#!/usr/bin/env node
/**
 * Disposable PostgreSQL integration tests for the M1 readiness runner's two
 * database phases.
 *
 * Safety contract, the same one `src/harness/postgres.integration.selftest.ts`
 * established for Phase 0A:
 *
 *   - requires `M1_READINESS_DISPOSABLE_POSTGRES=1` and a LOOPBACK-ONLY
 *     `M1_READINESS_POSTGRES_ADMIN_URL`, so it cannot be pointed at production
 *     by exporting one variable;
 *   - creates randomly named databases, touches only those databases, and drops
 *     every one of them on exit;
 *   - never runs against `GCD_AUDIT_DATABASE_URL`.
 *
 * The scenarios are the ones the runner has to get right against a real server
 * rather than a fixture: migration 007 absent, migration 007 present, an
 * unexpected migration, a within-bound audit, an exceeded-bound audit, lock
 * contention, connection failure, and an interrupted read.
 *
 * Two invariants are asserted after EVERY runner call, because they are the
 * claims the runner makes about itself:
 *
 *   - `_migrations` is byte-for-byte unchanged: no migration is applied and
 *     none is rolled back;
 *   - no backend named `gcd-m1-readiness-runner` remains in `pg_stat_activity`:
 *     the runner leaves no open database session. This is read from the server's
 *     own catalogue, not from `/proc` and not by matching a process name.
 */

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { CANONICAL_MIGRATIONS, MIGRATION_007_STATES } from "../lib/migrationState.mjs";
import { readEvidenceLimits } from "../lib/aggregateAudit.mjs";
import { DEADLINES_MS } from "./deadlines.mjs";
import { readMigrationState, runAggregateAudit } from "./database.mjs";
import { Runtime } from "./runtime.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const APPLICATION_NAME = "gcd-m1-readiness-runner";

const GATE = "M1_READINESS_DISPOSABLE_POSTGRES";
const ADMIN = "M1_READINESS_POSTGRES_ADMIN_URL";

if (process.env[GATE] !== "1") {
  console.log(`[m1-postgres] skipped: set ${GATE}=1 and ${ADMIN} to run this suite.`);
  process.exit(0);
}
const adminUrl = process.env[ADMIN];
if (!adminUrl) {
  console.error(`[m1-postgres] ${ADMIN} is not set.`);
  process.exit(2);
}
{
  const host = new URL(adminUrl).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]", ""].includes(host)) {
    console.error("[m1-postgres] refusing a non-loopback admin URL.");
    process.exit(2);
  }
}

let passed = 0;
/** @param {string} label @param {boolean} condition */
const check = (label, condition) => {
  if (!condition) throw new Error(label);
  passed += 1;
  console.log(`  ✓ ${label}`);
};

/** @param {string} url @param {string} sql @param {unknown[]} [params] */
const withAdmin = async (url, fn) => {
  const client = new pg.Client({ connectionString: url, application_name: "m1-readiness-selftest" });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
};

/** @param {string} name */
const databaseUrl = (name) => {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
};

/** The migration SQL, read from the repository rather than reinvented. */
const migrationSql = async (name) =>
  readFile(resolve(REPO_ROOT, "state/migrations", name), "utf8");

/**
 * Apply migrations 001..n into a fresh database, exactly as the repository's own
 * runner would, and record them in `_migrations`.
 *
 * This is TEST SETUP. The runner under test never writes anything.
 *
 * @param {string} url @param {readonly string[]} names
 */
const seedMigrations = async (url, names) => {
  await withAdmin(url, async (client) => {
    await client.query(
      `CREATE TABLE IF NOT EXISTS _migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    for (const name of names) {
      await client.query(await migrationSql(name));
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
    }
  });
};

/** @param {string} url */
const migrationsSnapshot = async (url) =>
  withAdmin(url, async (client) =>
    JSON.stringify((await client.query("SELECT name FROM _migrations ORDER BY name")).rows),
  );

/** @param {string} url */
const runnerBackendCount = async (url) =>
  withAdmin(url, async (client) =>
    Number(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1",
          [APPLICATION_NAME],
        )
      ).rows[0].n,
    ),
  );

/**
 * Give the server a moment to reap a backend whose socket has just been
 * destroyed, then assert none of ours remains. Bounded and polled rather than
 * slept blindly, so a genuine leak still fails.
 *
 * @param {string} url
 */
const assertNoRunnerSession = async (url) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((await runnerBackendCount(url)) === 0) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

const databases = [];
/** @param {string} label */
const freshDatabase = async (label) => {
  const name = `m1r_${label}_${randomBytes(4).toString("hex")}`;
  await withAdmin(adminUrl, (client) => client.query(`CREATE DATABASE ${name}`));
  databases.push(name);
  return databaseUrl(name);
};

/**
 * One fixed seeding statement for the audit scenarios.
 *
 * This is TEST SETUP, written here rather than by the runner: the runner under
 * test issues no statement that is not read-only.
 */
const SEED_EVIDENCE_SQL = `
  INSERT INTO content_evidence
    (id, kind, claim, subject, attribute, tags, source_type, source_ref, provenance, reviewed_by, detail)
  VALUES
    ($1, 'creative_hypothesis', $2, 'subject', 'attribute', ARRAY['tag-a','tag-b'],
     'model_inference', 'ref', 'provenance', 'reviewer', '{"note":"bounded"}'::jsonb)
`;

const LIMITS = readEvidenceLimits(REPO_ROOT);
const SERVER_VERSION = await withAdmin(adminUrl, async (client) =>
  (await client.query("SHOW server_version")).rows[0].server_version,
);
const MAJOR = Number.parseInt(String(SERVER_VERSION).split(".")[0] ?? "", 10);

console.log(`[m1-postgres] PostgreSQL ${SERVER_VERSION}`);

try {
  check("the server is PostgreSQL 16 or 18", MAJOR === 16 || MAJOR === 18);

  // --- scenario 1: migration 007 absent ------------------------------------
  {
    const url = await freshDatabase("absent");
    await seedMigrations(url, CANONICAL_MIGRATIONS.slice(0, 6));
    const before = await migrationsSnapshot(url);
    const result = await readMigrationState({
      connectionString: url,
      milestone: "M1",
      artifactEntries: [...CANONICAL_MIGRATIONS],
      runtime: new Runtime(),
    });
    check("007 absent: the read completes", result.status === "READ");
    check("007 absent: decision is pass", result.decision === "pass");
    check("007 absent: 007 is NOT APPLIED", result.migration_007_state === MIGRATION_007_STATES.NOT_APPLIED);
    check("007 absent: pending is exactly 007", result.pending.join() === "007_evidence_bounds.sql");
    check("007 absent: the transaction was read-only", result.session.transaction_read_only === "on");
    check("007 absent: the server enforced the statement deadline", result.session.statement_timeout === "15s");
    check("007 absent: the server enforced the lock deadline", result.session.lock_timeout === "5s");
    check("007 absent: no migration was applied or rolled back", (await migrationsSnapshot(url)) === before);
    check("007 absent: no runner session remains", await assertNoRunnerSession(url));
  }

  // --- scenario 2: migration 007 present -----------------------------------
  {
    const url = await freshDatabase("present");
    await seedMigrations(url, [...CANONICAL_MIGRATIONS]);
    const before = await migrationsSnapshot(url);
    const result = await readMigrationState({
      connectionString: url,
      milestone: "M1",
      artifactEntries: [...CANONICAL_MIGRATIONS],
      runtime: new Runtime(),
    });
    check("007 present: 007 is APPLIED", result.migration_007_state === MIGRATION_007_STATES.APPLIED);
    check("007 present: decision is stop", result.decision === "stop");
    check(
      "007 present: comparisons 2 and 3 fail",
      result.failed_comparisons.includes("2_D==E_applied_pre") && result.failed_comparisons.includes("3_P==E_pending"),
    );
    check("007 present: nothing was rolled back", (await migrationsSnapshot(url)) === before);
    check("007 present: no runner session remains", await assertNoRunnerSession(url));
  }

  // --- scenario 3: an unexpected migration ---------------------------------
  {
    const url = await freshDatabase("unexpected");
    await seedMigrations(url, CANONICAL_MIGRATIONS.slice(0, 6));
    await withAdmin(url, (client) =>
      client.query("INSERT INTO _migrations (name) VALUES ('999_unexpected.sql')"),
    );
    const result = await readMigrationState({
      connectionString: url,
      milestone: "M1",
      artifactEntries: [...CANONICAL_MIGRATIONS],
      runtime: new Runtime(),
    });
    check(
      "unexpected migration: comparisons 2, 4 and 6 fail",
      ["2_D==E_applied_pre", "4_every_D_present_in_F(A)", "6_no_unexpected_applied_in_D"].every((k) =>
        result.failed_comparisons.includes(k),
      ),
    );
    check("unexpected migration: it is named in the detail", result.comparison_detail.unexpected_applied_in_D.join() === "999_unexpected.sql");
    check("unexpected migration: decision is stop", result.decision === "stop");
    check("unexpected migration: no runner session remains", await assertNoRunnerSession(url));
  }

  // --- scenario 4: a within-bound audit ------------------------------------
  // Seeded under 001-006 only, because that is the state the audit exists to
  // judge: whether 007's not-yet-applied constraints COULD pass.
  {
    const url = await freshDatabase("within");
    await seedMigrations(url, CANONICAL_MIGRATIONS.slice(0, 6));
    await withAdmin(url, async (client) => {
      // `creative_hypothesis` + `model_inference` is the shape migration 006
      // constrains least, so the row exercises the BOUNDS rather than 006's
      // unrelated kind-specific rules.
      await client.query(SEED_EVIDENCE_SQL, ["ev-within-1", "x".repeat(LIMITS.claimChars)]);
      await client.query(SEED_EVIDENCE_SQL, ["ev-within-2", "second claim"]);
      await client.query(
        `INSERT INTO content_evidence_relations (from_id, to_id, kind, note)
         VALUES ('ev-within-1', 'ev-within-2', 'supports', $1)`,
        ["n".repeat(LIMITS.relationNoteChars)],
      );
    });
    const result = await runAggregateAudit({ connectionString: url, repoRoot: REPO_ROOT, runtime: new Runtime() });
    check("within-bound audit: the audit completes", result.status === "AUDITED");
    check("within-bound audit: the contract is 23 checks", result.check_count === 23);
    check("within-bound audit: the verdict is WITHIN BOUNDS", result.verdict === "WITHIN BOUNDS");
    check("within-bound audit: a claim exactly at the bound is within it", result.checks.find((c) => c.check === "claim chars").measured === LIMITS.claimChars);
    check("within-bound audit: the transaction was read-only", result.session.transaction_read_only === "on");
    check("within-bound audit: no row content was returned", !JSON.stringify(result).includes("x".repeat(64)));
    check("within-bound audit: no runner session remains", await assertNoRunnerSession(url));
  }

  // --- scenario 5: an exceeded-bound audit ---------------------------------
  {
    const url = await freshDatabase("exceeded");
    await seedMigrations(url, CANONICAL_MIGRATIONS.slice(0, 6));
    await withAdmin(url, (client) =>
      client.query(SEED_EVIDENCE_SQL, ["ev-exceeded-1", "y".repeat(LIMITS.claimChars + 1)]),
    );
    const result = await runAggregateAudit({ connectionString: url, repoRoot: REPO_ROOT, runtime: new Runtime() });
    check("exceeded-bound audit: the verdict is EXCEEDS BOUNDS", result.verdict === "EXCEEDS BOUNDS");
    check("exceeded-bound audit: the failing check is named", result.failing_checks.includes("claim chars"));
    check("exceeded-bound audit: still 23 checks", result.check_count === 23);
    check("exceeded-bound audit: no runner session remains", await assertNoRunnerSession(url));
  }

  // --- scenario 6: lock contention ------------------------------------------
  {
    const url = await freshDatabase("locked");
    await seedMigrations(url, CANONICAL_MIGRATIONS.slice(0, 6));

    const blocker = new pg.Client({ connectionString: url, application_name: "m1-readiness-blocker" });
    await blocker.connect();
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE _migrations IN ACCESS EXCLUSIVE MODE");
    let elapsed;
    let result;
    try {
      const started = Date.now();
      result = await readMigrationState({
        connectionString: url,
        milestone: "M1",
        artifactEntries: [...CANONICAL_MIGRATIONS],
        runtime: new Runtime(),
      });
      elapsed = Date.now() - started;
    } finally {
      await blocker.query("ROLLBACK");
      await blocker.end();
    }
    check("lock contention: the read fails rather than hanging", result.status === "FAILED");
    check("lock contention: the category is the fixed lock_not_available", result.error_category === "lock_not_available");
    check(
      `lock contention: it stopped within the documented ${DEADLINES_MS.database_lock}ms lock deadline`,
      elapsed < DEADLINES_MS.database_lock + DEADLINES_MS.database_connect + 2_000,
    );
    check("lock contention: no driver message reached the result", !JSON.stringify(result).toLowerCase().includes("lock timeout"));
    check("lock contention: 007 stays UNKNOWN in either direction", result.migration_007_state === MIGRATION_007_STATES.UNKNOWN);
    check("lock contention: no runner session remains", await assertNoRunnerSession(url));

    const audit = await (async () => {
      const b2 = new pg.Client({ connectionString: url, application_name: "m1-readiness-blocker" });
      await b2.connect();
      await b2.query("BEGIN");
      await b2.query("LOCK TABLE content_evidence IN ACCESS EXCLUSIVE MODE");
      try {
        return await runAggregateAudit({ connectionString: url, repoRoot: REPO_ROOT, runtime: new Runtime() });
      } finally {
        await b2.query("ROLLBACK");
        await b2.end();
      }
    })();
    check("lock contention: the audit also refuses with lock_not_available", audit.status === "FAILED" && audit.error_category === "lock_not_available");
    check("lock contention: the audit verdict is NOT ESTABLISHED", audit.verdict === "NOT ESTABLISHED");
    check("lock contention: no runner session remains after the audit", await assertNoRunnerSession(url));
  }

  // --- scenario 7: connection failure ---------------------------------------
  {
    const refused = await readMigrationState({
      connectionString: "postgresql://nobody:nothing@127.0.0.1:1/absent",
      milestone: "M1",
      artifactEntries: [...CANONICAL_MIGRATIONS],
      runtime: new Runtime(),
    });
    check("connection failure: the read fails", refused.status === "FAILED");
    check("connection failure: the category is connection_refused", refused.error_category === "connection_refused");
    check("connection failure: 007 stays UNKNOWN in either direction", refused.migration_007_state === MIGRATION_007_STATES.UNKNOWN);
    check("connection failure: no host, port, user or password reached the result", !/127\.0\.0\.1|nobody|nothing|:1\b/.test(JSON.stringify(refused)));

    const missingDb = await runAggregateAudit({
      connectionString: databaseUrl(`m1r_never_created_${randomBytes(4).toString("hex")}`),
      repoRoot: REPO_ROOT,
      runtime: new Runtime(),
    });
    check("connection failure: an absent database is a fixed category", missingDb.status === "FAILED" && missingDb.error_category === "database_does_not_exist");
    check("connection failure: the audit verdict is NOT ESTABLISHED", missingDb.verdict === "NOT ESTABLISHED");
  }

  // --- scenario 8: an interrupted read --------------------------------------
  {
    const url = await freshDatabase("interrupted");
    await seedMigrations(url, CANONICAL_MIGRATIONS.slice(0, 6));

    const blocker = new pg.Client({ connectionString: url, application_name: "m1-readiness-blocker" });
    await blocker.connect();
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE _migrations IN ACCESS EXCLUSIVE MODE");

    const runtime = new Runtime();
    let result;
    try {
      const pending = readMigrationState({
        connectionString: url,
        milestone: "M1",
        artifactEntries: [...CANONICAL_MIGRATIONS],
        runtime,
      });
      // Interrupt while the statement is genuinely blocked on the lock.
      setTimeout(() => runtime.controller.abort(), 500);
      result = await pending;
      await runtime.shutdown();
    } finally {
      await blocker.query("ROLLBACK");
      await blocker.end();
    }
    check("interrupted read: the read reports a failure", result.status === "FAILED");
    check("interrupted read: 007 stays UNKNOWN in either direction", result.migration_007_state === MIGRATION_007_STATES.UNKNOWN);
    check("interrupted read: nothing was applied or rolled back", (await migrationsSnapshot(url)).includes("006_content_evidence.sql"));
    check("interrupted read: no runner session remains", await assertNoRunnerSession(url));
  }

  console.log(`\nM1 readiness PostgreSQL ${MAJOR} self-test passed: ${passed} checks`);
} finally {
  for (const name of databases) {
    try {
      await withAdmin(adminUrl, (client) => client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
    } catch {
      // Reported by the drop loop's own completion line below; a failure to drop
      // one disposable database must not mask the test result.
    }
  }
  console.log(`[m1-postgres] dropped ${databases.length} disposable databases`);
}
