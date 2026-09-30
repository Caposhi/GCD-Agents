/**
 * The Content Studio migration runner (docs/CONTENT_STUDIO_DESIGN.md §3.7).
 * Its entry point is `migrate.ts` (`npm run studio:migrate`). It is kept
 * strictly separate from the live runner, `src/state/migrate.ts`, which it
 * never imports and which is unchanged:
 *
 * 1. Different files: it reads only `studio/migrations/NNNN_*.sql`.
 * 2. A different ledger: `studio_schema_migrations`, recording each file's
 *    sha256. A recorded file whose bytes have changed is refused.
 * 3. A different connection variable: `STUDIO_DATABASE_URL` only, refused
 *    while `DATABASE_URL` is present at all (`resolveStudioDatabaseUrl`).
 * 4. Database identity checks, made with read-only queries before any other
 *    statement: `current_database()` is `gcd_studio`, no live-schema table
 *    exists, and the `studio_database_identity` row matches
 *    (`decideStudioIdentity`).
 * 5. The tripwire `_migrations` table created by migration 0001, whose
 *    `CHECK (false)` stops the live runner if it is ever pointed here. This
 *    runner refuses a `_migrations` table that lacks it.
 *
 * The decisions are pure functions over data, so the offline suite
 * (`migrate.offline.selftest.ts`) proves each refusal, and the disposable
 * PostgreSQL suite (`migrate.postgres.selftest.ts`) proves them end to end.
 * Nothing here imports the live runtime (`src/harness/config.ts` reads
 * `DATABASE_URL`), and nothing live imports this.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** The Studio database's name: Render's `databaseName: gcd_studio` (design §3.1). */
export const STUDIO_DATABASE_NAME = "gcd_studio";
/** The value migration 0001 writes into the singleton identity row. */
export const STUDIO_IDENTITY_MARKER = "gcd-studio:database-identity:v1";
/** The tripwire constraint on the Studio's `_migrations` table (migration 0001). */
export const STUDIO_TRIPWIRE_CONSTRAINT = "studio_tripwire_refuses_live_runner";
/** The only directory the Studio runner reads, relative to the repository root. */
export const STUDIO_MIGRATIONS_DIRECTORY = "studio/migrations";
export const STUDIO_MIGRATION_FILE = /^[0-9]{4}_[a-z0-9_]+\.sql$/;
/** Serializes concurrent Studio runners; a different key in a different database from every live lock. */
export const STUDIO_MIGRATION_LOCK_NAMESPACE = "gcd-studio:migration-runner:v1";

/**
 * Every table the live migrations (`state/migrations/*.sql`) create, except
 * `_migrations`, which is judged by its tripwire constraint instead. Any of
 * them in a database marks it as a live database. The offline suite checks
 * this list against the live SQL, so a new live table cannot be missed.
 */
export const LIVE_SCHEMA_TABLES = [
  "approval_decisions",
  "approval_queue",
  "brand_scorecard",
  "brief_queue",
  "content_evidence",
  "content_evidence_relations",
  "events",
  "media",
  "self_improvement_proposals",
  "session_state",
] as const;

/** A refusal: the runner stops, changes nothing, and says why. */
export class StudioMigrationRefusal extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = "StudioMigrationRefusal";
  }
}

const refuse = (reason: string, message: string): never => {
  throw new StudioMigrationRefusal(reason, message);
};

export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

// --- Separation 3: the connection variable ----------------------------------

/**
 * What the entry point reads from its environment, and all it reads:
 * `STUDIO_DATABASE_URL`'s value, and only whether `DATABASE_URL` is present.
 */
export interface StudioEnvironment {
  studioDatabaseUrl: string | undefined;
  databaseUrlPresent: boolean;
}

/**
 * The connection string, or a refusal. `DATABASE_URL` is refused whatever its
 * value, even empty: no Studio process carries that name (design §3.2).
 * Messages never echo a URL, which may carry a password.
 */
export function resolveStudioDatabaseUrl(env: StudioEnvironment): string {
  if (env.databaseUrlPresent) {
    refuse("database-url-present",
      "DATABASE_URL is present in this environment. The Studio runner reads only STUDIO_DATABASE_URL "
      + "and refuses to run beside the live database's variable; unset DATABASE_URL.");
  }
  const url = env.studioDatabaseUrl?.trim();
  if (!url) return refuse("studio-database-url-missing", "STUDIO_DATABASE_URL is not set.");
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return refuse("studio-database-url-invalid", "STUDIO_DATABASE_URL is not a URL.");
  }
  if (protocol !== "postgres:" && protocol !== "postgresql:") {
    refuse("studio-database-url-invalid", "STUDIO_DATABASE_URL is not a PostgreSQL URL.");
  }
  return url;
}

// --- Separation 2: the files and the sha256 ledger --------------------------

export interface StudioMigrationFile {
  name: string;
  sha256: string;
  sql: string;
}

export interface LedgerRow {
  name: string;
  sha256: string;
}

export interface StudioMigrationPlan {
  /** Recorded files, in order; their bytes match the ledger. */
  applied: string[];
  /** Files to apply, in order. */
  pending: string[];
}

/**
 * Which files to apply, or a refusal. Refused: a `.sql` file not named
 * `NNNN_name.sql`, two files with one number, a recorded file that is missing
 * or whose bytes have changed (sha256), and a recorded set that is not the
 * first files in order (an unapplied file sorting before an applied one).
 */
export function planStudioMigrations(
  files: ReadonlyArray<{ name: string; sha256: string }>,
  ledger: readonly LedgerRow[],
): StudioMigrationPlan {
  const names = files.map((file) => file.name);
  for (const name of names) {
    if (!STUDIO_MIGRATION_FILE.test(name)) {
      refuse("migration-name", `studio migration file ${JSON.stringify(name)} is not named NNNN_name.sql.`);
    }
  }
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const numbers = sorted.map((file) => file.name.slice(0, 4));
  if (new Set(numbers).size !== numbers.length) {
    refuse("migration-number", "two studio migration files share a number.");
  }
  const byName = new Map(sorted.map((file) => [file.name, file]));
  const recorded = [...ledger].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const row of recorded) {
    const file = byName.get(row.name);
    if (!file) {
      refuse("migration-missing", `recorded studio migration ${row.name} is no longer in ${STUDIO_MIGRATIONS_DIRECTORY}.`);
    } else if (file.sha256 !== row.sha256) {
      refuse("migration-changed",
        `recorded studio migration ${row.name} has changed since it was applied `
        + `(sha256 recorded ${row.sha256}, now ${file.sha256}); applied migrations are never edited.`);
    }
  }
  recorded.forEach((row, index) => {
    if (sorted[index]?.name !== row.name) {
      refuse("migration-order",
        `studio migration ${sorted[index]?.name ?? "(none)"} sorts before the applied ${row.name} but is not applied.`);
    }
  });
  return {
    applied: recorded.map((row) => row.name),
    pending: sorted.slice(recorded.length).map((file) => file.name),
  };
}

/** Every `.sql` file in the directory, with the sha256 of its exact bytes. */
export async function readStudioMigrationFiles(directory: string): Promise<StudioMigrationFile[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  return Promise.all(names.map(async (name) => {
    const bytes = await readFile(join(directory, name));
    return { name, sha256: sha256Hex(bytes), sql: bytes.toString("utf8") };
  }));
}

// --- Separation 4: the database identity ------------------------------------

/** What the read-only identity queries found. */
export interface StudioIdentityProbe {
  currentDatabase: string;
  /** Live-schema tables found, as `schema.table`. */
  liveTables: string[];
  /** `_migrations`: absent, the Studio tripwire in `public`, or anything else (a live ledger). */
  migrationsTable: "absent" | "tripwire" | "live";
  /** `studio_*` tables found in `public`. */
  studioTables: string[];
  /** Rows of `public.studio_database_identity`, or null when the table is absent. */
  identityRows: Array<{ database_name: string; marker: string }> | null;
  /** Rows of `public.studio_schema_migrations`, or null when the table is absent. */
  ledger: LedgerRow[] | null;
}

export type StudioIdentityDecision = { kind: "fresh" } | { kind: "studio" };

/**
 * Whether the runner may proceed, and from where, or a refusal. It proceeds
 * only on a database named `gcd_studio` holding no live-schema table and
 * either nothing of the Studio's (fresh) or the Studio's complete identity:
 * the tripwire, the ledger and exactly one matching identity row.
 */
export function decideStudioIdentity(probe: StudioIdentityProbe): StudioIdentityDecision {
  if (probe.currentDatabase !== STUDIO_DATABASE_NAME) {
    refuse("wrong-database",
      `current_database() is ${JSON.stringify(probe.currentDatabase)}, not ${STUDIO_DATABASE_NAME}; `
      + "the Studio runner applies nothing to any other database.");
  }
  if (probe.liveTables.length > 0) {
    refuse("live-schema",
      `this database holds live-schema tables (${probe.liveTables.join(", ")}); the Studio runner refuses it.`);
  }
  if (probe.migrationsTable === "live") {
    refuse("live-ledger",
      "this database has a _migrations table without the Studio tripwire constraint: it is a live database.");
  }
  if (probe.ledger === null) {
    if (probe.migrationsTable !== "absent" || probe.identityRows !== null || probe.studioTables.length > 0) {
      refuse("partial-studio",
        "this database has Studio objects but no studio_schema_migrations ledger; the Studio runner refuses it.");
    }
    return { kind: "fresh" };
  }
  if (probe.migrationsTable !== "tripwire") {
    refuse("tripwire-missing", "the Studio tripwire _migrations table is missing; the Studio runner refuses this database.");
  }
  const rows = probe.identityRows ?? [];
  if (rows.length !== 1 || rows[0]!.database_name !== STUDIO_DATABASE_NAME || rows[0]!.marker !== STUDIO_IDENTITY_MARKER) {
    refuse("identity-mismatch", "the studio_database_identity row is missing or does not match this Studio database.");
  }
  return { kind: "studio" };
}

/** The minimal client the runner needs (a `pg` Client satisfies it). */
export interface StudioSqlClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** The identity queries. Every one is a SELECT; none writes, locks or creates. */
export async function probeStudioIdentity(client: StudioSqlClient): Promise<StudioIdentityProbe> {
  const current = await client.query("SELECT current_database() AS name");
  const tables = await client.query(
    `SELECT n.nspname AS schema, c.relname AS name
       FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_toast%'
        AND (c.relname = ANY ($1::text[]) OR c.relname = '_migrations' OR c.relname LIKE 'studio\\_%')
      ORDER BY 1, 2`,
    [[...LIVE_SCHEMA_TABLES]],
  );
  const found = tables.rows.map((row) => ({ schema: String(row.schema), name: String(row.name) }));
  const live = new Set<string>(LIVE_SCHEMA_TABLES);
  const liveTables = found.filter((table) => live.has(table.name)).map((table) => `${table.schema}.${table.name}`);
  const studioTables = found.filter((table) => table.schema === "public" && table.name.startsWith("studio_"))
    .map((table) => table.name);
  const ledgers = found.filter((table) => table.name === "_migrations");
  let migrationsTable: StudioIdentityProbe["migrationsTable"] = "absent";
  if (ledgers.length > 0) {
    migrationsTable = "live";
    if (ledgers.length === 1 && ledgers[0]!.schema === "public") {
      const tripwire = await client.query(
        `SELECT pg_catalog.pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint
          WHERE conrelid = 'public._migrations'::regclass AND contype = 'c' AND conname = $1`,
        [STUDIO_TRIPWIRE_CONSTRAINT],
      );
      if (tripwire.rows.length === 1 && tripwire.rows[0]!.definition === "CHECK (false)") migrationsTable = "tripwire";
    }
  }
  const identityRows = studioTables.includes("studio_database_identity")
    ? (await client.query("SELECT database_name, marker FROM public.studio_database_identity")).rows
      .map((row) => ({ database_name: String(row.database_name), marker: String(row.marker) }))
    : null;
  const ledger = studioTables.includes("studio_schema_migrations")
    ? (await client.query("SELECT name, sha256 FROM public.studio_schema_migrations ORDER BY name")).rows
      .map((row) => ({ name: String(row.name), sha256: String(row.sha256) }))
    : null;
  return {
    currentDatabase: String(current.rows[0]?.name ?? ""),
    liveTables,
    migrationsTable,
    studioTables,
    identityRows,
    ledger,
  };
}

// --- The run ------------------------------------------------------------------

const lockKey = (): [number, number] => {
  const digest = createHash("sha256").update(STUDIO_MIGRATION_LOCK_NAMESPACE).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
};

export interface StudioMigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Probe, decide, plan, then apply each pending file in its own transaction:
 * take the runner lock, probe and plan again under it, run the file, record
 * its name and sha256, commit. Any refusal before the first file is raised
 * after the read-only probe alone, so nothing else has run. A failure inside a
 * file rolls that file back and stops.
 */
export async function runStudioMigrations(
  client: StudioSqlClient,
  options: { directory: string; log?: (line: string) => void },
): Promise<StudioMigrationResult> {
  const log = options.log ?? (() => {});
  const probe = await probeStudioIdentity(client);
  decideStudioIdentity(probe);
  const files = await readStudioMigrationFiles(options.directory);
  const plan = planStudioMigrations(files, probe.ledger ?? []);
  for (const name of plan.applied) log(`[studio-migrate] skip ${name} (already applied, sha256 matches)`);
  const byName = new Map(files.map((file) => [file.name, file]));
  for (const name of plan.pending) {
    const file = byName.get(name)!;
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", lockKey());
      const again = await probeStudioIdentity(client);
      decideStudioIdentity(again);
      if (planStudioMigrations(files, again.ledger ?? []).pending[0] !== name) {
        refuse("concurrent-runner", `studio migration ${name} was applied by another runner meanwhile.`);
      }
      await client.query(file.sql);
      await client.query("INSERT INTO studio_schema_migrations (name, sha256) VALUES ($1, $2)", [name, file.sha256]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    log(`[studio-migrate] applied ${name}`);
  }
  const final = await probeStudioIdentity(client);
  if (decideStudioIdentity(final).kind !== "studio") {
    refuse("identity-after", "the Studio identity is not complete after migrating.");
  }
  const finalPlan = planStudioMigrations(files, final.ledger ?? []);
  if (finalPlan.pending.length > 0) refuse("incomplete", "studio migrations remain unapplied after migrating.");
  log("[studio-migrate] done");
  return { applied: plan.pending, skipped: plan.applied };
}
