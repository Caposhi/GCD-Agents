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
  PHASE_RECONCILED,
} from "./briefRecovery.js";
import { runPublication, PublicationDeps } from "./publicationRunner.js";
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
    eventsForRun: async () => [],
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
    runIdsWithApprovalMarker: async () => new Set<string>(),
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

function fakeClient(server: FakeLockServer, opts: { failOnQuery?: () => Error | undefined } = {}): {
  client: OwnershipClient;
  ended: boolean;
  queries: string[];
  emitError: (err: Error) => void;
} {
  const queries: string[] = [];
  const listeners: ((err: Error) => void)[] = [];
  const state = { ended: false };
  const client: OwnershipClient = {
    async query(sql: string) {
      queries.push(sql);
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
    on(_event: "error", listener: (err: Error) => void) { listeners.push(listener); return client; },
  };
  return {
    client,
    get ended() { return state.ended; },
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
  const r = recorderDeps({ eventsForRun: async () => [approvalRequested()] });
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
    eventsForRun: async () => [approvalRequested(2), started(0, "instagram"), settled(0, "instagram", true, "IG_9"),
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
    eventsForRun: async () => [approvalRequested(1), started(0, "instagram"), settled(0, "instagram", true, "IG_10")],
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
    eventsForRun: async () => [approvalRequested()],
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
    eventsForRun: async () => [],
  });
  await reconcileAbandonedWork(r.deps);
  check("more than one running brief is escalated as anomalous",
    r.escalations.some((e) => e.reason.includes("should not be possible")));
}

{
  // Orphan sweep: only approvals with no owning marker are revoked.
  const r = recorderDeps({
    listRevocablePendingApprovals: async () => ["linked-1", "orphan-1"],
    runIdsWithApprovalMarker: async () => new Set(["linked-1"]),
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
  check("the barrier is checked before every provider attempt",
    order.filter((o) => o.startsWith("barrier:")).length === 2);
  check("the started marker commits BEFORE the provider call",
    order.indexOf(`marker:${PHASE_PUBLISH_ATTEMPT_STARTED}`) < order.indexOf("provider:instagram"));
  check("the settled marker commits after the provider call",
    order.indexOf("provider:instagram") < order.indexOf(`marker:${PHASE_PUBLISH_ATTEMPT_SETTLED}`));
  check("ordering per platform is barrier → started → provider → settled",
    order.slice(0, 4).join("|")
      === `barrier:provider attempt for instagram|marker:${PHASE_PUBLISH_ATTEMPT_STARTED}`
        + `|provider:instagram|marker:${PHASE_PUBLISH_ATTEMPT_SETTLED}`);
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
    assertSideEffectAllowed: () => {
      calls += 1;
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
// 6. Bounded diagnostics
// ---------------------------------------------------------------------------

{
  const long = "x".repeat(5_000);
  check("recovery error text is bounded", boundedErrorText(new Error(long)).length === MAX_RECOVERY_ERROR_CHARS);
  check("recovery error text collapses whitespace", boundedErrorText("a\n\n  b") === "a b");
}

// ---------------------------------------------------------------------------
// 7. Static wiring: the worker actually uses these boundaries
// ---------------------------------------------------------------------------

const workerSource = readFileSync(resolve("src/worker/index.ts"), "utf8");
const recoverySource = readFileSync(resolve("src/harness/briefRecovery.ts"), "utf8");

check("the worker fences approval creation behind ownership",
  workerSource.indexOf('assertSideEffectAllowed("approval creation")')
    < workerSource.indexOf("await requestApproval("));
check("the worker re-checks side effects after orchestration returns",
  workerSource.includes("if (!sideEffectsAllowed()) {"));
check("the worker binds the approval to the brief with a durable marker",
  workerSource.includes(`kind: PHASE_APPROVAL_REQUESTED`));
check("the worker threads the abort signal into the approval wait",
  workerSource.includes("waitForApproval(handle.id, { signal: workAbort.signal })"));
check("the worker routes uncertain outcomes away from the generic failure path",
  workerSource.includes('publication.kind === "uncertain"'));
check("shutdown releases ownership after closing ordinary state",
  workerSource.indexOf("await closeState()") < workerSource.indexOf("await ownership?.release()"));
check("shutdown no longer closes state before the active brief unwinds",
  workerSource.indexOf("if (activeBrief)") < workerSource.indexOf("await closeState()"));
check("recovery imports no provider/posting code",
  !/posting-tool|publishApprovedPackage/.test(recoverySource));
check("recovery cannot set a brief back to pending",
  !/["']pending["']/.test(recoverySource));

console.log(
  `ownership/recovery self-test: PASS (${checks} checks — advisory ownership, contention, loss fencing, `
  + "interruption classification, marker ordering, uncertain-outcome isolation)",
);
