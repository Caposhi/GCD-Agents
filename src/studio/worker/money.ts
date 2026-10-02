/**
 * Money for the Studio worker, in whole micro-dollars (the schema's
 * `numeric(12,6)` USD), so every comparison is exact integer arithmetic and no
 * floating-point sum can make a ceiling that fits look as if it did not, or the
 * reverse.
 */

export const MICROS_PER_USD = 1_000_000;

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

/** A PostgreSQL `numeric` as micro-dollars, exactly (at most six decimals). */
export function numericToMicros(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const match = /^(-)?(\d+)(?:\.(\d{1,6})0*)?$/.exec(String(text).trim());
  if (!match) throw new Error(`not a numeric(12,6) amount: ${JSON.stringify(text)}`);
  const micros = Number(match[2]) * MICROS_PER_USD + Number((match[3] ?? "").padEnd(6, "0"));
  return match[1] ? -micros : micros;
}

/** Micro-dollars as a `numeric(12,6)` literal. */
export function microsToNumeric(micros: number): string {
  if (!Number.isSafeInteger(micros)) throw new Error(`not a whole number of micro-dollars: ${micros}`);
  const sign = micros < 0 ? "-" : "";
  const abs = Math.abs(micros);
  return `${sign}${Math.floor(abs / MICROS_PER_USD)}.${String(abs % MICROS_PER_USD).padStart(6, "0")}`;
}

/**
 * A deployment-time cap (`STUDIO_MAX_DAILY_USD`, `STUDIO_MAX_MONTHLY_USD`) in
 * micro-dollars. Missing, empty, negative, not a plain decimal, or more than
 * six decimals: zero, which refuses every paid request (design §6.2).
 */
export function parseCapMicros(raw: string | undefined): number {
  if (typeof raw !== "string" || !/^\d{1,6}(?:\.\d{1,6})?$/.test(raw.trim())) return 0;
  return numericToMicros(raw.trim()) ?? 0;
}
