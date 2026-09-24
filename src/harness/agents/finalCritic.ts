/**
 * Phase 0B.6 — the `final-critic` stage executor, as a narrow critic panel.
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
 * ## One stage, four lenses, deterministic aggregation
 *
 * `final-critic` is still one registered stage (order 6). Its executor reviews
 * the package through four narrow **lenses**, in this order:
 *
 *  1. **evidence-fidelity** — `claim_fidelity`, `uncited_implication`;
 *  2. **platform-and-local** — `platform_semantics`,
 *     `hashtag_keyword_relevance`, `timing`;
 *  3. **voice-and-craft** — `voice_clarity`;
 *  4. **production-coherence** — `production_coherence`.
 *
 * Any lens may also raise `human_decision`. The validator refuses any other
 * category from a lens.
 *
 * Each lens is **exactly one model request** through the shared stage request
 * boundary (`invokeStage`): the `critic` policy, no retries, stop-reason checks,
 * the stream deadline. The four requests run concurrently. That is the one
 * amendment to "exactly one model request per stage" in this pipeline, and it
 * is narrow: **for final-critic only, exactly one request per lens, four lenses,
 * no retries.** Every other stage still makes exactly one request.
 *
 * Each lens has its own prompt (`agents/final-critic-<lens>.md`), its own
 * fact-free skills, its own input projection, its own categories and its own
 * output contract (`CRITIC_LENS_FIELD_LIMITS`, `CRITIC_LENS_OUTPUTS` in
 * `payloadContract.ts`). **If any lens fails — a request error, a refused or
 * truncated response, non-strict JSON, or a validation failure — the stage fails
 * closed** with a `CriticPanelError` naming every failed lens; no partial
 * critique is returned. The executor waits for every lens to settle before it
 * throws, so a caller recording raw responses (the local CLI does) keeps every
 * response that did return.
 *
 * **No model writes or merges the combined output.** TypeScript aggregates the
 * four validated lens outputs (`aggregateCriticPanel`):
 *
 *  - `findings` is the union of every lens's findings, in lens order, each
 *    carrying its `lens`; nothing is deduplicated;
 *  - `verdict`: any blocking finding → `needs_revision`; else any
 *    `human_decision` finding, or any lens verdict `needs_human_review` →
 *    `needs_human_review`; else `provisional_pass`;
 *  - the top-level `summary` is deterministic: finding counts per lens and
 *    severity;
 *  - each lens's own model-written summary is kept, attributed to its lens, in
 *    `lenses` — never merged into another.
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
 * This stage instead gets one tool-free prompt per lens, pinning no model, and
 * fact-free skills: `skills/critique-discipline/SKILL.md` for every lens,
 * `skills/claim-boundaries/SKILL.md` for evidence-fidelity,
 * `skills/platform-local-review/SKILL.md` for platform-and-local (not
 * `skills/platform-specs` or `skills/local-seo`, which carry concrete facts),
 * `skills/script-craft/SKILL.md` and `skills/adaptation-craft/SKILL.md` for
 * voice-and-craft, and `skills/production-craft/SKILL.md` for
 * production-coherence. None states a fact, names a legacy subagent, or
 * describes a provider payload.
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
 *    sense that neither becomes a new source of fact. Both reach the lenses as
 *    context to critique — that is this stage's entire job — but what a
 *    caption or a shot is *permitted* to have asserted is still measured
 *    against stage 3's used-claim set, exactly as it was when stage 5
 *    produced it.
 *  - **`PLATFORM_CLAIMS` narrows further still.** It is not stage 3's whole
 *    used-claim set; it is stage 5's own typed, per-platform claim bindings —
 *    the exact records stage 5 actually cited for each requested platform,
 *    never derived from a caption, a summary, or any other prose.
 *
 * Each lens receives only the bounded, labelled untrusted blocks its job needs
 * (`CRITIC_LENS_BLOCKS` in `payloadContract.ts` fixes the labels and order):
 *
 *  - **evidence-fidelity** — `SCRIPT_COPY` (stage 3's hook, beats and script),
 *    `OVERLAY_TEXT` (stage 4's on-screen wording, with the shot and shot
 *    subject each sits on), `PACKAGING_COPY` (each package's caption,
 *    hashtags, local keywords and contact line), `SCRIPT_CLAIMS`,
 *    `PLATFORM_CLAIMS`, and — reviewer-only — stage 2's `REQUIRED_CAVEATS` and
 *    `FORBIDDEN_CLAIMS`. Stage 2's caveats and forbidden claims are withheld
 *    from every writing stage after stage 3, so a writer cannot reach for a
 *    claim stage 3 did not use. **A reviewer writes no copy**: showing it the
 *    caveats lets it check the copy kept them, and gives it nothing it could
 *    put into a caption. Stage 2's assessment and restatements stay withheld.
 *  - **platform-and-local** — `PACKAGING_OUTPUT` (stage 5's output with its
 *    contact lines), `REQUESTED_PLATFORMS`, `PLATFORM_CLAIMS`.
 *  - **voice-and-craft** — `COPY`: the hook, the script and each caption.
 *  - **production-coherence** — `SCRIPT_OUTPUT`, `PRODUCTION_OUTPUT`,
 *    `PACKAGING_OUTPUT`.
 *
 * `PACKAGING_OUTPUT` is stage 5's output with the deterministic contact line
 * `contactLine.ts` attaches to every package — copied from the approved-facts
 * shop-name, phone and booking-link records, never written by a model. The
 * critic rebuilds each line from the pack and refuses a package whose line is
 * missing or differs, so every lens always sees the same package shape. The
 * complete pack, stage 2's assessment and restatements, stage 2's wider
 * whitelist, raw references, `config/approved-facts.json`, active environment
 * configuration, provider/account/location configuration, image or media
 * content, and any approval or publication state are never rendered to any
 * lens.
 *
 * ## What this stage guarantees, exactly
 *
 * **Guaranteed:**
 *  - Every lens's findings use only that lens's categories plus
 *    `human_decision`.
 *  - Every entry in a lens's typed claim-finding channel names a finding that
 *    lens actually returned, a platform that was actually requested, and a
 *    fact id stage 5 actually bound **for that platform**. Fabricated ids,
 *    wrong-platform ids, out-of-range finding indices, and exact-triple
 *    duplicates (the same finding citing the same platform and fact twice)
 *    all fail. A platform-specific finding's bindings must all name that
 *    finding's own platform; a `cross_platform` finding's bindings may name
 *    any requested platform, each still bound by stage 5 for that platform.
 *    Only the two lenses shown `PLATFORM_CLAIMS` have that channel at all.
 *  - The evidence class attached to a claim-finding entry always comes from
 *    the record stage 5 bound, never from the model's declaration.
 *  - Each lens's `verdict` is checked for **structural** self-consistency
 *    against its own findings' `severity` and `owner`: `provisional_pass`
 *    cannot coexist with a blocking finding; `needs_revision` requires at least
 *    one blocking finding owned by a revisable Stage 3/4/5 owner;
 *    `needs_human_review` requires at least one blocking finding owned by human
 *    review — a human-review verdict backed only by advisory findings fails.
 *    The panel's own verdict is then computed, never taken from a model.
 *  - All four prior-stage values (stage 2, 3, 4, 5) are revalidated against
 *    the same evidence pack, using the owning stages' own exported
 *    revalidators, before any model call, and the requested-platform sequence
 *    is checked to match stage 5's own package sequence exactly.
 *  - Every prose field a lens returns — its summary, each finding's issue and
 *    suggested action, and each claim-finding summary — is rejected if it
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
 * assessment this stage returns — the panel's and every lens's — including one
 * where a model itself expresses total confidence, invents an all-clear, or
 * otherwise argues for its own authority. Those fields are asserted by the
 * validator and the aggregator, not copied from a model, so a wrongly
 * optimistic model output cannot escape them — no lens contract has a field
 * through which a model could set any of them, so an attempt to smuggle one in
 * as an extra field is refused outright, not silently dropped. Verdict
 * consistency above is a check that a lens's own findings and their declared
 * owners do not contradict its own verdict; it is not a check that either is
 * true.
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
  PACKAGING_PLATFORMS,
  packagingClaimRecords,
  scriptUsedClaimRecordsForPackaging,
  renderPackagingScriptClaims,
  validateRequestedPlatforms,
} from "./packagingAdaptation.js";
import {
  StageExecutionError,
  StageExecutionMetadata,
  StageAssetUse,
  StageRunner,
  assertRequiredEvidenceKinds,
  invokeStage,
  parseStrictJsonObject,
} from "./stageExecution.js";
import {
  CRITIC_FIELD_LIMITS, CRITIC_LENSES, CRITIC_LENS_BINDS_CLAIMS, CRITIC_LENS_BLOCKS,
  CRITIC_LENS_FIELD_LIMITS, EVIDENCE_LIMITS, HANDOFF_GUARDS, CONTACTED_PACKAGING_OUTPUT,
  criticLensSpecId, isBoundedSerializableText, statedCeiling,
} from "./payloadContract.js";
import type { CriticLens } from "./payloadContract.js";
import type { ContactedPackagingOutput } from "./contactLine.js";
import { revalidateContactedPackagingOutput } from "./contactLine.js";
import {
  schemaArray, schemaEnum, schemaInteger, schemaObject, schemaString,
} from "./responseFormatKit.js";

export { CRITIC_LENSES } from "./payloadContract.js";
export type { CriticLens } from "./payloadContract.js";

export const FINAL_CRITIC_STAGE = "final-critic" as const;

/**
 * The serialized ceiling on a Stage 5 handoff, re-exported from the one
 * authority that derives it.
 *
 * The handoff is stage 5's output with the deterministic contact line attached
 * to every package (`contactLine.ts`), so the ceiling is
 * `CONTACTED_PACKAGING_OUTPUT` — stage 5's own `PACKAGING_OUTPUT` plus the
 * contact fields. The contact line is not model output, so stage 5's token
 * budget does not move; only this guard and this stage's assembled payloads do.
 *
 * This stage used to derive its own, with its own escape multiplier and its own
 * hand-chosen skeleton and short-field allowances. That derivation was correct
 * but private, so nothing prevented it drifting from the contract it described,
 * and nothing related it to the shared payload boundary. It now comes from
 * `payloadContract.ts` along with every other bound in the pipeline, measured
 * from a shape witness of the Stage 5 contract rather than from fixed
 * allowances.
 */
export const PACKAGING_OUTPUT_SERIALIZED_CEILING = CONTACTED_PACKAGING_OUTPUT.transportChars;

/**
 * Bounds on each lens's output and on the prior-stage values the panel is
 * shown.
 *
 * The output-field figures are the per-lens figures every lens instantiates
 * (`CRITIC_LENS_FIELD_LIMITS` in `payloadContract.ts`), identical across lenses.
 * Every one of the three prior-stage bounds is **exactly** the producing
 * stage's own derived ceiling, re-exported from `payloadContract.ts`:
 * `scriptOutputChars` is `SCRIPT_OUTPUT.transportChars`,
 * `directionOutputChars` is `DIRECTION_OUTPUT.transportChars`, and
 * `packagingOutputChars` is `CONTACTED_PACKAGING_OUTPUT.transportChars` — stage 5
 * plus its deterministic contact lines. Equality, not
 * mere sufficiency, is what the derivation regressions assert: a guard set
 * above its producer's ceiling would hide a future contract change instead of
 * failing on it, and a guard set below it would refuse a structurally valid
 * handoff. Stage 5 applies the same two mirrored values to the same two
 * handoffs, so this stage neither tightens nor loosens what the stage before
 * it accepts.
 *
 * **The available packaging payload is still a dynamic difference**, never a
 * fixed envelope constant: for each lens that is shown the packaging output, it
 * is `MAX_PAYLOAD_CHARS` minus the serialized sizes of the other framed blocks
 * in that lens's request, and those sizes move with the evidence. What the
 * payload-contract reconciliation changed is that the difference is now provably
 * positive at the worst case — evidence text is bounded in both TypeScript and
 * PostgreSQL, the pack projection is bounded in cardinality, and
 * `MAX_PAYLOAD_CHARS` is itself derived from the largest assembled request any
 * stage or lens can build — so no structurally valid pipeline can reach the
 * shared boundary. A regression asserts that, block by block, against a real
 * assembled prompt rather than a second copy of the arithmetic.
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

/**
 * Each lens's categories. Every lens may also raise `human_decision`; the
 * validator refuses any category outside a lens's own list, and the lens's
 * response schema enumerates only these.
 */
export const CRITIC_LENS_CATEGORIES: Readonly<Record<CriticLens, readonly CriticFindingCategory[]>> = {
  "evidence-fidelity": ["claim_fidelity", "uncited_implication", "human_decision"],
  "platform-and-local": ["platform_semantics", "hashtag_keyword_relevance", "timing", "human_decision"],
  "voice-and-craft": ["voice_clarity", "human_decision"],
  "production-coherence": ["production_coherence", "human_decision"],
};

/**
 * Each lens's instruction assets: one prompt and the fact-free skills it uses.
 * Every path is declared on the `final-critic` registry entry, and a request is
 * refused if it names one that is not.
 */
export const CRITIC_LENS_ASSETS: Readonly<Record<CriticLens, { prompt: string; skills: readonly string[] }>> = {
  "evidence-fidelity": {
    prompt: "agents/final-critic-evidence.md",
    skills: ["skills/critique-discipline/SKILL.md", "skills/claim-boundaries/SKILL.md"],
  },
  "platform-and-local": {
    prompt: "agents/final-critic-platform.md",
    skills: ["skills/critique-discipline/SKILL.md", "skills/platform-local-review/SKILL.md"],
  },
  "voice-and-craft": {
    prompt: "agents/final-critic-voice.md",
    skills: [
      "skills/critique-discipline/SKILL.md", "skills/script-craft/SKILL.md", "skills/adaptation-craft/SKILL.md",
    ],
  },
  "production-coherence": {
    prompt: "agents/final-critic-production.md",
    skills: ["skills/critique-discipline/SKILL.md", "skills/production-craft/SKILL.md"],
  },
};

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
 * one, which is also the anchor for a lens's `verdict` consistency below.
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
 * Closed set. A lens's opinion, and the panel's. Never an approval — see this
 * module's header for the honest guarantee this type does not weaken.
 */
export const CRITIC_VERDICTS = [
  "provisional_pass",
  "needs_revision",
  "needs_human_review",
] as const;
export type CriticVerdict = (typeof CRITIC_VERDICTS)[number];

/**
 * Exactly the fields each lens's contract allows. Anything else is an extra
 * field. Only a lens shown `PLATFORM_CLAIMS` has `claimFindingUse`.
 */
export const CRITIC_LENS_OUTPUT_FIELDS: Readonly<Record<CriticLens, readonly string[]>> = Object.fromEntries(
  CRITIC_LENSES.map((lens): [CriticLens, readonly string[]] => [
    lens,
    CRITIC_LENS_BINDS_CLAIMS[lens]
      ? ["verdict", "summary", "findings", "claimFindingUse"]
      : ["verdict", "summary", "findings"],
  ]),
) as unknown as Record<CriticLens, readonly string[]>;
export const ALLOWED_FINDING_FIELDS = [
  "severity", "category", "platform", "owner", "issue", "suggestedAction",
] as const;
const ALLOWED_CLAIM_FINDING_FIELDS = [
  "findingIndex", "platform", "factId", "summary",
] as const;

/**
 * The JSON Schema sent as `output_config.format` for one lens. Shape only.
 *
 * Built from the same `CRITIC_LENS_OUTPUT_FIELDS` and `CRITIC_LENS_CATEGORIES`
 * the validator reads. Internal-plumbing fields, and the reviewer-only `issue`
 * field, state `statedCeiling`, not the enforced limit: a `description` is a
 * model-facing channel, so it states what the prompt states. See
 * `STATED_FIELD_CEILINGS` and `REVIEWER_ONLY_MARGIN_FIELDS` in
 * `payloadContract.ts`.
 */
function criticLensResponseFormat(lens: CriticLens): Record<string, unknown> {
  const limits = CRITIC_LENS_FIELD_LIMITS[lens];
  const spec = criticLensSpecId(lens);
  const properties: Record<string, Record<string, unknown>> = {
    verdict: schemaEnum(CRITIC_VERDICTS, "This lens's provisional, non-approving verdict"),
    summary: schemaString("No recognizable URL syntax", limits.summaryChars),
    findings: schemaArray(
      schemaObject({
        severity: schemaEnum(CRITIC_FINDING_SEVERITIES, "Blocking or advisory"),
        category: schemaEnum(CRITIC_LENS_CATEGORIES[lens], "This lens's categories, or human_decision"),
        platform: schemaEnum(CRITIC_FINDING_PLATFORMS, "Which platform, or cross_platform"),
        owner: schemaEnum(CRITIC_FINDING_OWNERS, "Which stage or human must act"),
        issue: schemaString(
          "No recognizable URL syntax", statedCeiling(`${spec}.findings[].issue`, limits.issueChars),
        ),
        suggestedAction: schemaString("No recognizable URL syntax", limits.suggestedActionChars),
      }),
      "An empty findings array and a calm summary are a complete, correct answer",
      limits.maxFindings,
    ),
  };
  if (limits.claimFindingUse) {
    properties.claimFindingUse = schemaArray(
      schemaObject({
        findingIndex: schemaInteger("0-based index of a finding you returned"),
        platform: schemaEnum(PACKAGING_PLATFORMS, 'The bound platform; never "cross_platform"'),
        factId: schemaString("An id stage 5 bound on that exact platform"),
        summary: schemaString(
          "No recognizable URL syntax",
          statedCeiling(`${spec}.claimFindingUse[].summary`, limits.claimFindingUse.summaryChars),
        ),
      }),
      "Which stage-5-bound claim a finding discusses, if any",
      limits.claimFindingUse.maxEntries,
    );
  }
  // Same order as `CRITIC_LENS_OUTPUT_FIELDS`.
  return schemaObject(Object.fromEntries(
    CRITIC_LENS_OUTPUT_FIELDS[lens].map((field) => [field, properties[field]!]),
  ));
}

/** Each lens's `output_config.format` schema. */
export const CRITIC_LENS_RESPONSE_FORMATS: Readonly<Record<CriticLens, Record<string, unknown>>> = Object.fromEntries(
  CRITIC_LENSES.map((lens) => [lens, criticLensResponseFormat(lens)]),
) as Record<CriticLens, Record<string, unknown>>;

/**
 * One adversarial finding.
 *
 * Model prose throughout, branded unverified on its own: nothing here has
 * been checked for correctness, only for shape, bound length, enum
 * membership, and the absence of recognizable URL syntax.
 */
export interface CriticFinding {
  /** The lens that raised it. Set by the validator, never by the model. */
  lens: CriticLens;
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
  /** The lens whose finding this binding supports. */
  lens: CriticLens;
  /**
   * Index into `findings`. In a lens output, into that lens's findings; in the
   * panel's aggregated output, into the aggregated findings.
   */
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
 * One lens's model-authored critique, validated. Branded with the same five
 * literal-`false` fields as the panel's assessment.
 */
export interface CriticLensAssessment {
  readonly kind: "provisional_critic_lens_assessment";
  lens: CriticLens;
  readonly authoritative: false;
  readonly approvalGranted: false;
  readonly publishable: false;
  readonly executable: false;
  readonly productionValidated: false;
  verdict: CriticVerdict;
  summary: string;
  /** Order is preserved exactly as returned. */
  findings: CriticFinding[];
}

/** One lens's validated output. */
export interface CriticLensOutput {
  lens: CriticLens;
  provisional: CriticLensAssessment;
  /** Empty for a lens whose contract has no `claimFindingUse`. */
  claimFindingUse: CriticClaimFindingUse;
}

/**
 * One lens's own verdict and model-written summary, attributed to it in the
 * panel's output. Never merged with another lens's.
 */
export interface CriticLensSummary {
  readonly kind: "provisional_critic_lens_summary";
  lens: CriticLens;
  verdict: CriticVerdict;
  /** The lens's own model-written summary, verbatim. */
  summary: string;
  findingCount: number;
  /** Always false. A lens's summary is an opinion. */
  readonly authoritative: false;
}

/**
 * The panel's critique. Built by code from the four validated lens outputs —
 * no model writes or merges it.
 *
 * Branded and flagged with five literal-`false` fields, deliberately more
 * than any prior stage: this is the stage most likely to be misread as a
 * clearance, so the type refuses every reading of "this passed" it can name.
 * Nothing here may be published, executed, treated as an approval, or treated
 * as proof of production readiness — including when a model itself argues
 * that it should be.
 */
export interface ProvisionalCriticAssessment {
  readonly kind: "provisional_critic_assessment";
  /** How this assessment was produced: deterministic aggregation, not a model. */
  readonly aggregation: "deterministic_critic_panel";
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
  /** Computed by `aggregateCriticVerdict`. */
  verdict: CriticVerdict;
  /** Deterministic: finding counts per lens and severity. Not model prose. */
  summary: string;
  /** Each lens's own verdict and summary, in lens order. */
  lenses: CriticLensSummary[];
  /** Every lens's findings, in lens order, each carrying its lens. Not deduplicated. */
  findings: CriticFinding[];
}

export interface FinalCriticOutput {
  /** Untrusted, non-authoritative panel critique. Never an approval. */
  provisional: ProvisionalCriticAssessment;
  /** Typed, stage-5-bound record of which claim each aggregated finding discusses. */
  claimFindingUse: CriticClaimFindingUse;
}

export interface FinalCriticResult {
  output: FinalCriticOutput;
  /** The stage's metadata: four model requests, usage summed across lenses. */
  metadata: StageExecutionMetadata;
  /** Each lens request's own metadata, in lens order. */
  lenses: Array<{ lens: CriticLens; metadata: StageExecutionMetadata }>;
}

export interface FinalCriticInvocation {
  /** The complete typed output from stage 3. Untrusted context, never authority. */
  scriptOutput: HookStoryScriptOutput;
  /** The complete typed output from stage 4. Creative context only. */
  directionOutput: ProductionDirectionOutput;
  /**
   * The complete typed output from stage 5, with the deterministic contact line
   * attached to every package by `attachContactLines(...)`. What this stage
   * actually critiques. Every contact line is rebuilt from the pack and must
   * match exactly; a package without one is refused.
   */
  packagingOutput: ContactedPackagingOutput;
  /**
   * The complete typed output from stage 2.
   *
   * Used to revalidate the chain. Its caveats and forbidden claims are shown to
   * the evidence-fidelity lens alone, as reviewer-only input; its assessment,
   * its restatements and its wider whitelist are never shown to any lens.
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
  /**
   * Called once per lens. Each call's request carries its `lens` as a label;
   * the production runner ignores it.
   */
  runner: StageRunner;
}

/**
 * The panel failed closed: at least one lens did not return a valid critique.
 * Names every failed lens and why. No partial critique exists.
 */
export class CriticPanelError extends StageExecutionError {
  readonly lensFailures: ReadonlyArray<{ lens: CriticLens; message: string }>;
  readonly succeededLenses: readonly CriticLens[];
  constructor(
    lensFailures: ReadonlyArray<{ lens: CriticLens; message: string }>,
    succeededLenses: readonly CriticLens[],
  ) {
    super(
      FINAL_CRITIC_STAGE,
      `critic panel failed closed — ${lensFailures.length} of ${CRITIC_LENSES.length} lens(es) failed: `
      + lensFailures.map((f) => `[${f.lens}] ${f.message}`).join("; ")
      + ". No partial critique is returned.",
    );
    this.name = "CriticPanelError";
    this.lensFailures = lensFailures;
    this.succeededLenses = succeededLenses;
  }
}

const fail = (message: string): never => {
  throw new StageExecutionError(FINAL_CRITIC_STAGE, message);
};

function requireBoundedString(fail: (m: string) => never, value: unknown, field: string, max: number): string {
  if (typeof value !== "string") fail(`"${field}" must be a string`);
  const text = (value as string).trim();
  if (!text) fail(`"${field}" must not be empty`);
  // Reports the measurement, not only the bound: a paid response dies here.
  if (text.length > max) fail(`"${field}" exceeds ${max} characters (actual ${text.length})`);
  // Serializable text only. Control characters and unpaired surrogates are the
  // only things JSON.stringify expands sixfold; the shared helper also enforces
  // the UTF-8 byte allowance used by the worst-case token proof.
  if (!isBoundedSerializableText(text, max)) {
    fail(`"${field}" exceeds ${max} UTF-8 bytes or contains non-serializable text`);
  }
  return text;
}

function requireExactKeys(
  fail: (m: string) => never, obj: Record<string, unknown>, keys: readonly string[], label: string,
): void {
  const extras = Object.keys(obj).filter((k) => !keys.includes(k));
  if (extras.length) fail(`${label} has unknown field(s): ${extras.join(", ")}`);
  for (const key of keys) {
    if (!(key in obj)) fail(`${label} is missing "${key}"`);
  }
}

function requireObject(fail: (m: string) => never, value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`"${label}" must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireEnum<T extends string>(
  fail: (m: string) => never, value: unknown, allowed: readonly T[], field: string,
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(`"${field}" must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function requireUrlFreeText(fail: (m: string) => never, value: string, field: string): string {
  if (URL_SHAPED_TEXT_PATTERN.test(value)) {
    fail(`"${field}" must not contain a recognizable URL`);
  }
  return value;
}

/**
 * The bounded per-platform projection the two claim-binding lenses are shown.
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

/** The evidence-fidelity lens's `SCRIPT_COPY`: stage 3's hook, beats and script. */
export function renderScriptCopy(scriptOutput: HookStoryScriptOutput): string {
  const p = scriptOutput.provisional;
  return JSON.stringify({
    hook: p.hook,
    storyBeats: p.storyBeats.map((b) => ({ beat: b.beat, role: b.role })),
    script: p.script,
  }, null, 2);
}

/**
 * The evidence-fidelity lens's `OVERLAY_TEXT`: stage 4's on-screen wording, each
 * entry with its shot and that shot's subject, and nothing else of stage 4.
 */
export function renderOverlayText(directionOutput: ProductionDirectionOutput): string {
  const p = directionOutput.provisional;
  return JSON.stringify(p.overlayText.map((o) => ({
    shotIndex: o.shotIndex,
    role: o.role,
    shotSubject: p.shots[o.shotIndex]?.subject ?? "",
    text: o.text,
  })), null, 2);
}

/**
 * The evidence-fidelity lens's `PACKAGING_COPY`: each package's caption,
 * hashtags, local keywords and deterministic contact line.
 */
export function renderPackagingCopy(packagingOutput: ContactedPackagingOutput): string {
  return JSON.stringify(packagingOutput.provisional.packages.map((pkg) => ({
    platform: pkg.platform,
    caption: pkg.caption,
    hashtags: pkg.hashtags,
    localKeywords: pkg.localKeywords,
    contact: pkg.contact,
  })), null, 2);
}

/** The evidence-fidelity lens's `REQUIRED_CAVEATS`. Reviewer-only. */
export function renderRequiredCaveats(truthOutput: AutomotiveTruthOutput): string {
  return JSON.stringify(truthOutput.provisional.requiredCaveats, null, 2);
}

/** The evidence-fidelity lens's `FORBIDDEN_CLAIMS`. Reviewer-only. */
export function renderForbiddenClaims(truthOutput: AutomotiveTruthOutput): string {
  return JSON.stringify(
    truthOutput.provisional.forbiddenClaims.map((f) => ({ claim: f.claim, reason: f.reason })), null, 2,
  );
}

/** The voice-and-craft lens's `COPY`: the hook, the script and each caption. */
export function renderVoiceCopy(
  scriptOutput: HookStoryScriptOutput, packagingOutput: ContactedPackagingOutput,
): string {
  return JSON.stringify({
    hook: scriptOutput.provisional.hook,
    script: scriptOutput.provisional.script,
    captions: packagingOutput.provisional.packages.map((pkg) => ({ platform: pkg.platform, caption: pkg.caption })),
  }, null, 2);
}

/**
 * Validate one lens's object against that lens's contract and bind every
 * claim-finding entry to stage 5's actual per-platform claim bindings.
 *
 * **Scope of this function, stated precisely.** It validates *shape*,
 * *bounds*, *enums* — including that every category is one of **this lens's**
 * categories or `human_decision` — *finding-index and platform membership*,
 * *membership in stage 5's per-platform bound-claim set*, *recognizable URL
 * syntax in every model prose field*, *platform coherence between a finding and
 * its own claim-finding bindings*, and *structural consistency between the
 * lens's `verdict` and each finding's `severity`/`owner`*. It does not evaluate
 * whether a finding is correct, whether the package actually has the problem
 * described, whether a suggested action would fix it, or whether the verdict is
 * the right call. **No language model in this pipeline proves any of that true,
 * and nothing here treats one as though it did.**
 */
export function validateCriticLensOutput(
  lens: CriticLens,
  raw: Record<string, unknown>,
  requestedPlatforms: PackagingPlatform[],
  packagingOutput: PackagingAdaptationOutput,
  scriptOutput: HookStoryScriptOutput,
  truthOutput: AutomotiveTruthOutput,
  pack: EvidencePack,
): CriticLensOutput {
  const lensFail = (message: string): never => fail(`lens ${lens}: ${message}`);
  const limits = CRITIC_LENS_FIELD_LIMITS[lens];
  requireExactKeys(lensFail, raw, CRITIC_LENS_OUTPUT_FIELDS[lens], "output");

  const verdict = requireEnum(lensFail, raw.verdict, CRITIC_VERDICTS, "verdict");
  const summary = requireUrlFreeText(
    lensFail, requireBoundedString(lensFail, raw.summary, "summary", limits.summaryChars), "summary",
  );

  if (!Array.isArray(raw.findings)) lensFail('"findings" must be an array');
  const rawFindings = raw.findings as unknown[];
  if (rawFindings.length > limits.maxFindings) {
    lensFail(`"findings" exceeds ${limits.maxFindings} entries`);
  }
  const categories = CRITIC_LENS_CATEGORIES[lens];
  const findings: CriticFinding[] = rawFindings.map((entry, index) => {
    const obj = requireObject(lensFail, entry, `findings[${index}]`);
    requireExactKeys(lensFail, obj, ALLOWED_FINDING_FIELDS, "findings entry");
    return {
      lens,
      severity: requireEnum(lensFail, obj.severity, CRITIC_FINDING_SEVERITIES, `findings[${index}].severity`),
      // Restricted to this lens's categories plus human_decision: a lens that
      // strays into another lens's job is refused, not silently re-filed.
      category: requireEnum(lensFail, obj.category, categories, `findings[${index}].category`),
      platform: requireEnum(lensFail, obj.platform, CRITIC_FINDING_PLATFORMS, `findings[${index}].platform`),
      owner: requireEnum(lensFail, obj.owner, CRITIC_FINDING_OWNERS, `findings[${index}].owner`),
      issue: requireUrlFreeText(
        lensFail,
        requireBoundedString(lensFail, obj.issue, `findings[${index}].issue`, limits.issueChars),
        `findings[${index}].issue`,
      ),
      suggestedAction: requireUrlFreeText(
        lensFail,
        requireBoundedString(
          lensFail, obj.suggestedAction, `findings[${index}].suggestedAction`, limits.suggestedActionChars,
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
    lensFail('"verdict" is "provisional_pass", but a finding is marked severity "blocking"');
  }
  if (verdict === "needs_revision" && !hasRevisableBlocking) {
    lensFail(
      '"verdict" is "needs_revision", but no finding is both severity "blocking" and owned by a '
      + "revisable stage (hook-story-script, production-direction, or packaging-adaptation)",
    );
  }
  if (verdict === "needs_human_review" && !hasHumanBlocking) {
    lensFail(
      '"verdict" is "needs_human_review", but no finding is both severity "blocking" and owned by '
      + '"human_review" — a human-review verdict backed only by advisory findings is refused',
    );
  }

  const used: CriticClaimFindingBinding[] = [];
  if (limits.claimFindingUse) {
    // --- binding: stage 5's per-platform bound claims are the boundary ------
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

    if (!Array.isArray(raw.claimFindingUse)) lensFail('"claimFindingUse" must be an array');
    const rawClaimFindingUse = raw.claimFindingUse as unknown[];
    if (rawClaimFindingUse.length > limits.claimFindingUse.maxEntries) {
      lensFail(`"claimFindingUse" exceeds ${limits.claimFindingUse.maxEntries} entries`);
    }
    // Keyed by the exact (findingIndex, platform, factId) triple. A duplicate
    // triple is a repeated entry; the SAME (platform, factId) pair cited by two
    // genuinely different findings is not — each finding's use of a claim is
    // its own, independent citation.
    const seenTriples = new Set<string>();
    rawClaimFindingUse.forEach((entry, index) => {
      const obj = requireObject(lensFail, entry, `claimFindingUse[${index}]`);
      requireExactKeys(lensFail, obj, ALLOWED_CLAIM_FINDING_FIELDS, "claimFindingUse entry");

      if (typeof obj.findingIndex !== "number" || !Number.isInteger(obj.findingIndex)) {
        lensFail(`"claimFindingUse[${index}].findingIndex" must be an integer`);
      }
      const findingIndex = obj.findingIndex as number;
      if (findingIndex < 0 || findingIndex >= findings.length) {
        lensFail(
          `claimFindingUse[${index}] names finding ${findingIndex}, but only ${findings.length} `
          + "finding(s) were returned",
        );
      }
      const finding = findings[findingIndex]!;

      const platform = requireEnum(lensFail, obj.platform, PACKAGING_PLATFORMS, `claimFindingUse[${index}].platform`);
      if (!requestedSet.has(platform)) {
        lensFail(`claimFindingUse[${index}] names "${platform}", which was not requested`);
      }
      // Platform-specific findings may only bind claims on their own platform.
      // A cross_platform finding may bind any requested platform.
      if (finding.platform !== "cross_platform" && finding.platform !== platform) {
        lensFail(
          `claimFindingUse[${index}] names platform "${platform}", but finding ${findingIndex} is `
          + `scoped to "${finding.platform}" — a platform-specific finding's bindings must name its own platform`,
        );
      }

      const factId = requireBoundedString(
        lensFail, obj.factId, `claimFindingUse[${index}].factId`, EVIDENCE_LIMITS.idChars,
      );
      const record = boundByPlatform.get(platform)?.get(factId);
      if (!record) {
        lensFail(
          `claimFindingUse[${index}] cites "${factId}" for "${platform}", which packaging-adaptation `
          + "did not bind for that platform (a fabricated id, a script-only id, or a claim bound on a "
          + "different platform)",
        );
      }
      const triple = `${findingIndex} ${platform} ${factId}`;
      if (seenTriples.has(triple)) {
        lensFail(
          `claimFindingUse repeats the exact (finding, platform, fact) triple: finding ${findingIndex}, `
          + `"${platform}", "${factId}"`,
        );
      }
      seenTriples.add(triple);

      const bindingSummary = requireUrlFreeText(
        lensFail,
        requireBoundedString(
          lensFail, obj.summary, `claimFindingUse[${index}].summary`, limits.claimFindingUse!.summaryChars,
        ),
        `claimFindingUse[${index}].summary`,
      );

      used.push({
        kind: "evidence_bound_critic_claim_use",
        lens,
        findingIndex,
        platform,
        factId,
        factKind: record!.kind as CriticClaimFindingBinding["factKind"],
        provisionalSummary: bindingSummary,
        authoritative: false,
      });
    });
  }

  return {
    lens,
    provisional: {
      kind: "provisional_critic_lens_assessment",
      lens,
      authoritative: false,
      approvalGranted: false,
      publishable: false,
      executable: false,
      productionValidated: false,
      verdict,
      summary,
      findings,
    },
    claimFindingUse: { kind: "typed_critic_claim_use", used },
  };
}

/**
 * The panel's verdict, computed — never taken from a model.
 *
 * Any blocking finding → `needs_revision`. Else any `human_decision` finding, or
 * any lens verdict `needs_human_review` → `needs_human_review`. Else
 * `provisional_pass`. A lens's own `needs_human_review` requires a blocking
 * finding, so under the first rule it already yields `needs_revision`; the
 * second rule's lens-verdict arm is kept so the rule stands as written even if a
 * lens contract ever relaxes that. A blocking finding owned by `human_review`
 * still names its owner on the finding itself: the panel verdict is a triage
 * signal, the owner is the routing.
 */
export function aggregateCriticVerdict(lensOutputs: readonly CriticLensOutput[]): CriticVerdict {
  const findings = lensOutputs.flatMap((o) => o.provisional.findings);
  if (findings.some((f) => f.severity === "blocking")) return "needs_revision";
  if (findings.some((f) => f.category === "human_decision")
    || lensOutputs.some((o) => o.provisional.verdict === "needs_human_review")) {
    return "needs_human_review";
  }
  return "provisional_pass";
}

/**
 * The panel's top-level summary, deterministic: how many findings each lens
 * raised, and of what severity. It contains no model prose — each lens's own
 * summary is in `lenses`, attributed to it.
 */
export function criticPanelSummary(lensOutputs: readonly CriticLensOutput[], verdict: CriticVerdict): string {
  const count = (findings: readonly CriticFinding[], severity: CriticFindingSeverity) =>
    findings.filter((f) => f.severity === severity).length;
  const all = lensOutputs.flatMap((o) => o.provisional.findings);
  const perLens = lensOutputs.map((o) => {
    const f = o.provisional.findings;
    return `${o.lens}: ${f.length} (${count(f, "blocking")} blocking, ${count(f, "advisory")} advisory)`;
  });
  return `Critic panel, ${lensOutputs.length} lenses, deterministic aggregation — verdict ${verdict}. `
    + `${all.length} finding(s): ${count(all, "blocking")} blocking, ${count(all, "advisory")} advisory. `
    + `${perLens.join("; ")}.`;
}

/**
 * Aggregate the four validated lens outputs into the panel's output. Pure,
 * deterministic TypeScript: no model writes or merges any part of it.
 *
 * Findings are the union of every lens's findings, in lens order, each carrying
 * its lens, with no deduplication — two lenses flagging the same line is two
 * findings. Claim-finding bindings keep their lens and have their finding index
 * shifted to the aggregated findings array.
 */
export function aggregateCriticPanel(lensOutputs: readonly CriticLensOutput[]): FinalCriticOutput {
  const order = lensOutputs.map((o) => o.lens).join();
  if (order !== CRITIC_LENSES.join()) {
    fail(`the critic panel aggregates exactly the lenses ${CRITIC_LENSES.join(", ")}, in order; got ${order}`);
  }
  const findings: CriticFinding[] = [];
  const used: CriticClaimFindingBinding[] = [];
  for (const output of lensOutputs) {
    const offset = findings.length;
    findings.push(...output.provisional.findings);
    used.push(...output.claimFindingUse.used.map((b) => ({ ...b, findingIndex: offset + b.findingIndex })));
  }
  const verdict = aggregateCriticVerdict(lensOutputs);
  return {
    provisional: {
      kind: "provisional_critic_assessment",
      aggregation: "deterministic_critic_panel",
      authoritative: false,
      approvalGranted: false,
      publishable: false,
      executable: false,
      productionValidated: false,
      verdict,
      summary: criticPanelSummary(lensOutputs, verdict),
      lenses: lensOutputs.map((o) => ({
        kind: "provisional_critic_lens_summary",
        lens: o.lens,
        verdict: o.provisional.verdict,
        summary: o.provisional.summary,
        findingCount: o.provisional.findings.length,
        authoritative: false,
      })),
      findings,
    },
    claimFindingUse: { kind: "typed_critic_claim_use", used },
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

/** Sum each numeric usage key across lens requests; undefined when no lens reported usage. */
function sumUsage(metadata: readonly StageExecutionMetadata[]): Record<string, number> | undefined {
  const reported = metadata.map((m) => m.usage).filter((u): u is Record<string, number> => u !== undefined);
  if (!reported.length) return undefined;
  const total: Record<string, number> = {};
  for (const usage of reported) {
    for (const [key, value] of Object.entries(usage)) {
      if (typeof value === "number") total[key] = (total[key] ?? 0) + value;
    }
  }
  return total;
}

/**
 * Execute the final-critic stage: exactly one request per lens, four lenses,
 * concurrently, no retries.
 *
 * Fails closed on: a malformed, incompletely branded, evidence-inconsistent,
 * or oversized prior-stage value at any of the four preceding stages; a
 * requested-platform sequence that does not exactly match stage 5's own
 * package sequence; an empty stage 3 used-claim set; a lens block larger than
 * its derived ceiling; a missing asset. Every one of those is raised before any
 * model request exists. Then, per lens: a runner error or timeout, a refused,
 * truncated or unfinished response, non-strict JSON, any structural or policy
 * violation, a category outside the lens's own, and any claim-finding use that
 * is fabricated, wrong-platform, out-of-range, an exact-triple duplicate,
 * incoherent with its own finding's platform, or structurally inconsistent with
 * the lens's own verdict. **If any lens fails, the stage fails** with a
 * `CriticPanelError` naming every failed lens — after every lens has settled,
 * so no returned response is abandoned mid-flight. No lens is retried and no
 * second call is made for any lens.
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
  // Stage 5 is revalidated through its own revalidator
  // (`revalidatePackagingAdaptationOutput`, called inside
  // `revalidateContactedPackagingOutput`), and every contact line
  // is rebuilt from the approved-facts records in this pack and must match the
  // one supplied: every lens always sees the same package shape, and never a
  // contact line a model — or anyone — edited.
  const packagingOutput = revalidateContactedPackagingOutput(
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

  // Every block any lens is shown, by label. Each lens is sent exactly the
  // labels `CRITIC_LENS_BLOCKS` lists for it, in that order — the payload
  // contract, not this function, decides what a lens sees.
  const bodies: Record<string, string> = {
    SCRIPT_OUTPUT: renderedScriptOutput,
    PRODUCTION_OUTPUT: renderedDirectionOutput,
    PACKAGING_OUTPUT: renderedPackagingOutput,
    REQUESTED_PLATFORMS: JSON.stringify(requestedPlatforms, null, 2),
    SCRIPT_CLAIMS: renderPackagingScriptClaims(scriptOutput, truthOutput, pack),
    PLATFORM_CLAIMS: renderPlatformClaims(packagingOutput, requestedPlatforms, scriptOutput, truthOutput, pack),
    SCRIPT_COPY: renderScriptCopy(scriptOutput),
    OVERLAY_TEXT: renderOverlayText(directionOutput),
    PACKAGING_COPY: renderPackagingCopy(packagingOutput),
    REQUIRED_CAVEATS: renderRequiredCaveats(truthOutput),
    FORBIDDEN_CLAIMS: renderForbiddenClaims(truthOutput),
    COPY: renderVoiceCopy(scriptOutput, packagingOutput),
  };
  const lensBlocks = Object.fromEntries(CRITIC_LENSES.map((lens) => [
    lens,
    CRITIC_LENS_BLOCKS[lens].map(({ label, bodyChars }) => {
      const body = bodies[label];
      if (body === undefined) fail(`lens ${lens}: no renderer for block ${label}`);
      if (body!.length > bodyChars) {
        fail(`lens ${lens}: block ${label} exceeds its derived ceiling of ${bodyChars} characters`);
      }
      return { label, body: body! };
    }),
  ])) as Record<CriticLens, Array<{ label: string; body: string }>>;

  // One request per lens, concurrently. Every lens settles before anything is
  // decided, so a response that did return is never abandoned mid-flight — a
  // caller recording responses keeps it — and a failure in one lens does not
  // cancel a paid request in another.
  const settled = await Promise.allSettled(CRITIC_LENSES.map(async (lens) => {
    const assets = CRITIC_LENS_ASSETS[lens];
    const { rawText, metadata } = await invokeStage({
      stage: FINAL_CRITIC_STAGE,
      responseFormatSchema: CRITIC_LENS_RESPONSE_FORMATS[lens],
      registry,
      runner: invocation.runner,
      // This stage declares no reference asset. Explicit anyway, so adding one
      // later is a deliberate reviewed act rather than a silent channel change.
      referenceChannel: "omit",
      instructionAssets: [assets.prompt, ...assets.skills],
      lens,
      dataBlocks: lensBlocks[lens],
    });
    const parsed = parseStrictJsonObject(FINAL_CRITIC_STAGE, rawText);
    const output = validateCriticLensOutput(
      lens, parsed, requestedPlatforms, packagingOutput, scriptOutput, truthOutput, pack,
    );
    return { output, metadata };
  }));

  const lensFailures: Array<{ lens: CriticLens; message: string }> = [];
  const succeeded: Array<{ output: CriticLensOutput; metadata: StageExecutionMetadata }> = [];
  settled.forEach((result, index) => {
    const lens = CRITIC_LENSES[index]!;
    if (result.status === "fulfilled") succeeded.push(result.value);
    else lensFailures.push({ lens, message: (result.reason as Error)?.message ?? String(result.reason) });
  });
  if (lensFailures.length) {
    throw new CriticPanelError(lensFailures, succeeded.map((s) => s.output.lens));
  }

  const output = aggregateCriticPanel(succeeded.map((s) => s.output));
  const lensMetadata = succeeded.map((s) => s.metadata);
  const first = lensMetadata[0]!;
  // Every declared asset, with the channel it reached in at least one lens.
  const assets: StageAssetUse[] = first.assets.map((asset) => ({
    ...asset,
    channel: lensMetadata.some((m) => m.assets.some((a) => a.path === asset.path && a.channel === "instruction"))
      ? "instruction" : asset.channel,
  }));
  const costs = lensMetadata.map((m) => m.totalCostUsd);
  const metadata: StageExecutionMetadata = {
    stage: FINAL_CRITIC_STAGE,
    model: first.model,
    modelPolicy: first.modelPolicy,
    assets,
    modelRequests: lensMetadata.reduce((total, m) => total + m.modelRequests, 0),
    usage: sumUsage(lensMetadata),
    totalCostUsd: costs.every((c): c is number => typeof c === "number")
      ? costs.reduce((total, c) => total + c, 0) : undefined,
  };
  return {
    output,
    metadata,
    lenses: succeeded.map((s) => ({ lens: s.output.lens, metadata: s.metadata })),
  };
}
