/**
 * fal.ai model routing + pure request builder. Routes by content type:
 *   text-graphic  → Ideogram (best legible in-image text)
 *   photoreal     → Flux (top photorealism)
 *   graphic-vector→ Recraft (logos/flat brand design)
 *
 * Model slugs are fal.ai catalog ids — verify against https://fal.ai/models
 * before go-live; they are isolated here so a slug change is one edit.
 */

import { BuiltImageRequest, ImageContentType, ImageRequest } from "../types.js";

export const MODEL_ROUTES: Record<ImageContentType, string> = {
  "text-graphic": "fal-ai/ideogram/v3",
  photoreal: "fal-ai/flux-pro/v1.1",
  "graphic-vector": "fal-ai/recraft/v3/text-to-image",
};

export function modelFor(contentType: ImageContentType): string {
  const model = MODEL_ROUTES[contentType];
  if (!model) throw new Error(`no model route for content type: ${contentType}`);
  return model;
}

/**
 * Per-model extra body params. Kept here so model-specific knobs don't leak into
 * the generic builder. Ideogram v3's QUALITY tier yields richer, more photoreal
 * compositions (vs the default BALANCED) — worth it for hero brand graphics.
 */
const MODEL_EXTRAS: Record<ImageContentType, Record<string, unknown>> = {
  "text-graphic": { rendering_speed: "QUALITY" },
  photoreal: {},
  "graphic-vector": {},
};

/**
 * Provider-friendly SOURCE render size for each approved publication profile.
 *
 * The request we send is a *composition* request, not a publication-pixel
 * request. fal normalizes `image_size` to its own resolution buckets, and a
 * live 2026-08-27 diagnostic showed the requested value decides whether the
 * aspect survives at all:
 *
 *   requested 1080x1350 (production) -> returned 1024x1024  — WRONG aspect (1:1)
 *   requested 1024x1280 (diagnostic) -> returned  896x1120  — correct 4:5
 *
 * So asking for a bucket-friendly size is what makes the composition reliable;
 * the application then scales the provider's native render to the exact
 * publication profile. Every entry must have EXACTLY its target's ratio —
 * enforced by selftest — because the pipeline refuses any non-uniform resize.
 *
 * Only the 4:5 entry is proven against the live provider. The others are exact
 * by arithmetic and fail closed if the provider composes something else.
 */
const SOURCE_RENDER_SIZES: Record<string, { width: number; height: number }> = {
  "1080x1350": { width: 1_024, height: 1_280 }, // 4:5   — live-proven
  "1080x1080": { width: 1_024, height: 1_024 }, // 1:1
  "1200x900": { width: 1_024, height: 768 }, //    4:3
  "1200x630": { width: 960, height: 504 }, //     40:21
};

/**
 * Source size to request for a target publication profile.
 *
 * Falls back to the target itself when a profile has no reviewed mapping: the
 * aspect is then correct by construction, and an unexpected provider
 * composition still fails closed downstream rather than being cropped.
 */
export function sourceRenderSizeFor(width: number, height: number): { width: number; height: number } {
  return SOURCE_RENDER_SIZES[`${width}x${height}`] ?? { width, height };
}

/** The reviewed mapping, exposed for offline ratio assertions. */
export function sourceRenderSizeTable(): Record<string, { width: number; height: number }> {
  return { ...SOURCE_RENDER_SIZES };
}

/** fal sync endpoint: POST https://fal.run/<model> with { prompt, image_size }. */
export function buildFalRequest(req: ImageRequest): BuiltImageRequest {
  if (!req.prompt) throw new Error("prompt is required");
  if (!req.width || !req.height) throw new Error("width and height are required");
  const model = modelFor(req.contentType);
  const source = sourceRenderSizeFor(req.width, req.height);
  return {
    url: `https://fal.run/${model}`,
    model,
    body: {
      prompt: req.prompt,
      // Documented as ImageSize | Enum; the custom object is valid and accepted.
      // fal still normalizes it to its own bucket, which is why this is the
      // composition request and not the publication size.
      image_size: { width: source.width, height: source.height },
      num_images: 1,
      // Advisory only: the live diagnostic returned image/png despite this.
      // Final publication encoding is enforced application-side.
      output_format: "jpeg",
      ...MODEL_EXTRAS[req.contentType],
    },
  };
}
