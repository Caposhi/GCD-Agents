/**
 * Disposable-PostgreSQL suite for the Content Studio schema and its runner
 * (docs/CONTENT_STUDIO_DESIGN.md §3.7 and §4). Run on PostgreSQL 16 and 18 in
 * CI's `postgres-integration` job.
 *
 * Safety contract:
 * - Requires STUDIO_DISPOSABLE_POSTGRES=1 and a loopback-only
 *   STUDIO_POSTGRES_ADMIN_URL; refuses to run while DATABASE_URL or
 *   STUDIO_DATABASE_URL is set in its own environment.
 * - The Studio database must be named `gcd_studio`, so this suite creates a
 *   database of exactly that name, and refuses to start if one already exists:
 *   it never touches a database it did not create. Its other databases are
 *   named `gcd_studio_disposable_<random>`. It drops everything it created.
 * - It runs the compiled Studio entry point (`dist/studio/db/migrate.js`) and
 *   the unchanged, compiled live runner (`dist/state/migrate.js`) as child
 *   processes, each with a sanitized environment naming only its own database.
 *
 * What it proves:
 * - `runner`: the Studio runner applies every migration, is idempotent, and
 *   refuses a changed or missing recorded file, a wrongly named database, a
 *   live ledger, and a concurrent runner's partial view, changing nothing.
 * - `cross`: the Studio runner against a live-migrated database is refused
 *   before any statement but read-only probes; the unchanged live runner
 *   against a Studio-migrated database fails on the tripwire with nothing
 *   committed; the live runner against its own database applies and is
 *   idempotent.
 * - `schema`: every §4 invariant, by attempting the forbidden write and
 *   requiring its refusal (and, beside it, the permitted write succeeding).
 *
 * Pools: every pool comes from `openPool` and is closed by `closePool`, which
 * waits until each of its connections has actually closed (pg-pool's `end()`
 * resolves before its clients' sockets do) before any database is dropped.
 * Each pool has an `'error'` listener that ignores only a connection
 * termination (SQLSTATE 57P01) arriving after that pool's teardown began;
 * any other pool error, or a 57P01 during the test body, fails the suite by
 * name (`pool errors`). `--inject-pool-termination` proves that: it
 * terminates one pool's idle connection during the test body, and the suite
 * must then fail.
 *
 * Fixtures are synthetic: `.test`-free placeholder hashes, generated ids and
 * fixture addresses assembled at run time. No customer data, facts-file
 * content or booking link.
 */

import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";
import {
  probeStudioIdentity,
  readStudioMigrationFiles,
  runStudioMigrations,
  STUDIO_DATABASE_NAME,
  STUDIO_IDENTITY_MARKER,
  STUDIO_MIGRATIONS_DIRECTORY,
  STUDIO_TRIPWIRE_CONSTRAINT,
  StudioMigrationRefusal,
  type StudioSqlClient,
} from "./runner.js";

const GROUPS = ["runner", "cross", "schema"] as const;
type Group = typeof GROUPS[number];
const counts: Record<Group, number> = { runner: 0, cross: 0, schema: 0 };
let failures = 0;
function check(group: Group, name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  [${group}] ${name}${cond || !detail ? "" : ` — ${detail}`}`);
  counts[group] += 1;
  if (!cond) failures += 1;
}

const DOMAIN = "germancardepot.com";
const mail = (local: string) => `${local}@${DOMAIN}`;
const hex = (seed: string) => createHash("sha256").update(seed).digest("hex");
const commit = (seed: string) => hex(seed).slice(0, 40);
const repoRoot = process.cwd();
const EXPECTED_FILES = ["0001_studio_identity_and_tripwire.sql", "0002_studio_schema.sql", "0003_studio_preflight_requests.sql"];

// ---------------------------------------------------------------------------
// Environment and disposable databases
// ---------------------------------------------------------------------------

function adminUrl(): string {
  if (process.env.STUDIO_DISPOSABLE_POSTGRES !== "1") {
    throw new Error("STUDIO_DISPOSABLE_POSTGRES=1 is required for this destructive disposable-database test");
  }
  if (process.env.DATABASE_URL !== undefined || process.env.STUDIO_DATABASE_URL !== undefined) {
    throw new Error("unset DATABASE_URL and STUDIO_DATABASE_URL: this suite builds each child's environment itself");
  }
  const raw = process.env.STUDIO_POSTGRES_ADMIN_URL;
  if (!raw) throw new Error("STUDIO_POSTGRES_ADMIN_URL is required");
  const parsed = new URL(raw);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("STUDIO_POSTGRES_ADMIN_URL must be a PostgreSQL URL");
  }
  if (!new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(parsed.hostname.toLowerCase())) {
    throw new Error("STUDIO_POSTGRES_ADMIN_URL must use a loopback hostname");
  }
  if (!parsed.pathname || parsed.pathname === "/") {
    throw new Error("STUDIO_POSTGRES_ADMIN_URL must identify an administrative database");
  }
  return parsed.toString();
}

const OWNED_NAME = /^gcd_studio(?:_disposable_[a-z0-9_]+)?$/;
const databaseUrl = (admin: string, name: string) => {
  const parsed = new URL(admin);
  parsed.pathname = `/${name}`;
  return parsed.toString();
};

// ---------------------------------------------------------------------------
// Pools: full teardown before a drop, and an error policy that hides nothing
// ---------------------------------------------------------------------------

/** SQLSTATE admin_shutdown: the server terminated the connection (pg_terminate_backend). */
const CONNECTION_TERMINATED = "57P01";

interface PoolState {
  readonly label: string;
  closing: boolean;
  /** One per connection the pool opened, settled when that connection's socket has closed. */
  readonly closed: Promise<void>[];
}

const poolStates = new Map<pg.Pool, PoolState>();
/** Every pool error the policy does not allow; the suite fails by name if any is recorded. */
const unexpectedPoolErrors: string[] = [];
let ignoredTerminations = 0;

function openPool(label: string, config: pg.PoolConfig): pg.Pool {
  const pool = new pg.Pool(config);
  const state: PoolState = { label, closing: false, closed: [] };
  pool.on("connect", (client) => {
    state.closed.push(new Promise<void>((settle) => client.once("end", () => settle())));
  });
  pool.on("error", (error: Error) => {
    const code = (error as { code?: unknown }).code;
    if (state.closing && code === CONNECTION_TERMINATED) {
      ignoredTerminations += 1;
      return;
    }
    unexpectedPoolErrors.push(`${label}: ${typeof code === "string" ? code : "no SQLSTATE"} `
      + `${error.message} (${state.closing ? "during teardown" : "during the test body"})`);
  });
  poolStates.set(pool, state);
  return pool;
}

/**
 * Ends the pool and waits until every connection it opened has closed, so no
 * backend of it is left for a later `pg_terminate_backend` to reach.
 */
async function closePool(pool: pg.Pool): Promise<void> {
  const state = poolStates.get(pool);
  if (!state) throw new Error("closePool: not a pool from openPool");
  state.closing = true;
  await pool.end();
  await Promise.all(state.closed);
}

/** Fails the suite by name if any pool reported an error the policy does not allow. */
function reportPoolErrors(): void {
  if (unexpectedPoolErrors.length === 0) {
    console.log(`[studio-postgres] pool errors: none unexpected (${ignoredTerminations} connection termination(s) `
      + "ignored after teardown began)");
    return;
  }
  console.log(`FAIL  pool errors — ${unexpectedPoolErrors.length} unexpected: ${unexpectedPoolErrors.join(" | ")}`);
  failures += 1;
}

/**
 * `--inject-pool-termination`: terminates the pool's idle connection to `name`
 * during the test body. The pool must report it, and `reportPoolErrors` must
 * then fail the suite.
 */
async function injectPoolTermination(dbs: Databases, pool: pg.Pool, name: string): Promise<void> {
  const reported = new Promise<boolean>((settle) => {
    const timer = setTimeout(() => settle(false), 10_000);
    pool.once("error", () => {
      clearTimeout(timer);
      settle(true);
    });
  });
  const terminated = await dbs.admin.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [name]);
  console.log(`[studio-postgres] injected fault: terminated ${terminated.rows.length} idle connection(s) to ${name} `
    + `during the test body; the pool ${await reported ? "reported" : "did NOT report"} it`);
}

class Databases {
  readonly created = new Set<string>();
  constructor(readonly admin: pg.Pool, readonly adminUrl: string) {}
  async create(name: string): Promise<string> {
    if (!OWNED_NAME.test(name)) throw new Error(`refusing unexpected disposable database name: ${name}`);
    const exists = await this.admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (exists.rows.length > 0) {
      throw new Error(`database ${name} already exists; this suite never touches a database it did not create`);
    }
    await this.admin.query(`CREATE DATABASE "${name}"`);
    this.created.add(name);
    return databaseUrl(this.adminUrl, name);
  }
  async drop(name: string): Promise<void> {
    if (!OWNED_NAME.test(name) || !this.created.has(name)) throw new Error(`refusing to drop ${name}`);
    await this.admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [name]);
    await this.admin.query(`DROP DATABASE "${name}"`);
    this.created.delete(name);
  }
}

interface ChildRun { code: number; stdout: string; stderr: string }

function runChild(script: string, cwd: string, env: Record<string, string>): Promise<ChildRun> {
  const childEnv: Record<string, string> = {};
  for (const name of ["PATH", "LANG", "LC_ALL", "TZ", "TMPDIR"]) {
    const value = process.env[name];
    if (value !== undefined) childEnv[name] = value;
  }
  Object.assign(childEnv, env);
  return new Promise((settle) => {
    execFile(process.execPath, [resolve(repoRoot, script)], { cwd, env: childEnv, maxBuffer: 8 * 1024 * 1024, timeout: 120_000 },
      (error, stdout, stderr) => settle({
        code: error ? (typeof error.code === "number" ? error.code : -1) : 0,
        stdout: String(stdout),
        stderr: String(stderr),
      }));
  });
}

/** The compiled Studio entry point, given only STUDIO_DATABASE_URL. */
const studioRunner = (url: string, cwd = repoRoot) =>
  runChild("dist/studio/db/migrate.js", cwd, { STUDIO_DATABASE_URL: url });

/** The unchanged, compiled live runner, given only its test environment and DATABASE_URL. */
const liveRunner = (url: string) => runChild("dist/state/migrate.js", repoRoot, {
  NODE_ENV: "test",
  DATABASE_URL: url,
  PUBLIC_BASE_URL: "https://studio-selftest.invalid",
  ANTHROPIC_API_KEY: "", IMAGEGEN_API_KEY: "", APPROVAL_CHANNEL_WEBHOOK: "", IG_ACCESS_TOKEN: "",
  FB_PAGE_ACCESS_TOKEN: "", GOOGLE_ACCESS_TOKEN: "", GOOGLE_REFRESH_TOKEN: "", GOOGLE_CLIENT_SECRET: "", CONSOLE_TOKEN: "",
});

/**
 * Everything a migration could leave behind: every relation, column,
 * constraint, index, trigger, function and extension outside the system
 * schemas, plus every row of both ledgers and the identity table.
 */
async function snapshot(pool: pg.Pool): Promise<string> {
  const catalog = await pool.query(`
    SELECT string_agg(item, E'\\n' ORDER BY item) AS items FROM (
      SELECT 'rel ' || n.nspname || '.' || c.relname || ' ' || c.relkind::text AS item
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
      UNION ALL
      SELECT 'col ' || c.oid::regclass::text || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE a.attnum > 0 AND NOT a.attisdropped
         AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
      UNION ALL
      SELECT 'con ' || co.conrelid::regclass::text || ' ' || co.conname || ' ' || pg_get_constraintdef(co.oid)
        FROM pg_constraint co JOIN pg_namespace n ON n.oid = co.connamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
      UNION ALL
      SELECT 'trg ' || pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE NOT t.tgisinternal
      UNION ALL
      SELECT 'fn ' || p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid))
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE p.prokind IN ('f', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
      UNION ALL
      SELECT 'ext ' || extname FROM pg_extension
    ) items`);
  const rows: string[] = [];
  for (const table of ["_migrations", "studio_schema_migrations", "studio_database_identity"]) {
    const present = await pool.query("SELECT to_regclass($1) IS NOT NULL AS present", [`public.${table}`]);
    if (present.rows[0]?.present) {
      rows.push(`${table}: ${JSON.stringify((await pool.query(`SELECT * FROM public.${table} ORDER BY 1`)).rows)}`);
    }
  }
  return `${String(catalog.rows[0]?.items ?? "")}\n${rows.join("\n")}`;
}

/** Runs `fn` in one transaction; returns "" when it committed, else the error message. */
async function tx(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<unknown>): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await fn(client);
    await client.query("COMMIT");
    return "";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return (error as Error).message || "error with no message";
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// runner and cross
// ---------------------------------------------------------------------------

async function runnerAndCross(dbs: Databases): Promise<void> {
  // A database named otherwise is refused, and nothing is created in it.
  const otherName = `gcd_studio_disposable_${randomBytes(4).toString("hex")}`;
  const otherUrl = await dbs.create(otherName);
  const otherPool = openPool("wrong-name database", { connectionString: otherUrl, max: 2 });
  try {
    const before = await snapshot(otherPool);
    const run = await studioRunner(otherUrl);
    check("runner", "SP1. the Studio runner refuses a database not named gcd_studio (exit 1, wrong-database) and "
      + "creates nothing in it", run.code === 1 && run.stderr.includes("refused (wrong-database)")
      && before === await snapshot(otherPool), run.stderr);
    if (process.argv.includes("--inject-pool-termination")) await injectPoolTermination(dbs, otherPool, otherName);

    // The same live-migrated database under another name is refused as well.
    const live = await liveRunner(otherUrl);
    const liveBefore = await snapshot(otherPool);
    const refusedLive = await studioRunner(otherUrl);
    check("cross", "SP2. against a live-migrated database of another name, the Studio runner is refused and "
      + "changes nothing", live.code === 0 && refusedLive.code === 1 && liveBefore === await snapshot(otherPool),
    refusedLive.stderr);
  } finally {
    await closePool(otherPool);
    await dbs.drop(otherName);
  }

  // Cross-runner 1: the Studio runner against a live-migrated gcd_studio.
  let url = await dbs.create(STUDIO_DATABASE_NAME);
  let pool = openPool("live-migrated gcd_studio", { connectionString: url, max: 4 });
  try {
    const first = await liveRunner(url);
    const second = await liveRunner(url);
    check("cross", "SP3. the live runner applies every live migration to its own database, then is idempotent "
      + "(every file skipped)",
    first.code === 0 && /\[migrate\] applied 007_evidence_bounds\.sql/.test(first.stdout)
      && second.code === 0 && !second.stdout.includes("[migrate] applied") && second.stdout.includes("[migrate] skip 007"),
    first.stderr + second.stderr);
    const before = await snapshot(pool);
    const refused = await studioRunner(url);
    check("cross", "SP4. the Studio runner against a live-migrated gcd_studio is refused (exit 1, live-schema) "
      + "and the database is unchanged: no Studio ledger, table, function or row",
    refused.code === 1 && refused.stderr.includes("refused (live-schema)") && before === await snapshot(pool)
      && !(await snapshot(pool)).includes("studio_"), refused.stderr);
    const client = await pool.connect();
    const statements: string[] = [];
    const recording: StudioSqlClient = {
      query: (text, values) => {
        statements.push(text.trim());
        return client.query(text, values as unknown[]);
      },
    };
    let reason = "";
    try {
      await runStudioMigrations(recording, { directory: resolve(repoRoot, STUDIO_MIGRATIONS_DIRECTORY) });
    } catch (error) {
      reason = error instanceof StudioMigrationRefusal ? error.reason : String(error);
    } finally {
      client.release();
    }
    check("cross", "SP5. it is refused before any statement: every statement it sent was a read-only SELECT "
      + "probe — no BEGIN, lock, DDL or write",
    reason === "live-schema" && statements.length > 0
      && statements.every((statement) => /^SELECT\b/.test(statement) && !statement.includes("pg_advisory"))
      && before === await snapshot(pool), `${reason}: ${statements.length} statements`);
  } finally {
    await closePool(pool);
    await dbs.drop(STUDIO_DATABASE_NAME);
  }

  // A gcd_studio holding only a live-style ledger (no tripwire) is refused.
  url = await dbs.create(STUDIO_DATABASE_NAME);
  pool = openPool("live-ledger gcd_studio", { connectionString: url, max: 4 });
  try {
    await pool.query("CREATE TABLE _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const before = await snapshot(pool);
    const refused = await studioRunner(url);
    check("runner", "SP6. a gcd_studio whose _migrations lacks the Studio tripwire is refused as a live ledger, "
      + "changing nothing", refused.code === 1 && refused.stderr.includes("refused (live-ledger)")
      && before === await snapshot(pool), refused.stderr);
  } finally {
    await closePool(pool);
    await dbs.drop(STUDIO_DATABASE_NAME);
  }

  // Two runners at once on a fresh gcd_studio: the result is one complete schema.
  url = await dbs.create(STUDIO_DATABASE_NAME);
  pool = openPool("concurrent-runner gcd_studio", { connectionString: url, max: 4 });
  try {
    const both = await Promise.all([studioRunner(url), studioRunner(url)]);
    const ledger = (await pool.query("SELECT name FROM studio_schema_migrations ORDER BY name")).rows.map((row) => row.name);
    check("runner", "SP7. two Studio runners started together leave exactly one complete ledger; any runner that "
      + "lost the race refused (concurrent-runner) instead of applying twice",
    JSON.stringify(ledger) === JSON.stringify(EXPECTED_FILES) && both.some((run) => run.code === 0)
      && both.every((run) => run.code === 0 || run.stderr.includes("refused (concurrent-runner)")),
    both.map((run) => run.stderr).join(" | "));
  } finally {
    await closePool(pool);
    await dbs.drop(STUDIO_DATABASE_NAME);
  }
}

// ---------------------------------------------------------------------------
// The Studio database: apply, idempotency, changed files, cross-runner 2,
// and then every §4 invariant.
// ---------------------------------------------------------------------------

async function studioDatabase(dbs: Databases): Promise<void> {
  const url = await dbs.create(STUDIO_DATABASE_NAME);
  const pool = openPool("Studio gcd_studio", { connectionString: url, max: 6 });
  const scratch: string[] = [];
  try {
    const applied = await studioRunner(url);
    const files = await readStudioMigrationFiles(resolve(repoRoot, STUDIO_MIGRATIONS_DIRECTORY));
    const ledger = (await pool.query("SELECT name, sha256 FROM studio_schema_migrations ORDER BY name")).rows;
    check("runner", "SP8. the Studio runner applies every Studio migration in order to a fresh gcd_studio and records "
      + "each file's name and the sha256 of its exact bytes",
    applied.code === 0 && EXPECTED_FILES.every((name) => applied.stdout.includes(`[studio-migrate] applied ${name}`))
      && applied.stdout.includes("[studio-migrate] done")
      && JSON.stringify(ledger) === JSON.stringify(files.map((file) => ({ name: file.name, sha256: file.sha256 }))),
    applied.stderr);
    const identity = await pool.query("SELECT database_name, marker FROM studio_database_identity");
    const tripwire = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conrelid = 'public._migrations'::regclass AND conname = $1`, [STUDIO_TRIPWIRE_CONSTRAINT]);
    check("runner", "SP9. the migrated database carries its identity row, the tripwire CHECK (false) and an empty "
      + "tripwire table, and the probe now reads it as a complete Studio database",
    identity.rows.length === 1 && identity.rows[0]?.database_name === STUDIO_DATABASE_NAME
      && identity.rows[0]?.marker === STUDIO_IDENTITY_MARKER && tripwire.rows[0]?.definition === "CHECK (false)"
      && Number((await pool.query("SELECT count(*) AS n FROM _migrations")).rows[0]?.n) === 0
      && await (async () => {
        const client = await pool.connect();
        try {
          const probe = await probeStudioIdentity(client);
          return probe.migrationsTable === "tripwire" && probe.liveTables.length === 0
            && probe.ledger?.length === EXPECTED_FILES.length;
        } finally {
          client.release();
        }
      })());

    const before = await snapshot(pool);
    const again = await studioRunner(url);
    check("runner", "SP10. a second run is idempotent: every file skipped with a matching sha256, and the schema, "
      + "ledger and identity are byte-for-byte unchanged",
    again.code === 0 && EXPECTED_FILES.every((name) => again.stdout.includes(`[studio-migrate] skip ${name}`))
      && !again.stdout.includes("[studio-migrate] applied") && before === await snapshot(pool), again.stderr);

    // A changed recorded file, and a missing one, are refused before any statement.
    const changedRoot = await mkdtemp(join(tmpdir(), "gcd-studio-changed-"));
    scratch.push(changedRoot);
    await cp(resolve(repoRoot, STUDIO_MIGRATIONS_DIRECTORY), join(changedRoot, STUDIO_MIGRATIONS_DIRECTORY), { recursive: true });
    const target = join(changedRoot, STUDIO_MIGRATIONS_DIRECTORY, "0002_studio_schema.sql");
    await writeFile(target, `${await readFile(target, "utf8")}\n-- one edited byte after application\n`);
    const changed = await studioRunner(url, changedRoot);
    check("runner", "SP11. the runner refuses a recorded migration whose bytes changed (migration-changed) and "
      + "changes nothing", changed.code === 1 && changed.stderr.includes("refused (migration-changed)")
      && before === await snapshot(pool), changed.stderr);
    await rm(target);
    const missing = await studioRunner(url, changedRoot);
    check("runner", "SP12. the runner refuses when a recorded migration file is missing (migration-missing) and "
      + "changes nothing", missing.code === 1 && missing.stderr.includes("refused (migration-missing)")
      && before === await snapshot(pool), missing.stderr);

    // Cross-runner 2: the unchanged live runner against the Studio database.
    const live = await liveRunner(url);
    const after = await snapshot(pool);
    check("cross", "SP13. the unchanged live runner against the Studio-migrated database fails (exit 1) on the "
      + `tripwire: its first INSERT INTO _migrations violates ${STUDIO_TRIPWIRE_CONSTRAINT}`,
    live.code === 1 && live.stderr.includes(`violates check constraint "${STUDIO_TRIPWIRE_CONSTRAINT}"`)
      && live.stderr.includes("001_init.sql"), live.stderr.slice(0, 400));
    check("cross", "SP14. nothing it ran was committed: the schema, both ledgers and the identity are byte-for-byte "
      + "unchanged, and no live table exists",
    after === before && (await pool.query(
      "SELECT count(*) AS n FROM pg_class WHERE relname = ANY ($1::text[])",
      [["brief_queue", "approval_queue", "session_state", "media", "events", "content_evidence"]])).rows[0]?.n === "0");

    await invariants(pool);
    check("runner", "SP15. after every invariant probe, a further Studio run still skips every file and the "
      + "schema is unchanged", await (async () => {
      const catalog = (text: string) => text.split("\n").filter((line) => !line.startsWith("studio_database_identity"))
        .join("\n");
      const beforeLast = catalog(await snapshot(pool));
      const last = await studioRunner(url);
      return last.code === 0 && !last.stdout.includes("[studio-migrate] applied") && beforeLast === catalog(await snapshot(pool));
    })());
  } finally {
    await closePool(pool);
    for (const dir of scratch) await rm(dir, { recursive: true, force: true });
    await dbs.drop(STUDIO_DATABASE_NAME);
  }
}

// ---------------------------------------------------------------------------
// Content Studio S6.1: migration 0003 applied on top of a database at 0002
// ---------------------------------------------------------------------------

async function upgradeFromSchema0002(dbs: Databases): Promise<void> {
  const url = await dbs.create(STUDIO_DATABASE_NAME);
  const pool = openPool("Studio gcd_studio at 0002", { connectionString: url, max: 2 });
  const olderRoot = await mkdtemp(join(tmpdir(), "gcd-studio-0002-"));
  try {
    await mkdir(join(olderRoot, STUDIO_MIGRATIONS_DIRECTORY), { recursive: true });
    for (const name of EXPECTED_FILES.slice(0, 2)) {
      await cp(resolve(repoRoot, STUDIO_MIGRATIONS_DIRECTORY, name), join(olderRoot, STUDIO_MIGRATIONS_DIRECTORY, name));
    }
    const older = await studioRunner(url, olderRoot);
    const ledgerAt0002 = (await pool.query("SELECT name, sha256 FROM studio_schema_migrations ORDER BY name")).rows;
    // Rows a 0002-era Studio would hold: the bootstrap owner and a queued preflight job.
    await pool.query("INSERT INTO studio_users (email, role, google_sub) VALUES ($1, 'owner', 'sub-upgrade-owner')", [mail("upgrade.owner")]);
    await pool.query("INSERT INTO studio_jobs (kind) VALUES ('preflight')");
    const rows = async () => JSON.stringify([
      (await pool.query("SELECT id, email, role, status FROM studio_users ORDER BY id")).rows,
      (await pool.query("SELECT id, kind, state, created_at::text FROM studio_jobs ORDER BY id")).rows,
    ]);
    const rowsBefore = await rows();
    const upgrade = await studioRunner(url);
    const files = await readStudioMigrationFiles(resolve(repoRoot, STUDIO_MIGRATIONS_DIRECTORY));
    const ledger = (await pool.query("SELECT name, sha256 FROM studio_schema_migrations ORDER BY name")).rows;
    check("runner", "SP16. migration 0003 applies on top of a database migrated to 0002 alone, with rows in it: the "
      + "runner skips 0001 and 0002 (their recorded sha256 values unchanged), applies 0003 alone, records its sha256, and "
      + "leaves the 0002-era rows as they were",
    older.code === 0 && JSON.stringify(ledgerAt0002.map((row) => row.name)) === JSON.stringify(EXPECTED_FILES.slice(0, 2))
      && upgrade.code === 0
      && EXPECTED_FILES.slice(0, 2).every((name) => upgrade.stdout.includes(`[studio-migrate] skip ${name}`))
      && upgrade.stdout.includes(`[studio-migrate] applied ${EXPECTED_FILES[2]}`)
      && JSON.stringify(ledger) === JSON.stringify(files.map((file) => ({ name: file.name, sha256: file.sha256 })))
      && JSON.stringify(ledger.slice(0, 2)) === JSON.stringify(ledgerAt0002)
      && (await pool.query("SELECT to_regclass('public.studio_preflight_requests') IS NOT NULL AS present")).rows[0]?.present === true
      && rowsBefore === await rows(), `${older.stderr} ${upgrade.stderr}`);
    const before = await snapshot(pool);
    const again = await studioRunner(url);
    check("runner", "SP17. after that upgrade a further run is idempotent: every file skipped with a matching sha256, "
      + "and the schema, ledger and identity byte-for-byte unchanged",
    again.code === 0 && EXPECTED_FILES.every((name) => again.stdout.includes(`[studio-migrate] skip ${name}`))
      && !again.stdout.includes("[studio-migrate] applied") && before === await snapshot(pool), again.stderr);
  } finally {
    await closePool(pool);
    await rm(olderRoot, { recursive: true, force: true });
    await dbs.drop(STUDIO_DATABASE_NAME);
  }
}

// ---------------------------------------------------------------------------
// §4 invariants
// ---------------------------------------------------------------------------

async function invariants(pool: pg.Pool): Promise<void> {
  let n = 100;
  const refuses = async (label: string, pattern: RegExp, fn: (client: pg.PoolClient) => Promise<unknown>) => {
    const message = await tx(pool, fn);
    n += 1;
    check("schema", `SP${n}. refused: ${label}`, message !== "" && pattern.test(message), message || "it was accepted");
  };
  const accepts = async (label: string, fn: (client: pg.PoolClient) => Promise<unknown>) => {
    const message = await tx(pool, fn);
    n += 1;
    check("schema", `SP${n}. accepted: ${label}`, message === "", message);
  };
  const holds = (label: string, cond: boolean, detail = "") => {
    n += 1;
    check("schema", `SP${n}. ${label}`, cond, detail);
  };
  const one = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0] ?? {};
  const insertUser = (client: pg.PoolClient, email: string, role: string, createdBy: string | null, sub: string | null) =>
    client.query("INSERT INTO studio_users (email, role, created_by, google_sub) VALUES ($1, $2, $3, $4) RETURNING id",
      [email, role, createdBy, sub]);

  // ---- §4.1 users ----------------------------------------------------------
  await refuses("before any owner exists, a viewer cannot be created", /only the bootstrap owner/,
    (c) => insertUser(c, mail("first.viewer"), "viewer", null, "sub-viewer-0"));
  await refuses("the bootstrap owner without a verified Google subject", /only the bootstrap owner/,
    (c) => insertUser(c, mail("first.owner"), "owner", null, null));
  await refuses("an email outside @" + DOMAIN, /studio_users_email_domain/,
    (c) => insertUser(c, "owner.fixture@example.com", "owner", null, "sub-x"));
  await refuses("an email at a subdomain of the Workspace domain", /studio_users_email_domain/,
    (c) => insertUser(c, mail("owner.fixture").replace("@", "@mail."), "owner", null, "sub-x"));
  await refuses("an email whose domain only starts with the Workspace domain", /studio_users_email_domain/,
    (c) => insertUser(c, `${mail("owner.fixture")}.evil.invalid`, "owner", null, "sub-x"));
  await refuses("an email with two @ signs", /studio_users_email_domain/,
    (c) => insertUser(c, `a@${mail("owner.fixture")}`, "owner", null, "sub-x"));
  await refuses("an email that is not lower-cased", /studio_users_email_lowercase/,
    (c) => insertUser(c, mail("Owner.Fixture"), "owner", null, "sub-x"));
  let owner = "";
  await accepts("the bootstrap owner: an active owner, created by nobody, with its Google subject", async (c) => {
    owner = String((await insertUser(c, mail("owner.fixture"), "owner", null, "sub-owner")).rows[0]?.id);
  });
  await refuses("once an owner exists, a user created by nobody", /only by an active owner/,
    (c) => insertUser(c, mail("second.bootstrap"), "owner", null, "sub-second"));
  let viewer = "";
  let runner = "";
  let owner2 = "";
  await accepts("an owner creates a viewer, a runner and a second owner", async (c) => {
    viewer = String((await insertUser(c, mail("viewer.fixture"), "viewer", owner, null)).rows[0]?.id);
    runner = String((await insertUser(c, mail("runner.fixture"), "runner", owner, "sub-runner")).rows[0]?.id);
    owner2 = String((await insertUser(c, mail("owner2.fixture"), "owner", owner, "sub-owner2")).rows[0]?.id);
  });
  await refuses("a user created by a viewer", /only by an active owner/,
    (c) => insertUser(c, mail("by.viewer"), "viewer", viewer, null));
  await refuses("a duplicate email", /studio_users_email_unique/,
    (c) => insertUser(c, mail("viewer.fixture"), "viewer", owner, null));
  await refuses("a duplicate Google subject", /studio_users_google_sub_unique/,
    (c) => insertUser(c, mail("dup.sub"), "viewer", owner, "sub-runner"));
  await accepts("a user's google_sub is set at first sign-in (null to a value)",
    (c) => c.query("UPDATE studio_users SET google_sub = 'sub-viewer' WHERE id = $1", [viewer]));
  await refuses("a google_sub changed once set", /google_sub never changes/,
    (c) => c.query("UPDATE studio_users SET google_sub = 'sub-viewer-2' WHERE id = $1", [viewer]));
  await refuses("a google_sub cleared once set", /google_sub never changes/,
    (c) => c.query("UPDATE studio_users SET google_sub = NULL WHERE id = $1", [viewer]));
  await accepts("one of two owners is demoted",
    (c) => c.query("UPDATE studio_users SET role = 'runner' WHERE id = $1", [owner2]));
  await refuses("the last active owner demoted", /last active owner/,
    (c) => c.query("UPDATE studio_users SET role = 'viewer' WHERE id = $1", [owner]));
  await refuses("the last active owner disabled", /last active owner/,
    (c) => c.query("UPDATE studio_users SET status = 'disabled' WHERE id = $1", [owner]));
  await refuses("the last active owner deleted", /last active owner/, async (c) => {
    // A fresh owner nothing references, left as the only active owner, then deleted.
    const lone = String((await insertUser(c, mail("lone.owner"), "owner", owner, "sub-lone")).rows[0]?.id);
    await c.query("UPDATE studio_users SET role = 'viewer' WHERE id = $1", [owner]);
    await c.query("DELETE FROM studio_users WHERE id = $1", [lone]);
  });
  await refuses("both of two owners demoted in one statement", /last active owner/, async (c) => {
    await c.query("UPDATE studio_users SET role = 'owner' WHERE id = $1", [owner2]);
    await c.query("UPDATE studio_users SET role = 'viewer' WHERE role = 'owner'");
  });
  await refuses("studio_users truncated", /immutable/, (c) => c.query("TRUNCATE studio_users CASCADE"));

  // Two concurrent demotions of the two remaining owners: one must fail.
  await pool.query("UPDATE studio_users SET role = 'owner' WHERE id = $1", [owner2]);
  {
    const a = await pool.connect();
    const b = await pool.connect();
    let bError = "";
    try {
      await a.query("BEGIN");
      await b.query("BEGIN");
      await a.query("UPDATE studio_users SET role = 'viewer' WHERE id = $1", [owner]);
      const bUpdate = b.query("UPDATE studio_users SET role = 'viewer' WHERE id = $1", [owner2])
        .then(() => "", (error: Error) => error.message);
      await new Promise((settle) => setTimeout(settle, 200));
      await a.query("COMMIT");
      bError = await bUpdate;
      await b.query(bError ? "ROLLBACK" : "COMMIT");
    } finally {
      a.release();
      b.release();
    }
    const owners = await one("SELECT count(*) AS n FROM studio_users WHERE role = 'owner' AND status = 'active'");
    holds("two concurrent transactions each demoting one of the last two owners: the second waits, then is refused, "
      + "and one active owner remains", /last active owner/.test(bError) && owners.n === "1", bError);
    await pool.query("UPDATE studio_users SET role = 'owner' WHERE id = $1", [owner]);
    await pool.query("UPDATE studio_users SET role = 'runner' WHERE id = $1", [owner2]);
  }

  // ---- §4.1 login attempts ---------------------------------------------------
  const verifier = "v".repeat(43);
  const insertAttempt = (c: pg.PoolClient, state: string, extra = "") =>
    c.query(`INSERT INTO studio_login_attempts (state_hash, nonce_hash, pkce_verifier${extra ? ", created_at" : ""})
             VALUES ($1, $2, $3${extra ? `, ${extra}` : ""})`, [state, hex(`nonce-${state}`), verifier]);
  await refuses("a login attempt whose state is stored raw, not as a sha256 hash", /state_hash_shape/,
    (c) => insertAttempt(c, randomBytes(32).toString("base64url")));
  await refuses("a login attempt whose PKCE verifier is too short", /pkce_verifier_shape/,
    (c) => c.query("INSERT INTO studio_login_attempts (state_hash, nonce_hash, pkce_verifier) VALUES ($1, $2, 'short')",
      [hex("s-short"), hex("n-short")]));
  await refuses("a login attempt living longer than 10 minutes", /ten_minutes/,
    (c) => c.query(`INSERT INTO studio_login_attempts (state_hash, nonce_hash, pkce_verifier, expires_at)
                    VALUES ($1, $2, $3, now() + interval '11 minutes')`, [hex("s-long"), hex("n-long"), verifier]));
  await refuses("a login attempt created in the future", /in the future/,
    (c) => insertAttempt(c, hex("s-future"), "now() + interval '1 hour'"));
  const liveState = hex("state-live");
  await accepts("a login attempt, its expiry set to 10 minutes", (c) => insertAttempt(c, liveState));
  await refuses("a login attempt modified", /immutable/,
    (c) => c.query("UPDATE studio_login_attempts SET nonce_hash = $2 WHERE state_hash = $1", [liveState, hex("other")]));
  const consumed1 = (await pool.query("SELECT * FROM studio_consume_login_attempt($1)", [liveState])).rows;
  const consumed2 = (await pool.query("SELECT * FROM studio_consume_login_attempt($1)", [liveState])).rows;
  holds("a login attempt is single use: consumed once by delete, and a second consumption returns nothing",
    consumed1.length === 1 && consumed1[0]?.nonce_hash === hex(`nonce-${liveState}`) && consumed2.length === 0
      && (await one("SELECT count(*) AS n FROM studio_login_attempts WHERE state_hash = $1", [liveState])).n === "0");
  const expiredState = hex("state-expired");
  await tx(pool, (c) => insertAttempt(c, expiredState, "now() - interval '11 minutes'"));
  const expired = (await pool.query("SELECT * FROM studio_consume_login_attempt($1)", [expiredState])).rows;
  holds("an expired login attempt is refused on consumption and purged",
    expired.length === 0 && (await one("SELECT count(*) AS n FROM studio_login_attempts WHERE state_hash = $1",
      [expiredState])).n === "0");

  // ---- §4.1 sessions -----------------------------------------------------------
  const insertSession = (c: pg.PoolClient, user: string, id: string, idle = "12 hours", absolute = "7 days") =>
    c.query(`INSERT INTO studio_sessions (id_hash, user_id, csrf_token_hash, idle_expires_at, absolute_expires_at)
             VALUES ($1, $2, $3, now() + $4::interval, now() + $5::interval)`, [id, user, hex(`csrf-${id}`), idle, absolute]);
  await refuses("a session stored under its raw cookie value", /id_hash_shape/,
    (c) => insertSession(c, viewer, randomBytes(32).toString("base64url")));
  await refuses("a session beyond 7 days absolute", /absolute_lifetime/,
    (c) => insertSession(c, viewer, hex("sess-abs"), "12 hours", "8 days"));
  await refuses("a session idle beyond 12 hours", /idle_lifetime/,
    (c) => insertSession(c, viewer, hex("sess-idle"), "13 hours"));
  const viewerSession = hex("sess-viewer");
  const ownerSession = hex("sess-owner");
  await accepts("sessions for the viewer and the owner", async (c) => {
    await insertSession(c, viewer, viewerSession);
    await insertSession(c, owner, ownerSession);
  });
  await refuses("a session moved to another user", /never change/,
    (c) => c.query("UPDATE studio_sessions SET user_id = $2 WHERE id_hash = $1", [ownerSession, viewer]));
  {
    let revokedInside = false;
    const message = await tx(pool, async (c) => {
      await c.query("UPDATE studio_users SET status = 'disabled' WHERE id = $1", [viewer]);
      revokedInside = (await c.query("SELECT revoked_at IS NOT NULL AS revoked FROM studio_sessions WHERE id_hash = $1",
        [viewerSession])).rows[0]?.revoked === true;
    });
    holds("disabling a user revokes their sessions in the same transaction", message === "" && revokedInside
      && (await one("SELECT revoked_at IS NULL AS open FROM studio_sessions WHERE id_hash = $1", [ownerSession])).open === true,
    message);
  }
  await refuses("a revoked session reopened", /revoked session never changes/,
    (c) => c.query("UPDATE studio_sessions SET revoked_at = NULL WHERE id_hash = $1", [viewerSession]));
  await refuses("a session for a disabled user", /only for an active user/,
    (c) => insertSession(c, viewer, hex("sess-disabled")));
  await pool.query("UPDATE studio_users SET status = 'active' WHERE id = $1", [viewer]);

  // ---- §8.5 staging, §4.4 fact versions ---------------------------------------
  const factBytes = Buffer.from(JSON.stringify({ facts: [{ id: "synthetic-fixture-1" }] }), "utf8");
  const stage = (c: pg.PoolClient, by: string, bytes: Buffer, sha = hex(bytes.toString("latin1"))) =>
    c.query("INSERT INTO studio_fact_uploads (content, sha256, byte_length, uploaded_by) VALUES ($1, $2, $3, $4)",
      [bytes, sha, bytes.length, by]);
  const shaOf = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  await refuses("a fact upload staged by a runner (owner only)", /only an active owner/,
    (c) => stage(c, runner, factBytes, shaOf(factBytes)));
  await refuses("a staged upload whose sha256 is not of its bytes", /sha256_of_content/,
    (c) => stage(c, owner, factBytes, hex("not-the-bytes")));
  await refuses("a staged upload over 1 MiB", /bounded/, (c) => {
    const big = Buffer.alloc(1_048_577, 0x20);
    return stage(c, owner, big, shaOf(big));
  });
  await refuses("a fact version whose bytes were never staged", /only from the staged upload/,
    (c) => c.query(`INSERT INTO studio_fact_versions (sha256, content, byte_length, record_count, tag_counts, uploaded_by)
                    VALUES ($1, $2, $3, 1, '{}', $4)`, [shaOf(factBytes), factBytes, factBytes.length, owner]));
  await accepts("the owner stages an upload", (c) => stage(c, owner, factBytes, shaOf(factBytes)));
  await refuses("a second staged upload beside the first (a single staging row)", /studio_fact_uploads_pkey/,
    (c) => stage(c, owner, Buffer.from("{}"), shaOf(Buffer.from("{}"))));
  await refuses("a staged upload modified", /immutable/,
    (c) => c.query("UPDATE studio_fact_uploads SET uploaded_at = now()"));
  await refuses("a fact version inserted by a runner", /only an active owner/,
    (c) => c.query(`INSERT INTO studio_fact_versions (sha256, content, byte_length, record_count, tag_counts, uploaded_by)
                    VALUES ($1, $2, $3, 1, '{}', $4)`, [shaOf(factBytes), factBytes, factBytes.length, runner]));
  let factVersion = "";
  await accepts("the staged bytes become a fact version and the staging row is deleted", async (c) => {
    factVersion = String((await c.query(
      `INSERT INTO studio_fact_versions (sha256, content, byte_length, record_count, tag_counts, uploaded_by)
       VALUES ($1, $2, $3, 1, '{"oil": 1}', $4) RETURNING id`, [shaOf(factBytes), factBytes, factBytes.length, owner])).rows[0]?.id);
    await c.query("DELETE FROM studio_fact_uploads");
  });
  for (const [column, value] of [["content", "'\\x00'::bytea"], ["sha256", `'${hex("x")}'`], ["record_count", "2"],
    ["tag_counts", "'{}'::jsonb"], ["byte_length", "1"], ["uploaded_by", `'${runner}'`]] as const) {
    await refuses(`a fact version's ${column} changed (only status may change)`, /only a fact version's status|sha256_of_content|length_of_content/,
      (c) => c.query(`UPDATE studio_fact_versions SET ${column} = ${value} WHERE id = $1`, [factVersion]));
  }
  await refuses("an active fact version deleted", /only a retired fact version/,
    (c) => c.query("DELETE FROM studio_fact_versions WHERE id = $1", [factVersion]));

  // ---- §4.4 settings -----------------------------------------------------------
  const seeded = await one("SELECT daily_cap_usd, monthly_cap_usd, scheduled_runs_enabled, updated_by, active_fact_version_id FROM studio_settings");
  holds("studio_settings is seeded with the owner's editable defaults: $50 a day, $200 a month, scheduled runs off",
    seeded.daily_cap_usd === "50.000000" && seeded.monthly_cap_usd === "200.000000"
      && seeded.scheduled_runs_enabled === false && seeded.updated_by === null && seeded.active_fact_version_id === null,
    JSON.stringify(seeded));
  await refuses("a second settings row", /studio_settings_pkey|studio_settings_singleton/,
    (c) => c.query("INSERT INTO studio_settings (daily_cap_usd, monthly_cap_usd) VALUES (1, 1)"));
  await refuses("a settings row with singleton = false", /studio_settings_singleton/,
    (c) => c.query("INSERT INTO studio_settings (singleton, daily_cap_usd, monthly_cap_usd) VALUES (false, 1, 1)"));
  await refuses("the settings deleted", /immutable/, (c) => c.query("DELETE FROM studio_settings"));
  await refuses("the settings truncated", /immutable/, (c) => c.query("TRUNCATE studio_settings"));
  await refuses("the settings changed by a runner", /only an active owner/,
    (c) => c.query("UPDATE studio_settings SET daily_cap_usd = 60, updated_by = $1", [runner]));
  await refuses("the settings changed with no actor", /only an active owner/,
    (c) => c.query("UPDATE studio_settings SET daily_cap_usd = 60, updated_by = NULL"));
  {
    const auditBefore = Number((await one("SELECT count(*) AS n FROM studio_audit_log WHERE action = 'settings.update'")).n);
    let inside = -1;
    const message = await tx(pool, async (c) => {
      await c.query("UPDATE studio_settings SET daily_cap_usd = 45, active_fact_version_id = $2, updated_by = $1",
        [owner, factVersion]);
      inside = Number((await c.query(
        "SELECT count(*) AS n FROM studio_audit_log WHERE action = 'settings.update' AND actor_user_id = $1", [owner])).rows[0]?.n);
    });
    const row = await one("SELECT detail FROM studio_audit_log WHERE action = 'settings.update' ORDER BY at DESC LIMIT 1");
    holds("an owner's settings change writes its audit row in the same transaction, recording before and after",
      message === "" && inside === auditBefore + 1
        && (row.detail as { before?: { daily_cap_usd?: number }; after?: { daily_cap_usd?: number } })?.before?.daily_cap_usd === 50
        && (row.detail as { after?: { daily_cap_usd?: number } })?.after?.daily_cap_usd === 45, message);
    const rolledBack = await tx(pool, async (c) => {
      await c.query("UPDATE studio_settings SET daily_cap_usd = 44, updated_by = $1", [owner]);
      throw new Error("deliberate rollback");
    });
    holds("a rolled-back settings change leaves neither the change nor its audit row",
      rolledBack === "deliberate rollback"
        && (await one("SELECT daily_cap_usd FROM studio_settings")).daily_cap_usd === "45.000000"
        && Number((await one("SELECT count(*) AS n FROM studio_audit_log WHERE action = 'settings.update'")).n)
          === auditBefore + 1);
  }
  await refuses("the active fact version deleted while the settings point at it", /foreign key constraint|only a retired/,
    async (c) => {
      await c.query("UPDATE studio_fact_versions SET status = 'retired' WHERE id = $1", [factVersion]);
      await c.query("DELETE FROM studio_fact_versions WHERE id = $1", [factVersion]);
    });

  // ---- §4.6 quotes, §4.2 runs, the ledger and jobs ------------------------------
  const quote = async (user: string, action = "full", ceiling = "21.65", created = "now()") =>
    String((await pool.query(
      `INSERT INTO studio_quotes (user_id, action, params_sha256, worker_commit, approved_facts_sha256, fact_version_id,
                                  price_table_sha256, ceiling_usd, breakdown, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '[{"stage": "strategy-concept"}]', ${created}, ${created} + interval '10 minutes')
       RETURNING id`,
      [user, action, hex(`params-${randomBytes(4).toString("hex")}`), commit("worker"), hex("approved"), factVersion,
        hex("prices"), ceiling])).rows[0]?.id);
  /** The §6.1 step-4 transaction: consume the quote, create the run, its reserve entry and its paid job. */
  const confirm = (c: pg.PoolClient, q: string, user: string, opts: {
    kind?: string; source?: string | null; reserve?: boolean; job?: boolean; consume?: boolean; ceiling?: string;
    fact?: string | null; runId?: (id: string) => void; reserveExtra?: string;
  } = {}) => (async () => {
    if (opts.consume !== false) await c.query("UPDATE studio_quotes SET consumed_at = now() WHERE id = $1", [q]);
    const id = String((await c.query(
      `INSERT INTO studio_runs (kind, source_run_id, requested_by, runner, fact_version_id, automotive_facts_sha256,
                                quote_id, reserved_usd, goal)
       VALUES ($1, $2, $3, 'live', $4, $5, $6, $7, 'synthetic fixture goal') RETURNING id`,
      [opts.kind ?? "full", opts.source ?? null, user, opts.fact === undefined ? factVersion : opts.fact,
        opts.fact === null ? null : shaOf(factBytes), q, opts.ceiling ?? "21.65"])).rows[0]?.id);
    opts.runId?.(id);
    if (opts.reserve !== false) {
      await c.query(`INSERT INTO studio_spend_ledger (entry, run_id, amount_usd${opts.reserveExtra ? ", created_at" : ""})
                     VALUES ('reserve', $1, $2${opts.reserveExtra ? `, ${opts.reserveExtra}` : ""})`, [id, opts.ceiling ?? "21.65"]);
    }
    if (opts.job !== false) await c.query("INSERT INTO studio_jobs (run_id, kind) VALUES ($1, 'paid')", [id]);
  })();

  await refuses("a quote created already consumed", /created consumed/, async (c) => {
    await c.query(`INSERT INTO studio_quotes (user_id, action, params_sha256, worker_commit, approved_facts_sha256,
                     fact_version_id, price_table_sha256, ceiling_usd, breakdown, consumed_at)
                   VALUES ($1, 'full', $2, $3, $2, $4, $2, 1, '[{}]', now())`, [runner, hex("q"), commit("w"), factVersion]);
  });
  await refuses("a quote living longer than 10 minutes", /studio_quotes_ten_minutes/, (c) =>
    c.query(`INSERT INTO studio_quotes (user_id, action, params_sha256, worker_commit, approved_facts_sha256,
               fact_version_id, price_table_sha256, ceiling_usd, breakdown, expires_at)
             VALUES ($1, 'full', $2, $3, $2, $4, $2, 1, '[{}]', now() + interval '11 minutes')`,
    [runner, hex("q"), commit("w"), factVersion]));

  const q1 = await quote(runner);
  let paidRun = "";
  await refuses("a live run without its reserve entry (checked at commit)", /reserve entry is created/,
    (c) => confirm(c, q1, runner, { reserve: false }));
  await refuses("a live run without its paid job (checked at commit)", /paid job is created/,
    (c) => confirm(c, q1, runner, { job: false }));
  await refuses("a live run whose quote is not consumed (checked at commit)", /quote is consumed in the transaction/,
    (c) => confirm(c, q1, runner, { consume: false }));
  await refuses("a live run under another user's quote", /must match its quote/, (c) => confirm(c, q1, owner));
  await refuses("a live run reserving other than its quote's ceiling", /must match its quote/,
    (c) => confirm(c, q1, runner, { ceiling: "5.00" }));
  await refuses("a live run of another action than its quote's", /must match its quote/,
    (c) => confirm(c, q1, runner, { kind: "replay_critic", source: null }));
  await refuses("a live run whose recorded automotive-facts sha256 is not its pinned version's",
    /studio_runs_fact_version_fingerprint/, (c) => c.query(
      `INSERT INTO studio_runs (kind, requested_by, runner, fact_version_id, automotive_facts_sha256, quote_id, reserved_usd)
       VALUES ('full', $1, 'live', $2, $3, $4, 21.65)`, [runner, factVersion, hex("other-facts"), q1]));
  await refuses("a live run without a quote", /studio_runs_live_has_quote/, (c) => c.query(
    "INSERT INTO studio_runs (kind, requested_by, runner, fact_version_id) VALUES ('full', $1, 'live', $2)", [runner, factVersion]));
  await refuses("a quote consumed with no run created by the same transaction", /consumed only by the transaction/,
    (c) => c.query("UPDATE studio_quotes SET consumed_at = now() WHERE id = $1", [q1]));
  await refuses("a quote requested by a viewer", /quote is requested only by an active owner or runner/,
    () => quote(viewer));
  const ownersQuote = await quote(owner);
  await refuses("a paid run requested by a viewer (under an owner's quote)", /paid run needs an active owner or runner/,
    (c) => confirm(c, ownersQuote, viewer));
  await accepts("a runner's confirmation: quote consumed, run, reserve entry and paid job in one transaction",
    (c) => confirm(c, q1, runner, { runId: (id) => { paidRun = id; } }));
  await refuses("the same quote consumed again (single use)", /single use and is already consumed/,
    (c) => c.query("UPDATE studio_quotes SET consumed_at = now() WHERE id = $1", [q1]));
  await refuses("a second run under the same quote", /studio_runs_quote_single_use|already consumed/,
    (c) => confirm(c, q1, runner, { consume: false }));
  await refuses("a quote's bindings changed", /bindings never change/,
    (c) => c.query("UPDATE studio_quotes SET ceiling_usd = 1 WHERE id = $1", [q1]));
  await refuses("a consumed quote deleted", /consumed quote is never deleted|foreign key constraint/,
    (c) => c.query("DELETE FROM studio_quotes WHERE id = $1", [q1]));
  const expiredQuote = await quote(runner, "full", "21.65", "now() - interval '11 minutes'");
  await refuses("an expired quote consumed", /expired quote cannot be consumed/, (c) => confirm(c, expiredQuote, runner));
  await accepts("an unconsumed quote deleted (purge)", (c) => c.query("DELETE FROM studio_quotes WHERE id = $1", [expiredQuote]));

  // Who may create which run.
  const fakeRun = async (c: pg.PoolClient, user: string, kind = "full", source: string | null = null, fact: string | null = factVersion) =>
    String((await c.query(
      `INSERT INTO studio_runs (kind, source_run_id, requested_by, runner, fact_version_id)
       VALUES ($1, $2, $3, 'fake', $4) RETURNING id`, [kind, source, user, fact])).rows[0]?.id);
  await refuses("a fake run by a runner (owner only)", /owner-only/, (c) => fakeRun(c, runner));
  await refuses("an import by a runner (owner only)", /owner-only/, (c) => c.query(
    "INSERT INTO studio_runs (kind, requested_by, runner) VALUES ('imported', $1, 'live')", [runner]));
  await refuses("a fake run carrying a reservation", /studio_runs_fake_is_free/, (c) => c.query(
    "INSERT INTO studio_runs (kind, requested_by, runner, reserved_usd) VALUES ('full', $1, 'fake', 1)", [owner]));
  await refuses("a run created already running", /created queued/, (c) => c.query(
    "INSERT INTO studio_runs (kind, requested_by, runner, state) VALUES ('full', $1, 'fake', 'running')", [owner]));
  let fakeA = "";
  await accepts("an owner's fake run", async (c) => { fakeA = await fakeRun(c, owner); });

  // Lineage.
  await refuses("a run that is its own parent", /studio_runs_not_own_parent|must name an existing run/, (c) => c.query(
    `INSERT INTO studio_runs (id, kind, source_run_id, requested_by, runner, fact_version_id)
     VALUES ('00000000-0000-4000-8000-000000000001', 'revise', '00000000-0000-4000-8000-000000000001', $1, 'fake', $2)`,
    [owner, factVersion]));
  await refuses("a run whose source does not exist", /must name an existing run/,
    (c) => fakeRun(c, owner, "revise", "00000000-0000-4000-8000-00000000abcd"));
  await refuses("two runs naming each other as source in one statement (a cycle)", /must name an existing run/, (c) => c.query(
    `INSERT INTO studio_runs (id, kind, source_run_id, requested_by, runner, fact_version_id) VALUES
       ('00000000-0000-4000-8000-00000000000a', 'revise', '00000000-0000-4000-8000-00000000000b', $1, 'fake', $2),
       ('00000000-0000-4000-8000-00000000000b', 'revise', '00000000-0000-4000-8000-00000000000a', $1, 'fake', $2)`,
    [owner, factVersion]));
  let childA = "";
  await accepts("a revise of a run (a child pointing at its source)", async (c) => { childA = await fakeRun(c, owner, "revise", fakeA); });
  await refuses("a source re-pointed to make a run its own ancestor", /never change/,
    (c) => c.query("UPDATE studio_runs SET source_run_id = $2 WHERE id = $1", [fakeA, childA]));
  await refuses("a full run with a source", /studio_runs_lineage_shape/, (c) => fakeRun(c, owner, "full", fakeA));
  await refuses("a revise with no source", /studio_runs_lineage_shape/, (c) => fakeRun(c, owner, "revise", null));
  await refuses("a child pinning another fact version than its source", /pin its source run's fact version/,
    (c) => fakeRun(c, owner, "revise", fakeA, null));
  let importUnverified = "";
  let importVerified = "";
  await accepts("two imports", async (c) => {
    importUnverified = String((await c.query(
      "INSERT INTO studio_runs (kind, requested_by, runner, fact_version_id) VALUES ('imported', $1, 'live', $2) RETURNING id",
      [owner, factVersion])).rows[0]?.id);
    importVerified = String((await c.query(
      "INSERT INTO studio_runs (kind, requested_by, runner, fact_version_id) VALUES ('imported', $1, 'live', $2) RETURNING id",
      [owner, factVersion])).rows[0]?.id);
  });
  await refuses("an import with a parent", /studio_runs_lineage_shape/, (c) => c.query(
    "INSERT INTO studio_runs (kind, source_run_id, requested_by, runner, fact_version_id) VALUES ('imported', $1, $2, 'live', $3)",
    [fakeA, owner, factVersion]));
  await refuses("an import tier on a run that is not an import", /import_tier_only_on_imports/,
    (c) => c.query("UPDATE studio_runs SET import_tier = 'verified' WHERE id = $1", [fakeA]));
  await pool.query("UPDATE studio_runs SET import_tier = 'archived_unverified', state = 'succeeded' WHERE id = $1", [importUnverified]);
  await pool.query("UPDATE studio_runs SET import_tier = 'verified', state = 'succeeded' WHERE id = $1", [importVerified]);
  const reviseQuote = await quote(runner, "revise");
  await refuses("an archived_unverified import as the source of a paid revise", /not verified can never be a paid/,
    (c) => confirm(c, reviseQuote, runner, { kind: "revise", source: importUnverified }));
  await accepts("a verified import as the source of a paid revise",
    (c) => confirm(c, reviseQuote, runner, { kind: "revise", source: importVerified }));

  // Terminal states.
  await pool.query("UPDATE studio_runs SET state = 'running', started_at = now() WHERE id = $1", [fakeA]);
  await refuses("a running run returned to queued", /never returns to queued/,
    (c) => c.query("UPDATE studio_runs SET state = 'queued' WHERE id = $1", [fakeA]));
  await refuses("a running run tombstoned", /only a finished run may be deleted/,
    (c) => c.query("UPDATE studio_runs SET deleted_at = now(), deleted_by = $2 WHERE id = $1", [fakeA, owner]));
  await pool.query("UPDATE studio_runs SET state = 'succeeded', finished_at = now(), verdict = 'provisional_pass' WHERE id = $1", [fakeA]);
  for (const state of ["running", "failed", "queued", "cancelled"]) {
    await refuses(`a succeeded run moved to ${state}`, /terminal state succeeded never changes/,
      (c) => c.query("UPDATE studio_runs SET state = $2 WHERE id = $1", [fakeA, state]));
  }
  await refuses("any other column of a terminal run changed", /terminal state succeeded never changes/,
    (c) => c.query("UPDATE studio_runs SET verdict = 'needs_revision' WHERE id = $1", [fakeA]));
  await refuses("an import's tier changed once finished", /terminal state succeeded never changes/,
    (c) => c.query("UPDATE studio_runs SET import_tier = 'verified' WHERE id = $1", [importUnverified]));

  // ---- §4.2 artifacts ----------------------------------------------------------
  const artifact = (c: pg.PoolClient, run: string, name: string, bytes: Buffer, sha = shaOf(bytes), length = bytes.length) =>
    c.query("INSERT INTO studio_run_artifacts (run_id, name, content, sha256, byte_length) VALUES ($1, $2, $3, $4, $5)",
      [run, name, bytes, sha, length]);
  const meta = Buffer.from('{"synthetic":true}\n', "utf8");
  await refuses("an artifact whose sha256 is not of its bytes", /sha256_of_content/,
    (c) => artifact(c, childA, "run-meta.json", meta, hex("other")));
  await refuses("an artifact whose length is not its bytes'", /length_of_content/,
    (c) => artifact(c, childA, "run-meta.json", meta, shaOf(meta), meta.length + 1));
  await refuses("an artifact named with a path", /name_shape/, (c) => artifact(c, childA, "../run-meta.json", meta));
  await accepts("an artifact written for a queued run", (c) => artifact(c, childA, "run-meta.json", meta));
  await refuses("an artifact modified", /immutable once written/,
    (c) => c.query("UPDATE studio_run_artifacts SET content = $2, sha256 = $3 WHERE run_id = $1",
      [childA, Buffer.from("x"), shaOf(Buffer.from("x"))]));
  await refuses("an artifact deleted while its run stands", /removed only by the owner's deletion/,
    (c) => c.query("DELETE FROM studio_run_artifacts WHERE run_id = $1", [childA]));
  await refuses("an artifact added to a finished run", /finished or deleted run takes no new artifact/,
    (c) => artifact(c, fakeA, "summary.md", Buffer.from("# synthetic\n")));
  await refuses("the artifacts truncated", /immutable/, (c) => c.query("TRUNCATE studio_run_artifacts"));

  // ---- §4.2 requests -------------------------------------------------------------
  const request = (c: pg.PoolClient, run: string, seq: number, stage = "strategy-concept", lens: string | null = null) =>
    c.query("INSERT INTO studio_run_requests (run_id, seq, stage, lens, model, ceiling_usd) VALUES ($1, $2, $3, $4, 'claude-opus-5', 2.5)",
      [run, seq, stage, lens]);
  await refuses("a request row for a run that is not running", /only for a running run/, (c) => request(c, paidRun, 1));
  await pool.query("UPDATE studio_runs SET state = 'running', started_at = now() WHERE id = $1", [paidRun]);
  await pool.query("UPDATE studio_jobs SET state = 'running' WHERE run_id = $1", [paidRun]);
  await refuses("a request row written already completed", /written started/, (c) => c.query(
    `INSERT INTO studio_run_requests (run_id, seq, stage, model, ceiling_usd, outcome, finished_at, cost_usd)
     VALUES ($1, 1, 'strategy-concept', 'claude-opus-5', 2.5, 'succeeded', now(), 0.1)`, [paidRun]));
  await refuses("a critic request without its lens", /lens_only_for_critic/, (c) => request(c, paidRun, 1, "final-critic"));
  await refuses("a lens on a request that is not the critic's", /lens_only_for_critic/,
    (c) => request(c, paidRun, 1, "strategy-concept", "voice-and-craft"));
  await accepts("started rows committed before four requests are sent", async (c) => {
    for (let seq = 1; seq <= 3; seq += 1) await request(c, paidRun, seq);
    await request(c, paidRun, 4, "final-critic", "evidence-fidelity");
  });
  await accepts("two requests complete: one with its measured cost, one with no usage (unknown cost)", async (c) => {
    await c.query(`UPDATE studio_run_requests SET outcome = 'succeeded', finished_at = now(), cost_usd = 0.42,
                     input_tokens = 1000, output_tokens = 2000 WHERE run_id = $1 AND seq = 1`, [paidRun]);
    await c.query(`UPDATE studio_run_requests SET outcome = 'failed', finished_at = now() WHERE run_id = $1 AND seq = 2`, [paidRun]);
  });
  const charges = (await pool.query("SELECT seq, charged_usd FROM studio_run_requests WHERE run_id = $1 ORDER BY seq", [paidRun]))
    .rows.map((row) => `${row.seq}:${row.charged_usd}`).join(",");
  holds("each request is charged its measured cost once completed with a known cost, else its full ceiling "
    + "(a started row, or a completed one with no usage)", charges === "1:0.420000,2:2.500000,3:2.500000,4:2.500000", charges);
  await refuses("a completed request row changed", /completed request row never changes/,
    (c) => c.query("UPDATE studio_run_requests SET cost_usd = 0.01 WHERE run_id = $1 AND seq = 1", [paidRun]));
  await refuses("a started request's ceiling lowered", /never change/,
    (c) => c.query("UPDATE studio_run_requests SET ceiling_usd = 0.01 WHERE run_id = $1 AND seq = 3", [paidRun]));
  await refuses("a charged column written directly", /generated column|cannot insert|can only be updated to DEFAULT/i,
    (c) => c.query("UPDATE studio_run_requests SET charged_usd = 0 WHERE run_id = $1 AND seq = 3", [paidRun]));
  await refuses("a request row deleted", /never deleted/,
    (c) => c.query("DELETE FROM studio_run_requests WHERE run_id = $1 AND seq = 3", [paidRun]));

  // ---- §4.2 findings -------------------------------------------------------------
  const finding = (c: pg.PoolClient, idx: number, lens: string, category: string, owner_: string, ownerItem: boolean) =>
    c.query(`INSERT INTO studio_findings (run_id, idx, lens, severity, category, owner, issue, owner_item)
             VALUES ($1, $2, $3, 'blocking', $4, $5, 'synthetic finding', $6)`, [childA, idx, lens, category, owner_, ownerItem]);
  await refuses("a human_review finding not marked an owner item", /owner_item_rule/,
    (c) => finding(c, 0, "voice-and-craft", "voice_clarity", "human_review", false));
  await refuses("a human_decision finding not marked an owner item", /owner_item_rule/,
    (c) => finding(c, 0, "voice-and-craft", "human_decision", "hook-story-script", false));
  await refuses("a revisable finding marked an owner item", /owner_item_rule/,
    (c) => finding(c, 0, "voice-and-craft", "voice_clarity", "hook-story-script", true));
  await refuses("a finding of a category outside its lens's", /lens_category/,
    (c) => finding(c, 0, "voice-and-craft", "claim_fidelity", "hook-story-script", false));
  await accepts("findings derived as planRevision would hold them back", async (c) => {
    await finding(c, 0, "voice-and-craft", "voice_clarity", "hook-story-script", false);
    await finding(c, 1, "evidence-fidelity", "human_decision", "packaging-adaptation", true);
    await finding(c, 2, "platform-and-local", "timing", "human_review", true);
  });
  await refuses("a finding updated rather than rebuilt", /rebuilt from its artifact/,
    (c) => c.query("UPDATE studio_findings SET issue = 'x' WHERE run_id = $1 AND idx = 0", [childA]));
  await accepts("findings rebuilt from their artifact (deleted and inserted again)", async (c) => {
    await c.query("DELETE FROM studio_findings WHERE run_id = $1", [childA]);
    await finding(c, 0, "voice-and-craft", "voice_clarity", "hook-story-script", false);
  });

  // ---- §4.6 the spend ledger --------------------------------------------------------
  const today = String((await one("SELECT studio_local_day(now())::text AS d")).d);
  const days = await one(`SELECT studio_local_day('2026-10-01T03:59:59Z')::text AS a, studio_local_day('2026-10-01T04:00:00Z')::text AS b,
                                 studio_local_day('2026-12-01T04:59:59Z')::text AS c, studio_local_day('2026-12-01T05:00:00Z')::text AS d,
                                 studio_month_of('2026-09-30')::text AS m`);
  holds("ledger days are America/New_York days, across both UTC offsets (EDT, EST) and a month boundary",
    days.a === "2026-09-30" && days.b === "2026-10-01" && days.c === "2026-11-30" && days.d === "2026-12-01"
      && days.m === "2026-09-01", JSON.stringify(days));
  const paidReserve = await one("SELECT day_local::text AS day, month_local::text AS month, created_at = now() AS dbtime FROM studio_spend_ledger WHERE run_id = $1", [paidRun]);
  holds("a reserve entry is booked to the America/New_York day and month of its creation",
    paidReserve.day === today && paidReserve.month === `${today.slice(0, 8)}01`, JSON.stringify(paidReserve));
  await refuses("a ledger entry for a fake run", /only a live Studio run/,
    (c) => c.query("INSERT INTO studio_spend_ledger (entry, run_id, amount_usd) VALUES ('reserve', $1, 1)", [fakeA]));
  await refuses("a second reserve for a run", /studio_spend_ledger_one_reserve/,
    (c) => c.query("INSERT INTO studio_spend_ledger (entry, run_id, amount_usd) VALUES ('reserve', $1, 21.65)", [paidRun]));
  await refuses("a release greater than the reservation", /cannot exceed/,
    (c) => c.query("INSERT INTO studio_spend_ledger (entry, run_id, amount_usd) VALUES ('release', $1, 21.66)", [paidRun]));
  await refuses("a release booked to another day than its reserve", /booked to its run's reserve day/,
    (c) => c.query("INSERT INTO studio_spend_ledger (entry, run_id, amount_usd, day_local) VALUES ('release', $1, 1, $2::date - 1)",
      [paidRun, today]));
  const unreservedQuote = await quote(runner);
  await refuses("a release before its run's reserve entry", /needs its run's reserve entry first/, async (c) => {
    const q = unreservedQuote;
    await confirm(c, q, runner, { reserve: false, job: false, runId: () => {} });
    const run = String((await c.query("SELECT id FROM studio_runs WHERE quote_id = $1", [q])).rows[0]?.id);
    await c.query("INSERT INTO studio_spend_ledger (entry, run_id, amount_usd) VALUES ('release', $1, 1)", [run]);
  });
  let backdated = "";
  const backdatedQuote = await quote(runner);
  await accepts("a reservation supplied with a back-dated created_at (the database sets its own time)", async (c) => {
    await confirm(c, backdatedQuote, runner, { runId: (id) => { backdated = id; }, reserveExtra: "now() - interval '2 days'" });
  });
  const backdatedRow = await one("SELECT day_local::text AS day, created_at > now() - interval '1 hour' AS recent FROM studio_spend_ledger WHERE run_id = $1", [backdated]);
  holds("so a reservation cannot be back-dated onto an earlier day", backdatedRow.day === today && backdatedRow.recent === true,
    JSON.stringify(backdatedRow));
  const spendBefore = Number((await one("SELECT studio_spend_for_day($1::date) AS s", [today])).s);
  const monthBefore = Number((await one("SELECT studio_spend_for_month($1::date) AS s", [today])).s);
  await accepts("a run settles with a release of its unused reservation",
    (c) => c.query("INSERT INTO studio_spend_ledger (entry, run_id, amount_usd) VALUES ('release', $1, 20.48)", [backdated]));
  await refuses("a second settlement for the same run", /one_settlement/,
    (c) => c.query("INSERT INTO studio_spend_ledger (entry, run_id, amount_usd) VALUES ('overrun', $1, 1)", [backdated]));
  const spendAfter = Number((await one("SELECT studio_spend_for_day($1::date) AS s", [today])).s);
  const monthAfter = Number((await one("SELECT studio_spend_for_month($1::date) AS s", [today])).s);
  holds("spend is Σreserve − Σrelease + Σoverrun: a release lowers today's and this month's spend by exactly its amount",
    Math.abs(spendBefore - spendAfter - 20.48) < 1e-9 && Math.abs(monthBefore - monthAfter - 20.48) < 1e-9,
    `${spendBefore} -> ${spendAfter}; month ${monthBefore} -> ${monthAfter}`);
  let overrunRun = "";
  const overrunQuote = await quote(runner, "full", "5.00");
  await accepts("a run whose measured cost exceeded its ceiling records an overrun", async (c) => {
    await confirm(c, overrunQuote, runner, { ceiling: "5.00", runId: (id) => { overrunRun = id; } });
  });
  const beforeOverrun = Number((await one("SELECT studio_spend_for_day($1::date) AS s", [today])).s);
  await pool.query("INSERT INTO studio_spend_ledger (entry, run_id, amount_usd) VALUES ('overrun', $1, 1.5)", [overrunRun]);
  const afterOverrun = Number((await one("SELECT studio_spend_for_day($1::date) AS s", [today])).s);
  holds("and an overrun raises the day's spend by exactly its amount, on top of the full reservation",
    Math.abs(afterOverrun - beforeOverrun - 1.5) < 1e-9, `${beforeOverrun} -> ${afterOverrun}`);
  // A reserve written just before midnight, America/New_York (planted with triggers off,
  // since the database never back-dates one itself); its release written today.
  const lateQuote = await quote(runner);
  const lateRun = "00000000-0000-4000-8000-00000000fade";
  const lateClient = await pool.connect();
  try {
    await lateClient.query("SET session_replication_role = replica");
    await lateClient.query("UPDATE studio_quotes SET consumed_at = created_at WHERE id = $1", [lateQuote]);
    await lateClient.query(
      `INSERT INTO studio_runs (id, kind, requested_by, runner, fact_version_id, quote_id, reserved_usd, state)
       VALUES ($1, 'full', $2, 'live', $3, $4, 21.65, 'running')`, [lateRun, runner, factVersion, lateQuote]);
    await lateClient.query(
      `INSERT INTO studio_spend_ledger (entry, run_id, amount_usd, day_local, month_local, created_at)
       SELECT 'reserve', $1, 21.65, d, studio_month_of(d), ((d + 1)::timestamp - interval '1 minute') AT TIME ZONE 'America/New_York'
         FROM (SELECT $2::date - 1 AS d) yesterday`, [lateRun, today]);
    await lateClient.query("SET session_replication_role = origin");
  } finally {
    lateClient.release();
  }
  await accepts("a release written after midnight for a reserve made before it",
    (c) => c.query("INSERT INTO studio_spend_ledger (entry, run_id, amount_usd) VALUES ('release', $1, 20.00)", [lateRun]));
  const late = await one(`SELECT l.day_local::text AS day, studio_local_day(l.created_at)::text AS written
                            FROM studio_spend_ledger l WHERE run_id = $1 AND entry = 'release'`, [lateRun]);
  holds("it is booked to its reserve's day (yesterday), not the day it was written (today)",
    late.written === today && late.day !== today && late.day === String((await one("SELECT ($1::date - 1)::text AS d", [today])).d),
    JSON.stringify(late));
  await refuses("a ledger entry updated", /immutable/, (c) => c.query("UPDATE studio_spend_ledger SET amount_usd = 1"));
  await refuses("a ledger entry deleted", /immutable/, (c) => c.query("DELETE FROM studio_spend_ledger"));
  await refuses("the ledger truncated", /immutable/, (c) => c.query("TRUNCATE studio_spend_ledger"));

  // ---- §4.6 jobs -----------------------------------------------------------------------
  await refuses("a second job for a run", /studio_jobs_one_per_run/,
    (c) => c.query("INSERT INTO studio_jobs (run_id, kind) VALUES ($1, 'paid')", [paidRun]));
  await refuses("a job created already claimed", /created queued and unclaimed/,
    (c) => c.query("INSERT INTO studio_jobs (run_id, kind, claimed_at) VALUES ($1, 'fake', now())", [childA]));
  await refuses("a paid job for a fake run", /paid job runs a live run/,
    (c) => c.query("INSERT INTO studio_jobs (run_id, kind) VALUES ($1, 'paid')", [childA]));
  await refuses("a paid job with no run", /studio_jobs_run_required/,
    (c) => c.query("INSERT INTO studio_jobs (kind) VALUES ('paid')"));
  await refuses("a job expiring more than an hour after creation", /expiry_within_an_hour/,
    (c) => c.query("INSERT INTO studio_jobs (kind, expires_at) VALUES ('preflight', now() + interval '2 hours')"));
  let preflight = "";
  await accepts("a free preflight job, which runs before any run exists", async (c) => {
    preflight = String((await c.query("INSERT INTO studio_jobs (kind) VALUES ('preflight') RETURNING id")).rows[0]?.id);
  });
  await refuses("a queued job moved straight to finished", /cannot move from queued to finished/,
    (c) => c.query("UPDATE studio_jobs SET state = 'finished' WHERE id = $1", [preflight]));
  await accepts("a queued job claimed (started)", (c) => c.query("UPDATE studio_jobs SET state = 'running' WHERE id = $1", [preflight]));
  await refuses("a running job returned to queued (a job is never retried)", /cannot move from running to queued/,
    (c) => c.query("UPDATE studio_jobs SET state = 'queued' WHERE id = $1", [preflight]));
  await refuses("a job's claim time rewritten", /set once/,
    (c) => c.query("UPDATE studio_jobs SET claimed_at = now() - interval '1 minute' WHERE id = $1", [preflight]));
  await accepts("a running job finished", (c) => c.query("UPDATE studio_jobs SET state = 'finished' WHERE id = $1", [preflight]));
  await refuses("a finished job restarted", /job in state finished never changes/,
    (c) => c.query("UPDATE studio_jobs SET state = 'running' WHERE id = $1", [preflight]));
  let shortLived = "";
  await accepts("a queued job expiring in 100 ms", async (c) => {
    shortLived = String((await c.query(
      "INSERT INTO studio_jobs (kind, expires_at) VALUES ('preflight', now() + interval '100 milliseconds') RETURNING id")).rows[0]?.id);
  });
  await new Promise((settle) => setTimeout(settle, 400));
  await refuses("a queued job past its expiry started", /past its expiry is never started/,
    (c) => c.query("UPDATE studio_jobs SET state = 'running' WHERE id = $1", [shortLived]));
  await accepts("the expired job marked expired", (c) => c.query("UPDATE studio_jobs SET state = 'expired' WHERE id = $1", [shortLived]));

  // ---- §4.2 terminal requests, then §4.7 tombstones -----------------------------------
  await pool.query("UPDATE studio_runs SET state = 'failed', finished_at = now(), failure_class = 'job_timeout' WHERE id = $1", [paidRun]);
  await refuses("a request row added to a finished run", /only for a running run/, (c) => request(c, paidRun, 9));
  await refuses("a started request completed after its run finished", /finished run's request rows never change/,
    (c) => c.query("UPDATE studio_run_requests SET outcome = 'succeeded', finished_at = now(), cost_usd = 0.1 WHERE run_id = $1 AND seq = 3", [paidRun]));
  await pool.query("UPDATE studio_runs SET state = 'running' WHERE id = $1", [childA]);
  await pool.query("UPDATE studio_runs SET state = 'succeeded', finished_at = now() WHERE id = $1", [childA]);
  await refuses("a finished run tombstoned by a runner", /only an active owner may delete a run/,
    (c) => c.query("UPDATE studio_runs SET deleted_at = now(), deleted_by = $2 WHERE id = $1", [childA, runner]));
  await refuses("a run row deleted (a tombstone is kept instead)", /immutable/,
    (c) => c.query("DELETE FROM studio_runs WHERE id = $1", [childA]));
  await refuses("the runs truncated", /immutable/, (c) => c.query("TRUNCATE studio_runs CASCADE"));
  await accepts("the owner deletes a finished run: tombstone, then its artifacts and findings", async (c) => {
    await c.query("UPDATE studio_runs SET deleted_at = now(), deleted_by = $2 WHERE id = $1", [childA, owner]);
    await c.query("DELETE FROM studio_run_artifacts WHERE run_id = $1", [childA]);
    await c.query("DELETE FROM studio_findings WHERE run_id = $1", [childA]);
  });
  holds("the deletion is audited and keeps the run's tombstone row",
    (await one("SELECT count(*) AS n FROM studio_audit_log WHERE action = 'run.delete' AND target_id = $1 AND actor_user_id = $2",
      [childA, owner])).n === "1"
      && (await one("SELECT deleted_at IS NOT NULL AS gone FROM studio_runs WHERE id = $1", [childA])).gone === true);
  await refuses("a tombstone changed", /tombstone never changes/,
    (c) => c.query("UPDATE studio_runs SET deleted_by = $2 WHERE id = $1", [childA, owner2]));
  await refuses("an artifact added to a deleted run", /finished or deleted run takes no new artifact/,
    (c) => artifact(c, childA, "summary.md", Buffer.from("x")));
  await refuses("a finding added to a deleted run", /deleted run takes no finding/,
    (c) => finding(c, 5, "voice-and-craft", "voice_clarity", "hook-story-script", false));
  await refuses("a deleted run used as a source", /deleted run cannot be a source/, (c) => fakeRun(c, owner, "revise", childA));
  holds("a tombstone keeps the run's ledger entries (no path deletes them)",
    (await one("SELECT count(*) AS n FROM studio_spend_ledger")).n !== "0");

  // Fact versions: the restrictive references, then an unreferenced retired version.
  await pool.query("UPDATE studio_settings SET active_fact_version_id = NULL, updated_by = $1", [owner]);
  await pool.query("UPDATE studio_fact_versions SET status = 'retired' WHERE id = $1", [factVersion]);
  await refuses("a fact version deleted while runs and quotes reference it (restrictive foreign keys)", /foreign key constraint/,
    (c) => c.query("DELETE FROM studio_fact_versions WHERE id = $1", [factVersion]));
  const spare = Buffer.from('{"facts":[]}', "utf8");
  let spareVersion = "";
  await accepts("an unreferenced retired fact version deleted, and the deletion audited", async (c) => {
    await stage(c, owner, spare, shaOf(spare));
    spareVersion = String((await c.query(
      `INSERT INTO studio_fact_versions (sha256, content, byte_length, record_count, tag_counts, uploaded_by, status)
       VALUES ($1, $2, $3, 0, '{}', $4, 'retired') RETURNING id`, [shaOf(spare), spare, spare.length, owner])).rows[0]?.id);
    await c.query("DELETE FROM studio_fact_uploads");
    await c.query("DELETE FROM studio_fact_versions WHERE id = $1", [spareVersion]);
  });
  holds("that deletion wrote its audit row", (await one(
    "SELECT count(*) AS n FROM studio_audit_log WHERE action = 'fact_version.delete' AND target_id = $1", [spareVersion])).n === "1");

  // ---- §4.6 audit log, singletons, ledger, tripwire -----------------------------------
  await refuses("an audit row updated", /immutable/, (c) => c.query("UPDATE studio_audit_log SET action = 'x'"));
  await refuses("an audit row deleted", /immutable/, (c) => c.query("DELETE FROM studio_audit_log"));
  await refuses("the audit log truncated", /immutable/, (c) => c.query("TRUNCATE studio_audit_log"));
  await refuses("an audit detail that is not an object", /detail_object/,
    (c) => c.query("INSERT INTO studio_audit_log (action, detail) VALUES ('test.event', '[]')"));
  await refuses("an audit detail over 4 KiB", /detail_bounded/,
    (c) => c.query("INSERT INTO studio_audit_log (action, detail) VALUES ('test.event', jsonb_build_object('x', repeat('a', 5000)))"));
  const beat = (c: pg.PoolClient, singleton = true) => c.query(
    `INSERT INTO studio_worker_heartbeat (singleton, commit, schema_version, approved_facts_sha256, approved_facts_tag_counts, price_table_sha256)
     VALUES ($1, $2, '0003_studio_preflight_requests.sql', $3, '{}', $3)`, [singleton, commit("worker"), hex("approved")]);
  await accepts("the worker's heartbeat row", (c) => beat(c));
  await refuses("a second heartbeat row", /studio_worker_heartbeat_pkey/, (c) => beat(c));
  await refuses("a heartbeat row that is not the singleton", /studio_worker_heartbeat_singleton/, (c) => beat(c, false));
  await refuses("a second identity row", /studio_database_identity_pkey|studio_database_identity_singleton/,
    (c) => c.query("INSERT INTO studio_database_identity (database_name, marker) VALUES ('gcd_studio', $1)", [STUDIO_IDENTITY_MARKER]));
  await refuses("the identity row changed", /immutable/, (c) => c.query("UPDATE studio_database_identity SET created_at = now()"));
  await refuses("the identity row deleted", /immutable/, (c) => c.query("DELETE FROM studio_database_identity"));
  await refuses("the identity table truncated", /immutable/, (c) => c.query("TRUNCATE studio_database_identity"));
  await refuses("a Studio ledger row changed", /immutable/, (c) => c.query("UPDATE studio_schema_migrations SET sha256 = $1", [hex("x")]));
  await refuses("a Studio ledger row deleted", /immutable/, (c) => c.query("DELETE FROM studio_schema_migrations"));
  await refuses("the Studio ledger truncated", /immutable/, (c) => c.query("TRUNCATE studio_schema_migrations"));
  await refuses("a row written to the tripwire _migrations", new RegExp(STUDIO_TRIPWIRE_CONSTRAINT),
    (c) => c.query("INSERT INTO _migrations (name) VALUES ('001_init.sql')"));

  // ---- Content Studio S6.1: migration 0003, the preflight request ------------------------
  // Fixtures: a second fact version (for a quote that names another one), a disabled runner,
  // and a live run that is not deleted (paidRun) as a source; childA is a deleted one.
  const factBytes2 = Buffer.from(JSON.stringify({ facts: [{ id: "synthetic-fixture-2" }] }), "utf8");
  let factVersion2 = "";
  let disabledRunner = "";
  await accepts("S6.1 fixtures: a second fact version and a disabled runner", async (c) => {
    await stage(c, owner, factBytes2, shaOf(factBytes2));
    factVersion2 = String((await c.query(
      `INSERT INTO studio_fact_versions (sha256, content, byte_length, record_count, tag_counts, uploaded_by)
       VALUES ($1, $2, $3, 1, '{"oil": 1}', $4) RETURNING id`, [shaOf(factBytes2), factBytes2, factBytes2.length, owner])).rows[0]?.id);
    await c.query("DELETE FROM studio_fact_uploads");
    disabledRunner = String((await insertUser(c, mail("disabled.runner"), "runner", owner, null)).rows[0]?.id);
    await c.query("UPDATE studio_users SET status = 'disabled' WHERE id = $1", [disabledRunner]);
  });
  const ALL_PLATFORMS = ["instagram", "facebook", "google_business_profile"];
  const pfParams = (seed: string) => hex(`preflight-params-${seed}`);
  const pfJob = async (c: pg.PoolClient) =>
    String((await c.query("INSERT INTO studio_jobs (kind) VALUES ('preflight') RETURNING id")).rows[0]?.id);
  const pfRequest = async (c: pg.PoolClient, o: {
    job?: string; user?: string; action?: string; goal?: string | null; platforms?: string[]; scope?: string[] | null;
    source?: string | null; fact?: string | null; params?: string;
  } = {}) => {
    const action = o.action ?? "full";
    return String((await c.query(
      `INSERT INTO studio_preflight_requests (job_id, user_id, action, goal, platforms, scope_tags, source_run_id,
                                              fact_version_id, params_sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [o.job ?? await pfJob(c), o.user ?? runner, action,
        o.goal !== undefined ? o.goal : action === "full" ? "synthetic fixture goal" : null,
        o.platforms ?? ALL_PLATFORMS, o.scope ?? null,
        o.source !== undefined ? o.source : action === "full" ? null : paidRun,
        o.fact !== undefined ? o.fact : factVersion, o.params ?? pfParams("default")])).rows[0]?.id);
  };
  const pfQuote = async (c: pg.PoolClient, user: string, action: string, params: string, fact = factVersion) =>
    String((await c.query(
      `INSERT INTO studio_quotes (user_id, action, params_sha256, worker_commit, approved_facts_sha256, fact_version_id,
                                  price_table_sha256, ceiling_usd, breakdown)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 21.65, '[{"stage": "strategy-concept"}]') RETURNING id`,
      [user, action, params, commit("worker"), hex("approved"), fact, hex("prices")])).rows[0]?.id);
  const quoted = (c: pg.PoolClient, id: string, quoteId: string, plan: string | null = null) =>
    c.query("UPDATE studio_preflight_requests SET outcome = 'quoted', quote_id = $2, revise_plan = $3::jsonb WHERE id = $1",
      [id, quoteId, plan]);
  const refused = (c: pg.PoolClient, id: string, cls: string, message: string, plan: string | null = null) =>
    c.query(`UPDATE studio_preflight_requests SET outcome = 'refused', refusal_class = $2, refusal_message = $3,
                    revise_plan = $4::jsonb WHERE id = $1`, [id, cls, message, plan]);
  /** Test-only: a row stamped 31 days old, written with triggers off (a superuser's session_replication_role). */
  const pfBackdated = async (c: pg.PoolClient, o: { params: string; outcome: string; quote?: string | null }) => {
    const job = await pfJob(c);
    await c.query("SET LOCAL session_replication_role = replica");
    const id = String((await c.query(
      `INSERT INTO studio_preflight_requests (job_id, user_id, action, goal, platforms, fact_version_id, params_sha256,
                                              created_at, outcome, quote_id, refusal_class, refusal_message, outcome_at)
       VALUES ($1, $2, 'full', 'synthetic fixture goal', $3, $4, $5, now() - interval '31 days', $6, $7, $8, $9,
               now() - interval '31 days') RETURNING id`,
      [job, runner, ALL_PLATFORMS, factVersion, o.params, o.outcome, o.quote ?? null,
        o.outcome === "refused" ? "scope_over_cap" : null, o.outcome === "refused" ? "synthetic refusal" : null])).rows[0]?.id);
    await c.query("SET LOCAL session_replication_role = origin");
    return id;
  };
  const plan = JSON.stringify({ kind: "revision", startStage: "production-direction", stages: [], ownerItems: [], notRerun: [] });

  // The parameters.
  await refuses("a preflight request for a job that is not a preflight job", /belongs to a preflight job, not a paid job/,
    async (c) => pfRequest(c, { job: String((await c.query("SELECT id FROM studio_jobs WHERE run_id = $1", [paidRun])).rows[0]?.id) }));
  await refuses("a preflight request by a viewer", /requested only by an active owner or runner/,
    (c) => pfRequest(c, { user: viewer }));
  await refuses("a preflight request by a disabled runner", /requested only by an active owner or runner/,
    (c) => pfRequest(c, { user: disabledRunner }));
  await refuses("a full-run preflight with no goal", /studio_preflight_requests_goal_for_full/,
    (c) => pfRequest(c, { goal: null }));
  await refuses("a full-run preflight with an empty goal", /studio_preflight_requests_goal_bounded/,
    (c) => pfRequest(c, { goal: "" }));
  await refuses("a full-run preflight with a goal of 2,001 characters", /studio_preflight_requests_goal_bounded/,
    (c) => pfRequest(c, { goal: "g".repeat(2001) }));
  for (const action of ["revise", "replay_critic", "resume_packaging"]) {
    await refuses(`a ${action} preflight carrying a goal (it uses its source run's)`, /studio_preflight_requests_goal_for_full/,
      (c) => pfRequest(c, { action, goal: "synthetic fixture goal" }));
  }
  await refuses("a preflight for an action no quote can carry", /studio_preflight_requests_action/,
    (c) => pfRequest(c, { action: "imported" }));
  await refuses("a preflight with an empty platforms array", /studio_preflight_requests_platforms/,
    (c) => pfRequest(c, { platforms: [] }));
  await refuses("a preflight naming an unknown platform", /studio_preflight_requests_platforms/,
    (c) => pfRequest(c, { platforms: ["instagram", "tiktok"] }));
  await refuses("a preflight naming a platform twice (platforms are a set)", /studio_preflight_requests_platforms/,
    (c) => pfRequest(c, { platforms: ["instagram", "instagram"] }));
  await refuses("a preflight with an empty scope (an unscoped run is NULL)", /studio_preflight_requests_scope_tags/,
    (c) => pfRequest(c, { scope: [] }));
  await refuses("a preflight whose scope names a tag twice", /studio_preflight_requests_scope_tags/,
    (c) => pfRequest(c, { scope: ["oil", "oil"] }));
  await refuses("a revise preflight with no source run (required)", /studio_preflight_requests_lineage/,
    (c) => pfRequest(c, { action: "revise", source: null }));
  await refuses("a full-run preflight naming a source run (forbidden)", /studio_preflight_requests_lineage/,
    (c) => pfRequest(c, { source: paidRun }));
  await refuses("a revise preflight whose source run is deleted", /deleted run cannot be a preflight's source/,
    (c) => pfRequest(c, { action: "revise", source: childA }));
  await refuses("a preflight with no fact version", /null value in column "fact_version_id"/,
    (c) => pfRequest(c, { fact: null }));
  await refuses("a preflight whose params_sha256 is not a lower-case sha256", /studio_preflight_requests_params_sha256_shape/,
    (c) => pfRequest(c, { params: pfParams("x").toUpperCase() }));
  await refuses("a preflight request created with an outcome already written", /created without an outcome/,
    async (c) => c.query(
      `INSERT INTO studio_preflight_requests (job_id, user_id, action, goal, platforms, fact_version_id, params_sha256,
                                              outcome, refusal_class, refusal_message, outcome_at)
       VALUES ($1, $2, 'full', 'synthetic fixture goal', $3, $4, $5, 'refused', 'scope_over_cap', 'synthetic', now())`,
      [await pfJob(c), runner, ALL_PLATFORMS, factVersion, pfParams("born-answered")]));
  let sharedJob = "";
  await accepts("a runner's full-run preflight request, beside its preflight job", async (c) => {
    sharedJob = await pfJob(c);
    await pfRequest(c, { job: sharedJob, params: pfParams("first-on-job") });
  });
  await refuses("a second preflight request for the same job", /studio_preflight_requests_one_per_job/,
    (c) => pfRequest(c, { job: sharedJob, params: pfParams("second-on-job") }));

  // The outcome: quoted.
  const pQuoted = pfParams("quoted");
  let reqQuoted = "";
  await accepts("an owner's full-run request with a 2,000-character goal, every platform and a scope", async (c) => {
    reqQuoted = await pfRequest(c, { user: owner, goal: "goal ".repeat(400), scope: ["brakes", "oil"], params: pQuoted });
  });
  for (const [label, user, action, params, fact] of [
    ["another user", runner, "full", pQuoted, factVersion],
    ["another action", owner, "replay_critic", pQuoted, factVersion],
    ["other parameters", owner, "full", pfParams("other"), factVersion],
    ["another fact version", owner, "full", pQuoted, factVersion2],
  ] as const) {
    await refuses(`a quoted outcome naming a quote for ${label}`, /quote must match its user, action, parameters and fact version/,
      async (c) => quoted(c, reqQuoted, await pfQuote(c, user, action, params, fact)));
  }
  await refuses("a quoted outcome with no quote", /studio_preflight_requests_outcome_shape/,
    (c) => c.query("UPDATE studio_preflight_requests SET outcome = 'quoted' WHERE id = $1", [reqQuoted]));
  await refuses("a quoted outcome that also carries a refusal", /studio_preflight_requests_outcome_shape/, async (c) =>
    c.query("UPDATE studio_preflight_requests SET outcome = 'quoted', quote_id = $2, refusal_class = 'scope_over_cap' WHERE id = $1",
      [reqQuoted, await pfQuote(c, owner, "full", pQuoted)]));
  await refuses("a revise plan on a full run's quoted outcome", /studio_preflight_requests_revise_plan_when/,
    async (c) => quoted(c, reqQuoted, await pfQuote(c, owner, "full", pQuoted), plan));
  let quoteForQuoted = "";
  await accepts("the quoted path: the worker writes the outcome once, naming a quote for the same user, action, "
    + "parameters and fact version", async (c) => {
    quoteForQuoted = await pfQuote(c, owner, "full", pQuoted);
    await quoted(c, reqQuoted, quoteForQuoted);
  });
  holds("the database stamps the outcome's time, and the request keeps its parameters",
    await (async () => {
      const row = await one("SELECT outcome, quote_id, outcome_at IS NOT NULL AS stamped, goal, platforms, scope_tags FROM studio_preflight_requests WHERE id = $1", [reqQuoted]);
      return row.outcome === "quoted" && row.quote_id === quoteForQuoted && row.stamped === true
        && row.goal === "goal ".repeat(400) && JSON.stringify(row.platforms) === JSON.stringify(ALL_PLATFORMS)
        && JSON.stringify(row.scope_tags) === JSON.stringify(["brakes", "oil"]);
    })());
  await refuses("a second outcome written over a quoted one", /outcome is written once and never changes/,
    (c) => refused(c, reqQuoted, "scope_over_cap", "synthetic refusal"));
  await refuses("a quoted outcome re-pointed at another quote", /outcome is written once and never changes/,
    async (c) => c.query("UPDATE studio_preflight_requests SET quote_id = $2 WHERE id = $1", [reqQuoted, await pfQuote(c, owner, "full", pQuoted)]));
  await refuses("an answered request's parameters changed", /outcome is written once and never changes/,
    (c) => c.query("UPDATE studio_preflight_requests SET goal = 'another goal' WHERE id = $1", [reqQuoted]));
  await refuses("one quote named by two requests", /studio_preflight_requests_one_per_quote/, async (c) => {
    const other = await pfRequest(c, { user: owner, goal: "goal ".repeat(400), scope: ["brakes", "oil"], params: pQuoted });
    await quoted(c, other, quoteForQuoted);
  });
  await refuses("a quote deleted while a preflight request names it (restrictive foreign key)", /foreign key constraint/,
    (c) => c.query("DELETE FROM studio_quotes WHERE id = $1", [quoteForQuoted]));

  // The outcome: refused; parameters never change.
  let reqPending = "";
  await accepts("a runner's unanswered request", async (c) => { reqPending = await pfRequest(c, { params: pfParams("pending") }); });
  for (const [column, value] of [["goal", "'another goal'"], ["platforms", "ARRAY['instagram']"], ["scope_tags", "ARRAY['oil']"],
    ["fact_version_id", `'${factVersion2}'`], ["params_sha256", `'${pfParams("changed")}'`], ["user_id", `'${owner}'`],
    ["created_at", "now() - interval '40 days'"]] as const) {
    await refuses(`an unanswered request's ${column} changed`, /parameters never change/,
      (c) => c.query(`UPDATE studio_preflight_requests SET ${column} = ${value} WHERE id = $1`, [reqPending]));
  }
  await refuses("an update that writes no outcome (a plan alone)", /updated only to write its outcome/,
    (c) => c.query("UPDATE studio_preflight_requests SET revise_plan = $2::jsonb WHERE id = $1", [reqPending, plan]));
  await refuses("a refused outcome with no message", /studio_preflight_requests_outcome_shape/,
    (c) => c.query("UPDATE studio_preflight_requests SET outcome = 'refused', refusal_class = 'scope_over_cap' WHERE id = $1", [reqPending]));
  await refuses("a refused outcome that also names a quote", /studio_preflight_requests_outcome_shape/, async (c) =>
    c.query(`UPDATE studio_preflight_requests SET outcome = 'refused', refusal_class = 'scope_over_cap', refusal_message = 'x',
                    quote_id = $2 WHERE id = $1`, [reqPending, await pfQuote(c, runner, "full", pfParams("pending"))]));
  await refuses("a refusal class that is not the failure-class shape", /studio_preflight_requests_refusal_class_shape/,
    (c) => refused(c, reqPending, "Scope Over Cap", "synthetic refusal"));
  await refuses("a refusal message of 4,001 characters", /studio_preflight_requests_refusal_message_bounded/,
    (c) => refused(c, reqPending, "scope_over_cap", "m".repeat(4001)));
  await refuses("a revise plan on a full run's refusal", /studio_preflight_requests_revise_plan_when/,
    (c) => refused(c, reqPending, "no_revisable_blocking_finding", "synthetic refusal", plan));
  await accepts("the refused path: a refusal with its class and a 4,000-character message, at no cost",
    (c) => refused(c, reqPending, "scope_over_cap", "m".repeat(4000)));
  await refuses("a second outcome written over a refused one", /outcome is written once and never changes/,
    async (c) => quoted(c, reqPending, await pfQuote(c, runner, "full", pfParams("pending"))));

  // A revise, with its plan.
  const pRevise = pfParams("revise");
  let reqRevise = "";
  await accepts("a runner's revise request: a source run, a subset of platforms, no goal", async (c) => {
    reqRevise = await pfRequest(c, { action: "revise", platforms: ["instagram", "facebook"], params: pRevise });
  });
  await refuses("a revise plan that is not a JSON object", /studio_preflight_requests_revise_plan_object/,
    async (c) => quoted(c, reqRevise, await pfQuote(c, runner, "revise", pRevise), "[]"));
  await refuses("a revise plan over 1 MiB", /studio_preflight_requests_revise_plan_bounded/,
    async (c) => quoted(c, reqRevise, await pfQuote(c, runner, "revise", pRevise), JSON.stringify({ kind: "revision", x: "p".repeat(1_048_576) })));
  await refuses("a revise plan on a refusal of another class", /studio_preflight_requests_revise_plan_when/,
    (c) => refused(c, reqRevise, "source_unverified", "synthetic refusal", plan));
  await accepts("the revise path: a quoted revise carrying planRevision's plan",
    async (c) => quoted(c, reqRevise, await pfQuote(c, runner, "revise", pRevise), plan));
  holds("the stored plan is the plan written (jsonb equality)", (await one(
    "SELECT revise_plan = $2::jsonb AS same FROM studio_preflight_requests WHERE id = $1", [reqRevise, plan])).same === true);
  await accepts("a revise refused because no blocking finding is revisable keeps its plan, with no quote", async (c) => {
    const id = await pfRequest(c, { action: "revise", params: pfParams("no-revision") });
    await refused(c, id, "no_revisable_blocking_finding", "no blocking finding is revisable",
      JSON.stringify({ kind: "no_revision", stages: [], ownerItems: [], notRerun: [] }));
  });

  // Retention, TRUNCATE and DELETE.
  await refuses("the preflight requests truncated", /immutable/, (c) => c.query("TRUNCATE studio_preflight_requests"));
  await refuses("a quoted request whose quote was never consumed, deleted inside 30 days", /kept for 30 days/,
    (c) => c.query("DELETE FROM studio_preflight_requests WHERE id = $1", [reqQuoted]));
  await refuses("a refused request deleted inside 30 days", /kept for 30 days/,
    (c) => c.query("DELETE FROM studio_preflight_requests WHERE id = $1", [reqPending]));
  await refuses("a request inserted with a created_at 40 days old (the database stamps now), deleted at once", /kept for 30 days/,
    async (c) => {
      const id = String((await c.query(
        `INSERT INTO studio_preflight_requests (job_id, user_id, action, goal, platforms, fact_version_id, params_sha256, created_at)
         VALUES ($1, $2, 'full', 'synthetic fixture goal', $3, $4, $5, now() - interval '40 days') RETURNING id`,
        [await pfJob(c), runner, ALL_PLATFORMS, factVersion, pfParams("back-dated")])).rows[0]?.id);
      await c.query("DELETE FROM studio_preflight_requests WHERE id = $1", [id]);
    });
  const pConsumed = pfParams("consumed");
  let reqConsumed = "";
  await accepts("test fixture: a 31-day-old quoted request whose quote was then consumed by a confirmation", async (c) => {
    const q = await pfQuote(c, runner, "full", pConsumed);
    await confirm(c, q, runner);
    reqConsumed = await pfBackdated(c, { params: pConsumed, outcome: "quoted", quote: q });
  });
  await refuses("a request whose quote was consumed, deleted even after 30 days", /quote was consumed is never deleted/,
    (c) => c.query("DELETE FROM studio_preflight_requests WHERE id = $1", [reqConsumed]));
  await accepts("after 30 days a refused request, and a quoted one whose quote was never consumed (then its quote), are deleted",
    async (c) => {
      const old = await pfBackdated(c, { params: pfParams("old-refused"), outcome: "refused" });
      const q = await pfQuote(c, runner, "full", pfParams("old-quoted"));
      const oldQuoted = await pfBackdated(c, { params: pfParams("old-quoted"), outcome: "quoted", quote: q });
      await c.query("DELETE FROM studio_preflight_requests WHERE id = ANY ($1::uuid[])", [[old, oldQuoted]]);
      await c.query("DELETE FROM studio_quotes WHERE id = $1", [q]);
    });
}

async function main(): Promise<void> {
  const admin = adminUrl();
  const adminPool = openPool("admin", { connectionString: admin, max: 2, connectionTimeoutMillis: 10_000 });
  const dbs = new Databases(adminPool, admin);
  const started = performance.now();
  try {
    const version = String((await adminPool.query("SHOW server_version")).rows[0]?.server_version ?? "unknown");
    console.log(`[studio-postgres] server version ${version}`);
    const existing = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [STUDIO_DATABASE_NAME]);
    if (existing.rows.length > 0) {
      throw new Error(`a database named ${STUDIO_DATABASE_NAME} already exists on this server; this suite never touches it`);
    }
    await runnerAndCross(dbs);
    await studioDatabase(dbs);
    await upgradeFromSchema0002(dbs);
  } finally {
    const leftovers = [...dbs.created];
    for (const name of leftovers) await dbs.drop(name).catch((error) => console.error(`[studio-postgres] drop ${name}: ${(error as Error).message}`));
    await closePool(adminPool);
  }
  reportPoolErrors();
  const total = GROUPS.reduce((sum, group) => sum + counts[group], 0);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(failures === 0
    ? `\n[studio-postgres] PASS ${total} checks (runner=${counts.runner}, cross=${counts.cross}, schema=${counts.schema}) in ${seconds}s`
    : `\n[studio-postgres] ${failures} FAILURE(S) of ${total} checks`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`[studio-postgres] FAIL: ${(error as Error).stack ?? String(error)}`);
  if (unexpectedPoolErrors.length > 0) console.error(`[studio-postgres] pool errors: ${unexpectedPoolErrors.join(" | ")}`);
  process.exitCode = 1;
});
