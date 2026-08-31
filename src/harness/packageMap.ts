/**
 * Canonical, provider-bound package construction.
 *
 * All externally visible transformations happen in `buildFinalPackage` BEFORE
 * the critic and approval gate see the package. `providerPayloads` is therefore
 * the exact content contract that the worker is allowed to publish: mapping it
 * after approval may validate and clone, but must never add hashtags, truncate
 * text, insert a CTA, substitute media, or otherwise change content.
 */

import type {
  PostPackage,
  Platform,
  GbpActionType,
  PublicationTarget,
} from "../mcp/posting-tool/index.js";
import {
  mediaUrlMatchesContentSha256,
  validatePostPackage,
} from "../mcp/posting-tool/validation.js";

export type FinalPackageLanguage = "en" | "es";

export interface FinalPackageMediaPreview {
  url: string;
  contentSha256: string;
  altText?: string;
  /** Present only where the current provider request supports disclosure. */
  aiGenerated?: boolean;
}

/** Human-readable view derived from the provider payload at the same index. */
export interface FinalPackagePost {
  platform: Platform;
  /** Exact approval-bound provider account/location and API destination. */
  target: PublicationTarget;
  /** Exact provider-bound text, including applied Instagram hashtags. */
  body: string;
  /** Languages present in `body`, in display order. */
  languages: FinalPackageLanguage[];
  /** Hashtags already present in `body`; informational, never applied later. */
  hashtags?: string[];
  /** Provider-bound CTA (currently GBP only). */
  cta?: { actionType: GbpActionType; url: string };
  /** Recommendation only; current provider payloads are published immediately. */
  recommendedTime?: string;
  media?: FinalPackageMediaPreview[];
}

export interface FinalPackageImage {
  url: string;
  contentSha256: string;
  altEn?: string;
  altEs?: string;
  aiGenerated: boolean;
  model?: string;
  inspection: {
    status: "passed";
    attempts: number;
    readText: string[];
  };
}

export interface FinalPackage {
  schemaVersion: "gcd-final-package/v1";
  /** Deterministic policy inputs copied from trusted runtime configuration. */
  policy: {
    activePlatforms: Platform[];
    approvedCtaUrls: string[];
    formatterBlockingIssues: string[];
  };
  image?: FinalPackageImage;
  platforms: FinalPackagePost[];
  /** Exact canonical content supplied to the posting provider after approval. */
  providerPayloads: PostPackage[];
}

export interface BuildFinalPackageOptions {
  activePlatforms?: Platform[];
  publicationTargets?: Partial<Record<Platform, PublicationTarget>>;
  bookingUrl?: string;
  approvedCtaUrls?: string[];
}

export interface PackageValidationResult {
  ok: boolean;
  issues: string[];
}

const PLATFORM_MAP: Record<string, Platform> = {
  instagram: "instagram",
  ig: "instagram",
  facebook: "facebook",
  fb: "facebook",
  gbp: "gbp",
  google: "gbp",
};

/**
 * The deterministic per-platform limits this module enforces on provider text.
 *
 * Exported so a reviewed reasoning stage can validate its *proposed* copy
 * against exactly the same numbers instead of declaring a second, competing
 * policy. Exporting them changes no behaviour here; it removes the only way the
 * two could silently diverge.
 */
export const GBP_SUMMARY_MAX = 1_500;
export const INSTAGRAM_CAPTION_MAX = 2_200;
export const FACEBOOK_TEXT_MAX = 63_206;
export const INSTAGRAM_HASHTAG_MIN = 8;
export const INSTAGRAM_HASHTAG_MAX = 15;
/** Facebook leans on local language; provider text allows at most two tags. */
export const FACEBOOK_HASHTAG_MAX = 2;
/** Google Business Profile provider text must carry no hashtag at all. */
export const GBP_HASHTAG_MAX = 0;
/** The single token shape provider-visible hashtags must match. */
export const HASHTAG_TOKEN_PATTERN = /^#[\p{L}\p{N}_]+$/u;

function normPlatform(value: unknown): Platform | undefined {
  return PLATFORM_MAP[String(value ?? "").trim().toLowerCase()];
}

function normLang(value: unknown): FinalPackageLanguage | undefined {
  const lang = String(value ?? "").trim().toLowerCase();
  if (lang === "en" || lang === "en-us") return "en";
  if (lang === "es" || lang === "es-us") return "es";
  return undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.map(text).filter((item): item is string => !!item);
  return values.length ? values : undefined;
}

function hashtagTokens(value: string): string[] {
  return [...value.matchAll(/#[\p{L}\p{N}_]+/gu)].map((match) => match[0]);
}

function canonicalHashtag(value: string): string {
  return value.toLocaleLowerCase("en-US");
}

/** Truncate before critique/approval, at a word boundary when practical. */
function capText(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

function formattedBody(
  entries: any[],
  formatted: any[],
  platform: Platform,
  lang: FinalPackageLanguage,
): string | undefined {
  const source = entries.find((entry) => normLang(entry?.lang) === lang) ??
    (lang === "en" ? entries.find((entry) => normLang(entry?.lang) === undefined) : undefined);

  // Untagged formatter output is an English-only legacy fallback. It must
  // never be reused for Spanish, which previously duplicated one body twice.
  const explicit = formatted.find(
    (entry) => normPlatform(entry?.platform) === platform && normLang(entry?.lang) === lang,
  );
  const legacyEnglish = lang === "en"
    ? formatted.find(
        (entry) => normPlatform(entry?.platform) === platform && normLang(entry?.lang) === undefined,
      )
    : undefined;
  return text(explicit?.formatted_body) ?? text(explicit?.body) ??
    text(legacyEnglish?.formatted_body) ?? text(legacyEnglish?.body) ??
    text(source?.body) ?? text(source?.formatted_body);
}

function ctaForGbp(
  formatted: any[],
  entries: any[],
  bookingUrl: string | undefined,
  approvedCtaUrls: Set<string>,
): { actionType: GbpActionType; url: string } | undefined {
  const fromFormatter = formatted.find((entry) => normPlatform(entry?.platform) === "gbp")?.cta;
  const fromCopy = entries.find((entry) => entry?.cta && typeof entry.cta === "object")?.cta;
  const raw = fromFormatter && typeof fromFormatter === "object" ? fromFormatter : fromCopy;
  const requestedUrl = text(raw?.url);
  // A formatter/model may select an approved URL but can never introduce one.
  // Prefer the canonical booking URL when its suggestion is not allowlisted.
  const url = requestedUrl && approvedCtaUrls.has(requestedUrl) ? requestedUrl : text(bookingUrl);
  if (!url) return undefined;
  // The canonical booking destination always means BOOK. Other approved HTTPS
  // destinations are informational and cannot be relabeled CALL/ORDER/etc. by
  // formatter output.
  const actionType: GbpActionType = bookingUrl && url === bookingUrl ? "BOOK" : "LEARN_MORE";
  return { actionType, url };
}

function mediaFor(
  image: any,
  languages: FinalPackageLanguage[],
  platform: Platform,
): FinalPackageMediaPreview[] | undefined {
  const url = text(image?.url);
  if (!url) return undefined;
  const altEn = text(image?.alt_text_en) ?? text(image?.altEn);
  const altEs = text(image?.alt_text_es) ?? text(image?.altEs);
  const contentSha256 = text(image?.contentSha256) ?? "";
  const altText = languages.includes("en") ? altEn : altEs;
  // The verified native request builders currently transmit alt text and the
  // AI disclosure only for Instagram. FB sends image URL + caption; GBP sends
  // sourceUrl only. Do not imply ignored fields are provider-bound.
  return platform === "instagram"
    ? [{ url, contentSha256, altText, aiGenerated: image?.aiGenerated === true }]
    : [{ url, contentSha256 }];
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Build one canonical provider payload per active platform. The formatter may
 * refine only the explicitly tagged language it returns. IG/FB combine EN then
 * ES; the legacy GBP flow remains one listing post, preferring English.
 */
export function buildFinalPackage(
  copy: any,
  formatted: any,
  image: any,
  tags: any,
  options: BuildFinalPackageOptions = {},
): FinalPackage {
  const copyArr: any[] = Array.isArray(copy) ? copy : Array.isArray(copy?.posts) ? copy.posts : [];
  const fmtArr: any[] = Array.isArray(formatted) ? formatted : Array.isArray(formatted?.platforms) ? formatted.platforms : [];
  const tagArr: any[] = Array.isArray(tags) ? tags : Array.isArray(tags?.platforms) ? tags.platforms : [];
  const active = new Set(options.activePlatforms ?? (["instagram", "facebook", "gbp"] as Platform[]));
  const approvedCtaUrls = new Set(
    (options.approvedCtaUrls ?? [options.bookingUrl])
      .map(text)
      .filter((value): value is string => !!value),
  );
  const formatterBlockingIssues = fmtArr
    .map((entry) => text(entry?.blocking_issue))
    .filter((issue): issue is string => !!issue);

  const platforms: FinalPackagePost[] = [];
  const providerPayloads: PostPackage[] = [];

  for (const platform of ["instagram", "facebook", "gbp"] as const) {
    if (!active.has(platform)) continue;
    const entries = copyArr.filter((entry) => normPlatform(entry?.platform) === platform);
    if (!entries.length) continue;

    const en = formattedBody(entries, fmtArr, platform, "en");
    const es = formattedBody(entries, fmtArr, platform, "es");
    const languages: FinalPackageLanguage[] = platform === "gbp"
      ? en ? ["en"] : es ? ["es"] : []
      : ([en ? "en" : undefined, es ? "es" : undefined].filter(Boolean) as FinalPackageLanguage[]);
    if (!languages.length) continue;

    const localized = platform === "gbp"
      ? languages[0] === "en" ? en! : es!
      : [en, es].filter((value): value is string => !!value).join("\n\n");
    const tagEntry = tagArr.find((entry) => normPlatform(entry?.platform) === platform);
    const hashtags = platform === "instagram" ? stringArray(tagEntry?.hashtags) : undefined;
    const bodyWithTags = hashtags?.length ? `${localized}\n\n${hashtags.join(" ")}` : localized;
    const body = platform === "gbp" ? capText(bodyWithTags, GBP_SUMMARY_MAX) : bodyWithTags;
    const media = mediaFor(image, languages, platform);
    const cta = platform === "gbp" ? ctaForGbp(fmtArr, entries, options.bookingUrl, approvedCtaUrls) : undefined;
    const target = options.publicationTargets?.[platform] ?? {
      accountId: "",
      apiHost: "",
      apiVersion: "",
    };

    const payload: PostPackage = {
      platform,
      target: { ...target },
      text: body,
      languageCode: platform === "gbp" ? (languages[0] === "es" ? "es-US" : "en-US") : undefined,
      images: media?.map((item) => ({ ...item })),
      gbp: platform === "gbp"
        ? {
            topicType: "STANDARD",
            callToAction: cta ? { ...cta } : undefined,
          }
        : undefined,
    };

    // JSON serialization is the durable approval boundary; remove undefined
    // properties now so preview, hashing, storage, and publication agree.
    const canonicalPayload = cloneJson(payload);
    providerPayloads.push(canonicalPayload);
    platforms.push({
      platform,
      target: { ...canonicalPayload.target },
      body: canonicalPayload.text,
      languages,
      hashtags,
      cta,
      recommendedTime: text(tagEntry?.recommended_time),
      media: canonicalPayload.images?.map((item) => ({
        url: item.url,
        contentSha256: item.contentSha256,
        altText: item.altText,
        aiGenerated: item.aiGenerated,
      })),
    });
  }

  const imageUrl = text(image?.url);
  const imageSummary: FinalPackageImage | undefined = imageUrl && image?.inspection?.status === "passed"
    ? {
        url: imageUrl,
        contentSha256: text(image?.contentSha256) ?? "",
        altEn: text(image?.alt_text_en) ?? text(image?.altEn),
        altEs: text(image?.alt_text_es) ?? text(image?.altEs),
        aiGenerated: image?.aiGenerated === true,
        model: text(image?.model),
        inspection: {
          status: "passed",
          attempts: Number.isInteger(image.inspection?.attempts) ? image.inspection.attempts : 1,
          readText: stringArray(image.inspection?.readText) ?? [],
        },
      }
    : undefined;

  return {
    schemaVersion: "gcd-final-package/v1",
    policy: {
      activePlatforms: [...active],
      approvedCtaUrls: [...approvedCtaUrls].sort(),
      formatterBlockingIssues,
    },
    image: imageSummary,
    platforms,
    providerPayloads,
  };
}

function validHttpsUrl(value: unknown): boolean {
  try {
    return new URL(String(value)).protocol === "https:";
  } catch {
    return false;
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return canonicalJson(left) === canonicalJson(right);
}

/** Validate the exact review ↔ provider-content binding before critic/approval. */
export function validateFinalPackage(pkg: FinalPackage): PackageValidationResult {
  const issues: string[] = [];
  if (!pkg || pkg.schemaVersion !== "gcd-final-package/v1") issues.push("unsupported or missing package schemaVersion");
  const activePlatforms = Array.isArray(pkg?.policy?.activePlatforms) ? pkg.policy.activePlatforms : [];
  const approvedCtaUrls = new Set(Array.isArray(pkg?.policy?.approvedCtaUrls) ? pkg.policy.approvedCtaUrls : []);
  const formatterBlockingIssues = Array.isArray(pkg?.policy?.formatterBlockingIssues) ? pkg.policy.formatterBlockingIssues : [];
  if (activePlatforms.length === 0) issues.push("package policy has no active platforms");
  if (new Set(activePlatforms).size !== activePlatforms.length) issues.push("package policy contains duplicate active platforms");
  if (activePlatforms.some((platform) => !(["instagram", "facebook", "gbp"] as string[]).includes(platform))) {
    issues.push("package policy contains an invalid active platform");
  }
  if ([...approvedCtaUrls].some((url) => !validHttpsUrl(url))) issues.push("package policy contains a non-https CTA URL");
  for (const issue of formatterBlockingIssues) issues.push(`platform formatter blocked canonicalization: ${String(issue)}`);
  if (!Array.isArray(pkg?.platforms) || pkg.platforms.length === 0) issues.push("package has no reviewable platform posts");
  if (!Array.isArray(pkg?.providerPayloads) || pkg.providerPayloads.length === 0) issues.push("package has no provider payloads");
  if (pkg?.platforms?.length !== pkg?.providerPayloads?.length) issues.push("review/provider payload count mismatch");

  const seen = new Set<Platform>();
  for (let i = 0; i < (pkg?.providerPayloads?.length ?? 0); i++) {
    const payload = pkg.providerPayloads[i];
    const preview = pkg.platforms[i];
    if (!payload || !preview) continue;
    if (payload.platform !== preview.platform) issues.push(`platform[${i}] review/provider platform mismatch`);
    if (!sameJson(payload.target, preview.target)) issues.push(`${payload.platform} review target differs from provider target`);
    const strictPayload = validatePostPackage(payload);
    issues.push(...strictPayload.issues.map((issue) => `${payload.platform}: ${issue}`));
    if (seen.has(payload.platform)) issues.push(`duplicate provider payload for ${payload.platform}`);
    seen.add(payload.platform);
    if (!text(payload.text)) issues.push(`${payload.platform} provider text is empty`);
    if (payload.text !== preview.body) issues.push(`${payload.platform} review text differs from provider text`);
    if (!Array.isArray(preview.languages) || preview.languages.length === 0) issues.push(`${payload.platform} review languages are missing`);
    if (new Set(preview.languages).size !== preview.languages.length || preview.languages.some((lang) => lang !== "en" && lang !== "es")) {
      issues.push(`${payload.platform} review languages are invalid`);
    }

    const expectedMedia = payload.images?.map((item) => ({
      url: item.url,
      contentSha256: item.contentSha256,
      altText: item.altText,
      aiGenerated: item.aiGenerated,
    }));
    if (!sameJson(expectedMedia, preview.media)) issues.push(`${payload.platform} review media differs from provider media`);
    for (const [mediaIndex, media] of (payload.images ?? []).entries()) {
      if (!validHttpsUrl(media.url)) issues.push(`${payload.platform} media[${mediaIndex}] must use https`);
      if (!mediaUrlMatchesContentSha256(media.url, media.contentSha256)) {
        issues.push(`${payload.platform} media[${mediaIndex}] URL/digest binding is invalid`);
      }
    }

    if (payload.platform === "instagram") {
      if (payload.images?.length !== 1) issues.push("instagram requires exactly one inspected image");
      if (payload.text.length > INSTAGRAM_CAPTION_MAX) issues.push(`instagram caption exceeds ${INSTAGRAM_CAPTION_MAX} characters`);
      if (!text(payload.images?.[0]?.altText)) issues.push("instagram image alt text is missing");
      if (payload.images?.[0]?.aiGenerated !== true) issues.push("instagram generated-media disclosure is missing");
      const expectedHashtags = preview.hashtags?.length ? preview.hashtags.join(" ") : "";
      const visibleHashtags = hashtagTokens(payload.text);
      if (expectedHashtags && !payload.text.endsWith(expectedHashtags)) issues.push("instagram preview hashtags are not already applied to provider text");
      if (visibleHashtags.length < INSTAGRAM_HASHTAG_MIN || visibleHashtags.length > INSTAGRAM_HASHTAG_MAX) {
        issues.push(`instagram requires ${INSTAGRAM_HASHTAG_MIN}-${INSTAGRAM_HASHTAG_MAX} canonical hashtags`);
      }
      if (!sameJson(visibleHashtags.map(canonicalHashtag), (preview.hashtags ?? []).map(canonicalHashtag))) {
        issues.push("instagram provider-visible hashtags differ from the canonical hashtag list");
      }
      if ((preview.hashtags ?? []).some((tag) => !HASHTAG_TOKEN_PATTERN.test(tag))) {
        issues.push("instagram canonical hashtag contains an invalid token");
      }
      if (new Set(visibleHashtags.map(canonicalHashtag)).size !== visibleHashtags.length) {
        issues.push("instagram provider-visible hashtags must be unique");
      }
      if (payload.languageCode !== undefined) issues.push("instagram must not carry an ambiguous package languageCode");
      if (!sameJson(preview.languages, preview.languages.includes("es") ? ["en", "es"] : ["en"])) {
        issues.push("instagram languages must be explicit and ordered en then es");
      }
    }

    if (payload.platform === "facebook") {
      if (payload.text.length > FACEBOOK_TEXT_MAX) issues.push(`facebook text exceeds ${FACEBOOK_TEXT_MAX} characters`);
      if (hashtagTokens(payload.text).length > FACEBOOK_HASHTAG_MAX) {
        issues.push(`facebook provider text allows at most ${FACEBOOK_HASHTAG_MAX} hashtags`);
      }
      if (payload.languageCode !== undefined) issues.push("facebook must not carry an ambiguous package languageCode");
      if (payload.images?.length && payload.facebook?.link) issues.push("facebook image posts cannot also carry an ignored link field");
      if (!sameJson(preview.languages, preview.languages.includes("es") ? ["en", "es"] : ["en"])) {
        issues.push("facebook languages must be explicit and ordered en then es");
      }
    }

    if (payload.platform === "gbp") {
      if (payload.text.length > GBP_SUMMARY_MAX) issues.push(`gbp summary exceeds ${GBP_SUMMARY_MAX} characters`);
      if (payload.languageCode !== (preview.languages[0] === "es" ? "es-US" : "en-US")) {
        issues.push("gbp review language differs from provider languageCode");
      }
      const providerCta = payload.gbp?.callToAction;
      if (!providerCta) issues.push("gbp requires a canonical CTA from approved facts");
      if (!sameJson(providerCta, preview.cta)) issues.push("gbp review CTA differs from provider CTA");
      if (providerCta && !validHttpsUrl(providerCta.url)) issues.push("gbp CTA URL must use https");
      if (providerCta && !approvedCtaUrls.has(providerCta.url)) issues.push("gbp CTA URL is not in canonical approved facts");
      if (hashtagTokens(payload.text).length > GBP_HASHTAG_MAX) {
        issues.push("gbp provider text must not contain hashtags");
      }
      if (preview.languages.length !== 1) issues.push("legacy gbp payload must have exactly one explicit language");
    } else if (payload.gbp !== undefined) {
      issues.push(`${payload.platform} contains GBP-only fields`);
    }
    if (payload.facebook?.link && !approvedCtaUrls.has(payload.facebook.link)) {
      issues.push("facebook link is not in canonical approved facts");
    }
  }

  const expectedPlatforms = [...new Set(activePlatforms)].sort();
  const actualPlatforms = [...seen].sort();
  if (!sameJson(expectedPlatforms, actualPlatforms)) {
    issues.push(`provider payloads do not exactly cover active platforms (${expectedPlatforms.join(",")})`);
  }

  if (pkg.image) {
    if (!validHttpsUrl(pkg.image.url)) issues.push("package image URL must use https");
    if (!mediaUrlMatchesContentSha256(pkg.image.url, pkg.image.contentSha256)) {
      issues.push("package image URL does not match its inspected contentSha256");
    }
    if (pkg.image.inspection?.status !== "passed") issues.push("package image inspection did not pass");
    if (pkg.image.aiGenerated !== true) issues.push("package generated-media disclosure is missing");
    for (const payload of pkg.providerPayloads ?? []) {
      if (payload.images?.some((media) => media.url !== pkg.image!.url)) {
        issues.push(`${payload.platform} media URL differs from inspected package image`);
      }
      if (payload.images?.some((media) => media.contentSha256 !== pkg.image!.contentSha256)) {
        issues.push(`${payload.platform} media digest differs from inspected package image`);
      }
    }
  } else if ((pkg.providerPayloads ?? []).some((payload) => payload.images?.length)) {
    issues.push("provider payload contains media without an inspected package image");
  }

  return { ok: issues.length === 0, issues };
}

export function assertValidFinalPackage(pkg: FinalPackage): void {
  const result = validateFinalPackage(pkg);
  if (!result.ok) throw new Error(`BLOCKED: invalid canonical provider package: ${result.issues.join("; ")}`);
}

/**
 * Stable JSON for approval hashing. Object keys are sorted recursively and
 * undefined values are omitted, matching durable JSON storage semantics.
 */
export function canonicalJson(value: unknown): string {
  const visit = (input: unknown): unknown => {
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new Error("canonical JSON cannot contain non-finite numbers");
      return input;
    }
    if (Array.isArray(input)) return input.map(visit);
    if (typeof input === "object") {
      const record = input as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .filter((key) => record[key] !== undefined)
          .sort()
          .map((key) => [key, visit(record[key])]),
      );
    }
    throw new Error(`canonical JSON cannot contain ${typeof input}`);
  };
  return JSON.stringify(visit(value));
}

export function canonicalProviderPayloadJson(pkg: FinalPackage): string {
  assertValidFinalPackage(pkg);
  return canonicalJson(pkg.providerPayloads);
}

/** Exact handoff: validate and clone; perform no externally visible mapping. */
export function toPostPackages(pkg: FinalPackage): PostPackage[] {
  assertValidFinalPackage(pkg);
  return cloneJson(pkg.providerPayloads);
}

/** Escape model-authored preview text before it is embedded in Slack mrkdwn. */
export function sanitizeSlackSummaryText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Slack may auto-link a bare URL or parse an at-mention even without its
    // angle-bracket form. Keep model-authored previews visibly inert.
    .replace(/\b(https?):\/\//gi, "$1[:]//")
    .replace(/@/g, "＠")
    .replace(/`/g, "ˋ");
}

export function summarize(pkg: FinalPackage): string {
  assertValidFinalPackage(pkg);
  return pkg.platforms
    .map((post) => {
      const label = post.languages.length ? ` (${post.languages.join("+")})` : "";
      const normalized = post.body.replace(/\s+/g, " ").trim();
      const preview = sanitizeSlackSummaryText(normalized.slice(0, 120));
      return `• *${post.platform}*${label}: \`${preview}${normalized.length > 120 ? "…" : ""}\``;
    })
    .join("\n");
}
