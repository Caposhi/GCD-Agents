/**
 * Pure request-builders for the three native platform APIs. No network, no
 * tokens baked in — they return BuiltRequest data so the request shape can be
 * unit-tested offline (see selftest.ts). Endpoints/fields follow the official
 * Google Business Profile v4, Instagram Graph, and Facebook Pages docs.
 */

import { BuiltRequest, PostPackage, PlatformCredentials } from "../types.js";

const DEFAULT_GRAPH = "v25.0";

function requireCred<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === "") {
    throw new Error(`missing credential/field: ${name}`);
  }
  return value;
}

// ---------- Google Business Profile ----------

/** POST .../v4/accounts/{acct}/locations/{loc}/localPosts */
export function buildGbpLocalPost(pkg: PostPackage, creds: PlatformCredentials): BuiltRequest {
  const acct = requireCred(creds.gbpAccountId, "gbpAccountId");
  const loc = requireCred(creds.gbpLocationId, "gbpLocationId");

  const body: Record<string, unknown> = {
    languageCode: pkg.languageCode ?? "en-US",
    summary: pkg.text,
    topicType: pkg.gbp?.topicType ?? "STANDARD",
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
    url: `https://mybusiness.googleapis.com/v4/accounts/${acct}/locations/${loc}/localPosts`,
    body,
    step: "gbp:localPost",
  };
}

// ---------- Instagram (two-step: container -> publish) ----------

/** Step 1: POST /<IG_ID>/media (single image). */
export function buildIgCreateContainer(pkg: PostPackage, creds: PlatformCredentials): BuiltRequest {
  const ig = requireCred(creds.igUserId, "igUserId");
  const ver = creds.graphVersion ?? DEFAULT_GRAPH;
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
    url: `https://graph.facebook.com/${ver}/${ig}/media`,
    body,
    step: "ig:createContainer",
  };
}

/** Step 2: POST /<IG_ID>/media_publish with the container id. */
export function buildIgPublish(containerId: string, creds: PlatformCredentials): BuiltRequest {
  const ig = requireCred(creds.igUserId, "igUserId");
  const ver = creds.graphVersion ?? DEFAULT_GRAPH;
  return {
    method: "POST",
    url: `https://graph.facebook.com/${ver}/${ig}/media_publish`,
    body: { creation_id: requireCred(containerId, "containerId") },
    step: "ig:publish",
  };
}

// ---------- Facebook Page ----------

/** POST /<PAGE_ID>/feed (text/link) or /<PAGE_ID>/photos (single image). */
export function buildFacebookPost(pkg: PostPackage, creds: PlatformCredentials): BuiltRequest {
  const page = requireCred(creds.fbPageId, "fbPageId");
  const ver = creds.graphVersion ?? DEFAULT_GRAPH;
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
    url: `https://graph.facebook.com/${ver}/${page}/${hasImage ? "photos" : "feed"}`,
    body,
    step: hasImage ? "fb:photos" : "fb:feed",
  };
}
