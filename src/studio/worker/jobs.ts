/**
 * The Studio job queue (docs/CONTENT_STUDIO_DESIGN.md §5.3): claiming, expiry,
 * cancellation of queued jobs, terminalizing a run with its reconciliation,
 * and restart recovery. Every statement runs on the ownership session.
 *
 * - **Claim.** `FOR UPDATE SKIP LOCKED`, inside a transaction that first
 *   proves this backend holds the ownership lock. Free `preflight` jobs are
 *   taken before `paid` and `fake` ones; within a kind, oldest first.
 * - **No retries.** A job is claimed only from `queued`, and nothing ever
 *   returns one to `queued` (the schema refuses it too).
 * - **Expiry and queued cancellation.** A queued job past `expires_at` is never
 *   started: it becomes `expired`, its run `cancelled` and its whole
 *   reservation is released. A queued job whose cancellation was requested
 *   becomes `cancelled`, likewise.
 * - **Recovery: refuse, don't resume.** At start-up, after ownership, every
 *   `running` run becomes `interrupted`. Its reservation is reconciled from the
 *   durable request rows: a request with a `started` row and no completed one
 *   is charged its full ceiling. Nothing is resumed.
 */

import { microsToNumeric, numericToMicros } from "./money.js";
import { holdsOwnership } from "./session.js";
import type { WorkerSession } from "./session.js";
import { planSettlement, type Settlement, type SqlClient } from "./spend.js";

export interface ClaimedJob {
  jobId: string;
  kind: "preflight" | "paid" | "fake";
  runId: string | null;
}

/** A claim, or nothing queued. Refuses (throws) if this backend does not hold ownership. */
export async function claimNextJob(session: WorkerSession, commit: string): Promise<ClaimedJob | null> {
  return session.tx(async (client) => {
    if (!(await holdsOwnership(client))) throw new Error("ownership_lost: this session no longer holds the Studio worker lock");
    const job = (await client.query(
      `SELECT id, kind, run_id FROM studio_jobs
        WHERE state = 'queued' AND expires_at > now() AND cancel_requested_at IS NULL
        ORDER BY (kind = 'preflight') DESC, created_at, id
        LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
    if (!job) return null;
    if (job.run_id !== null) {
      const run = (await client.query("SELECT state FROM studio_runs WHERE id = $1 FOR UPDATE", [job.run_id])).rows[0];
      if (run?.state !== "queued") {
        // A job whose run is not queued is closed, never started and never
        // retried, rather than stopping the worker on every restart.
        await client.query("UPDATE studio_jobs SET state = 'cancelled' WHERE id = $1", [job.id]);
        await audit(client, "job.refused", "studio_jobs", job.id, { reason: "run_not_queued" });
        return null;
      }
    }
    await client.query(
      "UPDATE studio_jobs SET state = 'running', worker_commit = $2, heartbeat_at = now() WHERE id = $1", [job.id, commit]);
    if (job.run_id !== null) {
      await client.query(
        `UPDATE studio_runs SET state = 'running', started_at = now(), code_commit = $2
          WHERE id = $1 AND state = 'queued'`, [job.run_id, commit]);
    }
    await audit(client, "job.claim", "studio_jobs", job.id, { kind: job.kind });
    return { jobId: job.id, kind: job.kind, runId: job.run_id };
  });
}

export async function audit(
  client: SqlClient, action: string, targetType: string, targetId: string, detail: Record<string, unknown>,
): Promise<void> {
  await client.query(
    "INSERT INTO studio_audit_log (actor_user_id, action, target_type, target_id, detail) VALUES (NULL, $1, $2, $3, $4)",
    [action, targetType, targetId, JSON.stringify(detail)]);
}

export interface Terminal {
  runState: "succeeded" | "failed" | "refused" | "cancelled" | "interrupted";
  jobState: "finished" | "cancelled" | "expired";
  failureClass?: string | null;
  failureMessage?: string | null;
  verdict?: string | null;
  approvedFactsSha256?: string | null;
  evidencePackSha256?: string | null;
}

export interface Terminalized {
  runState: Terminal["runState"];
  chargedMicros: number;
  settlement: Settlement;
}

/**
 * Ends a run and its job in the caller's transaction: every request row still
 * `started` is completed as `failed` (so it stays charged its full ceiling),
 * the run is charged the sum, a live run's reservation is settled — the unused
 * part released, or the overrun booked, which also fails a run that otherwise
 * succeeded (`cost_ceiling_exceeded`) — and the job is closed.
 */
export async function terminalize(client: SqlClient, runId: string, jobId: string | null, end: Terminal): Promise<Terminalized> {
  const run = (await client.query(
    "SELECT runner, kind, state, reserved_usd::text AS reserved FROM studio_runs WHERE id = $1 FOR UPDATE", [runId])).rows[0];
  if (!run) throw new Error("terminalize: no such run");
  await client.query(
    "UPDATE studio_run_requests SET outcome = 'failed', finished_at = now() WHERE run_id = $1 AND outcome = 'started'", [runId]);
  const chargedMicros = numericToMicros((await client.query(
    "SELECT COALESCE(SUM(charged_usd), 0)::text AS charged FROM studio_run_requests WHERE run_id = $1", [runId])).rows[0]!.charged) ?? 0;
  let runState = end.runState;
  let failureClass = end.failureClass ?? null;
  let failureMessage = end.failureMessage ?? null;
  let settlement: Settlement = null;
  const live = run.runner === "live" && run.kind !== "imported";
  if (live) {
    const ledger = (await client.query("SELECT entry FROM studio_spend_ledger WHERE run_id = $1", [runId])).rows;
    const reserved = numericToMicros(run.reserved);
    if (reserved !== null && ledger.some((row) => row.entry === "reserve")
      && !ledger.some((row) => row.entry === "release" || row.entry === "overrun")) {
      settlement = planSettlement(reserved, chargedMicros);
      if (settlement) {
        await client.query("INSERT INTO studio_spend_ledger (entry, run_id, amount_usd) VALUES ($1, $2, $3)",
          [settlement.entry, runId, microsToNumeric(settlement.micros)]);
      }
      if (settlement?.entry === "overrun" && runState === "succeeded") {
        runState = "failed";
        failureClass = "cost_ceiling_exceeded";
        failureMessage = "the run's charged cost exceeded its reservation; new confirmations are locked until the owner acknowledges it";
      }
    }
  }
  await client.query(
    `UPDATE studio_runs SET state = $2, failure_class = $3, failure_message = $4, verdict = $5,
            actual_usd = $6, finished_at = now(),
            approved_facts_sha256 = COALESCE($7, approved_facts_sha256),
            evidence_pack_sha256 = COALESCE($8, evidence_pack_sha256)
      WHERE id = $1`,
    [runId, runState, failureClass, failureMessage, end.verdict ?? null, live ? microsToNumeric(chargedMicros) : null,
      end.approvedFactsSha256 ?? null, end.evidencePackSha256 ?? null]);
  if (jobId !== null) await client.query("UPDATE studio_jobs SET state = $2 WHERE id = $1", [jobId, end.jobState]);
  await audit(client, "run.finish", "studio_runs", runId, {
    state: runState, failure_class: failureClass, runner: run.runner, kind: run.kind,
    ...(settlement ? { settlement: settlement.entry } : {}),
  });
  return { runState, chargedMicros, settlement };
}

/**
 * Queued jobs that must never start: expired ones, and those whose
 * cancellation was requested. Returns how many of each were closed.
 */
export async function sweepQueuedJobs(session: WorkerSession): Promise<{ expired: number; cancelled: number }> {
  return session.tx(async (client) => {
    if (!(await holdsOwnership(client))) throw new Error("ownership_lost: this session no longer holds the Studio worker lock");
    const jobs = (await client.query(
      `SELECT id, run_id, expires_at <= now() AS expired FROM studio_jobs
        WHERE state = 'queued' AND (expires_at <= now() OR cancel_requested_at IS NOT NULL)
        ORDER BY created_at, id FOR UPDATE SKIP LOCKED`)).rows;
    let expired = 0;
    let cancelled = 0;
    for (const job of jobs) {
      if (job.expired) expired += 1; else cancelled += 1;
      const end: Terminal = job.expired
        ? { runState: "cancelled", jobState: "expired", failureClass: "job_expired", failureMessage: "the job expired before it was claimed" }
        : { runState: "cancelled", jobState: "cancelled", failureClass: "job_cancelled", failureMessage: "the job was cancelled before it was claimed" };
      if (job.run_id === null) await client.query("UPDATE studio_jobs SET state = $2 WHERE id = $1", [job.id, end.jobState]);
      else await terminalize(client, job.run_id, job.id, end);
    }
    return { expired, cancelled };
  });
}

/**
 * Restart recovery, after ownership and before readiness: every running run
 * becomes `interrupted`, reconciled from its durable request rows, and every
 * running job is closed. Nothing is resumed. Returns the interrupted run ids.
 */
export async function recoverInterruptedRuns(session: WorkerSession): Promise<string[]> {
  return session.tx(async (client) => {
    if (!(await holdsOwnership(client))) throw new Error("ownership_lost: this session no longer holds the Studio worker lock");
    const runs = (await client.query(
      `SELECT r.id, j.id AS job_id FROM studio_runs r LEFT JOIN studio_jobs j ON j.run_id = r.id AND j.state = 'running'
        WHERE r.state = 'running' ORDER BY r.id FOR UPDATE OF r`)).rows;
    for (const run of runs) {
      await terminalize(client, run.id, run.job_id ?? null, {
        runState: "interrupted", jobState: "finished", failureClass: "worker_restart",
        failureMessage: "the worker restarted while this run was running; it is not resumed — start a resume or revise from what was saved",
      });
    }
    await client.query("UPDATE studio_jobs SET state = 'finished' WHERE state = 'running'");
    return runs.map((run) => String(run.id));
  });
}
