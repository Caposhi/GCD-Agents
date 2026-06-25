/**
 * Daily posting scheduler (Render Cron Job entrypoint). Runs once per day, picks
 * the day's theme from the content calendar, and enqueues a brief onto the same
 * queue the worker already drains. It does NOT publish and does NOT bypass the
 * approval gate — the worker still runs the brief through the manager loop and the
 * HITL Slack approval before anything goes live (Phase A unchanged).
 *
 * One brief per day → one approval → one post per active platform (IG + FB now;
 * + GBP once it's added to ACTIVE_PLATFORMS).
 */

import { initState, enqueueBrief, closeState, stateEnabled } from "../harness/state.js";
import { briefForDate } from "../harness/contentCalendar.js";

async function main(): Promise<void> {
  await initState();
  if (!stateEnabled()) {
    // No DATABASE_URL → an in-memory enqueue would vanish when this short-lived
    // cron process exits. Refuse loudly rather than silently no-op.
    console.error("[scheduler] no DATABASE_URL — cannot enqueue a durable brief; aborting");
    process.exit(1);
  }
  const brief = briefForDate(new Date());
  const id = await enqueueBrief(brief);
  console.log(`[scheduler] enqueued daily brief ${id} — theme "${brief.theme}": ${brief.goal}`);
  await closeState();
}

main().catch((err) => {
  console.error("[scheduler] fatal:", err);
  process.exit(1);
});
