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
 * Three lifecycle guarantees sit on top of that:
 *
 *  - EXCLUSIVE OWNERSHIP. Render zero-downtime deploys keep the old worker
 *    alive while the new one starts, so both can briefly exist. A session-level
 *    advisory lock makes exactly one of them the owner. Ownership gates
 *    recovery, readiness, queue consumption, the pending→running claim itself,
 *    and every new external or terminal write.
 *
 *  - NO SILENT ABANDONMENT. Every phase boundary commits a durable marker
 *    before its side effect, so an interrupted brief can be classified exactly
 *    rather than guessed at, and is always terminalized by someone: by itself
 *    during coordinated shutdown, or by the next exclusive owner at startup.
 *
 *  - LOSING OWNERSHIP ENDS THE PROCESS. A worker that no longer owns the queue
 *    is not merely idle, it is unsafe to keep alive: it must stop, decline all
 *    writes, and exit nonzero so Render restarts it into the ordinary
 *    acquisition path. Recurring timers and pooled connections would otherwise
 *    hold the event loop open and leave a healthy-looking permanently idle
 *    process behind.
 */

import { config } from "../harness/config.js";
import {
  initState,
  stateEnabled,
  closeState,
  completeBrief,
  setApprovalStatus,
  recordEvent,
  recordDurablePhaseEvent,
  listRunningBriefs,
  listRevocablePendingApprovals,
  approvalIdsWithOwningBriefMarker,
  phaseMarkersForRun,
  revokeApproval,
  CLAIM_PENDING_BRIEF_SQL,
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
import { toPostPackages, summarize } from "../harness/packageMap.js";
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
import { runBriefLifecycle, LifecycleDeps } from "../harness/briefLifecycle.js";
import {
  finalizeWorkerExit,
  WorkerExitMode,
  WorkerExitSteps,
  OWNERSHIP_LOSS_DRAIN_MS,
  SHUTDOWN_DRAIN_MS,
} from "../harness/workerExit.js";
import {
  reconcileAbandonedWork,
  sweepOrphanApprovals,
  terminalizeInterruptedBrief,
  boundedErrorText,
  RecoveryDeps,
} from "../harness/briefRecovery.js";

let running = true;
let shutdownRequested = false;
let ownershipLost = false;
let ownership: WorkerOwnership | undefined;
let activeBrief: Promise<void> | undefined;
let exiting = false;

/** Aborted by SIGTERM or by ownership loss; threaded into every waiting path. */
const workAbort = new AbortController();

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
  phaseMarkersForRun,
  recordDurablePhaseEvent,
  completeBrief,
  revokeApproval,
  setApprovalStatus,
  notifyEscalation,
  listRunningBriefs,
  listRevocablePendingApprovals,
  approvalIdsWithOwningBriefMarker,
};

class WorkerShutdownError extends Error {
  constructor(operation: string) {
    super(`worker is shutting down — refusing ${operation}`);
    this.name = "WorkerShutdownError";
  }
}

/** True only while this process may still create new brief side effects. */
function sideEffectsAllowed(): boolean {
  return !shutdownRequested && ownership?.isOwner === true;
}

function ownershipHeld(): boolean {
  return ownership?.isOwner === true;
}

/**
 * The side-effect barrier. Called immediately before every boundary that
 * creates durable or external state for a brief, and again as late as possible
 * before each provider request.
 */
function assertSideEffectAllowed(operation: string): void {
  if (!ownership) throw new Error(`BLOCKED: no worker ownership — refusing ${operation}`);
  ownership.assertOwned(operation);
  if (shutdownRequested) throw new WorkerShutdownError(operation);
}

async function acquireCredentials(approvedPayloads: PostPackage[]): Promise<PlatformCredentials> {
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
  return creds;
}

const lifecycleDeps: LifecycleDeps = {
  runBrief,
  toPostPackages,
  summarize,
  requestApproval: (req) => requestApproval(req),
  recordDurablePhaseEvent,
  waitForApproval,
  assertPublishAllowed: (id) => assertPublishAllowed<PostPackage[]>(id),
  acquireCredentials,
  publishAll: (ctx) => runPublication(
    {
      publish: publishApprovedPackage,
      recordDurablePhaseEvent,
      assertSideEffectAllowed,
      ownershipHeld,
    },
    ctx,
  ),
  completeBrief,
  setApprovalStatus,
  revokeApproval,
  notifyEscalation,
  terminalizeInterruptedBrief: (runId, goal) => terminalizeInterruptedBrief(recoveryDeps, runId, {
    trigger: shutdownRequested ? "worker_shutdown" : "ownership_lost",
    goal,
  }),
  assertSideEffectAllowed,
  sideEffectsAllowed,
  ownershipHeld,
  abortSignal: workAbort.signal,
  recordEvent: (e) => { void recordEvent(e).catch(() => {}); },
  log: (message) => console.log(message),
};

async function loop(): Promise<void> {
  while (running) {
    let claimed: { id: string; brief: any } | null = null;
    try {
      // Claimed ON the ownership session, so the pending→running transition can
      // only commit while this process is still the exclusive owner. Claiming
      // through the shared pool left a window in which a successor could finish
      // its startup reconciliation before an older claim landed, creating a
      // fresh running row that nothing would ever reconcile.
      claimed = await ownership!.claimPendingBrief(CLAIM_PENDING_BRIEF_SQL);
    } catch (err) {
      if (err instanceof OwnershipLostError) {
        console.error(`[worker] claim refused: ${err.message}`);
        running = false;
        break;
      }
      console.error("[worker] claim error:", (err as Error).message);
    }
    if (!claimed) {
      if (!running) break;
      await sleep(10_000);
      continue;
    }
    const work = (async () => {
      try {
        if (!config.anthropicApiKey) {
          console.warn("[worker] ANTHROPIC_API_KEY not set — cannot run brief; marking failed");
          if (ownershipHeld()) {
            await completeBrief(claimed!.id, "failed", { reason: "no ANTHROPIC_API_KEY" });
          }
        } else {
          await runBriefLifecycle(lifecycleDeps, claimed!.id, claimed!.brief);
        }
      } catch (err) {
        if (err instanceof OwnershipLostError) {
          // Never write: a successor may already be reconciling this row.
          console.error(`[worker] brief ${claimed!.id} abandoned without ownership: ${err.message}`);
          running = false;
          return;
        }
        if (err instanceof WorkerShutdownError) {
          if (ownershipHeld()) {
            await terminalizeInterruptedBrief(recoveryDeps, claimed!.id, {
              trigger: "worker_shutdown",
              goal: typeof claimed!.brief?.goal === "string" ? claimed!.brief.goal : undefined,
            }).catch(() => {});
          }
          return;
        }
        console.error(`[worker] brief ${claimed!.id} error:`, (err as Error).message);
        if (ownershipHeld()) {
          await completeBrief(claimed!.id, "failed", { reason: (err as Error).message }).catch(() => {});
        }
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
        onLost: (reason, error) => { void handleOwnershipLoss(reason, error); },
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

/** Shared cleanup wiring for both exit modes; the ordering lives in workerExit. */
function exitSteps(): WorkerExitSteps {
  return {
    drainActiveWork: async (timeoutMs) => {
      if (!activeBrief) return true;
      let drained = false;
      await Promise.race([
        activeBrief.then(() => { drained = true; }).catch(() => { drained = true; }),
        sleep(timeoutMs),
      ]);
      return drained;
    },
    stopRecurringServices: () => {
      if (tokenTimer) clearInterval(tokenTimer);
      ownership?.stopMonitoring();
    },
    escalate: async (reason) => {
      await Promise.race([
        notifyEscalation("(worker ownership)", reason, "worker-ownership-loss"),
        sleep(5_000),
      ]);
    },
    closeState: async () => { await Promise.race([closeState(), sleep(5_000)]); },
    releaseOwnership: async () => { await ownership?.release(); },
    log: (message) => console.log(message),
  };
}

async function finish(mode: WorkerExitMode, reason?: string): Promise<void> {
  const result = await finalizeWorkerExit(mode, exitSteps(), {
    reason,
    drainMs: mode === "ownership_lost" ? OWNERSHIP_LOSS_DRAIN_MS : SHUTDOWN_DRAIN_MS,
  });
  process.exit(result.code);
}

/**
 * Ownership loss is terminal for this process. It writes nothing, releases
 * nothing, and exits nonzero so Render restarts it into acquisition.
 */
async function handleOwnershipLoss(reason: string, error?: Error): Promise<void> {
  if (exiting) return;
  exiting = true;
  ownershipLost = true;
  running = false;
  console.error(
    `[worker] OWNERSHIP LOST (${reason}): ${error ? boundedErrorText(error) : "no detail"} — `
    + "stopping all work and exiting for restart",
  );
  workAbort.abort();
  await finish(
    "ownership_lost",
    `Worker lost exclusive ownership (${reason}) and is exiting for restart. `
    + "Any in-flight brief is left for the next exclusive owner to reconcile.",
  );
}

/**
 * Coordinated shutdown for an expected SIGTERM, while ownership is still held.
 * The handler never finalizes a brief itself — it signals, and the active
 * lifecycle unwinds through its own path, keeping exactly one writer per brief.
 */
async function shutdown(signal: string): Promise<void> {
  if (exiting || ownershipLost) return;
  exiting = true;
  shutdownRequested = true;
  running = false;
  console.log(`[worker] received ${signal}, draining`);
  workAbort.abort();
  await finish("shutdown");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { void shutdown(sig); });
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
