/**
 * Phase 7 dry-run harness. Runs a brief through the real manager loop with a
 * supplied subagent runner, then proves the resulting package maps to VALID
 * platform API requests — without publishing and without network.
 *
 * Two modes:
 *  - simulated (default `npm run dryrun`): canned, representative agent outputs
 *    so you can watch the full pipeline + validate the package→request chain
 *    offline, no API keys.
 *  - live: pass the SDK runner (requires ANTHROPIC_API_KEY + fal) to exercise
 *    real agents. Still never publishes — it stops at the built requests.
 */

import { AgentRunner, Brief, runBrief } from "./orchestrator.js";
import { FinalPackage, toPostPackages } from "./packageMap.js";
import {
  buildGbpLocalPost,
  buildIgCreateContainer,
  buildFacebookPost,
  PlatformCredentials,
} from "../mcp/posting-tool/index.js";

const DUMMY_CREDS: PlatformCredentials = {
  igUserId: "IG_ID",
  fbPageId: "FB_ID",
  gbpAccountId: "ACCT",
  gbpLocationId: "LOC",
  graphVersion: "v25.0",
};

export interface DryRunReport {
  status: string;
  critiqueCycles: number;
  verdict: string;
  postCount: number;
  builtRequests: { platform: string; method: string; url: string; valid: boolean }[];
  scorecard: { platform: string; compliancePass: boolean; critiqueCycles: number; reworked: boolean }[];
  criticFindings?: any[];
  escalation?: string;
}

function lastFindings(outcome: any): any[] {
  const h = outcome?.critique?.history ?? [];
  return h.length ? (h[h.length - 1]?.findings ?? []) : [];
}

/** Build the platform request for one post (dry — validates shape only). */
function buildRequestFor(pkg: any): { method: string; url: string } {
  switch (pkg.platform) {
    case "gbp":
      return buildGbpLocalPost(pkg, DUMMY_CREDS);
    case "instagram":
      return buildIgCreateContainer(pkg, DUMMY_CREDS);
    case "facebook":
      return buildFacebookPost(pkg, DUMMY_CREDS);
    default:
      throw new Error(`unknown platform ${pkg.platform}`);
  }
}

/** runner omitted => runBrief uses the default live SDK runner. */
export async function runDryRun(brief: Brief, runner?: AgentRunner): Promise<DryRunReport> {
  const outcome = await runBrief(brief, runner ? { runner } : {});

  if (outcome.status !== "awaiting_approval") {
    return {
      status: outcome.status,
      critiqueCycles: outcome.critique.cycles,
      verdict: outcome.critique.finalVerdict,
      postCount: 0,
      builtRequests: [],
      scorecard: [],
      criticFindings: lastFindings(outcome),
      escalation: outcome.escalation,
    };
  }

  const pkg = outcome.package as FinalPackage;
  const posts = toPostPackages(pkg);
  const builtRequests = posts.map((p) => {
    try {
      const r = buildRequestFor(p);
      return { platform: p.platform, method: r.method, url: r.url, valid: !!r.url };
    } catch (err) {
      return { platform: p.platform, method: "-", url: `ERROR: ${(err as Error).message}`, valid: false };
    }
  });

  const scorecard = pkg.platforms.map((p) => ({
    platform: p.platform,
    compliancePass: outcome.critique.finalVerdict === "PASS",
    critiqueCycles: outcome.critique.cycles,
    reworked: outcome.critique.cycles > 1,
  }));

  return {
    status: outcome.status,
    critiqueCycles: outcome.critique.cycles,
    verdict: outcome.critique.finalVerdict,
    postCount: posts.length,
    builtRequests,
    scorecard,
  };
}

// ---- simulated runner (representative agent outputs) ----

const SIM: Record<string, any> = {
  analytics: { headline: "Maintenance tips outperform promos; best at 9am ET.", do_more_of: ["how-to tips"], do_less_of: [], timing_rec: "09:00 ET", data_gaps: [] },
  copywriter: [
    { platform: "instagram", lang: "en", body: "Your BMW runs best when the small stuff stays on schedule. We handle oil, brakes, and fluids the right way — no surprises. Book online when you're ready.", cta: "Book online", char_count: 150 },
    { platform: "facebook", lang: "en", body: "Dealer-level care for your European car, without the dealer markup. Book your next service with our team.", cta: "Book online", char_count: 105 },
    { platform: "gbp", lang: "en", body: "European car repair in Doral done the right way. Oil, brakes, and diagnostics by specialists who know your BMW, Mercedes, or Audi.", cta: "Book", char_count: 130 },
  ],
  image: { url: "https://img.gcd.example/brake-fluid.jpg", model: "fal-ai/ideogram/v3", contentType: "text-graphic", width: 1080, height: 1350, alt_text_en: "Navy graphic: 'Brake fluid flush — book online' with the German Car Depot logo.", alt_text_es: "Gráfico azul marino: 'Cambio de líquido de frenos — reserva en línea'." },
  "hashtag-seo-timing": [
    { platform: "instagram", hashtags: ["#bmwrepair", "#doral", "#europeancarservice"], keywords: ["BMW service Doral"], recommended_time: "09:00 ET" },
    { platform: "facebook", hashtags: [], keywords: ["European car repair Miami"], recommended_time: "12:00 ET" },
    { platform: "gbp", hashtags: [], keywords: ["European car repair in Doral"], recommended_time: "08:00 ET" },
  ],
  "platform-formatter": [
    { platform: "instagram", lang: "en", formatted_body: "Your BMW runs best when the small stuff stays on schedule. We handle oil, brakes, and fluids the right way. Book online when you're ready.", cta: { actionType: "BOOK", url: "https://gcd.example/book" } },
    { platform: "facebook", lang: "en", formatted_body: "Dealer-level care for your European car, without the dealer markup. Book your next service with our team.", cta: { actionType: "BOOK", url: "https://gcd.example/book" } },
    { platform: "gbp", lang: "en", formatted_body: "European car repair in Doral done the right way. Oil, brakes, and diagnostics by specialists who know your BMW, Mercedes, or Audi.", cta: { actionType: "BOOK", url: "https://gcd.example/book" } },
  ],
  "brand-compliance-critic": { verdict: "PASS", findings: [] },
};

export function simulatedRunner(): AgentRunner {
  return async (name: string) => SIM[name] ?? {};
}

// CLI: npm run dryrun
const isMain = process.argv[1]?.endsWith("dryrun.js");
if (isMain) {
  const live = process.argv.includes("--live");
  // Test fixture. Real posts pass approvedFacts via the /triggers payload —
  // the critic only lets claims through that these facts support.
  const brief: Brief = {
    goal: "Promote routine European-car maintenance; encourage booking online",
    approvedFacts: {
      shop: "German Car Depot — independent European-vehicle repair, South Florida, since 1992",
      positioning: "The Dealership Alternative — dealer-level expertise without dealer pricing",
      services: ["oil change", "brake service", "brake fluid flush", "diagnostics", "AC service", "scheduled maintenance"],
      makes: ["BMW", "Mercedes-Benz", "Audi", "VW", "Porsche", "Volvo", "MINI"],
      location: "Doral, FL (greater Miami)",
      bookingUrl: "https://germancardepot.com/book",
    } as Record<string, unknown>,
  };
  // live: no runner → real SDK agents (needs ANTHROPIC_API_KEY + fal). Never posts.
  runDryRun(brief, live ? undefined : simulatedRunner())
    .then((report) => {
      console.log(`=== GCD-SOCIAL dry run (${live ? "LIVE — real agents, no posting" : "simulated"}) ===`);
      console.log(JSON.stringify(report, null, 2));
      if (report.status === "escalated" && report.criticFindings?.length) {
        console.log("\nWhy the critic failed it:");
        report.criticFindings.forEach((f) => console.log(`  • [${f.section}] ${f.issue} → ${f.exact_fix} (${f.owning_subagent})`));
      }
      const allValid = report.builtRequests.every((r) => r.valid);
      console.log(
        allValid && report.status === "awaiting_approval"
          ? "\nDRY RUN OK ✅ (no posting performed)"
          : "\nDRY RUN ISSUES ⚠️ — see above",
      );
      process.exit(allValid ? 0 : 1);
    })
    .catch((err) => {
      console.error("dry run error:", err);
      process.exit(1);
    });
}
