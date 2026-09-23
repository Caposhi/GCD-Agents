/**
 * The deterministic contact line — attached to every stage 5 package by code,
 * after stage 5 validates and before the critic. **No model writes or edits any
 * part of it.**
 *
 * ## Why this exists
 *
 * In both six-stage runs of 2026-09-23, stage 1 planned a "book online or call"
 * close but spent all twelve of its citation slots on other facts and never cited
 * the phone record or the booking-link record. Stage 3 then wrote "Book online or
 * give us a call" with no citation, the critic correctly flagged it as an uncited
 * implication, and stage 5 correctly dropped it — so every caption shipped with
 * no way to book. The owner decided on 2026-09-23 to keep
 * `STRATEGY_LIMITS.maxIds` at 12 and to attach contact details by code:
 *
 *  - contact details must match the approved data exactly — `skills/local-seo`
 *    calls this "NAP consistency" — which a model paraphrasing a record cannot
 *    guarantee; and
 *  - they should not compete with the claims a piece is actually about for the
 *    citation slots every stage is bounded to.
 *
 * ## What it guarantees
 *
 *  - **Byte-exact values.** The shop name, the phone number and the booking
 *    link are copied out of the evidence pack's own `approved-facts:shop`,
 *    `approved-facts:phone` and `approved-facts:bookingurl` records — the
 *    substring after the record's `"<field>: "` prefix, which the approved-facts
 *    adapter writes from the checked-in file — and never retyped, reformatted,
 *    or normalized. No part of any line is typed into this module: the shop
 *    name used to be, and now comes from the `shop` record on the same terms as
 *    the phone number.
 *  - **Exact provenance.** `sourceFactIds` lists exactly the records a line
 *    used, in the order the template uses them.
 *  - **Fail closed, for free.** A needed record that is absent, not a verified
 *    business fact, or not usable in the pack (conflicted, stale, inactive) is a
 *    `ContactLineError` before any paid call. So is a value that does not read
 *    back cleanly, a booking link that is not plain HTTPS, and a line longer than
 *    its platform's reserve.
 *  - **It fits.** Contact text plus its separator stays inside
 *    `CONTACT_LINE_RESERVE_CHARS`, counted in characters and again in UTF-8
 *    bytes, and stage 5's validator holds the caption to
 *    the platform limit less that reserve, so caption + separator + hashtags +
 *    separator + contact text stays within each platform's existing limit.
 *    Attaching re-checks that sum on every package anyway.
 *
 * ## Templates — reviewed by the owner on 2026-09-23, used verbatim
 *
 *  - `instagram` — `Call {shop}: {phone}`
 *  - `facebook` — `Call {shop}: {phone} · Book online: {bookingUrl}`
 *  - `google_business_profile` — no text; a structured call to action
 *    `{ actionType: "BOOK", url: {bookingUrl} }`, mirroring the rule
 *    `ctaForGbp` in `packageMap.ts` applies to the live path: the canonical
 *    booking destination always means `BOOK`. That module is read, not changed.
 *
 * With today's `config/approved-facts.json`, `{shop}` is "German Car Depot", so
 * the rendered lines read exactly as the owner reviewed them.
 *
 * ## What it is not
 *
 * Contact text is **not caption prose**. It sits outside the caption, so stage
 * 5's recognizable-URL ban keeps applying to model prose only, and the Facebook
 * line legitimately carries the booking link. The contact line adds no
 * publication, scheduling, provider, or approval surface: the package it rides
 * on is still provisional, unverified, non-publishable and non-executable, and
 * nothing here builds a provider payload.
 */

import type { EvidenceRecord } from "../evidence/contract.js";
import type { EvidencePack } from "../evidence/pack.js";
import type { GbpActionType } from "../../mcp/posting-tool/index.js";
import type { AgentStageId } from "./registry.js";
import type { AutomotiveTruthOutput } from "./automotiveTruth.js";
import type { HookStoryScriptOutput } from "./hookStoryScript.js";
import {
  PACKAGING_PLATFORMS,
  PLATFORM_PACKAGING_POLICY,
  PACKAGING_LIMITS,
  type PackagingAdaptationOutput,
  type PackagingClaimUse,
  type PackagingPlatform,
  type ProvisionalPackaging,
  type ProvisionalPlatformPackage,
  contactReserveChars,
  proposedProviderText,
  revalidatePackagingAdaptationOutput,
} from "./packagingAdaptation.js";
import { StageExecutionError } from "./stageExecution.js";
import {
  CONTACT_CTA_URL_CHARS,
  CONTACT_LINE_SEPARATOR_CHARS,
  CONTACT_TEXT_MAX_CHARS,
  isBoundedSerializableText,
  utf8ByteLength,
} from "./payloadContract.js";

/** The approved-facts records a contact line may be built from, and nothing else. */
export const CONTACT_FACTS = {
  shop: { id: "approved-facts:shop", field: "shop" },
  phone: { id: "approved-facts:phone", field: "phone" },
  bookingUrl: { id: "approved-facts:bookingurl", field: "bookingUrl" },
} as const;
export type ContactFactKey = keyof typeof CONTACT_FACTS;

/** The separator before contact text. Its length is `CONTACT_LINE_SEPARATOR_CHARS`. */
export const CONTACT_LINE_SEPARATOR = "\n\n";

/** The one action a structured Google Business Profile call to action carries here. */
export const GBP_CONTACT_ACTION_TYPE = "BOOK" satisfies GbpActionType;

/** Which records each platform's line needs, in the order they are cited. */
export const CONTACT_FACTS_BY_PLATFORM: Record<PackagingPlatform, readonly ContactFactKey[]> = {
  instagram: ["shop", "phone"],
  facebook: ["shop", "phone", "bookingUrl"],
  google_business_profile: ["bookingUrl"],
};

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

/** A stage 5 package with its contact line attached. */
export interface ContactedPlatformPackage extends ProvisionalPlatformPackage {
  contact: ContactLine;
}

/**
 * Stage 5's output with a contact line on every package — the shape the critic
 * receives as `PACKAGING_OUTPUT`. Every stage 5 field is unchanged.
 */
export interface ContactedPackagingOutput {
  provisional: Omit<ProvisionalPackaging, "packages"> & { packages: ContactedPlatformPackage[] };
  claimUse: PackagingClaimUse;
}

/** Raised by this module. Always before any model call. */
export class ContactLineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContactLineError";
  }
}

const fail = (message: string): never => {
  throw new ContactLineError(message);
};

/**
 * Read one contact value out of the pack, byte for byte.
 *
 * The record must be a usable (`allowedFacts`) verified business fact with the
 * expected id and attribute, and its claim must read `"<field>: <value>"` — the
 * form the approved-facts adapter writes. The value is the exact substring after
 * that prefix. Nothing is trimmed, reformatted or normalized; a value that would
 * need it is refused instead.
 */
export function readContactValue(pack: EvidencePack, key: ContactFactKey): { value: string; record: EvidenceRecord } {
  const { id, field } = CONTACT_FACTS[key];
  const record = (pack?.allowedFacts ?? []).find((r) => r.id === id);
  if (!record) {
    fail(
      `the evidence pack has no usable "${id}" record, which the contact line needs; `
      + "refusing before any paid call rather than publishing a package with no way to reach the shop "
      + "(the record is absent, or it is conflicted, stale or inactive)",
    );
  }
  if (record!.kind !== "verified_business_fact") {
    fail(`"${id}" is a ${record!.kind}, not a verified_business_fact`);
  }
  if (record!.attribute !== field) {
    fail(`"${id}" carries attribute ${JSON.stringify(record!.attribute)}, not "${field}"`);
  }
  const prefix = `${field}: `;
  if (!record!.claim.startsWith(prefix)) {
    fail(`"${id}" claim does not read "${prefix}<value>", so its value cannot be copied byte for byte`);
  }
  const value = record!.claim.slice(prefix.length);
  if (!value || value !== value.trim() || /[\r\n]/.test(value)) {
    fail(`"${id}" value is empty or not a single clean line`);
  }
  if (key === "bookingUrl" && !/^https:\/\/\S+$/.test(value)) {
    fail(`"${id}" value is not a plain HTTPS link`);
  }
  return { value, record: record! };
}

/** The records `platforms` need, deduplicated, in first-use order. */
export function contactFactsRequired(platforms: readonly PackagingPlatform[]): ContactFactKey[] {
  const keys: ContactFactKey[] = [];
  for (const platform of platforms) {
    for (const key of CONTACT_FACTS_BY_PLATFORM[platform] ?? []) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

/**
 * The free preflight: every record the requested platforms' contact lines need
 * is present and usable, and every line fits its reserve.
 *
 * The local run calls this right after it builds the evidence pack, before the
 * cost gate and before stage 1 — so a missing phone record costs nothing.
 */
export function assertContactFactsAvailable(pack: EvidencePack, platforms: readonly PackagingPlatform[]): void {
  for (const key of contactFactsRequired(platforms)) readContactValue(pack, key);
  for (const platform of platforms) buildContactLine(platform, pack);
}

/**
 * Build `platform`'s contact line from the pack, using the owner-reviewed
 * templates verbatim.
 */
export function buildContactLine(platform: PackagingPlatform, pack: EvidencePack): ContactLine {
  if (!(PACKAGING_PLATFORMS as readonly string[]).includes(platform)) {
    fail(`no contact line is defined for platform ${JSON.stringify(platform)}`);
  }
  const keys = CONTACT_FACTS_BY_PLATFORM[platform];
  const values = Object.fromEntries(keys.map((key) => [key, readContactValue(pack, key).value])) as
    Partial<Record<ContactFactKey, string>>;
  const sourceFactIds = keys.map((key) => CONTACT_FACTS[key].id);

  let line: ContactLine;
  switch (platform) {
    case "instagram":
      line = { kind: "deterministic_contact", text: `Call ${values.shop}: ${values.phone}`, sourceFactIds };
      break;
    case "facebook":
      line = {
        kind: "deterministic_contact",
        text: `Call ${values.shop}: ${values.phone} · Book online: ${values.bookingUrl}`,
        sourceFactIds,
      };
      break;
    case "google_business_profile":
      line = {
        kind: "deterministic_contact",
        text: null,
        gbpCta: { actionType: GBP_CONTACT_ACTION_TYPE, url: values.bookingUrl! },
        sourceFactIds,
      };
      break;
    default:
      return fail(`no contact line is defined for platform ${JSON.stringify(platform)}`);
  }

  const reserve = contactReserveChars(platform);
  if (line.text !== null) {
    // The platform limit counts characters, so the reserve does too.
    const needed = CONTACT_LINE_SEPARATOR_CHARS + line.text.length;
    if (needed > reserve) {
      fail(
        `the ${platform} contact line needs ${needed} characters with its separator, more than the `
        + `${reserve}-character contact-line reserve CONTACT_LINE_RESERVE_CHARS.${platform}; `
        + "raise the reserve under review rather than trimming a value copied from approved facts",
      );
    }
    // The payload derivation counts UTF-8 bytes as well as characters, so the
    // reserve bounds both. The Facebook template's "·" is two bytes, so there
    // bytes run one ahead of characters.
    const neededBytes = CONTACT_LINE_SEPARATOR_CHARS + utf8ByteLength(line.text);
    if (neededBytes > reserve || !isBoundedSerializableText(line.text, CONTACT_TEXT_MAX_CHARS)) {
      fail(
        `the ${platform} contact line needs ${neededBytes} UTF-8 bytes with its separator, more than `
        + `the ${reserve}-character contact-line reserve CONTACT_LINE_RESERVE_CHARS.${platform}, which `
        + "bounds bytes as well as characters (or it contains non-serializable text)",
      );
    }
  } else if (reserve !== 0) {
    fail(`${platform} carries no contact text but reserves ${reserve} characters for it`);
  }
  if (line.gbpCta && !isBoundedSerializableText(line.gbpCta.url, CONTACT_CTA_URL_CHARS)) {
    fail(`the ${platform} call-to-action link exceeds CONTACT_CTA_URL_CHARS (${CONTACT_CTA_URL_CHARS})`);
  }
  return line;
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

/**
 * Attach every package's contact line. Pure and deterministic: the same stage 5
 * output and the same pack always produce byte-identical results.
 *
 * The stage 5 output must already have validated. Every stage 5 field is copied
 * unchanged; only `contact` is added.
 */
export function attachContactLines(output: PackagingAdaptationOutput, pack: EvidencePack): ContactedPackagingOutput {
  const packages = output.provisional.packages.map((pkg): ContactedPlatformPackage => {
    const contact = buildContactLine(pkg.platform, pack);
    const platformMax = Math.min(
      PLATFORM_PACKAGING_POLICY[pkg.platform].captionMax, PACKAGING_LIMITS.pipelineCaptionChars,
    );
    const total = providerTextWithContact(pkg.caption, pkg.hashtags, contact).length;
    if (total > platformMax) {
      fail(
        `${pkg.platform} caption, hashtags and contact line total ${total} characters, over the `
        + `${platformMax}-character platform limit; the caption does not fit under the contact-line `
        + `reserve CONTACT_LINE_RESERVE_CHARS.${pkg.platform}`,
      );
    }
    return { ...pkg, contact };
  });
  return {
    provisional: { ...output.provisional, packages },
    claimUse: output.claimUse,
  };
}

/** Key-order-independent JSON, so a round-tripped contact line compares equal. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/**
 * Revalidate a supplied contacted packaging output, for a consumer one step down
 * the chain (the critic).
 *
 * Every package must carry a `contact`. The stage 5 part is revalidated through
 * stage 5's own revalidator — so the caption budget, reserve included, is
 * re-checked — and every contact line is then rebuilt from the pack and required
 * to be **identical** to the one supplied. A supplied line is never trusted: a
 * missing, edited or model-written contact is refused before any model call.
 */
export function revalidateContactedPackagingOutput(
  value: unknown,
  scriptOutput: HookStoryScriptOutput,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
  stage: AgentStageId,
  label = "packagingOutput",
): ContactedPackagingOutput {
  const failHere = (message: string): never => {
    throw new StageExecutionError(stage, message);
  };
  const provisional = (value as { provisional?: { packages?: unknown } } | null)?.provisional;
  if (!provisional || !Array.isArray(provisional.packages)) {
    failHere(`"${label}.provisional.packages" must be an array`);
  }
  const suppliedContacts: unknown[] = [];
  const strippedPackages = (provisional!.packages as unknown[]).map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return failHere(`"${label}.provisional.packages[${index}]" must be an object`);
    }
    const { contact, ...rest } = entry as Record<string, unknown>;
    if (!("contact" in (entry as Record<string, unknown>))) {
      failHere(
        `"${label}.provisional.packages[${index}]" carries no contact line: attach it with `
        + "attachContactLines(...) after stage 5 validates, so the critic always sees the same package shape",
      );
    }
    suppliedContacts.push(contact);
    return rest;
  });
  const stage5 = revalidatePackagingAdaptationOutput(
    { ...(value as Record<string, unknown>), provisional: { ...provisional, packages: strippedPackages } },
    scriptOutput, truthOutput, pack, stage, label,
  );
  let contacted: ContactedPackagingOutput;
  try {
    contacted = attachContactLines(stage5, pack);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failHere(`"${label}" contact lines cannot be derived: ${detail}`);
  }
  contacted.provisional.packages.forEach((pkg, index) => {
    if (canonicalJson(suppliedContacts[index]) !== canonicalJson(pkg.contact)) {
      failHere(
        `"${label}.provisional.packages[${index}].contact" is not the contact line derived from `
        + "the approved-facts records in this pack; contact details are attached by code, never edited",
      );
    }
  });
  return contacted;
}
