/**
 * §4.1 aggregate-audit core logic, as exported functions.
 *
 * Extracted from `scripts/ops/evidence-aggregate-audit.mjs` so the same
 * computation serves that operator CLI and the M1 readiness runner. Nothing
 * here opens a connection: the caller supplies the three aggregate rows, and
 * the bounds come from the single authority.
 *
 * What this answers is exactly one question, per §4.1: *can the immediately
 * validated constraints of migration 007 pass against the data actually
 * stored?* It authorizes nothing by itself.
 *
 * The SQL below returns COUNTS, EXISTENCE and MAXIMA only. It never selects
 * claim text, subject text, any other row content, PII, or credential values.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The bound names read from the single authority, in a fixed order. */
export const LIMIT_KEYS = Object.freeze([
  "idChars",
  "claimChars",
  "subjectChars",
  "attributeChars",
  "sourceRefChars",
  "provenanceChars",
  "reviewedByChars",
  "tagChars",
  "maxTags",
  "detailSerializedChars",
  "relationNoteChars",
]);

/**
 * Read `EVIDENCE_LIMITS` from the single authority.
 *
 * Parsed rather than imported so an operator can run the audit without a build,
 * and so this cannot drift from the contract it is checking.
 *
 * @param {string} repoRoot
 */
export const readEvidenceLimits = (repoRoot) => {
  const source = readFileSync(resolve(repoRoot, "src/harness/agents/payloadContract.ts"), "utf8");
  /** @type {Record<string, number>} */
  const limits = {};
  for (const key of LIMIT_KEYS) {
    const m = new RegExp(`\\b${key}:\\s*([0-9_]+)`).exec(source);
    if (!m) throw new Error(`could not read EVIDENCE_LIMITS.${key} from payloadContract.ts`);
    const value = Number(m[1].replace(/_/g, ""));
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`EVIDENCE_LIMITS.${key} is not a positive safe integer`);
    }
    limits[key] = value;
  }
  return Object.freeze(limits);
};

export const BOUNDS_SOURCE = "src/harness/agents/payloadContract.ts EVIDENCE_LIMITS";

// --- the fixed, aggregate-only query set ----------------------------------
// Each entry names the measured aggregate and the bound it must not exceed.
// Nothing is interpolated from argv or the environment.

export const EVIDENCE_AGGREGATES_SQL = `
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

/** Per-element tag maxima and NULL-element detection need their own unnest. */
export const TAG_AGGREGATES_SQL = `
  SELECT
    coalesce(max(length(t)), 0)                                 AS max_tag_chars,
    coalesce(max(octet_length(t)), 0)                            AS max_tag_bytes,
    count(*) FILTER (WHERE t IS NULL)                            AS null_tag_elements,
    count(*)                                                     AS total_tag_elements
  FROM content_evidence, unnest(coalesce(tags, ARRAY[]::text[])) AS t
`;

export const RELATION_AGGREGATES_SQL = `
  SELECT
    count(*)                                                     AS row_count,
    coalesce(max(length(note)), 0)                               AS max_note_chars,
    coalesce(max(octet_length(note)), 0)                          AS max_note_bytes,
    count(*) FILTER (WHERE note IS NOT NULL)                     AS rows_with_note
  FROM content_evidence_relations
`;

export const TABLE_EXISTENCE_SQL = `
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('content_evidence', 'content_evidence_relations', '_migrations')
  ORDER BY table_name
`;

/** The tables §4.1 cannot proceed without. */
export const REQUIRED_TABLES = Object.freeze(["content_evidence", "content_evidence_relations"]);

/**
 * The exact current contract: 23 checks, named here so a silently added or
 * dropped check fails rather than passing unnoticed.
 */
export const EXPECTED_CHECK_COUNT = 23;
export const EXPECTED_CHECK_NAMES = Object.freeze([
  "id chars",
  "id bytes",
  "claim chars",
  "claim bytes",
  "subject chars",
  "subject bytes",
  "attribute chars",
  "attribute bytes",
  "source_ref chars",
  "source_ref bytes",
  "provenance chars",
  "provenance bytes",
  "reviewed_by chars",
  "reviewed_by bytes",
  "superseded_by_id chars",
  "superseded_by_id bytes",
  "detail jsonb::text bytes",
  "tag cardinality",
  "tag element chars",
  "tag element bytes",
  "relation note chars",
  "relation note bytes",
  "tag NULL elements",
]);

/**
 * PostgreSQL returns `bigint` aggregates as strings through `pg`. Every measured
 * value is converted here and required to be a non-negative safe integer, so a
 * value that does not fit is a failure rather than a silent `NaN` comparison
 * that would read as "within bound".
 *
 * @param {unknown} value
 * @param {string} label
 */
const measuredInteger = (value, label) => {
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`aggregate ${label} is not a non-negative safe integer`);
  }
  return n;
};

/**
 * Recompute the exact 23-check contract from the three aggregate rows.
 *
 * @param {object} input
 * @param {Record<string, unknown>} input.evidence  row from EVIDENCE_AGGREGATES_SQL
 * @param {Record<string, unknown>} input.tags      row from TAG_AGGREGATES_SQL
 * @param {Record<string, unknown>} input.relations row from RELATION_AGGREGATES_SQL
 * @param {Record<string, number>} input.limits     from {@link readEvidenceLimits}
 */
export const evaluateAggregateAudit = ({ evidence, tags, relations, limits }) => {
  const e = evidence;
  const t = tags;
  const r = relations;

  /** @type {Array<[string, unknown, number]>} */
  const boundPairs = [
    ["id chars", e.max_id_chars, limits.idChars],
    ["id bytes", e.max_id_bytes, limits.idChars],
    ["claim chars", e.max_claim_chars, limits.claimChars],
    ["claim bytes", e.max_claim_bytes, limits.claimChars],
    ["subject chars", e.max_subject_chars, limits.subjectChars],
    ["subject bytes", e.max_subject_bytes, limits.subjectChars],
    ["attribute chars", e.max_attribute_chars, limits.attributeChars],
    ["attribute bytes", e.max_attribute_bytes, limits.attributeChars],
    ["source_ref chars", e.max_source_ref_chars, limits.sourceRefChars],
    ["source_ref bytes", e.max_source_ref_bytes, limits.sourceRefChars],
    ["provenance chars", e.max_provenance_chars, limits.provenanceChars],
    ["provenance bytes", e.max_provenance_bytes, limits.provenanceChars],
    ["reviewed_by chars", e.max_reviewed_by_chars, limits.reviewedByChars],
    ["reviewed_by bytes", e.max_reviewed_by_bytes, limits.reviewedByChars],
    ["superseded_by_id chars", e.max_superseded_by_id_chars, limits.idChars],
    ["superseded_by_id bytes", e.max_superseded_by_id_bytes, limits.idChars],
    ["detail jsonb::text bytes", e.max_detail_jsonb_text_bytes, limits.detailSerializedChars],
    ["tag cardinality", e.max_tag_cardinality, limits.maxTags],
    ["tag element chars", t.max_tag_chars, limits.tagChars],
    ["tag element bytes", t.max_tag_bytes, limits.tagChars],
    ["relation note chars", r.max_note_chars, limits.relationNoteChars],
    ["relation note bytes", r.max_note_bytes, limits.relationNoteChars],
  ];

  const checks = boundPairs.map(([check, measured, bound]) => {
    const value = measuredInteger(measured, check);
    return { check, measured: value, bound, within_bound: value <= bound };
  });

  // A NULL tag element is rejected by 007's helper, so it is a gate too.
  const nullTagElements = measuredInteger(t.null_tag_elements, "tag NULL elements");
  checks.push({
    check: "tag NULL elements",
    measured: nullTagElements,
    bound: 0,
    within_bound: nullTagElements === 0,
  });

  const names = checks.map((c) => c.check);
  if (checks.length !== EXPECTED_CHECK_COUNT) {
    throw new Error(
      `aggregate audit produced ${checks.length} checks; the contract is ${EXPECTED_CHECK_COUNT}`,
    );
  }
  if (names.join("|") !== EXPECTED_CHECK_NAMES.join("|")) {
    throw new Error("aggregate audit check names do not match the current contract");
  }

  const failing = checks.filter((c) => !c.within_bound).map((c) => c.check);
  return {
    bounds_source: BOUNDS_SOURCE,
    check_count: checks.length,
    checks,
    failing_checks: failing,
    verdict: failing.length === 0 ? "WITHIN BOUNDS" : "EXCEEDS BOUNDS",
    /** Recorded for the operator record; not itself a pass/fail gate. */
    observed: {
      content_evidence_row_count: measuredInteger(e.row_count, "content_evidence row_count"),
      content_evidence_distinct_ids: measuredInteger(e.distinct_ids, "content_evidence distinct_ids"),
      content_evidence_rows_with_detail: measuredInteger(e.rows_with_detail, "rows_with_detail"),
      tag_elements_total: measuredInteger(t.total_tag_elements, "total_tag_elements"),
      relation_row_count: measuredInteger(r.row_count, "relations row_count"),
      relation_rows_with_note: measuredInteger(r.rows_with_note, "rows_with_note"),
    },
  };
};
