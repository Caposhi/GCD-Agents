/**
 * Phase 0B.1 — the `strategy-concept` stage executor.
 *
 * This is the first Content Intelligence stage with a real execution path. It is
 * **implemented, not wired**: nothing in the worker, scheduler, orchestrator,
 * approval path, or the `/console/content-intelligence/preview` route calls it.
 * Executing it requires a caller to construct an invocation deliberately and
 * supply a runner.
 *
 * ## What this stage guarantees, exactly
 *
 * **Guaranteed:** wrong-class and fabricated ids cannot enter the typed
 * fact-citation channel. Every id the model returns is checked against the pack
 * the caller built, in the section the contract assigns it, and anything
 * conflicted, stale, or inactive is rejected even when the id is real. A
 * performance or hypothesis id placed in `supportingFactIds` fails, because
 * membership is tested against `allowedFacts` and nothing else.
 *
 * **NOT guaranteed:** that the model's prose is true. `angle`, `concept`, and
 * `rationale` are free-form text. They are length-bounded and nothing more. A
 * response can assert a performance correlation as automotive fact inside
 * `rationale`, cite an unrelated but valid fact id, and validate cleanly. This
 * validator does not read prose for meaning and does not claim to.
 *
 * That gap is closed structurally rather than by keyword matching, which would
 * be trivially evadable and would imply a semantic check the code does not
 * perform. Instead the *type* separates the two channels:
 *
 *  - `output.provisional` — model-authored prose, branded
 *    `provisional_model_prose`, carrying `publishable: false` and
 *    `verified: false`. It is strategy material, not evidence, and no function
 *    in this module converts it into either.
 *  - `output.evidence` — the typed id channel. `citedFactRecords()` is the only
 *    supported way to obtain evidence records from this stage's output, and it
 *    returns records drawn from `pack.allowedFacts`, never model text.
 *
 * Stage 2 receives this complete typed output and structurally constrains the
 * claims content may make to evidence-record ids. It does not semantically prove
 * this prose true. Nothing produced here is publishable; this stage picks an
 * angle and preserves its untrusted inputs for that downstream review.
 */

import { EvidenceRecord } from "../evidence/contract.js";
import {
  EvidencePack,
  renderEvidencePackForStage,
  unusableEvidenceIds,
} from "../evidence/pack.js";
import { AgentRegistry } from "./registry.js";
import {
  StageExecutionError,
  StageExecutionMetadata,
  StageRunner,
  assertRequiredEvidenceKinds,
  invokeStage,
  parseStrictJsonObject,
} from "./stageExecution.js";
import { STRATEGY_LIMITS, HANDOFF_GUARDS, isBoundedSerializableText } from "./payloadContract.js";

export const STRATEGY_CONCEPT_STAGE = "strategy-concept" as const;

/**
 * Bounds on this stage, owned by `payloadContract.ts`.
 *
 * Re-exported under the established name so existing callers are unchanged.
 * Field limits live in one place because every downstream handoff guard and the
 * shared assembled-payload boundary are derived from them; the guards this
 * stage applies to its own inputs are likewise derived from the *producer's*
 * contract, so a structurally valid upstream result can never be refused here.
 */
export const LIMITS = STRATEGY_LIMITS;

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

/**
 * Model-authored prose from this stage.
 *
 * Deliberately branded and flagged. This is provisional, untrusted, and
 * **non-publishable** strategy material: the validator bounds its length and
 * checks nothing about its meaning. A consumer that wants evidence must use
 * `output.evidence` / `citedFactRecords()`; the literal `false` fields make
 * "treat prose as verified" a type error rather than an oversight.
 */
export interface ProvisionalStrategyProse {
  readonly kind: "provisional_model_prose";
  /** Always false. Nothing here may be published without `automotive-truth`. */
  readonly publishable: false;
  /** Always false. No prose from this stage has been checked for truth. */
  readonly verified: false;
  angle: string;
  concept: string;
  rationale: string;
  hypotheses: StrategyConceptHypothesis[];
  assumptions: string[];
}

/**
 * The typed evidence channel — the only path by which this stage contributes
 * anything the rest of the pipeline may treat as evidence.
 */
export interface CitedStageEvidence {
  readonly kind: "typed_evidence_citations";
  /** Ids drawn from `pack.allowedFacts` only. */
  supportingFactIds: string[];
  /** Ids drawn from `pack.gcdObservations` only. */
  observationIds: string[];
  /** Ids drawn from `pack.performanceEvidence` only. Never facts. */
  performanceSignalIds: string[];
}

export interface StrategyConceptOutput {
  /** Untrusted, non-publishable model prose. Never evidence. */
  provisional: ProvisionalStrategyProse;
  /** Typed, pack-validated citations. */
  evidence: CitedStageEvidence;
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
  // Serializable text only. Control characters and unpaired surrogates are the
  // only things JSON.stringify expands sixfold; the shared helper also enforces
  // the UTF-8 byte allowance used by the worst-case token proof.
  if (!isBoundedSerializableText(text, max)) {
    fail(`"${field}" exceeds ${max} UTF-8 bytes or contains non-serializable text`);
  }
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
 * The bounded projection of the pack this stage shows the model.
 *
 * Implemented once, beside the pack (`renderEvidencePackForStage`), and shared
 * by every stage: if each stage rendered its own view, two stages could
 * disagree about what the evidence says while both claiming to have read it.
 * Provenance, confidence, and internal timestamps are withheld; conflicted,
 * stale, and inactive material is named as an exclusion list rather than
 * dropped silently.
 */
export const renderEvidenceForStage = renderEvidencePackForStage;

/**
 * Validate the model's object against the contract and bind every cited id.
 *
 * Structural checks come first so a malformed shape fails before any id work.
 * The id checks then bind each citation to the exact evidence section the
 * contract assigns it.
 *
 * **Scope of this function, stated precisely.** It validates *shape* and
 * *citations*. It does not evaluate the truth of `angle`, `concept`, or
 * `rationale`, which are returned inside `provisional` marked
 * `publishable: false` / `verified: false`. Prose that misstates a performance
 * correlation as automotive fact will pass this validator. `automotive-truth`
 * receives the complete result and may structurally bind permissions to evidence
 * ids, but it does not semantically prove the prose true; nothing here is
 * publishable.
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
  const blocked = unusableEvidenceIds(pack);

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
    provisional: {
      kind: "provisional_model_prose",
      publishable: false,
      verified: false,
      angle,
      concept,
      rationale,
      hypotheses,
      assumptions,
    },
    evidence: {
      kind: "typed_evidence_citations",
      supportingFactIds,
      observationIds,
      performanceSignalIds,
    },
  };
}

/**
 * The only supported way to turn this stage's output into evidence records.
 *
 * Returns records from `pack.allowedFacts` matching the typed citation channel.
 * It cannot return model prose, because it never reads `output.provisional` —
 * the ids are the entire input. A downstream consumer that wants to know what
 * this stage established as fact calls this; there is no counterpart that
 * promotes text.
 */
export function citedFactRecords(
  output: StrategyConceptOutput,
  pack: EvidencePack,
): EvidenceRecord[] {
  const byId = new Map(pack.allowedFacts.map((r) => [r.id, r]));
  return output.evidence.supportingFactIds
    .map((id) => byId.get(id))
    .filter((r): r is EvidenceRecord => r !== undefined);
}

/**
 * Precondition: the stage's declared required evidence must actually be present.
 *
 * The registry declares `verified_business_fact` as required for this stage. A
 * strategy built with zero citable business facts is a strategy built on
 * nothing, so this refuses before spending a model call rather than after. The
 * check itself lives on the shared boundary so every stage enforces its
 * declaration identically.
 */
export function assertRequiredEvidence(pack: EvidencePack, registry: AgentRegistry): void {
  assertRequiredEvidenceKinds(STRATEGY_CONCEPT_STAGE, registry, pack);
}

/**
 * Execute the strategy-concept stage exactly once.
 *
 * Fails closed on: missing required evidence, an oversized or empty goal, a
 * missing asset, a runner error or timeout, non-strict JSON, any structural
 * contract violation, and any citation that is fabricated, wrong-class, stale,
 * conflicted, or inactive. Performs no retry and no second model call.
 *
 * It does **not** verify the truth of the returned prose — see this module's
 * header for the exact boundary.
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

  // The evidence pack is the one input this stage does not itself bound: its
  // cardinality is decided by whatever the classifier produced. Guarded here
  // against the derived ceiling so an oversized pack is refused before any
  // model call rather than assembling a payload nothing sized for.
  const renderedEvidence = renderEvidenceForStage(invocation.evidencePack);
  if (renderedEvidence.length > HANDOFF_GUARDS.evidencePackChars) {
    fail(`"evidencePack" exceeds ${HANDOFF_GUARDS.evidencePackChars} characters`);
  }

  const { rawText, metadata } = await invokeStage({
    stage: STRATEGY_CONCEPT_STAGE,
    registry,
    runner: invocation.runner,
    // The evidence projection below is the authoritative factual input. The
    // declared reference (`config/approved-facts.json`) is deliberately omitted
    // rather than injected: the pack already carries those facts classified,
    // freshness-checked, and conflict-filtered, and a raw second copy would be
    // unclassified authority competing with it.
    referenceChannel: "omit",
    dataBlocks: [
      { label: "GOAL", body: goal },
      { label: "EVIDENCE", body: renderedEvidence },
    ],
  });

  const parsed = parseStrictJsonObject(STRATEGY_CONCEPT_STAGE, rawText);
  const output = validateStrategyConceptOutput(parsed, invocation.evidencePack);
  return { output, metadata };
}
