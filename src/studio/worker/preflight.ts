/**
 * The worker's free preflight (docs/CONTENT_STUDIO_DESIGN.md §6.1 steps 1–2,
 * §8.3, §8.4). Content Studio S6.2; it replaces S3's `preflight_not_built`
 * stub. **It makes no request:** it runs no runner, builds none, and opens no
 * output.
 *
 * 1. It reads the request by its job (`studio_preflight_requests`, migration
 *    0003) and recomputes `params_sha256` with the ONE canonical function both
 *    the web and the worker call (`preflightParamsSha256`). A mismatch is
 *    refused (`params_mismatch`) before anything else is read.
 * 2. It runs the action's own library path — `runFullPipeline`, `reviseRun`,
 *    `replayCritic` or `resumeFromPackaging` — as a LIVE run, so every free check
 *    the CLI makes for that action runs exactly as it would: the facts and their
 *    fingerprints, the scope and the 64-record pack cap, the evidence classes,
 *    the contact and identity records, and source verification (fingerprints,
 *    recorded scope, every saved output revalidated, and, for a revise, the
 *    saved critic panel). The library calls its `PaidActionConsent` only after
 *    every free check and after pricing, before any runner or output exists;
 *    the preflight's consent records the priced request and stops there.
 * 3. A quote's breakdown is the library's own `computeCostCeiling` lines, as
 *    the consent received them — never a second formula — grouped so the
 *    critic's four lenses are one item. A line whose model has no price row is
 *    refused (`unpriced_request`): an unknown price cannot be reserved.
 * 4. A revise records `planRevision`'s plan, captured from the library's own
 *    call; with no revisable blocking finding it is refused as
 *    `no_revisable_blocking_finding`, with the plan.
 *
 * The outcome — the quote and the request's `quoted`, or the request's
 * `refused` — is written in ONE transaction with the job's end. A refusal's
 * message is stored for the users allowed to see it and never logged.
 */

import * as lib from "../../harness/contentRun/index.js";
import type {
  ContentRunRuntime, CostCeilingLine, FactFile, PaidActionRequest, RunIo, RunOptions, RunSource,
} from "../../harness/contentRun/index.js";
import { microsToNumeric, preflightParamsSha256 } from "../db/runner.js";
import {
  ACTIONS, APPROVED_FACTS_PATH, AUTOMOTIVE_FACTS_DISPLAY_PATH, failureClassOf, workerRuntime, WorkerStop, type RunKind,
  type WorkerJobContext,
} from "./execute.js";
import { audit, type ClaimedJob } from "./jobs.js";
import { ceilingMicros } from "./money.js";
import { dbRunSource } from "./runSink.js";
import type { WorkerSession } from "./session.js";

/** The request as the worker reads it (`studio_preflight_requests`). */
export interface PreflightRequestRow {
  id: string;
  jobId: string;
  userId: string;
  action: string;
  goal: string | null;
  platforms: string[];
  scopeTags: string[] | null;
  sourceRunId: string | null;
  factVersionId: string;
  paramsSha256: string;
}

/** A revise, replay or resume's source run, as the worker reads it, and its artifacts as the library's source. */
export interface PreflightSourceRun {
  state: string;
  deleted: boolean;
  kind: string;
  /** Content Studio S7.2: a fake source (a Studio fake run, or an import of a fake CLI run) is refused by name. */
  runner: string;
  importTier: string | null;
  factVersionId: string | null;
  source: RunSource;
}

export interface PreflightInputs {
  request: PreflightRequestRow;
  /** The request's fact version's exact bytes, or null when it no longer exists. */
  factVersion: { content: Buffer; sha256: string } | null;
  sourceRun: PreflightSourceRun | null;
  approvedFacts: { bytes: Buffer; sha256: string };
  repoRoot: string;
  /** The library's runtime as loaded; the preflight never passes it on unaltered (`workerRuntime`). */
  runtime: ContentRunRuntime;
}

/**
 * One item of a quote: a stage request, or the critic panel — its four lens
 * requests, which run together (design §6.1), as ONE item. `lines` are
 * `computeCostCeiling`'s lines exactly; `ceilingUsd` is the sum of their
 * ceilings, each rounded up to the micro-dollar as the worker reserves it.
 */
export interface QuoteItem {
  item: string;
  unit: "request" | "critic-panel";
  ceilingUsd: string;
  lines: CostCeilingLine[];
}

export type PreflightOutcome =
  | { outcome: "quoted"; items: QuoteItem[]; ceilingMicros: number; revisePlan: Record<string, unknown> | null }
  | { outcome: "refused"; refusalClass: string; message: string; revisePlan: Record<string, unknown> | null };

/** `studio_preflight_requests_refusal_message_bounded`: 1–4,000 characters. */
export const REFUSAL_MESSAGE_MAX = 4_000;
/** The critic panel's lines, as `criticLensPolicies` labels them. */
const CRITIC_PANEL = "final-critic";
const TERMINAL_STATES = ["succeeded", "failed", "refused", "cancelled", "interrupted"];

/** The thrown value that ends the library's path at its consent, once the request is priced. */
class Priced extends Error {
  constructor() {
    super("priced: the free preflight stops at the paid-action gate");
    this.name = "Priced";
  }
}

const bounded = (message: string): string => {
  const text = [...(message || "the free preflight refused this request")];
  return text.length > REFUSAL_MESSAGE_MAX ? text.slice(0, REFUSAL_MESSAGE_MAX).join("") : text.join("");
};
const refused = (refusalClass: string, message: string, revisePlan: Record<string, unknown> | null = null): PreflightOutcome =>
  ({ outcome: "refused", refusalClass, message: bounded(message), revisePlan });

/**
 * The library's lines as a quote's items: each stage request its own item, the
 * critic panel's four lens lines one item. Null when any line has no price
 * (a model with no row in the estimate's table): an unknown price cannot be reserved.
 */
export function quoteItems(lines: readonly CostCeilingLine[]): { items: QuoteItem[]; ceilingMicros: number } | null {
  if (lines.length === 0) return null;
  if (lines.some((line) => typeof line.costUsd !== "number" || !Number.isFinite(line.costUsd) || !(line.costUsd > 0))) return null;
  const items: QuoteItem[] = [];
  for (const line of lines) {
    const panel = line.label.startsWith(`${CRITIC_PANEL}:`);
    const last = items.at(-1);
    if (panel && last?.unit === "critic-panel") last.lines.push(line);
    else items.push({ item: panel ? CRITIC_PANEL : line.label, unit: panel ? "critic-panel" : "request", ceilingUsd: "", lines: [line] });
  }
  let total = 0;
  for (const item of items) {
    const micros = item.lines.reduce((sum, line) => sum + ceilingMicros(line.costUsd!), 0);
    item.ceilingUsd = microsToNumeric(micros);
    total += micros;
  }
  return { items, ceilingMicros: total };
}

/** A plan as stored: plain JSON (the schema requires an object). */
const asPlan = (plan: unknown): Record<string, unknown> | null =>
  plan !== null && typeof plan === "object" ? JSON.parse(JSON.stringify(plan)) as Record<string, unknown> : null;

/**
 * The free preflight's decision for one request. Pure of the database: the
 * caller reads the request, the fact version and the source run, and writes
 * the outcome. It makes no request — no runner is built, no output opened.
 */
export async function decidePreflight(input: PreflightInputs): Promise<PreflightOutcome> {
  const r = input.request;
  // 1. The parameters must hash to what the request says, by the one canonical function.
  const recomputed = preflightParamsSha256({
    action: r.action, goal: r.goal, platforms: r.platforms, scopeTags: r.scopeTags, sourceRunId: r.sourceRunId,
    factVersionId: r.factVersionId,
  });
  if (recomputed !== r.paramsSha256) {
    return refused("params_mismatch", "the request's parameters do not hash to its params_sha256; nothing was checked or priced");
  }
  if (!Object.hasOwn(ACTIONS, r.action)) return refused("not_executable", "this action is not one the worker runs");
  const kind = r.action as RunKind;
  if (!input.factVersion) return refused("fact_version_missing", "the request's fact version no longer exists");
  if (kind !== "full") {
    const s = input.sourceRun;
    if (!s || s.deleted) return refused("source_unavailable", "the source run does not exist or was deleted");
    // Owner decision of 2026-10-06 (migration 0004 refuses its confirmation): refused here by name, before any quote.
    if (s.runner === "fake") return refused("fake_source", "a fake run can never be the source of a paid action; nothing was checked or priced");
    if (!TERMINAL_STATES.includes(s.state)) return refused("source_not_finished", "the source run has not finished");
    if (s.kind === "imported" && s.importTier !== "verified") {
      return refused("source_not_verified", "an import that was not revalidated can never be the source of a paid action");
    }
    // §4.4: a revise, replay or resume uses its source run's pinned fact version (the library then proves the bytes).
    if (s.factVersionId !== r.factVersionId) {
      return refused("fact_version_mismatch", "the request's fact version is not the one its source run pinned");
    }
  }

  // 2. The action's own library path, as a LIVE run, stopped at its consent.
  let priced: PaidActionRequest | undefined;
  let plan: unknown;
  const base = workerRuntime(input.runtime, undefined);
  const rt: ContentRunRuntime = {
    ...base,
    revision: {
      ...base.revision,
      planRevision: ((...args: Parameters<ContentRunRuntime["revision"]["planRevision"]>) => {
        plan = base.revision.planRevision(...args);
        return plan;
      }) as ContentRunRuntime["revision"]["planRevision"],
    },
  };
  const stop = new Priced();
  const noOutput = (): never => { throw new Error("the free preflight opens no run output"); };
  const io: RunIo = {
    reporter: { log: () => {}, warn: () => {} },
    consent: async (request) => {
      if (request.kind !== ACTIONS[kind]) throw new WorkerStop("quote_mismatch", "the library priced another action than the request's");
      priced = request;
      throw stop;
    },
    confirmUnproven: lib.refuseUnprovenAutomotiveFacts,
    outputs: { openFullRun: noOutput, openDerivedRun: noOutput },
    execution: lib.createReviewOnlyExecutionContext({
      caller: "studio-worker",
      checkRequests: async () => { throw new Error("the free preflight sends no request"); },
    }),
  };
  const version = input.factVersion;
  const automotiveFacts: FactFile = {
    path: `studio fact version ${version.sha256}`, displayPath: AUTOMOTIVE_FACTS_DISPLAY_PATH,
    exists: () => true, read: async () => new Uint8Array(version.content),
  };
  const approvedFacts: FactFile = {
    path: APPROVED_FACTS_PATH, displayPath: APPROVED_FACTS_PATH,
    exists: () => true, read: async () => new Uint8Array(input.approvedFacts.bytes),
  };
  let scopeTags: string[] | undefined;
  try {
    scopeTags = r.scopeTags ? lib.normalizeScopeTags(r.scopeTags.join(",")) : undefined;
  } catch (error) {
    return refused("invalid_scope_tags", String((error as Error)?.message ?? error));
  }
  const options: RunOptions = {
    runner: "live",
    facts: { approvedFacts, automotiveFacts },
    goal: r.goal ?? undefined,
    platforms: [...r.platforms],
    scopeTags,
    reviewedAt: new Date().toISOString(),
    reviewedAtExplicit: false,
  };
  let revised: { revised: boolean; plan?: unknown } | undefined;
  try {
    switch (kind) {
      case "full": await lib.runFullPipeline(rt, options, io); break;
      case "replay_critic": await lib.replayCritic(rt, options, input.sourceRun!.source, io); break;
      case "resume_packaging": await lib.resumeFromPackaging(rt, options, input.sourceRun!.source, "packaging-adaptation", io); break;
      case "revise": revised = await lib.reviseRun(rt, options, input.sourceRun!.source, "revise-from", io); break;
    }
  } catch (error) {
    if (error !== stop) {
      const refusal = error instanceof WorkerStop ? error.refusal : failureClassOf(error);
      return refused(refusal, String((error as Error)?.message ?? error));
    }
  }
  if (kind === "revise" && revised?.revised === false) {
    return refused("no_revisable_blocking_finding",
      "no blocking finding has a revisable owner (hook-story-script, production-direction or packaging-adaptation): "
      + "nothing to revise, so no quote", asPlan(plan ?? revised.plan));
  }
  if (!priced) return refused("not_priced", "the action finished its free checks without reaching its paid-action gate");

  // 3. The quote: the library's own lines, the critic panel one item.
  const quote = quoteItems(priced.ceiling.lines);
  if (!quote) {
    const unpriced = priced.ceiling.lines.filter((line) => !(typeof line.costUsd === "number" && line.costUsd > 0))
      .map((line) => line.model);
    return refused("unpriced_request",
      `no price row for ${[...new Set(unpriced)].join(", ") || "a request"}: an unknown price cannot be reserved, so no quote`);
  }
  // 4. A revise's quote carries planRevision's plan.
  const revisePlan = kind === "revise" ? asPlan(plan) : null;
  if (kind === "revise" && !revisePlan) return refused("plan_missing", "the revision was priced without a plan");
  return { outcome: "quoted", items: quote.items, ceilingMicros: quote.ceilingMicros, revisePlan };
}

/** What a quote binds besides the request: the worker that priced it (design §6.1). */
export interface QuoteBinding {
  commit: string;
  approvedFactsSha256: string;
  priceTableSha256: string;
}

/**
 * The outcome, in ONE transaction: for a quote, the `studio_quotes` row and the
 * request's `quoted` outcome naming it (with a revise's plan); for a refusal,
 * the request's `refused` outcome (with a plan only where the schema requires
 * one); then the job's end and an audit row of classes only. Neither half is
 * ever written without the other.
 */
export async function writePreflightOutcome(
  session: Pick<WorkerSession, "tx">, binding: QuoteBinding, request: PreflightRequestRow, outcome: PreflightOutcome,
): Promise<{ quoteId: string | null }> {
  return session.tx(async (client) => {
    let quoteId: string | null = null;
    let written;
    if (outcome.outcome === "quoted") {
      quoteId = String((await client.query(
        `INSERT INTO studio_quotes (user_id, action, params_sha256, worker_commit, approved_facts_sha256, fact_version_id,
                                    price_table_sha256, ceiling_usd, breakdown)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [request.userId, request.action, request.paramsSha256, binding.commit, binding.approvedFactsSha256,
          request.factVersionId, binding.priceTableSha256, microsToNumeric(outcome.ceilingMicros),
          JSON.stringify(outcome.items)])).rows[0]!.id);
      written = await client.query(
        `UPDATE studio_preflight_requests SET outcome = 'quoted', quote_id = $2, revise_plan = $3
          WHERE id = $1 AND outcome IS NULL`,
        [request.id, quoteId, outcome.revisePlan === null ? null : JSON.stringify(outcome.revisePlan)]);
    } else {
      written = await client.query(
        `UPDATE studio_preflight_requests SET outcome = 'refused', refusal_class = $2, refusal_message = $3, revise_plan = $4
          WHERE id = $1 AND outcome IS NULL`,
        [request.id, outcome.refusalClass, outcome.message,
          outcome.revisePlan === null ? null : JSON.stringify(outcome.revisePlan)]);
    }
    if (written.rowCount !== 1) throw new Error("the preflight request already has an outcome");
    await client.query("UPDATE studio_jobs SET state = 'finished' WHERE id = $1", [request.jobId]);
    await audit(client, "preflight.answer", "studio_preflight_requests", request.id, outcome.outcome === "quoted"
      ? { outcome: "quoted" } : { outcome: "refused", refusal_class: outcome.refusalClass });
    return { quoteId };
  });
}

/** The ids as PostgreSQL prints them, the arrays as stored. */
const REQUEST_COLUMNS = `id::text AS id, job_id::text AS job_id, user_id::text AS user_id, action, goal, platforms, scope_tags,
  source_run_id::text AS source_run_id, fact_version_id::text AS fact_version_id, params_sha256, outcome`;

/**
 * One claimed preflight job, answered: the request read by its job, decided,
 * and its outcome written. Logs classes only — never a goal, a parameter or a
 * refusal's message (design §9.2).
 */
export async function runPreflight(ctx: WorkerJobContext, job: ClaimedJob): Promise<{ outcome: string; refusalClass: string | null }> {
  const { session } = ctx;
  const row = (await session.query(`SELECT ${REQUEST_COLUMNS} FROM studio_preflight_requests WHERE job_id = $1`, [job.jobId])).rows[0];
  if (!row || row.outcome !== null) {
    // Nothing to answer (a job written with no request, or one already answered): the job is closed, never retried.
    await session.tx(async (client) => {
      await client.query("UPDATE studio_jobs SET state = 'finished' WHERE id = $1", [job.jobId]);
      await audit(client, "job.preflight_refused", "studio_jobs", job.jobId, { reason: row ? "already_answered" : "no_request" });
    });
    return { outcome: row ? "already_answered" : "no_request", refusalClass: null };
  }
  const request: PreflightRequestRow = {
    id: row.id, jobId: row.job_id, userId: row.user_id, action: row.action, goal: row.goal, platforms: row.platforms,
    scopeTags: row.scope_tags, sourceRunId: row.source_run_id, factVersionId: row.fact_version_id, paramsSha256: row.params_sha256,
  };
  const version = (await session.query("SELECT content, sha256 FROM studio_fact_versions WHERE id = $1", [request.factVersionId])).rows[0];
  const source = request.sourceRunId === null ? undefined : (await session.query(
    `SELECT state, deleted_at IS NOT NULL AS deleted, kind, runner, import_tier, fact_version_id::text AS fact_version_id
       FROM studio_runs WHERE id = $1`, [request.sourceRunId])).rows[0];
  let outcome: PreflightOutcome;
  try {
    outcome = await decidePreflight({
      request,
      factVersion: version ? { content: version.content as Buffer, sha256: String(version.sha256) } : null,
      sourceRun: source && request.sourceRunId !== null ? {
        state: source.state, deleted: source.deleted === true, kind: source.kind, runner: source.runner, importTier: source.import_tier,
        factVersionId: source.fact_version_id, source: dbRunSource(session, request.sourceRunId),
      } : null,
      approvedFacts: ctx.approvedFacts, repoRoot: ctx.repoRoot, runtime: ctx.runtime,
    });
  } catch (error) {
    outcome = refused(failureClassOf(error), String((error as Error)?.message ?? error));
  }
  const binding = { commit: ctx.commit, approvedFactsSha256: ctx.approvedFacts.sha256, priceTableSha256: ctx.priceTableSha256 };
  try {
    await writePreflightOutcome(session, binding, request, outcome);
  } catch (error) {
    // The database refused the outcome (a quote whose requester is no longer an active owner or runner, say):
    // the request is answered as refused instead, still in one transaction with the job's end. Should that be
    // refused too, the job alone is closed, so the queue never stops on one request.
    if (session.lost) throw session.lost;
    outcome = refused("outcome_refused", outcome.outcome === "quoted"
      ? "the database refused this quote; the requester may no longer be an active owner or runner"
      : "the database refused this refusal's record");
    try {
      await writePreflightOutcome(session, binding, request, outcome);
    } catch {
      if (session.lost) throw session.lost;
      await session.tx(async (client) => {
        await client.query("UPDATE studio_jobs SET state = 'finished' WHERE id = $1 AND state = 'running'", [job.jobId]);
        await audit(client, "job.preflight_refused", "studio_jobs", job.jobId, { reason: "outcome_not_written" });
      });
      return { outcome: "not_written", refusalClass: null };
    }
  }
  return { outcome: outcome.outcome, refusalClass: outcome.outcome === "refused" ? outcome.refusalClass : null };
}
