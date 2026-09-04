/**
 * Phase 0B.2 — the `automotive-truth` stage executor.
 *
 * Stage 2 decides what the content is allowed to assert. It is **implemented,
 * not wired**: nothing in the worker, scheduler, orchestrator, approval path,
 * or the `/console/content-intelligence/preview` route calls it. Executing it
 * requires a caller to construct an invocation deliberately and supply a runner.
 *
 * ## The one thing this stage must make impossible
 *
 * A stage named "automotive-truth" is the obvious place to accidentally build a
 * machine that lets a language model declare things true. It must not be one.
 * **No sentence the model writes becomes a claim the pipeline may make.**
 *
 * The permission is a *binding*, not a sentence. The model permits a claim by
 * naming the id of a fact the evidence system already established; its wording
 * of that claim travels beside the binding as provisional prose. What content
 * may assert is read back out of the pack records — `allowedClaimRecords()` and
 * `allowedClaimTexts()` — and neither function reads model text.
 *
 * ## What this stage guarantees, exactly
 *
 * **Guaranteed:**
 *  - Every permitted claim is bound to an id present in `pack.allowedFacts`.
 *    Fabricated ids, ids from any other evidence class, and ids the pack marked
 *    conflicted, stale, or inactive are all rejected.
 *  - The class recorded for a permitted claim is **the pack's class**, not the
 *    model's. The model must declare `claimClass`, and a declaration that
 *    disagrees with the record fails — which is how "business fact asserted as
 *    automotive truth" is caught rather than merely discouraged.
 *  - The authoritative claim text comes from the evidence record. A restatement
 *    that drifts from its fact cannot reach a consumer that asks what may be
 *    claimed.
 *  - The stage refuses **before any model request** when either declared fact
 *    class is absent from the pack, and nothing else in the pack substitutes.
 *
 * **NOT guaranteed:** that the model's prose is true, or that a restatement is
 * a faithful rendering of the fact it cites. `assessment`, `restatement`,
 * `forbiddenClaims`, `requiredCaveats`, and `openQuestions` are free-form text.
 * They are length-bounded and nothing more. This validator does not read prose
 * for meaning and does not claim to.
 * **A language model does not prove factual truth here**, and nothing in this
 * module treats it as though one did.
 *
 * That gap is closed structurally rather than by keyword matching — which would
 * be trivially evadable and would imply a semantic check the code does not
 * perform. The *type* separates the two channels:
 *
 *  - `output.provisional` — branded `provisional_model_prose`, carrying
 *    `publishable: false` and `verified: false`.
 *  - `output.constraints` — branded `typed_claim_constraints`, holding
 *    id-bound permissions whose restatements are individually branded
 *    `restatementVerified: false`.
 *
 * `forbiddenClaims` is advisory prose, in the provisional channel on purpose:
 * it records what the model rejected and why, for later stages and human
 * reviewers. Nothing enforces it, and a claim absent from it is not thereby
 * permitted — only a binding permits.
 */

import { EvidenceKind, EvidenceRecord } from "../evidence/contract.js";
import {
  EvidencePack,
  renderEvidencePackForStage,
  unusableEvidenceIds,
} from "../evidence/pack.js";
import { AgentRegistry, AgentStageId } from "./registry.js";
import type { StrategyConceptOutput } from "./strategyConcept.js";
import { validateStrategyConceptOutput } from "./strategyConcept.js";
import {
  StageExecutionError,
  StageExecutionMetadata,
  StageRunner,
  assertRequiredEvidenceKinds,
  invokeStage,
  parseStrictJsonObject,
} from "./stageExecution.js";
import { TRUTH_FIELD_LIMITS, EVIDENCE_LIMITS, HANDOFF_GUARDS, isBoundedSerializableText } from "./payloadContract.js";

export const AUTOMOTIVE_TRUTH_STAGE = "automotive-truth" as const;

/**
 * Bounds on this stage, owned by `payloadContract.ts`.
 *
 * Re-exported under the established name so existing callers are unchanged.
 * Field limits live in one place because every downstream handoff guard and the
 * shared assembled-payload boundary are derived from them; the guards this
 * stage applies to its own inputs are likewise derived from the *producer's*
 * contract, so a structurally valid upstream result can never be refused here.
 */
export const TRUTH_LIMITS = {
  ...TRUTH_FIELD_LIMITS,
  strategyOutputChars: HANDOFF_GUARDS.strategyOutputChars,
  evidencePackChars: HANDOFF_GUARDS.evidencePackChars,
} as const;

/** Exactly the fields the contract allows. Anything else is an extra field. */
const ALLOWED_OUTPUT_FIELDS = [
  "assessment",
  "allowedClaims",
  "forbiddenClaims",
  "requiredCaveats",
  "openQuestions",
] as const;

/** Closed set. A free-form reason would be one more place to write an excuse. */
export const FORBIDDEN_CLAIM_REASONS = [
  "no_citable_fact",
  "wrong_evidence_class",
  "disputed_or_stale",
  "outside_evidence_scope",
] as const;
export type ForbiddenClaimReason = (typeof FORBIDDEN_CLAIM_REASONS)[number];

/**
 * The two fact classes, and the short names the model declares.
 *
 * The mapping is one-directional on purpose: a declaration is checked against
 * the record's recorded kind. The record is never reclassified to match what
 * the model said.
 */
export type ClaimClass = "automotive" | "business";
const CLASS_OF_KIND: Partial<Record<EvidenceKind, ClaimClass>> = {
  verified_automotive_fact: "automotive",
  verified_business_fact: "business",
};

/**
 * One permitted claim.
 *
 * The permission is `factId`. `provisionalRestatement` is the model's wording
 * and is branded unverified beside it, so a consumer that reaches for the
 * model's sentence instead of the fact has to do so knowingly.
 */
export interface AllowedClaimBinding {
  readonly kind: "evidence_bound_claim";
  /** An id present in `pack.allowedFacts`. The permission itself. */
  factId: string;
  /** Taken from the pack record. Never from the model's declaration. */
  factKind: "verified_automotive_fact" | "verified_business_fact";
  /** Derived from `factKind`, for callers that want the short name. */
  claimClass: ClaimClass;
  /** Model prose. Bounded in length; never checked for faithfulness. */
  provisionalRestatement: string;
  /** Always false. No restatement from this stage has been checked. */
  readonly restatementVerified: false;
}

export interface ForbiddenClaim {
  /** Model prose describing a claim that may not be made. */
  claim: string;
  reason: ForbiddenClaimReason;
}

/**
 * The typed constraint channel — the only part of this stage's output that
 * permits anything downstream.
 */
export interface EvidenceBoundClaims {
  readonly kind: "typed_claim_constraints";
  allowed: AllowedClaimBinding[];
}

/**
 * Model-authored prose from this stage.
 *
 * Deliberately branded and flagged. Provisional, untrusted, and
 * **non-publishable**: the validator bounds its length and checks nothing about
 * its meaning. The literal `false` fields make "treat this as verified" a type
 * error rather than an oversight.
 */
export interface ProvisionalTruthAssessment {
  readonly kind: "provisional_model_prose";
  /** Always false. Nothing here may be published. */
  readonly publishable: false;
  /** Always false. No prose from this stage has been checked for truth. */
  readonly verified: false;
  assessment: string;
  /** Advisory only. Nothing enforces this list. */
  forbiddenClaims: ForbiddenClaim[];
  requiredCaveats: string[];
  openQuestions: string[];
}

export interface AutomotiveTruthOutput {
  /** Untrusted, non-publishable model prose. Never a permission. */
  provisional: ProvisionalTruthAssessment;
  /** Typed, pack-bound permissions. */
  constraints: EvidenceBoundClaims;
}

export interface AutomotiveTruthResult {
  output: AutomotiveTruthOutput;
  metadata: StageExecutionMetadata;
}

export interface AutomotiveTruthInvocation {
  /**
   * The complete typed output from stage 1. Its prose and typed citations are
   * review input only: they are untrusted data, never a source of truth, never
   * instructions, and never automatic claim permissions.
   */
  strategyOutput: StrategyConceptOutput;
  evidencePack: EvidencePack;
  registry?: AgentRegistry;
  runner: StageRunner;
}

const fail = (message: string): never => {
  throw new StageExecutionError(AUTOMOTIVE_TRUTH_STAGE, message);
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

function requireBoundedStringArray(
  value: unknown, field: string, maxEntries: number, maxChars: number,
): string[] {
  if (!Array.isArray(value)) fail(`"${field}" must be an array`);
  const arr = value as unknown[];
  if (arr.length > maxEntries) fail(`"${field}" exceeds ${maxEntries} entries`);
  return arr.map((entry) => requireBoundedString(entry, `${field}[]`, maxChars));
}

function requireExactKeys(obj: Record<string, unknown>, keys: string[], label: string): void {
  const extras = Object.keys(obj).filter((k) => !keys.includes(k));
  if (extras.length) fail(`${label} has unknown field(s): ${extras.join(", ")}`);
  for (const key of keys) {
    if (!(key in obj)) fail(`${label} is missing "${key}"`);
  }
}

/**
 * Revalidate the runtime value at the stage boundary even though callers have a
 * compile-time `StrategyConceptOutput`. Casts, deserialisation, and JavaScript
 * callers can still supply malformed data. Reconstructing the Stage 1 validator
 * input also prevents the branding fields from being treated as authority.
 */
function validateStrategyOutputInput(
  value: unknown,
  pack: EvidencePack,
): StrategyConceptOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail('"strategyOutput" must be a complete StrategyConceptOutput object');
  }
  const output = value as Record<string, unknown>;
  requireExactKeys(output, ["provisional", "evidence"], "strategyOutput");

  if (!output.provisional || typeof output.provisional !== "object" || Array.isArray(output.provisional)) {
    fail('"strategyOutput.provisional" must be an object');
  }
  if (!output.evidence || typeof output.evidence !== "object" || Array.isArray(output.evidence)) {
    fail('"strategyOutput.evidence" must be an object');
  }
  const provisional = output.provisional as Record<string, unknown>;
  const evidence = output.evidence as Record<string, unknown>;
  requireExactKeys(
    provisional,
    ["kind", "publishable", "verified", "angle", "concept", "rationale", "hypotheses", "assumptions"],
    "strategyOutput.provisional",
  );
  requireExactKeys(
    evidence,
    ["kind", "supportingFactIds", "observationIds", "performanceSignalIds"],
    "strategyOutput.evidence",
  );
  if (provisional.kind !== "provisional_model_prose"
      || provisional.publishable !== false
      || provisional.verified !== false) {
    fail('"strategyOutput.provisional" has invalid boundary branding');
  }
  if (evidence.kind !== "typed_evidence_citations") {
    fail('"strategyOutput.evidence" has invalid boundary branding');
  }

  try {
    return validateStrategyConceptOutput({
      angle: provisional.angle,
      concept: provisional.concept,
      rationale: provisional.rationale,
      hypotheses: provisional.hypotheses,
      assumptions: provisional.assumptions,
      supportingFactIds: evidence.supportingFactIds,
      observationIds: evidence.observationIds,
      performanceSignalIds: evidence.performanceSignalIds,
    }, pack);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail(`"strategyOutput" is invalid: ${detail}`);
  }
}

/**
 * Revalidate a supplied `AutomotiveTruthOutput` against an evidence pack.
 *
 * This lives here, in the owning module, because more than one later stage needs
 * it and a second copy would be free to drift from this contract. Callers pass
 * their own `stage` so a failure is attributed to the stage that refused, not to
 * `automotive-truth`.
 *
 * Rebuilding this stage's validator input re-binds every permitted id against
 * the supplied pack, re-checks the recorded class against the declared one, and
 * rejects duplicated, conflicted, stale, or inactive ids — so a whitelist that
 * names something the pack does not permit cannot widen what a later stage may
 * say.
 *
 * **The limit, stated exactly.** Prior-stage values are treated as untrusted and
 * revalidated against the same evidence pack. Values that fail the prior
 * contracts are refused before the model call. This is structural validation,
 * not provenance or authenticity verification; a structurally valid deserialized
 * or hand-built value can pass. Nothing here establishes that the value came
 * from a real `automotive-truth` run.
 */
export function revalidateAutomotiveTruthOutput(
  value: unknown,
  pack: EvidencePack,
  stage: AgentStageId = AUTOMOTIVE_TRUTH_STAGE,
  label = "truthOutput",
): AutomotiveTruthOutput {
  const failHere = (message: string): never => {
    throw new StageExecutionError(stage, message);
  };
  const obj = (v: unknown, name: string): Record<string, unknown> => {
    if (!v || typeof v !== "object" || Array.isArray(v)) failHere(`"${name}" must be an object`);
    return v as Record<string, unknown>;
  };
  const exact = (o: Record<string, unknown>, keys: string[], name: string): void => {
    const extras = Object.keys(o).filter((k) => !keys.includes(k));
    if (extras.length) failHere(`${name} has unknown field(s): ${extras.join(", ")}`);
    for (const key of keys) if (!(key in o)) failHere(`${name} is missing "${key}"`);
  };

  const output = obj(value, label);
  exact(output, ["provisional", "constraints"], label);
  const provisional = obj(output.provisional, `${label}.provisional`);
  const constraints = obj(output.constraints, `${label}.constraints`);
  exact(
    provisional,
    ["kind", "publishable", "verified", "assessment", "forbiddenClaims", "requiredCaveats", "openQuestions"],
    `${label}.provisional`,
  );
  exact(constraints, ["kind", "allowed"], `${label}.constraints`);
  if (provisional.kind !== "provisional_model_prose"
      || provisional.publishable !== false
      || provisional.verified !== false) {
    failHere(`"${label}.provisional" has invalid boundary branding`);
  }
  if (constraints.kind !== "typed_claim_constraints") {
    failHere(`"${label}.constraints" has invalid boundary branding`);
  }
  if (!Array.isArray(constraints.allowed)) failHere(`"${label}.constraints.allowed" must be an array`);

  const allowedClaims = (constraints.allowed as unknown[]).map((entry, index) => {
    const binding = obj(entry, `${label}.constraints.allowed[${index}]`);
    exact(
      binding,
      ["kind", "factId", "factKind", "claimClass", "provisionalRestatement", "restatementVerified"],
      `${label}.constraints.allowed[${index}]`,
    );
    if (binding.kind !== "evidence_bound_claim" || binding.restatementVerified !== false) {
      failHere(`"${label}.constraints.allowed[${index}]" has invalid boundary branding`);
    }
    return {
      factId: binding.factId,
      claimClass: binding.claimClass,
      restatement: binding.provisionalRestatement,
    };
  });

  try {
    return validateAutomotiveTruthOutput({
      assessment: provisional.assessment,
      allowedClaims,
      forbiddenClaims: provisional.forbiddenClaims,
      requiredCaveats: provisional.requiredCaveats,
      openQuestions: provisional.openQuestions,
    }, pack);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failHere(`"${label}" is invalid: ${detail}`);
  }
}

/**
 * The bounded projection of the pack this stage shows the model.
 *
 * The shared projection, identical to the one stage 1 sees. Two stages that
 * rendered the evidence differently could disagree about what it says while
 * both claiming to have read it.
 */
export const renderEvidenceForTruthStage = renderEvidencePackForStage;

/**
 * Validate the model's object against the contract and bind every permitted
 * claim to a pack record.
 *
 * Structural checks come first so a malformed shape fails before any id work.
 * The id checks then bind each permission to `pack.allowedFacts` and confirm
 * the declared class against the class the evidence system recorded.
 *
 * **Scope of this function, stated precisely.** It validates *shape*,
 * *bindings*, and *declared class*. It does not evaluate the truth of any
 * prose, and it does not check that a restatement faithfully renders the fact
 * it cites. Those strings are returned inside `provisional` and inside
 * `AllowedClaimBinding.provisionalRestatement`, each branded unverified. A
 * restatement that overstates its fact will pass this validator; what it cannot
 * do is become the claim, because consumers read claim text from the records.
 */
export function validateAutomotiveTruthOutput(
  raw: Record<string, unknown>,
  pack: EvidencePack,
): AutomotiveTruthOutput {
  requireExactKeys(raw, [...ALLOWED_OUTPUT_FIELDS], "output");

  const assessment = requireBoundedString(raw.assessment, "assessment", TRUTH_LIMITS.assessmentChars);

  if (!Array.isArray(raw.allowedClaims)) fail('"allowedClaims" must be an array');
  const rawAllowed = raw.allowedClaims as unknown[];
  if (rawAllowed.length > TRUTH_LIMITS.maxAllowedClaims) {
    fail(`"allowedClaims" exceeds ${TRUTH_LIMITS.maxAllowedClaims} entries`);
  }

  if (!Array.isArray(raw.forbiddenClaims)) fail('"forbiddenClaims" must be an array');
  const rawForbidden = raw.forbiddenClaims as unknown[];
  if (rawForbidden.length > TRUTH_LIMITS.maxForbiddenClaims) {
    fail(`"forbiddenClaims" exceeds ${TRUTH_LIMITS.maxForbiddenClaims} entries`);
  }
  const forbiddenClaims: ForbiddenClaim[] = rawForbidden.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail('"forbiddenClaims" entries must be objects');
    }
    const obj = entry as Record<string, unknown>;
    requireExactKeys(obj, ["claim", "reason"], "forbiddenClaims entry");
    const claim = requireBoundedString(obj.claim, "forbiddenClaims[].claim", TRUTH_LIMITS.forbiddenClaimChars);
    if (!(FORBIDDEN_CLAIM_REASONS as readonly string[]).includes(obj.reason as string)) {
      fail(`forbiddenClaims[].reason must be one of: ${FORBIDDEN_CLAIM_REASONS.join(", ")}`);
    }
    return { claim, reason: obj.reason as ForbiddenClaimReason };
  });

  const requiredCaveats = requireBoundedStringArray(
    raw.requiredCaveats, "requiredCaveats", TRUTH_LIMITS.maxCaveats, TRUTH_LIMITS.caveatChars,
  );
  const openQuestions = requireBoundedStringArray(
    raw.openQuestions, "openQuestions", TRUTH_LIMITS.maxOpenQuestions, TRUTH_LIMITS.openQuestionChars,
  );

  // --- binding: every permission must name a citable fact in this pack ------
  // Defense in depth: a record only counts as a citable fact here if its own
  // kind says so, not merely because it was found in `allowedFacts`.
  const factsById = new Map(
    pack.allowedFacts.filter((r) => CLASS_OF_KIND[r.kind]).map((r) => [r.id, r]),
  );
  const blocked = unusableEvidenceIds(pack);
  const seen = new Set<string>();

  const allowed: AllowedClaimBinding[] = rawAllowed.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail('"allowedClaims" entries must be objects');
    }
    const obj = entry as Record<string, unknown>;
    requireExactKeys(obj, ["factId", "claimClass", "restatement"], "allowedClaims entry");

    const factId = requireBoundedString(obj.factId, "allowedClaims[].factId", EVIDENCE_LIMITS.idChars);
    const record = factsById.get(factId);
    if (!record) {
      // Covers both a fabricated id and — critically — a real id from the wrong
      // class. An observation, performance, research, hypothesis, or assumption
      // id lands here, which is the promotion this contract exists to prevent.
      fail(`allowedClaims cites "${factId}", which is not a citable fact in this pack`);
    }
    if (blocked.has(factId)) {
      fail(`allowedClaims cites "${factId}", which is conflicted, stale, or inactive`);
    }
    if (seen.has(factId)) fail(`allowedClaims cites "${factId}" more than once`);
    seen.add(factId);

    // The recorded class is authoritative. The model's declaration is checked
    // against it, never the other way round: this is the check that catches a
    // business fact being permitted as automotive truth.
    const recordedClass = CLASS_OF_KIND[record!.kind];
    if (!recordedClass) {
      // Unreachable while `allowedFacts` holds only the two fact classes, but
      // asserted rather than assumed: if that ever changes, this refuses instead
      // of silently permitting a claim of an unclassified kind.
      fail(`allowedClaims cites "${factId}", whose kind ${record!.kind} is not a fact class`);
    }
    const claimClass = recordedClass as ClaimClass;
    if (obj.claimClass !== "automotive" && obj.claimClass !== "business") {
      fail('allowedClaims[].claimClass must be "automotive" or "business"');
    }
    if (obj.claimClass !== claimClass) {
      fail(
        `allowedClaims declares "${factId}" as ${String(obj.claimClass)}, `
        + `but the evidence records it as ${claimClass}`,
      );
    }

    const provisionalRestatement = requireBoundedString(
      obj.restatement, "allowedClaims[].restatement", TRUTH_LIMITS.restatementChars,
    );

    return {
      kind: "evidence_bound_claim",
      factId,
      factKind: record!.kind as AllowedClaimBinding["factKind"],
      claimClass,
      provisionalRestatement,
      restatementVerified: false,
    };
  });

  return {
    provisional: {
      kind: "provisional_model_prose",
      publishable: false,
      verified: false,
      assessment,
      forbiddenClaims,
      requiredCaveats,
      openQuestions,
    },
    constraints: {
      kind: "typed_claim_constraints",
      allowed,
    },
  };
}

/**
 * The only supported way to turn this stage's output into evidence records.
 *
 * Returns records from `pack.allowedFacts` for the bound ids. It cannot return
 * model prose, because it never reads a restatement or the provisional channel
 * — the ids are the entire input.
 */
export function allowedClaimRecords(
  output: AutomotiveTruthOutput,
  pack: EvidencePack,
): EvidenceRecord[] {
  const byId = new Map(
    pack.allowedFacts.filter((r) => CLASS_OF_KIND[r.kind]).map((r) => [r.id, r]),
  );
  return output.constraints.allowed
    .map((binding) => byId.get(binding.factId))
    .filter((r): r is EvidenceRecord => r !== undefined);
}

/**
 * What the content may actually assert, in the evidence system's own words.
 *
 * This is the answer to "what did automotive-truth permit?", and it is drawn
 * from the records, not from the model's restatements. A restatement that
 * overstates or reshapes its fact is contained by exactly this: it is never
 * what a downstream consumer reads back.
 */
export function allowedClaimTexts(
  output: AutomotiveTruthOutput,
  pack: EvidencePack,
): string[] {
  return allowedClaimRecords(output, pack).map((record) => record.claim);
}

/**
 * Precondition: both declared fact classes must actually be citable.
 *
 * The registry declares `verified_automotive_fact` **and**
 * `verified_business_fact` for this stage. The stage whose job is truth must not
 * run on a pack that establishes none, and nothing else in the pack is a
 * substitute — not sourced research, observations, performance evidence,
 * hypotheses, assumptions, or the raw approved-facts reference. The shared
 * boundary implementation reads `pack.allowedFacts` only, and this runs before
 * the model call so a pack without evidence costs nothing.
 */
export function assertRequiredTruthEvidence(pack: EvidencePack, registry: AgentRegistry): void {
  assertRequiredEvidenceKinds(AUTOMOTIVE_TRUTH_STAGE, registry, pack);
}

/**
 * Execute the automotive-truth stage exactly once.
 *
 * Fails closed on: a missing required fact class, an empty, malformed, or
 * oversized complete Stage 1 output, a missing asset, a runner error or timeout,
 * non-strict JSON, any structural contract violation, and any permission that is
 * fabricated, wrong-class, misdeclared, duplicated, stale, conflicted, or
 * inactive. Performs no retry and no second model call.
 *
 * It does **not** verify the truth of the returned prose — see this module's
 * header for the exact boundary.
 */
export async function executeAutomotiveTruth(
  invocation: AutomotiveTruthInvocation,
): Promise<AutomotiveTruthResult> {
  const registry = invocation.registry ?? new AgentRegistry();

  if (!invocation.evidencePack || typeof invocation.evidencePack !== "object") {
    fail("an evidence pack is required");
  }
  const strategyOutput = validateStrategyOutputInput(invocation.strategyOutput, invocation.evidencePack);
  const renderedStrategyOutput = JSON.stringify(strategyOutput, null, 2);
  if (renderedStrategyOutput.length > TRUTH_LIMITS.strategyOutputChars) {
    fail(`"strategyOutput" exceeds ${TRUTH_LIMITS.strategyOutputChars} characters`);
  }
  assertRequiredTruthEvidence(invocation.evidencePack, registry);

  // The evidence pack is the one input this stage does not itself bound: its
  // cardinality is decided by whatever the classifier produced. Guarded here
  // against the derived ceiling so an oversized pack is refused before any
  // model call rather than assembling a payload nothing sized for.
  const renderedEvidence = renderEvidenceForTruthStage(invocation.evidencePack);
  if (renderedEvidence.length > HANDOFF_GUARDS.evidencePackChars) {
    fail(`"evidencePack" exceeds ${HANDOFF_GUARDS.evidencePackChars} characters`);
  }

  const { rawText, metadata } = await invokeStage({
    stage: AUTOMOTIVE_TRUTH_STAGE,
    registry,
    runner: invocation.runner,
    // The evidence projection is the authoritative factual input. The declared
    // reference (`config/approved-facts.json`) is deliberately omitted rather
    // than injected: the pack already carries those facts classified,
    // freshness-checked, and conflict-filtered, and a raw second copy would be
    // unclassified authority competing with it — in the one stage where that
    // would matter most.
    referenceChannel: "omit",
    dataBlocks: [
      { label: "STRATEGY_OUTPUT", body: renderedStrategyOutput },
      { label: "EVIDENCE", body: renderedEvidence },
    ],
  });

  const parsed = parseStrictJsonObject(AUTOMOTIVE_TRUTH_STAGE, rawText);
  const output = validateAutomotiveTruthOutput(parsed, invocation.evidencePack);
  return { output, metadata };
}
