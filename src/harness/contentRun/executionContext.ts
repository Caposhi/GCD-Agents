/**
 * The review-only execution context (Content Studio S3; the owner's binding
 * rule of 2026-09-29, docs/CONTENT_STUDIO_DESIGN.md §5.4).
 *
 * Production-wiring P2 will make `invokeStage` refuse unless a stage's
 * `executionEnabled` is true and the live runtime authority gate permits (C2),
 * and make the stage request boundary re-read that gate before every provider
 * request (C3). Neither the local CLI nor the Content Studio worker sets
 * `executionEnabled` or consults a live gate, so the rule requires an explicit,
 * separately reviewed context that keeps both working. This is it.
 *
 * What it is:
 *
 * - **A typed capability.** A `ReviewOnlyExecutionContext` carries a
 *   module-private brand, so no object literal satisfies the type, and the
 *   library verifies membership in this module's own registry at run time, so
 *   no look-alike, copy or spread passes either. Only
 *   `createReviewOnlyExecutionContext` makes one, and only
 *   `scripts/local/content-run.mjs` and `src/studio/worker/**` may call it
 *   (the offline suite's construction allowlist, CS8).
 * - **It can never approve or publish.** It holds exactly three things: its
 *   kind, its caller, and one per-request check. No approval, publication,
 *   provider-posting or live-database capability, and nothing that could carry
 *   one (CS7 at run time; the type-level check in
 *   `src/studio/worker/executionContext.typecheck.ts`). This module imports
 *   nothing at run time, so reaching it reaches nothing else (CS9).
 * - **It sits beside the live authority gate, never replacing it.** No live
 *   entry point can reach this module, construct a context or receive one
 *   (CS9). A context does not stand in for `executionEnabled`, the live gate,
 *   an approval decision or the publication guard; it only lets the two
 *   review-only callers run the stages as they do today.
 *
 * How the library uses it: every paid path (a live runner) requires one,
 * verified next to the `PaidActionConsent` and before it, so a paid path with
 * no context — or with an object that is not one — refuses before consent,
 * before any runner exists and before any output is created. When a context is
 * supplied, the library calls its `checkRequests` immediately before every
 * request unit — each stage request, and the critic panel's four lens requests
 * as one unit — and a refusal means that unit, and every later one, is never
 * sent. The CLI's check allows every unit (its consent was the typed LIVE); the
 * Studio worker's re-checks the job and the reservation (design §6.2).
 *
 * How P2 accepts it is written down, not built, in docs/CONTENT_STUDIO_DESIGN.md
 * §5.4 ("How P2's C2 and C3 accept the context").
 */

import type { CostCeiling, CostCeilingLine, PaidActionKind, RunnerKind } from "./types.js";

/** The only two callers the owner's rule names. */
export const REVIEW_ONLY_CALLERS = ["local-cli", "studio-worker"] as const;
export type ReviewOnlyCaller = typeof REVIEW_ONLY_CALLERS[number];

/** The context's own keys, exactly. The offline suite holds a context to these. */
export const REVIEW_ONLY_CONTEXT_KEYS = ["kind", "caller", "checkRequests"] as const;

/**
 * One request unit, as the library is about to send it: one stage request, or
 * the critic panel's four lens requests together (they run concurrently, so
 * they are authorized together — design §5.3).
 */
export interface ReviewOnlyRequestUnit {
  /** The paid action the unit belongs to. */
  action: PaidActionKind;
  runner: RunnerKind;
  /** The stage the unit runs: a stage id, or `final-critic` for the panel. */
  stage: string;
  /** The priced request(s) this unit sends. */
  requests: readonly CostCeilingLine[];
  /** Every request the action still has to send, this unit's included, priced now. */
  remaining: readonly CostCeilingLine[];
}

/** Resolves to allow the unit; throws to refuse it, and with it every later unit. */
export type ReviewOnlyRequestCheck = (unit: ReviewOnlyRequestUnit) => Promise<void>;

declare const reviewOnlyBrand: unique symbol;

export interface ReviewOnlyExecutionContext {
  readonly kind: "review-only";
  readonly caller: ReviewOnlyCaller;
  readonly checkRequests: ReviewOnlyRequestCheck;
  /** Module-private: no object literal outside this module can carry it. */
  readonly [reviewOnlyBrand]: true;
}

/** A refusal by the context or of it: always before the request it names. */
export class ReviewOnlyContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewOnlyContextError";
  }
}

/** Every context this module made, in this process. A live process makes none (CS9). */
const issued = new WeakSet<object>();

/**
 * Make a context. Only `scripts/local/content-run.mjs` and
 * `src/studio/worker/**` may call this (the offline suite's construction
 * allowlist). The result is frozen and holds exactly `kind`, `caller` and
 * `checkRequests`.
 */
export function createReviewOnlyExecutionContext(options: {
  caller: ReviewOnlyCaller;
  checkRequests: ReviewOnlyRequestCheck;
}): ReviewOnlyExecutionContext {
  const { caller, checkRequests } = options;
  if (!(REVIEW_ONLY_CALLERS as readonly string[]).includes(caller)) {
    throw new ReviewOnlyContextError(`a review-only execution context is made only for ${REVIEW_ONLY_CALLERS.join(" or ")}`);
  }
  if (typeof checkRequests !== "function") {
    throw new ReviewOnlyContextError("a review-only execution context needs its per-request check");
  }
  const context = Object.freeze({ kind: "review-only" as const, caller, checkRequests });
  issued.add(context);
  return context as unknown as ReviewOnlyExecutionContext;
}

/** Whether `value` is a context this module made, unaltered. */
export function isReviewOnlyExecutionContext(value: unknown): value is ReviewOnlyExecutionContext {
  if (typeof value !== "object" || value === null || !issued.has(value) || !Object.isFrozen(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === REVIEW_ONLY_CONTEXT_KEYS.length
    && REVIEW_ONLY_CONTEXT_KEYS.every((key) => keys.includes(key))
    && (value as { kind?: unknown }).kind === "review-only";
}

/**
 * The check a paid path makes next to its `PaidActionConsent`, and before it:
 * no context, or anything that is not one, refuses.
 */
export function requireReviewOnlyExecutionContext(value: unknown, action: PaidActionKind): ReviewOnlyExecutionContext {
  if (!isReviewOnlyExecutionContext(value)) {
    throw new ReviewOnlyContextError(
      `a paid ${action} requires the review-only execution context, which only scripts/local/content-run.mjs and `
      + "the Content Studio worker construct; refusing before any consent, runner or output",
    );
  }
  return value;
}

type Runner = (...callArgs: any[]) => Promise<any>;

/**
 * Wraps each stage runner so the context's check runs immediately before every
 * request unit. Each unit must be one of the action's priced requests not yet
 * sent: a request outside the priced action is refused (C3's "this request is
 * inside what was consented to"). The critic panel's four lens requests share
 * one check, made when the first of them arrives.
 */
export function gateRequestUnits(
  context: ReviewOnlyExecutionContext,
  { action, runner, ceiling }: { action: PaidActionKind; runner: RunnerKind; ceiling: CostCeiling },
): (stage: string, inner: Runner) => Runner {
  const pending: CostCeilingLine[] = [...ceiling.lines];
  let panel: Promise<void> | undefined;
  const check = (stage: string, labels: (line: CostCeilingLine) => boolean): Promise<void> => {
    const requests = pending.filter(labels);
    if (requests.length === 0) {
      return Promise.reject(new ReviewOnlyContextError(
        `a ${stage} request is not among the priced requests this ${action} still has to make; refusing it`));
    }
    const remaining = [...pending];
    for (const line of requests) pending.splice(pending.indexOf(line), 1);
    return context.checkRequests({ action, runner, stage, requests, remaining });
  };
  return (stage, inner) => async (...callArgs) => {
    if (stage === "final-critic") {
      panel ??= check(stage, (line) => line.label.startsWith("final-critic:"));
      await panel;
    } else {
      await check(stage, (line) => line.label === stage);
    }
    return inner(...callArgs);
  };
}
