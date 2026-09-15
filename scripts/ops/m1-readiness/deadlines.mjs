/**
 * Every deadline the M1 readiness runner observes, fixed in source.
 *
 * These are the ONLY deadlines in the runner, and they are not configurable.
 * This module deliberately does not read `process.env`, `process.argv`, any
 * file, or any clock: an operator who wants a different deadline changes this
 * file, in a reviewed commit, and the diff says so. An environment variable
 * cannot extend, shorten or disable any value below.
 *
 * `scripts/ops/m1-readiness/offline.selftest.mjs` asserts both the exact values
 * and the absence of any environment read in this file, so a later "just make it
 * configurable for CI" edit fails the suite rather than shipping.
 *
 * Relationship between the values:
 *
 *   - a single statement (STATEMENT_MS) must be able to run to completion
 *     inside the phase total that contains it;
 *   - LOCK_MS is deliberately well under STATEMENT_MS, so a statement blocked
 *     behind an exclusive lock is refused by PostgreSQL's own `lock_timeout`
 *     (SQLSTATE 55P03) rather than by our slower outer guard — the failure is
 *     then attributable, sanitized and fast;
 *   - IDLE_IN_TRANSACTION_MS bounds the read-only transaction itself, so a
 *     wedged client cannot hold a production snapshot open;
 *   - TOTAL_MS is larger than the sum of the phases the runner can actually
 *     reach, so it is a true backstop rather than the effective limit.
 */

/** Every GitHub API operation, individually. */
export const GITHUB_REQUEST_MS = 20_000;

/** Total for the CI-evidence phase, across all of its GitHub operations. */
export const GITHUB_PHASE_TOTAL_MS = 60_000;

/** Establishing a database connection, including TLS. */
export const DATABASE_CONNECT_MS = 10_000;

/** `lock_timeout`: how long any statement may wait for a lock before refusing. */
export const DATABASE_LOCK_MS = 5_000;

/** `statement_timeout`: how long any single statement may run. */
export const DATABASE_STATEMENT_MS = 15_000;

/** `idle_in_transaction_session_timeout`: how long the read-only transaction may idle. */
export const DATABASE_IDLE_IN_TRANSACTION_MS = 20_000;

/** Total for the complete migration-state read, connection included. */
export const MIGRATION_STATE_TOTAL_MS = 45_000;

/** Total for the complete aggregate audit, connection included. */
export const AGGREGATE_AUDIT_TOTAL_MS = 60_000;

/** Any single read-only git invocation. */
export const GIT_COMMAND_MS = 15_000;

/** Total for the repository-precondition phase. */
export const REPOSITORY_PHASE_TOTAL_MS = 60_000;

/** The whole runner, from entry to evidence written. */
export const RUNNER_TOTAL_MS = 240_000;

/**
 * How long a child process is given to exit after its deadline or an operator
 * interrupt has caused a SIGTERM, before SIGKILL. The runner awaits the child
 * either way, so this bounds the wait, not the guarantee.
 */
export const CHILD_TERMINATION_GRACE_MS = 2_000;

/** Every deadline, as one frozen record, for the evidence file and the tests. */
export const DEADLINES_MS = Object.freeze({
  github_request: GITHUB_REQUEST_MS,
  github_phase_total: GITHUB_PHASE_TOTAL_MS,
  database_connect: DATABASE_CONNECT_MS,
  database_lock: DATABASE_LOCK_MS,
  database_statement: DATABASE_STATEMENT_MS,
  database_idle_in_transaction: DATABASE_IDLE_IN_TRANSACTION_MS,
  migration_state_total: MIGRATION_STATE_TOTAL_MS,
  aggregate_audit_total: AGGREGATE_AUDIT_TOTAL_MS,
  git_command: GIT_COMMAND_MS,
  repository_phase_total: REPOSITORY_PHASE_TOTAL_MS,
  runner_total: RUNNER_TOTAL_MS,
  child_termination_grace: CHILD_TERMINATION_GRACE_MS,
});
