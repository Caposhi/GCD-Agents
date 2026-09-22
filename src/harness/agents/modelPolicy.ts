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
import { POLICY_OUTPUT_TOKEN_FLOORS } from "./payloadContract.js";

export class ModelPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelPolicyError";
  }
}

/**
 * Policy → model id.
 *
 * `reasoning-heavy` uses Claude Opus 5, the current most capable general model.
 * This is a new, dormant code path: no existing production call site resolves
 * through this table, so nothing that runs today changes model as a result of
 * this mapping.
 */
const POLICY_MODELS: Record<Exclude<ModelPolicy, "deterministic-only">, string> = {
  "reasoning-heavy": "claude-opus-5",
  "reasoning-standard": "claude-sonnet-5",
  critic: "claude-sonnet-5",
};

/**
 * Maximum output tokens per policy — **derived from the output contracts**, not
 * chosen.
 *
 * Each is the floor `payloadContract.ts` computes for the stages that resolve
 * through this policy: the largest contract-valid response any of them can
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
 * The floors stay below the 128,000-token output cap both configured models
 * offer, so no policy asks for more than its model can return. These paths
 * remain dormant and none has ever executed against a real model.
 */
export const POLICY_MAX_TOKENS: Record<Exclude<ModelPolicy, "deterministic-only">, number> = {
  "reasoning-heavy": POLICY_OUTPUT_TOKEN_FLOORS["reasoning-heavy"]!,
  "reasoning-standard": POLICY_OUTPUT_TOKEN_FLOORS["reasoning-standard"]!,
  critic: POLICY_OUTPUT_TOKEN_FLOORS.critic!,
};

/** Documented output cap of each centrally selected model. */
export const POLICY_MODEL_OUTPUT_CAPS: Record<Exclude<ModelPolicy, "deterministic-only">, number> = {
  "reasoning-heavy": 128_000,
  "reasoning-standard": 128_000,
  critic: 128_000,
};

/**
 * Structured stage calls need their complete `max_tokens` allowance for the
 * contract-valid visible JSON response. Opus 5 otherwise enables adaptive
 * thinking by default, and thinking tokens share that same hard ceiling.
 *
 * Disabling thinking is therefore a correctness policy, not a quality hint:
 * it makes the visible-output guarantee exactly equal to `maxTokens`, with no
 * heuristic hidden-token reserve. This policy belongs beside model selection
 * and output caps so a model change cannot silently change request semantics.
 */
export type StageThinkingPolicy = Readonly<{ type: "disabled" }>;

export const POLICY_THINKING: Record<
  Exclude<ModelPolicy, "deterministic-only">,
  StageThinkingPolicy
> = {
  "reasoning-heavy": { type: "disabled" },
  "reasoning-standard": { type: "disabled" },
  critic: { type: "disabled" },
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
 * Policy → declared `output_config.effort`.
 *
 * **Empty on purpose, and behaviour is unchanged by its existence.** No policy
 * declares an effort today. An absent declaration means the request carries no
 * `output_config.effort` key at all, so the provider's own default applies
 * exactly as it does now — this table adds a place to declare, not a value.
 *
 * It exists so the edit that *does* set one lands here: beside the thinking
 * policy, inside the file that owns model selection, and under the invariant
 * in `resolveModelPolicy` below. `POLICY_THINKING` pins all three policies to
 * `{type: "disabled"}`, which on a restricted model is valid only while effort
 * stays at `MAX_EFFORT_WITH_THINKING_DISABLED` or below. Declared anywhere the
 * invariant cannot read it, an effort of `xhigh` would be a knowable 400
 * discovered on the first paid call.
 */
export const POLICY_EFFORT: Partial<
  Record<Exclude<ModelPolicy, "deterministic-only">, StageEffortLevel>
> = {};

/** Position on the ordered effort scale. Names are never compared directly. */
function effortRank(level: StageEffortLevel): number {
  return EFFORT_LEVELS.indexOf(level);
}

/**
 * The contract-derived floor each policy must meet, re-exported so a regression
 * can assert the configured budget never drops below the contract it carries.
 */
export { POLICY_OUTPUT_TOKEN_FLOORS } from "./payloadContract.js";

export interface ResolvedModelPolicy {
  policy: ModelPolicy;
  model: string;
  maxTokens: number;
  thinking: StageThinkingPolicy;
  /**
   * The policy's declared `output_config.effort`, or `undefined` when it
   * declares none — in which case the request carries no `effort` key at all
   * and the provider default applies. Every policy is `undefined` today.
   */
  effort: StageEffortLevel | undefined;
  /** Hard visible-token guarantee under the selected thinking policy. */
  visibleOutputTokens: number;
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

  // One invariant, deliberately not two guards, because this is one
  // unserviceable combination rather than two separate mistakes. It catches
  // both directions an edit can arrive from: raising the effort of a policy
  // whose thinking is already disabled, and disabling the thinking of a policy
  // that already declares an effort above the limit. A pair of direction-named
  // guards would state the same condition twice and let a reviewer delete
  // whichever one their edit did not trip.
  //
  // Thrown at resolve time on purpose: resolution runs before the request is
  // built and before anything is billed, so the same knowable 400 costs
  // nothing here and one discarded paid stage call otherwise.
  if (
    thinking.type === "disabled"
    && MODELS_REJECTING_DISABLED_THINKING_ABOVE_HIGH.has(model)
    && effort !== undefined
    && effortRank(effort) > effortRank(MAX_EFFORT_WITH_THINKING_DISABLED)
  ) {
    throw new ModelPolicyError(
      `policy "${policy}" declares effort "${effort}" while its thinking is disabled, but `
      + `model "${model}" accepts disabled thinking only at effort `
      + `"${MAX_EFFORT_WITH_THINKING_DISABLED}" or below: the combination is rejected with `
      + "an HTTP 400 and the stage call fails. Lower the effort to "
      + `"${MAX_EFFORT_WITH_THINKING_DISABLED}" or below, or stop disabling thinking for `
      + "this policy.",
    );
  }

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

/** Every policy that maps to a model. Used by tests to pin the table. */
export function modelBearingPolicies(): ModelPolicy[] {
  return Object.keys(POLICY_MODELS) as ModelPolicy[];
}
