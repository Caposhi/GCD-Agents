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
import type { CostCeilingLine, ReviewOnlyRequestUnit } from "../../harness/contentRun/index.js";
import { STUDIO_MIGRATION_LOCK_NAMESPACE } from "../db/runner.js";
import { decideBeforeWork, failureClassOf, workerRuntime, WorkerStop, type BeforeWork } from "./execute.js";
import { claimNextJob, recoverInterruptedRuns, sweepQueuedJobs, terminalize } from "./jobs.js";
import { ceilingMicros, measuredMicros, microsToNumeric, numericToMicros, parseCapMicros } from "./money.js";
import { DbRunSink, REWRITTEN_ARTIFACTS } from "./runSink.js";
import { LIVE_WORKER_OWNERSHIP_KEY, STUDIO_WORKER_OWNERSHIP_NAMESPACE, studioOwnershipKey, type WorkerSession } from "./session.js";
import { decidePaidUnit, planSettlement, type PaidUnitPrice, type PaidUnitSnapshot } from "./spend.js";
import {
  decideSchemaVersion, decideWorkerIdentity, decideWorkerStartup, forbiddenVariablesPresent, FORBIDDEN_PREFIXES,
  FORBIDDEN_VARIABLES, S3_FORBIDDEN_VARIABLES, STUDIO_EXPECTED_MIGRATIONS, STUDIO_SCHEMA_VERSION, type WorkerEnvironment,
} from "./startup.js";
import { memoryIo, memorySink, repoFacts } from "./testSupport.js";
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
    + "AUTONOMY_PHASE, PUBLIC_BASE_URL, ACTIVE_PLATFORMS, any IG_/FB_/GBP_ name and, until S6, ANTHROPIC_API_KEY — "
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
  const extraFile = { name: "0003_later.sql", sha256: "f".repeat(64) };
  check(`SW3a. the worker refuses any schema version but ${STUDIO_SCHEMA_VERSION}: a migration missing from the ledger, an `
    + "extra one recorded or on disk, or a recorded file whose bytes changed",
    decideSchemaVersion(ledger, files) === STUDIO_SCHEMA_VERSION && STUDIO_SCHEMA_VERSION === "0002_studio_schema.sql"
      && refusalOf(() => decideSchemaVersion(ledger.slice(0, 1), files)) === "schema-version"
      && refusalOf(() => decideSchemaVersion(null, files)) === "schema-version"
      && refusalOf(() => decideSchemaVersion([...ledger, extraFile], [...files, extraFile])) === "schema-version"
      && refusalOf(() => decideSchemaVersion([...ledger, extraFile], files)) === "schema-version"
      && refusalOf(() => decideSchemaVersion(ledger, [...files, extraFile])) === "schema-version"
      && refusalOf(() => decideSchemaVersion([ledger[0]!, { ...ledger[1]!, sha256: "0".repeat(64) }], files)) === "migration-changed"
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
    + "is read — with FOR UPDATE SKIP LOCKED, free preflight jobs first, never an expired or cancellation-requested "
    + "job, and only from queued (no retries); it starts the job and its run, claims nothing when nothing is queued, and "
    + "closes — never starts — a job whose run is not queued, instead of stopping the worker",
    /^ownership_lost/.test(lostClaim) && lost.index(/FROM studio_jobs/) === -1
      && claimed?.jobId === "j1" && claimed.runId === "r1"
      && /FOR UPDATE SKIP LOCKED/.test(select) && /ORDER BY \(kind = 'preflight'\) DESC, created_at, id/.test(select)
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
}

async function main(): Promise<void> {
  await startupChecks();
  beforeWorkChecks();
  await queueStatementChecks();
  spendChecks();
  await gateChecks();
  await fakeOnlyChecks();
  console.log(failures === 0 ? `\n[studio-worker] ALL PASS (${total} checks)` : `\n[studio-worker] ${failures} FAILURE(S) of ${total}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((error) => {
  console.error(`[studio-worker] FAIL: ${(error as Error).stack ?? String(error)}`);
  process.exit(1);
});
