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

let client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

// Rough USD per 1M tokens, for the cost meter (not billing-accurate).
const PRICE: Record<string, { in: number; out: number }> = {
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
}

export async function runAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  const model = opts.model || "claude-sonnet-4-6";
  const res = await getClient().messages.create(
    {
      model,
      max_tokens: opts.maxTokens ?? 3000,
      system: opts.systemPrompt,
      messages: [{ role: "user", content: opts.prompt }],
    },
    { timeout: 90_000 },
  );
  return collect(res, model);
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
    { timeout: 90_000 },
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
