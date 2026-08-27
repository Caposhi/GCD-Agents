/**
 * fal.ai image provider. Composes the pure request builder with a thin
 * fetch-based sender. The API key is passed at call time (credential-bound,
 * never read from a committed file).
 */

import { withRetry } from "../../../harness/retry.js";
import { ImageProvider, ImageRequest, ImageResult, ProviderImageMetadata } from "../types.js";
import { buildFalRequest } from "./models.js";

/**
 * Keep whatever the provider volunteered, and require none of it.
 *
 * The observed Ideogram v3 asset carries url/content_type/file_name/file_size
 * and omits width/height entirely. Absent fields stay undefined rather than
 * failing generation; the downloaded header decides the real dimensions.
 */
export function providerMetadata(asset: any): ProviderImageMetadata | undefined {
  if (!asset || typeof asset !== "object") return undefined;
  const numeric = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
  const text = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;
  const metadata: ProviderImageMetadata = {
    contentType: text(asset.content_type ?? asset.contentType),
    fileName: text(asset.file_name ?? asset.fileName),
    fileSize: numeric(asset.file_size ?? asset.fileSize),
    width: numeric(asset.width),
    height: numeric(asset.height),
  };
  return Object.values(metadata).some((v) => v !== undefined) ? metadata : undefined;
}

interface HttpError extends Error {
  status?: number;
}
const FAL_REDIRECT_POLICY = "error" as const;

/** Fixed-input offline probe for the credential-bearing request policy. */
export function falRedirectPolicyForSelfTest(): "error" {
  return FAL_REDIRECT_POLICY;
}

const retryableStatus = (err: unknown) => {
  const s = (err as HttpError)?.status;
  return s === undefined || s === 429 || (s >= 500 && s < 600);
};

export class FalImageProvider implements ImageProvider {
  readonly name = "fal";

  async generate(req: ImageRequest, apiKey: string): Promise<ImageResult> {
    if (!apiKey) return { ok: false, error: "missing IMAGEGEN_API_KEY (fal key)" };
    let built;
    try {
      built = buildFalRequest(req);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    try {
      const json = await withRetry(
        async () => {
          const res = await fetch(built.url, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Key ${apiKey}` },
            body: JSON.stringify(built.body),
            redirect: FAL_REDIRECT_POLICY,
            signal: AbortSignal.timeout(120_000),
          });
          const text = await res.text();
          if (!res.ok) {
            const e: HttpError = new Error(`fal ${built.model} -> ${res.status}: ${text.slice(0, 300)}`);
            e.status = res.status;
            throw e;
          }
          return text ? JSON.parse(text) : {};
        },
        { shouldRetry: retryableStatus },
      );
      // fal sync responses vary slightly by model; check the common shapes.
      const asset = json?.images?.[0] ?? json?.image ?? json?.data?.images?.[0];
      const url = asset?.url as string | undefined;
      if (!url) return { ok: false, model: built.model, error: `no image url in fal response: ${JSON.stringify(json).slice(0, 200)}` };
      return { ok: true, url, model: built.model, metadata: providerMetadata(asset) };
    } catch (err) {
      return { ok: false, model: built.model, error: (err as Error).message };
    }
  }
}
