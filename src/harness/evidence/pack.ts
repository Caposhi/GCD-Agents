/**
 * The evidence pack — what a reasoning stage is actually handed.
 *
 * Agents never receive a bag of sentences and get asked to work out what is
 * true. They receive claims already sorted by epistemic class, with conflicts
 * and stale material pulled out and named.
 *
 * Two deliberate refusals:
 *
 *  - A conflict between two active facts is REPORTED, never resolved. Picking
 *    the newer row, or the one with higher confidence, would manufacture a
 *    confident answer out of a genuine disagreement — which is precisely the
 *    failure mode that turns a content engine into a liar. A human resolves it
 *    by authoring an explicit supersession.
 *  - Stale fact-class evidence is excluded from allowedFacts and surfaced
 *    separately. Freshness fails closed.
 */

import {
  EVIDENCE_KINDS,
  EvidenceKind,
  EvidenceRecord,
  EvidenceRelation,
  assertValidEvidenceRecord,
  assertValidEvidenceRelation,
  isCitableAsFact,
  isStale,
} from "./contract.js";
// `STRATEGY_LIMITS.goalChars` is the bound the `GOAL` block derivation already
// assumes for the pack's goal; taking it from the same authority is what keeps
// the derivation and this validator from drifting apart.
import { EVIDENCE_LIMITS, STRATEGY_LIMITS, isSerializableText } from "../agents/payloadContract.js";

export interface EvidenceConflict {
  /** Sorted pair, so the same disagreement always reports identically. */
  aId: string;
  bId: string;
  aClaim: string;
  bClaim: string;
  subject: string;
  /** `declared` came from a stored relation; `same_subject_fact` was inferred. */
  basis: "declared" | "same_attribute_fact";
  note?: string;
}

export interface EvidencePack {
  goal: string;
  builtAt: string;
  /** Citable as established fact: verified automotive + verified business. */
  allowedFacts: EvidenceRecord[];
  sourcedResearch: EvidenceRecord[];
  /** True as reports of what GCD saw; never universal automotive rules. */
  gcdObservations: EvidenceRecord[];
  /** Measurements only. Never automotive truth, never a cause. */
  performanceEvidence: EvidenceRecord[];
  creativeHypotheses: EvidenceRecord[];
  causalHypotheses: EvidenceRecord[];
  /** Surfaced, never auto-resolved. */
  conflicts: EvidenceConflict[];
  /** Fact-class evidence excluded for lapsed review or expiry. */
  staleEvidence: EvidenceRecord[];
  /** Recorded so they are visible and excluded — never usable. */
  unsupportedAssumptions: EvidenceRecord[];
  /** Superseded/retired/rejected/draft rows, kept auditable. */
  inactiveEvidence: EvidenceRecord[];
  counts: Record<string, number>;
}

export interface BuildEvidencePackInput {
  goal: string;
  records: EvidenceRecord[];
  relations?: EvidenceRelation[];
  /** Injected so packs are deterministic under test. */
  now: number;
  /** Optional subject/tag narrowing. Absent means "everything". */
  subjects?: string[];
  tags?: string[];
}

export class EvidencePackBoundsError extends Error {
  readonly violations: string[];
  constructor(violations: string[]) {
    super(`evidence pack exceeds projection contract: ${violations.join("; ")}`);
    this.name = "EvidencePackBoundsError";
    this.violations = violations;
  }
}

/** Stable ordering: subject, then kind, then id. Never insertion or clock order. */
function compareRecords(a: EvidenceRecord, b: EvidenceRecord): number {
  return a.subject.localeCompare(b.subject)
    || a.kind.localeCompare(b.kind)
    || a.id.localeCompare(b.id);
}

function matchesScope(record: EvidenceRecord, subjects?: string[], tags?: string[]): boolean {
  if (subjects && subjects.length && !subjects.includes(record.subject)) return false;
  if (tags && tags.length && !record.tags.some((t) => tags.includes(t))) return false;
  return true;
}

/**
 * Detect conflicts among ACTIVE evidence.
 *
 * Declared `conflicts_with` relations are authoritative. In addition, two
 * active fact-class records about the same subject with different claims are
 * treated as a conflict: a subject cannot have two contradictory established
 * truths, and silently serving both would let a stage pick whichever suited it.
 */
function detectConflicts(
  active: EvidenceRecord[],
  relations: EvidenceRelation[],
  now: number,
): EvidenceConflict[] {
  const byId = new Map(active.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const conflicts: EvidenceConflict[] = [];

  const add = (a: EvidenceRecord, b: EvidenceRecord, basis: EvidenceConflict["basis"], note?: string) => {
    const [first, second] = a.id < b.id ? [a, b] : [b, a];
    const key = `${first.id}|${second.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    conflicts.push({
      aId: first.id,
      bId: second.id,
      aClaim: first.claim,
      bClaim: second.claim,
      subject: first.subject,
      basis,
      note,
    });
  };

  for (const relation of relations) {
    if (relation.kind !== "conflicts_with") continue;
    const a = byId.get(relation.fromId);
    const b = byId.get(relation.toId);
    // A conflict with something already superseded is resolved history.
    if (a && b) add(a, b, "declared", relation.note);
  }

  // Keyed on subject AND attribute, not subject alone. Many facts share a
  // subject without disagreeing — the shop's warranty and its phone number are
  // both about the shop. A conflict is two different claims about the *same
  // attribute*. Records with no attribute can only conflict via a declared
  // relation, because nothing else establishes that they are even comparable.
  const factsByAttribute = new Map<string, EvidenceRecord[]>();
  for (const record of active) {
    if (!isCitableAsFact(record, now)) continue;
    if (!record.attribute) continue;
    const key = `${record.subject}\u0000${record.attribute}`;
    const list = factsByAttribute.get(key) ?? [];
    list.push(record);
    factsByAttribute.set(key, list);
  }
  for (const [, group] of factsByAttribute) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        if (a.claim.trim() === b.claim.trim()) continue;
        add(a, b, "same_attribute_fact", "two active fact-class claims about the same subject attribute");
      }
    }
  }

  return conflicts.sort((x, y) => x.aId.localeCompare(y.aId) || x.bId.localeCompare(y.bId));
}

export function buildEvidencePack(input: BuildEvidencePackInput): EvidencePack {
  const { goal, now } = input;
  if (typeof goal !== "string" || !goal.trim()) throw new Error("evidence pack requires a goal");

  // Validate every supplied record before scoping. An invalid record does not
  // become safe merely because the caller's subject/tag filter would omit it,
  // and aggregate rendered-block bounds cannot substitute for per-field
  // validation.
  for (const record of input.records) assertValidEvidenceRecord(record);
  const relations = input.relations ?? [];
  for (const relation of relations) assertValidEvidenceRelation(relation);
  const scoped = input.records
    .filter((r) => matchesScope(r, input.subjects, input.tags))
    .slice()
    .sort(compareRecords);
  if (scoped.length > EVIDENCE_LIMITS.maxProjectedRecords) {
    throw new EvidencePackBoundsError([
      `records ${scoped.length} exceeds ${EVIDENCE_LIMITS.maxProjectedRecords}`,
    ]);
  }

  const active = scoped.filter((r) => r.lifecycle === "active");
  const inactiveEvidence = scoped.filter((r) => r.lifecycle !== "active");

  const conflicts = detectConflicts(active, relations, now);
  // Anything in a live conflict is withheld from allowedFacts. A stage must not
  // be handed one side of a disagreement as though it were settled.
  const conflicted = new Set<string>();
  for (const c of conflicts) {
    conflicted.add(c.aId);
    conflicted.add(c.bId);
  }

  const allowedFacts: EvidenceRecord[] = [];
  const staleEvidence: EvidenceRecord[] = [];
  const sourcedResearch: EvidenceRecord[] = [];
  const gcdObservations: EvidenceRecord[] = [];
  const performanceEvidence: EvidenceRecord[] = [];
  const creativeHypotheses: EvidenceRecord[] = [];
  const causalHypotheses: EvidenceRecord[] = [];
  const unsupportedAssumptions: EvidenceRecord[] = [];

  for (const record of active) {
    const stale = isStale(record, now);
    switch (record.kind) {
      case "verified_automotive_fact":
      case "verified_business_fact":
        if (stale) staleEvidence.push(record);
        else if (!conflicted.has(record.id)) allowedFacts.push(record);
        break;
      case "sourced_research":
        if (stale) staleEvidence.push(record);
        else sourcedResearch.push(record);
        break;
      case "gcd_direct_observation":
        gcdObservations.push(record);
        break;
      case "gcd_performance_evidence":
        if (stale) staleEvidence.push(record);
        else performanceEvidence.push(record);
        break;
      case "creative_hypothesis":
        creativeHypotheses.push(record);
        break;
      case "causal_hypothesis":
        causalHypotheses.push(record);
        break;
      case "unsupported_assumption":
        unsupportedAssumptions.push(record);
        break;
    }
  }

  const pack: EvidencePack = {
    goal,
    builtAt: new Date(now).toISOString(),
    allowedFacts,
    sourcedResearch,
    gcdObservations,
    performanceEvidence,
    creativeHypotheses,
    causalHypotheses,
    conflicts,
    staleEvidence,
    unsupportedAssumptions,
    inactiveEvidence,
    counts: {},
  };
  pack.counts = {
    allowedFacts: allowedFacts.length,
    sourcedResearch: sourcedResearch.length,
    gcdObservations: gcdObservations.length,
    performanceEvidence: performanceEvidence.length,
    creativeHypotheses: creativeHypotheses.length,
    causalHypotheses: causalHypotheses.length,
    conflicts: conflicts.length,
    staleEvidence: staleEvidence.length,
    unsupportedAssumptions: unsupportedAssumptions.length,
    inactiveEvidence: inactiveEvidence.length,
  };
  return pack;
}

/**
 * Structural invariant check, asserted by the self-tests and cheap enough to
 * run wherever a pack crosses a boundary. If any of these ever fail, the class
 * separation has been broken and no downstream output can be trusted.
 */
export function evidencePackInvariants(pack: EvidencePack, now: number): string[] {
  const violations: string[] = evidencePackProjectionViolations(pack);
  for (const record of pack.allowedFacts) {
    if (!isCitableAsFact(record, now)) violations.push(`allowedFacts contains non-citable ${record.id} (${record.kind})`);
    if (record.kind === "unsupported_assumption") violations.push(`allowedFacts contains an unsupported assumption: ${record.id}`);
    if (record.kind === "gcd_performance_evidence") violations.push(`allowedFacts contains performance evidence: ${record.id}`);
    if (record.kind === "creative_hypothesis" || record.kind === "causal_hypothesis") {
      violations.push(`allowedFacts contains a hypothesis: ${record.id}`);
    }
  }
  for (const record of pack.gcdObservations) {
    if (record.generalizable === true) violations.push(`observation ${record.id} claims generalizability`);
  }
  return violations;
}

export type PackRecordSection = keyof Pick<EvidencePack,
  "allowedFacts" | "sourcedResearch" | "gcdObservations" | "performanceEvidence"
  | "creativeHypotheses" | "causalHypotheses" | "staleEvidence"
  | "unsupportedAssumptions" | "inactiveEvidence">;

const RECORD_SECTIONS: ReadonlyArray<PackRecordSection> = [
  "allowedFacts", "sourcedResearch", "gcdObservations", "performanceEvidence",
  "creativeHypotheses", "causalHypotheses", "staleEvidence",
  "unsupportedAssumptions", "inactiveEvidence",
];

/** Validate the two independent projection cardinalities without dropping data. */
export function evidencePackProjectionViolations(pack: EvidencePack): string[] {
  // Count projected entries, not unique ids. A hand-built pack that repeats one
  // id across sections still serializes each copy and must not evade the bound.
  const recordCount = RECORD_SECTIONS.reduce((total, section) => total + pack[section].length, 0);
  const violations: string[] = [];
  for (const section of RECORD_SECTIONS) {
    for (const record of pack[section]) {
      try {
        assertValidEvidenceRecord(record);
      } catch (error) {
        violations.push(`${section} contains invalid record ${record.id}: ${(error as Error).message}`);
      }
    }
  }
  if (recordCount > EVIDENCE_LIMITS.maxProjectedRecords) {
    violations.push(`records ${recordCount} exceeds ${EVIDENCE_LIMITS.maxProjectedRecords}`);
  }
  if (pack.conflicts.length > EVIDENCE_LIMITS.maxProjectedConflicts) {
    violations.push(`conflicts ${pack.conflicts.length} exceeds ${EVIDENCE_LIMITS.maxProjectedConflicts}`);
  }
  return violations;
}

export function assertEvidencePackProjectionBounds(pack: EvidencePack): EvidencePack {
  const violations = evidencePackProjectionViolations(pack);
  if (violations.length) throw new EvidencePackBoundsError(violations);
  return pack;
}

/**
 * Every id a reasoning stage may never cite as support, whatever section it
 * appeared in.
 *
 * Conflicted, stale, and inactive material is still *shown* to a stage — as a
 * named exclusion list — so the model can avoid it instead of inventing a
 * replacement for something it never knew existed. This set is what turns that
 * from advice into enforcement.
 *
 * It lives here, beside the pack, because it is a property of the pack rather
 * than of any one stage. Two stages sharing one definition cannot drift apart.
 */
export function unusableEvidenceIds(pack: EvidencePack): Set<string> {
  assertUsableEvidencePack(pack);
  const unusable = new Set<string>();
  for (const conflict of pack.conflicts) {
    unusable.add(conflict.aId);
    unusable.add(conflict.bId);
  }
  for (const record of pack.staleEvidence) unusable.add(record.id);
  for (const record of pack.inactiveEvidence) unusable.add(record.id);
  return unusable;
}

/**
 * The bounded projection of a pack that reasoning stages are shown.
 *
 * Only id, kind, claim, and — where it matters — attribute are sent. `kind` is
 * the evidence system's authoritative classification; stages must never infer
 * it from claim prose. Provenance, confidence numbers, reviewer identity, and
 * internal timestamps are withheld: a stage's job is to reason within what the
 * evidence system already decided, not to relitigate it, and a confidence score
 * in the prompt is an invitation to argue a disputed claim back into use.
 *
 * Conflicted, stale, and inactive material is included **as a named exclusion
 * list** rather than dropped silently.
 *
 * Shared by every stage on purpose. If a stage rendered its own view of the
 * pack, two stages could disagree about what the evidence says while both
 * claiming to have read it.
 */
export function renderEvidencePackForStage(pack: EvidencePack): string {
  assertUsableEvidencePack(pack);
  const brief = (records: EvidenceRecord[]) =>
    records.map((r) => ({
      id: r.id,
      kind: r.kind,
      claim: r.claim,
      ...(r.attribute ? { attribute: r.attribute } : {}),
    }));
  return JSON.stringify(
    {
      allowedFacts: brief(pack.allowedFacts),
      sourcedResearch: brief(pack.sourcedResearch),
      gcdObservations: brief(pack.gcdObservations),
      performanceEvidence: brief(pack.performanceEvidence),
      creativeHypotheses: brief(pack.creativeHypotheses),
      causalHypotheses: brief(pack.causalHypotheses),
      unusable: {
        conflicted: pack.conflicts.map((c) => ({ aId: c.aId, bId: c.bId, subject: c.subject })),
        stale: pack.staleEvidence.map((r) => r.id),
        inactive: pack.inactiveEvidence.map((r) => r.id),
        unsupportedAssumptions: pack.unsupportedAssumptions.map((r) => r.id),
      },
      counts: pack.counts,
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// The authoritative runtime pack validator
// ---------------------------------------------------------------------------

/**
 * Exactly which evidence kinds each record section may hold.
 *
 * This table is the machine-readable form of what `buildEvidencePack` does. A
 * pack that disagrees with it was not produced by the builder — it was hand
 * built, deserialized from somewhere, or mutated — and the difference is
 * exactly the promotion this pipeline exists to refuse: a hypothesis sitting in
 * `allowedFacts` is citable as established fact by every stage downstream.
 */
const SECTION_PERMITTED_KINDS: Record<PackRecordSection, ReadonlySet<EvidenceKind>> = {
  allowedFacts: new Set(["verified_automotive_fact", "verified_business_fact"]),
  sourcedResearch: new Set(["sourced_research"]),
  gcdObservations: new Set(["gcd_direct_observation"]),
  performanceEvidence: new Set(["gcd_performance_evidence"]),
  creativeHypotheses: new Set(["creative_hypothesis"]),
  causalHypotheses: new Set(["causal_hypothesis"]),
  // The builder routes any fact-class or freshness-bearing kind here once it
  // has lapsed. Observations and hypotheses never become stale, so they can
  // never legitimately appear.
  staleEvidence: new Set([
    "verified_automotive_fact", "verified_business_fact",
    "sourced_research", "gcd_performance_evidence",
  ]),
  unsupportedAssumptions: new Set(["unsupported_assumption"]),
  // Lifecycle, not kind, is what puts a record here.
  inactiveEvidence: new Set(EVIDENCE_KINDS),
};

/** Sections a stage may cite from. Everything else is shown only as exclusion. */
const USABLE_SECTIONS: ReadonlyArray<PackRecordSection> = [
  "allowedFacts", "sourcedResearch", "gcdObservations",
  "performanceEvidence", "creativeHypotheses", "causalHypotheses",
];

/** Every key `counts` must carry, and no others. */
const COUNT_KEYS: ReadonlyArray<string> = [
  ...RECORD_SECTIONS, "conflicts",
];

const CONFLICT_BASES: ReadonlySet<string> = new Set(["declared", "same_attribute_fact"]);

/**
 * A pack's freshness is evaluated **at its own `builtAt`**, never at the
 * moment a validator happens to run.
 *
 * The decision, and its cost, stated rather than left implicit. A pack is a
 * self-describing artifact: it records when it was assembled, and every section
 * must be exactly what `buildEvidencePack` would have produced at that instant.
 * Anchoring there makes this validator deterministic — the same pack is always
 * valid or always invalid, and a regression cannot pass or fail according to
 * the wall clock. Anchoring at invocation time instead would make validity a
 * property of *when you looked*, which is not something a deterministic
 * boundary can assert, and would make every fixture in the offline suite decay.
 *
 * **What that does not cover, said plainly:** a pack built before a fact's
 * `reviewBy` and consumed after it would still present that fact as citable.
 * Three things bound that gap. `builtAt` is itself validated as a real instant
 * (a malformed or non-round-tripping value is refused, so the anchor cannot be
 * forged into the future by accident). Every caller in this repository builds
 * the pack inside the same operation that consumes it — nothing persists,
 * caches, or replays a pack. And a caller that *does* hold a pack across time
 * can close the gap explicitly by passing `now`, which adds an
 * invocation-time freshness check on top of the internal-consistency one.
 */
export interface EvidencePackSemanticOptions {
  /**
   * Optional invocation-time clock. When supplied, `allowedFacts` must be fresh
   * at this instant as well as at `builtAt`. Callers that build and consume a
   * pack in one operation do not need it; a caller holding a pack across time
   * should pass it.
   */
  now?: number;
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  // Round-trip, so "2026-13-45" and "2026-08-27" (a date, not an instant) are
  // both refused rather than silently normalized into something else.
  return new Date(parsed).toISOString() === value;
}

/**
 * Every semantic rule a pack must satisfy before any consumer reads it.
 *
 * `evidencePackProjectionViolations` answers "is every value inside the
 * bounds the payload derivations assume?". This answers the question that one
 * cannot: "does this pack mean what its shape claims?" — that each record sits
 * in a section its kind and lifecycle permit, that nothing unusable is also
 * usable, that the conflict list refers to records that exist, and that the
 * counts are honest. Both run at every boundary; neither is sufficient alone.
 */
export function evidencePackSemanticViolations(
  pack: EvidencePack,
  options: EvidencePackSemanticOptions = {},
): string[] {
  const violations: string[] = [...evidencePackProjectionViolations(pack)];
  const push = (message: string) => violations.push(message);

  // --- the anchor itself ---------------------------------------------------
  if (!isIsoInstant(pack.builtAt)) {
    push(`builtAt is not an ISO-8601 instant: ${JSON.stringify(pack.builtAt)}`);
    // Without a usable anchor no freshness rule below can be evaluated
    // honestly, so stop rather than report a cascade of derived failures.
    return violations;
  }
  const builtAt = Date.parse(pack.builtAt);
  if (typeof pack.goal !== "string" || !pack.goal.trim()) {
    push("goal must be a non-empty string");
  } else if (!isSerializableText(pack.goal)) {
    push("goal contains a control character or unpaired surrogate");
  } else if (pack.goal.length > STRATEGY_LIMITS.goalChars) {
    push(`goal exceeds ${STRATEGY_LIMITS.goalChars} characters`);
  }

  // --- section membership, and one home per record -------------------------
  const sectionById = new Map<string, PackRecordSection>();
  for (const section of RECORD_SECTIONS) {
    for (const record of pack[section]) {
      const permitted = SECTION_PERMITTED_KINDS[section];
      if (!permitted.has(record.kind)) {
        push(`${section} contains ${record.id}, whose kind ${record.kind} does not belong there`);
      }
      const existing = sectionById.get(record.id);
      if (existing !== undefined) {
        push(`${record.id} appears in both ${existing} and ${section}; a record has exactly one section`);
      } else {
        sectionById.set(record.id, section);
      }

      // Lifecycle is what separates inactiveEvidence from everything else.
      if (section === "inactiveEvidence") {
        if (record.lifecycle === "active") {
          push(`inactiveEvidence contains active record ${record.id}`);
        }
      } else if (record.lifecycle !== "active") {
        push(`${section} contains ${record.lifecycle} record ${record.id}`);
      }
    }
  }

  // --- freshness, anchored at builtAt --------------------------------------
  for (const record of pack.allowedFacts) {
    if (!isCitableAsFact(record, builtAt)) {
      push(`allowedFacts contains ${record.id} (${record.kind}), which is not citable as fact at builtAt`);
    }
    if (options.now !== undefined && !isCitableAsFact(record, options.now)) {
      push(`allowedFacts contains ${record.id}, which is no longer citable at the supplied invocation time`);
    }
  }
  for (const section of ["sourcedResearch", "performanceEvidence"] as const) {
    for (const record of pack[section]) {
      if (isStale(record, builtAt)) {
        push(`${section} contains stale record ${record.id}; stale material belongs in staleEvidence`);
      }
    }
  }
  for (const record of pack.staleEvidence) {
    if (!isStale(record, builtAt)) {
      push(`staleEvidence contains ${record.id}, which is not stale at builtAt`);
    }
  }
  for (const record of pack.gcdObservations) {
    if (record.generalizable === true) {
      push(`observation ${record.id} claims generalizability`);
    }
  }

  // --- conflicts: every field, not merely the cardinality ------------------
  const seenConflicts = new Set<string>();
  pack.conflicts.forEach((conflict, index) => {
    const at = `conflicts[${index}]`;
    if (!conflict || typeof conflict !== "object") {
      push(`${at} is not an object`);
      return;
    }
    const boundedField = (value: unknown, field: string, max: number, required: boolean) => {
      if (value === undefined || value === null) {
        if (required) push(`${at}.${field} is required`);
        return;
      }
      if (typeof value !== "string") {
        push(`${at}.${field} must be a string`);
        return;
      }
      if (required && !value.trim()) push(`${at}.${field} must not be empty`);
      if (value.length > max) push(`${at}.${field} exceeds ${max} characters`);
      if (!isSerializableText(value)) {
        push(`${at}.${field} contains a control character or unpaired surrogate`);
      }
    };
    boundedField(conflict.aId, "aId", EVIDENCE_LIMITS.idChars, true);
    boundedField(conflict.bId, "bId", EVIDENCE_LIMITS.idChars, true);
    boundedField(conflict.subject, "subject", EVIDENCE_LIMITS.subjectChars, true);
    boundedField(conflict.aClaim, "aClaim", EVIDENCE_LIMITS.claimChars, true);
    boundedField(conflict.bClaim, "bClaim", EVIDENCE_LIMITS.claimChars, true);
    boundedField(conflict.note, "note", EVIDENCE_LIMITS.relationNoteChars, false);

    if (!CONFLICT_BASES.has(conflict.basis as string)) {
      push(`${at}.basis is not one of ${[...CONFLICT_BASES].join(", ")}: ${String(conflict.basis)}`);
    }
    if (conflict.aId === conflict.bId) {
      push(`${at} names ${conflict.aId} on both sides`);
    } else if (typeof conflict.aId === "string" && typeof conflict.bId === "string"
      && conflict.aId > conflict.bId) {
      // Canonical order, so one disagreement always reports identically and a
      // duplicate cannot hide behind a swapped pair.
      push(`${at} is not in canonical id order (${conflict.aId} > ${conflict.bId})`);
    }
    // NUL-separated so two ids cannot combine into the same key by accident.
    const key = `${conflict.aId}\u0000${conflict.bId}`;
    if (seenConflicts.has(key)) push(`${at} repeats the pair ${conflict.aId}/${conflict.bId}`);
    seenConflicts.add(key);

    for (const side of ["aId", "bId"] as const) {
      const id = conflict[side];
      const home = typeof id === "string" ? sectionById.get(id) : undefined;
      if (home === undefined) {
        push(`${at}.${side} names ${String(id)}, which is not a record in this pack`);
        continue;
      }
      if (USABLE_SECTIONS.includes(home)) {
        push(
          `${at}.${side} names ${String(id)}, which is also usable in ${home}; `
          + "a record in a live conflict must not remain citable",
        );
      }
    }
  });

  // --- counts: the exact keys, integers, and the truth ---------------------
  const counts = pack.counts;
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
    push("counts must be an object");
  } else {
    const actual = new Map<string, number>(
      RECORD_SECTIONS.map((section) => [section, pack[section].length] as const),
    );
    actual.set("conflicts", pack.conflicts.length);
    const present = Object.keys(counts);
    const unexpected = present.filter((key) => !COUNT_KEYS.includes(key));
    const missing = COUNT_KEYS.filter((key) => !present.includes(key));
    if (unexpected.length) push(`counts has unknown key(s): ${unexpected.join(", ")}`);
    if (missing.length) push(`counts is missing key(s): ${missing.join(", ")}`);
    for (const key of COUNT_KEYS) {
      if (!present.includes(key)) continue;
      const value = counts[key];
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        push(`counts.${key} must be a non-negative integer, received ${JSON.stringify(value)}`);
        continue;
      }
      const expected = actual.get(key)!;
      if (value !== expected) {
        push(`counts.${key} says ${value} but the section holds ${expected}`);
      }
    }
  }

  return violations;
}

/**
 * A pack refused by the authoritative validator.
 *
 * It extends `EvidencePackBoundsError` deliberately: the semantic contract is a
 * strict superset of the projection bounds — `evidencePackSemanticViolations`
 * begins with every bounds violation — so a caller that already catches a pack
 * refusal keeps catching one, and no boundary can be made weaker by narrowing
 * its catch. The `violations` array is the authoritative detail; the class is
 * only the family.
 */
export class EvidencePackSemanticError extends EvidencePackBoundsError {
  constructor(violations: string[]) {
    super(violations);
    this.name = "EvidencePackSemanticError";
    this.message = `evidence pack fails its semantic contract: ${violations.join("; ")}`;
  }
}

/**
 * The one call every pack consumer makes before reading a pack.
 *
 * Bounds and meaning are checked together, because either alone is a hole: a
 * pack can be perfectly bounded and still promote a hypothesis to fact, and it
 * can be semantically coherent and still carry a 50,000-character conflict
 * subject that no payload derivation allowed for.
 */
export function assertUsableEvidencePack(
  pack: EvidencePack,
  options: EvidencePackSemanticOptions = {},
): EvidencePack {
  const violations = evidencePackSemanticViolations(pack, options);
  if (violations.length) throw new EvidencePackSemanticError(violations);
  return pack;
}
