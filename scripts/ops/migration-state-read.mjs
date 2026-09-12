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
 *
 * Identity here means the COMPLETE FILENAME. A numeric prefix is not an
 * identity: `007_something_else.sql` is a different file with different SQL, and
 * neither is surrounding whitespace ignorable — the runner applies exactly the
 * entries whose real name ends in `.sql`, so filenames are compared byte for
 * byte and never trimmed. `--artifact` must name a COMMIT object, not merely 40
 * hex characters. On failure only a fixed category chosen in this file is
 * printed — never the driver's message, which routinely names the database user
 * and the host:port, and never its SQLSTATE, which the server chooses.
 */

import { execFileSync } from "node:child_process";
import pg from "pg";

// --- the four expected sets, per §4.4.2's contract table -------------------
//
// These are COMPLETE CANONICAL FILENAMES, never numeric prefixes. `_migrations`
// stores the filename, and the general migration runner applies whatever file is
// present — so an identifier reduced to its leading digits is not an identity.
// A migration renamed `007_anything_else.sql` shares the prefix `007` with the
// authorized migration while being a different file with different SQL; comparing
// prefixes would report it as expected and authorize applying it. Every
// comparison below therefore compares filenames verbatim.
const CANONICAL = [
  "001_init.sql",
  "002_brief_and_approval.sql",
  "003_media.sql",
  "004_events.sql",
  "005_approval_integrity.sql",
  "006_content_evidence.sql",
  "007_evidence_bounds.sql",
];
const THROUGH = (n) => CANONICAL.slice(0, n);

const MILESTONES = {
  M1: {
    // E_files: exactly 001–007 by filename, and no later migration.
    files: THROUGH(7),
    // E_applied_pre: exactly the authorized baseline 001–006, by filename.
    applied_pre: THROUGH(6),
    // E_pending: exactly {007_evidence_bounds.sql}.
    pending: ["007_evidence_bounds.sql"],
    // E_applied_post: exactly 001–007, by filename.
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
 * Migration filenames present in the artifact commit, from git alone.
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
 * Entries whose real name does not end in `.sql` are excluded from F(A) — the
 * same rule the runner applies — and returned separately so the operator can
 * see why F(A) is short instead of reading an unexplained mismatch.
 */
const filesAtArtifact = (sha) => {
  const out = execFileSync(
    "git",
    ["ls-tree", "-z", "--name-only", `${sha}`, "state/migrations/"],
    { encoding: "utf8" },
  );
  const entries = out
    .split("\0")
    .filter((l) => l.length > 0)
    .map((l) => l.slice(l.lastIndexOf("/") + 1));
  return {
    sql: entries.filter((f) => f.endsWith(".sql")).sort(),
    nonSql: entries.filter((f) => !f.endsWith(".sql")).sort(),
  };
};

const setEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The ONLY error identifiers this script will repeat, each mapped to a fixed
 * category string that is emitted in place of the code itself.
 *
 * A SQLSTATE is server-chosen and therefore attacker-controllable; a shape check
 * on it is not a sanitizer. This list is the sanitizer: an identifier that is not
 * a key here yields UNKNOWN, and the value emitted is always one of the fixed
 * strings below, never a value that came off the wire.
 */
const KNOWN_ERROR_CATEGORIES = new Map([
  // PostgreSQL SQLSTATEs (class 08 connection, 28 authorization, others as met).
  ["08000", "connection_exception"],
  ["08001", "connection_not_established"],
  ["08003", "connection_does_not_exist"],
  ["08004", "connection_rejected"],
  ["08006", "connection_failure"],
  ["08007", "transaction_resolution_unknown"],
  ["28000", "invalid_authorization"],
  ["28P01", "invalid_password"],
  ["3D000", "database_does_not_exist"],
  ["25006", "read_only_transaction"],
  ["42501", "insufficient_privilege"],
  ["42P01", "undefined_table"],
  ["53300", "too_many_connections"],
  ["55P03", "lock_not_available"],
  ["57014", "query_canceled"],
  ["57P01", "admin_shutdown"],
  ["57P03", "cannot_connect_now"],
  // Node/system and TLS error codes.
  ["ECONNREFUSED", "connection_refused"],
  ["ECONNRESET", "connection_reset"],
  ["ETIMEDOUT", "connection_timeout"],
  ["ENOTFOUND", "host_not_found"],
  ["EHOSTUNREACH", "host_unreachable"],
  ["ENETUNREACH", "network_unreachable"],
  ["EPIPE", "broken_pipe"],
  ["EAI_AGAIN", "dns_temporary_failure"],
  ["CERT_HAS_EXPIRED", "tls_certificate_expired"],
  ["DEPTH_ZERO_SELF_SIGNED_CERT", "tls_self_signed_certificate"],
  ["SELF_SIGNED_CERT_IN_CHAIN", "tls_self_signed_certificate"],
  ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "tls_unverified_certificate"],
]);

const LABEL = "migration-state read";

/**
 * A failure report that cannot leak connection identity.
 *
 * A raw driver message routinely embeds the database user and the host:port it
 * tried (`password authentication failed for user "..."`, `connect ECONNREFUSED
 * 127.0.0.1:1`). This script's contract is that it prints no connection string,
 * user, host, or password, and operator logs or committed evidence would carry
 * whatever is printed here.
 *
 * The SQLSTATE is NOT trusted either. A pattern match on its shape is not a
 * sanitizer: `RAISE ... USING ERRCODE = 'ZZZZZ'` lets the database choose the
 * five characters, so any well-formed value would pass straight through into
 * operator evidence. Only codes on the fixed list below are recognised, and
 * each maps to a FIXED category string that is emitted in place of the code —
 * so what reaches the log is chosen here, never by the server. Everything else,
 * including every unrecognised or custom SQLSTATE, degrades to UNKNOWN.
 */
const sanitizedFailure = (error) => {
  const raw = error?.code;
  const category =
    (typeof raw === "string" ? KNOWN_ERROR_CATEGORIES.get(raw) : undefined) ?? "UNKNOWN";
  return (
    `${LABEL} failed. error_category=${category}\n` +
    "The driver's own message and code are deliberately withheld: both can be chosen " +
    "by the database, and the message can contain the database user, host or port. " +
    "Check the connection settings in your own shell; they are not echoed here."
  );
};

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
  assertCommitObject(artifact);

  const record = {
    milestone,
    read_at: new Date().toISOString(),
    artifact_sha: artifact,
    read_only: true,
  };

  // --- F(A), from the artifact, no database required ----------------------
  const { sql: fFiles, nonSql } = filesAtArtifact(artifact);
  record["F(A)"] = fFiles;
  if (nonSql.length > 0) {
    // Not a decision input: the mismatch it causes is caught by comparison 1.
    // Recorded because a name that only LOOKS canonical is the whole hazard.
    record.non_sql_entries_excluded = nonSql;
  }
  record.expected = {
    E_files: expected.files,
    E_applied_pre: expected.applied_pre,
    E_pending: expected.pending,
    E_applied_post: expected.applied_post,
  };

  if (offline) {
    record.comparisons = {
      "1_F(A)==E_files": setEq(fFiles, expected.files),
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
  record.D = dFiles;
  record.D_row_count = dRows.length;
  record.D_distinct_identifier_count = new Set(dFiles).size;

  // --- P = F(A) − D --------------------------------------------------------
  const pFiles = fFiles.filter((f) => !dFiles.includes(f));
  record.P = pFiles;

  // --- all seven comparisons, each stated individually ---------------------
  // Every one compares COMPLETE FILENAMES. No numeric-prefix projection takes
  // part in any authorization decision.
  const appliedNotInArtifact = dFiles.filter((f) => !fFiles.includes(f));
  const expectedAppliedMissing = expected.applied_pre.filter((f) => !dFiles.includes(f));
  const unexpectedApplied = dFiles.filter((f) => !expected.applied_pre.includes(f));

  const comparisons = {
    "1_F(A)==E_files": setEq(fFiles, expected.files),
    "2_D==E_applied_pre": setEq(dFiles, expected.applied_pre),
    "3_P==E_pending": setEq(pFiles, expected.pending),
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
  console.error(sanitizedFailure(error));
  process.exit(1);
});
