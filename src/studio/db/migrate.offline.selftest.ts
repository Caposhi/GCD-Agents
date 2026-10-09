/**
 * Offline self-test for the Content Studio migration runner
 * (docs/CONTENT_STUDIO_DESIGN.md §3.7): everything that needs no database.
 * The environment refusal, the file-sha256 ledger, the identity decision, the
 * refusal-before-any-statement order, and the drift checks that tie the
 * runner's constants and the Studio SQL to the live migrations and to the
 * pipeline's closed sets. The compiled entry point is run as a child process
 * against a loopback TCP listener this suite owns; nothing leaves the machine
 * and no database is contacted. The disposable PostgreSQL suite
 * (`migrate.postgres.selftest.ts`) proves the same rules end to end.
 *
 * Run: npm run build && npm run test:studio-db
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { resolve } from "node:path";
import { CRITIC_FINDING_CATEGORIES, CRITIC_FINDING_OWNERS, CRITIC_FINDING_SEVERITIES,
  CRITIC_LENS_CATEGORIES, CRITIC_VERDICTS } from "../../harness/agents/finalCritic.js";
import { PACKAGING_PLATFORMS } from "../../harness/agents/packagingAdaptation.js";
import { CRITIC_LENSES } from "../../harness/agents/payloadContract.js";
import { TARGET_STAGE_IDS } from "../../harness/agents/registry.js";
import {
  decideStudioIdentity,
  LIVE_SCHEMA_TABLES,
  planStudioMigrations,
  PREFLIGHT_PARAMS_SCHEMA,
  preflightParamsCanonical,
  preflightParamsSha256,
  readStudioMigrationFiles,
  resolveStudioDatabaseUrl,
  runStudioMigrations,
  sha256Hex,
  STUDIO_DATABASE_NAME,
  STUDIO_EXPECTED_MIGRATIONS,
  STUDIO_IDENTITY_MARKER,
  STUDIO_MIGRATIONS_DIRECTORY,
  STUDIO_SCHEMA_VERSION,
  STUDIO_TRIPWIRE_CONSTRAINT,
  StudioMigrationRefusal,
  type StudioIdentityProbe,
  type StudioSqlClient,
} from "./runner.js";

const root = process.cwd();
let failures = 0;
function check(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
}

/** The refusal's reason, or undefined when `fn` did not refuse. */
function refusalOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof StudioMigrationRefusal ? error.reason : `not-a-refusal:${String(error)}`;
  }
}

const PASSWORD = "studio-offline-placeholder";
const urlFor = (port: number | "{PORT}") => `postgresql://studio_offline:${PASSWORD}@127.0.0.1:${port}/${STUDIO_DATABASE_NAME}`;

// ---------------------------------------------------------------------------
// The compiled entry point, as a child, against a listener this suite owns.
// ---------------------------------------------------------------------------

interface ChildRun { code: number | null; stderr: string; stdout: string; connections: number }

async function runEntryPoint(env: Record<string, string>): Promise<ChildRun> {
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    socket.destroy();
  });
  await new Promise<void>((settle) => server.listen(0, "127.0.0.1", settle));
  const port = (server.address() as { port: number }).port;
  const childEnv: Record<string, string> = { PATH: process.env.PATH ?? "" };
  for (const [name, value] of Object.entries(env)) childEnv[name] = value.replaceAll("{PORT}", String(port));
  try {
    return await new Promise<ChildRun>((settle) => {
      execFile(process.execPath, [resolve(root, "dist/studio/db/migrate.js")], { cwd: root, env: childEnv, timeout: 30_000 },
        (error, stdout, stderr) => {
          const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
          settle({ code, stdout: String(stdout), stderr: String(stderr), connections: sockets.length });
        });
    });
  } finally {
    await new Promise<void>((settle) => server.close(() => settle()));
  }
}

// ---------------------------------------------------------------------------
// A recording client for the runner's statement order.
// ---------------------------------------------------------------------------

interface FakeDatabase {
  currentDatabase: string;
  tables: Array<{ schema: string; name: string }>;
  tripwire: boolean;
  identityRows: Array<{ database_name: string; marker: string }>;
  ledger: Array<{ name: string; sha256: string }>;
}

function recordingClient(db: FakeDatabase): StudioSqlClient & { statements: string[] } {
  const statements: string[] = [];
  return {
    statements,
    async query(text: string, values?: unknown[]) {
      statements.push(text.trim());
      if (text.startsWith("SELECT current_database()")) return { rows: [{ name: db.currentDatabase }] };
      if (text.startsWith("SELECT n.nspname")) return { rows: db.tables.map((table) => ({ ...table })) };
      if (text.startsWith("SELECT pg_catalog.pg_get_constraintdef")) {
        return { rows: db.tripwire ? [{ definition: "CHECK (false)" }] : [] };
      }
      if (text.startsWith("SELECT database_name, marker")) return { rows: db.identityRows };
      if (text.startsWith("SELECT name, sha256")) return { rows: db.ledger };
      if (text.startsWith("INSERT INTO studio_schema_migrations")) {
        db.ledger.push({ name: String(values?.[0]), sha256: String(values?.[1]) });
        return { rows: [] };
      }
      if (text.includes("CREATE TABLE _migrations")) {
        db.tables.push({ schema: "public", name: "_migrations" }, { schema: "public", name: "studio_schema_migrations" },
          { schema: "public", name: "studio_database_identity" });
        db.tripwire = true;
        db.identityRows = [{ database_name: db.currentDatabase, marker: STUDIO_IDENTITY_MARKER }];
      }
      return { rows: [] };
    },
  };
}

const isReadOnlyProbe = (statement: string) => /^SELECT\b/.test(statement) && !/pg_advisory/.test(statement);

const completeProbe = (overrides: Partial<StudioIdentityProbe> = {}): StudioIdentityProbe => ({
  currentDatabase: STUDIO_DATABASE_NAME,
  liveTables: [],
  migrationsTable: "tripwire",
  studioTables: ["studio_database_identity", "studio_schema_migrations"],
  identityRows: [{ database_name: STUDIO_DATABASE_NAME, marker: STUDIO_IDENTITY_MARKER }],
  ledger: [{ name: "0001_a.sql", sha256: "a".repeat(64) }],
  ...overrides,
});
const freshProbe = (overrides: Partial<StudioIdentityProbe> = {}): StudioIdentityProbe => ({
  currentDatabase: STUDIO_DATABASE_NAME,
  liveTables: [],
  migrationsTable: "absent",
  studioTables: [],
  identityRows: null,
  ledger: null,
  ...overrides,
});

async function main(): Promise<void> {
  // --- SM1: DATABASE_URL is refused, whatever its value ----------------------
  check("SM1. the Studio runner refuses when DATABASE_URL is present, whatever its value (set, empty), even "
    + "beside a valid STUDIO_DATABASE_URL, and the refusal names DATABASE_URL without echoing any URL",
  refusalOf(() => resolveStudioDatabaseUrl({ studioDatabaseUrl: urlFor(5432), databaseUrlPresent: true }))
      === "database-url-present"
    && refusalOf(() => resolveStudioDatabaseUrl({ studioDatabaseUrl: undefined, databaseUrlPresent: true }))
      === "database-url-present"
    && (() => {
      try {
        resolveStudioDatabaseUrl({ studioDatabaseUrl: urlFor(5432), databaseUrlPresent: true });
        return false;
      } catch (error) {
        const message = (error as Error).message;
        return message.includes("DATABASE_URL") && !message.includes(PASSWORD) && !message.includes("postgresql://");
      }
    })());

  const bothSet = await runEntryPoint({ STUDIO_DATABASE_URL: urlFor("{PORT}"), DATABASE_URL: "" });
  const bothSetFull = await runEntryPoint({
    STUDIO_DATABASE_URL: urlFor("{PORT}"),
    DATABASE_URL: `postgresql://live:${PASSWORD}@127.0.0.1:{PORT}/gcd_social`,
  });
  check("SM1a. the compiled entry point, with DATABASE_URL present (empty, or a URL), exits 1 with the "
    + "database-url-present refusal before making any connection, and prints no URL or password",
  [bothSet, bothSetFull].every((run) => run.code === 1 && run.connections === 0
    && run.stderr.includes("refused (database-url-present)")
    && !run.stderr.includes(PASSWORD) && !run.stdout.includes(PASSWORD) && !run.stderr.includes("postgresql://")));

  // --- SM2: STUDIO_DATABASE_URL is the only connection variable --------------
  const exact = urlFor(6543);
  check("SM2. the connection string is exactly STUDIO_DATABASE_URL's value; a missing, empty, non-URL or "
    + "non-PostgreSQL value is refused, and no refusal echoes the value",
  resolveStudioDatabaseUrl({ studioDatabaseUrl: exact, databaseUrlPresent: false }) === exact
    && refusalOf(() => resolveStudioDatabaseUrl({ studioDatabaseUrl: undefined, databaseUrlPresent: false }))
      === "studio-database-url-missing"
    && refusalOf(() => resolveStudioDatabaseUrl({ studioDatabaseUrl: "  ", databaseUrlPresent: false }))
      === "studio-database-url-missing"
    && refusalOf(() => resolveStudioDatabaseUrl({ studioDatabaseUrl: "not a url", databaseUrlPresent: false }))
      === "studio-database-url-invalid"
    && refusalOf(() => resolveStudioDatabaseUrl({ studioDatabaseUrl: `https://u:${PASSWORD}@h/x`, databaseUrlPresent: false }))
      === "studio-database-url-invalid"
    && (() => {
      try {
        resolveStudioDatabaseUrl({ studioDatabaseUrl: `https://u:${PASSWORD}@h/x`, databaseUrlPresent: false });
        return false;
      } catch (error) {
        return !(error as Error).message.includes(PASSWORD);
      }
    })());

  const studioOnly = await runEntryPoint({
    STUDIO_DATABASE_URL: urlFor("{PORT}"),
    // Decoys a careless reader might use; the entry point must ignore them.
    PGHOST: "127.0.0.1", PGPORT: "9", PGDATABASE: "gcd_social", STUDIO_DB_URL: "postgresql://decoy@127.0.0.1:9/gcd_studio",
  });
  const neither = await runEntryPoint({ PGHOST: "127.0.0.1", PGPORT: "{PORT}", PGDATABASE: STUDIO_DATABASE_NAME });
  check("SM2a. the compiled entry point connects to exactly STUDIO_DATABASE_URL's target (one connection to this "
    + "suite's listener, whatever PG* or look-alike variables say), and with no STUDIO_DATABASE_URL it refuses "
    + "without connecting, even when PG* variables name a server",
  studioOnly.code === 1 && studioOnly.connections === 1 && studioOnly.stderr.includes("[studio-migrate] fatal")
    && !studioOnly.stderr.includes(PASSWORD)
    && neither.code === 1 && neither.connections === 0 && neither.stderr.includes("refused (studio-database-url-missing)"));

  const studioSources = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts")) studioSources.set(path, readFileSync(resolve(root, path), "utf8"));
    }
  };
  walk("src/studio");
  const entry = studioSources.get("src/studio/db/migrate.ts") ?? "";
  const entryReads = [...entry.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[0]);
  const runtimeSources = [...studioSources].filter(([path]) => !path.endsWith(".selftest.ts"));
  // Since S3 the Studio has a second entry point, the worker's (design §3.2), held to its own exact list:
  // the names present (for its refusal), STUDIO_DATABASE_URL, the two caps and RENDER_GIT_COMMIT — and, since
  // Content Studio S6b, ANTHROPIC_API_KEY, once, handed to the start-up's live-runner decision — never
  // DATABASE_URL, never a computed name. Every other Studio runtime module still reads nothing.
  const WORKER_ENTRY = "src/studio/worker/main.ts";
  // Its code, without its comments (which name what it never reads).
  const worker = (studioSources.get(WORKER_ENTRY) ?? "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const workerReads = [...worker.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[0]);
  // Since S4 the web service's entry point is the third (design §3.2), held to its own exact list the same
  // way: the names present, STUDIO_DATABASE_URL, the origin, the hd, the client id and secret, the bootstrap
  // email, PORT and RENDER_GIT_COMMIT — and, since S6.2, the two deployment ceilings — never DATABASE_URL, a
  // provider key or a computed name.
  const WEB_ENTRY = "src/studio/web/main.ts";
  const web = (studioSources.get(WEB_ENTRY) ?? "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const webReads = [...web.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[0]);
  const otherReads = runtimeSources.filter(([path]) => path !== "src/studio/db/migrate.ts" && path !== WORKER_ENTRY && path !== WEB_ENTRY)
    .filter(([, text]) => /process\.env|process\[|\benv\s*\[/.test(text)).map(([path]) => path);
  check("SM2b. the entry point reads exactly STUDIO_DATABASE_URL's value and DATABASE_URL's presence "
    + "(`process.env.DATABASE_URL !== undefined`, never its value), in the dot form; the worker's entry point "
    + "(S3) reads exactly the names present, STUDIO_DATABASE_URL, the two caps, RENDER_GIT_COMMIT and (S6b) "
    + "ANTHROPIC_API_KEY — once, as the start-up's anthropicApiKey — in the dot form, and never DATABASE_URL; the web's entry point (S4) reads exactly the names present, STUDIO_DATABASE_URL, "
    + "STUDIO_PUBLIC_ORIGIN, STUDIO_ALLOWED_HD, the client id and secret, STUDIO_BOOTSTRAP_OWNER_EMAIL, PORT, "
    + "RENDER_GIT_COMMIT and (S6.2) the two caps STUDIO_MAX_DAILY_USD and STUDIO_MAX_MONTHLY_USD, in the dot form, and "
    + "never DATABASE_URL; no other Studio runtime module reads the environment; and no Studio module "
    + "imports the live runtime (config, state or migrate)"
    + (otherReads.length ? ` — ${otherReads.join(", ")}` : ""),
  JSON.stringify(entryReads.sort()) === JSON.stringify(["process.env.DATABASE_URL", "process.env.STUDIO_DATABASE_URL"])
    && /studioDatabaseUrl:\s*process\.env\.STUDIO_DATABASE_URL,/.test(entry)
    && /databaseUrlPresent:\s*process\.env\.DATABASE_URL\s*!==\s*undefined,/.test(entry)
    && !/process\.env\.DATABASE_URL(?!\s*!==\s*undefined)/.test(entry)
    && !/process\.env\[/.test(entry)
    && JSON.stringify(workerReads.sort()) === JSON.stringify(["process.env.ANTHROPIC_API_KEY", "process.env.RENDER_GIT_COMMIT",
      "process.env.STUDIO_DATABASE_URL", "process.env.STUDIO_MAX_DAILY_USD", "process.env.STUDIO_MAX_MONTHLY_USD"])
    && /\n    anthropicApiKey: process\.env\.ANTHROPIC_API_KEY,\n/.test(worker)
    && (worker.match(/process\.env\b(?!\.)/g) ?? []).length === 1 && /names:\s*Object\.keys\(process\.env\),/.test(worker)
    && worker.includes("process.env.STUDIO_DATABASE_URL")
    && !/process\.env\[|process\[|\benv\s*\[|DATABASE_URL/.test(worker.replace(/STUDIO_DATABASE_URL/g, ""))
    && JSON.stringify(webReads.sort()) === JSON.stringify(["process.env.PORT", "process.env.RENDER_GIT_COMMIT",
      "process.env.STUDIO_ALLOWED_HD", "process.env.STUDIO_BOOTSTRAP_OWNER_EMAIL", "process.env.STUDIO_DATABASE_URL",
      "process.env.STUDIO_GOOGLE_CLIENT_ID", "process.env.STUDIO_GOOGLE_CLIENT_SECRET", "process.env.STUDIO_MAX_DAILY_USD",
      "process.env.STUDIO_MAX_MONTHLY_USD", "process.env.STUDIO_PUBLIC_ORIGIN"])
    && (web.match(/process\.env\b(?!\.)/g) ?? []).length === 1 && /names:\s*Object\.keys\(process\.env\),/.test(web)
    && !/process\.env\[|process\[|\benv\s*\[|DATABASE_URL|ANTHROPIC/.test(web.replace(/STUDIO_DATABASE_URL/g, ""))
    && otherReads.length === 0
    && [...studioSources.values()].every((text) =>
      !/from\s+["'][^"']*harness\/(?:config|state)\.js["']/.test(text)
      && !/import\(\s*["'][^"']*harness\/(?:config|state)\.js["']/.test(text)
      && !/from\s+["'][^"']*\/state\/migrate\.js["']/.test(text)));

  // --- SM3: the sha256 ledger ------------------------------------------------
  const files = [
    { name: "0001_first.sql", sha256: sha256Hex(Buffer.from("one")) },
    { name: "0002_second.sql", sha256: sha256Hex(Buffer.from("two")) },
    { name: "0003_third.sql", sha256: sha256Hex(Buffer.from("three")) },
  ];
  const fresh = planStudioMigrations(files, []);
  const partial = planStudioMigrations(files, files.slice(0, 2));
  const complete = planStudioMigrations(files, files);
  const changedByOneByte = [{ name: "0001_first.sql", sha256: sha256Hex(Buffer.from("onf")) }];
  check("SM3. the ledger plan applies unrecorded files in order, skips recorded ones whose sha256 matches, and "
    + "refuses a recorded file whose bytes changed (one byte), a recorded file that is missing, and an unapplied "
    + "file sorting before an applied one",
  JSON.stringify(fresh.pending) === JSON.stringify(files.map((file) => file.name)) && fresh.applied.length === 0
    && JSON.stringify(partial.applied) === JSON.stringify(["0001_first.sql", "0002_second.sql"])
    && JSON.stringify(partial.pending) === JSON.stringify(["0003_third.sql"])
    && complete.pending.length === 0 && complete.applied.length === 3
    && refusalOf(() => planStudioMigrations(files, changedByOneByte)) === "migration-changed"
    && refusalOf(() => planStudioMigrations(files, [...files.slice(0, 1), { ...files[1]!, sha256: files[2]!.sha256 }]))
      === "migration-changed"
    && refusalOf(() => planStudioMigrations(files.slice(1), files.slice(0, 1))) === "migration-missing"
    && refusalOf(() => planStudioMigrations(files, [files[1]!])) === "migration-order");
  check("SM3a. file names are refused unless NNNN_name.sql with a unique number",
    refusalOf(() => planStudioMigrations([{ name: "1_bad.sql", sha256: files[0]!.sha256 }], [])) === "migration-name"
      && refusalOf(() => planStudioMigrations([{ name: "0001_Upper.sql", sha256: files[0]!.sha256 }], []))
        === "migration-name"
      && refusalOf(() => planStudioMigrations([files[0]!, { name: "0001_again.sql", sha256: files[1]!.sha256 }], []))
        === "migration-number");
  const repositoryFiles = await readStudioMigrationFiles(resolve(root, STUDIO_MIGRATIONS_DIRECTORY));
  check(`SM3b. ${STUDIO_MIGRATIONS_DIRECTORY}/ holds the Studio migrations in order, each fingerprinted by the `
    + "sha256 of its exact bytes, and plans cleanly from an empty ledger",
  JSON.stringify(repositoryFiles.map((file) => file.name))
      === JSON.stringify(["0001_studio_identity_and_tripwire.sql", "0002_studio_schema.sql",
        "0003_studio_preflight_requests.sql", "0004_studio_fact_checks_and_imports.sql"])
    && repositoryFiles.every((file) => file.sha256
      === sha256Hex(readFileSync(resolve(root, STUDIO_MIGRATIONS_DIRECTORY, file.name))))
    && planStudioMigrations(repositoryFiles, []).pending.length === repositoryFiles.length);
  check("SM3c. every runtime's expected migrations are exactly the repository's files, 0001, 0002, 0003 and 0004, in "
    + "order, and the schema version they expect is 0004_studio_fact_checks_and_imports.sql",
  JSON.stringify([...STUDIO_EXPECTED_MIGRATIONS]) === JSON.stringify(repositoryFiles.map((file) => file.name))
    && STUDIO_EXPECTED_MIGRATIONS.length === 4 && STUDIO_SCHEMA_VERSION === "0004_studio_fact_checks_and_imports.sql"
    && planStudioMigrations(repositoryFiles, repositoryFiles.slice(0, 3)).pending.join(",") === STUDIO_SCHEMA_VERSION);

  // --- SM4: the identity decision ---------------------------------------------
  check("SM4. the identity decision refuses any database not named gcd_studio",
    refusalOf(() => decideStudioIdentity(freshProbe({ currentDatabase: "gcd_social" }))) === "wrong-database"
      && refusalOf(() => decideStudioIdentity(completeProbe({ currentDatabase: "gcd_studio_copy" }))) === "wrong-database"
      && refusalOf(() => decideStudioIdentity(freshProbe({ currentDatabase: "" }))) === "wrong-database");
  check("SM4a. it refuses a database holding any live-schema table, in any schema, even beside a complete Studio identity",
    LIVE_SCHEMA_TABLES.every((table) =>
      refusalOf(() => decideStudioIdentity(freshProbe({ liveTables: [`public.${table}`] }))) === "live-schema"
      && refusalOf(() => decideStudioIdentity(completeProbe({ liveTables: [`other.${table}`] }))) === "live-schema"));
  check("SM4b. it refuses a _migrations table without the Studio tripwire (a live ledger), and a Studio ledger "
    + "without the tripwire",
  refusalOf(() => decideStudioIdentity(freshProbe({ migrationsTable: "live" }))) === "live-ledger"
    && refusalOf(() => decideStudioIdentity(completeProbe({ migrationsTable: "live" }))) === "live-ledger"
    && refusalOf(() => decideStudioIdentity(completeProbe({ migrationsTable: "absent" }))) === "tripwire-missing");
  check("SM4c. once the Studio ledger exists, the identity row must exist exactly once and match; and Studio "
    + "objects without a ledger are refused as partial",
  refusalOf(() => decideStudioIdentity(completeProbe({ identityRows: null }))) === "identity-mismatch"
    && refusalOf(() => decideStudioIdentity(completeProbe({ identityRows: [] }))) === "identity-mismatch"
    && refusalOf(() => decideStudioIdentity(completeProbe({
      identityRows: [{ database_name: STUDIO_DATABASE_NAME, marker: "gcd-studio:database-identity:v0" }] })))
      === "identity-mismatch"
    && refusalOf(() => decideStudioIdentity(completeProbe({
      identityRows: [{ database_name: "gcd_social", marker: STUDIO_IDENTITY_MARKER }] }))) === "identity-mismatch"
    && refusalOf(() => decideStudioIdentity(completeProbe({
      identityRows: [
        { database_name: STUDIO_DATABASE_NAME, marker: STUDIO_IDENTITY_MARKER },
        { database_name: STUDIO_DATABASE_NAME, marker: STUDIO_IDENTITY_MARKER }] }))) === "identity-mismatch"
    && refusalOf(() => decideStudioIdentity(freshProbe({ migrationsTable: "tripwire" }))) === "partial-studio"
    && refusalOf(() => decideStudioIdentity(freshProbe({ studioTables: ["studio_users"] }))) === "partial-studio"
    && refusalOf(() => decideStudioIdentity(freshProbe({ identityRows: [] }))) === "partial-studio");
  check("SM4d. it proceeds only on an empty gcd_studio (fresh) or a complete Studio identity",
    decideStudioIdentity(freshProbe()).kind === "fresh" && decideStudioIdentity(completeProbe()).kind === "studio");

  // --- SM5: refused before any statement, then one transaction per file --------
  const liveDb = recordingClient({
    currentDatabase: STUDIO_DATABASE_NAME,
    tables: [{ schema: "public", name: "_migrations" }, { schema: "public", name: "approval_queue" },
      { schema: "public", name: "session_state" }],
    tripwire: false, identityRows: [], ledger: [],
  });
  let liveRefusal = "";
  try {
    await runStudioMigrations(liveDb, { directory: resolve(root, STUDIO_MIGRATIONS_DIRECTORY) });
  } catch (error) {
    liveRefusal = error instanceof StudioMigrationRefusal ? error.reason : String(error);
  }
  const liveLedgerOnly = recordingClient({
    currentDatabase: STUDIO_DATABASE_NAME, tables: [{ schema: "public", name: "_migrations" }],
    tripwire: false, identityRows: [], ledger: [],
  });
  let ledgerRefusal = "";
  try {
    await runStudioMigrations(liveLedgerOnly, { directory: resolve(root, STUDIO_MIGRATIONS_DIRECTORY) });
  } catch (error) {
    ledgerRefusal = error instanceof StudioMigrationRefusal ? error.reason : String(error);
  }
  const fakeFresh = recordingClient({ currentDatabase: STUDIO_DATABASE_NAME, tables: [], tripwire: false,
    identityRows: [], ledger: [] });
  const applied = await runStudioMigrations(fakeFresh, { directory: resolve(root, STUDIO_MIGRATIONS_DIRECTORY) });
  const shape = fakeFresh.statements.filter((statement) => !isReadOnlyProbe(statement))
    .map((statement) => (statement.startsWith("SELECT pg_advisory_xact_lock") ? "LOCK"
      : statement.startsWith("INSERT INTO studio_schema_migrations") ? "RECORD"
      : ["BEGIN", "COMMIT", "ROLLBACK"].includes(statement) ? statement : "FILE"));
  check("SM5. against a live-schema database, and against one holding only a _migrations table without the "
    + "tripwire, the runner is refused having issued only read-only SELECT probes; against a fresh one it applies each file in its own transaction: BEGIN, runner lock, the file, its "
    + "ledger row, COMMIT",
  liveRefusal === "live-schema" && liveDb.statements.length > 0 && liveDb.statements.every(isReadOnlyProbe)
    && ledgerRefusal === "live-ledger" && liveLedgerOnly.statements.every(isReadOnlyProbe)
    && JSON.stringify(applied.applied) === JSON.stringify(repositoryFiles.map((file) => file.name))
    && JSON.stringify(shape) === JSON.stringify(repositoryFiles.flatMap(() => ["BEGIN", "LOCK", "FILE", "RECORD", "COMMIT"])));

  // --- SM6: drift between the runner, the Studio SQL and the live SQL ----------
  const liveSql = readdirSync(resolve(root, "state/migrations")).filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(resolve(root, "state/migrations", name), "utf8")).join("\n");
  const created = (sql: string) => new Set([...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi)]
    .map((match) => match[1]!.toLowerCase()));
  const liveCreated = created(liveSql);
  const liveRunner = readFileSync(resolve(root, "src/state/migrate.ts"), "utf8");
  if (liveRunner.includes("CREATE TABLE IF NOT EXISTS _migrations")) liveCreated.add("_migrations");
  const studioSql = repositoryFiles.map((file) => file.sql).join("\n");
  const studioCreated = created(studioSql);
  check("SM6. LIVE_SCHEMA_TABLES is exactly the tables the live migrations create (besides _migrations), and the "
    + "Studio migrations create no live table name except the tripwire _migrations",
  JSON.stringify([...liveCreated].filter((name) => name !== "_migrations").sort())
      === JSON.stringify([...LIVE_SCHEMA_TABLES].sort())
    && liveCreated.has("_migrations")
    && [...studioCreated].filter((name) => liveCreated.has(name)).join(",") === "_migrations"
    && [...studioCreated].filter((name) => name !== "_migrations").every((name) => name.startsWith("studio_")));
  const first = repositoryFiles[0]!.sql;
  check("SM6a. migration 0001 creates the tripwire _migrations table with the runner's named CHECK (false) on the "
    + "column the live runner inserts, the identity row with the runner's database name and marker, and the ledger; "
    + "every Studio migration refuses to run outside gcd_studio",
  new RegExp(`CREATE TABLE _migrations \\(\\s*name text CONSTRAINT \\w+ PRIMARY KEY\\s*CONSTRAINT ${STUDIO_TRIPWIRE_CONSTRAINT} CHECK \\(false\\)`)
      .test(first)
    && first.includes(`CHECK (database_name = '${STUDIO_DATABASE_NAME}')`) && first.includes(`CHECK (marker = '${STUDIO_IDENTITY_MARKER}')`)
    && first.includes("CREATE TABLE studio_schema_migrations")
    && liveRunner.includes("INSERT INTO _migrations (name) VALUES ($1)")
    && repositoryFiles.every((file) => file.sql.includes(`IF current_database() <> '${STUDIO_DATABASE_NAME}' THEN`)));

  const sqlSet = (constraint: string): string[] => {
    const match = new RegExp(`CONSTRAINT ${constraint} CHECK \\(\\w+ IN \\(([^)]*)\\)\\)`).exec(studioSql);
    return match ? [...match[1]!.matchAll(/'([^']*)'/g)].map((value) => value[1]!).sort() : [];
  };
  const same = (a: readonly string[], b: readonly string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const lensCategoriesInSql = (lens: string): string[] => {
    const match = new RegExp(`lens = '${lens}' AND category IN \\(([^)]*)\\)`).exec(studioSql);
    return match ? [...match[1]!.matchAll(/'([^']*)'/g)].map((value) => value[1]!) : [];
  };
  check("SM6b. the Studio schema's closed sets match the pipeline's: stages, lenses, finding severities, "
    + "categories, owners, each lens's categories and the critic's verdicts",
  same(sqlSet("studio_run_requests_stage"), TARGET_STAGE_IDS)
    && same(sqlSet("studio_run_requests_lens"), CRITIC_LENSES) && same(sqlSet("studio_findings_lens"), CRITIC_LENSES)
    && same(sqlSet("studio_findings_severity"), CRITIC_FINDING_SEVERITIES)
    && same(sqlSet("studio_findings_category"), CRITIC_FINDING_CATEGORIES)
    && same(sqlSet("studio_findings_owner"), CRITIC_FINDING_OWNERS)
    && CRITIC_LENSES.every((lens) => same(lensCategoriesInSql(lens), CRITIC_LENS_CATEGORIES[lens]))
    && same(sqlSet("studio_runs_verdict"), CRITIC_VERDICTS)
    && studioSql.includes("CHECK (owner_item = (owner = 'human_review' OR category = 'human_decision'))"));
  const preflightSql = repositoryFiles.find((file) => file.name === "0003_studio_preflight_requests.sql")?.sql ?? "";
  const platformsInSql = [...(/platforms <@ ARRAY\[([^\]]*)\]::text\[\]/.exec(preflightSql)?.[1] ?? "").matchAll(/'([^']*)'/g)]
    .map((value) => value[1]!);
  check("SM6d. the preflight request's closed sets match the pipeline's and the quote's: its platforms are exactly "
    + "PACKAGING_PLATFORMS and its actions exactly studio_quotes' actions",
  platformsInSql.length === PACKAGING_PLATFORMS.length && same(platformsInSql, PACKAGING_PLATFORMS)
    && sqlSet("studio_preflight_requests_action").length === 4
    && same(sqlSet("studio_preflight_requests_action"), sqlSet("studio_quotes_action")));

  const scripts = (JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
  const envExample = readFileSync(resolve(root, ".env.example"), "utf8");
  check("SM6c. `npm run studio:migrate` runs the compiled Studio entry point, the live `npm run migrate` is "
    + "unchanged, and .env.example declares STUDIO_DATABASE_URL as a local gcd_studio placeholder",
  scripts["studio:migrate"] === "node dist/studio/db/migrate.js" && scripts.migrate === "node dist/state/migrate.js"
    && /^STUDIO_DATABASE_URL=postgresql:\/\/[a-z_]+:[a-z_]+@localhost:5432\/gcd_studio$/m.test(envExample));

  // --- SM7 (Content Studio S6.2): migration 0003's canonical parameter form, computed by ONE function ----------
  // A fixed vector, written here by hand: the inputs, the canonical text and the expected hex. The goal keeps a
  // non-ASCII character exactly; the platforms and the scope arrive unsorted.
  const VECTOR_FULL = {
    action: "full", goal: "Brake service, explained plainly — für Kunden", platforms: ["instagram", "facebook"],
    scopeTags: ["brakes", "audi"], sourceRunId: null, factVersionId: "0b8f2a4e-6c1d-4f3a-9e7b-2d5c8a1f0e93",
  };
  const VECTOR_FULL_TEXT = '{"schema":"gcd-studio-preflight-params/1","action":"full","goal":"Brake service, explained plainly — für Kunden",'
    + '"platforms":["facebook","instagram"],"scopeTags":["audi","brakes"],"sourceRunId":null,"factVersionId":"0b8f2a4e-6c1d-4f3a-9e7b-2d5c8a1f0e93"}';
  const VECTOR_FULL_HEX = "e9a3cc1c2efc996768a55a85fee05e9045cfc8998e481f890b3860bf6759cb0d";
  const VECTOR_REVISE = {
    action: "revise", goal: null, platforms: ["instagram", "google_business_profile"], scopeTags: null,
    sourceRunId: "5f0c7d2e-1a3b-4c5d-8e9f-0a1b2c3d4e5f", factVersionId: "0b8f2a4e-6c1d-4f3a-9e7b-2d5c8a1f0e93",
  };
  const VECTOR_REVISE_HEX = "e6a1111d40ce8546f779adadf37ab03757fd32003b536271ccc0a8d9e71e9b85";
  check("SM7. the canonical parameter form matches a fixed vector written by hand: the full run's inputs give exactly the "
    + "canonical text (seven keys in 0003's order, the two arrays sorted, absent values null, the goal byte for byte) and "
    + `the hex ${VECTOR_FULL_HEX}; a revise with no goal and no scope gives ${VECTOR_REVISE_HEX}`,
    PREFLIGHT_PARAMS_SCHEMA === "gcd-studio-preflight-params/1"
      && preflightParamsCanonical(VECTOR_FULL) === VECTOR_FULL_TEXT
      && preflightParamsSha256(VECTOR_FULL) === VECTOR_FULL_HEX
      && createHash("sha256").update(Buffer.from(VECTOR_FULL_TEXT, "utf8")).digest("hex") === VECTOR_FULL_HEX
      && preflightParamsSha256(VECTOR_REVISE) === VECTOR_REVISE_HEX
      && Object.keys(JSON.parse(preflightParamsCanonical(VECTOR_REVISE))).join()
        === "schema,action,goal,platforms,scopeTags,sourceRunId,factVersionId");

  const base = preflightParamsSha256(VECTOR_FULL);
  const changed = [
    { ...VECTOR_FULL, action: "replay_critic" }, { ...VECTOR_FULL, goal: `${VECTOR_FULL.goal} ` },
    { ...VECTOR_FULL, goal: VECTOR_FULL.goal.normalize("NFD") }, { ...VECTOR_FULL, platforms: ["instagram"] },
    { ...VECTOR_FULL, platforms: ["instagram", "facebook", "google_business_profile"] }, { ...VECTOR_FULL, scopeTags: ["brakes"] },
    { ...VECTOR_FULL, scopeTags: null }, { ...VECTOR_FULL, scopeTags: ["brakes", "Audi"] },
    { ...VECTOR_FULL, sourceRunId: "5f0c7d2e-1a3b-4c5d-8e9f-0a1b2c3d4e5f" },
    { ...VECTOR_FULL, factVersionId: "0b8f2a4e-6c1d-4f3a-9e7b-2d5c8a1f0e94" },
  ].map((p) => preflightParamsSha256(p));
  check("SM7a. a reordered platforms or scope-tag list hashes the same, and any changed parameter hashes differently: the "
    + "action, a goal with a trailing space or another Unicode form, fewer or more platforms, another scope, no scope, a tag's "
    + "case, a source run and a fact version",
    preflightParamsSha256({ ...VECTOR_FULL, platforms: ["facebook", "instagram"], scopeTags: ["audi", "brakes"] }) === base
      && changed.every((hash) => hash !== base && /^[0-9a-f]{64}$/.test(hash)) && new Set(changed).size === changed.length);

  // SM7b: the web and the worker both call this one function, and no other formula exists.
  const studioRuntime = [...studioSources].filter(([path]) => !path.endsWith(".selftest.ts") && !path.endsWith("/testSupport.ts"));
  const callers = studioRuntime.filter(([, text]) => /\bpreflightParamsSha256\b/.test(text)).map(([path]) => path).sort();
  const tagHolders = studioRuntime.filter(([, text]) => text.includes(PREFLIGHT_PARAMS_SCHEMA)).map(([path]) => path);
  const importsFromRunner = (text: string) => /import\s*\{[^}]*\bpreflightParamsSha256\b[^}]*\}\s*from\s*"\.\.\/db\/runner\.js"/.test(text);
  check("SM7b. the web and the worker compute params_sha256 with this one function and no other formula: exactly the web's "
    + "actions.ts and the worker's preflight.ts call preflightParamsSha256, each importing it from the S2 runner module; the "
    + "canonical form's schema tag appears in no other Studio runtime module; and neither caller hashes anything itself",
    callers.join() === ["src/studio/db/runner.ts", "src/studio/web/actions.ts", "src/studio/worker/preflight.ts"].join()
      && importsFromRunner(studioSources.get("src/studio/web/actions.ts") ?? "")
      && importsFromRunner(studioSources.get("src/studio/worker/preflight.ts") ?? "")
      && tagHolders.join() === "src/studio/db/runner.ts"
      && !/createHash|sha256Hex/.test(studioSources.get("src/studio/web/actions.ts") ?? "createHash")
      && !/createHash|sha256Hex/.test(studioSources.get("src/studio/worker/preflight.ts") ?? "createHash"),
    );

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
