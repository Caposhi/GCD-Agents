/**
 * Posting tool entry point. The ONLY sanctioned publish path. Enforces the
 * approval gate before any provider call — in Autonomy Phase A this throws
 * unless a human approval is recorded for THIS package (see harness/hitl.ts).
 *
 * No credentials are read here; the caller (posting agent wiring) supplies
 * tokens at runtime. Default provider is native (GBP/IG/FB direct APIs).
 */

import { publishNativeApprovedPackage } from "./native/provider.js";
import {
  PostPackage,
  PlatformCredentials,
  PublicationAuthorization,
  PublishResult,
} from "./types.js";

export * from "./types.js";
export { NativePostingProvider } from "./native/provider.js";
export { buildGbpLocalPost, buildIgCreateContainer, buildIgContainerStatus, buildIgPublish, buildFacebookPost } from "./native/requests.js";
export { matchExactPublicationPackage } from "./integrity.js";
export {
  assertRuntimeTargetMatches,
  assertValidPostPackage,
  assertValidSocialPostSubject,
  mediaUrlMatchesContentSha256,
  publicationTargetsFromEnv,
  validatePostPackage,
  validatePublicationTarget,
  validateSocialPostSubject,
} from "./validation.js";

/**
 * Publish one exact item from an approved multi-platform subject. The caller's
 * package is treated only as an expected value: the provider receives the
 * immutable canonical copy reloaded from current approval state. A fabricated
 * boolean, approval for another payload, expired/revoked approval, changed
 * package, or wrong index is rejected before provider IO.
 */
export async function publishApprovedPackage(
  pkg: PostPackage,
  authorization: PublicationAuthorization,
  creds: PlatformCredentials,
): Promise<PublishResult> {
  return publishNativeApprovedPackage(pkg, authorization, creds);
}
