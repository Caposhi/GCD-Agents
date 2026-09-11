#!/usr/bin/env node
/**
 * §4.4.2 deployment preflight — the COMPLETE migration-state reading.
 *
 * REQUIRES OPERATOR ACTION. Run by an authorized operator, never from an agent
 * session, immediately before the deployment is triggered. A reading taken
 * earlier is not a reading (§4.4.1).
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
 */

import { execFileSync } from "node:child_process";
import pg from "pg";

// --- the four expected sets, per §4.4.2's contract table -------------------
const M = (n) => `${String(n).padStart(3, "0")}`;
const THROUGH = (n) => Array.from({ length: n }, (_, i) => M(i + 1));

const MILESTONES = {
  M1: {
    // E_files: 001–007 and no later migration.
    files: THROUGH(7),
    // E_applied_pre: exactly the authorized baseline 001–006.
    applied_pre: THROUGH(6),
    // E_pending: exactly {007_evidence_bounds.sql}.
    pending: ["007"],
    // E_applied_post: exactly 001–007.
    applied_post: THROUGH(7),
  },
};

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

/** Migration filenames present in the artifact commit, from git alone. */
const filesAtArtifact = (sha) => {
  const out = execFileSync(
    "git",
    ["ls-tree", "--name-only", `${sha}`, "state/migrations/"],
    { encoding: "utf8" },
  );
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(".sql"))
    .map((l) => l.replace(/^.*\//, ""))
    .sort();
};

/** The leading numeric identifier of a migration filename, e.g. 007. */
const idOf = (filename) => {
  const m = /^(\d+)/.exec(filename);
  return m ? m[1] : filename;
};

const setEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const main = async () => {
  const { milestone, artifact, offline } = parseArgs();
  const expected = MILESTONES[milestone];
  if (!expected) {
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

  const record = {
    milestone,
    read_at: new Date().toISOString(),
    artifact_sha: artifact,
    read_only: true,
  };

  // --- F(A), from the artifact, no database required ----------------------
  const fFiles = filesAtArtifact(artifact);
  const fIds = fFiles.map(idOf);
  record["F(A)"] = fFiles;
  record["F(A)_ids"] = fIds;
  record.expected = {
    E_files: expected.files,
    E_applied_pre: expected.applied_pre,
    E_pending: expected.pending,
    E_applied_post: expected.applied_post,
  };

  if (offline) {
    record.comparisons = {
      "1_F(A)==E_files": setEq(fIds, expected.files),
    };
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

  // --- D, read-only, identifiers only -------------------------------------
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 15_000 });
  const client = await pool.connect();
  let dRows;
  try {
    await client.query("SET default_transaction_read_only = on");
    await client.query("BEGIN TRANSACTION READ ONLY");
    // Identifiers only. Row count and distinct-identifier count are derived in
    // JS rather than by window functions: PostgreSQL does not implement
    // DISTINCT inside a window function, so `count(DISTINCT name) OVER ()`
    // raises rather than returning a value.
    dRows = (await client.query("SELECT name FROM _migrations ORDER BY name")).rows;
    await client.query("ROLLBACK");
  } finally {
    client.release();
    await pool.end();
  }

  const dFiles = dRows.map((r) => r.name).sort();
  const dIds = dFiles.map(idOf);
  record.D = dFiles;
  record.D_ids = dIds;
  record.D_row_count = dRows.length;
  record.D_distinct_identifier_count = new Set(dFiles).size;

  // --- P = F(A) − D --------------------------------------------------------
  const pFiles = fFiles.filter((f) => !dFiles.includes(f));
  record.P = pFiles;
  record.P_ids = pFiles.map(idOf);

  // --- all seven comparisons, each stated individually ---------------------
  const appliedNotInArtifact = dFiles.filter((f) => !fFiles.includes(f));
  const expectedAppliedMissing = expected.applied_pre.filter((id) => !dIds.includes(id));
  const unexpectedApplied = dIds.filter((id) => !expected.applied_pre.includes(id));

  const comparisons = {
    "1_F(A)==E_files": setEq(fIds, expected.files),
    "2_D==E_applied_pre": setEq(dIds, expected.applied_pre),
    "3_P==E_pending": setEq(record.P_ids, expected.pending),
    "4_every_D_present_in_F(A)": appliedNotInArtifact.length === 0,
    "5_no_expected_applied_absent_from_D": expectedAppliedMissing.length === 0,
    "6_no_unexpected_applied_in_D": unexpectedApplied.length === 0,
    "7_no_duplicate_identifier": record.D_row_count === record.D_distinct_identifier_count,
  };
  record.comparisons = comparisons;
  record.comparison_detail = {
    applied_but_absent_from_artifact: appliedNotInArtifact,
    expected_applied_missing_from_D: expectedAppliedMissing,
    unexpected_applied_in_D: unexpectedApplied,
  };

  const failed = Object.entries(comparisons).filter(([, ok]) => !ok).map(([k]) => k);
  record.decision = failed.length === 0 ? "pass" : "stop";
  record.failed_comparisons = failed;
  record.note =
    "Identifiers only. `_migrations` stores no checksum or content column, so this " +
    "establishes migration IDENTITY and is NOT a content-integrity guarantee. " +
    "`stop` means the deployment is not triggered.";

  console.log(JSON.stringify(record, null, 2));
  process.exit(failed.length === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(`migration-state read failed: ${error?.message ?? String(error)}`);
  process.exit(1);
});
