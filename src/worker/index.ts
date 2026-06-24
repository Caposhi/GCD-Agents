/**
 * Orchestration worker (Render `worker` service). Long-running. Polls the brief
 * queue, runs the manager loop, routes the package to the human approval gate,
 * and — ONLY on recorded approval — publishes via the posting tool.
 *
 * The Phase-A guarantee is structural: publishing goes through
 * publishApprovedPackage → assertPublishAllowed, which throws unless approval
 * is recorded. The worker passes `approved` derived solely from waitForApproval.
 */

import { config } from "../harness/config.js";
import { initState, stateEnabled, closeState, claimNextBrief, completeBrief, setApprovalStatus } from "../harness/state.js";
import { requestApproval, waitForApproval, postingRequiresApproval } from "../harness/hitl.js";
import { runBrief } from "../harness/orchestrator.js";
import { publishApprovedPackage, PostPackage, Platform, PlatformCredentials } from "../mcp/posting-tool/index.js";

let running = true;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function credsFromEnv(): PlatformCredentials {
  return {
    igUserId: process.env.IG_USER_ID,
    igAccessToken: process.env.IG_ACCESS_TOKEN,
    igGraphHost: process.env.IG_GRAPH_HOST, // optional; defaults to graph.instagram.com
    fbPageId: process.env.FB_PAGE_ID,
    fbPageAccessToken: process.env.FB_PAGE_ACCESS_TOKEN,
    googleAccessToken: process.env.GOOGLE_ACCESS_TOKEN,
    gbpAccountId: process.env.GBP_ACCOUNT_ID,
    gbpLocationId: process.env.GBP_LOCATION_ID,
    graphVersion: process.env.GRAPH_VERSION,
  };
}

const PLATFORM_MAP: Record<string, Platform> = {
  instagram: "instagram",
  facebook: "facebook",
  gbp: "gbp",
};

/**
 * Best-effort mapping of the platform-formatter output to PostPackages.
 * The formatter's exact shape is finalized in Phase 7 against real agent
 * output; this is defensive and skips anything it can't map.
 */
function toPostPackages(formatted: any): PostPackage[] {
  const entries: any[] = Array.isArray(formatted) ? formatted : formatted?.platforms ?? [];
  const out: PostPackage[] = [];
  for (const e of entries) {
    const platform = PLATFORM_MAP[String(e?.platform)];
    const text = e?.formatted_body ?? e?.body ?? e?.text;
    if (!platform || !text) continue;
    const imgUrl = e?.image?.url ?? e?.image_ref ?? e?.image_url;
    const pkg: PostPackage = {
      platform,
      text: String(text),
      languageCode: e?.lang,
      images: imgUrl ? [{ url: String(imgUrl), altText: e?.image?.alt_text_en, aiGenerated: true }] : undefined,
    };
    if (platform === "gbp" && e?.cta?.url) {
      pkg.gbp = { topicType: "STANDARD", callToAction: { actionType: e.cta.actionType ?? "LEARN_MORE", url: e.cta.url } };
    }
    out.push(pkg);
  }
  return out;
}

function summarize(formatted: any): string {
  const pkgs = toPostPackages(formatted);
  if (pkgs.length === 0) return "Package ready for review (no auto-summary).";
  return pkgs.map((p) => `• *${p.platform}*: ${p.text.slice(0, 120)}${p.text.length > 120 ? "…" : ""}`).join("\n");
}

async function processBrief(id: string, brief: any): Promise<void> {
  console.log(`[worker] running brief ${id}: ${brief?.goal ?? "(no goal)"}`);
  const outcome = await runBrief(brief);

  if (outcome.status === "escalated") {
    console.log(`[worker] brief ${id} escalated: ${outcome.escalation}`);
    await completeBrief(id, "failed", { reason: outcome.escalation, cost: outcome.costUsd });
    return;
  }

  // awaiting_approval → route to the human gate.
  const handle = await requestApproval({ summary: summarize(outcome.package), packageFormatted: outcome.package });
  console.log(`[worker] brief ${id} awaiting approval (id=${handle.id})`);
  const decision = await waitForApproval(handle.id);

  if (decision !== "approved") {
    console.log(`[worker] brief ${id} ${decision} — not publishing`);
    await completeBrief(id, "done", { decision, cost: outcome.costUsd });
    return;
  }

  // APPROVED → publish (gated by assertPublishAllowed inside the tool).
  const approved = true;
  const creds = credsFromEnv();
  const pkgs = toPostPackages(outcome.package);
  const results = [];
  for (const pkg of pkgs) {
    try {
      results.push(await publishApprovedPackage(pkg, approved, creds));
    } catch (err) {
      results.push({ platform: pkg.platform, ok: false, error: (err as Error).message });
    }
  }
  const allOk = results.length > 0 && results.every((r) => r.ok);
  await setApprovalStatus(handle.id, allOk ? "posted" : "failed");
  await completeBrief(id, allOk ? "done" : "failed", { decision, results, cost: outcome.costUsd });
  console.log(`[worker] brief ${id} published: ${JSON.stringify(results)}`);
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
  await initState();
  console.log("[worker] gcd-social-worker started");
  console.log(`[worker] autonomy phase: ${config.autonomyPhase} · posting requires approval: ${postingRequiresApproval()}`);
  console.log(`[worker] state backend: ${stateEnabled() ? "postgres" : "ephemeral"}`);
  console.log("[worker] polling brief queue…");
  await loop();
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
