/**
 * Thin adapter over the Claude Agent SDK. Loaded dynamically so the skeleton
 * compiles and boots without coupling tightly to the SDK's evolving type
 * surface; the dependency is still real (see package.json).
 *
 * No tools are wired here. In particular the posting tool is NOT registered —
 * publishing is added only in Phase 3 behind the approval gate.
 */

export interface AgentRunResult {
  text: string;
  totalCostUsd: number | undefined;
  /** Last reported token usage, used to drive the compaction signal. */
  usage: Record<string, number> | undefined;
}

export interface AgentRunOptions {
  systemPrompt: string;
  prompt: string;
  model?: string;
  maxTurns?: number;
}

/**
 * Runs a single agent query and collects the final text + cost + usage.
 * Requires ANTHROPIC_API_KEY in the environment (asserted by the caller).
 */
export async function runAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  // Dynamic import keeps compile-time decoupling from the SDK's exports.
  const sdk: any = await import("@anthropic-ai/claude-agent-sdk");

  let text = "";
  let totalCostUsd: number | undefined;
  let usage: Record<string, number> | undefined;

  const stream = sdk.query({
    prompt: opts.prompt,
    options: {
      systemPrompt: opts.systemPrompt,
      model: opts.model,
      maxTurns: opts.maxTurns ?? 8,
      // No custom tools / MCP servers registered in the skeleton.
    },
  });

  for await (const message of stream) {
    if (message?.type === "assistant") {
      const blocks = message.message?.content ?? [];
      for (const b of blocks) {
        if (b?.type === "text" && typeof b.text === "string") text += b.text;
      }
    } else if (message?.type === "result") {
      totalCostUsd = message.total_cost_usd;
      usage = message.usage;
    }
  }

  return { text, totalCostUsd, usage };
}
