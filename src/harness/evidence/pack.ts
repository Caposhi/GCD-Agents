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
  EvidenceRecord,
  EvidenceRelation,
  isCitableAsFact,
  isStale,
} from "./contract.js";

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

  const relations = input.relations ?? [];
  const scoped = input.records
    .filter((r) => matchesScope(r, input.subjects, input.tags))
    .slice()
    .sort(compareRecords);

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
  const violations: string[] = [];
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
