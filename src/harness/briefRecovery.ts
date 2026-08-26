/**
 * Recovery for briefs interrupted mid-flight.
 *
 * A brief sits in `running` from the moment it is claimed until it reaches a
 * terminal status — through orchestration, a human approval wait of up to 24
 * hours, and the provider publish loop. `claimNextBrief` only ever selects
 * `pending`, so nothing reclaims a `running` row: before this module, an
 * interrupted worker stranded its brief permanently and silently.
 *
 * Classification is derived purely from durable phase markers, never from
 * elapsed time. Time cannot distinguish "crashed" from "legitimately waiting
 * for a human", but the markers can, because each one commits before the side
 * effect it describes.
 *
 * Two hard rules, both structural rather than advisory:
 *   - REFUSE, DON'T RESUME. Every classification is terminal. Nothing here can
 *     return a brief to `pending` (completeBrief accepts only done/failed) and
 *     nothing re-enters the publish loop.
 *   - NO PROVIDER I/O. This module imports no provider code at all, so recovery
 *     cannot repeat a publication whose outcome is unknown.
 *
 * Callers must already hold exclusive worker ownership. Without it a `running`
 * row may belong to a live peer during Render's zero-downtime deploy overlap.
 */

import type { EventRow } from "./state.js";

export const PHASE_APPROVAL_REQUESTED = "brief:approval_requested";
export const PHASE_PUBLISH_ATTEMPT_STARTED = "brief:publish_attempt_started";
export const PHASE_PUBLISH_ATTEMPT_SETTLED = "brief:publish_attempt_settled";
export const PHASE_RECONCILED = "brief:reconciled_stranded";
export const PHASE_ORPHAN_APPROVAL_REVOKED = "approval:orphan_revoked";

/** Keeps provider error text out of durable state and Slack previews. */
export const MAX_RECOVERY_ERROR_CHARS = 300;

export function boundedErrorText(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_RECOVERY_ERROR_CHARS);
}

/**
 * A safety marker failed to commit, so the side effect it guards must not run.
 * Distinct from an ordinary provider failure because the correct response is to
 * stop the whole publication, not to record one platform as failed.
 */
export class PhaseMarkerPersistenceError extends Error {
  readonly marker: string;
  readonly packageIndex: number | undefined;
  constructor(marker: string, cause: unknown, packageIndex?: number) {
    super(`safety marker ${marker} did not commit: ${boundedErrorText(cause)}`);
    this.name = "PhaseMarkerPersistenceError";
    this.marker = marker;
    this.packageIndex = packageIndex;
  }
}

/**
 * A provider reported success but its settled marker did not commit, so the
 * post exists and durable state cannot prove it.
 *
 * Deliberately its own type: routing this through the ordinary failure path
 * would record a live published post as a plain failure, which is exactly the
 * silent-mutation case the design forbids.
 */
export class UncertainProviderOutcomeError extends Error {
  readonly packageIndex: number;
  readonly platform: string;
  readonly providerPostId: string | undefined;
  constructor(packageIndex: number, platform: string, providerPostId: string | undefined, cause: unknown) {
    super(
      `uncertain provider outcome on ${platform} (package ${packageIndex}): `
      + `provider reported success but the settled marker did not commit: ${boundedErrorText(cause)}`,
    );
    this.name = "UncertainProviderOutcomeError";
    this.packageIndex = packageIndex;
    this.platform = platform;
    this.providerPostId = providerPostId;
  }
}

export type RecoveryClass =
  | "interrupted_before_approval"
  | "interrupted_awaiting_approval"
  | "uncertain_provider_outcome"
  | "partial_known_publication"
  | "publication_complete_unrecorded";

export type ProviderMutation = "impossible" | "uncertain" | "partial_known" | "complete_known";

export interface SettledAttempt {
  packageIndex: number;
  platform: string;
  ok: boolean;
  providerPostId?: string;
  error?: string;
}

export interface UnsettledAttempt {
  packageIndex: number;
  platform: string;
}

export interface RecoveryClassification {
  classification: RecoveryClass;
  approvalId?: string;
  packageCount?: number;
  providerMutation: ProviderMutation;
  terminalStatus: "done" | "failed";
  reason: string;
  /** Attempts with a committed settled marker — the known outcomes. */
  settled: SettledAttempt[];
  /** Started with no settled marker — each is an unknown provider outcome. */
  unsettled: UnsettledAttempt[];
  /** Package indexes never attempted at all. */
  unattemptedPackageIndexes: number[];
  knownProviderPostIds: { packageIndex: number; platform: string; providerPostId: string }[];
  requiresRevocation: boolean;
  requiresEscalation: boolean;
}

function markerData(event: EventRow): any {
  const data = event.data as any;
  return data && typeof data === "object" ? data : {};
}

/**
 * Pure classifier. Exported so every interruption class is provable offline
 * without a database, a worker, or a provider.
 */
export function classifyInterruptedBrief(events: EventRow[]): RecoveryClassification {
  let approvalId: string | undefined;
  let packageCount: number | undefined;
  const startedByIndex = new Map<number, UnsettledAttempt>();
  const settledByIndex = new Map<number, SettledAttempt>();

  for (const event of events) {
    const data = markerData(event);
    if (event.kind === PHASE_APPROVAL_REQUESTED) {
      if (typeof data.approvalId === "string") approvalId = data.approvalId;
      if (Number.isSafeInteger(data.packageCount)) packageCount = data.packageCount;
    } else if (event.kind === PHASE_PUBLISH_ATTEMPT_STARTED) {
      if (!Number.isSafeInteger(data.packageIndex)) continue;
      startedByIndex.set(data.packageIndex, {
        packageIndex: data.packageIndex,
        platform: typeof data.platform === "string" ? data.platform : "unknown",
      });
    } else if (event.kind === PHASE_PUBLISH_ATTEMPT_SETTLED) {
      if (!Number.isSafeInteger(data.packageIndex)) continue;
      settledByIndex.set(data.packageIndex, {
        packageIndex: data.packageIndex,
        platform: typeof data.platform === "string" ? data.platform : "unknown",
        ok: data.ok === true,
        ...(typeof data.providerPostId === "string" ? { providerPostId: data.providerPostId } : {}),
        ...(typeof data.error === "string" ? { error: data.error } : {}),
      });
    }
  }

  const settled = [...settledByIndex.values()].sort((a, b) => a.packageIndex - b.packageIndex);
  const unsettled = [...startedByIndex.values()]
    .filter((attempt) => !settledByIndex.has(attempt.packageIndex))
    .sort((a, b) => a.packageIndex - b.packageIndex);
  const knownProviderPostIds = settled
    .filter((attempt) => attempt.ok && attempt.providerPostId)
    .map((attempt) => ({
      packageIndex: attempt.packageIndex,
      platform: attempt.platform,
      providerPostId: attempt.providerPostId!,
    }));

  const unattemptedPackageIndexes: number[] = [];
  if (packageCount !== undefined) {
    for (let index = 0; index < packageCount; index += 1) {
      if (!startedByIndex.has(index)) unattemptedPackageIndexes.push(index);
    }
  }

  const base = {
    approvalId,
    packageCount,
    settled,
    unsettled,
    unattemptedPackageIndexes,
    knownProviderPostIds,
  };

  // No approval marker committed, so requestApproval never completed and no
  // provider request was reachable — publication requires an approval id.
  if (!approvalId) {
    return {
      ...base,
      classification: "interrupted_before_approval",
      providerMutation: "impossible",
      terminalStatus: "failed",
      reason: "worker interrupted before an approval was durably requested",
      requiresRevocation: false,
      requiresEscalation: false,
    };
  }

  // An approval exists and a human may still act on it, but nothing is
  // listening. Revoking is what stops a later click authorizing a post that
  // will never publish — the exact August 10 failure shape.
  if (startedByIndex.size === 0) {
    return {
      ...base,
      classification: "interrupted_awaiting_approval",
      providerMutation: "impossible",
      terminalStatus: "failed",
      reason: "worker interrupted while the approval was outstanding; no publish was attempted",
      requiresRevocation: true,
      requiresEscalation: true,
    };
  }

  if (unsettled.length > 0) {
    const partial = knownProviderPostIds.length > 0;
    return {
      ...base,
      classification: partial ? "partial_known_publication" : "uncertain_provider_outcome",
      providerMutation: partial ? "partial_known" : "uncertain",
      terminalStatus: "failed",
      reason: partial
        ? "some platforms published before the worker was interrupted mid-attempt; the remainder is unknown"
        : "worker was interrupted after a provider attempt began and before its outcome was recorded",
      requiresRevocation: true,
      requiresEscalation: true,
    };
  }

  // Every started attempt settled, but packages remain unattempted: platform 1
  // is genuinely published and platform 2 never ran. This must never be
  // reported as zero provider mutation.
  if (unattemptedPackageIndexes.length > 0) {
    return {
      ...base,
      classification: "partial_known_publication",
      providerMutation: "partial_known",
      terminalStatus: "failed",
      reason: "worker was interrupted between platforms; earlier results are known and later platforms never ran",
      requiresRevocation: true,
      requiresEscalation: true,
    };
  }

  // Every package attempted and settled; only the final brief/approval writes
  // were lost. The outcome is fully known and can be reconstructed exactly.
  const allOk = settled.length > 0 && settled.every((attempt) => attempt.ok);
  return {
    ...base,
    classification: "publication_complete_unrecorded",
    providerMutation: "complete_known",
    terminalStatus: allOk ? "done" : "failed",
    reason: allOk
      ? "every platform settled successfully; only the final durable write was lost"
      : "every platform settled but at least one failed; only the final durable write was lost",
    requiresRevocation: false,
    requiresEscalation: !allOk,
  };
}

export interface RecoveryDeps {
  eventsForRun(runId: string): Promise<EventRow[]>;
  recordDurablePhaseEvent(e: { runId?: string; kind: string; message: string; data?: unknown }): Promise<void>;
  completeBrief(id: string, status: "done" | "failed", outcome: unknown): Promise<void>;
  revokeApproval(id: string, revokedBy: string, reason: string): Promise<{ ok: boolean; reason?: string }>;
  setApprovalStatus(id: string, status: "posted" | "failed"): Promise<void>;
  notifyEscalation(goal: string, reason: string, runId: string): Promise<void>;
  listRunningBriefs(): Promise<{ id: string; brief: any; claimedAt?: string }[]>;
  listRevocablePendingApprovals(): Promise<string[]>;
  runIdsWithApprovalMarker(approvalIds: string[]): Promise<Set<string>>;
  log?: (message: string) => void;
  nowIso?: () => string;
}

export interface RecoveryResult {
  runId: string;
  classification: RecoveryClass;
  providerMutation: ProviderMutation;
  terminalStatus: "done" | "failed";
  approvalId?: string;
  revoked?: boolean;
  escalated?: boolean;
}

/**
 * Terminalizes one interrupted brief. Shared by startup recovery and the
 * coordinated shutdown path so both produce byte-identical durable state and
 * there is exactly one implementation of "finish an interrupted brief".
 */
export async function terminalizeInterruptedBrief(
  deps: RecoveryDeps,
  runId: string,
  context: { trigger: "startup_recovery" | "worker_shutdown" | "ownership_lost"; goal?: string },
): Promise<RecoveryResult> {
  const log = deps.log ?? ((message: string) => console.log(message));
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const events = await deps.eventsForRun(runId);
  const verdict = classifyInterruptedBrief(events);

  let revoked: boolean | undefined;
  if (verdict.requiresRevocation && verdict.approvalId) {
    const result = await deps.revokeApproval(
      verdict.approvalId,
      `worker:${context.trigger}`,
      `Brief ${runId} was interrupted (${verdict.classification}); a new approval must be requested.`,
    );
    revoked = result.ok;
  }

  // A fully settled run still needs its approval moved off `approved` so the
  // durable record matches what actually happened at the providers.
  if (verdict.classification === "publication_complete_unrecorded" && verdict.approvalId) {
    try {
      await deps.setApprovalStatus(verdict.approvalId, verdict.terminalStatus === "done" ? "posted" : "failed");
    } catch (err) {
      log(`[recovery] approval status repair failed for ${runId}: ${boundedErrorText(err)}`);
    }
  }

  const outcome = {
    reason: verdict.classification,
    trigger: context.trigger,
    reconciledAt: nowIso(),
    reconciledBy: `worker:${context.trigger}`,
    detail: verdict.reason,
    providerMutation: verdict.providerMutation,
    approvalId: verdict.approvalId,
    approvalRevoked: revoked,
    results: verdict.settled,
    unsettledAttempts: verdict.unsettled,
    unattemptedPackageIndexes: verdict.unattemptedPackageIndexes,
    knownProviderPostIds: verdict.knownProviderPostIds,
    published: verdict.classification === "publication_complete_unrecorded" && verdict.terminalStatus === "done",
    requiresProviderReconciliation: verdict.providerMutation === "uncertain"
      || verdict.providerMutation === "partial_known",
  };

  // Record the audit marker before the status change: a status that moved with
  // no explaining event is worse than an event with no status change, because
  // the console's history would still end at brief:awaiting_approval.
  await deps.recordDurablePhaseEvent({
    runId,
    kind: PHASE_RECONCILED,
    message: `interrupted brief reconciled as ${verdict.classification}`,
    data: outcome,
  });
  await deps.completeBrief(runId, verdict.terminalStatus, outcome);

  let escalated: boolean | undefined;
  if (verdict.requiresEscalation) {
    try {
      await deps.notifyEscalation(
        context.goal ?? "(interrupted brief)",
        `${verdict.classification}: ${verdict.reason}`
        + (verdict.knownProviderPostIds.length > 0
          ? ` Known published post IDs: ${verdict.knownProviderPostIds.map((p) => `${p.platform}=${p.providerPostId}`).join(", ")}.`
          : "")
        + (outcome.requiresProviderReconciliation
          ? " Manual provider reconciliation is required; automatic retry is refused."
          : ""),
        runId,
      );
      escalated = true;
    } catch (err) {
      escalated = false;
      log(`[recovery] escalation delivery failed for ${runId}: ${boundedErrorText(err)}`);
    }
  }

  log(`[recovery] brief ${runId} → ${verdict.terminalStatus} (${verdict.classification})`);
  return {
    runId,
    classification: verdict.classification,
    providerMutation: verdict.providerMutation,
    terminalStatus: verdict.terminalStatus,
    approvalId: verdict.approvalId,
    revoked,
    escalated,
  };
}

/**
 * Startup recovery. Only legal once exclusive ownership is held: at that
 * instant no other process can be consuming, so every remaining `running` row
 * provably has no live owner.
 */
export async function reconcileAbandonedWork(deps: RecoveryDeps): Promise<RecoveryResult[]> {
  const log = deps.log ?? ((message: string) => console.log(message));
  const running = await deps.listRunningBriefs();
  if (running.length === 0) {
    log("[recovery] no interrupted briefs found");
    return [];
  }

  // The queue loop is serial and ownership is exclusive, so a single row is the
  // normal maximum. More than one means an earlier failure went unnoticed.
  if (running.length > 1) {
    log(`[recovery] ANOMALY: ${running.length} briefs were left running; expected at most one`);
    try {
      await deps.notifyEscalation(
        "(worker recovery)",
        `${running.length} briefs were found in running state at startup, which should not be possible with a `
        + "serial single-owner worker. Investigate before relying on the queue.",
        running.map((row) => row.id).join(","),
      );
    } catch {
      /* escalation is best effort; recovery itself must still proceed */
    }
  }

  const results: RecoveryResult[] = [];
  for (const row of running) {
    results.push(await terminalizeInterruptedBrief(deps, row.id, {
      trigger: "startup_recovery",
      goal: typeof row.brief?.goal === "string" ? row.brief.goal : undefined,
    }));
  }
  return results;
}

/**
 * Narrow orphan sweep for approvals whose linking marker never committed.
 *
 * Such an approval has no brief pointing at it and no process waiting on it, so
 * a human could approve a package that can never publish. Anything with a
 * committed marker is left alone — that is a real brief's approval and belongs
 * to the per-brief recovery path above.
 */
export async function sweepOrphanApprovals(deps: RecoveryDeps): Promise<string[]> {
  const log = deps.log ?? ((message: string) => console.log(message));
  const pending = await deps.listRevocablePendingApprovals();
  if (pending.length === 0) return [];
  const linked = await deps.runIdsWithApprovalMarker(pending);
  const orphans = pending.filter((id) => !linked.has(id));
  const revoked: string[] = [];
  for (const approvalId of orphans) {
    const result = await deps.revokeApproval(
      approvalId,
      "worker:orphan_sweep",
      "Approval has no durable owning brief marker; submit a new approval request.",
    );
    if (!result.ok) {
      log(`[recovery] orphan approval ${approvalId} was not revocable: ${result.reason ?? "unknown"}`);
      continue;
    }
    revoked.push(approvalId);
    await deps.recordDurablePhaseEvent({
      kind: PHASE_ORPHAN_APPROVAL_REVOKED,
      message: "revoked a pending approval with no owning brief marker",
      data: { approvalId },
    });
  }
  if (revoked.length > 0) log(`[recovery] revoked ${revoked.length} orphan approval(s)`);
  return revoked;
}
