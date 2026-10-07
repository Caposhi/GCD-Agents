/**
 * Offline suite for the Content Studio worker (docs/CONTENT_STUDIO_DESIGN.md
 * §3.2, §5.3, §5.4, §6.2): `npm run test:studio-worker`, one of the
 * `test:offline` suites. No database, no network beyond a loopback listener
 * that must receive no connection, no provider, no credential.
 *
 * Every check is `SW…`. The worker's safety decisions are pure functions over
 * data, so each refusal is proven here and each is made load-bearing by a
 * mutation in the payload-contract mutation harness; the disposable PostgreSQL
 * suite (`worker.postgres.selftest.ts`) proves them end to end.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as lib from "../../harness/contentRun/index.js";
import type { ContentRunRuntime, CostCeilingLine, ReviewOnlyRequestUnit } from "../../harness/contentRun/index.js";
import { STUDIO_IMPORT_FILE_NAMES, STUDIO_MIGRATION_LOCK_NAMESPACE } from "../db/runner.js";
import {
  decideFactCheck, runFactCheck, UNKNOWN_FIELDS_MAX, UPLOAD_LABEL, writeFactCheckOutcome, type FactCheckOutcome, type FactCheckRow,
} from "./factCheck.js";
import { decideImport, IMPORT_GOAL_MAX_CHARS, writeImportOutcome, type ImportDecision } from "./importRun.js";
import { closeRun, decideBeforeWork, executeJob, failureClassOf, workerRuntime, WorkerStop, type BeforeWork } from "./execute.js";
import {
  decidePreflight, writePreflightOutcome, type PreflightInputs, type PreflightOutcome, type PreflightRequestRow, type PreflightSourceRun,
} from "./preflight.js";
import { preflightParamsSha256 } from "../db/runner.js";
import { preflightRequest } from "../web/actions.js";
import { CRITIC_ARTIFACT, deriveFindings } from "./findings.js";
import { providerTextWithContact } from "../../harness/agents/providerText.js";
import { readCaptions, readScript, readShotList } from "../web/runs.js";
import { CLAIMED_JOB_KINDS, claimNextJob, FREE_JOB_KINDS, recoverInterruptedRuns, sweepQueuedJobs, terminalize } from "./jobs.js";
import { ceilingMicros, measuredMicros, microsToNumeric, numericToMicros, parseCapMicros } from "./money.js";
import { DbRunSink, REWRITTEN_ARTIFACTS } from "./runSink.js";
import { LIVE_WORKER_OWNERSHIP_KEY, STUDIO_WORKER_OWNERSHIP_NAMESPACE, studioOwnershipKey, type WorkerSession } from "./session.js";
import { decidePaidUnit, planSettlement, type PaidUnitPrice, type PaidUnitSnapshot } from "./spend.js";
import {
  decideSchemaVersion, decideWorkerIdentity, decideWorkerStartup, forbiddenVariablesPresent, FORBIDDEN_PREFIXES,
  FORBIDDEN_VARIABLES, S3_FORBIDDEN_VARIABLES, STUDIO_EXPECTED_MIGRATIONS, STUDIO_SCHEMA_VERSION, type WorkerEnvironment,
} from "./startup.js";
import { fakeTranscript, memoryIo, memorySink, replayRunner, repoFacts, syntheticFactsBytes } from "./testSupport.js";
import { HEARTBEAT_INTERVAL_MS } from "./worker.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * The module specifiers of one compiled or source file: static imports and
 * re-exports, and literal dynamic imports. (Not livePathGuards' parser: that
 * needs the TypeScript compiler, a dev dependency no Studio module may load —
 * the CS1c walk covers every compiled Studio module, this suite included.)
 */
function moduleReferences(text: string): Array<{ kind: "static" | "dynamic"; specifier: string }> {
  const refs: Array<{ kind: "static" | "dynamic"; specifier: string }> = [];
  for (const m of text.matchAll(/^\s*(import|export)\s+(type\s+)?(?:[^;'"]*?\sfrom\s+)?["']([^"']+)["']/gm)) {
    if (!m[2]) refs.push({ kind: "static", specifier: m[3]! });
  }
  for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) refs.push({ kind: "dynamic", specifier: m[1]! });
  return refs;
}
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
const COMMIT = "c".repeat(40);
const URL_OK = "postgresql://worker:placeholder@127.0.0.1:5432/gcd_studio";
const env = (extra: Partial<WorkerEnvironment> = {}): WorkerEnvironment => ({
  names: ["PATH", "NODE_ENV", "STUDIO_DATABASE_URL"], studioDatabaseUrl: URL_OK, maxDailyUsd: "75", maxMonthlyUsd: "300",
  commit: COMMIT, ...extra,
});

async function startupChecks(): Promise<void> {
  // --- SW1: the environment refusal ---------------------------------------------------------------
  const ok = decideWorkerStartup(env());
  const forbidden = [...FORBIDDEN_VARIABLES, ...S3_FORBIDDEN_VARIABLES, "IG_ACCESS_TOKEN", "FB_PAGE_ACCESS_TOKEN", "GBP_LOCATION_ID"];
  const refusals = forbidden.map((name) => refusalOf(() => decideWorkerStartup(env({ names: [...env().names, name] }))));
  check("SW1. the worker refuses to start beside any forbidden variable — DATABASE_URL, every live credential, "
    + "AUTONOMY_PHASE, PUBLIC_BASE_URL, ACTIVE_PLATFORMS, any IG_/FB_/GBP_ name and, until S6b, ANTHROPIC_API_KEY — "
    + "whatever its value; with none it starts with its own caps and commit",
    ok.connectionString === URL_OK && ok.commit === COMMIT && ok.caps.dailyMicros === 75_000_000
      && ok.caps.monthlyMicros === 300_000_000 && ok.zeroCaps.length === 0
      && refusals.length === 15 && refusals.every((r) => r === "forbidden-variable")
      && JSON.stringify(FORBIDDEN_PREFIXES) === JSON.stringify(["IG_", "FB_", "GBP_"])
      && JSON.stringify(S3_FORBIDDEN_VARIABLES) === JSON.stringify(["ANTHROPIC_API_KEY"])
      && forbiddenVariablesPresent(["IGNORE_ME", "FBX", "GBPX", "IG", "PATH"]).length === 0
      && forbiddenVariablesPresent(["ANTHROPIC_API_KEY", "DATABASE_URL", "IG_X"]).join() === "ANTHROPIC_API_KEY,DATABASE_URL,IG_X",
    refusals.join());
  const messageOf = (e: Partial<WorkerEnvironment>) => { try { decideWorkerStartup(env(e)); return ""; } catch (x) { return (x as Error).message; } };
  check("SW1a. it also refuses a missing, empty or non-PostgreSQL STUDIO_DATABASE_URL and a commit that is not a full "
    + "40-character SHA; no refusal message echoes a value",
    ["studio-database-url-missing", "studio-database-url-missing", "studio-database-url-invalid", "studio-database-url-invalid",
      "commit-missing", "commit-missing", "commit-missing"].join() === [
      refusalOf(() => decideWorkerStartup(env({ studioDatabaseUrl: undefined }))),
      refusalOf(() => decideWorkerStartup(env({ studioDatabaseUrl: "  " }))),
      refusalOf(() => decideWorkerStartup(env({ studioDatabaseUrl: "mysql://x/y" }))),
      refusalOf(() => decideWorkerStartup(env({ studioDatabaseUrl: "not a url" }))),
      refusalOf(() => decideWorkerStartup(env({ commit: undefined }))),
      refusalOf(() => decideWorkerStartup(env({ commit: "abc123" }))),
      refusalOf(() => decideWorkerStartup(env({ commit: "C".repeat(40) }))),
    ].join()
      && !messageOf({ names: ["DATABASE_URL"], studioDatabaseUrl: "postgresql://u:secret-value@h/db" }).includes("secret-value")
      && !messageOf({ studioDatabaseUrl: "mysql://u:secret-value@h/db" }).includes("secret-value"));

  // --- SW1b: the entry point, executed: refused before any connection ---------------------------------
  const server = createServer((socket) => { connections += 1; socket.destroy(); });
  let connections = 0;
  await new Promise<void>((settle) => server.listen(0, "127.0.0.1", settle));
  const port = (server.address() as { port: number }).port;
  const base = { PATH: process.env.PATH ?? "", STUDIO_DATABASE_URL: `postgresql://u:placeholder@127.0.0.1:${port}/gcd_studio`,
    STUDIO_MAX_DAILY_USD: "75", STUDIO_MAX_MONTHLY_USD: "300", RENDER_GIT_COMMIT: COMMIT };
  const runMain = (extra: Record<string, string>, drop: string[] = []) => new Promise<{ code: number; stderr: string }>((settle) => {
    const childEnv: Record<string, string> = { ...base, ...extra };
    for (const name of drop) delete childEnv[name];
    execFile(process.execPath, [resolve(REPO_ROOT, "dist/studio/worker/main.js")], { env: childEnv, timeout: 30_000 },
      (error, _stdout, stderr) => settle({ code: error ? (typeof error.code === "number" ? error.code : -1) : 0, stderr: String(stderr) }));
  });
  const runs = [
    await runMain({ DATABASE_URL: "postgresql://live:placeholder-value@127.0.0.1/live" }),
    await runMain({ ANTHROPIC_API_KEY: "placeholder-value" }),
    await runMain({ IG_ACCESS_TOKEN: "" }),
    await runMain({}, ["STUDIO_DATABASE_URL"]),
    await runMain({}, ["RENDER_GIT_COMMIT"]),
  ];
  server.close();
  check("SW1b. `npm run start:studio-worker` (dist/studio/worker/main.js), executed: DATABASE_URL, ANTHROPIC_API_KEY, an "
    + "empty IG_ variable, a missing STUDIO_DATABASE_URL and a missing commit each exit 1 with the refusal named, no "
    + "value echoed, and no connection made to the listening database port",
    runs.map((r) => `${r.code}:${/refused \(([a-z-]+)\)/.exec(r.stderr)?.[1]}`).join()
      === "1:forbidden-variable,1:forbidden-variable,1:forbidden-variable,1:studio-database-url-missing,1:commit-missing"
      && runs.every((r) => !r.stderr.includes("placeholder-value")) && connections === 0,
    runs.map((r) => r.stderr.trim()).join(" | "));

  // --- SW1c: the environment is decided before anything reads process.env ------------------------------
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
  const mainStatic = staticGraph("dist/studio/worker/main.js");
  const mainRefs = moduleReferences(readFileSync(resolve(REPO_ROOT, "dist/studio/worker/main.js"), "utf8"));
  const mainSource = readFileSync(resolve(REPO_ROOT, "src/studio/worker/main.ts"), "utf8");
  check("SW1c. the entry point decides its environment before the library or the live config.ts can load: its static "
    + "imports reach only startup.ts, money.ts and the S2 runner (no config.ts, sdk.ts, stage module or library), the "
    + "worker is a literal dynamic import after the decision, and it reads only STUDIO_DATABASE_URL, the two caps and "
    + "RENDER_GIT_COMMIT, in the dot form",
    mainStatic.join() === ["dist/studio/db/runner.js", "dist/studio/worker/main.js", "dist/studio/worker/money.js",
      "dist/studio/worker/startup.js"].join()
      && mainRefs.some((r) => r.kind === "dynamic" && r.specifier === "./worker.js")
      && [...mainSource.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]).sort().join()
        === "RENDER_GIT_COMMIT,STUDIO_DATABASE_URL,STUDIO_MAX_DAILY_USD,STUDIO_MAX_MONTHLY_USD"
      && !/process\.env\[/.test(mainSource) && mainSource.includes("names: Object.keys(process.env)")
      && mainSource.indexOf("decideWorkerStartup(") < mainSource.indexOf('await import("./worker.js")'),
    mainStatic.join());

  // --- SW2: caps and money --------------------------------------------------------------------------
  const zero = decideWorkerStartup(env({ maxDailyUsd: undefined, maxMonthlyUsd: "lots" }));
  check("SW2. a deployment cap that is missing, empty, negative, not a plain decimal or over six decimals is zero "
    + "(every paid request refused), and is reported; a valid one is exact in micro-dollars",
    [undefined, "", " ", "-1", "1e3", "abc", "1.1234567", "0x10", "1,000"].every((raw) => parseCapMicros(raw) === 0)
      && parseCapMicros("75") === 75_000_000 && parseCapMicros("0.000001") === 1 && parseCapMicros(" 300.5 ") === 300_500_000
      && zero.caps.dailyMicros === 0 && zero.caps.monthlyMicros === 0
      && zero.zeroCaps.join() === "STUDIO_MAX_DAILY_USD,STUDIO_MAX_MONTHLY_USD");
  check("SW2a. money is exact: a ceiling rounds up to the micro-dollar, a measured cost to the nearest (unknown or "
    + "unusable is null), and numeric(12,6) round-trips",
    ceilingMicros(0.1234561) === 123_457 && ceilingMicros(0.123456) === 123_456 && ceilingMicros(0.1 + 0.2) === 300_000
      && ceilingMicros(21.65) === 21_650_000 && measuredMicros(0.0000014) === 1 && measuredMicros(undefined) === null
      && measuredMicros(-1) === null && measuredMicros(Number.NaN) === null && measuredMicros("1") === null
      && numericToMicros("21.650000") === 21_650_000 && numericToMicros("0.5") === 500_000 && numericToMicros(null) === null
      && microsToNumeric(21_650_001) === "21.650001" && microsToNumeric(5) === "0.000005"
      && refusalOf(() => numericToMicros("1.1234567")) !== "accepted");

  // --- SW3: the database identity and the schema version ------------------------------------------------
  const files = STUDIO_EXPECTED_MIGRATIONS.map((name) => ({ name, sha256: createHash("sha256").update(name).digest("hex") }));
  const ledger = files.map(({ name, sha256 }) => ({ name, sha256 }));
  const probe = (extra: Record<string, unknown> = {}) => ({
    currentDatabase: "gcd_studio", liveTables: [], migrationsTable: "tripwire" as const, studioTables: ["studio_database_identity"],
    identityRows: [{ database_name: "gcd_studio", marker: "gcd-studio:database-identity:v1" }], ledger, ...extra,
  });
  check("SW3. the worker refuses a database that is not the migrated Studio database — another name, a live table, a "
    + "live ledger, a missing identity row, or nothing migrated yet — and accepts the Studio's",
    refusalOf(() => decideWorkerIdentity(probe() as never)) === "accepted"
      && refusalOf(() => decideWorkerIdentity(probe({ currentDatabase: "gcd_social" }) as never)) === "wrong-database"
      && refusalOf(() => decideWorkerIdentity(probe({ liveTables: ["public.approval_queue"] }) as never)) === "live-schema"
      && refusalOf(() => decideWorkerIdentity(probe({ migrationsTable: "live" }) as never)) === "live-ledger"
      && refusalOf(() => decideWorkerIdentity(probe({ identityRows: [] }) as never)) === "identity-mismatch"
      && refusalOf(() => decideWorkerIdentity(probe({ ledger: null, identityRows: null, studioTables: [], migrationsTable: "absent" }) as never))
        === "not-migrated");
  const extraFile = { name: "0005_later.sql", sha256: "f".repeat(64) };
  check(`SW3a. the worker refuses any schema version but ${STUDIO_SCHEMA_VERSION}: a migration missing from the ledger, an `
    + "extra one recorded or on disk, or a recorded file whose bytes changed",
    decideSchemaVersion(ledger, files) === STUDIO_SCHEMA_VERSION && STUDIO_SCHEMA_VERSION === "0004_studio_fact_checks_and_imports.sql"
      && refusalOf(() => decideSchemaVersion(ledger.slice(0, 1), files)) === "schema-version"
      && refusalOf(() => decideSchemaVersion(ledger.slice(0, 2), files)) === "schema-version"
      && refusalOf(() => decideSchemaVersion(ledger.slice(0, 3), files)) === "schema-version"
      && refusalOf(() => decideSchemaVersion(ledger.slice(0, 2), files.slice(0, 2))) === "schema-version"
      && refusalOf(() => decideSchemaVersion(null, files)) === "schema-version"
      && refusalOf(() => decideSchemaVersion([...ledger, extraFile], [...files, extraFile])) === "schema-version"
      && refusalOf(() => decideSchemaVersion([...ledger, extraFile], files)) === "schema-version"
      && refusalOf(() => decideSchemaVersion(ledger, [...files, extraFile])) === "schema-version"
      && refusalOf(() => decideSchemaVersion([ledger[0]!, { ...ledger[1]!, sha256: "0".repeat(64) }, ledger[2]!, ledger[3]!], files))
        === "migration-changed"
      && refusalOf(() => decideSchemaVersion([ledger[0]!, ledger[1]!, { ...ledger[2]!, sha256: "0".repeat(64) }, ledger[3]!], files))
        === "migration-changed"
      && refusalOf(() => decideSchemaVersion([ledger[0]!, ledger[1]!, ledger[2]!, { ...ledger[3]!, sha256: "0".repeat(64) }], files))
        === "migration-changed"
      && JSON.stringify(readdirSync(resolve(REPO_ROOT, "studio/migrations")).filter((n) => n.endsWith(".sql")).sort())
        === JSON.stringify([...STUDIO_EXPECTED_MIGRATIONS]));

  // --- SW4: the ownership key ---------------------------------------------------------------------
  const key = studioOwnershipKey();
  const digest = createHash("sha256").update(STUDIO_WORKER_OWNERSHIP_NAMESPACE).digest();
  const s2 = createHash("sha256").update(STUDIO_MIGRATION_LOCK_NAMESPACE).digest();
  check("SW4. the worker's ownership lock is a Studio-only key from gcd-studio:worker-ownership:v1 — not the live "
    + "worker's (1889446263, 889784911) and not the Studio migration runner's",
    STUDIO_WORKER_OWNERSHIP_NAMESPACE === "gcd-studio:worker-ownership:v1"
      && key[0] === digest.readInt32BE(0) && key[1] === digest.readInt32BE(4)
      && !(key[0] === LIVE_WORKER_OWNERSHIP_KEY[0] && key[1] === LIVE_WORKER_OWNERSHIP_KEY[1])
      && LIVE_WORKER_OWNERSHIP_KEY.join() === "1889446263,889784911"
      && !(key[0] === s2.readInt32BE(0) && key[1] === s2.readInt32BE(4)));
  check("SW4a. the heartbeat is written every 30 seconds", HEARTBEAT_INTERVAL_MS === 30_000);
}

// --- SW5-SW6: the paid-unit decision and the settlement -------------------------------------------------

const RESERVED = 21_650_000;
const snapshot = (edit: (s: PaidUnitSnapshot) => void = () => {}): PaidUnitSnapshot => {
  const s: PaidUnitSnapshot = {
    run: { state: "running", runner: "live", kind: "full", reservedMicros: RESERVED, quoteId: "q", requestedBy: "u" },
    job: { state: "running", cancelRequested: false },
    quote: { userId: "u", consumed: true, action: "full" },
    requester: { status: "active", role: "owner", dailyCapMicros: null },
    reserves: [RESERVED], settled: false, chargedMicros: 0, openRequests: 0,
    daySpendMicros: RESERVED, monthSpendMicros: RESERVED, userDaySpendMicros: RESERVED,
    settings: { dailyCapMicros: 50_000_000, monthlyCapMicros: 200_000_000 }, unacknowledgedOverruns: 0,
  };
  edit(s);
  return s;
};
const CAPS = { dailyMicros: 75_000_000, monthlyMicros: 300_000_000 };
const PRICE: PaidUnitPrice = { requestCeilings: [2_000_000], remainingCeilings: [2_000_000, 19_650_000] };
const decide = (s: PaidUnitSnapshot, price: PaidUnitPrice = PRICE, caps = CAPS, timing = { elapsedMs: 0, limitMs: 1000 }) => {
  const d = decidePaidUnit(s, price, caps, timing);
  return d.ok ? "ok" : d.refusal;
};

function spendChecks(): void {
  const cases: Array<[string, string]> = [
    [decide(snapshot()), "ok"],
    [decide(snapshot((s) => { s.job!.cancelRequested = true; })), "job_cancelled"],
    [decide(snapshot((s) => { s.job = null; })), "job_cancelled"],
    [decide(snapshot((s) => { s.job!.state = "cancelled"; })), "job_cancelled"],
    [decide(snapshot(), PRICE, CAPS, { elapsedMs: 1001, limitMs: 1000 }), "job_timeout"],
    [decide(snapshot((s) => { s.run.state = "succeeded"; })), "not_running"],
    [decide(snapshot((s) => { s.run.runner = "fake"; })), "not_running"],
    [decide(snapshot((s) => { s.reserves = []; })), "reservation_missing"],
    [decide(snapshot((s) => { s.reserves = [RESERVED, RESERVED]; })), "reservation_missing"],
    [decide(snapshot((s) => { s.reserves = [RESERVED - 1]; })), "reservation_missing"],
    [decide(snapshot((s) => { s.run.reservedMicros = null; })), "reservation_missing"],
    [decide(snapshot((s) => { s.run.quoteId = null; })), "reservation_missing"],
    [decide(snapshot((s) => { s.settled = true; })), "reservation_settled"],
    [decide(snapshot((s) => { s.quote = null; })), "quote_mismatch"],
    [decide(snapshot((s) => { s.quote!.userId = "someone-else"; })), "quote_mismatch"],
    [decide(snapshot((s) => { s.quote!.consumed = false; })), "quote_mismatch"],
    [decide(snapshot((s) => { s.quote!.action = "revise"; })), "quote_mismatch"],
    [decide(snapshot((s) => { s.requester!.role = "viewer"; })), "requester_not_permitted"],
    [decide(snapshot((s) => { s.requester!.status = "disabled"; })), "requester_not_permitted"],
    [decide(snapshot((s) => { s.requester = null; })), "requester_not_permitted"],
    [decide(snapshot(), { requestCeilings: [undefined], remainingCeilings: [undefined] }), "unpriced_request"],
    [decide(snapshot(), { requestCeilings: [], remainingCeilings: [1] }), "unpriced_request"],
    [decide(snapshot(), { requestCeilings: [1], remainingCeilings: [1, undefined] }), "unpriced_request"],
    [decide(snapshot((s) => { s.openRequests = 1; })), "requests_in_flight"],
    [decide(snapshot((s) => { s.chargedMicros = RESERVED + 1; })), "cost_ceiling_exceeded"],
    [decide(snapshot(), { requestCeilings: [2_000_000], remainingCeilings: [2_000_000, 19_650_001] }), "reservation_exhausted"],
    [decide(snapshot((s) => { s.chargedMicros = 1; })), "reservation_exhausted"],
    [decide(snapshot((s) => { s.unacknowledgedOverruns = 1; })), "confirmations_locked"],
    [decide(snapshot(), PRICE, { dailyMicros: 0, monthlyMicros: 300_000_000 }), "cap_exceeded_daily"],
    [decide(snapshot((s) => { s.settings!.dailyCapMicros = RESERVED - 1; })), "cap_exceeded_daily"],
    [decide(snapshot((s) => { s.settings = null; })), "cap_exceeded_daily"],
    [decide(snapshot(), PRICE, { dailyMicros: 75_000_000, monthlyMicros: 0 }), "cap_exceeded_monthly"],
    [decide(snapshot((s) => { s.monthSpendMicros = 200_000_001; })), "cap_exceeded_monthly"],
    [decide(snapshot((s) => { s.requester!.dailyCapMicros = 25_000_000; s.userDaySpendMicros = 25_000_001; })), "cap_exceeded_user_daily"],
    [decide(snapshot((s) => { s.requester!.dailyCapMicros = 25_000_000; })), "ok"],
    [decide(snapshot((s) => { s.chargedMicros = 2_000_000; }), { requestCeilings: [19_650_000], remainingCeilings: [19_650_000] }), "ok"],
  ];
  const wrong = cases.map(([got, want], i) => (got === want ? "" : `#${i} ${got}≠${want}`)).filter(Boolean);
  check("SW5. before every paid request or lens unit the worker refuses, fail-closed: a cancelled or stopped job, the "
    + "wall clock, a run that is not running, no live reservation (none, two, a mismatched amount, no quote), a settled "
    + "one, a quote that is missing, unconsumed, another user's or another action's, a requester no longer an active "
    + "owner or runner, an unpriced request, a request still in flight, a charge over the reservation, a remaining "
    + "ceiling that does not fit, the overrun lock, and the effective daily, monthly and per-user caps (a cap of zero, "
    + "or an unreadable settings row, refuses)",
    wrong.length === 0, wrong.join("; "));
  check("SW5a. when several refusals hold, cancellation is recorded first, then the wall clock, then the reservation, "
    + "then the caps",
    decide(snapshot((s) => { s.job!.cancelRequested = true; s.reserves = []; s.unacknowledgedOverruns = 2; })) === "job_cancelled"
      && decide(snapshot((s) => { s.reserves = []; }), PRICE, CAPS, { elapsedMs: 2, limitMs: 1 }) === "job_timeout"
      && decide(snapshot((s) => { s.reserves = []; s.unacknowledgedOverruns = 1; }), PRICE, { dailyMicros: 0, monthlyMicros: 0 })
        === "reservation_missing"
      && decide(snapshot((s) => { s.unacknowledgedOverruns = 1; }), PRICE, { dailyMicros: 0, monthlyMicros: 0 }) === "confirmations_locked");
  check("SW6. a finished live run releases the unused part of its reservation, or books its overrun, and books "
    + "nothing when the charge equals the reservation",
    JSON.stringify(planSettlement(RESERVED, 90_000)) === JSON.stringify({ entry: "release", micros: RESERVED - 90_000 })
      && JSON.stringify(planSettlement(RESERVED, RESERVED + 500_000)) === JSON.stringify({ entry: "overrun", micros: 500_000 })
      && planSettlement(RESERVED, RESERVED) === null
      && JSON.stringify(planSettlement(RESERVED, 0)) === JSON.stringify({ entry: "release", micros: RESERVED }));
}

// --- SW7: the library's per-unit check, through contexts this worker tree may construct -----------------

async function gateChecks(): Promise<void> {
  const goal = "SW synthetic goal";
  const units: ReviewOnlyRequestUnit[] = [];
  const counting = lib.createReviewOnlyExecutionContext({ caller: "studio-worker", checkRequests: async (unit) => { units.push(unit); } });
  const sink = memorySink();
  let countedError = "";
  await lib.runFullPipeline(lib.loadRuntime(), {
    runner: "fake", facts: repoFacts(REPO_ROOT), goal, reviewedAt: "2026-09-01T00:00:00.000Z", reviewedAtExplicit: true,
  }, memoryIo(sink, { execution: counting })).catch((e) => { countedError = (e as Error).message; });
  const labels = (lines: readonly CostCeilingLine[]) => lines.map((l) => l.label).join("|");
  check("SW7. with a context, the library checks every request unit immediately before it is sent — the five stage "
    + "requests one by one, then the critic panel's four lenses as ONE unit — each with its own priced lines and the "
    + "ceiling still to come",
    units.map((u) => u.stage).join() === "strategy-concept,automotive-truth,hook-story-script,production-direction,"
      + "packaging-adaptation,final-critic"
      && units.slice(0, 5).every((u, i) => u.requests.length === 1 && u.remaining.length === 9 - i && u.requests[0] === u.remaining[0])
      && units[5]!.requests.length === 4 && labels(units[5]!.requests) === labels(units[5]!.remaining)
      && units[5]!.requests.every((l) => l.label.startsWith("final-critic:"))
      && units.every((u) => u.action === "full-run" && u.runner === "fake")
      && sink.recorded.length === 9 && sink.files.has("summary.md") && countedError === "", countedError);

  // A refusal at unit 3 (fake): two responses, then nothing more is requested.
  const stopAt = (n: number) => {
    let seen = 0;
    return lib.createReviewOnlyExecutionContext({ caller: "studio-worker",
      checkRequests: async () => { seen += 1; if (seen >= n) throw new Error(`SW: unit ${n} refused`); } });
  };
  const refusedSink = memorySink();
  let refusedError = "";
  await lib.runFullPipeline(lib.loadRuntime(), {
    runner: "fake", facts: repoFacts(REPO_ROOT), goal, reviewedAt: "2026-09-01T00:00:00.000Z", reviewedAtExplicit: true,
  }, memoryIo(refusedSink, { execution: stopAt(3) })).catch((e) => { refusedError = (e as Error).message; });

  // A live path whose provider runner is a counting fake: refused at unit 1, nothing is sent; at unit 2, one request.
  const evidence = await lib.buildRunEvidence(lib.loadRuntime(), {
    goal, now: Date.now(), reviewedAt: "2026-09-01T00:00:00.000Z", runner: "fake", facts: repoFacts(REPO_ROOT),
  }, { log: () => {}, warn: () => {} });
  const strategyText = JSON.stringify(lib.buildFakeStageResponses(goal, evidence.pack).strategyConcept());
  const liveRun = async (n: number) => {
    let calls = 0;
    const runner = (async () => { calls += 1; return { text: strategyText, totalCostUsd: 0.01 }; }) as never;
    let error = "";
    await lib.runFullPipeline(workerRuntime(lib.loadRuntime(), runner), {
      runner: "live", facts: repoFacts(REPO_ROOT), goal, reviewedAt: "2026-09-01T00:00:00.000Z", reviewedAtExplicit: true,
    }, memoryIo(memorySink(), { execution: stopAt(n) })).catch((e) => { error = (e as Error).message; });
    return { calls, error };
  };
  const live1 = await liveRun(1);
  const live2 = await liveRun(2);
  check("SW7a. a refused unit is never sent and nothing after it is: refused at the third unit, a fake run records two "
    + "responses; on a live path refused at the first unit the provider runner is called zero times, and at the "
    + "second, once",
    refusedError.endsWith("SW: unit 3 refused") && refusedSink.recorded.length === 2 && !refusedSink.files.has("summary.md")
      && live1.calls === 0 && live1.error.endsWith("SW: unit 1 refused") && live2.calls === 1 && live2.error.endsWith("SW: unit 2 refused"),
    `${refusedError}; ${JSON.stringify(live1)}; ${JSON.stringify(live2)}`);

  // A request outside the priced action is refused by the gate itself.
  const gate = lib.computeCostCeiling(lib.loadRuntime(), lib.criticLensPolicies(lib.loadRuntime()));
  let outside = "";
  const { gateRequestUnits } = await import("../../harness/contentRun/executionContext.js");
  const wrapped = gateRequestUnits(counting, { action: "critic-replay", runner: "fake", ceiling: gate })("packaging-adaptation",
    async () => "sent");
  await wrapped({}).catch((e: Error) => { outside = `${e.name}: ${e.message}`; });
  const panel = gateRequestUnits(stopAt(99), { action: "critic-replay", runner: "fake", ceiling: gate });
  const lens = panel("final-critic", async () => "sent");
  const lensResults = (await Promise.allSettled([lens({}), lens({}), lens({}), lens({})]))
    .map((r) => (r.status === "fulfilled" ? r.value : "refused"));
  const fifth = await lens({}).then(() => "sent", (e: Error) => e.name);
  check("SW7b. a request outside the action's priced requests is refused before it is sent, and the panel's single "
    + "check covers exactly its four lens requests",
    /^ReviewOnlyContextError: a packaging-adaptation request is not among the priced requests/.test(outside)
      && lensResults.join() === "sent,sent,sent,sent" && fifth === "sent");
}

// --- SW8-SW10: fake-only, the sink, failure classes --------------------------------------------------------

async function fakeOnlyChecks(): Promise<void> {
  const workerDir = resolve(REPO_ROOT, "src/studio/worker");
  const sources = readdirSync(workerDir).filter((n) => n.endsWith(".ts")).map((n) => [n, readFileSync(join(workerDir, n), "utf8")] as const);
  const dbSources = readdirSync(resolve(REPO_ROOT, "src/studio/db")).filter((n) => n.endsWith(".ts"))
    .map((n) => [n, readFileSync(resolve(REPO_ROOT, "src/studio/db", n), "utf8")] as const);
  const all = [...sources, ...dbSources];
  const importsStageExecution = all.filter(([, t]) => moduleReferences(t)
    .some((r) => /stageExecution|\/sdk\.js$|\/config\.js$/.test(r.specifier)));
  // (Suites build their children's environments by name; production modules may not.)
  const keyReads = all.filter(([n, t]) => !n.endsWith(".selftest.ts") && /process\.env\.ANTHROPIC_API_KEY|process\.env\[/.test(t));
  // This suite itself calls the worker's REPLACED factory, below; every other module may not call one at all.
  const factoryCalls = all.filter(([n, t]) => !n.endsWith(".selftest.ts") && /createAnthropicStageRunner\s*\(/.test(t));
  const factoryNamed = all.filter(([, t]) => t.includes("createAnthropicStageRunner")).map(([n]) => n).sort();
  const mainSource = readFileSync(join(workerDir, "main.ts"), "utf8");
  let baseCalls = 0;
  const base = lib.loadRuntime();
  const counted = { ...base, stageExecution: { ...base.stageExecution, createAnthropicStageRunner: () => { baseCalls += 1; throw new Error("real factory"); } } };
  const refusal = (() => {
    try { workerRuntime(counted as never, undefined).stageExecution.createAnthropicStageRunner(); return "built"; } catch (e) {
      return e instanceof WorkerStop ? e.refusal : (e as Error).message;
    }
  })();
  const fake = (async () => ({ text: "{}" })) as never;
  const given = workerRuntime(counted as never, fake).stageExecution.createAnthropicStageRunner();
  check("SW8. fake runner only in S3: no Studio module imports stageExecution, sdk or config, and no non-test Studio "
    + "module reads ANTHROPIC_API_KEY or any variable by computed name, or calls createAnthropicStageRunner; the entry point gives no paid stage runner; "
    + "and the worker's runtime replaces the provider runner factory — without a paid runner it refuses "
    + "(live_runs_not_enabled), with one it yields that runner, and the real factory is never called",
    importsStageExecution.length === 0 && keyReads.length === 0 && factoryCalls.length === 0
      && factoryNamed.join() === "execute.ts,worker.offline.selftest.ts,worker.postgres.selftest.ts"
      && !/paidStageRunner\s*:/.test(mainSource) && !mainSource.includes("paidStageRunner")
      && refusal === "live_runs_not_enabled" && given === fake && baseCalls === 0,
    `${importsStageExecution.map(([n]) => n)} ${keyReads.map(([n]) => n)} ${factoryCalls.map(([n]) => n)} ${factoryNamed}`);

  // The sink, over a recording fake session.
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const session = {
    run: async (fn: (c: unknown) => Promise<unknown>) => fn({ query: async (text: string, values: unknown[]) => { queries.push({ text, values }); return { rows: [], rowCount: 1 }; } }),
    query: async (text: string, values: unknown[]) => { queries.push({ text, values }); return { rows: [], rowCount: 1 }; },
  } as unknown as WorkerSession;
  const sink = new DbRunSink(session, "run-1", true);
  const writes = [
    await sink.writeArtifact("run-meta.json", "{\n  \"é\": 1\n}").then(() => "ok", (e: Error) => e.message),
    await sink.writeArtifact("revision-meta.json", "first").then(() => "ok", (e: Error) => e.message),
    await sink.writeArtifact("revision-meta.json", "final").then(() => "ok", (e: Error) => e.message),
  ];
  const twice = await sink.writeArtifact("run-meta.json", "again").then(() => "accepted", (e: Error) => e.message);
  const insertsBefore = queries.filter((q) => q.text.includes("INSERT INTO studio_run_artifacts")).length;
  await sink.flush({ query: async (text: string, values?: unknown[]) => { queries.push({ text, values: values ?? [] }); return { rows: [] }; } });
  const inserts = queries.filter((q) => q.text.includes("INSERT INTO studio_run_artifacts"));
  const metaBytes = (inserts[0]?.values[2] ?? Buffer.alloc(0)) as Buffer;
  check("SW9. the database sink stores exactly the library's bytes (a string as UTF-8, with its sha256 and length), "
    + "refuses a second write of an immutable artifact, and stores each rewritten file — resume-meta, revision-meta "
    + "and the two measurement files — once, with its final bytes, when the run ends",
    writes.join() === "ok,ok,ok" && insertsBefore === 1 && inserts.length === 2 && metaBytes.equals(Buffer.from("{\n  \"é\": 1\n}", "utf8"))
      && inserts[0]?.values[3] === createHash("sha256").update(metaBytes).digest("hex") && inserts[0]?.values[4] === metaBytes.length
      && String(inserts[1]?.values[2] ?? "") === "final" && inserts[1]?.values[1] === "revision-meta.json"
      && /immutable once stored/.test(twice)
      && JSON.stringify([...REWRITTEN_ARTIFACTS]) === JSON.stringify(["resume-meta.json", "revision-meta.json",
        "field-measurements.json", "field-measurements.md"])
      && REWRITTEN_ARTIFACTS.every((name) => Object.values(lib.RUN_ARTIFACT_NAMES).some((names) => (names as readonly string[]).includes(name))));
  check("SW10. every failure class the worker derives from an error name fits the schema's shape",
    ["StageExecutionError", "CriticPanelError", "Error", "ReviewOnlyContextError", "123Weird-Name!", ""].map((name) => {
      const e = new Error("x"); e.name = name; return failureClassOf(e);
    }).every((c) => /^[a-z][a-z0-9_]{0,63}$/.test(c)) && failureClassOf({ name: "StageExecutionError" }) === "stage_execution_error");
}

// --- SW11-SW13: before any work; the queue's statements, over a scripted client --------------------------

function beforeWorkChecks(): void {
  const b = (edit: (x: BeforeWork) => void = () => {}): BeforeWork => {
    const x: BeforeWork = {
      jobKind: "paid", run: { kind: "full", runner: "live", factVersionId: "fv" },
      quote: { workerCommit: COMMIT, approvedFactsSha256: "a".repeat(64), factVersionId: "fv", priceTableSha256: "p".repeat(64) },
      worker: { paidRunner: true, commit: COMMIT, approvedFactsSha256: "a".repeat(64), priceTableSha256: "p".repeat(64) },
    };
    edit(x);
    return x;
  };
  const of = (x: BeforeWork) => decideBeforeWork(x)?.failureClass ?? "proceed";
  const cases: Array<[string, string]> = [
    [of(b()), "proceed"],
    [of(b((x) => { x.worker.paidRunner = false; })), "live_runs_not_enabled"],
    [of(b((x) => { x.quote!.workerCommit = "d".repeat(40); })), "version_skew"],
    [of(b((x) => { x.quote!.approvedFactsSha256 = "b".repeat(64); })), "version_skew"],
    [of(b((x) => { x.quote!.factVersionId = "other"; })), "version_skew"],
    [of(b((x) => { x.quote!.priceTableSha256 = "q".repeat(64); })), "version_skew"],
    [of(b((x) => { x.quote = undefined; })), "version_skew"],
    [of(b((x) => { x.run = undefined; })), "not_executable"],
    [of(b((x) => { x.run!.kind = "imported"; })), "not_executable"],
    [of(b((x) => { x.jobKind = "fake"; })), "job_kind_mismatch"],
    [of(b((x) => { x.run!.runner = "fake"; })), "job_kind_mismatch"],
    [of(b((x) => { x.jobKind = "fake"; x.run!.runner = "fake"; x.worker.paidRunner = false; x.quote = undefined; })), "proceed"],
  ];
  const wrong = cases.map(([got, want], i) => (got === want ? "" : `#${i} ${got}≠${want}`)).filter(Boolean);
  check("SW11. before any work, the worker refuses a live run when it holds no paid runner (every live run in S3: "
    + "live_runs_not_enabled), a paid job whose quote names another worker commit, approved-facts sha256, fact version "
    + "or price table (version_skew), a kind it does not run and a job whose kind does not match its run; a fake run "
    + "proceeds with no paid runner and no quote", wrong.length === 0, wrong.join("; "));
}

/** A client that answers each statement from a script, by the first matching pattern, and records every statement. */
function scripted(script: Array<[RegExp, (values: unknown[]) => Array<Record<string, unknown>>]>) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      statements.push({ text, values });
      const hit = script.find(([pattern]) => pattern.test(text));
      const rows = hit ? hit[1](values) : [];
      return { rows, rowCount: hit ? Math.max(rows.length, 1) : 1 };
    },
  };
  const session = { tx: async (fn: (c: typeof client) => Promise<unknown>) => fn(client), run: async (fn: (c: typeof client) => Promise<unknown>) => fn(client),
    query: client.query } as unknown as WorkerSession;
  return { client, session, statements, index: (pattern: RegExp) => statements.findIndex((s) => pattern.test(s.text)) };
}

async function queueStatementChecks(): Promise<void> {
  const held = (yes: boolean) => [/pg_locks/, () => [{ held: yes }]] as [RegExp, () => Array<Record<string, unknown>>];
  const job = [/FROM studio_jobs/, () => [{ id: "j1", kind: "fake", run_id: "r1" }]] as [RegExp, () => Array<Record<string, unknown>>];
  const lost = scripted([held(false), job]);
  const lostClaim = await claimNextJob(lost.session, COMMIT).then(() => "claimed", (e: Error) => e.message);
  const queuedRun = [/SELECT state FROM studio_runs/, () => [{ state: "queued" }]] as [RegExp, () => Array<Record<string, unknown>>];
  const ok = scripted([held(true), job, queuedRun]);
  const claimed = await claimNextJob(ok.session, COMMIT);
  const stale = scripted([held(true), job, [/SELECT state FROM studio_runs/, () => [{ state: "succeeded" }]]]);
  const staleClaim = await claimNextJob(stale.session, COMMIT).then((c) => c, (e: Error) => e.message);
  const select = ok.statements[ok.index(/FROM studio_jobs/)]?.text ?? "";
  const none = scripted([held(true)]);
  const nothing = await claimNextJob(none.session, COMMIT);
  check("SW12. a claim is made only by the ownership holder — proven inside the claim's own transaction before any job "
    + "is read — with FOR UPDATE SKIP LOCKED, free jobs first (preflight; since S7.2 also fact_check and import), never an expired or cancellation-requested "
    + "job, and only from queued (no retries); it starts the job and its run, claims nothing when nothing is queued, and "
    + "closes — never starts — a job whose run is not queued, instead of stopping the worker",
    /^ownership_lost/.test(lostClaim) && lost.index(/FROM studio_jobs/) === -1
      && claimed?.jobId === "j1" && claimed.runId === "r1"
      && /FOR UPDATE SKIP LOCKED/.test(select) && /ORDER BY \(kind = ANY \(\$2::text\[\]\)\) DESC, created_at, id/.test(select)
      && /state = 'queued'/.test(select) && /expires_at > now\(\)/.test(select) && /cancel_requested_at IS NULL/.test(select)
      && ok.index(/pg_locks/) < ok.index(/FROM studio_jobs/)
      && ok.index(/FROM studio_jobs/) < ok.index(/UPDATE studio_jobs SET state = 'running'/)
      && ok.index(/UPDATE studio_runs SET state = 'running'/) > ok.index(/UPDATE studio_jobs SET state = 'running'/)
      && nothing === null && none.index(/^\s*UPDATE/) === -1
      && staleClaim === null && stale.index(/UPDATE studio_jobs SET state = 'cancelled'/) >= 0
      && stale.index(/state = 'running'/) === -1 && stale.statements.some((x) => x.values.includes("job.refused")),
    `${lostClaim} ${select}`);

  // terminalize: open rows first, then the charge, the settlement, the run, the job.
  const live = (charged: string) => scripted([
    [/SELECT runner, kind, state, reserved_usd/, () => [{ runner: "live", kind: "full", state: "running", reserved: "21.650000" }]],
    [/SUM\(charged_usd\)/, () => [{ charged }]],
    [/SELECT entry FROM studio_spend_ledger/, () => [{ entry: "reserve" }]],
  ]);
  const settled = live("1.000000");
  const end1 = await terminalize(settled.client, "r1", "j1", { runState: "succeeded", jobState: "finished" });
  const over = live("22.150000");
  const end2 = await terminalize(over.client, "r1", "j1", { runState: "succeeded", jobState: "finished" });
  const ledgerInsert = (x: ReturnType<typeof scripted>) => x.statements.find((s) => /INSERT INTO studio_spend_ledger/.test(s.text))?.values;
  const runUpdate = (x: ReturnType<typeof scripted>) => x.statements.find((s) => /UPDATE studio_runs SET state/.test(s.text))?.values;
  check("SW13. a run ends with every still-started request row completed as failed — before the charge is summed and "
    + "before the run is closed — so it stays charged its full ceiling; the unused reservation is released, or the "
    + "overrun booked, which fails a run that otherwise succeeded (cost_ceiling_exceeded)",
    settled.index(/outcome = 'failed'.*outcome = 'started'/s) >= 0
      && settled.index(/outcome = 'failed'.*outcome = 'started'/s) < settled.index(/SUM\(charged_usd\)/)
      && settled.index(/SUM\(charged_usd\)/) < settled.index(/UPDATE studio_runs SET state/)
      && JSON.stringify(ledgerInsert(settled)) === JSON.stringify(["release", "r1", "20.650000"])
      && end1.runState === "succeeded" && runUpdate(settled)?.[1] === "succeeded" && runUpdate(settled)?.[5] === "1.000000"
      && JSON.stringify(ledgerInsert(over)) === JSON.stringify(["overrun", "r1", "0.500000"])
      && end2.runState === "failed" && runUpdate(over)?.[1] === "failed" && runUpdate(over)?.[2] === "cost_ceiling_exceeded",
    JSON.stringify([ledgerInsert(settled), ledgerInsert(over), runUpdate(over)]));

  // recovery and the sweep
  const runRow = [/SELECT runner, kind, state, reserved_usd/, () => [{ runner: "fake", kind: "full", state: "running", reserved: null }]] as [RegExp, () => Array<Record<string, unknown>>];
  const lostRecovery = scripted([held(false)]);
  const lostResult = await recoverInterruptedRuns(lostRecovery.session).then(() => "recovered", (e: Error) => e.message);
  const rec = scripted([held(true), [/WHERE r\.state = 'running'/, () => [{ id: "r1", job_id: "j1" }]], runRow,
    [/SUM\(charged_usd\)/, () => [{ charged: "0" }]]]);
  const interrupted = await recoverInterruptedRuns(rec.session);
  const sweep = scripted([held(true), [/WHERE state = 'queued' AND \(expires_at <= now\(\)/, () => [
    { id: "j1", run_id: "r1", expired: true }, { id: "j2", run_id: "r2", expired: false }]], runRow,
    [/SUM\(charged_usd\)/, () => [{ charged: "0" }]]]);
  const swept = await sweepQueuedJobs(sweep.session);
  const runUpdates = (x: ReturnType<typeof scripted>) => x.statements.filter((s) => /UPDATE studio_runs SET state/.test(s.text)).map((s) => `${s.values[1]}:${s.values[2]}`);
  const jobUpdates = (x: ReturnType<typeof scripted>) => x.statements.filter((s) => /UPDATE studio_jobs SET state = \$2/.test(s.text)).map((s) => s.values[1]);
  check("SW13a. restart recovery refuses, never resumes: only the ownership holder recovers; every running run becomes "
    + "interrupted (worker_restart) and its job finished; and a queued job that expired or whose cancellation was "
    + "requested is never started — expired, or cancelled, with its run cancelled",
    /^ownership_lost/.test(lostResult) && interrupted.join() === "r1"
      && runUpdates(rec).join() === "interrupted:worker_restart" && jobUpdates(rec).join() === "finished"
      && rec.index(/UPDATE studio_jobs SET state = 'finished' WHERE state = 'running'/) > rec.index(/UPDATE studio_runs SET state/)
      && !rec.statements.some((s) => /state = 'running'/.test(s.text) && /^\s*UPDATE studio_runs/.test(s.text))
      && swept.expired === 1 && swept.cancelled === 1
      && runUpdates(sweep).join() === "cancelled:job_expired,cancelled:job_cancelled" && jobUpdates(sweep).join() === "expired,cancelled",
    `${lostResult} ${runUpdates(rec)} ${jobUpdates(rec)} ${runUpdates(sweep)} ${jobUpdates(sweep)}`);

  // Content Studio S7.1: the claim takes only the kinds this worker runs; migration 0004's kinds are S7.2's.
  const claimValues = ok.statements[ok.index(/FROM studio_jobs/)]?.values ?? [];
  const newKinds = scripted([held(true), [/WHERE state = 'queued' AND \(expires_at <= now\(\)/, () => [
    { id: "f1", run_id: null, expired: true }, { id: "i1", run_id: "r9", expired: true }]],
  [/SELECT runner, kind, state, reserved_usd/, () => [{ runner: "live", kind: "imported", state: "queued", reserved: null }]],
  [/SUM\(charged_usd\)/, () => [{ charged: "0" }]]]);
  const sweptNew = await sweepQueuedJobs(newKinds.session);
  const sweepSelect = newKinds.statements[newKinds.index(/WHERE state = 'queued' AND \(expires_at <= now\(\)/)]?.text ?? "";
  // (Until Content Studio S7.2 this check read: "the worker claims only preflight, paid and fake jobs … migration 0004's
  // fact_check and import jobs are Content Studio S7.2's and are never claimed here".)
  check("SW12a. the worker claims every kind migration 0004 allows (CLAIMED_JOB_KINDS, bound as the claim's first parameter), "
    + "the free kinds — preflight, fact_check and import (FREE_JOB_KINDS, its second) — before paid and fake jobs, then oldest "
    + "first; the sweep, which filters on no kind, expires a queued job past its expiry whatever its kind — a fact_check job "
    + "alone, with its staged bytes only while the staging row still holds its sha256, an import with its run cancelled (job_expired)",
    /AND kind = ANY \(\$1::text\[\]\)/.test(select)
      && JSON.stringify(claimValues) === JSON.stringify([["preflight", "fact_check", "import", "paid", "fake"], ["preflight", "fact_check", "import"]])
      && JSON.stringify([...CLAIMED_JOB_KINDS]) === JSON.stringify(["preflight", "fact_check", "import", "paid", "fake"])
      && JSON.stringify([...FREE_JOB_KINDS]) === JSON.stringify(["preflight", "fact_check", "import"])
      && newKinds.statements.filter((x) => /DELETE FROM studio_fact_uploads s USING studio_fact_checks c/.test(x.text)
        && /WHERE c\.job_id = \$1 AND s\.sha256 = c\.sha256/.test(x.text)).map((x) => x.values[0]).join() === "f1"
      && !/\bkind\b/.test(sweepSelect) && sweptNew.expired === 2
      && JSON.stringify(newKinds.statements.filter((x) => /UPDATE studio_jobs SET state = \$2/.test(x.text)).map((x) => x.values))
        === JSON.stringify([["f1", "expired"], ["i1", "expired"]])
      && runUpdates(newKinds).join() === "cancelled:job_expired",
    `${select} ${JSON.stringify(claimValues)} ${runUpdates(newKinds)}`);
}

/**
 * Content Studio S7.1: migration 0004's closed sets, against the code they must match (offline drift checks).
 */
function migration0004Checks(): void {
  const sql = readFileSync(resolve(REPO_ROOT, "studio/migrations/0004_studio_fact_checks_and_imports.sql"), "utf8");
  const quoted = (text: string | undefined) => [...(text ?? "").matchAll(/'([^']*)'/g)].map((m) => m[1]!);
  const importNames = quoted(/IF NEW\.name <> ALL \(ARRAY\[([^\]]*)\]\) THEN/.exec(sql)?.[1]);
  const libraryNames = [...new Set(Object.values(lib.RUN_ARTIFACT_NAMES).flat())].sort();
  check("SW25. migration 0004's import file names are exactly the library's RUN_ARTIFACT_NAMES (every kind of run, and the "
    + "failure file), each once — sixteen, inside design §8.6's twenty",
    importNames.length === new Set(importNames).size && JSON.stringify([...importNames].sort()) === JSON.stringify(libraryNames)
      && importNames.length === 16,
    `${importNames.length}: ${[...importNames].sort().join(",")} vs ${libraryNames.join(",")}`);
  const jobKinds = quoted(/CONSTRAINT studio_jobs_kind\s+CHECK \(kind IN \(([^)]*)\)\)/.exec(sql)?.[1]);
  // (Until Content Studio S7.2 this check read: "… exactly the kinds this worker claims plus S7.2's two, fact_check and
  // import, which it never claims".)
  check("SW26. migration 0004's job kinds are exactly the kinds this worker claims (CLAIMED_JOB_KINDS, since S7.2 every "
    + "one), each once; none is missing and the worker claims none the schema lacks",
    jobKinds.length === new Set(jobKinds).size
      && JSON.stringify([...jobKinds].sort()) === JSON.stringify([...CLAIMED_JOB_KINDS].sort())
      && jobKinds.length === 5,
    jobKinds.join(","));
}


/** A fake full run's stored files, through the library, as the worker's sink would store them. */
async function fakeRunFiles(): Promise<Map<string, Buffer>> {
  const sink = memorySink();
  await lib.runFullPipeline(lib.loadRuntime(), {
    runner: "fake", facts: repoFacts(REPO_ROOT), goal: "Synthetic findings goal", reviewedAt: new Date().toISOString(),
    reviewedAtExplicit: false, platforms: ["instagram", "facebook", "google_business_profile"],
  }, memoryIo(sink));
  return sink.files;
}

async function findingsChecks(): Promise<void> {
  const rt = lib.loadRuntime();
  const files = await fakeRunFiles();
  const critic = files.get(CRITIC_ARTIFACT)!;
  const source = (bytes: Buffer | undefined) => ({
    label: "memory", displayLabel: "memory", name: "memory", exists: async () => true,
    readArtifact: async (name: string) => (name === CRITIC_ARTIFACT && bytes ? new Uint8Array(bytes) : undefined),
  });
  const panel = JSON.parse(critic.toString("utf8"));
  const derived = await deriveFindings(rt, source(critic));
  const planned = rt.revision.planRevision(panel.output).ownerItems.map((item) => item.id);
  check("SW16. the findings are derived from a real fake run's stored 06-final-critic.json by the library's own accessors: "
    + "one row per panel finding in panel order, its lens, severity, category, owner and issue; owner_item exactly where "
    + "planRevision holds a finding back (a human_review owner or a human_decision category); and the counts are the rows'",
    derived.ok && derived.findings.length === panel.output.provisional.findings.length && derived.findings.length === 3
      && derived.findings.every((f, i) => {
        const raw = panel.output.provisional.findings[i];
        return f.idx === i && f.lens === raw.lens && f.severity === raw.severity && f.category === raw.category
          && f.owner === raw.owner && f.issue === raw.issue
          && f.ownerItem === (raw.owner === "human_review" || raw.category === "human_decision");
      })
      && derived.blocking === 1 && derived.advisory === 2 && derived.ownerItems === 1
      && JSON.stringify(derived.findings.filter((f) => f.ownerItem).map((f) => rt.payloadContract.revisionFindingId(f.idx)))
        === JSON.stringify(planned),
    JSON.stringify(derived));

  // closeRun over a scripted client: the statements, in order, inside the one transaction.
  const runRow = [/SELECT runner, kind, state, reserved_usd/, () => [{ runner: "fake", kind: "full", state: "running", reserved: null }]] as
    [RegExp, () => Array<Record<string, unknown>>];
  const charged = [/SUM\(charged_usd\)/, () => [{ charged: "0" }]] as [RegExp, () => Array<Record<string, unknown>>];
  const close = async (bytes: Buffer | undefined, timedOut = false) => {
    const x = scripted([[/SELECT content FROM studio_run_artifacts/, () => (bytes ? [{ content: bytes }] : [])], runRow, charged]);
    const logged: Array<[string, Record<string, unknown>]> = [];
    const sink = new DbRunSink(x.session, "r1", false);
    await sink.writeArtifact("field-measurements.json", "{}");
    const before = x.statements.length;
    const ended = await closeRun(x.client, {
      sink, runId: "r1", jobId: "j1", end: { runState: "succeeded", jobState: "finished", verdict: "needs_revision" }, timedOut, rt,
      log: (event, fields = {}) => { logged.push([event, fields]); },
    });
    const statements = x.statements.slice(before);
    const at = (pattern: RegExp) => statements.findIndex((s) => pattern.test(s.text));
    return { ended, statements, at, logged, inserts: statements.filter((s) => /INSERT INTO studio_findings/.test(s.text)),
      counts: statements.find((s) => /SET blocking_findings/.test(s.text))?.values,
      runState: statements.find((s) => /UPDATE studio_runs SET state/.test(s.text))?.values[1] };
  };
  const ok = await close(critic);
  const order = [/INSERT INTO studio_run_artifacts/, /^SAVEPOINT studio_findings_rebuild/, /SELECT content FROM studio_run_artifacts/,
    /DELETE FROM studio_findings WHERE run_id/, /INSERT INTO studio_findings/, /SET blocking_findings/, /RELEASE SAVEPOINT/,
    /SELECT runner, kind, state, reserved_usd/, /UPDATE studio_runs SET state/].map(ok.at);
  const timed = await close(critic, true);
  check("SW14. at run end the worker rebuilds the findings in the SAME transaction as the artifact flush and before the "
    + "run is closed: flush, read the run's own stored critic artifact, delete and insert the rows, write the counts, "
    + "then terminalize; a timed-out run flushes nothing and derives nothing",
    order.every((i) => i >= 0) && order.every((i, n) => n === 0 || i > order[n - 1]!)
      && ok.inserts.length === 3 && JSON.stringify(ok.counts) === JSON.stringify(["r1", 1, 2, 1])
      && ok.inserts.map((s) => `${s.values[1]}:${s.values[7]}`).join() === "0:false,1:false,2:true"
      && ok.ended.runState === "succeeded" && ok.runState === "succeeded"
      && ok.logged.some(([e, f]) => e === "findings.derived" && f.findings === 3)
      && timed.at(/studio_findings/) === -1 && timed.at(/INSERT INTO studio_run_artifacts/) === -1 && timed.runState === "succeeded",
    `${order.join()} ${JSON.stringify(ok.counts)}`);

  const edited = (edit: (p: any) => void) => {
    const copy = JSON.parse(critic.toString("utf8"));
    edit(copy);
    return Buffer.from(JSON.stringify(copy));
  };
  const malformed: Array<[string, Buffer]> = [
    ["not JSON", Buffer.from("{\"output\": ")],
    ["no output", Buffer.from("{\"metadata\":{}}")],
    ["findings not an array", edited((p) => { p.output.provisional.findings = "none"; })],
    ["a lens count that does not add up", edited((p) => { p.output.provisional.lenses[0].findingCount = 2; })],
    ["a category outside its lens", edited((p) => { p.output.provisional.findings[0].category = "timing"; })],
    ["an unknown owner", edited((p) => { p.output.provisional.findings[0].owner = "the-owner"; })],
    ["an unknown severity", edited((p) => { p.output.provisional.findings[1].severity = "critical"; })],
    ["an issue over the bound", edited((p) => { p.output.provisional.findings[0].issue = "x".repeat(601); })],
    ["a finding filed under another lens", edited((p) => { p.output.provisional.findings[0].lens = "voice-and-craft"; })],
  ];
  const results = [];
  for (const [label, bytes] of malformed) results.push([label, await close(bytes)] as const);
  const absent = await close(undefined);
  check("SW15. a malformed critic artifact — not JSON, no output, the wrong types, lens counts that do not add up, a "
    + "category outside its lens, an unknown owner or severity, an over-long issue — writes NO finding row and no count, "
    + "never fabricates one, is logged as a failure class only (never the artifact's text), and leaves the run's terminal "
    + "state exactly as it would have been; an absent artifact is no finding and no log line",
    results.every(([, r]) => r.inserts.length === 0 && r.counts === undefined && r.at(/DELETE FROM studio_findings/) === -1
      && r.runState === "succeeded" && r.ended.runState === "succeeded"
      && r.logged.length === 1 && r.logged[0]![0] === "findings.not_derived"
      && JSON.stringify(Object.keys(r.logged[0]![1]).sort()) === JSON.stringify(["failure_class", "run"])
      && r.logged[0]![1].failure_class === "critic_artifact_malformed")
      && absent.inserts.length === 0 && absent.counts === undefined && absent.logged.length === 0 && absent.runState === "succeeded",
    results.map(([label, r]) => `${label}:${r.inserts.length}/${r.logged.map(([e, f]) => `${e}:${f.failure_class}`).join()}`).join("; "));

  // The web's readers, on what the pipeline really writes (they live in the web tree, which may not run the library).
  const captions = readCaptions(files.get("05-packaging-adaptation.json"), files.get("05b-contact-lines.json"));
  const pkgs = JSON.parse(files.get("05-packaging-adaptation.json")!.toString("utf8")).output.provisional.packages;
  const contacts = JSON.parse(files.get("05b-contact-lines.json")!.toString("utf8")).packages;
  check("SW17. the web report's readers display a real fake run's stored artifacts: one caption card per platform, whose "
    + "Copy text is byte for byte the library's providerTextWithContact (re-exported by contactLine.ts from the leaf "
    + "module) for Instagram and Facebook and the caption alone for Google Business Profile; and the script and shot list",
    captions.ok && captions.value.length === 3 && rt.contact.providerTextWithContact === providerTextWithContact
      && captions.value.every((card, i) => card.copyText === (card.platform === "google_business_profile" ? pkgs[i].caption
        : rt.contact.providerTextWithContact(pkgs[i].caption, pkgs[i].hashtags, contacts[i].contact)))
      && captions.value[2]!.cta?.actionType === "BOOK" && captions.value[2]!.contactText === null
      && readScript(files.get("03-hook-story-script.json")).ok && readShotList(files.get("04-production-direction.json")).ok);
}

// --- SW18-SW24 (Content Studio S6.2): the free preflight, its outcome, and a live run with no paid runner -------

/** A runtime whose stage executors and provider factory count every call: a preflight must make none. */
function countedRuntime(): { rt: ContentRunRuntime; calls: () => number } {
  const base = lib.loadRuntime();
  let calls = 0;
  const count = <T extends Record<string, unknown>>(mod: T, name: string): T => ({
    ...mod, [name]: (...args: unknown[]) => { calls += 1; return (mod[name] as (...a: unknown[]) => unknown)(...args); },
  });
  return {
    rt: {
      ...base,
      strategy: count(base.strategy, "executeStrategyConcept"), truth: count(base.truth, "executeAutomotiveTruth"),
      script: count(base.script, "executeHookStoryScript"), direction: count(base.direction, "executeProductionDirection"),
      packaging: count(base.packaging, "executePackagingAdaptation"), critic: count(base.critic, "executeFinalCritic"),
      stageExecution: { ...base.stageExecution, createAnthropicStageRunner: () => { calls += 1; throw new Error("provider factory"); } },
    } as ContentRunRuntime,
    calls: () => calls,
  };
}

const ALL_PLATFORMS = ["instagram", "facebook", "google_business_profile"];
const FACT_VERSION = "0b8f2a4e-6c1d-4f3a-9e7b-2d5c8a1f0e93";
const SOURCE_RUN = "5f0c7d2e-1a3b-4c5d-8e9f-0a1b2c3d4e5f";
const approvedRepo = () => {
  const bytes = readFileSync(resolve(REPO_ROOT, "config/approved-facts.json"));
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
};
const approvedWithout = (key: string) => {
  const parsed = JSON.parse(readFileSync(resolve(REPO_ROOT, "config/approved-facts.json"), "utf8"));
  delete parsed[key];
  const bytes = Buffer.from(JSON.stringify(parsed, null, 2), "utf8");
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
};
const version = (bytes: Buffer = syntheticFactsBytes()) => ({ content: bytes, sha256: createHash("sha256").update(bytes).digest("hex") });

/** A request row whose params_sha256 is the canonical one (unless `sha` overrides it). */
function requestRow(edit: Partial<PreflightRequestRow> = {}, sha?: string): PreflightRequestRow {
  const row: PreflightRequestRow = {
    id: "req-1", jobId: "job-1", userId: "user-1", action: "full", goal: "SW preflight synthetic goal",
    platforms: [...ALL_PLATFORMS], scopeTags: null, sourceRunId: null, factVersionId: FACT_VERSION, paramsSha256: "", ...edit,
  };
  row.paramsSha256 = sha ?? preflightParamsSha256(row);
  return row;
}

/** A finished run's files, as a source: a fake run, or a live run through a replaying runner (`edit` changes its transcript). */
async function sourceFiles(kind: "fake" | "live", edit: (t: { stages: string[]; lenses: Map<string, string> }) => void = () => {}) {
  const sink = memorySink("source-run");
  const goal = "SW preflight source goal";
  if (kind === "fake") {
    await lib.runFullPipeline(lib.loadRuntime(), { runner: "fake", facts: repoFacts(REPO_ROOT), goal, reviewedAt: new Date().toISOString(),
      reviewedAtExplicit: false }, memoryIo(sink));
  } else {
    const transcript = await fakeTranscript(REPO_ROOT, goal);
    edit(transcript);
    await lib.runFullPipeline(workerRuntime(lib.loadRuntime(), replayRunner(transcript)), {
      runner: "live", facts: repoFacts(REPO_ROOT), goal, reviewedAt: new Date().toISOString(), reviewedAtExplicit: false,
    }, memoryIo(sink, { consent: async () => {}, execution: lib.createReviewOnlyExecutionContext({ caller: "studio-worker", checkRequests: async () => {} }) }));
  }
  return sink.files;
}
const sourceOf = (files: Map<string, Buffer>, edit: Partial<Omit<PreflightSourceRun, "source">> = {}): PreflightSourceRun => ({
  state: "succeeded", deleted: false, kind: "full", runner: "live", importTier: null, factVersionId: FACT_VERSION,
  source: { label: "source-run", displayLabel: "source-run", name: "source-run", exists: () => true,
    readArtifact: async (name) => (files.has(name) ? new Uint8Array(files.get(name)!) : undefined) },
  ...edit,
});

async function preflightOf(edit: Partial<PreflightInputs> & { request?: PreflightRequestRow } = {}) {
  const counted = countedRuntime();
  const outcome = await decidePreflight({
    request: requestRow(), factVersion: version(), sourceRun: null, approvedFacts: approvedRepo(), repoRoot: REPO_ROOT,
    runtime: counted.rt, ...edit,
  });
  return { outcome, calls: counted.calls() };
}
const refusedAs = (r: { outcome: PreflightOutcome; calls: number }, cls: string | RegExp, message?: RegExp) =>
  r.outcome.outcome === "refused" && r.calls === 0 && (typeof cls === "string" ? r.outcome.refusalClass === cls : cls.test(r.outcome.refusalClass))
  && r.outcome.message.length >= 1 && r.outcome.message.length <= 4000 && (!message || message.test(r.outcome.message))
  && /^[a-z][a-z0-9_]{0,63}$/.test(r.outcome.refusalClass);

/** A session whose transactions are recorded: BEGIN, each statement, then COMMIT or ROLLBACK. */
function txRecorder(answer: (text: string) => { rows: Array<Record<string, unknown>>; rowCount: number }) {
  const log: string[] = [];
  const client = { query: async (text: string, values: unknown[] = []) => { log.push(text.replace(/\s+/g, " ").trim()); void values; return answer(text); } };
  const session = {
    tx: async <T>(fn: (c: typeof client) => Promise<T>): Promise<T> => {
      log.push("BEGIN");
      try { const result = await fn(client); log.push("COMMIT"); return result; } catch (error) { log.push("ROLLBACK"); throw error; }
    },
  };
  return { log, session: session as unknown as Pick<WorkerSession, "tx">, values: [] as unknown[] };
}

async function preflightChecks(): Promise<void> {
  // SW18: the parameters are recomputed by the one canonical function before anything else.
  const mismatch = await preflightOf({ request: requestRow({}, "f".repeat(64)) });
  const reordered = await preflightOf({ request: requestRow({ platforms: ["google_business_profile", "facebook", "instagram"] }) });
  const otherFormula = await preflightOf({ request: requestRow({}, createHash("sha256").update(JSON.stringify({
    schema: "gcd-studio-preflight-params/1", action: "full", goal: "SW preflight synthetic goal", platforms: ALL_PLATFORMS,
    scopeTags: null, sourceRunId: null, factVersionId: FACT_VERSION })).digest("hex")) });
  check("SW18. the free preflight recomputes params_sha256 with the canonical function first: a request whose hash does not "
    + "match its parameters — any other hash, or the same object hashed without the canonical sort — is refused as "
    + "params_mismatch with nothing checked and zero executor or provider calls; the same parameters in another order are accepted",
    refusedAs(mismatch, "params_mismatch") && refusedAs(otherFormula, "params_mismatch")
      && reordered.outcome.outcome === "quoted" && reordered.calls === 0,
    `${JSON.stringify(mismatch.outcome).slice(0, 120)} ${JSON.stringify(otherFormula.outcome).slice(0, 120)} ${reordered.outcome.outcome}`);

  // SW18a: the web's request row and the worker's recomputation are the same function.
  const webRow = preflightRequest({ userId: "user-1", action: "full", goal: "SW preflight synthetic goal", platforms: ["facebook", "instagram"],
    scopeTags: ["synthetic-worker"], sourceRunId: null, factVersionId: FACT_VERSION });
  const fromWeb = await preflightOf({ request: { ...requestRow(), ...webRow, id: "req-web", jobId: "job-web" } });
  check("SW18a. a request row as the web writes it (preflightRequest, the web's only path) is accepted by the worker's "
    + "recomputation: both call preflightParamsSha256 from the S2 runner module",
    fromWeb.outcome.outcome === "quoted" && webRow.paramsSha256 === preflightParamsSha256(webRow) && fromWeb.calls === 0,
    JSON.stringify(fromWeb.outcome).slice(0, 200));

  // SW19, SW19a: the quote is computeCostCeiling's lines, the critic panel one item.
  const rt = lib.loadRuntime();
  const full = await preflightOf();
  const lines = full.outcome.outcome === "quoted" ? full.outcome.items.flatMap((i) => i.lines) : [];
  const expected = lib.computeCostCeiling(rt, lib.allStagePolicies(rt)).lines;
  const sum = expected.reduce((t, l) => t + ceilingMicros(l.costUsd!), 0);
  check("SW19. a full run is quoted by the library's own path, stopped at its consent: the breakdown's lines are exactly "
    + "computeCostCeiling's lines for the run's requests (never a second formula), the ceiling is their sum each rounded up "
    + "to the micro-dollar, and no executor, provider factory or output was reached",
    full.outcome.outcome === "quoted" && full.calls === 0 && JSON.stringify(lines) === JSON.stringify(expected)
      && full.outcome.ceilingMicros === sum && full.outcome.revisePlan === null && expected.length === 9,
    `${JSON.stringify(full.outcome).slice(0, 200)}`);
  const items = full.outcome.outcome === "quoted" ? full.outcome.items : [];
  const panel = items.filter((i) => i.unit === "critic-panel");
  const replayFiles = await sourceFiles("fake");
  const replay = await preflightOf({ request: requestRow({ action: "replay_critic", goal: null, sourceRunId: SOURCE_RUN }), sourceRun: sourceOf(replayFiles) });
  const replayItems = replay.outcome.outcome === "quoted" ? replay.outcome.items : [];
  check("SW19a. the critic's four lenses are ONE item — the critic panel, its four lines in lens order — and each stage "
    + "request its own; a critic replay is quoted as that one item; every item's ceiling is the sum of its own lines'",
    items.length === 6 && panel.length === 1 && panel[0]!.lines.map((l) => l.label).join()
      === rt.payloadContract.CRITIC_LENSES.map((lens) => `final-critic:${lens}`).join()
      && items.filter((i) => i.unit === "request").every((i) => i.lines.length === 1 && i.item === i.lines[0]!.label)
      && items.every((i) => numericToMicros(i.ceilingUsd) === i.lines.reduce((t, l) => t + ceilingMicros(l.costUsd!), 0))
      && replayItems.length === 1 && replayItems[0]!.unit === "critic-panel" && replayItems[0]!.lines.length === 4 && replay.calls === 0,
    `${items.map((i) => `${i.item}:${i.lines.length}`).join()} | ${JSON.stringify(replay.outcome).slice(0, 160)}`);

  // SW20: a model with no price row makes no quote.
  const unpricedRt = countedRuntime();
  const resolve0 = unpricedRt.rt.modelPolicy.resolveModelPolicy;
  const unpriced: PreflightOutcome = await decidePreflight({
    request: requestRow(), factVersion: version(), sourceRun: null, approvedFacts: approvedRepo(), repoRoot: REPO_ROOT,
    runtime: { ...unpricedRt.rt, modelPolicy: { ...unpricedRt.rt.modelPolicy,
      resolveModelPolicy: ((policy: Parameters<typeof resolve0>[0]) => (policy === "critic"
        ? { ...resolve0(policy), model: "claude-unpriced-test-model" } : resolve0(policy))) as typeof resolve0 } } as ContentRunRuntime,
  }).catch((error: unknown) => ({ outcome: "refused", refusalClass: "threw", message: String(error), revisePlan: null }));
  check("SW20. a request whose model has no price row is refused as unpriced_request, naming the model, with no quote: an "
    + "unknown price cannot be reserved",
    refusedAs({ outcome: unpriced, calls: unpricedRt.calls() }, "unpriced_request", /claude-unpriced-test-model/),
    JSON.stringify(unpriced).slice(0, 200));

  // SW21: each free refusal, with its class and its message, and no request.
  const manyFacts = Buffer.from(JSON.stringify({ facts: Array.from({ length: 70 }, (_, i) => ({
    id: `synthetic-bulk-${i}`, claim: `SYNTHETIC BULK FIXTURE ${i} - not a real automotive fact.`, subject: "synthetic-bulk",
    attribute: `synthetic-bulk-${i}`, tags: ["synthetic-bulk"], sourceType: "repository_config", sourceRef: "synthetic://bulk",
    provenance: "synthetic fixture", reviewedAt: "2026-09-01T00:00:00.000Z" })) }), "utf8");
  const tampered = new Map(replayFiles);
  // A saved stage 2 output that cites a fact id the rebuilt pack does not hold: its own validator refuses it.
  tampered.set("02-automotive-truth.json", Buffer.from(String(tampered.get("02-automotive-truth.json"))
    .replaceAll("synthetic-worker-fact-0", "synthetic-worker-fact-unknown")));
  const cases: Array<[string, Awaited<ReturnType<typeof preflightOf>>, string | RegExp, RegExp?]> = [
    ["no fact version", await preflightOf({ factVersion: null }), "fact_version_missing"],
    ["the 64-record pack cap", await preflightOf({ factVersion: version(manyFacts), request: requestRow({ scopeTags: ["synthetic-bulk"] }) }),
      /^[a-z_]+$/, /exceeds 64/],
    ["an evidence class no record supplies", await preflightOf({ request: requestRow({ scopeTags: ["no-record-carries-this-tag"] }) }),
      /^[a-z_]+$/, /evidence pack cannot satisfy/],
    ["the contact records", await preflightOf({ approvedFacts: approvedWithout("phone") }), /^[a-z_]+$/, /phone/i],
    ["the identity records", await preflightOf({ approvedFacts: approvedWithout("serviceArea") }), /^[a-z_]+$/, /servicearea|service area|identity/i],
    ["a deleted source", await preflightOf({ request: requestRow({ action: "revise", goal: null, sourceRunId: SOURCE_RUN }),
      sourceRun: sourceOf(replayFiles, { deleted: true }) }), "source_unavailable"],
    ["an unfinished source", await preflightOf({ request: requestRow({ action: "replay_critic", goal: null, sourceRunId: SOURCE_RUN }),
      sourceRun: sourceOf(replayFiles, { state: "running" }) }), "source_not_finished"],
    ["an unverified import", await preflightOf({ request: requestRow({ action: "replay_critic", goal: null, sourceRunId: SOURCE_RUN }),
      sourceRun: sourceOf(replayFiles, { kind: "imported", importTier: "archived_unverified" }) }), "source_not_verified"],
    ["another fact version than the source pinned", await preflightOf({ request: requestRow({ action: "revise", goal: null, sourceRunId: SOURCE_RUN }),
      sourceRun: sourceOf(replayFiles, { factVersionId: "11111111-1111-4111-8111-111111111111" }) }), "fact_version_mismatch"],
    ["source verification (a saved output edited)", await preflightOf({ request: requestRow({ action: "replay_critic", goal: null, sourceRunId: SOURCE_RUN }),
      sourceRun: sourceOf(tampered) }), "stage_execution_error", /not a citable fact in this pack/],
    ["the source's automotive facts", await preflightOf({ request: requestRow({ action: "resume_packaging", goal: null, sourceRunId: SOURCE_RUN }),
      factVersion: version(manyFacts), sourceRun: sourceOf(replayFiles) }), /^[a-z_]+$/, /automotive facts file .* does not match the source run/],
    ["a scope that differs from the source's", await preflightOf({ request: requestRow({ action: "replay_critic", goal: null,
      sourceRunId: SOURCE_RUN, scopeTags: ["synthetic-worker"] }), sourceRun: sourceOf(replayFiles) }), /^[a-z_]+$/, /differs from the source run's recorded scope/],
  ];
  const wrong = cases.filter(([, r, cls, msg]) => !refusedAs(r, cls, msg)).map(([name, r]) => `${name}: ${JSON.stringify(r.outcome).slice(0, 160)} calls ${r.calls}`);
  check("SW21. each free check the CLI makes refuses before any cost, with its class (failure-class shaped) and its "
    + "message (1-4,000 characters) and zero executor or provider calls: no fact version, the 64-record pack cap, an evidence "
    + "class no record supplies, the contact records, the identity records, a deleted, unfinished or unverified source, a fact "
    + "version other than the source's, source verification of an edited saved output, the source's automotive facts, and a "
    + "scope other than the source's",
    wrong.length === 0 && cases.length === 12, wrong.join(" | "));

  // SW23, SW23a: a revise's plan is planRevision's, captured from the library's own call.
  const reviseRequest = requestRow({ action: "revise", goal: null, sourceRunId: SOURCE_RUN });
  const revise = await preflightOf({ request: reviseRequest, sourceRun: sourceOf(replayFiles) });
  const savedCritic = JSON.parse(String(replayFiles.get("06-final-critic.json"))).output;
  const expectedPlan = JSON.parse(JSON.stringify(rt.revision.planRevision(savedCritic)));
  const reviseLines = revise.outcome.outcome === "quoted" ? revise.outcome.items.flatMap((i) => i.lines) : [];
  check("SW23. a revise is quoted with planRevision's plan, as the library's own call returned it, stored beside its quote; "
    + "its lines are computeCostCeiling's for the round the plan starts",
    revise.outcome.outcome === "quoted" && JSON.stringify(revise.outcome.revisePlan) === JSON.stringify(expectedPlan)
      && expectedPlan.kind === "revision" && revise.calls === 0
      && JSON.stringify(reviseLines) === JSON.stringify(lib.computeCostCeiling(rt, lib.revisionPolicies(rt, expectedPlan.startStage)).lines),
    JSON.stringify(revise.outcome).slice(0, 240));
  const passFiles = await sourceFiles("live", (t) => {
    t.lenses.set("production-coherence", JSON.stringify({ verdict: "provisional_pass",
      summary: "Synthetic pass: no production concern.", findings: [] }));
  });
  const noRevision = await preflightOf({ request: reviseRequest, sourceRun: sourceOf(passFiles) });
  const passPlan = JSON.parse(JSON.stringify(rt.revision.planRevision(JSON.parse(String(passFiles.get("06-final-critic.json"))).output)));
  check("SW23a. a revise whose source has no revisable blocking finding is refused as no_revisable_blocking_finding, with "
    + "planRevision's plan (no quote, no request)",
    refusedAs(noRevision, "no_revisable_blocking_finding") && passPlan.kind === "no_revision"
      && JSON.stringify(noRevision.outcome.revisePlan) === JSON.stringify(passPlan),
    JSON.stringify(noRevision.outcome).slice(0, 240));

  // SW22: the outcome and its quote in ONE transaction.
  const binding = { commit: COMMIT, approvedFactsSha256: "a".repeat(64), priceTableSha256: "b".repeat(64) };
  const ok = (text: string) => ({ rows: /INSERT INTO studio_quotes/.test(text) ? [{ id: "quote-1" }] : [], rowCount: 1 });
  const quoted = txRecorder(ok);
  await writePreflightOutcome(quoted.session, binding, requestRow(), full.outcome);
  const refusedTx = txRecorder(ok);
  await writePreflightOutcome(refusedTx.session, binding, requestRow(), cases[0]![1].outcome);
  const conflict = txRecorder((text) => ({ rows: /INSERT INTO studio_quotes/.test(text) ? [{ id: "quote-2" }] : [],
    rowCount: /UPDATE studio_preflight_requests/.test(text) ? 0 : 1 }));
  const conflicted = await writePreflightOutcome(conflict.session, binding, requestRow(), full.outcome).then(() => "written", () => "refused");
  const order = (log: string[]) => log.map((t) => (t === "BEGIN" || t === "COMMIT" || t === "ROLLBACK" ? t
    : /^INSERT INTO studio_quotes/.test(t) ? "quote" : /SET outcome = 'quoted'/.test(t) ? "quoted"
      : /SET outcome = 'refused'/.test(t) ? "refused" : /UPDATE studio_jobs SET state = 'finished'/.test(t) ? "job"
        : /INSERT INTO studio_audit_log/.test(t) ? "audit" : t)).join(",");
  check("SW22. the outcome is written in ONE transaction: the quote, the request's quoted outcome naming it, the job's end "
    + "and the audit row commit together (BEGIN … COMMIT, once); a refusal likewise; and when the request already has an "
    + "outcome the transaction is rolled back, so neither half is written alone",
    order(quoted.log) === "BEGIN,quote,quoted,job,audit,COMMIT" && order(refusedTx.log) === "BEGIN,refused,job,audit,COMMIT"
      && conflicted === "refused" && order(conflict.log) === "BEGIN,quote,quoted,ROLLBACK",
    `${order(quoted.log)} | ${order(refusedTx.log)} | ${order(conflict.log)}`);
}

/** SW24: a confirmed live run on the production wiring (no paid runner) is refused before any work, its reservation released. */
async function productionWiringChecks(): Promise<void> {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      statements.push({ text, values });
      if (/SELECT kind, runner, goal/.test(text)) {
        return { rows: [{ kind: "full", runner: "live", goal: "g", platforms: ALL_PLATFORMS, scope_tags: null, fact_version_id: FACT_VERSION,
          source_run_id: null, quote_id: "q1" }], rowCount: 1 };
      }
      if (/FROM studio_quotes WHERE id/.test(text)) {
        return { rows: [{ worker_commit: COMMIT, approved_facts_sha256: "a".repeat(64), fact_version_id: FACT_VERSION,
          price_table_sha256: "b".repeat(64) }], rowCount: 1 };
      }
      if (/SELECT runner, kind, state, reserved_usd/.test(text)) return { rows: [{ runner: "live", kind: "full", state: "running", reserved: "21.650000" }], rowCount: 1 };
      if (/SELECT entry FROM studio_spend_ledger/.test(text)) return { rows: [{ entry: "reserve" }], rowCount: 1 };
      if (/COALESCE\(SUM\(charged_usd\)/.test(text)) return { rows: [{ charged: "0" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  const session = { tx: async (fn: (c: typeof client) => Promise<unknown>) => fn(client), run: async (fn: (c: typeof client) => Promise<unknown>) => fn(client),
    query: client.query } as unknown as WorkerSession;
  const counted = countedRuntime();
  const logged: string[] = [];
  const state = await executeJob({
    session, commit: COMMIT, caps: CAPS, runtime: counted.rt, repoRoot: REPO_ROOT, approvedFacts: { bytes: Buffer.from("{}"), sha256: "a".repeat(64) },
    priceTableSha256: "b".repeat(64), log: (event, fields) => { logged.push(`${event} ${JSON.stringify(fields)}`); },
  }, { jobId: "j1", kind: "paid", runId: "r1" }).catch(() => "threw");
  const release = statements.find((s) => /INSERT INTO studio_spend_ledger/.test(s.text));
  const runEnd = statements.find((s) => /UPDATE studio_runs SET state = \$2/.test(s.text));
  check("SW24. on the production wiring — no paid stage runner, as start:studio-worker gives none — a confirmed live run "
    + "is refused before any work as live_runs_not_enabled: no fact is read, no executor or provider factory is called, and "
    + "its whole reservation is released",
    state === "refused" && counted.calls() === 0 && release?.values[0] === "release" && release?.values[2] === "21.650000"
      && runEnd?.values[1] === "refused" && runEnd?.values[2] === "live_runs_not_enabled"
      && !statements.some((s) => /studio_fact_versions|studio_run_requests \(/.test(s.text)),
    `${state} ${counted.calls()} ${JSON.stringify(release?.values)} ${JSON.stringify(runEnd?.values?.slice(0, 3))}`);
}

// --- Content Studio S7.2: the fact check, the import's revalidation and the fake source --------------------------------

/** A synthetic automotive record, valid by the contract, plainly labelled. */
const syntheticRecord = (i: number, edit: Record<string, unknown> = {}) => ({
  id: `synthetic-s72-fact-${i}`, claim: `SYNTHETIC S7.2 TEST FIXTURE ${i} - not a real automotive fact.`,
  subject: `synthetic-s72-subject-${i}`, attribute: `synthetic-s72-attr-${i}`, tags: i % 2 ? ["s72-odd", "s72-all"] : ["s72-all"],
  sourceType: "repository_config", sourceRef: "synthetic://s72-test-fixture", provenance: "synthetic S7.2 fixture; not a real source",
  reviewedAt: "2026-09-01T00:00:00.000Z", ...edit,
});
const factsFile = (records: unknown[], top: Record<string, unknown> = {}) => Buffer.from(JSON.stringify({ ...top, facts: records }, null, 2), "utf8");
const loaderMessage = (bytes: Buffer, now: number): string => {
  try { lib.parseAutomotiveFacts(bytes, { label: UPLOAD_LABEL, now }); return "accepted"; } catch (error) { return (error as Error).message; }
};
/** The fact check's statements, by role, in their transactions. */
const factOrder = (log: string[]) => log.map((t) => (t === "BEGIN" || t === "COMMIT" || t === "ROLLBACK" ? t
  : /^INSERT INTO studio_fact_versions .* FROM studio_fact_uploads s WHERE s\.sha256 = \$1/.test(t) ? "version"
    : /SET outcome = 'accepted'/.test(t) ? "accepted" : /SET outcome = 'refused'/.test(t) ? "refused"
      : /^DELETE FROM studio_fact_uploads WHERE sha256 = \$1/.test(t) ? "unstage"
        : /^UPDATE studio_jobs SET state = 'finished' WHERE id = \$1$/.test(t) ? "job"
          : /INSERT INTO studio_audit_log/.test(t) ? "audit" : t)).join(",");
const CHECK_ROW: FactCheckRow = { id: "check-1", jobId: "job-1", requestedBy: "owner-1", sha256: "e".repeat(64), byteLength: 10 };

async function factCheckChecks(): Promise<void> {
  const rt = lib.loadRuntime();
  const approved = approvedRepo();
  const now = Date.now();
  const decide = (bytes: Buffer) => decideFactCheck({ bytes, approvedFacts: approved, runtime: rt, now });
  const sql = readFileSync(resolve(REPO_ROOT, "studio/migrations/0004_studio_fact_checks_and_imports.sql"), "utf8");
  const quoted = (text: string | undefined) => [...(text ?? "").matchAll(/'([^']*)'/g)].map((m) => m[1]!);
  const importNames = quoted(/IF NEW\.name <> ALL \(ARRAY\[([^\]]*)\]\) THEN/.exec(sql)?.[1]).sort();
  const libraryNames = [...new Set(Object.values(lib.RUN_ARTIFACT_NAMES).flat())].sort();
  check("SW27. the import's known file names the web reads (STUDIO_IMPORT_FILE_NAMES, in the S2 runner module the web may "
    + "reach) are exactly the library's RUN_ARTIFACT_NAMES and migration 0004's list, each once — sixteen",
    JSON.stringify([...STUDIO_IMPORT_FILE_NAMES].sort()) === JSON.stringify(libraryNames)
      && JSON.stringify(importNames) === JSON.stringify(libraryNames) && new Set(STUDIO_IMPORT_FILE_NAMES).size === 16,
    [...STUDIO_IMPORT_FILE_NAMES].join(","));

  // SW28: the loader's known field set is the library's export, held equal to what parseAutomotiveFacts reads.
  const sentinel = Object.fromEntries(lib.AUTOMOTIVE_FACT_FIELDS.map((field, i) => [field, `sentinel-${i}`]));
  const read = lib.parseAutomotiveFacts(JSON.stringify({ facts: [{ ...sentinel, kind: "ignored", extraField: "ignored" }] }),
    { label: "t", now: 0 })[0] as Record<string, unknown>;
  const readKeys = Object.keys(read).filter((key) => key !== "kind").sort();
  const each = lib.AUTOMOTIVE_FACT_FIELDS.every((field) => {
    const without = { ...sentinel };
    delete (without as Record<string, unknown>)[field];
    let after: Record<string, unknown> | string;
    try { after = lib.parseAutomotiveFacts(JSON.stringify({ facts: [without] }), { label: "t", now: 0 })[0] as Record<string, unknown>; }
    catch { after = "refused"; }
    return after === "refused" || (after as Record<string, unknown>)[field] !== sentinel[field];
  });
  const factCheckSource = readFileSync(resolve(REPO_ROOT, "src/studio/worker/factCheck.ts"), "utf8");
  const ownLiterals = [...factCheckSource.matchAll(/["']([A-Za-z]+)["']/g)].map((m) => m[1]!)
    .filter((name) => lib.AUTOMOTIVE_FACT_FIELDS.includes(name));
  check("SW28. the loader's known field set is EXPORTED by the library (AUTOMOTIVE_FACT_FIELDS) and equals exactly what "
    + "parseAutomotiveFacts reads — every listed field is read through (dropping any one changes or refuses the record) and "
    + "nothing else is (an extra field and the input's kind are not kept); the fact check names that export and holds no "
    + "field-name list of its own",
    JSON.stringify(readKeys) === JSON.stringify([...lib.AUTOMOTIVE_FACT_FIELDS].sort())
      && lib.AUTOMOTIVE_FACT_FIELDS.every((field) => read[field] === sentinel[field]) && each
      && !("extraField" in read) && read.kind === "verified_automotive_fact" && lib.AUTOMOTIVE_FACT_FIELDS.length === 16
      && /new Set\(lib\.AUTOMOTIVE_FACT_FIELDS\)/.test(factCheckSource) && ownLiterals.length === 0,
    `${readKeys.join(",")} ${ownLiterals.join(",")}`);

  // SW29: every loader error is a refusal with the loader's own message, and writes no version.
  const loaderCases: Array<[string, Buffer]> = [
    ["not JSON", Buffer.from("{ this is not json", "utf8")],
    ["no facts array", Buffer.from(JSON.stringify({ records: [] }), "utf8")],
    ["a missing required field", factsFile([syntheticRecord(0), syntheticRecord(1, { provenance: undefined })])],
  ];
  const loaderResults = await Promise.all(loaderCases.map(async ([label, bytes]) => {
    const decision = await decide(bytes);
    const tx = txRecorder(() => ({ rows: [], rowCount: 1 }));
    if (decision.outcome === "refused") await writeFactCheckOutcome(tx.session, CHECK_ROW, decision);
    return { label, decision, expected: loaderMessage(bytes, now), order: factOrder(tx.log) };
  }));
  check("SW29. every loader error refuses the file with the loader's OWN message (loader_refused) — bytes that are not JSON, "
    + "no facts array, an entry missing a required field — and the refusal's write inserts no version: the outcome, the "
    + "staged bytes' deletion, the job's end and the audit row, in one transaction",
    loaderResults.every((r) => r.decision.outcome === "refused" && r.decision.refusalClass === "loader_refused"
      && r.expected !== "accepted" && r.decision.message === r.expected && r.order === "BEGIN,refused,unstage,job,audit,COMMIT")
      && loaderResults[2]!.decision.outcome === "refused" && /missing required field\(s\): provenance/.test(loaderResults[2]!.decision.message),
    loaderResults.map((r) => `${r.label}: ${JSON.stringify(r.decision).slice(0, 160)} ${r.order}`).join(" | "));

  // SW30: an invalid record is refused with the library's own message.
  const invalid = factsFile([syntheticRecord(0), syntheticRecord(1, { reviewedAt: "not-a-date" })]);
  const invalidDecision = await decide(invalid);
  let packMessage = "accepted";
  try {
    const all = await lib.loadRecords(rt, { facts: { approvedFacts: { path: "a", displayPath: "a", exists: () => true, read: async () => new Uint8Array(approved.bytes) },
      automotiveFacts: { path: UPLOAD_LABEL, displayPath: "x", exists: () => true, read: async () => new Uint8Array(invalid) } }, now,
    reviewedAt: new Date(now).toISOString() });
    rt.packModule.buildEvidencePack({ goal: "g", records: all.records, now });
  } catch (error) { packMessage = (error as Error).message; }
  check("SW30. a file the loader reads but whose record the evidence contract refuses (a reviewedAt that is not a date) is "
    + "refused as pack_refused with the library's own validation message; nothing is accepted",
    invalidDecision.outcome === "refused" && invalidDecision.refusalClass === "pack_refused" && packMessage !== "accepted"
      && invalidDecision.message === packMessage && /synthetic-s72-fact-1/.test(invalidDecision.message),
    JSON.stringify(invalidDecision).slice(0, 300));

  // SW31: over the pack's cap is a warning; every record is still validated and checked in a pack that fits.
  const many = Array.from({ length: 70 }, (_, i) => syntheticRecord(i));
  const over = await decide(factsFile(many));
  const overInvalid = await decide(factsFile([...many.slice(0, 69), syntheticRecord(69, { sourceType: "not-a-source-type" })]));
  const under = await decide(factsFile(many.slice(0, 4)));
  check("SW31. a file whose records, with the approved facts, exceed the pack's 64-record cap is ACCEPTED with the over-cap "
    + "warning (an unscoped run will be refused), not refused; every record is still validated and checked in packs that "
    + "fit — the seventieth record invalid refuses the file — and a file within the cap carries no warning",
    over.outcome === "accepted" && over.overCap && over.recordCount === 70
      && overInvalid.outcome === "refused" && overInvalid.refusalClass === "pack_refused" && /synthetic-s72-fact-69/.test(overInvalid.message)
      && under.outcome === "accepted" && !under.overCap && rt.payloadContract.EVIDENCE_LIMITS.maxProjectedRecords === 64,
    `${JSON.stringify(over).slice(0, 160)} | ${JSON.stringify(overInvalid).slice(0, 200)}`);

  // SW32: unknown field names, names only, entry fields and top-level keys, bounded.
  const SECRET = "SYNTHETIC-VALUE-NEVER-SHOWN";
  const withUnknown = await decide(factsFile([syntheticRecord(0, { vin: SECRET, customerName: SECRET }), syntheticRecord(1)],
    { exportedBy: SECRET, version: 2 }));
  const manyUnknown = await decide(factsFile([syntheticRecord(0, Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`stray${String(i).padStart(3, "0")}`, 1])))]));
  check("SW32. field names outside the loader's known set are listed as a warning — each entry field as facts[].<name>, each "
    + "top-level key besides facts by name — sorted, names only (no value is kept), never refusing the file; and bounded to "
    + "the schema's 200 names",
    withUnknown.outcome === "accepted"
      && JSON.stringify(withUnknown.unknownFields) === JSON.stringify(["exportedBy", "facts[].customerName", "facts[].vin", "version"])
      && !JSON.stringify(withUnknown).includes(SECRET)
      && manyUnknown.outcome === "accepted" && manyUnknown.unknownFields?.length === UNKNOWN_FIELDS_MAX
      && (await decide(factsFile([syntheticRecord(0)]))).unknownFields === null,
    JSON.stringify(withUnknown.unknownFields));

  // SW33: the counts are the uploaded records' only.
  const four = await decide(syntheticFactsBytes());
  const approvedOnly = await lib.countTags(rt, { facts: { approvedFacts: { path: "a", displayPath: "a", exists: () => true,
    read: async () => new Uint8Array(approved.bytes) }, automotiveFacts: { path: "-", displayPath: "-", exists: () => false,
    read: async () => { throw new Error("absent"); } } }, now, reviewedAt: new Date(now).toISOString() });
  check("SW33. a version's record count and tag counts are over the uploaded records only — the approved facts' own tags are "
    + "not added (the new-run page adds the heartbeat's) — each record counted once per tag",
    four.outcome === "accepted" && four.recordCount === 4
      && JSON.stringify(four.tagCounts) === JSON.stringify({ "synthetic-worker": 4, "worker-scope": 2 })
      && approvedOnly.tags.length > 0 && approvedOnly.tags.every((tag) => !(tag in (four.outcome === "accepted" ? four.tagCounts : {}))),
    JSON.stringify(four));

  // SW34: the outcome, the version, the staging row's deletion and the job's end in ONE transaction.
  const ok = (text: string) => ({ rows: [], rowCount: /^\s*DELETE/.test(text) ? 0 : 1 });
  const acceptedNew = txRecorder(ok);
  await writeFactCheckOutcome(acceptedNew.session, CHECK_ROW, { ...(four as Extract<FactCheckOutcome, { outcome: "accepted" }>), existing: false });
  const acceptedExisting = txRecorder(ok);
  await writeFactCheckOutcome(acceptedExisting.session, CHECK_ROW, { ...(four as Extract<FactCheckOutcome, { outcome: "accepted" }>), existing: true });
  const refusedWrite = txRecorder(ok);
  await writeFactCheckOutcome(refusedWrite.session, CHECK_ROW, loaderResults[0]!.decision as FactCheckOutcome);
  const vanished = txRecorder((text) => ({ rows: [], rowCount: /INSERT INTO studio_fact_versions/.test(text) ? 0 : 1 }));
  const vanishedResult = await writeFactCheckOutcome(vanished.session, CHECK_ROW,
    { ...(four as Extract<FactCheckOutcome, { outcome: "accepted" }>), existing: false }).then(() => "written", () => "refused");
  const insert = acceptedNew.log.find((t) => /^INSERT INTO studio_fact_versions/.test(t)) ?? "";
  check("SW34. each outcome is written in ONE transaction with its job's end, in order: a new acceptance inserts the version "
    + "FROM the staged bytes (never bytes the worker holds), then the check's outcome, the staging row's deletion (by the "
    + "check's sha256), the job's end and the audit row; bytes already a version insert nothing; a refusal deletes the staging "
    + "row too; and when the staged bytes are gone the transaction is rolled back, so no outcome is written alone",
    factOrder(acceptedNew.log) === "BEGIN,version,accepted,unstage,job,audit,COMMIT"
      && factOrder(acceptedExisting.log) === "BEGIN,accepted,unstage,job,audit,COMMIT"
      && factOrder(refusedWrite.log) === "BEGIN,refused,unstage,job,audit,COMMIT"
      && vanishedResult === "refused" && factOrder(vanished.log) === "BEGIN,version,ROLLBACK"
      && /SELECT s\.sha256, s\.content, s\.byte_length, \$2, \$3, s\.uploaded_by FROM studio_fact_uploads s/.test(insert),
    `${factOrder(acceptedNew.log)} | ${factOrder(acceptedExisting.log)} | ${factOrder(refusedWrite.log)} | ${factOrder(vanished.log)}`);

  // SW35: the worker's own reads: bytes already a version, and staged bytes that are gone.
  const runCheck = async (staged: boolean, existing: boolean) => {
    const tx = txRecorder((text) => ({ rows: [], rowCount: /^\s*DELETE/.test(text) ? 0 : 1 }));
    const bytes = syntheticFactsBytes();
    const session = {
      ...tx.session,
      query: async (text: string) => {
        if (/FROM studio_fact_checks WHERE job_id/.test(text)) {
          return { rows: [{ id: "check-1", job_id: "job-1", requested_by: "owner-1", sha256: "e".repeat(64), byte_length: bytes.length, outcome: null }] };
        }
        if (/SELECT content FROM studio_fact_uploads/.test(text)) return { rows: staged ? [{ content: bytes }] : [] };
        if (/SELECT 1 FROM studio_fact_versions/.test(text)) return { rows: existing ? [{ "?column?": 1 }] : [] };
        return { rows: [] };
      },
    } as unknown as WorkerSession;
    const answered = await runFactCheck({ session, runtime: rt, approvedFacts: approved } as never,
      { jobId: "job-1", kind: "fact_check", runId: null });
    return { answered, order: factOrder(tx.log), log: tx.log };
  };
  const existingCheck = await runCheck(true, true);
  const goneCheck = await runCheck(false, false);
  const freshCheck = await runCheck(true, false);
  check("SW35. bytes that are already a fact version are accepted, naming that version, with NO insert; staged bytes that "
    + "are no longer the check's are refused (staging_missing) with nothing inserted; and fresh bytes are inserted as a new version",
    existingCheck.answered.outcome === "accepted" && existingCheck.order === "BEGIN,accepted,unstage,job,audit,COMMIT"
      && goneCheck.answered.outcome === "refused" && goneCheck.answered.refusalClass === "staging_missing"
      && goneCheck.order === "BEGIN,refused,unstage,job,audit,COMMIT"
      && freshCheck.answered.outcome === "accepted" && freshCheck.order === "BEGIN,version,accepted,unstage,job,audit,COMMIT",
    `${JSON.stringify(existingCheck.answered)} ${existingCheck.order} | ${JSON.stringify(goneCheck.answered)} ${goneCheck.order} | ${freshCheck.order}`);
}

async function importChecks(): Promise<void> {
  const rt = lib.loadRuntime();
  const approved = approvedRepo();
  const facts = syntheticFactsBytes();
  const pinned = { id: FACT_VERSION, sha256: createHash("sha256").update(facts).digest("hex"), content: facts };
  const live = await sourceFiles("live");
  const folder = (files: Map<string, Buffer>, edit: (m: Map<string, Buffer>) => void = () => {}) => {
    const copy = new Map([...files].map(([k, v]) => [k, Buffer.from(v)] as [string, Buffer]));
    edit(copy);
    return { label: "import", displayLabel: "import", name: "import", exists: () => true,
      readArtifact: async (name: string) => (copy.has(name) ? new Uint8Array(copy.get(name)!) : undefined) };
  };
  const editMeta = (edit: (meta: Record<string, any>) => void) => (m: Map<string, Buffer>) => {
    const meta = JSON.parse(m.get("run-meta.json")!.toString("utf8"));
    edit(meta);
    m.set("run-meta.json", Buffer.from(JSON.stringify(meta, null, 2), "utf8"));
  };
  const decide = (source: ReturnType<typeof folder>, edit: { pinned?: typeof pinned | null; found?: boolean } = {}) => decideImport({
    source, pinned: edit.pinned ?? null, versionBySha: async (sha) => (edit.found === false || sha !== pinned.sha256 ? null : pinned),
    approvedFacts: approved, runtime: rt,
  });
  const meta = JSON.parse(live.get("run-meta.json")!.toString("utf8"));
  const verified = await decide(folder(live));
  check("SW36. a complete live run folder whose approved facts are this commit's and whose named fact version exists is "
    + "VERIFIED by the library's own verifySourceRun in revision mode: its goal, platforms and scope from that result, every "
    + "fingerprint and the fact version set",
    verified.tier === "verified" && verified.goal === meta.goal && JSON.stringify(verified.platforms) === JSON.stringify(meta.platforms)
      && verified.scopeTags === null && verified.factVersionId === FACT_VERSION && verified.approvedFactsSha256 === approved.sha256
      && verified.automotiveFactsSha256 === pinned.sha256 && verified.evidencePackSha256 === meta.evidencePackSha256,
    JSON.stringify(verified).slice(0, 300));

  const corrupt = (m: Map<string, Buffer>) => {
    const script = JSON.parse(m.get("03-hook-story-script.json")!.toString("utf8"));
    script.output.provisional.hook = `${script.output.provisional.hook} [cites an id the pack does not hold: synthetic-unknown-id]`;
    script.output.evidence = { ...(script.output.evidence ?? {}), supportingFactIds: ["synthetic-unknown-id"] };
    m.set("03-hook-story-script.json", Buffer.from(JSON.stringify(script, null, 2), "utf8"));
  };
  let libraryMessage = "verified";
  try {
    await lib.verifySourceRun(rt, { runner: "live", facts: repoFacts(REPO_ROOT), reviewedAt: new Date().toISOString(), reviewedAtExplicit: false },
      folder(live, corrupt), null, { reporter: { log: () => {}, warn: () => {} }, confirmUnproven: lib.refuseUnprovenAutomotiveFacts }, { revise: true });
  } catch (error) { libraryMessage = (error as Error).message; }
  const cases: Array<[string, ImportDecision, string]> = [
    ["an old approved-facts hash", await decide(folder(live, editMeta((m) => { m.approvedFacts.sha256 = "0".repeat(64); }))), "approved_facts_changed"],
    ["a missing fact version", await decide(folder(live), { found: false }), "fact_version_missing"],
    ["a source pin that is another file", await decide(folder(live), { pinned: { ...pinned, sha256: "1".repeat(64) } }), "fact_version_mismatch"],
    ["a failed saved output", await decide(folder(live, corrupt)), "revalidation_failed"],
    ["an incomplete folder", await decide(folder(live, (m) => { m.delete("06-final-critic.json"); })), "incomplete_folder"],
    ["a replay folder", await decide(folder(new Map([["replay-meta.json", Buffer.from("{}")], ["06-final-critic.json", live.get("06-final-critic.json")!]]))),
      "incomplete_folder"],
  ];
  check("SW37. otherwise the import is ARCHIVED (archived_unverified) with its class and reason: an old approved-facts hash "
    + "(approved_facts_changed), a fact version never uploaded (fact_version_missing), a source pin that is another file "
    + "(fact_version_mismatch), a saved output that no longer revalidates — with verifySourceRun's own message "
    + "(revalidation_failed) — and an incomplete folder or a replay folder (incomplete_folder)",
    cases.every(([, d, cls]) => d.tier === "archived_unverified" && d.failureClass === cls && d.message.length >= 1 && d.message.length <= 4000)
      && libraryMessage !== "verified" && (cases[3]![1] as Extract<ImportDecision, { tier: "archived_unverified" }>).message === libraryMessage,
    cases.map(([label, d]) => `${label}: ${d.tier}/${d.tier === "archived_unverified" ? `${d.failureClass} ${d.message.slice(0, 80)}` : ""}`).join(" | "));

  const archivedWith = async (edit: (m: Record<string, any>) => void) => decide(folder(live, editMeta((m) => {
    m.approvedFacts.sha256 = "0".repeat(64);
    edit(m);
  })));
  const longGoal = await archivedWith((m) => { m.goal = "é".repeat(IMPORT_GOAL_MAX_CHARS + 1); });
  const edgeGoal = await archivedWith((m) => { m.goal = "é".repeat(IMPORT_GOAL_MAX_CHARS); });
  const hostile = await archivedWith((m) => { m.goal = "bad\u0000goal"; m.platforms = ["instagram", "myspace"]; m.evidenceScope = { schema: "gcd-evidence-scope/1", tags: ["b", "a"] }; });
  const good = await archivedWith((m) => { m.evidenceScope = { schema: "gcd-evidence-scope/1", tags: ["a", "b"] }; });
  check("SW38. an archived import keeps only bounded metadata from its untrusted run-meta.json: a goal of 1–2,000 characters "
    + "(2,000 kept, 2,001 or a control character null), platforms the library's validator accepts (else null) and a "
    + "well-formed, normalized scope (else null)",
    longGoal.goal === null && edgeGoal.goal === "é".repeat(IMPORT_GOAL_MAX_CHARS) && hostile.goal === null
      && hostile.platforms === null && hostile.scopeTags === null && JSON.stringify(good.scopeTags) === JSON.stringify(["a", "b"])
      && JSON.stringify(good.platforms) === JSON.stringify(meta.platforms),
    JSON.stringify([longGoal.goal?.length, edgeGoal.goal?.length, hostile.goal, hostile.platforms, hostile.scopeTags, good.scopeTags]));

  // SW39: the import's outcome in ONE transaction.
  const importOrder = (log: string[]) => log.map((t) => (t === "BEGIN" || t === "COMMIT" || t === "ROLLBACK" ? t
    : /^UPDATE studio_runs SET goal = \$2/.test(t) ? "metadata" : t === "FINDINGS" ? "findings"
      : /^UPDATE studio_runs SET state = 'succeeded', import_tier = \$2/.test(t) ? "end"
        : /^UPDATE studio_jobs SET state = 'finished' WHERE id = \$1$/.test(t) ? "job" : /INSERT INTO studio_audit_log/.test(t) ? "audit" : t)).join(",");
  const tx = txRecorder(() => ({ rows: [], rowCount: 1 }));
  const values: unknown[][] = [];
  const recording = { tx: async <T>(fn: (c: { query: (t: string, v?: unknown[]) => Promise<unknown> }) => Promise<T>) => tx.session.tx(async (c) =>
    fn({ query: async (t: string, v: unknown[] = []) => { values.push(v); return c.query(t, v); } })) } as unknown as Pick<WorkerSession, "tx">;
  await writeImportOutcome(recording, { runId: "run-1", jobId: "job-1" }, verified, "needs_revision", async () => { tx.log.push("FINDINGS"); });
  const archivedTx = txRecorder(() => ({ rows: [], rowCount: 1 }));
  await writeImportOutcome(archivedTx.session, { runId: "run-1", jobId: "job-1" }, cases[0]![1], null, async () => { archivedTx.log.push("FINDINGS"); });
  const notRunning = txRecorder((text) => ({ rows: [], rowCount: /SET state = 'succeeded'/.test(text) ? 0 : 1 }));
  const notRunningResult = await writeImportOutcome(notRunning.session, { runId: "run-1", jobId: "job-1" }, verified, null, async () => {})
    .then(() => "written", () => "refused");
  check("SW39. an import's outcome is written in ONE transaction with its job's end: its metadata (and, verified, its fact "
    + "version and automotive fingerprint) while still running, the findings rebuilt from its stored critic, then its end — "
    + "succeeded with its tier — the job's end and the audit row; when the import is no longer running the transaction rolls back",
    importOrder(tx.log) === "BEGIN,metadata,findings,end,job,audit,COMMIT"
      && importOrder(archivedTx.log) === "BEGIN,metadata,findings,end,job,audit,COMMIT"
      && values[0]?.[4] === FACT_VERSION && values[0]?.[5] === pinned.sha256 && values[1]?.[1] === "verified"
      && importOrder(notRunning.log) === "BEGIN,metadata,end,ROLLBACK" && notRunningResult === "refused",
    `${importOrder(tx.log)} | ${importOrder(archivedTx.log)} | ${importOrder(notRunning.log)}`);

  // SW40: a fake source is refused by name before any quote, Studio or imported.
  const replay = await sourceFiles("fake");
  const fakeStudio = await preflightOf({ request: requestRow({ action: "revise", goal: null, sourceRunId: SOURCE_RUN }),
    sourceRun: sourceOf(replay, { runner: "fake" }) });
  const fakeImport = await preflightOf({ request: requestRow({ action: "replay_critic", goal: null, sourceRunId: SOURCE_RUN }),
    sourceRun: sourceOf(replay, { runner: "fake", kind: "imported", importTier: "verified" }) });
  const liveImport = await preflightOf({ request: requestRow({ action: "replay_critic", goal: null, sourceRunId: SOURCE_RUN }),
    sourceRun: sourceOf(live, { kind: "imported", importTier: "verified" }) });
  check("SW40. the free preflight refuses a fake source BY NAME (fake_source) before any quote and before the library is "
    + "touched — a Studio fake run and a verified import of a fake CLI run alike — while a verified live import is quoted",
    refusedAs(fakeStudio, "fake_source") && refusedAs(fakeImport, "fake_source") && liveImport.outcome.outcome === "quoted",
    `${JSON.stringify(fakeStudio.outcome).slice(0, 120)} ${JSON.stringify(fakeImport.outcome).slice(0, 120)} ${liveImport.outcome.outcome}`);
}

async function main(): Promise<void> {
  await startupChecks();
  beforeWorkChecks();
  await queueStatementChecks();
  migration0004Checks();
  spendChecks();
  await gateChecks();
  await fakeOnlyChecks();
  await findingsChecks();
  await preflightChecks();
  await productionWiringChecks();
  await factCheckChecks();
  await importChecks();
  console.log(failures === 0 ? `\n[studio-worker] ALL PASS (${total} checks)` : `\n[studio-worker] ${failures} FAILURE(S) of ${total}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((error) => {
  console.error(`[studio-worker] FAIL: ${(error as Error).stack ?? String(error)}`);
  process.exit(1);
});
