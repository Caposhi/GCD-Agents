/**
 * Disposable-PostgreSQL suite for the Content Studio web service
 * (docs/CONTENT_STUDIO_DESIGN.md §3.2, §4.1, §7): `npm run test:studio-web-postgres`,
 * run on PostgreSQL 16 and 18 in CI's existing Content Studio step of the
 * `postgres-integration` job, after the schema and worker suites. The issuer is
 * the local fake (`testSupport.ts`): no test ever contacts Google.
 *
 * Safety contract (the schema suite's): STUDIO_DISPOSABLE_POSTGRES=1 and a
 * loopback-only STUDIO_POSTGRES_ADMIN_URL are required; DATABASE_URL and
 * STUDIO_DATABASE_URL must be unset; a pre-existing `gcd_studio` is never
 * touched; every database it creates is dropped, after every pool and child
 * connection it opened has closed.
 *
 * Every check is `SAP…`.
 */

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { runStudioMigrations, STUDIO_DATABASE_NAME, STUDIO_EXPECTED_MIGRATIONS, STUDIO_SCHEMA_VERSION } from "../db/runner.js";
import { createStudioWebApp, type StudioWebApp, type WebLog } from "./app.js";
import { GOOGLE_OIDC } from "./oidc.js";
import { csrfTokenFor, LOGIN_COOKIE, SESSION_COOKIE, sessionIdHash } from "./sessions.js";
import { STUDIO_ALLOWED_HD } from "./startup.js";
import { PgWebStore } from "./store.js";
import { FakeIssuer, STUDIO_DOMAIN, syntheticEmail, syntheticRunArtifacts } from "./testSupport.js";
import { providerTextWithContact } from "../../harness/agents/providerText.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ORIGIN = "https://studio.test";
const COMMIT = createHash("sha256").update("studio-web-postgres-suite").digest("hex").slice(0, 40);
const CLIENT_ID = `client-${randomBytes(4).toString("hex")}.apps.test`;
const CLIENT_SECRET = `secret-${randomBytes(18).toString("base64url")}`;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

let failures = 0;
let total = 0;
function check(name: string, cond: boolean, detail = ""): void {
  total += 1;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : ` — ${detail}`}`);
  if (!cond) failures += 1;
}
const logLines: string[] = [];
const log: WebLog = (event, fields = {}) => { logLines.push(`${event} ${JSON.stringify(fields)}`); };

// --- The schema suite's environment contract and disposable databases ----------------------------

function adminUrl(): string {
  if (process.env.STUDIO_DISPOSABLE_POSTGRES !== "1") {
    throw new Error("STUDIO_DISPOSABLE_POSTGRES=1 is required for this destructive disposable-database test");
  }
  if (process.env.DATABASE_URL !== undefined || process.env.STUDIO_DATABASE_URL !== undefined) {
    throw new Error("unset DATABASE_URL and STUDIO_DATABASE_URL: this suite builds each environment itself");
  }
  const raw = process.env.STUDIO_POSTGRES_ADMIN_URL;
  if (!raw) throw new Error("STUDIO_POSTGRES_ADMIN_URL is required");
  const parsed = new URL(raw);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new Error("STUDIO_POSTGRES_ADMIN_URL must be a PostgreSQL URL");
  if (!new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(parsed.hostname.toLowerCase())) {
    throw new Error("STUDIO_POSTGRES_ADMIN_URL must use a loopback hostname");
  }
  if (!parsed.pathname || parsed.pathname === "/") throw new Error("STUDIO_POSTGRES_ADMIN_URL must identify an administrative database");
  return parsed.toString();
}

const OWNED_NAME = /^gcd_studio(?:_disposable_[a-z0-9_]+)?$/;
const databaseUrl = (admin: string, name: string) => { const u = new URL(admin); u.pathname = `/${name}`; return u.toString(); };
const CONNECTION_TERMINATED = "57P01";
const unexpectedPoolErrors: string[] = [];
const pools = new Map<pg.Pool, { closing: boolean; closed: Promise<void>[] }>();

function openPool(label: string, config: pg.PoolConfig): pg.Pool {
  const pool = new pg.Pool(config);
  const state = { closing: false, closed: [] as Promise<void>[] };
  pool.on("connect", (client) => { state.closed.push(new Promise<void>((settle) => client.once("end", () => settle()))); });
  pool.on("error", (error: Error) => {
    const code = (error as { code?: unknown }).code;
    if (state.closing && code === CONNECTION_TERMINATED) return;
    unexpectedPoolErrors.push(`${label}: ${typeof code === "string" ? code : "no SQLSTATE"} ${error.message}`);
  });
  pools.set(pool, state);
  return pool;
}
async function closePool(pool: pg.Pool): Promise<void> {
  const state = pools.get(pool)!;
  state.closing = true;
  await pool.end();
  await Promise.all(state.closed);
}

class Databases {
  readonly created = new Set<string>();
  constructor(readonly admin: pg.Pool, readonly adminUrl: string) {}
  async create(name: string): Promise<string> {
    if (!OWNED_NAME.test(name)) throw new Error(`refusing unexpected disposable database name: ${name}`);
    if ((await this.admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rows.length) {
      throw new Error(`database ${name} already exists; this suite never touches a database it did not create`);
    }
    await this.admin.query(`CREATE DATABASE "${name}"`);
    this.created.add(name);
    return databaseUrl(this.adminUrl, name);
  }
  async drop(name: string): Promise<void> {
    if (!OWNED_NAME.test(name) || !this.created.has(name)) throw new Error(`refusing to drop ${name}`);
    await this.admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [name]);
    await this.admin.query(`DROP DATABASE "${name}"`);
    this.created.delete(name);
  }
}

async function migrate(url: string, directory = resolve(REPO_ROOT, "studio/migrations")): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await runStudioMigrations(client, { directory });
  } finally {
    await client.end();
  }
}

// --- The app over the real store, and a browser -------------------------------------------------

interface Web { app: StudioWebApp; base: string; close(): Promise<void> }

async function web(pool: pg.Pool, issuer: FakeIssuer, bootstrapOwnerEmail: string | null = null, store?: PgWebStore): Promise<Web> {
  const app = createStudioWebApp({
    store: store ?? new PgWebStore(pool, pool), log, oidc: issuer.provider, commit: COMMIT,
    config: { publicOrigin: ORIGIN, allowedHd: STUDIO_ALLOWED_HD, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, bootstrapOwnerEmail },
  });
  const server: Server = createServer((req, res) => { void app.handle(req, res); });
  await new Promise<void>((settle) => server.listen(0, "127.0.0.1", settle));
  return {
    app, base: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: () => new Promise<void>((settle) => { server.closeAllConnections(); server.close(() => settle()); }),
  };
}

class Jar {
  readonly values = new Map<string, string>();
  header(): string { return [...this.values].map(([k, v]) => `${k}=${v}`).join("; "); }
  take(setCookies: string[]): void {
    for (const cookie of setCookies) {
      const [pair] = cookie.split(";");
      const at = pair!.indexOf("=");
      if (pair!.slice(at + 1) === "") this.values.delete(pair!.slice(0, at));
      else this.values.set(pair!.slice(0, at), pair!.slice(at + 1));
    }
  }
}

async function get(base: string, path: string, jar?: Jar, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (jar?.values.size) headers.cookie = jar.header();
  const response = await fetch(`${base}${path}`, { method: init.method ?? "GET", headers, body: init.body, redirect: "manual" });
  jar?.take(response.headers.getSetCookie());
  return { status: response.status, location: response.headers.get("location"), body: await response.text(), headers: response.headers };
}

/** Login, the issuer's redirect, and the callback path (not yet followed). */
async function startSignIn(w: Web, jar: Jar): Promise<string> {
  const login = await get(w.base, "/auth/login", jar);
  const back = new URL((await fetch(login.location!, { redirect: "manual" })).headers.get("location")!);
  return `${back.pathname}${back.search}`;
}

/** Every text value in every Studio table, for proving a value never reached the database. */
async function everyStoredText(pool: pg.Pool): Promise<string> {
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'studio\\_%'")).rows;
  const parts: string[] = [];
  for (const { tablename } of tables) {
    const rows = (await pool.query(`SELECT to_jsonb(t)::text AS row FROM ${pg.escapeIdentifier(String(tablename))} t`)).rows;
    parts.push(...rows.map((r) => String(r.row)));
  }
  return parts.join("\n");
}

async function main(): Promise<void> {
  const admin = adminUrl();
  const adminPool = openPool("admin", { connectionString: admin, max: 3, connectionTimeoutMillis: 10_000 });
  const dbs = new Databases(adminPool, admin);
  const issuer = await new FakeIssuer(CLIENT_ID, CLIENT_SECRET).start();
  const started = performance.now();
  try {
    console.log(`[studio-web-postgres] server version ${(await adminPool.query("SHOW server_version")).rows[0]?.server_version}`);
    if ((await adminPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [STUDIO_DATABASE_NAME])).rows.length) {
      throw new Error(`a database named ${STUDIO_DATABASE_NAME} already exists on this server; this suite never touches it`);
    }

    // SAP1: the web's identity refusal against a database that is not gcd_studio, executed through the entry point.
    {
      const otherName = `gcd_studio_disposable_${randomBytes(4).toString("hex")}`;
      const otherUrl = await dbs.create(otherName);
      try {
        const run = await runEntryPoint(otherUrl, String(await freePort()), 20_000);
        check("SAP1. the web refuses, through its entry point, a database that is not gcd_studio — exit 1, refused "
          + "(wrong-database), before it listens", run.code === 1 && /refused \(wrong-database\)/.test(run.stderr) && !run.ready,
        run.stderr.trim());
      } finally {
        await dbs.drop(otherName);
      }
    }

    const url = await dbs.create(STUDIO_DATABASE_NAME);
    try {
      // SAP2: an unmigrated gcd_studio is refused too; then migrate.
      const unmigrated = await runEntryPoint(url, String(await freePort()), 20_000);
      check("SAP2. the web refuses an unmigrated gcd_studio (not-migrated) before it listens",
        unmigrated.code === 1 && /refused \(not-migrated\)/.test(unmigrated.stderr) && !unmigrated.ready, unmigrated.stderr.trim());
      // SAP15 (Content Studio S6.1): migrated to 0002 alone, the web refuses; SAP3 then shows 0003 accepted.
      const only0002 = mkdtempSync(join(tmpdir(), "gcd-studio-web-0002-"));
      try {
        for (const name of STUDIO_EXPECTED_MIGRATIONS.slice(0, 2)) {
          copyFileSync(resolve(REPO_ROOT, "studio/migrations", name), join(only0002, name));
        }
        await migrate(url, only0002);
      } finally {
        rmSync(only0002, { recursive: true, force: true });
      }
      const older = await runEntryPoint(url, String(await freePort()), 20_000);
      check("SAP15. the web refuses, through its entry point, a gcd_studio migrated to 0002 alone — exit 1, refused "
        + `(schema-version), before it listens; once 0003 is applied on top it starts (SAP3, schema ${STUDIO_SCHEMA_VERSION})`,
        older.code === 1 && /refused \(schema-version\)/.test(older.stderr) && !older.ready
          && STUDIO_SCHEMA_VERSION === "0003_studio_preflight_requests.sql", older.stderr.trim());
      await migrate(url);
      const pool = openPool("web", { connectionString: url, max: 6 });
      try {
        await suite(pool, url, issuer);
      } finally {
        await closePool(pool);
      }
    } finally {
      await dbs.drop(STUDIO_DATABASE_NAME);
    }
  } finally {
    await issuer.stop();
    for (const name of [...dbs.created]) await dbs.drop(name).catch((e) => console.error(`[studio-web-postgres] drop ${name}: ${(e as Error).message}`));
    await closePool(adminPool);
  }
  if (unexpectedPoolErrors.length) {
    console.log(`FAIL  pool errors — ${unexpectedPoolErrors.length} unexpected: ${unexpectedPoolErrors.join(" | ")}`);
    failures += 1;
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(failures === 0 ? `\n[studio-web-postgres] PASS ${total} checks in ${seconds}s`
    : `\n[studio-web-postgres] ${failures} FAILURE(S) of ${total} checks`);
  process.exitCode = failures === 0 ? 0 : 1;
}

/** Runs `dist/studio/web/main.js` against `url`, until it is ready (then stops it) or exits. */
function runEntryPoint(url: string, port: string, timeoutMs: number, onReady?: (child: { port: number }) => Promise<void>):
  Promise<{ code: number | null; stderr: string; ready: boolean }> {
  return new Promise((settle) => {
    const child = spawn(process.execPath, [resolve(REPO_ROOT, "dist/studio/web/main.js")], {
      env: {
        PATH: process.env.PATH ?? "", STUDIO_DATABASE_URL: url, STUDIO_PUBLIC_ORIGIN: ORIGIN, STUDIO_ALLOWED_HD,
        STUDIO_GOOGLE_CLIENT_ID: CLIENT_ID, STUDIO_GOOGLE_CLIENT_SECRET: CLIENT_SECRET, RENDER_GIT_COMMIT: COMMIT, PORT: port,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let ready = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (!ready && stdout.includes("[studio-web] ready ")) {
        ready = true;
        void (onReady ?? (async () => undefined))({ port: Number(port) }).finally(() => child.kill("SIGTERM"));
      }
    });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("exit", (code) => { clearTimeout(timer); settle({ code, stderr: stderr + stdout, ready }); });
  });
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((settle) => server.listen(0, "127.0.0.1", settle));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((settle) => server.close(() => settle()));
  return port;
}

async function suite(pool: pg.Pool, url: string, issuer: FakeIssuer): Promise<void> {
  // SAP3: the entry point, end to end, with Google's constants.
  {
    const port = await freePort();
    let health: { status: number; body: string; headers: Headers } | undefined;
    let login: { status: number; location: string | null } | undefined;
    const run = await runEntryPoint(url, String(port), 30_000, async () => {
      health = await get(`http://127.0.0.1:${port}`, "/healthz");
      login = await get(`http://127.0.0.1:${port}`, "/auth/login", new Jar());
    });
    const doc = JSON.parse(health?.body ?? "{}") as Record<string, unknown>;
    const attempts = Number((await pool.query("SELECT count(*) AS n FROM studio_login_attempts")).rows[0].n);
    check("SAP3. `npm run start:studio-web`, executed against the migrated gcd_studio: it starts, /healthz reports "
      + "gcd-studio-web, the commit, postgres, schema 0003 and no heartbeat yet, with the security headers; and its "
      + "/auth/login redirects to Google's authorization endpoint — the entry point passes Google's constants — after "
      + "storing one login attempt",
      run.ready && health?.status === 200 && doc.service === "gcd-studio-web" && doc.commit === COMMIT && doc.state === "postgres"
        && doc.schema_version === "0003_studio_preflight_requests.sql" && doc.worker_heartbeat_age_seconds === null
        && health.headers.get("content-security-policy")?.startsWith("default-src 'self'") === true
        && login?.status === 302 && login.location!.startsWith(`${GOOGLE_OIDC.authorizationEndpoint}?`)
        && new URL(login.location!).searchParams.get("redirect_uri") === `${ORIGIN}/auth/callback` && attempts === 1,
      `${run.stderr.trim()} ${health?.status} ${login?.status}`);
    await pool.query("DELETE FROM studio_login_attempts");
  }

  // SAP4: two concurrent first sign-ins create exactly one owner.
  {
    const bootstrap = syntheticEmail("first.owner");
    const sub = `sub-${randomBytes(6).toString("hex")}`;
    // (a) The schema's own serialization: both transactions see no owner, then both insert.
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>((settle) => { release = settle; });
    const race = (email: string, s: string) => new PgWebStore(pool, pool).transaction(async (tx) => {
      const sawOwner = await tx.activeOwnerExists();
      arrived += 1;
      if (arrived === 2) release();
      await barrier;
      if (sawOwner) throw new Error("an owner already existed");
      return tx.createBootstrapOwner({ email, sub: s, displayName: null });
    });
    const raced = await Promise.allSettled([race(bootstrap, sub), race(syntheticEmail("second.owner"), `sub-${randomBytes(6).toString("hex")}`)]);
    const refusedCode = raced.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason?.code);
    const ownersA = Number((await pool.query("SELECT count(*) AS n FROM studio_users WHERE role = 'owner'")).rows[0].n);
    await pool.query("ALTER TABLE studio_users DISABLE TRIGGER studio_users_keep_an_owner");
    await pool.query("DELETE FROM studio_users");
    await pool.query("ALTER TABLE studio_users ENABLE TRIGGER studio_users_keep_an_owner");
    // (b) Two concurrent first sign-ins through the app, for the bootstrap email.
    const w = await web(pool, issuer, bootstrap);
    issuer.identity = { email: bootstrap, sub, name: "First Owner" };
    issuer.plan = {};
    const jars = [new Jar(), new Jar()];
    const paths = [await startSignIn(w, jars[0]!), await startSignIn(w, jars[1]!)];
    const replies = await Promise.all(paths.map((path, i) => get(w.base, path, jars[i])));
    const owners = (await pool.query("SELECT email, google_sub, status, created_by FROM studio_users WHERE role = 'owner'")).rows;
    const reasons = (await pool.query("SELECT detail->>'reason' AS reason FROM studio_audit_log WHERE action = 'auth.sign_in_refused'")).rows
      .map((r) => r.reason);
    await w.close();
    check("SAP4. two concurrent first sign-ins create exactly one owner: two transactions that both saw no owner cannot "
      + "both insert one (the schema's advisory-locked trigger refuses the second), and two concurrent bootstrap "
      + "callbacks through the app leave one owner, with any loser refused by name",
      raced.filter((r) => r.status === "fulfilled").length === 1 && refusedCode.join() === "23514" && ownersA === 1
        && owners.length === 1 && owners[0]!.email === bootstrap && owners[0]!.google_sub === sub && owners[0]!.created_by === null
        && replies.every((r) => r.status === 303 || r.status === 403) && replies.some((r) => r.status === 303)
        && reasons.every((r) => r === "bootstrap-refused"),
      `${raced.map((r) => r.status).join()} ${refusedCode.join()} ${replies.map((r) => r.status).join()} ${reasons.join()}`);
  }

  const owner = (await pool.query("SELECT id::text AS id, email FROM studio_users WHERE role = 'owner'")).rows[0] as { id: string; email: string };
  const viewer = (await pool.query("INSERT INTO studio_users (email, role, created_by, display_name) VALUES ($1, 'viewer', $2, 'Synthetic Viewer') RETURNING id::text AS id, email",
    [syntheticEmail("viewer"), owner.id])).rows[0] as { id: string; email: string };
  const viewerSub = `sub-${randomBytes(6).toString("hex")}`;

  // SAP5: a full sign-in over the real store; google_sub set once; nothing secret stored; replay refused.
  {
    const w = await web(pool, issuer);
    issuer.identity = { email: viewer.email, sub: viewerSub, name: "Synthetic Viewer" };
    const jar = new Jar();
    const path = await startSignIn(w, jar);
    const login = jar.values.get(LOGIN_COOKIE)!;
    const reply = await get(w.base, path, jar);
    const cookie = jar.values.get(SESSION_COOKIE) ?? "";
    const row = (await pool.query("SELECT google_sub FROM studio_users WHERE id = $1", [viewer.id])).rows[0];
    const replayJar = new Jar();
    replayJar.values.set(LOGIN_COOKIE, login);
    const replay = await get(w.base, path, replayJar);
    const stored = await everyStoredText(pool);
    const secretsHere = [cookie, csrfTokenFor(cookie), login, ...issuer.secrets].filter((s) => s.length >= 8);
    const home = await get(w.base, "/", jar);
    check("SAP5. over PostgreSQL a listed user signs in, google_sub is set at first sign-in, the session row holds only "
      + "sha256(cookie), and no cookie value, CSRF token, state, nonce, code or ID token appears in any Studio table; "
      + "the same callback replayed is refused, because studio_consume_login_attempt deleted the attempt",
      reply.status === 303 && reply.location === "/" && /^[A-Za-z0-9_-]{43}$/.test(cookie) && row.google_sub === viewerSub
        && (await pool.query("SELECT 1 FROM studio_sessions WHERE id_hash = $1", [sessionIdHash(cookie)])).rows.length === 1
        && secretsHere.length > 5 && secretsHere.every((s) => !stored.includes(s))
        && replay.status === 403 && home.body.includes("Synthetic Viewer"),
      `${reply.status} ${replay.status} ${secretsHere.filter((s) => stored.includes(s)).length} stored`);
    const reason = (await pool.query("SELECT detail->>'reason' AS r FROM studio_audit_log WHERE action = 'auth.sign_in_refused' ORDER BY at DESC LIMIT 1")).rows[0]?.r;
    check("SAP5a. the replay's audit row names only the reason class (state-unknown)", reason === "state-unknown", String(reason));

    // SAP6: an attempt older than 10 minutes is refused by the schema's function, and deleted by it.
    const state = randomBytes(32).toString("base64url");
    await pool.query(
      `INSERT INTO studio_login_attempts (state_hash, nonce_hash, pkce_verifier, created_at, expires_at)
       VALUES ($1, $2, $3, now() - interval '11 minutes', now() - interval '1 minute')`, [sha(state), sha("n"), "v".repeat(43)]);
    const oldJar = new Jar();
    oldJar.values.set(LOGIN_COOKIE, state);
    const expired = await get(w.base, `/auth/callback?state=${state}&code=x`, oldJar);
    const left = (await pool.query("SELECT 1 FROM studio_login_attempts WHERE state_hash = $1", [sha(state)])).rows.length;
    check("SAP6. a login attempt over 10 minutes old is refused at the callback and removed by the consumption itself",
      expired.status === 403 && left === 0);

    // SAP7: disabling a user revokes their sessions in the same transaction; the next request is signed out.
    const before = (await get(w.base, "/", jar)).body.includes("Signed in as");
    await pool.query("UPDATE studio_users SET status = 'disabled' WHERE id = $1", [viewer.id]);
    const revoked = (await pool.query("SELECT revoked_at FROM studio_sessions WHERE id_hash = $1", [sessionIdHash(cookie)])).rows[0];
    const after = await get(w.base, "/", jar);
    await pool.query("UPDATE studio_users SET status = 'active' WHERE id = $1", [viewer.id]);
    const reEnabled = await get(w.base, "/", (() => { const j = new Jar(); j.values.set(SESSION_COOKIE, cookie); return j; })());
    check("SAP7. disabling a user revokes their sessions in the same transaction (the schema's trigger): the next request "
      + "is signed out, and re-enabling the user does not revive the session",
      before && revoked?.revoked_at instanceof Date && !after.body.includes("Signed in as") && !reEnabled.body.includes("Signed in as"));
    await w.close();
  }

  // SAP8: the schema's session guard and lifetimes, enforced.
  {
    const refused = async (sql: string, values: unknown[]) => {
      try { await pool.query(sql, values); return "accepted"; } catch (error) { return String((error as { code?: unknown }).code); }
    };
    const insert = (idHash: string, user: string, extra = "") => refused(
      `INSERT INTO studio_sessions (id_hash, user_id, csrf_token_hash, created_at, last_seen_at, idle_expires_at, absolute_expires_at${extra ? ", revoked_at" : ""})
       VALUES ($1, $2, $3, now(), now(), now() + interval '12 hours', now() + interval '7 days'${extra})`, [idHash, user, sha("csrf")]);
    const disabled = (await pool.query("INSERT INTO studio_users (email, role, created_by, status) VALUES ($1, 'viewer', $2, 'disabled') RETURNING id::text AS id",
      [syntheticEmail("disabled"), owner.id])).rows[0].id as string;
    const live = sha(`live-${randomBytes(4).toString("hex")}`);
    const results = {
      live: await insert(live, owner.id),
      disabledUser: await insert(sha("d"), disabled),
      createdRevoked: await insert(sha("r"), owner.id, ", now()"),
      tooLong: await refused(`INSERT INTO studio_sessions (id_hash, user_id, csrf_token_hash, idle_expires_at, absolute_expires_at)
        VALUES ($1, $2, $3, now() + interval '12 hours', now() + interval '8 days')`, [sha("l"), owner.id, sha("c")]),
      idleTooLong: await refused("UPDATE studio_sessions SET idle_expires_at = last_seen_at + interval '13 hours' WHERE id_hash = $1", [live]),
      absoluteChanged: await refused("UPDATE studio_sessions SET absolute_expires_at = absolute_expires_at - interval '1 hour' WHERE id_hash = $1", [live]),
      csrfChanged: await refused("UPDATE studio_sessions SET csrf_token_hash = $2 WHERE id_hash = $1", [live, sha("other")]),
      revoke: await refused("UPDATE studio_sessions SET revoked_at = now() WHERE id_hash = $1", [live]),
      revokedChanged: await refused("UPDATE studio_sessions SET last_seen_at = now() WHERE id_hash = $1", [live]),
    };
    const store = new PgWebStore(pool, pool);
    await store.touchSession(live, new Date(), new Date(Date.now() + 3_600_000));
    check("SAP8. the schema's session triggers hold under the web's store: no session for a disabled user or created "
      + "revoked, no lifetime past 7 days or idle past 12 hours, no change to the absolute expiry or CSRF hash, and a "
      + "revoked session never changes (the store's touch leaves it alone)",
      JSON.stringify(results) === JSON.stringify({ live: "accepted", disabledUser: "23514", createdRevoked: "23514", tooLong: "23514",
        idleTooLong: "23514", absoluteChanged: "23514", csrfChanged: "23514", revoke: "accepted", revokedChanged: "23514" }),
      JSON.stringify(results));
  }

  // SAP9: the purge (design §4.7): attempts a day after expiry, sessions 30 days after they end.
  {
    await pool.query("DELETE FROM studio_login_attempts");
    const attempt = (id: string, age: string) => pool.query(
      `INSERT INTO studio_login_attempts (state_hash, nonce_hash, pkce_verifier, created_at, expires_at)
       VALUES ($1, $2, $3, now() - $4::interval, now() - $4::interval + interval '10 minutes')`, [sha(id), sha("n"), "v".repeat(43), age]);
    await attempt("attempt-2-days", "2 days");
    await attempt("attempt-1-hour", "1 hour");
    await attempt("attempt-live", "1 minute");
    await pool.query("DELETE FROM studio_sessions");
    const session = (id: string, created: string, revoked: string | null) => pool.query(
      `INSERT INTO studio_sessions (id_hash, user_id, csrf_token_hash, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, $3, now() - $4::interval, now() - $4::interval, now() - $4::interval + interval '12 hours',
               now() - $4::interval + interval '7 days')`, [sha(id), owner.id, sha(`c-${id}`), created])
      .then(() => revoked === null ? undefined : pool.query("UPDATE studio_sessions SET revoked_at = now() - $2::interval WHERE id_hash = $1", [sha(id), revoked]));
    await session("absolute-38-days", "38 days", null);
    await session("idle-31-days", "31 days 12 hours", null);
    await session("idle-1-day", "36 hours", null);
    await session("revoked-31-days", "1 hour", "31 days");
    await session("revoked-1-hour", "3 hours", "1 hour");
    await session("live", "1 hour", null);
    const w = await web(pool, issuer);
    const result = await w.app.purge();
    await w.close();
    const attempts = (await pool.query("SELECT state_hash FROM studio_login_attempts")).rows.map((r) => r.state_hash).sort();
    const sessions = (await pool.query("SELECT id_hash FROM studio_sessions")).rows.map((r) => r.id_hash).sort();
    check("SAP9. the purge DELETEs login attempts a day after they expire and sessions 30 days after their idle or "
      + "absolute expiry or their revocation, and keeps an attempt expired an hour ago, a live one, a session idle-expired "
      + "a day ago, one revoked an hour ago and a live one",
      result.loginAttempts === 1 && result.sessions === 3
        && attempts.join() === [sha("attempt-1-hour"), sha("attempt-live")].sort().join()
        && sessions.join() === [sha("idle-1-day"), sha("live"), sha("revoked-1-hour")].sort().join(),
      JSON.stringify(result));
  }

  // SAP12–SAP14 (Content Studio S5): the read-only screens over the real store.
  {
    const insertRun = async (goal: string, extra: { state?: string; failure?: string; created?: string } = {}) => {
      const id = (await pool.query(
        "INSERT INTO studio_runs (kind, requested_by, runner, goal, platforms) VALUES ('full', $1, 'fake', $2, $3) RETURNING id::text AS id",
        [owner.id, goal, ["instagram", "facebook", "google_business_profile"]])).rows[0].id as string;
      if (extra.state === "queued") return id;
      await pool.query("UPDATE studio_runs SET state = 'running', started_at = now() WHERE id = $1", [id]);
      return id;
    };
    const finish = (id: string, state: string, set = "") => pool.query(
      `UPDATE studio_runs SET state = $2, finished_at = now()${set} WHERE id = $1`, [id, state]);
    const files = syntheticRunArtifacts("");
    const done = await insertRun("SYNTHETIC S5 succeeded run");
    for (const [name, text] of Object.entries(files)) {
      const bytes = Buffer.from(text, "utf8");
      await pool.query("INSERT INTO studio_run_artifacts (run_id, name, content, sha256, byte_length) VALUES ($1, $2, $3, $4, $5)",
        [done, name, bytes, createHash("sha256").update(bytes).digest("hex"), bytes.length]);
    }
    const finding = (idx: number, lens: string, severity: string, category: string, ownerName: string) => pool.query(
      `INSERT INTO studio_findings (run_id, idx, lens, severity, category, owner, issue, owner_item)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $6 = 'human_review' OR $5 = 'human_decision')`,
      [done, idx, lens, severity, category, ownerName, `SYNTHETIC issue ${idx}`]);
    await finding(0, "evidence-fidelity", "advisory", "claim_fidelity", "packaging-adaptation");
    await finding(1, "production-coherence", "blocking", "production_coherence", "production-direction");
    await finding(2, "production-coherence", "advisory", "human_decision", "human_review");
    await finding(3, "voice-and-craft", "blocking", "human_decision", "packaging-adaptation");
    await finish(done, "succeeded", ", verdict = 'needs_revision', blocking_findings = 2, advisory_findings = 2, owner_item_findings = 2");
    const failed = await insertRun("SYNTHETIC S5 failed run");
    await finish(failed, "failed", ", failure_class = 'stage_execution_error', failure_message = '<b>SYNTHETIC</b> message'");
    const gone = await insertRun("SYNTHETIC S5 deleted run");
    await finish(gone, "succeeded");
    await pool.query("UPDATE studio_runs SET deleted_at = now(), deleted_by = $2 WHERE id = $1", [gone, owner.id]);
    const queued = await insertRun("SYNTHETIC S5 queued run", { state: "queued" });

    const w = await web(pool, issuer);
    issuer.identity = { email: viewer.email, sub: viewerSub, name: "Synthetic Viewer" };
    const jar = new Jar();
    await get(w.base, await startSignIn(w, jar), jar);
    const all = await get(w.base, "/runs", jar);
    const listed = [...all.body.matchAll(/<li class="run"><p class="run-goal"><a href="\/runs\/([0-9a-f-]{36})">/g)].map((m) => m[1]);
    const onlyQueued = await get(w.base, "/runs?state=queued", jar);
    const byOwner = await get(w.base, `/runs?requester=${owner.id}&kind=full`, jar);
    const byViewer = await get(w.base, `/runs?requester=${viewer.id}`, jar);
    const runsBefore = (await pool.query("SELECT count(*)::int AS n FROM studio_runs")).rows[0].n;
    const injected = await Promise.all(["state=succeeded'%20OR%20'1'%3D'1", "kind=full%3B%20DELETE%20FROM%20studio_runs",
      `requester=${owner.id}'%20OR%20true--`].map((q) => get(w.base, `/runs?${q}`, jar)));
    const runsAfter = (await pool.query("SELECT count(*)::int AS n FROM studio_runs")).rows[0].n;
    check("SAP12. over PostgreSQL the runs list shows live runs newest first, never a deleted one; a state, kind or "
      + "requester filter is bound as a parameter and narrows exactly; SQL metacharacters are 400 and change nothing",
      all.status === 200 && JSON.stringify(listed) === JSON.stringify([queued, failed, done]) && !all.body.includes(gone)
        && all.body.includes(`<meta http-equiv="refresh"`)
        && onlyQueued.body.includes(queued) && !onlyQueued.body.includes(done) && !onlyQueued.body.includes(failed)
        && byOwner.body.includes(done) && byOwner.body.includes(queued) && !byViewer.body.includes(done)
        && byViewer.body.includes("No runs match.") && injected.every((r) => r.status === 400) && runsBefore === runsAfter,
      JSON.stringify(listed));

    const report = await get(w.base, `/runs/${done}`, jar);
    const failedReport = await get(w.base, `/runs/${failed}`, jar);
    const goneReport = await get(w.base, `/runs/${gone}`, jar);
    const goneFile = await get(w.base, `/runs/${gone}/files/summary.md`, jar);
    const decisions = report.body.slice(report.body.indexOf('class="decisions'), report.body.indexOf("</section>", report.body.indexOf('class="decisions')));
    const pkgs = JSON.parse(files["05-packaging-adaptation.json"]!).output.provisional.packages;
    const contacts = JSON.parse(files["05b-contact-lines.json"]!).packages;
    const copied = [...report.body.matchAll(/data-copy-kind="full" data-copy="([^"]*)"/g)].map((m) => m[1]!
      .replace(/&(amp|lt|gt|quot|#39|#13);/g, (_x, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#13": "\r" })[e]!));
    check("SAP13. over PostgreSQL the report reads the worker's rows and the stored artifacts: \"Needs your decision\" is "
      + "exactly the owner_item rows, the counts are the run's, the Copy text is providerTextWithContact's, a failed run "
      + "shows its escaped message, and a deleted run is 404 with its files",
      report.status === 200 && /SYNTHETIC issue 2/.test(decisions) && /SYNTHETIC issue 3/.test(decisions)
        && !/SYNTHETIC issue [01]/.test(decisions) && report.body.includes("<p>2 blocking · 2 advisory</p>")
        && copied.length === 2 && copied[0] === providerTextWithContact(pkgs[0].caption, pkgs[0].hashtags, contacts[0].contact)
        && copied[1] === providerTextWithContact(pkgs[1].caption, pkgs[1].hashtags, contacts[1].contact)
        && failedReport.body.includes("&lt;b&gt;SYNTHETIC&lt;/b&gt; message") && goneReport.status === 404 && goneFile.status === 404,
      `${report.status} ${goneReport.status} ${goneFile.status} ${copied.length}`);

    const name = "05-packaging-adaptation.json";
    const download = await fetch(`${w.base}/runs/${done}/files/${name}`, { headers: { cookie: jar.header() } });
    const bytes = Buffer.from(await download.arrayBuffer());
    const storedRow = (await pool.query("SELECT sha256 FROM studio_run_artifacts WHERE run_id = $1 AND name = $2", [done, name])).rows[0];
    let immutable: unknown = null;
    try {
      await pool.query("UPDATE studio_run_artifacts SET content = $3 WHERE run_id = $1 AND name = $2", [done, name, Buffer.from("x")]);
    } catch (error) {
      immutable = (error as { code?: unknown }).code;
    }
    // A test-only path: a store that hands the web other bytes than the row's own.
    const tamperingStore = new PgWebStore(pool, pool);
    const read = tamperingStore.readArtifact.bind(tamperingStore);
    tamperingStore.readArtifact = async (runId, artifact) => {
      const row = await read(runId, artifact);
      return row ? { ...row, content: Buffer.concat([row.content, Buffer.from(" ")]) } : row;
    };
    const tw = await web(pool, issuer, null, tamperingStore);
    const tjar = new Jar();
    await get(tw.base, await startSignIn(tw, tjar), tjar);
    const tampered = await get(tw.base, `/runs/${done}/files/${name}`, tjar);
    await tw.close();
    check("SAP14. over PostgreSQL a download is the stored bytes exactly (their sha256 is the row's), as an attachment with "
      + "nosniff and the sandboxing CSP; the schema refuses changing an artifact, and bytes changed through a test-only "
      + "path are refused, never served",
      download.status === 200 && createHash("sha256").update(bytes).digest("hex") === storedRow.sha256
        && bytes.equals(Buffer.from(files[name]!, "utf8"))
        && download.headers.get("content-disposition") === `attachment; filename="${name}"`
        && download.headers.get("content-type") === "application/json" && download.headers.get("x-content-type-options") === "nosniff"
        && download.headers.get("content-security-policy") === "default-src 'none'; sandbox"
        && immutable === "23514" && tampered.status === 500 && tampered.headers.get("content-disposition") === null,
      `${download.status} ${String(immutable)} ${tampered.status}`);
    await w.close();
  }

  // SAP10: the audit rows the web wrote hold no email, token or secret.
  {
    const audit = (await pool.query("SELECT action, detail::text AS detail, target_id FROM studio_audit_log")).rows;
    const text = JSON.stringify(audit);
    check("SAP10. every audit row the web wrote names an action and classes only: no email address, cookie, token or "
      + "secret appears in any detail",
      audit.length >= 4 && !/@/.test(text) && ![...issuer.secrets].some((s) => s.length >= 8 && text.includes(s))
        && !text.includes(CLIENT_SECRET) && audit.every((r) => r.target_id === null || /^[0-9a-f-]{36}$/.test(String(r.target_id))),
      `${audit.length} rows`);
  }

  check("SAP11. nothing the app logged during this suite holds an email address, the client secret or an issued secret",
    logLines.length > 5 && !logLines.some((l) => /@/.test(l) || l.includes(CLIENT_SECRET))
      && ![...issuer.secrets].some((s) => s.length >= 8 && logLines.some((l) => l.includes(s))));
  void STUDIO_DOMAIN;
}

main().catch((error: unknown) => {
  console.error(`[studio-web-postgres] fatal: ${(error as Error)?.stack ?? String(error)}`);
  process.exit(1);
});
