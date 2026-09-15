#!/usr/bin/env node
/**
 * §4.4.2 deployment preflight — the COMPLETE migration-state reading.
 *
 * REQUIRES OPERATOR ACTION. Run by an authorized operator, never from an agent
 * session, immediately before the deployment is triggered. A reading taken
 * earlier is not a reading (§4.4.1).
 *
 * This file is a THIN CLI WRAPPER. The canonical sets, the SQL, the seven
 * comparisons and the decision live in `scripts/ops/lib/migrationState.mjs`, and
 * the failure sanitizer in `scripts/ops/lib/errorCategories.mjs`, so this tool
 * and `scripts/ops/m1-readiness/` cannot drift into two different answers. What
 * remains here is argument handling, the git reads that produce `F(A)`, and
 * printing.
 *
 * Computes and records, for a named milestone:
 *
 *   F(A) := the *.sql file names in state/migrations/ at artifact commit A
 *   D    := SELECT name FROM _migrations ORDER BY name   (read-only)
 *   P    := F(A) − D
 *
 * and evaluates ALL SEVEN comparisons of §4.4.2 individually. Comparing the
 * pending set alone is NOT sufficient: an unexpected migration that is already
 * applied appears in both F(A) and D, cancels out of P, and is invisible to
 * the pending difference. That is precisely why D is validated in its own
 * right against E_applied_pre.
 *
 * Usage (operator machine, read-only role strongly preferred):
 *
 *   export GCD_AUDIT_DATABASE_URL='postgres://READONLY_USER@host:5432/dbname'
 *   node scripts/ops/migration-state-read.mjs --milestone M1 --artifact <full-sha>
 *
 * `--offline` computes and prints F(A) and the expected sets without touching
 * any database, so the artifact half can be verified with no credential at all.
 *
 * The variable is deliberately NOT `DATABASE_URL`. Never paste a production
 * credential into chat, into a pull request, or into source control.
 *
 * Safety: read-only session, read-only transaction, a single fixed query
 * against `_migrations`. Identifiers only — `_migrations` has no checksum or
 * content column, so this establishes IDENTITY, never content integrity.
 *
 * Identity here means the COMPLETE FILENAME. A numeric prefix is not an
 * identity: `007_something_else.sql` is a different file with different SQL, and
 * neither is surrounding whitespace ignorable — the runner applies exactly the
 * entries whose real name ends in `.sql`, so filenames are compared byte for
 * byte and never trimmed. `--artifact` must name a COMMIT object, not merely 40
 * hex characters. On failure only a fixed category chosen in
 * `scripts/ops/lib/errorCategories.mjs` is printed — never the driver's message,
 * which routinely names the database user and the host:port, and never its
 * SQLSTATE, which the server chooses.
 */

import { execFileSync } from "node:child_process";
import pg from "pg";
import { sanitizedFailure } from "./lib/errorCategories.mjs";
import {
  MIGRATION_STATE_SQL,
  MILESTONES,
  computeMigrationState,
} from "./lib/migrationState.mjs";

const parseArgs = () => {
  const argv = process.argv.slice(2);
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    milestone: get("--milestone") ?? "M1",
    artifact: get("--artifact"),
    offline: argv.includes("--offline"),
  };
};

/**
 * Reject anything that is not a COMMIT object.
 *
 * `git ls-tree` happily enumerates a TREE sha, so a 40-hex check alone lets a
 * tree, blob or annotated-tag object be recorded as the deployed artifact. Such
 * an object has no commit ancestry, cannot have an exact-head CI run, and is not
 * a reviewable or deployable identity — all of which requirement A1 (§4.4)
 * depends on. Verified with `git cat-file -t`, which returns the object's true
 * type, before any enumeration happens.
 */
const assertCommitObject = (sha) => {
  let type;
  try {
    type = execFileSync("git", ["cat-file", "-t", sha], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    console.error(
      `--artifact ${sha} is not an object in this repository.\n` +
        "Requirement A1 (§4.4) needs the full SHA of a commit that exists here.",
    );
    process.exit(2);
  }
  if (type !== "commit") {
    console.error(
      `--artifact must name a COMMIT object; git reports its type as "${type}".\n` +
        "A tree, blob or annotated-tag SHA is rejected by requirement A1 (§4.4):\n" +
        "the artifact must have commit ancestry, an exact-head CI run, and a\n" +
        "reviewable, deployable commit identity.",
    );
    process.exit(2);
  }
};

/**
 * Migration entry names present in the artifact commit, from git alone.
 *
 * NUL-delimited and never trimmed, because a filename's surrounding whitespace
 * is part of its identity. `src/state/migrate.ts` applies exactly the entries
 * whose REAL name ends in `.sql`, so a file named `007_evidence_bounds.sql `
 * (trailing space) is silently skipped by the runner. Trimming here would make
 * that file read as the canonical `007_evidence_bounds.sql`, and the preflight
 * would authorize a deployment in which migration 007 is never applied.
 *
 * `git ls-tree --name-only` also QUOTES a path containing unusual characters,
 * which would corrupt the name before it is ever compared. `-z` emits raw bytes
 * with no quoting and no escaping, so what is compared is what is on disk.
 *
 * Splitting `.sql` from non-`.sql` is `splitMigrationEntries` in the shared
 * module; this returns the raw entry names it consumes.
 */
const entriesAtArtifact = (sha) =>
  execFileSync("git", ["ls-tree", "-z", "--name-only", `${sha}`, "state/migrations/"], {
    encoding: "utf8",
  })
    .split("\0")
    .filter((l) => l.length > 0)
    .map((l) => l.slice(l.lastIndexOf("/") + 1));

const main = async () => {
  const { milestone, artifact, offline } = parseArgs();
  if (!MILESTONES[milestone]) {
    console.error(`unknown milestone ${milestone}; known: ${Object.keys(MILESTONES).join(", ")}`);
    process.exit(2);
  }
  if (!artifact || !/^[0-9a-f]{40}$/.test(artifact)) {
    console.error(
      "--artifact must be a full 40-character commit SHA.\n" +
        "A branch name or tag is explicitly rejected by requirement A1 (§4.4).",
    );
    process.exit(2);
  }
  assertCommitObject(artifact);

  const artifactEntries = entriesAtArtifact(artifact);

  // --- the artifact half, no database required -----------------------------
  const record = {
    milestone,
    read_at: new Date().toISOString(),
    artifact_sha: artifact,
    read_only: true,
  };

  if (offline) {
    const state = computeMigrationState({ milestone, artifactEntries, appliedNames: null });
    record["F(A)"] = state.artifact_inventory.files;
    if (state.artifact_inventory.non_sql_entries_excluded.length > 0) {
      // Not a decision input: the mismatch it causes is caught by comparison 1.
      // Recorded because a name that only LOOKS canonical is the whole hazard.
      record.non_sql_entries_excluded = state.artifact_inventory.non_sql_entries_excluded;
    }
    record.expected = state.expected;
    record.comparisons = {
      "1_F(A)==E_files":
        state.artifact_inventory.files.length === state.expected.E_files.length &&
        state.artifact_inventory.files.every((f, i) => f === state.expected.E_files[i]),
    };
    record.migration_007_state = state.migration_007_state;
    record.note =
      "OFFLINE: no database was contacted. D, P and comparisons 2-7 are NOT YET EXECUTED " +
      "and must be completed by an authorized operator immediately before the deployment.";
    record.decision = "INCOMPLETE — offline run, D not read";
    console.log(JSON.stringify(record, null, 2));
    process.exit(0);
  }

  const url = process.env.GCD_AUDIT_DATABASE_URL;
  if (!url) {
    console.error(
      "GCD_AUDIT_DATABASE_URL is not set.\n" +
        "Set it, in the operator's own shell, to a READ-ONLY production connection string,\n" +
        "or pass --offline to compute the artifact half only.\n" +
        "Never paste a production credential into chat, a pull request, or source control.",
    );
    process.exit(2);
  }

  // --- D, read-only, identifiers only --------------------------------------
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 15_000 });
  const client = await pool.connect();
  let dRows;
  try {
    await client.query("SET default_transaction_read_only = on");
    await client.query("BEGIN TRANSACTION READ ONLY");
    dRows = (await client.query(MIGRATION_STATE_SQL)).rows;
    await client.query("ROLLBACK");
  } finally {
    client.release();
    await pool.end();
  }

  const state = computeMigrationState({
    milestone,
    artifactEntries,
    appliedNames: dRows.map((r) => r.name),
  });

  record["F(A)"] = state.artifact_inventory.files;
  if (state.artifact_inventory.non_sql_entries_excluded.length > 0) {
    record.non_sql_entries_excluded = state.artifact_inventory.non_sql_entries_excluded;
  }
  record.expected = state.expected;
  record.D = state.applied.identifiers;
  record.D_row_count = state.applied.row_count;
  record.D_distinct_identifier_count = state.applied.distinct_identifier_count;
  record.P = state.pending;
  record.comparisons = state.comparisons;
  record.comparison_detail = state.comparison_detail;
  record.decision = state.decision;
  record.failed_comparisons = state.failed_comparisons;
  record.migration_007_state = state.migration_007_state;
  record.note =
    "Identifiers only. `_migrations` stores no checksum or content column, so this " +
    "establishes migration IDENTITY and is NOT a content-integrity guarantee. " +
    "`stop` means the deployment is not triggered.";

  console.log(JSON.stringify(record, null, 2));
  process.exit(state.failed_comparisons.length === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(sanitizedFailure("migration-state read", error));
  process.exit(1);
});
