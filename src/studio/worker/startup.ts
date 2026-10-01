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
 */

import {
  decideStudioIdentity, planStudioMigrations, resolveStudioDatabaseUrl, type LedgerRow, type StudioIdentityProbe,
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
 * even empty, is a refusal.
 */
export const FORBIDDEN_VARIABLES = [
  "DATABASE_URL", "CONSOLE_TOKEN", "GOOGLE_ACCESS_TOKEN", "GOOGLE_REFRESH_TOKEN", "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET", "IMAGEGEN_API_KEY", "APPROVAL_CHANNEL_WEBHOOK", "AUTONOMY_PHASE", "PUBLIC_BASE_URL",
  "ACTIVE_PLATFORMS",
] as const;
export const FORBIDDEN_PREFIXES = ["IG_", "FB_", "GBP_"] as const;
/**
 * Refused in S3 only: live runs are enabled in S6, so until then the worker
 * holds no provider key at all — and the live `config.ts`, which the stage
 * modules load, never sees one.
 */
export const S3_FORBIDDEN_VARIABLES = ["ANTHROPIC_API_KEY"] as const;

/** What the entry point reads from its environment, and all it reads. */
export interface WorkerEnvironment {
  /** Every variable name present (names only: no value is read for the refusal). */
  names: readonly string[];
  studioDatabaseUrl: string | undefined;
  maxDailyUsd: string | undefined;
  maxMonthlyUsd: string | undefined;
  /** `RENDER_GIT_COMMIT`: the commit the heartbeat and every claim record. */
  commit: string | undefined;
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
}

/** The forbidden variables present, by name, in name order. */
export function forbiddenVariablesPresent(names: readonly string[]): string[] {
  const exact = new Set<string>([...FORBIDDEN_VARIABLES, ...S3_FORBIDDEN_VARIABLES]);
  return [...new Set(names)].filter((name) => exact.has(name) || FORBIDDEN_PREFIXES.some((p) => name.startsWith(p))).sort();
}

/**
 * Whether the worker may start, and with what. Refused, before any connection:
 * any forbidden variable present, `STUDIO_DATABASE_URL` missing or not a
 * PostgreSQL URL, and a commit that is not a full 40-character SHA. Messages
 * name variables, never values.
 */
export function decideWorkerStartup(env: WorkerEnvironment): WorkerStartup {
  const forbidden = forbiddenVariablesPresent(env.names);
  if (forbidden.length) {
    refuse("forbidden-variable",
      `forbidden variable(s) present: ${forbidden.join(", ")}. The Studio worker refuses to start beside any live `
      + "credential, the live database's variable or (until S6) a provider key, whatever the value.");
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
  return { connectionString, caps: { dailyMicros, monthlyMicros }, commit, zeroCaps };
}

/**
 * The Studio migrations this code expects, in order, and so its schema
 * version: the last of them. A database whose ledger is anything else — a
 * migration missing, an extra one, or one whose bytes changed — is refused at
 * start-up, before ownership (design §5.3, version skew).
 */
export const STUDIO_EXPECTED_MIGRATIONS = ["0001_studio_identity_and_tripwire.sql", "0002_studio_schema.sql"] as const;
export const STUDIO_SCHEMA_VERSION = STUDIO_EXPECTED_MIGRATIONS[STUDIO_EXPECTED_MIGRATIONS.length - 1]!;

/**
 * The database is the Studio's: named `gcd_studio`, no live-schema table, the
 * tripwire, the ledger and the identity row — S2's runner decision, repeated
 * at run time (design §3.2). An unmigrated database is refused too.
 */
export function decideWorkerIdentity(probe: StudioIdentityProbe): void {
  if (decideStudioIdentity(probe).kind !== "studio") {
    refuse("not-migrated", "the Studio database has not been migrated; the worker runs only against a migrated gcd_studio.");
  }
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
  const expected = [...STUDIO_EXPECTED_MIGRATIONS];
  const fileNames = [...files].map((f) => f.name).sort();
  if (JSON.stringify(fileNames) !== JSON.stringify(expected)) {
    refuse("schema-version",
      `this worker's studio/migrations holds ${JSON.stringify(fileNames)}, not the ${JSON.stringify(expected)} its code expects.`);
  }
  const recorded = [...(ledger ?? [])].map((row) => row.name).sort();
  if (JSON.stringify(recorded) !== JSON.stringify(expected)) {
    refuse("schema-version",
      `the database's Studio schema is ${JSON.stringify(recorded)}, not the ${STUDIO_SCHEMA_VERSION} this worker expects; `
      + "the web service (which runs the migrations) is deployed first, at the same commit.");
  }
  const plan = planStudioMigrations(files, ledger ?? []);
  if (plan.pending.length !== 0) refuse("schema-version", "studio migrations remain unapplied.");
  return STUDIO_SCHEMA_VERSION;
}
