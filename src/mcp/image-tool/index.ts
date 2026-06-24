/**
 * Image-tool entry point. Generates one on-brand image via the configured
 * provider (default fal.ai, routed by content type). No credentials read here;
 * the caller (image subagent wiring) supplies the key at runtime.
 *
 * Prompts must already carry brand guidance (palette, logo rules) from the
 * `image-brief` skill + `assets/brand/brand-tokens.json`. This tool executes;
 * it does not author prompts.
 */

import { FalImageProvider } from "./fal/provider.js";
import { ImageProvider, ImageRequest, ImageResult } from "./types.js";

export * from "./types.js";
export { FalImageProvider } from "./fal/provider.js";
export { MODEL_ROUTES, modelFor, buildFalRequest } from "./fal/models.js";

const defaultProvider: ImageProvider = new FalImageProvider();

export async function generateImage(
  req: ImageRequest,
  apiKey: string,
  provider: ImageProvider = defaultProvider,
): Promise<ImageResult> {
  return provider.generate(req, apiKey);
}
