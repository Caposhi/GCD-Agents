/**
 * Pure request-builders for the three native platform APIs. No network, no
 * tokens baked in — they return BuiltRequest data so the request shape can be
 * unit-tested offline (see selftest.ts). Endpoints/fields follow the official
 * Google Business Profile v4, Instagram Graph, and Facebook Pages docs.
 */

import { BuiltRequest, PostPackage, PlatformCredentials } from "../types.js";
import { assertRuntimeTargetMatches } from "../validation.js";

function requireCred<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === "") {
    throw new Error(`missing credential/field: ${name}`);
  }
  return value;
}

// ---------- Google Business Profile ----------

/** POST .../v4/accounts/{acct}/locations/{loc}/localPosts */
export function buildGbpLocalPost(pkg: PostPackage, creds: PlatformCredentials): BuiltRequest {
  const target = assertRuntimeTargetMatches(pkg, creds);
  const acct = encodeURIComponent(target.accountId);
  const loc = encodeURIComponent(requireCred(target.locationId, "target.locationId"));

  const body: Record<string, unknown> = {
    languageCode: pkg.languageCode,
    summary: pkg.text,
    topicType: pkg.gbp!.topicType,
  };
  if (pkg.gbp?.callToAction) {
    body.callToAction = {
      actionType: pkg.gbp.callToAction.actionType,
      url: pkg.gbp.callToAction.url,
    };
  }
  if (pkg.images && pkg.images.length > 0) {
    // GBP localPosts take PHOTO media by public sourceUrl.
    body.media = pkg.images.map((img) => ({ mediaFormat: "PHOTO", sourceUrl: img.url }));
  }
  return {
    method: "POST",
    url: `https://${target.apiHost}/${target.apiVersion}/accounts/${acct}/locations/${loc}/localPosts`,
    body,
    step: "gbp:localPost",
  };
}

// ---------- Instagram (two-step: container -> publish) ----------

/** Step 1: POST /<IG_ID>/media (single image). */
export function buildIgCreateContainer(pkg: PostPackage, creds: PlatformCredentials): BuiltRequest {
  const target = assertRuntimeTargetMatches(pkg, creds);
  const ig = encodeURIComponent(target.accountId);
  const img = pkg.images?.[0];
  requireCred(img, "images[0] (Instagram requires a public JPEG image)");

  const body: Record<string, unknown> = {
    image_url: img!.url, // must be public + JPEG at publish time
    caption: pkg.text,
  };
  if (img!.altText) body.alt_text = img!.altText;
  if (img!.aiGenerated) body.is_ai_generated = true; // honesty disclosure
  return {
    method: "POST",
    url: `https://${target.apiHost}/${target.apiVersion}/${ig}/media`,
    body,
    step: "ig:createContainer",
  };
}

/** Step 1.5: GET /<container-id>?fields=status_code — poll until FINISHED before publishing. */
export function buildIgContainerStatus(containerId: string, pkg: PostPackage, creds: PlatformCredentials): BuiltRequest {
  const target = assertRuntimeTargetMatches(pkg, creds);
  return {
    method: "GET",
    url: `https://${target.apiHost}/${target.apiVersion}/${encodeURIComponent(requireCred(containerId, "containerId"))}?fields=status_code`,
    step: "ig:status",
  };
}

/** Step 2: POST /<IG_ID>/media_publish with the container id. */
export function buildIgPublish(containerId: string, pkg: PostPackage, creds: PlatformCredentials): BuiltRequest {
  const target = assertRuntimeTargetMatches(pkg, creds);
  const ig = encodeURIComponent(target.accountId);
  return {
    method: "POST",
    url: `https://${target.apiHost}/${target.apiVersion}/${ig}/media_publish`,
    body: { creation_id: requireCred(containerId, "containerId") },
    step: "ig:publish",
  };
}

// ---------- Facebook Page ----------

/** POST /<PAGE_ID>/feed (text/link) or /<PAGE_ID>/photos (single image). */
export function buildFacebookPost(pkg: PostPackage, creds: PlatformCredentials): BuiltRequest {
  const target = assertRuntimeTargetMatches(pkg, creds);
  const page = encodeURIComponent(target.accountId);
  const hasImage = !!pkg.images?.[0];

  const body: Record<string, unknown> = {};
  if (hasImage) {
    body.url = pkg.images![0]!.url;
    if (pkg.text) body.caption = pkg.text;
  } else {
    body.message = pkg.text;
    if (pkg.facebook?.link) body.link = pkg.facebook.link;
  }
  if (pkg.facebook?.scheduledPublishTime) {
    body.published = false;
    body.scheduled_publish_time = pkg.facebook.scheduledPublishTime;
  }
  return {
    method: "POST",
    url: `https://${target.apiHost}/${target.apiVersion}/${page}/${hasImage ? "photos" : "feed"}`,
    body,
    step: hasImage ? "fb:photos" : "fb:feed",
  };
}
