import assert from "node:assert/strict";
import {
  buildApiHealthDocument,
  buildWorkerReadinessMarker,
  resolveRenderRuntimeIdentity,
} from "./renderIdentity.js";
import { runWorkerStartup } from "../worker/startup.js";

const targetSha = "2".repeat(40);
const production = {
  nodeEnv: "production",
  gitCommit: targetSha,
  instanceId: "instance-ready-01",
};

const marker = buildWorkerReadinessMarker("postgres", production);
assert.equal(
  marker,
  `[worker] ready {"service":"gcd-social-worker","commit":"${targetSha}","instance":"instance-ready-01","state":"postgres"}`,
);
assert.deepEqual(buildApiHealthDocument("A", "postgres", production), {
  status: "ok",
  service: "gcd-social-api",
  autonomyPhase: "A",
  state: "postgres",
  commit: targetSha,
});
assert.deepEqual(resolveRenderRuntimeIdentity({ nodeEnv: "test" }), { commit: "local", instance: null });
assert.throws(
  () => resolveRenderRuntimeIdentity({ nodeEnv: "production" }),
  /RENDER_GIT_COMMIT is required/,
);
assert.throws(
  () => resolveRenderRuntimeIdentity({ nodeEnv: "production", gitCommit: "not-a-sha" }),
  /full lowercase commit SHA/,
);
assert.throws(
  () => resolveRenderRuntimeIdentity({ nodeEnv: "production", gitCommit: ` ${targetSha}` }),
  /full lowercase commit SHA/,
);
assert.throws(
  () => resolveRenderRuntimeIdentity({ nodeEnv: "production", gitCommit: `${targetSha}\n` }),
  /full lowercase commit SHA/,
);
assert.throws(
  () => resolveRenderRuntimeIdentity({ ...production, instanceId: "bad\ninstance" }),
  /RENDER_INSTANCE_ID has an invalid format/,
);
assert.throws(
  () => resolveRenderRuntimeIdentity({ ...production, instanceId: " instance-ready-01" }),
  /RENDER_INSTANCE_ID has an invalid format/,
);
assert.throws(
  () => buildWorkerReadinessMarker("ephemeral", production),
  /requires durable PostgreSQL state/,
);
assert.throws(
  () => buildApiHealthDocument("A", "ephemeral", production),
  /requires durable PostgreSQL state/,
);
assert.throws(
  () => buildApiHealthDocument("A", "postgres", { nodeEnv: "production" }),
  /RENDER_GIT_COMMIT is required/,
);
assert.equal(
  JSON.parse(buildWorkerReadinessMarker("postgres", {
    nodeEnv: "production",
    gitCommit: targetSha,
  }).slice("[worker] ready ".length)).instance,
  null,
);

const FULL_STARTUP = [
  "state", "ownership", "monitor", "recovery", "instagram", "identity", "timer", "ready", "loop",
];

async function exerciseWorkerStartup(options: {
  stateError?: Error;
  ownershipWait?: () => Promise<void>;
  ownershipError?: Error;
  recoveryError?: Error;
  serviceInitialization?: () => Promise<void>;
  identityError?: Error;
} = {}): Promise<{ events: string[]; run: Promise<void> }> {
  const events: string[] = [];
  const run = runWorkerStartup({
    initializeState: async () => {
      events.push("state");
      if (options.stateError) throw options.stateError;
      return "postgres" as const;
    },
    acquireOwnership: async () => {
      // Modelled on the real acquisition: it may block indefinitely while the
      // previous Render instance still holds the lock.
      await options.ownershipWait?.();
      events.push("ownership");
      if (options.ownershipError) throw options.ownershipError;
      return { owner: true };
    },
    startOwnershipMonitoring: () => { events.push("monitor"); },
    reconcileAbandonedWork: async () => {
      events.push("recovery");
      if (options.recoveryError) throw options.recoveryError;
    },
    initializeRequiredServices: async () => {
      events.push("instagram");
      await options.serviceInitialization?.();
    },
    buildReadiness: () => {
      events.push("identity");
      if (options.identityError) throw options.identityError;
      return "ready-marker";
    },
    startRecurringServices: () => { events.push("timer"); },
    emitReadiness: () => { events.push("ready"); },
    consumeQueue: async () => { events.push("loop"); },
  });
  return { events, run };
}

{
  const successful = await exerciseWorkerStartup();
  await successful.run;
  assert.deepEqual(successful.events, FULL_STARTUP);
}
{
  const failed = await exerciseWorkerStartup({ stateError: new Error("state failed") });
  await assert.rejects(failed.run, /state failed/);
  assert.deepEqual(failed.events, ["state"]);
}
{
  // Ownership must precede monitoring, recovery, readiness and consumption.
  const failed = await exerciseWorkerStartup({ ownershipError: new Error("ownership failed") });
  await assert.rejects(failed.run, /ownership failed/);
  assert.deepEqual(failed.events, ["state", "ownership"]);
}
{
  // The Render overlap case: while the old worker still owns the lock, the new
  // instance must reconcile nothing, emit no readiness, and consume nothing.
  let releaseOwnership!: () => void;
  const contended = new Promise<void>((resolve) => { releaseOwnership = resolve; });
  const waiting = await exerciseWorkerStartup({ ownershipWait: () => contended });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(waiting.events, ["state"]);
  assert.ok(!waiting.events.includes("recovery"), "must not reconcile before ownership");
  assert.ok(!waiting.events.includes("ready"), "must not emit readiness before ownership");
  assert.ok(!waiting.events.includes("loop"), "must not consume the queue before ownership");
  releaseOwnership();
  await waiting.run;
  assert.deepEqual(waiting.events, FULL_STARTUP);
}
{
  // Recovery failure must fail closed before readiness.
  const failed = await exerciseWorkerStartup({ recoveryError: new Error("recovery failed") });
  await assert.rejects(failed.run, /recovery failed/);
  assert.deepEqual(failed.events, ["state", "ownership", "monitor", "recovery"]);
}
{
  const failed = await exerciseWorkerStartup({
    serviceInitialization: async () => { throw new Error("Instagram initialization failed"); },
  });
  await assert.rejects(failed.run, /Instagram initialization failed/);
  assert.deepEqual(failed.events, ["state", "ownership", "monitor", "recovery", "instagram"]);
}
{
  let finishInitialization!: () => void;
  const pendingInitialization = new Promise<void>((resolve) => { finishInitialization = resolve; });
  const hanging = await exerciseWorkerStartup({ serviceInitialization: () => pendingInitialization });
  await Promise.resolve();
  assert.ok(!hanging.events.includes("ready"));
  finishInitialization();
  await hanging.run;
  assert.deepEqual(hanging.events, FULL_STARTUP);
}
{
  const failed = await exerciseWorkerStartup({ identityError: new Error("identity failed") });
  await assert.rejects(failed.run, /identity failed/);
  assert.deepEqual(failed.events, ["state", "ownership", "monitor", "recovery", "instagram", "identity"]);
}

console.log(
  "render identity self-test: PASS (strict Render identity, durable health/readiness, "
  + "ownership-gated worker startup ordering)",
);
