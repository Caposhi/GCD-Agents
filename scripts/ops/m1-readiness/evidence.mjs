/**
 * The runner's two outputs: one bounded machine-readable evidence document and
 * one human-readable summary, both carrying only approved fields.
 *
 * ## What is always retained
 *
 * Whatever the phases return, the document states:
 *
 *   - `M1 BLOCKED / NO-GO`;
 *   - migration 007's production state from the READ RESULT ALONE, otherwise
 *     `UNKNOWN in either direction`;
 *   - rollback artifact `R = UNKNOWN`;
 *   - rollback compatibility `NOT EXECUTED`;
 *   - Render `NOT ESTABLISHED`;
 *
 * and it makes no deployment or production-validation claim. These are not
 * computed from the phases and cannot be overridden by them.
 *
 * ## What can never appear
 *
 * The database URL, username, password or host; any raw database error message
 * or server-chosen SQLSTATE; the GitHub token; and any unfiltered external
 * response. Two mechanisms enforce this rather than one:
 *
 *   1. **construction.** The document is built field by field against a closed
 *      schema. Free-form external text has no field to land in: every job name
 *      is pinned to the fixed enumeration of expected names, every check name to
 *      the fixed 23, every error to a fixed category, and the run URL is built
 *      from constants and a numeric id rather than copied from the response.
 *   2. **a final scan.** {@link assertNoCredentialLeak} re-reads the serialized
 *      bytes and refuses to write if the connection string, its user, its
 *      password, its host, or the token appears. The scan is case-sensitive and
 *      exact; a match fails the run rather than redacting, because a document
 *      that needed redacting was built wrong.
 */

import { ALL_ERROR_CATEGORIES } from "../lib/errorCategories.mjs";
import { EXPECTED_CHECK_NAMES } from "../lib/aggregateAudit.mjs";
import { COMPARISON_KEYS, MIGRATION_007_STATES } from "../lib/migrationState.mjs";
import { DEADLINES_MS } from "./deadlines.mjs";
import { EXPECTED_JOB_NAMES, OWNER, REPO } from "./github.mjs";
import { HANDLED_SIGNALS } from "./runtime.mjs";
import {
  StrictDataError,
  arr,
  bool,
  enumOf,
  int,
  nullable,
  obj,
  serializeChecked,
  str,
} from "./strictData.mjs";

export const EVIDENCE_SCHEMA_NAME = "gcd.m1-readiness-evidence";
export const EVIDENCE_SCHEMA_VERSION = 1;

/** The verdict this runner is not permitted to change. */
export const M1_VERDICT = "M1 BLOCKED / NO-GO";

/** The Render boundary. No executable Render functionality exists in this runner. */
export const RENDER_BOUNDARY = Object.freeze({
  api_identity: "UNKNOWN until separately read",
  worker_identity: "UNKNOWN until separately read",
  scheduler_identity: "UNKNOWN until separately read",
  state: "NOT ESTABLISHED",
  note: "Render evidence is a separately reviewed addendum; this runner performs no Render call.",
});

/** The rollback boundary. Nothing here executes a rollback or tests one. */
export const ROLLBACK_BOUNDARY = Object.freeze({
  artifact_R: "UNKNOWN",
  compatibility: "NOT EXECUTED",
});

/** Everything this runner deliberately does not do, stated in the evidence. */
export const NON_ACTIONS = Object.freeze([
  "no deployment was triggered",
  "no production validation was performed or claimed",
  "no migration was applied",
  "no migration was rolled back",
  "no rollback compatibility was executed",
  "no Render API, worker or scheduler was contacted",
  "no repository was cloned and no other tree was checked out",
  "no dependency was installed and npm was not invoked",
  "no executable helper was generated or extracted",
  "no git configuration was modified",
  "no .DS_Store was inspected or altered",
  "no executor was enabled and no production automation was enabled",
  "M1 was not authorized",
]);

/** Ceiling for the machine-readable document. */
export const MAX_EVIDENCE_BYTES = 524_288;
/** Ceiling for the human-readable summary. */
export const MAX_SUMMARY_BYTES = 32_768;

const SHA = str({ min: 40, max: 40 });
const CATEGORY = enumOf(ALL_ERROR_CATEGORIES);
const MIGRATION_NAME = str({ min: 1, max: 256 });
const SERVER_SETTING = str({ max: 64 });

const SESSION = nullable(
  obj({
    transaction_read_only: SERVER_SETTING,
    statement_timeout: SERVER_SETTING,
    lock_timeout: SERVER_SETTING,
    idle_in_transaction_session_timeout: SERVER_SETTING,
  }),
);

const COMPARISONS = nullable(
  obj(Object.fromEntries(COMPARISON_KEYS.map((key) => [key, bool()]))),
);

export const EVIDENCE_SCHEMA = obj({
  schema: enumOf([EVIDENCE_SCHEMA_NAME]),
  schema_version: int({ min: 1, max: 1 }),
  generated_at: str({ min: 20, max: 40 }),
  runner: obj({
    entrypoint: str({ max: 256 }),
    node_version: str({ max: 32 }),
    platform: str({ max: 32 }),
    interrupted: bool(),
    interrupted_by: nullable(enumOf(HANDLED_SIGNALS)),
  }),
  verdict: obj({
    m1: enumOf([M1_VERDICT]),
    migration_007_production_state: enumOf(Object.values(MIGRATION_007_STATES)),
    authorizes_deployment: bool(),
    claims_production_validation: bool(),
  }),
  artifact: obj({
    A: SHA,
    source: str({ max: 128 }),
    is_commit: bool(),
    accepts_branch_tag_abbreviation_or_override: bool(),
  }),
  repository: obj({
    node_version: str({ max: 32 }),
    node_major: int({ min: 0, max: 999 }),
    declared_node_version_file: str({ max: 32 }),
    declared_engines_node: str({ max: 32 }),
    tracked_source_clean: bool(),
    ds_store_modification_tolerated: bool(),
    ds_store_inspected_or_altered: bool(),
    object_format: enumOf(["sha1"]),
    package_json_blob: SHA,
    package_lock_blob: SHA,
    package_files_match_artifact: bool(),
    pg_resolved_inside_checkout: bool(),
    pg_installed_version: str({ max: 64 }),
    pg_lockfile_pinned_version: str({ max: 64 }),
    npm_invoked: bool(),
  }),
  ci: obj({
    status: enumOf(["ESTABLISHED", "NOT ESTABLISHED"]),
    identity: obj({
      owner: enumOf([OWNER]),
      repo: enumOf([REPO]),
      workflow_id: int({ min: 1 }),
      workflow_path: str({ max: 256 }),
      workflow_name: str({ max: 128 }),
      expected_event: str({ max: 32 }),
      expected_run_attempt: int({ min: 1, max: 1 }),
      expected_jobs: arr(enumOf(EXPECTED_JOB_NAMES), { min: 5, max: 5 }),
      identity_source: str({ max: 128 }),
    }),
    authenticated: bool(),
    reason: nullable(str({ max: 256 })),
    run_id: nullable(int({ min: 1 })),
    run_url: nullable(str({ max: 256 })),
    run_attempt: nullable(int({ min: 1, max: 100_000 })),
    matching_run_count: nullable(int({ min: 0, max: 100 })),
    retried_run_count: nullable(int({ min: 0, max: 100 })),
    job_count: nullable(int({ min: 0, max: 100 })),
    // Only jobs whose name is one of the five expected names are recorded, so
    // no external string reaches the document.
    jobs: arr(
      obj({
        name: enumOf(EXPECTED_JOB_NAMES),
        status: str({ max: 32 }),
        conclusion: nullable(str({ max: 32 })),
        run_attempt: int({ min: 1, max: 100_000 }),
      }),
      { max: 5 },
    ),
    duplicate_job_name_count: int({ min: 0, max: 100 }),
    unexpected_job_name_count: int({ min: 0, max: 100 }),
    missing_job_names: arr(enumOf(EXPECTED_JOB_NAMES), { max: 5 }),
    jobs_not_succeeded_on_attempt_1: arr(enumOf(EXPECTED_JOB_NAMES), { max: 5 }),
    failures: arr(str({ max: 128 }), { max: 16 }),
    discarded_unknown_fields: int({ min: 0, max: 1_000_000 }),
  }),
  migration_state: obj({
    status: enumOf(["READ", "FAILED", "NOT ATTEMPTED"]),
    error_category: nullable(CATEGORY),
    milestone: enumOf(["M1"]),
    artifact_inventory: obj({
      entry_count: int({ min: 0, max: 1_000 }),
      files: arr(MIGRATION_NAME, { max: 1_000 }),
      file_count: int({ min: 0, max: 1_000 }),
      distinct_file_count: int({ min: 0, max: 1_000 }),
      unique: bool(),
      canonically_ordered: bool(),
      matches_canonical_sequence: bool(),
      non_sql_entries_excluded: arr(MIGRATION_NAME, { max: 1_000 }),
    }),
    expected: obj({
      E_files: arr(MIGRATION_NAME, { max: 1_000 }),
      E_applied_pre: arr(MIGRATION_NAME, { max: 1_000 }),
      E_pending: arr(MIGRATION_NAME, { max: 1_000 }),
      E_applied_post: arr(MIGRATION_NAME, { max: 1_000 }),
    }),
    applied: nullable(
      obj({
        identifiers: arr(MIGRATION_NAME, { max: 1_000 }),
        row_count: int({ min: 0, max: 1_000_000 }),
        distinct_identifier_count: int({ min: 0, max: 1_000_000 }),
        unique: bool(),
        returned_in_canonical_order: bool(),
      }),
    ),
    pending: nullable(arr(MIGRATION_NAME, { max: 1_000 })),
    comparisons: COMPARISONS,
    comparison_detail: nullable(
      obj({
        applied_but_absent_from_artifact: arr(MIGRATION_NAME, { max: 1_000 }),
        expected_applied_missing_from_D: arr(MIGRATION_NAME, { max: 1_000 }),
        unexpected_applied_in_D: arr(MIGRATION_NAME, { max: 1_000 }),
      }),
    ),
    failed_comparisons: nullable(arr(enumOf(COMPARISON_KEYS), { max: 7 })),
    decision: enumOf(["pass", "stop", "INCOMPLETE — D not read"]),
    migration_007_state: enumOf(Object.values(MIGRATION_007_STATES)),
    session: SESSION,
  }),
  aggregate_audit: obj({
    status: enumOf(["AUDITED", "INCOMPLETE", "FAILED", "NOT ATTEMPTED"]),
    error_category: nullable(CATEGORY),
    verdict: enumOf(["WITHIN BOUNDS", "EXCEEDS BOUNDS", "NOT ESTABLISHED"]),
    bounds_source: str({ max: 128 }),
    check_count: nullable(int({ min: 0, max: 100 })),
    checks: nullable(
      arr(
        obj({
          check: enumOf(EXPECTED_CHECK_NAMES),
          measured: int({ min: 0 }),
          bound: int({ min: 0 }),
          within_bound: bool(),
        }),
        { max: 23 },
      ),
    ),
    failing_checks: nullable(arr(enumOf(EXPECTED_CHECK_NAMES), { max: 23 })),
    observed: nullable(
      obj({
        content_evidence_row_count: int({ min: 0 }),
        content_evidence_distinct_ids: int({ min: 0 }),
        content_evidence_rows_with_detail: int({ min: 0 }),
        tag_elements_total: int({ min: 0 }),
        relation_row_count: int({ min: 0 }),
        relation_rows_with_note: int({ min: 0 }),
      }),
    ),
    tables_present: nullable(arr(str({ max: 128 }), { max: 16 })),
    missing_tables: nullable(arr(str({ max: 128 }), { max: 16 })),
    session: SESSION,
  }),
  render: obj({
    api_identity: enumOf([RENDER_BOUNDARY.api_identity]),
    worker_identity: enumOf([RENDER_BOUNDARY.worker_identity]),
    scheduler_identity: enumOf([RENDER_BOUNDARY.scheduler_identity]),
    state: enumOf([RENDER_BOUNDARY.state]),
    note: str({ max: 256 }),
  }),
  rollback: obj({
    artifact_R: enumOf([ROLLBACK_BOUNDARY.artifact_R]),
    compatibility: enumOf([ROLLBACK_BOUNDARY.compatibility]),
  }),
  deadlines_ms: obj(
    Object.fromEntries(Object.keys(DEADLINES_MS).map((key) => [key, int({ min: 1 })])),
  ),
  non_actions: arr(str({ max: 128 }), { min: NON_ACTIONS.length, max: NON_ACTIONS.length }),
});

/**
 * Refuse to emit a document that contains a credential.
 *
 * Exact and case-sensitive. A match is a failure, never a redaction: a document
 * that needed redacting was constructed wrong, and silently repairing it would
 * hide the construction fault.
 *
 * @param {string} text
 * @param {{ connectionString?: string, token?: string }} secrets
 */
export const assertNoCredentialLeak = (text, secrets) => {
  /** @type {Array<[string, string]>} */
  const forbidden = [];
  if (secrets.token) forbidden.push(["github token", secrets.token]);
  const url = secrets.connectionString;
  if (url) {
    forbidden.push(["database url", url]);
    try {
      const parsed = new URL(url);
      if (parsed.username) forbidden.push(["database username", decodeURIComponent(parsed.username)]);
      if (parsed.password) forbidden.push(["database password", decodeURIComponent(parsed.password)]);
      if (parsed.hostname) forbidden.push(["database host", parsed.hostname]);
    } catch {
      // An unparsable connection string still has its whole value checked above.
    }
  }
  for (const [label, value] of forbidden) {
    if (value.length > 0 && text.includes(value)) {
      throw new StrictDataError(`refusing to write evidence: it contains the ${label}`);
    }
  }
};

/**
 * Build the evidence document from the phase results.
 *
 * Every field is written explicitly. Nothing is spread from a phase result, so
 * a field a phase invents cannot reach the document.
 *
 * @param {object} input
 * @param {string} input.generatedAt
 * @param {string} input.entrypoint
 * @param {{ interrupted: boolean, interruptedBy: string | null }} input.runtime
 * @param {Awaited<ReturnType<import("./repository.mjs").establishArtifact>>} input.repository
 * @param {any} input.ci
 * @param {any} input.migrationState
 * @param {any} input.aggregateAudit
 */
export const buildEvidence = ({
  generatedAt,
  entrypoint,
  runtime,
  repository,
  ci,
  migrationState,
  aggregateAudit,
}) => {
  const recordedJobs = Array.isArray(ci.jobs)
    ? ci.jobs.filter((j) => EXPECTED_JOB_NAMES.includes(j.name))
    : [];
  return {
    schema: EVIDENCE_SCHEMA_NAME,
    schema_version: EVIDENCE_SCHEMA_VERSION,
    generated_at: generatedAt,
    runner: {
      entrypoint,
      node_version: process.versions.node,
      platform: process.platform,
      interrupted: runtime.interrupted,
      interrupted_by: runtime.interruptedBy,
    },
    verdict: {
      // Fixed. No phase result can change it.
      m1: M1_VERDICT,
      migration_007_production_state: migrationState.migration_007_state,
      authorizes_deployment: false,
      claims_production_validation: false,
    },
    artifact: {
      A: repository.artifact,
      source: repository.artifact_source,
      is_commit: true,
      accepts_branch_tag_abbreviation_or_override: false,
    },
    repository: {
      node_version: repository.node.running,
      node_major: repository.node.major,
      declared_node_version_file: repository.node.declared_node_version_file,
      declared_engines_node: repository.node.declared_engines_node,
      tracked_source_clean: true,
      ds_store_modification_tolerated: repository.working_tree.ds_store_modification_tolerated,
      ds_store_inspected_or_altered: false,
      object_format: repository.package_binding.object_format,
      package_json_blob: repository.package_binding.files["package.json"].blob_oid,
      package_lock_blob: repository.package_binding.files["package-lock.json"].blob_oid,
      package_files_match_artifact: true,
      pg_resolved_inside_checkout: repository.pg.resolved_inside_checkout,
      pg_installed_version: repository.pg.installed_version,
      pg_lockfile_pinned_version: repository.pg.lockfile_pinned_version,
      npm_invoked: false,
    },
    ci: {
      status: ci.status,
      identity: {
        owner: ci.identity.owner,
        repo: ci.identity.repo,
        workflow_id: ci.identity.workflow_id,
        workflow_path: ci.identity.workflow_path,
        workflow_name: ci.identity.workflow_name,
        expected_event: ci.identity.expected_event,
        expected_run_attempt: ci.identity.expected_run_attempt,
        expected_jobs: ci.identity.expected_jobs,
        identity_source: ci.identity.identity_source,
      },
      authenticated: ci.identity.authenticated,
      reason: ci.reason ?? null,
      run_id: ci.run?.id ?? null,
      // Built here from constants and a numeric id, never copied from the response.
      run_url: ci.run ? `https://github.com/${OWNER}/${REPO}/actions/runs/${ci.run.id}` : null,
      run_attempt: ci.run?.run_attempt ?? null,
      matching_run_count: ci.matching_run_count ?? null,
      retried_run_count: ci.retried_run_count ?? null,
      job_count: ci.job_count ?? null,
      jobs: recordedJobs.map((j) => ({
        name: j.name,
        status: j.status,
        conclusion: j.conclusion,
        run_attempt: j.run_attempt,
      })),
      duplicate_job_name_count: ci.duplicate_job_names?.length ?? 0,
      unexpected_job_name_count: ci.unexpected_job_names?.length ?? 0,
      missing_job_names: ci.missing_job_names ?? [],
      jobs_not_succeeded_on_attempt_1: (ci.jobs_not_succeeded_on_attempt_1 ?? []).filter((n) =>
        EXPECTED_JOB_NAMES.includes(n),
      ),
      failures: ci.failures ?? [],
      discarded_unknown_fields: ci.discarded_unknown_fields ?? 0,
    },
    migration_state: {
      status: migrationState.status ?? "NOT ATTEMPTED",
      error_category: migrationState.error_category ?? null,
      milestone: migrationState.milestone,
      artifact_inventory: migrationState.artifact_inventory,
      expected: migrationState.expected,
      applied: migrationState.applied?.read
        ? {
            identifiers: migrationState.applied.identifiers,
            row_count: migrationState.applied.row_count,
            distinct_identifier_count: migrationState.applied.distinct_identifier_count,
            unique: migrationState.applied.unique,
            returned_in_canonical_order: migrationState.applied.returned_in_canonical_order,
          }
        : null,
      pending: migrationState.pending,
      comparisons: migrationState.comparisons,
      comparison_detail: migrationState.comparison_detail,
      failed_comparisons: migrationState.failed_comparisons,
      decision: migrationState.decision,
      migration_007_state: migrationState.migration_007_state,
      session: migrationState.session ?? null,
    },
    aggregate_audit: {
      status: aggregateAudit.status ?? "NOT ATTEMPTED",
      error_category: aggregateAudit.error_category ?? null,
      verdict: aggregateAudit.verdict,
      bounds_source: aggregateAudit.bounds_source,
      check_count: aggregateAudit.check_count ?? null,
      checks: aggregateAudit.checks ?? null,
      failing_checks: aggregateAudit.failing_checks ?? null,
      observed: aggregateAudit.observed ?? null,
      tables_present: aggregateAudit.tables_present ?? null,
      missing_tables: aggregateAudit.missing_tables ?? null,
      session: aggregateAudit.session ?? null,
    },
    render: { ...RENDER_BOUNDARY },
    rollback: { ...ROLLBACK_BOUNDARY },
    deadlines_ms: { ...DEADLINES_MS },
    non_actions: [...NON_ACTIONS],
  };
};

/**
 * Serialize the evidence document, proving it re-reads under its own schema and
 * carries no credential.
 *
 * @param {object} document
 * @param {{ connectionString?: string, token?: string }} secrets
 */
export const renderEvidenceDocument = (document, secrets) => {
  const { text } = serializeChecked(document, EVIDENCE_SCHEMA, MAX_EVIDENCE_BYTES);
  assertNoCredentialLeak(text, secrets);
  return text;
};

/**
 * The human-readable summary. Only approved fields; no free-form external text.
 *
 * @param {object} d the built evidence document
 * @param {{ connectionString?: string, token?: string }} secrets
 */
export const renderSummary = (d, secrets) => {
  const yn = (v) => (v ? "yes" : "no");
  const lines = [
    "M1 READINESS EVIDENCE — repository and database portions only",
    "=============================================================",
    "",
    `VERDICT                         ${d.verdict.m1}`,
    `Migration 007 production state  ${d.verdict.migration_007_production_state}`,
    `Authorizes deployment           ${yn(d.verdict.authorizes_deployment)}`,
    `Claims production validation    ${yn(d.verdict.claims_production_validation)}`,
    "",
    `Artifact A                      ${d.artifact.A}`,
    `A source                        ${d.artifact.source}`,
    "",
    "REPOSITORY",
    `  Node                          ${d.repository.node_version} (major ${d.repository.node_major})`,
    `  Tracked source clean          ${yn(d.repository.tracked_source_clean)}`,
    `  .DS_Store modification        ${d.repository.ds_store_modification_tolerated ? "tolerated, not inspected" : "none"}`,
    `  package.json blob             ${d.repository.package_json_blob}`,
    `  package-lock.json blob        ${d.repository.package_lock_blob}`,
    `  pg from this checkout         ${yn(d.repository.pg_resolved_inside_checkout)} (${d.repository.pg_installed_version})`,
    "",
    "CI (exact head)",
    `  Status                        ${d.ci.status}`,
    `  Workflow                      ${d.ci.identity.workflow_path} (id ${d.ci.identity.workflow_id})`,
    `  Run                           ${d.ci.run_url ?? "none accepted"}`,
    `  Attempt                       ${d.ci.run_attempt ?? "n/a"}`,
    `  Jobs succeeded on attempt 1   ${d.ci.jobs.length} of ${d.ci.identity.expected_jobs.length}`,
    ...(d.ci.reason ? [`  Reason                        ${d.ci.reason}`] : []),
    "",
    "MIGRATION STATE",
    `  Status                        ${d.migration_state.status}`,
    ...(d.migration_state.error_category
      ? [`  Error category                ${d.migration_state.error_category}`]
      : []),
    `  Decision                      ${d.migration_state.decision}`,
    `  Failed comparisons            ${
      d.migration_state.failed_comparisons === null
        ? "not evaluated"
        : d.migration_state.failed_comparisons.length === 0
          ? "none"
          : d.migration_state.failed_comparisons.join(", ")
    }`,
    `  Migration 007                 ${d.migration_state.migration_007_state}`,
    "",
    "AGGREGATE AUDIT",
    `  Status                        ${d.aggregate_audit.status}`,
    ...(d.aggregate_audit.error_category
      ? [`  Error category                ${d.aggregate_audit.error_category}`]
      : []),
    `  Verdict                       ${d.aggregate_audit.verdict}`,
    `  Checks                        ${d.aggregate_audit.check_count ?? "not evaluated"}`,
    `  Failing checks                ${
      d.aggregate_audit.failing_checks === null
        ? "not evaluated"
        : d.aggregate_audit.failing_checks.length === 0
          ? "none"
          : d.aggregate_audit.failing_checks.join(", ")
    }`,
    "",
    "RENDER",
    `  API identity                  ${d.render.api_identity}`,
    `  Worker identity               ${d.render.worker_identity}`,
    `  Scheduler identity            ${d.render.scheduler_identity}`,
    `  State                         ${d.render.state}`,
    "",
    "ROLLBACK",
    `  Artifact R                    ${d.rollback.artifact_R}`,
    `  Compatibility                 ${d.rollback.compatibility}`,
    "",
    "NOT DONE",
    ...d.non_actions.map((n) => `  - ${n}`),
    "",
    `Interrupted                     ${d.runner.interrupted ? d.runner.interrupted_by : "no"}`,
    `Generated at                    ${d.generated_at}`,
    "",
  ];
  const text = `${lines.join("\n")}`;
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > MAX_SUMMARY_BYTES) {
    throw new StrictDataError(`summary is ${bytes.byteLength} bytes; the ceiling is ${MAX_SUMMARY_BYTES}`);
  }
  assertNoCredentialLeak(text, secrets);
  return text;
};
