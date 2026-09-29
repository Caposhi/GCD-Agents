/**
 * Confirmations a caller that cannot ask a person uses in place of a prompt.
 */

import type { UnprovenFactsConfirmation } from "./types.js";

/**
 * The Studio worker's `UNPROVEN` confirmation: it always refuses.
 *
 * A replay of a run that predates the automotive-facts fingerprint cannot
 * prove it is using the facts file the run used. The CLI lets its operator
 * type UNPROVEN to continue anyway; a review-only worker has no operator at
 * the terminal, so it never continues on an unproven facts file. That is a
 * narrowing, not a relaxation (docs/CONTENT_STUDIO_DESIGN.md §5.2). Nothing
 * uses it until the worker exists (S3).
 */
export const refuseUnprovenAutomotiveFacts: UnprovenFactsConfirmation = async () => ({
  confirmed: false,
  reason: "a review-only worker never continues on an automotive facts file whose identity cannot be proven",
});
