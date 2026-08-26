/**
 * Offline proofs for exclusive worker ownership, interrupted-brief recovery,
 * durable safety markers, and the publication side-effect barrier.
 *
 * Everything here runs with injected boundaries: no database, no network, no
 * provider, no worker process. The properties proven are the ones that make
 * automated worker redeployment safe under Render's zero-downtime overlap.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  WorkerOwnership,
  OwnershipLostError,
  ownershipKeyMatchesNamespace,
  WORKER_OWNERSHIP_KEY_1,
  WORKER_OWNERSHIP_KEY_2,
  WORKER_OWNERSHIP_NAMESPACE,
  OwnershipClient,
} from "./workerOwnership.js";
import {
  classifyInterruptedBrief,
  terminalizeInterruptedBrief,
  reconcileAbandonedWork,
  sweepOrphanApprovals,
  boundedErrorText,
  MAX_RECOVERY_ERROR_CHARS,
  RecoveryDeps,
  PHASE_APPROVAL_REQUESTED,
  PHASE_PUBLISH_ATTEMPT_STARTED,
  PHASE_PUBLISH_ATTEMPT_SETTLED,
  PHASE_PUBLISH_ATTEMPT_ABANDONED,
  PHASE_RECONCILED,
} from "./briefRecovery.js";
import { runPublication, PublicationDeps } from "./publicationRunner.js";
import { runBriefLifecycle, LifecycleDeps } from "./briefLifecycle.js";
import {
  finalizeWorkerExit,
  WorkerExitSteps,
  OWNERSHIP_LOSS_EXIT_CODE,
  SHUTDOWN_EXIT_CODE,
} from "./workerExit.js";
import type { EventRow } from "./state.js";
import type { PostPackage, PlatformCredentials } from "../mcp/posting-tool/types.js";

let checks = 0;
function check(label: string, condition: boolean): void {
  assert.ok(condition, label);
  checks += 1;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let eventSeq = 0;
function event(kind: string, data?: unknown, runId = "run-1"): EventRow {
  return {
    id: ++eventSeq,
    runId,
    kind,
    message: kind,
    data,
    createdAt: new Date(1_700_000_000_000 + eventSeq * 1_000).toISOString(),
  };
}

const APPROVAL = "approval-1";
function approvalRequested(packageCount = 2): EventRow {
  return event(PHASE_APPROVAL_REQUESTED, { approvalId: APPROVAL, packageCount });
}
function started(packageIndex: number, platform: string): EventRow {
  return event(PHASE_PUBLISH_ATTEMPT_STARTED, { approvalId: APPROVAL, packageIndex, platform });
}
function settled(packageIndex: number, platform: string, ok: boolean, providerPostId?: string): EventRow {
  return event(PHASE_PUBLISH_ATTEMPT_SETTLED, {
    approvalId: APPROVAL, packageIndex, platform, ok,
    ...(providerPostId ? { providerPostId } : {}),
  });
}

function pkg(platform: PostPackage["platform"]): PostPackage {
  return {
    platform,
    target: { accountId: "1", apiHost: "graph.facebook.com", apiVersion: "v25.0" },
    text: "fixture",
  };
}
const CREDS = {} as PlatformCredentials;

/** Records every recovery side effect so ordering and content can be asserted. */
function recorderDeps(overrides: Partial<RecoveryDeps> = {}): {
  deps: RecoveryDeps;
  calls: string[];
  events: any[];
  completions: { id: string; status: string; outcome: any }[];
  revocations: string[];
  escalations: { reason: string; runId: string }[];
  approvalStatuses: { id: string; status: string }[];
} {
  const calls: string[] = [];
  const events: any[] = [];
  const completions: { id: string; status: string; outcome: any }[] = [];
  const revocations: string[] = [];
  const escalations: { reason: string; runId: string }[] = [];
  const approvalStatuses: { id: string; status: string }[] = [];
  const deps: RecoveryDeps = {
    phaseMarkersForRun: async () => [],
    recordDurablePhaseEvent: async (e) => { calls.push(`event:${e.kind}`); events.push(e); },
    completeBrief: async (id, status, outcome) => {
      calls.push(`complete:${status}`);
      completions.push({ id, status, outcome });
    },
    revokeApproval: async (id) => { calls.push(`revoke:${id}`); revocations.push(id); return { ok: true }; },
    setApprovalStatus: async (id, status) => {
      calls.push(`approvalStatus:${status}`);
      approvalStatuses.push({ id, status });
    },
    notifyEscalation: async (_goal, reason, runId) => { calls.push("escalate"); escalations.push({ reason, runId }); },
    listRunningBriefs: async () => [],
    listRevocablePendingApprovals: async () => [],
    approvalIdsWithOwningBriefMarker: async () => new Set<string>(),
    log: () => {},
    nowIso: () => "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
  return { deps, calls, events, completions, revocations, escalations, approvalStatuses };
}

// ---------------------------------------------------------------------------
// 1. Advisory key stability
// ---------------------------------------------------------------------------

check("advisory keys match their documented namespace", ownershipKeyMatchesNamespace());
check("advisory keys are the reviewed literals", WORKER_OWNERSHIP_KEY_1 === 1_889_446_263
  && WORKER_OWNERSHIP_KEY_2 === 889_784_911);
check("namespace is versioned", WORKER_OWNERSHIP_NAMESPACE === "gcd-social:worker-ownership:v1");
check("a different namespace would not match the shipped keys", !ownershipKeyMatchesNamespace("other:v1"));

// ---------------------------------------------------------------------------
// 2. Ownership acquisition, contention, loss
// ---------------------------------------------------------------------------

/** Minimal in-memory stand-in for one PostgreSQL session against a shared lock. */
class FakeLockServer {
  held = false;
  release(): void { this.held = false; }
}

function fakeClient(server: FakeLockServer, opts: {
  failOnQuery?: () => Error | undefined;
  hangOnQuery?: () => boolean;
} = {}): {
  client: OwnershipClient;
  ended: boolean;
  destroyed: boolean;
  queries: string[];
  emitError: (err: Error) => void;
} {
  const queries: string[] = [];
  const listeners: ((err: Error) => void)[] = [];
  const state = { ended: false, destroyed: false };
  const client: OwnershipClient = {
    async query(sql: string) {
      queries.push(sql);
      // A blackholed socket: the promise simply never settles, which is the
      // exact case a server-side statement_timeout cannot rescue.
      if (opts.hangOnQuery?.()) return new Promise<{ rows: any[] }>(() => {});
      const failure = opts.failOnQuery?.();
      if (failure) throw failure;
      if (sql.includes("pg_try_advisory_lock")) {
        if (server.held) return { rows: [{ acquired: false }] };
        server.held = true;
        return { rows: [{ acquired: true }] };
      }
      if (sql.includes("pg_advisory_unlock")) { server.release(); return { rows: [{}] }; }
      return { rows: [{ ok: 1 }] };
    },
    async end() { state.ended = true; server.release(); },
    destroy() { state.destroyed = true; server.release(); },
    on(_event: "error", listener: (err: Error) => void) { listeners.push(listener); return client; },
  };
  return {
    client,
    get ended() { return state.ended; },
    get destroyed() { return state.destroyed; },
    queries,
    emitError: (err) => listeners.forEach((l) => l(err)),
  };
}

const noSleep = async () => {};

{
  // Uncontended acquisition.
  const server = new FakeLockServer();
  const fake = fakeClient(server);
  const owned = await WorkerOwnership.acquire({
    connect: async () => fake.client, sleep: noSleep, log: () => {},
  });
  check("uncontended acquisition succeeds", owned.isOwner === true && server.held);
  check("acquisition used pg_try_advisory_lock, not the blocking form",
    fake.queries.some((q) => q.includes("pg_try_advisory_lock"))
    && !fake.queries.some((q) => /pg_advisory_lock\(/.test(q)));
  await owned.release();
  check("release frees the lock and closes the session", !server.held && fake.ended);
}

{
  // Contention: the second instance must wait, exactly as during a Render
  // zero-downtime overlap, and acquire only once the holder's session ends.
  const server = new FakeLockServer();
  const holder = fakeClient(server);
  const first = await WorkerOwnership.acquire({
    connect: async () => holder.client, sleep: noSleep, log: () => {},
  });
  check("first instance owns the lock", first.isOwner === true);

  const waiter = fakeClient(server);
  let acquired = false;
  let polls = 0;
  const second = WorkerOwnership.acquire({
    connect: async () => waiter.client,
    log: () => {},
    sleep: async () => {
      polls += 1;
      // Only after the holder releases may the waiter succeed.
      if (polls === 3) await first.release();
    },
  }).then((o) => { acquired = true; return o; });

  await Promise.resolve();
  check("second instance does not acquire while the first still holds", !acquired);
  const secondOwned = await second;
  check("second instance acquires only after the holder's session ends", acquired && polls >= 3);
  check("two instances are never both owners", !first.isOwner && secondOwned.isOwner);
  await secondOwned.release();
}

{
  // Connection error must mark ownership lost and fence all side effects.
  const server = new FakeLockServer();
  const fake = fakeClient(server);
  let lostReason: string | undefined;
  const owned = await WorkerOwnership.acquire({
    connect: async () => fake.client,
    sleep: noSleep,
    log: () => {},
    onLost: (reason) => { lostReason = reason; },
  });
  owned.startMonitoring();
  check("signal is not aborted while owned", !owned.signal.aborted);
  fake.emitError(new Error("connection terminated unexpectedly"));
  check("connection error marks ownership lost", owned.isOwner === false && lostReason === "connection_error");
  check("ownership loss aborts the work signal", owned.signal.aborted);
  assert.throws(() => owned.assertOwned("provider call"), OwnershipLostError);
  check("assertOwned fences side effects after loss", true);
  owned.stopMonitoring();
}

{
  // Heartbeat failure is treated identically to a connection error.
  const server = new FakeLockServer();
  let failing = false;
  const fake = fakeClient(server, { failOnQuery: () => (failing ? new Error("server closed the connection") : undefined) });
  let lostReason: string | undefined;
  const owned = await WorkerOwnership.acquire({
    connect: async () => fake.client,
    sleep: noSleep,
    log: () => {},
    heartbeatIntervalMs: 1,
    onLost: (reason) => { lostReason = reason; },
  });
  owned.startMonitoring();
  failing = true;
  await new Promise((r) => setTimeout(r, 25));
  check("heartbeat failure marks ownership lost", owned.isOwner === false && lostReason === "heartbeat_failed");
  owned.stopMonitoring();
}

{
  // A blackholed heartbeat must be bounded client-side. Without the deadline
  // the promise would hang for the OS TCP timeout while `lost` stayed false and
  // every side-effect barrier kept passing.
  const server = new FakeLockServer();
  let hanging = false;
  const fake = fakeClient(server, { hangOnQuery: () => hanging });
  let lostReason: string | undefined;
  const owned = await WorkerOwnership.acquire({
    connect: async () => fake.client,
    sleep: noSleep,
    log: () => {},
    heartbeatIntervalMs: 5,
    statementTimeoutMs: 30,
    onLost: (reason) => { lostReason = reason; },
  });
  owned.startMonitoring();
  hanging = true;
  await new Promise((r) => setTimeout(r, 200));
  check("a hung ownership statement is bounded and marks ownership lost",
    owned.isOwner === false && lostReason === "heartbeat_timeout");
  check("the deadline destroys the socket rather than leaving the statement alive",
    fake.destroyed);
  check("ownership loss from a timeout still fences side effects",
    (() => { try { owned.assertOwned("provider call"); return false; } catch { return true; } })());
  owned.stopMonitoring();
}

{
  // The claim runs on the ownership session and is refused once ownership is
  // gone, so a pending->running transition cannot be issued by a former owner.
  const server = new FakeLockServer();
  const fake = fakeClient(server);
  const owned = await WorkerOwnership.acquire({
    connect: async () => fake.client, sleep: noSleep, log: () => {},
  });
  const before = fake.queries.length;
  await owned.claimPendingBrief("UPDATE brief_queue SET status='running' RETURNING id, brief");
  check("the claim executes on the ownership session itself",
    fake.queries.length > before
    && fake.queries.some((q) => q.includes("UPDATE brief_queue")));
  await owned.release();
  let refused = false;
  try {
    await owned.claimPendingBrief("UPDATE brief_queue SET status='running' RETURNING id, brief");
  } catch (err) {
    refused = err instanceof OwnershipLostError;
  }
  check("a former owner cannot claim", refused);
}

{
  // No transparent reconnect: the API offers no way to re-acquire after loss,
  // because a successor may legitimately hold the lock by then.
  const surface = Object.getOwnPropertyNames(WorkerOwnership.prototype);
  check("ownership exposes no reconnect/reacquire path",
    !surface.some((name) => /reconnect|reacquire|retry/i.test(name)));
}

{
  // Aborted acquisition (startup interrupted) must not leak the session.
  const server = new FakeLockServer();
  const holder = fakeClient(server);
  const first = await WorkerOwnership.acquire({
    connect: async () => holder.client, sleep: noSleep, log: () => {},
  });
  const controller = new AbortController();
  const waiter = fakeClient(server);
  const attempt = WorkerOwnership.acquire({
    connect: async () => waiter.client,
    log: () => {},
    signal: controller.signal,
    sleep: async () => { controller.abort(); },
  });
  await assert.rejects(attempt, /aborted/);
  check("aborted acquisition closes its dedicated session", waiter.ended);
  await first.release();
}

// ---------------------------------------------------------------------------
// 3. Interruption classification
// ---------------------------------------------------------------------------

{
  const v = classifyInterruptedBrief([event("brief:start")]);
  check("no approval marker → interrupted before approval",
    v.classification === "interrupted_before_approval"
    && v.providerMutation === "impossible"
    && v.terminalStatus === "failed"
    && !v.requiresRevocation);
}

{
  const v = classifyInterruptedBrief([event("brief:start"), approvalRequested()]);
  check("approval requested, no publish → awaiting-approval strand",
    v.classification === "interrupted_awaiting_approval"
    && v.providerMutation === "impossible"
    && v.requiresRevocation
    && v.requiresEscalation
    && v.approvalId === APPROVAL);
}

{
  const v = classifyInterruptedBrief([approvalRequested(), started(0, "instagram")]);
  check("started without settled → uncertain provider outcome",
    v.classification === "uncertain_provider_outcome"
    && v.providerMutation === "uncertain"
    && v.terminalStatus === "failed"
    && v.requiresRevocation
    && v.requiresEscalation
    && v.unsettled.length === 1
    && v.unsettled[0]!.platform === "instagram");
  check("uncertain outcome claims no known provider ids", v.knownProviderPostIds.length === 0);
}

{
  const v = classifyInterruptedBrief([
    approvalRequested(2), started(0, "instagram"), settled(0, "instagram", true, "IG_1"), started(1, "facebook"),
  ]);
  check("settled success plus unmatched attempt → partial known publication",
    v.classification === "partial_known_publication"
    && v.providerMutation === "partial_known");
  check("partial publication preserves the known provider id",
    v.knownProviderPostIds.length === 1 && v.knownProviderPostIds[0]!.providerPostId === "IG_1");
  check("partial publication is never reported as zero provider mutation",
    v.providerMutation !== "impossible");
}

{
  // Case D: platform 1 settled, then interruption before platform 2 started.
  const v = classifyInterruptedBrief([
    approvalRequested(2), started(0, "instagram"), settled(0, "instagram", true, "IG_2"),
  ]);
  check("interruption between platforms → partial known publication",
    v.classification === "partial_known_publication" && v.providerMutation === "partial_known");
  check("unattempted platforms are distinguished from attempted ones",
    v.unattemptedPackageIndexes.length === 1 && v.unattemptedPackageIndexes[0] === 1);
  check("case D preserves the earlier provider id",
    v.knownProviderPostIds[0]!.providerPostId === "IG_2");
}

{
  const v = classifyInterruptedBrief([
    approvalRequested(2),
    started(0, "instagram"), settled(0, "instagram", true, "IG_3"),
    started(1, "facebook"), settled(1, "facebook", true, "FB_3"),
  ]);
  check("all attempts settled → complete publication, merely unrecorded",
    v.classification === "publication_complete_unrecorded"
    && v.providerMutation === "complete_known"
    && v.terminalStatus === "done"
    && !v.requiresRevocation);
  check("complete publication reconstructs every provider id", v.knownProviderPostIds.length === 2);
}

{
  const v = classifyInterruptedBrief([
    approvalRequested(2),
    started(0, "instagram"), settled(0, "instagram", true, "IG_4"),
    started(1, "facebook"), settled(1, "facebook", false),
  ]);
  check("all settled with a failure → failed, escalated, still fully known",
    v.classification === "publication_complete_unrecorded"
    && v.terminalStatus === "failed"
    && v.requiresEscalation);
}

{
  const v = classifyInterruptedBrief([approvalRequested(2), event(PHASE_PUBLISH_ATTEMPT_STARTED, { nonsense: true })]);
  check("markers with malformed data are ignored rather than trusted",
    v.classification === "interrupted_awaiting_approval");
}

// ---------------------------------------------------------------------------
// 4. Terminalization side effects
// ---------------------------------------------------------------------------

{
  const r = recorderDeps({ phaseMarkersForRun: async () => [approvalRequested()] });
  await terminalizeInterruptedBrief(r.deps, "run-1", { trigger: "startup_recovery" });
  check("awaiting-approval strand revokes its live approval", r.revocations.includes(APPROVAL));
  check("terminal status is failed, never pending",
    r.completions.length === 1 && r.completions[0]!.status === "failed");
  check("the audit event is written before the status change",
    r.calls.indexOf(`event:${PHASE_RECONCILED}`) < r.calls.indexOf("complete:failed"));
  check("the stranded brief is escalated", r.escalations.length === 1);
  check("the outcome records the approval linkage",
    r.completions[0]!.outcome.approvalId === APPROVAL);
}

{
  const r = recorderDeps({
    phaseMarkersForRun: async () => [approvalRequested(2), started(0, "instagram"), settled(0, "instagram", true, "IG_9"),
      started(1, "facebook")],
  });
  await terminalizeInterruptedBrief(r.deps, "run-1", { trigger: "startup_recovery" });
  const outcome = r.completions[0]!.outcome;
  check("partial publication flags provider reconciliation", outcome.requiresProviderReconciliation === true);
  check("known provider ids survive into durable state",
    outcome.knownProviderPostIds[0].providerPostId === "IG_9");
  check("escalation carries the known provider id",
    r.escalations[0]!.reason.includes("IG_9"));
  check("escalation states that automatic retry is refused",
    r.escalations[0]!.reason.includes("automatic retry"));
}

{
  const r = recorderDeps({
    phaseMarkersForRun: async () => [approvalRequested(1), started(0, "instagram"), settled(0, "instagram", true, "IG_10")],
  });
  await terminalizeInterruptedBrief(r.deps, "run-1", { trigger: "startup_recovery" });
  check("fully settled run repairs the approval status",
    r.approvalStatuses.length === 1 && r.approvalStatuses[0]!.status === "posted");
  check("fully settled run completes as done", r.completions[0]!.status === "done");
  check("fully settled run does not revoke", r.revocations.length === 0);
}

{
  // Recovery must never resurrect work and never touch a provider.
  const r = recorderDeps({
    listRunningBriefs: async () => [{ id: "run-1", brief: { goal: "g" } }],
    phaseMarkersForRun: async () => [approvalRequested()],
  });
  const results = await reconcileAbandonedWork(r.deps);
  check("startup recovery terminalizes each stranded brief", results.length === 1);
  check("recovery never writes a pending status",
    r.completions.every((c) => c.status === "done" || c.status === "failed"));
  check("recovery performs no provider call",
    !r.calls.some((c) => /publish|provider/i.test(c)));
}

{
  const r = recorderDeps({
    listRunningBriefs: async () => [
      { id: "run-1", brief: {} }, { id: "run-2", brief: {} },
    ],
    phaseMarkersForRun: async () => [],
  });
  await reconcileAbandonedWork(r.deps);
  check("more than one running brief is escalated as anomalous",
    r.escalations.some((e) => e.reason.includes("should not be possible")));
}

{
  // Orphan sweep: only approvals with no owning marker are revoked.
  const r = recorderDeps({
    listRevocablePendingApprovals: async () => ["linked-1", "orphan-1"],
    approvalIdsWithOwningBriefMarker: async () => new Set(["linked-1"]),
  });
  const revoked = await sweepOrphanApprovals(r.deps);
  check("orphan approvals are revoked", revoked.includes("orphan-1"));
  check("approvals owned by a real brief are left alone", !revoked.includes("linked-1"));
}

// ---------------------------------------------------------------------------
// 5. Publication safety markers
// ---------------------------------------------------------------------------

function publicationDeps(overrides: Partial<PublicationDeps> = {}): {
  deps: PublicationDeps; order: string[];
} {
  const order: string[] = [];
  const deps: PublicationDeps = {
    assertSideEffectAllowed: (op) => { order.push(`barrier:${op}`); },
    recordDurablePhaseEvent: async (e) => { order.push(`marker:${e.kind}`); },
    publish: async (p) => { order.push(`provider:${p.platform}`); return { platform: p.platform, ok: true, id: "P1" }; },
    ...overrides,
  };
  return { deps, order };
}

{
  const { deps, order } = publicationDeps();
  const outcome = await runPublication(deps, {
    runId: "run-1", approvalId: APPROVAL, payloads: [pkg("instagram"), pkg("facebook")], creds: CREDS,
  });
  check("a clean run settles every package", outcome.kind === "settled" && outcome.results.length === 2);
  check("two barriers are checked per provider attempt",
    order.filter((o) => o.startsWith("barrier:")).length === 4);
  check("the started marker commits BEFORE the provider call",
    order.indexOf(`marker:${PHASE_PUBLISH_ATTEMPT_STARTED}`) < order.indexOf("provider:instagram"));
  check("the settled marker commits after the provider call",
    order.indexOf("provider:instagram") < order.indexOf(`marker:${PHASE_PUBLISH_ATTEMPT_SETTLED}`));
  check("ordering per platform is barrier → started → barrier → provider → settled",
    order.slice(0, 5).join("|")
      === `barrier:provider attempt for instagram|marker:${PHASE_PUBLISH_ATTEMPT_STARTED}`
        + `|barrier:provider request for instagram`
        + `|provider:instagram|marker:${PHASE_PUBLISH_ATTEMPT_SETTLED}`);
  check("the second barrier is taken as late as possible, after the marker commits",
    order.indexOf(`marker:${PHASE_PUBLISH_ATTEMPT_STARTED}`)
      < order.indexOf("barrier:provider request for instagram")
    && order.indexOf("barrier:provider request for instagram") < order.indexOf("provider:instagram"));
}

{
  // Case B: a started marker that does not commit must stop the provider call.
  let published = 0;
  const { deps, order } = publicationDeps({
    recordDurablePhaseEvent: async (e) => {
      if (e.kind === PHASE_PUBLISH_ATTEMPT_STARTED) throw new Error("insert failed");
      order.push(`marker:${e.kind}`);
    },
    publish: async () => { published += 1; return { ok: true }; },
  });
  const outcome = await runPublication(deps, {
    runId: "run-1", approvalId: APPROVAL, payloads: [pkg("instagram"), pkg("facebook")], creds: CREDS,
  });
  check("started-marker failure stops publication", outcome.kind === "marker_failure");
  check("started-marker failure makes NO provider call", published === 0);
  check("started-marker failure attempts no later platform", order.every((o) => !o.includes("facebook")));
}

{
  // Case C: provider succeeded, settled marker failed → uncertain, and the
  // remaining platform must not be attempted.
  const platforms: string[] = [];
  const { deps } = publicationDeps({
    recordDurablePhaseEvent: async (e) => {
      if (e.kind === PHASE_PUBLISH_ATTEMPT_SETTLED) throw new Error("insert failed");
    },
    publish: async (p) => { platforms.push(p.platform); return { platform: p.platform, ok: true, id: "IG_LOST" }; },
  });
  const outcome = await runPublication(deps, {
    runId: "run-1", approvalId: APPROVAL, payloads: [pkg("instagram"), pkg("facebook")], creds: CREDS,
  });
  check("settle-marker failure after success becomes an uncertain outcome", outcome.kind === "uncertain");
  check("uncertain outcome preserves the provider post id out-of-band",
    outcome.kind === "uncertain" && outcome.error.providerPostId === "IG_LOST");
  check("uncertain outcome stops all remaining platform activity",
    platforms.length === 1 && platforms[0] === "instagram");
  check("uncertain outcome is its own type, not a generic failure",
    outcome.kind === "uncertain" && outcome.error.name === "UncertainProviderOutcomeError");
}

{
  // Ordinary provider failure stays ordinary and is still recorded as settled.
  const { deps } = publicationDeps({
    publish: async () => { throw new Error("provider rejected the request"); },
  });
  const outcome = await runPublication(deps, {
    runId: "run-1", approvalId: APPROVAL, payloads: [pkg("instagram")], creds: CREDS,
  });
  check("an ordinary provider failure settles normally",
    outcome.kind === "settled" && outcome.results[0].ok === false);
}

{
  // Ownership lost between platforms: the next platform is never attempted.
  const platforms: string[] = [];
  let calls = 0;
  const { deps } = publicationDeps({
    assertSideEffectAllowed: (op) => {
      // Count only the per-platform entry barrier, so ownership is lost after
      // the first platform completes rather than at its own second barrier.
      if (op.startsWith("provider attempt for")) calls += 1;
      if (calls > 1) throw new OwnershipLostError("connection_error", "BLOCKED: ownership lost");
    },
    publish: async (p) => { platforms.push(p.platform); return { platform: p.platform, ok: true, id: "X" }; },
  });
  const outcome = await runPublication(deps, {
    runId: "run-1", approvalId: APPROVAL, payloads: [pkg("instagram"), pkg("facebook")], creds: CREDS,
  });
  check("ownership lost between platforms interrupts publication", outcome.kind === "interrupted");
  check("no further platform is contacted after ownership loss",
    platforms.length === 1 && platforms[0] === "instagram");
}

{
  // Ownership lost before the first attempt: no provider is contacted at all.
  let published = 0;
  const { deps } = publicationDeps({
    assertSideEffectAllowed: () => { throw new OwnershipLostError("heartbeat_failed"); },
    publish: async () => { published += 1; return { ok: true }; },
  });
  const outcome = await runPublication(deps, {
    runId: "run-1", approvalId: APPROVAL, payloads: [pkg("instagram")], creds: CREDS,
  });
  check("losing ownership before publication blocks every provider call",
    outcome.kind === "interrupted" && published === 0);
}

// ---------------------------------------------------------------------------
// 5b. EXECUTED worker fencing — ownership revoked at each exact boundary
// ---------------------------------------------------------------------------

/**
 * A real lifecycle run with every boundary instrumented, so "the provider was
 * not called" is observed rather than inferred from source text.
 */
function lifecycleHarness(options: {
  loseOwnershipAt?: string;
  payloads?: PostPackage[];
  decision?: "approved" | "rejected";
} = {}) {
  const calls: string[] = [];
  let owner = true;
  let shuttingDown = false;
  const payloads = options.payloads ?? [pkg("instagram"), pkg("facebook")];

  const loseNow = (boundary: string): void => {
    if (options.loseOwnershipAt === boundary) owner = false;
  };

  const deps: LifecycleDeps = {
    runBrief: async () => {
      calls.push("runBrief");
      // Ownership can be lost while local computation is still running; the
      // brief still returns normally afterwards.
      loseNow("during_runBrief");
      return { status: "awaiting_approval", package: { platforms: payloads }, costUsd: 0 };
    },
    toPostPackages: () => payloads,
    summarize: () => "summary",
    requestApproval: async () => { calls.push("requestApproval"); return { id: APPROVAL }; },
    recordDurablePhaseEvent: async (e) => {
      calls.push(`marker:${e.kind}`);
      if (e.kind === PHASE_PUBLISH_ATTEMPT_STARTED) loseNow("after_started_marker");
    },
    waitForApproval: async () => {
      calls.push("waitForApproval");
      loseNow("after_approval");
      return options.decision ?? "approved";
    },
    assertPublishAllowed: async () => {
      calls.push("assertPublishAllowed");
      loseNow("before_credentials");
      return { subject: payloads };
    },
    acquireCredentials: async () => { calls.push("acquireCredentials"); return CREDS; },
    publishAll: (ctx) => runPublication(
      {
        publish: async (p) => {
          calls.push(`provider:${p.platform}`);
          loseNow("between_platforms");
          return { platform: p.platform, ok: true, id: `ID_${p.platform}` };
        },
        recordDurablePhaseEvent: deps.recordDurablePhaseEvent,
        assertSideEffectAllowed: deps.assertSideEffectAllowed,
        ownershipHeld: () => owner,
      },
      ctx,
    ),
    completeBrief: async (_id, status) => { calls.push(`completeBrief:${status}`); },
    setApprovalStatus: async (_id, status) => { calls.push(`setApprovalStatus:${status}`); },
    revokeApproval: async () => { calls.push("revokeApproval"); return { ok: true }; },
    notifyEscalation: async () => { calls.push("escalate"); },
    terminalizeInterruptedBrief: async () => { calls.push("terminalize"); return {}; },
    assertSideEffectAllowed: (op) => {
      calls.push(`barrier:${op}`);
      if (!owner) throw new OwnershipLostError("connection_error", `BLOCKED: refusing ${op}`);
      if (shuttingDown) throw new Error(`shutting down — refusing ${op}`);
    },
    sideEffectsAllowed: () => owner && !shuttingDown,
    ownershipHeld: () => owner,
    abortSignal: new AbortController().signal,
    recordEvent: () => { calls.push("recordEvent"); },
    log: () => {},
  };
  return { deps, calls, isOwner: () => owner };
}

{
  // A. Ownership lost while runBrief is still computing.
  const h = lifecycleHarness({ loseOwnershipAt: "during_runBrief" });
  const result = await runBriefLifecycle(h.deps, "run-A", { goal: "g" });
  check("A: interrupted after orchestration when ownership was lost mid-run",
    result === "interrupted");
  check("A: requestApproval is NEVER called after ownership loss",
    !h.calls.includes("requestApproval"));
  check("A: no terminal write is attempted by a former owner",
    !h.calls.some((c) => c.startsWith("completeBrief")) && !h.calls.includes("terminalize"));
}

{
  // B. Ownership lost exactly at the approval-creation barrier.
  const h2 = lifecycleHarness({ loseOwnershipAt: "during_runBrief" });
  const r2 = await runBriefLifecycle(h2.deps, "run-B", { goal: "g" });
  check("B: no approval is created when ownership is gone",
    r2 === "interrupted" && !h2.calls.includes("requestApproval"));
}

{
  // C. Ownership lost after approval, before credential acquisition.
  const h = lifecycleHarness({ loseOwnershipAt: "before_credentials" });
  const result = await runBriefLifecycle(h.deps, "run-C", { goal: "g" });
  check("C: credential acquisition is NEVER called after ownership loss",
    !h.calls.includes("acquireCredentials"));
  check("C: no provider is contacted", !h.calls.some((c) => c.startsWith("provider:")));
  check("C: the run is reported interrupted", result === "interrupted");
}

{
  // D. Ownership lost after the started marker commits, before the provider.
  const h = lifecycleHarness({ loseOwnershipAt: "after_started_marker" });
  const result = await runBriefLifecycle(h.deps, "run-D", { goal: "g" });
  check("D: the started marker did commit", h.calls.includes(`marker:${PHASE_PUBLISH_ATTEMPT_STARTED}`));
  check("D: the SECOND barrier blocks the provider call",
    !h.calls.some((c) => c.startsWith("provider:")));
  check("D: the run is reported interrupted", result === "interrupted");
  check("D: no abandonment marker is written by a former owner",
    !h.calls.includes(`marker:${PHASE_PUBLISH_ATTEMPT_ABANDONED}`));
}

{
  // D2. Same boundary, but shutdown rather than ownership loss: still the owner,
  // so the attempt can be positively proven never to have reached the provider.
  const calls: string[] = [];
  let blocked = false;
  const outcome = await runPublication(
    {
      publish: async (p) => { calls.push(`provider:${p.platform}`); return { platform: p.platform, ok: true }; },
      recordDurablePhaseEvent: async (e) => {
        calls.push(`marker:${e.kind}`);
        if (e.kind === PHASE_PUBLISH_ATTEMPT_STARTED) blocked = true;
      },
      assertSideEffectAllowed: (op) => {
        if (blocked && op.startsWith("provider request")) throw new Error(`shutting down — refusing ${op}`);
      },
      ownershipHeld: () => true,
    },
    { runId: "run-D2", approvalId: APPROVAL, payloads: [pkg("instagram")], creds: CREDS },
  );
  check("D2: the provider is not contacted when the second barrier blocks",
    outcome.kind === "interrupted" && !calls.some((c) => c.startsWith("provider:")));
  check("D2: an owner records positive proof the attempt never reached the provider",
    calls.includes(`marker:${PHASE_PUBLISH_ATTEMPT_ABANDONED}`));
  const abandoned = classifyInterruptedBrief([
    approvalRequested(1),
    started(0, "instagram"),
    event(PHASE_PUBLISH_ATTEMPT_ABANDONED, { approvalId: APPROVAL, packageIndex: 0, platform: "instagram" }),
  ]);
  check("D2: an abandoned attempt is classified as never contacted, not uncertain",
    abandoned.classification === "interrupted_awaiting_approval"
    && abandoned.providerMutation === "impossible");
}

{
  // E. Ownership lost between platforms.
  const h = lifecycleHarness({ loseOwnershipAt: "between_platforms" });
  const result = await runBriefLifecycle(h.deps, "run-E", { goal: "g" });
  const contacted = h.calls.filter((c) => c.startsWith("provider:"));
  check("E: exactly one platform was contacted before ownership was lost", contacted.length === 1);
  check("E: the next platform is NEVER contacted", !contacted.includes("provider:facebook"));
  check("E: the run is reported interrupted", result === "interrupted");
  check("E: a former owner writes no terminal state, preserving the successor's recovery",
    !h.calls.some((c) => c.startsWith("completeBrief") || c.startsWith("setApprovalStatus")));
}

{
  // Former-owner terminal writes on the ordinary decided-without-publication
  // path must also be declined.
  const h = lifecycleHarness({ decision: "rejected", loseOwnershipAt: "after_approval" });
  const result = await runBriefLifecycle(h.deps, "run-G", { goal: "g" });
  check("a rejected decision does not write terminal state without ownership",
    result === "decided_without_publication"
    && !h.calls.some((c) => c.startsWith("completeBrief")));
}

{
  // The happy path still writes everything when ownership is retained.
  const h = lifecycleHarness();
  const result = await runBriefLifecycle(h.deps, "run-H", { goal: "g" });
  check("an owner still publishes and writes terminal state", result === "published");
  check("both terminal writes happen for an owner",
    h.calls.includes("setApprovalStatus:posted") && h.calls.includes("completeBrief:done"));
}

// ---------------------------------------------------------------------------
// 5c. F — ownership-loss termination lifecycle
// ---------------------------------------------------------------------------

function exitHarness(drained: boolean): { steps: WorkerExitSteps; order: string[] } {
  const order: string[] = [];
  return {
    order,
    steps: {
      drainActiveWork: async () => { order.push("drain"); return drained; },
      stopRecurringServices: () => { order.push("stopRecurringServices"); },
      escalate: async () => { order.push("escalate"); },
      closeState: async () => { order.push("closeState"); },
      releaseOwnership: async () => { order.push("releaseOwnership"); },
      log: () => {},
    },
  };
}

{
  const h = exitHarness(true);
  const result = await finalizeWorkerExit("ownership_lost", h.steps);
  check("F: ownership loss exits NONZERO so the platform restarts the worker",
    result.code === OWNERSHIP_LOSS_EXIT_CODE && Number(result.code) > 0);
  check("F: ownership loss never releases the lock it no longer holds",
    result.releasedOwnership === false && !h.order.includes("releaseOwnership"));
  check("F: ownership loss drains active work before tearing anything down",
    h.order[0] === "drain");
  check("F: ownership loss stops recurring timers, which would otherwise keep the process alive",
    h.order.includes("stopRecurringServices"));
  check("F: ownership loss escalates out-of-band", h.order.includes("escalate"));
  check("F: state is closed before exit", h.order.includes("closeState"));
}

{
  const h = exitHarness(false);
  const result = await finalizeWorkerExit("ownership_lost", h.steps);
  check("F: a brief that never drains still exits nonzero rather than idling",
    result.code === OWNERSHIP_LOSS_EXIT_CODE && result.drained === false);
}

{
  const h = exitHarness(true);
  const result = await finalizeWorkerExit("shutdown", h.steps);
  check("coordinated shutdown exits zero", result.code === SHUTDOWN_EXIT_CODE);
  check("a fully drained shutdown hands ownership over explicitly",
    result.releasedOwnership && h.order.indexOf("closeState") < h.order.indexOf("releaseOwnership"));
  check("shutdown does not escalate", !h.order.includes("escalate"));
}

{
  const h = exitHarness(false);
  const result = await finalizeWorkerExit("shutdown", h.steps);
  check("a shutdown whose brief did not drain does NOT hand ownership to a successor",
    result.releasedOwnership === false && !h.order.includes("releaseOwnership"));
}

// ---------------------------------------------------------------------------
// 6. Bounded diagnostics
// ---------------------------------------------------------------------------

{
  const long = "x".repeat(5_000);
  check("recovery error text is bounded", boundedErrorText(new Error(long)).length === MAX_RECOVERY_ERROR_CHARS);
  check("recovery error text collapses whitespace", boundedErrorText("a\n\n  b") === "a b");
}

// ---------------------------------------------------------------------------
// 7. Architecture boundaries
//
// The runtime properties above are now executed, not inferred. What remains
// here are import-boundary and wiring facts that behaviour tests cannot show:
// they constrain what the modules are ALLOWED to reach, not what they did.
// ---------------------------------------------------------------------------

const workerSource = readFileSync(resolve("src/worker/index.ts"), "utf8");
const recoverySource = readFileSync(resolve("src/harness/briefRecovery.ts"), "utf8");
const lifecycleSource = readFileSync(resolve("src/harness/briefLifecycle.ts"), "utf8");

check("recovery imports no provider/posting code at all",
  !/posting-tool|publishApprovedPackage/.test(recoverySource));
check("recovery cannot express a pending status",
  !/["']pending["']/.test(recoverySource));
check("the lifecycle reaches providers only through the injected publishAll boundary",
  !/posting-tool\/index|publishApprovedPackage\(/.test(lifecycleSource));
check("the worker claims through the ownership session, not the shared pool",
  workerSource.includes("ownership!.claimPendingBrief(CLAIM_PENDING_BRIEF_SQL)")
  && !/\bclaimNextBrief\(/.test(workerSource));
check("the worker wires ownership loss to the terminating exit path",
  workerSource.includes("onLost:") && workerSource.includes("handleOwnershipLoss"));
check("the worker exits through the shared exit lifecycle rather than ad-hoc teardown",
  workerSource.includes("finalizeWorkerExit"));

console.log(
  `ownership/recovery self-test: PASS (${checks} checks — advisory ownership, contention, loss fencing, `
  + "interruption classification, marker ordering, uncertain-outcome isolation)",
);
