/**
 * The payload contract — one authority for every bound in the six-stage
 * Content Intelligence pipeline.
 *
 * **Why this module exists.** Before it, three separate families of number were
 * chosen independently and could not be reconciled:
 *
 *  - Evidence claim text had no maximum at all, in TypeScript or in
 *    PostgreSQL, so every projection built from it was structurally unbounded.
 *  - Each consumer stage picked its own aggregate ceiling for the producer
 *    handoff it accepts (12,000 / 16,000 / 20,000 / 24,000). None was derived
 *    from the producer's contract, and several were *smaller* than the
 *    producer's own structural maximum, so a consumer could refuse a
 *    structurally valid upstream result.
 *  - The shared assembled-payload boundary was a round number with no recorded
 *    derivation, and no proof that a valid Stage 5 output could reach Stage 6.
 *
 * Everything here is derived, and derived once. A stage never computes a bound;
 * it imports one. The derivation regressions in the offline suite fail if a
 * hand-maintained number is reintroduced, if a producer maximum can exceed its
 * consumer's accepted maximum, or if a TypeScript bound and its PostgreSQL
 * constraint drift apart.
 *
 * **The derivation method, stated once.** For any bounded contract the
 * serialized upper bound is
 *
 *     skeleton + stringContent × MAX_JSON_ESCAPE_EXPANSION
 *
 * where `skeleton` is measured from a *shape witness* — a real instance of the
 * contract at maximum array cardinality with every bounded string emptied — and
 * `stringContent` is the sum of every bounded string field multiplied by the
 * cardinality it can appear at. This is an upper bound rather than the exact
 * maximum, and deliberately so:
 *
 *  - Keys, punctuation, indentation and closed enum values are ASCII we author,
 *    so the measured skeleton counts them exactly and they never expand.
 *  - Only field *content* can expand under `JSON.stringify`, and every bounded
 *    string in this pipeline is required to be *serializable text*, which can
 *    expand by at most two characters per source code unit. Multiplying content
 *    by two therefore cannot under-approximate. See
 *    `MAX_JSON_ESCAPE_EXPANSION`.
 *  - Cross-field rules that make two fields share one allowance are
 *    over-approximated by counting both at their individual maxima.
 *    Over-approximating a cross-field rule is safe; under-approximating one was
 *    the original defect.
 *
 * **Token guarantee.** Every bounded output string is limited by UTF-8 bytes as
 * well as JavaScript code units. The escaping-aware transport ceiling is
 * therefore also a serialized UTF-8 byte ceiling. A lossless tokenizer cannot
 * emit more ordinary text tokens than the non-empty byte sequences those
 * tokens represent, so pricing the whole transport at one token per byte is a
 * tokenizer-independent worst case. No provider or tokenizer is contacted.
 */

/**
 * The maximum characters `JSON.stringify` can emit per source code unit of
 * *serializable* text: two.
 *
 * `JSON.stringify` emits six characters — a `\uXXXX` escape — only for a
 * control character or an unpaired surrogate. Every other code unit costs at
 * most two (`"` and `\` double, and JSON has short escapes for tab, newline
 * and carriage return). Rather than carry a 6× multiplier through every
 * derivation — which compounds into ceilings no model could fill and no
 * payload could carry — the pipeline *excludes* the characters that cost six.
 * `isSerializableText` below is the rule, and it is enforced on every bounded
 * string in the evidence contract and in all six stage validators.
 *
 * The factor is two because the character set is bounded, not because six was
 * pessimistic. A regression proves both halves together: text that passes
 * `isSerializableText` never expands past 2×, and text that would expand
 * further is refused before it can reach a payload.
 */
export const MAX_JSON_ESCAPE_EXPANSION = 2;

/**
 * True when `JSON.stringify` will not emit a `\uXXXX` escape for this text.
 *
 * Refuses C0 and C1 control characters other than tab, newline and carriage
 * return — which JSON escapes to two characters — and refuses unpaired
 * surrogates, which are not well-formed text in any case and which
 * `JSON.stringify` emits as a six-character escape.
 *
 * This is a serialization rule and nothing more. It says nothing about whether
 * the text is true, safe, or appropriate.
 */
export function isSerializableText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    // C0 controls, except the three JSON gives a two-character escape.
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return false;
    // DEL and the C1 range.
    if (code >= 0x7f && code <= 0x9f) return false;
    // A high surrogate must be followed by a low one.
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
      continue;
    }
    // A low surrogate must never appear on its own.
    if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

/**
 * UTF-8 byte length without a Node import. `TextEncoder` is available in the
 * Node 22 runtime and keeps this authority module free of dependencies.
 */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** One token per serialized UTF-8 byte is the lossless worst-case ceiling. */
export const MAX_TOKENS_PER_UTF8_BYTE = 1;

/**
 * Every bounded field uses one numeric allowance for both code units and bytes.
 * ASCII can fill the whole allowance; multibyte text remains valid but reaches
 * the byte boundary sooner. This is what makes the serialized byte proof cover
 * unusual, contract-valid text rather than only ordinary prose.
 */
export function isBoundedSerializableText(value: string, max: number): boolean {
  return value.length <= max && utf8ByteLength(value) <= max && isSerializableText(value);
}

// ---------------------------------------------------------------------------
// Evidence bounds
// ---------------------------------------------------------------------------

/**
 * Bounds on a durable evidence record.
 *
 * Chosen from three inputs, in this order:
 *
 *  1. **The read-only production audit** (operator-run, 2026-09-02, aggregate
 *     only). `content_evidence` and `content_evidence_relations` are both
 *     empty, so no existing row constrains any bound. The audit rules a
 *     compatibility problem out; it does not by itself justify a number.
 *  2. **The existing product contract.** The only evidence source in the
 *     repository today is `config/approved-facts.json`, whose 27 adapted
 *     records measure: claim 481 characters at most, subject 16, attribute 24,
 *     id 39, sourceRef 51, provenance 122, reviewedBy 18, at most 3 tags of at
 *     most 21 characters, and detail serializing to at most 119 characters.
 *  3. **Worst-case payload requirements.** A claim is restated downstream into
 *     a restatement, paraphrased into a paraphrase and summarized into a
 *     claim-use summary, each *stated* to the model at 400 characters (their
 *     enforced ceilings are wider; see `STATED_FIELD_CEILINGS`). A claim
 *     materially longer than a small multiple of that figure cannot be
 *     faithfully restated in them
 *     anyway, and each claim is projected once per citing stage — and, at Stage
 *     6, once per platform that binds it.
 *
 * `claimChars` at 1,000 is therefore roughly twice the largest real claim
 * and two and a half times the figure a restatement is asked to fit, with
 * headroom for research claims that run longer than business facts. Every other bound is set
 * an order of magnitude above its observed maximum, because none of them
 * reaches a model payload (see `PROJECTED_EVIDENCE_STRING_CHARS`) and their
 * only cost is storage.
 */
export const EVIDENCE_LIMITS = {
  idChars: 200,
  claimChars: 1_000,
  subjectChars: 200,
  attributeChars: 120,
  tagChars: 60,
  maxTags: 16,
  sourceRefChars: 500,
  provenanceChars: 500,
  reviewedByChars: 200,
  /** PostgreSQL-canonical `jsonb::text` UTF-8 bytes, not compact JSON or key count. */
  detailSerializedChars: 4_000,
  relationNoteChars: 500,
  /**
   * The largest evidence pack a stage will project to a model.
   *
   * Stages 1 and 2 receive the whole classified pack. Without a cardinality
   * bound the `EVIDENCE` block has no finite maximum however tightly each
   * record is bounded, so the pack projection is bounded here and guarded in
   * both stages.
   *
   * This bounds the pack *in total*, across every classified section and every
   * unusable list — not per section. The checked-in source holds 27 adapted
   * records today; 64 is more than twice that, and a brief needing more than 64
   * classified records needs a narrower brief, not a larger payload.
   */
  maxProjectedRecords: 64,
  /**
   * The most conflict entries a consumer may accept from one pack. Conflict
   * detection is intentionally exhaustive and can produce n(n-1)/2 pairs; a
   * pack over this boundary is refused intact before every consumer. No pair is
   * dropped and no side is chosen as truth.
   */
  maxProjectedConflicts: 64,
} as const;

/**
 * Exactly the evidence fields any stage projection emits: `id`, `kind`,
 * `claim` and the optional `attribute`. `kind` is a closed enum counted in the
 * skeleton, so only these three contribute expandable content.
 *
 * Nothing else about a record — `subject`, `tags`, `sourceRef`, `provenance`,
 * `detail`, lifecycle or review metadata — ever reaches a model.
 */
export const PROJECTED_EVIDENCE_STRING_CHARS =
  EVIDENCE_LIMITS.idChars + EVIDENCE_LIMITS.claimChars + EVIDENCE_LIMITS.attributeChars;

// ---------------------------------------------------------------------------
// Per-stage field and cardinality limits
// ---------------------------------------------------------------------------
//
// These live here rather than in the six executors so that the derivations
// below and the executors themselves read the same numbers. Each executor
// re-exports the block it owns under its established name, so existing imports
// are unchanged.

/**
 * Stage 1 — strategy-concept.
 *
 * **Every output character field here is internal plumbing** (see
 * `OUTPUT_FIELD_BOUNDS`), so each value below is an *enforced ceiling* three
 * times the figure the prompt states. The stated figures live in
 * `STATED_FIELD_CEILINGS`; the prompt is unchanged and still states them. Do not
 * reconcile the two numbers into one. `goalChars` is caller input, not model
 * output, and has no stated figure.
 */
export const STRATEGY_LIMITS = {
  angleChars: 1_200,
  conceptChars: 3_600,
  rationaleChars: 6_000,
  hypothesisChars: 1_200,
  assumptionChars: 1_200,
  maxIds: 12,
  maxHypotheses: 6,
  maxAssumptions: 6,
  goalChars: 2_000,
} as const;

/**
 * Stage 1 emits three independently bounded id channels — `supportingFactIds`,
 * `observationIds` and `performanceSignalIds` — each capped at
 * `STRATEGY_LIMITS.maxIds`. Counted here rather than written as a literal `3`
 * inside the derivation so the reason for the multiplier is visible; a
 * derivation regression asserts the number matches the validator's channel
 * list, so adding a fourth channel without widening the ceiling fails.
 */
export const STRATEGY_ID_CHANNELS = 3;

/**
 * Stage 2 — automotive-truth, output fields only.
 *
 * `assessmentChars`, `restatementChars` and `caveatChars` are internal plumbing
 * and enforce three times their stated figure (see `STATED_FIELD_CEILINGS`).
 * `forbiddenClaimChars` and `openQuestionChars` are product-bearing — the prompt
 * names a human reviewer as their reader — and state exactly what they enforce.
 */
export const TRUTH_FIELD_LIMITS = {
  assessmentChars: 6_000,
  restatementChars: 1_200,
  forbiddenClaimChars: 400,
  caveatChars: 900,
  openQuestionChars: 300,
  maxAllowedClaims: 12,
  maxForbiddenClaims: 12,
  maxCaveats: 6,
  maxOpenQuestions: 6,
} as const;

/**
 * Stage 3 — hook-story-script, output fields only.
 *
 * `beatChars` and `paraphraseChars` are internal plumbing and enforce three
 * times their stated figure. `hookChars`, `scriptChars` and `openQuestionChars`
 * are product-bearing and unchanged.
 */
export const SCRIPT_FIELD_LIMITS = {
  hookChars: 300,
  beatChars: 1_200,
  scriptChars: 6_000,
  paraphraseChars: 1_200,
  openQuestionChars: 300,
  maxBeats: 8,
  maxClaimUses: 12,
  maxOpenQuestions: 6,
} as const;

/**
 * Stage 4 — production-direction, output fields only.
 *
 * Only `directionSummaryChars` is internal plumbing (three times its stated
 * figure). Everything else is the shot plan, on-screen wording or a request to
 * a human, and is product-bearing and unchanged.
 */
export const DIRECTION_FIELD_LIMITS = {
  visualApproachChars: 1_500,
  subjectChars: 300,
  actionChars: 400,
  compositionChars: 400,
  continuityChars: 300,
  overlayTextChars: 200,
  requirementChars: 300,
  directionSummaryChars: 1_200,
  openQuestionChars: 300,
  maxShots: 10,
  maxOverlayText: 10,
  maxRequirements: 12,
  maxClaimVisuals: 12,
  maxOpenQuestions: 6,
} as const;

/**
 * Stage 5 — packaging-adaptation, output fields only.
 *
 * `pipelineCaptionChars` is a **deliberate narrowing** of the product contract,
 * and the one place this reconciliation reduces a maximum rather than deriving
 * one. The per-platform provider limits in `packageMap.ts` are unchanged and
 * still apply; the effective cap for a package is the smaller of the two.
 *
 * Why: Facebook's provider limit is 63,206 characters. A single caption at that
 * length dominates every downstream derivation — it alone exceeds the whole
 * assembled payload of every other stage, and no output-token budget any model
 * offers could produce three of them in one response. This pipeline writes
 * short-form social copy: 2,200 characters is Instagram's own provider limit
 * and roughly 350 words, already longer than any caption the live posting path
 * has ever carried. Google Business Profile's 1,500 stays tighter still.
 *
 * The narrowing is recorded rather than hidden: a valid Stage 5 output under
 * the *old* contract could carry a longer Facebook caption than this one
 * accepts. Stage 5 has never executed, so no stored output is invalidated.
 *
 * Only `summaryChars` — the claim-use gloss — is internal plumbing, and it
 * enforces **two** times its stated figure rather than three: this stage sets
 * the `reasoning-standard` budget, so its margin is the one the headroom limits.
 * See `OUTPUT_FIELD_BOUNDS`.
 */
export const PACKAGING_FIELD_LIMITS = {
  pipelineCaptionChars: 2_200,
  localKeywordChars: 120,
  summaryChars: 800,
  openQuestionChars: 300,
  /**
   * The pipeline ceiling on local keyword phrases per package. Per platform the
   * effective cap may be lower — Google Business Profile's is two, from
   * `skills/local-seo` (`PLATFORM_LOCAL_KEYWORD_MAX` in `packagingAdaptation.ts`).
   * The derivation counts every package at this ceiling, which over-
   * approximates the narrower platform and moves no budget.
   */
  maxLocalKeywords: 6,
  maxOpenQuestions: 6,
  maxClaimUses: 24,
  maxRequestedPlatforms: 3,
  /**
   * The most hashtag tokens any one package may carry.
   *
   * Like `pipelineCaptionChars`, this is a pipeline-level bound that dominates
   * every provider policy from above: the effective per-platform maximum is the
   * smaller of the provider's `hashtagMax` and this number. Instagram's 15 is
   * the largest provider maximum in the repository, so this changes no
   * accepted output today; it exists so the packaging ceiling has a finite
   * array cardinality that a provider-policy change cannot quietly raise. A
   * derivation regression asserts every platform's `hashtagMax` is at or below
   * it, and Stage 5 enforces it alongside the per-platform rule.
   */
  maxHashtags: 15,
} as const;

/**
 * The deterministic contact line — room reserved in each platform's
 * provider-visible text for a line no model writes.
 *
 * On 2026-09-23 stage 1 planned a "book online or call" close, spent its twelve
 * citation slots on other facts, and never cited the phone number or the booking
 * link. Stage 3 wrote the close uncited, the critic flagged it, stage 5 dropped
 * it, and every caption shipped with no way to book. The owner decided that
 * contact details are attached **by code, never by a model**: they must match the
 * approved data exactly (`skills/local-seo`, "NAP consistency"), and they should
 * not compete for citation slots. `contactLine.ts` builds the line from the
 * evidence pack's approved-facts shop-name, phone and booking-link records after
 * stage 5 validates; this block only sizes the room it needs.
 *
 * Provider-visible text becomes caption + separator + hashtags + separator +
 * contact text, and it must still fit each platform's existing limit, so the
 * caption budget stage 5 is told and held to is that limit less this reserve.
 * Each reserve covers the two-character separator plus the platform's contact
 * text — in characters, and again in UTF-8 bytes — with headroom so a reformatted phone number or a longer booking link
 * fails closed on a free check rather than silently eating caption room:
 *
 *  - `instagram` — 64. The line is "Call ", the shop name, ": " and the phone
 *    number — "Call German Car Depot: " and the phone with today's records: 37
 *    characters, 39 with the separator.
 *  - `facebook` — 192. The same, then " · Book online: " and the booking link:
 *    130 characters today, 132 with the separator (133 UTF-8 bytes: "·" is two).
 *  - `google_business_profile` — 0. Google Business Profile carries no contact
 *    text; its booking link travels as a structured `BOOK` call to action, which
 *    is not part of the 1,500-character summary.
 *
 * The platform keys are stage 5's own closed enum; a regression asserts they are
 * exactly that enum, so a new platform cannot be added without a reserve.
 * Changing a reserve moves stage 5's caption budget, the prompt that states it,
 * and the response schema that describes it — the drift regressions fail until
 * all three agree.
 */
export const CONTACT_LINE_RESERVE_CHARS = {
  instagram: 64,
  facebook: 192,
  google_business_profile: 0,
} as const;

/**
 * The separator placed before contact text: a blank line, the same two-newline
 * separator that already precedes the hashtag list. Counted inside the reserve.
 */
export const CONTACT_LINE_SEPARATOR_CHARS = 2;

/**
 * The most contact text any one package carries: the widest reserve less its
 * separator. What the critic's packaging ceiling counts per package. Each
 * platform's own reserve is the tighter bound, and `contactLine.ts` holds the
 * text plus its separator to it in characters **and** in UTF-8 bytes — every
 * bounded string caps code units and bytes with one number, which is what lets
 * this allowance stand for both. (The Facebook template's "·" is two bytes, so
 * there bytes run one ahead of characters.)
 */
export const CONTACT_TEXT_MAX_CHARS =
  Math.max(...Object.values(CONTACT_LINE_RESERVE_CHARS)) - CONTACT_LINE_SEPARATOR_CHARS;

/**
 * The longest booking link a structured Google Business Profile call to action
 * may carry. Not provider-visible summary text, so it is not charged to any
 * reserve; bounded so the critic's packaging block keeps a finite maximum. Far
 * above today's 77-character link.
 */
export const CONTACT_CTA_URL_CHARS = 200;

/**
 * A contact line cites at most three records: the shop-name record (its text
 * names the shop), the phone record and the booking-link record. Facebook's line
 * uses all three; Instagram's uses the shop name and the phone; Google Business
 * Profile's structured call to action uses the booking link alone.
 */
export const CONTACT_LINE_MAX_SOURCE_FACTS = 3;

/**
 * Stage 6 — final-critic, output fields only.
 *
 * `summaryChars`, `issueChars` and `suggestedActionChars` are rendered for the
 * human reviewer and are product-bearing. `summaryChars` and
 * `suggestedActionChars` state exactly what they enforce.
 *
 * `issueChars` is the one product-bearing field that carries a margin: the
 * prompt states 400 and the validator enforces 600. Its sole reader is the
 * internal human reviewer — no platform or provider ever receives it — which is
 * the narrow condition `REVIEWER_ONLY_MARGIN_FIELDS` records. On 2026-09-23 the
 * critic wrote findings of 419 and 397 characters against 400; the 419-character
 * one was its only blocking finding, and it was correct, and the whole stage
 * was discarded for 19 characters.
 *
 * `claimFindingSummaryChars` is internal plumbing, at two and a half times its
 * stated figure.
 */
export const CRITIC_FIELD_LIMITS = {
  summaryChars: 1_500,
  issueChars: 600,
  suggestedActionChars: 300,
  claimFindingSummaryChars: 1_000,
  maxFindings: 20,
  maxClaimFindingUses: 24,
} as const;

/** The figure every critic lens prompt states for `findings[].issue` (enforced 600). */
const CRITIC_STATED_ISSUE_CHARS = 400;
/** The figure a claim-binding lens prompt states for `claimFindingUse[].summary` (enforced 1,000). */
const CRITIC_STATED_CLAIM_FINDING_SUMMARY_CHARS = 400;

/**
 * The critic panel: stage 6 reviews through four narrow lenses, in this order.
 *
 * `final-critic` is still one registered stage. Its executor sends one model
 * request per lens — four, concurrently, no retries — and aggregates the four
 * validated answers deterministically in TypeScript. Each lens has its own
 * prompt, its own input projection, its own finding categories and its own
 * output contract, so each is bounded and budgeted on its own.
 *
 * The order is the order findings are aggregated in.
 */
export const CRITIC_LENSES = [
  "evidence-fidelity",
  "platform-and-local",
  "voice-and-craft",
  "production-coherence",
] as const;
export type CriticLens = (typeof CRITIC_LENSES)[number];

/**
 * Whether a lens's contract carries `claimFindingUse`.
 *
 * Only a lens shown `PLATFORM_CLAIMS` can bind a finding to a claim stage 5
 * bound. The voice and production lenses are shown no claim block, so their
 * contract has no field through which to cite one.
 */
export const CRITIC_LENS_BINDS_CLAIMS: Readonly<Record<CriticLens, boolean>> = {
  "evidence-fidelity": true,
  "platform-and-local": true,
  "voice-and-craft": false,
  "production-coherence": false,
};

/** One lens's output-field limits. `claimFindingUse` is null when the lens binds no claim. */
export interface CriticLensFieldLimits {
  readonly summaryChars: number;
  readonly issueChars: number;
  readonly suggestedActionChars: number;
  readonly maxFindings: number;
  readonly claimFindingUse: { readonly maxEntries: number; readonly summaryChars: number } | null;
}

/**
 * Each lens's own output-field limits.
 *
 * Every lens instantiates the same per-field figures the single critic had —
 * `CRITIC_FIELD_LIMITS` — so no product decision moved when the critic was
 * split: a lens summary, issue and suggested action are exactly as long as the
 * single critic's, and a lens may carry as many findings as the single critic
 * could. They are declared per lens so each lens has its own contract, its own
 * classification rows and its own token floor, and so a later change to one
 * lens is a change to that lens alone.
 */
export const CRITIC_LENS_FIELD_LIMITS: Readonly<Record<CriticLens, CriticLensFieldLimits>> = Object.fromEntries(
  CRITIC_LENSES.map((lens) => [lens, {
    summaryChars: CRITIC_FIELD_LIMITS.summaryChars,
    issueChars: CRITIC_FIELD_LIMITS.issueChars,
    suggestedActionChars: CRITIC_FIELD_LIMITS.suggestedActionChars,
    maxFindings: CRITIC_FIELD_LIMITS.maxFindings,
    claimFindingUse: CRITIC_LENS_BINDS_CLAIMS[lens]
      ? {
        maxEntries: CRITIC_FIELD_LIMITS.maxClaimFindingUses,
        summaryChars: CRITIC_FIELD_LIMITS.claimFindingSummaryChars,
      }
      : null,
  } satisfies CriticLensFieldLimits]),
) as Record<CriticLens, CriticLensFieldLimits>;

/**
 * The specification id a lens's bounded fields are keyed under in
 * `OUTPUT_FIELD_BOUNDS` and `STATED_FIELD_CEILINGS`: `final-critic:<lens>`.
 * Stage ids contain no colon and no dot, so `<spec id>.<field token>` still
 * splits at its first dot.
 */
export function criticLensSpecId(lens: CriticLens): string {
  return `final-critic:${lens}`;
}

// ---------------------------------------------------------------------------
// Field classification — which limits are product decisions, and which are not
// ---------------------------------------------------------------------------

/**
 * **The principle.** The skills govern craft; this payload contract governs
 * size; and where the skills deliberately say nothing, the budget decides.
 *
 * Every bounded output field is one of two kinds, and only one of them has
 * research behind it:
 *
 *  - **Product-bearing.** Its content reaches a human reviewer, a platform
 *    payload, or a filming instruction. Its limit is a product decision — some
 *    are platform maxima from `packageMap.ts`, and `skills/platform-specs` is in
 *    places deliberately stricter than the platform (Instagram permits 30
 *    hashtags; the skill specifies 8–15). **These limits are not margins.** A
 *    product-bearing limit states exactly what it enforces — with one narrow,
 *    listed exception: a field whose *sole* reader is the internal human
 *    reviewer, and which has no platform or provider consumer, may carry a
 *    margin (`REVIEWER_ONLY_MARGIN_FIELDS`). Text sent to a platform never
 *    gets one.
 *  - **Internal plumbing.** A stage explaining itself, or a handoff to the next
 *    stage. No customer, platform or reviewer sees it, so no research specifies
 *    its length — `skills/script-craft` says in terms that it is "craft only"
 *    and excludes "character-count trimming". Its limit exists only to keep the
 *    payload and output-token budget finite. For a plumbing *character* field
 *    the prompt keeps its stated figure (the model's aim point) and the
 *    validator enforces a wider ceiling the model is never told about.
 *
 * **How each field was classified — traced, not assumed.** A field is
 * product-bearing if any of these holds for it:
 *
 *  - `review surface` — it is rendered for the human reviewer in the run
 *    summary, `markdownSummary` in `scripts/local/content-run.mjs`, the only
 *    human review surface this pipeline has. (That script also writes every
 *    stage's full JSON to disk as a run record; a record of everything is not a
 *    review surface, or no field could be plumbing.)
 *  - `human reader` — the stage prompt names a human as the field's reader
 *    ("what a human would have to verify", "tells … human reviewers",
 *    "what a human must provide").
 *  - `platform` — it becomes, or is validated as, provider-visible text against
 *    `PLATFORM_PACKAGING_POLICY`, or a skill governs it as platform copy.
 *  - `filming` — it is part of the shot plan, on-screen wording, or a
 *    production requirement a crew would act on.
 *
 * Otherwise it is plumbing, for one of two traced reasons:
 *
 *  - `handoff` — later stages receive it as untrusted context and nothing else
 *    reads it: no review surface renders it and no prompt names a human reader.
 *  - `binding gloss` — the model's own wording beside an evidence-id binding.
 *    Every such prompt says what the claim actually says is read back from the
 *    evidence record, never from this prose, so its length carries no product.
 *
 * Where a field was borderline the classification errs toward
 * product-bearing: calling a product field plumbing would widen a product
 * decision, while calling a plumbing field product-bearing only forgoes a
 * margin.
 *
 * Cardinalities are classified too, but only character fields are given a
 * margin. The measured failure is a model landing near a stated *length*; an
 * entry count is discrete and has not been observed to overshoot, and several
 * counts (`maxIds`, `maxAllowedClaims`, the claim-use counts) also size the
 * claim blocks later stages receive, so widening one is an authority change,
 * not slack.
 *
 * **Keys are `<stage id>.<field token>`** — the tokens the `CD` prompt-drift
 * assertions pair — plus stage 5's per-platform caption and hashtag fields,
 * whose limits the prompt states per platform. A regression asserts the keys,
 * values and units here equal the validators' own, that every plumbing
 * character field declares a stated figure and no product-bearing field does,
 * and that no plumbing field appears on the review surface.
 */
export type OutputFieldClass = "product-bearing" | "internal-plumbing";

export interface OutputFieldBound {
  /** The limit the validator enforces. */
  readonly enforced: number;
  readonly unit: "characters" | "entries" | "ids";
  readonly class: OutputFieldClass;
  /** The traced reason, in the vocabulary above. */
  readonly basis: string;
}

const product = (
  enforced: number, unit: OutputFieldBound["unit"], basis: string,
): OutputFieldBound => ({ enforced, unit, class: "product-bearing", basis });
const plumbing = (
  enforced: number, unit: OutputFieldBound["unit"], basis: string,
): OutputFieldBound => ({ enforced, unit, class: "internal-plumbing", basis });

const S1 = STRATEGY_LIMITS;
const S2 = TRUTH_FIELD_LIMITS;
const S3 = SCRIPT_FIELD_LIMITS;
const S4 = DIRECTION_FIELD_LIMITS;
const S5 = PACKAGING_FIELD_LIMITS;

export const OUTPUT_FIELD_BOUNDS: Readonly<Record<string, OutputFieldBound>> = {
  // Stage 1. The prompt: "recorded as provisional strategy material … passed to
  // automotive-truth as untrusted review data". Nothing renders it for review.
  "strategy-concept.angle": plumbing(S1.angleChars, "characters", "handoff to stages 2–3"),
  "strategy-concept.concept": plumbing(S1.conceptChars, "characters", "handoff to stages 2–3"),
  "strategy-concept.rationale": plumbing(S1.rationaleChars, "characters", "handoff; stage 1 explaining itself"),
  "strategy-concept.supportingFactIds": plumbing(S1.maxIds, "ids", "handoff; id channel, not prose"),
  "strategy-concept.observationIds": plumbing(S1.maxIds, "ids", "handoff; id channel, not prose"),
  "strategy-concept.performanceSignalIds": plumbing(S1.maxIds, "ids", "handoff; id channel, not prose"),
  "strategy-concept.hypotheses": plumbing(S1.maxHypotheses, "entries", "handoff to stages 2–3"),
  "strategy-concept.hypotheses[].statement": plumbing(S1.hypothesisChars, "characters", "handoff to stages 2–3"),
  "strategy-concept.assumptions": plumbing(S1.maxAssumptions, "entries", "handoff to stages 2–3"),
  "strategy-concept.assumptions[]": plumbing(S1.assumptionChars, "characters", "handoff to stages 2–3"),

  // Stage 2.
  "automotive-truth.assessment": plumbing(S2.assessmentChars, "characters", "handoff to stage 3; no human reader named"),
  "automotive-truth.allowedClaims": plumbing(S2.maxAllowedClaims, "entries", "handoff; sizes stage 3's PERMITTED_CLAIMS"),
  "automotive-truth.allowedClaims[].restatement": plumbing(S2.restatementChars, "characters", "binding gloss; claim text is read back from the record"),
  "automotive-truth.forbiddenClaims": product(S2.maxForbiddenClaims, "entries", "human reader: \"tells later stages and human reviewers\""),
  "automotive-truth.forbiddenClaims[].claim": product(S2.forbiddenClaimChars, "characters", "human reader: \"tells later stages and human reviewers\""),
  "automotive-truth.requiredCaveats": plumbing(S2.maxCaveats, "entries", "handoff to stage 3 and to the critic's evidence-fidelity lens (reviewer-only input); no human reader named"),
  "automotive-truth.requiredCaveats[]": plumbing(S2.caveatChars, "characters", "handoff to stage 3 and to the critic's evidence-fidelity lens (reviewer-only input); no human reader named"),
  "automotive-truth.openQuestions": product(S2.maxOpenQuestions, "entries", "human reader: \"what a human would have to verify\""),
  "automotive-truth.openQuestions[]": product(S2.openQuestionChars, "characters", "human reader: \"what a human would have to verify\""),

  // Stage 3. Governed by skills/script-craft, which sets no length.
  "hook-story-script.hook": product(S3.hookChars, "characters", "review surface: summary.md \"Hook\""),
  "hook-story-script.storyBeats": plumbing(S3.maxBeats, "entries", "handoff to stages 4–6"),
  "hook-story-script.storyBeats[].beat": plumbing(S3.beatChars, "characters", "handoff to stages 4–6; not rendered"),
  "hook-story-script.script": product(S3.scriptChars, "characters", "review surface: summary.md \"Script\""),
  "hook-story-script.claimUse": plumbing(S3.maxClaimUses, "entries", "handoff; sizes SCRIPT_CLAIMS for stages 4–6"),
  "hook-story-script.claimUse[].paraphrase": plumbing(S3.paraphraseChars, "characters", "binding gloss; claim text is read back from the record"),
  "hook-story-script.openQuestions": product(S3.maxOpenQuestions, "entries", "human reader: \"what a human would have to verify\""),
  "hook-story-script.openQuestions[]": product(S3.openQuestionChars, "characters", "human reader: \"what a human would have to verify\""),

  // Stage 4. Governed by skills/production-craft, which sets no length.
  "production-direction.visualApproach": product(S4.visualApproachChars, "characters", "filming: the sequence's one visual idea"),
  "production-direction.shots": product(S4.maxShots, "entries", "filming; review surface: summary.md \"Shot list\""),
  "production-direction.shots[].subject": product(S4.subjectChars, "characters", "filming: what is in frame"),
  "production-direction.shots[].action": product(S4.actionChars, "characters", "filming; review surface: summary.md \"Shot list\""),
  "production-direction.shots[].composition": product(S4.compositionChars, "characters", "filming: how the frame is arranged"),
  "production-direction.shots[].continuityNote": product(S4.continuityChars, "characters", "filming: what must match across a cut"),
  "production-direction.overlayText": product(S4.maxOverlayText, "entries", "filming: on-screen wording a viewer reads"),
  "production-direction.overlayText[].text": product(S4.overlayTextChars, "characters", "filming: on-screen wording a viewer reads"),
  "production-direction.productionRequirements": product(S4.maxRequirements, "entries", "filming; human reader: \"what a human must provide\""),
  "production-direction.productionRequirements[].requirement": product(S4.requirementChars, "characters", "filming; human reader: \"what a human must provide\""),
  "production-direction.claimVisuals": plumbing(S4.maxClaimVisuals, "entries", "handoff; id-to-shot binding"),
  "production-direction.claimVisuals[].directionSummary": plumbing(S4.directionSummaryChars, "characters", "binding gloss; claim text is read back from the record"),
  "production-direction.openQuestions": product(S4.maxOpenQuestions, "entries", "human reader: \"what a human must verify before production\""),
  "production-direction.openQuestions[]": product(S4.openQuestionChars, "characters", "human reader: \"what a human must verify before production\""),

  // Stage 5. Governed by skills/adaptation-craft, skills/platform-specs and
  // skills/local-seo.
  "packaging-adaptation.packages[].caption": product(S5.pipelineCaptionChars, "characters", "platform: provider-visible text; review surface: summary.md \"Captions\""),
  "packaging-adaptation.packages[].hashtags": product(S5.maxHashtags, "entries", "platform: provider-visible text; review surface: summary.md \"Captions\""),
  "packaging-adaptation.packages[].localKeywords": product(S5.maxLocalKeywords, "entries", "platform: SEO copy governed by skills/local-seo; per platform, this is the pipeline ceiling (Google Business Profile is narrower)"),
  "packaging-adaptation.packages[].localKeywords[]": product(S5.localKeywordChars, "characters", "platform: SEO copy governed by skills/local-seo"),
  "packaging-adaptation.packages[].openQuestions": product(S5.maxOpenQuestions, "entries", "human reader: \"what a human must decide\""),
  "packaging-adaptation.packages[].openQuestions[]": product(S5.openQuestionChars, "characters", "human reader: \"what a human must decide\""),
  "packaging-adaptation.claimUse": plumbing(S5.maxClaimUses, "entries", "handoff; sizes PLATFORM_CLAIMS for stage 6"),
  "packaging-adaptation.claimUse[].summary": plumbing(S5.summaryChars, "characters", "binding gloss; claim text is read back from the record"),

  // Stage 6, one set of rows per lens. Governed by skills/critique-discipline,
  // which sets no length. A lens's summary is rendered, attributed to its lens;
  // the panel's own summary is deterministic code, not model output.
  ...Object.fromEntries(CRITIC_LENSES.flatMap((lens) => {
    const spec = criticLensSpecId(lens);
    const limits = CRITIC_LENS_FIELD_LIMITS[lens];
    const rows: Array<[string, OutputFieldBound]> = [
      [`${spec}.summary`, product(limits.summaryChars, "characters", "review surface: summary.md \"Critic panel\", attributed to its lens")],
      [`${spec}.findings`, product(limits.maxFindings, "entries", "review surface: summary.md \"Critic panel\", grouped by lens")],
      [`${spec}.findings[].issue`, product(limits.issueChars, "characters", "review surface: summary.md \"Critic panel\"; sole reader the internal human reviewer, no platform or provider consumer")],
      [`${spec}.findings[].suggestedAction`, product(limits.suggestedActionChars, "characters", "review surface: summary.md \"Critic panel\"")],
    ];
    if (limits.claimFindingUse) {
      rows.push(
        [`${spec}.claimFindingUse`, plumbing(limits.claimFindingUse.maxEntries, "entries", "handoff; id-to-finding binding")],
        [`${spec}.claimFindingUse[].summary`, plumbing(limits.claimFindingUse.summaryChars, "characters", "binding gloss; claim text is read back from the record")],
      );
    }
    return rows;
  })),
};

/**
 * The figure the prompt states for each internal-plumbing character field, and
 * for the one reviewer-only product-bearing field in
 * `REVIEWER_ONLY_MARGIN_FIELDS` — deliberately **lower** than the ceiling its
 * validator enforces.
 *
 * **Why — the measurements, not a preference.** Authorized live runs measured
 * stage 1 against stated figures that were also the enforced ceilings:
 *
 *  - `concept`, stated 1,200: **1,196** (passed, by four) and **1,259** (+5%,
 *    and the paid response was discarded);
 *  - `rationale`, stated 2,000: **2,580** (+29%, discarded).
 *
 * A model aims at a stated number and lands around it. PR #81 separated
 * `concept`'s stated figure from its enforced ceiling with a 1.25× margin sized
 * on `concept`'s own ±5% spread; applied to `rationale` that margin is 2,500 —
 * still short of 2,580 — and `rationale` had no margin at all. Five of the six
 * stages have never returned a live response, so every other field's spread is
 * unknown. Discovering each one with a paid, discarded call is what this table
 * exists to stop.
 *
 * **Why not simply raise the stated number.** Because the stated number is the
 * aim point: raising it moves the aim and reproduces the same proportional
 * overshoot above it. The margin has to be one the model is never told about —
 * which is why the prompt, and the response schema `description`, keep the
 * figure below.
 *
 * **The margins are sized from budget headroom, not a uniform multiplier.** A
 * plumbing field's ceiling costs nothing a reviewer sees, only output-token
 * budget, so each stage takes the widest margin its policy can afford while
 * every policy keeps at least a fifth of its model's 128,000-token output cap
 * unallocated (≤ 102,400):
 *
 *  - **3×** — stages 1 and 2 (`reasoning-heavy`, 74,000) and stages 3 and 4
 *    (72,621 and 87,531 transport characters), which sit below stage 5 and so do
 *    not move the `reasoning-standard` budget at all.
 *  - **2×** — stage 5, which *sets* the `reasoning-standard` budget (99,000); 2.5×
 *    would reach 107,684.
 *  - **2.5×** — stage 6 (`critic`); sized at PR #85, when the critic ran with
 *    thinking disabled and its floor was 102,000 (3× would have reached 110,606).
 *    The critic now runs with adaptive thinking and `max_tokens` at its model's
 *    cap, so its floor is bounded instead by `THINKING_RESERVE_TOKENS` in
 *    `modelPolicy.ts`: the floor must leave that reserve under the cap.
 *
 * `CEILING_SLACK_MULTIPLIER` is the declared minimum under all three: 2×, well
 * clear of the largest overshoot yet measured (1.29×). The largest margin is 3×
 * because beyond that the budget, not the data, would be deciding.
 *
 * Every key must name an `internal-plumbing` character field in
 * `OUTPUT_FIELD_BOUNDS`, or a field listed in `REVIEWER_ONLY_MARGIN_FIELDS`; a
 * regression fails if any other product-bearing field is given one, or a
 * plumbing character field is left without one. A future reader must not
 * "tidy" a stated figure and its enforced ceiling back into one number: that is
 * the defect this table exists to hold open.
 */
export const STATED_FIELD_CEILINGS: Readonly<Record<string, number>> = {
  "strategy-concept.angle": 400,
  "strategy-concept.concept": 1_200,
  "strategy-concept.rationale": 2_000,
  "strategy-concept.hypotheses[].statement": 400,
  "strategy-concept.assumptions[]": 400,
  "automotive-truth.assessment": 2_000,
  "automotive-truth.allowedClaims[].restatement": 400,
  "automotive-truth.requiredCaveats[]": 300,
  "hook-story-script.storyBeats[].beat": 400,
  "hook-story-script.claimUse[].paraphrase": 400,
  "production-direction.claimVisuals[].directionSummary": 400,
  "packaging-adaptation.claimUse[].summary": 400,
  // Stage 6, per lens: every lens states the single critic's figures — 400 for
  // an issue (reviewer-only margin, enforced 600) and, on the two lenses that
  // bind claims, 400 for a claim-finding summary (plumbing, enforced 1,000).
  ...Object.fromEntries(CRITIC_LENSES.flatMap((lens) => [
    [`${criticLensSpecId(lens)}.findings[].issue`, CRITIC_STATED_ISSUE_CHARS],
    ...(CRITIC_LENS_BINDS_CLAIMS[lens]
      ? [[`${criticLensSpecId(lens)}.claimFindingUse[].summary`, CRITIC_STATED_CLAIM_FINDING_SUMMARY_CHARS]]
      : []),
  ])),
};

/**
 * The minimum ratio of enforced ceiling to stated figure for every field in
 * `STATED_FIELD_CEILINGS`. Narrowing any margin below it fails `CD0c`.
 */
export const CEILING_SLACK_MULTIPLIER = 2;

/**
 * The product-bearing fields allowed a hidden margin — **exactly one field,
 * `findings[].issue`, on each of the four critic lenses**.
 *
 * The rule PR #85 set, that every product-bearing field states exactly what it
 * enforces, is amended here and only here. A product-bearing field may carry a
 * margin only if its **sole reader is the internal human reviewer** and it has
 * **no platform or provider consumer**. Text that is sent to a platform never
 * gets one: a caption, a hashtag, a local keyword, on-screen wording or a shot
 * instruction is a product decision the platform or the crew acts on, and a
 * margin would silently widen it.
 *
 * A critic finding's `issue` qualifies: it is rendered only in the local
 * review summary, and nothing downstream sends it anywhere. The margin is 1.5×
 * (stated 400, enforced 600), against a measured 1.05× overshoot (419). When
 * the single critic became a panel of four lenses, the one field became one
 * field per lens — the same field, with the same reader, split four ways — so
 * the set names each lens's `findings[].issue` and nothing else.
 *
 * A regression asserts this set is exactly the four lenses' `findings[].issue`.
 * Adding a field is a product decision and must change that regression too.
 */
export const REVIEWER_ONLY_MARGIN_FIELDS: ReadonlySet<string> = new Set(
  CRITIC_LENSES.map((lens) => `${criticLensSpecId(lens)}.findings[].issue`),
);

/**
 * The minimum enforced-to-stated ratio for a `REVIEWER_ONLY_MARGIN_FIELDS`
 * entry. Lower than `CEILING_SLACK_MULTIPLIER` on purpose: the field is still
 * product-bearing, so its margin covers measured variance and nothing more.
 */
export const REVIEWER_ONLY_SLACK_MULTIPLIER = 1.5;

/**
 * The figure a prompt — and any other model-facing channel, such as a response
 * schema `description` — states for a bounded field.
 *
 * Defaults to the enforced limit, which is the case for every product-bearing
 * field except the reviewer-only ones in `REVIEWER_ONLY_MARGIN_FIELDS`. Callers pass the enforced value so a field with no declared stated
 * figure is unaffected by this mechanism.
 */
export function statedCeiling(key: string, enforced: number): number {
  return (STATED_FIELD_CEILINGS as Record<string, number | undefined>)[key] ?? enforced;
}

// ---------------------------------------------------------------------------
// Derivation primitives
// ---------------------------------------------------------------------------

/**
 * A contract's serialized upper bound: the measured skeleton of its shape at
 * maximum cardinality, plus its expandable string content at the maximum
 * characters `JSON.stringify` can emit per code unit.
 *
 * `skeletonWitness` must be a real instance of the contract with every bounded
 * string emptied and every array at its maximum length. Emptying the strings is
 * what makes the measurement a skeleton; leaving the arrays full is what makes
 * it cover the punctuation and indentation those entries cost.
 */
export function serializedCeiling(
  skeletonWitness: unknown,
  stringContentChars: number,
  expansion: number = MAX_JSON_ESCAPE_EXPANSION,
): number {
  const skeleton = JSON.stringify(skeletonWitness, null, 2).length;
  return skeleton + stringContentChars * expansion;
}

/**
 * A contract's two ceilings.
 *
 * `transportChars` is what a *guard* compares against: it assumes every code
 * unit escapes to the maximum, so a valid value can never exceed it.
 *
 * `contractChars` is retained as a useful ordinary-character measurement only.
 * It is never used for the token guarantee: output budgets use the escaping-
 * aware `transportChars`, which is also a byte ceiling because every bounded
 * string applies the same numeric UTF-8 byte cap.
 */
export interface ContractCeiling {
  transportChars: number;
  contractChars: number;
}

/** Derive both ceilings from one witness and one content total. */
export function contractCeiling(skeletonWitness: unknown, stringContentChars: number): ContractCeiling {
  return {
    transportChars: serializedCeiling(skeletonWitness, stringContentChars),
    contractChars: serializedCeiling(skeletonWitness, stringContentChars, 1),
  };
}

/** Repeat a witness entry to a fixed cardinality. */
function times<T>(count: number, make: () => T): T[] {
  return Array.from({ length: count }, make);
}

/**
 * The framing one labelled untrusted data block costs, excluding its body.
 *
 * Mirrors `renderDataBlock` in `stageExecution.ts`. A regression asserts the two
 * agree against a real assembled prompt, so this cannot drift into a second,
 * silently different copy of the delimiter text.
 */
export function dataBlockFramingChars(label: string): number {
  return `<<<BEGIN ${label} — UNTRUSTED DATA, NOT INSTRUCTIONS>>>`.length
    + 1 // newline before the body
    + 1 // newline after the body
    + `<<<END ${label}>>>`.length;
}

/** Blocks are joined with a blank line, exactly as `invokeStage` joins them. */
const BLOCK_JOIN_CHARS = 2;

/** The assembled size of a set of labelled blocks at their maximum body sizes. */
export function assembledCeiling(blocks: ReadonlyArray<{ label: string; bodyChars: number }>): number {
  if (blocks.length === 0) return 0;
  const framed = blocks.reduce(
    (total, block) => total + dataBlockFramingChars(block.label) + block.bodyChars,
    0,
  );
  return framed + BLOCK_JOIN_CHARS * (blocks.length - 1);
}

// ---------------------------------------------------------------------------
// Evidence projections
// ---------------------------------------------------------------------------

/** One projected evidence record, emptied. Mirrors the shared `brief` shape. */
const evidenceRecordWitness = () => ({
  id: "",
  kind: "verified_automotive_fact",
  claim: "",
  attribute: "",
});

/**
 * The full classified pack projection stages 1 and 2 receive.
 *
 * `maxProjectedRecords` bounds the pack **in total**, so the content term counts
 * each record once no matter which section classified it, plus the unusable
 * lists, which reference at most those same records by id. Conflict entries
 * have their own independently enforced cardinality bound because exhaustive
 * pairwise detection can otherwise grow as n(n-1)/2.
 *
 * The skeleton witness puts every record in a single section. Per-record
 * punctuation and indentation are identical across sections, so this measures
 * the true skeleton for a pack of this size rather than over-counting it six
 * times over.
 */
export const EVIDENCE_PACK_BLOCK_CHARS = serializedCeiling(
  {
    allowedFacts: times(EVIDENCE_LIMITS.maxProjectedRecords, evidenceRecordWitness),
    sourcedResearch: [],
    gcdObservations: [],
    performanceEvidence: [],
    creativeHypotheses: [],
    causalHypotheses: [],
    unusable: {
      // The conflict pairs. `conflictedEvidence` — the pack section holding the
      // authoritative records behind these ids — is deliberately NOT a
      // separate entry here: a pack invariant asserts the set of ids it holds
      // is exactly the set of ids these pairs name, so the exclusion is
      // already shown and a second list would only duplicate it. That
      // equivalence is what makes this witness still cover the real shape.
      conflicted: times(EVIDENCE_LIMITS.maxProjectedConflicts, () => ({ aId: "", bId: "", subject: "" })),
      stale: times(EVIDENCE_LIMITS.maxProjectedRecords, () => ""),
      inactive: times(EVIDENCE_LIMITS.maxProjectedRecords, () => ""),
      unsupportedAssumptions: times(EVIDENCE_LIMITS.maxProjectedRecords, () => ""),
    },
    // `counts` is a small map of section name to integer, authored by the pack
    // builder. Witnessed generously: far more keys than it can carry.
    counts: Object.fromEntries(times(24, () => 0).map((_, index) => [`section_${index}`, 0])),
  },
  EVIDENCE_LIMITS.maxProjectedRecords * (
    // Each record, projected once into whichever section classified it.
    PROJECTED_EVIDENCE_STRING_CHARS
    // The three unusable id lists.
    + 3 * EVIDENCE_LIMITS.idChars
  )
  // Conflicts are separate from record cardinality and never discarded.
  + EVIDENCE_LIMITS.maxProjectedConflicts
    * (2 * EVIDENCE_LIMITS.idChars + EVIDENCE_LIMITS.subjectChars),
);

/** A bounded list of projected claim records, as every claim block renders. */
function claimListChars(maxRecords: number): number {
  return serializedCeiling(
    times(maxRecords, evidenceRecordWitness),
    maxRecords * PROJECTED_EVIDENCE_STRING_CHARS,
  );
}

/** Stage 3's `PERMITTED_CLAIMS`: at most stage 2's whitelist. */
export const PERMITTED_CLAIMS_BLOCK_CHARS = claimListChars(TRUTH_FIELD_LIMITS.maxAllowedClaims);

/** Stages 4, 5 and 6's `SCRIPT_CLAIMS`: at most stage 3's used-claim set. */
export const SCRIPT_CLAIMS_BLOCK_CHARS = claimListChars(SCRIPT_FIELD_LIMITS.maxClaimUses);

/**
 * Stage 6's `PLATFORM_CLAIMS`, **narrowed**.
 *
 * It previously repeated the whole evidence record — id, kind, claim,
 * attribute — once for every platform that bound it, so one claim bound on
 * three platforms was projected three times. That duplication was the single
 * largest block in the pipeline and bought the critic nothing: the authoritative
 * records are already present, exactly once, in `SCRIPT_CLAIMS`, and every
 * Stage 5 binding is by construction a member of Stage 3's used-claim set.
 *
 * The block now carries only what the critique contract needs that
 * `SCRIPT_CLAIMS` does not already say: **which** of those records Stage 5
 * bound, **on which platform**, in Stage 5's own order. Evidence ids remain the
 * factual channel and the authoritative records remain in the payload; the
 * critic gains no authority it did not have, and loses no binding it needs.
 *
 * Every validator guarantee is untouched: platform membership and order, the
 * exact `(findingIndex, platform, factId)` duplicate identity, per-platform
 * fact binding, finding/platform coherence, verdict/owner consistency, the five
 * no-approval brands, and the zero-used-claims refusal all read Stage 5's typed
 * bindings, not this projection.
 */
export const PLATFORM_CLAIMS_BLOCK_CHARS = serializedCeiling(
  times(PACKAGING_FIELD_LIMITS.maxRequestedPlatforms, () => ({
    platform: "google_business_profile",
    factIds: times(PACKAGING_FIELD_LIMITS.maxClaimUses, () => ""),
  })),
  PACKAGING_FIELD_LIMITS.maxRequestedPlatforms
    * PACKAGING_FIELD_LIMITS.maxClaimUses
    * EVIDENCE_LIMITS.idChars,
);

/** Stage 5 and 6's `REQUESTED_PLATFORMS`: a short closed-vocabulary list. */
export const REQUESTED_PLATFORMS_BLOCK_CHARS = serializedCeiling(
  times(PACKAGING_FIELD_LIMITS.maxRequestedPlatforms, () => "google_business_profile"),
  0,
);

/** Stage 1's `GOAL` block: caller prose, bounded by the stage's own limit. */
export const GOAL_BLOCK_CHARS = STRATEGY_LIMITS.goalChars * MAX_JSON_ESCAPE_EXPANSION;

// ---------------------------------------------------------------------------
// Stage output ceilings
// ---------------------------------------------------------------------------
//
// Each is the serialized upper bound of the stage's *validated* output — the
// branded object a downstream stage receives, not the raw model object.

/** Stage 1 — `StrategyConceptOutput`. */
export const STRATEGY_OUTPUT = contractCeiling(
  {
    provisional: {
      kind: "provisional_model_prose",
      publishable: false,
      verified: false,
      angle: "",
      concept: "",
      rationale: "",
      hypotheses: times(STRATEGY_LIMITS.maxHypotheses, () => ({
        statement: "",
        basis: "creative",
      })),
      assumptions: times(STRATEGY_LIMITS.maxAssumptions, () => ""),
    },
    evidence: {
      kind: "typed_evidence_citations",
      supportingFactIds: times(STRATEGY_LIMITS.maxIds, () => ""),
      observationIds: times(STRATEGY_LIMITS.maxIds, () => ""),
      performanceSignalIds: times(STRATEGY_LIMITS.maxIds, () => ""),
    },
  },
  STRATEGY_LIMITS.angleChars
    + STRATEGY_LIMITS.conceptChars
    + STRATEGY_LIMITS.rationaleChars
    + STRATEGY_LIMITS.maxHypotheses * STRATEGY_LIMITS.hypothesisChars
    + STRATEGY_LIMITS.maxAssumptions * STRATEGY_LIMITS.assumptionChars
    // Three id channels, each independently bounded at `maxIds`.
    + STRATEGY_ID_CHANNELS * STRATEGY_LIMITS.maxIds * EVIDENCE_LIMITS.idChars,
);

/** Stage 2 — `AutomotiveTruthOutput`. */
export const TRUTH_OUTPUT = contractCeiling(
  {
    provisional: {
      kind: "provisional_model_prose",
      publishable: false,
      verified: false,
      assessment: "",
      forbiddenClaims: times(TRUTH_FIELD_LIMITS.maxForbiddenClaims, () => ({
        claim: "",
        reason: "outside_evidence_scope",
      })),
      requiredCaveats: times(TRUTH_FIELD_LIMITS.maxCaveats, () => ""),
      openQuestions: times(TRUTH_FIELD_LIMITS.maxOpenQuestions, () => ""),
    },
    constraints: {
      kind: "typed_claim_constraints",
      allowed: times(TRUTH_FIELD_LIMITS.maxAllowedClaims, () => ({
        kind: "evidence_bound_claim",
        factId: "",
        factKind: "verified_automotive_fact",
        claimClass: "automotive",
        provisionalRestatement: "",
        restatementVerified: false,
      })),
    },
  },
  TRUTH_FIELD_LIMITS.assessmentChars
    + TRUTH_FIELD_LIMITS.maxCaveats * TRUTH_FIELD_LIMITS.caveatChars
    + TRUTH_FIELD_LIMITS.maxOpenQuestions * TRUTH_FIELD_LIMITS.openQuestionChars
    + TRUTH_FIELD_LIMITS.maxForbiddenClaims * TRUTH_FIELD_LIMITS.forbiddenClaimChars
    + TRUTH_FIELD_LIMITS.maxAllowedClaims
      * (EVIDENCE_LIMITS.idChars + TRUTH_FIELD_LIMITS.restatementChars),
);

/** Stage 3 — `HookStoryScriptOutput`. */
export const SCRIPT_OUTPUT = contractCeiling(
  {
    provisional: {
      kind: "provisional_model_prose",
      publishable: false,
      verified: false,
      hook: "",
      storyBeats: times(SCRIPT_FIELD_LIMITS.maxBeats, () => ({ beat: "", role: "closing" })),
      script: "",
      openQuestions: times(SCRIPT_FIELD_LIMITS.maxOpenQuestions, () => ""),
    },
    claimUse: {
      kind: "typed_claim_use",
      used: times(SCRIPT_FIELD_LIMITS.maxClaimUses, () => ({
        kind: "evidence_bound_claim_use",
        factId: "",
        factKind: "verified_automotive_fact",
        usedIn: "script",
        provisionalParaphrase: "",
        paraphraseVerified: false,
      })),
    },
  },
  SCRIPT_FIELD_LIMITS.hookChars
    + SCRIPT_FIELD_LIMITS.scriptChars
    + SCRIPT_FIELD_LIMITS.maxBeats * SCRIPT_FIELD_LIMITS.beatChars
    + SCRIPT_FIELD_LIMITS.maxOpenQuestions * SCRIPT_FIELD_LIMITS.openQuestionChars
    + SCRIPT_FIELD_LIMITS.maxClaimUses
      * (EVIDENCE_LIMITS.idChars + SCRIPT_FIELD_LIMITS.paraphraseChars),
);

/** Stage 4 — `ProductionDirectionOutput`. */
export const DIRECTION_OUTPUT = contractCeiling(
  {
    provisional: {
      kind: "provisional_model_prose",
      publishable: false,
      verified: false,
      executable: false,
      visualApproach: "",
      shots: times(DIRECTION_FIELD_LIMITS.maxShots, () => ({
        purpose: "establishing",
        subject: "",
        framing: "over-the-shoulder",
        movement: "push-in",
        action: "",
        composition: "",
        continuityNote: "",
      })),
      overlayText: times(DIRECTION_FIELD_LIMITS.maxOverlayText, () => ({
        text: "",
        shotIndex: 0,
        role: "clarification",
        wordingVerified: false,
      })),
      productionRequirements: times(DIRECTION_FIELD_LIMITS.maxRequirements, () => ({
        requirement: "",
        category: "permission",
        availabilityVerified: false,
      })),
      openQuestions: times(DIRECTION_FIELD_LIMITS.maxOpenQuestions, () => ""),
    },
    claimVisuals: {
      kind: "typed_visual_claim_use",
      used: times(DIRECTION_FIELD_LIMITS.maxClaimVisuals, () => ({
        kind: "evidence_bound_visual_use",
        factId: "",
        factKind: "verified_automotive_fact",
        shotIndex: 0,
        provisionalDirectionSummary: "",
        directionVerified: false,
      })),
    },
  },
  DIRECTION_FIELD_LIMITS.visualApproachChars
    + DIRECTION_FIELD_LIMITS.maxShots * (
      DIRECTION_FIELD_LIMITS.subjectChars
      + DIRECTION_FIELD_LIMITS.actionChars
      + DIRECTION_FIELD_LIMITS.compositionChars
      + DIRECTION_FIELD_LIMITS.continuityChars
    )
    + DIRECTION_FIELD_LIMITS.maxOverlayText * DIRECTION_FIELD_LIMITS.overlayTextChars
    + DIRECTION_FIELD_LIMITS.maxRequirements * DIRECTION_FIELD_LIMITS.requirementChars
    + DIRECTION_FIELD_LIMITS.maxOpenQuestions * DIRECTION_FIELD_LIMITS.openQuestionChars
    + DIRECTION_FIELD_LIMITS.maxClaimVisuals
      * (EVIDENCE_LIMITS.idChars + DIRECTION_FIELD_LIMITS.directionSummaryChars),
);

/**
 * Stage 5 — `PackagingAdaptationOutput`.
 *
 * Every package is counted at `pipelineCaptionChars`, which bounds each
 * platform's *effective* cap from above: the effective cap is the smaller of
 * the provider limit and the pipeline limit, so it can never exceed the
 * pipeline limit. Google Business Profile's 1,500 is over-approximated by 700
 * characters as a result — safe, and it keeps this derivation free of platform
 * vocabulary and of `packageMap.ts`'s posting-tool dependency. The contact-line
 * reserve (`CONTACT_LINE_RESERVE_CHARS`) lowers every caption budget further, so
 * the over-approximation only widens. A derivation
 * regression asserts every platform's effective cap really is at or below
 * `pipelineCaptionChars`, so a provider-policy change cannot slip past it.
 *
 * Caption and hashtag content are each counted at a full cap although Stage 5's
 * combined provider-visible rule makes them share one. Over-approximating a
 * cross-field rule is safe.
 */
export const PACKAGING_OUTPUT = contractCeiling(
  {
    provisional: {
      kind: "provisional_model_prose",
      publishable: false,
      verified: false,
      executable: false,
      packages: times(PACKAGING_FIELD_LIMITS.maxRequestedPlatforms, () => ({
        platform: "google_business_profile",
        caption: "",
        captionVerified: false,
        hashtags: times(PACKAGING_FIELD_LIMITS.maxHashtags, () => ""),
        localKeywords: times(PACKAGING_FIELD_LIMITS.maxLocalKeywords, () => ""),
        selectionVerified: false,
        recommendedTime: "23:59 ET",
        timingVerified: false,
        schedulable: false,
        openQuestions: times(PACKAGING_FIELD_LIMITS.maxOpenQuestions, () => ""),
      })),
    },
    claimUse: {
      kind: "typed_platform_claim_use",
      used: times(PACKAGING_FIELD_LIMITS.maxClaimUses, () => ({
        kind: "evidence_bound_platform_claim_use",
        platform: "google_business_profile",
        factId: "",
        factKind: "verified_automotive_fact",
        provisionalSummary: "",
        wordingVerified: false,
      })),
    },
  },
  PACKAGING_FIELD_LIMITS.maxRequestedPlatforms * (
    PACKAGING_FIELD_LIMITS.pipelineCaptionChars // caption
    + PACKAGING_FIELD_LIMITS.pipelineCaptionChars // every hashtag token, jointly
    + PACKAGING_FIELD_LIMITS.maxLocalKeywords * PACKAGING_FIELD_LIMITS.localKeywordChars
    + PACKAGING_FIELD_LIMITS.maxOpenQuestions * PACKAGING_FIELD_LIMITS.openQuestionChars
  )
  + PACKAGING_FIELD_LIMITS.maxClaimUses
    * (EVIDENCE_LIMITS.idChars + PACKAGING_FIELD_LIMITS.summaryChars),
);

/**
 * Stage 5's output with the deterministic contact line attached to every package
 * — the `PACKAGING_OUTPUT` block the critic receives.
 *
 * Not model output: nothing here moves a token budget, because stage 5's own
 * response is still bounded by `PACKAGING_OUTPUT` above. It is the critic's
 * *input*, so it sizes the critic's handoff guard and its assembled payload.
 *
 * Every package is counted with every contact field at once — text at the widest
 * reserve less its separator, a structured call to action at
 * `CONTACT_CTA_URL_CHARS`, and both source-fact ids — though no real platform
 * carries both text and a call to action. Over-approximating is safe.
 */
export const CONTACTED_PACKAGING_OUTPUT = contractCeiling(
  {
    provisional: {
      kind: "provisional_model_prose",
      publishable: false,
      verified: false,
      executable: false,
      packages: times(PACKAGING_FIELD_LIMITS.maxRequestedPlatforms, () => ({
        platform: "google_business_profile",
        caption: "",
        captionVerified: false,
        hashtags: times(PACKAGING_FIELD_LIMITS.maxHashtags, () => ""),
        localKeywords: times(PACKAGING_FIELD_LIMITS.maxLocalKeywords, () => ""),
        selectionVerified: false,
        recommendedTime: "23:59 ET",
        timingVerified: false,
        schedulable: false,
        openQuestions: times(PACKAGING_FIELD_LIMITS.maxOpenQuestions, () => ""),
        contact: {
          kind: "deterministic_contact",
          text: "",
          gbpCta: { actionType: "BOOK", url: "" },
          sourceFactIds: times(CONTACT_LINE_MAX_SOURCE_FACTS, () => ""),
        },
      })),
    },
    claimUse: {
      kind: "typed_platform_claim_use",
      used: times(PACKAGING_FIELD_LIMITS.maxClaimUses, () => ({
        kind: "evidence_bound_platform_claim_use",
        platform: "google_business_profile",
        factId: "",
        factKind: "verified_automotive_fact",
        provisionalSummary: "",
        wordingVerified: false,
      })),
    },
  },
  PACKAGING_FIELD_LIMITS.maxRequestedPlatforms * (
    PACKAGING_FIELD_LIMITS.pipelineCaptionChars // caption
    + PACKAGING_FIELD_LIMITS.pipelineCaptionChars // every hashtag token, jointly
    + PACKAGING_FIELD_LIMITS.maxLocalKeywords * PACKAGING_FIELD_LIMITS.localKeywordChars
    + PACKAGING_FIELD_LIMITS.maxOpenQuestions * PACKAGING_FIELD_LIMITS.openQuestionChars
    + CONTACT_TEXT_MAX_CHARS // contact text, at the widest reserve less its separator
    + CONTACT_CTA_URL_CHARS
    + CONTACT_LINE_MAX_SOURCE_FACTS * EVIDENCE_LIMITS.idChars
  )
  + PACKAGING_FIELD_LIMITS.maxClaimUses
    * (EVIDENCE_LIMITS.idChars + PACKAGING_FIELD_LIMITS.summaryChars),
);

/**
 * Stage 6 — one critic lens's validated output. Never a handoff; bounded for the
 * budget proof, once per lens.
 *
 * The critic is a panel of four lenses, each a separate model request with its
 * own contract, so each lens's response is bounded — and its token floor derived
 * — on its own. The panel's aggregated `FinalCriticOutput` is not model output:
 * code builds it from the four validated lens outputs, so it needs no token
 * budget.
 *
 * The witness is the *validated* lens output, which carries everything the raw
 * response does plus the brands and the `lens` attribution the validator adds,
 * so it bounds the raw response from above. Every finding is witnessed with the
 * longest category any lens can emit (`hashtag_keyword_relevance`) and the
 * largest two-digit finding index, so no lens's real shape can exceed its own
 * witness.
 */
function criticLensOutputWitness(lens: CriticLens) {
  const limits = CRITIC_LENS_FIELD_LIMITS[lens];
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
      verdict: "needs_human_review",
      summary: "",
      findings: times(limits.maxFindings, () => ({
        lens,
        severity: "blocking",
        category: "hashtag_keyword_relevance",
        platform: "google_business_profile",
        owner: "packaging-adaptation",
        issue: "",
        suggestedAction: "",
        authoritative: false,
      })),
    },
    claimFindingUse: {
      kind: "typed_critic_claim_use",
      used: times(limits.claimFindingUse?.maxEntries ?? 0, () => ({
        kind: "evidence_bound_critic_claim_use",
        lens,
        findingIndex: limits.maxFindings - 1,
        platform: "google_business_profile",
        factId: "",
        factKind: "verified_automotive_fact",
        provisionalSummary: "",
        authoritative: false,
      })),
    },
  };
}

export const CRITIC_LENS_OUTPUTS: Readonly<Record<CriticLens, ContractCeiling>> = Object.fromEntries(
  CRITIC_LENSES.map((lens) => {
    const limits = CRITIC_LENS_FIELD_LIMITS[lens];
    return [lens, contractCeiling(
      criticLensOutputWitness(lens),
      limits.summaryChars
        + limits.maxFindings * (limits.issueChars + limits.suggestedActionChars)
        + (limits.claimFindingUse
          ? limits.claimFindingUse.maxEntries * (EVIDENCE_LIMITS.idChars + limits.claimFindingUse.summaryChars)
          : 0),
    )];
  }),
) as Record<CriticLens, ContractCeiling>;

// ---------------------------------------------------------------------------
// Stage 6 lens inputs — the narrower projections each critic lens is shown
// ---------------------------------------------------------------------------

/**
 * The evidence-fidelity lens's `SCRIPT_COPY`: stage 3's hook, ordered beats and
 * script — the words a claim can hide in — without its claim-use glosses or
 * open questions.
 */
export const SCRIPT_COPY_BLOCK_CHARS = serializedCeiling(
  {
    hook: "",
    storyBeats: times(SCRIPT_FIELD_LIMITS.maxBeats, () => ({ beat: "", role: "closing" })),
    script: "",
  },
  SCRIPT_FIELD_LIMITS.hookChars
    + SCRIPT_FIELD_LIMITS.maxBeats * SCRIPT_FIELD_LIMITS.beatChars
    + SCRIPT_FIELD_LIMITS.scriptChars,
);

/**
 * The evidence-fidelity lens's `OVERLAY_TEXT`: stage 4's on-screen wording, each
 * entry with the shot it sits on, that shot's subject, and the ids of the
 * records stage 4's `claimVisuals` bound to that shot — overlay wording
 * attributes a claim to whatever is on screen, so the lens needs to know what
 * that is and which record it carries. Nothing else of stage 4 is shown; the
 * binding's `directionSummary` prose is not.
 *
 * Worst case for the ids: every overlay sits on the same shot and every binding
 * names that shot, so each of `maxOverlayText` entries repeats all
 * `maxClaimVisuals` ids.
 */
export const OVERLAY_TEXT_BLOCK_CHARS = serializedCeiling(
  times(DIRECTION_FIELD_LIMITS.maxOverlayText, () => ({
    shotIndex: DIRECTION_FIELD_LIMITS.maxShots - 1,
    role: "clarification",
    shotSubject: "",
    shotFactIds: times(DIRECTION_FIELD_LIMITS.maxClaimVisuals, () => ""),
    text: "",
  })),
  DIRECTION_FIELD_LIMITS.maxOverlayText * (
    DIRECTION_FIELD_LIMITS.subjectChars
    + DIRECTION_FIELD_LIMITS.maxClaimVisuals * EVIDENCE_LIMITS.idChars
    + DIRECTION_FIELD_LIMITS.overlayTextChars
  ),
);

/**
 * The evidence-fidelity lens's `PACKAGING_COPY`: every package's caption,
 * hashtags, local keywords and deterministic contact line — the provider-facing
 * text — without timing, open questions or stage 5's claim-use glosses.
 */
export const PACKAGING_COPY_BLOCK_CHARS = serializedCeiling(
  times(PACKAGING_FIELD_LIMITS.maxRequestedPlatforms, () => ({
    platform: "google_business_profile",
    caption: "",
    hashtags: times(PACKAGING_FIELD_LIMITS.maxHashtags, () => ""),
    localKeywords: times(PACKAGING_FIELD_LIMITS.maxLocalKeywords, () => ""),
    contact: {
      kind: "deterministic_contact",
      text: "",
      gbpCta: { actionType: "BOOK", url: "" },
      sourceFactIds: times(CONTACT_LINE_MAX_SOURCE_FACTS, () => ""),
    },
  })),
  PACKAGING_FIELD_LIMITS.maxRequestedPlatforms * (
    PACKAGING_FIELD_LIMITS.pipelineCaptionChars // caption
    + PACKAGING_FIELD_LIMITS.pipelineCaptionChars // every hashtag token, jointly
    + PACKAGING_FIELD_LIMITS.maxLocalKeywords * PACKAGING_FIELD_LIMITS.localKeywordChars
    + CONTACT_TEXT_MAX_CHARS
    + CONTACT_CTA_URL_CHARS
    + CONTACT_LINE_MAX_SOURCE_FACTS * EVIDENCE_LIMITS.idChars
  ),
);

/**
 * The evidence-fidelity lens's `REQUIRED_CAVEATS`: stage 2's caveat list.
 *
 * **Reviewer-only.** Stage 2's caveats are withheld from every writing stage —
 * stages 4 and 5 never see stage 2's prose, so they cannot reach for a claim
 * stage 3 did not use. A reviewer writes no copy: showing it the caveats lets it
 * check that the copy kept them, and gives it nothing it could put into a
 * caption. Stage 2's assessment and restatements stay withheld here too.
 */
export const REQUIRED_CAVEATS_BLOCK_CHARS = serializedCeiling(
  times(TRUTH_FIELD_LIMITS.maxCaveats, () => ""),
  TRUTH_FIELD_LIMITS.maxCaveats * TRUTH_FIELD_LIMITS.caveatChars,
);

/** The evidence-fidelity lens's `FORBIDDEN_CLAIMS`: stage 2's forbidden-claim list. Reviewer-only, as above. */
export const FORBIDDEN_CLAIMS_BLOCK_CHARS = serializedCeiling(
  times(TRUTH_FIELD_LIMITS.maxForbiddenClaims, () => ({ claim: "", reason: "outside_evidence_scope" })),
  TRUTH_FIELD_LIMITS.maxForbiddenClaims * TRUTH_FIELD_LIMITS.forbiddenClaimChars,
);

/** The voice-and-craft lens's `COPY`: the hook, the script and each platform's caption. */
export const VOICE_COPY_BLOCK_CHARS = serializedCeiling(
  {
    hook: "",
    script: "",
    captions: times(PACKAGING_FIELD_LIMITS.maxRequestedPlatforms, () => ({
      platform: "google_business_profile",
      caption: "",
    })),
  },
  SCRIPT_FIELD_LIMITS.hookChars
    + SCRIPT_FIELD_LIMITS.scriptChars
    + PACKAGING_FIELD_LIMITS.maxRequestedPlatforms * PACKAGING_FIELD_LIMITS.pipelineCaptionChars,
);

// ---------------------------------------------------------------------------
// Producer/consumer handoff guards
// ---------------------------------------------------------------------------

/**
 * The guard every consumer applies to a producer's handoff.
 *
 * Each is *exactly* the producer's derived ceiling, so a structurally valid
 * producer output can never be refused by its consumer. The derivation
 * regressions assert equality, not merely sufficiency: raising a guard above
 * its producer's ceiling would hide a future contract change instead of
 * surfacing it.
 */
export const HANDOFF_GUARDS = {
  /** Stages 2 and 3 accept Stage 1's output. */
  strategyOutputChars: STRATEGY_OUTPUT.transportChars,
  /** Stage 3 accepts Stage 2's output. */
  truthOutputChars: TRUTH_OUTPUT.transportChars,
  /** Stages 4, 5 and 6 accept Stage 3's output. */
  scriptOutputChars: SCRIPT_OUTPUT.transportChars,
  /** Stages 5 and 6 accept Stage 4's output. */
  directionOutputChars: DIRECTION_OUTPUT.transportChars,
  /** Stages 1 and 2 accept the classified evidence pack projection. */
  evidencePackChars: EVIDENCE_PACK_BLOCK_CHARS,
} as const;

// ---------------------------------------------------------------------------
// The shared assembled-payload boundary
// ---------------------------------------------------------------------------

/**
 * The blocks each critic lens is sent, in order, at their maximum body sizes.
 * The executor renders exactly these labels in exactly this order; a regression
 * compares the two against a real assembled prompt per lens.
 */
export const CRITIC_LENS_BLOCKS: Readonly<Record<CriticLens, ReadonlyArray<{ label: string; bodyChars: number }>>> = {
  "evidence-fidelity": [
    { label: "SCRIPT_COPY", bodyChars: SCRIPT_COPY_BLOCK_CHARS },
    { label: "OVERLAY_TEXT", bodyChars: OVERLAY_TEXT_BLOCK_CHARS },
    { label: "PACKAGING_COPY", bodyChars: PACKAGING_COPY_BLOCK_CHARS },
    { label: "SCRIPT_CLAIMS", bodyChars: SCRIPT_CLAIMS_BLOCK_CHARS },
    { label: "PLATFORM_CLAIMS", bodyChars: PLATFORM_CLAIMS_BLOCK_CHARS },
    { label: "REQUIRED_CAVEATS", bodyChars: REQUIRED_CAVEATS_BLOCK_CHARS },
    { label: "FORBIDDEN_CLAIMS", bodyChars: FORBIDDEN_CLAIMS_BLOCK_CHARS },
  ],
  "platform-and-local": [
    { label: "PACKAGING_OUTPUT", bodyChars: CONTACTED_PACKAGING_OUTPUT.transportChars },
    { label: "REQUESTED_PLATFORMS", bodyChars: REQUESTED_PLATFORMS_BLOCK_CHARS },
    { label: "PLATFORM_CLAIMS", bodyChars: PLATFORM_CLAIMS_BLOCK_CHARS },
  ],
  "voice-and-craft": [
    { label: "COPY", bodyChars: VOICE_COPY_BLOCK_CHARS },
  ],
  "production-coherence": [
    { label: "SCRIPT_OUTPUT", bodyChars: SCRIPT_OUTPUT.transportChars },
    { label: "PRODUCTION_OUTPUT", bodyChars: DIRECTION_OUTPUT.transportChars },
    { label: "PACKAGING_OUTPUT", bodyChars: CONTACTED_PACKAGING_OUTPUT.transportChars },
  ],
};

/** Each critic lens's assembled payload at its maximum. */
export const CRITIC_LENS_ASSEMBLED_CEILINGS: Readonly<Record<CriticLens, number>> = Object.fromEntries(
  CRITIC_LENSES.map((lens) => [lens, assembledCeiling(CRITIC_LENS_BLOCKS[lens])]),
) as Record<CriticLens, number>;

/**
 * Every stage's assembled payload at its maximum, derived from the blocks each
 * one actually sends. `final-critic` sends one request per lens, so its entry is
 * the largest of its four lens payloads.
 */
export const STAGE_ASSEMBLED_CEILINGS: Record<string, number> = {
    "strategy-concept": assembledCeiling([
      { label: "GOAL", bodyChars: GOAL_BLOCK_CHARS },
      { label: "EVIDENCE", bodyChars: EVIDENCE_PACK_BLOCK_CHARS },
    ]),
    "automotive-truth": assembledCeiling([
      { label: "STRATEGY_OUTPUT", bodyChars: STRATEGY_OUTPUT.transportChars },
      { label: "EVIDENCE", bodyChars: EVIDENCE_PACK_BLOCK_CHARS },
    ]),
    "hook-story-script": assembledCeiling([
      { label: "STRATEGY_OUTPUT", bodyChars: STRATEGY_OUTPUT.transportChars },
      { label: "TRUTH_OUTPUT", bodyChars: TRUTH_OUTPUT.transportChars },
      { label: "PERMITTED_CLAIMS", bodyChars: PERMITTED_CLAIMS_BLOCK_CHARS },
    ]),
    "production-direction": assembledCeiling([
      { label: "SCRIPT_OUTPUT", bodyChars: SCRIPT_OUTPUT.transportChars },
      { label: "SCRIPT_CLAIMS", bodyChars: SCRIPT_CLAIMS_BLOCK_CHARS },
    ]),
    "packaging-adaptation": assembledCeiling([
      { label: "SCRIPT_OUTPUT", bodyChars: SCRIPT_OUTPUT.transportChars },
      { label: "PRODUCTION_OUTPUT", bodyChars: DIRECTION_OUTPUT.transportChars },
      { label: "REQUESTED_PLATFORMS", bodyChars: REQUESTED_PLATFORMS_BLOCK_CHARS },
      { label: "SCRIPT_CLAIMS", bodyChars: SCRIPT_CLAIMS_BLOCK_CHARS },
    ]),
    "final-critic": Math.max(...CRITIC_LENSES.map((lens) => CRITIC_LENS_ASSEMBLED_CEILINGS[lens])),
};

/**
 * The shared ceiling on an assembled user payload.
 *
 * Derived, not chosen: the largest assembled maximum across the six stages,
 * rounded up to a whole ten thousand so an incidental one-character contract
 * edit does not move a shared constant. The rounding only ever adds headroom,
 * and a derivation regression asserts the bound still exceeds every stage's
 * maximum. It replaces an undocumented 120,000 that no derivation supported and
 * that a valid Stage 5 output could not satisfy.
 */
export const MAX_PAYLOAD_CHARS = (() => {
  const largest = Math.max(...Object.values(STAGE_ASSEMBLED_CEILINGS));
  return Math.ceil(largest / 10_000) * 10_000;
})();

/**
 * The shared ceiling on assembled instruction text.
 *
 * Instructions are checked-in prompt and skill assets, not model output, so
 * this is a guard against an oversized asset rather than a derived contract. It
 * is stated here beside the payload boundary so both live in one place, and a
 * regression asserts it exceeds the largest instruction any registered stage
 * actually assembles.
 */
export const MAX_INSTRUCTION_CHARS = 200_000;

// ---------------------------------------------------------------------------
// Output contracts against model token budgets
// ---------------------------------------------------------------------------

/**
 * The minimum output-token budget a contract-valid response needs.
 *
 * Sized against the escaping-aware serialized UTF-8 byte ceiling. Every field
 * validator applies the same numeric bound to UTF-8 bytes, so the transport
 * ceiling covers punctuation, escaping, ASCII, multibyte text, and adversarial
 * mixtures. One token per byte is a lossless worst case; this is a guarantee
 * for every contract-valid output, not an ordinary-prose estimate.
 */
export function minimumOutputTokens(transportBytes: number): number {
  return Math.ceil(transportBytes * MAX_TOKENS_PER_UTF8_BYTE);
}

/**
 * Each critic lens's own output-token floor: the lossless worst case of its own
 * contract, rounded up to a whole thousand. Every lens request carries the
 * `critic` policy's `max_tokens`, and `modelPolicy.ts` requires each lens floor
 * to leave `THINKING_RESERVE_TOKENS` under that cap, lens by lens.
 */
export const CRITIC_LENS_OUTPUT_TOKEN_FLOORS: Readonly<Record<CriticLens, number>> = Object.fromEntries(
  CRITIC_LENSES.map((lens) => [
    lens, Math.ceil(minimumOutputTokens(CRITIC_LENS_OUTPUTS[lens].transportChars) / 1_000) * 1_000,
  ]),
) as Record<CriticLens, number>;

/**
 * The output-token floor each model policy must offer, derived from the stages
 * that resolve through it.
 *
 * `modelPolicy.ts` asserts its configured budgets meet these floors, so a
 * contract change that outgrows a budget fails the build rather than producing
 * a stage whose valid output is impossible to emit.
 *
 * Rounded up to a whole thousand: budgets are operational settings, and a
 * one-character contract edit should not move one.
 */
export const POLICY_OUTPUT_TOKEN_FLOORS: Record<string, number> = (() => {
  const ceil = (tokens: number) => Math.ceil(tokens / 1_000) * 1_000;
  return {
    // Stages 1 and 2.
    "reasoning-heavy": ceil(Math.max(
      minimumOutputTokens(STRATEGY_OUTPUT.transportChars),
      minimumOutputTokens(TRUTH_OUTPUT.transportChars),
    )),
    // Stages 3, 4 and 5.
    "reasoning-standard": ceil(Math.max(
      minimumOutputTokens(SCRIPT_OUTPUT.transportChars),
      minimumOutputTokens(DIRECTION_OUTPUT.transportChars),
      minimumOutputTokens(PACKAGING_OUTPUT.transportChars),
    )),
    // Stage 6: every lens request resolves through `critic` and sends the same
    // `max_tokens`, so the policy floor is the largest lens floor.
    critic: Math.max(...CRITIC_LENSES.map((lens) => CRITIC_LENS_OUTPUT_TOKEN_FLOORS[lens])),
  };
})();

// ---------------------------------------------------------------------------
// Provider request policy
// ---------------------------------------------------------------------------

/**
 * Retries the SDK may take for a Content Intelligence stage request: **none**.
 *
 * The Anthropic SDK defaults `maxRetries` to 2, retrying 408/409/429/5xx and
 * connection errors — so one wrapper call was up to **three** wire requests, and
 * because timeouts are retried too, one 90-second budget was really up to 270
 * seconds of wall clock. Every "exactly one model request" guarantee in this
 * pipeline, and the `modelRequests: 1` metadata every stage returns, described
 * one *wrapper invocation* rather than one *provider request*.
 *
 * Setting this to zero is what makes those statements true. It is the right
 * default for these stages regardless: a stage is a single-shot "produce JSON
 * per your contract" call with no idempotency key, so a silent retry can bill
 * twice for one logical request and — on a timeout that the server actually
 * completed — generate content twice.
 *
 * Legacy `runAgent` and `runVision` keep the SDK default; nothing here changes
 * their behaviour.
 */
export const STAGE_REQUEST_MAX_RETRIES = 0;

/**
 * The output rate a stage's stream deadline is sized against.
 *
 * **An explicit operational assumption, not a measurement and not a guarantee.**
 * No stage in this repository has ever executed against a real model, so there
 * is nothing here to measure and nothing is claimed about what a model does.
 * This is a policy choice: the slowest sustained output rate the pipeline is
 * willing to treat as a live stream rather than a hung one. Choosing it low
 * makes the deadline generous, which is the safe direction for a bound whose
 * only job is to stop an indefinite hang — a deadline that fires on a merely
 * slow response is a defect, not a protection. If real runs ever produce
 * measured rates, this number should be revisited against them; until then it
 * carries no empirical backing.
 */
export const MIN_OUTPUT_TOKENS_PER_SECOND = 20;

/** Connection, queueing and first-token latency, above the generation time. */
export const STAGE_REQUEST_OVERHEAD_MS = 60_000;

/**
 * How long request **setup** may take: the fetch up to streaming response
 * headers, and nothing after that.
 *
 * This is the value the Anthropic SDK's `timeout` option actually bounds. In
 * the pinned SDK the timer is armed around the underlying `fetch` and cleared
 * in a `finally` as soon as that call resolves — which, for a streaming
 * request, is when response headers arrive. Everything after that point is
 * `MessageStream` consuming events with no timer of its own. So this bounds
 * getting the connection, not receiving the answer, and it is deliberately
 * small: a minute is generous for headers and says nothing about generation.
 *
 * `stageStreamDeadlineMs` is the bound that covers the rest. The two are
 * named apart on purpose — collapsing them is exactly how a 90-second value
 * came to be described as bounding a response it could not have bounded.
 */
export const STAGE_REQUEST_SETUP_TIMEOUT_MS = 60_000;

/**
 * The total deadline for one stage stream, derived from what the stage may
 * return — from opening the request to the last event of the final message.
 *
 * The 90-second non-streaming budget this replaces could not carry the output
 * contracts it was paired with: at the per-policy budgets — 74,000
 * tokens for `reasoning-heavy`, 99,000 for `reasoning-standard`, 128,000 for
 * `critic` (its model's whole output cap, because the critic thinks and its
 * thinking shares `max_tokens`) — a contract-valid maximum response cannot be generated in 90
 * seconds by any model, so the timeout, not the contract, decided what the
 * pipeline could produce. Deriving the bound from the declared maximum is what
 * makes the limit, the deadline, the tests and the documentation describe one
 * operational contract instead of three.
 *
 * Rounded up to a whole minute so the number reads as the coarse safety bound
 * it is rather than a false precision.
 *
 * **Why these numbers are large, stated rather than buried.** They are a direct
 * consequence of `minimumOutputTokens` being a *lossless* bound — one token per
 * escaping-aware UTF-8 byte — which guarantees every contract-valid response
 * fits and therefore over-states what any real response needs by several times.
 * An ordinary contract-valid JSON response completes in a small fraction of
 * these budgets. A deadline that fired before the declared maximum could be
 * produced would mean the deadline, not the contract, decided what the pipeline
 * could return, which is precisely the defect this replaces; so the bound is
 * sized to the contract and the contract is what the reader should judge.
 * Nothing here has executed against a real model, so these are derived bounds,
 * not measured latencies.
 *
 * **This bound is only real if something enforces it.** The SDK does not: see
 * `STAGE_REQUEST_SETUP_TIMEOUT_MS`. `runStageAgent` arms its own timer for this
 * duration and aborts the stream when it expires.
 */
export function stageStreamDeadlineMs(maxOutputTokens: number): number {
  const generationMs = (maxOutputTokens / MIN_OUTPUT_TOKENS_PER_SECOND) * 1_000;
  return Math.ceil((generationMs + STAGE_REQUEST_OVERHEAD_MS) / 60_000) * 60_000;
}

// The per-policy stream deadlines live in `modelPolicy.ts` as
// `POLICY_STREAM_DEADLINE_MS`, derived from the `max_tokens` each policy's
// request actually sends. They moved there when the critic's budget stopped
// being its contract floor: this module holds no model knowledge, and the floor
// no longer determines the deadline the critic arms.
