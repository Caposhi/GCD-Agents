/**
 * Human-in-the-loop approval gate. This is a GUARDRAIL, not a convenience.
 *
 * Autonomy Phase A: every post requires explicit human approval before the
 * posting tool may run. The lock lives here (assertPublishAllowed) AND on the
 * posting tool. No brief, boolean, tool result, autonomy setting, or web
 * content can lift it. This module is append-only with respect to safety:
 * never add a path that lets posting proceed without a live approval whose
 * canonical hash matches the exact provider-bound subject.
 */

import { config } from "./config.js";
import { isIP } from "node:net";
import { createApproval, getApproval, getLiveApprovedSubject, revokeApproval } from "./state.js";
import { withRetry } from "./retry.js";
import { assertValidSocialPostSubject } from "../mcp/posting-tool/validation.js";
import { sanitizeSlackSummaryText } from "./packageMap.js";

/** Exact provider-bound PostPackage[] subjects use this stable contract id. */
export const SOCIAL_POST_APPROVAL_SUBJECT = "social-post-packages/v1";
const APPROVAL_CHANNEL_TIMEOUT_MS = 10_000;
const SLACK_APPROVAL_WEBHOOK_HOSTS = new Set(["hooks.slack.com"]);

export interface ApprovalDeliveryConfig {
  reviewBaseUrl: string;
  webhookUrl?: string;
}

function isObviouslyNonPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const octets = host.split(".").map(Number);
    const [a, b] = octets;
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b! >= 64 && b! <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b! >= 16 && b! <= 31)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || a! >= 224;
  }
  if (ipVersion === 6) {
    return host === "::"
      || host === "::1"
      || host.startsWith("fc")
      || host.startsWith("fd")
      || /^fe[89ab]/.test(host)
      || host.startsWith("::ffff:");
  }
  return host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host.endsWith(".lan")
    || !host.includes(".");
}

/**
 * Validate the origin used in token-bearing approval links without reading
 * process globals, so startup/self-tests can fail closed before persisting an
 * approval. Development may use localhost HTTP; production may not.
 */
export function validateApprovalReviewBaseUrl(
  publicBaseUrl: string | undefined,
  nodeEnv: string,
  port = 3000,
): string {
  const configured = publicBaseUrl?.trim();
  if (!configured && nodeEnv === "production") {
    throw new Error("PUBLIC_BASE_URL is required for production approval delivery");
  }

  const raw = configured || `http://localhost:${port}`;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("PUBLIC_BASE_URL must be a valid absolute URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("PUBLIC_BASE_URL must use http or https");
  }
  if (nodeEnv === "production" && parsed.protocol !== "https:") {
    throw new Error("PUBLIC_BASE_URL must use https for production approval delivery");
  }
  if (
    nodeEnv === "production"
    && isObviouslyNonPublicHostname(parsed.hostname)
  ) {
    throw new Error("PUBLIC_BASE_URL must use a public HTTPS host for production approval delivery");
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("PUBLIC_BASE_URL must be an origin without credentials, a path, query, or fragment");
  }
  return parsed.origin;
}

/** Validate the only supported destination for token-bearing review links. */
export function validateApprovalChannelWebhook(
  approvalChannelWebhook: string | undefined,
  nodeEnv: string,
): string | undefined {
  const configured = approvalChannelWebhook?.trim();
  if (!configured) {
    if (nodeEnv === "production") {
      throw new Error("APPROVAL_CHANNEL_WEBHOOK is required to deliver production approval requests");
    }
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("APPROVAL_CHANNEL_WEBHOOK must be a valid Slack HTTPS webhook URL");
  }
  if (
    parsed.protocol !== "https:"
    || !SLACK_APPROVAL_WEBHOOK_HOSTS.has(parsed.hostname)
    || parsed.port !== ""
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.search !== ""
    || parsed.hash !== ""
    || !/^\/services\/[^/]+\/[^/]+\/[^/]+$/.test(parsed.pathname)
  ) {
    throw new Error("APPROVAL_CHANNEL_WEBHOOK must be an HTTPS hooks.slack.com/services webhook URL");
  }
  return parsed.toString();
}

/** Resolve and validate approval delivery before creating a durable request. */
export function validateApprovalDeliveryConfig(
  publicBaseUrl: string | undefined,
  approvalChannelWebhook: string | undefined,
  nodeEnv: string,
  port = 3000,
): ApprovalDeliveryConfig {
  const webhookUrl = validateApprovalChannelWebhook(approvalChannelWebhook, nodeEnv);
  if (!webhookUrl) {
    throw new Error(
      "APPROVAL_CHANNEL_WEBHOOK is required for worker approval delivery; use createApproval directly in offline tests",
    );
  }
  return {
    reviewBaseUrl: validateApprovalReviewBaseUrl(publicBaseUrl, nodeEnv, port),
    webhookUrl,
  };
}

/** Build a bounded, non-redirecting Slack request so its body cannot replay. */
export function approvalWebhookRequestInit(body: Record<string, unknown>): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(APPROVAL_CHANNEL_TIMEOUT_MS),
  };
}

/** Publication always requires a live durable exact-payload approval. */
export function postingRequiresApproval(): boolean {
  return true;
}

export interface ApprovalRequest {
  summary: string; // human-readable digest of the package
  packageFormatted: unknown; // canonical provider-bound subject; no later content transformation
  subjectType?: string;
}

export interface ApprovalHandle {
  id: string;
  token: string;
  payloadSha256: string;
  tokenExpiresAt: string;
  authorizationExpiresAt: string;
}

/**
 * Persists the manager-approved package as a pending approval and routes a
 * review link to the ApprovalChannel (Slack). Does NOT publish.
 */
export async function requestApproval(req: ApprovalRequest): Promise<ApprovalHandle> {
  // Resolve all token-delivery destinations before creating either the
  // approval row or its one-time secret. Production misconfiguration cannot
  // result in a bearer token being placed into an insecure/arbitrary URL.
  const delivery = validateApprovalDeliveryConfig(
    config.publicBaseUrl,
    config.approvalChannelWebhook,
    config.nodeEnv,
    config.port,
  );
  const subjectType = req.subjectType ?? SOCIAL_POST_APPROVAL_SUBJECT;
  if (subjectType === SOCIAL_POST_APPROVAL_SUBJECT) {
    assertValidSocialPostSubject(req.packageFormatted);
  }
  const { id, token, payloadSha256, tokenExpiresAt, authorizationExpiresAt } = await createApproval(
    req.summary,
    req.packageFormatted,
    { subjectType },
  );
  try {
    await notifyApprovalChannel(req.summary, id, token, delivery);
  } catch (notificationError) {
    // The caller does not receive the one-time token when notification fails.
    // Revoke the orphaned request so a delayed/duplicate delivery cannot later
    // authorize it unexpectedly.
    try {
      await revokeOrphanedApproval(id);
    } catch (revocationError) {
      throw new AggregateError(
        [notificationError, revocationError],
        `approval notification failed and revocation could not be confirmed (id=${id})`,
      );
    }
    throw notificationError;
  }
  return { id, token, payloadSha256, tokenExpiresAt, authorizationExpiresAt };
}

async function revokeOrphanedApproval(id: string): Promise<void> {
  await withRetry(async () => {
    const result = await revokeApproval(
      id,
      "system:approval-notification",
      "approval notification was not confirmed",
    );
    if (result.ok) return;
    // A prior ambiguous attempt may have committed before its connection
    // failed. Confirm current state before treating the retry as a failure.
    const current = await getApproval(id);
    if (current?.revokedAt) return;
    throw new Error(`approval revocation was not confirmed: ${result.reason ?? "unknown reason"}`);
  }, { retries: 2, baseDelayMs: 250 });
}

function reviewUrl(id: string, token: string, baseUrl: string): string {
  const link = new URL(baseUrl);
  link.pathname = `${link.pathname.replace(/\/$/, "")}/approvals/${encodeURIComponent(id)}`;
  link.searchParams.set("token", token);
  return link.toString();
}

async function notifyApprovalChannel(
  summary: string,
  id: string,
  token: string,
  delivery: ApprovalDeliveryConfig,
): Promise<void> {
  if (!delivery.webhookUrl) {
    throw new Error("approval channel delivery is unavailable");
  }
  const link = reviewUrl(id, token, delivery.reviewBaseUrl);
  await withRetry(async () => {
    const res = await fetch(delivery.webhookUrl as string, approvalWebhookRequestInit({
        text: formatApprovalNotification(summary, link),
    }));
    if (!res.ok) throw new Error(`approval channel responded ${res.status}`);
  });
}

/** Only the separately generated review link may remain active Slack markup. */
export function formatApprovalNotification(summary: string, authoritativeLink: string): string {
  const safeSummary = String(summary)
    .split(/\r?\n/)
    .slice(0, 3)
    .map((line) => sanitizeSlackSummaryText(line.slice(0, 300)))
    .filter(Boolean)
    // Add controlled delimiters only after sanitizing caller/model text. This
    // keeps bare domains and every mrkdwn metacharacter inert while leaving
    // the separately generated review URL as the message's sole active link.
    .map((line) => `\`${line}\``)
    .join("\n");
  return `*GCD-SOCIAL — approval needed*\n${safeSummary}\n\n`
    + `👉 *Authoritative exact-payload review:* ${authoritativeLink}`;
}

/**
 * Alerts the ApprovalChannel (Slack) that a brief was escalated instead of
 * shipped — it failed the brand-compliance critic loop or the image
 * legibility QC gate after every allowed attempt, so there is no package to
 * approve. Without this, an escalation only ever landed in the state DB and
 * the console log; a human had no way to learn about it short of noticing a
 * silent "awaiting human review" tile on the Arcade dashboard.
 *
 * Deliberately best-effort: unlike notifyApprovalChannel (part of the
 * approval gate's critical path), a failed escalation alert must not stop
 * the brief from being recorded "failed" and the worker moving on.
 */
export async function notifyEscalation(goal: string, reason: string, runId: string): Promise<void> {
  if (!config.approvalChannelWebhook) {
    console.warn(
      `[hitl] brief escalated (runId=${sanitizeSlackSummaryText(String(runId).slice(0, 200))}) — `
      + `no APPROVAL_CHANNEL_WEBHOOK set. Reason: ${sanitizeSlackSummaryText(String(reason).slice(0, 1_500))}`,
    );
    return;
  }
  try {
    const webhookUrl = validateApprovalChannelWebhook(config.approvalChannelWebhook, config.nodeEnv) as string;
    await withRetry(async () => {
      const res = await fetch(webhookUrl, approvalWebhookRequestInit({
          text: formatEscalationNotification(goal, reason, runId),
      }));
      if (!res.ok) throw new Error(`approval channel responded ${res.status}`);
    });
  } catch (err) {
    console.error(
      `[hitl] failed to notify approval channel of escalation `
      + `(runId=${sanitizeSlackSummaryText(String(runId).slice(0, 200))}):`,
      (err as Error).name,
    );
  }
}

/** Treat trigger/model-authored escalation context as inert Slack preview text. */
export function formatEscalationNotification(goal: string, reason: string, runId: string): string {
  const safeGoal = sanitizeSlackSummaryText(String(goal).slice(0, 500));
  const safeReason = sanitizeSlackSummaryText(String(reason).slice(0, 1_500));
  const safeRunId = sanitizeSlackSummaryText(String(runId).slice(0, 200));
  return `🚨 *GCD-SOCIAL — escalated, nothing to review yet*\n`
    + `Goal: \`${safeGoal}\`\n`
    + `Reason: \`${safeReason}\`\n\n`
    + `No post was produced for this brief — there's no approval link waiting. `
    + `Check the worker service logs (runId: ${safeRunId}) for the full critique/QC history.`;
}

export interface WaitOptions {
  timeoutMs?: number;
  pollMs?: number;
}

/**
 * Polls until the human approves/rejects, or the timeout elapses.
 * Returns the terminal decision, inactive reason, or timeout. Only an explicit,
 * recorded, still-live "approved" result lets the worker attempt publication;
 * the posting tool independently re-verifies it before each provider call.
 */
export async function waitForApproval(
  id: string,
  opts: WaitOptions = {},
): Promise<"approved" | "rejected" | "expired" | "revoked" | "timeout"> {
  const timeoutMs = opts.timeoutMs ?? 24 * 60 * 60 * 1000; // 24h default
  const pollMs = opts.pollMs ?? 15_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await getApproval(id);
    if (row?.revokedAt) return "revoked";
    if (
      row?.status === "approved"
      && row.authorizationExpiresAt
      && Date.parse(row.authorizationExpiresAt) <= Date.now()
    ) return "expired";
    if (row?.status === "approved") return "approved";
    if (row?.status === "rejected") return "rejected";
    if (row?.tokenExpiresAt && Date.parse(row.tokenExpiresAt) <= Date.now()) return "expired";
    if (Date.now() >= deadline) return "timeout";
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/**
 * Hard guard invoked immediately before every provider call. It resolves the
 * canonical subject from current approval state and re-computes its SHA-256.
 * There is intentionally no caller-supplied boolean or autonomy-phase bypass.
 */
export async function assertPublishAllowed<T = unknown>(
  approvalId: string,
  expectedSubjectType = SOCIAL_POST_APPROVAL_SUBJECT,
): Promise<{ subject: T; payloadSha256: string }> {
  if (typeof approvalId !== "string" || approvalId.length === 0) {
    throw new Error("BLOCKED: posting attempted without an approval id");
  }
  return getLiveApprovedSubject<T>(approvalId, expectedSubjectType);
}
