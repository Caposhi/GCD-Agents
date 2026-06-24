/**
 * Image-tool types. Provider-agnostic (like the posting tool) so fal.ai can be
 * swapped for direct model APIs later without changing the agents.
 */

export type ImageContentType =
  | "text-graphic" // offer cards, tips with words, CTA graphics → legible in-image text
  | "photoreal" // shop, cars, hands-on service
  | "graphic-vector"; // flat branded graphics, logos, icons

export interface ImageRequest {
  contentType: ImageContentType;
  prompt: string;
  width: number; // px (see platform-specs / image-brief)
  height: number;
  /** Self-disclose AI generation downstream (IG is_ai_generated, alt text). */
  aiGenerated?: boolean;
}

/** A built HTTP request — pure data, so routing/shape is unit-testable offline. */
export interface BuiltImageRequest {
  url: string;
  model: string;
  body: Record<string, unknown>;
}

export interface ImageResult {
  ok: boolean;
  url?: string; // hosted image URL returned by the provider
  model?: string;
  error?: string;
}

export interface ImageProvider {
  readonly name: string;
  generate(req: ImageRequest, apiKey: string): Promise<ImageResult>;
}
