/**
 * Orchestration worker (Render `worker` service). Long-running. Polls the brief
 * queue, runs the manager loop, routes the package to the human approval gate,
 * and — ONLY on recorded approval — publishes via the posting tool.
 *
 * The Phase-A guarantee is structural: the exact provider-bound PostPackage[]
 * is stored and hash-bound before review. Publishing reloads that stored
 * subject and publishApprovedPackage verifies live durable approval plus an
 * exact item match immediately before every provider call.
 */

import { config } from "../harness/config.js";
import {
  initState,
  stateEnabled,
  closeState,
  claimNextBrief,
  completeBrief,
  setApprovalStatus,
  recordEvent,
} from "../harness/state.js";
import {
  assertPublishAllowed,
  requestApproval,
  waitForApproval,
  postingRequiresApproval,
  notifyEscalation,
} from "../harness/hitl.js";
import { runBrief } from "../harness/orchestrator.js";
import { publishApprovedPackage, PlatformCredentials, PostPackage } from "../mcp/posting-tool/index.js";
import { toPostPackages, summarize, FinalPackage } from "../harness/packageMap.js";
import { credsFromEnv } from "../harness/creds.js";
import { getCurrentIgToken } from "../harness/igToken.js";
import { getGoogleAccessToken } from "../harness/googleToken.js";

let running = true;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Keep the (60-day-capped) Instagram-Login token fresh out-of-band so posting never lapses.
const TOKEN_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
let tokenTimer: ReturnType<typeof setInterval> | undefined;
async function igTokenTick(): Promise<void> {
  try {
    await getCurrentIgToken(Date.now());
  } catch (err) {
    console.error("[ig-token] tick error:", (err as Error).message);
  }
}

async function processBrief(id: string, brief: any): Promise<void> {
  console.log(`[worker] running brief ${id}: ${brief?.goal ?? "(no goal)"}`);
  const outcome = await runBrief(brief, { runId: id });

  if (outcome.status === "escalated") {
    console.log(`[worker] brief ${id} escalated: ${outcome.escalation}`);
    await notifyEscalation(brief?.goal ?? "(no goal)", outcome.escalation ?? "unknown reason", id);
    await completeBrief(id, "failed", { reason: outcome.escalation, cost: outcome.costUsd });
    return;
  }

  // awaiting_approval → route to the human gate.
  const pkg = outcome.package as FinalPackage;
  // All externally visible transformations already happened in
  // buildFinalPackage before the final critic. toPostPackages only validates
  // review/provider parity and clones that stored canonical array.
  const providerPayloads = toPostPackages(pkg);
  const handle = await requestApproval({ summary: summarize(pkg), packageFormatted: providerPayloads });
  console.log(`[worker] brief ${id} awaiting approval (id=${handle.id})`);
  const decision = await waitForApproval(handle.id);

  if (decision !== "approved") {
    console.log(`[worker] brief ${id} ${decision} — not publishing`);
    await completeBrief(id, "done", { decision, cost: outcome.costUsd });
    return;
  }

  // APPROVED → publish only the canonical subject reloaded from approval
  // storage. The posting tool re-loads and re-verifies it before every call.
  // Re-resolve live durable authorization before even acquiring platform
  // tokens. Each actual provider attempt repeats this check inside its guard.
  const approval = await assertPublishAllowed<PostPackage[]>(handle.id);
  const approvedPayloads = approval.subject;
  const creds = credsFromEnv();
  if (approvedPayloads.some((payload) => payload.platform === "instagram")) {
    // Use the auto-refreshed IG token (DB-backed) rather than the possibly-stale env value.
    const liveIgToken = await getCurrentIgToken(Date.now());
    if (liveIgToken) creds.igAccessToken = liveIgToken;
  }
  if (approvedPayloads.some((payload) => payload.platform === "gbp")) {
    // Acquire a fresh Google token only when this exact approval includes GBP.
    try {
      const googleAccessToken = await getGoogleAccessToken();
      if (googleAccessToken) creds.googleAccessToken = googleAccessToken;
    } catch (err) {
      console.error("[gbp] Google token refresh failed:", (err as Error).message);
    }
  }
  const results = [];
  for (let packageIndex = 0; packageIndex < approvedPayloads.length; packageIndex++) {
    const approvedPayload = approvedPayloads[packageIndex]!;
    try {
      results.push(await publishApprovedPackage(
        approvedPayload,
        { approvalId: handle.id, packageIndex },
        creds,
      ));
    } catch (err) {
      results.push({ platform: approvedPayload.platform, ok: false, error: (err as Error).message });
    }
  }
  const allOk = results.length > 0 && results.every((r) => r.ok);
  await setApprovalStatus(handle.id, allOk ? "posted" : "failed");
  await completeBrief(id, allOk ? "done" : "failed", { decision, results, cost: outcome.costUsd });
  console.log(`[worker] brief ${id} published: ${JSON.stringify(results)}`);
  void recordEvent({
    runId: id,
    kind: allOk ? "brief:published" : "brief:publish_failed",
    message: allOk ? "published to all platforms" : "one or more platforms failed",
    data: { results },
  }).catch(() => {});
}

async function loop(): Promise<void> {
  while (running) {
    let claimed: { id: string; brief: any } | null = null;
    try {
      claimed = await claimNextBrief();
    } catch (err) {
      console.error("[worker] claim error:", (err as Error).message);
    }
    if (!claimed) {
      await sleep(10_000);
      continue;
    }
    try {
      if (!config.anthropicApiKey) {
        console.warn("[worker] ANTHROPIC_API_KEY not set — cannot run brief; marking failed");
        await completeBrief(claimed.id, "failed", { reason: "no ANTHROPIC_API_KEY" });
      } else {
        await processBrief(claimed.id, claimed.brief);
      }
    } catch (err) {
      console.error(`[worker] brief ${claimed.id} error:`, (err as Error).message);
      await completeBrief(claimed.id, "failed", { reason: (err as Error).message });
    }
  }
}

async function main(): Promise<void> {
  // A worker-local Map cannot share briefs or approvals with the API process.
  // Refuse startup unless the durable backend is configured and reachable.
  await initState({ requireDurable: true });
  console.log("[worker] gcd-social-worker started");
  console.log(`[worker] autonomy phase: ${config.autonomyPhase} · posting requires approval: ${postingRequiresApproval()}`);
  console.log(`[worker] state backend: ${stateEnabled() ? "postgres" : "ephemeral"}`);
  if (config.activePlatforms.includes("instagram")) {
    await igTokenTick(); // seed/refresh the IG token only when Instagram is active
    tokenTimer = setInterval(() => void igTokenTick(), TOKEN_REFRESH_INTERVAL_MS);
  }
  console.log("[worker] polling brief queue…");
  await loop();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    running = false;
    if (tokenTimer) clearInterval(tokenTimer);
    await closeState();
    console.log(`[worker] received ${sig}, shutting down`);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
