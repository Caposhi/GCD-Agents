/**
 * Deterministic adapter from `config/approved-facts.json` into evidence.
 *
 * That file is currently the ONLY source the copywriter may cite and the critic
 * checks against, and this adapter must not create a second, competing truth.
 * So it is exactly a projection: the JSON stays authoritative, and every record
 * produced here carries provenance naming the file and the content hash it came
 * from, so any drift is visible rather than silent.
 *
 * Two properties matter and are tested:
 *
 *  - **Deterministic.** The same file bytes always produce the same records,
 *    with the same ids, in the same order. Ids are derived from the field path,
 *    not from a counter or a clock, so re-running is a no-op rather than a
 *    duplicate set.
 *  - **Non-mutating.** Nothing here writes to a database. Import into durable
 *    storage is an explicit operator command, never an application startup
 *    side effect.
 *
 * Almost every entry is GCD business identity or policy, so the default kind is
 * `verified_business_fact`. Calling the shop's address an automotive fact would
 * defeat the separation the contract exists to enforce.
 */

import { createHash } from "node:crypto";

import { EvidenceRecord, assertValidEvidenceRecord } from "./contract.js";

export const APPROVED_FACTS_SOURCE_REF = "config/approved-facts.json";

/**
 * Fields deliberately not imported.
 *
 * `_note` is instruction-to-humans, not a claim. `currentPromos` is an
 * intentionally empty offer list whose emptiness is the fact; importing it as a
 * claim would invite a stage to invent one. Both stay in the JSON.
 */
const SKIPPED_FIELDS: ReadonlySet<string> = new Set(["_note", "currentPromos"]);

/**
 * Fields that read as automotive capability rather than business identity.
 * These still describe what GCD does, so they remain business facts — but they
 * are tagged so a later automotive-truth stage can find them without having to
 * guess from the claim text.
 */
const AUTOMOTIVE_TAGGED_FIELDS: ReadonlySet<string> = new Set([
  "makes",
  "services",
  "diagnostics",
  "parts",
]);

export interface ApprovedFactsAdaptationInput {
  facts: Record<string, unknown>;
  /** Content identity of the exact bytes adapted. */
  contentSha256: string;
  /** Review timestamp attributed to the checked-in file, supplied by the caller. */
  reviewedAt: string;
  reviewedBy?: string;
  /** Injected for determinism; used only for createdAt. */
  now: number;
}

/** Stable id from the field path. Same field, same id, run after run. */
export function approvedFactEvidenceId(field: string): string {
  const slug = field.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `approved-facts:${slug}`;
}

/** Canonical bytes → sha256, for provenance and idempotent sync. */
export function approvedFactsContentSha256(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function claimFor(field: string, value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? `${field}: ${trimmed}` : undefined;
  }
  if (typeof value === "number") return `${field}: ${value}`;
  if (Array.isArray(value)) {
    const items = value.filter((v) => typeof v === "string" && v.trim()).map((v) => String(v).trim());
    return items.length ? `${field}: ${items.join(", ")}` : undefined;
  }
  return undefined;
}

/**
 * Project the approved-facts object into evidence records.
 *
 * Pure: no filesystem, no database, no clock beyond the injected `now`.
 */
export function adaptApprovedFacts(input: ApprovedFactsAdaptationInput): EvidenceRecord[] {
  const { facts, contentSha256, reviewedAt, now } = input;
  if (!contentSha256) throw new Error("approved-facts adaptation requires the content sha256");
  if (!reviewedAt) throw new Error("approved-facts adaptation requires a reviewedAt");

  const createdAt = new Date(now).toISOString();
  const records: EvidenceRecord[] = [];

  // Sorted field order so output is byte-stable regardless of key order.
  for (const field of Object.keys(facts).sort()) {
    if (SKIPPED_FIELDS.has(field)) continue;
    const claim = claimFor(field, facts[field]);
    if (!claim) continue;

    const tags = ["approved-facts", "gcd"];
    if (AUTOMOTIVE_TAGGED_FIELDS.has(field)) tags.push("automotive-capability");

    records.push(assertValidEvidenceRecord({
      id: approvedFactEvidenceId(field),
      kind: "verified_business_fact",
      claim,
      subject: "german-car-depot",
      // The field name is the attribute, so two claims about the same field are
      // a real conflict while warranty-vs-phone is not.
      attribute: field,
      tags,
      sourceType: "repository_config",
      sourceRef: `${APPROVED_FACTS_SOURCE_REF}#${field}`,
      // Provenance carries the exact bytes this was derived from, so a changed
      // file is detectable without re-reading history.
      provenance: `adapted from ${APPROVED_FACTS_SOURCE_REF} at content sha256 ${contentSha256}`,
      confidence: 0.99,
      reviewedAt,
      reviewedBy: input.reviewedBy ?? "gcd-business-owner",
      createdAt,
      lifecycle: "active",
      detail: { field, contentSha256 },
    }));
  }

  return records;
}

/**
 * Parse and adapt in one step from raw file bytes.
 *
 * The hash is computed over the exact bytes, not over the reparsed object, so
 * whitespace-only edits still register as a new version.
 */
export function adaptApprovedFactsFile(
  raw: string,
  options: { reviewedAt: string; reviewedBy?: string; now: number },
): { contentSha256: string; records: EvidenceRecord[] } {
  const contentSha256 = approvedFactsContentSha256(raw);
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("approved-facts.json must contain a JSON object");
  }
  return {
    contentSha256,
    records: adaptApprovedFacts({
      facts: parsed,
      contentSha256,
      reviewedAt: options.reviewedAt,
      reviewedBy: options.reviewedBy,
      now: options.now,
    }),
  };
}
