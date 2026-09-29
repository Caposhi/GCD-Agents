/**
 * The deterministic contact-in-overlay check for stage 4's `overlayText[].text`.
 *
 * ## Why this exists
 *
 * Stage 4's prompt has said since PR #98 that overlay text never carries
 * contact details, because code attaches a fixed contact line to every stage 5
 * package (`contactLine.ts`), copied exactly from the approved facts. On
 * 2026-09-26 a stage 4 overlay typed the shop's phone number and "Book online"
 * anyway, and the critic did not flag it. The owner decided on 2026-09-29 that
 * the rule is enforced in code: `validateProductionDirectionOutput` calls
 * `overlayContactViolations` on every overlay and refuses the whole response
 * on any violation, and — because `revalidateProductionDirectionOutput` goes
 * through that validator — saved stage 4 outputs are refused too.
 *
 * ## What it detects — three categories, nothing else
 *
 * Every overlay is normalized first: Unicode NFKC, invisible format
 * characters removed, curly quotes made straight, whitespace collapsed to one
 * space, and lower case.
 *
 *  - **`phone`** — a North American-shaped number (optional `+1`, an area code
 *    with or without parentheses, then 3 and 4 digits, separated by a space, a
 *    dot, a dash or nothing), not part of a longer digit run; a 7-digit local
 *    number with a dot or dash separator (`921-1515`); and, when the pack holds
 *    a usable `approved-facts:phone` record, that number compared by its digits
 *    in any grouping. Counts, mileages, model years and year ranges
 *    (`5,000`, `6 months`, `12,000`, `2025`, `2019–2024`) do not match. A space
 *    does not separate the 7-digit local form, so a model number followed by a
 *    year (`C300 2021`) is not read as a phone number.
 *  - **`url`** — `http://` or `https://`; `www.`; a bare domain ending in one
 *    of `URL_TLDS`; an email address; and, when the pack holds a usable
 *    `approved-facts:bookingurl` record, that link's host.
 *  - **`call_to_action`** — one of the closed list `CALL_TO_ACTION_PHRASES`,
 *    matched as whole words. Bare "visit" and bare "call" are deliberately
 *    absent ("each shop visit", "the driver's call"), and the shop's name is
 *    branding, not contact, so it is never a violation.
 *
 * Curly-quote normalization changes no current match — no listed phrase
 * contains a quote — and is kept so a phrase added later behaves the same
 * whichever quote a model types.
 *
 * ## What it is not
 *
 * It is a narrow, closed rule, not a semantic check: an unlisted wording of a
 * call to action passes, and the critic remains the second line. It never
 * throws for a missing record — the approved values only add matches — and it
 * returns categories only: callers must never echo the overlay text or any
 * contact value, so neither can reach a log, an error or a saved failure.
 */

import type { EvidencePack } from "../evidence/pack.js";
import { readContactValue } from "./contactLine.js";

/** The categories this check reports, in the order it reports them. */
export const OVERLAY_CONTACT_CATEGORIES = ["phone", "url", "call_to_action"] as const;
export type OverlayContactCategory = (typeof OVERLAY_CONTACT_CATEGORIES)[number];

/**
 * The closed call-to-action list. Whole phrases, matched on word boundaries
 * after normalization. Documented in `docs/ROADMAP.md`; extending it is a
 * reviewed change with its own acceptance checks.
 */
export const CALL_TO_ACTION_PHRASES = [
  "book online",
  "book now",
  "book today",
  "book your",
  "schedule online",
  "schedule now",
  "call us",
  "call now",
  "call today",
  "give us a call",
  "contact us",
  "visit us",
  "visit our",
  "text us",
  "message us",
  "dm us",
  "link in bio",
] as const;

/** The top-level domains a bare domain is recognized by. */
export const URL_TLDS = ["com", "net", "org", "io", "app", "co", "us", "biz", "info"] as const;

/** A dash a model may type between digit groups: hyphen, the Unicode dashes, minus. */
const DASH = "\\-\\u2010-\\u2015\\u2212";
const SEP = `[\\s.${DASH}]`;

/** North American shape, not part of a longer digit run. */
const NORTH_AMERICAN_PHONE = new RegExp(
  `(?<!\\d)(?:\\+?1${SEP}?)?(?:\\(\\d{3}\\)|\\d{3})${SEP}?\\d{3}${SEP}?\\d{4}(?!\\d)`,
);
/** A 7-digit local number with a dot or dash separator. */
const LOCAL_PHONE = new RegExp(`(?<!\\d)\\d{3}[.${DASH}]\\d{4}(?!\\d)`);
/** A run of digits with the separators a phone number is written with. */
const DIGIT_RUN = new RegExp(`\\d(?:[\\d\\s().+${DASH}]*\\d)?`, "g");

const URL_SCHEME = /\bhttps?:\/\//;
const URL_WWW = /\bwww\./;
const URL_BARE_DOMAIN = new RegExp(
  `\\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\\.(?:${URL_TLDS.join("|")})\\b`,
);
const URL_EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CALL_TO_ACTION = CALL_TO_ACTION_PHRASES.map((phrase) =>
  new RegExp(`(?<![a-z0-9])${escapeRegExp(phrase)}(?![a-z0-9])`));

/** NFKC, invisible format characters removed, straight quotes, one space, lower case. */
export function normalizeOverlayText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, "\"")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** An approved contact value, or undefined when the record is absent or unusable. Never throws. */
function approvedValue(pack: EvidencePack, key: "phone" | "bookingUrl"): string | undefined {
  try {
    return readContactValue(pack, key).value;
  } catch {
    return undefined;
  }
}

function approvedPhoneLocalDigits(pack: EvidencePack): string | undefined {
  const phone = approvedValue(pack, "phone");
  const digits = phone?.replace(/\D/g, "") ?? "";
  // The last seven digits are the local number, in every North American grouping.
  return digits.length >= 7 ? digits.slice(-7) : undefined;
}

function approvedBookingHost(pack: EvidencePack): string | undefined {
  const link = approvedValue(pack, "bookingUrl");
  if (!link) return undefined;
  try {
    const host = new URL(link).hostname.toLowerCase();
    return host || undefined;
  } catch {
    return undefined;
  }
}

function hasPhone(text: string, pack: EvidencePack): boolean {
  if (NORTH_AMERICAN_PHONE.test(text)) return true;
  if (LOCAL_PHONE.test(text)) return true;
  const local = approvedPhoneLocalDigits(pack);
  if (local) {
    for (const run of text.match(DIGIT_RUN) ?? []) {
      if (run.replace(/\D/g, "").includes(local)) return true;
    }
  }
  return false;
}

function hasUrl(text: string, pack: EvidencePack): boolean {
  if (URL_SCHEME.test(text)) return true;
  if (URL_WWW.test(text)) return true;
  if (URL_BARE_DOMAIN.test(text)) return true;
  if (URL_EMAIL.test(text)) return true;
  const host = approvedBookingHost(pack);
  if (host && text.includes(host)) return true;
  return false;
}

function hasCallToAction(text: string): boolean {
  return CALL_TO_ACTION.some((pattern) => pattern.test(text));
}

/**
 * The contact-detail categories one overlay string carries, in
 * `OVERLAY_CONTACT_CATEGORIES` order; empty when it carries none. Pure: it
 * reads the pack's approved phone and booking records when present and never
 * throws when they are not.
 */
export function overlayContactViolations(text: string, pack: EvidencePack): OverlayContactCategory[] {
  const normalized = normalizeOverlayText(text);
  const categories: OverlayContactCategory[] = [];
  if (hasPhone(normalized, pack)) categories.push("phone");
  if (hasUrl(normalized, pack)) categories.push("url");
  if (hasCallToAction(normalized)) categories.push("call_to_action");
  return categories;
}
