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

/**
 * What the provider actually reported about the asset it produced.
 *
 * Every field is optional on purpose. A live 2026-08-27 Ideogram v3 response
 * carried only `url`, `content_type`, `file_name` and `file_size` — no width or
 * height at all — so nothing here may be treated as guaranteed. These values
 * are diagnostic context; the downloaded byte header remains the sole authority
 * on dimensions and format, and a missing field is never an error.
 */
export interface ProviderImageMetadata {
  contentType?: string;
  fileName?: string;
  fileSize?: number;
  /** Present only when the provider volunteers it; frequently absent. */
  width?: number;
  height?: number;
}

export interface ImageResult {
  ok: boolean;
  url?: string; // hosted image URL returned by the provider
  model?: string;
  error?: string;
  /** Best-effort provider-reported metadata; never authoritative. */
  metadata?: ProviderImageMetadata;
}

export interface ImageProvider {
  readonly name: string;
  generate(req: ImageRequest, apiKey: string): Promise<ImageResult>;
}
