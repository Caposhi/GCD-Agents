/**
 * The reservation and reconciliation primitives (docs/CONTENT_STUDIO_DESIGN.md
 * §6.2), and the check the worker's `PaidActionConsent` and review-only
 * context make before every paid request or lens unit.
 *
 * The decision is a pure function over a snapshot the worker reads under the
 * run's row lock, so the offline suite proves every refusal and the mutation
 * harness proves each one load-bearing. It re-checks everything itself,
 * independently of the web: a compromised web process, or a row written
 * directly, cannot buy a request (design §9.1).
 */

import type { WorkerCaps } from "./startup.js";
import { numericToMicros } from "./money.js";

/** Every way a paid unit is refused; each is the run's `failure_class`. */
export type PaidRefusal =
  | "job_cancelled" | "job_timeout" | "not_running" | "reservation_missing" | "reservation_settled" | "quote_mismatch"
  | "requester_not_permitted" | "unpriced_request" | "requests_in_flight" | "cost_ceiling_exceeded"
  | "reservation_exhausted" | "confirmations_locked" | "cap_exceeded_daily" | "cap_exceeded_monthly"
  | "cap_exceeded_user_daily";

/** What the worker read about one paid run, under its row lock, immediately before a unit. */
export interface PaidUnitSnapshot {
  run: { state: string; runner: string; kind: string; reservedMicros: number | null; quoteId: string | null;
    requestedBy: string };
  job: { state: string; cancelRequested: boolean } | null;
  quote: { userId: string; consumed: boolean; action: string } | null;
  requester: { status: string; role: string; dailyCapMicros: number | null } | null;
  /** The run's reserve entries' amounts, and whether a release or overrun is booked. */
  reserves: number[];
  settled: boolean;
  /** Σ charged over the run's request rows: measured cost, or the full ceiling where unknown or unfinished. */
  chargedMicros: number;
  /** Request rows still `started`. */
  openRequests: number;
  /** The ledger re-summed by the worker for the run's booked day and month, and the requester's day. */
  daySpendMicros: number;
  monthSpendMicros: number;
  userDaySpendMicros: number;
  /** The owner's caps (`studio_settings`), or null when the row cannot be read. */
  settings: { dailyCapMicros: number; monthlyCapMicros: number } | null;
  /** Overrun entries the owner has not acknowledged, on any run. */
  unacknowledgedOverruns: number;
}

/** The unit about to be sent: its own ceilings, and every ceiling still to come (its own included). */
export interface PaidUnitPrice {
  /** Undefined entries are requests whose model has no price row. */
  requestCeilings: Array<number | undefined>;
  remainingCeilings: Array<number | undefined>;
}

export type PaidUnitDecision = { ok: true } | { ok: false; refusal: PaidRefusal; message: string };

const no = (refusal: PaidRefusal, message: string): PaidUnitDecision => ({ ok: false, refusal, message });
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** The run kinds a quote's `action` names, one for one. */
const QUOTE_ACTION: Record<string, string> = {
  full: "full", revise: "revise", replay_critic: "replay_critic", resume_packaging: "resume_packaging",
};

/**
 * Whether one paid unit may be sent. Fails closed: every input that is missing,
 * unreadable or inconsistent refuses. The order fixes which refusal a run
 * records when several hold: cancellation and the wall clock first, then the
 * reservation, then the caps.
 */
export function decidePaidUnit(
  s: PaidUnitSnapshot, price: PaidUnitPrice, caps: WorkerCaps, timing: { elapsedMs: number; limitMs: number },
): PaidUnitDecision {
  if (!s.job || s.job.cancelRequested || s.job.state !== "running") {
    return no("job_cancelled", "the job was cancelled or is no longer running; no further request is sent");
  }
  if (!(timing.elapsedMs <= timing.limitMs)) {
    return no("job_timeout", `the job passed its wall-clock limit of ${timing.limitMs} ms`);
  }
  if (s.run.state !== "running" || s.run.runner !== "live" || s.run.kind === "imported") {
    return no("not_running", "the run is not a running live run");
  }
  const reserved = s.run.reservedMicros;
  if (reserved === null || !(reserved > 0) || s.run.quoteId === null || s.reserves.length !== 1 || s.reserves[0] !== reserved) {
    return no("reservation_missing", "the run has no live reservation: exactly one reserve entry equal to its reservation");
  }
  if (s.settled) return no("reservation_settled", "the run's reservation is already released or overrun");
  if (!s.quote || !s.quote.consumed || s.quote.userId !== s.run.requestedBy || QUOTE_ACTION[s.run.kind] !== s.quote.action) {
    return no("quote_mismatch", "the run's quote is missing, unconsumed, another user's, or for another action");
  }
  if (!s.requester || s.requester.status !== "active" || !["owner", "runner"].includes(s.requester.role)) {
    return no("requester_not_permitted", "the run's requester is no longer an active owner or runner");
  }
  if ([...price.requestCeilings, ...price.remainingCeilings].some((c) => c === undefined || !Number.isSafeInteger(c) || c <= 0)
    || price.requestCeilings.length === 0) {
    return no("unpriced_request", "a request has no price row, so its cost cannot be reserved");
  }
  if (s.openRequests !== 0) return no("requests_in_flight", "an earlier request of this run has no completed row");
  if (s.chargedMicros > reserved) {
    return no("cost_ceiling_exceeded", "the run's charged cost already exceeds its reservation");
  }
  if (sum(price.remainingCeilings as number[]) > reserved - s.chargedMicros) {
    return no("reservation_exhausted", "the ceiling for the requests still to make does not fit what remains of the reservation");
  }
  if (s.unacknowledgedOverruns > 0) {
    return no("confirmations_locked", "an overrun the owner has not acknowledged locks every paid request and confirmation");
  }
  const dailyCap = Math.min(caps.dailyMicros, s.settings?.dailyCapMicros ?? 0);
  const monthlyCap = Math.min(caps.monthlyMicros, s.settings?.monthlyCapMicros ?? 0);
  if (!(s.daySpendMicros <= dailyCap)) return no("cap_exceeded_daily", "the day's spend is over the effective daily cap");
  if (!(s.monthSpendMicros <= monthlyCap)) return no("cap_exceeded_monthly", "the month's spend is over the effective monthly cap");
  if (s.requester.dailyCapMicros !== null && !(s.userDaySpendMicros <= s.requester.dailyCapMicros)) {
    return no("cap_exceeded_user_daily", "the requester's spend today is over their daily cap");
  }
  return { ok: true };
}

/** The settlement a finished live run books: the unused reservation released, or its overrun. */
export type Settlement = { entry: "release" | "overrun"; micros: number } | null;

export function planSettlement(reservedMicros: number, chargedMicros: number): Settlement {
  if (chargedMicros < reservedMicros) return { entry: "release", micros: reservedMicros - chargedMicros };
  if (chargedMicros > reservedMicros) return { entry: "overrun", micros: chargedMicros - reservedMicros };
  return null;
}

/** The audit action by which the owner acknowledges an overrun (design §6.2), unlocking confirmations. */
export const OVERRUN_ACKNOWLEDGED = "spend.overrun_acknowledged";

/** Overrun entries no owner has acknowledged. Shared by the worker's unit check and, in S6, the confirmation. */
export const UNACKNOWLEDGED_OVERRUNS_SQL = `
  SELECT count(*)::int AS n FROM studio_spend_ledger l
   WHERE l.entry = 'overrun' AND NOT EXISTS (
     SELECT 1 FROM studio_audit_log a JOIN studio_users u ON u.id = a.actor_user_id AND u.role = 'owner'
      WHERE a.action = '${OVERRUN_ACKNOWLEDGED}' AND a.target_type = 'studio_runs' AND a.target_id = l.run_id::text)`;

export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, any>>; rowCount?: number | null }>;
}

/** Whether new confirmations are locked by an unacknowledged overrun. S6's confirmation transaction calls this. */
export async function confirmationsLocked(client: SqlClient): Promise<boolean> {
  return ((await client.query(UNACKNOWLEDGED_OVERRUNS_SQL)).rows[0]?.n ?? 1) !== 0;
}

/** Reads the snapshot. Call inside a transaction: it locks the run's row first, which serializes its ledger writes. */
export async function readPaidUnitSnapshot(client: SqlClient, runId: string, jobId: string): Promise<PaidUnitSnapshot | null> {
  const run = (await client.query(
    `SELECT state, runner, kind, reserved_usd::text AS reserved, quote_id, requested_by
       FROM studio_runs WHERE id = $1 FOR UPDATE`, [runId])).rows[0];
  if (!run) return null;
  const job = (await client.query(
    "SELECT state, cancel_requested_at IS NOT NULL AS cancel FROM studio_jobs WHERE id = $1 AND run_id = $2",
    [jobId, runId])).rows[0];
  const quote = run.quote_id === null ? undefined : (await client.query(
    "SELECT user_id, consumed_at IS NOT NULL AS consumed, action FROM studio_quotes WHERE id = $1", [run.quote_id])).rows[0];
  const requester = (await client.query(
    "SELECT status, role, daily_cap_usd::text AS cap FROM studio_users WHERE id = $1", [run.requested_by])).rows[0];
  const ledger = (await client.query(
    "SELECT entry, amount_usd::text AS amount, day_local::text AS day FROM studio_spend_ledger WHERE run_id = $1",
    [runId])).rows;
  const reserveRows = ledger.filter((row) => row.entry === "reserve");
  const charged = (await client.query(
    `SELECT COALESCE(SUM(charged_usd), 0)::text AS charged, count(*) FILTER (WHERE outcome = 'started')::int AS open
       FROM studio_run_requests WHERE run_id = $1`, [runId])).rows[0]!;
  const day = reserveRows[0]?.day ?? (await client.query("SELECT studio_local_day(now())::text AS day")).rows[0]!.day;
  const spend = (await client.query(
    `SELECT studio_spend_for_day($1::date)::text AS day, studio_spend_for_month($1::date)::text AS month,
            (SELECT COALESCE(SUM(CASE l.entry WHEN 'release' THEN -l.amount_usd ELSE l.amount_usd END), 0)::text
               FROM studio_spend_ledger l JOIN studio_runs r ON r.id = l.run_id
              WHERE r.requested_by = $2 AND l.day_local = $1::date) AS user_day`, [day, run.requested_by])).rows[0]!;
  const settings = (await client.query(
    "SELECT daily_cap_usd::text AS daily, monthly_cap_usd::text AS monthly FROM studio_settings")).rows;
  const overruns = (await client.query(UNACKNOWLEDGED_OVERRUNS_SQL)).rows[0]?.n;
  return {
    run: { state: run.state, runner: run.runner, kind: run.kind, reservedMicros: numericToMicros(run.reserved),
      quoteId: run.quote_id, requestedBy: run.requested_by },
    job: job ? { state: job.state, cancelRequested: job.cancel === true } : null,
    quote: quote ? { userId: quote.user_id, consumed: quote.consumed === true, action: quote.action } : null,
    requester: requester ? { status: requester.status, role: requester.role, dailyCapMicros: numericToMicros(requester.cap) } : null,
    reserves: reserveRows.map((row) => numericToMicros(row.amount)!),
    settled: ledger.some((row) => row.entry === "release" || row.entry === "overrun"),
    chargedMicros: numericToMicros(charged.charged) ?? 0,
    openRequests: Number(charged.open),
    daySpendMicros: numericToMicros(spend.day) ?? 0,
    monthSpendMicros: numericToMicros(spend.month) ?? 0,
    userDaySpendMicros: numericToMicros(spend.user_day) ?? 0,
    settings: settings.length === 1
      ? { dailyCapMicros: numericToMicros(settings[0]!.daily) ?? 0, monthlyCapMicros: numericToMicros(settings[0]!.monthly) ?? 0 }
      : null,
    unacknowledgedOverruns: typeof overruns === "number" ? overruns : 1,
  };
}
