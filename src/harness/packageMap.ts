/**
 * Canonical package contract + deterministic mapping to PostPackages.
 *
 * Phase 7 pins the hand-off between the agents and the posting tool. The
 * orchestrator builds a `FinalPackage` in CODE from the subagent outputs (not
 * trusting any single agent to carry everything), and the worker maps it to
 * PostPackages deterministically here. One `platforms[]` entry == one post.
 */

import { PostPackage, Platform, GbpActionType } from "../mcp/posting-tool/index.js";

export interface FinalPackagePost {
  platform: Platform;
  body: string;
  lang?: string; // "en" | "es"
  hashtags?: string[];
  cta?: { actionType?: GbpActionType; url?: string };
  scheduledTime?: string;
}

export interface FinalPackage {
  image?: { url?: string; altEn?: string; altEs?: string };
  platforms: FinalPackagePost[];
}

const PLATFORM_MAP: Record<string, Platform> = {
  instagram: "instagram",
  ig: "instagram",
  facebook: "facebook",
  fb: "facebook",
  gbp: "gbp",
  google: "gbp",
};

function normPlatform(p: unknown): Platform | undefined {
  return PLATFORM_MAP[String(p).toLowerCase()];
}

function tagsForPlatform(tags: any, platform: string): string[] | undefined {
  if (!Array.isArray(tags)) return undefined;
  const entry = tags.find((t: any) => normPlatform(t?.platform) === normPlatform(platform));
  return entry?.hashtags;
}

/**
 * Build the canonical package from raw subagent outputs. Tolerant of shape
 * variation; drops any entry without a platform + body.
 */
export function buildFinalPackage(formatted: any, image: any, tags: any): FinalPackage {
  const entries: any[] = Array.isArray(formatted) ? formatted : formatted?.platforms ?? [];
  const platforms: FinalPackagePost[] = [];
  for (const e of entries) {
    const platform = normPlatform(e?.platform);
    const body = e?.formatted_body ?? e?.body ?? e?.text;
    if (!platform || !body) continue;
    platforms.push({
      platform,
      body: String(body),
      lang: e?.lang,
      hashtags: e?.hashtags ?? tagsForPlatform(tags, e?.platform),
      cta: e?.cta,
      scheduledTime: e?.scheduled_time ?? e?.recommended_time,
    });
  }
  const img = image?.url
    ? { url: String(image.url), altEn: image.alt_text_en ?? image.altEn, altEs: image.alt_text_es ?? image.altEs }
    : undefined;
  return { image: img, platforms };
}

function bodyWithTags(post: FinalPackagePost): string {
  // Hashtags on Instagram only; GBP forbids them, FB leans on plain language.
  if (post.platform === "instagram" && post.hashtags?.length) {
    return `${post.body}\n\n${post.hashtags.join(" ")}`;
  }
  return post.body;
}

/** Deterministic map: canonical package → PostPackages (one per post). */
export function toPostPackages(pkg: FinalPackage): PostPackage[] {
  return pkg.platforms.map((post) => {
    const out: PostPackage = {
      platform: post.platform,
      text: bodyWithTags(post),
      languageCode: post.lang,
      images: pkg.image?.url
        ? [{ url: pkg.image.url, altText: post.lang === "es" ? pkg.image.altEs : pkg.image.altEn, aiGenerated: true }]
        : undefined,
    };
    if (post.platform === "gbp" && post.cta?.url) {
      out.gbp = { topicType: "STANDARD", callToAction: { actionType: post.cta.actionType ?? "LEARN_MORE", url: post.cta.url } };
    }
    return out;
  });
}

export function summarize(pkg: FinalPackage): string {
  if (pkg.platforms.length === 0) return "Package ready for review (no auto-summary).";
  return pkg.platforms
    .map((p) => `• *${p.platform}*${p.lang ? ` (${p.lang})` : ""}: ${p.body.slice(0, 120)}${p.body.length > 120 ? "…" : ""}`)
    .join("\n");
}
