/**
 * Disposable-PostgreSQL suite for the Content Studio worker
 * (docs/CONTENT_STUDIO_DESIGN.md §3.2, §3.3, §5.3, §6.2):
 * `npm run test:studio-worker-postgres`, run on PostgreSQL 16 and 18 in CI's
 * existing *Content Studio* step of the `postgres-integration` job, after the
 * schema suite. **No provider, no real key, no network beyond the loopback
 * database.** Where a paid path is proven, a replaying fake stage runner — or
 * (S6b) the real provider runner over a scripted stream — stands in for the
 * provider.
 *
 * Safety contract (the schema suite's): STUDIO_DISPOSABLE_POSTGRES=1 and a
 * loopback-only STUDIO_POSTGRES_ADMIN_URL are required; DATABASE_URL and
 * STUDIO_DATABASE_URL must be unset; a pre-existing `gcd_studio` is never
 * touched; every database it creates is dropped, after every pool and worker
 * connection it opened has closed.
 *
 * Every check is `SWP…`, in groups: `startup`, `queue`, `paid`, `identical`,
 * `findings`, (Content Studio S6.2) `actions` — the free preflight answered
 * by the worker, the confirmation through the web's own store, and the paid
 * path behind it with the counting fake runner — and (S7.2) `facts` and
 * `imports`: the fact check and the import's revalidation, each staged through
 * the web's own store and answered by the worker; and (S7.3) `caps`: a runner
 * with no daily cap refused before any paid unit, and an overrun's
 * acknowledgement surviving its owner's later demotion; and (S6b) `live`: the
 * real provider runner — the library's factory over sdk.ts's own stream
 * handling, with only the stream scripted (`providerShapedRunner`) — through
 * every gate, its charge (usage × the price table) and its failures reconciled,
 * and the production entry point holding a stand-in key: ready and
 * heartbeat lines `live_runner: "enabled"`, the value never printed, and a
 * preloaded fetch trap proving no request leaves the process. No key is ever
 * read from this suite's own environment: one set there fails the group.
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import pg from "pg";

import * as lib from "../../harness/contentRun/index.js";
import type { ContentRunRuntime } from "../../harness/contentRun/index.js";
import { runStudioMigrations, STUDIO_DATABASE_NAME, STUDIO_EXPECTED_MIGRATIONS, STUDIO_SCHEMA_VERSION } from "../db/runner.js";
import { closeRun, workerRuntime, type PaidStageRunner } from "./execute.js";
import { UPLOAD_LABEL } from "./factCheck.js";
import { CRITIC_ARTIFACT } from "./findings.js";
import { ceilingMicros, microsToNumeric, numericToMicros } from "./money.js";
import { studioOwnershipKey } from "./session.js";
import { confirmationsLocked, OVERRUN_ACKNOWLEDGED } from "./spend.js";
import {
  fakeTranscript, memoryIo, memorySink, providerShapedRunner, replayRunner, repoFacts, syntheticFactsBytes, usageMicros,
  type ProviderOutcome, type ReplayCall,
} from "./testSupport.js";
import { startWorker, type WorkerHandle, type WorkerOptions } from "./worker.js";
import { localDay, preflightRequest } from "../web/actions.js";
import { PgWebStore } from "../web/store.js";
import { importRunner, lineageKey } from "../web/bundle.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const GROUPS = ["startup", "queue", "paid", "identical", "findings", "actions", "facts", "imports", "caps", "live"] as const;
type Group = typeof GROUPS[number];
const counts: Record<Group, number> = { startup: 0, queue: 0, paid: 0, identical: 0, findings: 0, actions: 0, facts: 0, imports: 0, caps: 0, live: 0 };
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

async function migrate(url: string, directory = resolve(REPO_ROOT, "studio/migrations")): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await runStudioMigrations(client, { directory });
  } finally {
    await client.end();
  }
}

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
    // Content Studio S7.3, by fact: a runner with no daily cap is refused before any paid unit (cap_missing), so this
    // runner has one at the daily ceiling, which never binds first. (Until S7.3 it had none, then no per-user cap.)
    runner = (await pool.query("INSERT INTO studio_users (email, role, created_by, daily_cap_usd) VALUES ($1, 'runner', $2, 75) RETURNING id",
      [`runner.${randomBytes(3).toString("hex")}@germancardepot.com`, owner])).rows[0].id;
    await pool.query("INSERT INTO studio_fact_uploads (content, sha256, byte_length, uploaded_by) VALUES ($1, $2, $3, $4)",
      [facts, factSha, facts.length, owner]);
    // Since Studio migration 0004 a version is created only by the running fact check of its staged bytes.
    const check = (await pool.query("INSERT INTO studio_jobs (kind) VALUES ('fact_check') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO studio_fact_checks (job_id, requested_by, sha256, byte_length) VALUES ($1, $2, $3, $4)",
      [check, owner, factSha, facts.length]);
    await pool.query("UPDATE studio_jobs SET state = 'running' WHERE id = $1", [check]);
    factVersion = (await pool.query(
      `INSERT INTO studio_fact_versions (sha256, content, byte_length, record_count, tag_counts, uploaded_by)
       VALUES ($1, $2, $3, 4, '{}', $4) RETURNING id`, [factSha, facts, facts.length, owner])).rows[0].id;
    await pool.query("UPDATE studio_fact_checks SET outcome = 'accepted' WHERE job_id = $1", [check]);
    await pool.query("UPDATE studio_jobs SET state = 'finished' WHERE id = $1", [check]);
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
  /** S6b: the quote's price-table sha256 (default: this commit's), the run's kind and its source run. */
  quotePriceTableSha256?: string;
  kind?: "full" | "replay_critic";
  sourceRunId?: string;
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
       VALUES ($1, $9, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [quoteUser, hex(randomBytes(8).toString("hex")), spec.workerCommit ?? COMMIT, approvedSha, st.factVersion,
        spec.quotePriceTableSha256 ?? lib.priceTableSha256(), microsToNumeric(reserved), fullCeiling.breakdown, spec.kind ?? "full"])).rows[0].id;
    const runId = (await client.query(
      `INSERT INTO studio_runs (kind, requested_by, runner, goal, fact_version_id, automotive_facts_sha256, quote_id, reserved_usd,
                                source_run_id)
       VALUES ($7, $1, 'live', $2, $3, $4, $5, $6, $8) RETURNING id`,
      [requester, spec.kind && spec.kind !== "full" ? null : GOAL, st.factVersion, st.factSha, quoteId, microsToNumeric(reserved),
        spec.kind ?? "full", spec.sourceRunId ?? null])).rows[0].id;
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
function childWorker(url: string, extraArgs: string[] = [], extraEnv: Record<string, string> = {}): Child {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "", STUDIO_DATABASE_URL: url, STUDIO_MAX_DAILY_USD: "75", STUDIO_MAX_MONTHLY_USD: "300",
    RENDER_GIT_COMMIT: COMMIT, ...extraEnv,
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
    writeFileSync(join(root, "studio/migrations/0004_later.sql"), "SELECT 1;\n");
    const extraFile = await refusalOf(inProcess(st, { repoRoot: root }));
    rmSync(join(root, "studio/migrations/0004_later.sql"));
    writeFileSync(join(root, "studio/migrations/0002_studio_schema.sql"),
      `${readFileSync(join(root, "studio/migrations/0002_studio_schema.sql"), "utf8")}\n-- edited\n`);
    const changed = await refusalOf(inProcess(st, { repoRoot: root }));
    await st.pool.query("INSERT INTO studio_schema_migrations (name, sha256) VALUES ('0004_later.sql', $1)", [hex("later")]);
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

  // Content Studio S6.1: a database migrated to 0002 alone, then (S7.1) to 0003 alone, then to 0004.
  const older = await studio(dbs, "schema-0002", { migrated: false });
  const only0002 = mkdtempSync(join(tmpdir(), "gcd-studio-0002-"));
  try {
    for (const name of STUDIO_EXPECTED_MIGRATIONS.slice(0, 2)) {
      cpSync(resolve(REPO_ROOT, "studio/migrations", name), join(only0002, name));
    }
    await migrate(older.url, only0002);
    const ledgerBefore = (await older.pool.query("SELECT name FROM studio_schema_migrations ORDER BY name")).rows.map((r) => r.name);
    const refused = await refusalOf(inProcess(older));
    cpSync(resolve(REPO_ROOT, "studio/migrations", STUDIO_EXPECTED_MIGRATIONS[2]), join(only0002, STUDIO_EXPECTED_MIGRATIONS[2]));
    await migrate(older.url, only0002);
    const ledgerAt0003 = (await older.pool.query("SELECT name FROM studio_schema_migrations ORDER BY name")).rows.map((r) => r.name);
    const refused0003 = await refusalOf(inProcess(older));
    const beatsBefore = (await older.pool.query("SELECT count(*)::int AS n FROM studio_worker_heartbeat")).rows[0].n;
    const heldBefore = await holders(older.pool);
    await migrate(older.url);
    const worker = inProcess(older);
    const accepted = await worker.ready.then(() => true, () => false);
    const beat = (await older.pool.query("SELECT schema_version FROM studio_worker_heartbeat")).rows[0];
    await worker.stop();
    check("startup", "SWP18. a database migrated to 0002 alone is refused at start-up (schema-version), and so is the "
      + "same database at 0003 alone — before ownership, writing no heartbeat — and once 0004 is applied on top it is "
      + `accepted: the worker becomes ready and its heartbeat names ${STUDIO_SCHEMA_VERSION}`,
      JSON.stringify(ledgerBefore) === JSON.stringify(STUDIO_EXPECTED_MIGRATIONS.slice(0, 2)) && refused === "schema-version"
        && JSON.stringify(ledgerAt0003) === JSON.stringify(STUDIO_EXPECTED_MIGRATIONS.slice(0, 3)) && refused0003 === "schema-version"
        && beatsBefore === 0 && heldBefore === 0 && accepted && beat?.schema_version === STUDIO_SCHEMA_VERSION
        && STUDIO_SCHEMA_VERSION === "0004_studio_fact_checks_and_imports.sql",
      `${JSON.stringify(ledgerBefore)} ${refused} ${JSON.stringify(ledgerAt0003)} ${refused0003} ${beatsBefore} ${heldBefore} ${accepted} ${beat?.schema_version}`);
  } finally {
    rmSync(only0002, { recursive: true, force: true });
    await older.close();
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
      + "structured ready line, which (S6b) says live_runner \"disabled\" on a worker started with no key",
      order.indexOf("ownership.held") >= 0 && order.indexOf("ownership.held") < order.indexOf("recovery.finished")
        && order.indexOf("recovery.finished") < order.indexOf("ready")
        && owner.output.includes(`[studio-worker] ready {"service":"gcd-studio-worker","commit":"${COMMIT}","state":"postgres","live_runner":"disabled"}`));

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

    // SWP27 (Content Studio S7.1; by fact since S7.2, whose worker claims every kind): migration 0004's fact_check
    // and import jobs are FREE and claimed before a fake job queued with them. All three are written in one
    // transaction, so they share a creation time: the claim's free-first order alone decides. (Until S7.2 this check
    // read: "the worker never claims migration 0004's fact_check or import jobs (S7.2's) … the sweep expires them".)
    const client = await st.pool.connect();
    let factCheckJob = "";
    let importRun = "";
    let importJob = "";
    let behind = { runId: "", jobId: "" };
    try {
      await client.query("BEGIN");
      const fakeRun = (await client.query(
        `INSERT INTO studio_runs (kind, requested_by, runner, goal, fact_version_id, automotive_facts_sha256)
         VALUES ('full', $1, 'fake', $2, $3, $4) RETURNING id`, [st.owner, GOAL, st.factVersion, st.factSha])).rows[0].id;
      behind = { runId: fakeRun, jobId: (await client.query("INSERT INTO studio_jobs (run_id, kind) VALUES ($1, 'fake') RETURNING id", [fakeRun])).rows[0].id };
      factCheckJob = (await client.query("INSERT INTO studio_jobs (kind) VALUES ('fact_check') RETURNING id")).rows[0].id;
      importRun = (await client.query(
        "INSERT INTO studio_runs (kind, requested_by, runner) VALUES ('imported', $1, 'live') RETURNING id", [st.owner])).rows[0].id;
      importJob = (await client.query("INSERT INTO studio_jobs (run_id, kind) VALUES ($1, 'import') RETURNING id", [importRun])).rows[0].id;
      const meta = Buffer.from("{}", "utf8");
      await client.query("INSERT INTO studio_run_artifacts (run_id, name, content, sha256, byte_length) VALUES ($1, 'run-meta.json', $2, $3, $4)",
        [importRun, meta, createHash("sha256").update(meta).digest("hex"), meta.length]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const behindRow = await terminal(st, behind.runId);
    const imported = await terminal(st, importRun);
    const tier = (await st.pool.query("SELECT import_tier FROM studio_runs WHERE id = $1", [importRun])).rows[0].import_tier;
    const claimOrder = (await st.pool.query(
      `SELECT target_id FROM studio_audit_log WHERE action = 'job.claim' AND target_id = ANY ($1::text[]) ORDER BY at, id`,
      [[factCheckJob, importJob, behind.jobId]])).rows.map((r) => String(r.target_id));
    const factJobState = (await st.pool.query("SELECT state FROM studio_jobs WHERE id = $1", [factCheckJob])).rows[0].state;
    check("queue", "SWP27. the worker claims migration 0004's fact_check and import jobs (S7.2), FREE kinds taken before a fake "
      + "job queued with them in one transaction: a fact check with no check row is closed (no_check), an import of an "
      + "incomplete folder ends succeeded and archived_unverified (incomplete_folder), and the fake job runs after both",
      claimOrder.length === 3 && claimOrder.at(-1) === behind.jobId && claimOrder.includes(factCheckJob) && claimOrder.includes(importJob)
        && factJobState === "finished" && behindRow.state === "succeeded"
        && imported.state === "succeeded" && imported.failure_class === "incomplete_folder" && tier === "archived_unverified",
      `${claimOrder.join()} ${factJobState} ${behindRow.state} ${JSON.stringify(imported)} ${tier}`);
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
    await asActor(st.pool, st.owner, "UPDATE studio_settings SET daily_cap_usd = 1000, monthly_cap_usd = 10000, updated_by = $1", [st.owner]);
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
        await c.query(`SET LOCAL studio.actor = '${st.owner}'`);
        await c.query("UPDATE studio_users SET role = 'viewer', updated_by = $2 WHERE id = $1", [st.runner, st.owner]);
      } }, "0:refused:requester_not_permitted:0:0"),
      await attempt("wrong user (another user's quote)", { requestedBy: "runner", quoteUser: "owner",
        disable: [["studio_runs", "studio_runs_before_insert"]] }, "0:refused:quote_mismatch:0:0"),
      await attempt("exhausted", { ceilingMicros: 1_000_000 }, "0:refused:reservation_exhausted:0:0"),
      await attempt("version skew", { workerCommit: hex("another worker").slice(0, 40) }, "0:refused:version_skew:0:0"),
    ];
    await asActor(st.pool, st.owner, "UPDATE studio_users SET role = 'runner', updated_by = $2 WHERE id = $1", [st.runner, st.owner]);
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

    // SWP36-SWP37 (Content Studio S7.3): the runner's missing cap before a paid unit, and an acknowledgement that
    // survives its owner's later demotion.
    current = replayRunner(transcript);
    const p36 = await paidJob(st, { requestedBy: "runner", after: async (c) => {
      await c.query(`SET LOCAL studio.actor = '${st.owner}'`);
      await c.query("UPDATE studio_users SET daily_cap_usd = NULL, updated_by = $2 WHERE id = $1", [st.runner, st.owner]);
    } });
    const r36 = await terminal(st, p36.runId);
    const calls36 = current.calls.length;
    const rows36 = (await requestsOf(st, p36.runId)).length;
    const ownerCap36 = (await st.pool.query("SELECT daily_cap_usd FROM studio_users WHERE id = $1", [st.owner])).rows[0].daily_cap_usd;
    current = replayRunner(transcript);
    const p36b = await paidJob(st);
    const r36b = await terminal(st, p36b.runId);
    await asActor(st.pool, st.owner, "UPDATE studio_users SET daily_cap_usd = 75, updated_by = $2 WHERE id = $1", [st.runner, st.owner]);
    check("caps", "SWP36. before every paid unit, a run whose requester is a runner with no daily cap (NULL) is refused "
      + "(cap_missing) with ZERO fake-runner calls, no request row, and its reservation released in full; the owner, whose own "
      + "cap is NULL too, runs to the end (9 calls)",
      calls36 === 0 && r36.state === "refused" && r36.failure_class === "cap_missing" && rows36 === 0
        && await ledgerOf(st, p36.runId) === `release:${microsToNumeric(p36.reserved)},reserve:${microsToNumeric(p36.reserved)}`
        && ownerCap36 === null && r36b.state === "succeeded" && current.calls.length === 9,
      `${calls36} ${JSON.stringify(r36)} ${rows36} ${ownerCap36} ${JSON.stringify(r36b)} ${current.calls.length}`);

    const owner2 = (await st.pool.query("INSERT INTO studio_users (email, role, created_by) VALUES ($1, 'owner', $2) RETURNING id",
      [`owner2.${randomBytes(3).toString("hex")}@germancardepot.com`, st.owner])).rows[0].id as string;
    let overrun37 = 0;
    current = replayRunner(transcript, { costUsd: (call) => (call.index === 0 ? (overrun37 + 250_000) / 1e6 : 0.01) });
    const p37 = await paidJob(st, { after: async () => { overrun37 = fullCeiling.micros; } });
    await terminal(st, p37.runId);
    const locked37 = await confirmationsLocked(st.pool);
    await st.pool.query(`INSERT INTO studio_audit_log (actor_user_id, action, target_type, target_id, detail)
      VALUES ($1, '${OVERRUN_ACKNOWLEDGED}', 'studio_runs', $2, '{}')`, [owner2, p37.runId]);
    await asActor(st.pool, st.owner, "UPDATE studio_users SET role = 'viewer', updated_by = $2 WHERE id = $1", [owner2, st.owner]);
    const lockedAfterDemotion = await confirmationsLocked(st.pool);
    current = replayRunner(transcript);
    const p37b = await paidJob(st);
    const r37b = await terminal(st, p37b.runId);
    check("caps", "SWP37. an overrun acknowledged by an owner who is later demoted stays acknowledged: the worker's own query "
      + "(the one it reads before every unit) no longer depends on the acknowledger's CURRENT role, so confirmations stay "
      + "unlocked and the next confirmed run is not refused as confirmations_locked",
      locked37 && !lockedAfterDemotion && r37b.state === "succeeded" && current.calls.length === 9,
      `${locked37} ${lockedAfterDemotion} ${JSON.stringify(r37b)} ${current.calls.length}`);

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
      + "when it carries no preflight request, closed at once); then the rest in creation order",
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
      beat1.commit === COMMIT && beat1.schema_version === "0004_studio_fact_checks_and_imports.sql" && beat1.approved_facts_sha256 === approvedSha
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

// ---------------------------------------------------------------------------
// actions (Content Studio S6.2): the preflight, the confirmation and the paid path end to end
// ---------------------------------------------------------------------------

async function actionsGroup(dbs: Databases): Promise<void> {
  const st = await studio(dbs, "actions");
  const web = new PgWebStore(st.pool, st.pool);
  const WIDE = { dailyMicros: 1_000_000_000, monthlyMicros: 10_000_000_000 };
  const PLATFORMS = ["instagram", "facebook", "google_business_profile"];
  const rt = lib.loadRuntime();
  let worker: WorkerHandle | undefined;
  try {
    await asActor(st.pool, st.owner,
      "UPDATE studio_settings SET active_fact_version_id = $1, daily_cap_usd = 1000, monthly_cap_usd = 10000, updated_by = $2",
      [st.factVersion, st.owner]);
    const ask = (userId: string, edit: Partial<Parameters<typeof preflightRequest>[0]> = {}) => web.createPreflightRequest(preflightRequest({
      userId, action: "full", goal: GOAL, platforms: PLATFORMS, scopeTags: null, sourceRunId: null, factVersionId: st.factVersion, ...edit,
    }));
    const answered = (requestId: string) => waitFor(`preflight ${requestId}`, async () => {
      const v = await web.findPreflightRequest(requestId);
      return v && v.outcome !== null ? v : undefined;
    });
    const confirm = async (userId: string, edit: Partial<Parameters<typeof preflightRequest>[0]> = {}) => {
      const view = await answered((await ask(userId, edit)).requestId);
      if (view.outcome !== "quoted") throw new Error(`not quoted: ${view.refusalClass}`);
      return { view, result: await web.confirmQuote({ quoteId: view.quote!.id, userId, ceilings: WIDE }) };
    };
    const factoryBefore = realFactoryCalls;

    // SWP19: the free preflight, answered by the worker, quoted.
    worker = inProcess(st);
    await worker.ready;
    const asked = await ask(st.runner);
    const view = await answered(asked.requestId);
    const quote = (await st.pool.query(
      `SELECT q.*, q.ceiling_usd::text AS ceiling, q.fact_version_id::text AS fv, q.user_id::text AS uid,
              extract(epoch FROM q.expires_at - q.created_at)::int AS ttl, r.params_sha256 AS request_sha, j.state AS job
         FROM studio_quotes q JOIN studio_preflight_requests r ON r.quote_id = q.id JOIN studio_jobs j ON j.id = r.job_id
        WHERE r.id = $1`, [asked.requestId])).rows[0];
    const expectedLines = lib.computeCostCeiling(rt, lib.allStagePolicies(rt)).lines;
    const items = (quote?.breakdown ?? []) as Array<{ unit: string; lines: unknown[] }>;
    check("actions", "SWP19. the worker answers a price request written by the web's store with its free preflight: one quote "
      + "bound to the requester, the action, the request's params_sha256, the worker's commit, the approved-facts sha256, the "
      + "fact version and the price table, expiring 10 minutes after it was made, its breakdown computeCostCeiling's lines "
      + "with the critic panel one item; the request names it, the job is finished, no request row exists and the provider "
      + "factory was never called",
      view.outcome === "quoted" && quote?.uid === st.runner && quote.action === "full" && quote.params_sha256 === quote.request_sha
        && quote.worker_commit === COMMIT && quote.approved_facts_sha256 === approvedSha && quote.fv === st.factVersion
        && quote.price_table_sha256 === lib.priceTableSha256() && quote.ttl === 600 && quote.job === "finished"
        && numericToMicros(quote.ceiling) === fullCeiling.micros
        && isDeepStrictEqual(items.flatMap((i) => i.lines), JSON.parse(JSON.stringify(expectedLines)))
        && items.filter((i) => i.unit === "critic-panel").length === 1 && items.length === 6
        && (await st.pool.query("SELECT count(*)::int AS n FROM studio_run_requests")).rows[0].n === 0 && realFactoryCalls === factoryBefore,
      `${view.outcome} uid=${quote?.uid === st.runner} sha=${quote?.params_sha256 === quote?.request_sha} commit=${quote?.worker_commit} `
        + `facts=${quote?.approved_facts_sha256 === approvedSha} fv=${quote?.fv === st.factVersion} prices=${quote?.price_table_sha256 === lib.priceTableSha256()} `
        + `ttl=${quote?.ttl} job=${quote?.job} ceiling=${quote?.ceiling}/${microsToNumeric(fullCeiling.micros)} items=${items.length} `
        + `lines=${isDeepStrictEqual(items.flatMap((i) => i.lines), JSON.parse(JSON.stringify(expectedLines)))}`);

    // SWP19a: refusals stored with their class and message; a params mismatch; no quote.
    const mismatch = (await st.pool.query(
      `WITH j AS (INSERT INTO studio_jobs (kind) VALUES ('preflight') RETURNING id)
       INSERT INTO studio_preflight_requests (job_id, user_id, action, goal, platforms, fact_version_id, params_sha256)
       SELECT j.id, $1, 'full', $2, $3, $4, $5 FROM j RETURNING id::text AS id`,
      [st.runner, GOAL, PLATFORMS, st.factVersion, "0".repeat(64)])).rows[0].id as string;
    const scoped = await ask(st.runner, { scopeTags: ["no-record-carries-this-tag"] });
    const [m, sc] = [await answered(mismatch), await answered(scoped.requestId)];
    const quotesAfter = (await st.pool.query("SELECT count(*)::int AS n FROM studio_quotes")).rows[0].n;
    check("actions", "SWP19a. a request whose params_sha256 does not match its parameters is refused (params_mismatch), and one "
      + "the library's free checks refuse (an evidence class no record in its scope supplies) is refused with the library's "
      + "own message — each stored with its class and message, with no quote and no request",
      m.outcome === "refused" && m.refusalClass === "params_mismatch" && (m.refusalMessage ?? "").length > 0
        && sc.outcome === "refused" && /evidence pack cannot satisfy/.test(sc.refusalMessage ?? "") && quotesAfter === 1
        && (await st.pool.query("SELECT count(*)::int AS n FROM studio_run_requests")).rows[0].n === 0,
      `${m.refusalClass} ${sc.refusalClass}`);
    await worker.stop();

    // SWP19b: an unknown model price, on a worker whose runtime resolves the critic to a model with no price row.
    const base = countedRuntime();
    const resolve0 = base.modelPolicy.resolveModelPolicy;
    worker = inProcess(st, { runtime: { ...base, modelPolicy: { ...base.modelPolicy,
      resolveModelPolicy: ((policy: Parameters<typeof resolve0>[0]) => (policy === "critic"
        ? { ...resolve0(policy), model: "claude-unpriced-test-model" } : resolve0(policy))) as typeof resolve0 } } as ContentRunRuntime });
    await worker.ready;
    const unpriced = await answered((await ask(st.runner)).requestId);
    check("actions", "SWP19b. a model with no price row makes no quote: the worker refuses the request as unpriced_request, "
      + "naming the model, and writes no quote",
      unpriced.outcome === "refused" && unpriced.refusalClass === "unpriced_request" && /claude-unpriced-test-model/.test(unpriced.refusalMessage ?? "")
        && unpriced.quote === null && (await st.pool.query("SELECT count(*)::int AS n FROM studio_quotes")).rows[0].n === 1,
      `${unpriced.refusalClass}`);
    await worker.stop();

    // SWP20: a fake run (owner only, through the web's store), then a revise of it. (By fact since Content Studio S7.2,
    // owner decision of 2026-10-06: a fake run is never a paid action's source, so the revise is refused by name before
    // any quote. Until S7.2 this check read: "a revise of it is quoted with planRevision's plan, stored with the outcome";
    // that property is now proven on a verified live import's revise, SWP34.)
    worker = inProcess(st);
    await worker.ready;
    const fake = await web.createFakeRun({ ownerId: st.owner, goal: GOAL, platforms: PLATFORMS, scopeTags: null, factVersionId: st.factVersion });
    const fakeEnd = await terminal(st, fake.runId);
    const revise = await answered((await ask(st.runner, { action: "revise", goal: null, sourceRunId: fake.runId })).requestId);
    check("actions", "SWP20. the owner's fake run (no quote, no reservation) succeeds on the worker; a revise of it is REFUSED by "
      + "name (fake_source) before any quote — no quote, no plan — and the fake run has no ledger entry",
      fakeEnd.state === "succeeded" && revise.outcome === "refused" && revise.refusalClass === "fake_source" && revise.quote === null
        && revise.revisePlan === null && (await ledgerOf(st, fake.runId)) === "",
      `${fakeEnd.state} ${revise.outcome} ${revise.refusalClass} ledger=${await ledgerOf(st, fake.runId)}`);
    await worker.stop();

    // SWP21: confirmed, then run on the injected counting fake paid runner: requests charged, reconciled, released.
    const transcript = await fakeTranscript(REPO_ROOT, GOAL);
    const counting = replayRunner(transcript);
    worker = inProcess(st, { paidStageRunner: counting });
    await worker.ready;
    const paid = await confirm(st.runner);
    const runId = paid.result.ok ? paid.result.runId : "";
    const ended = await terminal(st, runId);
    const rows = await requestsOf(st, runId);
    const charged = rows.reduce((t, r) => t + numericToMicros(r.charged)!, 0);
    check("actions", "SWP21. a quote confirmed through the web's store runs on the injected counting fake paid runner: every "
      + "request is charged (nine rows, nine runner calls), the run is reconciled to its charged cost and the unused "
      + "reservation released; the real provider factory is never called",
      paid.result.ok && ended.state === "succeeded" && rows.length === 9 && counting.calls.length === 9
        && rows.every((r) => r.outcome === "succeeded") && ended.actual === microsToNumeric(charged)
        && (await ledgerOf(st, runId)) === `release:${microsToNumeric(fullCeiling.micros - charged)},reserve:${microsToNumeric(fullCeiling.micros)}`
        && realFactoryCalls === factoryBefore,
      `${JSON.stringify(ended)} ${rows.length} ${counting.calls.length} ${await ledgerOf(st, runId)}`);
    await worker.stop();

    // SWP22: cancelling a running run: no request after the cancel, completed costs kept, the rest released.
    let cancelResult = "";
    const cancelling = replayRunner(transcript, { during: async (call) => {
      if (call.index !== 1) return;
      const run = (await st.pool.query("SELECT id::text AS id FROM studio_runs WHERE state = 'running' AND runner = 'live'")).rows[0];
      const r = await web.cancelRun({ runId: run.id, user: { id: st.owner, role: "owner", status: "active" } });
      cancelResult = r.ok ? r.kind : r.refusal;
    } });
    worker = inProcess(st, { paidStageRunner: cancelling });
    await worker.ready;
    const toCancel = await confirm(st.runner);
    const cancelledId = toCancel.result.ok ? toCancel.result.runId : "";
    const cancelEnd = await terminal(st, cancelledId);
    const cancelRows = await requestsOf(st, cancelledId);
    const kept = cancelRows.reduce((t, r) => t + numericToMicros(r.charged)!, 0);
    check("actions", "SWP22. the owner cancels a running run through the web's store during its second request: no further "
      + "request is sent, both completed requests stay charged, the run is cancelled and the rest of its reservation released",
      cancelResult === "running" && cancelEnd.state === "cancelled" && cancelling.calls.length === 2 && cancelRows.length === 2
        && (await ledgerOf(st, cancelledId)) === `release:${microsToNumeric(fullCeiling.micros - kept)},reserve:${microsToNumeric(fullCeiling.micros)}`,
      `${cancelResult} ${JSON.stringify(cancelEnd)} ${cancelling.calls.length} ${cancelRows.length}`);
    await worker.stop();

    // SWP23: a queued run cancelled before any claim; a runner cannot cancel another's.
    const queued = await (async () => {
      worker = inProcess(st);
      await worker.ready;
      const view = await answered((await ask(st.runner)).requestId);
      await worker.stop();
      const result = await web.confirmQuote({ quoteId: view.quote!.id, userId: st.runner, ceilings: WIDE });
      return result.ok ? result.runId : "";
    })();
    const otherRunner = (await st.pool.query("INSERT INTO studio_users (email, role, created_by) VALUES ($1, 'runner', $2) RETURNING id::text AS id",
      [`runner2.${randomBytes(3).toString("hex")}@germancardepot.com`, st.owner])).rows[0].id as string;
    const refusedCancel = await web.cancelRun({ runId: queued, user: { id: otherRunner, role: "runner", status: "active" } });
    const ownCancel = await web.cancelRun({ runId: queued, user: { id: st.runner, role: "runner", status: "active" } });
    worker = inProcess(st, { paidStageRunner: replayRunner(transcript) });
    await worker.ready;
    await sleep(500);
    const claims = (await st.pool.query(
      "SELECT count(*)::int AS n FROM studio_audit_log a JOIN studio_jobs j ON j.id::text = a.target_id WHERE a.action = 'job.claim' AND j.run_id = $1",
      [queued])).rows[0].n;
    check("actions", "SWP23. a runner cannot cancel another user's run (not_your_run); the requester's own cancellation of a "
      + "queued run cancels it before any claim — the worker, started afterwards, never claims it — and releases its whole "
      + "reservation",
      !refusedCancel.ok && refusedCancel.refusal === "not_your_run" && ownCancel.ok && ownCancel.kind === "queued" && claims === 0
        && (await runRow(st, queued)).state === "cancelled"
        && (await ledgerOf(st, queued)) === `release:${microsToNumeric(fullCeiling.micros)},reserve:${microsToNumeric(fullCeiling.micros)}`,
      `${JSON.stringify(refusedCancel)} ${JSON.stringify(ownCancel)} ${claims}`);
    await worker.stop();

    // SWP24: an overrun fails the run and locks confirmations until the owner acknowledges it.
    const overrunning = replayRunner(transcript, { costUsd: (call) => (call.index === 0 ? 50 : 0.01) });
    worker = inProcess(st, { paidStageRunner: overrunning });
    await worker.ready;
    const over = await confirm(st.runner);
    const overId = over.result.ok ? over.result.runId : "";
    const overEnd = await terminal(st, overId);
    const overCalls = overrunning.calls.length;
    const lockedView = await answered((await ask(st.runner)).requestId);
    const locked = await web.confirmQuote({ quoteId: lockedView.quote!.id, userId: st.runner, ceilings: WIDE });
    const ack = await web.acknowledgeOverrun({ runId: overId, ownerId: st.owner });
    await worker.stop();
    worker = inProcess(st, { paidStageRunner: replayRunner(transcript) });
    await worker.ready;
    const unlocked = await web.confirmQuote({ quoteId: lockedView.quote!.id, userId: st.runner, ceilings: WIDE });
    const unlockedEnd = unlocked.ok ? await terminal(st, unlocked.runId) : undefined;
    check("actions", "SWP24. a run whose charged cost passes its reservation stops (one request, then no more), fails as "
      + "cost_ceiling_exceeded with an overrun entry; every confirmation is then refused (confirmations_locked) until the "
      + "owner acknowledges it through the web's store, after which the next confirmation runs",
      overEnd.state === "failed" && overEnd.failure_class === "cost_ceiling_exceeded" && overCalls === 1
        && (await ledgerOf(st, overId)).startsWith("overrun:") && !locked.ok && locked.refusal === "confirmations_locked"
        && ack && unlocked.ok && unlockedEnd?.state === "succeeded",
      `${JSON.stringify(overEnd)} ${overCalls} ${JSON.stringify(locked)} ${ack} ${JSON.stringify(unlocked)} ${unlockedEnd?.state}`);
    await worker.stop();

    // SWP25: the day and month a run's entries are booked to: its reserve's, in America/New_York.
    const planted = async (day: string) => paidJob(st, {
      reserve: false, disable: [["studio_spend_ledger", "studio_spend_ledger_before_insert"]],
      after: async (c, ids) => {
        await c.query(
          `INSERT INTO studio_spend_ledger (entry, run_id, amount_usd, day_local, month_local, created_at)
           SELECT 'reserve', $1, $2, $3::date, studio_month_of($3::date),
                  (($3::date + 1)::timestamp - interval '1 minute') AT TIME ZONE 'America/New_York'`,
          [ids.runId, microsToNumeric(fullCeiling.micros), day]);
      },
    });
    const today = String((await st.pool.query("SELECT studio_local_day(now())::text AS d")).rows[0].d);
    const yesterday = String((await st.pool.query("SELECT (studio_local_day(now()) - 1)::text AS d")).rows[0].d);
    const lastOfPreviousMonth = String((await st.pool.query("SELECT (studio_month_of(studio_local_day(now())) - 1)::text AS d")).rows[0].d);
    const late = await planted(yesterday);
    const monthEnd = await planted(lastOfPreviousMonth);
    worker = inProcess(st, { paidStageRunner: replayRunner(transcript) });
    await worker.ready;
    await terminal(st, late.runId);
    await terminal(st, monthEnd.runId);
    const booked = async (runId: string) => (await st.pool.query(
      `SELECT entry, day_local::text AS day, month_local::text AS month, studio_local_day(created_at)::text AS written
         FROM studio_spend_ledger WHERE run_id = $1 ORDER BY entry`, [runId])).rows;
    const lateRows = await booked(late.runId);
    const monthRows = await booked(monthEnd.runId);
    const todaySpend = await web.spendView(today);
    const lateNet = numericToMicros((await st.pool.query(
      "SELECT sum(CASE entry WHEN 'release' THEN -amount_usd ELSE amount_usd END)::text AS s FROM studio_spend_ledger WHERE run_id = $1",
      [late.runId])).rows[0].s)!;
    const yesterdaySpend = await web.spendView(yesterday);
    const yesterdayBefore = numericToMicros((await st.pool.query(
      `SELECT COALESCE(sum(CASE entry WHEN 'release' THEN -amount_usd ELSE amount_usd END), 0)::text AS s FROM studio_spend_ledger
        WHERE day_local = $1::date AND run_id NOT IN ($2::uuid, $3::uuid)`, [yesterday, late.runId, monthEnd.runId])).rows[0].s)!;
    check("actions", "SWP25. a run reserved at 23:59 America/New_York and finished after midnight books every entry to its "
      + "reserve's day — its release is written today and booked to yesterday — and one reserved on the last day of the "
      + "previous month books its release to that month; the web's spend for today leaves both out, and its spend for yesterday "
      + "counts the late run's net",
      lateRows.map((r) => `${r.entry}:${r.day}`).join() === `release:${yesterday},reserve:${yesterday}`
        && lateRows.find((r) => r.entry === "release")?.written === today
        && monthRows.map((r) => `${r.entry}:${r.month}`).join()
          === `release:${lastOfPreviousMonth.slice(0, 8)}01,reserve:${lastOfPreviousMonth.slice(0, 8)}01`
        && todaySpend.day === today && localDay(Date.now()) === today
        && (yesterday === lastOfPreviousMonth ? true : yesterdaySpend.dayMicros === yesterdayBefore + lateNet),
      `${JSON.stringify(lateRows)} ${JSON.stringify(monthRows)} ${yesterdaySpend.dayMicros} ${yesterdayBefore} ${lateNet}`);
    await worker.stop();
    worker = undefined;

    // SWP26: the production entry point: no paid runner; a confirmed live run refused, its reservation released.
    const child = childWorker(st.url);
    await waitFor("the child worker to be ready", async () => has(child, "[studio-worker] ready"), 60_000);
    const childAnswer = await answered((await ask(st.runner)).requestId);
    const childRun = await web.confirmQuote({ quoteId: childAnswer.quote!.id, userId: st.runner, ceilings: WIDE });
    const childId = childRun.ok ? childRun.runId : "";
    const childEnd = childRun.ok ? await terminal(st, childId) : { state: `not confirmed: ${childRun.refusal}`, failure_class: null };
    child.process.kill("SIGTERM");
    await child.exited;
    // Since S6b an EMPTY key (as Render may hold before O4) refuses nothing and enables nothing: the worker starts disabled.
    const empty = childWorker(st.url, [], { ANTHROPIC_API_KEY: "" });
    await waitFor("the empty-key child to be ready", async () => has(empty, "[studio-worker] ready"), 60_000);
    const emptyAnswer = await answered((await ask(st.runner)).requestId);
    const emptyRun = await web.confirmQuote({ quoteId: emptyAnswer.quote!.id, userId: st.runner, ceilings: WIDE });
    const emptyId = emptyRun.ok ? emptyRun.runId : "";
    const emptyEnd = emptyRun.ok ? await terminal(st, emptyId) : { state: `not confirmed: ${emptyRun.refusal}`, failure_class: null };
    empty.process.kill("SIGTERM");
    const emptyCode = await empty.exited;
    check("actions", "SWP26. on the production wiring without the key — npm run start:studio-worker with no ANTHROPIC_API_KEY, "
      + "and (S6b) again with an EMPTY one, which no longer refuses the start — the worker answers a price request, and each "
      + "run confirmed from its quote is refused before any work as live_runs_not_enabled, its whole reservation released "
      + "and no request made; the empty-key worker says live_runner \"disabled\" (anthropic_key_empty) in its start-up and "
      + "ready lines",
      childAnswer.outcome === "quoted" && childRun.ok && childEnd.state === "refused" && childEnd.failure_class === "live_runs_not_enabled"
        && childRun.ok && (await requestsOf(st, childId)).length === 0
        && (await ledgerOf(st, childId)) === `release:${microsToNumeric(fullCeiling.micros)},reserve:${microsToNumeric(fullCeiling.micros)}`
        && emptyAnswer.outcome === "quoted" && emptyRun.ok && emptyEnd.state === "refused" && emptyEnd.failure_class === "live_runs_not_enabled"
        && (await requestsOf(st, emptyId)).length === 0
        && (await ledgerOf(st, emptyId)) === `release:${microsToNumeric(fullCeiling.micros)},reserve:${microsToNumeric(fullCeiling.micros)}`
        && empty.output.includes('[studio-worker] live_runner {"live_runner":"disabled","provider_key":"anthropic_key_empty"}')
        && empty.output.some((l) => l.startsWith("[studio-worker] ready ") && l.endsWith(',"live_runner":"disabled"}'))
        && !empty.output.some((l) => /refused \(/.test(l)) && emptyCode !== null,
      `${childAnswer.outcome} ${JSON.stringify(childEnd)} ${JSON.stringify(emptyEnd)} ${empty.output.join(" / ")}`);
  } finally {
    await worker?.stop();
    await st.close();
  }
}

// ---------------------------------------------------------------------------
// facts (Content Studio S7.2): the fact check, staged through the web's store and answered by the worker
// ---------------------------------------------------------------------------

/** A synthetic facts file of `n` records, plainly labelled. */
const s72Facts = (n: number, edit: (record: Record<string, unknown>, i: number) => void = () => {}) => Buffer.from(JSON.stringify({
  facts: Array.from({ length: n }, (_, i) => {
    const record: Record<string, unknown> = {
      id: `synthetic-swp-fact-${i}`, claim: `SYNTHETIC WORKER-POSTGRES FIXTURE ${i} - not a real automotive fact.`,
      subject: `synthetic-swp-subject-${i}`, attribute: `synthetic-swp-attr-${i}`, tags: ["swp-all", ...(i % 2 ? ["swp-odd"] : [])],
      sourceType: "repository_config", sourceRef: "synthetic://swp-test-fixture", provenance: "synthetic fixture; not a real source",
      reviewedAt: "2026-09-01T00:00:00.000Z",
    };
    edit(record, i);
    return record;
  }),
}, null, 2), "utf8");

async function factsGroup(dbs: Databases): Promise<void> {
  const st = await studio(dbs, "facts");
  const web = new PgWebStore(st.pool, st.pool);
  let worker: WorkerHandle | undefined;
  const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const checkOf = (checkId: string) => waitFor(`fact check ${checkId}`, async () => {
    const row = (await st.pool.query(
      `SELECT c.outcome, c.refusal_class, c.refusal_message, c.unknown_fields, c.outcome_at, j.state AS job,
              (SELECT a.at FROM studio_audit_log a WHERE a.action = 'fact_check.outcome' AND a.target_id = c.id::text) AS audit_at,
              (SELECT a.detail FROM studio_audit_log a WHERE a.action = 'fact_check.outcome' AND a.target_id = c.id::text) AS detail
         FROM studio_fact_checks c JOIN studio_jobs j ON j.id = c.job_id WHERE c.id = $1`, [checkId])).rows[0];
    return row && row.outcome !== null && row.job === "finished" ? row : undefined;
  });
  const staged = async () => Number((await st.pool.query("SELECT count(*)::int AS n FROM studio_fact_uploads")).rows[0].n);
  const stage = async (bytes: Buffer) => {
    const result = await web.stageFactUpload({ ownerId: st.owner, content: bytes, sha256: sha(bytes) });
    if (!result.ok) throw new Error(`not staged: ${result.refusal}`);
    return result.checkId;
  };
  try {
    worker = inProcess(st);
    await worker.ready;

    // SWP28: accepted, end to end.
    const accepted = s72Facts(5, (r, i) => { if (i === 0) r.vin = "SYNTHETIC-VALUE"; });
    const acceptedCheck = await checkOf(await stage(accepted));
    const version = (await st.pool.query(
      `SELECT content, record_count, tag_counts, uploaded_by::text AS by, uploaded_at, status FROM studio_fact_versions WHERE sha256 = $1`,
      [sha(accepted)])).rows[0];
    check("facts", "SWP28. an owner's upload, staged through the web's store, is checked by the worker and ACCEPTED: the version "
      + "is created from the staged bytes, byte for byte, with the uploaded records' count and tag counts; the outcome (with "
      + "the unknown field names, never their values), the staging row's deletion, the job's end and the audit row are ONE "
      + "transaction (the version, the outcome and the audit row share its instant)",
      acceptedCheck.outcome === "accepted" && version?.content.equals(accepted) && version.record_count === 5
        && JSON.stringify(version.tag_counts) === JSON.stringify({ "swp-all": 5, "swp-odd": 2 }) && version.by === st.owner
        && JSON.stringify(acceptedCheck.unknown_fields) === JSON.stringify(["facts[].vin"]) && (await staged()) === 0
        && acceptedCheck.outcome_at.getTime() === version.uploaded_at.getTime()
        && acceptedCheck.audit_at.getTime() === acceptedCheck.outcome_at.getTime()
        && !JSON.stringify(acceptedCheck).includes("SYNTHETIC-VALUE") && acceptedCheck.detail.existing === false,
      JSON.stringify({ ...acceptedCheck, detail: acceptedCheck.detail }).slice(0, 400));

    // SWP29: refused with the loader's own message.
    const missing = s72Facts(3, (r, i) => { if (i === 2) delete r.provenance; });
    const refusedCheck = await checkOf(await stage(missing));
    let expected = "";
    try { lib.parseAutomotiveFacts(missing, { label: UPLOAD_LABEL, now: Date.now() }); } catch (error) { expected = (error as Error).message; }
    const noVersion = (await st.pool.query("SELECT 1 FROM studio_fact_versions WHERE sha256 = $1", [sha(missing)])).rows.length === 0;
    check("facts", "SWP29. a file the loader refuses is REFUSED with the loader's own message (loader_refused); no version is "
      + "created, the staging row is deleted, and the outcome and the job's end are one transaction",
      refusedCheck.outcome === "refused" && refusedCheck.refusal_class === "loader_refused" && expected.length > 0
        && refusedCheck.refusal_message === expected && noVersion && (await staged()) === 0
        && refusedCheck.audit_at.getTime() === refusedCheck.outcome_at.getTime(),
      JSON.stringify(refusedCheck).slice(0, 400));

    // SWP30: bytes that are already a version.
    const versionsBefore = Number((await st.pool.query("SELECT count(*)::int AS n FROM studio_fact_versions")).rows[0].n);
    const existingCheck = await checkOf(await stage(accepted));
    const versionsAfter = Number((await st.pool.query("SELECT count(*)::int AS n FROM studio_fact_versions")).rows[0].n);
    check("facts", "SWP30. bytes that are already a fact version are ACCEPTED, naming that version, with no insert; the staging "
      + "row is deleted",
      existingCheck.outcome === "accepted" && versionsAfter === versionsBefore && (await staged()) === 0 && existingCheck.detail.existing === true,
      `${versionsBefore} → ${versionsAfter} ${JSON.stringify(existingCheck.detail)}`);

    // SWP31: the sweep deletes an expired, unclaimed check's staged bytes only while they are its bytes.
    await worker.stop();
    worker = undefined;
    const expiredCheck = async (bytes: Buffer, stagedBytes: Buffer) => {
      const c = await st.pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("DELETE FROM studio_fact_uploads");
        await c.query("INSERT INTO studio_fact_uploads (content, sha256, byte_length, uploaded_by) VALUES ($1, $2, $3, $4)",
          [bytes, sha(bytes), bytes.length, st.owner]);
        const job = (await c.query("INSERT INTO studio_jobs (kind, expires_at) VALUES ('fact_check', now() + interval '1 second') RETURNING id")).rows[0].id;
        await c.query("INSERT INTO studio_fact_checks (job_id, requested_by, sha256, byte_length) VALUES ($1, $2, $3, $4)",
          [job, st.owner, sha(bytes), bytes.length]);
        if (!stagedBytes.equals(bytes)) {
          await c.query("DELETE FROM studio_fact_uploads");
          await c.query("INSERT INTO studio_fact_uploads (content, sha256, byte_length, uploaded_by) VALUES ($1, $2, $3, $4)",
            [stagedBytes, sha(stagedBytes), stagedBytes.length, st.owner]);
        }
        await c.query("COMMIT");
        return String(job);
      } finally {
        c.release();
      }
    };
    const own = s72Facts(1);
    const ownJob = await expiredCheck(own, own);
    await sleep(1_500);
    worker = inProcess(st);
    await worker.ready;
    const ownState = await waitFor("the sweep", async () => {
      const r = (await st.pool.query("SELECT state FROM studio_jobs WHERE id = $1", [ownJob])).rows[0];
      return r.state === "expired" ? r.state : undefined;
    });
    const ownLeft = await staged();
    await worker.stop();
    worker = undefined;
    const other = s72Facts(2);
    const otherJob = await expiredCheck(s72Facts(1, (r) => { r.claim = "SYNTHETIC replaced bytes"; }), other);
    await sleep(1_500);
    worker = inProcess(st);
    await worker.ready;
    await waitFor("the sweep", async () => ((await st.pool.query("SELECT state FROM studio_jobs WHERE id = $1", [otherJob])).rows[0].state === "expired") || undefined);
    const otherLeft = (await st.pool.query("SELECT sha256 FROM studio_fact_uploads")).rows.map((r) => r.sha256);
    check("facts", "SWP31. the sweep expires a fact check that was never claimed and deletes the staging row with it only while "
      + "that row still holds the check's bytes (its sha256): another upload's staged bytes are left in place",
      ownState === "expired" && ownLeft === 0 && otherLeft.join() === sha(other),
      `${ownState} ${ownLeft} ${otherLeft.join()}`);
    await st.pool.query("DELETE FROM studio_fact_uploads");
  } finally {
    await worker?.stop();
    await st.close();
  }
}

// ---------------------------------------------------------------------------
// imports (Content Studio S7.2): an import created through the web's store and revalidated by the worker
// ---------------------------------------------------------------------------

/** A run folder, as the CLI writes it: a live run's (the provider replayed), or a fake one's. */
async function runFolder(runner: "live" | "fake"): Promise<Map<string, Buffer>> {
  const sink = memorySink("import-folder");
  const goal = "SYNTHETIC import goal";
  if (runner === "fake") {
    await lib.runFullPipeline(lib.loadRuntime(), { runner: "fake", facts: repoFacts(REPO_ROOT), goal, reviewedAt: new Date().toISOString(),
      reviewedAtExplicit: false }, memoryIo(sink));
  } else {
    const transcript = await fakeTranscript(REPO_ROOT, goal);
    await lib.runFullPipeline(workerRuntime(lib.loadRuntime(), replayRunner(transcript)), {
      runner: "live", facts: repoFacts(REPO_ROOT), goal, reviewedAt: new Date().toISOString(), reviewedAtExplicit: false,
    }, memoryIo(sink, { consent: async () => {}, execution: lib.createReviewOnlyExecutionContext({ caller: "studio-worker", checkRequests: async () => {} }) }));
  }
  return sink.files;
}

async function importsGroup(dbs: Databases): Promise<void> {
  const st = await studio(dbs, "imports");
  const web = new PgWebStore(st.pool, st.pool);
  let worker: WorkerHandle | undefined;
  const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const create = async (files: Map<string, Buffer>) => {
    const list = [...files].map(([name, content]) => ({ name, content, sha256: sha(content) }));
    return web.createImport({ ownerId: st.owner, runner: importRunner(list), files: list, lineage: lineageKey(list) });
  };
  const ended = async (runId: string) => {
    await terminal(st, runId);
    return (await st.pool.query(
      `SELECT r.state, r.import_tier, r.failure_class, r.failure_message, r.goal, r.platforms, r.scope_tags, r.runner,
              r.fact_version_id::text AS fv, r.approved_facts_sha256 AS approved, r.automotive_facts_sha256 AS automotive,
              r.evidence_pack_sha256 AS pack, r.code_commit, r.finished_at, r.source_run_id::text AS source, r.blocking_findings,
              j.state AS job, (SELECT a.at FROM studio_audit_log a WHERE a.action = 'import.outcome' AND a.target_id = r.id::text) AS audit_at
         FROM studio_runs r JOIN studio_jobs j ON j.run_id = r.id WHERE r.id = $1`, [runId])).rows[0];
  };
  const edited = (files: Map<string, Buffer>, edit: (m: Map<string, Buffer>) => void) => {
    const copy = new Map([...files].map(([k, v]) => [k, Buffer.from(v)] as [string, Buffer]));
    edit(copy);
    return copy;
  };
  const editMeta = (edit: (meta: Record<string, any>) => void) => (m: Map<string, Buffer>) => {
    const meta = JSON.parse(m.get("run-meta.json")!.toString("utf8"));
    edit(meta);
    m.set("run-meta.json", Buffer.from(JSON.stringify(meta, null, 2), "utf8"));
  };
  try {
    await asActor(st.pool, st.owner,
      "UPDATE studio_settings SET active_fact_version_id = $1, daily_cap_usd = 1000, monthly_cap_usd = 10000, updated_by = $2",
      [st.factVersion, st.owner]);
    worker = inProcess(st);
    await worker.ready;
    const live = await runFolder("live");
    const meta = JSON.parse(live.get("run-meta.json")!.toString("utf8"));

    // SWP32: verified, end to end.
    const verified = await create(live);
    const v = await ended(verified.runId);
    const stored = (await st.pool.query("SELECT name, content FROM studio_run_artifacts WHERE run_id = $1", [verified.runId])).rows;
    check("imports", "SWP32. a complete live run folder, imported through the web's store, is revalidated by the worker with "
      + "verifySourceRun in revision mode and ends succeeded and VERIFIED: every fingerprint, the fact version its folder names, "
      + "the worker's commit, the goal and platforms from that result, its findings rebuilt from its critic, its files byte for "
      + "byte — and its end, its job's end and its audit row in ONE transaction",
      v.state === "succeeded" && v.import_tier === "verified" && v.failure_class === null && v.fv === st.factVersion
        && v.approved === approvedSha && v.automotive === st.factSha && v.pack === meta.evidencePackSha256 && v.code_commit === COMMIT
        && v.goal === meta.goal && JSON.stringify(v.platforms) === JSON.stringify(meta.platforms) && v.scope_tags === null
        && v.runner === "live" && v.job === "finished" && v.blocking_findings === 1 && v.audit_at.getTime() === v.finished_at.getTime()
        && stored.length === live.size && stored.every((r) => live.get(r.name)?.equals(r.content)),
      JSON.stringify({ ...v, finished_at: undefined, audit_at: undefined }).slice(0, 400));

    // SWP33: archived, each with its class and reason, and only bounded metadata.
    const corrupt = (m: Map<string, Buffer>) => {
      const script = JSON.parse(m.get("03-hook-story-script.json")!.toString("utf8"));
      script.output.evidence = { ...(script.output.evidence ?? {}), supportingFactIds: ["synthetic-unknown-id"] };
      m.set("03-hook-story-script.json", Buffer.from(JSON.stringify(script, null, 2), "utf8"));
    };
    const archivedCases: Array<[string, Map<string, Buffer>, string]> = [
      ["an old approved-facts hash", edited(live, editMeta((m) => { m.approvedFacts.sha256 = "0".repeat(64); m.goal = "é".repeat(2_001); })), "approved_facts_changed"],
      ["a missing fact version", edited(live, editMeta((m) => { m.automotiveFacts.sha256 = "1".repeat(64); })), "fact_version_missing"],
      ["a failed saved output", edited(live, corrupt), "revalidation_failed"],
      ["an incomplete folder", edited(live, (m) => { m.delete("06-final-critic.json"); }), "incomplete_folder"],
    ];
    const archived = [];
    for (const [label, files, cls] of archivedCases) archived.push([label, await ended((await create(files)).runId), cls] as const);
    check("imports", "SWP33. an import that does not revalidate ends succeeded and ARCHIVED (archived_unverified) with its class "
      + "and reason — an old approved-facts hash, a fact version never uploaded, a failed saved output, an incomplete folder — "
      + "keeping only bounded metadata (a 2,001-character goal is null) and no verified fingerprint pair",
      archived.every(([, r, cls]) => r.state === "succeeded" && r.import_tier === "archived_unverified" && r.failure_class === cls
        && typeof r.failure_message === "string" && r.failure_message.length > 0 && r.automotive === null && r.job === "finished")
        && archived[0]![1].goal === null && archived[1]![1].goal === meta.goal
        && JSON.stringify(archived[1]![1].platforms) === JSON.stringify(meta.platforms),
      archived.map(([label, r]) => `${label}: ${r.import_tier}/${r.failure_class}/${String(r.goal).slice(0, 12)}`).join(" | "));

    // SWP34: an import as a paid source only when verified; a fake import never.
    const fakeImport = await ended((await create(await runFolder("fake"))).runId);
    const fakeImportId = (await st.pool.query("SELECT id::text AS id FROM studio_runs WHERE kind = 'imported' AND runner = 'fake'")).rows[0].id;
    const archivedId = (await st.pool.query(
      "SELECT id::text AS id FROM studio_runs WHERE kind = 'imported' AND failure_class = 'revalidation_failed'")).rows[0].id;
    const askRevise = async (sourceRunId: string, factVersionId: string | null) => {
      const asked = await web.createPreflightRequest(preflightRequest({ userId: st.runner, action: "revise", goal: null,
        platforms: meta.platforms, scopeTags: null, sourceRunId, factVersionId: factVersionId ?? st.factVersion }));
      return waitFor(`preflight ${asked.requestId}`, async () => {
        const view = await web.findPreflightRequest(asked.requestId);
        return view && view.outcome !== null ? view : undefined;
      });
    };
    const fromVerified = await askRevise(verified.runId, st.factVersion);
    const fromArchived = await askRevise(archivedId, st.factVersion);
    const fromFake = await askRevise(fakeImportId, fakeImport.fv);
    const plan = JSON.parse(JSON.stringify(lib.loadRuntime().revision.planRevision(JSON.parse(live.get("06-final-critic.json")!.toString("utf8")).output)));
    check("imports", "SWP34. a verified live import is a paid action's source: its revise is quoted with planRevision's plan, "
      + "stored with the outcome (the property S6.2's SWP20 proved on a fake run); an archived import is refused "
      + "(source_not_verified) and a verified import of a FAKE CLI run is refused by name (fake_source), each before any quote",
      fakeImport.import_tier === "verified" && fakeImport.runner === "fake"
        && fromVerified.outcome === "quoted" && isDeepStrictEqual(fromVerified.revisePlan, plan) && plan.kind === "revision"
        && fromArchived.outcome === "refused" && fromArchived.refusalClass === "source_not_verified"
        && fromFake.outcome === "refused" && fromFake.refusalClass === "fake_source" && fromFake.quote === null,
      `${fromVerified.outcome}/${fromVerified.refusalClass} ${fromArchived.refusalClass} ${fromFake.refusalClass} ${fakeImport.import_tier}`);

    // SWP35: lineage — proven, ambiguous, absent — over a fresh folder that no earlier import shares.
    const second = await runFolder("live");
    const source = await create(second);
    await ended(source.runId);
    const child = new Map<string, Buffer>([["run-meta.json", second.get("run-meta.json")!], ["round-1-06-final-critic.json", second.get("06-final-critic.json")!],
      ["revision-meta.json", Buffer.from(JSON.stringify({ runner: "live" }), "utf8")]]);
    const proven = await create(child);
    const absent = await create(edited(child, (m) => { m.set("round-1-06-final-critic.json", Buffer.from("{}", "utf8")); }));
    await ended((await create(second)).runId);
    const ambiguous = await create(child);
    const pins = async (runId: string) => (await st.pool.query(
      "SELECT source_run_id::text AS source, fact_version_id::text AS fv FROM studio_runs WHERE id = $1", [runId])).rows[0];
    const [p, a, amb] = [await pins(proven.runId), await pins(absent.runId), await pins(ambiguous.runId)];
    check("imports", "SWP35. lineage is recorded only when exactly one non-deleted import's run-meta.json and 06-final-critic.json "
      + "are this folder's run-meta.json and round-1-06-final-critic.json, byte for byte — the child then pins its source's fact "
      + "version — and not when none or two match",
      proven.sourceRunId === source.runId && p.source === source.runId && p.fv === st.factVersion
        && absent.sourceRunId === null && a.source === null && a.fv === null
        && ambiguous.sourceRunId === null && amb.source === null && amb.fv === null,
      JSON.stringify([p, a, amb]));
  } finally {
    await worker?.stop();
    await st.close();
  }
}

// ---------------------------------------------------------------------------
// live (Content Studio S6b): the real provider runner over a scripted stream, and the keyed entry point
// ---------------------------------------------------------------------------

/** A preload that makes any HTTP request from the child fail loudly, before it leaves the process. */
const FETCH_TRAP = "globalThis.fetch = async () => { process.stderr.write('S6B-NETWORK-ATTEMPT\\n'); "
  + "throw new Error('the S6b suite refuses every network request'); };\n";

async function liveGroup(dbs: Databases): Promise<void> {
  // SWP38: the test-run guard.
  const keyInEnvironment = process.env.ANTHROPIC_API_KEY !== undefined;
  check("live", "SWP38. the test-run guard: ANTHROPIC_API_KEY is NOT set in this suite's environment (every paid-path "
    + "check injects its runner; a key here fails the suite and the rest of this group does not run)", !keyInEnvironment,
    keyInEnvironment ? "ANTHROPIC_API_KEY is set: unset it before running the Studio suites" : "");
  if (keyInEnvironment) return;

  const st = await studio(dbs, "live");
  const transcript = await fakeTranscript(REPO_ROOT, GOAL);
  let outcome: (o: { index: number }) => ProviderOutcome = () => "end_turn";
  let runId = "";
  const seen: string[] = [];
  let current = providerShapedRunner(transcript);
  const fresh = () => {
    current = providerShapedRunner(transcript, {
      outcome: (o) => outcome(o),
      // Seen from the suite's own session as each request's stream opens: this request's row, committed and started.
      during: async (open) => {
        const rows = (await st.pool.query(
          "SELECT stage, lens, outcome FROM studio_run_requests WHERE run_id = $1 ORDER BY seq", [runId])).rows;
        const own = open.lens ? rows.find((r) => r.lens === open.lens) : rows[rows.length - 1];
        seen.push(`${open.index}:${own ? `${own.lens ?? own.stage}=${own.outcome}` : "none"}`);
      },
    });
  };
  fresh();
  const dispatch = (async (request: never) => current(request)) as unknown as PaidStageRunner;
  let worker = inProcess(st, { paidStageRunner: dispatch, heartbeatMs: 200 });
  const job = async (spec: PaidSpec = {}) => {
    fresh();
    seen.length = 0;
    const made = await paidJob(st, { ...spec, after: async (c, ids) => { runId = ids.runId; await spec.after?.(c, ids); } });
    runId = made.runId;
    return made;
  };
  const claimsOf = async (jobId: string) => (await st.pool.query(
    "SELECT count(*)::int AS n FROM studio_audit_log WHERE action = 'job.claim' AND target_id = $1", [jobId])).rows[0].n as number;
  const tokensOf = async (id: string) => (await st.pool.query(
    "SELECT input_tokens, output_tokens FROM studio_run_requests WHERE run_id = $1 ORDER BY seq", [id])).rows;
  try {
    await asActor(st.pool, st.owner, "UPDATE studio_settings SET daily_cap_usd = 1000, monthly_cap_usd = 10000, updated_by = $1", [st.owner]);
    await worker.ready;
    const lines = lib.computeCostCeiling(lib.loadRuntime(), lib.allStagePolicies(lib.loadRuntime())).lines;
    const ceil = lines.map((l) => ceilingMicros(l.costUsd!));

    // SWP39: a live run through the real provider runner, charged usage × the price table.
    outcome = () => "end_turn";
    const p39 = await job();
    const r39 = await terminal(st, p39.runId);
    const rows39 = await requestsOf(st, p39.runId);
    const opens39 = current.opens;
    const want39 = rows39.map((r, i) => usageMicros(lines[i]!.model, (r.lens ? opens39.find((o) => o.lens === r.lens) : opens39[i])!.usage));
    const sum39 = want39.reduce((t: number, c) => t + (c ?? Number.NaN), 0);
    check("live", "SWP39. an enabled worker runs a confirmed live run through the REAL provider runner (only the stream "
      + "scripted): each request opened once (maxRetries 0) only after its own row was committed and visible to another "
      + "session; each row's cost is its provider-reported usage × the repository's price table, to the micro-dollar; the "
      + "run is charged their sum and the unused reservation released, in PostgreSQL",
      r39.state === "succeeded" && opens39.length === 9 && opens39.every((o) => o.maxRetries === 0)
        && seen.length === 9 && seen.every((x) => /=started$/.test(x))
        && rows39.length === 9 && rows39.every((r, i) => r.outcome === "succeeded" && numericToMicros(r.cost) === want39[i]
          && numericToMicros(r.charged) === want39[i] && numericToMicros(r.ceiling) === ceil[i])
        && Number.isSafeInteger(sum39) && sum39 > 0 && numericToMicros(r39.actual) === sum39
        && await ledgerOf(st, p39.runId) === `release:${microsToNumeric(p39.reserved - sum39)},reserve:${microsToNumeric(p39.reserved)}`,
      `${JSON.stringify(r39)} ${seen.join(" ")} ${JSON.stringify(rows39)} ${want39.join(",")} ${await ledgerOf(st, p39.runId)}`);

    // SWP40: a provider error, and a refusal stop reason, each fail the run cleanly and reconcile.
    outcome = ({ index }) => (index === 1 ? "error" : "end_turn");
    const p40 = await job();
    const r40 = await terminal(st, p40.runId);
    await sleep(400);
    const rows40 = await requestsOf(st, p40.runId);
    const opens40 = current.opens;
    const c40 = usageMicros(opens40[0]!.model, opens40[0]!.usage)!;
    outcome = ({ index }) => (index === 2 ? "refusal" : "end_turn");
    const p40b = await job();
    const r40b = await terminal(st, p40b.runId);
    const rows40b = await requestsOf(st, p40b.runId);
    const tokens40b = await tokensOf(p40b.runId);
    const opens40b = current.opens;
    const c40b = usageMicros(opens40b[0]!.model, opens40b[0]!.usage)! + usageMicros(opens40b[1]!.model, opens40b[1]!.usage)!;
    check("live", "SWP40. a provider error with no response on request 2 fails the run (stage_execution_error) after exactly "
      + "2 requests, never retried and the job never claimed again, request 2 charged its full ceiling; a response refused "
      + "by the model (stop_reason \"refusal\") on request 3 fails its run likewise after 3, its usage recorded on the row and "
      + "the row charged its ceiling; each run's reservation is reconciled in the ledger (released less the charge)",
      r40.state === "failed" && r40.failure_class === "stage_execution_error" && opens40.length === 2 && await claimsOf(p40.jobId) === 1
        && rows40.length === 2 && numericToMicros(rows40[0]!.cost) === c40 && rows40[1]!.outcome === "failed" && rows40[1]!.cost === null
        && numericToMicros(rows40[1]!.charged) === ceil[1] && numericToMicros(r40.actual) === c40 + ceil[1]!
        && await ledgerOf(st, p40.runId) === `release:${microsToNumeric(p40.reserved - c40 - ceil[1]!)},reserve:${microsToNumeric(p40.reserved)}`
        && r40b.state === "failed" && r40b.failure_class === "stage_execution_error" && opens40b.length === 3 && rows40b.length === 3
        && rows40b[2]!.outcome === "failed" && rows40b[2]!.cost === null && numericToMicros(rows40b[2]!.charged) === ceil[2]
        && tokens40b[2]!.input_tokens === opens40b[2]!.usage.input_tokens && tokens40b[2]!.output_tokens === opens40b[2]!.usage.output_tokens
        && await ledgerOf(st, p40b.runId) === `release:${microsToNumeric(p40b.reserved - c40b - ceil[2]!)},reserve:${microsToNumeric(p40b.reserved)}`
        && (await artifactNames(st, p40b.runId)).includes("rejected-responses.json"),
      `${JSON.stringify(r40)} ${JSON.stringify(rows40)} ${JSON.stringify(r40b)} ${JSON.stringify(rows40b)} ${await ledgerOf(st, p40b.runId)}`);

    // SWP41: every gate, before any request, through the real provider runner: zero opens each.
    outcome = () => "end_turn";
    const zero: string[] = [];
    const attempt = async (label: string, spec: PaidSpec, want: string) => {
      const made = await job(spec);
      const row = await terminal(st, made.runId);
      const released = await ledgerOf(st, made.runId) === `release:${microsToNumeric(made.reserved)},reserve:${microsToNumeric(made.reserved)}`;
      const got = `${current.opens.length}:${row.state}:${row.failure_class}:${(await requestsOf(st, made.runId)).length}:${released}`;
      zero.push(got === want ? "" : `${label}: ${got}≠${want}`);
    };
    // A cap exceeded: the owner's daily cap set below what is already booked today.
    await asActor(st.pool, st.owner, "UPDATE studio_settings SET daily_cap_usd = 1, updated_by = $1", [st.owner]);
    await attempt("the effective daily cap exceeded", {}, "0:refused:cap_exceeded_daily:0:true");
    await asActor(st.pool, st.owner, "UPDATE studio_settings SET daily_cap_usd = 1000, updated_by = $1", [st.owner]);
    await attempt("an expired job (its quote's confirmation)", { expiresInMs: 1, after: async (c) => { await c.query("SELECT pg_sleep(0.05)"); } },
      "0:cancelled:job_expired:0:true");
    await attempt("another user's quote, written past the schema", { requestedBy: "runner", quoteUser: "owner",
      disable: [["studio_runs", "studio_runs_before_insert"]] }, "0:refused:quote_mismatch:0:true");
    await attempt("a changed price table", { quotePriceTableSha256: hex("another price table") }, "0:refused:version_skew:0:true");
    // A reused quote: a second run naming a quote another run consumed is refused by the schema, so no job exists.
    const reused = await job();
    await terminal(st, reused.runId);
    const quoteOf = (await st.pool.query("SELECT quote_id FROM studio_runs WHERE id = $1", [reused.runId])).rows[0].quote_id as string;
    const reuse = await st.pool.query(
      `INSERT INTO studio_runs (kind, requested_by, runner, goal, fact_version_id, automotive_facts_sha256, quote_id, reserved_usd)
       VALUES ('full', $1, 'live', $2, $3, $4, $5, $6) RETURNING id`,
      [st.owner, GOAL, st.factVersion, st.factSha, quoteOf, microsToNumeric(fullCeiling.micros)]).then(() => "accepted", (e: Error) => e.message);
    const opensAfterReuse = current.opens.length;
    // A fake source: refused by the schema at the run's insert; written past it, refused by the worker before any work.
    const fakeSource = await fakeJob(st);
    await terminal(st, fakeSource.runId);
    const viaSchema = await job({ kind: "replay_critic", sourceRunId: fakeSource.runId }).then(() => "accepted", (e: Error) => e.message);
    await attempt("a fake source, written past the schema", { kind: "replay_critic", sourceRunId: fakeSource.runId,
      disable: [["studio_runs", "studio_runs_before_insert"]] }, "0:refused:fake_source:0:true");
    check("live", "SWP41. through the real provider runner every gate holds with ZERO requests: an exceeded cap, an expired "
      + "job, another user's quote (written past the schema's trigger), a price table changed since the quote (version_skew) "
      + "and a fake source written past the schema (fake_source) each make 0 requests and 0 request rows and release the "
      + "reservation in full; a reused quote and a fake source through the normal path are refused by the schema before any "
      + "job exists",
      zero.every((z) => z === "") && /quote/i.test(reuse) && reuse !== "accepted" && opensAfterReuse === 9
        && /fake run can never be a paid action's source/.test(viaSchema),
      `${zero.filter(Boolean).join("; ")} | reuse: ${reuse} | schema: ${viaSchema}`);
    await worker.stop();

    // SWP42: the production entry point holding a stand-in key: enabled, the value never printed, no request made.
    const sentinel = ["s6b", "postgres", "sentinel", "not", "a", "key", randomBytes(6).toString("hex")].join("-");
    const queued = (await st.pool.query("SELECT count(*)::int AS n FROM studio_jobs WHERE state = 'queued'")).rows[0].n as number;
    const trapDir = mkdtempSync(join(tmpdir(), "gcd-s6b-trap-"));
    const trap = join(trapDir, "fetch-trap.mjs");
    writeFileSync(trap, FETCH_TRAP);
    let keyed: Child | undefined;
    let beats = 0;
    try {
      keyed = queued === 0 ? childWorker(st.url, [`--import=${trap}`], { ANTHROPIC_API_KEY: sentinel }) : undefined;
      if (keyed) {
        await waitFor("the keyed child to be ready", async () => has(keyed!, "[studio-worker] ready"), 60_000);
        await waitFor("a heartbeat line", async () => has(keyed!, "[studio-worker] heartbeat"), 60_000);
        beats = keyed.output.filter((l) => l === '[studio-worker] heartbeat {"live_runner":"enabled"}').length;
        keyed.process.kill("SIGTERM");
        await keyed.exited;
      }
    } finally {
      if (keyed && keyed.process.exitCode === null) keyed.process.kill("SIGKILL");
      rmSync(trapDir, { recursive: true, force: true });
    }
    const out = keyed?.output ?? [];
    check("live", "SWP42. npm run start:studio-worker with ANTHROPIC_API_KEY set to a stand-in value (no job queued, a "
      + "preloaded fetch trap): it constructs the provider runner and says so — the start-up line live_runner \"enabled\" "
      + "(anthropic_key_present), the ready line and every heartbeat line live_runner \"enabled\" — the value appears in no "
      + "line it prints, and no network request was attempted",
      queued === 0 && out.includes('[studio-worker] live_runner {"live_runner":"enabled","provider_key":"anthropic_key_present"}')
        && out.includes(`[studio-worker] ready {"service":"gcd-studio-worker","commit":"${COMMIT}","state":"postgres","live_runner":"enabled"}`)
        && beats >= 1 && out.filter((l) => l.startsWith("[studio-worker] heartbeat")).every((l) => l.endsWith('{"live_runner":"enabled"}'))
        && !out.some((l) => l.includes(sentinel) || l.includes(sentinel.slice(-12)))
        && !out.some((l) => l.includes("S6B-NETWORK-ATTEMPT")) && !out.some((l) => /refused \(|fatal \(/.test(l)),
      `${queued} ${out.join(" / ").replaceAll(sentinel, "<SENTINEL>")}`);
  } finally {
    await worker.stop();
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
    await actionsGroup(dbs);
    await factsGroup(dbs);
    await importsGroup(dbs);
    await liveGroup(dbs);
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
