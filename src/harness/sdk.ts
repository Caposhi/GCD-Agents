/**
 * Subagent execution via the Anthropic Messages API (single-shot prompt → text).
 *
 * Our subagents are single-turn "produce JSON per your contract" calls, so we
 * use the Messages API directly rather than the agentic Claude Agent SDK (which
 * spawns the Claude Code CLI runtime — heavy, and hangs in a headless worker).
 * No tools are registered here; tool use (image gen, posting) is orchestrated
 * deterministically in code, not delegated to the model.
 */

import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import type { StageThinkingPolicy } from "./agents/modelPolicy.js";
import { STAGE_REQUEST_MAX_RETRIES, stageRequestTimeoutMs } from "./agents/payloadContract.js";

let client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

// Rough USD per 1M tokens, for the cost meter (not billing-accurate).
const PRICE: Record<string, { in: number; out: number }> = {
  // Phase 0B.1 resolves the "reasoning-heavy" policy to Opus 5; without a row
  // here its cost meter would silently report undefined. Additive only — no
  // existing model's price and no existing call site changes.
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 15, out: 75 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
};
function costUsd(model: string, usage: any): number | undefined {
  const p = PRICE[model];
  if (!p || !usage) return undefined;
  return ((usage.input_tokens || 0) * p.in + (usage.output_tokens || 0) * p.out) / 1e6;
}

export interface AgentRunResult {
  text: string;
  totalCostUsd: number | undefined;
  usage: Record<string, number> | undefined;
}

export interface AgentRunOptions {
  systemPrompt: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
  /** Omitted for legacy calls; Content Intelligence stages set this explicitly. */
  thinking?: StageThinkingPolicy;
}

/**
 * The complete set of SDK request options this module sends.
 *
 * Typed exhaustively on purpose. The retry policy used to be absent from this
 * type and therefore absent from every regression that inspected a request,
 * which is how the SDK's default of two retries survived unnoticed underneath a
 * documented "exactly one model request" guarantee.
 */
export interface SdkRequestOptions {
  /** Milliseconds. The TypeScript SDK measures timeouts in milliseconds. */
  timeout: number;
  /** Wire-level retries the SDK may take. `undefined` means the SDK default. */
  maxRetries: number | undefined;
}

export type AgentMessageCreator = (
  request: Anthropic.MessageCreateParamsNonStreaming,
  options: SdkRequestOptions,
) => Promise<Anthropic.Message>;

/**
 * The legacy, non-streaming request options.
 *
 * `maxRetries: undefined` keeps the SDK default of two retries for the legacy
 * agent and vision paths, which are unchanged by the Content Intelligence
 * request policy and are not covered by any one-request guarantee.
 */
const LEGACY_REQUEST_OPTIONS: SdkRequestOptions = { timeout: 90_000, maxRetries: undefined };

function buildRequest(opts: AgentRunOptions): {
  model: string;
  request: Anthropic.MessageCreateParamsNonStreaming;
} {
  const model = opts.model || "claude-sonnet-4-6";
  return {
    model,
    request: {
      model,
      max_tokens: opts.maxTokens ?? 3000,
      system: opts.systemPrompt,
      messages: [{ role: "user", content: opts.prompt }],
      ...(opts.thinking ? { thinking: opts.thinking } : {}),
    },
  };
}

/**
 * Execute the exact production text request through an injectable Messages
 * creator. The seam exists so an offline regression can inspect every byte of
 * the SDK request without a credential or provider call.
 *
 * **Legacy path.** Non-streaming, SDK-default retries, 90-second timeout —
 * unchanged. Content Intelligence stages use `runStageAgentWithMessageCreator`.
 */
export async function runAgentWithMessageCreator(
  opts: AgentRunOptions,
  createMessage: AgentMessageCreator,
): Promise<AgentRunResult> {
  const { model, request } = buildRequest(opts);
  const res = await createMessage(request, LEGACY_REQUEST_OPTIONS);
  return collect(res, model);
}

export async function runAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  return runAgentWithMessageCreator(
    opts,
    (request, options) => getClient().messages.create(request, {
      timeout: options.timeout,
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    }),
  );
}

/**
 * The Content Intelligence stage request boundary.
 *
 * Three things differ from the legacy path, and each is a correction rather
 * than a preference:
 *
 *  - **Retries are disabled** (`STAGE_REQUEST_MAX_RETRIES`). The SDK default of
 *    two meant one wrapper call was up to three wire requests, so neither the
 *    "exactly one model request" guarantee nor the `modelRequests: 1` metadata
 *    described what actually reached a provider.
 *  - **The request streams.** A stage's derived `max_tokens` budget is tens of
 *    thousands of tokens; the Anthropic SDKs require streaming at that size
 *    precisely because a non-streaming request cannot hold an HTTP connection
 *    open long enough to receive it. `finalMessage()` reassembles the complete
 *    response, so callers see the same `Anthropic.Message` either way and no
 *    stage handles stream events.
 *  - **The timeout is derived from the budget** rather than a fixed 90 seconds
 *    that could not carry any stage's declared maximum.
 *
 * A streaming request is still exactly one request: `messages.stream` opens one
 * HTTP connection and, with retries disabled, never opens a second.
 */
export type StageMessageCreator = (
  request: Anthropic.MessageCreateParamsNonStreaming,
  options: SdkRequestOptions,
) => Promise<Anthropic.Message>;

export async function runStageAgentWithMessageCreator(
  opts: AgentRunOptions,
  createMessage: StageMessageCreator,
): Promise<AgentRunResult> {
  const { model, request } = buildRequest(opts);
  const res = await createMessage(request, {
    timeout: stageRequestTimeoutMs(request.max_tokens),
    maxRetries: STAGE_REQUEST_MAX_RETRIES,
  });
  return collect(res, model);
}

export async function runStageAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  return runStageAgentWithMessageCreator(
    opts,
    (request, options) => getClient().messages
      .stream(request, { timeout: options.timeout, maxRetries: options.maxRetries })
      .finalMessage(),
  );
}

export interface VisionRunOptions {
  systemPrompt: string;
  prompt: string;
  jpegBase64: string;
  model?: string;
  maxTokens?: number;
}

/** Single-shot vision call: inspect a JPEG and return the model's text. */
export async function runVision(opts: VisionRunOptions): Promise<AgentRunResult> {
  const model = opts.model || "claude-sonnet-4-6";
  const res = await getClient().messages.create(
    {
      model,
      max_tokens: opts.maxTokens ?? 1000,
      system: opts.systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: opts.jpegBase64 } },
            { type: "text", text: opts.prompt },
          ],
        },
      ],
    },
    LEGACY_REQUEST_OPTIONS,
  );
  return collect(res, model);
}

function collect(res: Anthropic.Message, model: string): AgentRunResult {
  let text = "";
  for (const block of res.content) {
    if (block.type === "text") text += block.text;
  }
  const u = res.usage;
  const usage = u
    ? {
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        cache_read_input_tokens: (u as any).cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: (u as any).cache_creation_input_tokens ?? 0,
      }
    : undefined;
  return { text, totalCostUsd: costUsd(model, u), usage };
}
