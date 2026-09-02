/**
 * The content evidence contract — Phase 0B.0.
 *
 * The governing rule of this repository is that research gives us the prior and
 * GCD empirical performance becomes the posterior. That only holds if the two
 * can never be confused, so epistemic class is a first-class property of every
 * record rather than a convention observed by prose.
 *
 * Two promotions are forbidden by construction, because both are ways a system
 * like this quietly starts lying:
 *
 *  - a model-authored hypothesis must never become a verified fact;
 *  - a measured performance correlation must never become automotive truth or
 *    a causal claim.
 *
 * Nothing here reaches an agent as undifferentiated text. The class travels
 * with the claim, and the pack builder groups by class so a reasoning stage is
 * told what kind of thing it is holding.
 */

/**
 * Evidence kinds.
 *
 * The roadmap names seven. `verified_business_fact` is an eighth, added
 * deliberately: `config/approved-facts.json` is almost entirely GCD business
 * identity and policy — address, hours, warranty terms, makes serviced — which
 * is verified and citable but is emphatically NOT an automotive fact. Importing
 * "German Car Depot is at 2130 Fillmore Street" as a `verified_automotive_fact`
 * would break the exact semantic separation this contract exists to enforce.
 * The seven roadmap kinds are unchanged and none was renamed.
 */
export const EVIDENCE_KINDS = [
  "verified_automotive_fact",
  "verified_business_fact",
  "sourced_research",
  "gcd_direct_observation",
  "gcd_performance_evidence",
  "creative_hypothesis",
  "causal_hypothesis",
  "unsupported_assumption",
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** Lifecycle. Superseded and retired rows stay readable; history is never destroyed. */
export const EVIDENCE_LIFECYCLE_STATES = ["draft", "active", "superseded", "retired", "rejected"] as const;
export type EvidenceLifecycleState = (typeof EVIDENCE_LIFECYCLE_STATES)[number];

/** How a claim came to be known. `model_inference` can never back a verified kind. */
export const EVIDENCE_SOURCE_TYPES = [
  "repository_config",
  "manufacturer_documentation",
  "industry_publication",
  "regulatory_or_standards_body",
  "gcd_shop_record",
  "gcd_staff_observation",
  "platform_analytics",
  "model_inference",
  "unattributed",
] as const;
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

export const EVIDENCE_RELATION_KINDS = ["supports", "conflicts_with", "supersedes"] as const;
export type EvidenceRelationKind = (typeof EVIDENCE_RELATION_KINDS)[number];

export interface EvidenceRecord {
  /** Stable, caller-supplied, unique. Deterministic for adapted sources. */
  id: string;
  kind: EvidenceKind;
  /** The assertion itself, in plain language. */
  claim: string;
  /** What the claim is about — a make, a service, a channel, the shop. */
  subject: string;
  /**
   * The specific attribute of the subject being asserted, when there is one.
   *
   * This is what makes conflict detection meaningful. "warranty" and "phone"
   * are both claims about German Car Depot and do not disagree; two different
   * claims about the subject's *warranty* do. Without an attribute, a record
   * can only conflict through an explicitly declared relation.
   */
  attribute?: string;
  tags: string[];
  sourceType: EvidenceSourceType;
  /** Human-checkable reference: a file path, document title, URL, or record id. */
  sourceRef?: string;
  /** How this record came to exist, including any transformation applied. */
  provenance?: string;
  /** 0–1. Absent means "not assessed", which is not the same as zero. */
  confidence?: number;
  /** When the underlying thing was observed or measured. */
  observedAt?: string;
  /** When a human last reviewed the claim itself. */
  reviewedAt?: string;
  reviewedBy?: string;
  /** Review-by date. Past means stale, not false. */
  reviewBy?: string;
  /** Hard expiry. Past means unusable. */
  expiresAt?: string;
  createdAt: string;
  lifecycle: EvidenceLifecycleState;
  /** Set on a superseded record, pointing at the record that replaced it. */
  supersededById?: string;
  /**
   * Only meaningful for `gcd_direct_observation`. Always false: an observation
   * is a report of one thing seen, never a universal automotive rule. Promoting
   * it requires authoring a separate verified_automotive_fact with its own
   * source, which is exactly the review step this flag protects.
   */
  generalizable?: boolean;
  /** Free-form structured detail. Never secrets, PII, or raw analytics dumps. */
  detail?: Record<string, unknown>;
}

export interface EvidenceRelation {
  fromId: string;
  toId: string;
  kind: EvidenceRelationKind;
  note?: string;
  createdAt: string;
}

/** Kinds a reasoning stage may cite as established fact. */
export const CITABLE_AS_FACT: ReadonlySet<EvidenceKind> = new Set<EvidenceKind>([
  "verified_automotive_fact",
  "verified_business_fact",
]);

/**
 * Kinds that must never be presented as established fact, whatever their
 * confidence. `gcd_performance_evidence` is here on purpose: "this post did
 * well" is a measurement, and measurement is not automotive truth and not a
 * cause.
 */
export const NEVER_CITABLE_AS_FACT: ReadonlySet<EvidenceKind> = new Set<EvidenceKind>([
  "gcd_performance_evidence",
  "creative_hypothesis",
  "causal_hypothesis",
  "unsupported_assumption",
]);

/** Kinds whose usefulness decays, so an overdue review makes them unusable. */
export const FRESHNESS_REQUIRED: ReadonlySet<EvidenceKind> = new Set<EvidenceKind>([
  "verified_automotive_fact",
  "verified_business_fact",
  "sourced_research",
  "gcd_performance_evidence",
]);

/** Source types that can never underwrite a verified kind. */
const NON_VERIFYING_SOURCE_TYPES: ReadonlySet<EvidenceSourceType> = new Set<EvidenceSourceType>([
  "model_inference",
  "unattributed",
]);

export interface EvidenceValidationResult {
  ok: boolean;
  issues: string[];
}

import {
  EVIDENCE_LIMITS,
  isSerializableText,
  utf8ByteLength,
} from "../agents/payloadContract.js";

/**
 * Bounded, serializable text.
 *
 * Two rules, both new and both load-bearing downstream:
 *
 *  - **A maximum length.** Before this, `claim` and every other text field were
 *    bounded only by "non-empty", so every projection built from a record was
 *    structurally unbounded and no payload derived from one had a finite
 *    maximum. The limits live in `payloadContract.ts` beside the derivations
 *    that consume them, and `state/migrations/007_evidence_bounds.sql` states
 *    the same numbers as database constraints.
 *  - **A bounded character set.** `isSerializableText` refuses control
 *    characters and unpaired surrogates — the only things `JSON.stringify`
 *    expands sixfold. Excluding them is what lets every payload derivation use
 *    a factor of two instead of six.
 */
function boundedText(value: string, field: string, max: number, push: (issue: string) => void): void {
  if (value.length > max) push(`${field} exceeds ${max} characters`);
  if (utf8ByteLength(value) > max) push(`${field} exceeds ${max} UTF-8 bytes`);
  if (!isSerializableText(value)) {
    push(`${field} contains a control character or unpaired surrogate`);
  }
}

/**
 * Conservative UTF-8 byte ceiling for PostgreSQL's canonical `jsonb::text`.
 *
 * PostgreSQL inserts one ASCII space after every object colon and comma. It may
 * also expand any finite JavaScript number into ordinary decimal notation; 327
 * bytes covers the signed longest IEEE-754 value (`-5e-324`) in that
 * representation. The sign is load-bearing: PostgreSQL renders that value as
 * 327 bytes, one more than the unsigned form.
 * Object key order is irrelevant to length. The result can overestimate, but
 * never underestimates the canonical database representation.
 */
function normalizedJsonbTextUpperBoundBytes(value: unknown): number {
  if (value === null) return 4;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number") return 327;
  if (typeof value === "string") return utf8ByteLength(JSON.stringify(value));
  if (Array.isArray(value)) {
    return 2 + value.reduce((total, entry) => total + normalizedJsonbTextUpperBoundBytes(entry), 0)
      + Math.max(0, value.length - 1) * 2;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return 2 + entries.reduce((total, [key, entry]) =>
    total + utf8ByteLength(JSON.stringify(key)) + 2 + normalizedJsonbTextUpperBoundBytes(entry), 0)
    + Math.max(0, entries.length - 1) * 2;
}

function jsonbStringsAreCompatible(value: unknown): boolean {
  if (typeof value === "string") return isSerializableText(value);
  if (Array.isArray(value)) return value.every(jsonbStringsAreCompatible);
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .every(([key, entry]) => isSerializableText(key) && jsonbStringsAreCompatible(entry));
  }
  return true;
}

/** Undefined means the value cannot be represented as JSON. */
export function postgresJsonbTextUpperBoundBytes(value: unknown): number | undefined {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return undefined;
    const normalized = JSON.parse(serialized) as unknown;
    if (!jsonbStringsAreCompatible(normalized)) return undefined;
    return normalizedJsonbTextUpperBoundBytes(normalized);
  } catch {
    return undefined;
  }
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function isInstant(value: unknown): value is string {
  return typeof value === "string" && ISO_INSTANT.test(value) && Number.isFinite(Date.parse(value));
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Per-kind validation.
 *
 * Rules differ by kind on purpose. Demanding `observedAt` from a creative
 * hypothesis would force a meaningless timestamp and teach authors that the
 * metadata is decorative; demanding a real source from a verified fact is the
 * entire point of calling it verified.
 */
export function validateEvidenceRecord(record: EvidenceRecord): EvidenceValidationResult {
  const issues: string[] = [];
  const push = (issue: string) => issues.push(issue);

  if (!nonEmpty(record.id)) push("id is required");
  else boundedText(record.id, "id", EVIDENCE_LIMITS.idChars, push);
  if (!EVIDENCE_KINDS.includes(record.kind)) push(`unknown evidence kind: ${String(record.kind)}`);
  if (!nonEmpty(record.claim)) push("claim is required");
  else boundedText(record.claim, "claim", EVIDENCE_LIMITS.claimChars, push);
  if (!nonEmpty(record.subject)) push("subject is required");
  else boundedText(record.subject, "subject", EVIDENCE_LIMITS.subjectChars, push);
  if (record.attribute !== undefined) {
    boundedText(record.attribute, "attribute", EVIDENCE_LIMITS.attributeChars, push);
  }
  if (!Array.isArray(record.tags) || record.tags.some((t) => typeof t !== "string")) push("tags must be an array of strings");
  else {
    if (record.tags.length > EVIDENCE_LIMITS.maxTags) {
      push(`tags exceeds ${EVIDENCE_LIMITS.maxTags} entries`);
    }
    record.tags.forEach((tag, index) => boundedText(tag, `tags[${index}]`, EVIDENCE_LIMITS.tagChars, push));
  }
  for (const [field, value, max] of [
    ["sourceRef", record.sourceRef, EVIDENCE_LIMITS.sourceRefChars],
    ["provenance", record.provenance, EVIDENCE_LIMITS.provenanceChars],
    ["reviewedBy", record.reviewedBy, EVIDENCE_LIMITS.reviewedByChars],
    ["supersededById", record.supersededById, EVIDENCE_LIMITS.idChars],
  ] as const) {
    if (value !== undefined) boundedText(value, field, max, push);
  }
  if (record.detail !== undefined) {
    if (record.detail === null || typeof record.detail !== "object" || Array.isArray(record.detail)) {
      push("detail must be an object when present");
    } else {
      const canonicalUpperBound = postgresJsonbTextUpperBoundBytes(record.detail);
      if (canonicalUpperBound === undefined) push("detail must be JSON-serializable");
      else if (canonicalUpperBound > EVIDENCE_LIMITS.detailSerializedChars) {
        push(`detail exceeds ${EVIDENCE_LIMITS.detailSerializedChars} UTF-8 bytes in PostgreSQL jsonb text`);
      }
    }
  }
  if (!EVIDENCE_SOURCE_TYPES.includes(record.sourceType)) push(`unknown source type: ${String(record.sourceType)}`);
  if (!EVIDENCE_LIFECYCLE_STATES.includes(record.lifecycle)) push(`unknown lifecycle state: ${String(record.lifecycle)}`);
  if (!isInstant(record.createdAt)) push("createdAt must be an ISO instant");

  for (const [field, value] of [
    ["observedAt", record.observedAt],
    ["reviewedAt", record.reviewedAt],
    ["reviewBy", record.reviewBy],
    ["expiresAt", record.expiresAt],
  ] as const) {
    if (value !== undefined && !isInstant(value)) push(`${field} must be an ISO instant when present`);
  }

  if (record.confidence !== undefined) {
    if (typeof record.confidence !== "number" || !Number.isFinite(record.confidence)
      || record.confidence < 0 || record.confidence > 1) {
      push("confidence must be a number in [0, 1] when present");
    }
  }

  if (record.lifecycle === "superseded" && !nonEmpty(record.supersededById)) {
    push("superseded evidence must name the record that superseded it");
  }
  if (record.lifecycle !== "superseded" && nonEmpty(record.supersededById)) {
    push("supersededById is only valid on superseded evidence");
  }
  if (record.supersededById && record.supersededById === record.id) {
    push("evidence cannot supersede itself");
  }

  switch (record.kind) {
    // A verified fact is only verified if a human can go and check it.
    case "verified_automotive_fact":
    case "verified_business_fact": {
      if (!nonEmpty(record.sourceRef)) push(`${record.kind} requires a checkable sourceRef`);
      if (!nonEmpty(record.provenance)) push(`${record.kind} requires provenance`);
      if (!isInstant(record.reviewedAt)) push(`${record.kind} requires reviewedAt`);
      if (NON_VERIFYING_SOURCE_TYPES.has(record.sourceType)) {
        push(`${record.kind} cannot be sourced from ${record.sourceType}`);
      }
      break;
    }
    // Research keeps its external identity; without it, it is just an assertion.
    case "sourced_research": {
      if (!nonEmpty(record.sourceRef)) push("sourced_research requires an external sourceRef");
      if (record.sourceType === "unattributed") push("sourced_research cannot be unattributed");
      if (!isInstant(record.observedAt) && !isInstant(record.reviewedAt)) {
        push("sourced_research requires observedAt or reviewedAt so freshness is assessable");
      }
      break;
    }
    // Something GCD actually saw. True as a report; not a universal rule.
    case "gcd_direct_observation": {
      if (!isInstant(record.observedAt)) push("gcd_direct_observation requires observedAt");
      if (!nonEmpty(record.provenance)) push("gcd_direct_observation requires provenance naming who observed it");
      if (record.generalizable === true) {
        push("gcd_direct_observation cannot be marked generalizable; author a verified_automotive_fact instead");
      }
      break;
    }
    // A measurement of content or business performance. Never a cause.
    case "gcd_performance_evidence": {
      if (!isInstant(record.observedAt)) push("gcd_performance_evidence requires observedAt");
      if (record.sourceType !== "platform_analytics" && record.sourceType !== "gcd_shop_record") {
        push("gcd_performance_evidence must come from platform analytics or a GCD shop record");
      }
      if (record.generalizable === true) {
        push("gcd_performance_evidence cannot be marked generalizable");
      }
      break;
    }
    // Speculative by definition. No source is required; claiming one is the error.
    case "creative_hypothesis": {
      if (!NON_VERIFYING_SOURCE_TYPES.has(record.sourceType) && !nonEmpty(record.provenance)) {
        push("creative_hypothesis with an attributed source type requires provenance explaining the attribution");
      }
      break;
    }
    // An inference. It may cite what it reasons from, but it remains a guess.
    case "causal_hypothesis": {
      if (record.confidence !== undefined && record.confidence >= 1) {
        push("causal_hypothesis cannot claim certainty");
      }
      break;
    }
    // Recorded so it is visible and excluded, not so it can be used.
    case "unsupported_assumption": {
      if (record.confidence !== undefined && record.confidence > 0.5) {
        push("unsupported_assumption cannot carry confidence above 0.5");
      }
      break;
    }
  }

  return { ok: issues.length === 0, issues };
}

/** Throwing form, for call sites where invalid evidence is a programming error. */
export class EvidenceValidationError extends Error {
  readonly issues: string[];
  constructor(id: string, issues: string[]) {
    super(`invalid evidence ${id}: ${issues.join("; ")}`);
    this.name = "EvidenceValidationError";
    this.issues = issues;
  }
}

export function assertValidEvidenceRecord(record: EvidenceRecord): EvidenceRecord {
  const { ok, issues } = validateEvidenceRecord(record);
  if (!ok) throw new EvidenceValidationError(record.id, issues);
  return record;
}

/** Validate the relation contract before either consumption or persistence. */
export function validateEvidenceRelation(relation: EvidenceRelation): EvidenceValidationResult {
  const issues: string[] = [];
  const push = (issue: string) => issues.push(issue);
  if (!nonEmpty(relation.fromId)) push("fromId is required");
  else boundedText(relation.fromId, "fromId", EVIDENCE_LIMITS.idChars, push);
  if (!nonEmpty(relation.toId)) push("toId is required");
  else boundedText(relation.toId, "toId", EVIDENCE_LIMITS.idChars, push);
  if (relation.fromId === relation.toId) push("evidence relation cannot refer to itself");
  if (!EVIDENCE_RELATION_KINDS.includes(relation.kind)) {
    push(`unknown evidence relation kind: ${String(relation.kind)}`);
  }
  if (relation.note !== undefined) {
    boundedText(relation.note, "note", EVIDENCE_LIMITS.relationNoteChars, push);
  }
  if (!isInstant(relation.createdAt)) push("createdAt must be an ISO instant");
  return { ok: issues.length === 0, issues };
}

export function assertValidEvidenceRelation(relation: EvidenceRelation): EvidenceRelation {
  const { ok, issues } = validateEvidenceRelation(relation);
  if (!ok) throw new EvidenceValidationError(`${relation.fromId}->${relation.toId}`, issues);
  return relation;
}

/** True when review or expiry has lapsed for a kind whose freshness matters. */
export function isStale(record: EvidenceRecord, now: number): boolean {
  if (record.expiresAt && Date.parse(record.expiresAt) <= now) return true;
  if (!FRESHNESS_REQUIRED.has(record.kind)) return false;
  if (record.reviewBy && Date.parse(record.reviewBy) <= now) return true;
  return false;
}

/** Only active, fresh, fact-class evidence may be cited as established fact. */
export function isCitableAsFact(record: EvidenceRecord, now: number): boolean {
  if (NEVER_CITABLE_AS_FACT.has(record.kind)) return false;
  if (!CITABLE_AS_FACT.has(record.kind)) return false;
  if (record.lifecycle !== "active") return false;
  return !isStale(record, now);
}
