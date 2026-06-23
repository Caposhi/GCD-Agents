/**
 * Cumulative cost logging. The Claude Agent SDK surfaces `total_cost_usd` on
 * result messages; we accumulate it per run so the manager can report cumulative
 * spend (cost_discipline in MASTER_PROMPT).
 */

export class CostTracker {
  private cumulativeUsd = 0;
  private runs = 0;

  /** Add the cost reported by an SDK result message. */
  add(totalCostUsd: number | undefined): void {
    if (typeof totalCostUsd === "number" && Number.isFinite(totalCostUsd)) {
      this.cumulativeUsd += totalCostUsd;
      this.runs += 1;
    }
  }

  get totalUsd(): number {
    return this.cumulativeUsd;
  }

  summary(): { totalUsd: number; runs: number } {
    return { totalUsd: Number(this.cumulativeUsd.toFixed(6)), runs: this.runs };
  }
}
