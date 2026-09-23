/**
 * One place where a `ModelPolicy` class becomes a concrete model id.
 *
 * The registry deliberately declares a *class* ("reasoning-heavy"), not an id.
 * If each executor picked its own id, changing models would mean auditing every
 * call site and every stage definition, and drift between stages would be
 * invisible. Resolution therefore lives here and nowhere else: the registry
 * never names a model, and no executor hardcodes one.
 *
 * `deterministic-only` has no model on purpose. It marks work that must be done
 * in TypeScript, so asking for its model id is a bug in the caller rather than
 * something to satisfy with a default.
 */

import { ModelPolicy } from "./registry.js";
import { POLICY_OUTPUT_TOKEN_FLOORS, stageStreamDeadlineMs } from "./payloadContract.js";

export class ModelPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelPolicyError";
  }
}

/**
 * Policy → model id.
 *
 * `reasoning-heavy` uses Claude Opus 5 and `reasoning-standard` uses Claude
 * Sonnet 5, both with thinking disabled. `critic` uses **Claude Opus 5.5**, with
 * adaptive thinking — the owner's choice after the 2026-09-23 six-stage run, in
 * which the Sonnet 5 critic, thinking disabled, missed the most serious defect
 * in the package. Claude Opus 5 is now the legacy Opus; it still serves
 * `reasoning-heavy`, unchanged here.
 *
 * This is a dormant code path: no deployed call site resolves through this
 * table, so nothing that runs in production changes model as a result of it.
 */
const POLICY_MODELS: Record<Exclude<ModelPolicy, "deterministic-only">, string> = {
  "reasoning-heavy": "claude-opus-5",
  "reasoning-standard": "claude-sonnet-5",
  critic: "claude-opus-5-5",
};

/** Documented output cap of each centrally selected model. */
export const POLICY_MODEL_OUTPUT_CAPS: Record<Exclude<ModelPolicy, "deterministic-only">, number> = {
  "reasoning-heavy": 128_000,
  "reasoning-standard": 128_000,
  critic: 128_000,
};

/**
 * Output tokens reserved for thinking under a policy whose thinking is on.
 *
 * **A heuristic, not a guarantee.** Thinking tokens count against `max_tokens`,
 * and the API offers no way to cap thinking separately from the visible answer:
 * on Claude Opus 5.5 effort is the only control. A regression requires the
 * critic's contract-derived output floor to sit at or below
 * `POLICY_MODEL_OUTPUT_CAPS.critic - THINKING_RESERVE_TOKENS`, so a contract that
 * grows into the room thinking needs fails the suite. It cannot make a response
 * fit: if the model thinks for more than the reserve *and* writes a maximal
 * answer, the response is truncated at `max_tokens`, and the stage fails closed
 * with `StageOutputTruncatedError`.
 *
 * The floor it guards is itself a lossless one-token-per-byte worst case, so an
 * ordinary critique leaves far more than this for thinking. The number is a
 * starting point to be revisited against measured `usage.output_tokens` from
 * real replays.
 */
export const THINKING_RESERVE_TOKENS = 16_000;

/**
 * Maximum output tokens per policy — **derived**, not chosen.
 *
 * For the two thinking-disabled policies, each is the floor `payloadContract.ts`
 * computes for the stages that resolve through this policy: the largest contract-valid response any of them can
 * return, priced at the escaping-aware serialized UTF-8 byte ceiling and one
 * token per byte, then rounded up to a whole thousand.
 *
 * They replace 4,000 / 3,000 / 2,000, which were set before the contracts were
 * bounded and which every stage's maximum valid output exceeded — a
 * contract-valid response was impossible to emit for reasons that had nothing
 * to do with the response. The alternative was to shrink the output contracts
 * instead; that was rejected because it would narrow product behaviour (fewer
 * findings, shorter scripts) to fit a number nothing derived.
 *
 * The floors stay below the 128,000-token output cap every configured model
 * offers, so no policy asks for more than its model can return. The critic's
 * budget is that cap itself, because its thinking shares it (see below). These
 * paths remain dormant in production; they have run only from the local
 * operator CLI.
 */
export const POLICY_MAX_TOKENS: Record<Exclude<ModelPolicy, "deterministic-only">, number> = {
  "reasoning-heavy": POLICY_OUTPUT_TOKEN_FLOORS["reasoning-heavy"]!,
  "reasoning-standard": POLICY_OUTPUT_TOKEN_FLOORS["reasoning-standard"]!,
  // The critic thinks, and thinking tokens count against `max_tokens`. Its
  // budget is therefore the model's whole output cap rather than its contract
  // floor: the floor is what the visible answer may need, and the rest is room
  // for thinking. See `THINKING_RESERVE_TOKENS` for what that does and does not
  // guarantee.
  critic: POLICY_MODEL_OUTPUT_CAPS.critic,
};

/**
 * The thinking configuration a stage request sends.
 *
 * **Disabled** is a correctness policy, not a quality hint: Opus 5 and Sonnet 5
 * otherwise run adaptive thinking by default, and thinking tokens share the
 * `max_tokens` ceiling, so disabling it makes the visible-output guarantee
 * exactly `maxTokens`. `reasoning-heavy` and `reasoning-standard` keep that.
 *
 * **Adaptive** is the only mode Claude Opus 5.5 accepts, and the `critic`
 * policy uses it. That reverses the "thinking disabled = visible-output
 * guarantee" decision for the critic alone, recorded with its rejected
 * alternatives in `docs/ROADMAP.md`: a thinking policy has no guaranteed visible
 * budget, which `ResolvedModelPolicy` now says in its type.
 *
 * This policy belongs beside model selection and output caps so a model change
 * cannot silently change request semantics.
 */
export type StageThinkingPolicy = Readonly<{ type: "disabled" }> | Readonly<{ type: "adaptive" }>;

export const POLICY_THINKING: Record<
  Exclude<ModelPolicy, "deterministic-only">,
  StageThinkingPolicy
> = {
  "reasoning-heavy": { type: "disabled" },
  "reasoning-standard": { type: "disabled" },
  critic: { type: "adaptive" },
};

/**
 * The effort levels `output_config.effort` accepts, in increasing order.
 *
 * Ordered on purpose. The invariant below compares *positions* on this scale,
 * never level names, so a level the provider adds is placed once here instead
 * of in every comparison that cares about it.
 */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

export type StageEffortLevel = (typeof EFFORT_LEVELS)[number];

/**
 * The highest effort at which a restricted model still accepts disabled
 * thinking. Above this, the pairing is rejected rather than degraded.
 */
export const MAX_EFFORT_WITH_THINKING_DISABLED: StageEffortLevel = "high";

/**
 * Model ids that reject `thinking: {type: "disabled"}` above
 * `MAX_EFFORT_WITH_THINKING_DISABLED`.
 *
 * **Source and exact rule.** Anthropic's documented thinking/effort matrix for
 * Claude Opus 5: thinking is on by default, and `{type: "disabled"}` is
 * accepted **only at effort `high` or below** — pairing it with `xhigh` or
 * `max` returns a **400**. Not a degradation, not a warning: the request is
 * refused, so the first stage to send it fails after it has been billed for
 * nothing.
 *
 * **This is a property of the model, not of a policy name.** The set holds ids
 * for that reason. `reasoning-heavy` is restricted today only because it
 * resolves to `claude-opus-5`; repointing it at a different id must carry the
 * restriction away with the id, and pointing another policy at `claude-opus-5`
 * must pick it up, neither of which a policy-keyed rule would do.
 *
 * **`claude-sonnet-5` is deliberately absent.** No such restriction is
 * documented for it — it accepts `{type: "disabled"}`, and no documented
 * effort level withdraws that acceptance. Adding any model here requires a
 * documented provider source stating the restriction for that id. An
 * assumption, an argument from symmetry with Opus, or "it is probably the
 * same" is not such a source, and would convert a free, correct assertion into
 * a confidently wrong one that blocks a valid configuration.
 */
export const MODELS_REJECTING_DISABLED_THINKING_ABOVE_HIGH: ReadonlySet<string> = new Set([
  "claude-opus-5",
]);

/**
 * Model ids that reject `thinking: {type: "disabled"}` **at every effort level**.
 *
 * **Source and exact rule.** Anthropic's migration guide for Claude Opus 5.5,
 * "Breaking change 1: thinking can't be disabled": "On Claude Opus 5.5 thinking
 * is **always on**: `{"type": "disabled"}` and `{"type": "enabled",
 * "budget_tokens": N}` both return a 400 `invalid_request_error` at every effort
 * level". The request is refused, not degraded, so a stage that sent it would
 * fail on its first call.
 *
 * Distinct from `MODELS_REJECTING_DISABLED_THINKING_ABOVE_HIGH`, whose models
 * accept disabled thinking at `high` or below. **This is a property of the
 * model, not of a policy name**, so the set holds ids: pointing any policy at a
 * model here picks up the rule, and repointing one away carries it off.
 *
 * Adding any model here requires a documented provider source stating that
 * restriction for that id. Symmetry with a sibling model, or "it is probably
 * the same", is not such a source.
 */
export const MODELS_REQUIRING_THINKING: ReadonlySet<string> = new Set([
  "claude-opus-5-5",
]);

/**
 * Policy → declared `output_config.effort`.
 *
 * An absent declaration means the request carries no `output_config.effort`
 * key at all and the provider's default applies. `reasoning-heavy` and
 * `reasoning-standard` declare none, so their requests are unchanged.
 *
 * **`critic` declares `high` explicitly** because Claude Opus 5.5's own default
 * is `medium`, one level below Claude Opus 5's `high` — the migration guide:
 * "The API default is `medium` … so a request that omits `effort` now runs one
 * level lower than it did. **Set `effort` explicitly**". `high` is a starting
 * point, not a measured optimum; it is to be tuned from measured critic-only
 * replays (`scripts/local/content-run.mjs --replay-critic`).
 *
 * This table is the only place a stage effort is declared, and the only source
 * the stage request reads it from, so the invariant in `resolveModelPolicy`
 * sees every effort a stage can send. `sdk.ts` re-checks the same invariant
 * where the stage request is built.
 */
export const POLICY_EFFORT: Partial<
  Record<Exclude<ModelPolicy, "deterministic-only">, StageEffortLevel>
> = {
  critic: "high",
};

/** Position on the ordered effort scale. Names are never compared directly. */
function effortRank(level: StageEffortLevel): number {
  return EFFORT_LEVELS.indexOf(level);
}

/**
 * The contract-derived floor each policy must meet, re-exported so a regression
 * can assert the configured budget never drops below the contract it carries.
 */
export { POLICY_OUTPUT_TOKEN_FLOORS } from "./payloadContract.js";

/**
 * The total stream deadline each policy's stage request actually arms.
 *
 * Derived from `POLICY_MAX_TOKENS` — the `max_tokens` the request sends and the
 * value `runStageAgent` sizes its timer from — rather than from the contract
 * floor. The two are equal for the thinking-disabled policies; for the critic,
 * whose budget is the model's whole output cap, they are not, and the deadline
 * must cover what the request may actually stream.
 */
export const POLICY_STREAM_DEADLINE_MS: Record<Exclude<ModelPolicy, "deterministic-only">, number> = {
  "reasoning-heavy": stageStreamDeadlineMs(POLICY_MAX_TOKENS["reasoning-heavy"]),
  "reasoning-standard": stageStreamDeadlineMs(POLICY_MAX_TOKENS["reasoning-standard"]),
  critic: stageStreamDeadlineMs(POLICY_MAX_TOKENS.critic),
};

interface ResolvedModelPolicyBase {
  policy: ModelPolicy;
  model: string;
  maxTokens: number;
  /**
   * The policy's declared `output_config.effort`, or `undefined` when it
   * declares none — in which case the request carries no `effort` key at all
   * and the provider default applies.
   */
  effort: StageEffortLevel | undefined;
}

/**
 * A resolved policy. **The visible-output guarantee exists only when thinking
 * is disabled**, and the type says so: `visibleOutputTokens` is present, and
 * equal to `maxTokens`, only on the disabled branch. Under adaptive thinking,
 * thinking and the visible answer share `maxTokens` and the API reports no
 * split in advance, so no visible budget is guaranteed and none is claimed.
 */
export type ResolvedModelPolicy =
  | (ResolvedModelPolicyBase & {
    thinking: Readonly<{ type: "disabled" }>;
    /** Hard visible-token guarantee: thinking is disabled and no tool is registered. */
    visibleOutputTokens: number;
  })
  | (ResolvedModelPolicyBase & {
    thinking: Readonly<{ type: "adaptive" }>;
    visibleOutputTokens?: never;
  });

/**
 * The thinking/effort pairings a model rejects, as one check.
 *
 * Returns the reason a pairing is unserviceable, or `undefined` when it is
 * fine. Shared by `resolveModelPolicy` and the stage request builder in
 * `sdk.ts`, so the rule is written once and enforced at both points.
 */
export function thinkingEffortViolation(
  model: string,
  thinking: StageThinkingPolicy,
  effort: StageEffortLevel | undefined,
): string | undefined {
  if (thinking.type === "disabled" && MODELS_REQUIRING_THINKING.has(model)) {
    return `model "${model}" rejects disabled thinking at every effort level: the request `
      + "is refused with an HTTP 400 and the stage call fails. Use adaptive thinking and "
      + "control depth with effort instead.";
  }
  if (
    thinking.type === "disabled"
    && MODELS_REJECTING_DISABLED_THINKING_ABOVE_HIGH.has(model)
    && effort !== undefined
    && effortRank(effort) > effortRank(MAX_EFFORT_WITH_THINKING_DISABLED)
  ) {
    return `effort "${effort}" is declared while thinking is disabled, but model "${model}" `
      + `accepts disabled thinking only at effort "${MAX_EFFORT_WITH_THINKING_DISABLED}" or `
      + "below: the combination is rejected with an HTTP 400 and the stage call fails. "
      + `Lower the effort to "${MAX_EFFORT_WITH_THINKING_DISABLED}" or below, or stop `
      + "disabling thinking.";
  }
  return undefined;
}

/**
 * Resolve a declared policy to the model that should serve it.
 *
 * Throws for `deterministic-only` rather than falling back to a model: a stage
 * marked deterministic must not acquire one by accident.
 */
export function resolveModelPolicy(policy: ModelPolicy): ResolvedModelPolicy {
  if (policy === "deterministic-only") {
    throw new ModelPolicyError(
      "policy \"deterministic-only\" has no model: this work must be implemented in TypeScript",
    );
  }
  const model = POLICY_MODELS[policy];
  if (!model) throw new ModelPolicyError(`unknown model policy: ${String(policy)}`);
  const maxTokens = POLICY_MAX_TOKENS[policy];
  const thinking = POLICY_THINKING[policy];
  const effort = POLICY_EFFORT[policy];

  // One invariant, deliberately not a set of direction-named guards, because
  // each case is one unserviceable combination rather than separate mistakes.
  // It catches every direction an edit can arrive from: raising the effort of a
  // policy whose thinking is already disabled; disabling the thinking of a
  // policy that already declares an effort above the limit; and disabling
  // thinking on — or repointing a thinking-disabled policy at — a model that
  // requires thinking at every effort.
  //
  // Thrown at resolve time on purpose: resolution runs before the request is
  // built and before anything is billed, so the same knowable 400 costs
  // nothing here and one discarded paid stage call otherwise.
  const violation = thinkingEffortViolation(model, thinking, effort);
  if (violation) throw new ModelPolicyError(`policy "${policy}": ${violation}`);

  if (thinking.type === "disabled") {
    return {
      policy,
      model,
      maxTokens,
      thinking,
      effort,
      // Every output token is available to visible text because thinking is
      // explicitly disabled. Tools are also absent from the stage boundary.
      visibleOutputTokens: maxTokens,
    };
  }
  // Adaptive thinking shares `maxTokens` with the visible answer, so no
  // visible budget is guaranteed and none is returned.
  return { policy, model, maxTokens, thinking, effort };
}

/** Every policy that maps to a model. Used by tests to pin the table. */
export function modelBearingPolicies(): ModelPolicy[] {
  return Object.keys(POLICY_MODELS) as ModelPolicy[];
}
