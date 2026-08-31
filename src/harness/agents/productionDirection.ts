/**
 * Phase 0B.4 — the `production-direction` stage executor.
 *
 * Stage 4 directs what is filmed or made: the visual approach, an ordered shot
 * list, framing, movement, continuity, overlay-text planning, and production
 * requirements. It is **implemented, not wired**: nothing in the worker,
 * scheduler, orchestrator, approval path, publication path, image-generation
 * path, Slack path, database, evidence-write path, or the
 * `/console/content-intelligence/preview` route calls it. Executing it requires
 * a caller to construct an invocation deliberately and supply a runner.
 *
 * ## The authority boundary this stage exists to hold
 *
 * Each stage narrows the previous one, and stage 4 narrows the hardest, because
 * a picture asserts as surely as a sentence and is far harder to audit.
 *
 *  - **Stage 3's *used* claims are the boundary** — not stage 2's whitelist, and
 *    not the evidence pack. A fact stage 2 permitted but stage 3 never bound is
 *    **not available here**: it is absent from the projection the model sees,
 *    and citing it fails validation. A fact merely sitting in
 *    `pack.allowedFacts` is absent for the same reason, one step further out.
 *  - **The complete pack is never rendered to this model**, and neither is
 *    stage 2's provisional prose. Stage 2's output is required here only so
 *    stage 3's bindings can be structurally revalidated; it is an input to the
 *    *validator*, not to the *model*. Sending its assessment, restatements,
 *    caveats and forbidden-claim prose along would hand the model a wider,
 *    unused set of claims to reach for.
 *  - The model receives exactly two blocks: the complete stage 3 result as
 *    bounded untrusted data, and `SCRIPT_CLAIMS` — the exact evidence records
 *    bound by stage 3's claim-use ids.
 *
 * ## What this stage guarantees, exactly
 *
 * **Guaranteed:**
 *  - Every entry in the typed visual-claim channel names an id stage 3 actually
 *    used. Fabricated ids, pack-only ids, stage-2-permitted-but-stage-3-unused
 *    ids, and duplicates all fail.
 *  - Every `shotIndex` names a shot the model returned.
 *  - Both prior-stage values are revalidated against the same evidence pack,
 *    using the owning stages' own exported validators, before any model call.
 *  - Prior-stage prose reaches the model only inside bounded, labelled untrusted
 *    data blocks. None of it enters the instruction channel.
 *  - The claim text a downstream consumer reads back comes from the evidence
 *    records — `visualClaimRecords()` and `visualClaimTexts()` take ids and
 *    never read direction prose.
 *
 * **The limit on that revalidation, stated exactly.** Prior-stage values are
 * treated as untrusted and revalidated against the same evidence pack. Values
 * that fail the prior contracts are refused before the model call. This is
 * structural validation, not provenance or authenticity verification; a
 * structurally valid deserialized or hand-built value can pass.
 *
 * **NOT guaranteed — the honest limit of a stage that directs pictures:**
 * deterministic validation can check structure, bounds, enums, ids, indices, and
 * membership in stage 3's used-claim set. It **cannot**:
 *
 *  - prove that a shot accurately represents reality;
 *  - verify that a requested asset exists or is available;
 *  - establish ownership, releases, consent, location, make or model
 *    availability, or safe physical feasibility;
 *  - prove that overlay wording faithfully restates its cited record;
 *  - detect every uncited factual or visual implication.
 *
 * None of that is closed by keyword matching, which would be trivially evadable
 * and would imply a semantic check the code does not perform. It is contained by
 * type: direction returns branded `provisional_model_prose` carrying
 * `verified: false`, `publishable: false`, **and `executable: false`**; overlay
 * wording is separately branded `wordingVerified: false`; production
 * requirements are separately branded `availabilityVerified: false`; and the
 * visual-claim channel is a separate branded type. **No language model in this
 * pipeline proves a statement true or an asset real, and nothing in this module
 * treats one as though it did.**
 *
 * ## What this stage is not allowed to do
 *
 * It produces direction only. It does not generate, download, inspect, resize,
 * transcode, hash, host, or store media; select an image provider or model;
 * return URLs, digests, QC results, provenance, hosted flags, or approval state;
 * perform platform adaptation, cropping, feed-profile selection, translation,
 * alt-text localisation, hashtags, timing, scheduling, approval, or publication;
 * assert that a person, shop, vehicle, repair, result, asset, location,
 * promotion, or before/after evidence exists; or contact any external system.
 * Those belong to deterministic runtime services, human production, later
 * stages, or existing production code.
 */

import { EvidenceRecord } from "../evidence/contract.js";
import { EvidencePack } from "../evidence/pack.js";
import { AgentRegistry, AgentStageId } from "./registry.js";
import type { AutomotiveTruthOutput } from "./automotiveTruth.js";
import { revalidateAutomotiveTruthOutput } from "./automotiveTruth.js";
import type { HookStoryScriptOutput } from "./hookStoryScript.js";
import { revalidateHookStoryScriptOutput, scriptClaimRecords } from "./hookStoryScript.js";
import {
  StageExecutionError,
  StageExecutionMetadata,
  StageRunner,
  assertRequiredEvidenceKinds,
  invokeStage,
  parseStrictJsonObject,
} from "./stageExecution.js";

export const PRODUCTION_DIRECTION_STAGE = "production-direction" as const;

/** Bounds on the model's output and on the prior-stage values it is shown. */
export const DIRECTION_LIMITS = {
  visualApproachChars: 1_500,
  subjectChars: 300,
  actionChars: 400,
  compositionChars: 400,
  continuityChars: 300,
  overlayTextChars: 200,
  requirementChars: 300,
  directionSummaryChars: 400,
  openQuestionChars: 300,
  maxShots: 10,
  maxOverlayText: 10,
  maxRequirements: 12,
  maxClaimVisuals: 12,
  maxOpenQuestions: 6,
  scriptOutputChars: 20_000,
} as const;

/** Exactly the fields the contract allows. Anything else is an extra field. */
const ALLOWED_OUTPUT_FIELDS = [
  "visualApproach",
  "shots",
  "overlayText",
  "productionRequirements",
  "claimVisuals",
  "openQuestions",
] as const;

/** Closed set. What a shot is for; order is meaningful, the role is not free text. */
export const SHOT_PURPOSES = [
  "establishing", "context", "demonstration", "detail", "reaction", "closing",
] as const;
export type ShotPurpose = (typeof SHOT_PURPOSES)[number];

/** Closed set. Channel-neutral framing — never a pixel size or aspect ratio. */
export const SHOT_FRAMINGS = ["wide", "medium", "close", "macro", "over-the-shoulder"] as const;
export type ShotFraming = (typeof SHOT_FRAMINGS)[number];

/** Closed set. One movement per shot. */
export const SHOT_MOVEMENTS = ["static", "pan", "tilt", "push-in", "pull-out", "handheld"] as const;
export type ShotMovement = (typeof SHOT_MOVEMENTS)[number];

/** Closed set. Why a piece of wording is in frame at all. */
export const OVERLAY_ROLES = ["label", "emphasis", "clarification"] as const;
export type OverlayRole = (typeof OVERLAY_ROLES)[number];

/** Closed set. What kind of thing a human must provide or refuse. */
export const REQUIREMENT_CATEGORIES = [
  "location", "vehicle", "person", "equipment", "prop", "permission",
] as const;
export type RequirementCategory = (typeof REQUIREMENT_CATEGORIES)[number];

export interface ProductionShot {
  purpose: ShotPurpose;
  subject: string;
  framing: ShotFraming;
  movement: ShotMovement;
  action: string;
  composition: string;
  continuityNote: string;
}

/**
 * Wording planned for the frame.
 *
 * Branded unverified on its own, because overlay text is the place where a
 * narrow fact most easily becomes a broad one: it is short, emphatic, and read
 * as caption-grade truth.
 */
export interface OverlayTextPlan {
  text: string;
  /** Index into `shots`. Validated against the shots actually returned. */
  shotIndex: number;
  role: OverlayRole;
  /** Always false. No overlay wording from this stage has been checked. */
  readonly wordingVerified: false;
}

/**
 * Something a human must provide or refuse.
 *
 * Deliberately *not* an assertion that the thing exists. Nothing in this
 * pipeline can check whether a location, vehicle, person, prop, or permission is
 * real, owned, available, safe, or consented to, so the type refuses to imply it.
 */
export interface ProductionRequirement {
  requirement: string;
  category: RequirementCategory;
  /** Always false. Existence, ownership, availability and consent are unchecked. */
  readonly availabilityVerified: false;
}

/**
 * One recorded use of a stage 3 claim in the visual plan.
 *
 * The record is `factId` and `shotIndex`. `provisionalDirectionSummary` is the
 * model's wording, branded unverified beside it.
 */
export interface VisualClaimBinding {
  readonly kind: "evidence_bound_visual_use";
  /** An id stage 3 actually used. Stage 2's permission alone is not enough. */
  factId: string;
  /** Taken from the pack record via stage 3's binding. Never from the model. */
  factKind: "verified_automotive_fact" | "verified_business_fact";
  /** Index into `shots`. Validated against the shots actually returned. */
  shotIndex: number;
  /** Model prose. Bounded in length; never checked for faithfulness. */
  provisionalDirectionSummary: string;
  /** Always false. No direction from this stage has been checked. */
  readonly directionVerified: false;
}

/**
 * The typed visual-claim channel — structurally separate from the direction, so
 * a consumer cannot mistake a shot description for its evidence.
 */
export interface VisualClaimUse {
  readonly kind: "typed_visual_claim_use";
  used: VisualClaimBinding[];
}

/**
 * Model-authored direction from this stage.
 *
 * Branded and flagged. Provisional, untrusted, **non-publishable**, and
 * **non-executable**: nothing here may be handed to a generator, a camera, or a
 * publishing path as an instruction. The literal `false` fields make "treat this
 * plan as verified" or "run this plan" a type error rather than an oversight.
 */
export interface ProvisionalProductionPlan {
  readonly kind: "provisional_model_prose";
  /** Always false. Nothing here may be published. */
  readonly publishable: false;
  /** Always false. No direction from this stage has been checked for truth. */
  readonly verified: false;
  /** Always false. This is a plan for humans, not an instruction for a runtime. */
  readonly executable: false;
  visualApproach: string;
  /** Order is preserved exactly as returned; it is part of the contract. */
  shots: ProductionShot[];
  overlayText: OverlayTextPlan[];
  productionRequirements: ProductionRequirement[];
  openQuestions: string[];
}

export interface ProductionDirectionOutput {
  /** Untrusted, non-publishable, non-executable model direction. Never evidence. */
  provisional: ProvisionalProductionPlan;
  /** Typed, used-claim-bound record of which shot carries which fact. */
  claimVisuals: VisualClaimUse;
}

export interface ProductionDirectionResult {
  output: ProductionDirectionOutput;
  metadata: StageExecutionMetadata;
}

export interface ProductionDirectionInvocation {
  /**
   * The complete typed output from stage 3. Creative context only: untrusted
   * data, never a source of truth, never instructions.
   */
  scriptOutput: HookStoryScriptOutput;
  /**
   * The complete typed output from stage 2.
   *
   * Required to revalidate stage 3's bindings structurally. It is **not** shown
   * to the model: its whitelist is wider than what stage 3 used, and its prose
   * would be a second, unused set of claims to reach for.
   */
  truthOutput: AutomotiveTruthOutput;
  /** The same pack that bound both prior outputs. Revalidated against it. */
  evidencePack: EvidencePack;
  registry?: AgentRegistry;
  runner: StageRunner;
}

const fail = (message: string): never => {
  throw new StageExecutionError(PRODUCTION_DIRECTION_STAGE, message);
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

function requireEnum<T extends string>(
  value: unknown, allowed: readonly T[], field: string,
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(`"${field}" must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function requireShotIndex(value: unknown, field: string, shotCount: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(`"${field}" must be an integer shot index`);
  }
  const index = value as number;
  if (index < 0 || index >= shotCount) {
    fail(`"${field}" names shot ${index}, but only ${shotCount} shot(s) were returned`);
  }
  return index;
}

/**
 * The evidence records stage 3 actually used, in stage 3's order.
 *
 * This is the whole factual surface of stage 4, and it is deliberately narrower
 * than stage 3's own surface: it is derived from `scriptClaimRecords()`, so a
 * fact stage 2 permitted but stage 3 left unused simply is not in it.
 */
export function scriptUsedClaimRecords(
  scriptOutput: HookStoryScriptOutput,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
): EvidenceRecord[] {
  return scriptClaimRecords(scriptOutput, truthOutput, pack);
}

/**
 * The bounded projection stage 4's model is shown.
 *
 * Deliberately **not** the evidence pack and **not** stage 2's whitelist.
 * Showing either would hand this stage a wider set of facts than the piece
 * actually uses, which is precisely the widening a visual stage must not do.
 * Only the used records appear, each with the evidence system's own wording and
 * its authoritative `kind`.
 */
export function renderScriptClaims(
  scriptOutput: HookStoryScriptOutput,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
): string {
  return JSON.stringify(
    scriptUsedClaimRecords(scriptOutput, truthOutput, pack).map((record) => ({
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
 * Validate the model's object and bind every visual claim use to stage 3's used
 * claims.
 *
 * Structural checks come first so a malformed shape fails before any id work.
 *
 * **Scope of this function, stated precisely.** It validates *shape*, *bounds*,
 * *enums*, *shot indices*, and *membership in stage 3's used-claim set*. It does
 * not evaluate whether a shot represents reality, whether a requested asset
 * exists or may lawfully be used, whether an action is safe, whether overlay
 * wording faithfully renders its cited record, or whether the plan asserts
 * something visual that it failed to cite at all.
 */
export function validateProductionDirectionOutput(
  raw: Record<string, unknown>,
  scriptOutput: HookStoryScriptOutput,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
): ProductionDirectionOutput {
  requireExactKeys(raw, [...ALLOWED_OUTPUT_FIELDS], "output");

  const visualApproach = requireBoundedString(
    raw.visualApproach, "visualApproach", DIRECTION_LIMITS.visualApproachChars,
  );

  if (!Array.isArray(raw.shots)) fail('"shots" must be an array');
  const rawShots = raw.shots as unknown[];
  if (!rawShots.length) fail('"shots" must contain at least one shot');
  if (rawShots.length > DIRECTION_LIMITS.maxShots) {
    fail(`"shots" exceeds ${DIRECTION_LIMITS.maxShots} entries`);
  }
  const shots: ProductionShot[] = rawShots.map((entry, index) => {
    const obj = requireObject(entry, `shots[${index}]`);
    requireExactKeys(
      obj,
      ["purpose", "subject", "framing", "movement", "action", "composition", "continuityNote"],
      "shots entry",
    );
    return {
      purpose: requireEnum(obj.purpose, SHOT_PURPOSES, "shots[].purpose"),
      subject: requireBoundedString(obj.subject, "shots[].subject", DIRECTION_LIMITS.subjectChars),
      framing: requireEnum(obj.framing, SHOT_FRAMINGS, "shots[].framing"),
      movement: requireEnum(obj.movement, SHOT_MOVEMENTS, "shots[].movement"),
      action: requireBoundedString(obj.action, "shots[].action", DIRECTION_LIMITS.actionChars),
      composition: requireBoundedString(obj.composition, "shots[].composition", DIRECTION_LIMITS.compositionChars),
      continuityNote: requireBoundedString(obj.continuityNote, "shots[].continuityNote", DIRECTION_LIMITS.continuityChars),
    };
  });

  if (!Array.isArray(raw.overlayText)) fail('"overlayText" must be an array');
  const rawOverlay = raw.overlayText as unknown[];
  if (rawOverlay.length > DIRECTION_LIMITS.maxOverlayText) {
    fail(`"overlayText" exceeds ${DIRECTION_LIMITS.maxOverlayText} entries`);
  }
  const overlayText: OverlayTextPlan[] = rawOverlay.map((entry, index) => {
    const obj = requireObject(entry, `overlayText[${index}]`);
    requireExactKeys(obj, ["text", "shotIndex", "role"], "overlayText entry");
    return {
      text: requireBoundedString(obj.text, "overlayText[].text", DIRECTION_LIMITS.overlayTextChars),
      shotIndex: requireShotIndex(obj.shotIndex, "overlayText[].shotIndex", shots.length),
      role: requireEnum(obj.role, OVERLAY_ROLES, "overlayText[].role"),
      wordingVerified: false,
    };
  });

  if (!Array.isArray(raw.productionRequirements)) fail('"productionRequirements" must be an array');
  const rawRequirements = raw.productionRequirements as unknown[];
  if (rawRequirements.length > DIRECTION_LIMITS.maxRequirements) {
    fail(`"productionRequirements" exceeds ${DIRECTION_LIMITS.maxRequirements} entries`);
  }
  const productionRequirements: ProductionRequirement[] = rawRequirements.map((entry, index) => {
    const obj = requireObject(entry, `productionRequirements[${index}]`);
    requireExactKeys(obj, ["requirement", "category"], "productionRequirements entry");
    return {
      requirement: requireBoundedString(
        obj.requirement, "productionRequirements[].requirement", DIRECTION_LIMITS.requirementChars,
      ),
      category: requireEnum(obj.category, REQUIREMENT_CATEGORIES, "productionRequirements[].category"),
      availabilityVerified: false,
    };
  });

  const openQuestions = requireBoundedStringArray(
    raw.openQuestions, "openQuestions", DIRECTION_LIMITS.maxOpenQuestions, DIRECTION_LIMITS.openQuestionChars,
  );

  // --- binding: stage 3's USED claims are the boundary ----------------------
  //
  // `usedById` is built from what stage 3 bound. A fact stage 2 permitted but
  // stage 3 never used is absent from this map, as is any other pack fact — the
  // difference between "this may be said" and "this piece actually says it".
  const usedById = new Map(
    scriptUsedClaimRecords(scriptOutput, truthOutput, pack).map((record) => [record.id, record]),
  );

  if (!Array.isArray(raw.claimVisuals)) fail('"claimVisuals" must be an array');
  const rawClaimVisuals = raw.claimVisuals as unknown[];
  if (rawClaimVisuals.length > DIRECTION_LIMITS.maxClaimVisuals) {
    fail(`"claimVisuals" exceeds ${DIRECTION_LIMITS.maxClaimVisuals} entries`);
  }
  const seen = new Set<string>();
  const used: VisualClaimBinding[] = rawClaimVisuals.map((entry, index) => {
    const obj = requireObject(entry, `claimVisuals[${index}]`);
    requireExactKeys(obj, ["factId", "shotIndex", "directionSummary"], "claimVisuals entry");

    const factId = requireBoundedString(obj.factId, "claimVisuals[].factId", 200);
    const record = usedById.get(factId);
    if (!record) {
      fail(
        `claimVisuals cites "${factId}", which hook-story-script did not use `
        + "(a fabricated id, a pack fact, or a claim automotive-truth permitted but the script never bound)",
      );
    }
    if (seen.has(factId)) fail(`claimVisuals cites "${factId}" more than once`);
    seen.add(factId);

    return {
      kind: "evidence_bound_visual_use",
      factId,
      factKind: record!.kind as VisualClaimBinding["factKind"],
      shotIndex: requireShotIndex(obj.shotIndex, "claimVisuals[].shotIndex", shots.length),
      provisionalDirectionSummary: requireBoundedString(
        obj.directionSummary, "claimVisuals[].directionSummary", DIRECTION_LIMITS.directionSummaryChars,
      ),
      directionVerified: false,
    };
  });

  return {
    provisional: {
      kind: "provisional_model_prose",
      publishable: false,
      verified: false,
      executable: false,
      visualApproach,
      shots,
      overlayText,
      productionRequirements,
      openQuestions,
    },
    claimVisuals: {
      kind: "typed_visual_claim_use",
      used,
    },
  };
}

/**
 * Revalidate a supplied `ProductionDirectionOutput` against the stage 3 chain and
 * an evidence pack.
 *
 * Lives here, in the owning module, for the same reason stage 2's and stage 3's
 * do: the next stage needs it, and a divergent copy could accept something this
 * contract rejects. Rebuilding this stage's validator input re-binds every
 * visual claim use against the stage 3 used-claim set and re-checks every shot
 * index, so a value naming an id stage 3 never used — or a shot that does not
 * exist — is refused.
 *
 * **The limit, stated exactly.** Prior-stage values are treated as untrusted and
 * revalidated against the same evidence pack. Values that fail the prior
 * contracts are refused before the model call. This is structural validation,
 * not provenance or authenticity verification; a structurally valid deserialized
 * or hand-built value can pass.
 */
export function revalidateProductionDirectionOutput(
  value: unknown,
  scriptOutput: HookStoryScriptOutput,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
  stage: AgentStageId = PRODUCTION_DIRECTION_STAGE,
  label = "directionOutput",
): ProductionDirectionOutput {
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
  exact(output, ["provisional", "claimVisuals"], label);
  const provisional = obj(output.provisional, `${label}.provisional`);
  const claimVisuals = obj(output.claimVisuals, `${label}.claimVisuals`);
  exact(
    provisional,
    ["kind", "publishable", "verified", "executable", "visualApproach", "shots",
     "overlayText", "productionRequirements", "openQuestions"],
    `${label}.provisional`,
  );
  exact(claimVisuals, ["kind", "used"], `${label}.claimVisuals`);
  if (provisional.kind !== "provisional_model_prose"
      || provisional.publishable !== false
      || provisional.verified !== false
      || provisional.executable !== false) {
    failHere(`"${label}.provisional" has invalid boundary branding`);
  }
  if (claimVisuals.kind !== "typed_visual_claim_use") {
    failHere(`"${label}.claimVisuals" has invalid boundary branding`);
  }
  if (!Array.isArray(provisional.overlayText)) failHere(`"${label}.provisional.overlayText" must be an array`);
  if (!Array.isArray(provisional.productionRequirements)) {
    failHere(`"${label}.provisional.productionRequirements" must be an array`);
  }
  if (!Array.isArray(claimVisuals.used)) failHere(`"${label}.claimVisuals.used" must be an array`);

  const rebuiltOverlay = (provisional.overlayText as unknown[]).map((entry, index) => {
    const o = obj(entry, `${label}.provisional.overlayText[${index}]`);
    exact(o, ["text", "shotIndex", "role", "wordingVerified"], `${label}.provisional.overlayText[${index}]`);
    if (o.wordingVerified !== false) {
      failHere(`"${label}.provisional.overlayText[${index}]" has invalid boundary branding`);
    }
    return { text: o.text, shotIndex: o.shotIndex, role: o.role };
  });
  const rebuiltRequirements = (provisional.productionRequirements as unknown[]).map((entry, index) => {
    const o = obj(entry, `${label}.provisional.productionRequirements[${index}]`);
    exact(o, ["requirement", "category", "availabilityVerified"], `${label}.provisional.productionRequirements[${index}]`);
    if (o.availabilityVerified !== false) {
      failHere(`"${label}.provisional.productionRequirements[${index}]" has invalid boundary branding`);
    }
    return { requirement: o.requirement, category: o.category };
  });
  const rebuiltClaimVisuals = (claimVisuals.used as unknown[]).map((entry, index) => {
    const o = obj(entry, `${label}.claimVisuals.used[${index}]`);
    exact(
      o,
      ["kind", "factId", "factKind", "shotIndex", "provisionalDirectionSummary", "directionVerified"],
      `${label}.claimVisuals.used[${index}]`,
    );
    if (o.kind !== "evidence_bound_visual_use" || o.directionVerified !== false) {
      failHere(`"${label}.claimVisuals.used[${index}]" has invalid boundary branding`);
    }
    return {
      factId: o.factId,
      shotIndex: o.shotIndex,
      directionSummary: o.provisionalDirectionSummary,
    };
  });

  try {
    return validateProductionDirectionOutput({
      visualApproach: provisional.visualApproach,
      shots: provisional.shots,
      overlayText: rebuiltOverlay,
      productionRequirements: rebuiltRequirements,
      claimVisuals: rebuiltClaimVisuals,
      openQuestions: provisional.openQuestions,
    }, scriptOutput, truthOutput, pack);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failHere(`"${label}" is invalid: ${detail}`);
  }
}

/**
 * The only supported way to turn this stage's output into evidence records.
 *
 * Returns the exact used records for the bound ids. It cannot return direction,
 * because it never reads a shot, an overlay, a requirement, or a direction
 * summary — the ids are the entire input.
 */
export function visualClaimRecords(
  output: ProductionDirectionOutput,
  scriptOutput: HookStoryScriptOutput,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
): EvidenceRecord[] {
  const usedById = new Map(
    scriptUsedClaimRecords(scriptOutput, truthOutput, pack).map((record) => [record.id, record]),
  );
  return output.claimVisuals.used
    .map((binding) => usedById.get(binding.factId))
    .filter((r): r is EvidenceRecord => r !== undefined);
}

/**
 * What the plan's cited claims actually say, in the evidence system's words.
 *
 * Drawn from the records, never from overlay wording or a direction summary. A
 * summary that overstates its fact is contained by exactly this: it is not what
 * a downstream consumer reads back. It is **not** contained by anything
 * detecting the overstatement, because nothing here does.
 */
export function visualClaimTexts(
  output: ProductionDirectionOutput,
  scriptOutput: HookStoryScriptOutput,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
): string[] {
  return visualClaimRecords(output, scriptOutput, truthOutput, pack).map((record) => record.claim);
}

/**
 * Precondition inherited from this stage's registry entry.
 *
 * Kept for consistency with the other executors, but it is **not** this stage's
 * authority gate — stage 3's used-claim set is. The registry declares no
 * required evidence kind for this stage, so this can only catch a caller
 * assembling stages against a pack the earlier stages never saw.
 */
export function assertRequiredDirectionEvidence(pack: EvidencePack, registry: AgentRegistry): void {
  assertRequiredEvidenceKinds(PRODUCTION_DIRECTION_STAGE, registry, pack);
}

/**
 * Execute the production-direction stage exactly once.
 *
 * Fails closed on: a malformed, incompletely branded, or oversized prior-stage
 * value; a prior-stage value that does not revalidate against this pack; an
 * empty used-claim set; a missing asset; a runner error or timeout; non-strict
 * JSON; any structural contract violation; and any visual claim use that is
 * fabricated, duplicated, outside stage 3's used set, or pointing at a shot that
 * does not exist. Performs no retry and no second model call.
 *
 * **The zero-bound-script-claims decision, made explicitly.** When stage 3 bound
 * no claims, this stage **refuses before the model call** rather than producing a
 * production plan. Both options were considered. A plan would be a
 * finished-looking shot list whose every factual or visual implication has no
 * evidence authority behind it, handed to human producers and to later stages
 * that have no mechanism to keep it non-factual — and a picture asserts without
 * anyone having to write the claim down. **Authority is never widened back to
 * stage 2's whitelist or to the pack to rescue the request.** Refusing costs a
 * model call that could not have produced usable direction and surfaces the real
 * problem, which is upstream. The cost is accepted honestly: a purely atmospheric
 * piece that depicts nothing factual cannot be directed by this stage, and would
 * need its own authorised contract rather than a silent widening of this one.
 *
 * It does **not** verify that any shot is true, feasible, safe, lawful, or
 * producible — see this module's header for the exact boundary.
 */
export async function executeProductionDirection(
  invocation: ProductionDirectionInvocation,
): Promise<ProductionDirectionResult> {
  const registry = invocation.registry ?? new AgentRegistry();

  if (!invocation.evidencePack || typeof invocation.evidencePack !== "object") {
    fail("an evidence pack is required");
  }
  const pack = invocation.evidencePack;

  const truthOutput = revalidateAutomotiveTruthOutput(
    invocation.truthOutput, pack, PRODUCTION_DIRECTION_STAGE, "truthOutput",
  );
  const scriptOutput = revalidateHookStoryScriptOutput(
    invocation.scriptOutput, truthOutput, pack, PRODUCTION_DIRECTION_STAGE, "scriptOutput",
  );

  const renderedScriptOutput = JSON.stringify(scriptOutput, null, 2);
  if (renderedScriptOutput.length > DIRECTION_LIMITS.scriptOutputChars) {
    fail(`"scriptOutput" exceeds ${DIRECTION_LIMITS.scriptOutputChars} characters`);
  }

  assertRequiredDirectionEvidence(pack, registry);

  const usedClaims = scriptUsedClaimRecords(scriptOutput, truthOutput, pack);
  if (!usedClaims.length) {
    // See the zero-bound-script-claims decision in this function's documentation.
    fail("hook-story-script bound no claims: refusing to direct a piece with no factual authority");
  }

  const { rawText, metadata } = await invokeStage({
    stage: PRODUCTION_DIRECTION_STAGE,
    registry,
    runner: invocation.runner,
    // This stage declares no reference asset. The setting is explicit anyway, so
    // adding one later is a deliberate reviewed act rather than something that
    // silently starts entering a channel.
    referenceChannel: "omit",
    // Deliberately two blocks. Stage 2's output was needed to revalidate stage
    // 3's bindings; it is an input to the validator, not to the model, and its
    // wider whitelist and prose are not sent.
    dataBlocks: [
      { label: "SCRIPT_OUTPUT", body: renderedScriptOutput },
      { label: "SCRIPT_CLAIMS", body: renderScriptClaims(scriptOutput, truthOutput, pack) },
    ],
  });

  const parsed = parseStrictJsonObject(PRODUCTION_DIRECTION_STAGE, rawText);
  const output = validateProductionDirectionOutput(parsed, scriptOutput, truthOutput, pack);
  return { output, metadata };
}
