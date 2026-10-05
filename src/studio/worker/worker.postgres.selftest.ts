/**
 * Disposable-PostgreSQL suite for the Content Studio worker
 * (docs/CONTENT_STUDIO_DESIGN.md §3.2, §3.3, §5.3, §6.2):
 * `npm run test:studio-worker-postgres`, run on PostgreSQL 16 and 18 in CI's
 * existing *Content Studio* step of the `postgres-integration` job, after the
 * schema suite. **Fake runner only:** no provider, no key, no network beyond
 * the loopback database. Where a paid path is proven, a replaying fake stage
 * runner stands in for the provider; `start:studio-worker` gives none.
 *
 * Safety contract (the schema suite's): STUDIO_DISPOSABLE_POSTGRES=1 and a
 * loopback-only STUDIO_POSTGRES_ADMIN_URL are required; DATABASE_URL and
 * STUDIO_DATABASE_URL must be unset; a pre-existing `gcd_studio` is never
 * touched; every database it creates is dropped, after every pool and worker
 * connection it opened has closed.
 *
 * Every check is `SWP…`, in four groups: `startup`, `queue`, `paid` and
 * `identical`.
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import * as lib from "../../harness/contentRun/index.js";
import type { ContentRunRuntime } from "../../harness/contentRun/index.js";
import { runStudioMigrations, STUDIO_DATABASE_NAME } from "../db/runner.js";
import { closeRun, type PaidStageRunner } from "./execute.js";
import { CRITIC_ARTIFACT } from "./findings.js";
import { ceilingMicros, microsToNumeric, numericToMicros } from "./money.js";
import { studioOwnershipKey } from "./session.js";
import { confirmationsLocked, OVERRUN_ACKNOWLEDGED } from "./spend.js";
import { fakeTranscript, replayRunner, syntheticFactsBytes, type ReplayCall } from "./testSupport.js";
import { startWorker, type WorkerHandle, type WorkerOptions } from "./worker.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const GROUPS = ["startup", "queue", "paid", "identical", "findings"] as const;
type Group = typeof GROUPS[number];
const counts: Record<Group, number> = { startup: 0, queue: 0, paid: 0, identical: 0, findings: 0 };
let failures = 0;
function check(group: Group, name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  [${group}] ${name}${cond || !detail ? "" : ` — ${detail}`}`);
  counts[group] += 1;
  if (!cond) failures += 1;
}

const hex = (seed: string) => createHash("sha256").update(seed).digest("hex");
const COMMIT = hex("studio-worker-postgres-suite").slice(0, 40);
/**
 * In-process workers' deployment ceilings. Generous on purpose: the paid group
 * charges many full request ceilings (timeouts, kills, an overrun) on one day,
 * and the caps' own refusal is proven separately (a worker whose caps are zero).
 */
const CAPS = { dailyMicros: 1_000_000_000, monthlyMicros: 10_000_000_000 };
const GOAL = "SYNTHETIC worker-suite goal: brake service explained plainly";
const sleep = (ms: number) => new Promise<void>((settle) => setTimeout(settle, ms));

// ---------------------------------------------------------------------------
// Environment, disposable databases and pools (the schema suite's contract)
// ---------------------------------------------------------------------------

function adminUrl(): string {
  if (process.env.STUDIO_DISPOSABLE_POSTGRES !== "1") {
    throw new Error("STUDIO_DISPOSABLE_POSTGRES=1 is required for this destructive disposable-database test");
  }
  if (process.env.DATABASE_URL !== undefined || process.env.STUDIO_DATABASE_URL !== undefined) {
    throw new Error("unset DATABASE_URL and STUDIO_DATABASE_URL: this suite builds each worker's environment itself");
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

interface PoolState { label: string; closing: boolean; closed: Promise<void>[] }
const poolStates = new Map<pg.Pool, PoolState>();
const unexpectedPoolErrors: string[] = [];

function openPool(label: string, config: pg.PoolConfig): pg.Pool {
  const pool = new pg.Pool(config);
  const state: PoolState = { label, closing: false, closed: [] };
  pool.on("connect", (client) => { state.closed.push(new Promise<void>((settle) => client.once("end", () => settle()))); });
  pool.on("error", (error: Error) => {
    const code = (error as { code?: unknown }).code;
    if (state.closing && code === CONNECTION_TERMINATED) return;
    unexpectedPoolErrors.push(`${label}: ${typeof code === "string" ? code : "no SQLSTATE"} ${error.message}`);
  });
  poolStates.set(pool, state);
  return pool;
}
async function closePool(pool: pg.Pool): Promise<void> {
  const state = poolStates.get(pool)!;
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

/** A migrated Studio database with an owner, a runner and one synthetic fact version. */
interface Studio {
  url: string;
  pool: pg.Pool;
  owner: string;
  runner: string;
  factVersion: string;
  factSha: string;
  close(): Promise<void>;
}

async function migrate(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await runStudioMigrations(client, { directory: resolve(REPO_ROOT, "studio/migrations") });
  } finally {
    await client.end();
  }
}

async function studio(dbs: Databases, label: string, { migrated = true } = {}): Promise<Studio> {
  const url = await dbs.create(STUDIO_DATABASE_NAME);
  if (migrated) await migrate(url);
  const pool = openPool(label, { connectionString: url, max: 4 });
  let owner = "";
  let runner = "";
  let factVersion = "";
  const facts = syntheticFactsBytes();
  const factSha = createHash("sha256").update(facts).digest("hex");
  if (migrated) {
    owner = (await pool.query("INSERT INTO studio_users (email, role, google_sub) VALUES ($1, 'owner', $2) RETURNING id",
      [`owner.${randomBytes(3).toString("hex")}@germancardepot.com`, `sub-${randomBytes(6).toString("hex")}`])).rows[0].id;
    runner = (await pool.query("INSERT INTO studio_users (email, role, created_by) VALUES ($1, 'runner', $2) RETURNING id",
      [`runner.${randomBytes(3).toString("hex")}@germancardepot.com`, owner])).rows[0].id;
    await pool.query("INSERT INTO studio_fact_uploads (content, sha256, byte_length, uploaded_by) VALUES ($1, $2, $3, $4)",
      [facts, factSha, facts.length, owner]);
    factVersion = (await pool.query(
      `INSERT INTO studio_fact_versions (sha256, content, byte_length, record_count, tag_counts, uploaded_by)
       VALUES ($1, $2, $3, 4, '{}', $4) RETURNING id`, [factSha, facts, facts.length, owner])).rows[0].id;
    await pool.query("DELETE FROM studio_fact_uploads");
  }
  return {
    url, pool, owner, runner, factVersion, factSha,
    async close() { await closePool(pool); await dbs.drop(STUDIO_DATABASE_NAME); },
  };
}

// ---------------------------------------------------------------------------
// Jobs, workers and children
// ---------------------------------------------------------------------------

async function fakeJob(st: Studio, goal = GOAL): Promise<{ runId: string; jobId: string }> {
  const runId = (await st.pool.query(
    `INSERT INTO studio_runs (kind, requested_by, runner, goal, fact_version_id, automotive_facts_sha256)
     VALUES ('full', $1, 'fake', $2, $3, $4) RETURNING id`, [st.owner, goal, st.factVersion, st.factSha])).rows[0].id;
  const jobId = (await st.pool.query("INSERT INTO studio_jobs (run_id, kind) VALUES ($1, 'fake') RETURNING id", [runId])).rows[0].id;
  return { runId, jobId };
}

interface PaidSpec {
  ceilingMicros?: number;
  requestedBy?: "owner" | "runner";
  quoteUser?: "owner" | "runner";
  workerCommit?: string;
  /** Statements run in the creating transaction, after the job exists. */
  after?: (c: pg.PoolClient, ids: { runId: string; jobId: string; quoteId: string }) => Promise<void>;
  reserve?: boolean;
  consume?: boolean;
  /** Triggers disabled around the insert: a row written directly, past the schema's own checks. */
  disable?: Array<[string, string]>;
  expiresInMs?: number;
}

let fullCeiling: { micros: number; breakdown: string } = { micros: 0, breakdown: "[]" };
let approvedSha = "";

async function paidJob(st: Studio, spec: PaidSpec = {}): Promise<{ runId: string; jobId: string; reserved: number }> {
  const reserved = spec.ceilingMicros ?? fullCeiling.micros;
  const requester = spec.requestedBy === "runner" ? st.runner : st.owner;
  const quoteUser = spec.quoteUser ? (spec.quoteUser === "runner" ? st.runner : st.owner) : requester;
  const client = await st.pool.connect();
  try {
    for (const [table, trigger] of spec.disable ?? []) await client.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
    await client.query("BEGIN");
    const quoteId = (await client.query(
      `INSERT INTO studio_quotes (user_id, action, params_sha256, worker_commit, approved_facts_sha256, fact_version_id,
                                  price_table_sha256, ceiling_usd, breakdown)
       VALUES ($1, 'full', $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [quoteUser, hex(randomBytes(8).toString("hex")), spec.workerCommit ?? COMMIT, approvedSha, st.factVersion,
        lib.priceTableSha256(), microsToNumeric(reserved), fullCeiling.breakdown])).rows[0].id;
    const runId = (await client.query(
      `INSERT INTO studio_runs (kind, requested_by, runner, goal, fact_version_id, automotive_facts_sha256, quote_id, reserved_usd)
       VALUES ('full', $1, 'live', $2, $3, $4, $5, $6) RETURNING id`,
      [requester, GOAL, st.factVersion, st.factSha, quoteId, microsToNumeric(reserved)])).rows[0].id;
    if (spec.reserve !== false) {
      await client.query("INSERT INTO studio_spend_ledger (entry, run_id, amount_usd) VALUES ('reserve', $1, $2)", [runId, microsToNumeric(reserved)]);
    }
    const expires = spec.expiresInMs === undefined ? null : `${spec.expiresInMs} milliseconds`;
    const jobId = (await client.query(
      `INSERT INTO studio_jobs (run_id, kind, expires_at) VALUES ($1, 'paid', CASE WHEN $2::interval IS NULL THEN NULL ELSE now() + $2::interval END)
       RETURNING id`, [runId, expires])).rows[0].id;
    if (spec.consume !== false) await client.query("UPDATE studio_quotes SET consumed_at = now() WHERE id = $1", [quoteId]);
    await spec.after?.(client, { runId, jobId, quoteId });
    await client.query("COMMIT");
    return { runId, jobId, reserved };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    for (const [table, trigger] of spec.disable ?? []) await client.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
    client.release();
  }
}

const TERMINAL = new Set(["succeeded", "failed", "refused", "cancelled", "interrupted"]);
async function waitFor<T>(what: string, probe: () => Promise<T | undefined | null | false>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value as T;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}
async function runRow(st: Studio, runId: string) {
  return (await st.pool.query(
    `SELECT state, failure_class, verdict, actual_usd::text AS actual, reserved_usd::text AS reserved FROM studio_runs WHERE id = $1`,
    [runId])).rows[0];
}
const terminal = (st: Studio, runId: string, timeoutMs?: number) =>
  waitFor(`run ${runId} to finish`, async () => { const r = await runRow(st, runId); return TERMINAL.has(r.state) ? r : undefined; }, timeoutMs);
async function ledgerOf(st: Studio, runId: string): Promise<string> {
  return (await st.pool.query("SELECT entry, amount_usd::text AS amount FROM studio_spend_ledger WHERE run_id = $1 ORDER BY entry",
    [runId])).rows.map((r) => `${r.entry}:${r.amount}`).join(",");
}
async function requestsOf(st: Studio, runId: string) {
  return (await st.pool.query(
    `SELECT seq, stage, lens, outcome, ceiling_usd::text AS ceiling, cost_usd::text AS cost, charged_usd::text AS charged
       FROM studio_run_requests WHERE run_id = $1 ORDER BY seq`, [runId])).rows;
}
async function artifactNames(st: Studio, runId: string): Promise<string[]> {
  return (await st.pool.query("SELECT name FROM studio_run_artifacts WHERE run_id = $1 ORDER BY name", [runId])).rows.map((r) => r.name);
}

/** The library runtime with its real provider runner factory counted: it must never be called. */
let realFactoryCalls = 0;
function countedRuntime(): ContentRunRuntime {
  const base = lib.loadRuntime();
  return { ...base, stageExecution: { ...base.stageExecution, createAnthropicStageRunner: () => {
    realFactoryCalls += 1;
    throw new Error("the real provider runner factory was called");
  } } as ContentRunRuntime["stageExecution"] };
}

const logs: string[] = [];
function inProcess(st: Studio, extra: Partial<WorkerOptions> = {}): WorkerHandle {
  return startWorker({
    connectionString: st.url, commit: COMMIT, caps: CAPS, repoRoot: REPO_ROOT, pollMs: 50, ownershipRetryMs: 200,
    log: (event, fields) => logs.push(`${event} ${JSON.stringify(fields ?? {})}`), runtime: countedRuntime(), ...extra,
  });
}

interface Child { process: ChildProcess; output: string[]; exited: Promise<number | null> }
function childWorker(url: string, extraArgs: string[] = []): Child {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "", STUDIO_DATABASE_URL: url, STUDIO_MAX_DAILY_USD: "75", STUDIO_MAX_MONTHLY_USD: "300",
    RENDER_GIT_COMMIT: COMMIT,
  };
  for (const name of ["LANG", "TZ", "TMPDIR"]) { const v = process.env[name]; if (v !== undefined) env[name] = v; }
  const child = spawn(process.execPath, [...extraArgs, resolve(REPO_ROOT, "dist/studio/worker/main.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
  const output: string[] = [];
  const collect = (chunk: Buffer) => output.push(...chunk.toString("utf8").split("\n").filter(Boolean));
  child.stdout!.on("data", collect);
  child.stderr!.on("data", collect);
  return { process: child, output, exited: new Promise((settle) => child.once("exit", (code) => settle(code))) };
}
const has = (child: Child, prefix: string) => child.output.some((line) => line.startsWith(prefix));

// ---------------------------------------------------------------------------
// startup
// ---------------------------------------------------------------------------

async function startupGroup(dbs: Databases): Promise<void> {
  const holders = async (pool: pg.Pool) => {
    const [a, b] = studioOwnershipKey();
    return Number((await pool.query(
      `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted
          AND classid = ($1::bigint & 4294967295)::oid AND objid = ($2::bigint & 4294967295)::oid AND objsubid = 2`, [a, b])).rows[0].n);
  };
  const refusalOf = async (handle: WorkerHandle) => handle.stopped.then(() => "stopped", (e) => String((e as { reason?: string }).reason ?? (e as Error).message));

  // An unmigrated gcd_studio: the in-process worker and the real entry point both refuse.
  const fresh = await studio(dbs, "unmigrated", { migrated: false });
  try {
    const refused = await refusalOf(inProcess(fresh));
    const child = childWorker(fresh.url);
    const code = await child.exited;
    const tables = (await fresh.pool.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'")).rows[0].n;
    check("startup", "SWP1. against an unmigrated gcd_studio the worker refuses (not-migrated) — in process and through "
      + "npm run start:studio-worker, which exits 1 — before taking ownership or creating anything",
      refused === "not-migrated" && code === 1 && has(child, "[studio-worker] refused (not-migrated)") && !has(child, "[studio-worker] ready")
        && tables === 0 && await holders(fresh.pool) === 0, `${refused} ${code} ${child.output.join(" | ")}`);
  } finally { await fresh.close(); }

  // A database of another name.
  const otherName = `gcd_studio_disposable_${randomBytes(4).toString("hex")}`;
  const otherUrl = await dbs.create(otherName);
  try {
    const refused = await refusalOf(startWorker({ connectionString: otherUrl, commit: COMMIT, caps: CAPS, repoRoot: REPO_ROOT, log: () => {} }));
    check("startup", "SWP1a. against a database not named gcd_studio the worker refuses (wrong-database): the runtime "
      + "repetition of S2's current_database() and identity check", refused === "wrong-database", refused);
  } finally { await dbs.drop(otherName); }

  // The schema version: an extra migration on disk, a changed file, an extra ledger row.
  const st = await studio(dbs, "schema-version");
  const root = mkdtempSync(join(tmpdir(), "gcd-studio-worker-root-"));
  try {
    mkdirSync(join(root, "config"), { recursive: true });
    cpSync(resolve(REPO_ROOT, "config/approved-facts.json"), join(root, "config/approved-facts.json"));
    cpSync(resolve(REPO_ROOT, "studio/migrations"), join(root, "studio/migrations"), { recursive: true });
    writeFileSync(join(root, "studio/migrations/0003_later.sql"), "SELECT 1;\n");
    const extraFile = await refusalOf(inProcess(st, { repoRoot: root }));
    rmSync(join(root, "studio/migrations/0003_later.sql"));
    writeFileSync(join(root, "studio/migrations/0002_studio_schema.sql"),
      `${readFileSync(join(root, "studio/migrations/0002_studio_schema.sql"), "utf8")}\n-- edited\n`);
    const changed = await refusalOf(inProcess(st, { repoRoot: root }));
    await st.pool.query("INSERT INTO studio_schema_migrations (name, sha256) VALUES ('0003_later.sql', $1)", [hex("later")]);
    const extraRow = await refusalOf(inProcess(st));
    const beats = (await st.pool.query("SELECT count(*)::int AS n FROM studio_worker_heartbeat")).rows[0].n;
    check("startup", "SWP1b. the worker refuses any schema version but the one its code expects — an extra migration in "
      + "its own files (schema-version), a recorded file whose bytes changed (migration-changed), an extra recorded "
      + "migration (schema-version) — before ownership, writing no heartbeat",
      extraFile === "schema-version" && changed === "migration-changed" && extraRow === "schema-version" && beats === 0
        && await holders(st.pool) === 0, `${extraFile} ${changed} ${extraRow}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
    await st.close();
  }
}

// ---------------------------------------------------------------------------
// queue: two real worker processes
// ---------------------------------------------------------------------------

async function queueGroup(dbs: Databases): Promise<void> {
  const st = await studio(dbs, "queue");
  const children: Child[] = [];
  try {
    const jobs = [await fakeJob(st), await fakeJob(st), await fakeJob(st), await fakeJob(st)];
    children.push(childWorker(st.url), childWorker(st.url));
    await waitFor("both workers to report", async () => children.every((c) => has(c, "[studio-worker] ready") || has(c, "[studio-worker] ownership.waiting")), 30_000);
    for (const job of jobs) await terminal(st, job.runId);
    const owner = children.find((c) => has(c, "[studio-worker] ready"))!;
    const standby = children.find((c) => c !== owner)!;
    const [a, b] = studioOwnershipKey();
    const lockHolders = (await st.pool.query(
      `SELECT a.application_name FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.locktype = 'advisory' AND l.granted AND l.classid = ($1::bigint & 4294967295)::oid
          AND l.objid = ($2::bigint & 4294967295)::oid AND l.objsubid = 2`, [a, b])).rows;
    const states = await Promise.all(jobs.map((j) => runRow(st, j.runId)));
    const claims = (await st.pool.query("SELECT count(*)::int AS n FROM studio_audit_log WHERE action = 'job.claim'")).rows[0].n;
    const names = await Promise.all(jobs.map((j) => artifactNames(st, j.runId)));
    check("queue", "SWP2. a single consumer under contention: of two worker processes started together, exactly one "
      + "holds the Studio lock and reports ready; the other waits, reports no readiness and claims nothing; every queued "
      + "job runs exactly once, to the full set of a fake run's artifacts",
      children.filter((c) => has(c, "[studio-worker] ready")).length === 1 && has(standby, "[studio-worker] ownership.waiting")
        && !has(standby, "[studio-worker] job.claimed") && !has(standby, "[studio-worker] ready")
        && owner.output.filter((l) => l.startsWith("[studio-worker] job.claimed")).length === 4
        && lockHolders.length === 1 && lockHolders[0]!.application_name === "gcd-studio-worker"
        && states.every((s) => s.state === "succeeded" && s.verdict) && claims === 4
        && names.every((n) => n.length === 11 && n.includes("summary.md") && n.includes("run-meta.json")),
      `${children.map((c) => c.output.join(" / ")).join(" || ")}`);
    // Readiness only after ownership and recovery.
    const order = owner.output.map((l) => l.split(" ")[1]);
    check("queue", "SWP2a. readiness is emitted only after ownership is held and recovery has finished, as the one "
      + "structured ready line",
      order.indexOf("ownership.held") >= 0 && order.indexOf("ownership.held") < order.indexOf("recovery.finished")
        && order.indexOf("recovery.finished") < order.indexOf("ready")
        && owner.output.includes(`[studio-worker] ready {"service":"gcd-studio-worker","commit":"${COMMIT}","state":"postgres"}`));

    // SWP3: kill the owner mid-run. Its first artifact write is held by a table lock, so the run is running.
    const locker = await st.pool.connect();
    let killed: { runId: string; jobId: string };
    try {
      await locker.query("BEGIN");
      await locker.query("LOCK TABLE studio_run_artifacts IN SHARE MODE");
      killed = await fakeJob(st);
      await waitFor("the job to be running", async () => (await runRow(st, killed.runId)).state === "running", 30_000);
      owner.process.kill("SIGKILL");
      await owner.exited;
    } finally {
      await locker.query("ROLLBACK").catch(() => undefined);
      locker.release();
    }
    await waitFor("the standby to take over", async () => has(standby, "[studio-worker] ready"), 60_000);
    const killedRow = await terminal(st, killed!.runId);
    const killedJob = (await st.pool.query("SELECT state FROM studio_jobs WHERE id = $1", [killed!.jobId])).rows[0].state;
    const killedNames = await artifactNames(st, killed!.runId);
    const after = await fakeJob(st);
    const afterRow = await terminal(st, after.runId);
    await sleep(300);
    const reclaims = (await st.pool.query("SELECT count(*)::int AS n FROM studio_audit_log WHERE action = 'job.claim' AND target_id = $1",
      [killed!.jobId])).rows[0].n;
    const recovery = standby.output.find((l) => l.startsWith("[studio-worker] recovery.finished")) ?? "";
    check("queue", "SWP3. refuse, don't resume, after a kill mid-run: with the owner killed (SIGKILL) while its run is "
      + "running, the standby takes the lock, marks the run interrupted (worker_restart) and its job finished during "
      + "recovery, before its own readiness, and resumes nothing — no later artifact, no second claim — then runs new work",
      killedRow.state === "interrupted" && killedRow.failure_class === "worker_restart" && killedJob === "finished"
        && !killedNames.includes("summary.md") && killedNames.every((n) => n === "run-meta.json") && reclaims === 1
        && recovery.includes(killed!.runId) && afterRow.state === "succeeded",
      `${JSON.stringify(killedRow)} ${killedJob} ${killedNames} ${reclaims} ${recovery}`);
  } finally {
    for (const child of children) { child.process.kill("SIGKILL"); await child.exited; }
    await st.close();
  }
}

// ---------------------------------------------------------------------------
// paid: the reservation, the request rows and the stops, with a replaying fake runner
// ---------------------------------------------------------------------------

async function paidGroup(dbs: Databases): Promise<void> {
  const st = await studio(dbs, "paid");
  const transcript = await fakeTranscript(REPO_ROOT, GOAL);
  let current: PaidStageRunner & { calls: ReplayCall[] } = replayRunner(transcript);
  const dispatch = (async (request: never) => current(request)) as unknown as PaidStageRunner;
  let worker = inProcess(st, { paidStageRunner: dispatch, heartbeatMs: 200 });
  const restart = async (extra: Partial<WorkerOptions> = {}) => {
    await worker.stop();
    worker = inProcess(st, { paidStageRunner: dispatch, heartbeatMs: 200, ...extra });
    await worker.ready;
  };
  try {
    await st.pool.query("UPDATE studio_settings SET daily_cap_usd = 1000, monthly_cap_usd = 10000, updated_by = $1", [st.owner]);
    await worker.ready;
    const lines = lib.computeCostCeiling(lib.loadRuntime(), lib.allStagePolicies(lib.loadRuntime())).lines;
    const ceil = lines.map((l) => ceilingMicros(l.costUsd!));

    // SWP4: every request row is durable before its request is sent; reconciliation.
    let runId = "";
    const seen: string[] = [];
    // Seen from the suite's own session, during each call: how many rows the run
    // has, and this call's own row — the stage's latest, or this lens's — and its outcome.
    current = replayRunner(transcript, {
      during: async (call) => {
        const rows = (await st.pool.query(
          "SELECT seq, stage, lens, outcome FROM studio_run_requests WHERE run_id = $1 ORDER BY seq", [runId])).rows;
        const own = call.lens ? rows.find((r) => r.lens === call.lens) : rows[rows.length - 1];
        seen.push(`${call.index}:${rows.length}:${own ? `${own.lens ?? own.stage}=${own.outcome}` : "none"}`);
      },
    });
    const p4 = await paidJob(st, { after: async (_c, ids) => { runId = ids.runId; } });
    runId = p4.runId;
    const r4 = await terminal(st, p4.runId);
    const rows4 = await requestsOf(st, p4.runId);
    const lensNames = ["evidence-fidelity", "platform-and-local", "voice-and-craft", "production-coherence"];
    check("paid", "SWP4. a request row carrying its own ceiling is committed — visible to another session — before each "
      + "request is sent: each stage's started row, one more each time, then the critic panel's four lens rows together, "
      + "written as one unit, each still started while its own request is in flight",
      seen.slice(0, 5).join() === ["0:1:strategy-concept=started", "1:2:automotive-truth=started", "2:3:hook-story-script=started",
        "3:4:production-direction=started", "4:5:packaging-adaptation=started"].join()
        && seen.length === 9 && seen.slice(5).every((s) => /^\d:9:[a-z-]+=started$/.test(s))
        && lensNames.every((lens) => seen.slice(5).some((s) => s.includes(`:${lens}=`)))
        && rows4.length === 9 && rows4.map((r) => r.seq).join() === "1,2,3,4,5,6,7,8,9"
        && rows4.every((r, i) => numericToMicros(r.ceiling) === ceil[i]),
      seen.join(" "));
    check("paid", "SWP4a. a completed paid run is reconciled: each row completed with its measured cost, the run charged "
      + "their sum, and the unused reservation released",
      r4.state === "succeeded" && rows4.every((r) => r.outcome === "succeeded" && r.cost === "0.010000" && r.charged === "0.010000")
        && r4.actual === "0.090000" && await ledgerOf(st, p4.runId) === `release:${microsToNumeric(p4.reserved - 90_000)},reserve:${microsToNumeric(p4.reserved)}`
        && (await artifactNames(st, p4.runId)).length === 11,
      `${JSON.stringify(r4)} ${await ledgerOf(st, p4.runId)}`);

    // SWP5: no request after cancel.
    let cancelRun = "";
    current = replayRunner(transcript, { during: async (call) => {
      if (call.index === 1) await st.pool.query("UPDATE studio_jobs SET cancel_requested_at = now() WHERE run_id = $1", [cancelRun]);
    } });
    const p5 = await paidJob(st, { after: async (_c, ids) => { cancelRun = ids.runId; } });
    const r5 = await terminal(st, p5.runId);
    const calls5 = current.calls.length;
    const job5 = (await st.pool.query("SELECT state FROM studio_jobs WHERE id = $1", [p5.jobId])).rows[0].state;
    current = replayRunner(transcript, { during: async (call) => {
      if (call.index === 5) await st.pool.query("UPDATE studio_jobs SET cancel_requested_at = now() WHERE run_id = $1", [cancelRun]);
    } });
    const p5a = await paidJob(st, { after: async (_c, ids) => { cancelRun = ids.runId; } });
    const r5a = await terminal(st, p5a.runId);
    const calls5a = current.calls.length;
    current = replayRunner(transcript);
    const p5b = await paidJob(st, { after: async (c, ids) => { await c.query("UPDATE studio_jobs SET cancel_requested_at = now() WHERE id = $1", [ids.jobId]); } });
    const r5b = await terminal(st, p5b.runId);
    check("paid", "SWP5. no request after cancel: cancelled during stage 2, the in-flight request completes and no further "
      + "request starts (2 runner calls); the run is cancelled with its 2 requests kept and the rest of its reservation "
      + "released. Cancelled during the first lens, the four-lens unit completes (9 calls). Cancelled while queued, it "
      + "is never claimed: 0 calls and its whole reservation released",
      calls5 === 2 && r5.state === "cancelled" && r5.failure_class === "job_cancelled" && job5 === "cancelled"
        && (await requestsOf(st, p5.runId)).length === 2
        && await ledgerOf(st, p5.runId) === `release:${microsToNumeric(p5.reserved - 20_000)},reserve:${microsToNumeric(p5.reserved)}`
        && calls5a === 9 && r5a.state === "cancelled" && (await requestsOf(st, p5a.runId)).length === 9
        && current.calls.length === 0 && r5b.state === "cancelled" && (await requestsOf(st, p5b.runId)).length === 0
        && await ledgerOf(st, p5b.runId) === `release:${microsToNumeric(p5b.reserved)},reserve:${microsToNumeric(p5b.reserved)}`,
      `${calls5} ${JSON.stringify(r5)} ${calls5a} ${JSON.stringify(r5a)} ${JSON.stringify(r5b)}`);

    // SWP6: zero runner calls without a reservation.
    const zero: Array<[string, Awaited<ReturnType<typeof paidJob>>, string]> = [];
    const attempt = async (label: string, spec: PaidSpec, want: string) => {
      current = replayRunner(transcript);
      const job = await paidJob(st, spec);
      const row = await terminal(st, job.runId);
      zero.push([label, job, `${current.calls.length}:${row.state}:${row.failure_class}:${(await requestsOf(st, job.runId)).length}:`
        + `${(await artifactNames(st, job.runId)).length}`]);
      return want;
    };
    const wants = [
      await attempt("missing", { reserve: false, consume: false, disable: [["studio_runs", "studio_runs_check_confirmation"]] },
        "0:refused:reservation_missing:0:0"),
      await attempt("settled", { after: async (c, ids) => {
        await c.query("INSERT INTO studio_spend_ledger (entry, run_id, amount_usd) VALUES ('release', $1, $2)", [ids.runId, microsToNumeric(fullCeiling.micros)]);
      } }, "0:refused:reservation_settled:0:0"),
      await attempt("expired", { expiresInMs: 1, after: async (c) => { await c.query("SELECT pg_sleep(0.05)"); } }, "0:cancelled:job_expired:0:0"),
      await attempt("wrong user (requester demoted)", { requestedBy: "runner", after: async (c) => {
        await c.query("UPDATE studio_users SET role = 'viewer' WHERE id = $1", [st.runner]);
      } }, "0:refused:requester_not_permitted:0:0"),
      await attempt("wrong user (another user's quote)", { requestedBy: "runner", quoteUser: "owner",
        disable: [["studio_runs", "studio_runs_before_insert"]] }, "0:refused:quote_mismatch:0:0"),
      await attempt("exhausted", { ceilingMicros: 1_000_000 }, "0:refused:reservation_exhausted:0:0"),
      await attempt("version skew", { workerCommit: hex("another worker").slice(0, 40) }, "0:refused:version_skew:0:0"),
    ];
    await st.pool.query("UPDATE studio_users SET role = 'runner' WHERE id = $1", [st.runner]);
    // Caps: a worker whose deployment ceilings are missing (zero) refuses every paid request.
    await restart({ caps: { dailyMicros: 0, monthlyMicros: 0 } });
    wants.push(await attempt("caps missing (zero)", {}, "0:refused:cap_exceeded_daily:0:0"));
    // And the entry point's own worker, with no paid runner: live runs are not enabled in S3.
    await worker.stop();
    worker = inProcess(st, { heartbeatMs: 200 });
    await worker.ready;
    wants.push(await attempt("live without a paid runner (S3)", {}, "0:refused:live_runs_not_enabled:0:0"));
    await restart();
    const releasedInFull = await Promise.all(zero.filter(([label]) => label !== "missing" && label !== "settled")
      .map(async ([, job]) => (await ledgerOf(st, job.runId)) === `release:${microsToNumeric(job.reserved)},reserve:${microsToNumeric(job.reserved)}`));
    check("paid", "SWP6. zero runner calls without a reservation: a missing or already-settled reservation, an expired "
      + "job, a wrong user (the requester demoted, or another user's quote written past the schema's trigger), an "
      + "exhausted reservation, a quote for another worker commit, deployment caps that are missing (zero), and a live "
      + "job on a worker with no paid runner each make 0 runner calls, 0 request rows and 0 artifacts, and release "
      + "the reservation in full",
      zero.every(([, , got], i) => got === wants[i]) && releasedInFull.every(Boolean) && zero.length === 9,
      zero.map(([label, , got], i) => `${label}=${got}${got === wants[i] ? "" : `≠${wants[i]}`}`).join("; "));

    // SWP7: an overrun stops the run and locks confirmations until the owner acknowledges it.
    let overrunReserved = 0;
    current = replayRunner(transcript, { costUsd: (call) => (call.index === 0 ? (overrunReserved + 500_000) / 1e6 : 0.01) });
    const p7 = await paidJob(st, { after: async () => { overrunReserved = fullCeiling.micros; } });
    const r7 = await terminal(st, p7.runId);
    const calls7 = current.calls.length;
    const lockedAfter = await confirmationsLocked(st.pool);
    current = replayRunner(transcript);
    const p7b = await paidJob(st);
    const r7b = await terminal(st, p7b.runId);
    const calls7b = current.calls.length;
    await st.pool.query(`INSERT INTO studio_audit_log (actor_user_id, action, target_type, target_id, detail)
      VALUES ($1, '${OVERRUN_ACKNOWLEDGED}', 'studio_runs', $2, '{}')`, [st.owner, p7.runId]);
    const lockedAfterAck = await confirmationsLocked(st.pool);
    current = replayRunner(transcript);
    const p7c = await paidJob(st);
    const r7c = await terminal(st, p7c.runId);
    check("paid", "SWP7. an overrun stops the run: a first request charged over the whole reservation fails the run "
      + "(cost_ceiling_exceeded) with no further request and its overrun booked; new confirmations are then locked — "
      + "the next confirmed run makes 0 runner calls (confirmations_locked) — until the owner acknowledges the overrun",
      calls7 === 1 && r7.state === "failed" && r7.failure_class === "cost_ceiling_exceeded"
        && await ledgerOf(st, p7.runId) === `overrun:0.500000,reserve:${microsToNumeric(p7.reserved)}`
        && r7.actual === microsToNumeric(p7.reserved + 500_000) && lockedAfter
        && calls7b === 0 && r7b.state === "refused" && r7b.failure_class === "confirmations_locked"
        && !lockedAfterAck && r7c.state === "succeeded" && current.calls.length === 9,
      `${calls7} ${JSON.stringify(r7)} ${await ledgerOf(st, p7.runId)} ${lockedAfter} ${calls7b} ${JSON.stringify(r7b)} ${lockedAfterAck} ${JSON.stringify(r7c)}`);

    // SWP8: no retries.
    current = replayRunner(transcript, { fail: (call) => call.index === 1 });
    const p8 = await paidJob(st);
    const r8 = await terminal(st, p8.runId);
    await sleep(400);
    const rows8 = await requestsOf(st, p8.runId);
    const claims8 = (await st.pool.query("SELECT count(*)::int AS n FROM studio_audit_log WHERE action = 'job.claim' AND target_id = $1", [p8.jobId])).rows[0].n;
    check("paid", "SWP8. no retries: a request that fails with no response ends the run (failed) after exactly 2 runner "
      + "calls; its row stays charged its full ceiling; the job is never claimed again",
      r8.state === "failed" && current.calls.length === 2 && claims8 === 1 && rows8.length === 2
        && rows8[1]!.outcome === "failed" && rows8[1]!.cost === null && numericToMicros(rows8[1]!.charged) === ceil[1]
        && (await st.pool.query("SELECT state FROM studio_jobs WHERE id = $1", [p8.jobId])).rows[0].state === "finished",
      `${JSON.stringify(r8)} ${current.calls.length} ${claims8} ${JSON.stringify(rows8)}`);

    // SWP9: the wall clock, at the unit check and while a request is in flight.
    await restart({ jobTimeoutMs: 700 });
    current = replayRunner(transcript, { during: () => sleep(300) });
    const p9 = await paidJob(st);
    const r9 = await terminal(st, p9.runId);
    const calls9 = current.calls.length;
    let release: () => void = () => {};
    current = replayRunner(transcript, { during: () => new Promise<void>((settle) => { release = settle; }) });
    const p9b = await paidJob(st);
    const r9b = await terminal(st, p9b.runId);
    release();
    await sleep(200);
    await restart();
    check("paid", "SWP9. the wall-clock limit: a job past it starts no further request and fails (job_timeout); one whose "
      + "request is still in flight at the limit is failed then, its unfinished request charged its full ceiling",
      r9.state === "failed" && r9.failure_class === "job_timeout" && calls9 >= 2 && calls9 <= 4
        && r9b.state === "failed" && r9b.failure_class === "job_timeout"
        && (await requestsOf(st, p9b.runId)).length === 1 && (await requestsOf(st, p9b.runId))[0]!.outcome === "failed",
      `${JSON.stringify(r9)} ${calls9} ${JSON.stringify(r9b)}`);

    // SWP10: a kill mid-request reconciles from the durable rows.
    let hung: () => void = () => {};
    current = replayRunner(transcript, { during: (call) => (call.index === 1 ? new Promise<void>((settle) => { hung = settle; }) : undefined) });
    const p10 = await paidJob(st);
    await waitFor("the second request to be in flight", async () => current.calls.length === 2, 30_000)
      .catch(async (e) => { throw new Error(`${(e as Error).message}: ${JSON.stringify(await runRow(st, p10.runId))} ${logs.slice(-6).join(" | ")}`); });
    await dbs.admin.query("SELECT pg_terminate_backend($1)", [worker.backendPid()]);
    hung();
    const lost = await worker.stopped.then(() => "stopped", () => "lost");
    worker = inProcess(st, { paidStageRunner: dispatch, heartbeatMs: 200 });
    await worker.ready;
    const r10 = await runRow(st, p10.runId);
    const rows10 = await requestsOf(st, p10.runId);
    const charged10 = 10_000 + ceil[1]!;
    check("paid", "SWP10. refuse, don't resume, mid-request: the worker's session killed while request 2 is in flight, "
      + "the next worker marks the run interrupted and reconciles it from the durable rows — request 1 at its measured "
      + "cost, the started request 2 at its full ceiling — releasing the rest of the reservation",
      lost === "lost" && r10.state === "interrupted" && r10.failure_class === "worker_restart"
        && rows10.length === 2 && rows10[0]!.cost === "0.010000" && rows10[1]!.outcome === "failed" && rows10[1]!.cost === null
        && r10.actual === microsToNumeric(charged10)
        && await ledgerOf(st, p10.runId) === `release:${microsToNumeric(p10.reserved - charged10)},reserve:${microsToNumeric(p10.reserved)}`,
      `${lost} ${JSON.stringify(r10)} ${JSON.stringify(rows10)} ${await ledgerOf(st, p10.runId)}`);

    // SWP11: free preflight jobs are claimed before paid and fake ones.
    await worker.stop();
    current = replayRunner(transcript);
    const q1 = await paidJob(st);
    const q2 = await fakeJob(st);
    const pre = (await st.pool.query("INSERT INTO studio_jobs (kind) VALUES ('preflight') RETURNING id")).rows[0].id;
    worker = inProcess(st, { paidStageRunner: dispatch, heartbeatMs: 200 });
    await worker.ready;
    await terminal(st, q1.runId);
    await terminal(st, q2.runId);
    const claimOrder = (await st.pool.query(
      `SELECT target_id FROM studio_audit_log WHERE action = 'job.claim' AND target_id = ANY($1::text[]) ORDER BY at, id`,
      [[q1.jobId, q2.jobId, pre]])).rows.map((r) => r.target_id);
    const preState = (await st.pool.query("SELECT state FROM studio_jobs WHERE id = $1", [pre])).rows[0].state;
    check("paid", "SWP11. a queued free preflight job is claimed before queued paid and fake jobs created earlier (and, "
      + "until S6 builds the preflight, closed at once); then the rest in creation order",
      claimOrder.join() === [pre, q1.jobId, q2.jobId].join() && preState === "finished",
      claimOrder.join());

    // SWP11a: a job whose run is not queued is closed, never started, and the worker carries on.
    const orphanRun = (await st.pool.query(
      `INSERT INTO studio_runs (kind, requested_by, runner, goal, fact_version_id, automotive_facts_sha256)
       VALUES ('full', $1, 'fake', $2, $3, $4) RETURNING id`, [st.owner, GOAL, st.factVersion, st.factSha])).rows[0].id;
    await st.pool.query("UPDATE studio_runs SET state = 'cancelled', finished_at = now() WHERE id = $1", [orphanRun]);
    const orphanJob = (await st.pool.query("INSERT INTO studio_jobs (run_id, kind) VALUES ($1, 'fake') RETURNING id", [orphanRun])).rows[0].id;
    const orphanState = await waitFor("the orphan job to be closed", async () => {
      const row = (await st.pool.query("SELECT state FROM studio_jobs WHERE id = $1", [orphanJob])).rows[0];
      return row.state !== "queued" ? row.state : undefined;
    }, 30_000);
    const emptyScope = (await st.pool.query(
      `INSERT INTO studio_runs (kind, requested_by, runner, goal, scope_tags, fact_version_id, automotive_facts_sha256)
       VALUES ('full', $1, 'fake', $2, '{}', $3, $4) RETURNING id`, [st.owner, GOAL, st.factVersion, st.factSha])).rows[0].id;
    await st.pool.query("INSERT INTO studio_jobs (run_id, kind) VALUES ($1, 'fake')", [emptyScope]);
    const emptyScopeRow = await terminal(st, emptyScope);
    const afterOrphan = await fakeJob(st);
    const afterOrphanRow = await terminal(st, afterOrphan.runId);
    check("paid", "SWP11a. a queued job whose run is no longer queued is closed (cancelled) without being started or "
      + "retried, a run whose stored scope is an empty tag list is refused (invalid_scope_tags) before any work, and the "
      + "worker carries on with the next job",
      orphanState === "cancelled" && (await runRow(st, orphanRun)).state === "cancelled" && afterOrphanRow.state === "succeeded"
        && emptyScopeRow.state === "refused" && emptyScopeRow.failure_class === "invalid_scope_tags"
        && (await artifactNames(st, emptyScope)).length === 0
        && (await st.pool.query("SELECT count(*)::int AS n FROM studio_audit_log WHERE action = 'job.refused' AND target_id = $1",
          [orphanJob])).rows[0].n === 1);

    // SWP12: the heartbeat.
    const beat1 = (await st.pool.query("SELECT *, beat_at::text AS at FROM studio_worker_heartbeat")).rows[0];
    await sleep(500);
    const beat2 = (await st.pool.query("SELECT beat_at::text AS at FROM studio_worker_heartbeat")).rows[0];
    check("paid", "SWP12. the worker writes the singleton heartbeat — its commit, the schema version, the approved-facts "
      + "sha256 and tag counts, and the price table's sha256 — and keeps it fresh on its interval",
      beat1.commit === COMMIT && beat1.schema_version === "0002_studio_schema.sql" && beat1.approved_facts_sha256 === approvedSha
        && beat1.price_table_sha256 === lib.priceTableSha256() && Object.keys(beat1.approved_facts_tag_counts).length > 0
        && beat2.at > beat1.at);
    check("paid", "SWP13. fake runner only: across every worker in this suite the real provider runner factory was "
      + "called zero times", realFactoryCalls === 0, String(realFactoryCalls));
  } finally {
    await worker.stop();
    await st.close();
  }
}

// ---------------------------------------------------------------------------
// identical: a full fake run through the worker writes the CLI's bytes
// ---------------------------------------------------------------------------

const PRELOAD = `// Pins the clock and the asset-read order, as scripts/local/content-run-golden.mjs does.
const FIXED = Date.parse("2026-09-29T12:00:00.000Z");
const RealDate = Date;
class PinnedDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(FIXED); else super(...args); }
  static now() { return FIXED; }
}
globalThis.Date = PinnedDate;
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const realReadFile = fsp.readFile;
let tail = Promise.resolve();
fsp.readFile = function readFileInIssueOrder(...args) {
  const run = tail.then(() => realReadFile.apply(fsp, args));
  tail = run.catch(() => {});
  return run;
};
syncBuiltinESMExports();
`;

async function identicalGroup(dbs: Databases): Promise<void> {
  const st = await studio(dbs, "identical");
  const work = mkdtempSync(join(tmpdir(), "gcd-studio-worker-identical-"));
  let child: Child | undefined;
  try {
    const preload = join(work, "pin.mjs");
    writeFileSync(preload, PRELOAD);
    // The CLI, in a root of its own: its scripts, the real dist/, the approved facts and the synthetic facts at the default path.
    const root = join(work, "root");
    mkdirSync(join(root, "scripts/local"), { recursive: true });
    mkdirSync(join(root, "config"));
    cpSync(resolve(REPO_ROOT, "scripts/local/content-run.mjs"), join(root, "scripts/local/content-run.mjs"));
    symlinkSync(resolve(REPO_ROOT, "dist"), join(root, "dist"), "dir");
    cpSync(resolve(REPO_ROOT, "config/approved-facts.json"), join(root, "config/approved-facts.json"));
    writeFileSync(join(root, "config/automotive-facts.local.json"), syntheticFactsBytes());
    const out = join(work, "out");
    const cli = await new Promise<{ code: number; stderr: string }>((settle) => execFile(process.execPath,
      ["--import", preload, join(root, "scripts/local/content-run.mjs"), GOAL, "--out-dir", out],
      { env: { PATH: process.env.PATH ?? "" }, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
      (error, _stdout, stderr) => settle({ code: error ? -1 : 0, stderr: String(stderr) })));
    const [dir] = readdirSync(out);
    const cliFiles = new Map(readdirSync(join(out, dir!)).sort().map((name) => [name, readFileSync(join(out, dir!, name))]));
    // The worker, as `npm run start:studio-worker`, under the same pins.
    const job = await fakeJob(st);
    child = childWorker(st.url, ["--import", preload]);
    const row = await terminal(st, job.runId, 120_000);
    const stored = (await st.pool.query("SELECT name, content FROM studio_run_artifacts WHERE run_id = $1 ORDER BY name", [job.runId])).rows;
    const workerFiles = new Map(stored.map((r) => [String(r.name), r.content as Buffer]));
    const differences = [...new Set([...cliFiles.keys(), ...workerFiles.keys()])].sort()
      .filter((name) => !cliFiles.get(name)?.equals(workerFiles.get(name) ?? Buffer.alloc(0)) || !workerFiles.has(name));
    check("identical", "SWP14. a full fake run through the worker stores artifacts byte-identical to the CLI's files for "
      + "the same inputs: the same 11 file names and every byte, run-meta.json's fingerprints included",
      cli.code === 0 && row.state === "succeeded" && cliFiles.size === 11 && workerFiles.size === 11 && differences.length === 0,
      `cli ${cli.code} ${cli.stderr.slice(0, 300)}; worker ${JSON.stringify(row)}; differ: ${differences.join(", ")}`);
  } finally {
    if (child) { child.process.kill("SIGTERM"); await child.exited; }
    rmSync(work, { recursive: true, force: true });
    await st.close();
  }
}

// ---------------------------------------------------------------------------
// findings (Content Studio S5): the worker's derivation, over PostgreSQL
// ---------------------------------------------------------------------------

async function findingsGroup(dbs: Databases): Promise<void> {
  const st = await studio(dbs, "findings");
  const worker = inProcess(st);
  try {
    const job = await fakeJob(st);
    const row = await terminal(st, job.runId);
    await worker.stop();
    const stored = (await st.pool.query("SELECT content FROM studio_run_artifacts WHERE run_id = $1 AND name = $2",
      [job.runId, CRITIC_ARTIFACT])).rows[0];
    const panel = JSON.parse((stored.content as Buffer).toString("utf8")).output.provisional.findings as Array<Record<string, string>>;
    const rows = (await st.pool.query(
      "SELECT idx, lens, severity, category, owner, issue, owner_item FROM studio_findings WHERE run_id = $1 ORDER BY idx",
      [job.runId])).rows;
    const counts = (await st.pool.query(
      `SELECT r.blocking_findings, r.advisory_findings, r.owner_item_findings,
              (SELECT count(*) FILTER (WHERE severity = 'blocking') FROM studio_findings f WHERE f.run_id = r.id)::int AS blocking,
              (SELECT count(*) FILTER (WHERE severity = 'advisory') FROM studio_findings f WHERE f.run_id = r.id)::int AS advisory,
              (SELECT count(*) FILTER (WHERE owner_item) FROM studio_findings f WHERE f.run_id = r.id)::int AS owner_items,
              (SELECT bool_and(owner_item = (owner = 'human_review' OR category = 'human_decision'))
                 FROM studio_findings f WHERE f.run_id = r.id) AS rule
         FROM studio_runs r WHERE r.id = $1`, [job.runId])).rows[0];
    check("findings", "SWP15. a fake run through the worker ends with studio_findings rebuilt from its own stored "
      + "06-final-critic.json — one row per panel finding, its fields exactly — and the run's blocking, advisory and "
      + "owner-item counts equal to its rows",
      row.state === "succeeded" && rows.length === panel.length && rows.length === 3
        && rows.every((r, i) => r.idx === i && r.lens === panel[i]!.lens && r.severity === panel[i]!.severity
          && r.category === panel[i]!.category && r.owner === panel[i]!.owner && r.issue === panel[i]!.issue)
        && counts.blocking_findings === counts.blocking && counts.advisory_findings === counts.advisory
        && counts.owner_item_findings === counts.owner_items && counts.blocking === 1 && counts.advisory === 2
        && counts.owner_items === 1 && logs.some((l) => l.startsWith("findings.derived ") && l.includes(job.runId)),
      JSON.stringify({ row, counts, rows: rows.length }));

    // owner_item is the schema CHECK's rule on every row, and a row that breaks it cannot be written.
    let refusedCode: unknown = null;
    try {
      await st.pool.query(
        `INSERT INTO studio_findings (run_id, idx, lens, severity, category, owner, issue, owner_item)
         VALUES ($1, 99, 'voice-and-craft', 'blocking', 'human_decision', 'packaging-adaptation', 'x', false)`, [job.runId]);
    } catch (error) {
      refusedCode = (error as { code?: unknown }).code;
    }
    check("findings", "SWP16. every derived row's owner_item agrees with the schema's CHECK (a human_review owner or a "
      + "human_decision category), and a row that disagrees is refused by it (23514) — the web reads owner_item, never "
      + "re-derives it",
      counts.rule === true && refusedCode === "23514", `${counts.rule} ${String(refusedCode)}`);

    // A malformed critic artifact, through closeRun in one real transaction.
    const malformedRun = (await st.pool.query(
      `INSERT INTO studio_runs (kind, requested_by, runner, goal) VALUES ('full', $1, 'fake', 'malformed critic') RETURNING id`,
      [st.owner])).rows[0].id as string;
    await st.pool.query("UPDATE studio_runs SET state = 'running', started_at = now() WHERE id = $1", [malformedRun]);
    const edited = JSON.parse((stored.content as Buffer).toString("utf8"));
    edited.output.provisional.lenses[0].findingCount = 3;
    const bad = Buffer.from(JSON.stringify(edited, null, 2));
    await st.pool.query(
      "INSERT INTO studio_run_artifacts (run_id, name, content, sha256, byte_length) VALUES ($1, $2, $3, $4, $5)",
      [malformedRun, CRITIC_ARTIFACT, bad, createHash("sha256").update(bad).digest("hex"), bad.length]);
    const logged: string[] = [];
    const client = await st.pool.connect();
    let ended: { runState: string } | undefined;
    try {
      await client.query("BEGIN");
      ended = await closeRun(client, {
        sink: { flush: async () => {} }, runId: malformedRun, jobId: null, timedOut: false, rt: lib.loadRuntime(),
        end: { runState: "succeeded", jobState: "finished", verdict: "needs_revision" },
        log: (event, fields) => logged.push(`${event} ${JSON.stringify(fields ?? {})}`),
      });
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const after = (await st.pool.query(
      `SELECT state, verdict, blocking_findings, advisory_findings, owner_item_findings,
              (SELECT count(*)::int FROM studio_findings WHERE run_id = $1) AS rows FROM studio_runs WHERE id = $1`,
      [malformedRun])).rows[0];
    check("findings", "SWP17. over PostgreSQL, a malformed critic artifact writes no finding row and no count, and the "
      + "run still ends exactly as it would have (succeeded, its verdict kept); the worker logs the failure class only",
      ended?.runState === "succeeded" && after.state === "succeeded" && after.verdict === "needs_revision" && after.rows === 0
        && after.blocking_findings === null && after.advisory_findings === null && after.owner_item_findings === null
        && logged.length === 1 && logged[0] === `findings.not_derived ${JSON.stringify({ run: malformedRun, failure_class: "critic_artifact_malformed" })}`,
      `${JSON.stringify(after)} ${logged.join(" | ")}`);
  } finally {
    await worker.stop().catch(() => undefined);
    await st.close();
  }
}

async function main(): Promise<void> {
  const admin = adminUrl();
  const adminPool = openPool("admin", { connectionString: admin, max: 3, connectionTimeoutMillis: 10_000 });
  const dbs = new Databases(adminPool, admin);
  const started = performance.now();
  try {
    console.log(`[studio-worker-postgres] server version ${(await adminPool.query("SHOW server_version")).rows[0]?.server_version}`);
    if ((await adminPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [STUDIO_DATABASE_NAME])).rows.length) {
      throw new Error(`a database named ${STUDIO_DATABASE_NAME} already exists on this server; this suite never touches it`);
    }
    const rt = lib.loadRuntime();
    const lines = lib.computeCostCeiling(rt, lib.allStagePolicies(rt)).lines;
    fullCeiling = {
      micros: lines.reduce((total, l) => total + ceilingMicros(l.costUsd!), 0),
      breakdown: JSON.stringify(lines.map((l) => ({ label: l.label, model: l.model, maxTokens: l.maxTokens, usd: l.costUsd }))),
    };
    approvedSha = createHash("sha256").update(readFileSync(resolve(REPO_ROOT, "config/approved-facts.json"))).digest("hex");
    await startupGroup(dbs);
    await queueGroup(dbs);
    await paidGroup(dbs);
    await identicalGroup(dbs);
    await findingsGroup(dbs);
  } finally {
    for (const name of [...dbs.created]) await dbs.drop(name).catch((e) => console.error(`[studio-worker-postgres] drop ${name}: ${(e as Error).message}`));
    await closePool(adminPool);
  }
  if (unexpectedPoolErrors.length) {
    console.log(`FAIL  pool errors — ${unexpectedPoolErrors.length} unexpected: ${unexpectedPoolErrors.join(" | ")}`);
    failures += 1;
  }
  const total = GROUPS.reduce((sum, g) => sum + counts[g], 0);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(failures === 0
    ? `\n[studio-worker-postgres] PASS ${total} checks (${GROUPS.map((g) => `${g}=${counts[g]}`).join(", ")}) in ${seconds}s`
    : `\n[studio-worker-postgres] ${failures} FAILURE(S) of ${total} checks`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`[studio-worker-postgres] FAIL: ${(error as Error).stack ?? String(error)}`);
  process.exitCode = 1;
});
