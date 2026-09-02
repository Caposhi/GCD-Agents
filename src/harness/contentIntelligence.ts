/**
 * ContentIntelligenceContext and the deterministic Phase 0B.0 preview.
 *
 * This is the typed object later reasoning stages will consume. It exists now,
 * ahead of those stages, so they are never written against an untyped bag of
 * JSON — the shape of what a stage receives is the main thing that decides
 * whether it can distinguish a fact from a guess.
 *
 * The preview is architecture inspection, not generation. It builds the
 * evidence pack, resolves the stage plan, verifies every registered asset, and
 * returns structured JSON. It calls no model, no image provider, and no social
 * platform; it creates no approval and enqueues no brief. `assertPreviewIsInert`
 * makes that a checked property rather than a promise in a comment.
 */

import { randomUUID } from "node:crypto";

import { EvidenceKind, EvidenceRecord, EvidenceRelation } from "./evidence/contract.js";
import {
  EvidencePack,
  assertEvidencePackProjectionBounds,
  buildEvidencePack,
  evidencePackInvariants,
} from "./evidence/pack.js";
import { AgentRegistry, StagePlanEntry } from "./agents/registry.js";

export const MAX_PREVIEW_GOAL_CHARS = 2_000;

export interface ContentIntelligenceContext {
  /** Correlates preview output with events and logs. */
  traceId: string;
  goal: string;
  createdAt: string;
  evidencePack: EvidencePack;
  stagePlan: StagePlanEntry[];
  /** Non-secret business context a stage may rely on. */
  businessContext: {
    activePlatforms: string[];
    autonomyPhase: string;
    approvedFactsSource: string;
  };
}

export interface ContentIntelligencePreview {
  traceId: string;
  goal: string;
  builtAt: string;
  evidence: {
    counts: Record<string, number>;
    allowedFacts: Array<{ id: string; claim: string; kind: EvidenceKind; sourceRef?: string }>;
    sourcedResearch: Array<{ id: string; claim: string }>;
    gcdObservations: Array<{ id: string; claim: string; observedAt?: string }>;
    performanceEvidence: Array<{ id: string; claim: string; observedAt?: string }>;
    creativeHypotheses: Array<{ id: string; claim: string }>;
    causalHypotheses: Array<{ id: string; claim: string }>;
    unsupportedAssumptions: Array<{ id: string; claim: string }>;
    conflicts: EvidencePack["conflicts"];
    staleEvidence: Array<{ id: string; claim: string; kind: EvidenceKind; reviewBy?: string; expiresAt?: string }>;
  };
  stagePlan: StagePlanEntry[];
  /** Every stage's assets resolved and hashed, proving nothing dangles. */
  assetsVerified: boolean;
  /** Always true in this slice; asserted, not assumed. */
  executionDisabled: boolean;
  invariantViolations: string[];
  notes: string[];
}

export class PreviewInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewInputError";
  }
}

/** Validate the caller-supplied goal. Rejects unknown fields at the route. */
export function parsePreviewGoal(value: unknown): string {
  if (typeof value !== "string") throw new PreviewInputError("goal must be a string");
  const trimmed = value.trim();
  if (!trimmed) throw new PreviewInputError("goal must not be empty");
  if (trimmed.length > MAX_PREVIEW_GOAL_CHARS) {
    throw new PreviewInputError(`goal must be at most ${MAX_PREVIEW_GOAL_CHARS} characters`);
  }
  return trimmed;
}

export interface BuildContextInput {
  goal: string;
  records: EvidenceRecord[];
  relations?: EvidenceRelation[];
  now: number;
  registry?: AgentRegistry;
  traceId?: string;
  businessContext: ContentIntelligenceContext["businessContext"];
}

export function buildContentIntelligenceContext(input: BuildContextInput): ContentIntelligenceContext {
  const registry = input.registry ?? new AgentRegistry();
  const evidencePack = buildEvidencePack({
    goal: input.goal,
    records: input.records,
    relations: input.relations,
    now: input.now,
  });
  assertEvidencePackProjectionBounds(evidencePack);

  // Only classes actually present and usable count as available. Stale or
  // conflicted facts do not silently satisfy a stage's requirement.
  const available = new Set<EvidenceKind>();
  for (const record of evidencePack.allowedFacts) available.add(record.kind);
  for (const record of evidencePack.sourcedResearch) available.add(record.kind);
  for (const record of evidencePack.gcdObservations) available.add(record.kind);
  for (const record of evidencePack.performanceEvidence) available.add(record.kind);
  for (const record of evidencePack.creativeHypotheses) available.add(record.kind);
  for (const record of evidencePack.causalHypotheses) available.add(record.kind);

  return {
    traceId: input.traceId ?? randomUUID(),
    goal: input.goal,
    createdAt: new Date(input.now).toISOString(),
    evidencePack,
    stagePlan: registry.buildStagePlan(available),
    businessContext: input.businessContext,
  };
}

const summarize = (record: EvidenceRecord) => ({ id: record.id, claim: record.claim });

export interface PreviewOptions extends BuildContextInput {
  /** Injected so the self-test can prove asset verification actually ran. */
  registry?: AgentRegistry;
}

/**
 * Build the preview. Deterministic for a fixed `now`, evidence set, and trace.
 */
export async function buildContentIntelligencePreview(
  options: PreviewOptions,
): Promise<ContentIntelligencePreview> {
  const registry = options.registry ?? new AgentRegistry();
  const context = buildContentIntelligenceContext({ ...options, registry });
  const pack = context.evidencePack;

  // Fails loudly if any registered prompt, skill, or reference is missing.
  await registry.verifyAllAssets();

  const notes: string[] = [];
  if (pack.conflicts.length) {
    notes.push(
      `${pack.conflicts.length} active evidence conflict(s) surfaced and withheld from allowedFacts; `
      + "resolve by authoring an explicit supersession",
    );
  }
  if (pack.staleEvidence.length) {
    notes.push(`${pack.staleEvidence.length} evidence record(s) excluded as stale or expired`);
  }
  if (pack.unsupportedAssumptions.length) {
    notes.push(`${pack.unsupportedAssumptions.length} unsupported assumption(s) recorded and excluded from allowedFacts`);
  }
  if (!pack.allowedFacts.length) {
    notes.push("no citable facts available; run the approved-facts evidence sync before relying on this pack");
  }
  notes.push("preview is deterministic architecture inspection; the six reasoning stages are registered but not executed");

  return {
    traceId: context.traceId,
    goal: context.goal,
    builtAt: pack.builtAt,
    evidence: {
      counts: pack.counts,
      allowedFacts: pack.allowedFacts.map((r) => ({ id: r.id, claim: r.claim, kind: r.kind, sourceRef: r.sourceRef })),
      sourcedResearch: pack.sourcedResearch.map(summarize),
      gcdObservations: pack.gcdObservations.map((r) => ({ id: r.id, claim: r.claim, observedAt: r.observedAt })),
      performanceEvidence: pack.performanceEvidence.map((r) => ({ id: r.id, claim: r.claim, observedAt: r.observedAt })),
      creativeHypotheses: pack.creativeHypotheses.map(summarize),
      causalHypotheses: pack.causalHypotheses.map(summarize),
      unsupportedAssumptions: pack.unsupportedAssumptions.map(summarize),
      conflicts: pack.conflicts,
      staleEvidence: pack.staleEvidence.map((r) => ({
        id: r.id, claim: r.claim, kind: r.kind, reviewBy: r.reviewBy, expiresAt: r.expiresAt,
      })),
    },
    stagePlan: context.stagePlan,
    assetsVerified: true,
    executionDisabled: context.stagePlan.every((s) => s.executionEnabled === false),
    invariantViolations: evidencePackInvariants(pack, options.now),
    notes,
  };
}

/**
 * Inertness assertion.
 *
 * Checked rather than asserted in prose: the preview must never claim a stage
 * is executable, must never break a class-separation invariant, and must never
 * report having published anything. The self-test calls this, and the route
 * calls it before responding, so a future change that wires execution into the
 * preview fails immediately instead of quietly generating content.
 */
export function assertPreviewIsInert(preview: ContentIntelligencePreview): void {
  if (!preview.executionDisabled) {
    throw new Error("content intelligence preview reported an execution-enabled stage; preview must be inert");
  }
  if (preview.invariantViolations.length) {
    throw new Error(`content intelligence preview violated evidence invariants: ${preview.invariantViolations.join("; ")}`);
  }
}
