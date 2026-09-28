/**
 * The revision pass's plan: from one round-1 critic panel output, which writing
 * stages re-run, and exactly which findings each one is sent.
 *
 * Opt-in, local-CLI only (`--revise-from <run-dir>`, `--revise-once`), and
 * exactly one round: nothing here loops, and nothing here reads a round-2
 * critic. Pure and deterministic; it makes no request and reads no file.
 *
 * The rules, as the owner decided them (2026-09-26, and the caps 2026-09-28):
 *
 *  1. **What may reach a model.** A finding whose owner is in
 *     `REVISABLE_OWNERS` (hook-story-script, production-direction,
 *     packaging-adaptation) and whose category is not `human_decision`. Every
 *     finding owned by `human_review`, and every `human_decision` finding, is an
 *     **owner item**: listed for the person running the pass, never sent to any
 *     model.
 *  2. **Whether anything happens.** If no *blocking* finding has a revisable
 *     owner, the plan is `no_revision`: no request is made.
 *  3. **Which stages re-run.** The earliest stage owning at least one blocking
 *     finding, and every later writing stage through stage 5, in order. Stages
 *     1–2 never re-run. An earlier writing stage that owns only advisory
 *     findings is not re-run, and those findings are recorded as not sent.
 *  4. **What each re-run stage is sent.** Only the findings it owns, at most its
 *     cap (`REVISION_FINDING_CAPS`, derived from the payload contract so the
 *     request fits `MAX_PAYLOAD_CHARS`). Kept in this order: blocking first,
 *     then advisory; within each, lens order (evidence-fidelity,
 *     platform-and-local, voice-and-craft, production-coherence), then the
 *     finding's original order. What does not fit is dropped — advisory only,
 *     because:
 *  5. **A stage that owns more blocking findings than its cap is refused**
 *     (`RevisionCapError`), naming the stage, the count and the cap, before any
 *     cost gate and before any request.
 */

import {
  CRITIC_LENSES,
  REVISABLE_OWNERS,
  type CriticFinding,
  type FinalCriticOutput,
} from "./finalCritic.js";
import {
  REVISABLE_STAGES,
  REVISION_FINDING_CAPS,
  revisionFindingId,
  type RevisableStage,
} from "./payloadContract.js";
import type { RevisionFinding } from "./revisionInput.js";

export { REVISABLE_STAGES, REVISION_FINDING_CAPS } from "./payloadContract.js";
export type { RevisableStage } from "./payloadContract.js";

/** A stage owns more blocking findings than its derived cap. Always before any request. */
export class RevisionCapError extends Error {
  constructor(readonly stage: RevisableStage, readonly blocking: number, readonly cap: number) {
    super(
      `${stage} owns ${blocking} blocking findings, over its derived cap of ${cap} (the most its revision `
      + "request can carry within MAX_PAYLOAD_CHARS); refusing the revision before the cost gate. No request was made.",
    );
    this.name = "RevisionCapError";
  }
}

/** A finding's short reference, as recorded wherever a finding is not sent. */
export interface FindingRef {
  id: string;
  lens: string;
  severity: string;
}

/** A finding for the person running the pass. Never sent to a model. */
export interface OwnerItem extends FindingRef {
  owner: string;
  category: string;
  platform: string;
  issue: string;
  suggestedAction: string;
}

/** One re-run stage: what it is sent and what did not fit. */
export interface StageRevisionPlan {
  stage: RevisableStage;
  cap: number;
  /** Every finding the stage owns that may reach a model, before the cap. */
  owned: number;
  blocking: number;
  /** In the order they are sent. */
  sent: RevisionFinding[];
  /** Advisory findings over the cap, in selection order. */
  dropped: FindingRef[];
}

export interface RevisionPlan {
  kind: "revision" | "no_revision";
  /** The earliest stage owning a blocking finding; absent for `no_revision`. */
  startStage?: RevisableStage;
  /** The stages that re-run, in order, each with its findings. */
  stages: StageRevisionPlan[];
  /** Human-owned and human_decision findings. Never sent to any model. */
  ownerItems: OwnerItem[];
  /** Advisory findings owned by a writing stage before the start stage, which is not re-run. */
  notRerun: Array<FindingRef & { owner: string }>;
}

const isOwnerItem = (f: CriticFinding): boolean =>
  !REVISABLE_OWNERS.has(f.owner) || f.category === "human_decision";

/**
 * Plan one revision round from a round-1 panel output that the caller has
 * already revalidated. Throws `RevisionCapError`; otherwise pure.
 */
export function planRevision(
  critic: FinalCriticOutput,
  caps: Readonly<Record<RevisableStage, number>> = REVISION_FINDING_CAPS,
): RevisionPlan {
  const indexed = critic.provisional.findings.map((finding, index) => ({ finding, index, id: revisionFindingId(index) }));
  const ref = ({ finding, id }: (typeof indexed)[number]): FindingRef =>
    ({ id, lens: finding.lens, severity: finding.severity });

  const ownerItems: OwnerItem[] = indexed.filter(({ finding }) => isOwnerItem(finding)).map((entry) => ({
    ...ref(entry),
    owner: entry.finding.owner,
    category: entry.finding.category,
    platform: entry.finding.platform,
    issue: entry.finding.issue,
    suggestedAction: entry.finding.suggestedAction,
  }));
  const revisable = indexed.filter(({ finding }) => !isOwnerItem(finding));

  const startIndex = REVISABLE_STAGES.findIndex((stage) =>
    revisable.some(({ finding }) => finding.owner === stage && finding.severity === "blocking"));
  if (startIndex < 0) return { kind: "no_revision", stages: [], ownerItems, notRerun: [] };

  const notRerun = revisable
    .filter(({ finding }) => REVISABLE_STAGES.indexOf(finding.owner as RevisableStage) < startIndex)
    .map((entry) => ({ ...ref(entry), owner: entry.finding.owner }));

  const lensRank = (lens: string) => (CRITIC_LENSES as readonly string[]).indexOf(lens);
  const stages = REVISABLE_STAGES.slice(startIndex).map((stage): StageRevisionPlan => {
    const owned = revisable
      .filter(({ finding }) => finding.owner === stage)
      .sort((a, b) =>
        Number(b.finding.severity === "blocking") - Number(a.finding.severity === "blocking")
        || lensRank(a.finding.lens) - lensRank(b.finding.lens)
        || a.index - b.index);
    const blocking = owned.filter(({ finding }) => finding.severity === "blocking").length;
    const cap = caps[stage];
    if (blocking > cap) throw new RevisionCapError(stage, blocking, cap);
    return {
      stage,
      cap,
      owned: owned.length,
      blocking,
      sent: owned.slice(0, cap).map(({ finding, id }) => ({
        id,
        lens: finding.lens,
        owner: finding.owner,
        severity: finding.severity,
        category: finding.category,
        platform: finding.platform,
        issue: finding.issue,
        suggestedAction: finding.suggestedAction,
      })),
      dropped: owned.slice(cap).map(ref),
    };
  });

  return { kind: "revision", startStage: REVISABLE_STAGES[startIndex], stages, ownerItems, notRerun };
}
