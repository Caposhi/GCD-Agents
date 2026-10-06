/**
 * Money for the Studio worker, in whole micro-dollars (the schema's
 * `numeric(12,6)` USD), so every comparison is exact integer arithmetic and no
 * floating-point sum can make a ceiling that fits look as if it did not, or the
 * reverse.
 *
 * Content Studio S6.2 moved `MICROS_PER_USD`, `numericToMicros`,
 * `microsToNumeric` and `parseCapMicros`, unchanged, into the S2 runner module,
 * which the web also reads (its deployment ceilings); they are re-exported
 * here by their S3 names.
 */

import { MICROS_PER_USD } from "../db/runner.js";

export { MICROS_PER_USD, microsToNumeric, numericToMicros, parseCapMicros } from "../db/runner.js";

/**
 * A ceiling in micro-dollars, rounded UP: a request's ceiling, and so a
 * reservation summed from them, is never below the estimate it comes from.
 * `undefined` (a model with no price row) and anything not finite and
 * non-negative are refused by the caller, never priced here.
 */
export function ceilingMicros(usd: number): number {
  // Round away float noise at a thousandth of a micro-dollar first, so
  // 0.1234560000001 and 0.123456 both mean 123,456 µ$, then round up.
  return Math.ceil(Number((usd * MICROS_PER_USD).toFixed(3)));
}

/** A measured cost in micro-dollars, rounded to the nearest; null when unknown or not a usable number. */
export function measuredMicros(usd: unknown): number | null {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0) return null;
  return Math.round(usd * MICROS_PER_USD);
}
