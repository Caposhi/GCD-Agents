/**
 * Human-in-the-loop approval gate. This is a GUARDRAIL, not a convenience.
 *
 * Autonomy Phase A: every post requires explicit human approval before the
 * posting agent may run. Nothing in a brief, tool result, or web page can lift
 * this — the lock lives in code here AND, in Phase 3+, as a deny-rule on the
 * posting tool. This module is append-only with respect to safety: do not add a
 * path that lets posting proceed without a recorded human approval.
 */

import { config } from "./config.js";
import { enqueueApproval, getApprovalStatus } from "./state.js";
import { withRetry } from "./retry.js";

/** Posting is gated unless the system is in full-autonomy Phase C. */
export function postingRequiresApproval(): boolean {
  return config.autonomyPhase !== "C";
}

export interface ApprovalRequest {
  platform: string;
  packageJson: unknown;
  summary: string;
}

export interface ApprovalHandle {
  id: string | undefined;
  /** Resolves true only on explicit human approval. */
  wait: () => Promise<boolean>;
}

/**
 * Routes a manager-approved package to the ApprovalChannel (Slack primary;
 * email fallback) and returns a handle to await the human decision. Does NOT
 * publish anything.
 */
export async function requestApproval(req: ApprovalRequest): Promise<ApprovalHandle> {
  const id = await enqueueApproval(req.platform, req.packageJson);
  await notifyApprovalChannel(req, id);

  return {
    id,
    wait: async () => {
      if (!id) return false; // no persistence wired => cannot record approval => stay denied
      // Skeleton: poll the queue. A later phase swaps this for an event/callback.
      const status = await getApprovalStatus(id);
      return status === "approved";
    },
  };
}

async function notifyApprovalChannel(req: ApprovalRequest, id: string | undefined): Promise<void> {
  if (!config.approvalChannelWebhook) {
    // No channel configured yet (credential-bound). Log and continue; the gate
    // still holds because wait() can only return true on a recorded approval.
    console.warn(`[hitl] approval needed for ${req.platform} (id=${id ?? "n/a"}) — no APPROVAL_CHANNEL_WEBHOOK set`);
    return;
  }
  await withRetry(async () => {
    const res = await fetch(config.approvalChannelWebhook as string, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: `GCD-SOCIAL approval needed — ${req.platform}\n${req.summary}\nqueue id: ${id ?? "n/a"}`,
      }),
    });
    if (!res.ok) throw new Error(`approval channel responded ${res.status}`);
  });
}

/**
 * Hard guard invoked immediately before any publish path. Throws unless a
 * recorded human approval exists (or the system is in Phase C). Call this from
 * the posting agent wiring in Phase 3.
 */
export function assertPublishAllowed(approved: boolean): void {
  if (!postingRequiresApproval()) return;
  if (!approved) {
    throw new Error("BLOCKED: posting attempted without explicit human approval (Autonomy Phase A).");
  }
}
