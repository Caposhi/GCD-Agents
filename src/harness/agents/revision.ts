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
 *
 * **The source run's legal findings (Content Studio S8.8; the owner's go-ahead
 * of 2026-10-14).** When the caller passes the source run's revalidated legal
 * review (`legal`), every one of its findings joins the plan — each blocking
 * finding and each "for your decision" finding — owned by the writing stage
 * that wrote the quoted block (`legalReview.ts`, `legalFindingStage`):
 *
 *  - **any** legal finding — blocking or "for your decision" — counts for rule
 *    2 and rule 3 as a blocking critic finding does: it alone makes the run
 *    revisable, and the start stage is the earliest stage owning a critic
 *    blocking finding or any legal finding, so every legal finding reaches a
 *    stage that re-runs and none is ever "not re-run" (the reviewer's required
 *    change of 2026-10-14: run `46f5bf15…`'s two script decisions would
 *    otherwise have gone to a stage that never re-ran). Critic advisory
 *    findings alone still revise nothing and never move the start;
 *  - each is sent in the stage's existing `CRITIC_FINDINGS` block, in the
 *    revision-finding shape (`legalRevisionFinding`): lens `legal-review`, its
 *    category, severity `blocking` or `advisory`, platform `cross_platform`,
 *    issue, suggested action = its fix, and an `L<n>` id that cannot equal a
 *    panel finding's `F<n>`;
 *  - within each stage the order is: critic blocking (as rule 4 orders them),
 *    legal blocking, legal "for your decision", then critic advisory (as rule 4
 *    orders them); within each legal group, the review's own order. Blocking
 *    findings, critic plus legal, over the cap are rule 5's refusal; anything
 *    else over the cap is dropped and recorded;
 *  - owner items (rule 1) are unchanged: never sent.
 *
 * Without `legal` (a source from before S8.6, or one stopped before its legal
 * review) the plan is exactly what it was before S8.8, key for key.
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
import {
  LEGAL_REVISION_LENS, LEGAL_REVISION_PLATFORM, legalRevisionFindingId, type RevisionFinding,
} from "./revisionInput.js";

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

/**
 * Content Studio S8.8: one finding of the source run's legal review, as the
 * caller hands it to the plan: already revalidated, with the writing stage that
 * wrote its quoted block. Model prose: never evidence, never instructions.
 */
export interface LegalRevisionFindingInput {
  category: string;
  /** Code's, from the category (`LEGAL_BLOCKING_CATEGORIES`), never the model's. */
  blocking: boolean;
  location: string;
  stage: RevisableStage;
  issue: string;
  fix: string;
}

/** Content Studio S8.8: the source run's legal review, as the plan reads it. */
export interface LegalRevisionInput {
  verdict: string;
  /** In the review's own order; finding `i` is `L<i + 1>`. */
  findings: readonly LegalRevisionFindingInput[];
}

/**
 * What became of one legal finding in the plan: sent to its stage, or dropped
 * over that stage's cap. Every legal finding's stage re-runs (the start is never
 * after it), and a review with any finding always makes a revision.
 */
export type LegalFindingDisposition = "sent" | "dropped";

/** Content Studio S8.8: one legal finding's record in the plan, for revision-meta.json, summary.md and the price page. */
export interface LegalFindingRecord {
  id: string;
  category: string;
  severity: "blocking" | "advisory";
  location: string;
  stage: RevisableStage;
  /** `sent` to its stage, or `dropped` over that stage's cap. */
  disposition: LegalFindingDisposition;
}

export interface RevisionPlan {
  kind: "revision" | "no_revision";
  /** The earliest stage owning a blocking finding; absent for `no_revision`. */
  startStage?: RevisableStage;
  /** The stages that re-run, in order, each with its findings. */
  stages: StageRevisionPlan[];
  /** Human-owned and human_decision findings. Never sent to any model. */
  ownerItems: OwnerItem[];
  /**
   * Critic advisory findings owned by a writing stage before the start stage, which is not re-run. Never a
   * legal finding: every legal finding's stage is at or after the start (S8.8).
   */
  notRerun: Array<FindingRef & { owner: string }>;
  /** Content Studio S8.8: the source run's legal review and every one of its findings; absent without one. */
  legalReview?: { verdict: string; findings: LegalFindingRecord[] };
}

/** Content Studio S8.8: one legal finding in the revision-finding shape `CRITIC_FINDINGS` carries. */
export function legalRevisionFinding(finding: LegalRevisionFindingInput, index: number): RevisionFinding {
  return {
    id: legalRevisionFindingId(index),
    lens: LEGAL_REVISION_LENS,
    owner: finding.stage,
    severity: finding.blocking ? "blocking" : "advisory",
    category: finding.category,
    platform: LEGAL_REVISION_PLATFORM,
    issue: finding.issue,
    suggestedAction: finding.fix,
  };
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
  legal: LegalRevisionInput | null = null,
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
  // S8.8: the source run's legal findings, each already owned by the stage that wrote its quote.
  const legalSent = (legal?.findings ?? []).map((finding, index) => {
    if (!(REVISABLE_STAGES as readonly string[]).includes(finding.stage)) {
      throw new Error(`legal finding ${legalRevisionFindingId(index)} names no writing stage (${JSON.stringify(finding.stage)})`);
    }
    return legalRevisionFinding(finding, index);
  });
  const legalRecord = (dropped: ReadonlySet<string>) => (legal === null ? {} : {
    legalReview: {
      verdict: legal.verdict,
      findings: legalSent.map((f, index): LegalFindingRecord => ({
        id: f.id, category: f.category, severity: f.severity as LegalFindingRecord["severity"],
        location: legal.findings[index]!.location, stage: f.owner as RevisableStage,
        disposition: dropped.has(f.id) ? "dropped" : "sent",
      })),
    },
  });

  const startIndex = REVISABLE_STAGES.findIndex((stage) =>
    revisable.some(({ finding }) => finding.owner === stage && finding.severity === "blocking")
    || legalSent.some((f) => f.owner === stage));
  // No revision means no legal finding at all: a review with none is recorded, and nothing is sent.
  if (startIndex < 0) return { kind: "no_revision", stages: [], ownerItems, notRerun: [], ...legalRecord(new Set()) };

  // Critic findings only: no legal finding's stage precedes the start, by the rule above.
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
    const criticBlocking = owned.filter(({ finding }) => finding.severity === "blocking").length;
    const ownLegal = legalSent.filter((f) => f.owner === stage);
    const legalBlocking = ownLegal.filter((f) => f.severity === "blocking");
    const blocking = criticBlocking + legalBlocking.length;
    const cap = caps[stage];
    if (blocking > cap) throw new RevisionCapError(stage, blocking, cap);
    const asSent = ({ finding, id }: (typeof owned)[number]): RevisionFinding => ({
      id,
      lens: finding.lens,
      owner: finding.owner,
      severity: finding.severity,
      category: finding.category,
      platform: finding.platform,
      issue: finding.issue,
      suggestedAction: finding.suggestedAction,
    });
    // Critic blocking (the sorted prefix), legal blocking, legal "for your decision", then critic advisory.
    const ordered: RevisionFinding[] = [
      ...owned.slice(0, criticBlocking).map(asSent),
      ...legalBlocking,
      ...ownLegal.filter((f) => f.severity !== "blocking"),
      ...owned.slice(criticBlocking).map(asSent),
    ];
    return {
      stage,
      cap,
      owned: ordered.length,
      blocking,
      sent: ordered.slice(0, cap),
      dropped: ordered.slice(cap).map(({ id, lens, severity }) => ({ id, lens, severity })),
    };
  });

  return {
    kind: "revision", startStage: REVISABLE_STAGES[startIndex], stages, ownerItems, notRerun,
    ...legalRecord(new Set(stages.flatMap((s) => s.dropped.map((f) => f.id)))),
  };
}
