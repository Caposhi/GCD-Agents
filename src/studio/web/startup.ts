/**
 * The Studio web service's start-up decisions (docs/CONTENT_STUDIO_DESIGN.md
 * §3.2, §7): the environment refusal and the configuration it accepts, then the
 * database identity and schema-version check. Each is a pure function over
 * data, so the offline suite (`web.offline.selftest.ts`) proves every refusal,
 * the mutation harness proves each one load-bearing, and the disposable
 * PostgreSQL suite proves the identity refusal end to end.
 *
 * Every refusal here is made before any connection is opened. This module reads
 * nothing itself: the entry point (`main.ts`) hands it what it read. It imports
 * only the S2 runner module, which the worker shares, and nothing from the
 * worker, the pipeline or the live runtime.
 */

import {
  decideRuntimeIdentity, decideRuntimeSchemaVersion, forbiddenNamesPresent, parseCapMicros, resolveStudioDatabaseUrl,
  type LedgerRow, type RuntimeRefusal, type StudioIdentityProbe,
} from "../db/runner.js";

/** A refusal to start: the web service connects to nothing, or stops before it listens. */
export class WebStartupRefusal extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = "WebStartupRefusal";
  }
}

const refuse = (reason: string, message: string): never => {
  throw new WebStartupRefusal(reason, message);
};

/**
 * Refused on the web in EVERY phase, beside the shared list (design §3.1,
 * §9.1): the web service never calls a model, so it never carries a provider
 * key, whatever the worker may carry later.
 */
export const WEB_FORBIDDEN_VARIABLES = ["ANTHROPIC_API_KEY"] as const;

/** The only Google Workspace domain whose `hd` claim the Studio accepts (design §3.2). */
export const STUDIO_ALLOWED_HD = "germancardepot.com";
/** The listening port when `PORT` is unset (as the live API's default). */
export const DEFAULT_PORT = 3000;

/** What the entry point reads from its environment, and all it reads. */
export interface WebEnvironment {
  /** Every variable name present (names only: no value is read for the refusal). */
  names: readonly string[];
  studioDatabaseUrl: string | undefined;
  publicOrigin: string | undefined;
  allowedHd: string | undefined;
  googleClientId: string | undefined;
  googleClientSecret: string | undefined;
  bootstrapOwnerEmail: string | undefined;
  port: string | undefined;
  /** `RENDER_GIT_COMMIT`: the commit `/healthz` reports. */
  commit: string | undefined;
  /** Content Studio S6.2: the deployment ceilings a confirmation is bounded by (design §6.2). */
  maxDailyUsd: string | undefined;
  maxMonthlyUsd: string | undefined;
}

/**
 * The deployment ceilings (`STUDIO_MAX_DAILY_USD`, `STUDIO_MAX_MONTHLY_USD`) in
 * micro-dollars, parsed by the worker's own `parseCapMicros` (S2 runner module):
 * missing, empty, unreadable or unparsable is ZERO, which refuses every
 * confirmation (fail closed). They bound the owner's caps; they never raise them.
 */
export interface DeploymentCeilings {
  dailyMicros: number;
  monthlyMicros: number;
}

/** The configuration the web service runs with. Every URL it makes is derived from `publicOrigin`. */
export interface WebConfig {
  publicOrigin: string;
  allowedHd: string;
  clientId: string;
  clientSecret: string;
  /** Lower-cased; null when unset, which refuses the bootstrap (design §7.2). Ignored once an owner exists. */
  bootstrapOwnerEmail: string | null;
  /** Content Studio S6.2: the deployment ceilings every confirmation is checked against. */
  ceilings: DeploymentCeilings;
}

export interface WebStartup {
  connectionString: string;
  port: number;
  commit: string;
  config: WebConfig;
  /** Ceilings that were missing or unreadable, and so are zero (every confirmation is refused). */
  zeroCaps: string[];
}

/** The forbidden variables present, by name, in name order. */
export function webForbiddenVariablesPresent(names: readonly string[]): string[] {
  return forbiddenNamesPresent(names, WEB_FORBIDDEN_VARIABLES);
}

/**
 * The exact HTTPS origin, or null: `https://host[:port]` with nothing else —
 * no path (not even a trailing slash), query, fragment, credentials, upper
 * case, default port or surrounding space. It must equal its own parsed origin.
 */
export function exactHttpsOrigin(raw: string | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  return url.origin === raw ? raw : null;
}

/**
 * Whether the web service may start, and with what. Refused, before any
 * connection: (a) any forbidden variable present, whatever its value, even
 * empty; `STUDIO_DATABASE_URL` missing or not a PostgreSQL URL; (b) a
 * `STUDIO_PUBLIC_ORIGIN` that is not an exact https origin; (c) a
 * `STUDIO_ALLOWED_HD` other than germancardepot.com; (d) a missing or empty
 * client id or client secret; a `PORT` that is not a port; and a commit that
 * is not a full 40-character SHA. Messages name variables, never values.
 */
export function decideWebStartup(env: WebEnvironment): WebStartup {
  const forbidden = webForbiddenVariablesPresent(env.names);
  if (forbidden.length) {
    refuse("forbidden-variable",
      `forbidden variable(s) present: ${forbidden.join(", ")}. The Studio web service refuses to start beside any live `
      + "credential, the live database's variable or a provider key, whatever the value.");
  }
  let connectionString: string;
  try {
    connectionString = resolveStudioDatabaseUrl({ studioDatabaseUrl: env.studioDatabaseUrl, databaseUrlPresent: false });
  } catch (error) {
    return refuse((error as { reason?: string }).reason ?? "studio-database-url", (error as Error).message);
  }
  const publicOrigin = exactHttpsOrigin(env.publicOrigin);
  if (publicOrigin === null) {
    refuse("public-origin",
      "STUDIO_PUBLIC_ORIGIN must be the Studio's exact https origin: https://host, with no path, trailing slash, query or fragment.");
  }
  if (env.allowedHd !== STUDIO_ALLOWED_HD) {
    refuse("allowed-hd", `STUDIO_ALLOWED_HD must be exactly ${STUDIO_ALLOWED_HD}.`);
  }
  const clientId = env.googleClientId?.trim() ?? "";
  const clientSecret = env.googleClientSecret?.trim() ?? "";
  if (!clientId || !clientSecret) {
    refuse("google-client", "STUDIO_GOOGLE_CLIENT_ID and STUDIO_GOOGLE_CLIENT_SECRET must both be set and non-empty.");
  }
  let port = DEFAULT_PORT;
  if (env.port !== undefined && env.port !== "") {
    port = /^[1-9][0-9]{0,4}$/.test(env.port) ? Number(env.port) : 0;
    if (port < 1 || port > 65_535) refuse("port", "PORT must be a TCP port number.");
  }
  const commit = env.commit?.trim() ?? "";
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    refuse("commit-missing", "RENDER_GIT_COMMIT must be the full 40-character lowercase commit SHA this service runs.");
  }
  const bootstrap = env.bootstrapOwnerEmail?.trim().toLowerCase() ?? "";
  const ceilings: DeploymentCeilings = {
    dailyMicros: parseCapMicros(env.maxDailyUsd),
    monthlyMicros: parseCapMicros(env.maxMonthlyUsd),
  };
  return {
    connectionString,
    port,
    commit,
    config: {
      publicOrigin: publicOrigin!,
      allowedHd: STUDIO_ALLOWED_HD,
      clientId,
      clientSecret,
      bootstrapOwnerEmail: bootstrap === "" ? null : bootstrap,
      ceilings,
    },
    zeroCaps: [
      ...(ceilings.dailyMicros === 0 ? ["STUDIO_MAX_DAILY_USD"] : []),
      ...(ceilings.monthlyMicros === 0 ? ["STUDIO_MAX_MONTHLY_USD"] : []),
    ],
  };
}

/** The web service's refusals: its own class, and its own words. */
const WEB_REFUSAL: RuntimeRefusal = {
  refuse,
  who: "web service",
  deployHint: "run `npm run studio:migrate` at this commit before the web service starts.",
};

/**
 * (e) The database is the Studio's — `current_database()` is `gcd_studio`, no
 * live-schema table, the tripwire, the ledger and the `studio_database_identity`
 * row — exactly the worker's check. An unmigrated database is refused too.
 */
export function decideWebIdentity(probe: StudioIdentityProbe): void {
  decideRuntimeIdentity(probe, WEB_REFUSAL);
}

/** (e) The applied schema version must be exactly the one this code expects, as for the worker. */
export function decideWebSchemaVersion(
  ledger: readonly LedgerRow[] | null,
  files: ReadonlyArray<{ name: string; sha256: string }>,
): string {
  return decideRuntimeSchemaVersion(ledger, files, WEB_REFUSAL);
}
