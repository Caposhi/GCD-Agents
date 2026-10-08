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
import { readdirSync, readFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FORBIDDEN_PREFIXES, FORBIDDEN_VARIABLES, microsToNumeric, numericToMicros, parseCapMicros, preflightParamsSha256,
} from "../db/runner.js";
import {
  codePoints, decideConfirm, GOAL_MAX_CHARS, localDay, monthOf, offeredTags, PACK_RECORD_CAP, PLATFORMS, preflightPurgeable,
  preflightRequest, scopeUpperBound, type ConfirmSnapshot,
} from "./actions.js";
import { PREFLIGHT_POLL_SECONDS } from "./actionViews.js";
import {
  CONTENT_SECURITY_POLICY, createStudioWebApp, SECURITY_HEADERS, STUDIO_ROUTE_TABLE, type Route, type StudioWebApp, type WebLog,
} from "./app.js";
import {
  checkAudienceParty, CLOCK_SKEW_SECONDS, GOOGLE_OIDC, ID_TOKEN_ALGORITHMS, JWKS_TIMEOUT_MS, OIDC_SCOPE, pkceChallenge, TOKEN_EXCHANGE_TIMEOUT_MS,
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
import {
  FakeIssuer, MemoryWebStore, STUDIO_DOMAIN, SYNTHETIC_BOOKING_URL, SYNTHETIC_PHONE, SYNTHETIC_SHOP, syntheticEmail,
  syntheticRunArtifacts, type TokenPlan,
} from "./testSupport.js";
import { providerTextWithContact, type ContactLine } from "../../harness/agents/providerText.js";
import { attachmentDisposition, DOWNLOAD_CSP, verifiedBytes } from "./downloads.js";
import { escapeHtml } from "./html.js";
import {
  MAX_DISPLAY_ARTIFACT_BYTES, needsDecision, parseRunFilters, POLL_SECONDS, readCaptions, readScript, readShotList, RUN_KINDS,
  RUN_STATES, type FindingRow, type RunRow,
} from "./runs.js";
import { STATIC_ASSETS } from "./static.js";
import { capBoundMicros, decideUserChange, losesOwnSeat, normalizeNewUserEmail, parseAuditFilters, parseCapInput, parseRole } from "./users.js";
import { SCHEDULED_RUNS_UNAVAILABLE, usersBody } from "./userViews.js";
import { dollars } from "./actionViews.js";
import {
  BUNDLE_TOO_LARGE, decideLineage, decodeFactUpload, decodeRunBundle, documentField, encodeRunBundle, FACT_UPLOAD_MAX_DOCUMENT_BYTES,
  FACT_UPLOAD_MAX_FORM_BYTES, IMPORT_MAX_DOCUMENT_BYTES, IMPORT_MAX_FILES, importRunner, RUN_BUNDLE_SCHEMA,
} from "./bundle.js";
import { sourceActions } from "./actions.js";
import { downloadHeaders } from "./downloads.js";
import { FACT_UPLOAD_MAX_BYTES, STUDIO_IMPORT_FILE_NAMES } from "../db/runner.js";
import {
  CANNOT_DISPLAY, COPY_BANNER, FINGERPRINT_SHORT_CHARS, GOAL_PREVIEW_CHARS, GROUP_ORDERS, REQUIREMENT_UNVERIFIED,
} from "./views.js";

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

/** The deployment ceilings O4 sets (design §3.2): $75 a day, $300 a month. */
const CEILINGS = { dailyMicros: 75_000_000, monthlyMicros: 300_000_000 };
const CONFIG = (bootstrapOwnerEmail: string | null = null, ceilings = CEILINGS): WebConfig => ({
  publicOrigin: ORIGIN, allowedHd: STUDIO_ALLOWED_HD, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, bootstrapOwnerEmail, ceilings,
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

interface Reply { status: number; headers: Headers; body: string; raw: Buffer; setCookies: string[]; location: string | null }

/** Every HTML page any request in this suite received (S5: none may hold an inline script or style). */
const htmlPages: Array<{ path: string; status: number; body: string }> = [];

async function request(w: World, path: string, init: { method?: string; jar?: Jar; headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.jar && init.jar.values.size) headers.cookie = init.jar.header();
  const response = await fetch(`${w.base}${path}`, { method: init.method ?? "GET", headers, body: init.body, redirect: "manual" });
  const setCookies = response.headers.getSetCookie();
  init.jar?.take(setCookies);
  const raw = Buffer.from(await response.arrayBuffer());
  const body = raw.toString("utf8");
  if ((response.headers.get("content-type") ?? "").startsWith("text/html")) htmlPages.push({ path, status: response.status, body });
  return { status: response.status, headers: response.headers, body, raw, setCookies, location: response.headers.get("location") };
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
  port: "10000", commit: COMMIT, maxDailyUsd: "75", maxMonthlyUsd: "300", ...extra,
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
  const files = ["0001_studio_identity_and_tripwire.sql", "0002_studio_schema.sql", "0003_studio_preflight_requests.sql",
    "0004_studio_fact_checks_and_imports.sql"]
    .map((name) => ({ name, sha256: createHash("sha256").update(name).digest("hex") }));
  const ledger = files.map(({ name, sha256 }) => ({ name, sha256 }));
  const probe = (extra: Record<string, unknown> = {}) => ({
    currentDatabase: "gcd_studio", liveTables: [], migrationsTable: "tripwire" as const, studioTables: ["studio_database_identity"],
    identityRows: [{ database_name: "gcd_studio", marker: "gcd-studio:database-identity:v1" }], ledger, ...extra,
  });
  check("SA7. (e) the web makes the worker's database check: it refuses another database name, a live table, a live "
    + "ledger, a missing identity row or nothing migrated, and any schema version but 0004_studio_fact_checks_and_imports.sql "
    + "(a 0002-only and a 0003-only ledger among them)",
    refusalOf(() => decideWebIdentity(probe() as never)) === "accepted"
      && refusalOf(() => decideWebIdentity(probe({ currentDatabase: "gcd_social" }) as never)) === "wrong-database"
      && refusalOf(() => decideWebIdentity(probe({ liveTables: ["public.approval_queue"] }) as never)) === "live-schema"
      && refusalOf(() => decideWebIdentity(probe({ migrationsTable: "live" }) as never)) === "live-ledger"
      && refusalOf(() => decideWebIdentity(probe({ identityRows: [] }) as never)) === "identity-mismatch"
      && refusalOf(() => decideWebIdentity(probe({ ledger: null, identityRows: null, studioTables: [], migrationsTable: "absent" }) as never))
        === "not-migrated"
      && refusalOf(() => decideWebSchemaVersion(ledger, files)) === "accepted"
      && decideWebSchemaVersion(ledger, files) === "0004_studio_fact_checks_and_imports.sql"
      && refusalOf(() => decideWebSchemaVersion(ledger.slice(0, 1), files)) === "schema-version"
      && refusalOf(() => decideWebSchemaVersion(ledger.slice(0, 2), files)) === "schema-version"
      && refusalOf(() => decideWebSchemaVersion(ledger.slice(0, 3), files)) === "schema-version"
      && refusalOf(() => decideWebSchemaVersion(ledger.slice(0, 2), files.slice(0, 2))) === "schema-version"
      && refusalOf(() => decideWebSchemaVersion(null, files)) === "schema-version"
      && refusalOf(() => decideWebSchemaVersion([ledger[0]!, { ...ledger[1]!, sha256: "0".repeat(64) }, ledger[2]!, ledger[3]!], files))
        === "migration-changed"
      && refusalOf(() => decideWebSchemaVersion([ledger[0]!, ledger[1]!, { ...ledger[2]!, sha256: "0".repeat(64) }, ledger[3]!], files))
        === "migration-changed"
      && refusalOf(() => decideWebSchemaVersion([ledger[0]!, ledger[1]!, ledger[2]!, { ...ledger[3]!, sha256: "0".repeat(64) }], files))
        === "migration-changed");

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
    + "secret, STUDIO_BOOTSTRAP_OWNER_EMAIL, PORT, RENDER_GIT_COMMIT and (S6.2) the two deployment ceilings "
    + "STUDIO_MAX_DAILY_USD and STUDIO_MAX_MONTHLY_USD, in the dot form, plus the names for the scan; it "
    + "decides before the server module loads (its static imports reach only startup.js and the S2 runner); and the "
    + "only app it builds is given store, config, commit and log — never an issuer, routes or a clock",
    [...mainSource.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]).sort().join() === ["PORT", "RENDER_GIT_COMMIT",
      "STUDIO_ALLOWED_HD", "STUDIO_BOOTSTRAP_OWNER_EMAIL", "STUDIO_DATABASE_URL", "STUDIO_GOOGLE_CLIENT_ID",
      "STUDIO_GOOGLE_CLIENT_SECRET", "STUDIO_MAX_DAILY_USD", "STUDIO_MAX_MONTHLY_USD", "STUDIO_PUBLIC_ORIGIN"].join()
      && (mainSource.match(/process\.env\b(?!\.)/g) ?? []).length === 1 && mainSource.includes("names: Object.keys(process.env),")
      && !/process\.env\[|ANTHROPIC/.test(mainSource)
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
      && health.schema_version === "0004_studio_fact_checks_and_imports.sql" && health.worker_heartbeat_age_seconds === 42
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
        "GET /auth/login public", "GET /auth/callback public", "POST /auth/logout viewer",
        // Content Studio S5's read-only routes: every one a GET, every one viewer.
        "GET /runs viewer", "GET /runs/:id viewer", "GET /runs/:id/files/:name viewer", "GET /static/studio.css viewer",
        "GET /static/studio.js viewer",
        // Content Studio S6.2's actions: every POST runner or owner; the screens runner, and the spend panel viewer.
        "GET /new runner", "POST /new/price runner", "POST /new/fake owner", "POST /runs/:id/price runner",
        "POST /runs/:id/cancel runner", "GET /preflights/:id runner", "POST /quotes/:id/confirm runner", "GET /spend viewer",
        "POST /spend/overruns/:id/acknowledge owner",
        // Content Studio S7.2: the versions list and the whole-run bundle viewer; every fact and import edit owner.
        "GET /facts viewer", "GET /facts/upload owner", "POST /facts/upload owner", "GET /facts/checks/:id owner",
        "POST /facts/versions/:id/activate owner", "POST /facts/versions/:id/retire owner", "POST /facts/versions/:id/restore owner",
        "GET /facts/versions/:id/file owner", "GET /imports/new owner", "POST /imports owner", "GET /runs/:id/bundle viewer",
        // Content Studio S7.3 (by fact; until S7.3 the list ended at the bundle): the users, caps and audit screens, every one owner.
        "GET /users owner", "POST /users owner", "POST /users/:id/role owner", "POST /users/:id/cap owner",
        "POST /users/:id/disable owner", "POST /users/:id/enable owner", "POST /users/:id/revoke-sessions owner",
        "GET /settings owner", "POST /settings/caps owner", "GET /audit owner"].join()
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

// =====================================================================================================
// S5. The read-only screens (design §8, §8.1, §8.2, §9.1): routes, roles, the list, the report, the Copy
// text, findings, downloads, static files, hostile content and the phone layout's static half
// =====================================================================================================

const HOSTILE = "<script>alert(1)</script>\"'><img src=x onerror=alert(2)><a href=\"javascript:alert(3)\">x</a></textarea> &amp;";
const decodeAttribute = (value: string) =>
  value.replace(/&(amp|lt|gt|quot|#39|#13);/g, (_m, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#13": "\r" })[e]!);
/** Every `data-copy` value on a page, decoded as an HTML parser decodes our escapes. */
const copyValues = (html: string) => [...html.matchAll(/data-copy-kind="(full|caption)" data-copy="([^"]*)"/g)]
  .map((m) => ({ kind: m[1]!, text: decodeAttribute(m[2]!) }));
const S5_ROUTES = (runId: string, name: string) =>
  ["/runs", `/runs/${runId}`, `/runs/${runId}/files/${name}`, STATIC_ASSETS.css.path, STATIC_ASSETS.js.path];

/** A world with a signed-in viewer and one finished fake run holding every displayed artifact. */
async function s5World(options: { mark?: string; displayName?: string; run?: Parameters<MemoryWebStore["addRun"]>[1] } = {}) {
  const w = await world();
  const viewer = listed(w, "viewer", { display_name: options.displayName ?? "Synthetic viewer" });
  const jar = new Jar();
  await signIn(w, jar, { identity: identityOf(viewer) });
  const run = w.store.addRun(w.owner, { goal: `${options.mark ?? ""}[goal]`, platforms: ["instagram", "facebook", "google_business_profile"],
    ...options.run });
  const files = syntheticRunArtifacts(options.mark ?? "");
  for (const [name, text] of Object.entries(files)) w.store.addArtifact(run.id, name, text);
  return { w, viewer, jar, run, files };
}

{
  const { w, jar, run } = await s5World();
  const name = "summary.md";
  const callsBefore = w.store.calls.length;
  const signedOut = await Promise.all(S5_ROUTES(run.id, name).map((path) => request(w, path)));
  const signedOutCalls = w.store.calls.slice(callsBefore);
  const asViewer = await Promise.all(S5_ROUTES(run.id, name).map((path) => request(w, path, { jar })));
  const disabled = listed(w, "viewer");
  const disabledJar = new Jar();
  await signIn(w, disabledJar, { identity: identityOf(disabled) });
  const before = (await request(w, "/runs", { jar: disabledJar })).status;
  w.store.setStatus(disabled.id, "disabled");
  const afterDisable = await Promise.all(S5_ROUTES(run.id, name).map((path) => request(w, path, { jar: disabledJar })));
  check("SA67. every S5 route is a GET declared viewer in the one route table — /runs, /runs/:id, /runs/:id/files/:name, "
    + "/static/studio.css and /static/studio.js — and none accepts a POST",
    STUDIO_ROUTE_TABLE.slice(5, 10).map((r) => `${r.method} ${r.path} ${r.minRole}`).join() === ["GET /runs viewer",
      "GET /runs/:id viewer", "GET /runs/:id/files/:name viewer", "GET /static/studio.css viewer", "GET /static/studio.js viewer"].join()
      && (await request(w, `/runs/${run.id}`, { method: "POST", jar, headers: { origin: ORIGIN } })).status === 405);
  check("SA68. signed out, every S5 route is 401, with nothing read from the runs store",
    signedOut.every((r) => r.status === 401)
      && !signedOutCalls.some((c) => ["listRuns", "findRun", "readArtifact"].includes(c)),
    `${signedOut.map((r) => r.status).join()} ${signedOutCalls.join()}`);
  check("SA69. a signed-in viewer gets 200 on every S5 route",
    asViewer.every((r) => r.status === 200), asViewer.map((r) => r.status).join());
  check("SA70. a disabled user is refused on every S5 route (their session is revoked, so 401), though allowed before",
    before === 200 && afterDisable.every((r) => r.status === 401), `${before} then ${afterDisable.map((r) => r.status).join()}`);
  await w.close();
}

{
  const { w, jar, run } = await s5World();
  const deleted = w.store.addRun(w.owner, { deleted_at: new Date(w.clock.now) });
  w.store.addArtifact(deleted.id, "summary.md", "deleted run's summary");
  const paths = [`/runs/${deleted.id}`, `/runs/${deleted.id}/files/summary.md`, "/runs/not-a-uuid", `/runs/${run.id.toUpperCase()}`,
    `/runs/${randomUUIDv4()}`, `/runs/${run.id}/files/no-such-file.json`, `/runs/${run.id}/files/..%2Frun-meta.json`,
    `/runs/${run.id}/files/.hidden`, "/runs/", `/runs/${run.id}/files/`, `/runs/${run.id}/`];
  const replies = await Promise.all(paths.map((path) => request(w, path, { jar })));
  const list = await request(w, "/runs", { jar });
  check("SA71. a deleted run is 404 (its report and its files) and absent from the list; so are a non-UUID id, an "
    + "upper-case id, an unknown run, an unknown artifact, a name outside the schema's shape and an empty segment",
    replies.every((r) => r.status === 404) && !list.body.includes(deleted.id) && list.body.includes(run.id),
    replies.map((r) => r.status).join());
  await w.close();
}

function randomUUIDv4(): string {
  return crypto.randomUUID();
}

{
  const w = await world();
  const viewer = listed(w, "viewer");
  const jar = new Jar();
  await signIn(w, jar, { identity: identityOf(viewer) });
  const ids: string[] = [];
  for (let i = 0; i < 120; i += 1) {
    ids.push(w.store.addRun(w.owner, { created_at: new Date(Date.UTC(2026, 8, 1) + i * 60_000), goal: `goal ${String(i).padStart(3, "0")}` }).id);
  }
  const pages = [await request(w, "/runs", { jar }), await request(w, "/runs?page=2", { jar }), await request(w, "/runs?page=3", { jar })];
  const shownIds = (html: string) => [...html.matchAll(/<li class="run"><p class="run-goal"><a href="\/runs\/([0-9a-f-]{36})">/g)].map((m) => m[1]!);
  const p1 = shownIds(pages[0]!.body);
  const p2 = shownIds(pages[1]!.body);
  const p3 = shownIds(pages[2]!.body);
  const newestFirst = [...ids].reverse();
  check("SA72. the runs list is newest first in bounded pages of at most 50: 120 runs are 50, 50 and 20, each page asks the "
    + "store for at most 51 rows, and the pager links an older page only when one exists",
    p1.length === 50 && p2.length === 50 && p3.length === 20
      && JSON.stringify([...p1, ...p2, ...p3]) === JSON.stringify(newestFirst)
      && w.store.runQueries.every((q) => q.limit <= 51) && w.store.runQueries.map((q) => q.offset).join() === "0,50,100"
      && pages[0]!.body.includes('href="/runs?page=2"') && !pages[2]!.body.includes("page=4") && pages[2]!.body.includes("Newer"),
    `${p1.length},${p2.length},${p3.length}`);
  await w.close();
}

{
  const { w, jar, viewer } = await s5World();
  const queriesBefore = w.store.runQueries.length;
  const bad = ["state=done", "state=queued&state=running", "kind=everything", "kind=FULL", "requester=not-a-uuid",
    `requester=${viewer.id.toUpperCase()}`, "page=0", "page=-1", "page=1.5", "page=01", "page=99999",
    "state=queued'%20OR%201%3D1%20--", "kind=full%3B%20DROP%20TABLE%20studio_runs", `requester=${viewer.id}'--`,
    "state=%00", "page=1e3"];
  const refused = await Promise.all(bad.map((q) => request(w, `/runs?${q}`, { jar })));
  const refusedQueries = w.store.runQueries.length - queriesBefore;
  const good = await request(w, `/runs?state=succeeded&kind=full&requester=${viewer.id}&page=1&utm=ignored`, { jar });
  const passed = w.store.runQueries.at(-1)!;
  check("SA73. every list filter is validated before any query: an unknown state or kind, a repeated filter, a requester "
    + "that is not a UUID, a page that is not 1..10000, and SQL metacharacters are each 400 with no query made; valid "
    + "filters reach the store exactly as the schema's values",
    refused.every((r) => r.status === 400) && refusedQueries === 0 && good.status === 200
      && JSON.stringify(passed.filters) === JSON.stringify({ state: "succeeded", kind: "full", requester: viewer.id })
      && parseRunFilters(new URLSearchParams("state=")).ok
      && JSON.stringify(RUN_STATES) === JSON.stringify(["queued", "running", "succeeded", "failed", "refused", "cancelled", "interrupted"])
      && JSON.stringify(RUN_KINDS) === JSON.stringify(["full", "revise", "replay_critic", "resume_packaging", "imported"]),
    refused.map((r) => r.status).join());
  await w.close();
}

{
  const { w, jar, run } = await s5World();
  const live = w.store.addRun(w.owner, { runner: "live", goal: "live goal", reserved_usd: "21.650000", actual_usd: "1.250000" });
  const imported = w.store.addRun(w.owner, { kind: "imported", runner: "live", import_tier: "archived_unverified", goal: "imported goal" });
  const verified = w.store.addRun(w.owner, { kind: "imported", runner: "live", import_tier: "verified", goal: "verified import" });
  const list = await request(w, "/runs", { jar });
  const row = (id: string) => list.body.slice(list.body.indexOf(`/runs/${id}"`), list.body.indexOf("</li>", list.body.indexOf(`/runs/${id}"`)));
  const fakeReport = await request(w, `/runs/${run.id}`, { jar });
  const liveReport = await request(w, `/runs/${live.id}`, { jar });
  const importReport = await request(w, `/runs/${imported.id}`, { jar });
  check("SA74. a fake run carries the FAKE badge in the list and on its report; an archived_unverified import carries "
    + "\"not revalidated\"; a live run and a verified import carry neither",
    row(run.id).includes('class="badge badge-fake">FAKE<') && fakeReport.body.includes('class="badge badge-fake">FAKE<')
      && !row(live.id).includes("FAKE") && !liveReport.body.includes("FAKE")
      && row(imported.id).includes(">not revalidated<") && importReport.body.includes(">not revalidated<")
      && !row(verified.id).includes("not revalidated") && !row(live.id).includes("not revalidated"));
  await w.close();
}

{
  const { w, jar, run } = await s5World();
  const settled = await request(w, "/runs", { jar });
  const settledReport = await request(w, `/runs/${run.id}`, { jar });
  const queued = w.store.addRun(w.owner, { state: "queued", started_at: null, finished_at: null, verdict: null });
  const polling = await request(w, "/runs", { jar });
  const queuedReport = await request(w, `/runs/${queued.id}`, { jar });
  const running = w.store.addRun(w.owner, { state: "running", finished_at: null, verdict: null });
  const runningReport = await request(w, `/runs/${running.id}`, { jar });
  const refresh = `<meta http-equiv="refresh" content="${POLL_SECONDS}">`;
  check("SA75. polling: a <meta http-equiv=\"refresh\"> appears only while a queued or running run is shown — on the "
    + "list and on that run's report — and never on a settled list or report",
    !settled.body.includes("http-equiv") && !settledReport.body.includes("http-equiv") && polling.body.includes(refresh)
      && queuedReport.body.includes(refresh) && runningReport.body.includes(refresh) && POLL_SECONDS === 15);
  await w.close();
}

{
  const { w, jar, run } = await s5World({ run: { source_run_id: null } });
  const child = w.store.addRun(w.owner, { kind: "revise", source_run_id: run.id });
  const tombstoned = w.store.addRun(w.owner, { deleted_at: new Date(w.clock.now) });
  const orphan = w.store.addRun(w.owner, { kind: "replay_critic", source_run_id: tombstoned.id });
  run.approved_facts_sha256 = "a".repeat(64);
  w.store.runs.get(run.id)!.approved_facts_sha256 = "a".repeat(64);
  w.store.runs.get(run.id)!.code_commit = "c".repeat(40);
  const report = await request(w, `/runs/${run.id}`, { jar });
  const childReport = await request(w, `/runs/${child.id}`, { jar });
  const orphanReport = await request(w, `/runs/${orphan.id}`, { jar });
  const at = (needle: string) => report.body.indexOf(needle);
  const order = ['<h1 class="goal', 'class="captions"', 'class="script"', 'class="shots"', 'class="findings"', 'class="decisions',
    'class="cost"', 'class="files"'].map(at);
  check("SA76. the report is in the design's order: header, captions, script, shot list, findings, \"Needs your "
    + "decision\", cost, files",
    report.status === 200 && order.every((i) => i >= 0) && order.every((i, n) => n === 0 || i > order[n - 1]!), order.join());
  check("SA77. fingerprints and the commit are shown short (12 characters), with the full value in a <details> to tap open",
    report.body.includes(`<details class="fp"><summary><code>${"a".repeat(12)}…</code></summary><code class="fp-full">${"a".repeat(64)}</code></details>`)
      && report.body.includes(`<code>${"c".repeat(12)}…</code>`) && FINGERPRINT_SHORT_CHARS === 12);
  check("SA78. lineage: a report links the run it read and the runs that read it; a tombstoned source shows as \"a deleted run\", "
    + "never as a link",
    report.body.includes(`href="/runs/${child.id}"`) && childReport.body.includes(`href="/runs/${run.id}"`)
      && orphanReport.body.includes("a deleted run") && !orphanReport.body.includes(`href="/runs/${tombstoned.id}"`),
    `${report.body.includes(`href="/runs/${child.id}"`)} ${childReport.body.includes(`href="/runs/${run.id}"`)} ${orphanReport.body.includes("a deleted run")} ${!orphanReport.body.includes(`href="/runs/${tombstoned.id}"`)}`);
  await w.close();
}

{
  const { w, jar } = await s5World();
  const failed = w.store.addRun(w.owner, { state: "failed", verdict: null, failure_class: "stage_execution_error",
    failure_message: `${HOSTILE}[failure]` });
  for (const name of ["run-meta.json", "01-strategy-concept.json", "02-automotive-truth.json", "03-hook-story-script.json",
    "04-production-direction.json"]) w.store.addArtifact(failed.id, name, "{}");
  const refused = w.store.addRun(w.owner, { state: "refused", verdict: null, failure_class: "live_runs_not_enabled",
    failure_message: "live runs are not enabled in this worker" });
  const liveFailed = w.store.addRun(w.owner, { runner: "live", state: "failed", failure_class: "job_timeout", failure_message: "timed out",
    reserved_usd: "21.650000", actual_usd: "3.000000" });
  w.store.requests.set(liveFailed.id, [
    { seq: 1, stage: "strategy-concept", lens: null, model: "model-a", ceiling_usd: "1.000000", input_tokens: 10, output_tokens: 20,
      cost_usd: "0.010000", charged_usd: "0.010000", outcome: "succeeded" },
    { seq: 2, stage: "final-critic", lens: "voice-and-craft", model: "model-b", ceiling_usd: "2.000000", input_tokens: null,
      output_tokens: null, cost_usd: null, charged_usd: "2.000000", outcome: "failed" },
  ]);
  const f = await request(w, `/runs/${failed.id}`, { jar });
  const r = await request(w, `/runs/${refused.id}`, { jar });
  const l = await request(w, `/runs/${liveFailed.id}`, { jar });
  const forms = [f, r, l].flatMap((p) => [...p.body.matchAll(/<form\b[^>]*>/g)].map((m) => m[0]));
  const buttons = [f, r, l].flatMap((p) => [...p.body.matchAll(/<button\b[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]!));
  check("SA79. a failed or refused run shows its failure class, its message (escaped) and the stage it stopped at — the "
    + "first stage file it did not save, or its last request that did not succeed — with no Resume button and no form "
    + "but sign-out",
    f.body.includes("<code>stage_execution_error</code>") && f.body.includes(escapeHtml(`${HOSTILE}[failure]`))
      && !f.body.includes(`${HOSTILE}[failure]`) && /Stopped at<\/dt><dd>packaging-adaptation</.test(f.body)
      && r.body.includes("<code>live_runs_not_enabled</code>") && /Stopped at<\/dt><dd>strategy-concept</.test(r.body)
      && /Stopped at<\/dt><dd>final-critic \(voice-and-craft\)</.test(l.body)
      && ![f, r, l].some((p) => /\bResume\b/.test(p.body))
      && buttons.every((b) => ["Sign out", "Copy", "Copy caption only", "Copy caption"].includes(b))
      && forms.length === 3 && forms.every((form) => form === '<form method="post" action="/auth/logout">'),
    buttons.join("|"));
  check("SA80. cost: the report shows the reserved ceiling, the actual cost and one row per request from "
    + "studio_run_requests — stage or lens, model, tokens, cost, charge and outcome; a fake run says it made no request",
    l.body.includes("<dt>Reserved ceiling</dt><dd>$21.650000</dd>") && l.body.includes("<dt>Actual cost</dt><dd>$3.000000</dd>")
      && l.body.includes("<td>1</td><td>strategy-concept</td><td>model-a</td><td>10</td><td>20</td><td>$0.010000</td><td>$0.010000</td><td>succeeded</td>")
      && l.body.includes("<td>2</td><td>final-critic: voice-and-craft</td><td>model-b</td><td>—</td><td>—</td><td>—</td><td>$2.000000</td><td>failed</td>")
      && f.body.includes("A fake run makes no provider request."));
  await w.close();
}

{
  const { w, jar, run, files } = await s5World();
  const report = await request(w, `/runs/${run.id}`, { jar });
  const copies = copyValues(report.body);
  const pkgs = (JSON.parse(files["05-packaging-adaptation.json"]!) as { output: { provisional: { packages: Array<{ platform: string;
    caption: string; hashtags: string[] }> } } }).output.provisional.packages;
  const contacts = (JSON.parse(files["05b-contact-lines.json"]!) as { packages: Array<{ contact: ContactLine }> }).packages;
  const expected = pkgs.map((p, i) => (p.platform === "google_business_profile" ? p.caption : providerTextWithContact(p.caption, p.hashtags, contacts[i]!.contact)));
  const full = copies.filter((c) => c.kind === "full").map((c) => c.text);
  const captionOnly = copies.filter((c) => c.kind === "caption").map((c) => c.text);
  check("SA81. Copy for Instagram and Facebook is byte for byte providerTextWithContact(caption, hashtags, contact) — the "
    + "leaf module's function — over the stored 05 and 05b files, carriage returns and line breaks included",
    full.length === 2 && full[0] === expected[0] && full[1] === expected[1] && full.every((t) => t.includes("\r\n"))
      && full[1]!.endsWith(`Call ${SYNTHETIC_SHOP}: ${SYNTHETIC_PHONE} · Book online: ${SYNTHETIC_BOOKING_URL}`)
      && report.body.includes("&#13;"),
    JSON.stringify(full));
  check("SA82. Google Business Profile copies its caption alone, with its BOOK call to action shown as a separate item; a "
    + "second button on every other card copies the caption alone",
    captionOnly.length === 3 && captionOnly[0] === pkgs[0]!.caption && captionOnly[1] === pkgs[1]!.caption
      && captionOnly[2] === pkgs[2]!.caption && expected[2] === pkgs[2]!.caption
      && /Call to action: <strong>BOOK<\/strong> → <span class="prose">https:\/\/booking\.invalid\/synthetic\?\[cta\]<\/span>/.test(report.body)
      && (report.body.match(/data-copy-kind="caption"/g) ?? []).length === 3);
  check("SA83. the captions carry the banner: the contact line is copied from approved facts, not written by a model, and "
    + "nothing here is approved or scheduled",
    report.body.includes(`<p class="banner">${escapeHtml(COPY_BANNER)}</p>`) && /approved facts, not written by a model/.test(COPY_BANNER)
      && /approved, scheduled/.test(COPY_BANNER));
  const imported = w.store.addRun(w.owner, { kind: "imported", runner: "live", import_tier: "archived_unverified" });
  for (const [name, text] of Object.entries(files)) w.store.addArtifact(imported.id, name, text);
  const archived = await request(w, `/runs/${imported.id}`, { jar });
  const buttons = [...archived.body.matchAll(/<button type="button" class="copy"[^>]*>/g)].map((m) => m[0]);
  check("SA84. on an archived_unverified import every Copy button is disabled and carries no text to copy",
    buttons.length === 5 && buttons.every((b) => b.endsWith(" disabled>") && !b.includes("data-copy="))
      && copyValues(archived.body).length === 0 && archived.body.includes("Copy is disabled"),
    buttons.join(" "));
  await w.close();
}

{
  const { w, jar, run } = await s5World();
  const row = (idx: number, lens: string, severity: string, category: string, owner: string, ownerItem: boolean): FindingRow =>
    ({ idx, lens, severity, category, owner, issue: `issue-${idx}`, owner_item: ownerItem });
  w.store.findings.set(run.id, [
    row(0, "evidence-fidelity", "advisory", "claim_fidelity", "packaging-adaptation", false),
    row(1, "evidence-fidelity", "blocking", "human_decision", "packaging-adaptation", true),
    row(2, "platform-and-local", "blocking", "platform_semantics", "hook-story-script", false),
    row(3, "voice-and-craft", "advisory", "voice_clarity", "human_review", true),
    row(4, "production-coherence", "blocking", "production_coherence", "production-direction", false),
    row(5, "voice-and-craft", "blocking", "voice_clarity", "packaging-adaptation", false),
  ]);
  w.store.runs.get(run.id)!.blocking_findings = 4;
  w.store.runs.get(run.id)!.advisory_findings = 2;
  const byOwner = await request(w, `/runs/${run.id}`, { jar });
  const byLens = await request(w, `/runs/${run.id}?group=lens`, { jar });
  const badGroup = await request(w, `/runs/${run.id}?group=severity`, { jar });
  const issues = (html: string, section: string) => {
    const start = html.indexOf(`class="${section}`);
    const body = html.slice(start, html.indexOf("</section>", start));
    return [...body.matchAll(/issue-(\d)/g)].map((m) => m[1]).join("");
  };
  const headings = (html: string) => {
    const start = html.indexOf('class="findings"');
    return [...html.slice(start, html.indexOf("</section>", start)).matchAll(/<h3>([^<]*)<\/h3>/g)].map((m) => m[1]).join("|");
  };
  check("SA85. findings are grouped by stage owner (stages 3, 4, 5, then a person), blocking first, then advisory; "
    + "?group=lens groups them by lens in panel order with no script; any other grouping is 400",
    issues(byOwner.body, "findings") === "241503" && headings(byOwner.body)
      === "Stage owner: hook-story-script|Stage owner: production-direction|Stage owner: packaging-adaptation|A person (human_review)"
      && issues(byLens.body, "findings") === "102534" && byLens.body.includes(`href="/runs/${run.id}#findings">Group by stage owner`)
      && byOwner.body.includes(`href="/runs/${run.id}?group=lens#findings">Group by lens`) && badGroup.status === 400
      && JSON.stringify(GROUP_ORDERS.lens) === JSON.stringify(["evidence-fidelity", "platform-and-local", "voice-and-craft", "production-coherence"]),
    `${issues(byOwner.body, "findings")} ${issues(byLens.body, "findings")} ${headings(byOwner.body)}`);
  const noDecision = w.store.addRun(w.owner, {});
  w.store.findings.set(noDecision.id, [row(0, "voice-and-craft", "advisory", "voice_clarity", "packaging-adaptation", false)]);
  const quiet = await request(w, `/runs/${noDecision.id}`, { jar });
  check("SA86. \"Needs your decision\" lists exactly the rows whose owner_item is true — a human_decision finding owned by "
    + "a stage as well as a human_review one — and is marked to come first on a phone only when it holds any",
    issues(byOwner.body, "decisions") === "13" && byOwner.body.includes('class="decisions decisions-open"')
      && needsDecision([row(0, "x", "blocking", "human_decision", "packaging-adaptation", true),
        row(1, "x", "blocking", "c", "human_review", false), row(2, "x", "blocking", "c", "s", true)]).map((f) => f.idx).join() === "0,2"
      && quiet.body.includes('<section class="decisions"><h2>Needs your decision</h2><p>Nothing needs your decision.</p>')
      && /@media \(max-width:699\.98px\)\{.*\.decisions-open\{order:-1\}\s*\}\s*$/s.test(STATIC_ASSETS.css.body.toString("utf8")),
    issues(byOwner.body, "decisions"));
  await w.close();
}

{
  const { w, jar, run } = await s5World();
  const report = await request(w, `/runs/${run.id}`, { jar });
  const shapes: Array<[string, Buffer | undefined]> = [
    ["absent", undefined], ["not json", Buffer.from("{not json")], ["null", Buffer.from("null")], ["array", Buffer.from("[1,2]")],
    ["no output", Buffer.from('{"metadata":{}}')], ["wrong types", Buffer.from('{"output":{"provisional":{"hook":1,"storyBeats":"x","script":[]}}}')],
    ["too large", Buffer.alloc(MAX_DISPLAY_ARTIFACT_BYTES + 1, 32)], ["deep", Buffer.from(`${"[".repeat(5000)}${"]".repeat(5000)}`)],
    ["verified requirement", Buffer.from(JSON.stringify({ output: { provisional: { visualApproach: "v", shots: [], overlayText: [],
      productionRequirements: [{ requirement: "r", category: "c", availabilityVerified: true }] } } }))],
  ];
  let threw = false;
  const results = shapes.map(([label, bytes]) => {
    try {
      return [label, readScript(bytes), readShotList(bytes), readCaptions(bytes, bytes)] as const;
    } catch {
      threw = true;
      return [label] as const;
    }
  });
  const broken = w.store.addRun(w.owner, {});
  w.store.addArtifact(broken.id, "03-hook-story-script.json", '{"output":{"provisional":{"hook":{"html":"<b>"}}}}');
  w.store.addArtifact(broken.id, "04-production-direction.json", "[]");
  w.store.addArtifact(broken.id, "05-packaging-adaptation.json", "{");
  w.store.addArtifact(broken.id, "05b-contact-lines.json", "{}");
  const brokenReport = await request(w, `/runs/${broken.id}`, { jar });
  check("SA87. the script and shot list are read from the stored stage JSON as untrusted data: shown in full when well "
    + "formed — hook, beats, script, shots, overlays, and each requirement \"to be confirmed by a person\" — and, for "
    + "any unexpected shape (absent, not JSON, null, an array, wrong types, over the size bound, a claimed-verified "
    + "requirement), \"cannot display; download the file\" or \"did not save\", never an exception",
    !threw && results.every((r) => r.length === 4 && !r[1].ok && !r[2].ok && !r[3].ok)
      && results.find((r) => r[0] === "absent")?.[1]?.ok === false
      && report.body.includes("[hook]") && report.body.includes("[beat-2]") && report.body.includes("[script]")
      && report.body.includes("[shot-1-action]") && report.body.includes("Overlay (headline): <span class=\"prose\">[overlay]</span>")
      && report.body.includes(`[requirement]</span> <span class="meta">location — ${REQUIREMENT_UNVERIFIED}</span>`)
      && REQUIREMENT_UNVERIFIED === "to be confirmed by a person"
      && brokenReport.status === 200 && (brokenReport.body.match(new RegExp(CANNOT_DISPLAY.replace(/[.;]/g, "\\$&"), "g")) ?? []).length === 3
      && CANNOT_DISPLAY === "Cannot display; download the file.");
  await w.close();
}

{
  const { w, jar, run, files } = await s5World();
  const json = await request(w, `/runs/${run.id}/files/05-packaging-adaptation.json`, { jar });
  const md = await request(w, `/runs/${run.id}/files/summary.md`, { jar });
  const exact = (r: Reply, name: string, type: string, bytes: Buffer) => r.status === 200
    && JSON.stringify([...r.headers.keys()].sort()) === JSON.stringify(["cache-control", "connection", "content-disposition",
      "content-length", "content-security-policy", "content-type", "date", "keep-alive", "referrer-policy",
      "strict-transport-security", "x-content-type-options"])
    && r.headers.get("content-type") === type && r.headers.get("content-disposition") === `attachment; filename="${name}"`
    && r.headers.get("x-content-type-options") === "nosniff" && r.headers.get("content-security-policy") === "default-src 'none'; sandbox"
    && r.headers.get("cache-control") === "no-store" && r.headers.get("content-length") === String(bytes.length) && r.raw.equals(bytes)
    && createHash("sha256").update(r.raw).digest("hex") === w.store.artifacts.get(run.id)!.get(name)!.sha256;
  check("SA88. a download is an attachment with exactly its own headers — Content-Disposition attachment, application/json "
    + "or text/plain, nosniff, the CSP default-src 'none'; sandbox, no-store — and the bytes exactly as stored, matching "
    + "the stored sha256",
    exact(json, "05-packaging-adaptation.json", "application/json", Buffer.from(files["05-packaging-adaptation.json"]!))
      && exact(md, "summary.md", "text/plain; charset=utf-8", Buffer.from(files["summary.md"]!)) && DOWNLOAD_CSP === "default-src 'none'; sandbox",
    `${json.status} ${[...json.headers].map(([k, v]) => `${k}=${v}`).join("; ")}`);
  w.store.addArtifact(run.id, "tampered.json", '{"ok":true}', Buffer.from('{"ok":false}'));
  w.store.addArtifact(run.id, "03-hook-story-script.json", files["03-hook-story-script.json"]!, Buffer.from(files["03-hook-story-script.json"]!.replace("[hook]", "[HOOK!]")));
  const tampered = await request(w, `/runs/${run.id}/files/tampered.json`, { jar });
  const tamperedReport = await request(w, `/runs/${run.id}`, { jar });
  check("SA89. an artifact whose stored bytes no longer match its sha256 (changed through a test-only path) is refused, "
    + "never served — and the report shows it as cannot display",
    tampered.status === 500 && !tampered.body.includes("false") && tampered.headers.get("content-disposition") === null
      && tampered.headers.get("content-type") === "text/html; charset=utf-8" && !tamperedReport.body.includes("[HOOK!]")
      && verifiedBytes({ name: "x", content: Buffer.from("a"), sha256: createHash("sha256").update("b").digest("hex"), byte_length: 1 }) === null,
    `${tampered.status}`);
  const hostileNames = ["a\r\nset-cookie: x=1", 'a".json', "a;b.json", "a b.json", "a\nb", "../run-meta.json", "", "é.json", `${"a".repeat(129)}`];
  const refusals = hostileNames.map((name) => refusalOf(() => attachmentDisposition(name)));
  const injected = await Promise.all(["a%0D%0Aset-cookie:%20x=1", "a%22.json", "a%3Bb.json", "a%20b.json"]
    .map((name) => request(w, `/runs/${run.id}/files/${name}`, { jar })));
  check("SA90. no header injection: a filename with CR, LF, a quote, a semicolon, a space, a path, a non-ASCII letter or "
    + "too many characters is refused before any header is written, and such a name in the URL is a 404",
    refusals.every((r) => r === "DownloadNameRefusal") && injected.every((r) => r.status === 404 && r.headers.get("set-cookie") === null)
      && attachmentDisposition("summary.md") === 'attachment; filename="summary.md"',
    refusals.join());
  await w.close();
}

{
  const { w, jar, run } = await s5World();
  const css = await request(w, STATIC_ASSETS.css.path, { jar });
  const js = await request(w, STATIC_ASSETS.js.path, { jar });
  const report = await request(w, `/runs/${run.id}`, { jar });
  const fileOk = (r: Reply, asset: (typeof STATIC_ASSETS)["css"], type: string) => r.status === 200 && asset.contentType === type
    && r.headers.get("content-type") === type && r.headers.get("x-content-type-options") === "nosniff"
    && r.headers.get("content-security-policy") === CONTENT_SECURITY_POLICY
    && r.headers.get("cache-control") === "private, max-age=31536000, immutable" && r.raw.equals(asset.body)
    && asset.href === `${asset.path}?v=${createHash("sha256").update(asset.body).digest("hex").slice(0, 16)}`;
  check("SA91. the static files are served from code with their own type (text/css, text/javascript), nosniff, S4's CSP "
    + "unchanged and a year's private cache; every page links them by their sha256, and the script copies only a "
    + "button's data-copy attribute",
    fileOk(css, STATIC_ASSETS.css, "text/css; charset=utf-8") && fileOk(js, STATIC_ASSETS.js, "text/javascript; charset=utf-8")
      && report.body.includes(`<link rel="stylesheet" href="${STATIC_ASSETS.css.href}">`)
      && report.body.includes(`<script src="${STATIC_ASSETS.js.href}" defer></script>`)
      && /navigator\.clipboard\.writeText\(text\)/.test(js.body) && /getAttribute\("data-copy"\)/.test(js.body)
      && !/innerHTML|eval\(|Function\(|fetch\(|XMLHttpRequest|document\.write/.test(js.body)
      && CONTENT_SECURITY_POLICY === "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  await w.close();
}

{
  const { w, jar, run, viewer } = await s5World({ mark: HOSTILE, displayName: `${HOSTILE}[display-name]` });
  w.store.findings.set(run.id, [{ idx: 0, lens: "voice-and-craft", severity: "blocking", category: "human_decision",
    owner: "human_review", issue: `${HOSTILE}[issue]`, owner_item: true }]);
  w.store.runs.get(run.id)!.state = "failed";
  w.store.runs.get(run.id)!.failure_class = "stage_execution_error";
  w.store.runs.get(run.id)!.failure_message = `${HOSTILE}[failure]`;
  w.store.runs.get(run.id)!.scope_tags = [`${HOSTILE}[scope]`];
  w.store.addArtifact(run.id, 'x"onmouseover="alert(4).json', "{}");
  w.store.addArtifact(run.id, "x<script>.json", "{}");
  const pages = [await request(w, `/runs/${run.id}`, { jar }), await request(w, "/runs", { jar }),
    await request(w, `/runs/${run.id}?group=lens`, { jar })];
  const inert = (html: string) => {
    const tags = [...html.matchAll(/<[a-zA-Z][^>]*>/g)].map((m) => m[0].replace(/"[^"]*"/g, '""'));
    return (html.match(/<script\b/g) ?? []).length === 1 && !html.includes("<img") && !html.includes("</textarea>")
      && !html.includes("<a href=\"javascript") && !/(?:href|src|action)\s*=\s*"\s*javascript:/i.test(html)
      && tags.every((t) => !/\son[a-z]+\s*=/i.test(t) && !/\sstyle\s*=/i.test(t)) && !html.includes(HOSTILE);
  };
  const escaped = (field: string) => pages[0]!.body.includes(`${escapeHtml(HOSTILE)}[${field}]`);
  check("SA92. hostile captions stay inert: <script>, attribute-breaking quotes, a javascript: URL, </textarea> and "
    + "U+2028 in the caption, hashtags, local keywords and contact line are escaped text, and the Copy attribute holds "
    + "them escaped",
    pages.every((p) => inert(p.body)) && ["caption-instagram", "caption-facebook", "tag-instagram", "keyword-facebook",
      "contact-instagram", "contact-facebook", "cta"].every(escaped)
      && copyValues(pages[0]!.body).some((c) => c.text.startsWith(`${HOSTILE}[caption-instagram]`))
      && pages[0]!.body.includes(" "),
    pages.map((p) => inert(p.body)).join());
  check("SA93. hostile stage output stays inert: the hook, beats, script, visual approach, shots, overlays and requirements "
    + "are escaped text",
    ["hook", "beat-1", "script", "visual-approach", "shot-0-subject", "shot-1-action", "shot-0-composition", "overlay",
      "requirement"].every(escaped));
  check("SA94. hostile run data stays inert: the goal (on the report and the list), a finding's issue (in Findings and Needs "
    + "your decision), the failure message, a scope tag, the requester's display name and artifact names in links "
    + "(escaped text, encoded URLs)",
    ["goal", "issue", "failure", "scope"].every(escaped) && (pages[0]!.body.split(`${escapeHtml(HOSTILE)}[issue]`).length - 1) === 2
      && pages[1]!.body.includes(escapeHtml(`${HOSTILE}[goal]`).slice(0, GOAL_PREVIEW_CHARS - 10))
      && pages[0]!.body.includes(`${escapeHtml(HOSTILE)}[display-name]`) && viewer.display_name!.includes(HOSTILE)
      && pages[0]!.body.includes(`href="/runs/${run.id}/files/${encodeURIComponent('x"onmouseover="alert(4).json')}"`)
      && pages[0]!.body.includes(`>${escapeHtml('x"onmouseover="alert(4).json')}</a>`)
      && pages[0]!.body.includes(`>${escapeHtml("x<script>.json")}</a>`));
  await w.close();
}

await refusal("SA95. refused: an aud array naming the client id and another audience (OIDC Core §3.1.3.7), which jose "
  + "alone accepts", "audience-multiple",
  (w) => ({ identity: user(w), plan: claims((c) => { c.aud = [CLIENT_ID, "another-client.apps.test"]; }) }));
await refusal("SA96. refused: an azp other than the client id", "authorized-party",
  (w) => ({ identity: user(w), plan: claims((c) => { c.azp = "another-client.apps.test"; }) }));
{
  const w = await world();
  const ok = await signIn(w, new Jar(), { identity: user(w), plan: claims((c) => { c.aud = [CLIENT_ID]; c.azp = CLIENT_ID; }) });
  check("SA97. a one-entry aud array naming the client, with azp equal to the client id, is accepted",
    ok.status === 303 && ok.location === "/" && refusalOf(() => checkAudienceParty({ aud: [CLIENT_ID, "x"] }, CLIENT_ID)) === "audience-multiple"
      && refusalOf(() => checkAudienceParty({ aud: CLIENT_ID, azp: "y" }, CLIENT_ID)) === "authorized-party"
      && refusalOf(() => checkAudienceParty({ aud: CLIENT_ID }, CLIENT_ID)) === "accepted", `${ok.status}`);
  await w.close();
}

// =====================================================================================================
// Content Studio S6.2: the run and revise actions with caps (design §6.1-§6.4, §8.3, §8.4)
// =====================================================================================================

const S62_COMMIT = "c".repeat(40);
const APPROVED_SHA = "a".repeat(64);
const PRICE_SHA = "b".repeat(64);
const CEILING = 21_650_000;

interface S62 {
  w: World; owner: Jar; runner: Jar; viewer: Jar; runnerUser: StudioUserRow; viewerUser: StudioUserRow; factVersion: string;
}

async function s62World(options: { ceilings?: WebConfig["ceilings"]; withVersion?: boolean } = {}): Promise<S62> {
  const w = await world();
  if (options.ceilings) {
    await w.close();
    const clock = w.clock;
    const store = w.store;
    const app = createStudioWebApp({ store, config: CONFIG(null, options.ceilings), commit: COMMIT, log, now: () => clock.now, oidc: issuer.provider });
    const server: Server = createHttpServer((req, res) => { void app.handle(req, res); });
    await new Promise<void>((settle) => server.listen(0, "127.0.0.1", settle));
    Object.assign(w, { app, base: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      close: () => new Promise<void>((settle) => { server.closeAllConnections(); server.close(() => settle()); }) });
  }
  const runnerUser = listed(w, "runner");
  const viewerUser = listed(w, "viewer");
  const jars = { owner: new Jar(), runner: new Jar(), viewer: new Jar() };
  await signIn(w, jars.owner, { identity: identityOf(w.owner) });
  await signIn(w, jars.runner, { identity: identityOf(runnerUser) });
  await signIn(w, jars.viewer, { identity: identityOf(viewerUser) });
  for (const jar of Object.values(jars)) secrets.add(csrfTokenFor(jar.values.get(SESSION_COOKIE)!));
  const factVersion = options.withVersion === false ? "" : w.store.addFactVersion({ "synthetic-tag-a": 3, "synthetic-tag-b": 2 });
  w.store.heartbeat = { commit: S62_COMMIT, approvedFactsSha256: APPROVED_SHA, priceTableSha256: PRICE_SHA,
    tagCounts: { "synthetic-approved": 5, "synthetic-tag-a": 1 }, beatAtMs: w.clock.now };
  // Content Studio S7.3, by fact: a runner with no daily cap cannot confirm (a missing cap is zero, §6.2), so this
  // world's runner has one AT the daily deployment ceiling — it never binds before the day's own cap, so every S6.2
  // check keeps its meaning. (Until S7.3 the runner had none, which then meant no per-user cap.)
  w.store.userCaps.set(runnerUser.id, CEILINGS.dailyMicros);
  // Every user row predates the quotes this world makes.
  for (const id of w.store.users.keys()) w.store.userUpdatedAt.set(id, w.clock.now - 60_000);
  return { w, ...jars, runnerUser, viewerUser, factVersion };
}

/**
 * A POST with the session's synchronizer token and the configured Origin. (S7.3: a jar whose session cookie was cleared
 * sends a token for no session, so the route refuses it instead of the suite crashing.)
 */
async function post(w: World, path: string, jar: Jar, fields: Array<[string, string]> = []): Promise<Reply> {
  const body = new URLSearchParams([...fields, ["csrf", csrfTokenFor(jar.values.get(SESSION_COOKIE) ?? "")]]).toString();
  return request(w, path, { method: "POST", jar, headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body });
}
const newRunFields = (goal = "Synthetic S6.2 goal", extra: Array<[string, string]> = []): Array<[string, string]> =>
  [["goal", goal], ["platform", "instagram"], ["platform", "facebook"], ...extra];
const requestIdOf = (reply: Reply) => /^\/preflights\/([0-9a-f-]{36})$/.exec(reply.location ?? "")?.[1] ?? "";

/** Ask for a full run's price as `jar`, then answer it as the worker would: a quote of `ceiling`. */
async function quoteFor(s: S62, jar: Jar, ceiling = CEILING, edit: Parameters<MemoryWebStore["answerPreflight"]>[1] extends infer A
  ? (A extends { quote: infer Q } ? Partial<Q> : never) : never = {}): Promise<{ requestId: string; quoteId: string }> {
  const reply = await post(s.w, "/new/price", jar, newRunFields());
  const requestId = requestIdOf(reply);
  const quoteId = s.w.store.answerPreflight(requestId, { quote: { ceilingMicros: ceiling, ...edit } })!;
  return { requestId, quoteId };
}
const counts = (w: World) => ({
  runs: [...w.store.runs.values()].filter((r) => r.runner === "live").length,
  jobs: [...w.store.jobs.values()].filter((j) => j.kind === "paid").length,
  ledger: w.store.ledger.length,
  consumed: [...w.store.quotes.values()].filter((q) => q.consumedAtMs !== null).length,
});
const same = (a: ReturnType<typeof counts>, b: ReturnType<typeof counts>) => JSON.stringify(a) === JSON.stringify(b);
/** A refused confirmation: its status, its class on the page, and nothing written. */
async function confirmRefused(s: S62, jar: Jar, quoteId: string, refusal: string, status = 409): Promise<{ ok: boolean; detail: string }> {
  const before = counts(s.w);
  const reply = await post(s.w, `/quotes/${quoteId}/confirm`, jar);
  const after = counts(s.w);
  return { ok: reply.status === status && reply.body.includes(`<code>${refusal}</code>`) && same(before, after),
    detail: `${reply.status} ${/<code>([a-z_]+)<\/code>/.exec(reply.body)?.[1]} ${JSON.stringify(before)}→${JSON.stringify(after)}` };
}

{
  // SA99-SA101: asking for a price.
  const s = await s62World();
  const callsBefore = s.w.store.calls.length;
  const asked = await post(s.w, "/new/price", s.runner, newRunFields("  A goal kept exactly as typed\r\n", [["tag", "synthetic-tag-b"], ["tag", "synthetic-tag-a"]]));
  const requestId = requestIdOf(asked);
  const row = s.w.store.preflight.get(requestId);
  const job = row ? s.w.store.jobs.get(row.jobId) : undefined;
  check("SA99. a runner's price request creates, together, one preflight job and its request — the action, the goal exactly "
    + "as typed, the platforms, the scope tags sorted, no source, the active fact version and params_sha256 by the canonical "
    + "function — with an audit row of classes only, and redirects to the request's page",
    asked.status === 303 && row !== undefined && job?.kind === "preflight" && job.state === "queued" && job.runId === null
      && row.action === "full" && row.goal === "  A goal kept exactly as typed\r\n" && row.platforms.join() === "instagram,facebook"
      && row.scopeTags?.join() === "synthetic-tag-a,synthetic-tag-b" && row.sourceRunId === null && row.factVersionId === s.factVersion
      && row.paramsSha256 === preflightParamsSha256(row) && row.userId === s.runnerUser.id
      && s.w.store.auditLog.at(-1)?.action === "preflight.request" && JSON.stringify(s.w.store.auditLog.at(-1)?.detail) === '{"action":"full"}'
      && s.w.store.calls.slice(callsBefore).filter((c) => c === "createPreflightRequest").length === 1,
    `${asked.status} ${asked.location} ${JSON.stringify(row)}`);

  const jobsBefore = s.w.store.jobs.size;
  const viewerAsks = await post(s.w, "/new/price", s.viewer, newRunFields());
  const viewerForm = await request(s.w, "/new", { jar: s.viewer });
  const disabledJar = new Jar();
  const disabled = listed(s.w, "runner");
  await signIn(s.w, disabledJar, { identity: identityOf(disabled) });
  s.w.store.setStatus(disabled.id, "disabled");
  const disabledAsks = await post(s.w, "/new/price", disabledJar, newRunFields());
  const storeRefuses = await s.w.store.createPreflightRequest(preflightRequest({ userId: s.viewerUser.id, action: "full", goal: "x",
    platforms: ["instagram"], scopeTags: null, sourceRunId: null, factVersionId: s.factVersion })).then(() => "written", (e) => String(e.code));
  check("SA99a. a viewer's or a disabled user's price request is refused before anything is written — the viewer by the "
    + "route's role (403), the disabled user's session by its live users row — and the store refuses one written directly, "
    + "as 0003's trigger does",
    viewerAsks.status === 403 && viewerForm.status === 403 && disabledAsks.status === 401 && storeRefuses === "23514"
      && s.w.store.jobs.size === jobsBefore,
    `${viewerAsks.status} ${viewerForm.status} ${disabledAsks.status} ${storeRefuses}`);
  await s.w.close();

  const none = await s62World({ withVersion: false });
  const form = await request(none.w, "/new", { jar: none.runner });
  const refused = await post(none.w, "/new/price", none.runner, newRunFields());
  check("SA99b. with no active fact version the new-run page says so and offers no price (its button disabled), and a "
    + "price request is refused (409) with no job or request written",
    form.status === 200 && form.body.includes("No fact version is active, so no price can be offered")
      && form.body.includes("<button type=\"submit\" disabled>Check and get a price</button>")
      && refused.status === 409 && refused.body.includes("<code>no_fact_version</code>") && none.w.store.preflight.size === 0
      && none.w.store.jobs.size === 0, `${form.status} ${refused.status}`);
  await none.w.close();
}

{
  const s = await s62World();
  const astral = "𝔊".repeat(GOAL_MAX_CHARS);
  const bad: Array<[string, Array<[string, string]>]> = [
    ["empty goal", newRunFields("")], ["blank goal", newRunFields("   ")], ["2,001 characters", newRunFields("x".repeat(GOAL_MAX_CHARS + 1))],
    ["two goals", [...newRunFields(), ["goal", "second"]]], ["no platform", [["goal", "g"]]],
    ["an unknown platform", [["goal", "g"], ["platform", "tiktok"]]], ["a repeated platform", [["goal", "g"], ["platform", "instagram"], ["platform", "instagram"]]],
    ["a tag not offered", newRunFields("g", [["tag", "not-offered"]])], ["a repeated tag", newRunFields("g", [["tag", "synthetic-tag-a"], ["tag", "synthetic-tag-a"]])],
  ];
  const replies = await Promise.all(bad.map(([, fields]) => post(s.w, "/new/price", s.runner, fields)));
  const longest = await post(s.w, "/new/price", s.runner, newRunFields(astral));
  check("SA100. the new-run form is validated before anything is written: an empty, blank or 2,001-character goal, two "
    + "goals, no platform, an unknown or repeated platform, and a tag not offered or repeated are each refused (400); a goal "
    + "of exactly 2,000 characters counted as PostgreSQL counts them (code points, here astral) is accepted",
    replies.every((r) => r.status === 400) && s.w.store.preflight.size === 1 && longest.status === 303
      && codePoints(astral) === GOAL_MAX_CHARS && astral.length === 2 * GOAL_MAX_CHARS,
    replies.map((r) => r.status).join());
  const page = await request(s.w, "/new", { jar: s.runner });
  const migration = readFileSync(resolve(REPO_ROOT, "studio/migrations/0003_studio_preflight_requests.sql"), "utf8");
  const contract = readFileSync(resolve(REPO_ROOT, "src/harness/agents/payloadContract.ts"), "utf8");
  check("SA101. the new-run page offers the goal, the three platforms (all checked) and the scope tags with their record "
    + "counts (the heartbeat's and the active fact version's, summed), and shows the in-scope count as an UPPER BOUND, labelled "
    + "as such, beside the 64-record cap — which the worker enforces exactly; the platforms are 0003's and the cap the payload "
    + "contract's",
    page.status === 200 && page.body.includes('name="goal"') && page.body.includes(`maxlength="${GOAL_MAX_CHARS}"`)
      && PLATFORMS.every((p) => page.body.includes(`value="${p}" checked>`))
      && page.body.includes('value="synthetic-tag-a" data-count="4"') && page.body.includes('value="synthetic-approved" data-count="5"')
      && page.body.includes("The count shown is an upper bound") && page.body.includes("data-scope-bound")
      && page.body.includes(`${PACK_RECORD_CAP}-record cap exactly`) && scopeUpperBound(offeredTags({ a: 3, b: 2 }, { a: 1 }), ["a", "b"]) === 6
      && migration.includes(`ARRAY[${PLATFORMS.map((p) => `'${p}'`).join(", ")}]::text[]`)
      && /maxProjectedRecords:\s*64,/.test(contract) && PACK_RECORD_CAP === 64,
    `${page.status}`);
  await s.w.close();
}

{
  // SA102: the request's page, before and after the worker answers.
  const s = await s62World();
  const asked = await post(s.w, "/new/price", s.runner, newRunFields());
  const id = requestIdOf(asked);
  const pending = await request(s.w, `/preflights/${id}`, { jar: s.runner });
  const breakdown = [
    { item: "strategy-concept", unit: "request", ceilingUsd: "3.000000", lines: [{ label: "strategy-concept", model: "synthetic-model-a", maxTokens: 64000, costUsd: 3 }] },
    { item: "final-critic", unit: "critic-panel", ceilingUsd: "18.650000", lines: ["evidence-fidelity", "platform-and-local", "voice-and-craft", "production-coherence"]
      .map((lens) => ({ label: `final-critic:${lens}`, model: "synthetic-model-a", maxTokens: 32000, costUsd: 4.6625 })) },
  ];
  s.w.store.answerPreflight(id, { quote: { ceilingMicros: CEILING, breakdown } });
  const quoted = await request(s.w, `/preflights/${id}`, { jar: s.runner });
  const otherRunner = listed(s.w, "runner");
  const otherJar = new Jar();
  await signIn(s.w, otherJar, { identity: identityOf(otherRunner) });
  const asOther = await request(s.w, `/preflights/${id}`, { jar: otherJar });
  const asOwner = await request(s.w, `/preflights/${id}`, { jar: s.owner });
  check("SA102. a price request's page polls until the worker answers; then shows the quote's lines (the critic panel's four "
    + "lenses as one item), its total, the caps remaining today and this month, its expiry, and a Confirm button only to the "
    + "user who asked; an owner may view it without the button, another runner sees nothing (404)",
    pending.status === 200 && pending.body.includes(`<meta http-equiv="refresh" content="${PREFLIGHT_POLL_SECONDS}">`)
      && quoted.status === 200 && !quoted.body.includes("http-equiv=\"refresh\"") && quoted.body.includes("final-critic panel — 4 lenses, run together, one item")
      && quoted.body.includes("$18.650000") && quoted.body.includes("Total ceiling: <strong>$21.65</strong>")
      && quoted.body.includes("<dt>Left today</dt><dd>$50.00 of $50.00</dd>") && quoted.body.includes("<dt>Left this month</dt><dd>$200.00 of $200.00</dd>")
      && quoted.body.includes("Expires ") && quoted.body.includes(`action="/quotes/${s.w.store.preflight.get(id)!.quoteId}/confirm"`)
      && quoted.body.includes("Confirm and reserve $21.65") && quoted.body.includes("live_runs_not_enabled")
      && asOther.status === 404 && asOwner.status === 200 && !asOwner.body.includes("Confirm and reserve"),
    `${pending.status} ${quoted.status} ${asOther.status} ${asOwner.status}`);
  await s.w.close();
}

{
  // SA103-SA104: confirmation.
  const s = await s62World();
  const { quoteId } = await quoteFor(s, s.runner);
  const reply = await post(s.w, `/quotes/${quoteId}/confirm`, s.runner);
  const runId = /^\/runs\/([0-9a-f-]{36})$/.exec(reply.location ?? "")?.[1] ?? "";
  const run = s.w.store.runs.get(runId);
  const ledger = s.w.store.ledger.filter((l) => l.runId === runId);
  const job = [...s.w.store.jobs.values()].find((j) => j.runId === runId);
  check("SA103. confirming a quote creates, together, the live run (queued, the quote's action, user, parameters and fact "
    + "version, reserved at the quote's ceiling), the quote's consumption, ONE reserve entry equal to the ceiling booked to "
    + "today's America/New_York day, the paid job and an audit row; the web computed no price",
    reply.status === 303 && run?.runner === "live" && run.state === "queued" && run.kind === "full" && run.requested_by === s.runnerUser.id
      && run.reserved_usd === "21.650000" && run.fact_version_id === s.factVersion && run.goal === "Synthetic S6.2 goal"
      && s.w.store.quotes.get(quoteId)!.consumedAtMs !== null && ledger.length === 1 && ledger[0]!.entry === "reserve"
      && ledger[0]!.amountMicros === CEILING && ledger[0]!.day === localDay(s.w.clock.now) && job?.kind === "paid" && job.state === "queued"
      && s.w.store.auditLog.at(-1)?.action === "run.confirm",
    `${reply.status} ${JSON.stringify(run)?.slice(0, 120)} ${JSON.stringify(ledger)}`);
  const again = await confirmRefused(s, s.runner, quoteId, "quote_used");
  const twice = await Promise.all([post(s.w, `/quotes/${quoteId}/confirm`, s.runner), post(s.w, `/quotes/${quoteId}/confirm`, s.runner)]);
  check("SA104. a double confirmation creates exactly one run, one job and one reserve entry: pressing Confirm again — once "
    + "after, and twice at once — is refused as quote_used",
    again.ok && twice.every((r) => r.status === 409) && counts(s.w).runs === 1 && counts(s.w).jobs === 1 && counts(s.w).ledger === 1,
    again.detail);
  await s.w.close();
}

{
  const cases: Array<[string, (s: S62) => Promise<{ ok: boolean; detail: string }>]> = [
    ["SA104a. no quote: a quote id that names none is refused (404, no_quote) with nothing written", async (s) =>
      confirmRefused(s, s.runner, crypto.randomUUID(), "no_quote", 404)],
    ["SA104b. another user's quote is refused (quote_not_yours)", async (s) =>
      confirmRefused(s, s.owner, (await quoteFor(s, s.runner)).quoteId, "quote_not_yours")],
    ["SA104c. an expired quote is refused (quote_expired)", async (s) => {
      const { quoteId } = await quoteFor(s, s.runner);
      s.w.clock.now += 10 * 60_000 + 1;
      s.w.store.heartbeat!.beatAtMs = s.w.clock.now;
      return confirmRefused(s, s.runner, quoteId, "quote_expired");
    }],
    ["SA104d. a quote whose worker commit differs from the heartbeat's is refused (quote_stale)", async (s) =>
      confirmRefused(s, s.runner, (await quoteFor(s, s.runner, CEILING, { workerCommit: "d".repeat(40) })).quoteId, "quote_stale")],
    ["SA104e. a quote whose approved-facts sha256 differs from the heartbeat's is refused (quote_stale)", async (s) =>
      confirmRefused(s, s.runner, (await quoteFor(s, s.runner, CEILING, { approvedFactsSha256: "e".repeat(64) })).quoteId, "quote_stale")],
    ["SA104f. a quote whose price-table sha256 differs from the heartbeat's is refused (quote_stale)", async (s) =>
      confirmRefused(s, s.runner, (await quoteFor(s, s.runner, CEILING, { priceTableSha256: "f".repeat(64) })).quoteId, "quote_stale")],
    ["SA104g. a quote whose fact version is no longer the current one (the active version changed) is refused (quote_stale)", async (s) => {
      const { quoteId } = await quoteFor(s, s.runner);
      s.w.store.addFactVersion({});
      return confirmRefused(s, s.runner, quoteId, "quote_stale");
    }],
    ["SA104h. a stale heartbeat (older than two minutes), and none at all, is refused (worker_offline)", async (s) => {
      const { quoteId } = await quoteFor(s, s.runner);
      s.w.store.heartbeat!.beatAtMs = s.w.clock.now - 2 * 60_000 - 1;
      const stale = await confirmRefused(s, s.runner, quoteId, "worker_offline");
      s.w.store.heartbeat = null;
      const gone = await confirmRefused(s, s.runner, quoteId, "worker_offline");
      return { ok: stale.ok && gone.ok, detail: `${stale.detail} | ${gone.detail}` };
    }],
    ["SA104i. a viewer cannot confirm (the route's role, 403), and a disabled user's session is refused (401)", async (s) => {
      const { quoteId } = await quoteFor(s, s.runner);
      const before = counts(s.w);
      const viewer = await post(s.w, `/quotes/${quoteId}/confirm`, s.viewer);
      s.w.store.setStatus(s.runnerUser.id, "disabled");
      const disabled = await post(s.w, `/quotes/${quoteId}/confirm`, s.runner);
      return { ok: viewer.status === 403 && disabled.status === 401 && same(before, counts(s.w)), detail: `${viewer.status} ${disabled.status}` };
    }],
    ["SA104j. a role changed after quoting is refused: demoted to viewer (the route, 403), and an owner demoted to runner "
      + "after the quote, which keeps the route (user_changed)", async (s) => {
      const { quoteId } = await quoteFor(s, s.runner);
      const before = counts(s.w);
      s.w.store.users.get(s.runnerUser.id)!.role = "viewer";
      const demoted = await post(s.w, `/quotes/${quoteId}/confirm`, s.runner);
      const second = listed(s.w, "owner");
      const jar = new Jar();
      await signIn(s.w, jar, { identity: identityOf(second) });
      s.w.store.userUpdatedAt.set(second.id, s.w.clock.now - 60_000);
      const { quoteId: ownerQuote } = await quoteFor(s, jar);
      s.w.clock.now += 1_000;
      s.w.store.users.get(second.id)!.role = "runner";
      s.w.store.userUpdatedAt.set(second.id, s.w.clock.now);
      s.w.store.heartbeat!.beatAtMs = s.w.clock.now;
      const changed = await confirmRefused(s, jar, ownerQuote, "user_changed");
      return { ok: demoted.status === 403 && same(before, counts(s.w)) && changed.ok, detail: `${demoted.status} ${changed.detail}` };
    }],
    ["SA104k. the owner's daily cap: a ceiling that does not fit what remains of today's is refused (cap_exceeded_daily)", async (s) => {
      s.w.store.settings!.dailyCapMicros = CEILING - 1;
      return confirmRefused(s, s.runner, (await quoteFor(s, s.runner)).quoteId, "cap_exceeded_daily");
    }],
    ["SA104l. the owner's monthly cap: today's caps fit (both raised) but the month does not (cap_exceeded_monthly)", async (s) => {
      const { quoteId } = await quoteFor(s, s.runner);
      s.w.store.settings!.dailyCapMicros = 1_000_000_000;
      s.w.store.ledger.push({ entry: "reserve", runId: crypto.randomUUID(), amountMicros: 190_000_000, day: localDay(s.w.clock.now) });
      return confirmRefused(s, s.runner, quoteId, "cap_exceeded_monthly");
    }],
    ["SA104m. the runner's own daily cap: a ceiling over what remains of it is refused although the owner's caps fit "
      + "(cap_exceeded_user_daily)", async (s) => {
      s.w.store.userCaps.set(s.runnerUser.id, 25_000_000);
      const first = await quoteFor(s, s.runner, 10_000_000);
      const ok = await post(s.w, `/quotes/${first.quoteId}/confirm`, s.runner);
      const refusal = await confirmRefused(s, s.runner, (await quoteFor(s, s.runner, 15_000_001)).quoteId, "cap_exceeded_user_daily");
      return { ok: ok.status === 303 && refusal.ok, detail: `${ok.status} ${refusal.detail}` };
    }],
    ["SA104n. the deployment ceiling bounds the owner's cap: with STUDIO_MAX_DAILY_USD below the owner's $50, a ceiling "
      + "the owner's cap would allow is refused (cap_exceeded_daily)", async (s) =>
      confirmRefused(s, s.runner, (await quoteFor(s, s.runner)).quoteId, "cap_exceeded_daily")],
    ["SA104o. an unacknowledged overrun locks every confirmation (confirmations_locked); the owner's acknowledgement unlocks it", async (s) => {
      const overrunRun = s.w.store.addRun(s.runnerUser, { runner: "live", state: "failed", failure_class: "cost_ceiling_exceeded" });
      s.w.store.ledger.push({ entry: "reserve", runId: overrunRun.id, amountMicros: 1_000_000, day: localDay(s.w.clock.now) },
        { entry: "overrun", runId: overrunRun.id, amountMicros: 500_000, day: localDay(s.w.clock.now) });
      const { quoteId } = await quoteFor(s, s.runner);
      const locked = await confirmRefused(s, s.runner, quoteId, "confirmations_locked");
      const ack = await post(s.w, `/spend/overruns/${overrunRun.id}/acknowledge`, s.owner);
      const unlocked = await post(s.w, `/quotes/${quoteId}/confirm`, s.runner);
      return { ok: locked.ok && ack.status === 303 && unlocked.status === 303, detail: `${locked.detail} ${ack.status} ${unlocked.status}` };
    }],
  ];
  for (const [name, run] of cases) {
    const s = await s62World(name.startsWith("SA104n.") ? { ceilings: { dailyMicros: CEILING - 1, monthlyMicros: 300_000_000 } }
      : name.startsWith("SA104l.") ? { ceilings: { dailyMicros: 1_000_000_000, monthlyMicros: 300_000_000 } } : {});
    const result = await run(s);
    check(name, result.ok, result.detail);
    await s.w.close();
  }
}

{
  // SA105: the deployment ceilings as the entry point reads them.
  const parsed = (daily: string | undefined, monthly: string | undefined) => decideWebStartup(env({ maxDailyUsd: daily, maxMonthlyUsd: monthly }));
  const zeroCases = [parsed(undefined, "300"), parsed("abc", "300"), parsed("", "300"), parsed("-5", "300"), parsed("75.1234567", "300"),
    parsed("1e3", "300")];
  const ok = parsed("75", "300.50");
  const results: string[] = [];
  for (const startup of zeroCases.slice(0, 3)) {
    const s = await s62World({ ceilings: startup.config.ceilings });
    const r = await confirmRefused(s, s.runner, (await quoteFor(s, s.runner)).quoteId, "cap_exceeded_daily");
    results.push(r.ok ? "refused" : r.detail);
    await s.w.close();
  }
  check("SA105. the web reads STUDIO_MAX_DAILY_USD and STUDIO_MAX_MONTHLY_USD through the worker's parseCapMicros (one "
    + "function, in the S2 runner module): a missing, unparsable, empty, negative or over-precise ceiling is ZERO and named "
    + "in zeroCaps, and a confirmation under a missing, unparsable or empty ceiling is refused (fail closed)",
    zeroCases.every((x) => x.config.ceilings.dailyMicros === 0 && x.zeroCaps.join() === "STUDIO_MAX_DAILY_USD")
      && ok.config.ceilings.dailyMicros === 75_000_000 && ok.config.ceilings.monthlyMicros === 300_500_000 && ok.zeroCaps.length === 0
      && [undefined, "abc", "", "-5", "75.1234567", "1e3", "75", "300.50"].every((raw) => parsed(raw, "300").config.ceilings.dailyMicros === parseCapMicros(raw))
      && results.every((r) => r === "refused"),
    results.join(" | "));
}

/**
 * A scripted PostgreSQL for the confirmation transaction: it answers each statement PgWebStore.confirmQuote makes,
 * and models what the transaction relies on — a `FOR UPDATE` on the settings row is held until COMMIT or ROLLBACK
 * and a second one waits for it, as PostgreSQL's row lock does; each statement sees only committed rows (READ
 * COMMITTED); a transaction's own writes apply at COMMIT. Every statement is recorded with its transaction, and every
 * statement yields first, so two transactions interleave.
 */
class ScriptedConfirmDb {
  readonly statements: Array<{ tx: number | null; text: string }> = [];
  committedReserves: Array<{ runId: string; amountMicros: number; userId: string }> = [];
  consumed = new Set<string>();
  private lockHeld: number | null = null;
  private waiters: Array<() => void> = [];
  private nextTx = 1;
  constructor(readonly state: { nowMs: number; userId: string; dailyCap: string; quotes: Map<string, { ceiling: string }> }) {}

  private async lock(tx: number): Promise<void> {
    while (this.lockHeld !== null && this.lockHeld !== tx) await new Promise<void>((settle) => this.waiters.push(settle));
    this.lockHeld = tx;
  }
  private unlock(tx: number): void {
    if (this.lockHeld !== tx) return;
    this.lockHeld = null;
    for (const wake of this.waiters.splice(0)) wake();
  }
  private answer(tx: number | null, text: string, values: unknown[], pending: { reserves: ScriptedConfirmDb["committedReserves"]; consumed: string[] }) {
    const t = text.replace(/\s+/g, " ");
    const st = this.state;
    if (/FROM studio_settings WHERE singleton/.test(t)) return [{ daily: st.dailyCap, monthly: "200", active: "fv-1" }];
    if (/^SELECT \(extract\(epoch FROM now\(\)\) \* 1000\)::float8 AS now$/.test(t.trim())) return [{ now: st.nowMs }];
    // (S7.3, by fact: the runner has a cap at the daily ceiling — a runner with none is refused as cap_missing. Until S7.3: cap null.)
    if (/FROM studio_users WHERE id/.test(t)) return [{ id: st.userId, role: "runner", status: "active", cap: "75.000000", updated: st.nowMs - 60_000 }];
    if (/FROM studio_quotes q LEFT JOIN studio_fact_versions/.test(t)) {
      const q = st.quotes.get(String(values[0]));
      return q ? [{ id: values[0], user_id: st.userId, action: "full", params_sha256: "p".repeat(64), worker_commit: S62_COMMIT,
        approved_facts_sha256: APPROVED_SHA, fact_version_id: "fv-1", price_table_sha256: PRICE_SHA, ceiling: q.ceiling,
        created: st.nowMs - 1_000, expires: st.nowMs + 60_000, consumed: this.consumed.has(String(values[0])), fact_sha: "d".repeat(64) }] : [];
    }
    if (/FROM studio_preflight_requests WHERE quote_id/.test(t)) {
      return [{ action: "full", goal: "g", platforms: ["instagram"], scope_tags: null, source_run_id: null, fact_version_id: "fv-1",
        params_sha256: "p".repeat(64) }];
    }
    if (/FROM studio_worker_heartbeat/.test(t)) {
      return [{ commit: S62_COMMIT, approved_facts_sha256: APPROVED_SHA, price_table_sha256: PRICE_SHA, beat: st.nowMs }];
    }
    if (/count\(\*\)::int AS n FROM studio_spend_ledger/.test(t)) return [{ n: 0 }];
    if (/studio_spend_for_day/.test(t)) {
      const total = this.committedReserves.reduce((sum, r) => sum + r.amountMicros, 0);
      return [{ day: microsToNumeric(total), month: microsToNumeric(total), user_day: microsToNumeric(total) }];
    }
    if (/^INSERT INTO studio_runs/.test(t.trim())) return [{ id: `run-${tx}` }];
    if (/^UPDATE studio_quotes SET consumed_at/.test(t.trim())) { pending.consumed.push(String(values[0])); return []; }
    if (/^INSERT INTO studio_spend_ledger/.test(t.trim())) {
      pending.reserves.push({ runId: String(values[0]), amountMicros: numericToMicros(String(values[1]))!, userId: st.userId });
      return [];
    }
    return [];
  }
  /** A client of the pool: one transaction at a time, its writes applied at COMMIT. */
  private client(): { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>; release: () => void } {
    let tx: number | null = null;
    let pending = { reserves: [] as ScriptedConfirmDb["committedReserves"], consumed: [] as string[] };
    return {
      query: async (text: string, values: unknown[] = []) => {
        await new Promise<void>((settle) => setImmediate(settle));
        if (text === "BEGIN") { tx = this.nextTx++; pending = { reserves: [], consumed: [] }; this.statements.push({ tx, text }); return { rows: [], rowCount: 0 }; }
        if (text === "COMMIT" || text === "ROLLBACK") {
          this.statements.push({ tx, text });
          if (text === "COMMIT") {
            this.committedReserves.push(...pending.reserves);
            for (const q of pending.consumed) this.consumed.add(q);
          }
          if (tx !== null) this.unlock(tx);
          tx = null;
          return { rows: [], rowCount: 0 };
        }
        this.statements.push({ tx, text });
        if (tx !== null && /FROM studio_settings WHERE singleton FOR UPDATE/.test(text.replace(/\s+/g, " "))) await this.lock(tx);
        const rows = this.answer(tx, text, values, tx === null ? { reserves: this.committedReserves, consumed: [] } : pending);
        if (tx === null && /^\s*UPDATE studio_quotes SET consumed_at/.test(text)) this.consumed.add(String(values[0]));
        return { rows, rowCount: Math.max(rows.length, 1) };
      },
      release: () => {},
    };
  }
  pool() {
    return { connect: async () => this.client(), query: (text: string, values?: unknown[]) => this.client().query(text, values) };
  }
}

{
  // SA106-SA106a: the confirmation transaction's statements, and two confirmations against the same headroom.
  const ceilings = { dailyMicros: 75_000_000, monthlyMicros: 300_000_000 };
  const db = new ScriptedConfirmDb({ nowMs: Date.UTC(2026, 9, 5, 16), userId: "u-1", dailyCap: "30",
    quotes: new Map([["q-1", { ceiling: "21.650000" }], ["q-2", { ceiling: "21.650000" }]]) });
  const store = new PgWebStore(db.pool() as never, db.pool() as never);
  const [a, b] = await Promise.all([
    store.confirmQuote({ quoteId: "q-1", userId: "u-1", ceilings }), store.confirmQuote({ quoteId: "q-2", userId: "u-1", ceilings }),
  ]);
  const results = [a, b].map((r) => (r.ok ? "ok" : r.refusal)).sort();
  check("SA106. two confirmations against the same headroom (a $30 daily cap, two $21.65 quotes), over a scripted database "
    + "that grants the settings row's FOR UPDATE lock as PostgreSQL does: exactly one is confirmed and the other is refused by "
    + "the cap, because the second reads the spend only after the first has committed its reservation",
    results.join() === "cap_exceeded_daily,ok" && db.committedReserves.length === 1 && db.consumed.size === 1,
    `${results.join()} ${db.committedReserves.length}`);

  const one = new ScriptedConfirmDb({ nowMs: Date.UTC(2026, 9, 5, 16), userId: "u-1", dailyCap: "50",
    quotes: new Map([["q-1", { ceiling: "21.650000" }]]) });
  const confirmed = await new PgWebStore(one.pool() as never, one.pool() as never).confirmQuote({ quoteId: "q-1", userId: "u-1", ceilings });
  const tag = (text: string) => {
    const t = text.replace(/\s+/g, " ").trim();
    return t === "BEGIN" || t === "COMMIT" || t === "ROLLBACK" ? t : /FROM studio_settings WHERE singleton FOR UPDATE/.test(t) ? "lock-settings"
      : /^INSERT INTO studio_runs/.test(t) ? "run" : /^UPDATE studio_quotes SET consumed_at/.test(t) ? "consume"
        : /^INSERT INTO studio_spend_ledger/.test(t) ? "reserve" : /^INSERT INTO studio_jobs/.test(t) ? "job"
          : /^INSERT INTO studio_audit_log/.test(t) ? "audit" : "read";
  };
  const order = one.statements.map((s) => `${s.tx ?? "none"}:${tag(s.text)}`);
  const writes = order.filter((o) => !o.endsWith(":read"));
  const firstRead = order.findIndex((o) => o.endsWith(":read"));
  check("SA106a. the confirmation is ONE transaction whose first statement takes SELECT … FOR UPDATE on the settings row, "
    + "before anything is read; the run, the quote's consumption, the reserve entry, the paid job and the audit row are all "
    + "written inside it, and committed together",
    confirmed.ok && writes.join() === "1:BEGIN,1:lock-settings,1:run,1:consume,1:reserve,1:job,1:audit,1:COMMIT"
      && order[1] === "1:lock-settings" && firstRead === 2 && one.statements.every((s) => s.tx === 1),
    order.join());
}

{
  // SA107: cancellation.
  const s = await s62World();
  const confirmQuote = async (jar: Jar) => {
    const { quoteId } = await quoteFor(s, jar);
    return /^\/runs\/([0-9a-f-]{36})$/.exec((await post(s.w, `/quotes/${quoteId}/confirm`, jar)).location ?? "")![1]!;
  };
  s.w.store.settings!.dailyCapMicros = 200_000_000;
  const queued = await confirmQuote(s.runner);
  const ownerCancels = await post(s.w, `/runs/${queued}/cancel`, s.owner);
  const ledger = s.w.store.ledger.filter((l) => l.runId === queued);
  const job = [...s.w.store.jobs.values()].find((j) => j.runId === queued)!;
  const run = s.w.store.runs.get(queued)!;
  check("SA107. a queued run is cancelled before it is claimed — its job cancelled, its run cancelled (job_cancelled) — and "
    + "its WHOLE reservation released, booked to the reserve's day; the owner may cancel a runner's run",
    ownerCancels.status === 303 && job.state === "cancelled" && run.state === "cancelled" && run.failure_class === "job_cancelled"
      && ledger.map((l) => `${l.entry}:${l.amountMicros}:${l.day}`).join()
        === `reserve:${CEILING}:${localDay(s.w.clock.now)},release:${CEILING}:${localDay(s.w.clock.now)}`
      && s.w.store.spendMicros((l) => l.runId === queued) === 0,
    `${ownerCancels.status} ${JSON.stringify(ledger)}`);

  const running = await confirmQuote(s.runner);
  const runningJob = [...s.w.store.jobs.values()].find((j) => j.runId === running)!;
  runningJob.state = "running";
  s.w.store.runs.get(running)!.state = "running";
  const ledgerBefore = s.w.store.ledger.length;
  const ownCancel = await post(s.w, `/runs/${running}/cancel`, s.runner);
  check("SA107a. a running run's cancellation is requested — the worker sends no further request, keeps what completed and "
    + "releases the rest (S3's check before every unit) — and the web writes no ledger entry itself; a runner may cancel "
    + "their own run",
    ownCancel.status === 303 && runningJob.cancelRequested && runningJob.state === "running" && s.w.store.ledger.length === ledgerBefore,
    `${ownCancel.status}`);

  const ownersRun = await confirmQuote(s.owner);
  const before = JSON.stringify({ ledger: s.w.store.ledger, jobs: [...s.w.store.jobs.values()] });
  const runnerCancelsOwners = await post(s.w, `/runs/${ownersRun}/cancel`, s.runner);
  const viewerCancels = await post(s.w, `/runs/${ownersRun}/cancel`, s.viewer);
  check("SA107b. a runner cannot cancel another user's run (403, not_your_run) and a viewer cannot cancel at all (403); "
    + "nothing changes",
    runnerCancelsOwners.status === 403 && runnerCancelsOwners.body.includes("<code>not_your_run</code>") && viewerCancels.status === 403
      && JSON.stringify({ ledger: s.w.store.ledger, jobs: [...s.w.store.jobs.values()] }) === before
      && s.w.store.runs.get(ownersRun)!.state === "queued",
    `${runnerCancelsOwners.status} ${viewerCancels.status}`);
  await s.w.close();
}

{
  // SA108: fake runs.
  const s = await s62World();
  const quotesBefore = s.w.store.quotes.size;
  const ownerFake = await post(s.w, "/new/fake", s.owner, newRunFields("Synthetic fake wiring goal"));
  const runId = /^\/runs\/([0-9a-f-]{36})$/.exec(ownerFake.location ?? "")?.[1] ?? "";
  const run = s.w.store.runs.get(runId);
  const report = await request(s.w, `/runs/${runId}`, { jar: s.owner });
  const runsBefore = s.w.store.runs.size;
  const runnerFake = await post(s.w, "/new/fake", s.runner, newRunFields("Synthetic fake wiring goal"));
  const page = await request(s.w, "/new", { jar: s.runner });
  check("SA108. a fake run is owner only: the owner's creates a fake run and a fake job with no quote and no ledger entry, "
    + "labelled \"FAKE — wiring test\" on its report; a runner's is refused (403) with nothing created, and the runner's new-run "
    + "page offers no fake button",
    ownerFake.status === 303 && run?.runner === "fake" && run.state === "queued" && run.reserved_usd === null
      && [...s.w.store.jobs.values()].some((j) => j.runId === runId && j.kind === "fake") && s.w.store.quotes.size === quotesBefore
      && s.w.store.ledger.length === 0 && report.body.includes("FAKE — wiring test") && report.body.includes('class="badge badge-fake">FAKE<')
      && runnerFake.status === 403 && runnerFake.body.includes("<h1>Forbidden</h1>") && s.w.store.runs.size === runsBefore
      && !page.body.includes("formaction=\"/new/fake\""),
    `${ownerFake.status} ${runnerFake.status}`);
  await s.w.close();
}

{
  // SA109-SA110: the overrun acknowledgement and the spend panel.
  const s = await s62World();
  const overrunRun = s.w.store.addRun(s.runnerUser, { runner: "live", state: "failed", failure_class: "cost_ceiling_exceeded" });
  const day = localDay(s.w.clock.now);
  s.w.store.ledger.push({ entry: "reserve", runId: overrunRun.id, amountMicros: 21_650_000, day },
    { entry: "overrun", runId: overrunRun.id, amountMicros: 1_250_000, day });
  const runnerAck = await post(s.w, `/spend/overruns/${overrunRun.id}/acknowledge`, s.runner);
  const panelLocked = await request(s.w, "/spend", { jar: s.viewer });
  const ownerLocked = await request(s.w, "/spend", { jar: s.owner });
  const ownerAck = await post(s.w, `/spend/overruns/${overrunRun.id}/acknowledge`, s.owner);
  const ackRow = s.w.store.auditLog.at(-1);
  const again = await post(s.w, `/spend/overruns/${overrunRun.id}/acknowledge`, s.owner);
  check("SA109. acknowledging an overrun is owner only (a runner is refused, 403); the owner's writes S3's audit row "
    + "(spend.overrun_acknowledged on the run) and unlocks confirmations; a second acknowledgement finds nothing (409)",
    runnerAck.status === 403 && ownerAck.status === 303 && ackRow?.action === "spend.overrun_acknowledged"
      && ackRow.targetType === "studio_runs" && ackRow.targetId === overrunRun.id && ackRow.actorUserId === s.w.owner.id
      && s.w.store.unacknowledgedOverruns().length === 0 && again.status === 409
      && panelLocked.body.includes("not acknowledged: every confirmation is locked"),
    `${runnerAck.status} ${ownerAck.status} ${again.status}`);
  const panel = await request(s.w, "/spend", { jar: s.viewer });
  const ownerPanel = await request(s.w, "/spend", { jar: s.owner });
  check("SA110. the spend panel is viewer-readable: today and this month (America/New_York) against each effective cap — the "
    + "lower of the owner's cap and the deployment ceiling — per user, and every overrun with whether it was acknowledged; the "
    + "acknowledge button is the owner's alone",
    panel.status === 200 && panel.body.includes(`Today (${day})`) && panel.body.includes("$22.90") && panel.body.includes("$50.00")
      && panel.body.includes("$75.00") && panel.body.includes("$300.00") && panel.body.includes("acknowledged")
      && panel.body.includes(escapeHtml(s.runnerUser.display_name!)) && ownerPanel.status === 200
      && ownerLocked.body.includes(`action="/spend/overruns/${overrunRun.id}/acknowledge"`) && !panelLocked.body.includes("/acknowledge\""),
    `${panel.status}`);
  await s.w.close();
}

{
  // SA111: the America/New_York day, at both UTC offsets and a month boundary.
  check("SA111. a cap's day is the America/New_York day, at both UTC offsets and across a month boundary: 03:59Z on 1 October "
    + "is still 30 September (EDT), 04:59:59Z on 1 December is still 30 November (EST), and each day's month is its first",
    localDay(Date.parse("2026-10-01T03:59:59Z")) === "2026-09-30" && localDay(Date.parse("2026-10-01T04:00:00Z")) === "2026-10-01"
      && localDay(Date.parse("2026-12-01T04:59:59Z")) === "2026-11-30" && localDay(Date.parse("2026-12-01T05:00:00Z")) === "2026-12-01"
      && monthOf("2026-09-30") === "2026-09-01" && monthOf("2026-10-01") === "2026-10-01");
}

{
  // SA112: the purge of preflight requests.
  const s = await s62World();
  const ask = async () => requestIdOf(await post(s.w, "/new/price", s.runner, newRunFields()));
  const refusedOld = await ask();
  s.w.store.answerPreflight(refusedOld, { refused: { refusalClass: "params_mismatch", message: "m" } });
  const quotedUnused = await ask();
  s.w.store.answerPreflight(quotedUnused, { quote: { ceilingMicros: CEILING } });
  const consumedOld = await ask();
  const consumedQuote = s.w.store.answerPreflight(consumedOld, { quote: { ceilingMicros: CEILING } })!;
  const confirmed = await post(s.w, `/quotes/${consumedQuote}/confirm`, s.runner);
  const unanswered = await ask();
  s.w.clock.now += 31 * 24 * 3_600_000;
  // (The sessions have expired by now; a request made today is written as the route writes it.)
  const { requestId: recent } = await s.w.store.createPreflightRequest(preflightRequest({ userId: s.runnerUser.id, action: "full",
    goal: "recent", platforms: ["instagram"], scopeTags: null, sourceRunId: null, factVersionId: s.factVersion }));
  const purged = await s.w.app.purge().catch(() => ({ loginAttempts: -1, sessions: -1, preflightRequests: -1 }));
  check("SA112. the purge deletes preflight requests older than 30 days on which no consumed quote depends — refused, "
    + "unanswered, or quoted but never confirmed — and keeps one whose quote was consumed and every request inside 30 days",
    confirmed.status === 303 && purged.preflightRequests === 3 && !s.w.store.preflight.has(refusedOld) && !s.w.store.preflight.has(quotedUnused)
      && !s.w.store.preflight.has(unanswered) && s.w.store.preflight.has(consumedOld) && s.w.store.preflight.has(recent)
      && preflightPurgeable({ pastRetention: true, quoteConsumed: false }) && !preflightPurgeable({ pastRetention: true, quoteConsumed: true })
      && !preflightPurgeable({ pastRetention: false, quoteConsumed: false }),
    `${JSON.stringify(purged)}`);
  await s.w.close();
}

{
  // SA113: actions from a run's report.
  const s = await s62World();
  // (Live source runs: since Content Studio S7.2 a fake run offers no derived action — SA116.)
  const succeeded = s.w.store.addRun(s.w.owner, { runner: "live", platforms: ["instagram", "facebook"], scope_tags: ["synthetic-tag-a"],
    fact_version_id: s.factVersion, goal: "Synthetic source goal" });
  const failed = s.w.store.addRun(s.w.owner, { runner: "live", state: "failed", platforms: ["instagram"], fact_version_id: s.factVersion });
  for (const name of ["run-meta.json", "01-strategy-concept.json", "02-automotive-truth.json", "03-hook-story-script.json", "04-production-direction.json"]) {
    s.w.store.addArtifact(failed.id, name, "{}");
  }
  const noVersion = s.w.store.addRun(s.w.owner, { runner: "live", platforms: ["instagram"], fact_version_id: null });
  const asRunner = await request(s.w, `/runs/${succeeded.id}`, { jar: s.runner });
  const asViewer = await request(s.w, `/runs/${succeeded.id}`, { jar: s.viewer });
  const failedPage = await request(s.w, `/runs/${failed.id}`, { jar: s.runner });
  const noVersionPage = await request(s.w, `/runs/${noVersion.id}`, { jar: s.runner });
  const revise = await post(s.w, `/runs/${succeeded.id}/price`, s.runner, [["action", "revise"]]);
  const row = s.w.store.preflight.get(requestIdOf(revise));
  const notOffered = await post(s.w, `/runs/${succeeded.id}/price`, s.runner, [["action", "resume_packaging"]]);
  const viewerAsks = await post(s.w, `/runs/${succeeded.id}/price`, s.viewer, [["action", "revise"]]);
  check("SA113. a succeeded run's report offers Revise and Critic replay to a runner (none to a viewer); a run that failed "
    + "at stage 5 offers Resume from packaging; a run with no fact version offers none; Revise asks a price for the source "
    + "run's own platforms, scope and fact version, with no goal; an action not offered is refused (409), and a viewer's (403)",
    asRunner.body.includes('value="revise"') && asRunner.body.includes('value="replay_critic"') && !asRunner.body.includes('value="resume_packaging"')
      && !asViewer.body.includes('name="action"') && failedPage.body.includes('value="resume_packaging"')
      && !noVersionPage.body.includes('name="action"') && revise.status === 303 && row?.action === "revise" && row.goal === null
      && row.sourceRunId === succeeded.id && row.platforms.join() === "instagram,facebook" && row.scopeTags?.join() === "synthetic-tag-a"
      && row.factVersionId === s.factVersion && row.paramsSha256 === preflightParamsSha256(row)
      && notOffered.status === 409 && viewerAsks.status === 403,
    `${revise.status} ${notOffered.status} ${viewerAsks.status}`);
  await s.w.close();
}

{
  // SA114: hostile text stays inert on every S6.2 page.
  const s = await s62World();
  const hostile = '<script>alert(1)</script>"\'><img src=x onerror=alert(2)>';
  const asked = await post(s.w, "/new/price", s.runner, newRunFields(`${hostile}[goal]`));
  const id = requestIdOf(asked);
  const plan = { kind: "revision", startStage: `${hostile}[stage]`, stages: [{ stage: `${hostile}[stage]`, cap: 5, owned: 1, blocking: 1,
    sent: [{ id: "f0", lens: `${hostile}[lens]`, severity: "blocking", category: "production_coherence", issue: `${hostile}[issue]`,
      suggestedAction: `${hostile}[action]` }], dropped: [] }], ownerItems: [{ id: "f1", lens: "x", severity: "advisory", owner: "human_review",
    category: "human_decision", issue: `${hostile}[owner-item]` }], notRerun: [] };
  s.w.store.answerPreflight(id, { quote: { ceilingMicros: CEILING, breakdown: [{ item: `${hostile}[item]`, unit: "critic-panel",
    ceilingUsd: `${hostile}[usd]`, lines: [{ label: `${hostile}[label]`, model: `${hostile}[model]`, maxTokens: `${hostile}[tokens]` }] }] } }, plan);
  const quotePage = await request(s.w, `/preflights/${id}`, { jar: s.runner });
  const refusedId = requestIdOf(await post(s.w, "/new/price", s.runner, newRunFields()));
  s.w.store.answerPreflight(refusedId, { refused: { refusalClass: "stage_execution_error", message: `${hostile}[refusal]` } });
  const refusalPage = await request(s.w, `/preflights/${refusedId}`, { jar: s.runner });
  const inert = (html: string) => !html.includes(hostile) && !/<img\b/i.test(html) && (html.match(/<script\b/g) ?? []).length === 1;
  const fields = ["goal", "stage", "lens", "issue", "action", "owner-item", "item", "usd", "label", "model", "tokens"];
  check("SA114. hostile text stays inert on every S6.2 page: the goal, the revise plan's text, every quote line and a "
    + "refusal's message are escaped text, never markup",
    inert(quotePage.body) && inert(refusalPage.body) && fields.every((f) => quotePage.body.includes(`${escapeHtml(hostile)}[${f}]`))
      && refusalPage.body.includes(`${escapeHtml(hostile)}[refusal]`),
    fields.filter((f) => !quotePage.body.includes(`${escapeHtml(hostile)}[${f}]`)).join());
  await s.w.close();
}

{
  // SA115: logs and the cap's mutation-proof pure decisions.
  const quoteSnap = (edit: (s: ConfirmSnapshot) => void = () => {}): ConfirmSnapshot => {
    const now = Date.UTC(2026, 9, 5, 16);
    const snap: ConfirmSnapshot = {
      // (S7.3, by fact: the runner's cap is the daily ceiling — a runner with none is cap_missing. Until S7.3: null.)
      nowMs: now, user: { id: "u", role: "runner", status: "active", dailyCapMicros: 75_000_000, updatedAtMs: now - 60_000 },
      quote: { id: "q", userId: "u", action: "full", paramsSha256: "p", workerCommit: "c", approvedFactsSha256: "a", factVersionId: "fv",
        priceTableSha256: "t", ceilingMicros: 21_650_000, createdAtMs: now - 1_000, expiresAtMs: now + 60_000, consumed: false },
      request: { action: "full", paramsSha256: "p", factVersionId: "fv", sourceRunId: null }, sourceAvailable: false,
      heartbeat: { commit: "c", approvedFactsSha256: "a", priceTableSha256: "t", beatAtMs: now }, currentFactVersionId: "fv",
      settings: { dailyCapMicros: 50_000_000, monthlyCapMicros: 200_000_000 }, ceilings: { dailyMicros: 75_000_000, monthlyMicros: 300_000_000 },
      spend: { dayMicros: 0, monthMicros: 0, userDayMicros: 0 }, unacknowledgedOverruns: 0,
    };
    edit(snap);
    return snap;
  };
  const of = (s: ConfirmSnapshot) => { const d = decideConfirm(s); return d.ok ? "ok" : d.refusal; };
  const edges: Array<[string, string]> = [
    [of(quoteSnap()), "ok"],
    [of(quoteSnap((s) => { s.spend.dayMicros = 50_000_000 - 21_650_000; })), "ok"],
    [of(quoteSnap((s) => { s.spend.dayMicros = 50_000_000 - 21_650_000 + 1; })), "cap_exceeded_daily"],
    [of(quoteSnap((s) => { s.spend.monthMicros = 200_000_000 - 21_650_000 + 1; })), "cap_exceeded_monthly"],
    [of(quoteSnap((s) => { s.ceilings.dailyMicros = 21_650_000 - 1; })), "cap_exceeded_daily"],
    [of(quoteSnap((s) => { s.ceilings.monthlyMicros = 0; })), "cap_exceeded_monthly"],
    [of(quoteSnap((s) => { s.settings = null; })), "cap_exceeded_daily"],
    [of(quoteSnap((s) => { s.user!.dailyCapMicros = 25_000_000; s.spend.userDayMicros = 3_350_001; })), "cap_exceeded_user_daily"],
    [of(quoteSnap((s) => { s.user!.dailyCapMicros = 25_000_000; s.spend.userDayMicros = 3_350_000; })), "ok"],
    [of(quoteSnap((s) => { s.request!.sourceRunId = "src"; s.sourceAvailable = false; })), "source_unavailable"],
    [of(quoteSnap((s) => { s.request!.paramsSha256 = "other"; })), "quote_unmatched"],
    [of(quoteSnap((s) => { s.nowMs = s.quote!.expiresAtMs; s.heartbeat!.beatAtMs = s.nowMs; })), "ok"],
  ];
  const wrong = edges.map(([got, want], i) => (got === want ? "" : `#${i} ${got}≠${want}`)).filter(Boolean);
  check("SA115. the confirmation's cap arithmetic is exact at its edges: a ceiling that exactly fits what remains of the "
    + "day's, the month's or the user's cap is confirmed and one micro-dollar more is refused; a deployment ceiling below "
    + "the owner's cap, a zero ceiling and an unreadable settings row each refuse; a quote at its expiry instant is accepted",
    wrong.length === 0, wrong.join("; "));
}

// =====================================================================================================
// Content Studio S7.2: fact versions, the fact check, imports, the whole-run bundle and the fake source
// (design §8.2 item 8, §8.5, §8.6, §9.1)
// =====================================================================================================

const sha256Of = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const bundleText = (files: Array<[string, Buffer]>, edit: (entry: Record<string, string>, i: number) => void = () => {}) =>
  JSON.stringify({ schema: RUN_BUNDLE_SCHEMA, files: files.map(([name, content], i) => {
    const entry: Record<string, string> = { name, sha256: sha256Of(content), base64: content.toString("base64") };
    edit(entry, i);
    return entry;
  }) });
const uploadText = (bytes: Buffer, sha = sha256Of(bytes)) => JSON.stringify({ sha256: sha, base64: bytes.toString("base64") });
/** A synthetic run folder: run-meta.json with its runner, and stage files whose bytes are awkward on purpose. */
const s72Folder = (runner = "live", extra: Record<string, string> = {}): Array<[string, Buffer]> => [
  ["run-meta.json", Buffer.from(JSON.stringify({ schema: "gcd-content-run-meta/1", goal: "Synthetic S7.2 goal", runner,
    approvedFacts: { path: "/Users/synthetic-owner/private/config/approved-facts.json", sha256: "a".repeat(64) },
    automotiveFacts: { path: "/Users/synthetic-owner/private/automotive-facts.local.json", present: true, sha256: "b".repeat(64) }, ...extra }), "utf8")],
  ["01-strategy-concept.json", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{\r\n  \"output\": {}\r\n}\r\n")])],
  ["summary.md", Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a])],
];
const sendDocument = (w: World, path: string, jar: Jar, document: string) => post(w, path, jar, [["document", document]]);

{
  // SA116: a fake source is refused by name before any quote; the report offers no derived action on a fake run.
  const s = await s62World();
  const fakeRun = s.w.store.addRun(s.w.owner, { runner: "fake", platforms: ["instagram"], fact_version_id: s.factVersion });
  const fakeImport = s.w.store.addRun(s.w.owner, { kind: "imported", runner: "fake", import_tier: "verified", platforms: ["instagram"],
    fact_version_id: s.factVersion });
  const liveRun = s.w.store.addRun(s.w.owner, { runner: "live", platforms: ["instagram"], fact_version_id: s.factVersion });
  const pages = await Promise.all([fakeRun, fakeImport].map((r) => request(s.w, `/runs/${r.id}`, { jar: s.owner })));
  const before = { preflight: s.w.store.preflight.size, jobs: s.w.store.jobs.size, calls: s.w.store.calls.filter((c) => c === "createPreflightRequest").length };
  const asks = [
    await post(s.w, `/runs/${fakeRun.id}/price`, s.owner, [["action", "revise"]]),
    await post(s.w, `/runs/${fakeRun.id}/price`, s.runner, [["action", "replay_critic"]]),
    await post(s.w, `/runs/${fakeImport.id}/price`, s.owner, [["action", "revise"]]),
  ];
  const after = { preflight: s.w.store.preflight.size, jobs: s.w.store.jobs.size, calls: s.w.store.calls.filter((c) => c === "createPreflightRequest").length };
  const livePage = await request(s.w, `/runs/${liveRun.id}`, { jar: s.runner });
  check("SA116. a fake run — a Studio fake run, or an import of a fake CLI run, verified or not — offers no Revise or "
    + "Critic replay on its report, and its price request is refused BY NAME (409, fake_source) before anything is written: "
    + "no preflight request, no job, the store never asked; a live run still offers them",
    pages.every((p) => p.status === 200 && !p.body.includes('name="action"'))
      && asks.every((r) => r.status === 409 && r.body.includes("<code>fake_source</code>")) && JSON.stringify(before) === JSON.stringify(after)
      && sourceActions({ ...liveRun, runner: "fake" }, null).length === 0 && sourceActions(liveRun, null).join() === "revise,replay_critic"
      && livePage.body.includes('value="revise"'),
    `${asks.map((r) => r.status).join()} ${JSON.stringify(before)} ${JSON.stringify(after)}`);
  await s.w.close();
}

{
  // SA117-SA119: the codecs, pure.
  const folder = s72Folder();
  const ok = decodeRunBundle(Buffer.from(bundleText(folder)));
  const refusalOfBundle = (text: string | Buffer) => { const d = decodeRunBundle(Buffer.isBuffer(text) ? text : Buffer.from(text)); return d.ok ? "accepted" : d.refusal; };
  const overGarbage = Buffer.alloc(IMPORT_MAX_DOCUMENT_BYTES + 1, 0x7b);
  const overJson = Buffer.from(bundleText([["run-meta.json", Buffer.alloc(Math.ceil(IMPORT_MAX_DOCUMENT_BYTES * 0.76), 0x41)]]));
  const twentyOne = JSON.stringify({ schema: RUN_BUNDLE_SCHEMA, files: Array.from({ length: IMPORT_MAX_FILES + 1 },
    (_, i) => ({ name: STUDIO_IMPORT_FILE_NAMES[i % 16], sha256: sha256Of("x"), base64: "eA==" })) });
  const cases: Array<[string, string]> = [
    ["accepted", ok.ok && ok.value.every((f, i) => f.name === folder[i]![0] && f.content.equals(folder[i]![1])) ? "accepted" : "wrong"],
    ["sha_mismatch", refusalOfBundle(bundleText(folder, (e, i) => { if (i === 1) e.sha256 = sha256Of("other"); }))],
    ["sha_mismatch", refusalOfBundle(bundleText(folder, (e, i) => { if (i === 1) e.sha256 = e.sha256!.toUpperCase(); }))],
    ["unknown_name", refusalOfBundle(bundleText([...folder, ["notes.txt", Buffer.from("x")]]))],
    ["unknown_name", refusalOfBundle(bundleText([["../run-meta.json", Buffer.from("x")]]))],
    ["duplicate_name", refusalOfBundle(bundleText([...folder, ["summary.md", Buffer.from("x")]]))],
    ["too_many_files", refusalOfBundle(twentyOne)],
    ["invalid_base64", refusalOfBundle(bundleText(folder, (e, i) => { if (i === 2) e.base64 = `${e.base64!.slice(0, -1)} `; }))],
    ["invalid_base64", refusalOfBundle(bundleText([["summary.md", Buffer.from("A")]], (e) => { e.base64 = "QR=="; }))],
    ["too_large", refusalOfBundle(overGarbage)],
    ["too_large", refusalOfBundle(overJson)],
    ["invalid_bundle", refusalOfBundle(JSON.stringify({ schema: RUN_BUNDLE_SCHEMA, files: [], extra: 1 }))],
    ["invalid_bundle", refusalOfBundle(JSON.stringify({ schema: "other/1", files: [] }))],
    ["no_files", refusalOfBundle(JSON.stringify({ schema: RUN_BUNDLE_SCHEMA, files: [] }))],
    ["invalid_json", refusalOfBundle(Buffer.from([0x7b, 0xff, 0x7d]))],
  ];
  const wrong = cases.filter(([want, got]) => want !== got).map(([want, got]) => `${want}≠${got}`);
  check("SA117. the import document is decoded strictly: its 10 MiB bound checked BEFORE it is parsed (10 MiB and a byte of "
    + "garbage is too_large, never invalid_json), at most twenty files, then each name one of the CLI's known files and named "
    + "once, each base64 canonical, each sha256 recomputed and equal (lower-case hex only), and nothing else in the document; "
    + "a valid one decodes byte for byte (a byte-order mark, CRLF and invalid UTF-8 kept)",
    wrong.length === 0, wrong.join("; "));

  const encoded = encodeRunBundle([...folder].reverse().map(([name, content]) => ({ name, content })));
  const round = encoded.ok ? decodeRunBundle(encoded.value) : null;
  const tooLarge = encodeRunBundle([{ name: "rejected-responses.json", content: Buffer.alloc(8 * 1024 * 1024, 0x41) }]);
  const foreign = encodeRunBundle([{ name: "notes.txt", content: Buffer.from("x") }]);
  check("SA118. the whole-run bundle is exactly the import's format — the schema and every file by name, sorted, with its "
    + "sha256 and base64 — so it decodes back byte for byte; a bundle over 10 MiB is refused with its reason ('too large to "
    + "re-import'), and a run holding a file the import refuses is offered no bundle",
    encoded.ok && round !== null && round.ok && round.value.map((f) => f.name).join() === [...folder].map(([n]) => n).sort().join()
      && round.value.every((f) => f.content.equals(folder.find(([n]) => n === f.name)![1]))
      && JSON.parse(encoded.value.toString("utf8")).schema === RUN_BUNDLE_SCHEMA
      && !tooLarge.ok && tooLarge.refusal === "bundle_too_large" && tooLarge.message.includes(BUNDLE_TOO_LARGE)
      && BUNDLE_TOO_LARGE === "too large to re-import" && !foreign.ok && foreign.refusal === "bundle_not_importable",
    `${JSON.stringify(tooLarge).slice(0, 160)}`);

  const facts = Buffer.from(JSON.stringify({ facts: [] }));
  const up = (text: string) => { const d = decodeFactUpload(Buffer.from(text)); return d.ok ? `ok:${d.value.sha256}` : d.refusal; };
  const field = (form: URLSearchParams) => { const d = documentField(form); return d.ok ? "ok" : d.refusal; };
  const uploads: Array<[string, string]> = [
    [`ok:${sha256Of(facts)}`, up(uploadText(facts))],
    ["sha_mismatch", up(uploadText(facts, sha256Of("other")))],
    ["empty_file", up(uploadText(Buffer.alloc(0)))],
    ["too_large", up(uploadText(Buffer.alloc(FACT_UPLOAD_MAX_BYTES + 1, 0x20)))],
    ["invalid_base64", up(JSON.stringify({ sha256: sha256Of(facts), base64: "%%%" }))],
    ["invalid_upload", up(JSON.stringify({ sha256: sha256Of(facts), base64: facts.toString("base64"), name: "x" }))],
    ["too_large", up(" ".repeat(FACT_UPLOAD_MAX_DOCUMENT_BYTES + 1))],
    ["invalid_document", field(new URLSearchParams())],
    ["invalid_document", field(new URLSearchParams([["document", "a"], ["document", "b"]]))],
    ["ok", field(new URLSearchParams([["document", "a"]]))],
  ];
  const wrongUploads = uploads.filter(([want, got]) => want !== got).map(([want, got]) => `${want}≠${got}`);
  check("SA119. a fact upload is decoded strictly: exactly a sha256 and canonical base64 content of 1 byte to 1 MiB, the "
    + "sha256 recomputed and equal, the document bounded before it is parsed; and the form carries exactly one document",
    wrongUploads.length === 0 && FACT_UPLOAD_MAX_FORM_BYTES >= 3 * FACT_UPLOAD_MAX_DOCUMENT_BYTES, wrongUploads.join("; "));
}

{
  // SA120: every S7.2 owner route is refused to a runner and a viewer at the route, before the store; viewers read versions and bundles.
  const s = await s62World();
  const versionId = s.factVersion;
  const run = s.w.store.addRun(s.w.owner, { runner: "live", platforms: ["instagram"] });
  for (const [name, content] of s72Folder()) s.w.store.addArtifact(run.id, name, content);
  const ownerRoutes: Array<[string, string]> = [["GET", "/facts/upload"], ["POST", "/facts/upload"], ["GET", `/facts/checks/${randomUUIDv4()}`],
    ["POST", `/facts/versions/${versionId}/activate`], ["POST", `/facts/versions/${versionId}/retire`], ["POST", `/facts/versions/${versionId}/restore`],
    ["GET", `/facts/versions/${versionId}/file`], ["GET", "/imports/new"], ["POST", "/imports"]];
  const callsBefore = s.w.store.calls.length;
  const actorsBefore = s.w.store.declaredActors.length;
  const replies: number[] = [];
  for (const jar of [s.runner, s.viewer]) {
    for (const [method, path] of ownerRoutes) {
      replies.push((method === "GET" ? await request(s.w, path, { jar }) : await sendDocument(s.w, path, jar, uploadText(Buffer.from("{}")))).status);
    }
  }
  const touched = s.w.store.calls.slice(callsBefore).filter((c) => c !== "findSession");
  const versionsAsViewer = await request(s.w, "/facts", { jar: s.viewer });
  const bundleAsViewer = await request(s.w, `/runs/${run.id}/bundle`, { jar: s.viewer });
  check("SA120. a runner and a viewer are refused (403) at the route on every S7.2 owner route — the upload page and post, "
    + "a check's result, activate, retire, restore, a version's bytes, the import page and post — before the store is "
    + "touched (no read, no staged bytes, no declared actor); a viewer reads the versions list, with no download link or "
    + "action, and downloads the whole-run bundle",
    replies.every((status) => status === 403) && touched.length === 0 && s.w.store.declaredActors.length === actorsBefore
      && s.w.store.staged === null && versionsAsViewer.status === 200 && !versionsAsViewer.body.includes("/file")
      && !versionsAsViewer.body.includes("<form method=\"post\" action=\"/facts/versions") && bundleAsViewer.status === 200,
    `${replies.join()} ${touched.join()} ${versionsAsViewer.status} ${bundleAsViewer.status}`);
  await s.w.close();
}

{
  // SA121: the upload, through the route: staged with its check; refusals write nothing; one check at a time.
  const s = await s62World();
  const facts = Buffer.from(JSON.stringify({ facts: [{ id: "synthetic-sa121" }] }));
  const badSha = await sendDocument(s.w, "/facts/upload", s.owner, uploadText(facts, sha256Of("other")));
  const tooLarge = await sendDocument(s.w, "/facts/upload", s.owner, uploadText(Buffer.alloc(FACT_UPLOAD_MAX_BYTES + 1, 0x20)));
  // Over the route's own bound the body is never read to its end: a 413, or the connection closed mid-upload.
  const overRoute = await request(s.w, "/facts/upload", { method: "POST", jar: s.owner, headers: { origin: ORIGIN,
    "content-type": "application/x-www-form-urlencoded" }, body: `csrf=x&document=${"a".repeat(FACT_UPLOAD_MAX_FORM_BYTES)}` })
    .catch(() => ({ status: 413 }));
  const nothingYet = s.w.store.staged === null && s.w.store.factChecks.size === 0;
  const uploaded = await sendDocument(s.w, "/facts/upload", s.owner, uploadText(facts));
  const checkId = /^\/facts\/checks\/([0-9a-f-]{36})$/.exec(uploaded.location ?? "")?.[1] ?? "";
  const pending = await request(s.w, `/facts/checks/${checkId}`, { jar: s.owner });
  const second = await sendDocument(s.w, "/facts/upload", s.owner, uploadText(Buffer.from("{\"facts\":[]}")));
  check("SA121. the owner's upload is staged byte for byte with its fact check and job (303 to the check's page, which polls "
    + "while the worker works), the actor declared; a sha256 mismatch (400), a file over 1 MiB (413) and a body over the "
    + "route's own bound (413) each write nothing; and a second upload while a check is pending is refused (409, check_pending)",
    badSha.status === 400 && badSha.body.includes("<code>sha_mismatch</code>") && tooLarge.status === 413 && overRoute.status === 413
      && nothingYet && uploaded.status === 303 && s.w.store.staged?.content.equals(facts) === true && s.w.store.staged.sha256 === sha256Of(facts)
      && s.w.store.factChecks.get(checkId)?.outcome === null && s.w.store.declaredActors.at(-1)?.actor === s.w.owner.id
      && pending.status === 200 && pending.body.includes(`<meta http-equiv="refresh" content="5">`)
      && second.status === 409 && second.body.includes("<code>check_pending</code>") && s.w.store.factChecks.size === 1,
    `${badSha.status} ${tooLarge.status} ${overRoute.status} ${uploaded.status} ${second.status}`);

  // SA122 (part): the check's result page — refusal, acceptance, warnings — escaped.
  s.w.store.answerFactCheck(checkId, { refused: { refusalClass: "loader_refused", message: `${HOSTILE}[loader message]` } }, [`facts[].${HOSTILE}`]);
  const refusedPage = await request(s.w, `/facts/checks/${checkId}`, { jar: s.owner });
  const accepted = await sendDocument(s.w, "/facts/upload", s.owner, uploadText(Buffer.from("{\"facts\":[1]}")));
  const acceptedId = /^\/facts\/checks\/([0-9a-f-]{36})$/.exec(accepted.location ?? "")?.[1] ?? "";
  s.w.store.answerFactCheck(acceptedId, { accepted: { recordCount: 70, tagCounts: { [`${HOSTILE}[tag]`]: 3 }, overCap: true } }, ["exportedBy"]);
  const acceptedPage = await request(s.w, `/facts/checks/${acceptedId}`, { jar: s.owner });
  check("SA122. the check's page shows a refusal's class and the loader's message, or the acceptance with its counts, its tag "
    + "counts, the over-cap warning and the unknown field names — every one escaped; it stops polling once answered",
    refusedPage.status === 200 && !refusedPage.body.includes(HOSTILE) && refusedPage.body.includes(escapeHtml(`${HOSTILE}[loader message]`))
      && refusedPage.body.includes(escapeHtml(`facts[].${HOSTILE}`)) && !refusedPage.body.includes("http-equiv=\"refresh\"")
      && acceptedPage.body.includes("70 records") && acceptedPage.body.includes("an unscoped run will be refused")
      && acceptedPage.body.includes("<code>exportedBy</code>") && !acceptedPage.body.includes(HOSTILE)
      && acceptedPage.body.includes(escapeHtml(`${HOSTILE}[tag]`)),
    `${refusedPage.status} ${acceptedPage.status}`);
  await s.w.close();
}

{
  // SA123: versions: activate, retire and restore, each one owner edit with its actor and audit row; never the active one retired.
  const s = await s62World();
  const active = s.factVersion;
  const other = s.w.store.addFactVersion({ "synthetic-tag-c": 1 }, false);
  const page = await request(s.w, "/facts", { jar: s.owner });
  const retireActive = await post(s.w, `/facts/versions/${active}/retire`, s.owner);
  const stillActive = s.w.store.factVersions.get(active)?.status === "active" && s.w.store.settings?.activeFactVersionId === active;
  const audits = () => s.w.store.auditLog.filter((a) => a.action === "settings.update" || a.action === "fact_version.status")
    .map((a) => `${a.action}:${a.actorUserId === s.w.owner.id ? "owner" : "other"}`);
  const activate = await post(s.w, `/facts/versions/${other}/activate`, s.owner);
  const retire = await post(s.w, `/facts/versions/${active}/retire`, s.owner);
  const activateRetired = await post(s.w, `/facts/versions/${active}/activate`, s.owner);
  const restore = await post(s.w, `/facts/versions/${active}/restore`, s.owner);
  const noChange = await post(s.w, `/facts/versions/${active}/restore`, s.owner);
  const actors = s.w.store.declaredActors.map((d) => `${d.edit}:${d.actor === s.w.owner.id ? "owner" : "other"}`);
  const activeRow = page.body.split("<li class=\"version\">").find((li) => li.includes("ACTIVE")) ?? "";
  check("SA123. the owner activates, retires and restores versions — each one edit declaring the owner as its actor and "
    + "audited by that actor (settings.update, fact_version.status) — the versions page never offers retiring the active "
    + "version and the store refuses it anyway (409, nothing changed); a retired version is restored before it is made "
    + "active (409), and an edit that changes nothing is refused (409)",
    retireActive.status === 409 && stillActive && activate.status === 303 && retire.status === 303 && activateRetired.status === 409
      && restore.status === 303 && noChange.status === 409 && s.w.store.settings?.activeFactVersionId === other
      && s.w.store.factVersions.get(active)?.status === "active"
      && audits().join() === "settings.update:owner,fact_version.status:owner,fact_version.status:owner"
      && actors.every((a) => a.endsWith(":owner")) && actors.length === 6
      && activeRow.length > 0 && !activeRow.includes("/retire") && !activeRow.includes("/activate") && page.body.includes(`/facts/versions/${other}/retire`),
    `${retireActive.status} ${activate.status} ${retire.status} ${activateRetired.status} ${restore.status} ${noChange.status} ${audits().join()} ${actors.join()}`);

  // SA124: a version's bytes are the owner's alone, as an attachment.
  const bytes = Buffer.from(JSON.stringify({ facts: [], synthetic: "sa124" }));
  const versionId = s.w.store.addFactVersion({}, false);
  s.w.store.factVersions.get(versionId)!.sha256 = sha256Of(bytes);
  s.w.store.versionBytes.set(versionId, { content: bytes, uploadedBy: s.w.owner.id, statusChangedAt: null });
  const asOwner = await request(s.w, `/facts/versions/${versionId}/file`, { jar: s.owner });
  const asRunner = await request(s.w, `/facts/versions/${versionId}/file`, { jar: s.runner });
  const asViewer = await request(s.w, `/facts/versions/${versionId}/file`, { jar: s.viewer });
  const name = `automotive-facts-${sha256Of(bytes).slice(0, 12)}.json`;
  check("SA124. only the owner downloads a version's bytes — exactly as stored, as an attachment with S5's exact download "
    + "headers — and a runner or a viewer is refused (403) without the bytes being read",
    asOwner.status === 200 && asOwner.raw.equals(bytes)
      && JSON.stringify([...asOwner.headers.entries()].filter(([k]) => k !== "date" && k !== "connection" && k !== "keep-alive" && k !== "transfer-encoding").sort())
        === JSON.stringify(Object.entries(downloadHeaders(name, bytes.length)).sort())
      && asRunner.status === 403 && asViewer.status === 403 && !asRunner.raw.includes(bytes) && !asViewer.raw.includes(bytes),
    `${asOwner.status} ${asRunner.status} ${asViewer.status} ${[...asOwner.headers.keys()].join()}`);
  await s.w.close();
}

{
  // SA125-SA127: the import route, the bundle download and its byte-for-byte re-import.
  const s = await s62World();
  const tally = () => ({ runs: s.w.store.runs.size, jobs: s.w.store.jobs.size, actors: s.w.store.declaredActors.length });
  const folder = s72Folder();
  const before = tally();
  const refusals = [
    await sendDocument(s.w, "/imports", s.owner, bundleText(folder, (e, i) => { if (i === 0) e.sha256 = sha256Of("x"); })),
    await sendDocument(s.w, "/imports", s.owner, bundleText([...folder, ["notes.txt", Buffer.from("x")]])),
    await sendDocument(s.w, "/imports", s.owner, JSON.stringify({ schema: RUN_BUNDLE_SCHEMA, files: Array.from({ length: 21 },
      (_, i) => ({ name: STUDIO_IMPORT_FILE_NAMES[i % 16], sha256: sha256Of("x"), base64: "eA==" })) })),
    await sendDocument(s.w, "/imports", s.owner, `${bundleText(folder)}${" ".repeat(IMPORT_MAX_DOCUMENT_BYTES)}`),
  ];
  const unchanged = JSON.stringify(tally()) === JSON.stringify(before);
  const created = await sendDocument(s.w, "/imports", s.owner, bundleText(folder));
  const runId = /^\/runs\/([0-9a-f-]{36})$/.exec(created.location ?? "")?.[1] ?? "";
  const imported = s.w.store.runs.get(runId);
  const job = [...s.w.store.jobs.values()].find((j) => j.runId === runId);
  check("SA125. the owner's import creates, in one edit declaring the owner, the queued import run (its runner from its "
    + "metadata), every file byte for byte and its queued import job; a sha256 mismatch, an unknown name and more than twenty "
    + "files (400) and a document over 10 MiB (413) are each refused with nothing written",
    refusals.map((r) => r.status).join() === "400,400,400,413" && refusals[0]!.body.includes("<code>sha_mismatch</code>")
      && refusals[1]!.body.includes("<code>unknown_name</code>") && refusals[2]!.body.includes("<code>too_many_files</code>")
      && refusals[3]!.body.includes("<code>too_large</code>") && unchanged
      && created.status === 303 && imported?.kind === "imported" && imported.state === "queued" && imported.runner === "live"
      && job?.kind === "import" && job.state === "queued" && s.w.store.declaredActors.at(-1)?.edit === "createImport"
      && folder.every(([name, content]) => s.w.store.artifacts.get(runId)?.get(name)?.content.equals(content) === true)
      && importRunner(s72Folder("fake").map(([name, content]) => ({ name, content }))) === "fake"
      && importRunner([...s72Folder(), ["revision-meta.json", Buffer.from("{\"runner\":\"fake\"}")] as [string, Buffer]].map(([name, content]) => ({ name, content }))) === "fake"
      && importRunner(folder.slice(1).map(([name, content]) => ({ name, content }))) === "fake",
    `${refusals.map((r) => r.status).join()} ${unchanged} ${created.status} ${imported?.runner}`);

  const download = await request(s.w, `/runs/${runId}/bundle`, { jar: s.viewer });
  const reimport = await sendDocument(s.w, "/imports", s.owner, download.raw.toString("utf8"));
  const reimportId = /^\/runs\/([0-9a-f-]{36})$/.exec(reimport.location ?? "")?.[1] ?? "";
  const same = [...(s.w.store.artifacts.get(runId)?.values() ?? [])].every((a) =>
    s.w.store.artifacts.get(reimportId)?.get(a.name)?.content.equals(a.content) === true)
    && s.w.store.artifacts.get(reimportId)?.size === s.w.store.artifacts.get(runId)?.size;
  const bundleName = `run-${runId}.json`;
  const headerSet = JSON.stringify([...download.headers.entries()].filter(([k]) => !["date", "connection", "keep-alive", "transfer-encoding"].includes(k)).sort());
  const big = s.w.store.addRun(s.w.owner, { runner: "live" });
  s.w.store.addArtifact(big.id, "rejected-responses.json", Buffer.alloc(8 * 1024 * 1024, 0x41));
  const bigReply = await request(s.w, `/runs/${big.id}/bundle`, { jar: s.viewer });
  const tampered = s.w.store.addRun(s.w.owner, { runner: "live" });
  s.w.store.addArtifact(tampered.id, "summary.md", "stored", Buffer.from("other"));
  const tamperedReply = await request(s.w, `/runs/${tampered.id}/bundle`, { jar: s.viewer });
  check("SA126. the whole-run download is one JSON bundle in exactly the import's format, viewer-readable, with S5's exact "
    + "attachment headers (application/json, nosniff, the sandboxing CSP); it re-imports BYTE FOR BYTE; a bundle over 10 MiB "
    + "is refused with its reason (409, 'too large to re-import'), and a file failing its sha256 serves no bundle (500)",
    download.status === 200 && headerSet === JSON.stringify(Object.entries(downloadHeaders(bundleName, download.raw.length)).sort())
      && reimport.status === 303 && reimportId !== runId && same
      && bigReply.status === 409 && bigReply.body.includes("too large to re-import") && tamperedReply.status === 500,
    `${download.status} ${reimport.status} ${same} ${bigReply.status} ${tamperedReply.status}`);

  // SA127: lineage — proven, ambiguous, absent.
  const source = s.w.store.runs.get(runId)!;
  source.fact_version_id = s.factVersion;
  const critic = Buffer.from("{\"output\":{\"synthetic\":\"round 1 critic\"}}");
  s.w.store.addArtifact(runId, "06-final-critic.json", critic);
  const revised: Array<[string, Buffer]> = [["run-meta.json", folder[0]![1]], ["round-1-06-final-critic.json", critic],
    ["revision-meta.json", Buffer.from("{\"runner\":\"live\",\"sourceRunDir\":\"/Users/synthetic-owner/local-output/round-1\"}")]];
  const proven = await sendDocument(s.w, "/imports", s.owner, bundleText(revised));
  const provenRun = s.w.store.runs.get(/^\/runs\/([0-9a-f-]{36})$/.exec(proven.location ?? "")?.[1] ?? "");
  const absent = await sendDocument(s.w, "/imports", s.owner, bundleText([revised[0]!, ["round-1-06-final-critic.json", Buffer.from("{}")]]));
  const absentRun = s.w.store.runs.get(/^\/runs\/([0-9a-f-]{36})$/.exec(absent.location ?? "")?.[1] ?? "");
  const twin = await sendDocument(s.w, "/imports", s.owner, bundleText([...folder, ["06-final-critic.json", critic]]));
  void twin;
  const ambiguous = await sendDocument(s.w, "/imports", s.owner, bundleText(revised));
  const ambiguousRun = s.w.store.runs.get(/^\/runs\/([0-9a-f-]{36})$/.exec(ambiguous.location ?? "")?.[1] ?? "");
  check("SA127. lineage is proven from the folder's bytes and recorded only when EXACTLY ONE non-deleted import's "
    + "run-meta.json and 06-final-critic.json are this folder's run-meta.json and round-1-06-final-critic.json: then the child "
    + "names it and pins its fact version; with none matching, or two, no source is recorded",
    provenRun?.source_run_id === runId && provenRun.fact_version_id === s.factVersion
      && absentRun?.source_run_id === null && absentRun.fact_version_id === null
      && ambiguousRun?.source_run_id === null && ambiguousRun.fact_version_id === null
      && decideLineage([]) === null && decideLineage([{ id: "a" }])?.id === "a" && decideLineage([{ id: "a" }, { id: "b" }]) === null,
    `${provenRun?.source_run_id} ${absentRun?.source_run_id} ${ambiguousRun?.source_run_id}`);

  // SA128: an import's report: its tier, its reason escaped, and the recorded files by base name only. (A hostile base
  // name holds no path separator: one that did would itself be cut at its last separator.)
  const HOSTILE_BASE = "<img src=x onerror=alert(9)>\"'.json";
  const archived = s.w.store.runs.get(provenRun!.id)!;
  Object.assign(archived, { state: "succeeded", import_tier: "archived_unverified", failure_class: "revalidation_failed",
    failure_message: `${HOSTILE}[reason]` });
  s.w.store.artifacts.get(archived.id)!.set("run-meta.json", { name: "run-meta.json",
    content: Buffer.from(JSON.stringify({ approvedFacts: { path: `/Users/synthetic-owner/${HOSTILE}/approved-facts.json` },
      automotiveFacts: { path: `C:\\Users\\synthetic-owner\\secret\\${HOSTILE_BASE}` } })), sha256: "", byte_length: 0 });
  const meta = s.w.store.artifacts.get(archived.id)!.get("run-meta.json")!;
  meta.sha256 = sha256Of(meta.content);
  meta.byte_length = meta.content.length;
  const report = await request(s.w, `/runs/${archived.id}`, { jar: s.viewer });
  check("SA128. an imported run's report shows its tier — archived with its class and reason, escaped, and Copy disabled — "
    + "and the files its metadata recorded by BASE NAME only: no absolute path from the owner's computer, and a hostile "
    + "name escaped",
    report.status === 200 && report.body.includes("Not revalidated") && report.body.includes("<code>revalidation_failed</code>")
      && report.body.includes(escapeHtml(`${HOSTILE}[reason]`)) && !report.body.includes(HOSTILE)
      && report.body.includes("<code>approved-facts.json</code>") && report.body.includes(`<code>${escapeHtml(HOSTILE_BASE)}</code>`)
      && !report.body.includes(HOSTILE_BASE)
      && report.body.includes("<code>round-1</code>") && !report.body.includes("/Users/") && !report.body.includes("C:\\Users"),
    `${report.status}`);
  await s.w.close();
}

{
  // SA129: hostile content on every new page.
  const s = await s62World();
  s.w.store.users.get(s.w.owner.id)!.display_name = `${HOSTILE}[uploader]`;
  const v = s.w.store.addFactVersion({ [`${HOSTILE}[tag]`]: 2 }, false);
  s.w.store.versionBytes.set(v, { content: Buffer.from("{}"), uploadedBy: s.w.owner.id, statusChangedAt: null });
  const pages = await Promise.all(["/facts", "/facts/upload", "/imports/new"].map((path) => request(s.w, path, { jar: s.owner })));
  const viewerFacts = await request(s.w, "/facts", { jar: s.viewer });
  const refusedImport = await sendDocument(s.w, "/imports", s.owner, bundleText([[`${HOSTILE}.json`, Buffer.from("x")]]));
  check("SA129. hostile text stays inert on every S7.2 page: a version's tags and its uploader's name (to the owner and to a "
    + "viewer), the upload and import pages, and a refusal naming a hostile file name — each escaped text, never markup",
    [...pages, viewerFacts, refusedImport].every((p) => !p.body.includes(HOSTILE) && !/<script>alert/.test(p.body))
      && pages[0]!.body.includes(escapeHtml(`${HOSTILE}[tag]`)) && pages[0]!.body.includes(escapeHtml(`${HOSTILE}[uploader]`))
      && viewerFacts.body.includes(escapeHtml(`${HOSTILE}[tag]`)) && refusedImport.status === 400
      && refusedImport.body.includes("<code>unknown_name</code>"),
    pages.map((p) => p.status).join());

  // SA130: the upload and import pages are plain forms; the script completes them and sends nothing itself.
  const [, uploadPage, importPage] = pages;
  const js = STATIC_ASSETS.js.body.toString("utf8");
  check("SA130. the upload and import pages are POST forms carrying the session's token and one document field, their file "
    + "inputs unnamed (no file is sent any other way); the one static script reads the file or the folder's known files, puts "
    + "ONE JSON document — each file's sha256 beside its base64 — in that field and submits the form: it sends nothing itself",
    [uploadPage!, importPage!].every((p) => /<form class="action-form" method="post" action="\/(facts\/upload|imports)" data-upload="(facts|import)"/.test(p.body)
      && p.body.includes('<input type="hidden" name="csrf"') && p.body.includes('<input type="hidden" name="document" value="">')
      && !/<input[^>]*type="file"[^>]*name=/.test(p.body))
      && STUDIO_IMPORT_FILE_NAMES.every((n) => importPage!.body.includes(n))
      && /crypto\.subtle\.digest\("SHA-256"/.test(js) && /field\.value = JSON\.stringify\(doc\)/.test(js) && /form\.submit\(\)/.test(js)
      && js.includes(`schema: "${RUN_BUNDLE_SCHEMA}"`) && !/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(js),
    `${uploadPage!.status} ${importPage!.status}`);
  await s.w.close();
}

{
  // SA131: the actor helper — one place, SET LOCAL only — and no Studio source sets the actor any other way.
  const sources: Array<[string, string]> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(resolve(REPO_ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(ts|mjs|js|sql)$/.test(entry.name)) sources.push([rel, readFileSync(resolve(REPO_ROOT, rel), "utf8")]);
    }
  };
  for (const dir of ["src/studio", "studio/migrations", "scripts"]) walk(dir);
  const sessionWide = /\bSET\s+(?:SESSION\s+)?studio\.actor\b|set_config\(\s*'studio\.actor'\s*,[^)]*,\s*false\s*\)/i;
  const offenders = sources.filter(([, text]) => sessionWide.test(text)).map(([file]) => file);
  const runtimeWeb = sources.filter(([file]) => file.startsWith("src/studio/web/") && !/selftest|testSupport/.test(file));
  // The statement itself, not a comment naming it: a template literal that interpolates the actor.
  const runtimeDeclarations = runtimeWeb.flatMap(([file, text]) => [...text.matchAll(/`SET LOCAL studio\.actor = '\$\{/g)].map(() => file));
  const statements: string[] = [];
  const client = { query: async (text: string) => {
    statements.push(text.replace(/\s+/g, " ").trim());
    return { rows: /SELECT status FROM studio_fact_versions/.test(text) ? [{ status: "active" }] : [], rowCount: 1 };
  }, release: () => {} };
  const pool = { connect: async () => client, query: client.query } as unknown as import("pg").Pool;
  const store = new PgWebStore(pool, pool);
  const owner = "0b8f2a4e-6c1d-4f3a-9e7b-2d5c8a1f0e93";
  await store.activateFactVersion({ ownerId: owner, versionId: owner });
  const activation = [...statements];
  statements.length = 0;
  const forged = await store.setFactVersionStatus({ ownerId: "x'; RESET studio.actor; --", versionId: owner, status: "retired" })
    .then(() => "written", (e: Error) => e.message);
  check("SA131. the web declares an owner edit's actor in ONE place (declareActor): its first statement inside the edit's own "
    + "transaction is SET LOCAL studio.actor, then the edit, then COMMIT; a value that is not a user id is refused before any "
    + "statement of the edit; and no Studio source — runtime, migration, test or script — sets the actor for the session: "
    + "no SET of it without LOCAL, and no set_config of it with is_local false",
    offenders.length === 0 && runtimeDeclarations.join() === "src/studio/web/store.ts"
      && activation.join(" | ") === `BEGIN | SET LOCAL studio.actor = '${owner}' | SELECT status FROM studio_fact_versions WHERE id = $1::uuid | `
        + "UPDATE studio_settings SET active_fact_version_id = $1::uuid, updated_by = $2::uuid WHERE singleton | COMMIT"
      && /^declareActor/.test(forged) && statements.join(" | ") === "BEGIN | ROLLBACK"
      // (Each vector is assembled, so this file never matches itself.)
      && [["SE", "T studio.actor = 'x'"], ["set sessio", "n studio.actor = 'x'"], ["SELECT set_config('studio.actor'", ", $1, false)"]]
        .every((parts) => sessionWide.test(parts.join("")))
      && [["SET LOCA", "L studio.actor = 'x'"], ["SELECT set_config('studio.actor'", ", $1, true)"]].every((parts) => !sessionWide.test(parts.join("")))
      && sources.length > 50,
    `${offenders.join()} ${runtimeDeclarations.join()} ${activation.join(" | ")} ${forged} ${statements.join(" | ")}`);
}

{
  // SA132: the purge deletes fact checks older than 30 days (0004's rule), in the web's purge.
  const s = await s62World();
  const old = await sendDocument(s.w, "/facts/upload", s.owner, uploadText(Buffer.from("{\"facts\":[]}")));
  const oldId = /([0-9a-f-]{36})$/.exec(old.location ?? "")?.[1] ?? "";
  s.w.store.answerFactCheck(oldId, { refused: { refusalClass: "loader_refused", message: "m" } });
  s.w.clock.now += 31 * 24 * 3_600_000;
  for (const id of s.w.store.users.keys()) s.w.store.userUpdatedAt.set(id, s.w.clock.now);
  const ownerJar = new Jar();
  await signIn(s.w, ownerJar, { identity: identityOf(s.w.owner) });
  const recent = await sendDocument(s.w, "/facts/upload", ownerJar, uploadText(Buffer.from("{\"facts\":[2]}")));
  const recentId = /([0-9a-f-]{36})$/.exec(recent.location ?? "")?.[1] ?? "";
  const purged = await s.w.app.purge();
  const statements: string[] = [];
  const pgStore = new PgWebStore({ query: async (text: string) => { statements.push(text.replace(/\s+/g, " ").trim()); return { rows: [], rowCount: 0 }; } } as never);
  await pgStore.purge(new Date(), new Date());
  check("SA132. the web's purge deletes fact checks older than 30 days — migration 0004's rule, by the database's own clock "
    + "— and keeps a younger one",
    purged.factChecks === 1 && !s.w.store.factChecks.has(oldId) && s.w.store.factChecks.has(recentId)
      && statements.includes("DELETE FROM studio_fact_checks WHERE created_at <= now() - interval '30 days'")
      && captured.some((line) => line.includes("[studio-web] purge") && line.includes("\"fact_checks\":1")),
    `${JSON.stringify(purged)} ${statements.join(" | ")}`);
  await s.w.close();
}

// =====================================================================================================
// Content Studio S7.3: users, caps and settings, the audit view; the runner's missing cap; the overrun rule
// (design §4.1, §6.2, §7.2, §8.7, §9.5)
// =====================================================================================================

/** What an S7.3 edit could write: users (role, status, cap), sessions' revocations, the settings' caps and the audit log. */
const s73State = (w: World) => JSON.stringify({
  users: [...w.store.users.values()].map((u) => [u.id, u.email, u.role, u.status, w.store.userCaps.get(u.id) ?? null]),
  revoked: [...w.store.sessions.values()].map((x) => x.revoked_at === null ? null : x.revoked_at.getTime()),
  caps: w.store.settings ? [w.store.settings.dailyCapMicros, w.store.settings.monthlyCapMicros] : null,
  audit: w.store.auditLog.length,
});
/** A refused S7.3 edit: its status, its class on the page, and nothing written. */
async function s73Refused(w: World, path: string, jar: Jar, fields: Array<[string, string]>, refusal: string, status: number):
  Promise<{ ok: boolean; detail: string }> {
  const before = s73State(w);
  const reply = await post(w, path, jar, fields);
  const got = /<code>([a-z_]+)<\/code>/.exec(reply.body)?.[1];
  return { ok: reply.status === status && got === refusal && s73State(w) === before, detail: `${path} ${reply.status} ${got}` };
}
const auditAfter = (w: World, from: number) => w.store.auditLog.slice(from);
const S73_ROUTES: Array<[string, string]> = [
  ["GET", "/users"], ["POST", "/users"], ["POST", "/users/:id/role"], ["POST", "/users/:id/cap"], ["POST", "/users/:id/disable"],
  ["POST", "/users/:id/enable"], ["POST", "/users/:id/revoke-sessions"], ["GET", "/settings"], ["POST", "/settings/caps"], ["GET", "/audit"],
];

{
  // SA133-SA134: owner only, at the route and in the navigation.
  const s = await s62World();
  const results: string[] = [];
  for (const [who, jar] of [["runner", s.runner], ["viewer", s.viewer]] as const) {
    for (const [method, pattern] of S73_ROUTES) {
      const path = pattern.replace(":id", s.runnerUser.id);
      const before = s73State(s.w);
      const calls = s.w.store.calls.length;
      const reply = method === "GET" ? await request(s.w, path, { jar })
        : await post(s.w, path, jar, [["email", syntheticEmail("x")], ["role", "owner"], ["cap", "1"], ["daily", "1"], ["monthly", "1"]]);
      const read = s.w.store.calls.slice(calls).filter((c) => c !== "findSession");
      if (reply.status !== 403 || read.length || s73State(s.w) !== before) results.push(`${who} ${method} ${path}: ${reply.status} ${read.join()}`);
    }
  }
  const signedOut = await Promise.all(S73_ROUTES.filter(([m]) => m === "GET").map(([, p]) => request(s.w, p)));
  check("SA133. every S7.3 route — the users screen and its six edits, the caps and settings and their edit, and the audit "
    + "log — is refused to a runner and to a viewer (403) before the store is read (nothing but the session), with nothing "
    + "written; signed out, it is 401",
    results.length === 0 && signedOut.every((r) => r.status === 401) && S73_ROUTES.length === 10, results.join("; "));
  const navOf = async (jar: Jar) => /<nav>([\s\S]*?)<\/nav>/.exec((await request(s.w, "/runs", { jar })).body)?.[1] ?? "";
  const [ownerNav, runnerNav, viewerNav] = [await navOf(s.owner), await navOf(s.runner), await navOf(s.viewer)];
  const links = ["href=\"/users\"", "href=\"/settings\"", "href=\"/audit\""];
  check("SA134. the navigation carries the owner's links — Users, Caps and settings, Audit — for the owner only; a runner's and "
    + "a viewer's carry none of them",
    links.every((l) => ownerNav.includes(l)) && links.every((l) => !runnerNav.includes(l) && !viewerNav.includes(l))
      && ownerNav.includes(">Caps and settings<"),
    `${ownerNav} | ${runnerNav} | ${viewerNav}`);
  await s.w.close();
}

{
  // SA135: the users list, for the owner; addresses for an active owner only (§9.5).
  const s = await s62World();
  const unbound = listed(s.w, "viewer", { display_name: "Synthetic Unbound" });
  const page = await request(s.w, "/users", { jar: s.owner });
  const rows = await s.w.store.listUsers();
  const runnerItem = page.body.split("<li class=\"user\">").find((x) => x.includes("Synthetic runner")) ?? "";
  const unboundItem = page.body.split("<li class=\"user\">").find((x) => x.includes("Synthetic Unbound")) ?? "";
  const asViewer = usersBody({ users: rows, viewer: s.viewerUser, csrfToken: "t", ceilings: CEILINGS });
  const asDisabledOwner = usersBody({ users: rows, viewer: { ...s.w.owner, status: "disabled" }, csrfToken: "t", ceilings: CEILINGS });
  const subs = [...s.w.store.users.values()].map((u) => u.google_sub).filter((x): x is string => x !== null);
  check("SA135. the owner's users screen lists every user with their address, display name, role, status, own daily cap, last "
    + "sign-in and whether a Google account is bound — never the account's subject or any session value; rendered for anyone "
    + "but an active owner, it shows no address at all",
    page.status === 200 && [...s.w.store.users.values()].every((u) => page.body.includes(escapeHtml(u.email)))
      && runnerItem.includes("bound at first sign-in") && unboundItem.includes("not yet bound") && unboundItem.includes("<dt>Last sign-in</dt><dd>—</dd>")
      && /<dt>Last sign-in<\/dt><dd>\d\d\/\d\d\/\d{4}/.test(runnerItem) && runnerItem.includes("<dt>Live sessions</dt><dd>1</dd>")
      && runnerItem.includes(`<dt>Own daily cap</dt><dd>${dollars(CEILINGS.dailyMicros)}</dd>`) && runnerItem.includes("· runner")
      && subs.length >= 3 && subs.every((sub) => !page.body.includes(sub))
      && [...s.w.store.sessions.keys()].every((h) => !page.body.includes(h))
      && [...s.w.store.users.values()].every((u) => !asViewer.includes(escapeHtml(u.email)) && !asDisabledOwner.includes(escapeHtml(u.email)))
      && unbound.google_sub === null,
    `${page.status}`);
  await s.w.close();
}

{
  // SA136-SA137: adding a user.
  const s = await s62World();
  const local = `Mixed.Case.${randomBytes(3).toString("hex")}`;
  const typed = `  ${local}@GermanCarDepot.COM `;
  const auditFrom = s.w.store.auditLog.length;
  const added = await post(s.w, "/users", s.owner, [["email", typed], ["role", "runner"], ["cap", "25"]]);
  const row = [...s.w.store.users.values()].find((u) => u.email === `${local.toLowerCase()}@${STUDIO_DOMAIN}`);
  const audit = auditAfter(s.w, auditFrom);
  check("SA136. adding a user stores the address trimmed and LOWER-CASED, with the chosen role and own daily cap, created by "
    + "the acting owner in ONE owner edit that declares its actor; it is audited (user.create) with that owner as actor and "
    + "no address or name in the detail",
    added.status === 303 && added.location === "/users" && row !== undefined && row.role === "runner" && row.status === "active"
      && row.created_by === s.w.owner.id && s.w.store.userCaps.get(row.id) === 25_000_000 && row.google_sub === null
      && audit.length === 1 && audit[0]!.action === "user.create" && audit[0]!.actorUserId === s.w.owner.id && audit[0]!.targetId === row.id
      && !JSON.stringify(audit[0]!.detail).includes("@") && s.w.store.declaredActors.at(-1)?.actor === s.w.owner.id
      && s.w.store.declaredActors.at(-1)?.edit === "createUser",
    `${added.status} ${row?.role} ${JSON.stringify(audit.map((a) => a.action))}`);
  const refusals = [
    await s73Refused(s.w, "/users", s.owner, [["email", `someone.${randomBytes(2).toString("hex")}@other.test`], ["role", "viewer"]], "wrong_domain", 400),
    await s73Refused(s.w, "/users", s.owner, [["email", `x@${STUDIO_DOMAIN}.evil.test`], ["role", "viewer"]], "wrong_domain", 400),
    await s73Refused(s.w, "/users", s.owner, [["email", "not an address"], ["role", "viewer"]], "invalid_email", 400),
    await s73Refused(s.w, "/users", s.owner, [["email", `two@x@${STUDIO_DOMAIN}`], ["role", "viewer"]], "invalid_email", 400),
    await s73Refused(s.w, "/users", s.owner, [["role", "viewer"]], "invalid_email", 400),
    await s73Refused(s.w, "/users", s.owner, [["email", syntheticEmail("y")], ["role", "admin"]], "invalid_role", 400),
    await s73Refused(s.w, "/users", s.owner, [["email", syntheticEmail("y")], ["role", "viewer"], ["cap", "-1"]], "invalid_cap", 400),
    await s73Refused(s.w, "/users", s.owner, [["email", s.runnerUser.email], ["role", "viewer"]], "duplicate", 409),
    await s73Refused(s.w, "/users", s.owner, [["email", s.runnerUser.email.toUpperCase()], ["role", "viewer"]], "duplicate", 409),
  ];
  check("SA137. an address at another domain (or a look-alike) is refused (wrong_domain, 400), as are a malformed or missing "
    + "address, an unknown role and an invalid cap (400); an address already listed — in any case — is refused as a duplicate "
    + "(409); each with nothing written",
    refusals.every((r) => r.ok), refusals.filter((r) => !r.ok).map((r) => r.detail).join("; "));
  await s.w.close();
}

{
  // SA138-SA141: role, cap, disable and re-enable, and the explicit revocation.
  const s = await s62World();
  const id = s.runnerUser.id;
  let from = s.w.store.auditLog.length;
  const role = await post(s.w, `/users/${id}/role`, s.owner, [["role", "viewer"]]);
  const roleAudit = auditAfter(s.w, from);
  check("SA138. changing a role writes it in ONE owner edit with its declared actor, audited (user.update) with the owner as "
    + "actor and the role before and after; the changed user's next request is judged by the new role (403 on a runner's page)",
    role.status === 303 && s.w.store.users.get(id)!.role === "viewer" && roleAudit.length === 1 && roleAudit[0]!.action === "user.update"
      && roleAudit[0]!.actorUserId === s.w.owner.id && roleAudit[0]!.targetId === id
      && String(roleAudit[0]!.detail.before).includes("\"role\":\"runner\"") && String(roleAudit[0]!.detail.after).includes("\"role\":\"viewer\"")
      && (await request(s.w, "/new", { jar: s.runner })).status === 403
      && (await s73Refused(s.w, `/users/${id}/role`, s.owner, [["role", "viewer"]], "no_change", 409)).ok
      && (await s73Refused(s.w, `/users/${id}/role`, s.owner, [["role", "superuser"]], "invalid_role", 400)).ok
      && (await s73Refused(s.w, `/users/${crypto.randomUUID()}/role`, s.owner, [["role", "runner"]], "no_user", 404)).ok,
    `${role.status} ${JSON.stringify(roleAudit)}`);
  await post(s.w, `/users/${id}/role`, s.owner, [["role", "runner"]]);
  from = s.w.store.auditLog.length;
  const set = await post(s.w, `/users/${id}/cap`, s.owner, [["cap", "12.50"]]);
  const afterSet = s.w.store.userCaps.get(id);
  const cleared = await post(s.w, `/users/${id}/cap`, s.owner, [["cap", ""]]);
  const capAudit = auditAfter(s.w, from);
  const capRefusals = await Promise.all([["-1", "invalid_cap"], ["12.345", "invalid_cap"], ["1e2", "invalid_cap"], ["+5", "invalid_cap"],
    ["05", "invalid_cap"], ["100", "cap_too_large"], ["99.995", "invalid_cap"]].map(([v, r]) => s73Refused(s.w, `/users/${id}/cap`, s.owner, [["cap", v!]], r!, 400)));
  check("SA139. a runner's own daily cap is set (12.50 is $12.50) and cleared (blank), each ONE owner edit audited (user.update) "
    + "with the owner as actor; an amount that is negative, has more than two decimals, an exponent, a sign or a leading "
    + "zero, or reaches the next order of magnitude above the daily ceiling ($100 for $75) is refused (400) with nothing written",
    set.status === 303 && afterSet === 12_500_000 && cleared.status === 303 && s.w.store.userCaps.get(id) === null
      && capAudit.length === 2 && capAudit.every((a) => a.action === "user.update" && a.actorUserId === s.w.owner.id && a.targetId === id)
      && capRefusals.every((r) => r.ok),
    capRefusals.filter((r) => !r.ok).map((r) => r.detail).join("; "));
  s.w.store.userCaps.set(id, CEILINGS.dailyMicros);
  const runnerCookie = s.runner.values.get(SESSION_COOKIE)!;
  from = s.w.store.auditLog.length;
  const disabled = await post(s.w, `/users/${id}/disable`, s.owner);
  const stale = new Jar();
  stale.values.set(SESSION_COOKIE, runnerCookie);
  const next = await request(s.w, "/runs", { jar: stale });
  const enabled = await post(s.w, `/users/${id}/enable`, s.owner);
  const stillOut = await request(s.w, "/runs", { jar: stale });
  const again = new Jar();
  await signIn(s.w, again, { identity: identityOf(s.w.store.users.get(id)!) });
  const statusAudit = auditAfter(s.w, from);
  check("SA140. disabling a user revokes every session of theirs in the same change, so their very next request is signed out "
    + "(401, the cookie cleared); re-enabling makes them active again without reviving a revoked session — they sign in afresh; "
    + "both audited (user.update) with the owner as actor",
    disabled.status === 303 && s.w.store.users.get(id)!.status === "active" && next.status === 401
      && next.setCookies.some((c) => c.startsWith(`${SESSION_COOKIE}=;`)) && enabled.status === 303 && stillOut.status === 401
      && (await request(s.w, "/runs", { jar: again })).status === 200
      && [...s.w.store.sessions.values()].filter((x) => x.user_id === id && x.revoked_at === null).length === 1
      && statusAudit.filter((a) => a.action === "user.update").length === 2
      && statusAudit.filter((a) => a.action === "user.update").every((a) => a.actorUserId === s.w.owner.id)
      && (await s73Refused(s.w, `/users/${id}/enable`, s.owner, [], "no_change", 409)).ok,
    `${disabled.status} ${next.status} ${enabled.status} ${stillOut.status}`);
  const second = new Jar();
  await signIn(s.w, second, { identity: identityOf(s.w.store.users.get(id)!) });
  from = s.w.store.auditLog.length;
  const revoked = await post(s.w, `/users/${id}/revoke-sessions`, s.owner);
  const revokeAudit = auditAfter(s.w, from);
  const afterRevoke = await Promise.all([again, second].map((jar) => request(s.w, "/runs", { jar })));
  check("SA141. the owner revokes one user's sessions explicitly: every live one ends at once (their next requests are 401), "
    + "the user stays active, and the revocation is audited (user.sessions_revoked) with the owner as actor and only the count",
    revoked.status === 303 && afterRevoke.every((r) => r.status === 401) && s.w.store.users.get(id)!.status === "active"
      && revokeAudit.length === 1 && revokeAudit[0]!.action === "user.sessions_revoked" && revokeAudit[0]!.actorUserId === s.w.owner.id
      && JSON.stringify(revokeAudit[0]!.detail) === JSON.stringify({ sessions: 2 })
      && (await request(s.w, "/users", { jar: s.owner })).status === 200,
    `${revoked.status} ${afterRevoke.map((r) => r.status).join()} ${JSON.stringify(revokeAudit)}`);
  await s.w.close();
}

{
  // SA142-SA143: the last owner, and the acting owner's own seat.
  const s = await s62World();
  const self = s.w.owner.id;
  const last = [
    await s73Refused(s.w, `/users/${self}/role`, s.owner, [["role", "viewer"], ["confirm", "yes"]], "last_owner", 409),
    await s73Refused(s.w, `/users/${self}/disable`, s.owner, [["confirm", "yes"]], "last_owner", 409),
  ];
  const decisions = [
    decideUserChange({ target: { id: "a", role: "owner", status: "active" }, change: { kind: "role", role: "runner" }, activeOwnerIds: ["a"] }),
    decideUserChange({ target: { id: "a", role: "owner", status: "active" }, change: { kind: "status", status: "disabled" }, activeOwnerIds: ["a"] }),
    decideUserChange({ target: { id: "a", role: "owner", status: "active" }, change: { kind: "role", role: "runner" }, activeOwnerIds: ["a", "b"] }),
    decideUserChange({ target: { id: "a", role: "owner", status: "disabled" }, change: { kind: "role", role: "viewer" }, activeOwnerIds: ["b"] }),
  ].map((d) => (d.ok ? "ok" : d.refusal));
  let storeRefusal = "";
  try {
    await s.w.store.changeUser({ ownerId: self, userId: self, change: { kind: "status", status: "disabled" } }).then((r) => { storeRefusal = r.ok ? "written" : r.refusal; });
  } catch (error) { storeRefusal = String((error as { code?: unknown }).code); }
  check("SA142. the last active owner can never be demoted or disabled: refused (409, last_owner, shown plainly) even when "
    + "confirmed, with nothing written; the decision counts the OTHER active owners, and a disabled owner is not one",
    last.every((r) => r.ok) && decisions.join() === "last_owner,last_owner,ok,ok" && storeRefusal === "last_owner"
      && s.w.store.users.get(self)!.role === "owner" && s.w.store.users.get(self)!.status === "active",
    `${last.map((r) => r.detail).join("; ")} ${decisions.join()} ${storeRefusal}`);
  // A second owner exists: now the acting owner may step down, but only after an explicit confirmation.
  const other = listed(s.w, "owner");
  const otherJar = new Jar();
  await signIn(s.w, otherJar, { identity: identityOf(other) });
  const before = s73State(s.w);
  const asked = await post(s.w, `/users/${self}/role`, s.owner, [["role", "viewer"]]);
  const notYet = s73State(s.w) === before;
  const ownCookie = s.owner.values.get(SESSION_COOKIE)!;
  const done = await post(s.w, `/users/${self}/role`, s.owner, [["role", "viewer"], ["confirm", "yes"]]);
  const stale = new Jar();
  stale.values.set(SESSION_COOKIE, ownCookie);
  const after = await request(s.w, "/runs", { jar: stale });
  // The other owner disables themself: the same confirmation, and signed out.
  const askedDisable = await post(s.w, `/users/${other.id}/disable`, otherJar);
  const lastStanding = await s73Refused(s.w, `/users/${other.id}/disable`, otherJar, [["confirm", "yes"]], "last_owner", 409);
  check("SA143. demoting or disabling oneself first shows an explicit confirmation (200, nothing written) whose form repeats the "
    + "change with confirm=yes; once confirmed it is written, every session of the acting owner is revoked and its cookie "
    + "cleared, they are sent to / and their next request is signed out (401); and confirming cannot remove the last owner",
    asked.status === 200 && notYet && asked.body.includes("name=\"confirm\" value=\"yes\"") && asked.body.includes(`action="/users/${self}/role"`)
      && asked.body.includes("name=\"role\" value=\"viewer\"") && done.status === 303 && done.location === "/"
      && done.setCookies.some((c) => c.startsWith(`${SESSION_COOKIE}=;`)) && after.status === 401
      && s.w.store.users.get(self)!.role === "viewer"
      && [...s.w.store.sessions.values()].filter((x) => x.user_id === self).every((x) => x.revoked_at !== null)
      && askedDisable.status === 200 && askedDisable.body.includes(`action="/users/${other.id}/disable"`) && lastStanding.ok,
    `${asked.status} ${done.status} ${done.location} ${after.status} ${askedDisable.status} ${lastStanding.detail}`);
  await s.w.close();
}

{
  // SA144-SA145: no email edit; every edit audited with the right actor and no address or name.
  const s = await s62World();
  const emailRoutes = s.w.app.routes.filter((r) => /email/i.test(r.path));
  const id = s.runnerUser.id;
  const before = s73State(s.w);
  const tries = await Promise.all(["/users/:id/email", "/users/:id/address", "/users/:id"].map((p) =>
    post(s.w, p.replace(":id", id), s.owner, [["email", syntheticEmail("changed")]])));
  const page = (await request(s.w, "/users", { jar: s.owner })).body;
  const storeMethods = Object.getOwnPropertyNames(PgWebStore.prototype);
  check("SA144. there is no email edit (owner decision 5): no route's path names an address, a POST to any such path is 404 "
    + "with nothing written, the users screen has exactly ONE address field (the add form's), and no store method writes an "
    + "existing user's address",
    emailRoutes.length === 0 && tries.every((r) => r.status === 404 || r.status === 405) && s73State(s.w) === before
      && (page.match(/name="email"/g) ?? []).length === 1 && page.includes("<form class=\"action-form\" method=\"post\" action=\"/users\">")
      && storeMethods.filter((m) => /email/i.test(m)).join() === "findUserByEmail",
    `${emailRoutes.map((r) => r.path).join()} ${tries.map((r) => r.status).join()}`);
  const from = s.w.store.auditLog.length;
  const actorsFrom = s.w.store.declaredActors.length;
  await post(s.w, "/users", s.owner, [["email", syntheticEmail("audit")], ["role", "viewer"]]);
  await post(s.w, `/users/${id}/role`, s.owner, [["role", "viewer"]]);
  await post(s.w, `/users/${id}/cap`, s.owner, [["cap", "3"]]);
  await post(s.w, `/users/${id}/disable`, s.owner);
  await post(s.w, `/users/${id}/enable`, s.owner);
  await post(s.w, `/users/${id}/revoke-sessions`, s.owner);
  await post(s.w, "/settings/caps", s.owner, [["daily", "40"], ["monthly", "150"]]);
  const rows = auditAfter(s.w, from);
  const people = [...s.w.store.users.values()].flatMap((u) => [u.email, u.display_name ?? ""]).filter((x) => x.length > 3);
  check("SA145. every S7.3 edit — add, role, cap, disable, re-enable, revoke and the caps — writes exactly one audit row with "
    + "the acting owner as actor, through ONE owner edit that declared that actor first, and no row's detail holds an address "
    + "or a display name",
    rows.map((r) => r.action).join() === "user.create,user.update,user.update,user.update,user.update,user.sessions_revoked,settings.update"
      && rows.every((r) => r.actorUserId === s.w.owner.id)
      && s.w.store.declaredActors.slice(actorsFrom).map((a) => a.edit).join()
        === "createUser,changeUser,setUserCap,changeUser,changeUser,revokeUserSessions,setCaps"
      && s.w.store.declaredActors.slice(actorsFrom).every((a) => a.actor === s.w.owner.id)
      && rows.every((r) => people.every((p) => !JSON.stringify(r.detail).includes(p)) && !JSON.stringify(r.detail).includes("@")),
    rows.map((r) => r.action).join());
  await s.w.close();
}

{
  // SA146-SA148: the caps and the other settings.
  const s = await s62World();
  const from = s.w.store.auditLog.length;
  const saved = await post(s.w, "/settings/caps", s.owner, [["daily", "90"], ["monthly", "250.5"]]);
  const audit = auditAfter(s.w, from);
  const page = await request(s.w, "/settings", { jar: s.owner });
  check("SA146. the owner's caps are shown beside the deployment ceilings and the EFFECTIVE cap, the lower of each pair: a "
    + "daily cap of $90 above the $75 ceiling is stored and shown, but its effective cap is $75.00, while a monthly $250.50 "
    + "under the $300 ceiling is effective itself; the edit is ONE owner edit, audited (settings.update) with the owner as actor",
    saved.status === 303 && saved.location === "/settings" && s.w.store.settings!.dailyCapMicros === 90_000_000
      && s.w.store.settings!.monthlyCapMicros === 250_500_000
      && page.body.includes("<tr><td>Daily</td><td>$90.00</td><td>$75.00</td><td><strong>$75.00</strong></td></tr>")
      && page.body.includes("<tr><td>Monthly</td><td>$250.50</td><td>$300.00</td><td><strong>$250.50</strong></td></tr>")
      && audit.length === 1 && audit[0]!.action === "settings.update" && audit[0]!.actorUserId === s.w.owner.id
      && s.w.store.declaredActors.at(-1)?.edit === "setCaps",
    `${saved.status} ${/<tbody>([\s\S]*?)<\/tbody>/.exec(page.body)?.[1]}`);
  const bad: Array<[Array<[string, string]>, string]> = [
    [[["daily", "-1"], ["monthly", "100"]], "invalid_cap"], [[["daily", "10"], ["monthly", "1e3"]], "invalid_cap"],
    [[["daily", "12.345"], ["monthly", "100"]], "invalid_cap"], [[["daily", ""], ["monthly", "100"]], "invalid_cap"],
    [[["daily", "100"], ["monthly", "100"]], "cap_too_large"], [[["daily", "10"], ["monthly", "1000"]], "cap_too_large"],
    [[["daily", "abc"], ["monthly", "100"]], "invalid_cap"], [[["daily", "10"]], "invalid_cap"],
    [[["daily", "10"], ["daily", "11"], ["monthly", "100"]], "invalid_cap"], [[["daily", " 1,000 "], ["monthly", "100"]], "invalid_cap"],
  ];
  const refusals = await Promise.all(bad.map(([fields, refusal]) => s73Refused(s.w, "/settings/caps", s.owner, fields, refusal, 400)));
  check("SA147. an invalid amount is refused (400) with nothing written: negative, an exponent, more than two decimals, blank, "
    + "letters, a thousands separator, a missing or repeated field, and an amount at or past the next order of magnitude above "
    + "its ceiling ($100 for the $75 daily, $1,000 for the $300 monthly); the bound is computed from each ceiling",
    refusals.every((r) => r.ok) && capBoundMicros(75_000_000) === 100_000_000 && capBoundMicros(300_000_000) === 1_000_000_000
      && capBoundMicros(100_000_000) === 1_000_000_000 && capBoundMicros(0) === 10_000_000 && capBoundMicros(9_999_999) === 10_000_000
      && JSON.stringify(parseCapInput("99.99", 75_000_000, false)) === JSON.stringify({ ok: true, value: 99_990_000 })
      && JSON.stringify(parseCapInput("0", 75_000_000, false)) === JSON.stringify({ ok: true, value: 0 })
      && JSON.stringify(parseCapInput(" 7.5 ", 75_000_000, false)) === JSON.stringify({ ok: true, value: 7_500_000 })
      && JSON.stringify(parseCapInput("", 75_000_000, true)) === JSON.stringify({ ok: true, value: null })
      && !parseCapInput("", 75_000_000, false).ok && !parseCapInput(null, 75_000_000, true).ok,
    refusals.filter((r) => !r.ok).map((r) => r.detail).join("; "));
  const other = /<section><h2>Other settings<\/h2>([\s\S]*?)<\/section>/.exec(page.body)?.[1] ?? "";
  const active = s.w.store.factVersions.get(s.factVersion)!;
  const runnerPage = await request(s.w, "/settings", { jar: s.runner });
  check("SA148. the other settings: the active fact version (its sha256) with a link to the fact-versions page, a link to the "
    + "audit log, and scheduled runs shown as off and UNAVAILABLE — the cron job does not exist (S9) — with no control of any "
    + "kind for it on the page and no route that writes it; a runner sees no caps page (403)",
    other.includes(escapeHtml(active.sha256.slice(0, 12))) && other.includes("href=\"/facts\"") && other.includes("href=\"/audit\"")
      && other.includes(escapeHtml(SCHEDULED_RUNS_UNAVAILABLE)) && !/scheduled/i.test((page.body.match(/<(form|input|select|button|textarea)\b[^>]*>/g) ?? []).join(""))
      && !/<(input|select|button|textarea)\b/.test(other) && s.w.app.routes.every((r) => !/schedul/i.test(r.path))
      && runnerPage.status === 403 && !runnerPage.body.includes("Effective cap"),
    other.slice(0, 300));
  await s.w.close();
}

{
  // SA149: the audit view.
  const s = await s62World();
  for (let i = 0; i < 60; i += 1) {
    s.w.store.auditLog.push({ action: "test.synthetic", actorUserId: s.w.owner.id, targetType: "studio_runs", targetId: `t${i}`, detail: { n: i } });
  }
  const first = await request(s.w, "/audit?action=test.synthetic", { jar: s.owner });
  const second = await request(s.w, "/audit?action=test.synthetic&page=2", { jar: s.owner });
  const all = await request(s.w, "/audit", { jar: s.owner });
  const items = (body: string) => body.split("<li class=\"audit\">").length - 1;
  const bad = await Promise.all(["/audit?action=Bad%20Action", "/audit?page=0", "/audit?page=x", "/audit?action=a&action=b", "/audit?who=x"]
    .map((p) => request(s.w, p, { jar: s.owner })));
  const viewer = await request(s.w, "/audit", { jar: s.viewer });
  check("SA149. the audit log is the owner's alone (a viewer is refused, 403), read-only and newest first: 50 rows a page with "
    + "a link to the older page, the action filter narrowing it to one action (each action offered once in its list), and a "
    + "malformed filter or page refused (400)",
    first.status === 200 && items(first.body) === 50 && first.body.indexOf("{&quot;n&quot;:59}") < first.body.indexOf("{&quot;n&quot;:58}")
      && first.body.includes("href=\"/audit?action=test.synthetic&amp;page=2\">Older<") && items(second.body) === 10
      && second.body.includes("{&quot;n&quot;:9}") && !second.body.includes("{&quot;n&quot;:10}") && second.body.includes(">Newer<")
      && !second.body.includes(">Older<") && (first.body.match(/<option value="test.synthetic" selected>/g) ?? []).length === 1
      && all.body.includes("auth.sign_in") && bad.every((r) => r.status === 400) && viewer.status === 403
      && !/<form method="post"/.test(first.body.replace(/<form method="post" action="\/auth\/logout">/g, "")),
    `${first.status} ${items(first.body)} ${items(second.body)} ${bad.map((r) => r.status).join()}`);
  await s.w.close();
}

{
  // SA150: hostile content stays inert on every S7.3 page.
  const s = await s62World();
  const hostile = "<script>alert(1)</script><img src=x onerror=alert(2)>\"'&";
  s.w.store.users.get(s.runnerUser.id)!.display_name = `${hostile}[name]`;
  s.w.store.auditLog.push({ action: "test.hostile", actorUserId: s.runnerUser.id, targetType: "studio_runs", targetId: `${hostile}[target]`,
    detail: { note: `${hostile}[detail]`, nested: `</code></pre>${hostile}` } });
  const users = await request(s.w, "/users", { jar: s.owner });
  const audit = await request(s.w, "/audit", { jar: s.owner });
  const cap = await post(s.w, "/settings/caps", s.owner, [["daily", "<b>x</b>"], ["monthly", "100"]]);
  const userCap = await post(s.w, `/users/${s.runnerUser.id}/cap`, s.owner, [["cap", "<i>y</i>"]]);
  const raw = (body: string) => body.includes("<script>alert") || body.includes("<img src=x") || body.includes("<b>x</b>") || body.includes("<i>y</i>");
  check("SA150. hostile text on every S7.3 page stays inert — a display name on the users screen and as an audit row's actor, "
    + "an audit row's target and its detail (shown as escaped JSON text, never markup), and a typed cap echoed back in its "
    + "refusal: no raw tag reaches any page, and each appears escaped",
    !raw(users.body) && users.body.includes(`${escapeHtml(hostile)}[name]`) && !raw(audit.body)
      && audit.body.includes(`${escapeHtml(hostile)}[target]`) && audit.body.includes(escapeHtml(JSON.stringify(`${hostile}[detail]`)))
      && audit.body.includes(`by ${escapeHtml(hostile)}[name]`) && !audit.body.includes("</code></pre><script>")
      && cap.status === 400 && !raw(cap.body) && cap.body.includes("&lt;b&gt;x&lt;/b&gt;") && userCap.status === 400 && !raw(userCap.body),
    `${users.status} ${audit.status} ${cap.status} ${userCap.status}`);
  await s.w.close();
}

{
  // SA151: D — the runner's missing cap, at the confirmation.
  const s = await s62World();
  s.w.store.userCaps.set(s.runnerUser.id, null);
  const { requestId, quoteId } = await quoteFor(s, s.runner);
  const pricePage = await request(s.w, `/preflights/${requestId}`, { jar: s.runner });
  const refused = await confirmRefused(s, s.runner, quoteId, "cap_missing");
  const ownerQuote = await quoteFor(s, s.owner);
  const ownerOk = await post(s.w, `/quotes/${ownerQuote.quoteId}/confirm`, s.owner);
  const spend = await request(s.w, "/spend", { jar: s.viewer });
  const base: ConfirmSnapshot = {
    nowMs: 1_000_000, user: { id: "u", role: "runner", status: "active", dailyCapMicros: null, updatedAtMs: 0 },
    quote: { id: "q", userId: "u", action: "full", paramsSha256: "p", workerCommit: "c", approvedFactsSha256: "a", factVersionId: "f",
      priceTableSha256: "t", ceilingMicros: 1, createdAtMs: 1, expiresAtMs: 2_000_000, consumed: false },
    request: { action: "full", paramsSha256: "p", factVersionId: "f", sourceRunId: null }, sourceAvailable: false,
    heartbeat: { commit: "c", approvedFactsSha256: "a", priceTableSha256: "t", beatAtMs: 1_000_000 }, currentFactVersionId: "f",
    settings: { dailyCapMicros: 50_000_000, monthlyCapMicros: 200_000_000 }, ceilings: CEILINGS,
    spend: { dayMicros: 0, monthMicros: 0, userDayMicros: 0 }, unacknowledgedOverruns: 0,
  };
  const of = (edit: (x: ConfirmSnapshot) => void) => { const x = structuredClone(base); edit(x); const d = decideConfirm(x); return d.ok ? "ok" : d.refusal; };
  const pure = [of(() => {}), of((x) => { x.user!.dailyCapMicros = 0; }), of((x) => { x.user!.dailyCapMicros = 5; }),
    of((x) => { x.user!.role = "owner"; })].join();
  check("SA151. at the confirmation, a runner whose daily_cap_usd is NULL is refused (cap_missing, 409) — a missing cap is "
    + "zero (§6.2) — with nothing written, and their price page says why; the owner's own NULL cap still means no per-user cap, "
    + "and their confirmation succeeds; the spend panel names a runner's missing cap",
    refused.ok && ownerOk.status === 303 && pure === "cap_missing,cap_exceeded_user_daily,ok,ok"
      && pricePage.body.includes("a runner without one cannot confirm") && spend.body.includes("none — cannot confirm"),
    `${refused.detail} ${ownerOk.status} ${pure}`);
  await s.w.close();
}

{
  // SA152: E — the overrun acknowledgement survives the acknowledger's later demotion.
  const s = await s62World();
  const other = listed(s.w, "owner");
  const otherJar = new Jar();
  await signIn(s.w, otherJar, { identity: identityOf(other) });
  const overrun = (run: RunRow) => s.w.store.ledger.push({ entry: "reserve", runId: run.id, amountMicros: 1_000_000, day: localDay(s.w.clock.now) },
    { entry: "overrun", runId: run.id, amountMicros: 500_000, day: localDay(s.w.clock.now) });
  const first = s.w.store.addRun(s.runnerUser, { runner: "live", state: "failed", failure_class: "cost_ceiling_exceeded" });
  overrun(first);
  const byRunner = await s.w.store.acknowledgeOverrun({ runId: first.id, ownerId: s.runnerUser.id });
  const ack = await post(s.w, `/spend/overruns/${first.id}/acknowledge`, otherJar);
  const demote = await post(s.w, `/users/${other.id}/role`, s.owner, [["role", "viewer"]]);
  const { quoteId } = await quoteFor(s, s.runner);
  const stillUnlocked = await post(s.w, `/quotes/${quoteId}/confirm`, s.runner);
  const panel = await request(s.w, "/spend", { jar: s.owner });
  const second = s.w.store.addRun(s.runnerUser, { runner: "live", state: "failed", failure_class: "cost_ceiling_exceeded" });
  overrun(second);
  const locked = await confirmRefused(s, s.runner, (await quoteFor(s, s.runner)).quoteId, "confirmations_locked");
  // The PostgreSQL store's acknowledgement reads, over a recording database: none joins a users row or names a role.
  const statements: string[] = [];
  const recorder = { query: async (text: string) => {
    statements.push(text.replace(/\s+/g, " ").trim());
    return { rows: [{ ok: true, n: 0, day: "0", month: "0", month_start: "2026-10-01", daily: "50", monthly: "200" }], rowCount: 1 };
  }, connect: async () => ({ ...recorder, release: () => {} }) };
  const pgStore = new PgWebStore(recorder as unknown as import("pg").Pool, recorder as unknown as import("pg").Pool);
  await pgStore.acknowledgeOverrun({ runId: first.id, ownerId: s.w.owner.id });
  await pgStore.spendView("2026-10-07").catch(() => undefined);
  const acknowledgementReads = statements.filter((t) => t.includes("spend.overrun_acknowledged") && !t.startsWith("INSERT"));
  check("SA152. an overrun acknowledged by an owner stays acknowledged after that owner is demoted: confirmations stay "
    + "unlocked and the spend panel still shows it acknowledged; a new unacknowledged overrun still locks them; a runner cannot "
    + "write an acknowledgement through the store (only an active owner can); and none of the web store's acknowledgement reads "
    + "joins a users row or names a role",
    byRunner === false && ack.status === 303 && demote.status === 303 && s.w.store.users.get(other.id)!.role === "viewer"
      && stillUnlocked.status === 303 && panel.body.includes("acknowledged") && locked.ok
      && s.w.store.auditLog.filter((a) => a.action === "spend.overrun_acknowledged").length === 1
      && acknowledgementReads.length === 2 && acknowledgementReads.every((t) => !/studio_users|\brole\b/.test(t))
      && statements.some((t) => t.startsWith("SELECT studio_is_active_user_in_role($1::uuid, ARRAY['owner'])")),
    `${byRunner} ${ack.status} ${demote.status} ${stillUnlocked.status} ${locked.detail} ${acknowledgementReads.join(" | ")}`);
  await s.w.close();
}

{
  // SA153: S7.3's pure decisions.
  const email = (raw: unknown) => { const r = normalizeNewUserEmail(raw); return r.ok ? r.value : r.refusal; };
  const filters = (q: string) => { const r = parseAuditFilters(new URLSearchParams(q)); return r.ok ? JSON.stringify(r.value) : r.refusal; };
  check("SA153. S7.3's pure decisions: an address is trimmed and lower-cased and must be one address at the Studio's domain; a "
    + "role is one of three; only demoting or disabling ONESELF loses one's own seat; and the audit filter takes one action of "
    + "the schema's shape and a page from 1",
    email(` A.B@${STUDIO_DOMAIN.toUpperCase()} `) === `a.b@${STUDIO_DOMAIN}` && email(`a@sub.${STUDIO_DOMAIN}`) === "wrong_domain"
      && email(`a@${STUDIO_DOMAIN}x`) === "wrong_domain" && email("") === "invalid_email" && email(42) === "invalid_email"
      && email(`${"a".repeat(250)}@${STUDIO_DOMAIN}`) === "invalid_email" && email(`a b@${STUDIO_DOMAIN}`) === "invalid_email"
      && parseRole("runner").ok && !parseRole("Owner").ok && !parseRole(null).ok
      && losesOwnSeat("a", "a", { kind: "role", role: "viewer" }) && losesOwnSeat("a", "a", { kind: "status", status: "disabled" })
      && !losesOwnSeat("a", "a", { kind: "role", role: "owner" }) && !losesOwnSeat("a", "b", { kind: "role", role: "viewer" })
      && !losesOwnSeat("a", "a", { kind: "status", status: "active" })
      && filters("") === JSON.stringify({ action: null, page: 1 }) && filters("action=user.update&page=3") === JSON.stringify({ action: "user.update", page: 3 })
      && filters("action=") === JSON.stringify({ action: null, page: 1 }) && filters("page=0") === "invalid_filter"
      && filters("page=100000") === "invalid_filter" && filters("action=X") === "invalid_filter" && filters("q=1") === "invalid_filter");
}

{
  // Every HTML page this suite received, S4's and S5's: no inline script, no inline style, no event handler.
  const scripts = htmlPages.flatMap((p) => [...p.body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .map((m) => ({ attributes: m[1]!, inner: m[2]! })));
  const tags = htmlPages.flatMap((p) => [...p.body.matchAll(/<[a-zA-Z][^>]*>/g)].map((m) => m[0].replace(/"[^"]*"/g, '""')));
  const s5Pages = htmlPages.filter((p) => p.path.startsWith("/runs") && p.status === 200);
  check("SA98. across every page this suite rendered (S4's and S5's), no script is inline: each <script> is the one "
    + `static file, with no body, and no tag carries an event handler, a style attribute or a <style> element (${htmlPages.length} pages)`,
    htmlPages.length > 100 && s5Pages.length > 20
      && scripts.every((x) => x.inner === "" && x.attributes === ` src="${STATIC_ASSETS.js.href}" defer`)
      && scripts.length === htmlPages.filter((p) => p.body.includes(STATIC_ASSETS.js.href)).length
      && tags.every((t) => !/\son[a-z]+\s*=/i.test(t) && !/\sstyle\s*=/i.test(t) && !/^<style\b/i.test(t))
      && s5Pages.every((p) => p.body.includes(STATIC_ASSETS.js.href) && p.body.includes(STATIC_ASSETS.css.href)),
    `${htmlPages.length} pages, ${scripts.length} scripts`);
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
