/**
 * Phase 0B.6 — the `final-critic` stage executor.
 *
 * Stage 6 is the last of the six target Content Intelligence reasoning stages.
 * It reviews the finished, already-adapted package and returns an adversarial
 * opinion: a verdict, a summary, and a bounded list of findings. It is
 * **implemented, not wired**: nothing in the worker, scheduler, orchestrator,
 * approval path, publication path, provider path, media path, Slack path,
 * database, evidence-write path, or the
 * `/console/content-intelligence/preview` route calls it. Executing it
 * requires a caller to construct an invocation deliberately and supply a
 * runner.
 *
 * ## This is a second, different critic from the one already running
 *
 * German Car Depot's existing orchestrator already has an independent
 * reviewer — `agents/brand-compliance-critic.md`, running the
 * `skills/compliance-checklist/SKILL.md` rubric against a canonical package,
 * its exact provider payloads, and `config/approved-facts.json`. That critic
 * is **left completely alone**: its prompt, its skill, its approved-facts
 * reference, and the orchestrator call site that uses it are unchanged by
 * this stage's registration or by anything in this module. It is a different
 * contract for a different, currently-running pipeline, checked against a
 * provider payload this pipeline never builds.
 *
 * Stage 6 cannot reuse those assets and stays fact-free instead. Verified from
 * the merged files, before this registry entry was touched:
 *
 *  - `agents/brand-compliance-critic.md` pins a concrete model, declares
 *    `tools: Read, Skill`, reads `brief.approvedFacts` (a runtime-injected
 *    fact set this stage never receives), evaluates the exact provider
 *    payloads GCD's live posting path builds (account/location ids, API
 *    hosts and versions, image digests, alt text as transmitted), and returns
 *    a routing field naming one of the *legacy* subagents
 *    (`copywriter`/`image`/`hashtag-seo-timing`/`platform-formatter`) as the
 *    owner of a fix. None of that exists in the six-stage pipeline: there is
 *    no provider payload, no brief, no approved-facts injection, and no
 *    legacy subagent to route a fix to.
 *  - `skills/compliance-checklist/SKILL.md` is that critic's rubric, and it
 *    states concrete facts of its own — an address, a city, a warranty term,
 *    a slogan, image pixel and file-size ceilings, WCAG contrast numbers, and
 *    GBP field policy. Injecting it here would hand a stage whose only job is
 *    to critique what stage 3 and stage 5 actually claimed a second, wider,
 *    unclassified source of "fact" to reach for — exactly the widening every
 *    stage in this pipeline exists to refuse.
 *  - `config/approved-facts.json` is GCD's canonical business-fact
 *    reference. It is already the evidence system's source for
 *    `verified_business_fact` records (see `evidence/approvedFacts.ts`); a
 *    second, raw copy handed straight to this stage's model would compete
 *    with the classified, pack-bound projection that is supposed to be the
 *    sole factual input.
 *
 * All three assets are preserved byte-for-byte. `agents/brand-compliance-critic.md`
 * and `skills/compliance-checklist/SKILL.md` are removed from this registry
 * entry only; the orchestrator's existing call site is untouched, and no
 * other registered stage references either file.
 *
 * This stage instead gets `agents/final-critic.md` (tool-free, no pinned
 * model) and `skills/critique-discipline/SKILL.md` — both written to state no
 * fact, name no legacy subagent, and describe no provider payload.
 *
 * ## The authority boundary this stage exists to hold
 *
 * Stage 3's actually-used claims remain the complete factual authority, one
 * step further downstream than stage 5:
 *
 *  - Not stage 2's wider whitelist, not the complete evidence pack, not model
 *    knowledge, and not the rejected compliance-checklist rubric or
 *    approved-facts reference.
 *  - **Not stage 4's direction and not stage 5's captions either**, in the
 *    sense that neither becomes a new source of fact. Both reach the model as
 *    context to critique — that is this stage's entire job — but what a
 *    caption or a shot is *permitted* to have asserted is still measured
 *    against stage 3's used-claim set, exactly as it was when stage 5
 *    produced it.
 *  - **`PLATFORM_CLAIMS` narrows further still.** It is not stage 3's whole
 *    used-claim set; it is stage 5's own typed, per-platform claim bindings —
 *    the exact records stage 5 actually cited for each requested platform,
 *    never derived from a caption, a summary, or any other prose.
 *
 * The model receives exactly six bounded, labelled untrusted blocks:
 * `SCRIPT_OUTPUT`, `PRODUCTION_OUTPUT`, `PACKAGING_OUTPUT`,
 * `REQUESTED_PLATFORMS`, `SCRIPT_CLAIMS`, and `PLATFORM_CLAIMS`. The complete
 * pack, stage 2's provisional prose, stage 2's wider whitelist, raw
 * references, `config/approved-facts.json`, active environment
 * configuration, provider/account/location configuration, image or media
 * content, and any approval or publication state are never rendered.
 *
 * ## What this stage guarantees, exactly
 *
 * **Guaranteed:**
 *  - Every entry in the typed claim-finding channel names a finding the model
 *    actually returned, a platform that was actually requested, and a fact id
 *    stage 5 actually bound **for that platform**. Fabricated ids,
 *    wrong-platform ids, out-of-range finding indices, and exact-triple
 *    duplicates (the same finding citing the same platform and fact twice)
 *    all fail. A platform-specific finding's bindings must all name that
 *    finding's own platform; a `cross_platform` finding's bindings may name
 *    any requested platform, each still bound by stage 5 for that platform.
 *  - The evidence class attached to a claim-finding entry always comes from
 *    the record stage 5 bound, never from the model's declaration.
 *  - `verdict` is checked for **structural** self-consistency against each
 *    finding's `severity` and `owner`: `provisional_pass` cannot coexist with
 *    a blocking finding; `needs_revision` requires at least one blocking
 *    finding owned by a revisable Stage 3/4/5 owner; `needs_human_review`
 *    requires at least one blocking finding owned by human review — a
 *    human-review verdict backed only by advisory findings fails.
 *  - All four prior-stage values (stage 2, 3, 4, 5) are revalidated against
 *    the same evidence pack, using the owning stages' own exported
 *    revalidators, before any model call, and the requested-platform sequence
 *    is checked to match stage 5's own package sequence exactly.
 *  - Every prose field this stage returns — the summary, each finding's issue
 *    and suggested action, and each claim-finding summary — is rejected if it
 *    contains recognizable URL syntax, using the same guard stage 5 uses.
 *  - Nothing here may ever read as an approval. See the guarantee below,
 *    stated as its own section because it is the point of this stage.
 *
 * **The limit on prior-stage revalidation, stated exactly.** Prior-stage
 * values are treated as untrusted and revalidated against the same evidence
 * pack. Values that fail the prior contracts are refused before the model
 * call. This is structural validation, not provenance or authenticity
 * verification; a structurally valid deserialized or hand-built value can
 * pass.
 *
 * ## The honest guarantee: this is an opinion, never a clearance
 *
 * This stage may flag an unsupported claim's presence in the used-claim
 * projection it was shown, an uncited implication, a platform-semantics
 * problem, a voice/clarity concern, a hashtag or keyword relevance problem, a
 * timing concern, a production-coherence problem, or a matter it believes
 * only a human should decide.
 *
 * **It does not, and cannot, prove correctness, grant approval, gate
 * publication, validate production readiness, or replace the existing
 * `brand-compliance-critic` gate that the live orchestrator runs against the
 * real provider payload.** Nothing in this module's output may be read as
 * clearance: `authoritative`, `approvalGranted`, `publishable`, `executable`,
 * and `productionValidated` are always `false`, structurally, on every
 * assessment this stage returns — including one where the model itself
 * expresses total confidence, invents an all-clear, or otherwise argues for
 * its own authority. Those fields are asserted by the validator, not copied
 * from the model, so a wrongly optimistic model output cannot escape them —
 * the output contract has no field through which a model could set any of
 * them, so an attempt to smuggle one in as an extra field is refused outright,
 * not silently dropped. Verdict consistency above is a check that the
 * model's own findings and their declared owners do not contradict its own
 * verdict; it is not a check that either is true.
 *
 * ## What this stage is not allowed to do
 *
 * It produces a critique only. It does not approve, clear, gate, publish,
 * schedule, construct or validate a provider payload, select or name a
 * destination, account, location, page, host, endpoint or API version,
 * generate, inspect, or QC media, write to the database or the evidence
 * store, or contact any external system. It does not rewrite, revise, or
 * regenerate any prior stage's output — a finding is advice to a human, never
 * an edit. Those belong to deterministic runtime code, the existing
 * publishing critic and approval path, or a human.
 */

import { EvidenceRecord } from "../evidence/contract.js";
import { EvidencePack } from "../evidence/pack.js";
import { AgentRegistry } from "./registry.js";
import type { AutomotiveTruthOutput } from "./automotiveTruth.js";
import { revalidateAutomotiveTruthOutput } from "./automotiveTruth.js";
import type { HookStoryScriptOutput } from "./hookStoryScript.js";
import { revalidateHookStoryScriptOutput } from "./hookStoryScript.js";
import type { ProductionDirectionOutput } from "./productionDirection.js";
import { revalidateProductionDirectionOutput } from "./productionDirection.js";
import type { PackagingAdaptationOutput, PackagingPlatform } from "./packagingAdaptation.js";
import {
  URL_SHAPED_TEXT_PATTERN,
  PACKAGING_LIMITS,
  PACKAGING_PLATFORMS,
  PLATFORM_PACKAGING_POLICY,
  packagingClaimRecords,
  revalidatePackagingAdaptationOutput,
  scriptUsedClaimRecordsForPackaging,
  renderPackagingScriptClaims,
  validateRequestedPlatforms,
} from "./packagingAdaptation.js";
import {
  StageExecutionError,
  StageExecutionMetadata,
  StageRunner,
  assertRequiredEvidenceKinds,
  invokeStage,
  parseStrictJsonObject,
} from "./stageExecution.js";
import { CRITIC_FIELD_LIMITS, EVIDENCE_LIMITS, HANDOFF_GUARDS, PACKAGING_OUTPUT, isSerializableText } from "./payloadContract.js";

export const FINAL_CRITIC_STAGE = "final-critic" as const;

/**
 * The serialized ceiling on a Stage 5 handoff, re-exported from the one
 * authority that derives it.
 *
 * This stage used to derive its own, with its own escape multiplier and its own
 * hand-chosen skeleton and short-field allowances. That derivation was correct
 * but private, so nothing prevented it drifting from the contract it described,
 * and nothing related it to the shared payload boundary. It now comes from
 * `payloadContract.ts` along with every other bound in the pipeline, measured
 * from a shape witness of the Stage 5 contract rather than from fixed
 * allowances.
 */
export const PACKAGING_OUTPUT_SERIALIZED_CEILING = PACKAGING_OUTPUT.transportChars;

/**
 * Bounds on the model's output and on the prior-stage values it is shown.
 *
 * Every one of the three prior-stage bounds is **exactly** the producing
 * stage's own derived ceiling, re-exported from `payloadContract.ts`:
 * `scriptOutputChars` is `SCRIPT_OUTPUT.transportChars`,
 * `directionOutputChars` is `DIRECTION_OUTPUT.transportChars`, and
 * `packagingOutputChars` is `PACKAGING_OUTPUT.transportChars`. Equality, not
 * mere sufficiency, is what the derivation regressions assert: a guard set
 * above its producer's ceiling would hide a future contract change instead of
 * failing on it, and a guard set below it would refuse a structurally valid
 * handoff. Stage 5 applies the same two mirrored values to the same two
 * handoffs, so this stage neither tightens nor loosens what the stage before
 * it accepts.
 *
 * **The available packaging payload is still a dynamic difference**, never a
 * fixed envelope constant: it is `MAX_PAYLOAD_CHARS` minus the serialized
 * sizes of the other five framed blocks this stage assembles, and those sizes
 * move with the evidence. What the payload-contract reconciliation changed is
 * that the difference is now provably positive at the worst case — evidence
 * text is bounded in both TypeScript and PostgreSQL, the pack projection is
 * bounded in cardinality, and `MAX_PAYLOAD_CHARS` is itself derived from the
 * largest assembled stage ceiling — so no structurally valid pipeline can
 * reach the shared boundary. A regression asserts that, block by block,
 * against a real assembled prompt rather than a second copy of the arithmetic.
 *
 * **Still dormant.** Every stage reports `executionEnabled: false`, nothing
 * reaches an executor, and oversized input fails closed before any model call.
 * These bounds are derived and regression-tested, **not production-validated**.
 */
export const FINAL_CRITIC_LIMITS = {
  ...CRITIC_FIELD_LIMITS,
  scriptOutputChars: HANDOFF_GUARDS.scriptOutputChars,
  directionOutputChars: HANDOFF_GUARDS.directionOutputChars,
  packagingOutputChars: PACKAGING_OUTPUT_SERIALIZED_CEILING,
} as const;

/** Closed set. What kind of concern a finding raises. */
export const CRITIC_FINDING_CATEGORIES = [
  "claim_fidelity",
  "uncited_implication",
  "platform_semantics",
  "voice_clarity",
  "hashtag_keyword_relevance",
  "timing",
  "production_coherence",
  "human_decision",
] as const;
export type CriticFindingCategory = (typeof CRITIC_FINDING_CATEGORIES)[number];

/** Closed set. Whether a finding blocks, or is advisory only. */
export const CRITIC_FINDING_SEVERITIES = ["blocking", "advisory"] as const;
export type CriticFindingSeverity = (typeof CRITIC_FINDING_SEVERITIES)[number];

/**
 * Closed set. What a finding is about: one requested platform, or the package
 * as a whole. Distinct from `PackagingPlatform` alone so a cross-platform
 * finding (a hook-level inconsistency, for instance) has a place to live
 * without being falsely pinned to one channel.
 */
export const CRITIC_FINDING_PLATFORMS = [...PACKAGING_PLATFORMS, "cross_platform"] as const;
export type CriticFindingPlatform = (typeof CRITIC_FINDING_PLATFORMS)[number];

/**
 * Closed set. Who would act on a finding, if anyone does.
 *
 * A revisable owner names the upstream stage whose output would need to
 * change; `human_review` names a matter this pipeline cannot resolve by
 * revision at all — a judgement call for a person. Every finding must name
 * one, which is also the anchor for `verdict` consistency below.
 */
export const CRITIC_FINDING_OWNERS = [
  "hook-story-script",
  "production-direction",
  "packaging-adaptation",
  "human_review",
] as const;
export type CriticFindingOwner = (typeof CRITIC_FINDING_OWNERS)[number];

/** The three owners naming an upstream stage that could revise its output. */
const REVISABLE_OWNERS: ReadonlySet<CriticFindingOwner> = new Set([
  "hook-story-script", "production-direction", "packaging-adaptation",
]);

/**
 * Closed set. The critic's opinion. Never an approval — see this module's
 * header for the honest guarantee this type does not weaken.
 */
export const CRITIC_VERDICTS = [
  "provisional_pass",
  "needs_revision",
  "needs_human_review",
] as const;
export type CriticVerdict = (typeof CRITIC_VERDICTS)[number];

/** Exactly the fields the contract allows. Anything else is an extra field. */
const ALLOWED_OUTPUT_FIELDS = ["verdict", "summary", "findings", "claimFindingUse"] as const;
const ALLOWED_FINDING_FIELDS = [
  "severity", "category", "platform", "owner", "issue", "suggestedAction",
] as const;
const ALLOWED_CLAIM_FINDING_FIELDS = [
  "findingIndex", "platform", "factId", "summary",
] as const;

/**
 * One adversarial finding.
 *
 * Model prose throughout, branded unverified on its own: nothing here has
 * been checked for correctness, only for shape, bound length, enum
 * membership, and the absence of recognizable URL syntax.
 */
export interface CriticFinding {
  severity: CriticFindingSeverity;
  category: CriticFindingCategory;
  /** One requested platform, or `"cross_platform"` for a cross-platform concern. */
  platform: CriticFindingPlatform;
  /** Who would act on this, if anyone does — a revisable stage, or a human. */
  owner: CriticFindingOwner;
  issue: string;
  suggestedAction: string;
  /** Always false. A finding is an opinion, never an authoritative fact. */
  readonly authoritative: false;
}

/**
 * One recorded use of a stage-5-bound claim in one finding.
 *
 * The record is `findingIndex`, `platform`, and `factId`. `provisionalSummary`
 * is the model's wording, branded unverified beside it, exactly as every
 * other stage in this pipeline brands its prose next to its typed citation.
 */
export interface CriticClaimFindingBinding {
  readonly kind: "evidence_bound_critic_claim_use";
  /** Index into `findings`. Validated against the findings actually returned. */
  findingIndex: number;
  /** A platform that was actually requested. */
  platform: PackagingPlatform;
  /** A fact id stage 5 actually bound for this exact platform. */
  factId: string;
  /** Taken from the pack record via stage 5's binding. Never from the model. */
  factKind: "verified_automotive_fact" | "verified_business_fact";
  /** Model prose. Bounded in length; never checked for faithfulness. */
  provisionalSummary: string;
  /** Always false. No summary from this stage has been checked. */
  readonly authoritative: false;
}

/**
 * The typed claim-finding channel — structurally separate from the critique
 * prose, so a consumer cannot mistake a finding's wording for its evidence.
 */
export interface CriticClaimFindingUse {
  readonly kind: "typed_critic_claim_use";
  used: CriticClaimFindingBinding[];
}

/**
 * Model-authored critique from this stage.
 *
 * Branded and flagged with five literal-`false` fields, deliberately more
 * than any prior stage: this is the stage most likely to be misread as a
 * clearance, so the type refuses every reading of "this passed" it can name.
 * Nothing here may be published, executed, treated as an approval, or treated
 * as proof of production readiness — including when the model itself argues
 * that it should be.
 */
export interface ProvisionalCriticAssessment {
  readonly kind: "provisional_critic_assessment";
  /** Always false. An opinion is not a grant of authority. */
  readonly authoritative: false;
  /** Always false. Nothing here approves anything. */
  readonly approvalGranted: false;
  /** Always false. Nothing here may be published. */
  readonly publishable: false;
  /** Always false. This is advice for a human, not an instruction for a runtime. */
  readonly executable: false;
  /** Always false. This stage does not validate production readiness. */
  readonly productionValidated: false;
  verdict: CriticVerdict;
  summary: string;
  /** Order is preserved exactly as returned; it is part of the contract. */
  findings: CriticFinding[];
}

export interface FinalCriticOutput {
  /** Untrusted, non-authoritative model critique. Never an approval. */
  provisional: ProvisionalCriticAssessment;
  /** Typed, stage-5-bound record of which claim each finding discusses. */
  claimFindingUse: CriticClaimFindingUse;
}

export interface FinalCriticResult {
  output: FinalCriticOutput;
  metadata: StageExecutionMetadata;
}

export interface FinalCriticInvocation {
  /** The complete typed output from stage 3. Untrusted context, never authority. */
  scriptOutput: HookStoryScriptOutput;
  /** The complete typed output from stage 4. Creative context only. */
  directionOutput: ProductionDirectionOutput;
  /** The complete typed output from stage 5. What this stage actually critiques. */
  packagingOutput: PackagingAdaptationOutput;
  /**
   * The complete typed output from stage 2.
   *
   * Used only to revalidate the chain. It is never shown to the model: its
   * whitelist is wider than what stage 3 used, and its prose would be a
   * second, unused set of claims to reach for.
   */
  truthOutput: AutomotiveTruthOutput;
  /** The same pack that bound the whole chain. Revalidated against it. */
  evidencePack: EvidencePack;
  /**
   * Channels the finished package was adapted for. Must match stage 5's own
   * package sequence exactly — this stage critiques exactly what was
   * produced, not a different or partial platform set.
   */
  requestedPlatforms: PackagingPlatform[];
  registry?: AgentRegistry;
  runner: StageRunner;
}

const fail = (message: string): never => {
  throw new StageExecutionError(FINAL_CRITIC_STAGE, message);
};

function requireBoundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") fail(`"${field}" must be a string`);
  const text = (value as string).trim();
  if (!text) fail(`"${field}" must not be empty`);
  if (text.length > max) fail(`"${field}" exceeds ${max} characters`);
  // Serializable text only. Control characters and unpaired surrogates are the
  // only things JSON.stringify expands sixfold; excluding them is what lets
  // every payload derivation in payloadContract.ts use a factor of two.
  if (!isSerializableText(text)) {
    fail(`"${field}" contains a control character or unpaired surrogate`);
  }
  return text;
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

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(`"${field}" must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function requirePlatform(value: unknown, field: string): PackagingPlatform {
  if (typeof value !== "string" || !(PACKAGING_PLATFORMS as readonly string[]).includes(value)) {
    fail(`"${field}" must be one of: ${PACKAGING_PLATFORMS.join(", ")}`);
  }
  return value as PackagingPlatform;
}

function requireUrlFreeText(value: string, field: string): string {
  if (URL_SHAPED_TEXT_PATTERN.test(value)) {
    fail(`"${field}" must not contain a recognizable URL`);
  }
  return value;
}

/**
 * The bounded per-platform projection this stage's model is shown.
 *
 * Deliberately narrower than `SCRIPT_CLAIMS`: it is stage 5's own typed claim
 * bindings, drawn **only** via `packagingClaimRecords` — a caption, a
 * hashtag, a local keyword, or a claim-use summary is never the source. A
 * platform stage 5 did not actually cite anything for reports an empty
 * `claims` array rather than falling back to stage 3's wider used-claim set.
 */
export function renderPlatformClaims(
  packagingOutput: PackagingAdaptationOutput,
  requestedPlatforms: PackagingPlatform[],
  scriptOutput: HookStoryScriptOutput,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
): string {
  return JSON.stringify(
    requestedPlatforms.map((platform) => ({
      platform,
      // Ids only. The authoritative records for these ids are already in
      // SCRIPT_CLAIMS, exactly once each, and every stage 5 binding is by
      // construction a member of stage 3's used-claim set — so repeating the
      // whole record per platform added size without adding authority. What
      // this block carries is the part SCRIPT_CLAIMS cannot say: which of those
      // records stage 5 bound, on which platform, in stage 5's own order.
      factIds: packagingClaimRecords(packagingOutput, platform, scriptOutput, truthOutput, pack)
        .map((record) => record.id),
    })),
    null,
    2,
  );
}

/**
 * Validate the model's object against the contract and bind every
 * claim-finding entry to stage 5's actual per-platform claim bindings.
 *
 * **Scope of this function, stated precisely.** It validates *shape*,
 * *bounds*, *enums*, *finding-index and platform membership*, *membership in
 * stage 5's per-platform bound-claim set*, *recognizable URL syntax in every
 * model prose field*, *platform coherence between a finding and its own
 * claim-finding bindings*, and *structural consistency between `verdict` and
 * each finding's `severity`/`owner`*. It does not evaluate whether a finding
 * is correct, whether the package actually has the problem described,
 * whether a suggested action would fix it, or whether the verdict is the
 * right call. **No language model in this pipeline proves any of that true,
 * and nothing here treats one as though it did.**
 */
export function validateFinalCriticOutput(
  raw: Record<string, unknown>,
  requestedPlatforms: PackagingPlatform[],
  packagingOutput: PackagingAdaptationOutput,
  scriptOutput: HookStoryScriptOutput,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
): FinalCriticOutput {
  requireExactKeys(raw, [...ALLOWED_OUTPUT_FIELDS], "output");

  const verdict = requireEnum(raw.verdict, CRITIC_VERDICTS, "verdict");
  const summary = requireUrlFreeText(
    requireBoundedString(raw.summary, "summary", FINAL_CRITIC_LIMITS.summaryChars), "summary",
  );

  if (!Array.isArray(raw.findings)) fail('"findings" must be an array');
  const rawFindings = raw.findings as unknown[];
  if (rawFindings.length > FINAL_CRITIC_LIMITS.maxFindings) {
    fail(`"findings" exceeds ${FINAL_CRITIC_LIMITS.maxFindings} entries`);
  }
  const findings: CriticFinding[] = rawFindings.map((entry, index) => {
    const obj = requireObject(entry, `findings[${index}]`);
    requireExactKeys(obj, [...ALLOWED_FINDING_FIELDS], "findings entry");
    return {
      severity: requireEnum(obj.severity, CRITIC_FINDING_SEVERITIES, `findings[${index}].severity`),
      category: requireEnum(obj.category, CRITIC_FINDING_CATEGORIES, `findings[${index}].category`),
      platform: requireEnum(obj.platform, CRITIC_FINDING_PLATFORMS, `findings[${index}].platform`),
      owner: requireEnum(obj.owner, CRITIC_FINDING_OWNERS, `findings[${index}].owner`),
      issue: requireUrlFreeText(
        requireBoundedString(obj.issue, `findings[${index}].issue`, FINAL_CRITIC_LIMITS.issueChars),
        `findings[${index}].issue`,
      ),
      suggestedAction: requireUrlFreeText(
        requireBoundedString(
          obj.suggestedAction, `findings[${index}].suggestedAction`, FINAL_CRITIC_LIMITS.suggestedActionChars,
        ),
        `findings[${index}].suggestedAction`,
      ),
      authoritative: false,
    };
  });

  // --- structural verdict consistency: never a correctness proof ------------
  //
  // Anchored on each finding's *severity* and *owner*, not a separate
  // model-supplied boolean: a verdict claiming a shape of blocking work that
  // no finding's own severity+owner combination actually backs is refused.
  const blockingFindings = findings.filter((f) => f.severity === "blocking");
  const hasRevisableBlocking = blockingFindings.some((f) => REVISABLE_OWNERS.has(f.owner));
  const hasHumanBlocking = blockingFindings.some((f) => f.owner === "human_review");

  if (verdict === "provisional_pass" && blockingFindings.length > 0) {
    fail('"verdict" is "provisional_pass", but a finding is marked severity "blocking"');
  }
  if (verdict === "needs_revision" && !hasRevisableBlocking) {
    fail(
      '"verdict" is "needs_revision", but no finding is both severity "blocking" and owned by a '
      + "revisable stage (hook-story-script, production-direction, or packaging-adaptation)",
    );
  }
  if (verdict === "needs_human_review" && !hasHumanBlocking) {
    fail(
      '"verdict" is "needs_human_review", but no finding is both severity "blocking" and owned by '
      + '"human_review" — a human-review verdict backed only by advisory findings is refused',
    );
  }

  // --- binding: stage 5's per-platform bound claims are the boundary --------
  const requestedSet = new Set<string>(requestedPlatforms);
  const boundByPlatform = new Map<PackagingPlatform, Map<string, EvidenceRecord>>();
  for (const platform of requestedPlatforms) {
    boundByPlatform.set(
      platform,
      new Map(
        packagingClaimRecords(packagingOutput, platform, scriptOutput, truthOutput, pack)
          .map((record) => [record.id, record]),
      ),
    );
  }

  if (!Array.isArray(raw.claimFindingUse)) fail('"claimFindingUse" must be an array');
  const rawClaimFindingUse = raw.claimFindingUse as unknown[];
  if (rawClaimFindingUse.length > FINAL_CRITIC_LIMITS.maxClaimFindingUses) {
    fail(`"claimFindingUse" exceeds ${FINAL_CRITIC_LIMITS.maxClaimFindingUses} entries`);
  }
  // Keyed by the exact (findingIndex, platform, factId) triple. A duplicate
  // triple is a repeated entry; the SAME (platform, factId) pair cited by two
  // genuinely different findings is not — each finding's use of a claim is
  // its own, independent citation.
  const seenTriples = new Set<string>();
  const used: CriticClaimFindingBinding[] = rawClaimFindingUse.map((entry, index) => {
    const obj = requireObject(entry, `claimFindingUse[${index}]`);
    requireExactKeys(obj, [...ALLOWED_CLAIM_FINDING_FIELDS], "claimFindingUse entry");

    if (typeof obj.findingIndex !== "number" || !Number.isInteger(obj.findingIndex)) {
      fail(`"claimFindingUse[${index}].findingIndex" must be an integer`);
    }
    const findingIndex = obj.findingIndex as number;
    if (findingIndex < 0 || findingIndex >= findings.length) {
      fail(
        `claimFindingUse[${index}] names finding ${findingIndex}, but only ${findings.length} `
        + "finding(s) were returned",
      );
    }
    const finding = findings[findingIndex]!;

    const platform = requirePlatform(obj.platform, `claimFindingUse[${index}].platform`);
    if (!requestedSet.has(platform)) {
      fail(`claimFindingUse[${index}] names "${platform}", which was not requested`);
    }
    // Platform-specific findings may only bind claims on their own platform.
    // A cross_platform finding may bind any requested platform.
    if (finding.platform !== "cross_platform" && finding.platform !== platform) {
      fail(
        `claimFindingUse[${index}] names platform "${platform}", but finding ${findingIndex} is `
        + `scoped to "${finding.platform}" — a platform-specific finding's bindings must name its own platform`,
      );
    }

    const factId = requireBoundedString(obj.factId, `claimFindingUse[${index}].factId`, EVIDENCE_LIMITS.idChars);
    const record = boundByPlatform.get(platform)?.get(factId);
    if (!record) {
      fail(
        `claimFindingUse[${index}] cites "${factId}" for "${platform}", which packaging-adaptation `
        + "did not bind for that platform (a fabricated id, a script-only id, or a claim bound on a "
        + "different platform)",
      );
    }
    const triple = `${findingIndex} ${platform} ${factId}`;
    if (seenTriples.has(triple)) {
      fail(
        `claimFindingUse repeats the exact (finding, platform, fact) triple: finding ${findingIndex}, `
        + `"${platform}", "${factId}"`,
      );
    }
    seenTriples.add(triple);

    const summary = requireUrlFreeText(
      requireBoundedString(
        obj.summary, `claimFindingUse[${index}].summary`, FINAL_CRITIC_LIMITS.claimFindingSummaryChars,
      ),
      `claimFindingUse[${index}].summary`,
    );

    return {
      kind: "evidence_bound_critic_claim_use",
      findingIndex,
      platform,
      factId,
      factKind: record!.kind as CriticClaimFindingBinding["factKind"],
      provisionalSummary: summary,
      authoritative: false,
    };
  });

  return {
    provisional: {
      kind: "provisional_critic_assessment",
      authoritative: false,
      approvalGranted: false,
      publishable: false,
      executable: false,
      productionValidated: false,
      verdict,
      summary,
      findings,
    },
    claimFindingUse: {
      kind: "typed_critic_claim_use",
      used,
    },
  };
}

/**
 * The only supported way to turn this stage's output into evidence records.
 *
 * Reads the platform and the bound ids and nothing else. It never reads a
 * verdict, a summary, a finding's issue, owner, or suggested action, or a
 * claim-finding summary.
 */
export function criticClaimRecords(
  output: FinalCriticOutput,
  platform: PackagingPlatform,
  packagingOutput: PackagingAdaptationOutput,
  scriptOutput: HookStoryScriptOutput,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
): EvidenceRecord[] {
  const boundById = new Map(
    packagingClaimRecords(packagingOutput, platform, scriptOutput, truthOutput, pack)
      .map((record) => [record.id, record]),
  );
  return output.claimFindingUse.used
    .filter((binding) => binding.platform === platform)
    .map((binding) => boundById.get(binding.factId))
    .filter((r): r is EvidenceRecord => r !== undefined);
}

/**
 * What one platform's critiqued claims actually say, in the evidence system's
 * words.
 *
 * Drawn from the records, never from a finding's issue text or a
 * claim-finding summary. A summary that overstates its fact is contained by
 * exactly this: it is not what a downstream consumer reads back. It is
 * **not** contained by anything detecting the overstatement, because nothing
 * here does.
 */
export function criticClaimTexts(
  output: FinalCriticOutput,
  platform: PackagingPlatform,
  packagingOutput: PackagingAdaptationOutput,
  scriptOutput: HookStoryScriptOutput,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
): string[] {
  return criticClaimRecords(output, platform, packagingOutput, scriptOutput, truthOutput, pack)
    .map((record) => record.claim);
}

/**
 * Precondition inherited from this stage's registry entry.
 *
 * The registry declares no required evidence kind for this stage — its real
 * authority gate is stage 3's used-claim set, enforced below. Kept for
 * consistency with every other executor in this pipeline.
 */
export function assertRequiredFinalCriticEvidence(pack: EvidencePack, registry: AgentRegistry): void {
  assertRequiredEvidenceKinds(FINAL_CRITIC_STAGE, registry, pack);
}

/**
 * Execute the final-critic stage exactly once.
 *
 * Fails closed on: a malformed, incompletely branded, evidence-inconsistent,
 * or oversized prior-stage value at any of the four preceding stages; a
 * requested-platform sequence that does not exactly match stage 5's own
 * package sequence; an empty stage 3 used-claim set; a missing asset; a
 * runner error or timeout; non-strict JSON; any structural or policy
 * violation; and any claim-finding use that is fabricated, wrong-platform,
 * out-of-range, an exact-triple duplicate, incoherent with its own finding's
 * platform, or structurally inconsistent with its own verdict. Performs no
 * retry and no second model call.
 *
 * **The zero-used-claims decision, made explicitly.** Stage 5 already refuses
 * when stage 3 bound nothing, and stage 4 refuses before it. This stage does
 * not assume either was reached legitimately and refuses independently
 * **before its own model call**, for the same reason both of them do:
 * critiquing a package whose every factual implication has no evidence
 * authority behind it would produce a finished-looking opinion about nothing.
 * **Authority is never widened back to stage 2's whitelist or the evidence
 * pack to rescue the request.**
 *
 * It does **not** verify that any finding is correct, that the package
 * actually has the problem described, that a suggested action would fix it,
 * or that the verdict is the right call — see this module's header for the
 * exact, honestly-stated limit. It especially does not replace the existing
 * `brand-compliance-critic` gate the live orchestrator runs against the real
 * provider payload.
 */
export async function executeFinalCritic(
  invocation: FinalCriticInvocation,
): Promise<FinalCriticResult> {
  const registry = invocation.registry ?? new AgentRegistry();

  if (!invocation.evidencePack || typeof invocation.evidencePack !== "object") {
    fail("an evidence pack is required");
  }
  const pack = invocation.evidencePack;

  const truthOutput = revalidateAutomotiveTruthOutput(
    invocation.truthOutput, pack, FINAL_CRITIC_STAGE, "truthOutput",
  );
  const scriptOutput = revalidateHookStoryScriptOutput(
    invocation.scriptOutput, truthOutput, pack, FINAL_CRITIC_STAGE, "scriptOutput",
  );
  const directionOutput = revalidateProductionDirectionOutput(
    invocation.directionOutput, scriptOutput, truthOutput, pack,
    FINAL_CRITIC_STAGE, "directionOutput",
  );
  const packagingOutput = revalidatePackagingAdaptationOutput(
    invocation.packagingOutput, scriptOutput, truthOutput, pack,
    FINAL_CRITIC_STAGE, "packagingOutput",
  );

  // Requested-platform membership AND order, checked against what
  // packaging-adaptation actually produced — not merely a well-formed list.
  const requestedPlatforms = validateRequestedPlatforms(invocation.requestedPlatforms);
  const actualPlatforms = packagingOutput.provisional.packages.map((pkg) => pkg.platform);
  const sequenceMatches = requestedPlatforms.length === actualPlatforms.length
    && requestedPlatforms.every((platform, index) => platform === actualPlatforms[index]);
  if (!sequenceMatches) {
    fail(
      '"requestedPlatforms" does not match the packaging-adaptation output\'s platform sequence exactly '
      + `(packaging-adaptation produced: ${actualPlatforms.join(", ")}; requested: ${requestedPlatforms.join(", ")})`,
    );
  }

  const renderedScriptOutput = JSON.stringify(scriptOutput, null, 2);
  if (renderedScriptOutput.length > FINAL_CRITIC_LIMITS.scriptOutputChars) {
    fail(`"scriptOutput" exceeds ${FINAL_CRITIC_LIMITS.scriptOutputChars} characters`);
  }
  const renderedDirectionOutput = JSON.stringify(directionOutput, null, 2);
  if (renderedDirectionOutput.length > FINAL_CRITIC_LIMITS.directionOutputChars) {
    fail(`"directionOutput" exceeds ${FINAL_CRITIC_LIMITS.directionOutputChars} characters`);
  }
  const renderedPackagingOutput = JSON.stringify(packagingOutput, null, 2);
  if (renderedPackagingOutput.length > FINAL_CRITIC_LIMITS.packagingOutputChars) {
    fail(`"packagingOutput" exceeds ${FINAL_CRITIC_LIMITS.packagingOutputChars} characters`);
  }

  assertRequiredFinalCriticEvidence(pack, registry);

  const usedClaims = scriptUsedClaimRecordsForPackaging(scriptOutput, truthOutput, pack);
  if (!usedClaims.length) {
    // See the zero-used-claims decision in this function's documentation.
    fail("hook-story-script bound no claims: refusing to critique a package with no factual authority");
  }

  const { rawText, metadata } = await invokeStage({
    stage: FINAL_CRITIC_STAGE,
    registry,
    runner: invocation.runner,
    // This stage declares no reference asset. Explicit anyway, so adding one
    // later is a deliberate reviewed act rather than a silent channel change.
    referenceChannel: "omit",
    dataBlocks: [
      { label: "SCRIPT_OUTPUT", body: renderedScriptOutput },
      { label: "PRODUCTION_OUTPUT", body: renderedDirectionOutput },
      { label: "PACKAGING_OUTPUT", body: renderedPackagingOutput },
      { label: "REQUESTED_PLATFORMS", body: JSON.stringify(requestedPlatforms, null, 2) },
      {
        label: "SCRIPT_CLAIMS",
        body: renderPackagingScriptClaims(scriptOutput, truthOutput, pack),
      },
      {
        label: "PLATFORM_CLAIMS",
        body: renderPlatformClaims(packagingOutput, requestedPlatforms, scriptOutput, truthOutput, pack),
      },
    ],
  });

  const parsed = parseStrictJsonObject(FINAL_CRITIC_STAGE, rawText);
  const output = validateFinalCriticOutput(
    parsed, requestedPlatforms, packagingOutput, scriptOutput, truthOutput, pack,
  );
  return { output, metadata };
}
