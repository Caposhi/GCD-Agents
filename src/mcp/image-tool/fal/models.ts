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

/** fal sync endpoint: POST https://fal.run/<model> with { prompt, image_size }. */
export function buildFalRequest(req: ImageRequest): BuiltImageRequest {
  if (!req.prompt) throw new Error("prompt is required");
  if (!req.width || !req.height) throw new Error("width and height are required");
  const model = modelFor(req.contentType);
  return {
    url: `https://fal.run/${model}`,
    model,
    body: {
      prompt: req.prompt,
      image_size: { width: req.width, height: req.height },
      num_images: 1,
      // Instagram only accepts JPEG; request it so the same asset works on IG + FB.
      output_format: "jpeg",
      ...MODEL_EXTRAS[req.contentType],
    },
  };
}
