/**
 * Every value the M1→M2 interval monitor expects to observe, fixed in source.
 *
 * This module is the SINGLE SOURCE OF TRUTH for the monitor. The workflow
 * (`.github/workflows/interval-monitor.yml`) carries no expected value of its
 * own — it wires credentials and invokes `run.mjs`, and every comparison the
 * job makes is made against a constant below. A monitor whose expectations are
 * scattered as literals across a YAML file drifts from the record it is meant
 * to defend, silently, on the first edit that touches only one of them.
 *
 * Like `../m1-readiness/deadlines.mjs`, this file deliberately reads no
 * `process.env`, no `process.argv`, no file and no clock. An operator who wants
 * a different expectation changes this file, in a reviewed commit, and the diff
 * says so. No environment variable can relax, widen or disable any value here.
 *
 * `offline.selftest.mjs` asserts three separate agreements:
 *
 *   1. these constants against what [`docs/STATUS.md`](../../../docs/STATUS.md)
 *      records for the interval — the document is the authority, this file is
 *      its executable restatement. Most of these are containment checks: they
 *      fail when a constant here is edited to a value Status does not record,
 *      not when Status is edited and the old value survives elsewhere in it.
 *      The interval expiry is bound to the CURRENT bound Status records;
 *   2. these constants against `.github/workflows/interval-monitor.yml` — its
 *      schedule, its environment, its secret name, its trigger set and its
 *      permission set;
 *   3. the migration expectation against `../lib/migrationState.mjs`, which
 *      already owns the canonical filenames and is not duplicated here.
 *
 * That is the same shape as the `CD`/`CF` stage-prompt guards in
 * `src/harness/contentIntelligence.selftest.ts`: the prose and the enforcing
 * constant are checked against each other, never against a number written out
 * twice.
 */

import { CANONICAL_MIGRATIONS } from "../lib/migrationState.mjs";

/**
 * Exact artifact `A` — the commit the production API was deployed at by M1.
 *
 * `/healthz` reports this as its `commit`. It is NOT current `main`, and the
 * two must never be conflated: `main` is ahead of `A` by documentation-only
 * commits, and "deploy `main`" and "deploy `A`" are different instructions.
 */
export const API_ARTIFACT_A = "d5015236672a02bf8f58d342625c32a4f5acc8a1";

/**
 * The only health destination this monitor will contact.
 *
 * Byte-identical to the single value `validateApiHealthUrl` in
 * `scripts/render/deployment-controller.mjs` accepts, and the offline suite
 * proves that by calling that validator on this constant. The agreement is
 * asserted at TEST time on purpose: the monitor must not import the deployment
 * controller at run time, because a read-only observer has no business holding
 * a reference to the module that performs releases.
 */
export const API_HEALTH_URL = "https://gcd-social-api.onrender.com/healthz";

/** The service name `/healthz` must report alongside `status: ok`. */
export const API_SERVICE_NAME = "gcd-social-api";

/**
 * The complete applied migration set, by COMPLETE FILENAME.
 *
 * Re-exported rather than re-listed. `../lib/migrationState.mjs` already owns
 * these names and already documents why a numeric prefix is not an identity:
 * `007_something_else.sql` is a different file with different SQL. A second
 * list here would be a second thing to forget to update.
 */
export const EXPECTED_MIGRATIONS = CANONICAL_MIGRATIONS;

/**
 * The migration whose appearance would mean M2 had begun without authorization.
 *
 * Exact-set equality against {@link EXPECTED_MIGRATIONS} already rejects it.
 * This prefix exists so the failure NAMES it — "migration 008 is applied" is a
 * different operational event from "the migration set does not match", and an
 * operator reading a failure email must not have to work out which one happened.
 */
export const FORBIDDEN_MIGRATION_PREFIX = "008";

/**
 * How stale the newest `brief_queue` row may be before the scheduler is judged
 * to have stopped.
 *
 * The production scheduler enqueues on Render cron `0 13 * * *` and this
 * monitor runs at `0 14 * * *`, so a healthy system presents a row about an
 * hour old. Twenty-five hours tolerates exactly one missed hour of cron jitter
 * or a single late run without tolerating a missed DAY, which is the event
 * worth catching.
 */
export const SCHEDULER_MAX_AGE_HOURS = 25;

/** The production scheduler's cron, as `docs/OPERATIONS.md` and `render.yaml` state it. */
export const SCHEDULER_CRON = "0 13 * * *";

/**
 * This monitor's own cron, asserted against the workflow file.
 *
 * One hour after the scheduler's, so the day's `brief_queue` row exists by the
 * time {@link SCHEDULER_MAX_AGE_HOURS} is evaluated against it.
 */
export const MONITOR_CRON = "0 14 * * *";

/**
 * The exact string the deployment gate must hold.
 *
 * The gate is compared as a STRING, not coerced to a boolean. `deploy-production.yml`
 * refuses on anything that is not exactly `true`, so `false`, empty and missing
 * are all equally safe there — but they are not equally INFORMATIVE here. A gate
 * that has become empty means the variable was deleted, which is a change to the
 * control this interval rests on, and the monitor says so rather than shrugging
 * because the outcome happens to still be safe.
 */
export const DEPLOY_AUTOMATION_EXPECTED = "false";

/** The repository variable holding that gate. */
export const DEPLOY_AUTOMATION_VARIABLE = "RENDER_DEPLOY_AUTOMATION_ENABLED";

/** The workflow whose successful runs would mean a release happened. */
export const DEPLOY_WORKFLOW_FILE = "deploy-production.yml";

/** The only branch a `deploy-production` run can legitimately carry. */
export const DEPLOY_WORKFLOW_BRANCH = "main";

/**
 * Interval start — the finish time of the M1 API deploy `dep-dam3dfv40ujc73fgidhg`.
 *
 * Recorded at the microsecond precision the provider reported. It is DISPLAYED
 * and cross-checked against `docs/STATUS.md`; it is never parsed. The ECMAScript
 * date-time grammar specifies exactly three fractional digits, so parsing six is
 * engine-dependent behaviour this monitor does not rely on.
 */
export const INTERVAL_START = "2026-09-17T18:52:47.893627Z";

/**
 * The instant from which a successful `deploy-production` run would be a breach,
 * at second precision so it parses under the specified grammar.
 *
 * The offline suite asserts this is {@link INTERVAL_START} truncated, not an
 * independently typed timestamp that could drift from it.
 */
export const WORKFLOW_REFUSAL_SINCE = "2026-09-17T18:52:47Z";

/**
 * Interval expiry — a decision point, not a cliff.
 *
 * Reaching it authorizes nothing: it obliges the named owner to choose M2
 * completion, explicit re-authorization with a new bound and reason, or the
 * recovery path. This monitor reports the remaining days and never decides.
 *
 * This is the CURRENT bound. The owner re-authorized the interval on 2026-09-22
 * (outcome (b)), superseding the original `2026-09-24T18:52Z`; `docs/STATUS.md`
 * keeps that superseded bound as history. The offline suite binds this constant
 * to the current bound Status records, not to any date appearing in the file.
 */
export const INTERVAL_EXPIRY = "2026-10-22T18:52Z";

/** The GitHub environment holding the read-only database secret. */
export const MONITOR_ENVIRONMENT = "monitoring";

/** The environment secret's name. Only ever read from `process.env`; never printed. */
export const DATABASE_URL_ENV = "GCD_MONITOR_DATABASE_URL";

/** The environment variable carrying the deployment gate into the job. */
export const DEPLOY_GATE_ENV = "DEPLOY_AUTOMATION_GATE";

/** This monitor's workflow file, relative to the repository root. */
export const WORKFLOW_PATH = ".github/workflows/interval-monitor.yml";

/** Every value above as one frozen record, for the report and the tests. */
export const EXPECTATIONS = Object.freeze({
  api_artifact_a: API_ARTIFACT_A,
  api_health_url: API_HEALTH_URL,
  api_service_name: API_SERVICE_NAME,
  expected_migrations: EXPECTED_MIGRATIONS,
  forbidden_migration_prefix: FORBIDDEN_MIGRATION_PREFIX,
  scheduler_max_age_hours: SCHEDULER_MAX_AGE_HOURS,
  scheduler_cron: SCHEDULER_CRON,
  monitor_cron: MONITOR_CRON,
  deploy_automation_expected: DEPLOY_AUTOMATION_EXPECTED,
  deploy_automation_variable: DEPLOY_AUTOMATION_VARIABLE,
  deploy_workflow_file: DEPLOY_WORKFLOW_FILE,
  deploy_workflow_branch: DEPLOY_WORKFLOW_BRANCH,
  interval_start: INTERVAL_START,
  workflow_refusal_since: WORKFLOW_REFUSAL_SINCE,
  interval_expiry: INTERVAL_EXPIRY,
  monitor_environment: MONITOR_ENVIRONMENT,
});
