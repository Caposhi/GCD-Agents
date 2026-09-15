/**
 * The runner's database boundary: two read-only, aggregate-only reads.
 *
 * Both reuse the repository's existing logic rather than re-implementing or, worse,
 * parsing the operator CLIs' terminal prose — `scripts/ops/lib/migrationState.mjs`
 * and `scripts/ops/lib/aggregateAudit.mjs` hold the computation, the SQL and the
 * bounds, and the two operator CLIs are thin wrappers over the same modules.
 *
 * Safety properties, all enforced here rather than merely documented:
 *
 *   - `statement_timeout`, `lock_timeout` and `idle_in_transaction_session_timeout`
 *     are sent as STARTUP parameters, so they bind the very first statement rather
 *     than a later `SET` that a failure might never reach. They are re-applied as
 *     explicit `SET`s (a connection pooler can refuse startup options) and then
 *     VERIFIED with `SHOW`, so the evidence records what the server actually
 *     enforced rather than what was requested.
 *   - the session is `default_transaction_read_only`, and every statement runs
 *     inside `BEGIN TRANSACTION READ ONLY`, verified with
 *     `SHOW transaction_read_only`.
 *   - the query set is fixed; nothing is interpolated from argv or the
 *     environment. No migration is applied and none is rolled back: the only DDL
 *     verb that appears anywhere here is `ROLLBACK`, which ends the read.
 *   - it returns COUNTS, EXISTENCE, MAXIMA and migration IDENTIFIERS only. It
 *     never selects claim text, subject text, any other row content, PII, or a
 *     credential value.
 *   - no connection string, user, host, port or password is printed or returned,
 *     on any path. A failure yields one fixed category chosen in
 *     `scripts/ops/lib/errorCategories.mjs`.
 *   - a statement blocked behind an exclusive lock is refused by the server's own
 *     `lock_timeout` well inside the phase deadline, and surfaces as the fixed
 *     category `lock_not_available`.
 *   - on an operator interrupt or a deadline, the socket is destroyed and awaited,
 *     so no database session is left open by this runner.
 */

import { once } from "node:events";
import pg from "pg";
import { categorizeError } from "../lib/errorCategories.mjs";
import {
  BOUNDS_SOURCE,
  EVIDENCE_AGGREGATES_SQL,
  RELATION_AGGREGATES_SQL,
  REQUIRED_TABLES,
  TABLE_EXISTENCE_SQL,
  TAG_AGGREGATES_SQL,
  assertDistinctColumns,
  evaluateAggregateAudit,
  readEvidenceLimits,
} from "../lib/aggregateAudit.mjs";
import { MIGRATION_STATE_SQL, computeMigrationState } from "../lib/migrationState.mjs";
import {
  AGGREGATE_AUDIT_TOTAL_MS,
  CHILD_TERMINATION_GRACE_MS,
  DATABASE_CONNECT_MS,
  DATABASE_IDLE_IN_TRANSACTION_MS,
  DATABASE_LOCK_MS,
  DATABASE_STATEMENT_MS,
  MIGRATION_STATE_TOTAL_MS,
} from "./deadlines.mjs";
import { settleWithin, withDeadline } from "./runtime.mjs";

/** The environment variable an operator sets. Deliberately NOT `DATABASE_URL`. */
export const CONNECTION_ENV = "GCD_AUDIT_DATABASE_URL";

/** Applied at startup AND verified afterwards. */
const STARTUP_OPTIONS = "-c default_transaction_read_only=on";

/** @param {string} connectionString */
const newClient = (connectionString) =>
  new pg.Client({
    connectionString,
    connectionTimeoutMillis: DATABASE_CONNECT_MS,
    statement_timeout: DATABASE_STATEMENT_MS,
    lock_timeout: DATABASE_LOCK_MS,
    idle_in_transaction_session_timeout: DATABASE_IDLE_IN_TRANSACTION_MS,
    // A client-side backstop under the server's own statement_timeout is
    // deliberately NOT set: it would mask which side enforced the bound, and the
    // phase deadline in `runtime.mjs` already bounds the wait.
    options: STARTUP_OPTIONS,
    application_name: "gcd-m1-readiness-runner",
  });

/**
 * Open a read-only session, prove it is read-only and time-bounded, run `fn`,
 * and tear the connection down whatever happens.
 *
 * The client is created OUTSIDE the deadline scope on purpose: when the
 * deadline or an operator interrupt wins, `withDeadline` calls `onCancel`, and
 * `onCancel` has to be able to reach this exact socket in order to destroy it.
 * A deadline that could not reach the connection would leave a production
 * backend running a query nobody is waiting for.
 *
 * `teardown` does not return until the socket's `close` event has fired or the
 * socket reports itself destroyed, so "the session is closed" is confirmed
 * rather than assumed. That confirmation is recorded on the returned record.
 *
 * `totalMs` is a parameter rather than a constant read here so the disposable
 * PostgreSQL suite can drive the real timeout path against a real lock wait.
 * Both production call sites pass the fixed constants from `deadlines.mjs`, and
 * the offline suite asserts that from source.
 *
 * @template T
 * @param {object} input
 * @param {string} input.connectionString
 * @param {import("./runtime.mjs").Runtime} input.runtime
 * @param {string} input.label
 * @param {number} input.totalMs
 * @param {(client: pg.Client) => Promise<T>} fn
 */
export const withReadOnlySession = async ({ connectionString, runtime, label, totalMs }, fn) => {
  const client = newClient(connectionString);
  let torn = false;
  let sessionClosed = false;

  const teardown = async () => {
    if (torn) return;
    torn = true;
    const stream = client.connection?.stream;
    // Subscribed BEFORE anything is destroyed, so the confirmation cannot be
    // missed by racing the close.
    const closed =
      stream && !stream.destroyed
        ? once(stream, "close").then(
            () => undefined,
            () => undefined,
          )
        : Promise.resolve();
    // `end()` is the graceful path and is given a bounded grace period; the
    // socket is then destroyed unconditionally, which is what actually ends the
    // server-side session when a statement is still in flight.
    await settleWithin(
      Promise.resolve()
        .then(() => client.end())
        .then(
          () => undefined,
          () => undefined,
        ),
      CHILD_TERMINATION_GRACE_MS,
    );
    try {
      stream?.destroy();
    } catch {
      /* already closed */
    }
    await settleWithin(closed, CHILD_TERMINATION_GRACE_MS);
    sessionClosed = stream ? stream.destroyed : true;
  };

  const unregister = runtime.registerCleanup(teardown);
  /** @type {unknown} */
  let failure = null;
  /** @type {any} */
  let outcome = null;
  try {
    outcome = await withDeadline(
      runtime,
      label,
      totalMs,
      async () => {
        await client.connect();

        // Belt and braces: a connection pooler may refuse startup options, so the
        // same settings are applied explicitly before any read.
        await client.query(`SET statement_timeout = ${DATABASE_STATEMENT_MS}`);
        await client.query(`SET lock_timeout = ${DATABASE_LOCK_MS}`);
        await client.query(
          `SET idle_in_transaction_session_timeout = ${DATABASE_IDLE_IN_TRANSACTION_MS}`,
        );
        await client.query("SET default_transaction_read_only = on");
        await client.query("BEGIN TRANSACTION READ ONLY");

        const enforced = {
          transaction_read_only: (await client.query("SHOW transaction_read_only")).rows[0]
            ?.transaction_read_only,
          statement_timeout: (await client.query("SHOW statement_timeout")).rows[0]
            ?.statement_timeout,
          lock_timeout: (await client.query("SHOW lock_timeout")).rows[0]?.lock_timeout,
          idle_in_transaction_session_timeout: (
            await client.query("SHOW idle_in_transaction_session_timeout")
          ).rows[0]?.idle_in_transaction_session_timeout,
        };
        if (enforced.transaction_read_only !== "on") {
          throw new Error("the server did not enforce a read-only transaction");
        }

        const result = await fn(client);
        await client.query("ROLLBACK");
        return { value: result, enforced };
      },
      // The deadline reaches the socket, and does not return until the session
      // is confirmed closed.
      { onCancel: teardown },
    );
  } catch (error) {
    failure = error;
  } finally {
    unregister();
    await teardown();
  }

  // Teardown has completed before anything is returned or rethrown, so the
  // caller never sees a result while a session this call opened is still open.
  if (failure) throw failure;
  if (!sessionClosed) {
    // Never swallowed: the runner's claim is that it leaves no open database
    // session, so a teardown that could not confirm closure fails the read.
    throw new Error("the database session could not be confirmed closed");
  }
  return outcome;
};

/**
 * A failure record that cannot leak connection identity.
 *
 * @param {unknown} error
 */
const sanitizedResult = (error) => ({
  status: "FAILED",
  error_category: categorizeError(error),
  note:
    "The driver's own message and code are withheld: both can be chosen by the database, " +
    "and the message can contain the database user, host or port.",
});

/**
 * The complete §4.4.2 migration-state read, bound to one artifact.
 *
 * @param {object} input
 * @param {string} input.connectionString
 * @param {string} input.milestone
 * @param {readonly string[]} input.artifactEntries `state/migrations/` entries at `A`
 * @param {import("./runtime.mjs").Runtime} input.runtime
 */
export const readMigrationState = async ({
  connectionString,
  milestone,
  artifactEntries,
  runtime,
}) => {
  try {
    const { value, enforced } = await withReadOnlySession(
      {
        connectionString,
        runtime,
        label: "migration-state read",
        totalMs: MIGRATION_STATE_TOTAL_MS,
      },
      async (client) => (await client.query(MIGRATION_STATE_SQL)).rows.map((row) => row.name),
    );
    // Identifiers are required to be strings before anything compares them: a
    // non-text column would otherwise compare unequal to every expected name and
    // read as an unexpected migration rather than as a schema fault.
    if (!value.every((name) => typeof name === "string")) {
      throw new Error("_migrations.name did not return text identifiers");
    }
    return {
      status: "READ",
      session: enforced,
      statement: MIGRATION_STATE_SQL.trim(),
      ...computeMigrationState({ milestone, artifactEntries, appliedNames: value }),
      note:
        "Identifiers only. `_migrations` stores no checksum or content column, so this " +
        "establishes migration IDENTITY and is NOT a content-integrity guarantee.",
    };
  } catch (error) {
    return {
      ...sanitizedResult(error),
      ...computeMigrationState({ milestone, artifactEntries, appliedNames: null }),
    };
  }
};

/**
 * The §4.1 fresh, read-only, aggregate-only evidence audit.
 *
 * @param {object} input
 * @param {string} input.connectionString
 * @param {string} input.repoRoot
 * @param {import("./runtime.mjs").Runtime} input.runtime
 */
export const runAggregateAudit = async ({ connectionString, repoRoot, runtime }) => {
  const limits = readEvidenceLimits(repoRoot);
  try {
    const { value, enforced } = await withReadOnlySession(
      {
        connectionString,
        runtime,
        label: "aggregate audit",
        totalMs: AGGREGATE_AUDIT_TOTAL_MS,
      },
      async (client) => {
        const tables = (await client.query(TABLE_EXISTENCE_SQL)).rows.map((r) => r.table_name);
        const missing = REQUIRED_TABLES.filter((t) => !tables.includes(t));
        if (missing.length > 0) return { tables, missing };
        // `pg` collapses two columns of the same name into one row property, so
        // a duplicate is only visible in the result's field list.
        const read = async (sql, label) => {
          const result = await client.query(sql);
          assertDistinctColumns(result.fields, label);
          return result.rows[0];
        };
        return {
          tables,
          missing,
          evidence: await read(EVIDENCE_AGGREGATES_SQL, "content_evidence aggregates"),
          tags: await read(TAG_AGGREGATES_SQL, "content_evidence tag aggregates"),
          relations: await read(RELATION_AGGREGATES_SQL, "content_evidence_relations aggregates"),
        };
      },
    );
    if (value.missing.length > 0) {
      return {
        status: "INCOMPLETE",
        session: enforced,
        tables_present: value.tables,
        missing_tables: value.missing,
        verdict: "NOT ESTABLISHED",
        bounds_source: BOUNDS_SOURCE,
      };
    }
    return {
      status: "AUDITED",
      session: enforced,
      tables_present: value.tables,
      missing_tables: [],
      ...evaluateAggregateAudit({
        evidence: value.evidence,
        tags: value.tags,
        relations: value.relations,
        limits,
      }),
      note:
        "Aggregate-only. No claim text, subject text, other row content, PII, or credential " +
        "value was selected. This answers only whether 007's immediately validated constraints " +
        "can pass against stored data; it authorizes nothing by itself.",
    };
  } catch (error) {
    return { ...sanitizedResult(error), verdict: "NOT ESTABLISHED", bounds_source: BOUNDS_SOURCE };
  }
};
