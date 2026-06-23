/**
 * Context-compaction signal — ported from ECC `strategic-compact`
 * (vendor/ECC/skills/strategic-compact/SKILL.md, MIT, pinned).
 *
 * The upstream skill is interactive guidance for the Claude Code CLI `/compact`.
 * Here we reuse only its *signal*: the true context size of a turn is
 * input_tokens + cache_read_input_tokens + cache_creation_input_tokens, and a
 * compaction should be triggered at a window-scaled threshold and re-signalled
 * every COMPACT_CONTEXT_INTERVAL tokens of further growth. No upstream code is
 * imported.
 */

import { config } from "./config.js";

export interface TokenUsage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** True context size of a turn (matches the strategic-compact definition). */
export function contextSize(usage: TokenUsage | undefined): number {
  if (!usage) return 0;
  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}

export class CompactionMonitor {
  private lastSignalAt = 0;
  private readonly threshold: number;
  private readonly interval: number;

  constructor(threshold = config.compactContextThreshold, interval = config.compactContextInterval) {
    this.threshold = threshold;
    this.interval = interval;
  }

  /**
   * Returns true when the orchestrator should compact (persist state, then
   * start a fresh context). Threshold of 0 disables the signal.
   */
  shouldCompact(usage: TokenUsage | undefined): boolean {
    if (this.threshold <= 0) return false;
    const size = contextSize(usage);
    if (size < this.threshold) return false;
    if (size >= this.lastSignalAt + this.interval || this.lastSignalAt === 0) {
      this.lastSignalAt = size;
      return true;
    }
    return false;
  }

  reset(): void {
    this.lastSignalAt = 0;
  }
}
