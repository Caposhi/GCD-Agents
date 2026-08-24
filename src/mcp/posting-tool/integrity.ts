/** Pure package equality checks. These do not grant publication authority. */

import { canonicalApprovalJson } from "../../harness/state.js";
import type { PostPackage } from "./types.js";
import { assertValidPostPackage, assertValidSocialPostSubject } from "./validation.js";

/**
 * Match one expected package to an exact canonical item in an already-resolved
 * subject. This is deliberately pure: it is not an approval or authorization
 * check and cannot call a provider.
 */
export function matchExactPublicationPackage(
  approvedSubject: unknown,
  expected: PostPackage,
  packageIndex: number,
): PostPackage {
  // A valid selected item cannot launder malformed or duplicate siblings
  // through one human decision. The complete hash-bound subject must pass.
  assertValidSocialPostSubject(approvedSubject);
  if (!Number.isSafeInteger(packageIndex) || packageIndex < 0) {
    throw new Error("BLOCKED: publication package index is invalid");
  }
  const stored = approvedSubject[packageIndex];
  if (!stored) {
    throw new Error("BLOCKED: approved publication package is missing or invalid");
  }
  // Unknown/ignored fields and unbound provider destinations are invalid even
  // if a historical approval subject happens to contain them.
  assertValidPostPackage(stored);
  assertValidPostPackage(expected);
  if (canonicalApprovalJson(expected) !== canonicalApprovalJson(stored)) {
    throw new Error("BLOCKED: publication package does not match the exact approved payload");
  }
  return JSON.parse(canonicalApprovalJson(stored)) as PostPackage;
}
