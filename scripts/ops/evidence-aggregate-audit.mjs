#!/usr/bin/env node
/**
 * §4.1 prerequisite — fresh, read-only, AGGREGATE-ONLY production evidence audit.
 *
 * REQUIRES OPERATOR ACTION. Run by an authorized operator, never from an agent
 * session. No agent session in this repository has been given, or may request,
 * a production database credential.
 *
 * Usage (operator machine, read-only role strongly preferred):
 *
 *   export GCD_AUDIT_DATABASE_URL='postgres://READONLY_USER@host:5432/dbname'
 *   node scripts/ops/evidence-aggregate-audit.mjs
 *
 * The variable is deliberately NOT `DATABASE_URL`, so this cannot be run by
 * accident against whatever happens to be exported in a deploy shell.
 *
 * Safety properties, all enforced below rather than merely documented:
 *   - every statement runs inside `BEGIN TRANSACTION READ ONLY`;
 *   - `default_transaction_read_only` is set for the session;
 *   - the query set is fixed; nothing is interpolated from argv or env;
 *   - it returns COUNTS, EXISTENCE and MAXIMA only. It never selects claim
 *     text, subject text, any other row content, PII, or credential values;
 *   - it prints no connection string, user, host, or password — including on
 *     the failure path, where the driver's message AND its code are withheld
 *     and only a fixed category chosen in this file is emitted. The message
 *     routinely names the user and the host:port, and the SQLSTATE is chosen
 *     by the server, so neither is repeated.
 *
 * What it answers is exactly one question, per §4.1: *can the immediately
 * validated constraints of migration 007 pass against the data actually
 * stored?* Bounds are NOT chosen here — they are read from the single
 * authority, `src/harness/agents/payloadContract.ts` → `EVIDENCE_LIMITS`, so
 * this script cannot drift from the contract it is checking.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

// --- bounds, read from the single authority -------------------------------
// Parsed rather than imported so the operator can run this without a build.
const limitsSource = readFileSync(
  resolve(REPO_ROOT, "src/harness/agents/payloadContract.ts"),
  "utf8",
);
const readLimit = (key) => {
  const m = new RegExp(`\\b${key}:\\s*([0-9_]+)`).exec(limitsSource);
  if (!m) throw new Error(`could not read EVIDENCE_LIMITS.${key} from payloadContract.ts`);
  return Number(m[1].replace(/_/g, ""));
};
const LIMITS = {
  idChars: readLimit("idChars"),
  claimChars: readLimit("claimChars"),
  subjectChars: readLimit("subjectChars"),
  attributeChars: readLimit("attributeChars"),
  sourceRefChars: readLimit("sourceRefChars"),
  provenanceChars: readLimit("provenanceChars"),
  reviewedByChars: readLimit("reviewedByChars"),
  tagChars: readLimit("tagChars"),
  maxTags: readLimit("maxTags"),
  detailSerializedChars: readLimit("detailSerializedChars"),
  relationNoteChars: readLimit("relationNoteChars"),
};

// --- the fixed, aggregate-only query set ----------------------------------
// Each entry names the measured aggregate and the bound it must not exceed.
// `null` bound means the value is recorded for the operator record but is not
// itself a pass/fail gate (row counts, existence, NULL-element counts).
const EVIDENCE_AGGREGATES = `
  SELECT
    count(*)                                                   AS row_count,
    count(DISTINCT id)                                         AS distinct_ids,
    coalesce(max(length(id)), 0)                               AS max_id_chars,
    coalesce(max(octet_length(id)), 0)                          AS max_id_bytes,
    coalesce(max(length(claim)), 0)                             AS max_claim_chars,
    coalesce(max(octet_length(claim)), 0)                        AS max_claim_bytes,
    coalesce(max(length(subject)), 0)                           AS max_subject_chars,
    coalesce(max(octet_length(subject)), 0)                      AS max_subject_bytes,
    coalesce(max(length(attribute)), 0)                         AS max_attribute_chars,
    coalesce(max(octet_length(attribute)), 0)                    AS max_attribute_bytes,
    coalesce(max(length(source_ref)), 0)                        AS max_source_ref_chars,
    coalesce(max(octet_length(source_ref)), 0)                   AS max_source_ref_bytes,
    coalesce(max(length(provenance)), 0)                        AS max_provenance_chars,
    coalesce(max(octet_length(provenance)), 0)                   AS max_provenance_bytes,
    coalesce(max(length(reviewed_by)), 0)                       AS max_reviewed_by_chars,
    coalesce(max(octet_length(reviewed_by)), 0)                  AS max_reviewed_by_bytes,
    coalesce(max(length(superseded_by_id)), 0)                  AS max_superseded_by_id_chars,
    coalesce(max(octet_length(superseded_by_id)), 0)             AS max_superseded_by_id_bytes,
    coalesce(max(octet_length(detail::text)), 0)                 AS max_detail_jsonb_text_bytes,
    coalesce(max(cardinality(tags)), 0)                          AS max_tag_cardinality,
    count(*) FILTER (WHERE detail IS NOT NULL)                   AS rows_with_detail
  FROM content_evidence
`;

// Per-element tag maxima and NULL-element detection need their own unnest.
const TAG_AGGREGATES = `
  SELECT
    coalesce(max(length(t)), 0)                                 AS max_tag_chars,
    coalesce(max(octet_length(t)), 0)                            AS max_tag_bytes,
    count(*) FILTER (WHERE t IS NULL)                            AS null_tag_elements,
    count(*)                                                     AS total_tag_elements
  FROM content_evidence, unnest(coalesce(tags, ARRAY[]::text[])) AS t
`;

const RELATION_AGGREGATES = `
  SELECT
    count(*)                                                     AS row_count,
    coalesce(max(length(note)), 0)                               AS max_note_chars,
    coalesce(max(octet_length(note)), 0)                          AS max_note_bytes,
    count(*) FILTER (WHERE note IS NOT NULL)                     AS rows_with_note
  FROM content_evidence_relations
`;

const TABLE_EXISTENCE = `
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('content_evidence', 'content_evidence_relations', '_migrations')
  ORDER BY table_name
`;

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

const LABEL = "audit";

/**
 * A failure report that cannot leak connection identity.
 *
 * A raw driver message routinely embeds the database user and the host:port it
 * tried (`password authentication failed for user "..."`, `connect ECONNREFUSED
 * 127.0.0.1:1`). This script's contract is that it prints no connection string,
 * user, host, or password, and operator logs or committed evidence would carry
 * whatever is printed here. Only a bounded code is emitted: a PostgreSQL
 * SQLSTATE or a Node system error code, matched against a strict pattern so an
 * unexpected value degrades to UNKNOWN rather than passing text through.
 *
 * The SQLSTATE is NOT trusted either. A pattern match on its shape is not a
 * sanitizer: `RAISE ... USING ERRCODE = 'ZZZZZ'` lets the database choose the
 * five characters. Only codes on the fixed list above are recognised, and each
 * maps to a FIXED category emitted in place of the code, so what reaches the
 * log is chosen here and never by the server.
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
  const url = process.env.GCD_AUDIT_DATABASE_URL;
  if (!url) {
    console.error(
      "GCD_AUDIT_DATABASE_URL is not set.\n" +
        "Set it, in the operator's own shell, to a READ-ONLY production connection string.\n" +
        "Never paste a production credential into chat, into a pull request, or into source control.",
    );
    process.exit(2);
  }

  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 15_000 });
  const client = await pool.connect();
  const out = { audited_at: new Date().toISOString(), read_only: true };
  try {
    // Belt and braces: session-level read-only, then an explicitly read-only
    // transaction. Any accidental write raises rather than proceeding.
    await client.query("SET default_transaction_read_only = on");
    await client.query("BEGIN TRANSACTION READ ONLY");

    const tables = (await client.query(TABLE_EXISTENCE)).rows.map((r) => r.table_name);
    out.tables_present = tables;
    const need = ["content_evidence", "content_evidence_relations"];
    const missing = need.filter((t) => !tables.includes(t));
    if (missing.length) {
      out.error = `expected tables absent: ${missing.join(", ")}`;
      await client.query("ROLLBACK");
      console.log(JSON.stringify(out, null, 2));
      process.exit(1);
    }

    out.content_evidence = (await client.query(EVIDENCE_AGGREGATES)).rows[0];
    out.content_evidence_tags = (await client.query(TAG_AGGREGATES)).rows[0];
    out.content_evidence_relations = (await client.query(RELATION_AGGREGATES)).rows[0];

    await client.query("ROLLBACK");
  } finally {
    client.release();
    await pool.end();
  }

  // --- measured maximum vs bound, each stated individually -----------------
  const e = out.content_evidence;
  const t = out.content_evidence_tags;
  const r = out.content_evidence_relations;
  const checks = [
    ["id chars", e.max_id_chars, LIMITS.idChars],
    ["id bytes", e.max_id_bytes, LIMITS.idChars],
    ["claim chars", e.max_claim_chars, LIMITS.claimChars],
    ["claim bytes", e.max_claim_bytes, LIMITS.claimChars],
    ["subject chars", e.max_subject_chars, LIMITS.subjectChars],
    ["subject bytes", e.max_subject_bytes, LIMITS.subjectChars],
    ["attribute chars", e.max_attribute_chars, LIMITS.attributeChars],
    ["attribute bytes", e.max_attribute_bytes, LIMITS.attributeChars],
    ["source_ref chars", e.max_source_ref_chars, LIMITS.sourceRefChars],
    ["source_ref bytes", e.max_source_ref_bytes, LIMITS.sourceRefChars],
    ["provenance chars", e.max_provenance_chars, LIMITS.provenanceChars],
    ["provenance bytes", e.max_provenance_bytes, LIMITS.provenanceChars],
    ["reviewed_by chars", e.max_reviewed_by_chars, LIMITS.reviewedByChars],
    ["reviewed_by bytes", e.max_reviewed_by_bytes, LIMITS.reviewedByChars],
    ["superseded_by_id chars", e.max_superseded_by_id_chars, LIMITS.idChars],
    ["superseded_by_id bytes", e.max_superseded_by_id_bytes, LIMITS.idChars],
    ["detail jsonb::text bytes", e.max_detail_jsonb_text_bytes, LIMITS.detailSerializedChars],
    ["tag cardinality", e.max_tag_cardinality, LIMITS.maxTags],
    ["tag element chars", t.max_tag_chars, LIMITS.tagChars],
    ["tag element bytes", t.max_tag_bytes, LIMITS.tagChars],
    ["relation note chars", r.max_note_chars, LIMITS.relationNoteChars],
    ["relation note bytes", r.max_note_bytes, LIMITS.relationNoteChars],
  ].map(([name, measured, bound]) => ({
    check: name,
    measured: Number(measured),
    bound,
    within_bound: Number(measured) <= bound,
  }));

  // A NULL tag element is rejected by 007's helper, so it is a gate too.
  const nullTagElements = Number(t.null_tag_elements);
  checks.push({
    check: "tag NULL elements",
    measured: nullTagElements,
    bound: 0,
    within_bound: nullTagElements === 0,
  });

  out.bounds_source = "src/harness/agents/payloadContract.ts → EVIDENCE_LIMITS";
  out.checks = checks;
  const failures = checks.filter((c) => !c.within_bound);
  out.verdict = failures.length === 0 ? "WITHIN BOUNDS" : "EXCEEDS BOUNDS";
  out.failing_checks = failures.map((c) => c.check);
  out.note =
    "Aggregate-only. No claim text, subject text, other row content, PII, or credential " +
    "value was selected or printed. This answers only whether 007's immediately validated " +
    "constraints can pass against stored data; it authorizes nothing by itself.";

  console.log(JSON.stringify(out, null, 2));
  process.exit(failures.length === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(sanitizedFailure(error));
  process.exit(1);
});
