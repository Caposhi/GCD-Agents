/**
 * One brief, from claimed to terminal, with every ownership fence in place.
 *
 * Extracted from the worker so the fencing rules are provable by executing them
 * rather than by asserting on source text. Every boundary that creates durable
 * or external state is injected, so a test can revoke ownership at an exact
 * instant and observe that the next side effect genuinely does not happen.
 *
 * Two rules govern the whole file:
 *
 *   1. A process that has lost ownership creates no new side effects and writes
 *      no terminal state. A successor may already be reconciling this row, and
 *      a former owner overwriting a successor's recovery result is exactly the
 *      corruption ownership exists to prevent.
 *
 *   2. Nothing is ever lost by declining to write. Durable phase markers carry
 *      the approval linkage and every known provider post id, so a successor
 *      reconstructs the same terminal state from them.
 */

import type { PostPackage, PlatformCredentials } from "../mcp/posting-tool/types.js";
import type { PublicationOutcome } from "./publicationRunner.js";
import {
  boundedErrorText,
  PhaseMarkerPersistenceError,
  UncertainProviderOutcomeError,
  PHASE_APPROVAL_REQUESTED,
} from "./briefRecovery.js";

export type ApprovalDecision = "approved" | "rejected" | "expired" | "revoked" | "timeout" | "aborted";

export interface LifecycleDeps {
  /** Orchestration. Local model/image computation; not itself abortable. */
  runBrief(brief: any, opts: { runId: string }): Promise<any>;
  /** Validates review/provider parity and clones the canonical array. */
  toPostPackages(pkg: any): PostPackage[];
  summarize(pkg: any): string;
  requestApproval(req: { summary: string; packageFormatted: PostPackage[] }): Promise<{ id: string }>;
  /** Must reject if the marker did not commit. */
  recordDurablePhaseEvent(e: { runId?: string; kind: string; message: string; data?: unknown }): Promise<void>;
  waitForApproval(id: string, opts: { signal?: AbortSignal }): Promise<ApprovalDecision>;
  assertPublishAllowed(id: string): Promise<{ subject: PostPackage[] }>;
  acquireCredentials(payloads: PostPackage[]): Promise<PlatformCredentials>;
  publishAll(ctx: {
    runId: string; approvalId: string; payloads: PostPackage[]; creds: PlatformCredentials;
  }): Promise<PublicationOutcome>;
  completeBrief(id: string, status: "done" | "failed", outcome: unknown): Promise<void>;
  setApprovalStatus(id: string, status: "posted" | "failed"): Promise<void>;
  revokeApproval(id: string, revokedBy: string, reason: string): Promise<{ ok: boolean; reason?: string }>;
  notifyEscalation(goal: string, reason: string, runId: string): Promise<void>;
  /** Shared classify-and-terminalize path, also used by startup recovery. */
  terminalizeInterruptedBrief(runId: string, goal: string | undefined): Promise<unknown>;
  /** Throws when ownership was lost or shutdown was requested. */
  assertSideEffectAllowed(operation: string): void;
  /** Non-throwing form of the same predicate. */
  sideEffectsAllowed(): boolean;
  /** Narrower: is this process still the exclusive owner? */
  ownershipHeld(): boolean;
  /** Aborted by shutdown or ownership loss. */
  abortSignal: AbortSignal;
  recordEvent(e: { runId?: string; kind: string; message: string; data?: unknown }): void;
  log(message: string): void;
}

export type LifecycleResult =
  | "escalated"
  | "interrupted"
  | "decided_without_publication"
  | "published"
  | "publish_failed"
  | "approval_marker_failed"
  | "publish_marker_failed"
  | "uncertain_provider_outcome";

/**
 * Terminal writes by a process that may no longer own the queue.
 *
 * Returns false when the write was declined because ownership is gone. The
 * caller must not treat that as a failure: the successor owns reconciliation
 * from here, and the durable markers hold everything it needs.
 */
async function writeTerminalIfOwned(
  deps: LifecycleDeps,
  runId: string,
  write: () => Promise<void>,
): Promise<boolean> {
  if (!deps.ownershipHeld()) {
    deps.log(
      `[worker] declining terminal write for ${runId}: ownership lost, `
      + "leaving reconciliation to the exclusive owner",
    );
    return false;
  }
  await write();
  return true;
}

export async function runBriefLifecycle(
  deps: LifecycleDeps,
  id: string,
  brief: any,
): Promise<LifecycleResult> {
  const goal = typeof brief?.goal === "string" ? brief.goal : undefined;
  deps.log(`[worker] running brief ${id}: ${goal ?? "(no goal)"}`);
  const outcome = await deps.runBrief(brief, { runId: id });

  // runBrief performs local computation that is not abortable. Once it returns,
  // no approval may be created and no provider call may occur unless this
  // process still owns the queue and is not shutting down.
  if (!deps.sideEffectsAllowed()) {
    await unwind(deps, id, goal, "after orchestration");
    return "interrupted";
  }

  if (outcome.status === "escalated") {
    deps.log(`[worker] brief ${id} escalated: ${outcome.escalation}`);
    await safelyEscalate(deps, goal, outcome.escalation ?? "unknown reason", id);
    await writeTerminalIfOwned(deps, id, () => deps.completeBrief(id, "failed", {
      reason: outcome.escalation, cost: outcome.costUsd,
    }));
    return "escalated";
  }

  const providerPayloads = deps.toPostPackages(outcome.package);
  deps.assertSideEffectAllowed("approval creation");
  const handle = await deps.requestApproval({
    summary: deps.summarize(outcome.package),
    packageFormatted: providerPayloads,
  });

  // The approval row and its Slack link now exist. Without a committed linking
  // marker nothing durably ties this approval to this brief, so recovery could
  // never classify it and a human could approve something nobody is waiting on.
  try {
    await deps.recordDurablePhaseEvent({
      runId: id,
      kind: PHASE_APPROVAL_REQUESTED,
      message: "approval requested and bound to this brief",
      data: { approvalId: handle.id, packageCount: providerPayloads.length },
    });
  } catch (err) {
    await handleApprovalMarkerFailure(deps, id, goal, handle.id, err, outcome.costUsd);
    return "approval_marker_failed";
  }

  deps.log(`[worker] brief ${id} awaiting approval (id=${handle.id})`);
  const decision = await deps.waitForApproval(handle.id, { signal: deps.abortSignal });

  if (decision === "aborted") {
    await unwind(deps, id, goal, "awaiting approval");
    return "interrupted";
  }

  if (decision !== "approved") {
    deps.log(`[worker] brief ${id} ${decision} — not publishing`);
    await writeTerminalIfOwned(deps, id, () => deps.completeBrief(id, "done", {
      decision, cost: outcome.costUsd,
    }));
    return "decided_without_publication";
  }

  // APPROVED. Publishing reloads the canonical subject from approval storage;
  // the posting tool re-verifies it before every provider call.
  try {
    deps.assertSideEffectAllowed("publication");
  } catch {
    await unwind(deps, id, goal, "before publication");
    return "interrupted";
  }
  const approval = await deps.assertPublishAllowed(handle.id);
  const approvedPayloads = approval.subject;

  try {
    deps.assertSideEffectAllowed("platform credential acquisition");
  } catch {
    await unwind(deps, id, goal, "before credential acquisition");
    return "interrupted";
  }
  const creds = await deps.acquireCredentials(approvedPayloads);

  const publication = await deps.publishAll({
    runId: id, approvalId: handle.id, payloads: approvedPayloads, creds,
  });

  if (publication.kind === "uncertain") {
    await handleUncertainProviderOutcome(
      deps, id, goal, handle.id, publication.error, publication.results, outcome.costUsd,
    );
    return "uncertain_provider_outcome";
  }
  if (publication.kind === "marker_failure") {
    await handlePublishMarkerFailure(
      deps, id, goal, handle.id, publication.error, publication.results, outcome.costUsd,
    );
    return "publish_marker_failed";
  }
  if (publication.kind === "interrupted") {
    await unwind(deps, id, goal, "publication");
    return "interrupted";
  }

  const results = publication.results;
  const allOk = results.length > 0 && results.every((r: any) => r.ok);
  // Both writes are declined together when ownership is gone. Nothing is lost:
  // every settled marker already carries its provider post id, so the successor
  // reconstructs this exact outcome as publication_complete_unrecorded.
  const wrote = await writeTerminalIfOwned(deps, id, async () => {
    await deps.setApprovalStatus(handle.id, allOk ? "posted" : "failed");
    await deps.completeBrief(id, allOk ? "done" : "failed", { decision, results, cost: outcome.costUsd });
  });
  if (wrote) {
    deps.log(`[worker] brief ${id} published: ${JSON.stringify(results)}`);
    deps.recordEvent({
      runId: id,
      kind: allOk ? "brief:published" : "brief:publish_failed",
      message: allOk ? "published to all platforms" : "one or more platforms failed",
      data: { results },
    });
  }
  return allOk ? "published" : "publish_failed";
}

/**
 * Ends an interrupted brief. While ownership is still held it terminalizes
 * itself through the same classifier the next owner would use, so shutdown and
 * startup recovery produce identical durable state. With ownership gone it
 * writes nothing at all.
 */
async function unwind(
  deps: LifecycleDeps,
  id: string,
  goal: string | undefined,
  stage: string,
): Promise<void> {
  if (!deps.ownershipHeld()) {
    deps.log(
      `[worker] brief ${id} interrupted at ${stage} without ownership — `
      + "leaving it for the next exclusive owner",
    );
    return;
  }
  await deps.terminalizeInterruptedBrief(id, goal);
}

/** Case A: the approval exists but nothing durably links it to this brief. */
async function handleApprovalMarkerFailure(
  deps: LifecycleDeps,
  id: string,
  goal: string | undefined,
  approvalId: string,
  err: unknown,
  costUsd: number | undefined,
): Promise<void> {
  const detail = boundedErrorText(err);
  deps.log(`[worker] brief ${id} approval marker did not commit: ${detail}`);
  let revoked = false;
  if (deps.ownershipHeld()) {
    try {
      revoked = (await deps.revokeApproval(
        approvalId,
        "worker:marker_failure",
        "Approval could not be durably bound to its brief; submit a new approval request.",
      )).ok;
    } catch (revokeErr) {
      deps.log(`[worker] revocation after marker failure also failed: ${boundedErrorText(revokeErr)}`);
    }
  }
  // Escalate first: if the database is unwritable, Slack is the only channel
  // that can carry the dangling approval id to a human.
  await safelyEscalate(
    deps,
    goal,
    `Approval ${approvalId} was created but its durable binding marker failed (${detail}). `
    + (revoked
      ? "The approval has been revoked; no publication occurred."
      : "REVOCATION WAS NOT CONFIRMED — revoke it manually; the orphan sweep will also attempt it at next startup."),
    id,
  );
  await writeTerminalIfOwned(deps, id, () => deps.completeBrief(id, "failed", {
    reason: "approval_marker_persistence_failed",
    approvalId,
    approvalRevoked: revoked,
    detail,
    published: false,
    providerMutation: "impossible",
    cost: costUsd,
  })).catch((writeErr) => {
    deps.log(`[worker] terminal write failed for ${id}: ${boundedErrorText(writeErr)}`);
    return false;
  });
}

/** Case B: a started marker failed, so no provider call was made. */
async function handlePublishMarkerFailure(
  deps: LifecycleDeps,
  id: string,
  goal: string | undefined,
  approvalId: string,
  err: PhaseMarkerPersistenceError,
  results: any[],
  costUsd: number | undefined,
): Promise<void> {
  deps.log(`[worker] brief ${id} publish marker failure: ${err.message}`);
  const priorPublished = results.filter((r) => r.ok);
  let revoked = false;
  if (deps.ownershipHeld()) {
    try {
      revoked = (await deps.revokeApproval(
        approvalId,
        "worker:marker_failure",
        "A publication safety marker failed to commit; submit a new approval request.",
      )).ok;
    } catch {
      /* reported through escalation below */
    }
  }
  await safelyEscalate(
    deps,
    goal,
    `Publication stopped because ${err.marker} did not commit (package ${err.packageIndex ?? "?"}). `
    + "No provider request was made for that package. "
    + (priorPublished.length > 0
      ? `Earlier platforms already published: ${priorPublished.map((r) => `${r.platform}=${r.id ?? "unknown-id"}`).join(", ")}.`
      : "No platform had published yet."),
    id,
  );
  await writeTerminalIfOwned(deps, id, () => deps.completeBrief(id, "failed", {
    reason: "publish_marker_persistence_failed",
    approvalId,
    approvalRevoked: revoked,
    marker: err.marker,
    packageIndex: err.packageIndex,
    results,
    published: priorPublished.length > 0,
    providerMutation: priorPublished.length > 0 ? "partial_known" : "impossible",
    requiresProviderReconciliation: priorPublished.length > 0,
    cost: costUsd,
  })).catch(() => false);
}

/** Case C: provider succeeded but its settled marker did not commit. */
async function handleUncertainProviderOutcome(
  deps: LifecycleDeps,
  id: string,
  goal: string | undefined,
  approvalId: string,
  err: UncertainProviderOutcomeError,
  results: any[],
  costUsd: number | undefined,
): Promise<void> {
  deps.log(`[worker] brief ${id} UNCERTAIN provider outcome: ${err.message}`);
  let revoked = false;
  if (deps.ownershipHeld()) {
    try {
      revoked = (await deps.revokeApproval(
        approvalId,
        "worker:uncertain_outcome",
        "A provider mutation could not be durably recorded; submit a new approval request after reconciliation.",
      )).ok;
    } catch {
      /* reported through escalation below */
    }
  }
  // The provider post id may exist nowhere else if the database is unwritable,
  // so it must reach a human out-of-band regardless of ownership.
  await safelyEscalate(
    deps,
    goal,
    `UNCERTAIN PROVIDER OUTCOME on ${err.platform} (package ${err.packageIndex}). `
    + `The provider reported success${err.providerPostId ? ` with post id ${err.providerPostId}` : ""}, `
    + "but the settled marker did not commit. Remaining platforms were NOT attempted and no automatic retry "
    + "will occur. Reconcile against the platform before issuing a new approval.",
    id,
  );
  await writeTerminalIfOwned(deps, id, () => deps.completeBrief(id, "failed", {
    reason: "uncertain_provider_outcome",
    approvalId,
    approvalRevoked: revoked,
    platform: err.platform,
    packageIndex: err.packageIndex,
    providerPostId: err.providerPostId,
    results,
    published: true,
    providerMutation: "uncertain",
    requiresProviderReconciliation: true,
    automaticRetry: "refused",
    cost: costUsd,
  })).catch(() => false);
}

async function safelyEscalate(
  deps: LifecycleDeps,
  goal: string | undefined,
  reason: string,
  runId: string,
): Promise<void> {
  try {
    await deps.notifyEscalation(goal ?? "(no goal)", reason, runId);
  } catch (err) {
    deps.log(`[worker] escalation delivery failed for ${runId}: ${boundedErrorText(err)}`);
  }
}
