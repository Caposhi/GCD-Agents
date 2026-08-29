/**
 * Phase 0B.3 — the `hook-story-script` stage executor.
 *
 * Stage 3 writes the hook, the ordered story beats, and the channel-neutral
 * script. It is **implemented, not wired**: nothing in the worker, scheduler,
 * orchestrator, approval path, publication path, image path, Slack path,
 * database, evidence-write path, or the
 * `/console/content-intelligence/preview` route calls it. Executing it requires
 * a caller to construct an invocation deliberately and supply a runner.
 *
 * ## The authority boundary this stage exists to hold
 *
 * Stage 3 is where copy gets written, which makes it the stage most likely to
 * quietly re-acquire a fact that stage 2 refused. Two rules make that
 * structural rather than aspirational:
 *
 *  - **Stage 2's whitelist is the boundary, not the pack.** The factual input is
 *    derived exclusively from the evidence ids stage 2 permitted. A real,
 *    citable, perfectly valid fact sitting in `pack.allowedFacts` that stage 2
 *    did not permit is **not available here** — it is absent from the projection
 *    the model sees, and citing it fails validation. Presence in the pack is not
 *    permission.
 *  - **The complete pack is never offered as an alternate claim source.** The
 *    model receives `PERMITTED_CLAIMS`, a bounded projection of exactly the
 *    whitelisted records. It does not receive the pack's other sections. There
 *    is no second list to reach for.
 *
 * ## What this stage guarantees, exactly
 *
 * **Guaranteed:**
 *  - Every entry in the typed claim-use channel names an id that stage 2
 *    permitted. Fabricated ids, ids from another evidence class, ids the pack
 *    marked conflicted, stale, or inactive, duplicates, and real pack facts
 *    outside stage 2's whitelist all fail.
 *  - Both prior-stage outputs are **revalidated at this boundary** against the
 *    same evidence pack that bound them, using the prior stages' own
 *    validators. A caller that hands over a cast, hand-built, deserialised, or
 *    tampered object gets a refusal, not a run. Branding fields are *checked*,
 *    never *trusted*.
 *  - Prior-stage prose reaches the model only inside bounded, labelled untrusted
 *    data blocks. None of it enters the instruction channel.
 *  - The claim text a downstream consumer reads back comes from the evidence
 *    records — `scriptClaimRecords()` and `scriptClaimTexts()` take ids and
 *    never read script text.
 *
 * **NOT guaranteed — and this is the honest limit of the whole design:**
 * deterministic validation can check structure, bounds, enums, ids, and
 * membership in stage 2's whitelist. It **cannot** verify that the script's
 * prose faithfully restates the fact it cites, and it **cannot** detect an
 * uncited factual implication. A script may cite `biz-1` and then describe it
 * in words the record does not support; a script may assert something factual
 * and simply list nothing in `claimUse`. Neither is caught here.
 *
 * That is not closed by keyword matching, which would be trivially evadable and
 * would imply a semantic check the code does not perform. It is contained by
 * type: script prose returns branded `provisional_model_prose`
 * (`verified: false`, `publishable: false`), each paraphrase is separately
 * branded `paraphraseVerified: false`, and the claim-use channel is a separate
 * branded type. **No language model in this pipeline proves a statement true,
 * and nothing in this module treats one as though it did.**
 */

import { EvidenceRecord } from "../evidence/contract.js";
import { EvidencePack, unusableEvidenceIds } from "../evidence/pack.js";
import { AgentRegistry } from "./registry.js";
import type { StrategyConceptOutput } from "./strategyConcept.js";
import { validateStrategyConceptOutput } from "./strategyConcept.js";
import type { AutomotiveTruthOutput } from "./automotiveTruth.js";
import { validateAutomotiveTruthOutput } from "./automotiveTruth.js";
import {
  StageExecutionError,
  StageExecutionMetadata,
  StageRunner,
  assertRequiredEvidenceKinds,
  invokeStage,
  parseStrictJsonObject,
} from "./stageExecution.js";

export const HOOK_STORY_SCRIPT_STAGE = "hook-story-script" as const;

/** Bounds on the model's output and on the prior-stage inputs it is shown. */
export const SCRIPT_LIMITS = {
  hookChars: 300,
  beatChars: 400,
  scriptChars: 6_000,
  paraphraseChars: 400,
  openQuestionChars: 300,
  maxBeats: 8,
  maxClaimUses: 12,
  maxOpenQuestions: 6,
  strategyOutputChars: 12_000,
  truthOutputChars: 16_000,
} as const;

/** Exactly the fields the contract allows. Anything else is an extra field. */
const ALLOWED_OUTPUT_FIELDS = [
  "hook",
  "storyBeats",
  "script",
  "claimUse",
  "openQuestions",
] as const;

/** Closed set. Order is meaningful; the role names what a beat is doing. */
export const STORY_BEAT_ROLES = ["setup", "tension", "insight", "proof", "closing"] as const;
export type StoryBeatRole = (typeof STORY_BEAT_ROLES)[number];

/** Closed set. Where in the piece a permitted claim does its work. */
export const CLAIM_USE_LOCATIONS = ["hook", "beats", "script"] as const;
export type ClaimUseLocation = (typeof CLAIM_USE_LOCATIONS)[number];

export interface StoryBeat {
  beat: string;
  role: StoryBeatRole;
}

/**
 * One recorded use of a permitted claim.
 *
 * The record is `factId`. `provisionalParaphrase` is the model's wording and is
 * branded unverified beside it, so a consumer reaching for the model's sentence
 * instead of the evidence record has to do so knowingly.
 */
export interface ScriptClaimBinding {
  readonly kind: "evidence_bound_claim_use";
  /** An id stage 2 permitted. Presence in the pack alone is not enough. */
  factId: string;
  /** Taken from the pack record via stage 2's binding. Never from the model. */
  factKind: "verified_automotive_fact" | "verified_business_fact";
  usedIn: ClaimUseLocation;
  /** Model prose. Bounded in length; never checked for faithfulness. */
  provisionalParaphrase: string;
  /** Always false. No paraphrase from this stage has been checked. */
  readonly paraphraseVerified: false;
}

/**
 * The typed claim-use channel — structurally separate from the copy, so a
 * consumer cannot mistake the script for its evidence.
 */
export interface ScriptClaimUse {
  readonly kind: "typed_claim_use";
  used: ScriptClaimBinding[];
}

/**
 * Model-authored copy from this stage.
 *
 * Branded and flagged. Provisional, untrusted, and **non-publishable**: the
 * validator bounds its length and checks nothing about its meaning. The literal
 * `false` fields make "treat this copy as verified" a type error rather than an
 * oversight.
 */
export interface ProvisionalScript {
  readonly kind: "provisional_model_prose";
  /** Always false. Nothing here may be published. */
  readonly publishable: false;
  /** Always false. No copy from this stage has been checked for truth. */
  readonly verified: false;
  hook: string;
  /** Order is preserved exactly as returned; it is part of the contract. */
  storyBeats: StoryBeat[];
  script: string;
  openQuestions: string[];
}

export interface HookStoryScriptOutput {
  /** Untrusted, non-publishable model copy. Never evidence. */
  provisional: ProvisionalScript;
  /** Typed, whitelist-bound record of which permitted claims the copy uses. */
  claimUse: ScriptClaimUse;
}

export interface HookStoryScriptResult {
  output: HookStoryScriptOutput;
  metadata: StageExecutionMetadata;
}

export interface HookStoryScriptInvocation {
  /**
   * The complete typed output from stage 1. Review context only: untrusted
   * data, never a source of truth, never instructions, never a permission.
   */
  strategyOutput: StrategyConceptOutput;
  /**
   * The complete typed output from stage 2. Its permitted-claim bindings are
   * the sole factual authority for this stage; its prose is review context on
   * the same untrusted terms as stage 1's.
   */
  truthOutput: AutomotiveTruthOutput;
  /** The same pack that bound both prior outputs. Revalidated against it. */
  evidencePack: EvidencePack;
  registry?: AgentRegistry;
  runner: StageRunner;
}

const fail = (message: string): never => {
  throw new StageExecutionError(HOOK_STORY_SCRIPT_STAGE, message);
};

function requireBoundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") fail(`"${field}" must be a string`);
  const text = (value as string).trim();
  if (!text) fail(`"${field}" must not be empty`);
  if (text.length > max) fail(`"${field}" exceeds ${max} characters`);
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

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`"${label}" must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Revalidate stage 1's output at this boundary.
 *
 * Callers hold a compile-time `StrategyConceptOutput`, but a cast, a JSON round
 * trip, or a JavaScript caller can still deliver something malformed. Rebuilding
 * the stage 1 validator's input and running it re-binds every citation against
 * this pack, so the branding fields are *checked* rather than treated as
 * authority.
 */
function revalidateStrategyOutput(value: unknown, pack: EvidencePack): StrategyConceptOutput {
  const output = requireObject(value, "strategyOutput");
  requireExactKeys(output, ["provisional", "evidence"], "strategyOutput");
  const provisional = requireObject(output.provisional, "strategyOutput.provisional");
  const evidence = requireObject(output.evidence, "strategyOutput.evidence");
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
 * Revalidate stage 2's output at this boundary.
 *
 * Same reasoning as stage 1's, and it matters more here: this object *is* the
 * factual authority for stage 3. Rebuilding stage 2's validator input re-binds
 * every permitted id against this pack, re-checks the recorded class against the
 * declared one, and rejects duplicated, conflicted, stale, or inactive ids —
 * so a tampered whitelist cannot widen what stage 3 may say.
 */
function revalidateTruthOutput(value: unknown, pack: EvidencePack): AutomotiveTruthOutput {
  const output = requireObject(value, "truthOutput");
  requireExactKeys(output, ["provisional", "constraints"], "truthOutput");
  const provisional = requireObject(output.provisional, "truthOutput.provisional");
  const constraints = requireObject(output.constraints, "truthOutput.constraints");
  requireExactKeys(
    provisional,
    ["kind", "publishable", "verified", "assessment", "forbiddenClaims", "requiredCaveats", "openQuestions"],
    "truthOutput.provisional",
  );
  requireExactKeys(constraints, ["kind", "allowed"], "truthOutput.constraints");
  if (provisional.kind !== "provisional_model_prose"
      || provisional.publishable !== false
      || provisional.verified !== false) {
    fail('"truthOutput.provisional" has invalid boundary branding');
  }
  if (constraints.kind !== "typed_claim_constraints") {
    fail('"truthOutput.constraints" has invalid boundary branding');
  }
  if (!Array.isArray(constraints.allowed)) fail('"truthOutput.constraints.allowed" must be an array');

  const allowedClaims = (constraints.allowed as unknown[]).map((entry, index) => {
    const binding = requireObject(entry, `truthOutput.constraints.allowed[${index}]`);
    requireExactKeys(
      binding,
      ["kind", "factId", "factKind", "claimClass", "provisionalRestatement", "restatementVerified"],
      `truthOutput.constraints.allowed[${index}]`,
    );
    if (binding.kind !== "evidence_bound_claim" || binding.restatementVerified !== false) {
      fail(`"truthOutput.constraints.allowed[${index}]" has invalid boundary branding`);
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
    return fail(`"truthOutput" is invalid: ${detail}`);
  }
}

/**
 * The evidence records stage 2 permitted, in stage 2's order.
 *
 * This is the whole factual surface of stage 3. It is derived from the
 * whitelist, so a pack fact stage 2 omitted simply is not in it.
 */
export function permittedClaimRecords(
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
): EvidenceRecord[] {
  const byId = new Map(pack.allowedFacts.map((r) => [r.id, r]));
  const blocked = unusableEvidenceIds(pack);
  return truthOutput.constraints.allowed
    .map((binding) => byId.get(binding.factId))
    .filter((r): r is EvidenceRecord => r !== undefined && !blocked.has(r.id));
}

/**
 * The bounded projection stage 3's model is shown.
 *
 * Deliberately **not** `renderEvidencePackForStage`. Showing this stage the
 * whole pack would hand it a second, wider list of facts alongside the one it is
 * allowed to use, which is precisely the widening this stage must not do. Only
 * the whitelisted records appear, each with the evidence system's own wording
 * and its authoritative `kind`.
 */
export function renderPermittedClaims(
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
): string {
  return JSON.stringify(
    permittedClaimRecords(truthOutput, pack).map((record) => ({
      id: record.id,
      kind: record.kind,
      claim: record.claim,
      ...(record.attribute ? { attribute: record.attribute } : {}),
    })),
    null,
    2,
  );
}

/**
 * Validate the model's object and bind every claim use to stage 2's whitelist.
 *
 * Structural checks come first so a malformed shape fails before any id work.
 *
 * **Scope of this function, stated precisely.** It validates *shape*, *bounds*,
 * *enums*, and *whitelist membership*. It does not evaluate whether the hook,
 * the beats, or the script are true, whether a paraphrase faithfully renders the
 * fact it cites, or whether the copy asserts something factual that it failed to
 * cite at all. Those strings are returned inside `provisional` and inside
 * `ScriptClaimBinding.provisionalParaphrase`, each branded unverified.
 */
export function validateHookStoryScriptOutput(
  raw: Record<string, unknown>,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
): HookStoryScriptOutput {
  requireExactKeys(raw, [...ALLOWED_OUTPUT_FIELDS], "output");

  const hook = requireBoundedString(raw.hook, "hook", SCRIPT_LIMITS.hookChars);
  const script = requireBoundedString(raw.script, "script", SCRIPT_LIMITS.scriptChars);

  if (!Array.isArray(raw.storyBeats)) fail('"storyBeats" must be an array');
  const rawBeats = raw.storyBeats as unknown[];
  if (!rawBeats.length) fail('"storyBeats" must contain at least one beat');
  if (rawBeats.length > SCRIPT_LIMITS.maxBeats) {
    fail(`"storyBeats" exceeds ${SCRIPT_LIMITS.maxBeats} entries`);
  }
  const storyBeats: StoryBeat[] = rawBeats.map((entry, index) => {
    const obj = requireObject(entry, `storyBeats[${index}]`);
    requireExactKeys(obj, ["beat", "role"], "storyBeats entry");
    const beat = requireBoundedString(obj.beat, "storyBeats[].beat", SCRIPT_LIMITS.beatChars);
    if (!(STORY_BEAT_ROLES as readonly string[]).includes(obj.role as string)) {
      fail(`storyBeats[].role must be one of: ${STORY_BEAT_ROLES.join(", ")}`);
    }
    return { beat, role: obj.role as StoryBeatRole };
  });

  const openQuestions = requireBoundedStringArray(
    raw.openQuestions, "openQuestions", SCRIPT_LIMITS.maxOpenQuestions, SCRIPT_LIMITS.openQuestionChars,
  );

  // --- binding: stage 2's whitelist is the boundary, not the pack -----------
  //
  // `permittedById` is built from the whitelist. A real, citable fact that
  // stage 2 did not permit is absent from this map and therefore fails, which is
  // the difference between "this fact exists" and "this fact may be said".
  const permittedById = new Map(
    permittedClaimRecords(truthOutput, pack).map((record) => [record.id, record]),
  );

  if (!Array.isArray(raw.claimUse)) fail('"claimUse" must be an array');
  const rawClaimUse = raw.claimUse as unknown[];
  if (rawClaimUse.length > SCRIPT_LIMITS.maxClaimUses) {
    fail(`"claimUse" exceeds ${SCRIPT_LIMITS.maxClaimUses} entries`);
  }
  const seen = new Set<string>();
  const used: ScriptClaimBinding[] = rawClaimUse.map((entry, index) => {
    const obj = requireObject(entry, `claimUse[${index}]`);
    requireExactKeys(obj, ["factId", "usedIn", "paraphrase"], "claimUse entry");

    const factId = requireBoundedString(obj.factId, "claimUse[].factId", 200);
    const record = permittedById.get(factId);
    if (!record) {
      fail(
        `claimUse cites "${factId}", which automotive-truth did not permit `
        + "(a fabricated id, an id of another evidence class, or a pack fact outside the whitelist)",
      );
    }
    if (seen.has(factId)) fail(`claimUse cites "${factId}" more than once`);
    seen.add(factId);

    if (!(CLAIM_USE_LOCATIONS as readonly string[]).includes(obj.usedIn as string)) {
      fail(`claimUse[].usedIn must be one of: ${CLAIM_USE_LOCATIONS.join(", ")}`);
    }
    const provisionalParaphrase = requireBoundedString(
      obj.paraphrase, "claimUse[].paraphrase", SCRIPT_LIMITS.paraphraseChars,
    );

    return {
      kind: "evidence_bound_claim_use",
      factId,
      factKind: record!.kind as ScriptClaimBinding["factKind"],
      usedIn: obj.usedIn as ClaimUseLocation,
      provisionalParaphrase,
      paraphraseVerified: false,
    };
  });

  return {
    provisional: {
      kind: "provisional_model_prose",
      publishable: false,
      verified: false,
      hook,
      storyBeats,
      script,
      openQuestions,
    },
    claimUse: {
      kind: "typed_claim_use",
      used,
    },
  };
}

/**
 * The only supported way to turn this stage's output into evidence records.
 *
 * Returns the exact permitted records for the bound ids. It cannot return copy,
 * because it never reads a paraphrase, the hook, the beats, or the script — the
 * ids are the entire input.
 */
export function scriptClaimRecords(
  output: HookStoryScriptOutput,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
): EvidenceRecord[] {
  const permittedById = new Map(
    permittedClaimRecords(truthOutput, pack).map((record) => [record.id, record]),
  );
  return output.claimUse.used
    .map((binding) => permittedById.get(binding.factId))
    .filter((r): r is EvidenceRecord => r !== undefined);
}

/**
 * What the script's cited claims actually say, in the evidence system's words.
 *
 * Drawn from the records, never from the paraphrases. A paraphrase that
 * overstates its fact is contained by exactly this: it is not what a downstream
 * consumer reads back. It is **not** contained by anything detecting the
 * overstatement, because nothing here does.
 */
export function scriptClaimTexts(
  output: HookStoryScriptOutput,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
): string[] {
  return scriptClaimRecords(output, truthOutput, pack).map((record) => record.claim);
}

/**
 * Precondition inherited from this stage's registry entry.
 *
 * Kept because it is cheap and consistent with the other stages, but it is
 * **not** this stage's real authority gate — stage 2's whitelist is. Any pack
 * that reached stage 3 legitimately already satisfied stage 2's stricter
 * requirement, so this can only catch a caller assembling stages out of order.
 */
export function assertRequiredScriptEvidence(pack: EvidencePack, registry: AgentRegistry): void {
  assertRequiredEvidenceKinds(HOOK_STORY_SCRIPT_STAGE, registry, pack);
}

/**
 * Execute the hook-story-script stage exactly once.
 *
 * Fails closed on: a malformed, incompletely branded, or oversized prior-stage
 * output; a prior-stage output that does not revalidate against this pack; an
 * empty permitted-claim whitelist; a missing asset; a runner error or timeout;
 * non-strict JSON; any structural contract violation; and any claim use that is
 * fabricated, duplicated, or outside stage 2's whitelist. Performs no retry and
 * no second model call.
 *
 * **The zero-permitted-claims decision, made explicitly.** When stage 2
 * permitted nothing, this stage **refuses before the model call** rather than
 * producing a "clearly non-factual" draft. Both options were considered. A draft
 * would be a finished-looking script whose every concrete statement is
 * unfounded, handed to stages that have no mechanism to keep it non-factual —
 * and asking a model to write compelling copy with no permitted facts is a
 * direct invitation to supply its own. Refusing costs one model call that could
 * not have produced usable output, surfaces the real problem (the evidence or
 * stage 2's review, not the copy), and is the fail-closed direction. The cost is
 * accepted honestly: a purely stylistic piece that legitimately asserts nothing
 * cannot be produced by this stage, and would need its own authorised contract
 * rather than a silent widening of this one.
 *
 * It does **not** verify that the script is true or that a paraphrase is
 * faithful — see this module's header for the exact boundary.
 */
export async function executeHookStoryScript(
  invocation: HookStoryScriptInvocation,
): Promise<HookStoryScriptResult> {
  const registry = invocation.registry ?? new AgentRegistry();

  if (!invocation.evidencePack || typeof invocation.evidencePack !== "object") {
    fail("an evidence pack is required");
  }
  const pack = invocation.evidencePack;

  const strategyOutput = revalidateStrategyOutput(invocation.strategyOutput, pack);
  const truthOutput = revalidateTruthOutput(invocation.truthOutput, pack);

  const renderedStrategyOutput = JSON.stringify(strategyOutput, null, 2);
  if (renderedStrategyOutput.length > SCRIPT_LIMITS.strategyOutputChars) {
    fail(`"strategyOutput" exceeds ${SCRIPT_LIMITS.strategyOutputChars} characters`);
  }
  const renderedTruthOutput = JSON.stringify(truthOutput, null, 2);
  if (renderedTruthOutput.length > SCRIPT_LIMITS.truthOutputChars) {
    fail(`"truthOutput" exceeds ${SCRIPT_LIMITS.truthOutputChars} characters`);
  }

  assertRequiredScriptEvidence(pack, registry);

  const permitted = permittedClaimRecords(truthOutput, pack);
  if (!permitted.length) {
    // See the zero-permitted-claims decision in this function's documentation.
    fail("automotive-truth permitted no claims: refusing to write copy with no factual authority");
  }

  const { rawText, metadata } = await invokeStage({
    stage: HOOK_STORY_SCRIPT_STAGE,
    registry,
    runner: invocation.runner,
    // This stage declares no reference asset. The setting is explicit anyway, so
    // that adding one later is a deliberate reviewed act rather than something
    // that silently starts entering a channel.
    referenceChannel: "omit",
    dataBlocks: [
      { label: "STRATEGY_OUTPUT", body: renderedStrategyOutput },
      { label: "TRUTH_OUTPUT", body: renderedTruthOutput },
      { label: "PERMITTED_CLAIMS", body: renderPermittedClaims(truthOutput, pack) },
    ],
  });

  const parsed = parseStrictJsonObject(HOOK_STORY_SCRIPT_STAGE, rawText);
  const output = validateHookStoryScriptOutput(parsed, truthOutput, pack);
  return { output, metadata };
}
