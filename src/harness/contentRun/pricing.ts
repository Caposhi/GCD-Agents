/**
 * Which model requests each paid action makes, and the rough ceiling on what
 * they cost — computed as data. Moved from `scripts/local/content-run.mjs`
 * (Content Studio S1); the CLI prints the ceiling exactly as it always did.
 */

import { createHash } from "node:crypto";

import type { ContentRunRuntime } from "./runtime.js";
import type { CostCeiling } from "./types.js";

/** The stages a resume accepts. Only packaging-adaptation. */
export const RESUME_POINTS = ["packaging-adaptation"];

/**
 * Rough, non-billing-accurate prices for the cost-ceiling estimate. Mirrors
 * `PRICE` in src/harness/sdk.ts, a module the live services load; mirroring it
 * here keeps Content Studio S1 from editing that module. An offline regression
 * (MR7) asserts every model a stage policy resolves to has an identical row here.
 */
const PRICE = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
};

/**
 * sha256 of the estimate's price table, as canonical JSON. The Studio worker
 * records it in its heartbeat and a quote is bound to it (design §6.1), so a
 * price change between a quote and its run is refused.
 */
export function priceTableSha256(): string {
  const rows = Object.entries(PRICE).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

/**
 * The rough ceiling for the given model requests. Each entry is one request:
 * a full run is five stage requests plus the critic panel's four lens
 * requests, and a critic-only replay is the four lens requests.
 */
export function computeCostCeiling(
  rt: Pick<ContentRunRuntime, "modelPolicy" | "payloadContract">,
  stagePolicies: Array<[string, string]>,
): CostCeiling {
  const { resolveModelPolicy, modelBearingPolicies, POLICY_MAX_TOKENS } = rt.modelPolicy;
  const { MAX_PAYLOAD_CHARS } = rt.payloadContract;
  // Worst-case output tokens per stage (the one number this pipeline derives
  // and bounds) plus a ~4-chars-per-token estimate of the largest input this
  // pipeline would assemble. For a thinking policy the output ceiling includes
  // the thinking tokens, because they are billed as output and count against
  // the same `max_tokens`.
  let total = 0;
  const lines = stagePolicies.map(([stage, policy]) => {
    const resolved = resolveModelPolicy(policy as Parameters<typeof resolveModelPolicy>[0]);
    const price = (PRICE as Record<string, { in: number; out: number }>)[resolved.model];
    const inputTokensEstimate = Math.ceil(MAX_PAYLOAD_CHARS / 4);
    const cost = price ? (inputTokensEstimate * price.in + resolved.maxTokens * price.out) / 1e6 : undefined;
    total += cost ?? 0;
    return {
      label: stage, policy, model: resolved.model, maxTokens: resolved.maxTokens, inputTokensEstimate, costUsd: cost,
    };
  });
  return {
    lines,
    totalUsd: total,
    policiesChecked: [...modelBearingPolicies()],
    policyMaxTokens: { ...POLICY_MAX_TOKENS },
  };
}

/** The critic panel: one `critic` request per lens, in lens order. */
export function criticLensPolicies(rt: { payloadContract: { CRITIC_LENSES: readonly string[] } }): Array<[string, string]> {
  return rt.payloadContract.CRITIC_LENSES.map((lens) => [`final-critic:${lens}`, "critic"]);
}

/** Every model request one full run makes: five stages, then the four critic lenses. */
export function allStagePolicies(rt: { payloadContract: { CRITIC_LENSES: readonly string[] } }): Array<[string, string]> {
  return [
    ["strategy-concept", "reasoning-heavy"], ["automotive-truth", "reasoning-heavy"],
    ["hook-story-script", "reasoning-standard"], ["production-direction", "reasoning-standard"],
    ["packaging-adaptation", "reasoning-standard"], ...criticLensPolicies(rt),
  ];
}

/**
 * The model requests a run resumed at `stage` makes: every request from that
 * stage on, as a full run would make them, and none before it. For
 * packaging-adaptation, stage 5 and the four critic lenses.
 */
export function resumePolicies(rt: { payloadContract: { CRITIC_LENSES: readonly string[] } }, stage: string): Array<[string, string]> {
  const all = allStagePolicies(rt);
  const at = all.findIndex(([label]) => label === stage);
  if (at < 0 || !RESUME_POINTS.includes(stage)) throw new Error(`not a resume point: ${stage}`);
  return all.slice(at);
}

/**
 * The model requests one revision round starting at `startStage` makes: that
 * writing stage and every later one through stage 5, then the four critic
 * lenses — a full run's requests from `startStage` on. Never stage 1 or 2.
 */
export function revisionPolicies(
  rt: { payloadContract: { CRITIC_LENSES: readonly string[] }; revision: { REVISABLE_STAGES: readonly string[] } },
  startStage: string | undefined,
): Array<[string, string]> {
  const all = allStagePolicies(rt);
  const at = all.findIndex(([label]) => label === startStage);
  if (at < 0 || !rt.revision.REVISABLE_STAGES.includes(startStage as string)) {
    throw new Error(`not a revision start stage: ${startStage}`);
  }
  return all.slice(at);
}
