/**
 * The interval monitor's evaluation logic, as pure functions.
 *
 * Nothing here opens a socket, reads the environment, reads a file or reads a
 * clock. Every function takes observations the caller has already gathered and
 * returns a verdict record. That separation is what makes the drift logic
 * testable offline against fabricated observations, including the ones nobody
 * can produce on demand — migration `008` applied, a successful
 * `deploy-production` run, a scheduler that stopped two days ago.
 *
 * Three statuses, and the difference between the last two is the entire point
 * of this monitor:
 *
 *   - `PASS`  — checked, and the observation matches the record.
 *   - `DRIFT` — checked, and it does not. Production has moved.
 *   - `ERROR` — NOT CHECKED. The database was unreachable, the secret was
 *               missing, `/healthz` timed out, the API refused the token.
 *
 * `DRIFT` and `ERROR` both fail the job. A monitor that cannot distinguish
 * "checked, fine" from "couldn't check" is worthless, and a monitor that
 * reports the second as the first is worse than none: it manufactures evidence
 * of a state nobody observed. The predecessor of this workflow — a Routine
 * bound to a chat session, which fired once into a transcript nobody read —
 * failed in exactly that way.
 *
 * `INFO` is separate and never fails the job. It carries context an operator
 * wants in the same email — the current `main` SHA, the days left in the
 * interval — and it decides nothing. The expiry decision belongs to the named
 * owner; reaching the date authorizes neither M2 nor the recovery path.
 */

import { computeAppliedInventory, setEq } from "../lib/migrationState.mjs";
import {
  API_ARTIFACT_A,
  API_SERVICE_NAME,
  DEPLOY_AUTOMATION_EXPECTED,
  DEPLOY_AUTOMATION_VARIABLE,
  DEPLOY_WORKFLOW_BRANCH,
  DEPLOY_WORKFLOW_FILE,
  EXPECTED_MIGRATIONS,
  FORBIDDEN_MIGRATION_PREFIX,
  INTERVAL_EXPIRY,
  INTERVAL_START,
  SCHEDULER_CRON,
  SCHEDULER_MAX_AGE_HOURS,
  WORKFLOW_REFUSAL_SINCE,
} from "./expected.mjs";

export const STATUS = Object.freeze({
  PASS: "PASS",
  DRIFT: "DRIFT",
  ERROR: "ERROR",
  INFO: "INFO",
});

/**
 * The five gating checks, in report order.
 *
 * `run.mjs` asserts the result set it produced is EXACTLY this set before it is
 * allowed to report success. A check that threw before producing a record, or a
 * sixth that was added without being registered, therefore fails the job rather
 * than quietly narrowing what "all clear" covers.
 */
export const GATING_CHECKS = Object.freeze([
  "api-health",
  "migration-set",
  "scheduler-liveness",
  "deployment-gate",
  "workflow-refusals",
]);

/** The informational items, which are reported and never gate. */
export const INFO_ITEMS = Object.freeze(["interval-context"]);

/** Human titles, so a failure email names the check rather than an id. */
export const CHECK_TITLES = Object.freeze({
  "api-health": "API artifact and health",
  "migration-set": "Applied migration set",
  "scheduler-liveness": "Scheduler liveness",
  "deployment-gate": "Deployment automation gate",
  "workflow-refusals": "Production workflow refusals",
  "interval-context": "Interval context",
});

/** Empty and absent are rendered, never printed as nothing at all. */
export const renderValue = (value) => {
  if (value === undefined) return "(not supplied)";
  if (value === null) return "(none)";
  if (value === "") return "(empty)";
  return String(value);
};

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/**
 * A check that could not be performed.
 *
 * `cause` is a category or a message this repository chose, never a driver's or
 * a server's own text: both can name the database user, host or port, and a
 * database can choose its own error message. Callers pass a sanitized cause.
 */
export const errorResult = (id, expected, cause) => Object.freeze({
  id,
  title: CHECK_TITLES[id] ?? id,
  status: STATUS.ERROR,
  expected,
  observed: "NOT CHECKED",
  detail: cause,
});

/**
 * Check 1 — the API is still serving exact artifact `A`, and says it is healthy.
 *
 * @param {object} input
 * @param {number} input.httpStatus
 * @param {boolean} input.redirected
 * @param {Record<string, unknown>} input.document the parsed `/healthz` JSON
 */
export const evaluateApiHealth = ({ httpStatus, redirected, document }) => {
  const expected = `HTTP 200, status "ok", service "${API_SERVICE_NAME}", commit ${API_ARTIFACT_A}`;
  const failures = [];
  if (httpStatus !== 200) failures.push(`HTTP status is ${httpStatus}, expected 200`);
  if (redirected) failures.push("the request was redirected; the health URL must answer directly");
  if (document?.status !== "ok") {
    failures.push(`"status" is ${renderValue(document?.status)}, expected "ok"`);
  }
  if (document?.service !== API_SERVICE_NAME) {
    failures.push(`"service" is ${renderValue(document?.service)}, expected "${API_SERVICE_NAME}"`);
  }
  if (document?.commit !== API_ARTIFACT_A) {
    failures.push(
      `"commit" is ${renderValue(document?.commit)}, expected artifact A ${API_ARTIFACT_A}`
      + " — the API is no longer serving the artifact M1 deployed",
    );
  }
  const observed = `HTTP ${httpStatus}, status ${renderValue(document?.status)},`
    + ` service ${renderValue(document?.service)}, commit ${renderValue(document?.commit)},`
    + ` state ${renderValue(document?.state)}`;
  return Object.freeze({
    id: "api-health",
    title: CHECK_TITLES["api-health"],
    status: failures.length === 0 ? STATUS.PASS : STATUS.DRIFT,
    expected,
    observed,
    detail: failures.length === 0
      ? "The live API reports healthy at exact artifact A."
      : failures.join("; "),
  });
};

/**
 * Check 2 — the applied set is still exactly `001`–`007`, each once, and no `008`.
 *
 * Exact-set equality alone would reject an applied `008`, but it would report
 * "the set does not match", and "migration 008 has been applied" is a different
 * operational event: it means M2 began without authorization. It is named
 * separately so the failure email says which one happened.
 *
 * @param {readonly string[]} names identifiers exactly as `_migrations` returned them
 */
export const evaluateMigrationSet = ({ names }) => {
  const inventory = computeAppliedInventory(names);
  const applied = inventory.identifiers;
  const expectedList = [...EXPECTED_MIGRATIONS];
  const missing = expectedList.filter((file) => !applied.includes(file));
  const unexpected = applied.filter((file) => !expectedList.includes(file));
  const forbidden = applied.filter((file) => file.startsWith(FORBIDDEN_MIGRATION_PREFIX));
  const duplicated = inventory.row_count !== inventory.distinct_identifier_count;

  const failures = [];
  if (forbidden.length) {
    failures.push(
      `migration ${FORBIDDEN_MIGRATION_PREFIX} is APPLIED (${forbidden.join(", ")}) —`
      + " M2 schema work has reached production and was not authorized",
    );
  }
  if (missing.length) failures.push(`missing from the applied set: ${missing.join(", ")}`);
  const otherUnexpected = unexpected.filter((file) => !forbidden.includes(file));
  if (otherUnexpected.length) failures.push(`applied but not expected: ${otherUnexpected.join(", ")}`);
  if (duplicated) {
    failures.push(
      `${inventory.row_count} rows carry only ${inventory.distinct_identifier_count}`
      + " distinct identifiers — a migration is recorded more than once",
    );
  }
  if (!failures.length && !setEq(applied, expectedList)) {
    // Unreachable by the comparisons above; kept so a future edit that weakens
    // one of them cannot turn a mismatched set into a PASS.
    failures.push("the applied set does not equal the expected set");
  }

  return Object.freeze({
    id: "migration-set",
    title: CHECK_TITLES["migration-set"],
    status: failures.length === 0 ? STATUS.PASS : STATUS.DRIFT,
    expected: `exactly ${expectedList.length} rows, ${expectedList.join(", ")},`
      + ` each once, and no ${FORBIDDEN_MIGRATION_PREFIX}`,
    observed: `${inventory.row_count} rows: ${applied.length ? applied.join(", ") : "(none)"}`,
    detail: failures.length === 0
      ? "The applied set is unchanged since M1."
      : failures.join("; "),
  });
};

/**
 * Check 3 — the daily scheduler is still enqueueing.
 *
 * Both instants come from the DATABASE's own clock, so a runner whose clock has
 * drifted cannot make a stopped scheduler look live, or a live one look stopped.
 *
 * @param {object} input
 * @param {Date | null} input.latest newest `brief_queue.created_at`, or null when empty
 * @param {Date} input.now the database's `now()`
 */
export const evaluateSchedulerLiveness = ({ latest, now }) => {
  const expected = `a brief_queue row created within the last ${SCHEDULER_MAX_AGE_HOURS} hours`
    + ` (production cron ${SCHEDULER_CRON})`;
  if (latest === null) {
    return Object.freeze({
      id: "scheduler-liveness",
      title: CHECK_TITLES["scheduler-liveness"],
      status: STATUS.DRIFT,
      expected,
      observed: "brief_queue holds no rows at all",
      detail: "No brief has ever been enqueued, so the scheduler cannot be shown to be running.",
    });
  }
  const ageMs = now.getTime() - latest.getTime();
  const ageHours = ageMs / MS_PER_HOUR;
  // Five minutes of tolerance for a row committed while this read was in flight.
  // Beyond that, a future timestamp is a real disagreement worth reporting.
  const inFuture = ageMs < -300_000;
  const stale = ageHours > SCHEDULER_MAX_AGE_HOURS;
  const failures = [];
  if (stale) {
    failures.push(
      `the newest brief is ${ageHours.toFixed(1)} hours old, past the`
      + ` ${SCHEDULER_MAX_AGE_HOURS}-hour bound — the daily scheduler has missed at least one run`,
    );
  }
  if (inFuture) {
    failures.push(
      `the newest brief is timestamped ${Math.abs(ageHours).toFixed(1)} hours in the future`
      + " relative to the database's own clock",
    );
  }
  return Object.freeze({
    id: "scheduler-liveness",
    title: CHECK_TITLES["scheduler-liveness"],
    status: failures.length === 0 ? STATUS.PASS : STATUS.DRIFT,
    expected,
    observed: `newest brief_queue row ${latest.toISOString()},`
      + ` ${ageHours.toFixed(1)} hours before database now() ${now.toISOString()}`,
    detail: failures.length === 0
      ? "The scheduler completed a run inside the window."
      : failures.join("; "),
  });
};

/**
 * Check 4 — the deployment gate still reads exactly `false`.
 *
 * Compared as a string. `deploy-production.yml` refuses on anything that is not
 * exactly `true`, so an empty or deleted variable is equally SAFE there — but it
 * is not the recorded state, and a control that has quietly disappeared is worth
 * an operator's attention even when its disappearance happens to fail closed.
 *
 * @param {string | undefined} value the raw variable, or undefined when the job did not supply it
 */
export const evaluateDeploymentGate = ({ value }) => {
  const expected = `${DEPLOY_AUTOMATION_VARIABLE} exactly "${DEPLOY_AUTOMATION_EXPECTED}"`;
  if (value === undefined) {
    return errorResult(
      "deployment-gate",
      expected,
      "The workflow did not pass the gate variable into the step, so its value was never read."
      + " This is a workflow defect, not an observation of the gate.",
    );
  }
  const matches = value === DEPLOY_AUTOMATION_EXPECTED;
  return Object.freeze({
    id: "deployment-gate",
    title: CHECK_TITLES["deployment-gate"],
    status: matches ? STATUS.PASS : STATUS.DRIFT,
    expected,
    observed: renderValue(value),
    detail: matches
      ? "The gate is unchanged."
      : value === ""
        ? `${DEPLOY_AUTOMATION_VARIABLE} is empty or no longer defined. Deployment still fails`
          + " closed, because the production workflow requires exactly \"true\" — but the"
          + " recorded control has changed and should be restored or re-recorded."
        : `${DEPLOY_AUTOMATION_VARIABLE} is "${value}". If this is "true", ordinary automated`
          + " deployment is ENABLED during an interval whose terms prohibit any release of any"
          + " service, for any reason.",
  });
};

/**
 * Check 5 — no `deploy-production` run on `main` has concluded `success`.
 *
 * The branch and the conclusion are filtered HERE, from each run's own fields,
 * rather than by asking the API to filter. A server-side filter that silently
 * over-restricted would hide a breaching run and produce a false `PASS`; a
 * client-side filter over a complete listing cannot.
 *
 * @param {object} input
 * @param {ReadonlyArray<Record<string, any>>} input.runs runs of the deploy workflow
 * @param {number} input.inspected how many runs the caller actually enumerated
 */
export const evaluateWorkflowRefusals = ({ runs, inspected }) => {
  const sinceMs = Date.parse(WORKFLOW_REFUSAL_SINCE);
  const breaches = runs.filter((run) => (
    run.head_branch === DEPLOY_WORKFLOW_BRANCH
    && run.conclusion === "success"
    && Number.isFinite(Date.parse(run.created_at))
    && Date.parse(run.created_at) >= sinceMs
  ));
  const expected = `no ${DEPLOY_WORKFLOW_FILE} run on ${DEPLOY_WORKFLOW_BRANCH} concluded`
    + ` "success" since ${WORKFLOW_REFUSAL_SINCE}`;
  return Object.freeze({
    id: "workflow-refusals",
    title: CHECK_TITLES["workflow-refusals"],
    status: breaches.length === 0 ? STATUS.PASS : STATUS.DRIFT,
    expected,
    observed: breaches.length === 0
      ? `none, across ${inspected} runs inspected`
      : breaches
        .map((run) => `run ${run.id} (#${run.run_number}) succeeded ${run.created_at}`)
        .join("; "),
    detail: breaches.length === 0
      ? "Every release attempt since the interval began was refused."
      : `${breaches.length} successful production deployment run(s) since the interval began.`
        + " A release occurred during an interval whose terms prohibit any release of any"
        + " service, for any reason.",
  });
};

/**
 * Informational — where `main` is, and how much of the interval is left.
 *
 * Deliberately never gates. Expiry is a decision point, and the decision is the
 * named owner's: reaching the date authorizes neither M2 nor the recovery path,
 * so a monitor that failed on the calendar would be asserting an authority it
 * does not have. It reports the number and says whose call it is.
 *
 * @param {object} input
 * @param {Date} input.now
 * @param {string | null} input.mainSha current `main`, or null when it could not be read
 */
export const describeInterval = ({ now, mainSha }) => {
  const expiryMs = Date.parse(INTERVAL_EXPIRY);
  const remainingMs = expiryMs - now.getTime();
  const remainingDays = remainingMs / MS_PER_DAY;
  const expired = remainingMs <= 0;
  const remaining = expired
    ? `EXPIRED ${Math.abs(remainingDays).toFixed(1)} days ago`
    : `${remainingDays.toFixed(1)} days remaining`;
  return Object.freeze({
    id: "interval-context",
    title: CHECK_TITLES["interval-context"],
    status: STATUS.INFO,
    expected: `interval ${INTERVAL_START} to ${INTERVAL_EXPIRY}`,
    observed: `${remaining}; main is ${mainSha ?? "(could not be read)"}`,
    detail: expired
      ? "The interval bound has passed. This monitor decides nothing: the named owner must"
        + " choose M2 completion, explicit re-authorization with a new bound and reason, or the"
        + " recovery path. None of the three is automatic."
      : "Reported for context. The expiry decision belongs to the named owner.",
  });
};
