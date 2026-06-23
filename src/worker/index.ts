/**
 * Orchestration worker (Render `worker` service). Long-running process that
 * would pull queued briefs and run the manager loop. In the skeleton it boots,
 * verifies wiring, and idles — it performs NO live social action.
 */

import { config } from "../harness/config.js";
import { initState, stateEnabled, closeState } from "../harness/state.js";
import { postingRequiresApproval } from "../harness/hitl.js";
import { loadMasterPrompt } from "../harness/agentLoop.js";

let running = true;

async function main(): Promise<void> {
  await initState();

  // Fail fast if the master prompt is missing/unreadable.
  const prompt = await loadMasterPrompt();

  console.log("[worker] gcd-social-worker started");
  console.log(`[worker] autonomy phase: ${config.autonomyPhase}`);
  console.log(`[worker] posting requires approval: ${postingRequiresApproval()}`);
  console.log(`[worker] state backend: ${stateEnabled() ? "postgres" : "ephemeral (no DATABASE_URL)"}`);
  console.log(`[worker] master prompt loaded: ${prompt.length} chars`);
  console.log("[worker] idle — no brief queue wired yet (skeleton). No posting will occur.");

  // Skeleton idle loop; replaced by a real queue consumer in later phases.
  const tick = () => {
    if (!running) return;
    setTimeout(tick, 60_000);
  };
  tick();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    running = false;
    await closeState();
    console.log(`[worker] received ${sig}, shutting down`);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
