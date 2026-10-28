/**
 * Posting scheduler (Render Cron Job entrypoint). The cron fires every day; on a
 * scheduled posting day (Monday, Wednesday and Friday, UTC — see
 * `contentCalendar.ts`) this picks the day's theme from the content calendar and
 * enqueues a brief onto the same queue the worker already drains. On any other
 * day it logs and exits without enqueueing. It does NOT publish and does NOT
 * bypass the approval gate — the worker still runs the brief through the manager
 * loop and the HITL Slack approval before anything goes live (Phase A unchanged).
 *
 * One brief per posting day → one approval → one post per active platform (IG +
 * FB now; + GBP once it's added to ACTIVE_PLATFORMS).
 *
 * `--force` (from a Render Shell: `npm run start:scheduler -- --force`) enqueues
 * the next posting day's brief on a day with no scheduled post. The dashboard's
 * "Trigger Run" passes no arguments, so on an off day it enqueues nothing.
 */

import { initState, enqueueBrief, closeState, stateEnabled } from "../harness/state.js";
import { briefForDate } from "../harness/contentCalendar.js";

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const brief = briefForDate(new Date(), { force });
  if (brief === null) {
    // Decided from the date alone, before any database connection: an off day
    // needs no queue and must not fail on one.
    console.log(
      "[scheduler] no post scheduled today (posting days are Monday, Wednesday and Friday, UTC)"
      + " — nothing enqueued; run with --force to enqueue the next posting day's brief",
    );
    return;
  }
  await initState({ requireDurable: true });
  if (!stateEnabled()) {
    // No DATABASE_URL → an in-memory enqueue would vanish when this short-lived
    // cron process exits. Refuse loudly rather than silently no-op.
    console.error("[scheduler] no DATABASE_URL — cannot enqueue a durable brief; aborting");
    process.exit(1);
  }
  const id = await enqueueBrief(brief);
  console.log(`[scheduler] enqueued brief ${id} — theme "${brief.theme}": ${brief.goal}`);
  await closeState();
}

main().catch((err) => {
  console.error("[scheduler] fatal:", err);
  process.exit(1);
});
