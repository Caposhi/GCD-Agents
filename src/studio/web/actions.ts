/**
 * The run and revise actions' decisions (docs/CONTENT_STUDIO_DESIGN.md §6.1–§6.4,
 * §8.3, §8.4). Content Studio S6.2.
 *
 * Every decision here is a pure function over data the store read, so the
 * offline suite proves each refusal and the mutation harness proves each one
 * load-bearing; the disposable PostgreSQL suites prove them end to end. The
 * web never computes a price: a quote's ceiling and breakdown are the worker's
 * (§6.1), and the web only compares the stored ceiling with the caps.
 */

import { preflightParamsSha256 } from "../db/runner.js";
import type { DeploymentCeilings } from "./startup.js";

export type { DeploymentCeilings } from "./startup.js";

// --- Shapes the schema fixes ----------------------------------------------------

/** `studio_preflight_requests_platforms`: the three packaging platforms, in the CLI's default order. */
export const PLATFORMS = ["instagram", "facebook", "google_business_profile"] as const;
/** The paid actions, as `studio_quotes.action` names them. */
export const PAID_ACTIONS = ["full", "revise", "replay_critic", "resume_packaging"] as const;
export type PaidAction = (typeof PAID_ACTIONS)[number];
/** A full run's goal: 1–2,000 characters, counted as PostgreSQL counts them (code points). */
export const GOAL_MAX_CHARS = 2_000;
/** The evidence pack's record cap (EVIDENCE_LIMITS.maxProjectedRecords), shown beside a scope; the worker enforces it. */
export const PACK_RECORD_CAP = 64;
/** §3.3: the worker is offline, and confirmations are refused, once its heartbeat is older than this. */
export const WORKER_OFFLINE_MS = 2 * 60_000;
/** §4.7 (dated note of 2026-10-05): a preflight request is kept at least this long. */
export const PREFLIGHT_RETENTION_MS = 30 * 24 * 60 * 60_000;
/** The longest scope tag the form accepts. */
export const MAX_TAG_CHARS = 200;
/** The most scope tags one request may name. */
export const MAX_TAGS = 200;

/** A refusal: its class (shown, and logged) and its message (shown, never logged). */
export interface Refusal { refusal: string; message: string }
export type Decision = { ok: true } | ({ ok: false } & Refusal);
const no = (refusal: string, message: string): { ok: false } & Refusal => ({ ok: false, refusal, message });

/** Characters as PostgreSQL's char_length counts them: code points, not UTF-16 units. */
export const codePoints = (value: string): number => [...value].length;

// --- The day and month a cap is counted over ---------------------------------------

const NY_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * The America/New_York day of an instant, `YYYY-MM-DD` (owner decision of
 * 2026-09-29): the day the schema's `studio_local_day` books a reserve entry
 * made at that instant to. Every entry of a run is booked to its reserve's day.
 */
export function localDay(instant: number): string {
  const parts = Object.fromEntries(NY_DAY.formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** The first day of a day's month, as `studio_month_of` gives it. */
export const monthOf = (day: string): string => `${day.slice(0, 8)}01`;

// --- Caps (§6.2) -----------------------------------------------------------------


export interface EffectiveCaps {
  dailyMicros: number;
  monthlyMicros: number;
  /** The user's own daily cap, bounded by the deployment's daily ceiling; null when they have none. */
  userDailyMicros: number | null;
}

/**
 * The effective caps: the LOWER of the owner's cap (`studio_settings`, and a
 * user's `daily_cap_usd`) and the deployment ceiling, so a compromised owner
 * session cannot raise spend past the deployment ceiling. Settings that cannot
 * be read are zero.
 */
export function effectiveCaps(
  settings: { dailyCapMicros: number; monthlyCapMicros: number } | null, ceilings: DeploymentCeilings,
  userDailyCapMicros: number | null,
): EffectiveCaps {
  return {
    dailyMicros: Math.min(ceilings.dailyMicros, settings?.dailyCapMicros ?? 0),
    monthlyMicros: Math.min(ceilings.monthlyMicros, settings?.monthlyCapMicros ?? 0),
    userDailyMicros: userDailyCapMicros === null ? null : Math.min(ceilings.dailyMicros, userDailyCapMicros),
  };
}

// --- Confirmation (§6.1 steps 3-4) ------------------------------------------------

/** Everything the confirmation reads, inside its transaction, after the settings-row lock. */
export interface ConfirmSnapshot {
  /** The database's clock, read in the same transaction. */
  nowMs: number;
  /** The confirming user's live row. */
  user: { id: string; role: string; status: string; dailyCapMicros: number | null; updatedAtMs: number } | null;
  quote: {
    id: string; userId: string; action: string; paramsSha256: string; workerCommit: string; approvedFactsSha256: string;
    factVersionId: string; priceTableSha256: string; ceilingMicros: number; createdAtMs: number; expiresAtMs: number;
    consumed: boolean;
  } | null;
  /** The request the quote answers (`studio_preflight_requests.quote_id`). */
  request: { action: string; paramsSha256: string; factVersionId: string; sourceRunId: string | null } | null;
  /** For a revise, replay or resume: whether its source run still exists and is not deleted. */
  sourceAvailable: boolean;
  heartbeat: { commit: string; approvedFactsSha256: string; priceTableSha256: string; beatAtMs: number } | null;
  /**
   * The fact version a run of this action would use now: the active version for
   * a full run, the source run's pinned version for a revise, replay or resume.
   * (The heartbeat carries no fact version.)
   */
  currentFactVersionId: string | null;
  settings: { dailyCapMicros: number; monthlyCapMicros: number } | null;
  ceilings: DeploymentCeilings;
  /** Σreserve − Σrelease + Σoverrun for today's (America/New_York) day and month, and the user's today. */
  spend: { dayMicros: number; monthMicros: number; userDayMicros: number };
  unacknowledgedOverruns: number;
}

/**
 * Whether a quote may be confirmed. The web never computes a price: it compares
 * the worker's stored ceiling with the caps. Fails closed; the order fixes which
 * refusal is shown when several hold.
 */
export function decideConfirm(s: ConfirmSnapshot): Decision {
  const u = s.user;
  if (!u || u.status !== "active" || !["owner", "runner"].includes(u.role)) {
    return no("not_permitted", "only an active owner or runner can confirm a paid run");
  }
  const q = s.quote;
  if (!q) return no("no_quote", "there is no such quote");
  if (q.userId !== u.id) return no("quote_not_yours", "this quote was made for another user");
  if (q.consumed) return no("quote_used", "this quote was already used; a quote confirms one run");
  if (!(s.nowMs <= q.expiresAtMs)) return no("quote_expired", "this quote has expired; ask for a new price");
  if (u.updatedAtMs > q.createdAtMs) {
    return no("user_changed", "your account's role or status changed after this quote was made; ask for a new price");
  }
  const r = s.request;
  if (!r || r.action !== q.action || r.paramsSha256 !== q.paramsSha256 || r.factVersionId !== q.factVersionId) {
    return no("quote_unmatched", "this quote does not answer a price request with the same parameters");
  }
  if (r.sourceRunId !== null && !s.sourceAvailable) return no("source_unavailable", "the source run no longer exists");
  const hb = s.heartbeat;
  if (!hb || !(s.nowMs - hb.beatAtMs <= WORKER_OFFLINE_MS)) {
    return no("worker_offline", "the worker is offline (no heartbeat in the last two minutes); confirmations are refused");
  }
  if (q.workerCommit !== hb.commit || q.approvedFactsSha256 !== hb.approvedFactsSha256 || q.priceTableSha256 !== hb.priceTableSha256) {
    return no("quote_stale", "the worker's commit, approved facts or price table changed since this quote; ask for a new price");
  }
  if (q.factVersionId !== s.currentFactVersionId) {
    return no("quote_stale", "the fact version changed since this quote; ask for a new price");
  }
  if (s.unacknowledgedOverruns > 0) {
    return no("confirmations_locked", "an overrun the owner has not acknowledged locks every confirmation");
  }
  // Content Studio S7.3 (the S7 analysis's item 12, accepted by the owner): a runner's missing daily cap is zero
  // (design §6.2), so a runner with none cannot confirm. The owner's own unset cap is still no per-user cap.
  if (u.role === "runner" && u.dailyCapMicros === null) {
    return no("cap_missing", "you have no daily cap, which counts as zero: the owner sets one on the Users page before you can confirm");
  }
  const caps = effectiveCaps(s.settings, s.ceilings, u.dailyCapMicros);
  if (!(s.spend.dayMicros + q.ceilingMicros <= caps.dailyMicros)) {
    return no("cap_exceeded_daily", "this quote's ceiling does not fit what remains of today's cap");
  }
  if (!(s.spend.monthMicros + q.ceilingMicros <= caps.monthlyMicros)) {
    return no("cap_exceeded_monthly", "this quote's ceiling does not fit what remains of this month's cap");
  }
  if (caps.userDailyMicros !== null && !(s.spend.userDayMicros + q.ceilingMicros <= caps.userDailyMicros)) {
    return no("cap_exceeded_user_daily", "this quote's ceiling does not fit what remains of your own daily cap");
  }
  return { ok: true };
}

// --- Cancellation (§5.3) -------------------------------------------------------------

export interface CancelTarget {
  run: { id: string; requestedBy: string; state: string; runner: string; kind: string; reservedMicros: number | null; deleted: boolean } | null;
  job: { state: string; cancelRequested: boolean } | null;
}

export type CancelPlan =
  | { ok: true; kind: "queued"; releaseMicros: number | null }
  | { ok: true; kind: "running" }
  | ({ ok: false } & Refusal);

/**
 * Who may cancel what, and how (S6.2 decision: the owner may cancel any run, a
 * runner only their own). A queued job is cancelled before it is claimed, and a
 * live run's whole reservation is released with it. A running job's
 * cancellation is requested: the worker sends no further request, keeps what
 * completed and releases the rest (S3's check before every unit).
 */
export function decideCancel(user: { id: string; role: string; status: string } | null, t: CancelTarget): CancelPlan {
  if (!user || user.status !== "active" || !["owner", "runner"].includes(user.role)) {
    return no("not_permitted", "only an active owner or runner can cancel a run");
  }
  const run = t.run;
  if (!run || run.deleted) return no("no_run", "there is no such run");
  if (user.role !== "owner" && run.requestedBy !== user.id) return no("not_your_run", "a runner can cancel only their own runs");
  const job = t.job;
  if (job?.state === "queued" && run.state === "queued") {
    const live = run.runner === "live" && run.kind !== "imported";
    return { ok: true, kind: "queued", releaseMicros: live ? run.reservedMicros : null };
  }
  if (job?.state === "running" && run.state === "running") {
    if (job.cancelRequested) return no("already_cancelling", "this run's cancellation was already requested");
    return { ok: true, kind: "running" };
  }
  return no("not_cancellable", "only a queued or running run can be cancelled");
}

// --- The forms (§8.3, §8.4) ------------------------------------------------------------

export type NewRunForm = { ok: true; goal: string; platforms: string[]; scopeTags: string[] | null } | ({ ok: false } & Refusal);

/**
 * The new-run form, validated before anything is written: one goal of 1–2,000
 * characters (stored exactly as given, as 0003's canonical form requires), a
 * non-empty set of the three platforms (in their default order), and scope tags
 * drawn from the tags offered (sorted; none means an unscoped run).
 */
export function parseNewRun(form: URLSearchParams, offeredTags: ReadonlySet<string>): NewRunForm {
  const goals = form.getAll("goal");
  if (goals.length !== 1) return no("invalid_goal", "give exactly one goal");
  const goal = goals[0]!;
  const length = codePoints(goal);
  if (length < 1 || length > GOAL_MAX_CHARS || goal.trim() === "") {
    return no("invalid_goal", `the goal must be 1 to ${GOAL_MAX_CHARS.toLocaleString("en-US")} characters`);
  }
  const chosen = form.getAll("platform");
  if (chosen.length === 0 || new Set(chosen).size !== chosen.length || !chosen.every((p) => (PLATFORMS as readonly string[]).includes(p))) {
    return no("invalid_platforms", "choose one or more of the three platforms, each once");
  }
  const tags = form.getAll("tag");
  if (tags.length > MAX_TAGS || new Set(tags).size !== tags.length
    || !tags.every((t) => t.length > 0 && t.length <= MAX_TAG_CHARS && offeredTags.has(t))) {
    return no("invalid_scope", "choose scope tags from the list offered, each once");
  }
  return {
    ok: true, goal, platforms: PLATFORMS.filter((p) => chosen.includes(p)),
    scopeTags: tags.length ? [...tags].sort() : null,
  };
}

/**
 * The derived actions a source run's report offers, by the run as stored (the worker's preflight proves the rest).
 * Content Studio S7.2: none on a fake run — a Studio fake run, or an import of a fake CLI run — which can never be a
 * paid action's source (owner decision of 2026-10-06); its price route refuses it by name (`fake_source`).
 */
export function sourceActions(run: {
  kind: string; state: string; runner: string; deleted_at: Date | null; import_tier: string | null; fact_version_id: string | null;
  platforms: string[] | null; scope_tags: string[] | null;
}, stoppedAtStage: string | null): PaidAction[] {
  if (run.runner === "fake") return [];
  if (run.deleted_at !== null || run.fact_version_id === null || !run.platforms?.length) return [];
  if (run.scope_tags !== null && run.scope_tags.length === 0) return [];
  if (run.kind === "imported" && run.import_tier !== "verified") return [];
  if (!["full", "revise", "resume_packaging", "imported"].includes(run.kind)) return [];
  if (run.state === "succeeded") return ["revise", "replay_critic"];
  if (["failed", "interrupted", "cancelled"].includes(run.state) && stoppedAtStage === "packaging-adaptation") return ["resume_packaging"];
  return [];
}

// --- The purge (§4.7, dated note of 2026-10-05) ----------------------------------------

/**
 * Whether the purge may delete a preflight request: kept at least 30 days, and
 * never once a consumed quote depends on it — the record of how its run was
 * priced. (Migration 0003's trigger refuses the same deletions.)
 */
export const preflightPurgeable = (row: { pastRetention: boolean; quoteConsumed: boolean }): boolean =>
  row.pastRetention && !row.quoteConsumed;

// --- The price request (§6.1 step 1) ---------------------------------------------------

/** What the web writes beside a preflight job: the parameters, and their canonical hash. */
export interface PreflightRequestInput {
  userId: string;
  action: PaidAction;
  goal: string | null;
  platforms: string[];
  scopeTags: string[] | null;
  sourceRunId: string | null;
  factVersionId: string;
  paramsSha256: string;
}

/**
 * A request's row, with `params_sha256` computed by the ONE canonical
 * function the worker also calls (`preflightParamsSha256`, S2 runner module).
 */
export function preflightRequest(input: Omit<PreflightRequestInput, "paramsSha256">): PreflightRequestInput {
  return {
    ...input,
    paramsSha256: preflightParamsSha256({
      action: input.action, goal: input.goal, platforms: input.platforms, scopeTags: input.scopeTags,
      sourceRunId: input.sourceRunId, factVersionId: input.factVersionId,
    }),
  };
}

/** The labels a screen shows for each paid action. */
export const ACTION_LABELS: Readonly<Record<PaidAction, string>> = Object.freeze({
  full: "Full run", revise: "Revise", replay_critic: "Critic replay", resume_packaging: "Resume from packaging",
});

/**
 * The tags a new run's scope may name, with how many records carry each: the
 * approved facts' counts (the worker's heartbeat) and the active fact
 * version's, summed per tag, in tag order. The web never reads a fact file.
 */
export function offeredTags(...counts: ReadonlyArray<Readonly<Record<string, number>> | null | undefined>): Array<{ tag: string; count: number }> {
  const merged = new Map<string, number>();
  for (const table of counts) {
    for (const [tag, n] of Object.entries(table ?? {})) {
      if (typeof n === "number" && Number.isSafeInteger(n) && n >= 0) merged.set(tag, (merged.get(tag) ?? 0) + n);
    }
  }
  return [...merged.keys()].sort().map((tag) => ({ tag, count: merged.get(tag)! }));
}

/**
 * An UPPER BOUND of the records the chosen tags put in a pack: the sum of the
 * chosen tags' counts. Tags overlap — a record carrying two chosen tags is
 * counted twice — so the true number may be lower; the always-included contact
 * and identity records are added to it. The worker's free preflight enforces
 * the pack's record cap exactly.
 */
export function scopeUpperBound(tags: ReadonlyArray<{ tag: string; count: number }>, chosen: readonly string[]): number {
  return tags.filter((t) => chosen.includes(t.tag)).reduce((sum, t) => sum + t.count, 0);
}

/** A worker heartbeat counts as online for two minutes (§3.3). */
export const workerOnline = (nowMs: number, beatAtMs: number | null | undefined): boolean =>
  typeof beatAtMs === "number" && nowMs - beatAtMs <= WORKER_OFFLINE_MS;
