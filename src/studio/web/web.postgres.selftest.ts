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

import {
  preflightParamsSha256, runStudioMigrations, STUDIO_DATABASE_NAME, STUDIO_EXPECTED_MIGRATIONS, STUDIO_SCHEMA_VERSION,
  UNACKNOWLEDGED_OVERRUNS_SQL,
} from "../db/runner.js";
import { escapeHtml as escapeText } from "./html.js";
import { createStudioWebApp, type StudioWebApp, type WebLog } from "./app.js";
import { GOOGLE_OIDC } from "./oidc.js";
import { localDay, preflightRequest } from "./actions.js";
import { csrfTokenFor, LOGIN_COOKIE, SESSION_COOKIE, sessionIdHash } from "./sessions.js";
import { STUDIO_ALLOWED_HD } from "./startup.js";
import { PgWebStore } from "./store.js";
import { FakeIssuer, STUDIO_DOMAIN, syntheticEmail, syntheticRunArtifacts } from "./testSupport.js";
import { IMPORT_MAX_DOCUMENT_BYTES, RUN_BUNDLE_SCHEMA } from "./bundle.js";
import { providerTextWithContact } from "../../harness/agents/providerText.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ORIGIN = "https://studio.test";
const COMMIT = createHash("sha256").update("studio-web-postgres-suite").digest("hex").slice(0, 40);
const CLIENT_ID = `client-${randomBytes(4).toString("hex")}.apps.test`;
const CLIENT_SECRET = `secret-${randomBytes(18).toString("base64url")}`;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const sha256Of = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

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

/**
 * One owner-managed statement in its own transaction, declaring `actor` as the transaction's actor
 * (`SET LOCAL studio.actor`, Studio migration 0004).
 */
async function asActor(pool: pg.Pool, actor: string, sql: string, params: unknown[] = []): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(actor)) throw new Error("asActor: not a user id");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL studio.actor = '${actor}'`);
    await client.query(sql, params);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function web(pool: pg.Pool, issuer: FakeIssuer, bootstrapOwnerEmail: string | null = null, store?: PgWebStore): Promise<Web> {
  const app = createStudioWebApp({
    store: store ?? new PgWebStore(pool, pool), log, oidc: issuer.provider, commit: COMMIT,
    config: { publicOrigin: ORIGIN, allowedHd: STUDIO_ALLOWED_HD, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, bootstrapOwnerEmail,
      ceilings: { dailyMicros: 75_000_000, monthlyMicros: 300_000_000 } },
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
      // SAP15 (Content Studio S6.1, S7.1): migrated to 0002 alone, then to 0003 alone, the web refuses; SAP3 then
      // shows 0004 accepted.
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
      const only0003 = mkdtempSync(join(tmpdir(), "gcd-studio-web-0003-"));
      try {
        for (const name of STUDIO_EXPECTED_MIGRATIONS.slice(0, 3)) {
          copyFileSync(resolve(REPO_ROOT, "studio/migrations", name), join(only0003, name));
        }
        await migrate(url, only0003);
      } finally {
        rmSync(only0003, { recursive: true, force: true });
      }
      const at0003 = await runEntryPoint(url, String(await freePort()), 20_000);
      check("SAP15. the web refuses, through its entry point, a gcd_studio migrated to 0002 alone, and the same database at "
        + "0003 alone — exit 1, refused (schema-version), before it listens; once 0004 is applied on top it starts (SAP3, "
        + `schema ${STUDIO_SCHEMA_VERSION})`,
        older.code === 1 && /refused \(schema-version\)/.test(older.stderr) && !older.ready
          && at0003.code === 1 && /refused \(schema-version\)/.test(at0003.stderr) && !at0003.ready
          && STUDIO_SCHEMA_VERSION === "0004_studio_fact_checks_and_imports.sql", `${older.stderr.trim()} | ${at0003.stderr.trim()}`);
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
      + "gcd-studio-web, the commit, postgres, schema 0004 and no heartbeat yet, with the security headers; and its "
      + "/auth/login redirects to Google's authorization endpoint — the entry point passes Google's constants — after "
      + "storing one login attempt",
      run.ready && health?.status === 200 && doc.service === "gcd-studio-web" && doc.commit === COMMIT && doc.state === "postgres"
        && doc.schema_version === "0004_studio_fact_checks_and_imports.sql" && doc.worker_heartbeat_age_seconds === null
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
    await asActor(pool, owner.id, "UPDATE studio_users SET status = 'disabled', updated_by = $2 WHERE id = $1", [viewer.id, owner.id]);
    const revoked = (await pool.query("SELECT revoked_at FROM studio_sessions WHERE id_hash = $1", [sessionIdHash(cookie)])).rows[0];
    const after = await get(w.base, "/", jar);
    await asActor(pool, owner.id, "UPDATE studio_users SET status = 'active', updated_by = $2 WHERE id = $1", [viewer.id, owner.id]);
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

  // (S6.2's checks run after SAP10 and SAP11, which hold every audit row and log line the S4/S5 web wrote; the
  // settings changes below write the schema's own settings.update audit rows.)
  // SAP16-SAP25 (Content Studio S6.2): the actions over the real store and schema. The worker's answers are written
  // here as the worker writes them (a quote and the request's outcome); the worker suite runs the worker itself.
  {
    const CEILINGS = { dailyMicros: 75_000_000, monthlyMicros: 300_000_000 };
    /** Wide deployment ceilings, for the checks after the caps' own (the day's spend has grown by then). */
    const WIDE = { dailyMicros: 1_000_000_000, monthlyMicros: 10_000_000_000 };
    const sleep = (ms: number) => new Promise<void>((settle) => setTimeout(settle, ms));
    const COMMIT_S62 = "c".repeat(40);
    const APPROVED = "a".repeat(64);
    const PRICES = "b".repeat(64);
    const addUser = async (role: string, label: string) => {
      const sub = `sub-${label}-${randomBytes(4).toString("hex")}`;
      const email = syntheticEmail(label);
      // Content Studio S7.3, by fact: a runner with no daily cap cannot confirm (cap_missing), so each runner here has one
      // so large it never binds, even under WIDE ceilings. (Until S7.3 a runner had none, which meant no per-user cap.)
      const id = (await pool.query("INSERT INTO studio_users (email, role, created_by, google_sub, display_name, daily_cap_usd) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text AS id",
        [email, role, owner.id, sub, `Synthetic ${label}`, role === "runner" ? 999_999 : null])).rows[0].id as string;
      return { id, email, sub };
    };
    const runnerA = await addUser("runner", "s62-runner-a");
    const runnerB = await addUser("runner", "s62-runner-b");
    const facts = Buffer.from(JSON.stringify({ facts: [], note: `synthetic ${randomBytes(4).toString("hex")}` }), "utf8");
    const factSha = createHash("sha256").update(facts).digest("hex");
    await pool.query("INSERT INTO studio_fact_uploads (content, sha256, byte_length, uploaded_by) VALUES ($1, $2, $3, $4)",
      [facts, factSha, facts.length, owner.id]);
    // Since Studio migration 0004 a version is created only by the running fact check of its staged bytes.
    const check0004 = (await pool.query("INSERT INTO studio_jobs (kind) VALUES ('fact_check') RETURNING id::text AS id")).rows[0].id as string;
    await pool.query("INSERT INTO studio_fact_checks (job_id, requested_by, sha256, byte_length) VALUES ($1, $2, $3, $4)",
      [check0004, owner.id, factSha, facts.length]);
    await pool.query("UPDATE studio_jobs SET state = 'running' WHERE id = $1", [check0004]);
    const factVersion = (await pool.query(
      `INSERT INTO studio_fact_versions (sha256, content, byte_length, record_count, tag_counts, uploaded_by)
       VALUES ($1, $2, $3, 0, '{"synthetic-tag":2}', $4) RETURNING id::text AS id`, [factSha, facts, facts.length, owner.id])).rows[0].id as string;
    await pool.query("UPDATE studio_fact_checks SET outcome = 'accepted' WHERE job_id = $1", [check0004]);
    await pool.query("UPDATE studio_jobs SET state = 'finished' WHERE id = $1", [check0004]);
    await pool.query("DELETE FROM studio_fact_uploads");
    await asActor(pool, owner.id, "UPDATE studio_settings SET active_fact_version_id = $1, updated_by = $2", [factVersion, owner.id]);
    const beat = () => pool.query(
      `INSERT INTO studio_worker_heartbeat (singleton, commit, schema_version, approved_facts_sha256, approved_facts_tag_counts, price_table_sha256, beat_at)
       VALUES (true, $1, $2, $3, '{"synthetic-approved":3}', $4, now())
       ON CONFLICT (singleton) DO UPDATE SET commit = EXCLUDED.commit, approved_facts_sha256 = EXCLUDED.approved_facts_sha256,
         price_table_sha256 = EXCLUDED.price_table_sha256, beat_at = now()`, [COMMIT_S62, STUDIO_SCHEMA_VERSION, APPROVED, PRICES]);
    await beat();
    const store = new PgWebStore(pool, pool);
    const w = await web(pool, issuer);
    const signedIn = async (who: { email: string; sub: string }) => {
      issuer.identity = { email: who.email, sub: who.sub };
      const jar = new Jar();
      await get(w.base, await startSignIn(w, jar), jar);
      return jar;
    };
    const post = (path: string, jar: Jar, fields: Array<[string, string]> = []) => get(w.base, path, jar, {
      method: "POST", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([...fields, ["csrf", csrfTokenFor(jar.values.get(SESSION_COOKIE)!)]]).toString(),
    });
    const ownerSub = String((await pool.query("SELECT google_sub FROM studio_users WHERE id = $1", [owner.id])).rows[0].google_sub);
    const ownerJar = await signedIn({ email: owner.email, sub: ownerSub });
    const jarA = await signedIn(runnerA);
    const jarB = await signedIn(runnerB);
    const ask = async (jar: Jar, goal = "SYNTHETIC S6.2 goal") => {
      const reply = await post("/new/price", jar, [["goal", goal], ["platform", "instagram"], ["platform", "facebook"]]);
      return /^\/preflights\/([0-9a-f-]{36})$/.exec(reply.location ?? "")?.[1] ?? "";
    };
    /** The worker's answer, as `writePreflightOutcome` writes it. */
    const answer = async (requestId: string, ceiling = "21.650000", edit: { commit?: string; agedMinutes?: number } = {}) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const quote = (await c.query(
          `INSERT INTO studio_quotes (user_id, action, params_sha256, worker_commit, approved_facts_sha256, fact_version_id,
                                      price_table_sha256, ceiling_usd, breakdown, created_at, expires_at)
           SELECT user_id, action, params_sha256, $2, $3, fact_version_id, $4, $5,
                  '[{"item":"strategy-concept","unit":"request","ceilingUsd":"1.000000","lines":[]}]',
                  now() - make_interval(mins => $6), now() - make_interval(mins => $6) + interval '10 minutes'
             FROM studio_preflight_requests WHERE id = $1 RETURNING id::text AS id`,
          [requestId, edit.commit ?? COMMIT_S62, APPROVED, PRICES, ceiling, edit.agedMinutes ?? 0])).rows[0].id as string;
        await c.query("UPDATE studio_preflight_requests SET outcome = 'quoted', quote_id = $2 WHERE id = $1", [requestId, quote]);
        await c.query("COMMIT");
        return quote;
      } catch (error) {
        await c.query("ROLLBACK");
        throw error;
      } finally {
        c.release();
      }
    };
    const tally = async () => (await pool.query(
      `SELECT (SELECT count(*) FROM studio_runs WHERE runner = 'live')::int AS runs, (SELECT count(*) FROM studio_jobs WHERE kind = 'paid')::int AS jobs,
              (SELECT count(*) FROM studio_spend_ledger)::int AS ledger,
              (SELECT count(*) FROM studio_quotes WHERE consumed_at IS NOT NULL)::int AS consumed`)).rows[0];

    // SAP16: the price request, atomically, and the schema's own refusal.
    const requestId = await ask(jarA);
    const row = (await pool.query(
      `SELECT r.*, j.kind AS job_kind, j.state AS job_state FROM studio_preflight_requests r JOIN studio_jobs j ON j.id = r.job_id WHERE r.id = $1`,
      [requestId])).rows[0];
    const jobsBefore = (await pool.query("SELECT count(*)::int AS n FROM studio_jobs")).rows[0].n;
    const direct = (userId: string) => store.createPreflightRequest(preflightRequest({ userId, action: "full", goal: "x",
      platforms: ["instagram"], scopeTags: null, sourceRunId: null, factVersionId: factVersion })).then(() => "written", (e) => String(e.code));
    const viewerRefused = await direct(viewer.id);
    const disabledUser = await addUser("runner", "s62-disabled");
    await asActor(pool, owner.id, "UPDATE studio_users SET status = 'disabled', updated_by = $2 WHERE id = $1", [disabledUser.id, owner.id]);
    const disabledRefused = await direct(disabledUser.id);
    const jobsAfter = (await pool.query("SELECT count(*)::int AS n FROM studio_jobs")).rows[0].n;
    check("SAP16. over PostgreSQL a runner's price request writes its preflight job and its request in ONE transaction, with "
      + "params_sha256 by the canonical function; a viewer's or a disabled user's, written straight through the store, is "
      + "refused by migration 0003's trigger and leaves no job behind",
      row?.job_kind === "preflight" && row.job_state === "queued" && row.user_id === runnerA.id && row.action === "full"
        && row.params_sha256 === preflightParamsSha256({ action: "full", goal: row.goal, platforms: row.platforms, scopeTags: row.scope_tags,
          sourceRunId: null, factVersionId: factVersion })
        && viewerRefused === "23514" && disabledRefused === "23514" && jobsAfter === jobsBefore,
      `${viewerRefused} ${disabledRefused} ${jobsBefore}→${jobsAfter}`);

    // SAP17: the confirmation over the real schema.
    const quoteA = await answer(requestId);
    const confirmed = await post(`/quotes/${quoteA}/confirm`, jarA);
    const runId = /^\/runs\/([0-9a-f-]{36})$/.exec(confirmed.location ?? "")?.[1] ?? "";
    const made = (await pool.query(
      `SELECT r.state, r.runner, r.kind, r.reserved_usd::text AS reserved, r.requested_by::text AS by, r.automotive_facts_sha256 AS fact_sha,
              q.consumed_at IS NOT NULL AS consumed, l.amount_usd::text AS amount, l.day_local::text AS day,
              studio_local_day(now())::text AS today, j.kind AS job
         FROM studio_runs r JOIN studio_quotes q ON q.id = r.quote_id JOIN studio_spend_ledger l ON l.run_id = r.id AND l.entry = 'reserve'
         JOIN studio_jobs j ON j.run_id = r.id WHERE r.id = $1`, [runId])).rows[0];
    check("SAP17. over PostgreSQL a confirmation creates the queued live run, consumes its quote, books one reserve entry equal "
      + "to the ceiling to today's America/New_York day (the web's day equals studio_local_day(now())), and creates the paid "
      + "job — the schema's deferred confirmation check accepting the one transaction",
      confirmed.status === 303 && made?.state === "queued" && made.runner === "live" && made.kind === "full" && made.reserved === "21.650000"
        && made.by === runnerA.id && made.consumed === true && made.amount === "21.650000" && made.day === made.today
        && made.day === localDay(Date.now()) && made.job === "paid" && made.fact_sha === factSha,
      `${confirmed.status} ${JSON.stringify(made)}`);

    // SAP18: a double confirmation.
    const before18 = await tally();
    const twice = await Promise.all([post(`/quotes/${quoteA}/confirm`, jarA), post(`/quotes/${quoteA}/confirm`, jarA)]);
    const doubled = await Promise.all([ask(jarA).then(answer), Promise.resolve()]).then(async ([q]) =>
      Promise.all([store.confirmQuote({ quoteId: q, userId: runnerA.id, ceilings: CEILINGS }), store.confirmQuote({ quoteId: q, userId: runnerA.id, ceilings: CEILINGS })]));
    const after18 = await tally();
    check("SAP18. over PostgreSQL a double confirmation creates exactly one run, one job and one reserve entry: a used quote "
      + "is refused (quote_used), and two confirmations of one fresh quote at once confirm it once",
      twice.every((r) => r.status === 409 && r.body.includes("<code>quote_used</code>"))
        && doubled.filter((r) => r.ok).length === 1 && doubled.some((r) => !r.ok && r.refusal === "quote_used")
        && after18.runs === before18.runs + 1 && after18.jobs === before18.jobs + 1 && after18.ledger === before18.ledger + 1,
      `${JSON.stringify(before18)} → ${JSON.stringify(after18)}`);

    // SAP19: refusals over the real store, each writing nothing.
    const refusedWith = async (quoteId: string, userId: string, ceilings = CEILINGS) => {
      const before = await tally();
      const result = await store.confirmQuote({ quoteId, userId, ceilings });
      const after = await tally();
      return result.ok ? "confirmed" : JSON.stringify(before) === JSON.stringify(after) ? result.refusal : `${result.refusal}+wrote`;
    };
    const cases19 = [
      await refusedWith(crypto.randomUUID(), runnerA.id),
      await refusedWith(await answer(await ask(jarA)), runnerB.id),
      await refusedWith(await answer(await ask(jarA), "21.650000", { agedMinutes: 11 }), runnerA.id),
      await refusedWith(await answer(await ask(jarA), "21.650000", { commit: "d".repeat(40) }), runnerA.id),
      await (async () => { const q = await answer(await ask(jarA)); await pool.query("UPDATE studio_worker_heartbeat SET beat_at = now() - interval '3 minutes'");
        const r = await refusedWith(q, runnerA.id); await beat(); return r; })(),
      await refusedWith(await answer(await ask(jarA)), runnerA.id, { dailyMicros: 0, monthlyMicros: 300_000_000 }),
      await refusedWith(await answer(await ask(jarA), "60.000000"), runnerA.id),
    ];
    check("SAP19. over PostgreSQL, with nothing written: no quote, another user's quote, an expired one, one whose worker "
      + "commit differs from the heartbeat's, a stale heartbeat, a zero deployment ceiling, and a ceiling over the owner's "
      + "$50 daily cap are each refused",
      cases19.join() === "no_quote,quote_not_yours,quote_expired,quote_stale,worker_offline,cap_exceeded_daily,cap_exceeded_daily",
      cases19.join());

    // SAP20: two confirmations against the same headroom, over PostgreSQL.
    await asActor(pool, owner.id, "UPDATE studio_settings SET daily_cap_usd = $1, updated_by = $2", [
      (Number((await pool.query("SELECT studio_spend_for_day(studio_local_day(now()))::text AS s")).rows[0].s) + 30).toFixed(6), owner.id]);
    const [q1, q2] = [await answer(await ask(jarA)), await answer(await ask(jarB))];
    let release!: () => void;
    const held = new Promise<void>((settle) => { release = settle; });
    const first = store.confirmQuote({ quoteId: q1, userId: runnerA.id, ceilings: CEILINGS }, { beforeCommit: () => held });
    await sleep(200);
    const second = store.confirmQuote({ quoteId: q2, userId: runnerB.id, ceilings: CEILINGS });
    const secondEarly = await Promise.race([second.then(() => "settled"), sleep(700).then(() => "waiting")]);
    release();
    const [r1, r2] = await Promise.all([first, second]);
    check("SAP20. over PostgreSQL two confirmations against the same headroom (each $21.65, $30 left today): the second waits "
      + "on the settings row's FOR UPDATE while the first is open, then reads the first's reservation and is refused by the "
      + "cap; exactly one is confirmed",
      secondEarly === "waiting" && r1.ok && !r2.ok && r2.refusal === "cap_exceeded_daily",
      `${secondEarly} ${JSON.stringify(r1)} ${JSON.stringify(r2)}`);
    await asActor(pool, owner.id, "UPDATE studio_settings SET daily_cap_usd = 1000, monthly_cap_usd = 10000, updated_by = $1", [owner.id]);

    // SAP21: cancellation.
    const toCancel = r1.ok ? r1.runId : "";
    const runnerBCancels = await post(`/runs/${toCancel}/cancel`, jarB);
    const ownerCancels = await post(`/runs/${toCancel}/cancel`, ownerJar);
    const cancelled = (await pool.query(
      `SELECT r.state, r.failure_class, j.state AS job, (SELECT string_agg(entry || ':' || amount_usd::text || ':' || day_local::text, ',' ORDER BY entry DESC)
         FROM studio_spend_ledger WHERE run_id = r.id) AS ledger
         FROM studio_runs r JOIN studio_jobs j ON j.run_id = r.id WHERE r.id = $1`, [toCancel])).rows[0];
    const today = localDay(Date.now());
    check("SAP21. over PostgreSQL a runner cannot cancel another user's run (403, nothing changes), and the owner's "
      + "cancellation of a queued run cancels its job before any claim and releases its whole reservation, booked to the "
      + "reserve's day",
      runnerBCancels.status === 403 && ownerCancels.status === 303 && cancelled?.state === "cancelled"
        && cancelled.failure_class === "job_cancelled" && cancelled.job === "cancelled"
        && cancelled.ledger === `reserve:21.650000:${today},release:21.650000:${today}`,
      `${runnerBCancels.status} ${ownerCancels.status} ${JSON.stringify(cancelled)}`);

    // SAP22: fake runs.
    const fakeOwner = await post("/new/fake", ownerJar, [["goal", "SYNTHETIC fake wiring goal"], ["platform", "instagram"]]);
    const fakeId = /^\/runs\/([0-9a-f-]{36})$/.exec(fakeOwner.location ?? "")?.[1] ?? "";
    const fakeRow = (await pool.query(
      "SELECT r.runner, r.quote_id, r.reserved_usd, j.kind FROM studio_runs r JOIN studio_jobs j ON j.run_id = r.id WHERE r.id = $1", [fakeId])).rows[0];
    const fakeRunner = await post("/new/fake", jarA, [["goal", "SYNTHETIC fake wiring goal"], ["platform", "instagram"]]);
    const fakeDirect = await store.createFakeRun({ ownerId: runnerA.id, goal: "x", platforms: ["instagram"], scopeTags: null,
      factVersionId: null }).then(() => "written", (e) => String(e.code));
    check("SAP22. over PostgreSQL a fake run is the owner's alone: the owner's has a fake job, no quote and no reservation; "
      + "a runner's is refused by the route (403) and, written straight through the store, by the runs trigger",
      fakeOwner.status === 303 && fakeRow?.runner === "fake" && fakeRow.quote_id === null && fakeRow.reserved_usd === null
        && fakeRow.kind === "fake" && fakeRunner.status === 403 && fakeDirect === "23514",
      `${fakeOwner.status} ${fakeRunner.status} ${fakeDirect}`);

    // SAP23: the overrun lock and its acknowledgement; the spend panel.
    // An overrun on SAP17's live run (the worker's own path to one is proven in the worker suite).
    const overrunRun = runId;
    await pool.query("INSERT INTO studio_spend_ledger (entry, run_id, amount_usd) VALUES ('overrun', $1, 0.5)", [overrunRun]);
    const lockedQuote = await answer(await ask(jarA));
    const locked = await refusedWith(lockedQuote, runnerA.id);
    const panel = await get(w.base, "/spend", ownerJar);
    const runnerAck = await post(`/spend/overruns/${overrunRun}/acknowledge`, jarA);
    const ownerAck = await post(`/spend/overruns/${overrunRun}/acknowledge`, ownerJar);
    const unlocked = await store.confirmQuote({ quoteId: lockedQuote, userId: runnerA.id, ceilings: WIDE });
    check("SAP23. over PostgreSQL an unacknowledged overrun locks confirmations (confirmations_locked) and shows on the spend "
      + "panel with the owner's acknowledge button; a runner cannot acknowledge (403); the owner's acknowledgement writes "
      + "S3's audit row and the next confirmation succeeds",
      locked === "confirmations_locked" && panel.status === 200 && panel.body.includes(`/spend/overruns/${overrunRun}/acknowledge`)
        && runnerAck.status === 403 && ownerAck.status === 303 && unlocked.ok
        && (await pool.query("SELECT count(*)::int AS n FROM studio_audit_log WHERE action = 'spend.overrun_acknowledged' AND target_id = $1",
          [overrunRun])).rows[0].n === 1,
      `${locked} ${panel.status} ${runnerAck.status} ${ownerAck.status} ${JSON.stringify(unlocked)}`);

    // SAP24: the purge of preflight requests.
    const refusedOld = await ask(jarA);
    await pool.query("UPDATE studio_preflight_requests SET outcome = 'refused', refusal_class = 'params_mismatch', refusal_message = 'm' WHERE id = $1", [refusedOld]);
    const unusedOld = await ask(jarA);
    await answer(unusedOld);
    const consumedOld = await ask(jarA);
    const consumedQuote = await answer(consumedOld);
    const consumedRun = await store.confirmQuote({ quoteId: consumedQuote, userId: runnerA.id, ceilings: WIDE });
    const recent = await ask(jarA);
    const age = await pool.connect();
    try {
      await age.query("SET session_replication_role = replica");
      await age.query("UPDATE studio_preflight_requests SET created_at = now() - interval '40 days' WHERE id = ANY($1::uuid[])",
        [[refusedOld, unusedOld, consumedOld]]);
      await age.query("SET session_replication_role = origin");
    } finally {
      age.release();
    }
    const purged = await w.app.purge();
    const left = (await pool.query("SELECT id::text AS id FROM studio_preflight_requests WHERE id = ANY($1::uuid[])",
      [[refusedOld, unusedOld, consumedOld, recent]])).rows.map((r) => r.id).sort();
    check("SAP24. over PostgreSQL the purge deletes the preflight requests older than 30 days on which no consumed quote "
      + "depends — a refused one and one quoted but never confirmed — and keeps one whose quote was consumed (0003's trigger "
      + "would refuse it) and every request inside 30 days",
      consumedRun.ok && purged.preflightRequests === 2 && left.join() === [consumedOld, recent].sort().join(),
      `${JSON.stringify(purged)} ${left.join()} ${JSON.stringify(consumedRun)}`);

    // SAP25: the spend panel and the America/New_York day.
    const spend = await get(w.base, "/spend", jarA);
    const dbDay = (await pool.query("SELECT studio_local_day(now())::text AS d")).rows[0].d;
    check("SAP25. over PostgreSQL the spend panel is readable, shows today's America/New_York day as the schema books it "
      + "(the web's localDay equals studio_local_day(now())) and lists each user's spend and every overrun as acknowledged",
      spend.status === 200 && dbDay === localDay(Date.now()) && spend.body.includes(`Today (${dbDay})`)
        && spend.body.includes("Synthetic s62-runner-a") && spend.body.includes("acknowledged"),
      `${spend.status} ${dbDay}`);

    // SAP27-SAP33 (Content Studio S7.2): fact versions, imports and the whole-run bundle over the real schema.
    const viewerS72 = await addUser("viewer", "s72-viewer");
    const viewerJar = await signedIn(viewerS72);
    const document = (path: string, jar: Jar, text: string) => post(path, jar, [["document", text]]);
    const bundleText = (files: Array<[string, Buffer]>, edit: (entry: Record<string, string>, i: number) => void = () => {}) =>
      JSON.stringify({ schema: RUN_BUNDLE_SCHEMA, files: files.map(([name, content], i) => {
        const entry: Record<string, string> = { name, sha256: sha256Of(content), base64: content.toString("base64") };
        edit(entry, i);
        return entry;
      }) });
    const counts = async () => (await pool.query(
      `SELECT (SELECT count(*) FROM studio_runs)::int AS runs, (SELECT count(*) FROM studio_jobs)::int AS jobs,
              (SELECT count(*) FROM studio_run_artifacts)::int AS artifacts, (SELECT count(*) FROM studio_fact_uploads)::int AS staged,
              (SELECT count(*) FROM studio_fact_checks)::int AS checks, (SELECT count(*) FROM studio_fact_versions)::int AS versions,
              (SELECT count(*) FROM studio_preflight_requests)::int AS requests,
              (SELECT active_fact_version_id::text FROM studio_settings) AS active,
              (SELECT string_agg(status, ',' ORDER BY id) FROM studio_fact_versions) AS statuses`)).rows[0];

    // SAP27: every S7.2 edit is the owner's: refused by the schema for a runner, with nothing written.
    const s72Bytes = Buffer.from(JSON.stringify({ facts: [], synthetic: "sap27" }), "utf8");
    const before27 = await counts();
    const refusedCode = (p: Promise<unknown>) => p.then(() => "written", (e) => String((e as { code?: unknown }).code));
    const runnerEdits = [
      await refusedCode(store.stageFactUpload({ ownerId: runnerA.id, content: s72Bytes, sha256: sha256Of(s72Bytes) })),
      await refusedCode(store.activateFactVersion({ ownerId: runnerA.id, versionId: factVersion })),
      await refusedCode(store.setFactVersionStatus({ ownerId: runnerA.id, versionId: factVersion, status: "retired" })),
      await refusedCode(store.createImport({ ownerId: runnerA.id, runner: "live", lineage: null,
        files: [{ name: "summary.md", content: Buffer.from("x"), sha256: sha256Of(Buffer.from("x")) }] })),
    ];
    const after27 = await counts();
    check("SAP27. over PostgreSQL every S7.2 edit is the owner's: a runner's upload, activation, retirement and import, each "
      + "written straight through the store with the runner declared as the transaction's actor, is refused by the schema "
      + "(check_violation) and leaves nothing behind",
      runnerEdits.every((code) => code === "23514") && JSON.stringify(before27) === JSON.stringify(after27),
      `${runnerEdits.join()} ${JSON.stringify(before27)} ${JSON.stringify(after27)}`);

    // SAP28: activate, retire and restore through the routes, each audited with the owner as actor; never the active one retired.
    const other = await (async () => {
      const bytes = Buffer.from(JSON.stringify({ facts: [], synthetic: "sap28" }), "utf8");
      const staged = await store.stageFactUpload({ ownerId: owner.id, content: bytes, sha256: sha256Of(bytes) });
      if (!staged.ok) throw new Error(staged.refusal);
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("UPDATE studio_jobs SET state = 'running' WHERE id = $1", [staged.jobId]);
        const id = (await c.query(`INSERT INTO studio_fact_versions (sha256, content, byte_length, record_count, tag_counts, uploaded_by)
          SELECT sha256, content, byte_length, 0, '{}', uploaded_by FROM studio_fact_uploads RETURNING id::text AS id`)).rows[0].id as string;
        await c.query("UPDATE studio_fact_checks SET outcome = 'accepted' WHERE id = $1", [staged.checkId]);
        await c.query("DELETE FROM studio_fact_uploads");
        await c.query("UPDATE studio_jobs SET state = 'finished' WHERE id = $1", [staged.jobId]);
        await c.query("COMMIT");
        return id;
      } finally {
        c.release();
      }
    })();
    const auditFrom = (await pool.query("SELECT count(*)::int AS n FROM studio_audit_log")).rows[0].n as number;
    const retireActive = await post(`/facts/versions/${factVersion}/retire`, ownerJar);
    const activeKept = (await counts()).active === factVersion;
    const activate = await post(`/facts/versions/${other}/activate`, ownerJar);
    const retire = await post(`/facts/versions/${factVersion}/retire`, ownerJar);
    const restore = await post(`/facts/versions/${factVersion}/restore`, ownerJar);
    const runnerRetire = await post(`/facts/versions/${factVersion}/retire`, jarA);
    const audited = (await pool.query(
      `SELECT action, actor_user_id::text AS actor, detail FROM studio_audit_log ORDER BY at OFFSET $1`, [auditFrom])).rows
      .filter((r) => r.action === "settings.update" || r.action === "fact_version.status")
      .map((r) => `${r.action}:${r.actor === owner.id ? "owner" : r.actor}:${typeof r.detail.after === "string" ? r.detail.after : ""}`);
    // A direct edit with no actor declared, on the pool the helper used, and one carrying the last editor's id, are refused.
    const noActor = await refusedCode(pool.query("UPDATE studio_settings SET active_fact_version_id = $1", [factVersion]));
    const stale = await refusedCode(pool.query("UPDATE studio_fact_versions SET status = 'retired', status_changed_by = $2 WHERE id = $1",
      [factVersion, owner.id]));
    check("SAP28. over PostgreSQL the owner activates, retires and restores versions through the routes, each one edit "
      + "declaring the owner as its transaction's actor and audited by the schema with that actor (settings.update, "
      + "fact_version.status retired then active); retiring the active version is refused (409, nothing changed) and a "
      + "runner's is refused at the route (403); an edit with no actor, or carrying the last editor's id undeclared, is refused",
      retireActive.status === 409 && activeKept && activate.status === 303 && retire.status === 303 && restore.status === 303
        && runnerRetire.status === 403 && (await counts()).active === other
        && audited.join() === "settings.update:owner:,fact_version.status:owner:retired,fact_version.status:owner:active"
        && noActor === "23514" && stale === "23514",
      `${retireActive.status} ${activate.status} ${retire.status} ${restore.status} ${runnerRetire.status} ${audited.join()} ${noActor} ${stale}`);

    // SAP29: a version's bytes are the owner's alone.
    const asOwner = await get(w.base, `/facts/versions/${factVersion}/file`, ownerJar);
    const asRunner = await get(w.base, `/facts/versions/${factVersion}/file`, jarA);
    const asViewer = await get(w.base, `/facts/versions/${factVersion}/file`, viewerJar);
    const versionsPage = await get(w.base, "/facts", viewerJar);
    check("SAP29. over PostgreSQL the owner downloads a version's exact bytes as an attachment; a runner and a viewer are refused "
      + "(403), and a viewer's versions list shows each version's sha256, uploader and counts with no download link",
      asOwner.status === 200 && asOwner.body === facts.toString("utf8") && asOwner.headers.get("content-disposition")?.startsWith("attachment;") === true
        && asOwner.headers.get("content-security-policy") === "default-src 'none'; sandbox"
        && asRunner.status === 403 && asViewer.status === 403 && versionsPage.status === 200
        && versionsPage.body.includes(factSha.slice(0, 12)) && !versionsPage.body.includes("/file"),
      `${asOwner.status} ${asRunner.status} ${asViewer.status} ${versionsPage.status}`);

    // SAP30: the whole-run bundle re-imports byte for byte.
    const files = syntheticRunArtifacts("");
    for (const [name, text] of Object.entries(files)) {
      const bytes = Buffer.from(text, "utf8");
      await pool.query("INSERT INTO studio_run_artifacts (run_id, name, content, sha256, byte_length) VALUES ($1, $2, $3, $4, $5)",
        [fakeId, name, bytes, sha256Of(bytes), bytes.length]);
    }
    const download = await fetch(`${w.base}/runs/${fakeId}/bundle`, { headers: { cookie: viewerJar.header() } });
    const bundle = Buffer.from(await download.arrayBuffer());
    const reimport = await document("/imports", ownerJar, bundle.toString("utf8"));
    const reimportId = /^\/runs\/([0-9a-f-]{36})$/.exec(reimport.location ?? "")?.[1] ?? "";
    const pair = (await pool.query(
      `SELECT COALESCE(a.name, b.name) AS name, a.content = b.content AS same
         FROM (SELECT name, content FROM studio_run_artifacts WHERE run_id = $1) a
         FULL JOIN (SELECT name, content FROM studio_run_artifacts WHERE run_id = $2) b ON b.name = a.name`, [fakeId, reimportId])).rows;
    const reimported = (await pool.query("SELECT kind, state, runner FROM studio_runs WHERE id = $1", [reimportId])).rows[0];
    check("SAP30. over PostgreSQL a run's whole-run bundle, downloaded by a viewer as an attachment, re-imports BYTE FOR BYTE: the "
      + "import's files are exactly the run's, and the import is queued with its import job (migration 0004's commit check passed)",
      download.status === 200 && download.headers.get("content-type") === "application/json"
        && download.headers.get("content-disposition") === `attachment; filename="run-${fakeId}.json"`
        && reimport.status === 303 && pair.length === Object.keys(files).length && pair.every((r) => r.same === true)
        && reimported?.kind === "imported" && reimported.state === "queued",
      `${download.status} ${reimport.status} ${pair.length} ${JSON.stringify(reimported)}`);

    // SAP31: import refusals over PostgreSQL write nothing.
    const before31 = await counts();
    const folder: Array<[string, Buffer]> = [["run-meta.json", Buffer.from("{\"runner\":\"live\"}")], ["summary.md", Buffer.from("# x\n")]];
    const refusals31 = [
      await document("/imports", ownerJar, bundleText(folder, (e, i) => { if (i === 1) e.sha256 = sha256Of("other"); })),
      await document("/imports", ownerJar, bundleText([...folder, ["notes.txt", Buffer.from("x")]])),
      await document("/imports", ownerJar, JSON.stringify({ schema: RUN_BUNDLE_SCHEMA, files: Array.from({ length: 21 }, () => folder[0]) })),
      await document("/imports", ownerJar, `${bundleText(folder)}${" ".repeat(IMPORT_MAX_DOCUMENT_BYTES)}`),
      await document("/imports", jarA, bundleText(folder)),
    ];
    const after31 = await counts();
    check("SAP31. over PostgreSQL an import with a sha256 mismatch, an unknown name or more than twenty files (400), a document "
      + "over 10 MiB (413) and a runner's import (403) are each refused with nothing written: no run, job or file",
      refusals31.map((r) => r.status).join() === "400,400,400,413,403" && JSON.stringify(before31) === JSON.stringify(after31),
      `${refusals31.map((r) => r.status).join()} ${JSON.stringify(before31)} ${JSON.stringify(after31)}`);

    // SAP32: a fake run is refused as a source by name, with no preflight written.
    const before32 = await counts();
    const fakeSource = await post(`/runs/${fakeId}/price`, ownerJar, [["action", "revise"]]);
    const after32 = await counts();
    check("SAP32. over PostgreSQL a fake run's price request is refused by name (409, fake_source) before anything is written: no "
      + "preflight request, no job",
      fakeSource.status === 409 && fakeSource.body.includes("<code>fake_source</code>") && after32.requests === before32.requests
        && after32.jobs === before32.jobs,
      `${fakeSource.status} ${JSON.stringify(before32)} ${JSON.stringify(after32)}`);

    // SAP33: the purge deletes fact checks older than 30 days, through 0004's rule.
    const checkIds = (await pool.query("SELECT id::text AS id FROM studio_fact_checks ORDER BY created_at")).rows.map((r) => r.id as string);
    const aged = await pool.connect();
    try {
      await aged.query("SET session_replication_role = replica");
      await aged.query("UPDATE studio_fact_checks SET created_at = now() - interval '31 days' WHERE id = $1", [checkIds[0]]);
      await aged.query("SET session_replication_role = origin");
    } finally {
      aged.release();
    }
    const youngRefused = await refusedCode(pool.query("DELETE FROM studio_fact_checks WHERE id = $1", [checkIds.at(-1)]));
    const purged33 = await w.app.purge();
    const left33 = (await pool.query("SELECT id::text AS id FROM studio_fact_checks")).rows.map((r) => r.id as string);
    check("SAP33. over PostgreSQL the web's purge deletes the fact checks older than 30 days — migration 0004's rule, whose "
      + "trigger refuses deleting a younger one — and keeps every younger check",
      purged33.factChecks === 1 && !left33.includes(checkIds[0]!) && left33.length === checkIds.length - 1 && youngRefused === "23514",
      `${JSON.stringify(purged33)} ${left33.length}/${checkIds.length} ${youngRefused}`);

    // SAP34-SAP40 (Content Studio S7.3): users, caps and the audit view over the real schema; the runner's missing cap and
    // the overrun acknowledgement at the confirmation.
    const users73 = async () => JSON.stringify((await pool.query(
      `SELECT (SELECT json_agg(json_build_object('e', email, 'r', role, 's', status, 'c', daily_cap_usd) ORDER BY id) FROM studio_users) AS u,
              (SELECT count(*) FROM studio_sessions WHERE revoked_at IS NULL)::int AS live,
              (SELECT count(*) FROM studio_audit_log)::int AS audit,
              (SELECT daily_cap_usd::text || '/' || monthly_cap_usd::text FROM studio_settings) AS caps`)).rows[0]);
    const auditSince = async (since: string, action?: string) => (await pool.query(
      `SELECT action, actor_user_id::text AS actor, target_id, detail::text AS detail FROM studio_audit_log
        WHERE at >= $1::timestamptz AND ($2::text IS NULL OR action = $2) ORDER BY at, id`, [since, action ?? null])).rows;
    const nowText = async () => String((await pool.query("SELECT now()::text AS t")).rows[0].t);
    const liveSessions = async (id: string) => (await pool.query(
      "SELECT count(*)::int AS n FROM studio_sessions WHERE user_id = $1 AND revoked_at IS NULL", [id])).rows[0].n as number;

    // SAP34: adding a user.
    let since = await nowText();
    const local = `Sap34.Mixed.${randomBytes(3).toString("hex")}`;
    const added = await post("/users", ownerJar, [["email", ` ${local}@GermanCarDepot.COM `], ["role", "runner"], ["cap", "25"]]);
    const addedRow = (await pool.query(
      "SELECT id::text AS id, email, role, daily_cap_usd::text AS cap, created_by::text AS cb, updated_by::text AS ub, google_sub FROM studio_users WHERE email = $1",
      [`${local.toLowerCase()}@${STUDIO_DOMAIN}`])).rows[0];
    const addAudit = await auditSince(since, "user.create");
    const before34 = await users73();
    const duplicate = await post("/users", ownerJar, [["email", addedRow?.email.toUpperCase() ?? "x"], ["role", "viewer"]]);
    const wrongDomain = await post("/users", ownerJar, [["email", `sap34.${randomBytes(2).toString("hex")}@other.test`], ["role", "viewer"]]);
    const viewerAdd = await post("/users", viewerJar, [["email", syntheticEmail("sap34v")], ["role", "owner"]]);
    const direct34 = [
      await refusedCode(store.createUser({ ownerId: owner.id, email: `Upper.${randomBytes(2).toString("hex")}@${STUDIO_DOMAIN}`, role: "viewer", dailyCapMicros: null })),
      await refusedCode(store.createUser({ ownerId: owner.id, email: `x.${randomBytes(2).toString("hex")}@other.test`, role: "viewer", dailyCapMicros: null })),
      await refusedCode(store.createUser({ ownerId: runnerA.id, email: syntheticEmail("sap34r"), role: "owner", dailyCapMicros: null })),
    ];
    const after34 = await users73();
    check("SAP34. over PostgreSQL the owner adds a user through the route: the address stored lower-cased, the role and cap as "
      + "given, created and stamped (updated_by) by the owner, audited by the schema (user.create) with the owner as actor and "
      + "no address; a duplicate in another case is refused (409), another domain (400) and a viewer (403) too, and the schema "
      + "itself refuses an upper-case address, another domain and a runner as creator — each with nothing written",
      added.status === 303 && addedRow?.role === "runner" && addedRow.cap === "25.000000" && addedRow.cb === owner.id && addedRow.ub === owner.id
        && addedRow.google_sub === null && addAudit.length === 1 && addAudit[0].actor === owner.id && !addAudit[0].detail.includes("@")
        && duplicate.status === 409 && duplicate.body.includes("<code>duplicate</code>") && wrongDomain.status === 400
        && viewerAdd.status === 403 && direct34.every((c) => c === "23514") && before34 === after34,
      `${added.status} ${duplicate.status} ${wrongDomain.status} ${viewerAdd.status} ${direct34.join()}`);

    // SAP35: role, cap, disable (the schema revokes the sessions), re-enable, and the explicit revocation.
    const target = await addUser("runner", "s73-target");
    let targetJar = await signedIn(target);
    since = await nowText();
    const roleChange = await post(`/users/${target.id}/role`, ownerJar, [["role", "viewer"]]);
    const capClear = await post(`/users/${target.id}/cap`, ownerJar, [["cap", ""]]);
    const capSet = await post(`/users/${target.id}/cap`, ownerJar, [["cap", "7.25"]]);
    const liveBefore = await liveSessions(target.id);
    const disable = await post(`/users/${target.id}/disable`, ownerJar);
    const signedOutNext = await get(w.base, "/runs", targetJar);
    const liveAfterDisable = await liveSessions(target.id);
    const enable = await post(`/users/${target.id}/enable`, ownerJar);
    targetJar = await signedIn(target);
    const revoke = await post(`/users/${target.id}/revoke-sessions`, ownerJar);
    const afterRevoke = await get(w.base, "/runs", targetJar);
    const row35 = (await pool.query("SELECT role, status, daily_cap_usd::text AS cap, updated_by::text AS ub FROM studio_users WHERE id = $1",
      [target.id])).rows[0];
    const audit35 = await auditSince(since);
    const edits35 = audit35.filter((r) => r.action === "user.update" || r.action === "user.sessions_revoked");
    check("SAP35. over PostgreSQL the role, the cap (cleared, then set), disable, re-enable and an explicit revocation each go "
      + "through ONE owner edit with its declared actor: the schema audits each user.update with the owner as actor and no "
      + "address or name; disabling revokes every session in the same transaction (the next request is 401); the revocation "
      + "ends the re-signed-in session too and is audited with its count",
      [roleChange, capClear, capSet, disable, enable, revoke].every((r) => r.status === 303) && liveBefore === 1 && liveAfterDisable === 0
        && signedOutNext.status === 401 && afterRevoke.status === 401 && row35.role === "viewer" && row35.status === "active"
        && row35.cap === "7.250000" && row35.ub === owner.id
        && edits35.map((r) => r.action).join() === "user.update,user.update,user.update,user.update,user.update,user.sessions_revoked"
        && edits35.every((r) => r.actor === owner.id && r.target_id === target.id && !r.detail.includes("@") && !r.detail.includes("Synthetic"))
        && edits35.at(-1)?.detail === "{\"sessions\": 1}",
      `${[roleChange, capClear, capSet, disable, enable, revoke].map((r) => r.status).join()} ${liveBefore}/${liveAfterDisable} `
        + `${signedOutNext.status} ${afterRevoke.status} ${JSON.stringify(row35)} ${edits35.map((r) => `${r.action}:${r.detail}`).join(" | ")}`);

    // Caps wide enough that only the rules under test refuse a confirmation below (the day's spend has grown by now).
    await asActor(pool, owner.id, "UPDATE studio_settings SET daily_cap_usd = 99999, monthly_cap_usd = 999999, updated_by = $1", [owner.id]);

    // SAP36: D — a runner with no daily cap cannot confirm; the owner's own NULL cap is still no per-user cap.
    await post(`/users/${runnerB.id}/cap`, ownerJar, [["cap", ""]]);
    await beat();
    const quoteB = await answer(await ask(jarB));
    const tally36 = await tally();
    const refusedB = await post(`/quotes/${quoteB}/confirm`, jarB);
    const tally36b = await tally();
    const ownerQuote = await answer(await ask(ownerJar));
    const ownerCap = (await pool.query("SELECT daily_cap_usd FROM studio_users WHERE id = $1", [owner.id])).rows[0].daily_cap_usd;
    const ownerConfirmed = await store.confirmQuote({ quoteId: ownerQuote, userId: owner.id, ceilings: WIDE });
    check("SAP36. over PostgreSQL a runner whose daily_cap_usd is NULL is refused at the confirmation (409, cap_missing) with "
      + "nothing written — no run, job, ledger entry or consumed quote — while the owner, whose own cap is NULL too, confirms",
      refusedB.status === 409 && refusedB.body.includes("<code>cap_missing</code>") && JSON.stringify(tally36) === JSON.stringify(tally36b)
        && ownerCap === null && ownerConfirmed.ok,
      `${refusedB.status} ${JSON.stringify(tally36)} ${JSON.stringify(tally36b)} ${JSON.stringify(ownerConfirmed)}`);

    // SAP37: E — an acknowledgement survives its owner's later demotion.
    const owner2 = await addUser("owner", "s73-owner2");
    const owner2Jar = await signedIn(owner2);
    const overrunRun37 = ownerConfirmed.ok ? ownerConfirmed.runId : "";
    await pool.query("INSERT INTO studio_spend_ledger (entry, run_id, amount_usd) VALUES ('overrun', $1, 0.25)", [overrunRun37]);
    await beat();
    const lockedA = await store.confirmQuote({ quoteId: await answer(await ask(jarA)), userId: runnerA.id, ceilings: WIDE });
    const runnerDirectAck = await store.acknowledgeOverrun({ runId: overrunRun37, ownerId: runnerA.id });
    const ack37 = await post(`/spend/overruns/${overrunRun37}/acknowledge`, owner2Jar);
    const demote37 = await post(`/users/${owner2.id}/role`, ownerJar, [["role", "runner"]]);
    await beat();
    const afterDemotion = await store.confirmQuote({ quoteId: await answer(await ask(jarA)), userId: runnerA.id, ceilings: WIDE });
    const panel37 = await get(w.base, "/spend", ownerJar);
    const unacknowledged = (await pool.query(UNACKNOWLEDGED_OVERRUNS_SQL)).rows[0].n;
    const second37 = afterDemotion.ok ? afterDemotion.runId : "";
    await pool.query("INSERT INTO studio_spend_ledger (entry, run_id, amount_usd) VALUES ('overrun', $1, 0.25)", [second37]);
    const lockedAgain = await store.confirmQuote({ quoteId: await answer(await ask(jarA)), userId: runnerA.id, ceilings: WIDE });
    check("SAP37. over PostgreSQL an overrun acknowledged by an owner who is later demoted stays acknowledged: confirmations stay "
      + "unlocked (the worker's query counts none) and the spend panel shows it acknowledged; a runner's acknowledgement written "
      + "through the store is refused; and a new unacknowledged overrun still locks every confirmation",
      !lockedA.ok && lockedA.refusal === "confirmations_locked" && runnerDirectAck === false && ack37.status === 303
        && demote37.status === 303 && afterDemotion.ok && unacknowledged === 0
        && panel37.body.includes(`<code>${overrunRun37}</code></a>`) && !lockedAgain.ok && lockedAgain.refusal === "confirmations_locked",
      `${JSON.stringify(lockedA)} ${runnerDirectAck} ${ack37.status} ${demote37.status} ${JSON.stringify(afterDemotion)} ${unacknowledged} ${JSON.stringify(lockedAgain)}`);
    await post(`/spend/overruns/${second37}/acknowledge`, ownerJar);

    // SAP38: the owner's caps.
    since = await nowText();
    const caps38 = await post("/settings/caps", ownerJar, [["daily", "90"], ["monthly", "250.50"]]);
    const settings38 = (await pool.query("SELECT daily_cap_usd::text AS d, monthly_cap_usd::text AS m, updated_by::text AS ub FROM studio_settings")).rows[0];
    const audit38 = await auditSince(since, "settings.update");
    const page38 = await get(w.base, "/settings", ownerJar);
    const before38 = await users73();
    const bad38 = await Promise.all([[["daily", "100"], ["monthly", "10"]], [["daily", "-1"], ["monthly", "10"]], [["daily", "1.234"], ["monthly", "10"]]]
      .map((fields) => post("/settings/caps", ownerJar, fields as Array<[string, string]>)));
    const runnerCaps = await post("/settings/caps", jarA, [["daily", "1"], ["monthly", "1"]]);
    const direct38 = await refusedCode(store.setCaps({ ownerId: runnerA.id, dailyCapMicros: 1, monthlyCapMicros: 1 }));
    check("SAP38. over PostgreSQL the owner's caps are written in ONE owner edit, audited by the schema (settings.update) with the "
      + "owner as actor; the page shows the effective cap, the lower of each cap and its ceiling ($75.00 for a $90 daily cap); "
      + "invalid amounts (400), a runner (403) and a runner's edit straight through the store (the schema) change nothing",
      caps38.status === 303 && settings38.d === "90.000000" && settings38.m === "250.500000" && settings38.ub === owner.id
        && audit38.length === 1 && audit38[0].actor === owner.id
        && page38.body.includes("<tr><td>Daily</td><td>$90.00</td><td>$75.00</td><td><strong>$75.00</strong></td></tr>")
        && bad38.every((r) => r.status === 400) && runnerCaps.status === 403 && direct38 === "23514" && before38 === await users73(),
      `${caps38.status} ${JSON.stringify(settings38)} ${audit38.length} ${bad38.map((r) => r.status).join()} ${runnerCaps.status} ${direct38}`);

    // SAP39: the audit view over the real log, and hostile text in it.
    const hostile = "<script>alert(1)</script>\"'&";
    await asActor(pool, owner.id, "UPDATE studio_users SET display_name = $2, updated_by = $3 WHERE id = $1", [runnerA.id, `${hostile}[name]`, owner.id]);
    await pool.query(`INSERT INTO studio_audit_log (actor_user_id, action, target_type, target_id, detail)
      VALUES ($1, 'test.hostile', 'studio_runs', $2, $3::jsonb)`, [runnerA.id, `${hostile}[t]`, JSON.stringify({ note: `${hostile}[detail]` })]);
    const auditPage = await get(w.base, "/audit", ownerJar);
    const filtered = await get(w.base, "/audit?action=user.update", ownerJar);
    const viewerAudit = await get(w.base, "/audit", viewerJar);
    const usersPage = await get(w.base, "/users", ownerJar);
    const auditList = auditPage.body.slice(auditPage.body.indexOf("<ol class=\"audit-log\">"));
    const actionsShown = [...filtered.body.matchAll(/<li class="audit"><p><code>([^<]+)<\/code>/g)].map((m) => m[1]);
    check("SAP39. over PostgreSQL the audit view is the owner's alone (a viewer 403), newest first, filtered by action, and "
      + "inert: a hostile display name, target and detail are shown escaped (the detail as the stored JSON's text), never as "
      + "markup, on the audit view and the users screen",
      auditPage.status === 200 && auditList.indexOf("test.hostile") >= 0 && auditList.indexOf("test.hostile") < auditList.indexOf("settings.update")
        && !auditPage.body.includes("<script>alert") && auditPage.body.includes(escapeText(`${hostile}[t]`))
        && auditPage.body.includes(escapeText(`${hostile}[name]`)) && auditPage.body.includes(escapeText("[detail]"))
        && actionsShown.length > 3 && actionsShown.every((a) => a === "user.update") && viewerAudit.status === 403
        && usersPage.status === 200 && !usersPage.body.includes("<script>alert") && usersPage.body.includes(escapeText(`${hostile}[name]`)),
      `${auditPage.status} ${actionsShown.length} ${viewerAudit.status} ${usersPage.status}`);

    // SAP40: the last owner, and the acting owner stepping down (last, as it signs the owner out).
    const otherOwners = (await pool.query(
      "SELECT id::text AS id FROM studio_users WHERE role = 'owner' AND status = 'active' AND id <> $1", [owner.id])).rows.map((r) => r.id as string);
    for (const id of otherOwners) await store.changeUser({ ownerId: owner.id, userId: id, change: { kind: "role", role: "viewer" } });
    const before40 = await users73();
    const lastRole = await post(`/users/${owner.id}/role`, ownerJar, [["role", "viewer"], ["confirm", "yes"]]);
    const lastDisable = await post(`/users/${owner.id}/disable`, ownerJar, [["confirm", "yes"]]);
    const bySchema = await refusedCode(asActor(pool, owner.id, "UPDATE studio_users SET role = 'viewer', updated_by = $1 WHERE id = $1", [owner.id]));
    const unchanged40 = before40 === await users73();
    const successor = await addUser("owner", "s73-successor");
    const successorJar = await signedIn(successor);
    const before40b = await users73();
    const asked = await post(`/users/${owner.id}/role`, ownerJar, [["role", "runner"]]);
    const notYet = before40b === await users73();
    const stepped = await post(`/users/${owner.id}/role`, ownerJar, [["role", "runner"], ["confirm", "yes"]]);
    const stillSignedIn = await get(w.base, "/runs", ownerJar);
    const staleCookie = (await pool.query("SELECT count(*)::int AS n FROM studio_sessions WHERE user_id = $1 AND revoked_at IS NULL", [owner.id])).rows[0].n;
    const roleNow = (await pool.query("SELECT role FROM studio_users WHERE id = $1", [owner.id])).rows[0].role;
    const successorUsers = await get(w.base, "/users", successorJar);
    check("SAP40. over PostgreSQL the last active owner can never be demoted or disabled — refused by the store's decision (409, "
      + "last_owner) even when confirmed, and by the schema's trigger written directly — with nothing written; with a second "
      + "owner, stepping down first asks for confirmation (nothing written), then demotes, revokes every session of the acting "
      + "owner and signs them out, and the other owner carries on",
      lastRole.status === 409 && lastRole.body.includes("<code>last_owner</code>") && lastDisable.status === 409
        && lastDisable.body.includes("<code>last_owner</code>") && bySchema === "23514" && unchanged40
        && asked.status === 200 && asked.body.includes("name=\"confirm\" value=\"yes\"") && notYet
        && stepped.status === 303 && stepped.location === "/" && staleCookie === 0 && roleNow === "runner" && stillSignedIn.status === 401
        && successorUsers.status === 200,
      `${lastRole.status} ${lastDisable.status} ${bySchema} ${unchanged40} ${asked.status} ${notYet} ${stepped.status} ${staleCookie} ${roleNow}`);
    await w.close();
  }

  void STUDIO_DOMAIN;
}

main().catch((error: unknown) => {
  console.error(`[studio-web-postgres] fatal: ${(error as Error)?.stack ?? String(error)}`);
  process.exit(1);
});
