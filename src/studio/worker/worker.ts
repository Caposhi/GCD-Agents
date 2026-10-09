/**
 * The Content Studio worker's lifecycle (docs/CONTENT_STUDIO_DESIGN.md §3.2,
 * §3.3, §5.3). `main.ts` decides the environment first, then loads this.
 *
 * 1. **Connect, then check the database before anything else:** it must be the
 *    migrated Studio database (`current_database()` is `gcd_studio`, the
 *    tripwire, the ledger and the `studio_database_identity` row — S2's
 *    runner decision, repeated) and its schema version must be exactly the
 *    one this code expects. Either refusal stops the worker before it takes
 *    ownership or writes anything.
 * 2. **Ownership:** a session-level advisory lock on the Studio-only key, on
 *    the one session every later statement uses. A worker that does not hold
 *    it consumes nothing and emits no readiness; it retries until it does.
 * 3. **Recovery: refuse, don't resume** (`jobs.ts`).
 * 4. **The heartbeat** row, at once and then every 30 seconds, each beat also
 *    logged as one `heartbeat` line naming `live_runner` (Content Studio S6b:
 *    the row's columns are migration 0002's and are not changed).
 * 5. **Readiness**, one structured line, only now; it names `live_runner`
 *    too: "enabled" when the worker holds a paid stage runner, else "disabled".
 * 6. **The queue:** sweep expired and cancelled queued jobs, claim one, run it
 *    (`execute.ts`), repeat. One job at a time. A lost session stops the
 *    worker: it can no longer prove ownership.
 */

import { resolve } from "node:path";
import pg from "pg";

import * as lib from "../../harness/contentRun/index.js";
import type { ContentRunRuntime } from "../../harness/contentRun/index.js";
import { probeStudioIdentity, readStudioMigrationFiles, STUDIO_MIGRATIONS_DIRECTORY } from "../db/runner.js";
import { executeJob, loadApprovedFacts, type PaidStageRunner, type WorkerLog } from "./execute.js";
import { claimNextJob, recoverInterruptedRuns, sweepQueuedJobs } from "./jobs.js";
import { tryAcquireOwnership, WorkerSession } from "./session.js";
import { decideSchemaVersion, decideWorkerIdentity, type WorkerCaps } from "./startup.js";

/** The heartbeat interval (design §3.3). The web shows "worker offline" past two minutes. */
export const HEARTBEAT_INTERVAL_MS: number = 30_000;

/** Content Studio S6b: whether this worker holds a paid stage runner — a class, never a key. */
export const liveRunnerOf = (paid: unknown): "enabled" | "disabled" => (paid === undefined ? "disabled" : "enabled");

/** The one readiness line: the service, its commit, the store, and (S6b) `live_runner`. */
export function readinessLine(commit: string, liveRunner: "enabled" | "disabled"): string {
  return `[studio-worker] ready ${JSON.stringify({ service: STUDIO_WORKER_SERVICE, commit, state: "postgres", live_runner: liveRunner })}`;
}

export const STUDIO_WORKER_SERVICE = "gcd-studio-worker";

export interface WorkerOptions {
  connectionString: string;
  commit: string;
  caps: WorkerCaps;
  repoRoot: string;
  log: WorkerLog;
  /** Called once, with the readiness line, after ownership and recovery. */
  ready?: (line: string) => void;
  pollMs?: number;
  heartbeatMs?: number;
  ownershipRetryMs?: number;
  /**
   * The paid stage runner. Since Content Studio S6b `start:studio-worker` sets it — the existing
   * provider runner — only when `ANTHROPIC_API_KEY` is present and not blank; the suites give fakes.
   */
  paidStageRunner?: PaidStageRunner;
  /** The library runtime to start from (tests wrap it to count calls). */
  runtime?: ContentRunRuntime;
  jobTimeoutMs?: number;
}

export interface WorkerHandle {
  /** Settles once ready; rejects if the worker stops first. */
  readonly ready: Promise<void>;
  /** Settles when the worker has stopped; rejects with the reason it stopped on its own. */
  readonly stopped: Promise<void>;
  /** The worker's backend process id, once connected. */
  readonly backendPid: () => number | undefined;
  /** Stop after the current job; closes the session. */
  stop(): Promise<void>;
}

export function startWorker(options: WorkerOptions): WorkerHandle {
  const state = { stopping: false };
  let wake: (() => void) | undefined;
  /** A pause that `stop()` ends at once. */
  const sleep = (ms: number) => new Promise<void>((settle) => {
    const timer = setTimeout(() => { wake = undefined; settle(); }, ms);
    wake = () => { clearTimeout(timer); wake = undefined; settle(); };
  });
  let pid: number | undefined;
  let session: WorkerSession | undefined;
  let markReady!: () => void;
  let failReady!: (error: unknown) => void;
  const ready = new Promise<void>((settle, fail) => { markReady = settle; failReady = fail; });
  ready.catch(() => undefined);

  const run = async () => {
    const client = new pg.Client({
      connectionString: options.connectionString, application_name: STUDIO_WORKER_SERVICE, connectionTimeoutMillis: 10_000,
    });
    session = new WorkerSession(client);
    await client.connect();
    let heartbeat: NodeJS.Timeout | undefined;
    try {
      pid = Number((await session.query("SELECT pg_backend_pid() AS pid")).rows[0]?.pid);
      // 1. the database, before anything is written or locked
      const probe = await probeStudioIdentity({ query: (text, values) => session!.query(text, values) });
      decideWorkerIdentity(probe);
      const files = await readStudioMigrationFiles(resolve(options.repoRoot, STUDIO_MIGRATIONS_DIRECTORY));
      const schemaVersion = decideSchemaVersion(probe.ledger, files);
      const approvedFacts = await loadApprovedFacts(options.repoRoot);
      const runtime = options.runtime ?? lib.loadRuntime();
      const tagCounts = await lib.countTags(runtime, {
        facts: {
          approvedFacts: { path: "approved facts", displayPath: "config/approved-facts.json", exists: () => true,
            read: async () => new Uint8Array(approvedFacts.bytes) },
          automotiveFacts: { path: "(none)", displayPath: "(none)", exists: () => false,
            read: async () => { throw new Error("no automotive facts for the heartbeat's tag counts"); } },
        },
        now: Date.now(), reviewedAt: new Date().toISOString(),
      });
      const priceTableSha256 = lib.priceTableSha256();

      // 2. ownership
      let waiting = false;
      while (!(await tryAcquireOwnership(session))) {
        if (!waiting) options.log("ownership.waiting", { service: STUDIO_WORKER_SERVICE });
        waiting = true;
        if (state.stopping) return;
        await sleep(options.ownershipRetryMs ?? 2_000);
        if (state.stopping) return;
      }
      options.log("ownership.held", { service: STUDIO_WORKER_SERVICE });

      // 3. recovery: refuse, don't resume
      const interrupted = await recoverInterruptedRuns(session);
      options.log("recovery.finished", { interrupted: interrupted.length, runs: interrupted });

      // 4. the heartbeat
      const liveRunner = liveRunnerOf(options.paidStageRunner);
      const beat = () => session!.query(
        `INSERT INTO studio_worker_heartbeat (singleton, commit, schema_version, approved_facts_sha256,
                                              approved_facts_tag_counts, price_table_sha256, beat_at)
         VALUES (true, $1, $2, $3, $4, $5, now())
         ON CONFLICT (singleton) DO UPDATE SET commit = EXCLUDED.commit, schema_version = EXCLUDED.schema_version,
           approved_facts_sha256 = EXCLUDED.approved_facts_sha256,
           approved_facts_tag_counts = EXCLUDED.approved_facts_tag_counts,
           price_table_sha256 = EXCLUDED.price_table_sha256, beat_at = now()`,
        [options.commit, schemaVersion, approvedFacts.sha256, JSON.stringify(Object.fromEntries(tagCounts.counts)),
          priceTableSha256])
        .then(() => session!.query("UPDATE studio_jobs SET heartbeat_at = now() WHERE state = 'running'"))
        .then(() => options.log("heartbeat", { live_runner: liveRunner }));
      await beat();
      heartbeat = setInterval(() => {
        beat().catch((error) => options.log("heartbeat.failed", { error_class: (error as Error)?.name ?? "Error" }));
      }, options.heartbeatMs ?? HEARTBEAT_INTERVAL_MS);

      // 5. readiness, and only now
      options.ready?.(readinessLine(options.commit, liveRunner));
      markReady();

      // 6. the queue
      const ctx = {
        session, commit: options.commit, caps: options.caps, runtime, repoRoot: options.repoRoot, approvedFacts,
        priceTableSha256, paidStageRunner: options.paidStageRunner, jobTimeoutMs: options.jobTimeoutMs, log: options.log,
      };
      while (!state.stopping) {
        if (session.lost) throw session.lost;
        const swept = await sweepQueuedJobs(session);
        if (swept.expired || swept.cancelled) options.log("queue.swept", swept);
        const job = await claimNextJob(session, options.commit);
        if (!job) { await sleep(options.pollMs ?? 1_000); continue; }
        options.log("job.claimed", { job: job.jobId, kind: job.kind, run: job.runId });
        await executeJob(ctx, job);
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await client.end().catch(() => undefined);
    }
  };

  const stopped = run().then(
    () => { failReady(new Error("the worker stopped before it was ready")); },
    (error) => { failReady(error); throw error; },
  );
  stopped.catch(() => undefined);
  return {
    ready,
    stopped,
    backendPid: () => pid,
    async stop() {
      state.stopping = true;
      wake?.();
      await stopped.catch(() => undefined);
    },
  };
}
