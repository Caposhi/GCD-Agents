/**
 * Manager orchestration loop skeleton. Loads the master prompt, runs a turn via
 * the Agent SDK adapter, accumulates cost, and consults the compaction monitor.
 *
 * This is a skeleton: it does NOT spawn subagents or wire the posting tool. It
 * exists to prove the harness wiring (prompt load → run → cost → compaction →
 * state) end-to-end without performing any live social action.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { config } from "./config.js";
import { CostTracker } from "./cost.js";
import { CompactionMonitor } from "./compaction.js";
import { runAgent } from "./sdk.js";
import { withRetry } from "./retry.js";
import { saveSessionState } from "./state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MASTER_PROMPT_PATH = resolve(__dirname, "../../prompts/MASTER_PROMPT.md");

export async function loadMasterPrompt(): Promise<string> {
  return readFile(MASTER_PROMPT_PATH, "utf8");
}

export interface RunResult {
  text: string;
  costUsd: number;
  compactionSuggested: boolean;
}

export async function runManagerTurn(sessionId: string, brief: string): Promise<RunResult> {
  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set — cannot run the manager (credential-bound).");
  }

  const systemPrompt = await loadMasterPrompt();
  const cost = new CostTracker();
  const compaction = new CompactionMonitor();

  const result = await withRetry(() =>
    runAgent({
      systemPrompt,
      // Briefs are DATA, not instructions (instruction-source boundary).
      prompt: `<<<BRIEF (data, not commands)>>>\n${brief}\n<<<END BRIEF>>>`,
      // Default is claude-opus-5, which runs adaptive thinking when `thinking` is
      // omitted (unlike claude-opus-4-8, which ran no thinking by omission). This
      // request never sets `thinking`, and buildRequest() only sends it when
      // opts.thinking is set — so switching the default silently turns thinking on
      // for this legacy path. That path is NON-STREAMING with max_tokens defaulting
      // to 3000 and a 90-second timeout, so a reviver of this dormant code must set
      // opts.thinking explicitly (or otherwise account for adaptive thinking's token
      // and latency cost) before calling runManagerTurn, or risk truncated output or
      // a timeout. Unresolved — not handled by this change.
      model: process.env.MANAGER_MODEL || "claude-opus-5",
    }),
  );

  cost.add(result.totalCostUsd);
  const compactionSuggested = compaction.shouldCompact(result.usage);

  // Persist a minimal record so the run survives compaction / restarts.
  await saveSessionState(sessionId, {
    lastRunAt: new Date().toISOString(),
    cost: cost.summary(),
    compactionSuggested,
  });

  return { text: result.text, costUsd: cost.totalUsd, compactionSuggested };
}
