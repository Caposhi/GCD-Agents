const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export interface RenderRuntimeEnvironment {
  nodeEnv?: string;
  gitCommit?: string;
  instanceId?: string;
}

export interface RenderRuntimeIdentity {
  commit: string;
  instance: string | null;
}

function currentRuntimeEnvironment(): RenderRuntimeEnvironment {
  return {
    nodeEnv: process.env.NODE_ENV,
    gitCommit: process.env.RENDER_GIT_COMMIT,
    instanceId: process.env.RENDER_INSTANCE_ID,
  };
}

/** Resolve only Render-owned, non-secret release identity. */
export function resolveRenderRuntimeIdentity(
  env: RenderRuntimeEnvironment = currentRuntimeEnvironment(),
): RenderRuntimeIdentity {
  const production = env.nodeEnv === "production";
  const commit = env.gitCommit ?? "";
  const instance = env.instanceId || null;

  if (commit && !FULL_COMMIT_PATTERN.test(commit)) {
    throw new Error("RENDER_GIT_COMMIT must be a full lowercase commit SHA");
  }
  if (production && !commit) {
    throw new Error("RENDER_GIT_COMMIT is required in production");
  }
  if (instance && !INSTANCE_ID_PATTERN.test(instance)) {
    throw new Error("RENDER_INSTANCE_ID has an invalid format");
  }

  return { commit: commit || "local", instance };
}

/** Emit one machine-parseable readiness event only after worker initialization. */
export function buildWorkerReadinessMarker(
  state: "postgres" | "ephemeral",
  env?: RenderRuntimeEnvironment,
): string {
  if (state !== "postgres") throw new Error("worker readiness requires durable PostgreSQL state");
  const identity = resolveRenderRuntimeIdentity(env);
  return `[worker] ready ${JSON.stringify({
    service: "gcd-social-worker",
    commit: identity.commit,
    instance: identity.instance,
    state,
  })}`;
}

export function buildApiHealthDocument(
  autonomyPhase: string,
  state: "postgres" | "ephemeral",
  env?: RenderRuntimeEnvironment,
): Record<string, string> {
  if (state !== "postgres") throw new Error("API health requires durable PostgreSQL state");
  const identity = resolveRenderRuntimeIdentity(env);
  return {
    status: "ok",
    service: "gcd-social-api",
    autonomyPhase,
    state,
    commit: identity.commit,
  };
}
