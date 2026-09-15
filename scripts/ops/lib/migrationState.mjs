/**
 * §4.4.2 migration-state core logic, as exported functions.
 *
 * Extracted from `scripts/ops/migration-state-read.mjs` so the same computation
 * serves that operator CLI and the M1 readiness runner. Nothing here reads
 * argv, the environment, a clock or a database: the caller supplies `F(A)` and
 * the applied identifiers, and every field of the result is recomputed from
 * those two inputs alone.
 *
 * Identity here means the COMPLETE FILENAME. A numeric prefix is not an
 * identity: `007_something_else.sql` is a different file with different SQL, and
 * neither is surrounding whitespace ignorable — `src/state/migrate.ts` applies
 * exactly the entries whose real name ends in `.sql`, so filenames are compared
 * byte for byte and never trimmed.
 *
 * Comparing the pending set alone is NOT sufficient: an unexpected migration
 * that is already applied appears in both `F(A)` and `D`, cancels out of `P`,
 * and is invisible to the pending difference. That is precisely why `D` is
 * validated in its own right against `E_applied_pre`.
 */

/**
 * The COMPLETE CANONICAL FILENAMES, in canonical order, never numeric prefixes.
 * `_migrations` stores the filename, and the general migration runner applies
 * whatever file is present — so an identifier reduced to its leading digits is
 * not an identity.
 */
export const CANONICAL_MIGRATIONS = Object.freeze([
  "001_init.sql",
  "002_brief_and_approval.sql",
  "003_media.sql",
  "004_events.sql",
  "005_approval_integrity.sql",
  "006_content_evidence.sql",
  "007_evidence_bounds.sql",
]);

/** The migration whose production state M1 turns on. */
export const MIGRATION_007 = "007_evidence_bounds.sql";

/** @param {number} n */
const through = (n) => CANONICAL_MIGRATIONS.slice(0, n);

/** The four expected sets, per §4.4.2's contract table. */
export const MILESTONES = Object.freeze({
  M1: Object.freeze({
    /** E_files: exactly 001-007 by filename, and no later migration. */
    files: Object.freeze(through(7)),
    /** E_applied_pre: exactly the authorized baseline 001-006, by filename. */
    applied_pre: Object.freeze(through(6)),
    /** E_pending: exactly {007_evidence_bounds.sql}. */
    pending: Object.freeze([MIGRATION_007]),
    /** E_applied_post: exactly 001-007, by filename. */
    applied_post: Object.freeze(through(7)),
  }),
});

/** The single fixed, read-only, identifiers-only statement. */
export const MIGRATION_STATE_SQL = "SELECT name FROM _migrations ORDER BY name";

/** The seven comparison keys, in the order §4.4.2 states them. */
export const COMPARISON_KEYS = Object.freeze([
  "1_F(A)==E_files",
  "2_D==E_applied_pre",
  "3_P==E_pending",
  "4_every_D_present_in_F(A)",
  "5_no_expected_applied_absent_from_D",
  "6_no_unexpected_applied_in_D",
  "7_no_duplicate_identifier",
]);

/** Migration 007's production state is a three-valued fact, never a default. */
export const MIGRATION_007_STATES = Object.freeze({
  APPLIED: "APPLIED",
  NOT_APPLIED: "NOT APPLIED",
  UNKNOWN: "UNKNOWN in either direction",
});

/** @param {readonly string[]} a @param {readonly string[]} b */
export const setEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Split raw `state/migrations/` entry names into the set the runner would apply
 * and the set it would silently skip.
 *
 * Entries whose real name does not end in `.sql` are excluded from `F(A)` — the
 * same rule `src/state/migrate.ts` applies — and returned separately so an
 * operator can see why `F(A)` is short instead of reading an unexplained
 * mismatch. Names are never trimmed: `007_evidence_bounds.sql ` (trailing
 * space) is a DIFFERENT file that the runner skips, and trimming it here would
 * authorize a deployment in which migration 007 is never applied.
 *
 * @param {readonly string[]} entries basenames, byte-exact
 */
export const splitMigrationEntries = (entries) => ({
  sql: entries.filter((f) => f.endsWith(".sql")).sort(),
  nonSql: entries.filter((f) => !f.endsWith(".sql")).sort(),
});

/**
 * The complete artifact migration inventory, independently recomputed.
 *
 * @param {readonly string[]} entries raw basenames at the artifact commit
 */
export const computeArtifactInventory = (entries) => {
  const { sql, nonSql } = splitMigrationEntries(entries);
  const distinct = new Set(sql);
  return {
    entry_count: entries.length,
    files: sql,
    file_count: sql.length,
    distinct_file_count: distinct.size,
    unique: distinct.size === sql.length,
    /** `sql` is sorted above, so this states whether the sorted set IS canonical. */
    canonically_ordered: setEq(sql, sql.slice().sort()),
    matches_canonical_sequence: setEq(sql, CANONICAL_MIGRATIONS.slice(0, sql.length)),
    non_sql_entries_excluded: nonSql,
  };
};

/**
 * The applied set `D`, independently recomputed from the returned rows.
 *
 * Row count and distinct-identifier count are derived here rather than by a
 * window function: PostgreSQL does not implement DISTINCT inside a window
 * function, so `count(DISTINCT name) OVER ()` raises rather than returning a
 * value.
 *
 * @param {readonly string[]} names identifiers exactly as returned, in order
 */
export const computeAppliedInventory = (names) => {
  const sorted = names.slice().sort();
  const distinct = new Set(names);
  return {
    identifiers: sorted,
    row_count: names.length,
    distinct_identifier_count: distinct.size,
    unique: distinct.size === names.length,
    /** Whether the server honoured `ORDER BY name`; recomputed, not assumed. */
    returned_in_canonical_order: setEq(names, sorted),
  };
};

/**
 * Migration 007's production state, derived ONLY from a completed read.
 *
 * When `D` was not read, the answer is `UNKNOWN in either direction`. It is
 * never inferred from `main`, from `render.yaml`, from any dated record in this
 * repository, or from a previous milestone's record.
 *
 * @param {{ read: boolean, identifiers?: readonly string[] }} applied
 */
export const computeMigration007State = (applied) => {
  if (!applied.read || !applied.identifiers) return MIGRATION_007_STATES.UNKNOWN;
  return applied.identifiers.includes(MIGRATION_007)
    ? MIGRATION_007_STATES.APPLIED
    : MIGRATION_007_STATES.NOT_APPLIED;
};

/**
 * The complete §4.4.2 evaluation: inventory, pending set, all seven
 * comparisons, the failed set, the decision, and migration 007's state.
 *
 * @param {object} input
 * @param {string} input.milestone
 * @param {readonly string[]} input.artifactEntries raw basenames at `A`
 * @param {readonly string[] | null} input.appliedNames `D` as returned, or
 *   `null` when no database read was performed
 */
export const computeMigrationState = ({ milestone, artifactEntries, appliedNames }) => {
  const expected = MILESTONES[milestone];
  if (!expected) throw new Error(`unknown milestone ${milestone}`);

  const artifact = computeArtifactInventory(artifactEntries);
  const fFiles = artifact.files;
  const expectedSets = {
    E_files: [...expected.files],
    E_applied_pre: [...expected.applied_pre],
    E_pending: [...expected.pending],
    E_applied_post: [...expected.applied_post],
  };

  if (appliedNames === null) {
    return {
      milestone,
      artifact_inventory: artifact,
      expected: expectedSets,
      applied: { read: false },
      pending: null,
      comparisons: null,
      comparison_detail: null,
      failed_comparisons: null,
      decision: "INCOMPLETE — D not read",
      migration_007_state: MIGRATION_007_STATES.UNKNOWN,
    };
  }

  const applied = { read: true, ...computeAppliedInventory(appliedNames) };
  const dFiles = applied.identifiers;
  const pFiles = fFiles.filter((f) => !dFiles.includes(f));

  const appliedNotInArtifact = dFiles.filter((f) => !fFiles.includes(f));
  const expectedAppliedMissing = expectedSets.E_applied_pre.filter((f) => !dFiles.includes(f));
  const unexpectedApplied = dFiles.filter((f) => !expectedSets.E_applied_pre.includes(f));

  const comparisons = {
    "1_F(A)==E_files": setEq(fFiles, expectedSets.E_files),
    "2_D==E_applied_pre": setEq(dFiles, expectedSets.E_applied_pre),
    "3_P==E_pending": setEq(pFiles, expectedSets.E_pending),
    "4_every_D_present_in_F(A)": appliedNotInArtifact.length === 0,
    "5_no_expected_applied_absent_from_D": expectedAppliedMissing.length === 0,
    "6_no_unexpected_applied_in_D": unexpectedApplied.length === 0,
    "7_no_duplicate_identifier": applied.row_count === applied.distinct_identifier_count,
  };
  // A missing or extra key would silently weaken the gate, so the shape of the
  // comparison set is itself checked rather than trusted.
  if (!setEq(Object.keys(comparisons), [...COMPARISON_KEYS])) {
    throw new Error("comparison set does not match the seven §4.4.2 comparisons");
  }

  const failed = COMPARISON_KEYS.filter((key) => !comparisons[key]);
  return {
    milestone,
    artifact_inventory: artifact,
    expected: expectedSets,
    applied,
    pending: pFiles,
    comparisons,
    comparison_detail: {
      applied_but_absent_from_artifact: appliedNotInArtifact,
      expected_applied_missing_from_D: expectedAppliedMissing,
      unexpected_applied_in_D: unexpectedApplied,
    },
    failed_comparisons: failed,
    decision: failed.length === 0 ? "pass" : "stop",
    migration_007_state: computeMigration007State(applied),
  };
};
