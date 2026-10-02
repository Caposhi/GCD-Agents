/**
 * The provider-visible text of one stage 5 package: caption, canonical
 * hashtags, then the deterministic contact line. Moved unchanged from
 * `contactLine.ts` (and `proposedProviderText` from `packagingAdaptation.ts`)
 * by Content Studio S5, which re-export every name here, so every existing
 * caller and check reads the same function.
 *
 * **A leaf: this module imports nothing at run time** (its one import is
 * type-only and compiles away). That is why it exists. The Studio web service
 * builds its Copy text with this function rather than a second copy of it
 * (docs/CONTENT_STUDIO_DESIGN.md §8.2), and the web may reach no stage
 * executor, the stage-execution boundary or the fact loader (CS10). CS10 allows
 * the web to reach exactly this module beyond its own tree and the S2 runner,
 * and CS10a fails if it ever gains a runtime import.
 */

import type { GbpActionType } from "../../mcp/posting-tool/index.js";

/** The separator before contact text. Its length is `CONTACT_LINE_SEPARATOR_CHARS`. */
export const CONTACT_LINE_SEPARATOR = "\n\n";

/** The one action a structured Google Business Profile call to action carries here. */
export const GBP_CONTACT_ACTION_TYPE = "BOOK" satisfies GbpActionType;

/** A structured Google Business Profile call to action. */
export interface ContactCta {
  actionType: typeof GBP_CONTACT_ACTION_TYPE;
  url: string;
}

/**
 * The deterministic contact line one package carries.
 *
 * `text` is the provider-visible contact line, or `null` where the platform
 * carries none (Google Business Profile). `gbpCta` is present only on Google
 * Business Profile. `sourceFactIds` are exactly the records used.
 */
export interface ContactLine {
  readonly kind: "deterministic_contact";
  text: string | null;
  gbpCta?: ContactCta;
  sourceFactIds: string[];
}

/**
 * The provider-visible text a package proposes: caption, then the canonical
 * tags after a blank line. Exported so the local run's field measurement
 * reports the same length this validator compares, not a second formula.
 */
export function proposedProviderText(caption: string, hashtags: string[]): string {
  return hashtags.length ? `${caption}\n\n${hashtags.join(" ")}` : caption;
}

/**
 * The full provider-visible text a package would carry: caption, separator,
 * canonical hashtags, then separator and contact text. What the platform limit
 * is measured against.
 */
export function providerTextWithContact(caption: string, hashtags: string[], contact: ContactLine): string {
  const base = proposedProviderText(caption, hashtags);
  return contact.text === null ? base : `${base}${CONTACT_LINE_SEPARATOR}${contact.text}`;
}
