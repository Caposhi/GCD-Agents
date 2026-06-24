/**
 * Posting tool entry point. The ONLY sanctioned publish path. Enforces the
 * approval gate before any provider call — in Autonomy Phase A this throws
 * unless a human approval is recorded for THIS package (see harness/hitl.ts).
 *
 * No credentials are read here; the caller (posting agent wiring) supplies
 * tokens at runtime. Default provider is native (GBP/IG/FB direct APIs).
 */

import { assertPublishAllowed } from "../../harness/hitl.js";
import { NativePostingProvider } from "./native/provider.js";
import { PostPackage, PlatformCredentials, PostingProvider, PublishResult } from "./types.js";

export * from "./types.js";
export { NativePostingProvider } from "./native/provider.js";
export { buildGbpLocalPost, buildIgCreateContainer, buildIgPublish, buildFacebookPost } from "./native/requests.js";

const defaultProvider: PostingProvider = new NativePostingProvider();

/**
 * Publish an approved package. `approved` MUST be the result of a recorded human
 * approval for this exact package. The gate is checked before anything else.
 */
export async function publishApprovedPackage(
  pkg: PostPackage,
  approved: boolean,
  creds: PlatformCredentials,
  provider: PostingProvider = defaultProvider,
): Promise<PublishResult> {
  // Guardrail: cannot proceed without explicit human approval in Phase A.
  assertPublishAllowed(approved);
  return provider.publish(pkg, creds);
}
