/**
 * Phase 0B.1 — the `strategy-concept` stage executor.
 *
 * This is the first Content Intelligence stage with a real execution path. It is
 * **implemented, not wired**: nothing in the worker, scheduler, orchestrator,
 * approval path, or the `/console/content-intelligence/preview` route calls it.
 * Executing it requires a caller to construct an invocation deliberately and
 * supply a runner.
 *
 * The interesting work here is not the model call — it is refusing to believe
 * the result. The model chooses an angle; it does not get to choose what counts
 * as evidence. Every id it returns is checked against the pack the caller built,
 * in the section the contract requires, and anything conflicted, stale, or
 * inactive is rejected even when the id is real.
 *
 * The two promotions this pipeline exists to prevent are enforced structurally
 * rather than asked for politely: a performance or hypothesis id placed in
 * `supportingFactIds` fails validation, because membership is checked against
 * `allowedFacts` and nothing else.
 */

import { EvidenceRecord } from "../evidence/contract.js";
import { EvidencePack } from "../evidence/pack.js";
import { AgentRegistry } from "./registry.js";
import {
  StageExecutionError,
  StageExecutionMetadata,
  StageRunner,
  invokeStage,
  parseStrictJsonObject,
} from "./stageExecution.js";

export const STRATEGY_CONCEPT_STAGE = "strategy-concept" as const;

/** Bounds on the model's output. Generous enough to be useful, small enough to be safe. */
export const LIMITS = {
  angleChars: 400,
  conceptChars: 1_200,
  rationaleChars: 2_000,
  hypothesisChars: 400,
  assumptionChars: 400,
  maxIds: 12,
  maxHypotheses: 6,
  maxAssumptions: 6,
  goalChars: 2_000,
} as const;

/** Exactly the fields the contract allows. Anything else is an extra field. */
const ALLOWED_OUTPUT_FIELDS = [
  "angle",
  "concept",
  "rationale",
  "supportingFactIds",
  "observationIds",
  "performanceSignalIds",
  "hypotheses",
  "assumptions",
] as const;

export interface StrategyConceptHypothesis {
  statement: string;
  basis: "creative" | "causal";
}

export interface StrategyConceptOutput {
  angle: string;
  concept: string;
  rationale: string;
  /** Ids drawn from `pack.allowedFacts` only. */
  supportingFactIds: string[];
  /** Ids drawn from `pack.gcdObservations` only. */
  observationIds: string[];
  /** Ids drawn from `pack.performanceEvidence` only. Never facts. */
  performanceSignalIds: string[];
  hypotheses: StrategyConceptHypothesis[];
  assumptions: string[];
}

export interface StrategyConceptResult {
  output: StrategyConceptOutput;
  metadata: StageExecutionMetadata;
}

export interface StrategyConceptInvocation {
  goal: string;
  evidencePack: EvidencePack;
  registry?: AgentRegistry;
  runner: StageRunner;
}

const fail = (message: string): never => {
  throw new StageExecutionError(STRATEGY_CONCEPT_STAGE, message);
};

function requireBoundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") fail(`"${field}" must be a string`);
  const text = (value as string).trim();
  if (!text) fail(`"${field}" must not be empty`);
  if (text.length > max) fail(`"${field}" exceeds ${max} characters`);
  return text;
}

function requireIdArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) fail(`"${field}" must be an array`);
  const arr = value as unknown[];
  if (arr.length > LIMITS.maxIds) fail(`"${field}" exceeds ${LIMITS.maxIds} entries`);
  const ids: string[] = [];
  for (const entry of arr) {
    if (typeof entry !== "string") fail(`"${field}" must contain only strings`);
    const id = (entry as string).trim();
    if (!id) fail(`"${field}" must not contain empty ids`);
    if (ids.includes(id)) fail(`"${field}" contains a duplicate id: ${id}`);
    ids.push(id);
  }
  return ids;
}

/**
 * A bounded projection of the pack for the model.
 *
 * Only id, claim, and — for the sections where it matters — the attribute are
 * sent. Provenance, confidence numbers, and internal timestamps are withheld:
 * the model's job is to choose an angle, not to relitigate what the evidence
 * system already decided, and a confidence score in the prompt is an invitation
 * to argue a disputed claim back into use.
 *
 * Conflicted, stale, and inactive material is included **as a named exclusion
 * list** rather than dropped silently, so the model can see what it must not
 * cite instead of inventing a replacement for something it never knew existed.
 */
export function renderEvidenceForStage(pack: EvidencePack): string {
  const brief = (records: EvidenceRecord[]) =>
    records.map((r) => ({ id: r.id, claim: r.claim, ...(r.attribute ? { attribute: r.attribute } : {}) }));
  return JSON.stringify(
    {
      builtAt: pack.builtAt,
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

/** Ids the model may never cite as support, whatever section they came from. */
function unusableIds(pack: EvidencePack): Set<string> {
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
 * Validate the model's object against the contract *and* against the evidence.
 *
 * Structural checks come first so a malformed shape fails before any semantic
 * work; the semantic checks then bind every cited id to the exact section the
 * contract assigns it.
 */
export function validateStrategyConceptOutput(
  raw: Record<string, unknown>,
  pack: EvidencePack,
): StrategyConceptOutput {
  // Extra fields are a contract violation, not something to ignore. A stage that
  // tolerates unknown keys cannot tell a typo from an attempt to smuggle state.
  const extras = Object.keys(raw).filter((k) => !(ALLOWED_OUTPUT_FIELDS as readonly string[]).includes(k));
  if (extras.length) fail(`output has unknown field(s): ${extras.join(", ")}`);
  for (const field of ALLOWED_OUTPUT_FIELDS) {
    if (!(field in raw)) fail(`output is missing "${field}"`);
  }

  const angle = requireBoundedString(raw.angle, "angle", LIMITS.angleChars);
  const concept = requireBoundedString(raw.concept, "concept", LIMITS.conceptChars);
  const rationale = requireBoundedString(raw.rationale, "rationale", LIMITS.rationaleChars);

  const supportingFactIds = requireIdArray(raw.supportingFactIds, "supportingFactIds");
  const observationIds = requireIdArray(raw.observationIds, "observationIds");
  const performanceSignalIds = requireIdArray(raw.performanceSignalIds, "performanceSignalIds");

  if (!Array.isArray(raw.hypotheses)) fail('"hypotheses" must be an array');
  const rawHypotheses = raw.hypotheses as unknown[];
  if (rawHypotheses.length > LIMITS.maxHypotheses) {
    fail(`"hypotheses" exceeds ${LIMITS.maxHypotheses} entries`);
  }
  const hypotheses: StrategyConceptHypothesis[] = rawHypotheses.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail('"hypotheses" entries must be objects');
    }
    const obj = entry as Record<string, unknown>;
    const unknown = Object.keys(obj).filter((k) => k !== "statement" && k !== "basis");
    if (unknown.length) fail(`hypothesis has unknown field(s): ${unknown.join(", ")}`);
    const statement = requireBoundedString(obj.statement, "hypotheses[].statement", LIMITS.hypothesisChars);
    if (obj.basis !== "creative" && obj.basis !== "causal") {
      fail('hypotheses[].basis must be "creative" or "causal"');
    }
    return { statement, basis: obj.basis as "creative" | "causal" };
  });

  if (!Array.isArray(raw.assumptions)) fail('"assumptions" must be an array');
  const rawAssumptions = raw.assumptions as unknown[];
  if (rawAssumptions.length > LIMITS.maxAssumptions) {
    fail(`"assumptions" exceeds ${LIMITS.maxAssumptions} entries`);
  }
  const assumptions = rawAssumptions.map((a) =>
    requireBoundedString(a, "assumptions[]", LIMITS.assumptionChars),
  );

  // --- semantic binding: every id must exist, in its own section ---
  const factIds = new Set(pack.allowedFacts.map((r) => r.id));
  const observationPackIds = new Set(pack.gcdObservations.map((r) => r.id));
  const performancePackIds = new Set(pack.performanceEvidence.map((r) => r.id));
  const blocked = unusableIds(pack);

  for (const id of supportingFactIds) {
    if (!factIds.has(id)) {
      // Covers both a fabricated id and — critically — a real id from the wrong
      // class. A performance or hypothesis id lands here, which is the promotion
      // this contract exists to prevent.
      fail(`supportingFactIds cites "${id}", which is not a citable fact in this pack`);
    }
    if (blocked.has(id)) fail(`supportingFactIds cites "${id}", which is conflicted, stale, or inactive`);
  }
  for (const id of observationIds) {
    if (!observationPackIds.has(id)) fail(`observationIds cites "${id}", which is not a GCD observation in this pack`);
    if (blocked.has(id)) fail(`observationIds cites "${id}", which is conflicted, stale, or inactive`);
  }
  for (const id of performanceSignalIds) {
    if (!performancePackIds.has(id)) {
      fail(`performanceSignalIds cites "${id}", which is not performance evidence in this pack`);
    }
    if (blocked.has(id)) fail(`performanceSignalIds cites "${id}", which is conflicted, stale, or inactive`);
  }

  return {
    angle,
    concept,
    rationale,
    supportingFactIds,
    observationIds,
    performanceSignalIds,
    hypotheses,
    assumptions,
  };
}

/**
 * Precondition: the stage's declared required evidence must actually be present.
 *
 * The registry declares `verified_business_fact` as required for this stage. A
 * strategy built with zero citable business facts is a strategy built on nothing,
 * so this refuses before spending a model call rather than after.
 */
export function assertRequiredEvidence(pack: EvidencePack, registry: AgentRegistry): void {
  const definition = registry.get(STRATEGY_CONCEPT_STAGE);
  const available = new Set(pack.allowedFacts.map((r) => r.kind));
  const missing = definition.requiredEvidenceKinds.filter((kind) => !available.has(kind));
  if (missing.length) {
    fail(`required evidence class(es) absent from the pack: ${missing.join(", ")}`);
  }
}

/**
 * Execute the strategy-concept stage exactly once.
 *
 * Fails closed on: missing required evidence, an oversized or empty goal, a
 * missing asset, a runner error or timeout, non-strict JSON, and any structural
 * or semantic contract violation. Performs no retry and no second model call.
 */
export async function executeStrategyConcept(
  invocation: StrategyConceptInvocation,
): Promise<StrategyConceptResult> {
  const registry = invocation.registry ?? new AgentRegistry();

  const goal = requireBoundedString(invocation.goal, "goal", LIMITS.goalChars);
  if (!invocation.evidencePack || typeof invocation.evidencePack !== "object") {
    fail("an evidence pack is required");
  }
  assertRequiredEvidence(invocation.evidencePack, registry);

  const { rawText, metadata } = await invokeStage({
    stage: STRATEGY_CONCEPT_STAGE,
    registry,
    runner: invocation.runner,
    dataBlocks: [
      { label: "GOAL", body: goal },
      { label: "EVIDENCE", body: renderEvidenceForStage(invocation.evidencePack) },
    ],
  });

  const parsed = parseStrictJsonObject(STRATEGY_CONCEPT_STAGE, rawText);
  const output = validateStrategyConceptOutput(parsed, invocation.evidencePack);
  return { output, metadata };
}
