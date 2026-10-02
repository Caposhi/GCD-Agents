/**
 * Offline suite for the Content Studio web service (docs/CONTENT_STUDIO_DESIGN.md
 * §3.2, §3.3, §7, §9.2): `npm run test:studio-web`, the twelfth `test:offline`
 * suite. No database and no network beyond loopback: a fake OpenID issuer
 * (`testSupport.ts`) on 127.0.0.1:0 with keys generated when it starts, the app
 * on 127.0.0.1:0, and a listener that must receive no connection. No test ever
 * contacts Google.
 *
 * Every check is `SA…`, each case its own check. The store is `MemoryWebStore`,
 * which keeps the S2 schema's own rules; the disposable PostgreSQL suite
 * (`web.postgres.selftest.ts`) proves the real schema end to end. Across the
 * whole suite, every line the app logs and every byte this process or the
 * entry point prints is captured, and `SA64` requires that none of it holds a
 * secret, code, state, nonce, verifier, cookie, token, email or the client secret.
 */

import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FORBIDDEN_PREFIXES, FORBIDDEN_VARIABLES } from "../db/runner.js";
import {
  CONTENT_SECURITY_POLICY, createStudioWebApp, SECURITY_HEADERS, STUDIO_ROUTE_TABLE, type Route, type StudioWebApp, type WebLog,
} from "./app.js";
import {
  CLOCK_SKEW_SECONDS, GOOGLE_OIDC, ID_TOKEN_ALGORITHMS, JWKS_TIMEOUT_MS, OIDC_SCOPE, pkceChallenge, TOKEN_EXCHANGE_TIMEOUT_MS,
} from "./oidc.js";
import { CALLBACK_LIMIT, FAILED_SIGN_IN_LIMIT, LOGIN_LIMIT, WindowLimiter } from "./rateLimit.js";
import {
  csrfTokenFor, decideSession, LOGIN_COOKIE, planSignIn, roleAllows, SESSION_ABSOLUTE_MS, SESSION_COOKIE, SESSION_IDLE_MS,
  sessionIdHash, type SessionRow, type StudioUserRow,
} from "./sessions.js";
import {
  decideWebIdentity, decideWebSchemaVersion, decideWebStartup, exactHttpsOrigin, STUDIO_ALLOWED_HD, WEB_FORBIDDEN_VARIABLES,
  webForbiddenVariablesPresent, type WebConfig, type WebEnvironment,
} from "./startup.js";
import { PgWebStore } from "./store.js";
import { FakeIssuer, MemoryWebStore, STUDIO_DOMAIN, syntheticEmail, type TokenPlan } from "./testSupport.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ORIGIN = "https://studio.test";
const COMMIT = createHash("sha256").update("studio-web-offline-suite").digest("hex").slice(0, 40);
const CLIENT_ID = `client-${randomBytes(4).toString("hex")}.apps.test`;
const CLIENT_SECRET = `secret-${randomBytes(18).toString("base64url")}`;

// --- Capture: every log line and every printed byte ----------------------------------------------

const captured: string[] = [];
/** Every value the suite must never see in captured output. */
const secrets = new Set<string>([CLIENT_SECRET]);
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean;
  (stream as unknown as { write: typeof write }).write = (chunk: unknown, ...rest: unknown[]) => {
    captured.push(String(chunk));
    return write(chunk, ...rest);
  };
}
const log: WebLog = (event, fields = {}) => { captured.push(`[studio-web] ${event} ${JSON.stringify(fields)}`); };

let failures = 0;
let total = 0;
function check(name: string, cond: boolean, detail = ""): void {
  total += 1;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : ` — ${detail}`}`);
  if (!cond) failures += 1;
}
const refusalOf = (fn: () => unknown): string => {
  try { fn(); return "accepted"; } catch (error) { return String((error as { reason?: unknown }).reason ?? (error as Error).name); }
};

/** Module specifiers of one file (no TypeScript compiler: no Studio module may load a dev dependency). */
function moduleReferences(text: string): Array<{ kind: "static" | "dynamic"; specifier: string }> {
  const refs: Array<{ kind: "static" | "dynamic"; specifier: string }> = [];
  for (const m of text.matchAll(/^\s*(import|export)\s+(type\s+)?(?:[^;'"]*?\sfrom\s+)?["']([^"']+)["']/gm)) {
    if (!m[2]) refs.push({ kind: "static", specifier: m[3]! });
  }
  for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) refs.push({ kind: "dynamic", specifier: m[1]! });
  return refs;
}

// --- The world: a fake issuer, a store, the app on loopback, a clock, a cookie jar -------------------

const issuer = await new FakeIssuer(CLIENT_ID, CLIENT_SECRET).start();

interface World {
  store: MemoryWebStore;
  app: StudioWebApp;
  base: string;
  clock: { now: number };
  owner: StudioUserRow;
  close(): Promise<void>;
}

const CONFIG = (bootstrapOwnerEmail: string | null = null): WebConfig => ({
  publicOrigin: ORIGIN, allowedHd: STUDIO_ALLOWED_HD, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, bootstrapOwnerEmail,
});

async function world(options: {
  bootstrap?: string | null; withOwner?: boolean; extraRoutes?: Route[]; tokenTimeoutMs?: number; google?: boolean;
} = {}): Promise<World> {
  const clock = { now: Date.now() };
  const store = new MemoryWebStore(() => clock.now);
  const owner = options.withOwner === false ? (null as unknown as StudioUserRow)
    : store.insertUser({ email: syntheticEmail("owner"), role: "owner", google_sub: `sub-owner-${randomBytes(4).toString("hex")}`,
      display_name: "Synthetic Owner" });
  // The bootstrap variable goes through the entry point's own decision, as in service.
  const bootstrap = decideWebStartup(env({ bootstrapOwnerEmail: options.bootstrap ?? undefined })).config.bootstrapOwnerEmail;
  const app = createStudioWebApp({
    store, config: CONFIG(bootstrap), commit: COMMIT, log, now: () => clock.now,
    ...(options.google ? {} : { oidc: issuer.provider }), extraRoutes: options.extraRoutes, tokenTimeoutMs: options.tokenTimeoutMs,
  });
  const server: Server = createHttpServer((req, res) => { void app.handle(req, res); });
  await new Promise<void>((settle) => server.listen(0, "127.0.0.1", settle));
  issuer.clock = () => clock.now;
  issuer.plan = {};
  issuer.tokenMode = "ok";
  return {
    store, app, clock, owner, base: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
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
      const name = pair!.slice(0, at);
      const value = pair!.slice(at + 1);
      if (value === "") this.values.delete(name);
      else { this.values.set(name, value); secrets.add(value); }
    }
  }
}

interface Reply { status: number; headers: Headers; body: string; setCookies: string[]; location: string | null }

async function request(w: World, path: string, init: { method?: string; jar?: Jar; headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.jar && init.jar.values.size) headers.cookie = init.jar.header();
  const response = await fetch(`${w.base}${path}`, { method: init.method ?? "GET", headers, body: init.body, redirect: "manual" });
  const setCookies = response.headers.getSetCookie();
  init.jar?.take(setCookies);
  return { status: response.status, headers: response.headers, body: await response.text(), setCookies, location: response.headers.get("location") };
}

/** The browser's round trip: login, the issuer's redirect, then the callback (optionally edited). */
async function signIn(w: World, jar: Jar, options: {
  identity?: { email: string; sub: string; name?: string }; plan?: TokenPlan; edit?: (callback: URL) => void; jarAtCallback?: Jar;
} = {}): Promise<Reply & { callbackPath: string }> {
  if (options.identity) issuer.identity = options.identity;
  issuer.plan = options.plan ?? {};
  const login = await request(w, "/auth/login", { jar });
  const authorize = await fetch(login.location!, { redirect: "manual" });
  const back = new URL(authorize.headers.get("location")!);
  options.edit?.(back);
  const callbackPath = `${back.pathname}${back.search}`;
  const reply = await request(w, callbackPath, { jar: options.jarAtCallback ?? jar });
  return { ...reply, callbackPath };
}

const listed = (w: World, role: StudioUserRow["role"], extra: Partial<StudioUserRow> = {}) => {
  const user = w.store.insertUser({ email: syntheticEmail(role), role, created_by: w.owner.id, google_sub: extra.google_sub ?? null,
    display_name: extra.display_name ?? `Synthetic ${role}` });
  if (extra.status === "disabled") w.store.setStatus(user.id, "disabled");
  return user;
};
const identityOf = (user: StudioUserRow, sub = user.google_sub ?? `sub-${randomBytes(6).toString("hex")}`) =>
  ({ email: user.email, sub, name: user.display_name ?? undefined });

let notAuthorizedBody: string | null = null;
/** One generic page, one audit row naming only the reason class, no session. */
function refusedAs(w: World, reply: Reply, reason: string, auditBefore: number, sessionsBefore: number): boolean {
  notAuthorizedBody ??= reply.status === 403 ? reply.body : null;
  const last = w.store.auditLog.at(-1);
  return reply.status === 403 && reply.body === notAuthorizedBody && reply.body.includes("Not authorized")
    && w.store.auditLog.length === auditBefore + 1 && last?.action === "auth.sign_in_refused" && last.actorUserId === null
    && last.targetType === null && last.targetId === null && JSON.stringify(last.detail) === JSON.stringify({ reason })
    && w.store.sessions.size === sessionsBefore && !reply.setCookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`))
    && reply.location === null;
}

/** A refusal scenario in a fresh world; `expect` is the audit row's reason class. */
async function refusal(name: string, reason: string, setup: (w: World) => Promise<Parameters<typeof signIn>[2]> | Parameters<typeof signIn>[2],
  options: Parameters<typeof world>[0] = {}, extra: (w: World, reply: Reply) => boolean = () => true): Promise<void> {
  const w = await world(options);
  try {
    const scenario = await setup(w);
    const auditBefore = w.store.auditLog.length;
    const sessionsBefore = w.store.sessions.size;
    const reply = await signIn(w, new Jar(), scenario);
    const lastReason = String(w.store.auditLog.at(-1)?.detail.reason ?? "(none)");
    check(name, refusedAs(w, reply, reason, auditBefore, sessionsBefore) && extra(w, reply), `status ${reply.status}, reason ${lastReason}`);
  } finally {
    await w.close();
  }
}

const SESSION_SET_COOKIE = new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=604800$`);
const LOGIN_SET_COOKIE = new RegExp(`^${LOGIN_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600$`);
const cookieNamesExact = (SESSION_COOKIE as string) === "__Host-gcd_studio_session" && (LOGIN_COOKIE as string) === "__Host-gcd_studio_login";

// =====================================================================================================
// B. Startup refusals, before any connection
// =====================================================================================================

const URL_OK = "postgresql://web:placeholder@127.0.0.1:5432/gcd_studio";
const env = (extra: Partial<WebEnvironment> = {}): WebEnvironment => ({
  names: ["PATH", "NODE_ENV", "STUDIO_DATABASE_URL", "STUDIO_PUBLIC_ORIGIN"], studioDatabaseUrl: URL_OK, publicOrigin: ORIGIN,
  allowedHd: STUDIO_ALLOWED_HD, googleClientId: CLIENT_ID, googleClientSecret: CLIENT_SECRET, bootstrapOwnerEmail: undefined,
  port: "10000", commit: COMMIT, ...extra,
});

{
  const ok = decideWebStartup(env({ bootstrapOwnerEmail: ` ${"Boot.Owner"}${"@"}GermanCarDepot.COM ` }));
  const forbidden = [...FORBIDDEN_VARIABLES, ...WEB_FORBIDDEN_VARIABLES, "IG_ACCESS_TOKEN", "FB_PAGE_ACCESS_TOKEN", "GBP_LOCATION_ID"];
  const refusals = forbidden.map((name) => refusalOf(() => decideWebStartup(env({ names: [...env().names, name] }))));
  check("SA1. (a) the web refuses to start beside any forbidden variable, whatever its value — DATABASE_URL, every live "
    + "credential, AUTONOMY_PHASE, PUBLIC_BASE_URL, ACTIVE_PLATFORMS, any IG_/FB_/GBP_ name, and ANTHROPIC_API_KEY, which "
    + "is always forbidden on the web; with none it starts with its exact configuration",
    refusals.length === 15 && refusals.every((r) => r === "forbidden-variable")
      && JSON.stringify(WEB_FORBIDDEN_VARIABLES) === JSON.stringify(["ANTHROPIC_API_KEY"])
      && JSON.stringify(FORBIDDEN_PREFIXES) === JSON.stringify(["IG_", "FB_", "GBP_"])
      && webForbiddenVariablesPresent(["ANTHROPIC_API_KEY", "PATH", "IG_X", "IGNORE"]).join() === "ANTHROPIC_API_KEY,IG_X"
      && ok.connectionString === URL_OK && ok.port === 10_000 && ok.commit === COMMIT && ok.config.publicOrigin === ORIGIN
      && ok.config.allowedHd === STUDIO_ALLOWED_HD && ok.config.clientId === CLIENT_ID
      && ok.config.bootstrapOwnerEmail === `${"boot.owner"}${"@"}${STUDIO_DOMAIN}`
      && decideWebStartup(env()).config.bootstrapOwnerEmail === null,
    refusals.join());

  const origins: Array<[string | undefined, boolean]> = [
    [ORIGIN, true], ["https://studio.test:8443", true], [`${ORIGIN}/`, false], [`${ORIGIN}/app`, false], [`${ORIGIN}?x=1`, false],
    [`${ORIGIN}#f`, false], ["http://studio.test", false], ["https://user:pw@studio.test", false], ["https://Studio.test", false],
    ["https://studio.test:443", false], [` ${ORIGIN}`, false], ["", false], [undefined, false], ["studio.test", false],
  ];
  check("SA2. (b) STUDIO_PUBLIC_ORIGIN must be an exact https origin: no path, trailing slash, query, fragment, "
    + "credentials, upper case, default port or space — each refused before any connection",
    origins.every(([raw, accepted]) => (exactHttpsOrigin(raw) !== null) === accepted
      && refusalOf(() => decideWebStartup(env({ publicOrigin: raw }))) === (accepted ? "accepted" : "public-origin")));

  check("SA3. (c) STUDIO_ALLOWED_HD must equal germancardepot.com exactly: another domain, upper case, a subdomain, an "
    + "empty value or none is refused",
    STUDIO_ALLOWED_HD === STUDIO_DOMAIN
      && ["other.test", "GERMANCARDEPOT.COM", `x.${STUDIO_DOMAIN}`, "", undefined, ` ${STUDIO_DOMAIN}`]
        .every((hd) => refusalOf(() => decideWebStartup(env({ allowedHd: hd }))) === "allowed-hd"));

  check("SA4. (d) the client id and the client secret must both be present and non-empty: missing, empty or blank either "
    + "one is refused, and no refusal message echoes the secret",
    [{ googleClientId: undefined }, { googleClientId: "" }, { googleClientId: "  " }, { googleClientSecret: undefined },
      { googleClientSecret: "" }, { googleClientSecret: " \t" }]
      .every((e) => refusalOf(() => decideWebStartup(env(e))) === "google-client")
      && (() => { try { decideWebStartup(env({ googleClientId: "" })); return false; } catch (e) { return !(e as Error).message.includes(CLIENT_SECRET); } })());

  check("SA5. it also refuses a missing or non-PostgreSQL STUDIO_DATABASE_URL, a PORT that is not a port, and a commit "
    + "that is not a full SHA; an unset PORT is the default",
    [refusalOf(() => decideWebStartup(env({ studioDatabaseUrl: undefined }))),
      refusalOf(() => decideWebStartup(env({ studioDatabaseUrl: "mysql://x/y" }))),
      refusalOf(() => decideWebStartup(env({ port: "0" }))), refusalOf(() => decideWebStartup(env({ port: "65536" }))),
      refusalOf(() => decideWebStartup(env({ port: "80a" }))), refusalOf(() => decideWebStartup(env({ commit: undefined }))),
      refusalOf(() => decideWebStartup(env({ commit: "abc" })))].join()
      === "studio-database-url-missing,studio-database-url-invalid,port,port,port,commit-missing,commit-missing"
      && decideWebStartup(env({ port: undefined })).port === 3000);

  // (a)-(d), executed: the entry point refuses with no connection to the listening database port.
  let connections = 0;
  const listener = createNetServer((socket) => { connections += 1; socket.destroy(); });
  await new Promise<void>((settle) => listener.listen(0, "127.0.0.1", settle));
  const port = (listener.address() as { port: number }).port;
  const base = {
    PATH: process.env.PATH ?? "", STUDIO_DATABASE_URL: `postgresql://u:placeholder@127.0.0.1:${port}/gcd_studio`,
    STUDIO_PUBLIC_ORIGIN: ORIGIN, STUDIO_ALLOWED_HD: STUDIO_ALLOWED_HD, STUDIO_GOOGLE_CLIENT_ID: CLIENT_ID,
    STUDIO_GOOGLE_CLIENT_SECRET: CLIENT_SECRET, RENDER_GIT_COMMIT: COMMIT, PORT: "18080",
  };
  const runMain = (extra: Record<string, string>, drop: string[] = []) => new Promise<{ code: number; stderr: string }>((settle) => {
    const childEnv: Record<string, string> = { ...base, ...extra };
    for (const name of drop) delete childEnv[name];
    execFile(process.execPath, [resolve(REPO_ROOT, "dist/studio/web/main.js")], { env: childEnv, timeout: 30_000 },
      (error, stdout, stderr) => {
        captured.push(String(stdout), String(stderr));
        settle({ code: error ? (typeof error.code === "number" ? error.code : -1) : 0, stderr: String(stderr) });
      });
  });
  const runs = [
    await runMain({ ANTHROPIC_API_KEY: "" }),
    await runMain({ DATABASE_URL: "postgresql://live:placeholder-value@127.0.0.1/live" }),
    await runMain({ GBP_LOCATION_ID: "" }),
    await runMain({ STUDIO_PUBLIC_ORIGIN: `${ORIGIN}/` }),
    await runMain({ STUDIO_ALLOWED_HD: "other.test" }),
    await runMain({ STUDIO_GOOGLE_CLIENT_SECRET: "" }),
    await runMain({}, ["STUDIO_GOOGLE_CLIENT_ID"]),
  ];
  const refusedConnections = connections;
  const valid = await runMain({});
  listener.close();
  check("SA6. `npm run start:studio-web` (dist/studio/web/main.js), executed: ANTHROPIC_API_KEY set to an EMPTY value, "
    + "DATABASE_URL, an empty GBP_ variable, an origin with a trailing slash, another hd, an empty client secret and a "
    + "missing client id each exit 1 with the refusal named, no value echoed and no connection made to the listening "
    + "database port; the same environment without them does connect",
    runs.map((r) => `${r.code}:${/refused \(([a-z-]+)\)/.exec(r.stderr)?.[1]}`).join()
      === "1:forbidden-variable,1:forbidden-variable,1:forbidden-variable,1:public-origin,1:allowed-hd,1:google-client,1:google-client"
      && runs.every((r) => !r.stderr.includes("placeholder-value") && !r.stderr.includes(CLIENT_SECRET))
      && refusedConnections === 0 && valid.code === 1 && connections > 0 && /\[studio-web\] fatal/.test(valid.stderr),
    runs.map((r) => r.stderr.trim()).join(" | "));

  // (e) the database identity and the schema version: the worker's check.
  const files = ["0001_studio_identity_and_tripwire.sql", "0002_studio_schema.sql"]
    .map((name) => ({ name, sha256: createHash("sha256").update(name).digest("hex") }));
  const ledger = files.map(({ name, sha256 }) => ({ name, sha256 }));
  const probe = (extra: Record<string, unknown> = {}) => ({
    currentDatabase: "gcd_studio", liveTables: [], migrationsTable: "tripwire" as const, studioTables: ["studio_database_identity"],
    identityRows: [{ database_name: "gcd_studio", marker: "gcd-studio:database-identity:v1" }], ledger, ...extra,
  });
  check("SA7. (e) the web makes the worker's database check: it refuses another database name, a live table, a live "
    + "ledger, a missing identity row or nothing migrated, and any schema version but 0002_studio_schema.sql",
    refusalOf(() => decideWebIdentity(probe() as never)) === "accepted"
      && refusalOf(() => decideWebIdentity(probe({ currentDatabase: "gcd_social" }) as never)) === "wrong-database"
      && refusalOf(() => decideWebIdentity(probe({ liveTables: ["public.approval_queue"] }) as never)) === "live-schema"
      && refusalOf(() => decideWebIdentity(probe({ migrationsTable: "live" }) as never)) === "live-ledger"
      && refusalOf(() => decideWebIdentity(probe({ identityRows: [] }) as never)) === "identity-mismatch"
      && refusalOf(() => decideWebIdentity(probe({ ledger: null, identityRows: null, studioTables: [], migrationsTable: "absent" }) as never))
        === "not-migrated"
      && decideWebSchemaVersion(ledger, files) === "0002_studio_schema.sql"
      && refusalOf(() => decideWebSchemaVersion(ledger.slice(0, 1), files)) === "schema-version"
      && refusalOf(() => decideWebSchemaVersion(null, files)) === "schema-version"
      && refusalOf(() => decideWebSchemaVersion([ledger[0]!, { ...ledger[1]!, sha256: "0".repeat(64) }], files)) === "migration-changed");

  // The entry point, read: it reads only its variables, decides first, and passes no provider.
  const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const mainSource = strip(readFileSync(resolve(REPO_ROOT, "src/studio/web/main.ts"), "utf8"));
  const serverSource = strip(readFileSync(resolve(REPO_ROOT, "src/studio/web/server.ts"), "utf8"));
  const staticGraph = (entry: string): string[] => {
    const seen = new Set<string>([entry]);
    const queue = [entry];
    while (queue.length) {
      const file = queue.shift()!;
      for (const ref of moduleReferences(readFileSync(resolve(REPO_ROOT, file), "utf8"))) {
        if (ref.kind !== "static" || !ref.specifier.startsWith(".")) continue;
        const target = join(dirname(file), ref.specifier).split("\\").join("/");
        if (!seen.has(target)) { seen.add(target); queue.push(target); }
      }
    }
    return [...seen].sort();
  };
  const mainStatic = staticGraph("dist/studio/web/main.js");
  const mainRefs = moduleReferences(readFileSync(resolve(REPO_ROOT, "dist/studio/web/main.js"), "utf8"));
  const appCall = /createStudioWebApp\(\{([^}]*)\}\)/.exec(serverSource)?.[1] ?? "";
  check("SA8. the entry point reads only STUDIO_DATABASE_URL, STUDIO_PUBLIC_ORIGIN, STUDIO_ALLOWED_HD, the client id and "
    + "secret, STUDIO_BOOTSTRAP_OWNER_EMAIL, PORT and RENDER_GIT_COMMIT, in the dot form, plus the names for the scan; it "
    + "decides before the server module loads (its static imports reach only startup.js and the S2 runner); and the "
    + "only app it builds is given store, config, commit and log — never an issuer, routes or a clock",
    [...mainSource.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]).sort().join() === ["PORT", "RENDER_GIT_COMMIT",
      "STUDIO_ALLOWED_HD", "STUDIO_BOOTSTRAP_OWNER_EMAIL", "STUDIO_DATABASE_URL", "STUDIO_GOOGLE_CLIENT_ID",
      "STUDIO_GOOGLE_CLIENT_SECRET", "STUDIO_PUBLIC_ORIGIN"].join()
      && (mainSource.match(/process\.env\b(?!\.)/g) ?? []).length === 1 && mainSource.includes("names: Object.keys(process.env),")
      && !/process\.env\[|STUDIO_MAX_|ANTHROPIC/.test(mainSource)
      && mainStatic.join() === ["dist/studio/db/runner.js", "dist/studio/web/main.js", "dist/studio/web/startup.js"].join()
      && mainRefs.some((r) => r.kind === "dynamic" && r.specifier === "./server.js")
      && mainSource.indexOf("decideWebStartup(") < mainSource.indexOf('await import("./server.js")')
      && !/oidc|extraRoutes|testSupport|now:/.test(mainSource) && !/oidc|extraRoutes|testSupport|now:/.test(serverSource)
      && [...appCall.matchAll(/(\w+)\s*:/g)].map((m) => m[1]).sort().join() === "commit,config,log,store",
    `${mainStatic.join()} | ${appCall}`);

  const webSources = ["app.ts", "oidc.ts", "rateLimit.ts", "server.ts", "sessions.ts", "startup.ts", "store.ts", "testSupport.ts"]
    .map((name) => [name, strip(readFileSync(resolve(REPO_ROOT, "src/studio/web", name), "utf8"))] as const);
  const g = await world({ google: true });
  const googleLogin = await request(g, "/auth/login", { jar: new Jar() });
  await g.close();
  check("SA9. the endpoints and issuers are Google's code constants, frozen, as read from Google's discovery document on "
    + "2026-10-02 — and no web module but the entry point reads the environment, so no variable can change them; an app "
    + "built without an issuer (as the entry point builds it) sends the browser to Google's authorization endpoint",
    GOOGLE_OIDC.authorizationEndpoint === "https://accounts.google.com/o/oauth2/v2/auth"
      && GOOGLE_OIDC.tokenEndpoint === "https://oauth2.googleapis.com/token"
      && GOOGLE_OIDC.jwksUri === "https://www.googleapis.com/oauth2/v3/certs"
      && JSON.stringify(GOOGLE_OIDC.issuers) === JSON.stringify(["https://accounts.google.com", "accounts.google.com"])
      && Object.isFrozen(GOOGLE_OIDC) && Object.isFrozen(GOOGLE_OIDC.issuers)
      && webSources.every(([, text]) => !/process\.env|process\[/.test(text))
      && googleLogin.status === 302 && googleLogin.location!.startsWith(`${GOOGLE_OIDC.authorizationEndpoint}?`)
      && JSON.stringify(ID_TOKEN_ALGORITHMS) === JSON.stringify(["RS256"]) && CLOCK_SKEW_SECONDS === 60);
}

// =====================================================================================================
// C. Login, the accepted paths, and every refusal
// =====================================================================================================

{
  const w = await world();
  const jar = new Jar();
  const login = await request(w, "/auth/login", { jar, headers: { host: "evil.test", "x-forwarded-host": "evil.test" } });
  const auth = new URL(login.location ?? "about:blank");
  const q = auth.searchParams;
  const [attempt] = [...w.store.attempts.entries()];
  const state = q.get("state") ?? "";
  const nonce = q.get("nonce") ?? "";
  for (const value of [state, nonce]) secrets.add(value);
  const loginCookie = login.setCookies.find((c) => c.startsWith(`${LOGIN_COOKIE}=`)) ?? "";
  check("SA10. GET /auth/login creates one login attempt — state and nonce stored only as sha256 hex, the PKCE verifier as "
    + "issued (its S256 is the challenge sent) — sets __Host-gcd_studio_login (Secure, HttpOnly, SameSite=Lax, Path=/, no "
    + "Domain) holding the state, and redirects with response_type=code, scope=openid email profile, hd=germancardepot.com, "
    + "S256, a nonce and a redirect_uri derived from STUDIO_PUBLIC_ORIGIN, never from Host",
    cookieNamesExact && login.status === 302 && `${auth.origin}${auth.pathname}` === issuer.provider.authorizationEndpoint
      && q.get("response_type") === "code" && q.get("scope") === OIDC_SCOPE && OIDC_SCOPE === "openid email profile"
      && q.get("hd") === STUDIO_DOMAIN && q.get("client_id") === CLIENT_ID && q.get("code_challenge_method") === "S256"
      && q.get("redirect_uri") === `${ORIGIN}/auth/callback` && /^[A-Za-z0-9_-]{43}$/.test(state) && /^[A-Za-z0-9_-]{43}$/.test(nonce)
      && w.store.attempts.size === 1 && attempt![0] === createHash("sha256").update(state).digest("hex")
      && attempt![1].nonceHash === createHash("sha256").update(nonce).digest("hex")
      && pkceChallenge(attempt![1].verifier) === q.get("code_challenge") && /^[A-Za-z0-9_-]{43}$/.test(attempt![1].verifier)
      && LOGIN_SET_COOKIE.test(loginCookie) && loginCookie.startsWith(`${LOGIN_COOKIE}=${state};`) && !/domain=/i.test(loginCookie)
      && !w.store.dump().includes(state) && !w.store.dump().includes(nonce),
    loginCookie.replace(/=[^;]*/, "=…"));
  await w.close();
}

{
  const w = await world();
  const viewer = listed(w, "viewer", { display_name: "Test <Viewer> & \"Co\"" });
  const sub = `sub-${randomBytes(6).toString("hex")}`;
  const jar = new Jar();
  const first = await signIn(w, jar, { identity: identityOf(viewer, sub) });
  const tokenForm = issuer.lastTokenRequest;
  const sessionCookie = first.setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`)) ?? "";
  const cookieValue = jar.values.get(SESSION_COOKIE) ?? "";
  const subAfterFirst = w.store.users.get(viewer.id)?.google_sub;
  const home = await request(w, "/", { jar });
  const second = await signIn(w, new Jar(), { identity: identityOf(viewer, sub) });
  check("SA11. a listed user signs in: the code is exchanged with the client secret and the PKCE verifier, the session "
    + "cookie is __Host-gcd_studio_session (Secure, HttpOnly, SameSite=Lax, Path=/, no Domain, 7 days), the login cookie "
    + "is cleared, the reply is a redirect to \"/\", google_sub is set at the first sign-in and kept at the next, and the "
    + "signed-in page shows the escaped display name, the role and a logout form, with no inline script",
    cookieNamesExact && first.status === 303 && first.location === "/" && SESSION_SET_COOKIE.test(sessionCookie)
      && !/domain=/i.test(sessionCookie) && first.setCookies.includes(`${LOGIN_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`)
      && tokenForm?.get("client_secret") === CLIENT_SECRET && tokenForm?.get("grant_type") === "authorization_code"
      && tokenForm?.get("redirect_uri") === `${ORIGIN}/auth/callback` && subAfterFirst === sub
      && second.status === 303 && w.store.users.get(viewer.id)?.google_sub === sub
      && w.store.auditLog.filter((a) => a.action === "auth.sign_in" && a.actorUserId === viewer.id).length === 2
      && home.status === 200 && home.body.includes("Test &lt;Viewer&gt; &amp; &quot;Co&quot;") && !home.body.includes("<Viewer>")
      && home.body.includes("role: <strong>viewer</strong>") && home.body.includes(`value="${csrfTokenFor(cookieValue)}"`)
      && home.body.includes('<form method="post" action="/auth/logout">') && !/<script|\son[a-z]+=/i.test(home.body),
    `${first.status} ${sessionCookie.replace(/=[^;]*/, "=…")}`);
  secrets.add(csrfTokenFor(cookieValue));
  await w.close();
}

{
  const w = await world({ withOwner: false, bootstrap: ` ${"Boot.Owner"}${"@"}GermanCarDepot.COM ` });
  const sub = `sub-${randomBytes(6).toString("hex")}`;
  const email = `${"boot.owner"}${"@"}${STUDIO_DOMAIN}`;
  const reply = await signIn(w, new Jar(), { identity: { email: email.toUpperCase(), sub, name: "Boot Owner" } });
  const owners = [...w.store.users.values()].filter((u) => u.role === "owner");
  check("SA12. bootstrap: while no owner exists, a sign-in passing every check whose verified email equals the "
    + "lower-cased STUDIO_BOOTSTRAP_OWNER_EMAIL (set in mixed case, with spaces) creates that user as the active owner, "
    + "with its google_sub, by the schema's bootstrap rule, audit-logged",
    reply.status === 303 && reply.location === "/" && owners.length === 1 && owners[0]!.email === email
      && owners[0]!.google_sub === sub && owners[0]!.status === "active" && owners[0]!.created_by === null
      && w.store.auditLog.some((a) => a.action === "auth.bootstrap_owner" && a.actorUserId === owners[0]!.id)
      && w.store.sessions.size === 1, `${reply.status} ${String(w.store.auditLog.at(-1)?.detail.reason)}`);
  await w.close();
}

const user = (w: World, extra: Partial<StudioUserRow> = {}) => identityOf(listed(w, "viewer", extra));
const claims = (edit: (c: Record<string, unknown>) => void): TokenPlan => ({ claims: (c) => { const n = { ...c }; edit(n); return n; } });

await refusal("SA13. refused: an hd claim other than germancardepot.com", "hd",
  (w) => ({ identity: user(w), plan: claims((c) => { c.hd = "other.test"; }) }));
await refusal("SA14. refused: a missing hd claim", "hd", (w) => ({ identity: user(w), plan: claims((c) => { delete c.hd; }) }));
await refusal("SA15. refused: email_verified false", "email-unverified",
  (w) => ({ identity: user(w), plan: claims((c) => { c.email_verified = false; }) }));
await refusal("SA16. refused: email_verified missing", "email-unverified",
  (w) => ({ identity: user(w), plan: claims((c) => { delete c.email_verified; }) }));
await refusal("SA17. refused: email_verified as the string \"true\"", "email-unverified",
  (w) => ({ identity: user(w), plan: claims((c) => { c.email_verified = "true"; }) }));
await refusal("SA18. refused: an aud other than the client id", "audience",
  (w) => ({ identity: user(w), plan: claims((c) => { c.aud = "another-client.apps.test"; }) }));
await refusal("SA19. refused: an iss other than the provider's", "issuer",
  (w) => ({ identity: user(w), plan: claims((c) => { c.iss = "https://issuer.test"; }) }));
await refusal("SA20. refused: a bad signature (another token's signature spliced in)", "signature", (w) => ({
  identity: user(w),
  plan: { sign: async (c, i) => {
    const good = await i.signRs256(c);
    const other = await i.signRs256({ ...c, sub: "someone-else" });
    return `${good.split(".").slice(0, 2).join(".")}.${other.split(".")[2]}`;
  } },
}));
await refusal("SA21. refused: a token signed by a different key under the published key's kid", "signature",
  (w) => ({ identity: user(w), plan: { sign: (c, i) => i.signRs256(c, i.other.privateKey) } }));
await refusal("SA22. refused: alg none", "algorithm", (w) => ({ identity: user(w), plan: { sign: async (c, i) => i.signNone(c) } }));
await refusal("SA23. refused: HS256 keyed with the published public key", "algorithm",
  (w) => ({ identity: user(w), plan: { sign: async (c, i) => i.signHs256WithPublicKey(c) } }));
await refusal("SA23a. refused: RS512 signed by the published key under its kid — only RS256 is allowed", "algorithm",
  (w) => ({ identity: user(w), plan: { sign: (c, i) => i.signRs256(c, i.primary.privateKey, "RS512") } }));
await refusal("SA24. refused: an expired token (exp past the 60-second skew)", "token-expired", (w) => ({
  identity: user(w),
  plan: claims((c) => { const now = Math.floor(w.clock.now / 1000); c.iat = now - 600; c.exp = now - 61; }),
}));
await refusal("SA25. refused: iat in the future beyond the 60-second skew", "token-time", (w) => ({
  identity: user(w),
  plan: claims((c) => { const now = Math.floor(w.clock.now / 1000); c.iat = now + 120; c.exp = now + 3_720; }),
}));

{
  // SA26: replay — the same callback, with the same login cookie, after it succeeded once.
  const w = await world();
  const identity = user(w);
  const jar = new Jar();
  const first = await signIn(w, jar, { identity });
  const login = new Jar();
  const replayJar = new Jar();
  const r = await request(w, "/auth/login", { jar: login });
  const back = new URL((await fetch(r.location!, { redirect: "manual" })).headers.get("location")!);
  replayJar.values.set(LOGIN_COOKIE, login.values.get(LOGIN_COOKIE)!);
  const once = await request(w, `${back.pathname}${back.search}`, { jar: login });
  const auditBefore = w.store.auditLog.length;
  const sessionsBefore = w.store.sessions.size;
  const replay = await request(w, `${back.pathname}${back.search}`, { jar: replayJar });
  check("SA26. refused: a replayed state — the same callback and login cookie a second time; the attempt was consumed",
    first.status === 303 && once.status === 303 && refusedAs(w, replay, "state-unknown", auditBefore, sessionsBefore),
    `${once.status} ${replay.status} ${String(w.store.auditLog.at(-1)?.detail.reason)}`);
  await w.close();
}

{
  const w = await world();
  const identity = user(w);
  const other = new Jar();
  await request(w, "/auth/login", { jar: other });
  const auditBefore = w.store.auditLog.length;
  const reply = await signIn(w, new Jar(), { identity, jarAtCallback: other });
  const forged = randomBytes(32).toString("base64url");
  const forgedJar = new Jar();
  forgedJar.values.set(LOGIN_COOKIE, forged);
  const forgedReply = await request(w, `/auth/callback?state=${forged}&code=x`, { jar: forgedJar });
  const firstReason = w.store.auditLog[auditBefore]?.detail.reason;
  check("SA27. refused: the login cookie and the stored state disagree — the URL's state is stored but the cookie holds "
    + "another attempt's state; and a state matching its cookie but stored nowhere is refused too",
    reply.status === 403 && reply.body === notAuthorizedBody && firstReason === "state-cookie-mismatch"
      && forgedReply.status === 403 && forgedReply.body === notAuthorizedBody && w.store.auditLog.at(-1)?.detail.reason === "state-unknown"
      && w.store.auditLog.length === auditBefore + 2 && w.store.sessions.size === 0 && w.store.attempts.size === 2,
    `${String(firstReason)} ${String(w.store.auditLog.at(-1)?.detail.reason)}`);
  await w.close();
}

await refusal("SA28. refused: a callback with no state", "state-missing",
  (w) => ({ identity: user(w), edit: (u) => { u.searchParams.delete("state"); } }));
await refusal("SA29. refused: a nonce that does not match the stored one", "nonce",
  (w) => ({ identity: user(w), plan: claims((c) => { c.nonce = randomBytes(32).toString("base64url"); }) }));
await refusal("SA30. refused: a login attempt over 10 minutes old", "state-unknown", (w) => ({
  identity: user(w),
  edit: () => { w.clock.now += 10 * 60_000 + 1_000; },
}));
{
  const w = await world();
  const identity = user(w);
  issuer.tokenMode = "error";
  const before = w.store.auditLog.length;
  const reply = await signIn(w, new Jar(), { identity });
  check("SA31. refused: the token endpoint answers with an error", refusedAs(w, reply, "token-endpoint-error", before, 0),
    String(w.store.auditLog.at(-1)?.detail.reason));
  issuer.tokenMode = "ok";
  await w.close();
}
{
  const w = await world({ tokenTimeoutMs: 400 });
  const identity = user(w);
  issuer.tokenMode = "hang";
  const before = w.store.auditLog.length;
  const started = Date.now();
  const reply = await signIn(w, new Jar(), { identity });
  const elapsed = Date.now() - started;
  check("SA32. refused: a token endpoint that never answers is abandoned at the bounded timeout (10 s in service; 0.4 s "
    + "here), and the key set has its own 5 s bound",
    refusedAs(w, reply, "token-endpoint-timeout", before, 0) && elapsed < 5_000 && TOKEN_EXCHANGE_TIMEOUT_MS === 10_000
      && JWKS_TIMEOUT_MS === 5_000,
    `${elapsed} ms, ${String(w.store.auditLog.at(-1)?.detail.reason)}`);
  issuer.tokenMode = "ok";
  await w.close();
}
{
  const w = await world();
  const identity = user(w);
  const forged = await issuer.signRs256(issuer.baseClaims("n", w.clock.now));
  secrets.add(forged);
  const requestsBefore = issuer.tokenRequests;
  const before = w.store.auditLog.length;
  const reply = await signIn(w, new Jar(), { identity, edit: (u) => { u.searchParams.set("id_token", forged); } });
  check("SA33. refused: an ID token supplied in the callback URL — tokens are accepted only from the token response, so "
    + "the token endpoint is not even called",
    refusedAs(w, reply, "token-in-url", before, 0) && issuer.tokenRequests === requestsBefore,
    String(w.store.auditLog.at(-1)?.detail.reason));
  await w.close();
}
await refusal("SA34. refused: an email with no studio_users row", "not-listed",
  () => ({ identity: { email: syntheticEmail("unlisted"), sub: `sub-${randomBytes(6).toString("hex")}` } }));
await refusal("SA35. refused: a disabled user", "user-disabled", (w) => ({ identity: user(w, { status: "disabled" }) }));
await refusal("SA36. refused: a google_sub that does not match the one set at first sign-in", "subject-mismatch", (w) => {
  const row = listed(w, "viewer", { google_sub: `sub-${randomBytes(6).toString("hex")}` });
  return { identity: identityOf(row, `sub-${randomBytes(6).toString("hex")}`) };
});
await refusal("SA37. refused: an email outside germancardepot.com whose hd claim passes", "email-domain",
  () => ({ identity: { email: `outsider.${randomBytes(3).toString("hex")}${"@"}other.test`, sub: `sub-${randomBytes(6).toString("hex")}` } }));
await refusal("SA38. refused: bootstrap while STUDIO_BOOTSTRAP_OWNER_EMAIL is unset — no owner exists, and none is created",
  "bootstrap-unset", () => ({ identity: { email: syntheticEmail("first"), sub: `sub-${randomBytes(6).toString("hex")}` } }),
  { withOwner: false, bootstrap: null }, (w) => w.store.users.size === 0 && !w.store.calls.includes("createBootstrapOwner"));
{
  const email = syntheticEmail("late.bootstrap");
  await refusal("SA39. refused: bootstrap once an owner exists — the variable is ignored, the email is simply unlisted, "
    + "and no owner row is even attempted", "not-listed", () => ({ identity: { email, sub: `sub-${randomBytes(6).toString("hex")}` } }),
  { bootstrap: email }, (w) => !w.store.calls.includes("createBootstrapOwner")
    && [...w.store.users.values()].filter((u) => u.role === "owner").length === 1);
}

{
  const w = await world();
  const identity = user(w);
  const login = await request(w, "/auth/login?next=https%3A%2F%2Fevil.test%2F&return_to=%2F%2Fevil.test", { jar: new Jar() });
  const reply = await signIn(w, new Jar(), {
    identity, edit: (u) => { u.searchParams.set("next", "https://evil.test/"); u.searchParams.set("redirect", "//evil.test"); },
  });
  const params = [...new URL(login.location!).searchParams.keys()].sort().join();
  check("SA40. on success the redirect is always \"/\": a next, redirect or return_to parameter on login or callback is "
    + "ignored, and the authorization request carries none",
    reply.status === 303 && reply.location === "/"
      && params === "client_id,code_challenge,code_challenge_method,hd,nonce,redirect_uri,response_type,scope,state",
    `${reply.status} ${reply.location}`);
  await w.close();
}

{
  // SA41: the real store's statements, through a recording client.
  const statements: string[] = [];
  const recording = {
    query: async (text: string) => {
      statements.push(text);
      return { rows: text.includes("studio_consume_login_attempt") ? [{ nonce_hash: "a".repeat(64), pkce_verifier: "v".repeat(43) }] : [],
        rowCount: 0 };
    },
  };
  const pgStore = new PgWebStore(recording as never);
  await pgStore.consumeLoginAttempt("b".repeat(64));
  const consume = [...statements];
  statements.length = 0;
  await pgStore.findSession("c".repeat(64));
  const lookup = statements.join("\n");
  check("SA41. the store consumes a login attempt only through the schema's single-use, expiry-refusing "
    + "studio_consume_login_attempt, never by reading studio_login_attempts; and it reads a session with its live users "
    + "row unfiltered, so revocation, expiry and status are decided in one place (decideSession)",
    consume.length === 1 && /FROM studio_consume_login_attempt\(\$1\)/.test(consume[0]!) && !/studio_login_attempts/.test(consume[0]!)
      && /FROM studio_sessions s JOIN studio_users u/.test(lookup) && !/revoked_at\s+IS|expires_at\s*[<>]|status\s*=/.test(lookup),
    consume.join(" | "));
}

// =====================================================================================================
// E. CSRF and Origin; sessions
// =====================================================================================================

async function signedInWorld(role: StudioUserRow["role"] = "viewer", options: Parameters<typeof world>[0] = {}) {
  const w = await world(options);
  const row = listed(w, role);
  const jar = new Jar();
  await signIn(w, jar, { identity: identityOf(row) });
  return { w, row, jar, cookie: jar.values.get(SESSION_COOKIE)! };
}
const logout = (w: World, jar: Jar, headers: Record<string, string>, body?: string) => request(w, "/auth/logout", {
  method: "POST", jar, headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body,
});
const stillSignedIn = async (w: World, jar: Jar) => (await request(w, "/", { jar })).body.includes("Signed in as");

{
  const { w, jar, cookie } = await signedInWorld();
  const none = await logout(w, jar, { origin: ORIGIN }, "");
  check("SA42. CSRF refused: a logout POST with no token, even with the right Origin; the session stays live",
    none.status === 403 && (await stillSignedIn(w, jar)) && w.store.sessions.get(sessionIdHash(cookie))?.revoked_at === null);
  const wrong = await logout(w, jar, { origin: ORIGIN }, `csrf=${randomBytes(32).toString("base64url")}`);
  check("SA43. CSRF refused: a wrong token", wrong.status === 403 && (await stillSignedIn(w, jar)));
  const otherJar = new Jar();
  await signIn(w, otherJar, { identity: identityOf(listed(w, "viewer")) });
  const another = await logout(w, jar, { origin: ORIGIN }, `csrf=${csrfTokenFor(otherJar.values.get(SESSION_COOKIE)!)}`);
  const anotherHeader = await logout(w, jar, { origin: ORIGIN, "x-csrf-token": csrfTokenFor(otherJar.values.get(SESSION_COOKIE)!) });
  check("SA44. CSRF refused: another live session's token, in the form or the header",
    another.status === 403 && anotherHeader.status === 403 && (await stillSignedIn(w, jar)) && (await stillSignedIn(w, otherJar)));
  const token = `csrf=${csrfTokenFor(cookie)}`;
  const missing = await logout(w, jar, {}, token);
  check("SA45. Origin refused: a POST with no Origin header, even with the right token", missing.status === 403 && (await stillSignedIn(w, jar)));
  const nullOrigin = await logout(w, jar, { origin: "null" }, token);
  check("SA46. Origin refused: Origin \"null\"", nullOrigin.status === 403 && (await stillSignedIn(w, jar)));
  const others = await Promise.all(["https://evil.test", "http://studio.test", "https://studio.test.evil.test", `${ORIGIN}:443`,
    "https://STUDIO.test"].map((origin) => logout(w, jar, { origin }, token)));
  check("SA47. Origin refused: any other origin — another host, http, a suffix, a default port, upper case",
    others.every((r) => r.status === 403) && (await stillSignedIn(w, jar)));
  const get = await request(w, "/auth/logout", { jar });
  check("SA48. GET /auth/logout is 405, and changes nothing: no state changes on a GET",
    get.status === 405 && get.headers.get("allow") === "POST" && (await stillSignedIn(w, jar)));
  const auditBefore = w.store.auditLog.length;
  const done = await logout(w, jar, { origin: ORIGIN }, token);
  const after = await request(w, "/", { jar: (() => { const j = new Jar(); j.values.set(SESSION_COOKIE, cookie); return j; })() });
  check("SA49. a logout with the exact Origin and the session's own token revokes the session, clears the cookie with the "
    + "same attributes, audits it, and redirects to \"/\"; the old cookie is refused after",
    done.status === 303 && done.location === "/"
      && done.setCookies.includes(`${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`)
      && w.store.sessions.get(sessionIdHash(cookie))?.revoked_at instanceof Date
      && w.store.auditLog.length === auditBefore + 1 && w.store.auditLog.at(-1)?.action === "auth.sign_out"
      && !after.body.includes("Signed in as") && after.body.includes("Sign in with Google"));
  await w.close();
}

{
  const { w, jar, cookie } = await signedInWorld();
  const start = w.clock.now;
  w.clock.now = start + 11 * 3_600_000;
  const at11 = await stillSignedIn(w, jar);
  const extended = w.store.sessions.get(sessionIdHash(cookie))?.idle_expires_at.getTime();
  w.clock.now = start + 11 * 3_600_000 + SESSION_IDLE_MS - 1_000;
  const justBefore = await stillSignedIn(w, jar);
  w.clock.now = start + 11 * 3_600_000 + SESSION_IDLE_MS - 1_000 + SESSION_IDLE_MS + 1_000;
  const afterIdle = await request(w, "/", { jar: (() => { const j = new Jar(); j.values.set(SESSION_COOKIE, cookie); return j; })() });
  check("SA50. idle expiry: a session used within 12 hours is extended to 12 hours from its use (never past its absolute "
    + "expiry), and one left idle for 12 hours is refused and its cookie cleared",
    at11 && extended === start + 11 * 3_600_000 + SESSION_IDLE_MS && justBefore && !afterIdle.body.includes("Signed in as")
      && afterIdle.setCookies.some((c) => c.startsWith(`${SESSION_COOKIE}=;`)));
  await w.close();
}
{
  const { w, jar } = await signedInWorld();
  const start = w.clock.now;
  let alive = true;
  for (let t = 11 * 3_600_000; t < SESSION_ABSOLUTE_MS; t += 11 * 3_600_000) {
    w.clock.now = start + t;
    alive &&= await stillSignedIn(w, jar);
  }
  w.clock.now = start + SESSION_ABSOLUTE_MS - 1_000;
  const lastSecond = await stillSignedIn(w, jar);
  w.clock.now = start + SESSION_ABSOLUTE_MS;
  check("SA51. absolute expiry: a session in constant use is refused at 7 days, however recently it was used",
    alive && lastSecond && !(await stillSignedIn(w, jar)) && SESSION_ABSOLUTE_MS === 7 * 86_400_000);
  await w.close();
}
{
  const { w, jar, cookie } = await signedInWorld();
  const live = await stillSignedIn(w, jar);
  await w.store.revokeSession(sessionIdHash(cookie), new Date(w.clock.now));
  check("SA52. a revoked session is refused", live && !(await stillSignedIn(w, jar)));
  await w.close();
}
{
  const { w, row, jar, cookie } = await signedInWorld();
  const live = await stillSignedIn(w, jar);
  w.store.setStatus(row.id, "disabled");
  const disabled = !(await stillSignedIn(w, jar));
  w.store.setStatus(row.id, "active");
  // The refusal cleared the browser's cookie; the same value presented again is still refused.
  const presented = new Jar();
  presented.values.set(SESSION_COOKIE, cookie);
  const stillRevoked = !(await stillSignedIn(w, presented));
  const fresh = (status: StudioUserRow["status"]): SessionRow => ({
    id_hash: "a".repeat(64), csrf_token_hash: "b".repeat(64), created_at: new Date(1_000), last_seen_at: new Date(1_000),
    idle_expires_at: new Date(1_000 + SESSION_IDLE_MS), absolute_expires_at: new Date(1_000 + SESSION_ABSOLUTE_MS), revoked_at: null,
    user: { ...row, status },
  });
  check("SA53. disabling a user revokes their sessions (re-enabling does not revive one), and a disabled user's "
    + "unrevoked session is refused anyway",
    live && disabled && stillRevoked && !decideSession(fresh("disabled"), 2_000).ok && decideSession(fresh("active"), 2_000).ok);
  await w.close();
}
{
  const { w, row, jar, cookie } = await signedInWorld();
  const old = new Jar();
  old.values.set(SESSION_COOKIE, cookie);
  const again = await signIn(w, jar, { identity: identityOf(w.store.users.get(row.id)!) });
  const fresh = jar.values.get(SESSION_COOKIE)!;
  check("SA54. the session is rotated at sign-in: a session presented to the callback is revoked, and a new cookie "
    + "value is issued",
    again.status === 303 && fresh !== cookie && w.store.sessions.get(sessionIdHash(cookie))?.revoked_at instanceof Date
      && !(await stillSignedIn(w, old)) && (await stillSignedIn(w, jar))
      && w.store.auditLog.at(-1)?.action === "auth.sign_in" && w.store.auditLog.at(-1)?.detail.rotated === true);
  await w.close();
}
{
  const { w, jar, cookie } = await signedInWorld();
  const dump = w.store.dump();
  check("SA55. the session cookie's value never reaches the store: only its sha256 is stored, and neither the value nor "
    + "its CSRF token appears anywhere in what the store holds",
    !dump.includes(cookie) && !dump.includes(csrfTokenFor(cookie)) && dump.includes(sessionIdHash(cookie))
      && w.store.sessions.has(sessionIdHash(cookie)) && (await stillSignedIn(w, jar)));
  await w.close();
}

// =====================================================================================================
// Headers, /healthz, routes, rate limits, purges
// =====================================================================================================

const ownerOnly: Route = { method: "GET", path: "/test/owner-only", minRole: "owner",
  handle: async ({ res }) => { res.statusCode = 200; res.setHeader("content-type", "text/plain"); res.end("owner-only"); } };
const undeclaredRole: Route = { method: "GET", path: "/test/undeclared-role", minRole: "admin" as never,
  handle: async ({ res }) => { res.statusCode = 200; res.end("reached"); } };

{
  const { w, jar } = await signedInWorld("viewer", { extraRoutes: [ownerOnly] });
  w.store.heartbeatAt = w.clock.now - 42_000;
  const replies: Array<[string, Reply]> = [
    ["signed-out page", await request(w, "/")],
    ["signed-in page", await request(w, "/", { jar })],
    ["404", await request(w, "/nowhere")],
    ["405", await request(w, "/auth/logout")],
    ["OPTIONS", await request(w, "/", { method: "OPTIONS", headers: { origin: "https://evil.test", "access-control-request-method": "POST" } })],
    ["403 origin", await logout(w, jar, { origin: "https://evil.test" }, "")],
    ["403 role", await request(w, "/test/owner-only", { jar })],
    ["401", await request(w, "/test/owner-only")],
    ["not authorized", await request(w, "/auth/callback")],
    ["healthz", await request(w, "/healthz")],
  ];
  w.store.failHealth = true;
  replies.push(["healthz 503", await request(w, "/healthz")]);
  w.store.failSessions = true;
  replies.push(["500", await request(w, "/", { jar })]);
  await w.close();
  const lw = await world();
  let limited: Reply | undefined;
  for (let i = 0; i <= LOGIN_LIMIT.limit; i += 1) limited = await request(lw, "/auth/login");
  replies.push(["429", limited!]);
  await lw.close();
  const statuses = replies.map(([, r]) => r.status).join();
  check("SA56. every response carries the security headers — CSP default-src 'self'; script-src 'self'; object-src "
    + "'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none', Strict-Transport-Security, Referrer-Policy "
    + "no-referrer, nosniff — on success, 401, 403, 404, 405, 429, 500 and /healthz (200 and 503), and none carries a CORS "
    + "header, even to a preflight",
    statuses === "200,200,404,405,405,403,403,401,403,200,503,500,429"
      && replies.every(([, r]) => r.headers.get("content-security-policy") === CONTENT_SECURITY_POLICY
        && r.headers.get("strict-transport-security") === "max-age=63072000; includeSubDomains"
        && r.headers.get("referrer-policy") === "no-referrer" && r.headers.get("x-content-type-options") === "nosniff"
        && [...r.headers.keys()].every((k) => !k.startsWith("access-control-")))
      && CONTENT_SECURITY_POLICY === "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
      && Object.keys(SECURITY_HEADERS).length === 5,
    statuses);
  const health = JSON.parse(replies.find(([n]) => n === "healthz")![1].body) as Record<string, unknown>;
  const down = JSON.parse(replies.find(([n]) => n === "healthz 503")![1].body) as Record<string, unknown>;
  const body = replies.find(([n]) => n === "healthz")![1].body;
  check("SA57. /healthz needs no session and returns exactly service gcd-studio-web, the commit, state postgres, the "
    + "applied schema version and the worker heartbeat's age — no user, run or cost data",
    JSON.stringify(Object.keys(health).sort()) === JSON.stringify(["commit", "schema_version", "service", "state",
      "worker_heartbeat_age_seconds"])
      && health.service === "gcd-studio-web" && health.commit === COMMIT && health.state === "postgres"
      && health.schema_version === "0002_studio_schema.sql" && health.worker_heartbeat_age_seconds === 42
      && down.state === "unavailable" && !/@|owner|viewer|runner|display|email|usd|cost|run_id/i.test(body));
}

{
  const w = await world({ extraRoutes: [ownerOnly, undeclaredRole] });
  const owner = new Jar();
  await signIn(w, owner, { identity: identityOf(w.owner) });
  const calls = w.store.calls.length;
  const undeclared = await Promise.all(["/admin", "/auth", "/auth/callback/x", "/healthz/", "/%2e%2e/etc", "/.env"]
    .map((path) => request(w, path, { jar: owner })));
  check("SA58. an undeclared route is denied by default (404) without reaching a handler or the store; every route the "
    + "service ships is in the one table with a declared minimum role, and logout needs a session",
    undeclared.every((r) => r.status === 404) && w.store.calls.length === calls
      && STUDIO_ROUTE_TABLE.map((r) => `${r.method} ${r.path} ${r.minRole}`).join() === ["GET / public", "GET /healthz public",
        "GET /auth/login public", "GET /auth/callback public", "POST /auth/logout viewer"].join()
      && w.app.routes.length === STUDIO_ROUTE_TABLE.length + 2,
    undeclared.map((r) => r.status).join());
  const viewer = new Jar();
  await signIn(w, viewer, { identity: identityOf(listed(w, "viewer")) });
  const runner = new Jar();
  await signIn(w, runner, { identity: identityOf(listed(w, "runner")) });
  const results = [
    (await request(w, "/test/owner-only", { jar: viewer })).status, (await request(w, "/test/owner-only", { jar: runner })).status,
    (await request(w, "/test/owner-only")).status, (await request(w, "/test/owner-only", { jar: owner })).status,
    (await request(w, "/test/undeclared-role", { jar: owner })).status,
  ];
  check("SA59. roles, default deny: a viewer and a runner are refused (403) on a test-only owner route, a signed-out "
    + "request is refused (401), the owner is allowed, and a route declaring no known role is denied even to the owner",
    results.join() === "403,403,401,200,403" && !roleAllows(undefined, w.owner) && !roleAllows("admin", w.owner)
      && roleAllows("owner", w.owner) && !roleAllows("viewer", null) && roleAllows("public", null),
    results.join());
  const viewerRow = [...w.store.users.values()].find((u) => u.role === "viewer")!;
  viewerRow.role = "owner";
  const promoted = (await request(w, "/test/owner-only", { jar: viewer })).status;
  viewerRow.role = "viewer";
  const demoted = (await request(w, "/test/owner-only", { jar: viewer })).status;
  check("SA60. the role is checked on every request against the live users row, not a role remembered in the session",
    promoted === 200 && demoted === 403);
  await w.close();
}

{
  const w = await world();
  const statuses: number[] = [];
  for (let i = 0; i < LOGIN_LIMIT.limit + 2; i += 1) statuses.push((await request(w, "/auth/login")).status);
  const attempts = w.store.attempts.size;
  w.clock.now += LOGIN_LIMIT.windowMs;
  const later = (await request(w, "/auth/login")).status;
  const limiter = new WindowLimiter(2, 1_000);
  check("SA61. GET /auth/login is rate-limited per client address: past 20 a minute it is 429 and creates no attempt; "
    + "the window then reopens; another address has its own count",
    statuses.slice(0, LOGIN_LIMIT.limit).every((s) => s === 302) && statuses.slice(LOGIN_LIMIT.limit).every((s) => s === 429)
      && attempts === LOGIN_LIMIT.limit && later === 302
      && limiter.hit("a", 0) && limiter.hit("a", 1) && !limiter.hit("a", 2) && limiter.hit("b", 2) && limiter.hit("a", 1_000),
    statuses.join());
  await w.close();
}
{
  // Successful callbacks, so the failed-sign-in limit is not what trips; the logins span two login windows.
  const w = await world();
  const identity = user(w);
  issuer.identity = identity;
  const flows: Array<{ jar: Jar; path: string }> = [];
  for (let i = 0; i < CALLBACK_LIMIT.limit + 1; i += 1) {
    if (i === 10) w.clock.now += LOGIN_LIMIT.windowMs;
    const jar = new Jar();
    const login = await request(w, "/auth/login", { jar });
    const back = new URL((await fetch(login.location!, { redirect: "manual" })).headers.get("location")!);
    flows.push({ jar, path: `${back.pathname}${back.search}` });
  }
  const statuses: number[] = [];
  for (const flow of flows) statuses.push((await request(w, flow.path, { jar: flow.jar })).status);
  check("SA62. GET /auth/callback is rate-limited per client address: the 21st in a minute is 429, even when every "
    + "earlier one succeeded",
    statuses.slice(0, CALLBACK_LIMIT.limit).every((s) => s === 303) && statuses[CALLBACK_LIMIT.limit] === 429, statuses.join());
  await w.close();
}
{
  const w = await world();
  const identity = user(w);
  const statuses: number[] = [];
  for (let i = 0; i < FAILED_SIGN_IN_LIMIT.limit; i += 1) {
    statuses.push((await signIn(w, new Jar(), { identity, plan: claims((c) => { c.hd = "other.test"; }) })).status);
  }
  const audits = w.store.auditLog.length;
  const consumed = w.store.calls.filter((c) => c === "consumeLoginAttempt").length;
  const tokenRequests = issuer.tokenRequests;
  const blocked = await signIn(w, new Jar(), { identity });
  check("SA63. failed sign-ins are rate-limited per client address: after 10 failures the callback refuses with 429 "
    + "before any work — no attempt consumed, no token request, no audit row, no session",
    statuses.every((s) => s === 403) && blocked.status === 429 && w.store.auditLog.length === audits
      && w.store.calls.filter((c) => c === "consumeLoginAttempt").length === consumed && issuer.tokenRequests === tokenRequests
      && w.store.sessions.size === 0,
    `${statuses.join()} then ${blocked.status}`);
  await w.close();
}

{
  const { w, cookie } = await signedInWorld();
  const now = w.clock.now;
  const day = 86_400_000;
  const attempt = (expiresAt: number) => ({ nonceHash: "f".repeat(64), verifier: "v".repeat(43), createdAt: expiresAt - 600_000, expiresAt });
  w.store.attempts.set("e".repeat(64), attempt(now - 2 * day));
  w.store.attempts.set("c".repeat(64), attempt(now - 3_600_000));
  w.store.attempts.set("d".repeat(64), attempt(now + 60_000));
  const live = sessionIdHash(cookie);
  const base = w.store.sessions.get(live)!;
  const ended = (key: string, edit: Partial<typeof base>) => w.store.sessions.set(key.repeat(64), { ...base, id_hash: key.repeat(64), ...edit });
  ended("1", { absolute_expires_at: new Date(now - 31 * day), idle_expires_at: new Date(now - 31 * day) });
  ended("4", { idle_expires_at: new Date(now - day) });
  ended("2", { revoked_at: new Date(now - 31 * day) });
  ended("3", { revoked_at: new Date(now - 3_600_000) });
  const result = await w.app.purge();
  check("SA65. the purge (design §4.7) deletes login attempts a day after they expire and sessions 30 days after they "
    + "end — idle or absolute expiry, or revocation — and keeps a live attempt, one expired an hour ago, a live session, "
    + "one idle-expired a day ago and one revoked an hour ago",
    result.loginAttempts === 1 && result.sessions === 2 && !w.store.attempts.has("e".repeat(64))
      && w.store.attempts.has("c".repeat(64)) && w.store.attempts.has("d".repeat(64))
      && w.store.sessions.has(live) && w.store.sessions.has("3".repeat(64)) && w.store.sessions.has("4".repeat(64))
      && !w.store.sessions.has("1".repeat(64)) && !w.store.sessions.has("2".repeat(64)),
    JSON.stringify(result));
  await w.close();
}

{
  const plan = (input: Partial<Parameters<typeof planSignIn>[0]>) => planSignIn({
    identity: { email: "e", sub: "s" }, user: null, activeOwnerExists: false, bootstrapOwnerEmail: "e", ...input,
  }).kind;
  check("SA66. the sign-in plan, as a pure decision: bootstrap only with no active owner and the exact lower-cased email; "
    + "otherwise an active listed row with a matching or unset google_sub",
    plan({}) === "bootstrap" && plan({ activeOwnerExists: true }) === "refuse" && plan({ bootstrapOwnerEmail: null }) === "refuse"
      && plan({ bootstrapOwnerEmail: "other" }) === "refuse"
      && plan({ user: { id: "1", email: "e", google_sub: null, display_name: null, role: "viewer", status: "active" } }) === "existing"
      && plan({ user: { id: "1", email: "e", google_sub: "x", display_name: null, role: "viewer", status: "active" } }) === "refuse");
}

await issuer.stop();

// --- SA64: nothing captured holds a secret -------------------------------------------------------------
for (const value of issuer.secrets) secrets.add(value);
const output = captured.join("\n");
const emailLike = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const leaked = [...secrets].filter((value) => value.length >= 8 && output.includes(value));
check("SA64. across the whole suite, nothing the app logged and nothing this process or the entry point printed holds "
  + "a secret, code, state, nonce, verifier, cookie, CSRF token, ID token, email address or the client secret",
  secrets.size > 40 && leaked.length === 0 && !emailLike.test(output) && output.includes("auth.sign_in.refused")
    && output.includes("[studio-web] auth.sign_in "),
  `${leaked.length} leaked`);

console.log(failures === 0 ? `\n[studio-web] ALL PASS (${total} checks)` : `\n[studio-web] ${failures} FAILURE(S) of ${total}`);
process.exit(failures === 0 ? 0 : 1);
