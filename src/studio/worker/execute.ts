/**
 * One Studio job, run through the content-run library exactly as the CLI runs
 * it (docs/CONTENT_STUDIO_DESIGN.md §5.1–§5.3, §6.2).
 *
 * The worker supplies the library's collaborators: a database `RunSink`, its
 * `RunOutputs` and `RunSource`, the always-refusing `UNPROVEN` confirmation, a
 * reporter that logs nothing (design §9.2), its `PaidActionConsent`, and its
 * review-only execution context. Every free check is the library's own and
 * runs first; the worker adds checks and never removes one.
 *
 * Before every paid request or lens unit the worker re-checks, in one
 * transaction holding the run's row lock: the job is running and not
 * cancelled, the wall clock, a live reservation, the quote and its requester,
 * that every request is priced, the run's charged cost against its
 * reservation, the ceiling still to come against what remains of it, the
 * overrun lock, and the effective daily, monthly and per-user caps re-summed
 * from the ledger. Only then are the unit's `started` request rows, each with
 * its own ceiling, committed — before the request is sent.
 *
 * **Fake runner only in S3.** A job whose run names the `live` runner is
 * refused before any work unless the worker was given a paid stage runner,
 * and `start:studio-worker` gives none (`main.ts`): live runs are enabled in
 * S6. The runtime the library receives replaces `createAnthropicStageRunner`,
 * so no worker path can build the provider runner either. The disposable
 * PostgreSQL suite gives a counting fake runner in its place, which is how the
 * paid path's checks are proven with no provider.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import * as lib from "../../harness/contentRun/index.js";
import type {
  ContentRunRuntime, CostCeilingLine, FactFile, PaidActionRequest, RunFailureContext, RunIo, RunOptions,
} from "../../harness/contentRun/index.js";
import { ceilingMicros, microsToNumeric } from "./money.js";
import { audit, terminalize, type ClaimedJob, type Terminal } from "./jobs.js";
import { DbRunSink, dbRunOutputs, dbRunSource } from "./runSink.js";
import type { WorkerSession } from "./session.js";
import { decidePaidUnit, readPaidUnitSnapshot, type PaidRefusal } from "./spend.js";
import type { WorkerCaps } from "./startup.js";

/** The stage runner a paid path uses: in S3, only ever a fake supplied by the PostgreSQL suite. */
export type PaidStageRunner = ReturnType<ContentRunRuntime["stageExecution"]["createAnthropicStageRunner"]>;

export type WorkerLog = (event: string, fields?: Record<string, unknown>) => void;

export interface WorkerJobContext {
  session: WorkerSession;
  commit: string;
  caps: WorkerCaps;
  /** The library's runtime as loaded; the worker never passes it on unaltered (see `workerRuntime`). */
  runtime: ContentRunRuntime;
  repoRoot: string;
  approvedFacts: { bytes: Buffer; sha256: string };
  priceTableSha256: string;
  /** S3: never set by `start:studio-worker`. */
  paidStageRunner?: PaidStageRunner;
  /** Overrides the computed wall-clock limit (tests). */
  jobTimeoutMs?: number;
  log: WorkerLog;
}

/** A stop the worker itself decided; its refusal is the run's `failure_class`. */
export class WorkerStop extends Error {
  constructor(readonly refusal: PaidRefusal | "live_runs_not_enabled" | "version_skew", message: string) {
    super(message);
    this.name = "WorkerStop";
  }
}

/** The run kinds the library runs, and the paid-action kind each is. */
const ACTIONS = {
  full: "full-run", replay_critic: "critic-replay", resume_packaging: "resume", revise: "revision",
} as const;
type RunKind = keyof typeof ACTIONS;

/** The automotive facts as the CLI's default path records them, so a run's metadata is the CLI's byte for byte. */
export const AUTOMOTIVE_FACTS_DISPLAY_PATH = "config/automotive-facts.local.json";
export const APPROVED_FACTS_PATH = "config/approved-facts.json";

/** What a job's run and quote say, as the checks before any work read them. */
export interface BeforeWork {
  jobKind: "paid" | "fake";
  run: { kind: string; runner: string; factVersionId: string | null } | undefined;
  quote: { workerCommit: string; approvedFactsSha256: string; factVersionId: string; priceTableSha256: string } | undefined;
  worker: { paidRunner: boolean; commit: string; approvedFactsSha256: string; priceTableSha256: string };
}

/**
 * The refusals made before any work — before facts are read, before the
 * library is called, before any runner exists: a run kind the worker does not
 * run, a job whose kind does not match its run's runner, a live run on a worker
 * with no paid runner (every live run in S3), and a paid job whose quote names
 * another worker commit, approved-facts sha256, fact version or price table
 * (design §5.3, version skew). Null when the job may proceed.
 */
export function decideBeforeWork(b: BeforeWork): { failureClass: string; message: string } | null {
  if (!b.run || !(b.run.kind in ACTIONS)) return { failureClass: "not_executable", message: "this run's kind is not one the worker runs" };
  if ((b.jobKind === "paid") !== (b.run.runner === "live")) {
    return { failureClass: "job_kind_mismatch", message: "the job's kind does not match its run's runner" };
  }
  if (b.run.runner !== "live") return null;
  if (!b.worker.paidRunner) {
    return { failureClass: "live_runs_not_enabled", message: "live runs are not enabled in this worker (Content Studio S6); nothing was run" };
  }
  const q = b.quote;
  if (!q || q.workerCommit !== b.worker.commit || q.approvedFactsSha256 !== b.worker.approvedFactsSha256
    || q.factVersionId !== b.run.factVersionId || q.priceTableSha256 !== b.worker.priceTableSha256) {
    return { failureClass: "version_skew", message: "the run's quote names another worker commit, approved-facts sha256, fact version or price table" };
  }
  return null;
}

/** A bounded, schema-valid failure class from an error name: `StageExecutionError` → `stage_execution_error`. */
export function failureClassOf(error: unknown): string {
  const name = String((error as { name?: unknown })?.name ?? "Error");
  const snake = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^[^a-z]+/, "");
  return (snake || "error").slice(0, 64);
}

/** The library's runtime with the provider runner factory replaced: it yields only the paid runner the worker was given. */
export function workerRuntime(base: ContentRunRuntime, paid: PaidStageRunner | undefined): ContentRunRuntime {
  return {
    ...base,
    stageExecution: {
      ...base.stageExecution,
      createAnthropicStageRunner: () => {
        if (!paid) throw new WorkerStop("live_runs_not_enabled", "live runs are not enabled in this worker (Content Studio S6)");
        return paid;
      },
    } as ContentRunRuntime["stageExecution"],
  };
}

/** The request each policy line names: a stage, and a lens for the critic panel. */
const stageOf = (line: CostCeilingLine) => {
  const [stage, lens] = line.label.split(":");
  return { stage: stage!, lens: lens ?? null };
};

/** Every request a kind of run can make, in order: a revision's start stage is unknown until verified, so all of them. */
function actionPolicies(rt: ContentRunRuntime, kind: RunKind): Array<[string, string]> {
  if (kind === "replay_critic") return lib.criticLensPolicies(rt);
  if (kind === "resume_packaging") return lib.resumePolicies(rt, "packaging-adaptation");
  return lib.allStagePolicies(rt);
}

/** The job's wall-clock limit: every request's own stream deadline and set-up timeout, plus five minutes. */
export function jobWallClockMs(rt: ContentRunRuntime, lines: readonly CostCeilingLine[]): number {
  const { stageStreamDeadlineMs, STAGE_REQUEST_SETUP_TIMEOUT_MS } = rt.payloadContract;
  return lines.reduce((total, line) => total + stageStreamDeadlineMs(line.maxTokens) + STAGE_REQUEST_SETUP_TIMEOUT_MS, 0)
    + 5 * 60_000;
}

const HEX64 = /^[0-9a-f]{64}$/;
function fingerprintsFrom(written: ReadonlyMap<string, Buffer>): { approved: string | null; pack: string | null } {
  for (const name of ["run-meta.json", "resume-meta.json", "replay-meta.json", "revision-meta.json"].reverse()) {
    const bytes = written.get(name);
    if (!bytes) continue;
    try {
      const meta = JSON.parse(bytes.toString("utf8"));
      const approved = meta.approvedFactsSha256 ?? meta.approvedFacts?.sha256;
      const pack = meta.evidencePackSha256;
      return { approved: HEX64.test(approved) ? approved : null, pack: HEX64.test(pack) ? pack : null };
    } catch {
      return { approved: null, pack: null };
    }
  }
  return { approved: null, pack: null };
}

/** Run one claimed job to a terminal state. Never throws for a run's own failure; only for a lost session. */
export async function executeJob(ctx: WorkerJobContext, job: ClaimedJob): Promise<Terminal["runState"] | "preflight"> {
  const { session } = ctx;
  if (job.kind === "preflight") {
    // The free preflight and its quote are S6's (design §6.1). It is claimed
    // first and closed at once, so nothing waits behind it.
    await session.tx(async (client) => {
      if (job.runId !== null) {
        await terminalize(client, job.runId, job.jobId, {
          runState: "refused", jobState: "finished", failureClass: "preflight_not_built",
          failureMessage: "the free preflight and its quote are built in Content Studio S6",
        });
      } else {
        await client.query("UPDATE studio_jobs SET state = 'finished' WHERE id = $1", [job.jobId]);
      }
      await audit(client, "job.preflight_refused", "studio_jobs", job.jobId, { reason: "preflight_not_built" });
    });
    ctx.log("job.finished", { job: job.jobId, kind: job.kind, outcome: "preflight_not_built" });
    return "preflight";
  }
  const runId = job.runId!;
  const run = (await session.query(
    `SELECT kind, runner, goal, platforms, scope_tags, fact_version_id, source_run_id, quote_id
       FROM studio_runs WHERE id = $1`, [runId])).rows[0];
  const refuseNow = async (failureClass: string, failureMessage: string): Promise<Terminal["runState"]> => {
    const ended = await session.tx((client) => terminalize(client, runId, job.jobId, {
      runState: "refused", jobState: "finished", failureClass, failureMessage,
    }));
    ctx.log("job.finished", { job: job.jobId, run: runId, state: ended.runState, failure_class: failureClass });
    return ended.runState;
  };
  // --- before any work: live runs are S6's; and a paid job's quote must name this worker exactly -------
  const quote = run?.quote_id ? (await session.query(
    "SELECT worker_commit, approved_facts_sha256, fact_version_id, price_table_sha256 FROM studio_quotes WHERE id = $1",
    [run.quote_id])).rows[0] : undefined;
  const refusal = decideBeforeWork({
    jobKind: job.kind,
    run: run ? { kind: run.kind, runner: run.runner, factVersionId: run.fact_version_id } : undefined,
    quote: quote ? { workerCommit: quote.worker_commit, approvedFactsSha256: quote.approved_facts_sha256,
      factVersionId: quote.fact_version_id, priceTableSha256: quote.price_table_sha256 } : undefined,
    worker: { paidRunner: ctx.paidStageRunner !== undefined, commit: ctx.commit, approvedFactsSha256: ctx.approvedFacts.sha256,
      priceTableSha256: ctx.priceTableSha256 },
  });
  if (refusal) return refuseNow(refusal.failureClass, refusal.message);
  const kind = run.kind as RunKind;

  // --- the inputs, exactly as the CLI's flags would give them -------------------------------------------------
  const version = run.fact_version_id === null ? undefined : (await session.query(
    "SELECT content, sha256 FROM studio_fact_versions WHERE id = $1", [run.fact_version_id])).rows[0];
  const automotiveFacts: FactFile = version
    ? { path: `studio fact version ${version.sha256}`, displayPath: AUTOMOTIVE_FACTS_DISPLAY_PATH,
      exists: () => true, read: async () => new Uint8Array(version.content as Buffer) }
    : { path: "(no fact version pinned)", displayPath: AUTOMOTIVE_FACTS_DISPLAY_PATH, exists: () => false,
      read: async () => { throw new Error("no automotive facts file: the run pins no fact version"); } };
  const approvedFacts: FactFile = {
    path: resolve(ctx.repoRoot, APPROVED_FACTS_PATH), displayPath: APPROVED_FACTS_PATH,
    exists: () => true, read: async () => new Uint8Array(ctx.approvedFacts.bytes),
  };
  const rt = workerRuntime(ctx.runtime, run.runner === "live" ? ctx.paidStageRunner : undefined);
  // A stored scope the CLI would refuse at its flag (an empty tag list) refuses the run, before any work.
  let scopeTags: string[] | undefined;
  try {
    scopeTags = run.scope_tags ? lib.normalizeScopeTags(run.scope_tags.join(",")) : undefined;
  } catch (error) {
    return refuseNow("invalid_scope_tags", String((error as Error)?.message ?? error).slice(0, 4000));
  }
  const options: RunOptions = {
    runner: run.runner,
    facts: { approvedFacts, automotiveFacts },
    goal: run.goal ?? undefined,
    platforms: run.platforms ?? undefined,
    scopeTags,
    reviewedAt: new Date().toISOString(),
    reviewedAtExplicit: false,
  };

  // --- the checks before every unit ---------------------------------------------------------------------------
  const startedAt = Date.now();
  const limitMs = ctx.jobTimeoutMs ?? jobWallClockMs(rt, lib.computeCostCeiling(rt, actionPolicies(rt, kind)).lines);
  let stopped: WorkerStop | undefined;
  let aborted = false;
  const stop = (refusal: WorkerStop["refusal"], message: string): never => {
    stopped ??= new WorkerStop(refusal, message);
    throw stopped;
  };
  const priced = (lines: readonly CostCeilingLine[]) =>
    lines.map((line) => (typeof line.costUsd === "number" && line.costUsd > 0 ? ceilingMicros(line.costUsd) : undefined));

  /** One transaction: re-check everything, then commit the unit's started rows (none for consent). */
  const paidCheck = async (requests: readonly CostCeilingLine[], remaining: readonly CostCeilingLine[], insert: boolean) => {
    if (aborted) stop("job_timeout", "the job passed its wall-clock limit");
    await session.tx(async (client) => {
      const snapshot = await readPaidUnitSnapshot(client, runId, job.jobId);
      if (!snapshot) stop("not_running", "the run no longer exists");
      const decision = decidePaidUnit(snapshot!, { requestCeilings: priced(requests), remainingCeilings: priced(remaining) },
        ctx.caps, { elapsedMs: Date.now() - startedAt, limitMs });
      if (!decision.ok) stop(decision.refusal, decision.message);
      if (!insert) return;
      let seq = Number((await client.query(
        "SELECT COALESCE(MAX(seq), 0)::int AS seq FROM studio_run_requests WHERE run_id = $1", [runId])).rows[0]!.seq);
      for (const line of requests) {
        const { stage, lens } = stageOf(line);
        seq += 1;
        await client.query(
          `INSERT INTO studio_run_requests (run_id, seq, stage, lens, model, ceiling_usd) VALUES ($1, $2, $3, $4, $5, $6)`,
          [runId, seq, stage, lens, line.model, microsToNumeric(ceilingMicros(line.costUsd!))]);
      }
    });
  };
  /** A fake run's check: the job is still running and not cancelled, and the wall clock. */
  const fakeCheck = async () => {
    if (aborted) stop("job_timeout", "the job passed its wall-clock limit");
    const state = (await session.query(
      "SELECT state, cancel_requested_at IS NOT NULL AS cancel FROM studio_jobs WHERE id = $1", [job.jobId])).rows[0];
    if (!state || state.cancel || state.state !== "running") stop("job_cancelled", "the job was cancelled; no further request is sent");
    if (!(Date.now() - startedAt <= limitMs)) stop("job_timeout", `the job passed its wall-clock limit of ${limitMs} ms`);
  };

  const consent = async (request: PaidActionRequest) => {
    if (request.kind !== ACTIONS[kind]) stop("quote_mismatch", "the library priced another action than the run's");
    await paidCheck(request.ceiling.lines, request.ceiling.lines, false);
  };
  const execution = lib.createReviewOnlyExecutionContext({
    caller: "studio-worker",
    checkRequests: async (unit) => {
      if (run.runner === "live") await paidCheck(unit.requests, unit.remaining, true);
      else await fakeCheck();
    },
  });

  const sink = new DbRunSink(session, runId, run.runner === "live");
  const outputs = dbRunOutputs(sink);
  let failureContext: RunFailureContext | null = null;
  const io: RunIo = {
    reporter: { log: () => {}, warn: () => {} },
    consent,
    confirmUnproven: lib.refuseUnprovenAutomotiveFacts,
    outputs,
    execution,
    onFailureContext: (context) => { failureContext = context; },
  };
  const source = () => dbRunSource(session, run.source_run_id);

  // --- run, against the wall clock -----------------------------------------------------------------------------
  const work = (async () => {
    switch (kind) {
      case "full": return (await lib.runFullPipeline(rt, options, io)).verdict;
      case "replay_critic": return (await lib.replayCritic(rt, options, source(), io)).verdict;
      case "resume_packaging": return (await lib.resumeFromPackaging(rt, options, source(), "packaging-adaptation", io)).verdict;
      case "revise": {
        const revised = await lib.reviseRun(rt, options, source(), "revise-from", io);
        return revised.revised ? (await readVerdict(sink)) : NO_REVISION;
      }
    }
  })();
  work.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const clock = new Promise<"timeout">((settle) => { timer = setTimeout(() => settle("timeout"), limitMs); });
  let verdict: unknown;
  let failure: unknown;
  let timedOut = false;
  try {
    const first = await Promise.race([work, clock]);
    if (first === "timeout") timedOut = true; else verdict = first;
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(timer);
  }

  let end: Terminal;
  if (timedOut) {
    aborted = true;
    stopped ??= new WorkerStop("job_timeout", `the job passed its wall-clock limit of ${limitMs} ms`);
    end = { runState: "failed", jobState: "finished", failureClass: "job_timeout", failureMessage: stopped.message };
  } else if (failure === undefined && verdict === NO_REVISION) {
    end = { runState: "refused", jobState: "finished", failureClass: "no_revision",
      failureMessage: "no blocking finding has a revisable owner; no request was made and nothing was written" };
  } else if (failure === undefined) {
    const fp = fingerprintsFrom(sink.written);
    const cancel = (await session.query(
      "SELECT cancel_requested_at IS NOT NULL AS cancel FROM studio_jobs WHERE id = $1", [job.jobId])).rows[0]?.cancel === true;
    const known = typeof verdict === "string" ? verdict : null;
    end = cancel
      ? { runState: "cancelled", jobState: "cancelled", failureClass: "job_cancelled",
        failureMessage: "cancelled while running; every request it made is kept", verdict: known,
        approvedFactsSha256: fp.approved, evidencePackSha256: fp.pack }
      : { runState: "succeeded", jobState: "finished", verdict: known,
        approvedFactsSha256: fp.approved, evidencePackSha256: fp.pack };
  } else {
    // What the CLI saves on a failure, through the sink: the revision's final
    // metadata, the field measurements, and every raw response already received.
    if (outputs.opened && failureContext) await saveFailureRecords(failureContext, failure);
    const cause = stopped;
    const failureClass = cause ? cause.refusal : failureClassOf(failure);
    const cancelled = cause?.refusal === "job_cancelled";
    end = {
      runState: cancelled ? "cancelled" : outputs.opened || cause?.refusal === "job_timeout" ? "failed" : "refused",
      jobState: cancelled ? "cancelled" : "finished",
      failureClass,
      failureMessage: String((cause ?? (failure as Error))?.message ?? failure).slice(0, 4000),
    };
  }
  const ended = await session.tx(async (client) => {
    if (!timedOut) await sink.flush(client);
    return terminalize(client, runId, job.jobId, end);
  });
  ctx.log("job.finished", {
    job: job.jobId, run: runId, kind, runner: run.runner, state: ended.runState,
    failure_class: ended.runState === end.runState ? end.failureClass ?? null : "cost_ceiling_exceeded",
    charged_usd: run.runner === "live" ? microsToNumeric(ended.chargedMicros) : null,
  });
  return ended.runState;
}

/** A revision that found no revisable blocking finding: it made no request and wrote nothing. */
const NO_REVISION = Symbol("no revision");

/** A revision's round-2 verdict, from the critic artifact it wrote. */
async function readVerdict(sink: DbRunSink): Promise<string | null> {
  const bytes = sink.written.get("06-final-critic.json");
  try {
    return bytes ? JSON.parse(bytes.toString("utf8"))?.output?.provisional?.verdict ?? null : null;
  } catch {
    return null;
  }
}

/** The CLI's `saveFailureRecords`, through the run's sink. Each step is best effort, as the CLI's is. */
async function saveFailureRecords(context: RunFailureContext, error: unknown): Promise<void> {
  try { await context.finalize?.(error); } catch { /* recorded by the run's failure state */ }
  if (!context.transcript.length) return;
  try { await context.writeMeasurements().written; } catch { /* as above */ }
  try {
    await context.sink.writeArtifact("rejected-responses.json", JSON.stringify(context.transcript, null, 2));
  } catch { /* as above */ }
}

/** The approved-facts file at the worker's commit, read once at start-up. */
export async function loadApprovedFacts(repoRoot: string): Promise<{ bytes: Buffer; sha256: string }> {
  const bytes = await readFile(resolve(repoRoot, APPROVED_FACTS_PATH));
  return { bytes, sha256: lib.sha256OfBytes(bytes) };
}
