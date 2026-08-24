/**
 * Native posting provider. Composes the pure request-builders with a thin
 * fetch-based sender and the per-platform publish sequences. Tokens are passed
 * in at call time (credential-bound) — nothing is read from a committed file.
 */

import { withRetry } from "../../../harness/retry.js";
import { assertPublishAllowed, SOCIAL_POST_APPROVAL_SUBJECT } from "../../../harness/hitl.js";
import {
  assertHostedMediaIntegrity,
  canonicalApprovalJson,
} from "../../../harness/state.js";
import {
  PostPackage,
  PlatformCredentials,
  PostingProvider,
  PublicationAuthorization,
  PublicationGuard,
  PublishResult,
  BuiltRequest,
} from "../types.js";
import { matchExactPublicationPackage } from "../integrity.js";
import {
  assertRuntimeTargetMatches,
  assertValidPostPackage,
  assertValidSocialPostSubject,
} from "../validation.js";
import {
  buildGbpLocalPost,
  buildIgCreateContainer,
  buildIgContainerStatus,
  buildIgPublish,
  buildFacebookPost,
} from "./requests.js";

interface HttpError extends Error {
  status?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// IG processes the fetched image asynchronously; publishing before the container
// is FINISHED yields code 9007 / subcode 2207027 ("media is not ready").
const IG_STATUS_MAX_ATTEMPTS = 15; // ~ up to ~37s of processing headroom
const IG_STATUS_POLL_MS = 2500;
const PROVIDER_REQUEST_TIMEOUT_MS = 30_000;

interface IssuedGuardRecord {
  canonicalPackage: string;
}

// A caller-created object with a no-op `beforeMutation` method is not enough.
// Only this module can place a guard in the WeakMap, and every native request
// validates both membership and its exact package binding before invoking it.
const issuedGuards = new WeakMap<PublicationGuard, IssuedGuardRecord>();
// Offline probes may attach a fake transport to one provider instance without
// replacing global fetch. The map and setter remain module-private, so callers
// cannot inject a transport into the sanctioned publication entrypoint.
const providerTransports = new WeakMap<object, typeof fetch>();

/** A still-processing IG container surfaces as code 9007 / subcode 2207027. */
const igMediaNotReady = (err: unknown) => {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("2207027") || msg.includes("9007") || msg.includes("not ready");
};

function issueGuard(pkg: PostPackage, recheck: () => Promise<void>): PublicationGuard {
  const guard = Object.freeze({ beforeMutation: recheck });
  issuedGuards.set(guard, { canonicalPackage: canonicalApprovalJson(pkg) });
  return guard;
}

async function assertPackageMediaIntegrity(pkg: PostPackage): Promise<void> {
  for (const image of pkg.images ?? []) {
    await assertHostedMediaIntegrity(image.url, image.contentSha256);
  }
}

async function assertAuthenticGuard(
  guard: PublicationGuard,
  pkg: PostPackage,
): Promise<void> {
  const record = issuedGuards.get(guard);
  if (!record || record.canonicalPackage !== canonicalApprovalJson(pkg)) {
    throw new Error("BLOCKED: native provider received an unissued or mismatched publication guard");
  }
  await guard.beforeMutation();
}

async function send(
  provider: object,
  req: BuiltRequest,
  token: string,
  guard: PublicationGuard,
  pkg: PostPackage,
): Promise<any> {
  // Authorization is intentionally inside send rather than around withRetry:
  // every provider attempt, including read-only status polls and their retries,
  // must re-read current durable approval state before credentialed I/O.
  await assertAuthenticGuard(guard, pkg);
  const transport = providerTransports.get(provider) ?? globalThis.fetch;
  const res = await transport(req.url, {
    method: req.method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: req.body ? JSON.stringify(req.body) : undefined,
    // A provider redirect would otherwise create another request without a
    // fresh guard check and could replay credentials/content.
    redirect: "error",
    signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
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
  if ((err as Error)?.message?.startsWith("BLOCKED:")) return false;
  const s = (err as HttpError)?.status;
  return s === undefined || s === 429 || (s >= 500 && s < 600);
};

export class NativePostingProvider implements PostingProvider {
  readonly name = "native";

  async publish(pkg: PostPackage, creds: PlatformCredentials, guard: PublicationGuard): Promise<PublishResult> {
    try {
      assertValidPostPackage(pkg);
      switch (pkg.platform) {
        case "gbp":
          return await this.publishGbp(pkg, creds, guard);
        case "instagram":
          return await this.publishInstagram(pkg, creds, guard);
        case "facebook":
          return await this.publishFacebook(pkg, creds, guard);
        default:
          return { platform: pkg.platform, ok: false, error: `unsupported platform: ${pkg.platform}` };
      }
    } catch (err) {
      return { platform: pkg.platform, ok: false, error: (err as Error).message };
    }
  }

  private async publishGbp(
    pkg: PostPackage,
    creds: PlatformCredentials,
    guard: PublicationGuard,
  ): Promise<PublishResult> {
    const token = need(creds.googleAccessToken, "googleAccessToken");
    const req = buildGbpLocalPost(pkg, creds);
    const json = await withRetry(() => send(this, req, token, guard, pkg), { shouldRetry: retryableStatus });
    return { platform: "gbp", ok: true, id: requireProviderPostId(json.name ?? json.id, "GBP") };
  }

  private async publishInstagram(
    pkg: PostPackage,
    creds: PlatformCredentials,
    guard: PublicationGuard,
  ): Promise<PublishResult> {
    const token = need(creds.igAccessToken, "igAccessToken");
    const container = await withRetry(() => send(this, buildIgCreateContainer(pkg, creds), token, guard, pkg), {
      shouldRetry: retryableStatus,
    });
    const containerId = container.id as string;
    if (!containerId) return { platform: "instagram", ok: false, error: "no container id returned" };

    // Wait for IG to finish fetching/processing the image before publishing.
    await this.waitForIgContainer(containerId, creds, token, guard, pkg);

    // Publish; tolerate a transient "not ready" by retrying a few times.
    const published = await withRetry(() => send(this, buildIgPublish(containerId, pkg, creds), token, guard, pkg), {
      shouldRetry: (err) => retryableStatus(err) || igMediaNotReady(err),
      retries: 4,
      baseDelayMs: 2500,
    });
    return { platform: "instagram", ok: true, id: requireProviderPostId(published.id, "Instagram") };
  }

  /** Poll the container's status_code until FINISHED (or fail on ERROR/EXPIRED/timeout). */
  private async waitForIgContainer(
    containerId: string,
    creds: PlatformCredentials,
    token: string,
    guard: PublicationGuard,
    pkg: PostPackage,
  ): Promise<void> {
    for (let attempt = 0; attempt < IG_STATUS_MAX_ATTEMPTS; attempt++) {
      const status = await withRetry(() => send(this, buildIgContainerStatus(containerId, pkg, creds), token, guard, pkg), {
        shouldRetry: retryableStatus,
      });
      const code = status?.status_code as string | undefined;
      if (code === "FINISHED") return;
      if (code === "ERROR" || code === "EXPIRED") {
        throw new Error(`ig container ${code} before publish (container ${containerId})`);
      }
      // IN_PROGRESS (or unknown) → wait and re-check.
      await sleep(IG_STATUS_POLL_MS);
    }
    // Do not mutate after an inconclusive read deadline. A later retry of the
    // approved job may reconcile the container, but this call fails closed.
    throw new Error(`ig container did not reach FINISHED before status deadline (container ${containerId})`);
  }

  private async publishFacebook(
    pkg: PostPackage,
    creds: PlatformCredentials,
    guard: PublicationGuard,
  ): Promise<PublishResult> {
    const token = need(creds.fbPageAccessToken, "fbPageAccessToken");
    const json = await withRetry(() => send(this, buildFacebookPost(pkg, creds), token, guard, pkg), {
      shouldRetry: retryableStatus,
    });
    const id = requireProviderPostId(json.post_id ?? json.id, "Facebook");
    return {
      platform: "facebook",
      ok: true,
      id,
      permalink: id ? `https://www.facebook.com/${id}` : undefined,
    };
  }
}

function requireProviderPostId(value: unknown, platform: string): string {
  if ((typeof value === "string" || typeof value === "number") && String(value).trim() !== "") {
    return String(value);
  }
  throw new Error(`${platform} returned success without a post id`);
}

const defaultProvider = new NativePostingProvider();

/**
 * The only native publication entrypoint. It requires durable approval before
 * issuing a runtime-authentic guard; no caller-supplied provider or guard can
 * replace either step.
 */
export async function publishNativeApprovedPackage(
  pkg: PostPackage,
  authorization: PublicationAuthorization,
  creds: PlatformCredentials,
): Promise<PublishResult> {
  if (
    !authorization
    || typeof authorization !== "object"
    || typeof authorization.approvalId !== "string"
    || !Number.isSafeInteger(authorization.packageIndex)
    || authorization.packageIndex < 0
  ) {
    throw new Error("BLOCKED: posting requires an approval id and non-negative package index");
  }

  const approved = await assertPublishAllowed<unknown[]>(authorization.approvalId, SOCIAL_POST_APPROVAL_SUBJECT);
  assertValidSocialPostSubject(approved.subject);
  const stored = matchExactPublicationPackage(approved.subject, pkg, authorization.packageIndex);
  // Validate the immutable stored object, not merely caller input, before any
  // guard can be issued or provider request can be constructed.
  assertValidPostPackage(stored);
  const guard = issueGuard(stored, async () => {
    const current = await assertPublishAllowed<unknown[]>(authorization.approvalId, SOCIAL_POST_APPROVAL_SUBJECT);
    assertValidSocialPostSubject(current.subject);
    const currentStored = matchExactPublicationPackage(current.subject, stored, authorization.packageIndex);
    assertRuntimeTargetMatches(currentStored, creds);
    // This runs inside every provider attempt, including read-only polls,
    // retries, and the final step of a multi-request publish. The database row,
    // content-addressed URL, approved digest, and current bytes must all agree.
    await assertPackageMediaIntegrity(currentStored);
  });
  return defaultProvider.publish(deepFreeze(stored), creds, guard);
}

/**
 * Narrow offline invariant probe. It does not accept content/credentials and
 * cannot publish; it only proves that an issued guard rechecks changing state.
 */
export async function issuedGuardRejectsRevocationForSelfTest(): Promise<boolean> {
  const pkg: PostPackage = {
    platform: "facebook",
    target: { accountId: "1", apiHost: "graph.facebook.com", apiVersion: "v25.0" },
    text: "self-test",
  };
  let live = true;
  const guard = issueGuard(pkg, async () => {
    if (!live) throw new Error("BLOCKED: self-test approval revoked");
  });
  await assertAuthenticGuard(guard, pkg);
  live = false;
  try {
    await assertAuthenticGuard(guard, pkg);
    return false;
  } catch (err) {
    return (err as Error).message.startsWith("BLOCKED:");
  }
}

/** Fixed-input probe proving direct callers cannot forge a native guard. */
export async function forgedGuardRejectedBeforeFetchForSelfTest(): Promise<{
  blocked: boolean;
  beforeFetch: boolean;
}> {
  const provider = new NativePostingProvider();
  let fetches = 0;
  providerTransports.set(provider, (async () => {
    fetches++;
    throw new Error("self-test transport must not run for a forged guard");
  }) as typeof fetch);
  const result = await provider.publish(
    {
      platform: "facebook",
      target: { accountId: "1", apiHost: "graph.facebook.com", apiVersion: "v25.0" },
      text: "must not publish",
    },
    { fbPageId: "1", fbPageAccessToken: "test" },
    { beforeMutation: async () => {} },
  );
  return {
    blocked: !result.ok && result.error?.includes("unissued or mismatched") === true,
    beforeFetch: fetches === 0,
  };
}

/** Fixed-input, mocked-transport probe for mandatory provider post identities. */
export async function missingProviderIdsRejectedForSelfTest(): Promise<{
  gbp: boolean;
  instagram: boolean;
  facebook: boolean;
  redirects: boolean;
  igGuardsEveryAttempt: boolean;
}> {
  const response = (body: unknown): Response => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  }) as Response;
  {
    let redirectsBlocked = true;
    const provider = new NativePostingProvider();
    providerTransports.set(provider, (async (_input, init) => {
      redirectsBlocked &&= init?.redirect === "error";
      return response({});
    }) as typeof fetch);
    const gbpPkg: PostPackage = {
      platform: "gbp",
      target: {
        accountId: "1",
        locationId: "2",
        apiHost: "mybusiness.googleapis.com",
        apiVersion: "v4",
      },
      text: "self-test",
      languageCode: "en-US",
      gbp: { topicType: "STANDARD" },
    };
    const gbp = await provider.publish(
      gbpPkg,
      { gbpAccountId: "1", gbpLocationId: "2", googleAccessToken: "test" },
      issueGuard(gbpPkg, async () => {}),
    );

    const fbPkg: PostPackage = {
      platform: "facebook",
      target: { accountId: "1", apiHost: "graph.facebook.com", apiVersion: "v25.0" },
      text: "self-test",
    };
    const facebook = await provider.publish(
      fbPkg,
      { fbPageId: "1", fbPageAccessToken: "test" },
      issueGuard(fbPkg, async () => {}),
    );

    let igStep = 0;
    let igGuardCalls = 0;
    providerTransports.set(provider, (async (_input, init) => {
      redirectsBlocked &&= init?.redirect === "error";
      igStep++;
      if (igStep === 1) return response({ id: "container-1" });
      if (igStep === 2) return response({ status_code: "FINISHED" });
      return response({});
    }) as typeof fetch);
    const igPkg: PostPackage = {
      platform: "instagram",
      target: { accountId: "1", apiHost: "graph.instagram.com", apiVersion: "v25.0" },
      text: "self-test",
      images: [{
        url: `https://gcd.example/media/00000000-0000-4000-8000-000000000005-${"0".repeat(64)}.jpg`,
        contentSha256: "0".repeat(64),
        altText: "Self-test image",
        aiGenerated: true,
      }],
    };
    const instagram = await provider.publish(
      igPkg,
      { igUserId: "1", igAccessToken: "test" },
      issueGuard(igPkg, async () => { igGuardCalls++; }),
    );

    return {
      gbp: !gbp.ok && gbp.error?.includes("without a post id") === true,
      instagram: !instagram.ok && instagram.error?.includes("without a post id") === true,
      facebook: !facebook.ok && facebook.error?.includes("without a post id") === true,
      redirects: redirectsBlocked,
      igGuardsEveryAttempt: igGuardCalls === 3,
    };
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function need(value: string | undefined, name: string): string {
  if (!value) throw new Error(`missing credential: ${name}`);
  return value;
}
