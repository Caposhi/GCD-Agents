/**
 * `npm run start:studio-worker`: the Content Studio worker
 * (docs/CONTENT_STUDIO_DESIGN.md §3.2, §3.3, §5.3). **Not deployed:**
 * `render.studio.yaml` (Content Studio S8) declares it as `gcd-studio-worker`,
 * but no Render resource exists until owner action O3; `render.yaml` never
 * names it.
 *
 * The environment is decided FIRST, by `startup.ts`, which imports nothing
 * that reads `process.env`. Only once it passes is the worker — and with it the
 * content-run library and the live `src/harness/config.ts` the stage modules
 * load — imported. So a refused start reads no other variable, and a running
 * worker's `config.ts` can see no forbidden one, because every forbidden name
 * has been refused.
 *
 * It reads: the names of every variable present (for the refusal),
 * `STUDIO_DATABASE_URL`, `STUDIO_MAX_DAILY_USD`, `STUDIO_MAX_MONTHLY_USD`,
 * Render's `RENDER_GIT_COMMIT`, and (Content Studio S6b) `ANTHROPIC_API_KEY`,
 * whose value `decideLiveRunner` looks at only to tell present from absent,
 * empty, blank or (Content Studio S8.2) padded with leading or trailing
 * whitespace. It never reads `DATABASE_URL`'s value.
 *
 * S6b: when the key is present, not blank and not padded, it constructs the EXISTING
 * provider runner — the library runtime's `createAnthropicStageRunner`, called
 * with no argument, exactly as `pipeline.ts` calls it — and passes it as the
 * worker's paid stage runner; every gate before each paid unit still runs (`execute.ts`).
 * Otherwise it passes none, and a job naming the `live` runner is refused
 * before any work (`live_runs_not_enabled`). The start-up log, the ready line
 * and the heartbeat line say `live_runner` "enabled" or "disabled"; the
 * start-up log adds the key's class. Never its value.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { decideWorkerStartup, paidRunnerFor, WorkerStartupRefusal } from "./startup.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** One structured line: ids, states, classes and counts only, never content (design §9.2). */
function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(`[studio-worker] ${event} ${JSON.stringify(fields)}`);
}

async function main(): Promise<void> {
  const startup = decideWorkerStartup({
    names: Object.keys(process.env),
    studioDatabaseUrl: process.env.STUDIO_DATABASE_URL,
    maxDailyUsd: process.env.STUDIO_MAX_DAILY_USD,
    maxMonthlyUsd: process.env.STUDIO_MAX_MONTHLY_USD,
    commit: process.env.RENDER_GIT_COMMIT,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });
  if (startup.zeroCaps.length) log("caps.zero", { caps: startup.zeroCaps, effect: "every paid request is refused" });
  log("live_runner", { live_runner: startup.liveRunner, provider_key: startup.providerKey });
  const { startWorker } = await import("./worker.js");
  const lib = await import("../../harness/contentRun/index.js");
  // The existing provider runner, built as pipeline.ts builds it, and only when the key is present (S6b).
  const paidStageRunner = paidRunnerFor(startup.liveRunner, () => lib.loadRuntime().stageExecution.createAnthropicStageRunner());
  const worker = startWorker({
    connectionString: startup.connectionString,
    commit: startup.commit,
    caps: startup.caps,
    paidStageRunner,
    repoRoot: REPO_ROOT,
    log,
    ready: (line) => console.log(line),
  });
  const shutdown = () => { log("stopping", { reason: "signal" }); void worker.stop(); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  await worker.stopped;
  log("stopped", {});
}

main().catch((error: unknown) => {
  // The reason and message only: never an error object, which could carry connection details.
  const reason = (error as { reason?: unknown })?.reason;
  if (error instanceof WorkerStartupRefusal || typeof reason === "string") {
    console.error(`[studio-worker] refused (${String(reason)}): ${(error as Error).message}`);
  } else {
    console.error(`[studio-worker] fatal (${(error as Error)?.name ?? "Error"}): ${(error as Error)?.message ?? String(error)}`);
  }
  process.exit(1);
});
