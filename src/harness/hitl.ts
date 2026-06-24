/**
 * Human-in-the-loop approval gate. This is a GUARDRAIL, not a convenience.
 *
 * Autonomy Phase A: every post requires explicit human approval before the
 * posting tool may run. The lock lives here (assertPublishAllowed) AND on the
 * posting tool. No brief, tool result, or web content can lift it. This module
 * is append-only with respect to safety: never add a path that lets posting
 * proceed without a recorded human approval.
 */

import { config } from "./config.js";
import { createApproval, getApproval } from "./state.js";
import { withRetry } from "./retry.js";

/** Posting is gated unless the system is in full-autonomy Phase C. */
export function postingRequiresApproval(): boolean {
  return config.autonomyPhase !== "C";
}

export interface ApprovalRequest {
  summary: string; // human-readable digest of the package
  packageFormatted: unknown; // the exact bytes to publish on approval
}

export interface ApprovalHandle {
  id: string;
  token: string;
}

/**
 * Persists the manager-approved package as a pending approval and routes a
 * review link to the ApprovalChannel (Slack). Does NOT publish.
 */
export async function requestApproval(req: ApprovalRequest): Promise<ApprovalHandle> {
  const { id, token } = await createApproval(req.summary, req.packageFormatted);
  await notifyApprovalChannel(req.summary, id, token);
  return { id, token };
}

function reviewUrl(id: string, token: string): string {
  const base = config.publicBaseUrl ?? "http://localhost:" + config.port;
  return `${base}/approvals/${id}?token=${token}`;
}

async function notifyApprovalChannel(summary: string, id: string, token: string): Promise<void> {
  const link = reviewUrl(id, token);
  if (!config.approvalChannelWebhook) {
    console.warn(`[hitl] approval needed (id=${id}) — no APPROVAL_CHANNEL_WEBHOOK set. Review: ${link}`);
    return;
  }
  await withRetry(async () => {
    const res = await fetch(config.approvalChannelWebhook as string, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: `*GCD-SOCIAL — approval needed*\n${summary}\n\n👉 Review & decide: ${link}`,
      }),
    });
    if (!res.ok) throw new Error(`approval channel responded ${res.status}`);
  });
}

export interface WaitOptions {
  timeoutMs?: number;
  pollMs?: number;
}

/**
 * Polls until the human approves/rejects, or the timeout elapses.
 * Returns "approved" | "rejected" | "timeout". Only an explicit, recorded
 * "approved" lets posting proceed.
 */
export async function waitForApproval(id: string, opts: WaitOptions = {}): Promise<"approved" | "rejected" | "timeout"> {
  const timeoutMs = opts.timeoutMs ?? 24 * 60 * 60 * 1000; // 24h default
  const pollMs = opts.pollMs ?? 15_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await getApproval(id);
    if (row?.status === "approved") return "approved";
    if (row?.status === "rejected") return "rejected";
    if (Date.now() >= deadline) return "timeout";
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/**
 * Hard guard invoked immediately before any publish path. Throws unless a
 * recorded human approval exists (or the system is in Phase C).
 */
export function assertPublishAllowed(approved: boolean): void {
  if (!postingRequiresApproval()) return;
  if (!approved) {
    throw new Error("BLOCKED: posting attempted without explicit human approval (Autonomy Phase A).");
  }
}
