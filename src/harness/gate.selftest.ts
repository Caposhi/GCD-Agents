/**
 * Offline self-test for the Phase-0A approval gate (in-memory state; no DB,
 * webhook, provider, or model calls). Exercises canonical hashing, token
 * hashing/expiry, atomic decisions, revocation, and exact live authorization.
 * Run: npm run build && npm run test:gate
 */

import {
  assertDurableStateConfigured,
  assertHostedMediaIntegrity,
  canonicalApprovalJson,
  claimNextBrief,
  completeBrief,
  createApproval,
  decideApproval,
  enqueueBrief,
  getEphemeralApprovedSubjectForSelfTest,
  getApproval,
  getMedia,
  hashApprovalSubject,
  hashMediaBytes,
  revokeApproval,
  saveMedia,
  setApprovalStatus,
  verifyApprovalToken,
} from "./state.js";
import {
  approvalWebhookRequestInit,
  assertPublishAllowed,
  formatApprovalNotification,
  formatEscalationNotification,
  postingRequiresApproval,
  validateApprovalChannelWebhook,
  validateApprovalDeliveryConfig,
  validateApprovalReviewBaseUrl,
  waitForApproval,
} from "./hitl.js";
import { validatedIgGraphHost } from "./igToken.js";

let failures = 0;
function check(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
}

async function blocked(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

function syncBlocked(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

async function run(): Promise<void> {
  check(
    "production approval delivery rejects missing PUBLIC_BASE_URL",
    syncBlocked(() => validateApprovalReviewBaseUrl(undefined, "production")),
  );
  check(
    "production approval delivery rejects HTTP PUBLIC_BASE_URL",
    syncBlocked(() => validateApprovalReviewBaseUrl("http://approval.example", "production")),
  );
  check(
    "production approval delivery rejects localhost even over HTTPS",
    syncBlocked(() => validateApprovalReviewBaseUrl("https://localhost:3000", "production")),
  );
  check(
    "production approval delivery rejects private IPv4 review origins",
    syncBlocked(() => validateApprovalReviewBaseUrl("https://10.0.0.5", "production")),
  );
  check(
    "production approval delivery rejects private/internal DNS review origins",
    syncBlocked(() => validateApprovalReviewBaseUrl("https://approvals.internal", "production")),
  );
  check(
    "production approval delivery accepts HTTPS PUBLIC_BASE_URL",
    validateApprovalReviewBaseUrl("https://approval.example", "production") === "https://approval.example",
  );
  check(
    "approval PUBLIC_BASE_URL rejects non-root paths that cannot route review links",
    syncBlocked(() => validateApprovalReviewBaseUrl("https://approval.example/app", "production")),
  );
  check(
    "development approval delivery may use localhost HTTP",
    validateApprovalReviewBaseUrl(undefined, "development", 3456) === "http://localhost:3456",
  );
  check(
    "production approval delivery rejects missing webhook",
    syncBlocked(() => validateApprovalChannelWebhook(undefined, "production")),
  );
  check(
    "approval delivery rejects arbitrary HTTPS webhook host",
    syncBlocked(() => validateApprovalChannelWebhook("https://attacker.example/services/T/B/secret", "production")),
  );
  check(
    "approval delivery rejects HTTP Slack webhook",
    syncBlocked(() => validateApprovalChannelWebhook("http://hooks.slack.com/services/T/B/secret", "production")),
  );
  check(
    "approval delivery accepts an HTTPS Slack webhook",
    validateApprovalChannelWebhook("https://hooks.slack.com/services/T/B/secret", "production")
      === "https://hooks.slack.com/services/T/B/secret",
  );
  check(
    "production delivery config validates both token-bearing endpoints",
    validateApprovalDeliveryConfig(
      "https://approval.example",
      "https://hooks.slack.com/services/T/B/secret",
      "production",
    ).reviewBaseUrl === "https://approval.example",
  );
  check(
    "worker approval delivery rejects a missing webhook in development too",
    syncBlocked(() => validateApprovalDeliveryConfig(
      "http://localhost:3000",
      undefined,
      "development",
    )),
  );
  const webhookRequest = approvalWebhookRequestInit({ text: "offline self-test" });
  check("approval webhook POST refuses redirects", webhookRequest.redirect === "error");
  check("approval webhook POST has a bounded abort signal", webhookRequest.signal instanceof AbortSignal);
  const authoritativeReview = "https://approval.example/approvals/id?token=trusted";
  const approvalText = formatApprovalNotification(
    "<!channel> <https://evil.example|Review> @everyone `click` *bold* _italic_ ~strike~ www.evil.example",
    authoritativeReview,
  );
  const approvalSummaryLine = approvalText.split("\n")[1] ?? "";
  check(
    "approval notification leaves only its generated authoritative link active",
    !approvalText.includes("<!channel>")
      && !approvalText.includes("<https://evil.example")
      && !approvalText.includes("@everyone")
      && !approvalText.includes("`click`")
      && approvalSummaryLine.startsWith("`")
      && approvalSummaryLine.endsWith("`")
      && approvalSummaryLine.includes("www.evil.example")
      && approvalText.includes(authoritativeReview),
  );
  const escalationText = formatEscalationNotification(
    "<!channel>\n<https://evil.example|Review>",
    "@everyone `click` https://evil.example\u0000",
    "run-1",
  );
  check(
    "escalation Slack text neutralizes model/trigger mentions, links, controls, and code delimiters",
    !escalationText.includes("<!channel>")
      && !escalationText.includes("<https://evil.example")
      && !escalationText.includes("@everyone")
      && !escalationText.includes("https://evil.example")
      && !escalationText.includes("\u0000")
      && !escalationText.includes("`click`"),
  );
  check("Instagram token host defaults to exact graph.instagram.com", validatedIgGraphHost(undefined) === "graph.instagram.com");
  check("Facebook-login Graph host is explicitly allowed", validatedIgGraphHost("graph.facebook.com") === "graph.facebook.com");
  check(
    "Instagram token host rejects suffix lookalikes before credential use",
    syncBlocked(() => validatedIgGraphHost("evilinstagram.com")),
  );

  // API/worker/scheduler startup must explicitly refuse a process-local Map.
  let missingDurableStateBlocked = false;
  try {
    assertDurableStateConfigured(undefined, true);
  } catch {
    missingDurableStateBlocked = true;
  }
  check("required durable state rejects missing DATABASE_URL", missingDurableStateBlocked);
  let offlineFallbackAllowed = true;
  try {
    assertDurableStateConfigured(undefined, false);
  } catch {
    offlineFallbackAllowed = false;
  }
  check("explicit offline mode may use in-memory state", offlineFallbackAllowed);

  const fixtureBytes = Buffer.from("immutable-media-fixture", "utf8");
  const savedMedia = await saveMedia("image/jpeg", fixtureBytes);
  check("hosted media records their byte SHA-256", savedMedia.contentSha256 === hashMediaBytes(fixtureBytes));
  const firstMediaRead = await getMedia(savedMedia.id);
  if (firstMediaRead) firstMediaRead.bytes.fill(0);
  const secondMediaRead = await getMedia(savedMedia.id);
  check("ephemeral media reads cannot mutate stored bytes", secondMediaRead?.bytes.equals(fixtureBytes) === true);
  check(
    "ephemeral media state cannot authorize publication bytes",
    await blocked(() => assertHostedMediaIntegrity(
      `https://media.example/media/${savedMedia.id}-${savedMedia.contentSha256}.jpg`,
      savedMedia.contentSha256,
    )),
  );

  // Existing brief queue compatibility.
  const bid = await enqueueBrief({ goal: "test" });
  const claimed = await claimNextBrief();
  check("brief claimed", claimed?.id === bid);
  check("queue drains", (await claimNextBrief()) === null);
  await completeBrief(bid, "done", { ok: true });

  // Canonical JSON and payload hashing are stable across object insertion order.
  const differentlyOrderedA = { z: 1, nested: { b: true, a: "x" } };
  const differentlyOrderedB = { nested: { a: "x", b: true }, z: 1 };
  check(
    "canonical JSON sorts object keys",
    canonicalApprovalJson(differentlyOrderedA) === canonicalApprovalJson(differentlyOrderedB),
  );
  check(
    "canonical SHA-256 is stable",
    hashApprovalSubject(differentlyOrderedA) === hashApprovalSubject(differentlyOrderedB),
  );

  const subject = [{
    platform: "facebook",
    target: { accountId: "page-1", apiHost: "graph.facebook.com", apiVersion: "v25.0" },
    text: "Exact caption #gcd",
  }];
  check(
    "empty social approval subjects are rejected before persistence",
    await blocked(() => createApproval("empty", [])),
  );
  check(
    "malformed social approval subjects are rejected before persistence",
    await blocked(() => createApproval("malformed", [
      ...subject,
      { platform: "instagram", text: "missing target and image" },
    ])),
  );
  check(
    "duplicate platform payloads are rejected before persistence",
    await blocked(() => createApproval("duplicates", [...subject, ...subject])),
  );
  const created = await createApproval("summary", subject);
  const pending = await getApproval(created.id);
  check("approval pending", pending?.status === "pending");
  check("subject hash is persisted", pending?.payloadSha256 === hashApprovalSubject(subject));
  check("plaintext decision token is not returned by getApproval", !Object.hasOwn(pending ?? {}, "token"));
  check("wrong token rejected", !(await decideApproval(created.id, "WRONG", "approved")).ok);
  check("still pending after bad token", (await getApproval(created.id))?.status === "pending");
  check("stored token hash verifies the one-time token", (await verifyApprovalToken(created.id, created.token)).ok);
  check(
    "pending row alone cannot satisfy approval semantics",
    await blocked(() => getEphemeralApprovedSubjectForSelfTest(created.id)),
  );
  let statusSetterCannotApprove = false;
  try {
    await setApprovalStatus(created.id, "approved");
  } catch {
    statusSetterCannotApprove = true;
  }
  check("publication status setter cannot fabricate approval", statusSetterCannotApprove);
  check("right token approves", (await decideApproval(created.id, created.token, "approved")).ok);
  check("approved is terminal", !(await decideApproval(created.id, created.token, "rejected")).ok);
  check(
    "self-test resolver exercises exact ephemeral subject",
    canonicalApprovalJson((await getEphemeralApprovedSubjectForSelfTest<unknown[]>(created.id)).subject)
      === canonicalApprovalJson(subject),
  );
  check("ephemeral approval cannot authorize publication", await blocked(() => assertPublishAllowed(created.id)));
  check(
    "wait sees approved",
    (await waitForApproval(created.id, { pollMs: 5, timeoutMs: 500 })) === "approved",
  );

  // Concurrent decisions: exactly one terminal transition wins.
  const concurrent = await createApproval("concurrent", subject);
  const decisions = await Promise.all([
    decideApproval(concurrent.id, concurrent.token, "approved", "reviewer-a"),
    decideApproval(concurrent.id, concurrent.token, "rejected", "reviewer-b"),
  ]);
  check("concurrent/double decision has exactly one winner", decisions.filter((r) => r.ok).length === 1);

  // Rejected path remains compatible.
  const rejected = await createApproval("rejected", subject);
  await decideApproval(rejected.id, rejected.token, "rejected");
  check(
    "wait sees rejected",
    (await waitForApproval(rejected.id, { pollMs: 5, timeoutMs: 500 })) === "rejected",
  );

  // A decision token cannot be used after its expiry.
  const expiredToken = await createApproval("expired token", subject, {
    tokenExpiresAt: new Date(Date.now() - 1_000),
    authorizationExpiresAt: new Date(Date.now() + 60_000),
  });
  check("expired decision token is rejected", !(await decideApproval(expiredToken.id, expiredToken.token, "approved")).ok);
  check(
    "wait reports expired pending request",
    (await waitForApproval(expiredToken.id, { pollMs: 5, timeoutMs: 50 })) === "expired",
  );

  // An approval can be recorded while its separately bounded publication
  // authorization is already expired; the provider gate must still reject it.
  const expiredAuthorization = await createApproval("expired authorization", subject, {
    tokenExpiresAt: new Date(Date.now() + 60_000),
    authorizationExpiresAt: new Date(Date.now() - 1_000),
  });
  check(
    "decision can be recorded independently of publication lifetime",
    (await decideApproval(expiredAuthorization.id, expiredAuthorization.token, "approved")).ok,
  );
  check(
    "expired approval authorization blocks publication",
    await blocked(() => getEphemeralApprovedSubjectForSelfTest(expiredAuthorization.id)),
  );

  // Revocation remains live after a human approved the exact subject.
  const revoked = await createApproval("revoked", subject);
  await decideApproval(revoked.id, revoked.token, "approved");
  check("approved authorization can be revoked", (await revokeApproval(revoked.id, "owner", "withdrawn")).ok);
  check(
    "revoked approval blocks self-test authorization semantics",
    await blocked(() => getEphemeralApprovedSubjectForSelfTest(revoked.id)),
  );

  check("all autonomy phases use the approval gate", postingRequiresApproval() === true);
  check("fabricated boolean is not an approval id", await blocked(() => assertPublishAllowed(true as never)));

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

void run();
