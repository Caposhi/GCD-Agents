/** Offline adversarial checks for the Phase-0A HTTP boundary helpers. */

import { PassThrough, Readable } from "node:stream";
import {
  authorizeSharedSecret,
  BoundedRateLimiter,
  isAllowedCredentialEndpoint,
  isJsonContentType,
  MAX_TRIGGER_GOAL_CHARS,
  OperationTimeoutError,
  parseMediaPath,
  parseTriggerBody,
  readBoundedBody,
  RequestBodyError,
  withOperationTimeout,
} from "./security.js";
import { renderApprovalReview } from "./approvalReview.js";
import { hashApprovalSubject } from "../harness/state.js";
import type { PostPackage } from "../mcp/posting-tool/types.js";

let failures = 0;
function check(name: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) failures += 1;
}

function authStatus(result: ReturnType<typeof authorizeSharedSecret>): number | undefined {
  return result.ok ? undefined : result.status;
}

function triggerErrorCode(result: ReturnType<typeof parseTriggerBody>): string | undefined {
  return result.ok ? undefined : result.code;
}

async function bodyErrorCode(promise: Promise<string>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return err instanceof RequestBodyError ? err.code : "unexpected";
  }
}

async function run(): Promise<void> {
  // Fail-closed shared-secret authentication. Query-string credentials never
  // enter this API and therefore behave exactly like a missing credential.
  check("auth fails closed when secret is unset", authStatus(authorizeSharedSecret(undefined, {})) === 503);
  check("auth rejects missing credential", authStatus(authorizeSharedSecret("secret", {})) === 401);
  check(
    "auth accepts bearer credential",
    authorizeSharedSecret("secret", { authorization: "Bearer secret" }).ok,
  );
  check(
    "auth accepts x-console-token credential",
    authorizeSharedSecret("secret", { sharedToken: "secret" }).ok,
  );
  check(
    "auth accepts matching duplicate credentials",
    authorizeSharedSecret("secret", { authorization: "Bearer secret", sharedToken: "secret" }).ok,
  );
  check(
    "auth rejects conflicting credentials",
    !authorizeSharedSecret("secret", { authorization: "Bearer secret", sharedToken: "other" }).ok,
  );
  check(
    "auth rejects malformed bearer scheme",
    !authorizeSharedSecret("secret", { authorization: "Basic secret" }).ok,
  );
  check(
    "auth rejects duplicate header arrays",
    !authorizeSharedSecret("secret", { sharedToken: ["secret", "secret"] }).ok,
  );

  // Narrow trigger schema: only a bounded, non-empty goal is accepted.
  const valid = parseTriggerBody('{"goal":"  Check brakes  "}');
  check("trigger accepts and trims goal", valid.ok && valid.brief.goal === "Check brakes");
  check("trigger rejects malformed JSON", triggerErrorCode(parseTriggerBody("{")) === "invalid_json");
  check("trigger rejects arrays", triggerErrorCode(parseTriggerBody('[]')) === "invalid_shape");
  check("trigger rejects null", triggerErrorCode(parseTriggerBody("null")) === "invalid_shape");
  check("trigger rejects missing goal", triggerErrorCode(parseTriggerBody('{}')) === "invalid_goal");
  check("trigger rejects non-string goal", triggerErrorCode(parseTriggerBody('{"goal":7}')) === "invalid_goal");
  check("trigger rejects blank goal", triggerErrorCode(parseTriggerBody('{"goal":"  "}')) === "invalid_goal");
  check(
    "trigger rejects approvedFacts override",
    triggerErrorCode(parseTriggerBody('{"goal":"x","approvedFacts":{"hours":"always"}}')) === "unexpected_fields",
  );
  check(
    "trigger rejects every unknown field",
    triggerErrorCode(parseTriggerBody('{"goal":"x","raw":"extra"}')) === "unexpected_fields",
  );
  check(
    "trigger accepts exact goal limit",
    parseTriggerBody(JSON.stringify({ goal: "x".repeat(MAX_TRIGGER_GOAL_CHARS) })).ok,
  );
  check(
    "trigger rejects oversized goal",
    triggerErrorCode(parseTriggerBody(JSON.stringify({ goal: "x".repeat(MAX_TRIGGER_GOAL_CHARS + 1) }))) === "goal_too_long",
  );
  check("content type accepts JSON", isJsonContentType("application/json"));
  check("content type accepts JSON charset", isJsonContentType("Application/JSON; charset=utf-8"));
  check("content type rejects text", !isJsonContentType("text/plain"));
  check("content type rejects duplicate values", !isJsonContentType(["application/json", "text/plain"]));

  const mediaId = "550e8400-e29b-41d4-a716-446655440000";
  const mediaDigest = "a".repeat(64);
  check(
    "content-addressed media path parses exact UUID and SHA-256",
    parseMediaPath(`/media/${mediaId}-${mediaDigest}.jpg`)?.contentSha256 === mediaDigest,
  );
  check("legacy immutable media path remains readable", parseMediaPath(`/media/${mediaId}.jpg`)?.id === mediaId);
  check("malformed media path is rejected", parseMediaPath("/media/not-an-id.jpg") === undefined);

  const metaHosts = new Set(["graph.instagram.com", "graph.facebook.com"]);
  const googleHosts = new Set([
    "mybusinessaccountmanagement.googleapis.com",
    "mybusinessbusinessinformation.googleapis.com",
  ]);
  check(
    "credential endpoint accepts an exact Meta Graph origin",
    isAllowedCredentialEndpoint("https://graph.instagram.com/v25.0/me?fields=id", metaHosts),
  );
  check(
    "credential endpoint rejects Meta suffix lookalikes",
    !isAllowedCredentialEndpoint("https://graph.instagram.com.attacker.example/v25.0/me", metaHosts),
  );
  check(
    "credential endpoint accepts exact Google diagnostic origins",
    isAllowedCredentialEndpoint("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", googleHosts)
      && isAllowedCredentialEndpoint("https://mybusinessbusinessinformation.googleapis.com/v1/accounts/1/locations", googleHosts),
  );
  check(
    "credential endpoint rejects HTTPS hosts from the wrong provider policy",
    !isAllowedCredentialEndpoint("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", metaHosts),
  );

  // Byte limit and read deadline operate independently of Content-Length.
  check("bounded body reads normal input", (await readBoundedBody(Readable.from(["hello"]))) === "hello");
  check(
    "bounded body accepts exact byte limit",
    (await readBoundedBody(Readable.from(["1234"]), { maxBytes: 4 })) === "1234",
  );
  const oversized = Readable.from(["12345"]);
  check(
    "bounded body rejects streamed overflow",
    (await bodyErrorCode(readBoundedBody(oversized, { maxBytes: 4 }))) === "body_too_large",
  );
  oversized.destroy();

  const stalled = new PassThrough();
  check(
    "bounded body times out stalled input",
    (await bodyErrorCode(readBoundedBody(stalled, { timeoutMs: 15 }))) === "body_timeout",
  );
  stalled.destroy();

  // The fixed-window limiter resets and never exceeds its entry bound.
  const limiter = new BoundedRateLimiter(2, 1_000, 2);
  check("rate limit permits first request", limiter.check("a", 0).allowed);
  check("rate limit permits request at limit", limiter.check("a", 1).allowed);
  const denied = limiter.check("a", 2);
  check("rate limit rejects excess", !denied.allowed && denied.retryAfterSeconds === 1);
  check("rate limit resets after window", limiter.check("a", 1_000).allowed);
  limiter.check("b", 1_000);
  limiter.check("c", 1_000);
  check("rate limit storage stays bounded", limiter.size === 2);

  check(
    "operation deadline preserves fast success",
    (await withOperationTimeout(Promise.resolve("ok"), 100)) === "ok",
  );
  let operationTimedOut = false;
  let operationCancelled = false;
  try {
    await withOperationTimeout(new Promise<never>(() => {}), 15, () => { operationCancelled = true; });
  } catch (err) {
    operationTimedOut = err instanceof OperationTimeoutError;
  }
  check("operation deadline rejects stalled work", operationTimedOut);
  check("operation deadline invokes underlying cancellation hook", operationCancelled);

  // The review surface displays the entire canonical subject and refuses a
  // stale digest, so convenience UI omissions cannot hide provider fields.
  const reviewDigest = "b".repeat(64);
  const exactSubject: PostPackage[] = [
    {
      platform: "gbp",
      target: {
        accountId: "accounts-123",
        locationId: "location-456",
        apiHost: "mybusiness.googleapis.com",
        apiVersion: "v4",
      },
      text: "Exact caption",
      languageCode: "en-US",
      images: [{
        url: `https://media.example/media/00000000-0000-4000-8000-000000000004-${reviewDigest}.jpg`,
        contentSha256: reviewDigest,
      }],
      gbp: {
        topicType: "STANDARD",
        callToAction: { actionType: "BOOK", url: "https://business.example/book" },
      },
    },
    {
      platform: "instagram",
      target: {
        accountId: "ig-789",
        apiHost: "graph.instagram.com",
        apiVersion: "v25.0",
      },
      text: "Exact Instagram caption",
      images: [{
        url: `https://media.example/media/00000000-0000-4000-8000-000000000004-${reviewDigest}.jpg`,
        contentSha256: reviewDigest,
        altText: "Exact approved alt text",
        aiGenerated: true,
      }],
    },
  ];
  const payloadSha256 = hashApprovalSubject(exactSubject);
  const review = renderApprovalReview({
    id: "approval-id",
    token: "one-time-review-token",
    summary: "Exact provider review",
    subjectType: "social-post-packages/v1",
    subject: exactSubject,
    payloadSha256,
    tokenExpiresAt: "2030-01-01T00:00:00.000Z",
    authorizationExpiresAt: "2030-01-01T00:00:00.000Z",
  });
  check("review displays canonical payload hash", review.includes(payloadSha256));
  check("review displays exact final text", review.includes("Exact caption"));
  check("review displays CTA action and destination", review.includes("BOOK") && review.includes("https://business.example/book"));
  check("review displays media URL, digest, and alt text", review.includes(`https://media.example/media/00000000-0000-4000-8000-000000000004-${reviewDigest}.jpg`) && review.includes(reviewDigest) && review.includes("Exact approved alt text"));
  check("review displays AI disclosure and language", review.includes("true") && review.includes("en-US"));
  check("review displays exact provider destination", review.includes("accounts-123") && review.includes("location-456") && review.includes("mybusiness.googleapis.com") && review.includes("v4"));
  check("review makes token exclusion explicit", review.includes("Access tokens are never included"));
  let unknownFieldBlocked = false;
  try {
    const unknownSubject = [{ ...exactSubject[0]!, providerDisclosure: "ignored field" }];
    renderApprovalReview({
      id: "approval-id",
      token: "one-time-review-token",
      summary: "Unknown field",
      subjectType: "social-post-packages/v1",
      subject: unknownSubject,
      payloadSha256: hashApprovalSubject(unknownSubject),
      tokenExpiresAt: "2030-01-01T00:00:00.000Z",
      authorizationExpiresAt: "2030-01-01T00:00:00.000Z",
    });
  } catch {
    unknownFieldBlocked = true;
  }
  check("review rejects unknown or provider-ignored package fields", unknownFieldBlocked);
  let staleHashBlocked = false;
  try {
    renderApprovalReview({
      id: "approval-id",
      token: "one-time-review-token",
      summary: "Changed",
      subjectType: "social-post-packages/v1",
      subject: [{ ...exactSubject[0]!, text: "Mutated after digest" }],
      payloadSha256,
      tokenExpiresAt: "2030-01-01T00:00:00.000Z",
      authorizationExpiresAt: "2030-01-01T00:00:00.000Z",
    });
  } catch {
    staleHashBlocked = true;
  }
  check("review refuses a subject that differs from its bound hash", staleHashBlocked);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

void run();
