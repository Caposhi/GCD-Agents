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

import { AgentRunner, Brief, ImageResolver, runBrief } from "./orchestrator.js";
import { FinalPackage, toPostPackages } from "./packageMap.js";
import {
  buildGbpLocalPost,
  buildIgCreateContainer,
  buildFacebookPost,
  PlatformCredentials,
  PublicationTarget,
} from "../mcp/posting-tool/index.js";
export {
  clearSimulatedDryRunEnvironment,
  prepareSimulatedDryRunEnvironment,
  SIMULATED_DRYRUN_ENV_KEYS,
} from "./dryrunEnv.js";

const DUMMY_CREDS: PlatformCredentials = {
  igUserId: "IG_ID",
  fbPageId: "FB_ID",
  gbpAccountId: "ACCT",
  gbpLocationId: "LOC",
  graphVersion: "v25.0",
  igGraphHost: "graph.instagram.com",
};

/** Explicit non-live destinations; simulated mode works after env scrub. */
export const DUMMY_PUBLICATION_TARGETS: Record<"instagram" | "facebook" | "gbp", PublicationTarget> = {
  instagram: { accountId: "IG_ID", apiHost: "graph.instagram.com", apiVersion: "v25.0" },
  facebook: { accountId: "FB_ID", apiHost: "graph.facebook.com", apiVersion: "v25.0" },
  gbp: { accountId: "ACCT", locationId: "LOC", apiHost: "mybusiness.googleapis.com", apiVersion: "v4" },
};

export interface DryRunReport {
  status: string;
  critiqueCycles: number;
  verdict: string;
  postCount: number;
  builtRequests: { platform: string; method: string; url: string; valid: boolean }[];
  scorecard: { platform: string; compliancePass: boolean; critiqueCycles: number; reworked: boolean }[];
  package?: FinalPackage;
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

/** runner omitted => runBrief uses the default live SDK + image resolver. */
export async function runDryRun(
  brief: Brief,
  runner?: AgentRunner,
  imageResolver?: ImageResolver,
  publicationTargets?: Partial<Record<"instagram" | "facebook" | "gbp", PublicationTarget>>,
): Promise<DryRunReport> {
  const outcome = await runBrief(brief, {
    ...(runner ? { runner } : {}),
    ...(imageResolver ? { imageResolver } : {}),
    ...(publicationTargets ? { publicationTargets } : {}),
  });

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
    package: pkg,
  };
}

/** Empty request arrays are failures; Array#every alone would pass vacuously. */
export function dryRunReportPasses(report: DryRunReport): boolean {
  return report.status === "awaiting_approval" &&
    report.verdict === "PASS" &&
    report.postCount > 0 &&
    report.builtRequests.length === report.postCount &&
    report.builtRequests.length > 0 &&
    report.builtRequests.every((request) => request.valid);
}

// ---- simulated runner (representative agent outputs) ----

const SIM: Record<string, any> = {
  analytics: { headline: "Maintenance tips outperform promos; best at 9am ET.", do_more_of: ["how-to tips"], do_less_of: [], timing_rec: "09:00 ET", data_gaps: [] },
  copywriter: [
    { platform: "instagram", lang: "en", body: "Your BMW runs best when the small stuff stays on schedule. We handle oil, brakes, and fluids the right way — no surprises. Book online when you're ready.", cta: "Book online", char_count: 150 },
    { platform: "facebook", lang: "en", body: "Dealer-level care for your European car, without the dealer markup. Book your next service with our team.", cta: "Book online", char_count: 105 },
    { platform: "gbp", lang: "en", body: "European car repair in Doral done the right way. Oil, brakes, and diagnostics by specialists who know your BMW, Mercedes, or Audi.", cta: "Book", char_count: 130 },
  ],
  image: { contentType: "text-graphic", prompt: "A premium German Car Depot brake-service graphic.", width: 1080, height: 1350, in_image_text: ["BRAKE SERVICE", "BOOK ONLINE", "German Car Depot", "GermanCarDepot.com"], alt_text_en: "Navy graphic: 'Brake service — book online' with the German Car Depot logo.", alt_text_es: "Gráfico azul marino: 'Servicio de frenos — reserva en línea'." },
  "hashtag-seo-timing": [
    { platform: "instagram", hashtags: ["#bmwrepair", "#hollywoodfl", "#europeancarservice", "#germancar", "#brakeservice", "#autocare", "#broward", "#germancardepot"], keywords: ["BMW service Hollywood"], recommended_time: "09:00 ET" },
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

/** Offline-only stand-in for a runtime-generated, inspected, hosted JPEG. */
export const simulatedInspectedImageResolver: ImageResolver = async (specification) => ({
  ...specification,
  url: `https://img.gcd.example/media/00000000-0000-4000-8000-000000000002-${"a".repeat(64)}.jpg`,
  contentSha256: "a".repeat(64),
  model: "offline-fixture",
  aiGenerated: true,
  qcFailed: false,
  qc: { ok: true, issues: [], readText: specification?.in_image_text ?? [], attempts: 1, errored: false },
  inspection: { status: "passed", attempts: 1, readText: specification?.in_image_text ?? [] },
});
