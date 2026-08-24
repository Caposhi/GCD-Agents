/** Strict, side-effect-free validation for canonical publication packages. */

import type {
  Platform,
  PlatformCredentials,
  PostPackage,
  PublicationTarget,
} from "./types.js";

export const DEFAULT_META_API_VERSION = "v25.0";
export const DEFAULT_IG_API_HOST = "graph.instagram.com";
export const FACEBOOK_API_HOST = "graph.facebook.com";
export const GBP_API_HOST = "mybusiness.googleapis.com";
export const GBP_API_VERSION = "v4";
export const IG_API_HOSTS = new Set([DEFAULT_IG_API_HOST, FACEBOOK_API_HOST]);

const PLATFORMS = new Set<Platform>(["instagram", "facebook", "gbp"]);
const SHA256_RE = /^[a-f0-9]{64}$/;
const META_VERSION_RE = /^v[1-9][0-9]*\.0$/;
const ID_RE = /^[A-Za-z0-9._:-]+$/;

export interface PublicationValidationResult {
  ok: boolean;
  issues: string[];
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  issues: string[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) issues.push(`${label} contains unknown or provider-ignored field ${key}`);
  }
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0;
}

function validHttps(value: unknown): boolean {
  try {
    return typeof value === "string" && new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Require the media URL filename to address the exact inspected byte hash. */
export function mediaUrlMatchesContentSha256(url: unknown, digest: unknown): boolean {
  if (typeof url !== "string" || typeof digest !== "string" || !SHA256_RE.test(digest)) return false;
  try {
    const parsed = new URL(url);
    const escapedDigest = digest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
      && new RegExp(
        `^/media/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-${escapedDigest}\\.jpg$`,
        "i",
      ).test(parsed.pathname);
  } catch {
    return false;
  }
}

export function validatePublicationTarget(
  platform: Platform,
  value: unknown,
): PublicationValidationResult {
  const issues: string[] = [];
  if (!record(value)) return { ok: false, issues: [`${platform} publication target is missing or invalid`] };
  exactKeys(value, ["accountId", "locationId", "apiHost", "apiVersion"], `${platform} publication target`, issues);
  if (!nonempty(value.accountId) || !ID_RE.test(value.accountId)) {
    issues.push(`${platform} publication target accountId is invalid`);
  }
  if (!nonempty(value.apiHost) || value.apiHost !== value.apiHost.toLowerCase()) {
    issues.push(`${platform} publication target apiHost is invalid`);
  }
  if (!nonempty(value.apiVersion)) issues.push(`${platform} publication target apiVersion is invalid`);

  if (platform === "instagram") {
    if (!IG_API_HOSTS.has(String(value.apiHost))) issues.push("instagram publication target apiHost is not allowlisted");
    if (!META_VERSION_RE.test(String(value.apiVersion))) issues.push("instagram publication target apiVersion is invalid");
    if (value.locationId !== undefined) issues.push("instagram publication target must not contain locationId");
  } else if (platform === "facebook") {
    if (value.apiHost !== FACEBOOK_API_HOST) issues.push("facebook publication target apiHost must be graph.facebook.com");
    if (!META_VERSION_RE.test(String(value.apiVersion))) issues.push("facebook publication target apiVersion is invalid");
    if (value.locationId !== undefined) issues.push("facebook publication target must not contain locationId");
  } else {
    if (value.apiHost !== GBP_API_HOST) issues.push(`gbp publication target apiHost must be ${GBP_API_HOST}`);
    if (value.apiVersion !== GBP_API_VERSION) issues.push(`gbp publication target apiVersion must be ${GBP_API_VERSION}`);
    if (!nonempty(value.locationId) || !ID_RE.test(value.locationId)) {
      issues.push("gbp publication target locationId is invalid");
    }
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Reject any data the current native request builders would ignore. This makes
 * the reviewed JSON an exact provider request contract rather than a loose DTO.
 */
export function validatePostPackage(value: unknown): PublicationValidationResult {
  const issues: string[] = [];
  if (!record(value)) return { ok: false, issues: ["publication package is not an object"] };
  exactKeys(value, ["platform", "target", "text", "languageCode", "images", "gbp", "facebook"], "publication package", issues);
  if (!PLATFORMS.has(value.platform as Platform)) {
    issues.push("publication package platform is invalid");
    return { ok: false, issues };
  }
  const platform = value.platform as Platform;
  issues.push(...validatePublicationTarget(platform, value.target).issues);
  if (!nonempty(value.text)) issues.push(`${platform} publication text is empty or not canonical`);

  if (value.images !== undefined) {
    if (!Array.isArray(value.images) || value.images.length === 0) {
      issues.push(`${platform} images must be a nonempty array when present`);
    } else {
      if ((platform === "instagram" || platform === "facebook") && value.images.length !== 1) {
        issues.push(`${platform} supports exactly one image in the verified native request builder`);
      }
      value.images.forEach((image, index) => {
        if (!record(image)) {
          issues.push(`${platform} image[${index}] is invalid`);
          return;
        }
        const allowed = platform === "instagram"
          ? ["url", "contentSha256", "altText", "aiGenerated"]
          : ["url", "contentSha256"];
        exactKeys(image, allowed, `${platform} image[${index}]`, issues);
        if (!validHttps(image.url)) issues.push(`${platform} image[${index}] URL must use https`);
        if (!mediaUrlMatchesContentSha256(image.url, image.contentSha256)) {
          issues.push(`${platform} image[${index}] URL does not match its contentSha256`);
        }
        if (platform === "instagram") {
          if (!nonempty(image.altText)) issues.push("instagram image altText is required");
          if (image.aiGenerated !== true) issues.push("instagram image aiGenerated disclosure is required");
        }
      });
    }
  }
  if (platform === "instagram" && (!Array.isArray(value.images) || value.images.length !== 1)) {
    issues.push("instagram requires exactly one image");
  }

  if (platform === "gbp") {
    if (!nonempty(value.languageCode) || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(value.languageCode)) {
      issues.push("gbp languageCode is missing or invalid");
    }
    if (value.facebook !== undefined) issues.push("gbp contains Facebook-only fields");
    if (value.gbp === undefined) {
      issues.push("gbp options with an explicit topicType are required");
    } else {
      if (!record(value.gbp)) issues.push("gbp options are invalid");
      else {
        exactKeys(value.gbp, ["topicType", "callToAction"], "gbp options", issues);
        if (!["STANDARD", "EVENT", "OFFER", "ALERT"].includes(String(value.gbp.topicType))) {
          issues.push("gbp topicType is invalid");
        }
        if (value.gbp.callToAction !== undefined) {
          if (!record(value.gbp.callToAction)) issues.push("gbp callToAction is invalid");
          else {
            exactKeys(value.gbp.callToAction, ["actionType", "url"], "gbp callToAction", issues);
            if (!["BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "CALL"].includes(String(value.gbp.callToAction.actionType))) {
              issues.push("gbp callToAction actionType is invalid");
            }
            if (!validHttps(value.gbp.callToAction.url)) issues.push("gbp callToAction URL must use https");
          }
        }
      }
    }
  } else {
    if (value.languageCode !== undefined) issues.push(`${platform} contains provider-ignored languageCode`);
    if (value.gbp !== undefined) issues.push(`${platform} contains GBP-only fields`);
  }

  if (platform === "facebook") {
    if (value.facebook !== undefined) {
      if (!record(value.facebook)) issues.push("facebook options are invalid");
      else {
        exactKeys(value.facebook, ["link", "scheduledPublishTime"], "facebook options", issues);
        if (value.facebook.link !== undefined && !validHttps(value.facebook.link)) issues.push("facebook link must use https");
        const scheduled = value.facebook.scheduledPublishTime;
        if (
          scheduled !== undefined
          && (typeof scheduled !== "number" || !Number.isSafeInteger(scheduled) || scheduled <= 0)
        ) issues.push("facebook scheduledPublishTime must be a finite positive integer");
        if (Array.isArray(value.images) && value.images.length && value.facebook.link !== undefined) {
          issues.push("facebook image packages cannot contain a provider-ignored link");
        }
      }
    }
  } else if (value.facebook !== undefined) {
    issues.push(`${platform} contains Facebook-only fields`);
  }
  return { ok: issues.length === 0, issues };
}

export function assertValidPostPackage(value: unknown): asserts value is PostPackage {
  const result = validatePostPackage(value);
  if (!result.ok) throw new Error(`BLOCKED: invalid publication package: ${result.issues.join("; ")}`);
}

/**
 * Validate the complete approval subject, not just the item selected for one
 * provider call. A human decision always covers one non-empty, unique set of
 * canonical platform payloads; malformed or duplicate siblings invalidate the
 * whole decision.
 */
export function validateSocialPostSubject(value: unknown): PublicationValidationResult {
  const issues: string[] = [];
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, issues: ["social publication subject must be a nonempty package array"] };
  }

  const seen = new Set<Platform>();
  value.forEach((item, index) => {
    const result = validatePostPackage(item);
    issues.push(...result.issues.map((issue) => `package[${index}]: ${issue}`));
    if (record(item) && PLATFORMS.has(item.platform as Platform)) {
      const platform = item.platform as Platform;
      if (seen.has(platform)) issues.push(`package[${index}]: duplicate ${platform} platform payload`);
      seen.add(platform);
    }
  });
  return { ok: issues.length === 0, issues };
}

export function assertValidSocialPostSubject(value: unknown): asserts value is PostPackage[] {
  const result = validateSocialPostSubject(value);
  if (!result.ok) throw new Error(`BLOCKED: invalid social publication subject: ${result.issues.join("; ")}`);
}

function requireEnv(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`BLOCKED: ${name} is required to bind the publication target before canonicalization`);
  return value.trim();
}

/** Build non-secret targets once, before canonical packaging. */
export function publicationTargetsFromEnv(
  platforms: readonly Platform[],
  env: Record<string, string | undefined> = process.env,
): Record<Platform, PublicationTarget> {
  const graphVersion = env.GRAPH_VERSION?.trim() || DEFAULT_META_API_VERSION;
  const targets = {} as Record<Platform, PublicationTarget>;
  for (const platform of platforms) {
    const target: PublicationTarget = platform === "instagram"
      ? {
          accountId: requireEnv(env.IG_USER_ID, "IG_USER_ID"),
          apiHost: env.IG_GRAPH_HOST?.trim() || DEFAULT_IG_API_HOST,
          apiVersion: graphVersion,
        }
      : platform === "facebook"
        ? {
            accountId: requireEnv(env.FB_PAGE_ID, "FB_PAGE_ID"),
            apiHost: FACEBOOK_API_HOST,
            apiVersion: graphVersion,
          }
        : {
            accountId: requireEnv(env.GBP_ACCOUNT_ID, "GBP_ACCOUNT_ID"),
            locationId: requireEnv(env.GBP_LOCATION_ID, "GBP_LOCATION_ID"),
            apiHost: GBP_API_HOST,
            apiVersion: GBP_API_VERSION,
          };
    const validation = validatePublicationTarget(platform, target);
    if (!validation.ok) throw new Error(`BLOCKED: invalid ${platform} publication target: ${validation.issues.join("; ")}`);
    targets[platform] = Object.freeze({ ...target });
  }
  return Object.freeze(targets);
}

function effectiveRuntimeTarget(pkg: PostPackage, creds: PlatformCredentials): PublicationTarget {
  if (pkg.platform === "instagram") return {
    accountId: creds.igUserId ?? "",
    apiHost: creds.igGraphHost ?? DEFAULT_IG_API_HOST,
    apiVersion: creds.graphVersion ?? DEFAULT_META_API_VERSION,
  };
  if (pkg.platform === "facebook") return {
    accountId: creds.fbPageId ?? "",
    apiHost: FACEBOOK_API_HOST,
    apiVersion: creds.graphVersion ?? DEFAULT_META_API_VERSION,
  };
  return {
    accountId: creds.gbpAccountId ?? "",
    locationId: creds.gbpLocationId ?? "",
    apiHost: GBP_API_HOST,
    apiVersion: GBP_API_VERSION,
  };
}

/** Verify credentials are scoped to the exact destination approved in JSON. */
export function assertRuntimeTargetMatches(pkg: PostPackage, creds: PlatformCredentials): PublicationTarget {
  assertValidPostPackage(pkg);
  const runtime = effectiveRuntimeTarget(pkg, creds);
  const keys: (keyof PublicationTarget)[] = ["accountId", "locationId", "apiHost", "apiVersion"];
  for (const key of keys) {
    if (runtime[key] !== pkg.target[key]) {
      throw new Error(`BLOCKED: approved ${pkg.platform} publication target ${key} does not match runtime credentials/configuration`);
    }
  }
  return pkg.target;
}
