/**
 * fal.ai image provider. Composes the pure request builder with a thin
 * fetch-based sender. The API key is passed at call time (credential-bound,
 * never read from a committed file).
 */

import { withRetry } from "../../../harness/retry.js";
import { ImageProvider, ImageRequest, ImageResult } from "../types.js";
import { buildFalRequest } from "./models.js";

interface HttpError extends Error {
  status?: number;
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
      const url = (json?.images?.[0]?.url ?? json?.image?.url ?? json?.data?.images?.[0]?.url) as string | undefined;
      if (!url) return { ok: false, model: built.model, error: `no image url in fal response: ${JSON.stringify(json).slice(0, 200)}` };
      return { ok: true, url, model: built.model };
    } catch (err) {
      return { ok: false, model: built.model, error: (err as Error).message };
    }
  }
}
