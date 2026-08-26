/**
 * Orchestration worker (Render `worker` service). Long-running. Polls the brief
 * queue, runs the manager loop, routes the package to the human approval gate,
 * and — ONLY on recorded approval — publishes via the posting tool.
 *
 * The Phase-A guarantee is structural: the exact provider-bound PostPackage[]
 * is stored and hash-bound before review. Publishing reloads that stored
 * subject and publishApprovedPackage verifies live durable approval plus an
 * exact item match immediately before every provider call.
 *
 * Two lifecycle guarantees sit on top of that:
 *
 *  - EXCLUSIVE OWNERSHIP. Render zero-downtime deploys keep the old worker
 *    alive while the new one starts, so both can briefly exist. A session-level
 *    advisory lock makes exactly one of them the owner. Ownership gates
 *    recovery, readiness, queue consumption, and every new external side
 *    effect — a worker that has lost the lock is no longer authorized to create
 *    approvals or call providers.
 *
 *  - NO SILENT ABANDONMENT. Every phase boundary commits a durable marker
 *    before its side effect, so an interrupted brief can be classified exactly
 *    rather than guessed at, and is always terminalized by someone: by itself
 *    during coordinated shutdown, or by the next exclusive owner at startup.
 */

import { config } from "../harness/config.js";
import {
  initState,
  stateEnabled,
  closeState,
  claimNextBrief,
  completeBrief,
  setApprovalStatus,
  recordEvent,
  recordDurablePhaseEvent,
  listRunningBriefs,
  listRevocablePendingApprovals,
  runIdsWithApprovalMarker,
  eventsForRun,
  revokeApproval,
} from "../harness/state.js";
import {
  assertPublishAllowed,
  requestApproval,
  waitForApproval,
  postingRequiresApproval,
  notifyEscalation,
} from "../harness/hitl.js";
import { runBrief } from "../harness/orchestrator.js";
import { publishApprovedPackage, PlatformCredentials, PostPackage } from "../mcp/posting-tool/index.js";
import { toPostPackages, summarize, FinalPackage } from "../harness/packageMap.js";
import { credsFromEnv } from "../harness/creds.js";
import { getCurrentIgToken } from "../harness/igToken.js";
import { getGoogleAccessToken } from "../harness/googleToken.js";
import { buildWorkerReadinessMarker } from "../harness/renderIdentity.js";
import { runWorkerStartup } from "./startup.js";
import {
  WorkerOwnership,
  OwnershipLostError,
  connectOwnershipClient,
} from "../harness/workerOwnership.js";
import { runPublication } from "../harness/publicationRunner.js";
import {
  reconcileAbandonedWork,
  sweepOrphanApprovals,
  terminalizeInterruptedBrief,
  boundedErrorText,
  PhaseMarkerPersistenceError,
  UncertainProviderOutcomeError,
  PHASE_APPROVAL_REQUESTED,
  RecoveryDeps,
} from "../harness/briefRecovery.js";

let running = true;
let shutdownRequested = false;
let ownership: WorkerOwnership | undefined;
let activeBrief: Promise<void> | undefined;

/** Aborted by SIGTERM or by ownership loss; threaded into every waiting path. */
const workAbort = new AbortController();

/** Bounded so cleanup finishes inside Render's shutdown grace period. */
const SHUTDOWN_DRAIN_MS = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Keep the (60-day-capped) Instagram-Login token fresh out-of-band so posting never lapses.
const TOKEN_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
let tokenTimer: ReturnType<typeof setInterval> | undefined;
async function igTokenTick(): Promise<void> {
  try {
    await getCurrentIgToken(Date.now());
  } catch (err) {
    console.error("[ig-token] tick error:", (err as Error).message);
  }
}

async function initializeIgToken(): Promise<void> {
  await getCurrentIgToken(Date.now());
}

const recoveryDeps: RecoveryDeps = {
  eventsForRun,
  recordDurablePhaseEvent,
  completeBrief,
  revokeApproval,
  setApprovalStatus,
  notifyEscalation,
  listRunningBriefs,
  listRevocablePendingApprovals,
  runIdsWithApprovalMarker,
};

/** True only while this process may still create new brief side effects. */
function sideEffectsAllowed(): boolean {
  return !shutdownRequested && ownership?.isOwner === true;
}

/**
 * The side-effect barrier. Called immediately before every boundary that
 * creates durable or external state for a brief. Losing the lock or entering
 * shutdown must stop new provider work at once, not merely at the next brief.
 */
function assertSideEffectAllowed(operation: string): void {
  if (!ownership) throw new Error(`BLOCKED: no worker ownership — refusing ${operation}`);
  ownership.assertOwned(operation);
  if (shutdownRequested) throw new WorkerShutdownError(operation);
}

class WorkerShutdownError extends Error {
  constructor(operation: string) {
    super(`worker is shutting down — refusing ${operation}`);
    this.name = "WorkerShutdownError";
  }
}

/**
 * Ends an interrupted brief.
 *
 * While ownership is still held, the brief terminalizes itself through the same
 * classifier the next owner would use, so shutdown and startup recovery produce
 * identical durable state. If ownership is already lost we deliberately write
 * NOTHING: another instance may hold the lock and be reconciling this very row,
 * and two writers is exactly what ownership exists to prevent.
 */
async function unwindInterruptedBrief(id: string, brief: any, stage: string): Promise<void> {
  if (ownership?.isOwner !== true) {
    console.error(
      `[worker] brief ${id} interrupted at ${stage} without ownership — leaving it for the next exclusive owner`,
    );
    return;
  }
  await terminalizeInterruptedBrief(recoveryDeps, id, {
    trigger: shutdownRequested ? "worker_shutdown" : "ownership_lost",
    goal: typeof brief?.goal === "string" ? brief.goal : undefined,
  });
}

async function processBrief(id: string, brief: any): Promise<void> {
  console.log(`[worker] running brief ${id}: ${brief?.goal ?? "(no goal)"}`);
  const outcome = await runBrief(brief, { runId: id });

  // runBrief performs local model/image computation that is not itself
  // abortable. Once it returns, no approval may be created and no provider call
  // may occur unless this process still owns the queue.
  if (!sideEffectsAllowed()) {
    await unwindInterruptedBrief(id, brief, "after orchestration");
    return;
  }

  if (outcome.status === "escalated") {
    console.log(`[worker] brief ${id} escalated: ${outcome.escalation}`);
    await notifyEscalation(brief?.goal ?? "(no goal)", outcome.escalation ?? "unknown reason", id);
    await completeBrief(id, "failed", { reason: outcome.escalation, cost: outcome.costUsd });
    return;
  }

  // awaiting_approval → route to the human gate.
  const pkg = outcome.package as FinalPackage;
  // All externally visible transformations already happened in
  // buildFinalPackage before the final critic. toPostPackages only validates
  // review/provider parity and clones that stored canonical array.
  const providerPayloads = toPostPackages(pkg);
  assertSideEffectAllowed("approval creation");
  const handle = await requestApproval({ summary: summarize(pkg), packageFormatted: providerPayloads });

  // The approval row and its Slack link now exist. If the linking marker does
  // not commit, no durable record ties this approval to this brief, so recovery
  // could never classify it and a human could approve something nothing is
  // waiting for. Revoke it rather than wait.
  try {
    await recordDurablePhaseEvent({
      runId: id,
      kind: PHASE_APPROVAL_REQUESTED,
      message: "approval requested and bound to this brief",
      data: { approvalId: handle.id, packageCount: providerPayloads.length },
    });
  } catch (err) {
    await handleApprovalMarkerFailure(id, brief, handle.id, err, outcome.costUsd);
    return;
  }

  console.log(`[worker] brief ${id} awaiting approval (id=${handle.id})`);
  const decision = await waitForApproval(handle.id, { signal: workAbort.signal });

  if (decision === "aborted") {
    await unwindInterruptedBrief(id, brief, "awaiting approval");
    return;
  }

  if (decision !== "approved") {
    console.log(`[worker] brief ${id} ${decision} — not publishing`);
    await completeBrief(id, "done", { decision, cost: outcome.costUsd });
    return;
  }

  // APPROVED → publish only the canonical subject reloaded from approval
  // storage. The posting tool re-loads and re-verifies it before every call.
  // Re-resolve live durable authorization before even acquiring platform
  // tokens. Each actual provider attempt repeats this check inside its guard.
  assertSideEffectAllowed("publication");
  const approval = await assertPublishAllowed<PostPackage[]>(handle.id);
  const approvedPayloads = approval.subject;
  assertSideEffectAllowed("platform credential acquisition");
  const creds = credsFromEnv();
  if (approvedPayloads.some((payload) => payload.platform === "instagram")) {
    // Use the auto-refreshed IG token (DB-backed) rather than the possibly-stale env value.
    const liveIgToken = await getCurrentIgToken(Date.now());
    if (liveIgToken) creds.igAccessToken = liveIgToken;
  }
  if (approvedPayloads.some((payload) => payload.platform === "gbp")) {
    // Acquire a fresh Google token only when this exact approval includes GBP.
    try {
      const googleAccessToken = await getGoogleAccessToken();
      if (googleAccessToken) creds.googleAccessToken = googleAccessToken;
    } catch (err) {
      console.error("[gbp] Google token refresh failed:", (err as Error).message);
    }
  }

  const publication = await runPublication(
    { publish: publishApprovedPackage, recordDurablePhaseEvent, assertSideEffectAllowed },
    { runId: id, approvalId: handle.id, payloads: approvedPayloads, creds },
  );
  if (publication.kind === "uncertain") {
    await handleUncertainProviderOutcome(id, brief, handle.id, publication.error, publication.results, outcome.costUsd);
    return;
  }
  if (publication.kind === "marker_failure") {
    await handlePublishMarkerFailure(id, brief, handle.id, publication.error, publication.results, outcome.costUsd);
    return;
  }
  if (publication.kind === "interrupted") {
    await unwindInterruptedBrief(id, brief, "publication");
    return;
  }
  const results = publication.results;

  const allOk = results.length > 0 && results.every((r) => r.ok);
  await setApprovalStatus(handle.id, allOk ? "posted" : "failed");
  await completeBrief(id, allOk ? "done" : "failed", { decision, results, cost: outcome.costUsd });
  console.log(`[worker] brief ${id} published: ${JSON.stringify(results)}`);
  void recordEvent({
    runId: id,
    kind: allOk ? "brief:published" : "brief:publish_failed",
    message: allOk ? "published to all platforms" : "one or more platforms failed",
    data: { results },
  }).catch(() => {});
}

/** Case A: the approval exists but nothing durably links it to this brief. */
async function handleApprovalMarkerFailure(
  id: string,
  brief: any,
  approvalId: string,
  err: unknown,
  costUsd: number | undefined,
): Promise<void> {
  const detail = boundedErrorText(err);
  console.error(`[worker] brief ${id} approval marker did not commit: ${detail}`);
  let revoked = false;
  try {
    const result = await revokeApproval(
      approvalId,
      "worker:marker_failure",
      "Approval could not be durably bound to its brief; submit a new approval request.",
    );
    revoked = result.ok;
  } catch (revokeErr) {
    console.error(`[worker] revocation after marker failure also failed: ${boundedErrorText(revokeErr)}`);
  }
  // Escalate first: if the database is unwritable, Slack is the only channel
  // that can carry the dangling approval id to a human.
  await safelyEscalate(
    brief,
    `Approval ${approvalId} was created but its durable binding marker failed (${detail}). `
    + (revoked
      ? "The approval has been revoked; no publication occurred."
      : "REVOCATION COULD NOT BE CONFIRMED — revoke it manually; the orphan sweep will also attempt it at next startup."),
    id,
  );
  await safelyTerminalize(id, "failed", {
    reason: "approval_marker_persistence_failed",
    approvalId,
    approvalRevoked: revoked,
    detail,
    published: false,
    providerMutation: "impossible",
    cost: costUsd,
  });
}

/** Case B: a started marker failed, so no provider call was made. */
async function handlePublishMarkerFailure(
  id: string,
  brief: any,
  approvalId: string,
  err: PhaseMarkerPersistenceError,
  results: any[],
  costUsd: number | undefined,
): Promise<void> {
  console.error(`[worker] brief ${id} publish marker failure: ${err.message}`);
  const priorPublished = results.filter((r) => r.ok);
  let revoked = false;
  try {
    revoked = (await revokeApproval(
      approvalId,
      "worker:marker_failure",
      "A publication safety marker failed to commit; submit a new approval request.",
    )).ok;
  } catch {
    /* reported through escalation below */
  }
  await safelyEscalate(
    brief,
    `Publication stopped because ${err.marker} did not commit (package ${err.packageIndex ?? "?"}). `
    + "No provider request was made for that package. "
    + (priorPublished.length > 0
      ? `Earlier platforms already published: ${priorPublished.map((r) => `${r.platform}=${r.id ?? "unknown-id"}`).join(", ")}.`
      : "No platform had published yet."),
    id,
  );
  await safelyTerminalize(id, "failed", {
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
  });
}

/** Case C: provider succeeded but its settled marker did not commit. */
async function handleUncertainProviderOutcome(
  id: string,
  brief: any,
  approvalId: string,
  err: UncertainProviderOutcomeError,
  results: any[],
  costUsd: number | undefined,
): Promise<void> {
  console.error(`[worker] brief ${id} UNCERTAIN provider outcome: ${err.message}`);
  let revoked = false;
  try {
    revoked = (await revokeApproval(
      approvalId,
      "worker:uncertain_outcome",
      "A provider mutation could not be durably recorded; submit a new approval request after reconciliation.",
    )).ok;
  } catch {
    /* reported through escalation below */
  }
  // The provider post id may exist nowhere else if the database is unwritable,
  // so it must reach a human out-of-band.
  await safelyEscalate(
    brief,
    `UNCERTAIN PROVIDER OUTCOME on ${err.platform} (package ${err.packageIndex}). `
    + `The provider reported success${err.providerPostId ? ` with post id ${err.providerPostId}` : ""}, `
    + "but the settled marker did not commit. Remaining platforms were NOT attempted and no automatic retry "
    + "will occur. Reconcile against the platform before issuing a new approval.",
    id,
  );
  await safelyTerminalize(id, "failed", {
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
  });
}

async function safelyEscalate(brief: any, reason: string, runId: string): Promise<void> {
  try {
    await notifyEscalation(brief?.goal ?? "(no goal)", reason, runId);
  } catch (err) {
    console.error(`[worker] escalation delivery failed for ${runId}: ${boundedErrorText(err)}`);
  }
}

/**
 * Best-effort terminal write for the marker-failure paths. The database may be
 * the thing that is broken; if this also fails, the brief stays `running` and
 * the next exclusive owner reconciles it from the markers that did commit.
 */
async function safelyTerminalize(id: string, status: "done" | "failed", outcome: unknown): Promise<void> {
  try {
    await completeBrief(id, status, outcome);
  } catch (err) {
    console.error(
      `[worker] terminal write failed for ${id} (${boundedErrorText(err)}); `
      + "leaving it for the next exclusive owner to reconcile",
    );
  }
}

async function loop(): Promise<void> {
  while (running) {
    let claimed: { id: string; brief: any } | null = null;
    try {
      claimed = await claimNextBrief();
    } catch (err) {
      console.error("[worker] claim error:", (err as Error).message);
    }
    if (!claimed) {
      await sleep(10_000);
      continue;
    }
    const work = (async () => {
      try {
        if (!config.anthropicApiKey) {
          console.warn("[worker] ANTHROPIC_API_KEY not set — cannot run brief; marking failed");
          await completeBrief(claimed!.id, "failed", { reason: "no ANTHROPIC_API_KEY" });
        } else {
          await processBrief(claimed!.id, claimed!.brief);
        }
      } catch (err) {
        if (err instanceof OwnershipLostError) {
          // Never write: another owner may already be reconciling this row.
          console.error(`[worker] brief ${claimed!.id} abandoned without ownership: ${err.message}`);
          running = false;
          return;
        }
        if (err instanceof WorkerShutdownError) {
          await unwindInterruptedBrief(claimed!.id, claimed!.brief, "shutdown boundary");
          return;
        }
        console.error(`[worker] brief ${claimed!.id} error:`, (err as Error).message);
        await completeBrief(claimed!.id, "failed", { reason: (err as Error).message });
      }
    })();
    activeBrief = work;
    try {
      await work;
    } finally {
      activeBrief = undefined;
    }
  }
}

async function main(): Promise<void> {
  // A worker-local Map cannot share briefs or approvals with the API process.
  // Refuse startup unless the durable backend is configured and reachable.
  await runWorkerStartup({
    initializeState: async () => {
      await initState({ requireDurable: true });
      console.log(`[worker] autonomy phase: ${config.autonomyPhase} · posting requires approval: ${postingRequiresApproval()}`);
      const state = stateEnabled() ? "postgres" as const : "ephemeral" as const;
      console.log(`[worker] state backend: ${state}`);
      return state;
    },
    acquireOwnership: async () => {
      const databaseUrl = config.databaseUrl;
      if (!databaseUrl) throw new Error("DATABASE_URL is required for exclusive worker ownership");
      ownership = await WorkerOwnership.acquire({
        connect: () => connectOwnershipClient(databaseUrl),
        signal: workAbort.signal,
        onLost: () => {
          // Stop claiming and wake anything waiting; the active brief unwinds
          // without writing, because another owner may already have the lock.
          running = false;
          workAbort.abort();
        },
      });
      return ownership;
    },
    startOwnershipMonitoring: (owned) => owned.startMonitoring(),
    reconcileAbandonedWork: async () => {
      await reconcileAbandonedWork(recoveryDeps);
      await sweepOrphanApprovals(recoveryDeps);
    },
    initializeRequiredServices: async () => {
      if (config.activePlatforms.includes("instagram")) {
        // Unexpected initialization failures must prevent readiness. Recurring
        // refresh failures remain caught and surfaced by igTokenTick.
        await initializeIgToken();
      }
    },
    buildReadiness: (state) => buildWorkerReadinessMarker(state),
    startRecurringServices: () => {
      if (config.activePlatforms.includes("instagram")) {
        tokenTimer = setInterval(() => void igTokenTick(), TOKEN_REFRESH_INTERVAL_MS);
      }
    },
    emitReadiness: (marker) => console.log(marker),
    consumeQueue: () => loop(),
  });
}

/**
 * Coordinated shutdown.
 *
 * The handler never finalizes a brief itself — it signals, and the active
 * processBrief unwinds through its own safe path. That keeps exactly one writer
 * for any given brief. Ownership and the database are retained throughout
 * cleanup and released last, so a successor cannot begin reconciling until this
 * process is genuinely finished.
 */
async function shutdown(signal: string): Promise<void> {
  if (shutdownRequested) return;
  shutdownRequested = true;
  running = false;
  console.log(`[worker] received ${signal}, draining`);
  workAbort.abort();

  if (activeBrief) {
    let drained = false;
    await Promise.race([
      activeBrief.then(() => { drained = true; }).catch(() => { drained = true; }),
      sleep(SHUTDOWN_DRAIN_MS),
    ]);
    if (!drained) {
      // Do not guess at the brief's state from out here. Session death releases
      // ownership and the next exclusive owner reconciles it from the markers.
      console.warn(
        "[worker] active brief did not finish within the drain window; "
        + "leaving it for the next exclusive owner to reconcile",
      );
    }
  }

  if (tokenTimer) clearInterval(tokenTimer);
  ownership?.stopMonitoring();
  await closeState().catch(() => {});
  await ownership?.release().catch(() => {});
  console.log(`[worker] shutdown complete after ${signal}`);
  process.exit(0);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { void shutdown(sig); });
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
