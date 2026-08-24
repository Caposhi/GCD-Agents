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

async function exerciseWorkerStartup(options: {
  stateError?: Error;
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
  assert.deepEqual(successful.events, ["state", "instagram", "identity", "timer", "ready", "loop"]);
}
{
  const failed = await exerciseWorkerStartup({ stateError: new Error("state failed") });
  await assert.rejects(failed.run, /state failed/);
  assert.deepEqual(failed.events, ["state"]);
}
{
  const failed = await exerciseWorkerStartup({
    serviceInitialization: async () => { throw new Error("Instagram initialization failed"); },
  });
  await assert.rejects(failed.run, /Instagram initialization failed/);
  assert.deepEqual(failed.events, ["state", "instagram"]);
}
{
  let finishInitialization!: () => void;
  const pendingInitialization = new Promise<void>((resolve) => { finishInitialization = resolve; });
  const hanging = await exerciseWorkerStartup({ serviceInitialization: () => pendingInitialization });
  await Promise.resolve();
  assert.deepEqual(hanging.events, ["state", "instagram"]);
  finishInitialization();
  await hanging.run;
  assert.deepEqual(hanging.events, ["state", "instagram", "identity", "timer", "ready", "loop"]);
}
{
  const failed = await exerciseWorkerStartup({ identityError: new Error("identity failed") });
  await assert.rejects(failed.run, /identity failed/);
  assert.deepEqual(failed.events, ["state", "instagram", "identity"]);
}

console.log("render identity self-test: PASS (strict Render identity, durable health/readiness, worker startup ordering)");
