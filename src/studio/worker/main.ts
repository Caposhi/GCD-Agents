/**
 * `npm run start:studio-worker`: the Content Studio worker
 * (docs/CONTENT_STUDIO_DESIGN.md §3.2, §3.3, §5.3). **Not deployed:** no
 * Render file names it (S8 adds `render.studio.yaml`; `render.yaml` is never
 * changed), and in S3 it runs only fake-runner jobs.
 *
 * The environment is decided FIRST, by `startup.ts`, which imports nothing
 * that reads `process.env`. Only once it passes is the worker — and with it the
 * content-run library and the live `src/harness/config.ts` the stage modules
 * load — imported. So a refused start reads no other variable, and a running
 * worker's `config.ts` can see no forbidden one, because every forbidden name
 * (including, until S6, `ANTHROPIC_API_KEY`) has been refused.
 *
 * It reads: the names of every variable present (for the refusal),
 * `STUDIO_DATABASE_URL`, `STUDIO_MAX_DAILY_USD`, `STUDIO_MAX_MONTHLY_USD`, and
 * Render's `RENDER_GIT_COMMIT`. It never reads `DATABASE_URL`'s value.
 *
 * It passes no paid stage runner: a job naming the `live` runner is refused
 * before any work (`execute.ts`). Live runs are enabled in S6.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { decideWorkerStartup, WorkerStartupRefusal } from "./startup.js";

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
  });
  if (startup.zeroCaps.length) log("caps.zero", { caps: startup.zeroCaps, effect: "every paid request is refused" });
  const { startWorker } = await import("./worker.js");
  const worker = startWorker({
    connectionString: startup.connectionString,
    commit: startup.commit,
    caps: startup.caps,
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
