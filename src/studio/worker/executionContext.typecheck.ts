/**
 * Type-level checks on the review-only execution context (Content Studio S3,
 * docs/CONTENT_STUDIO_DESIGN.md §5.4). This file is its own proof: `npm run
 * typecheck` and `npm run build` fail if any assertion below stops holding,
 * and every `@ts-expect-error` fails the build if its line ever compiles.
 *
 * It lives in `src/studio/worker/**`, one of the two places allowed to
 * construct a context. Nothing calls `typeLevelChecks`: it exists to be
 * type-checked. The offline suite also requires that this file exists and
 * carries every one of these assertions (CS7c).
 */

import {
  createReviewOnlyExecutionContext,
  type ReviewOnlyExecutionContext,
  type ReviewOnlyRequestUnit,
} from "../../harness/contentRun/index.js";

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const holds = <T extends true>(): T => true as T;

/**
 * The context's string keys are exactly these three: no approval, publication,
 * provider-posting or live-database capability, and nothing that could carry
 * one, can be added without failing here.
 */
export const contextKeysAreExactlyThese = holds<Equals<Extract<keyof ReviewOnlyExecutionContext, string>,
  "kind" | "caller" | "checkRequests">>();
/** Its only other key is the module-private brand symbol. */
export const contextHasOneSymbolKey = holds<Equals<Extract<keyof ReviewOnlyExecutionContext, symbol> extends never ? false : true, true>>();
/** Its kind and callers are closed literals. */
export const contextKindIsReviewOnly = holds<Equals<ReviewOnlyExecutionContext["kind"], "review-only">>();
export const contextCallersAreTheTwo = holds<Equals<ReviewOnlyExecutionContext["caller"], "local-cli" | "studio-worker">>();
/** Its one capability takes a priced request unit and can only allow (resolve) or refuse (reject). */
export const contextCheckIsAPerUnitGate = holds<Equals<ReviewOnlyExecutionContext["checkRequests"],
  (unit: ReviewOnlyRequestUnit) => Promise<void>>>();
/** Every member is read-only. */
export const contextIsReadOnly = holds<Equals<{ -readonly [K in keyof ReviewOnlyExecutionContext]: ReviewOnlyExecutionContext[K] },
  ReviewOnlyExecutionContext> extends true ? false : true>();
/** A request unit carries prices and labels only: no handle on anything. */
export const unitKeysAreExactlyThese = holds<Equals<keyof ReviewOnlyRequestUnit,
  "action" | "runner" | "stage" | "requests" | "remaining">>();

/** Never called. Each line below must NOT compile; the build fails if one does. */
export function typeLevelChecks(): void {
  // @ts-expect-error — an object literal cannot be a context: it lacks the module-private brand.
  const literal: ReviewOnlyExecutionContext = { kind: "review-only", caller: "studio-worker", checkRequests: async () => {} };
  // @ts-expect-error — only the two named callers.
  createReviewOnlyExecutionContext({ caller: "live-worker", checkRequests: async () => {} });
  // @ts-expect-error — the constructor takes no other capability.
  createReviewOnlyExecutionContext({ caller: "studio-worker", checkRequests: async () => {}, approve: async () => {} });
  // @ts-expect-error — nor a publication one.
  createReviewOnlyExecutionContext({ caller: "local-cli", checkRequests: async () => {}, publish: async () => {} });
  const context = createReviewOnlyExecutionContext({ caller: "studio-worker", checkRequests: async () => {} });
  // @ts-expect-error — a context has no approval member to call.
  void context.approve;
  // @ts-expect-error — and it cannot be changed after it is made.
  context.caller = "local-cli";
  void literal;
}
