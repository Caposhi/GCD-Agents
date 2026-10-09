/**
 * The Studio worker's start-up decisions (docs/CONTENT_STUDIO_DESIGN.md §3.2,
 * §5.3): the environment refusal, the database identity check and the schema
 * version check. Each is a pure function over data, so the offline suite
 * (`worker.offline.selftest.ts`) proves every refusal and the mutation harness
 * proves each one load-bearing; the disposable PostgreSQL suite proves them
 * end to end.
 *
 * This module imports nothing from the pipeline or the live runtime, so the
 * entry point can decide its environment before any module that reads the
 * environment (the live `src/harness/config.ts`) is loaded. It reads nothing
 * itself: the entry point hands it what it read.
 *
 * Content Studio S6b: it also decides whether the worker holds a paid stage
 * runner (`decideLiveRunner`), from whether `ANTHROPIC_API_KEY` is present and
 * not blank. The key's value is looked at for that and nothing else: it is
 * never returned, stored, logged, hashed or put in any message; only its class
 * is.
 */

import {
  decideRuntimeIdentity, decideRuntimeSchemaVersion, forbiddenNamesPresent, resolveStudioDatabaseUrl, type LedgerRow,
  type RuntimeRefusal, type StudioIdentityProbe,
} from "../db/runner.js";
import { parseCapMicros } from "./money.js";

/** A refusal to start: the worker connects to nothing, or stops before ownership. */
export class WorkerStartupRefusal extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = "WorkerStartupRefusal";
  }
}

const refuse = (reason: string, message: string): never => {
  throw new WorkerStartupRefusal(reason, message);
};

/**
 * Every variable no Studio service may carry (design §3.2), by exact name, plus
 * every `IG_*`, `FB_*` and `GBP_*` name. Present at all, whatever its value,
 * even empty, is a refusal. Shared with the web service since S4: the lists
 * live in the S2 runner module, re-exported here by their S3 names.
 */
export { FORBIDDEN_PREFIXES, FORBIDDEN_VARIABLES, STUDIO_EXPECTED_MIGRATIONS, STUDIO_SCHEMA_VERSION } from "../db/runner.js";
/**
 * Whether the worker holds a paid stage runner (Content Studio S6b), and why.
 * A class, never a value: the ready line, the heartbeat line and the start-up
 * log carry these words only.
 */
export type LiveRunner = "enabled" | "disabled";
export type ProviderKeyClass = "anthropic_key_present" | "anthropic_key_absent" | "anthropic_key_empty" | "anthropic_key_whitespace";

/**
 * `ANTHROPIC_API_KEY` absent, empty or whitespace only: no paid runner, and
 * every live job is refused (`live_runs_not_enabled`). Never a refusal to
 * start: Render may hold an empty `sync: false` value before the owner enters
 * the key (O4). Anything else: the worker constructs the existing provider
 * runner (`main.ts`). Until S6b the worker refused to start beside the key at
 * all (`S3_FORBIDDEN_VARIABLES`); the web still refuses it in every phase.
 */
export function decideLiveRunner(value: string | undefined): { liveRunner: LiveRunner; providerKey: ProviderKeyClass } {
  if (value === undefined) return { liveRunner: "disabled", providerKey: "anthropic_key_absent" };
  if (value === "") return { liveRunner: "disabled", providerKey: "anthropic_key_empty" };
  if (value.trim() === "") return { liveRunner: "disabled", providerKey: "anthropic_key_whitespace" };
  return { liveRunner: "enabled", providerKey: "anthropic_key_present" };
}

/** The paid stage runner, constructed only when the live runner is enabled: otherwise none, and nothing is called. */
export function paidRunnerFor<R>(liveRunner: LiveRunner, construct: () => R): R | undefined {
  return liveRunner === "enabled" ? construct() : undefined;
}

/** What the entry point reads from its environment, and all it reads. */
export interface WorkerEnvironment {
  /** Every variable name present (names only: no value is read for the refusal). */
  names: readonly string[];
  studioDatabaseUrl: string | undefined;
  maxDailyUsd: string | undefined;
  maxMonthlyUsd: string | undefined;
  /** `RENDER_GIT_COMMIT`: the commit the heartbeat and every claim record. */
  commit: string | undefined;
  /** `ANTHROPIC_API_KEY`, read for `decideLiveRunner` only (S6b): never stored, returned, logged or echoed. */
  anthropicApiKey: string | undefined;
}

/** The worker's own deployment-time ceilings, in micro-dollars. A missing or unreadable cap is zero. */
export interface WorkerCaps {
  dailyMicros: number;
  monthlyMicros: number;
}

export interface WorkerStartup {
  connectionString: string;
  caps: WorkerCaps;
  commit: string;
  /** Caps that were missing or unreadable, and so are zero (fail closed: every paid request is refused). */
  zeroCaps: string[];
  /** S6b: whether the entry point constructs the paid stage runner, and the key's class (never its value). */
  liveRunner: LiveRunner;
  providerKey: ProviderKeyClass;
}

/**
 * The forbidden variables present, by name, in name order: the shared list
 * only. Since Content Studio S6b the worker adds no name of its own (until
 * then it added `ANTHROPIC_API_KEY`).
 */
export function forbiddenVariablesPresent(names: readonly string[]): string[] {
  return forbiddenNamesPresent(names, []);
}

/**
 * Whether the worker may start, and with what. Refused, before any connection:
 * any forbidden variable present, `STUDIO_DATABASE_URL` missing or not a
 * PostgreSQL URL, and a commit that is not a full 40-character SHA. Messages
 * name variables, never values. `ANTHROPIC_API_KEY` refuses nothing: it decides
 * only the live runner (S6b).
 */
export function decideWorkerStartup(env: WorkerEnvironment): WorkerStartup {
  const forbidden = forbiddenVariablesPresent(env.names);
  if (forbidden.length) {
    refuse("forbidden-variable",
      `forbidden variable(s) present: ${forbidden.join(", ")}. The Studio worker refuses to start beside any live `
      + "credential or the live database's variable, whatever the value.");
  }
  let connectionString: string;
  try {
    connectionString = resolveStudioDatabaseUrl({ studioDatabaseUrl: env.studioDatabaseUrl, databaseUrlPresent: false });
  } catch (error) {
    return refuse((error as { reason?: string }).reason ?? "studio-database-url", (error as Error).message);
  }
  const commit = env.commit?.trim() ?? "";
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    refuse("commit-missing", "RENDER_GIT_COMMIT must be the full 40-character lowercase commit SHA this worker runs.");
  }
  const dailyMicros = parseCapMicros(env.maxDailyUsd);
  const monthlyMicros = parseCapMicros(env.maxMonthlyUsd);
  const zeroCaps = [
    ...(dailyMicros === 0 ? ["STUDIO_MAX_DAILY_USD"] : []),
    ...(monthlyMicros === 0 ? ["STUDIO_MAX_MONTHLY_USD"] : []),
  ];
  const { liveRunner, providerKey } = decideLiveRunner(env.anthropicApiKey);
  return { connectionString, caps: { dailyMicros, monthlyMicros }, commit, zeroCaps, liveRunner, providerKey };
}

/** The worker's refusals: its own class, and its own words. */
const WORKER_REFUSAL: RuntimeRefusal = {
  refuse,
  who: "worker",
  deployHint: "the web service (which runs the migrations) is deployed first, at the same commit.",
};

/**
 * The database is the Studio's: named `gcd_studio`, no live-schema table, the
 * tripwire, the ledger and the identity row — S2's runner decision, repeated
 * at run time (design §3.2). An unmigrated database is refused too.
 */
export function decideWorkerIdentity(probe: StudioIdentityProbe): void {
  decideRuntimeIdentity(probe, WORKER_REFUSAL);
}

/**
 * The schema version, or a refusal: the ledger must record exactly the
 * expected migrations, the worker's own migration files must be exactly those,
 * and every recorded sha256 must match the file at the worker's commit.
 */
export function decideSchemaVersion(
  ledger: readonly LedgerRow[] | null,
  files: ReadonlyArray<{ name: string; sha256: string }>,
): string {
  return decideRuntimeSchemaVersion(ledger, files, WORKER_REFUSAL);
}
