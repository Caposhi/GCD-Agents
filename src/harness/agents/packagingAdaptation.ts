/**
 * Phase 0B.5 - the `packaging-adaptation` stage executor.
 *
 * Stage 5 adapts the already-written script into proposed per-platform captions,
 * hashtags, local-keyword suggestions, and review-only timing recommendations.
 * It is **implemented, not wired**: nothing in the worker, scheduler,
 * orchestrator, approval path, publication path, provider path, media path,
 * Slack path, database, evidence-write path, or the
 * `/console/content-intelligence/preview` route calls it.
 *
 * ## What this stage is not allowed to do
 *
 * It proposes review copy only. It does not publish, schedule, construct a
 * provider payload, select or name a destination, account, location, page, host,
 * endpoint or API version, expose a URL-bearing field, create or describe media,
 * produce alt text, or return hosting, provenance, QC or approval state. Its
 * prose validator rejects syntactically recognizable URL forms, while making no
 * claim to detect obfuscated or semantic destination references. It does
 * not modify stage 4's direction. Those belong to deterministic runtime code, to
 * later stages, or to a human.
 *
 * ## The authority boundary
 *
 * **Stage 3's actually used claims remain the complete factual authority**, and
 * this stage widens nothing:
 *
 *  - Not stage 2's wider whitelist, not the complete evidence pack, not model
 *    knowledge, and not the rejected platform/local-SEO assets.
 *  - **Not stage 4's output either.** Stage 4's direction prose, overlay
 *    wording, production requirements and claim-visual summaries are *creative
 *    and production context*, never factual authority.
 *  - Equally, **stage 4's visual claim subset must not silently erase a claim the
 *    script actually uses.** Captions adapt the *script*, so the available claim
 *    set stays the stage 3 used-claim set even where stage 4 chose to depict only
 *    part of it.
 *
 * The model receives exactly four bounded, labelled untrusted blocks:
 * `SCRIPT_OUTPUT`, `PRODUCTION_OUTPUT`, `REQUESTED_PLATFORMS`, and
 * `SCRIPT_CLAIMS`. The complete pack, stage 2's provisional prose, stage 2's
 * wider whitelist, raw references, active environment configuration, and
 * provider/account/location configuration are never rendered.
 *
 * ## Deterministic platform policy
 *
 * The per-platform caption and hashtag limits are **imported from
 * `packageMap.ts`**, the module that already enforces them on provider text.
 * This stage declares no competing numbers. Its platform identifiers are its own
 * closed enum - deliberately distinct from the provider-payload `Platform`
 * union, because a stage-5 package is review metadata and must never be mistaken
 * for a publishable payload. Exhaustive maps in both directions plus runtime
 * round trips pin a reviewed bijection so the two cannot drift apart unnoticed.
 *
 * ## What this stage guarantees, exactly
 *
 * **Guaranteed:**
 *  - Every entry in the typed claim-use channel names an id stage 3 actually
 *    used. Fabricated ids, pack-only ids, stage-2-permitted-but-unused ids,
 *    wrong-class ids, and within-platform duplicates all fail.
 *  - Exactly one package per requested platform, in the requested order.
 *  - Captions contain no hashtag token; canonical tags live only in the separate
 *    array, and proposed provider-visible caption-plus-tag length is enforced
 *    deterministically against the imported production constants.
 *  - Dedicated URL-bearing fields are structurally absent, and recognizable URL
 *    syntax is rejected from every model-authored prose channel. Obfuscated or
 *    semantic destination references are not claimed detectable.
 *  - All three prior-stage values are revalidated against the same evidence pack,
 *    using the owning stages' own exported revalidators, before any model call.
 *  - A recommended time is a bounded `HH:MM ET` note. It carries no date and no
 *    timestamp, so it cannot become a scheduler instruction.
 *
 * **The limit on that revalidation, stated exactly.** Prior-stage values are
 * treated as untrusted and revalidated against the same evidence pack. Values
 * that fail the prior contracts are refused before the model call. This is
 * structural validation, not provenance or authenticity verification; a
 * structurally valid deserialized or hand-built value can pass.
 *
 * **NOT guaranteed.** The validator does not prove that a caption faithfully
 * preserves the script, that a shortening or rewording keeps the meaning, that a
 * hashtag or local keyword is relevant or truthful, that a recommended time is
 * useful, or that every factual implication was cited. **No language model in
 * this pipeline proves any of those true.** The gap is contained by type and by
 * literal `false` branding - never by semantic keyword matching, which would be
 * trivially evadable and would imply a truth check the code does not perform.
 */

import { EvidenceRecord } from "../evidence/contract.js";
import { EvidencePack } from "../evidence/pack.js";
import {
  FACEBOOK_HASHTAG_MAX,
  FACEBOOK_TEXT_MAX,
  GBP_HASHTAG_MAX,
  GBP_SUMMARY_MAX,
  HASHTAG_TOKEN_PATTERN,
  INSTAGRAM_CAPTION_MAX,
  INSTAGRAM_HASHTAG_MAX,
  INSTAGRAM_HASHTAG_MIN,
  hashtagTokens,
} from "../packageMap.js";
import type { Platform } from "../../mcp/posting-tool/index.js";
import { AgentRegistry, AgentStageId } from "./registry.js";
import type { AutomotiveTruthOutput } from "./automotiveTruth.js";
import { revalidateAutomotiveTruthOutput } from "./automotiveTruth.js";
import type { HookStoryScriptOutput } from "./hookStoryScript.js";
import { revalidateHookStoryScriptOutput, scriptClaimRecords } from "./hookStoryScript.js";
import type { ProductionDirectionOutput } from "./productionDirection.js";
import { revalidateProductionDirectionOutput } from "./productionDirection.js";
import {
  StageExecutionError,
  StageExecutionMetadata,
  StageRunner,
  assertRequiredEvidenceKinds,
  invokeStage,
  parseStrictJsonObject,
} from "./stageExecution.js";
import { PACKAGING_FIELD_LIMITS, EVIDENCE_LIMITS, HANDOFF_GUARDS, PACKAGING_OUTPUT, isBoundedSerializableText } from "./payloadContract.js";

export const PACKAGING_ADAPTATION_STAGE = "packaging-adaptation" as const;

/**
 * The channels this stage may adapt for.
 *
 * A closed enum, deliberately spelled out rather than reusing the
 * provider-payload `Platform` union: a stage-5 package is review metadata and
 * must never be mistaken for something publishable. Exhaustive maps in both
 * directions plus runtime round trips pin the correspondence below.
 */
export const PACKAGING_PLATFORMS = ["instagram", "facebook", "google_business_profile"] as const;
export type PackagingPlatform = (typeof PACKAGING_PLATFORMS)[number];

/**
 * The forward half of the reviewed bijection with the repository's
 * provider-payload `Platform` union.
 *
 * `Record<PackagingPlatform, Platform>` makes this exhaustive over the stage
 * vocabulary. The inverse below is separately exhaustive over the provider
 * vocabulary; neither public spelling is collapsed into the other.
 */
export const PACKAGING_PLATFORM_PRODUCTION_ID: Record<PackagingPlatform, Platform> = {
  instagram: "instagram",
  facebook: "facebook",
  google_business_profile: "gbp",
};

/** The inverse half: exhaustive over every provider-payload `Platform`. */
export const PRODUCTION_PLATFORM_PACKAGING_ID: Record<Platform, PackagingPlatform> = {
  instagram: "instagram",
  facebook: "facebook",
  gbp: "google_business_profile",
};

/**
 * Assert both runtime round trips in addition to the two compile-time exhaustive maps.
 *
 * A future addition or rename on either union first fails typecheck until its
 * corresponding `Record` is reviewed. A mismatched or duplicate pair then
 * fails here rather than silently presenting the two vocabularies as bijective.
 */
export function assertPackagingPlatformBijection(): void {
  for (const packaging of PACKAGING_PLATFORMS) {
    const production = PACKAGING_PLATFORM_PRODUCTION_ID[packaging];
    if (PRODUCTION_PLATFORM_PACKAGING_ID[production] !== packaging) {
      throw new Error(`packaging platform mapping does not round-trip: ${packaging}`);
    }
  }
  for (const production of Object.keys(PRODUCTION_PLATFORM_PACKAGING_ID) as Platform[]) {
    const packaging = PRODUCTION_PLATFORM_PACKAGING_ID[production];
    if (PACKAGING_PLATFORM_PRODUCTION_ID[packaging] !== production) {
      throw new Error(`production platform mapping does not round-trip: ${production}`);
    }
  }
}

assertPackagingPlatformBijection();

/**
 * The deterministic per-platform policy.
 *
 * Every number here is **imported** from `packageMap.ts`, which already enforces
 * the same limits on provider text. This module defines no competing value; if
 * the production rule changes, this stage changes with it.
 */
export interface PlatformPackagingPolicy {
  captionMax: number;
  hashtagMin: number;
  hashtagMax: number;
}
export const PLATFORM_PACKAGING_POLICY: Record<PackagingPlatform, PlatformPackagingPolicy> = {
  instagram: {
    captionMax: INSTAGRAM_CAPTION_MAX,
    hashtagMin: INSTAGRAM_HASHTAG_MIN,
    hashtagMax: INSTAGRAM_HASHTAG_MAX,
  },
  facebook: {
    captionMax: FACEBOOK_TEXT_MAX,
    hashtagMin: 0,
    hashtagMax: FACEBOOK_HASHTAG_MAX,
  },
  google_business_profile: {
    captionMax: GBP_SUMMARY_MAX,
    hashtagMin: 0,
    hashtagMax: GBP_HASHTAG_MAX,
  },
};

/** Bounds on the model's output and on the prior-stage values it is shown. */
export const PACKAGING_LIMITS = {
  ...PACKAGING_FIELD_LIMITS,
  scriptOutputChars: HANDOFF_GUARDS.scriptOutputChars,
  directionOutputChars: HANDOFF_GUARDS.directionOutputChars,
} as const;

/**
 * Review-only time of day.
 *
 * Deliberately not a date and not a timestamp: the shape itself refuses to be a
 * scheduler instruction, which is a stronger guarantee than a comment saying so.
 */
export const RECOMMENDED_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d ET$/;

/**
 * Recognizable URL syntax refused from model-authored prose.
 *
 * This deliberately covers explicit URI schemes and `www.` tokens. It is a
 * syntactic guard, not a semantic destination detector: bare domains,
 * deliberately obfuscated destinations, and prose such as "our booking page"
 * are not provably detectable and remain an accepted limitation.
 */
export const URL_SHAPED_TEXT_PATTERN = /(?:\b[a-z][a-z0-9+.-]*:(?:\/\/)?[^\s]+|\bwww\.[^\s]+)/iu;

/** Exactly the fields the contract allows. Anything else is an extra field. */
const ALLOWED_OUTPUT_FIELDS = ["packages", "claimUse"] as const;
const ALLOWED_PACKAGE_FIELDS = [
  "platform", "caption", "hashtags", "localKeywords", "recommendedTime", "openQuestions",
] as const;
const ALLOWED_CLAIM_USE_FIELDS = ["platform", "factId", "summary"] as const;

/**
 * One proposed platform package.
 *
 * Every model-authored component is separately branded: the caption wording, the
 * hashtag and keyword selection, and the timing recommendation, which is also
 * branded non-schedulable.
 */
export interface ProvisionalPlatformPackage {
  platform: PackagingPlatform;
  caption: string;
  /** Always false. No caption has been checked against the script. */
  readonly captionVerified: false;
  hashtags: string[];
  localKeywords: string[];
  /** Always false. No tag or keyword has been checked for relevance or truth. */
  readonly selectionVerified: false;
  /** `HH:MM ET`. Review metadata only. */
  recommendedTime: string;
  /** Always false. No timing recommendation has been checked for usefulness. */
  readonly timingVerified: false;
  /** Always false. Nothing may treat this as a scheduling instruction. */
  readonly schedulable: false;
  openQuestions: string[];
}

/**
 * Model-authored packaging.
 *
 * Provisional, untrusted, **non-publishable** and **non-executable**: nothing
 * here may be handed to a provider, a scheduler, or a publishing path.
 */
export interface ProvisionalPackaging {
  readonly kind: "provisional_model_prose";
  readonly publishable: false;
  readonly verified: false;
  readonly executable: false;
  /** One per requested platform, in the requested order. */
  packages: ProvisionalPlatformPackage[];
}

/** One recorded use of a stage 3 claim in one platform's caption. */
export interface PackagingClaimBinding {
  readonly kind: "evidence_bound_platform_claim_use";
  platform: PackagingPlatform;
  /** An id stage 3 actually used. */
  factId: string;
  /** Taken from the pack record via stage 3's binding. Never from the model. */
  factKind: "verified_automotive_fact" | "verified_business_fact";
  /** Model prose. Bounded in length; never checked for faithfulness. */
  provisionalSummary: string;
  /** Always false. No summary from this stage has been checked. */
  readonly wordingVerified: false;
}

/** The typed claim-use channel - structurally separate from the copy. */
export interface PackagingClaimUse {
  readonly kind: "typed_platform_claim_use";
  used: PackagingClaimBinding[];
}

export interface PackagingAdaptationOutput {
  /** Untrusted, non-publishable, non-executable model copy. Never evidence. */
  provisional: ProvisionalPackaging;
  /** Typed, used-claim-bound record of which caption relies on which fact. */
  claimUse: PackagingClaimUse;
}

export interface PackagingAdaptationResult {
  output: PackagingAdaptationOutput;
  metadata: StageExecutionMetadata;
}

export interface PackagingAdaptationInvocation {
  /** The complete typed output from stage 3. Untrusted data. */
  scriptOutput: HookStoryScriptOutput;
  /** The complete typed output from stage 4. Creative context, never authority. */
  directionOutput: ProductionDirectionOutput;
  /**
   * The complete typed output from stage 2.
   *
   * Used **only** to revalidate the stage 3 chain. It is never shown to the
   * model: its whitelist is wider than what stage 3 used, and its prose would be
   * a second, unused set of claims to reach for.
   */
  truthOutput: AutomotiveTruthOutput;
  /** The same pack that bound the whole chain. Revalidated against it. */
  evidencePack: EvidencePack;
  /** Channels to adapt for. Nonempty, unique, known, caller order preserved. */
  requestedPlatforms: PackagingPlatform[];
  registry?: AgentRegistry;
  runner: StageRunner;
}

const fail = (message: string): never => {
  throw new StageExecutionError(PACKAGING_ADAPTATION_STAGE, message);
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

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`"${label}" must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireUrlFreeText(value: string, field: string): string {
  if (URL_SHAPED_TEXT_PATTERN.test(value)) {
    fail(`"${field}" must not contain a recognizable URL`);
  }
  return value;
}

function proposedProviderText(caption: string, hashtags: string[]): string {
  return hashtags.length ? `${caption}\n\n${hashtags.join(" ")}` : caption;
}

function requirePlatform(value: unknown, field: string): PackagingPlatform {
  if (typeof value !== "string" || !(PACKAGING_PLATFORMS as readonly string[]).includes(value)) {
    fail(`"${field}" must be one of: ${PACKAGING_PLATFORMS.join(", ")}`);
  }
  return value as PackagingPlatform;
}

/**
 * Validate the requested channel set before any model call.
 *
 * Caller order is meaningful and is preserved: the output contract requires one
 * package per platform in exactly this order, which makes a silently reordered
 * or padded response detectable rather than plausible.
 */
export function validateRequestedPlatforms(value: unknown): PackagingPlatform[] {
  if (!Array.isArray(value)) fail('"requestedPlatforms" must be an array');
  const arr = value as unknown[];
  if (!arr.length) fail('"requestedPlatforms" must not be empty');
  if (arr.length > PACKAGING_LIMITS.maxRequestedPlatforms) {
    fail(`"requestedPlatforms" exceeds ${PACKAGING_LIMITS.maxRequestedPlatforms} entries`);
  }
  const seen = new Set<string>();
  return arr.map((entry, index) => {
    const platform = requirePlatform(entry, `requestedPlatforms[${index}]`);
    if (seen.has(platform)) fail(`"requestedPlatforms" repeats "${platform}"`);
    seen.add(platform);
    return platform;
  });
}

/**
 * The evidence records stage 3 actually used, in stage 3's order.
 *
 * The whole factual surface of stage 5, and identical to stage 4's - captions
 * adapt the script, so stage 4's narrower visual selection does not shrink it.
 */
export function scriptUsedClaimRecordsForPackaging(
  scriptOutput: HookStoryScriptOutput,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
): EvidenceRecord[] {
  return scriptClaimRecords(scriptOutput, truthOutput, pack);
}

/**
 * The bounded projection this stage's model is shown.
 *
 * Only the used records, each with the evidence system's own wording and its
 * authoritative `kind`. Never the pack, never stage 2's wider whitelist.
 */
export function renderPackagingScriptClaims(
  scriptOutput: HookStoryScriptOutput,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
): string {
  return JSON.stringify(
    scriptUsedClaimRecordsForPackaging(scriptOutput, truthOutput, pack).map((record) => ({
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
 * Validate the model's object against the contract and the platform policy.
 *
 * **Scope of this function, stated precisely.** It validates *shape*, *bounds*,
 * *enums*, *per-platform provider-visible caption and hashtag policy*,
 * *recognizable URL syntax in model prose*, *exact requested-platform membership
 * and order*, and *membership in stage 3's used-claim set*. It does
 * not evaluate whether a caption preserves the script, whether a shortening kept
 * the meaning, whether a hashtag or keyword is relevant or truthful, whether a
 * recommended time is useful, or whether the copy asserts something factual that
 * it failed to cite.
 */
export function validatePackagingAdaptationOutput(
  raw: Record<string, unknown>,
  requestedPlatforms: PackagingPlatform[],
  scriptOutput: HookStoryScriptOutput,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
): PackagingAdaptationOutput {
  requireExactKeys(raw, [...ALLOWED_OUTPUT_FIELDS], "output");

  if (!Array.isArray(raw.packages)) fail('"packages" must be an array');
  const rawPackages = raw.packages as unknown[];
  if (rawPackages.length !== requestedPlatforms.length) {
    fail(
      `"packages" must contain exactly one entry per requested platform `
      + `(expected ${requestedPlatforms.length}, received ${rawPackages.length})`,
    );
  }

  const packages: ProvisionalPlatformPackage[] = rawPackages.map((entry, index) => {
    const obj = requireObject(entry, `packages[${index}]`);
    requireExactKeys(obj, [...ALLOWED_PACKAGE_FIELDS], "packages entry");

    const platform = requirePlatform(obj.platform, `packages[${index}].platform`);
    const expected = requestedPlatforms[index]!;
    if (platform !== expected) {
      fail(
        `packages[${index}] is "${platform}", but the requested platform at that `
        + `position is "${expected}": order must be preserved exactly`,
      );
    }
    const policy = PLATFORM_PACKAGING_POLICY[platform];
    // The effective cap is the smaller of the provider's limit and the
    // pipeline's own. Facebook's provider limit is 63,206 characters; a caption
    // at that length alone exceeds every derived payload ceiling in
    // `payloadContract.ts`, and no output-token budget could produce three of
    // them. Taking the minimum here is what makes `pipelineCaptionChars` a real
    // bound rather than a comment: a provider-policy change cannot widen it.
    const captionMax = Math.min(policy.captionMax, PACKAGING_LIMITS.pipelineCaptionChars);
    const hashtagMax = Math.min(policy.hashtagMax, PACKAGING_LIMITS.maxHashtags);

    const caption = requireUrlFreeText(
      requireBoundedString(obj.caption, `packages[${index}].caption`, captionMax),
      `packages[${index}].caption`,
    );
    if (hashtagTokens(caption).length) {
      fail(
        `"packages[${index}].caption" must not contain hashtag tokens: `
        + "canonical hashtags belong only in the hashtags field",
      );
    }

    if (!Array.isArray(obj.hashtags)) fail(`"packages[${index}].hashtags" must be an array`);
    const rawHashtags = obj.hashtags as unknown[];
    if (rawHashtags.length < policy.hashtagMin || rawHashtags.length > hashtagMax) {
      fail(
        `${platform} requires ${policy.hashtagMin}-${hashtagMax} hashtags, `
        + `received ${rawHashtags.length}`,
      );
    }
    const seenTags = new Set<string>();
    const hashtags = rawHashtags.map((tag, tagIndex) => {
      if (typeof tag !== "string") fail(`"packages[${index}].hashtags[${tagIndex}]" must be a string`);
      const token = (tag as string).trim();
      if (!HASHTAG_TOKEN_PATTERN.test(token)) {
        fail(`"packages[${index}].hashtags[${tagIndex}]" is not a valid hashtag token: ${token}`);
      }
      const canonical = token.toLocaleLowerCase("en-US");
      if (seenTags.has(canonical)) {
        fail(`"packages[${index}].hashtags" repeats "${token}" (comparison is case-insensitive)`);
      }
      seenTags.add(canonical);
      return token;
    });

    const providerText = proposedProviderText(caption, hashtags);
    if (providerText.length > captionMax) {
      fail(
        `${platform} proposed provider-visible text exceeds ${captionMax} characters `
        + "after appending canonical hashtags",
      );
    }

    const localKeywords = requireBoundedStringArray(
      obj.localKeywords, `packages[${index}].localKeywords`,
      PACKAGING_LIMITS.maxLocalKeywords, PACKAGING_LIMITS.localKeywordChars,
    );
    for (const keyword of localKeywords) {
      if (hashtagTokens(keyword).length) {
        fail(`"packages[${index}].localKeywords" must not contain hashtag tokens`);
      }
      requireUrlFreeText(keyword, `packages[${index}].localKeywords[]`);
    }

    const recommendedTime = requireBoundedString(
      obj.recommendedTime, `packages[${index}].recommendedTime`, 16,
    );
    if (!RECOMMENDED_TIME_PATTERN.test(recommendedTime)) {
      fail(
        `"packages[${index}].recommendedTime" must be review metadata of the form `
        + `"HH:MM ET": a date or timestamp is refused so it cannot become a schedule`,
      );
    }

    const openQuestions = requireBoundedStringArray(
      obj.openQuestions, `packages[${index}].openQuestions`,
      PACKAGING_LIMITS.maxOpenQuestions, PACKAGING_LIMITS.openQuestionChars,
    );
    for (const question of openQuestions) {
      requireUrlFreeText(question, `packages[${index}].openQuestions[]`);
    }

    return {
      platform,
      caption,
      captionVerified: false,
      hashtags,
      localKeywords,
      selectionVerified: false,
      recommendedTime,
      timingVerified: false,
      schedulable: false,
      openQuestions,
    };
  });

  // --- binding: stage 3's USED claims remain the boundary --------------------
  const usedById = new Map(
    scriptUsedClaimRecordsForPackaging(scriptOutput, truthOutput, pack).map((r) => [r.id, r]),
  );
  const requestedSet = new Set<string>(requestedPlatforms);

  if (!Array.isArray(raw.claimUse)) fail('"claimUse" must be an array');
  const rawClaimUse = raw.claimUse as unknown[];
  if (rawClaimUse.length > PACKAGING_LIMITS.maxClaimUses) {
    fail(`"claimUse" exceeds ${PACKAGING_LIMITS.maxClaimUses} entries`);
  }
  // Keyed by platform plus id: the same fact may back a caption on more than one
  // channel, because each caption is a separate use, but never twice on one.
  const seenBindings = new Set<string>();
  const used: PackagingClaimBinding[] = rawClaimUse.map((entry, index) => {
    const obj = requireObject(entry, `claimUse[${index}]`);
    requireExactKeys(obj, [...ALLOWED_CLAIM_USE_FIELDS], "claimUse entry");

    const platform = requirePlatform(obj.platform, `claimUse[${index}].platform`);
    if (!requestedSet.has(platform)) {
      fail(`claimUse[${index}] names "${platform}", which was not requested`);
    }

    const factId = requireBoundedString(obj.factId, `claimUse[${index}].factId`, EVIDENCE_LIMITS.idChars);
    const record = usedById.get(factId);
    if (!record) {
      fail(
        `claimUse cites "${factId}", which hook-story-script did not use `
        + "(a fabricated id, a pack fact, or a claim automotive-truth permitted but the script never bound)",
      );
    }
    const key = `${platform} ${factId}`;
    if (seenBindings.has(key)) {
      fail(`claimUse cites "${factId}" more than once for "${platform}"`);
    }
    seenBindings.add(key);

    const summary = requireUrlFreeText(
      requireBoundedString(
        obj.summary, `claimUse[${index}].summary`, PACKAGING_LIMITS.summaryChars,
      ),
      `claimUse[${index}].summary`,
    );

    return {
      kind: "evidence_bound_platform_claim_use",
      platform,
      factId,
      factKind: record!.kind as PackagingClaimBinding["factKind"],
      provisionalSummary: summary,
      wordingVerified: false,
    };
  });

  return {
    provisional: {
      kind: "provisional_model_prose",
      publishable: false,
      verified: false,
      executable: false,
      packages,
    },
    claimUse: {
      kind: "typed_platform_claim_use",
      used,
    },
  };
}

/**
 * Revalidate a supplied `PackagingAdaptationOutput` against the stage 3 chain
 * and an evidence pack.
 *
 * Lives here, in the owning module, for the same reason stage 2's, stage 3's
 * and stage 4's do: a caller one step further down the chain (stage 6) needs
 * it, and a divergent copy could accept something this contract rejects.
 * Rebuilding this stage's validator input from the branded shape — never
 * trusting the branding itself as proof — re-binds every claim-use entry
 * against the stage 3 used-claim set, re-checks every platform's hashtag and
 * caption policy, the combined provider-visible length bound, the
 * recognizable-URL guard, the recommended-time shape, and per-platform
 * duplicate rules, all by delegating to `validatePackagingAdaptationOutput`
 * rather than re-implementing any of it.
 *
 * The "requested platforms" this revalidation checks against are derived from
 * the packages' own platform sequence: a legitimate output already satisfies
 * "exactly one package per requested platform, in the requested order", so
 * that sequence *is* the requested set it was produced against. A caller that
 * additionally needs to confirm the value covers a *specific* platform list —
 * stage 6 does, against its own invocation's `requestedPlatforms` — must
 * compare that list to this function's result separately; this function
 * cannot do that comparison itself without being handed the caller's list,
 * and accepting an unchecked list here would just move the trust problem
 * rather than remove it.
 *
 * **The limit, stated exactly.** Prior-stage values are treated as untrusted
 * and revalidated against the same evidence pack. Values that fail the prior
 * contracts are refused before the model call. This is structural validation,
 * not provenance or authenticity verification; a structurally valid
 * deserialized or hand-built value can pass.
 */
export function revalidatePackagingAdaptationOutput(
  value: unknown,
  scriptOutput: HookStoryScriptOutput,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
  stage: AgentStageId = PACKAGING_ADAPTATION_STAGE,
  label = "packagingOutput",
): PackagingAdaptationOutput {
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
  exact(output, ["provisional", "claimUse"], label);
  const provisional = obj(output.provisional, `${label}.provisional`);
  const claimUse = obj(output.claimUse, `${label}.claimUse`);
  exact(
    provisional,
    ["kind", "publishable", "verified", "executable", "packages"],
    `${label}.provisional`,
  );
  exact(claimUse, ["kind", "used"], `${label}.claimUse`);
  if (provisional.kind !== "provisional_model_prose"
      || provisional.publishable !== false
      || provisional.verified !== false
      || provisional.executable !== false) {
    failHere(`"${label}.provisional" has invalid boundary branding`);
  }
  if (claimUse.kind !== "typed_platform_claim_use") {
    failHere(`"${label}.claimUse" has invalid boundary branding`);
  }
  if (!Array.isArray(provisional.packages)) failHere(`"${label}.provisional.packages" must be an array`);
  if (!Array.isArray(claimUse.used)) failHere(`"${label}.claimUse.used" must be an array`);

  const rebuiltPackages = (provisional.packages as unknown[]).map((entry, index) => {
    const o = obj(entry, `${label}.provisional.packages[${index}]`);
    exact(
      o,
      ["platform", "caption", "captionVerified", "hashtags", "localKeywords", "selectionVerified",
       "recommendedTime", "timingVerified", "schedulable", "openQuestions"],
      `${label}.provisional.packages[${index}]`,
    );
    if (o.captionVerified !== false || o.selectionVerified !== false
        || o.timingVerified !== false || o.schedulable !== false) {
      failHere(`"${label}.provisional.packages[${index}]" has invalid boundary branding`);
    }
    return {
      platform: o.platform,
      caption: o.caption,
      hashtags: o.hashtags,
      localKeywords: o.localKeywords,
      recommendedTime: o.recommendedTime,
      openQuestions: o.openQuestions,
    };
  });
  const rebuiltClaimUse = (claimUse.used as unknown[]).map((entry, index) => {
    const o = obj(entry, `${label}.claimUse.used[${index}]`);
    exact(
      o,
      ["kind", "platform", "factId", "factKind", "provisionalSummary", "wordingVerified"],
      `${label}.claimUse.used[${index}]`,
    );
    if (o.kind !== "evidence_bound_platform_claim_use" || o.wordingVerified !== false) {
      failHere(`"${label}.claimUse.used[${index}]" has invalid boundary branding`);
    }
    return { platform: o.platform, factId: o.factId, summary: o.provisionalSummary };
  });

  let derivedRequestedPlatforms: PackagingPlatform[];
  try {
    derivedRequestedPlatforms = validateRequestedPlatforms(rebuiltPackages.map((p) => p.platform));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failHere(`"${label}" names an invalid requested-platform sequence: ${detail}`);
  }

  try {
    return validatePackagingAdaptationOutput(
      { packages: rebuiltPackages, claimUse: rebuiltClaimUse },
      derivedRequestedPlatforms, scriptOutput, truthOutput, pack,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failHere(`"${label}" is invalid: ${detail}`);
  }
}

/**
 * The only supported way to turn this stage's output into evidence records.
 *
 * Reads the platform and the bound ids and nothing else. It never reads a
 * caption, a hashtag, a local keyword, a timing note, an open question, a
 * summary, or any stage 4 direction.
 */
export function packagingClaimRecords(
  output: PackagingAdaptationOutput,
  platform: PackagingPlatform,
  scriptOutput: HookStoryScriptOutput,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
): EvidenceRecord[] {
  const usedById = new Map(
    scriptUsedClaimRecordsForPackaging(scriptOutput, truthOutput, pack).map((r) => [r.id, r]),
  );
  return output.claimUse.used
    .filter((binding) => binding.platform === platform)
    .map((binding) => usedById.get(binding.factId))
    .filter((r): r is EvidenceRecord => r !== undefined);
}

/**
 * What one platform's cited claims actually say, in the evidence system's words.
 *
 * Drawn from the records, never from the caption or the model's summary. A
 * caption that drifts from its fact is contained by exactly this: it is not what
 * a downstream consumer reads back. It is **not** contained by anything
 * detecting the drift, because nothing here does.
 */
export function packagingClaimTexts(
  output: PackagingAdaptationOutput,
  platform: PackagingPlatform,
  scriptOutput: HookStoryScriptOutput,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
): string[] {
  return packagingClaimRecords(output, platform, scriptOutput, truthOutput, pack)
    .map((record) => record.claim);
}

/**
 * Precondition inherited from this stage's registry entry.
 *
 * Subordinate to the stage 3 used-claim gate, which is this stage's real
 * authority boundary. The registry declares no required evidence kind here.
 */
export function assertRequiredPackagingEvidence(pack: EvidencePack, registry: AgentRegistry): void {
  assertRequiredEvidenceKinds(PACKAGING_ADAPTATION_STAGE, registry, pack);
}

/**
 * Execute the packaging-adaptation stage exactly once.
 *
 * Fails closed on: a malformed, incompletely branded, evidence-inconsistent or
 * oversized prior-stage value; an empty, duplicated, oversized or unknown
 * requested-platform set; an empty stage 3 used-claim set; a missing asset; a
 * runner error or timeout; non-strict JSON; any structural or policy violation;
 * and any claim use that is fabricated, wrong-class, outside stage 3's used set,
 * duplicated within a platform, or attached to an unrequested platform. Performs
 * no retry and no second model call.
 *
 * **The zero-used-claims decision, made explicitly.** A legitimate stage 4 run
 * already refuses when stage 3 bound nothing, but stage 5 does not assume it was
 * reached legitimately and refuses independently **before its own model call**.
 * Adapting a piece whose captions could assert nothing would produce
 * finished-looking channel copy with no factual authority behind it, at the
 * widest point of the funnel. **Authority is never widened back to stage 2's
 * whitelist, the evidence pack, or stage 4's prose to rescue the request.**
 *
 * It does **not** verify that any caption preserves the script, that a hashtag
 * or keyword is truthful, or that a time is useful - see this module's header.
 */
export async function executePackagingAdaptation(
  invocation: PackagingAdaptationInvocation,
): Promise<PackagingAdaptationResult> {
  const registry = invocation.registry ?? new AgentRegistry();

  if (!invocation.evidencePack || typeof invocation.evidencePack !== "object") {
    fail("an evidence pack is required");
  }
  const pack = invocation.evidencePack;

  const truthOutput = revalidateAutomotiveTruthOutput(
    invocation.truthOutput, pack, PACKAGING_ADAPTATION_STAGE, "truthOutput",
  );
  const scriptOutput = revalidateHookStoryScriptOutput(
    invocation.scriptOutput, truthOutput, pack, PACKAGING_ADAPTATION_STAGE, "scriptOutput",
  );
  const directionOutput = revalidateProductionDirectionOutput(
    invocation.directionOutput, scriptOutput, truthOutput, pack,
    PACKAGING_ADAPTATION_STAGE, "directionOutput",
  );

  const renderedScriptOutput = JSON.stringify(scriptOutput, null, 2);
  if (renderedScriptOutput.length > PACKAGING_LIMITS.scriptOutputChars) {
    fail(`"scriptOutput" exceeds ${PACKAGING_LIMITS.scriptOutputChars} characters`);
  }
  const renderedDirectionOutput = JSON.stringify(directionOutput, null, 2);
  if (renderedDirectionOutput.length > PACKAGING_LIMITS.directionOutputChars) {
    fail(`"directionOutput" exceeds ${PACKAGING_LIMITS.directionOutputChars} characters`);
  }

  const requestedPlatforms = validateRequestedPlatforms(invocation.requestedPlatforms);

  assertRequiredPackagingEvidence(pack, registry);

  const usedClaims = scriptUsedClaimRecordsForPackaging(scriptOutput, truthOutput, pack);
  if (!usedClaims.length) {
    // See the zero-used-claims decision in this function's documentation.
    fail("hook-story-script bound no claims: refusing to adapt copy with no factual authority");
  }

  const { rawText, metadata } = await invokeStage({
    stage: PACKAGING_ADAPTATION_STAGE,
    registry,
    runner: invocation.runner,
    // This stage declares no reference asset. Explicit anyway, so adding one
    // later is a deliberate reviewed act rather than a silent channel change.
    referenceChannel: "omit",
    // Stage 2's output was needed to revalidate the chain; it is an input to the
    // validator, not to the model, and its wider whitelist and prose are not sent.
    dataBlocks: [
      { label: "SCRIPT_OUTPUT", body: renderedScriptOutput },
      { label: "PRODUCTION_OUTPUT", body: renderedDirectionOutput },
      { label: "REQUESTED_PLATFORMS", body: JSON.stringify(requestedPlatforms, null, 2) },
      {
        label: "SCRIPT_CLAIMS",
        body: renderPackagingScriptClaims(scriptOutput, truthOutput, pack),
      },
    ],
  });

  const parsed = parseStrictJsonObject(PACKAGING_ADAPTATION_STAGE, rawText);
  const output = validatePackagingAdaptationOutput(
    parsed, requestedPlatforms, scriptOutput, truthOutput, pack,
  );
  return { output, metadata };
}
