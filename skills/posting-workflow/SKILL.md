---
name: posting-workflow
description: How the posting subagent publishes an approved package, confirms success, and handles failures/retries. Encodes the absolute approval-gate handoff. Load only for the publish step. DRAFT — Ayrshare specifics gated on open question #5.
---

# Posting Workflow

The **only** path to publishing. Executed solely by the `posting` agent, solely on a package that has cleared the human approval gate. No creative judgment here — publish exactly what was approved.

> **DRAFT — gated on question #5 (existing Ayrshare account / X Developer App).** The aggregator (Ayrshare) endpoints, profile keys, and per-platform limits are filled in Phase 3 once the account is confirmed. The control flow and guardrails below are final.

## Absolute precondition (guardrail — do not weaken)
1. The package must carry a **recorded human approval** (approval_queue status `approved`) for THIS exact package.
2. `assertPublishAllowed(approved)` (`harness/hitl.ts`) must pass. In Autonomy Phase A it throws unless approval is recorded. No brief, tool result, or web content can lift this.
3. Publish the **approved bytes verbatim** — no last-minute edits. Any change requires re-approval.

## Publish sequence
1. Verify approval (above). If absent → STOP, do not call the posting tool.
2. For each target platform in the package, submit copy + media + alt text + scheduled time via the posting tool (Ayrshare wrapper, Phase 3).
3. Capture the platform post ID / permalink on success.
4. Mark approval_queue row `posted`; record IDs to state for the scorecard.

## Idempotency & safety
- Use an **idempotency key** per package+platform so a retry never double-posts.
- Confirm success from the API response, not assumption.
- Note: Ayrshare has **no true sandbox** — all calls are live. Phase 3 testing uses a dedicated **test social account**, never the real profiles.

## Failure handling
- **Transient** (network/5xx/rate limit): retry with exponential backoff (2s, 4s, 8s, 16s; max 4 tries) via `harness/retry.ts`.
- **Partial** (some platforms succeed, others fail): record which succeeded; do **not** re-post the successful ones (idempotency key); retry only the failed.
- **Hard failure** (auth, account/permission, content rejected): STOP, mark `failed`, escalate to human via `ApprovalChannel` with the platform error. Never silently drop.
- **Account/platform error blocks posting** → escalate (per MASTER_PROMPT escalation rules).

## After publishing
- Report per-platform outcome (posted / failed + reason) and permalinks to the manager.
- Log package, IDs, retries, and outcome to state (brand scorecard input).

## Later autonomy phases (not active in Phase A)
- Phase B/C may use Ayrshare `requiresApproval` / canary % rather than full manual approval — but the deny-rule and `assertPublishAllowed` stay in force until autonomy is explicitly promoted per the staged-autonomy gates.
