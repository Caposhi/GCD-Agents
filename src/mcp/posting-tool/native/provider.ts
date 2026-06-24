/**
 * Native posting provider. Composes the pure request-builders with a thin
 * fetch-based sender and the per-platform publish sequences. Tokens are passed
 * in at call time (credential-bound) — nothing is read from a committed file.
 */

import { withRetry } from "../../../harness/retry.js";
import {
  PostPackage,
  PlatformCredentials,
  PostingProvider,
  PublishResult,
  BuiltRequest,
} from "../types.js";
import {
  buildGbpLocalPost,
  buildIgCreateContainer,
  buildIgPublish,
  buildFacebookPost,
} from "./requests.js";

interface HttpError extends Error {
  status?: number;
}

async function send(req: BuiltRequest, token: string): Promise<any> {
  const res = await fetch(req.url, {
    method: req.method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: req.body ? JSON.stringify(req.body) : undefined,
  });
  const text = await res.text();
  let json: any = undefined;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err: HttpError = new Error(`${req.step ?? req.method} -> ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

const retryableStatus = (err: unknown) => {
  const s = (err as HttpError)?.status;
  return s === undefined || s === 429 || (s >= 500 && s < 600);
};

export class NativePostingProvider implements PostingProvider {
  readonly name = "native";

  async publish(pkg: PostPackage, creds: PlatformCredentials): Promise<PublishResult> {
    try {
      switch (pkg.platform) {
        case "gbp":
          return await this.publishGbp(pkg, creds);
        case "instagram":
          return await this.publishInstagram(pkg, creds);
        case "facebook":
          return await this.publishFacebook(pkg, creds);
        default:
          return { platform: pkg.platform, ok: false, error: `unsupported platform: ${pkg.platform}` };
      }
    } catch (err) {
      return { platform: pkg.platform, ok: false, error: (err as Error).message };
    }
  }

  private async publishGbp(pkg: PostPackage, creds: PlatformCredentials): Promise<PublishResult> {
    const token = need(creds.googleAccessToken, "googleAccessToken");
    const req = buildGbpLocalPost(pkg, creds);
    const json = await withRetry(() => send(req, token), { shouldRetry: retryableStatus });
    return { platform: "gbp", ok: true, id: json.name ?? json.id };
  }

  private async publishInstagram(pkg: PostPackage, creds: PlatformCredentials): Promise<PublishResult> {
    const token = need(creds.igAccessToken, "igAccessToken");
    const container = await withRetry(() => send(buildIgCreateContainer(pkg, creds), token), {
      shouldRetry: retryableStatus,
    });
    const containerId = container.id as string;
    if (!containerId) return { platform: "instagram", ok: false, error: "no container id returned" };
    const published = await withRetry(() => send(buildIgPublish(containerId, creds), token), {
      shouldRetry: retryableStatus,
    });
    return { platform: "instagram", ok: true, id: published.id };
  }

  private async publishFacebook(pkg: PostPackage, creds: PlatformCredentials): Promise<PublishResult> {
    const token = need(creds.fbPageAccessToken, "fbPageAccessToken");
    const json = await withRetry(() => send(buildFacebookPost(pkg, creds), token), {
      shouldRetry: retryableStatus,
    });
    const id = (json.post_id ?? json.id) as string | undefined;
    return {
      platform: "facebook",
      ok: true,
      id,
      permalink: id ? `https://www.facebook.com/${id}` : undefined,
    };
  }
}

function need(value: string | undefined, name: string): string {
  if (!value) throw new Error(`missing credential: ${name}`);
  return value;
}
