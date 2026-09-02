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
  "reasoning-standard": "claude-sonnet-4-6",
  critic: "claude-sonnet-4-6",
};

/**
 * Maximum output tokens per policy — **derived from the output contracts**, not
 * chosen.
 *
 * Each is the floor `payloadContract.ts` computes for the stages that resolve
 * through this policy: the largest contract-valid response any of them can
 * return, priced at a conservative characters-per-token ratio and rounded up to
 * a whole thousand.
 *
 * They replace 4,000 / 3,000 / 2,000, which were set before the contracts were
 * bounded and which every stage's maximum valid output exceeded — a
 * contract-valid response was impossible to emit for reasons that had nothing
 * to do with the response. The alternative was to shrink the output contracts
 * instead; that was rejected because it would narrow product behaviour (fewer
 * findings, shorter scripts) to fit a number nothing derived.
 *
 * The floors sit far below the 128,000-token output cap both configured models
 * offer, so no policy asks for more than its model can return. These paths
 * remain dormant and none has ever executed against a real model.
 */
export const POLICY_MAX_TOKENS: Record<Exclude<ModelPolicy, "deterministic-only">, number> = {
  "reasoning-heavy": POLICY_OUTPUT_TOKEN_FLOORS["reasoning-heavy"]!,
  "reasoning-standard": POLICY_OUTPUT_TOKEN_FLOORS["reasoning-standard"]!,
  critic: POLICY_OUTPUT_TOKEN_FLOORS.critic!,
};

/**
 * The contract-derived floor each policy must meet, re-exported so a regression
 * can assert the configured budget never drops below the contract it carries.
 */
export { POLICY_OUTPUT_TOKEN_FLOORS } from "./payloadContract.js";

export interface ResolvedModelPolicy {
  policy: ModelPolicy;
  model: string;
  maxTokens: number;
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
  return { policy, model, maxTokens: POLICY_MAX_TOKENS[policy] };
}

/** Every policy that maps to a model. Used by tests to pin the table. */
export function modelBearingPolicies(): ModelPolicy[] {
  return Object.keys(POLICY_MODELS) as ModelPolicy[];
}
