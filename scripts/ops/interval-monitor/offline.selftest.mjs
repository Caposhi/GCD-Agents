#!/usr/bin/env node
/**
 * Durable offline tests for the M1→M2 interval monitor.
 *
 * No network, no database, no container. The HTTP boundary is a stub, the
 * database boundary is never reached, and every drift state the monitor exists
 * to catch is fabricated here — migration `008` applied, a successful
 * `deploy-production` run, a scheduler that stopped two days ago, the API
 * serving a commit that is not artifact `A`. None of those can be produced on
 * demand in production, and a monitor whose failure paths have never executed
 * is a monitor nobody has tested.
 *
 * Groups:
 *   source     the constants module reads no environment, argv, file or clock
 *   status     the constants agree with what docs/STATUS.md records
 *   workflow   the constants agree with the workflow, and its prohibitions hold
 *   drift      every check's pass and drift states
 *   failclosed could-not-check is never reported as checked-and-fine
 *   report     a drift failure names the check, the expected and the observed
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CANONICAL_MIGRATIONS } from "../lib/migrationState.mjs";
import { validateApiHealthUrl } from "../../render/deployment-controller.mjs";
import {
  GATING_CHECKS,
  STATUS,
  describeInterval,
  errorResult,
  evaluateApiHealth,
  evaluateDeploymentGate,
  evaluateMigrationSet,
  evaluateSchedulerLiveness,
  evaluateWorkflowRefusals,
} from "./checks.mjs";
import {
  API_ARTIFACT_A,
  API_HEALTH_URL,
  API_SERVICE_NAME,
  DATABASE_URL_ENV,
  DEPLOY_AUTOMATION_EXPECTED,
  DEPLOY_AUTOMATION_VARIABLE,
  DEPLOY_GATE_ENV,
  DEPLOY_WORKFLOW_BRANCH,
  DEPLOY_WORKFLOW_FILE,
  EXPECTATIONS,
  EXPECTED_MIGRATIONS,
  FORBIDDEN_MIGRATION_PREFIX,
  INTERVAL_EXPIRY,
  INTERVAL_START,
  MONITOR_CRON,
  MONITOR_ENVIRONMENT,
  SCHEDULER_CRON,
  SCHEDULER_MAX_AGE_HOURS,
  WORKFLOW_PATH,
  WORKFLOW_REFUSAL_SINCE,
} from "./expected.mjs";
import { inert, overallVerdict, renderSummary } from "./report.mjs";
import {
  BRIEF_QUEUE_LIVENESS_SQL,
  DATABASE_CLOCK_SQL,
  collect,
  missingOrUnexpectedChecks,
} from "./run.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const read = (relative) => readFileSync(resolve(REPO_ROOT, relative), "utf8");

const GROUPS = ["source", "status", "workflow", "drift", "failclosed", "report"];
const counts = Object.fromEntries(GROUPS.map((group) => [group, 0]));

/** @param {string} group @param {string} label @param {boolean} condition */
const check = (group, label, condition) => {
  if (!condition) throw new Error(`[${group}] ${label}`);
  counts[group] += 1;
  console.log(`  ✓ [${group}] ${label}`);
};

const STATUS_DOC = read("docs/STATUS.md");
const WORKFLOW = read(WORKFLOW_PATH);
const EXPECTED_SOURCE = read("scripts/ops/interval-monitor/expected.mjs");
const RUN_SOURCE = read("scripts/ops/interval-monitor/run.mjs");
const CHECKS_SOURCE = read("scripts/ops/interval-monitor/checks.mjs");

// --- source ----------------------------------------------------------------
//
// The same property `deadlines.mjs` asserts about itself: an expectation an
// environment variable can move is not an expectation. A future "just make it
// configurable for CI" edit has to fail here rather than ship.
//
// Asserted twice, behaviourally and structurally. The behavioural test is the
// one that matters — it sets overrides and re-imports — and the structural one
// catches a read that no plausible variable name would have triggered.

/** Source with comments removed, so prose describing a rule cannot satisfy it. */
const codeOnly = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !/^\s*(\/\/|\*)/.test(line))
  .join("\n");

const expectationsBefore = JSON.stringify(EXPECTATIONS);
const overrides = [
  "GCD_MONITOR_API_ARTIFACT",
  "API_ARTIFACT_A",
  "INTERVAL_EXPIRY",
  "SCHEDULER_MAX_AGE_HOURS",
  "EXPECTED_MIGRATIONS",
];
for (const name of overrides) process.env[name] = "tampered";
const reimported = await import(`./expected.mjs?cache-bust=${Date.now()}`);
for (const name of overrides) delete process.env[name];
check(
  "source",
  "no environment variable can change what the monitor expects to observe",
  JSON.stringify(reimported.EXPECTATIONS) === expectationsBefore,
);
check("source", "the expectation record is frozen", Object.isFrozen(EXPECTATIONS));

for (const [label, pattern] of [
  ["process.env", /process\s*\.\s*env/],
  ["process.argv", /process\s*\.\s*argv/],
  ["a file read", /readFile|readFileSync|createReadStream/],
  ["a clock", /Date\.now|new Date\(/],
]) {
  check(
    "source",
    `the constants module reads no ${label}`,
    !pattern.test(codeOnly(EXPECTED_SOURCE)),
  );
}
check(
  "source",
  "the monitor never imports the deployment controller at run time",
  !/deployment-controller/.test(codeOnly(RUN_SOURCE))
    && !/deployment-controller/.test(codeOnly(CHECKS_SOURCE)),
);
check(
  "source",
  "the runner only runs when it is the program, so importing it performs no production read",
  RUN_SOURCE.includes("pathToFileURL(process.argv[1]).href === import.meta.url"),
);
check(
  "source",
  "the migration expectation is the canonical list, not a second copy of it",
  EXPECTED_MIGRATIONS === CANONICAL_MIGRATIONS,
);
check(
  "source",
  "the health destination is exactly the one the deployment controller accepts",
  validateApiHealthUrl(API_HEALTH_URL).href === API_HEALTH_URL,
);
check(
  "source",
  "the database statements are fixed and touch only granted columns",
  DATABASE_CLOCK_SQL === "SELECT now() AS now"
    && BRIEF_QUEUE_LIVENESS_SQL === "SELECT max(created_at) AS latest FROM brief_queue",
);
check(
  "source",
  "no database statement is a write",
  ![DATABASE_CLOCK_SQL, BRIEF_QUEUE_LIVENESS_SQL].some((sql) => (
    /\b(insert|update|delete|drop|alter|create|truncate|grant)\b/i.test(sql)
  )),
);
check(
  "source",
  "the refusal instant is the interval start truncated, not a separately typed timestamp",
  INTERVAL_START.startsWith(WORKFLOW_REFUSAL_SINCE.slice(0, -1))
    && Number.isFinite(Date.parse(WORKFLOW_REFUSAL_SINCE)),
);
check(
  "source",
  "the interval expiry parses under the specified date-time grammar",
  Number.isFinite(Date.parse(INTERVAL_EXPIRY)),
);
check(
  "source",
  "the monitor runs after the production scheduler, so the day's brief exists",
  Number(MONITOR_CRON.split(" ")[1]) > Number(SCHEDULER_CRON.split(" ")[1]),
);

// --- status ----------------------------------------------------------------
//
// docs/STATUS.md is the authority; expected.mjs is its executable restatement.
// This is the same shape as the CD/CF guards that hold the stage prompts and
// their validators together, with one difference in strength worth stating.
//
// Most checks below are containment: the constant must appear somewhere in
// Status. That fails when a constant is edited alone to a value Status does not
// record. It does NOT fail when Status is edited and the old value survives
// elsewhere in the file, and Status repeats several of these values.
//
// The interval expiry is bound more tightly, because Status deliberately keeps
// superseded bounds as history, so containment would pass on a stale constant.
// The constant must equal the CURRENT bound: the first `New bound: \`…\`.` line
// in the M1→M2 interval section (re-authorizations are recorded ahead of the
// bounds they supersede), or the original `- Expiry: \`…\`` line when no
// re-authorization exists. Once one exists, the original line must be marked
// superseded. What this does not check is that re-authorizations really are in
// newest-first order; that placement convention is what it relies on.

const INTERVAL_SECTION_HEADING = "### M1→M2 interval — owner, bound, and monitoring";
const NEW_BOUND_LINE = /^New bound: `([^`]+)`\./gm;
const ORIGINAL_EXPIRY_LINE = /^- Expiry: `([^`]+)`(.*)$/gm;

/** The M1→M2 interval section of Status, up to the next level-2 or level-3 heading. */
const intervalSection = (doc) => {
  const start = doc.indexOf(`\n${INTERVAL_SECTION_HEADING}`);
  if (start < 0) return null;
  const body = doc.slice(start + 1);
  const end = body.slice(INTERVAL_SECTION_HEADING.length).search(/\n#{2,3} /);
  return end < 0 ? body : body.slice(0, INTERVAL_SECTION_HEADING.length + end);
};

/** The bounds the interval section records, in document order. */
const recordedBounds = (doc) => {
  const section = intervalSection(doc);
  if (section === null) return null;
  return {
    reauthorized: [...section.matchAll(NEW_BOUND_LINE)].map((match) => match[1]),
    original: [...section.matchAll(ORIGINAL_EXPIRY_LINE)]
      .map((match) => ({ value: match[1], annotation: match[2] })),
  };
};

/** The bound Status records as current, or null when it cannot be read unambiguously. */
const currentBound = (bounds) => {
  if (bounds === null || bounds.original.length !== 1) return null;
  return bounds.reauthorized.length > 0 ? bounds.reauthorized[0] : bounds.original[0].value;
};

const STATUS_BOUNDS = recordedBounds(STATUS_DOC);

check(
  "status",
  "artifact A matches the commit Status records the API was deployed at",
  STATUS_DOC.includes(API_ARTIFACT_A),
);
check(
  "status",
  "the interval start matches the M1 deploy finish time Status records",
  STATUS_DOC.includes(INTERVAL_START),
);
check(
  "status",
  "the interval expiry is the current bound Status records, not a superseded one",
  currentBound(STATUS_BOUNDS) === INTERVAL_EXPIRY,
);
check(
  "status",
  "once Status records a re-authorization, its original expiry line is marked superseded",
  STATUS_BOUNDS !== null
    && STATUS_BOUNDS.original.length === 1
    && (STATUS_BOUNDS.reauthorized.length === 0
      || /\bsuperseded\b/i.test(STATUS_BOUNDS.original[0].annotation)),
);
check(
  "status",
  "the scheduler cron matches the schedule Status records",
  STATUS_DOC.includes(SCHEDULER_CRON),
);
check(
  "status",
  "the expected migration set is the seven Status records as applied",
  EXPECTED_MIGRATIONS.length === 7
    && EXPECTED_MIGRATIONS[0] === "001_init.sql"
    && EXPECTED_MIGRATIONS.at(-1) === "007_evidence_bounds.sql"
    && STATUS_DOC.includes("007_evidence_bounds.sql")
    && STATUS_DOC.includes("`001`–`007`"),
);
check(
  "status",
  "Status records that no migration 008 exists, which is what this monitor watches for",
  STATUS_DOC.includes(`no \`${FORBIDDEN_MIGRATION_PREFIX}\``),
);
check(
  "status",
  "the deployment gate expectation matches the value Status records",
  STATUS_DOC.includes(`\`${DEPLOY_AUTOMATION_VARIABLE}\` exactly \`${DEPLOY_AUTOMATION_EXPECTED}\``),
);
check(
  "status",
  "Status still records the monitoring condition as unmet, which this workflow does not by itself close",
  STATUS_DOC.includes("**That condition is unmet.**"),
);

// --- workflow --------------------------------------------------------------

/** Workflow with `#` comments removed, so prose describing a rule cannot satisfy it. */
const yamlCode = (source) => source
  .split("\n")
  .map((line) => {
    const stripped = line.replace(/(^|\s)#.*$/, "");
    return /^\s*$/.test(stripped) ? "" : stripped;
  })
  .join("\n");

const WORKFLOW_CODE = yamlCode(WORKFLOW);
const permissionsBlock = WORKFLOW_CODE.match(/^permissions:\n((?:[ \t]+\S.*\n)+)/m)?.[1] ?? "";
const triggerBlock = WORKFLOW_CODE.match(/^on:\n((?:(?:[ \t]+\S.*)?\n)+?)(?=\S)/m)?.[1] ?? "";
check(
  "workflow",
  "the workflow's schedule is the monitor cron this module declares",
  WORKFLOW.includes(`- cron: "${MONITOR_CRON}"`),
);
check(
  "workflow",
  `the job declares the ${MONITOR_ENVIRONMENT} environment, without which the secret is unreachable`,
  new RegExp(`^\\s+environment:\\s+${MONITOR_ENVIRONMENT}\\s*$`, "m").test(WORKFLOW),
);
check(
  "workflow",
  "the database secret is referenced by the expected name, from secrets",
  WORKFLOW.includes(`${DATABASE_URL_ENV}: \${{ secrets.${DATABASE_URL_ENV} }}`),
);
check(
  "workflow",
  "the deployment gate reaches the step under the name the runner reads",
  WORKFLOW.includes(`${DEPLOY_GATE_ENV}: \${{ vars.${DEPLOY_AUTOMATION_VARIABLE} }}`),
);
check(
  "workflow",
  "the workflow invokes the monitor and nothing else",
  WORKFLOW.includes("node scripts/ops/interval-monitor/run.mjs"),
);
check(
  "workflow",
  "there is no pull_request trigger, so a fork can never reach the secret",
  !/pull_request/.test(WORKFLOW_CODE),
);
check(
  "workflow",
  "the only triggers are the daily schedule and manual dispatch",
  triggerBlock.includes("schedule:")
    && triggerBlock.includes("workflow_dispatch:")
    && triggerBlock.match(/^ {2}\S+:/gm)?.length === 2,
);
check(
  "workflow",
  "the permission set is exactly contents:read and actions:read",
  permissionsBlock.trim().split("\n").map((line) => line.trim()).sort().join("|")
    === "actions: read|contents: read",
);
check(
  "workflow",
  "no write permission is granted anywhere in the workflow",
  !/:\s*write\b/.test(WORKFLOW_CODE),
);
check(
  "workflow",
  "the workflow references no deployment credential",
  !/RENDER_API_KEY|RENDER_WORKSPACE_ID|render-oss|render deploy/i.test(WORKFLOW_CODE),
);
check(
  "workflow",
  "the workflow performs no push, comment or deployment step",
  !/git push|gh pr|gh issue|actions\/github-script|peter-evans/i.test(WORKFLOW_CODE),
);
for (const literal of [
  API_ARTIFACT_A,
  API_HEALTH_URL,
  INTERVAL_START,
  INTERVAL_EXPIRY,
  WORKFLOW_REFUSAL_SINCE,
  ...EXPECTED_MIGRATIONS,
]) {
  check(
    "workflow",
    `the workflow carries no copy of the expected value ${literal.slice(0, 24)}`,
    !WORKFLOW.includes(literal),
  );
}

// --- drift -----------------------------------------------------------------

const health = (overrides = {}) => evaluateApiHealth({
  httpStatus: 200,
  redirected: false,
  document: {
    status: "ok",
    service: API_SERVICE_NAME,
    state: "postgres",
    commit: API_ARTIFACT_A,
    ...overrides,
  },
});
check("drift", "a healthy API at artifact A passes", health().status === STATUS.PASS);
const movedCommit = health({ commit: "0".repeat(40) });
check(
  "drift",
  "an API serving a different commit is drift, and both commits are named",
  movedCommit.status === STATUS.DRIFT
    && movedCommit.detail.includes(API_ARTIFACT_A)
    && movedCommit.detail.includes("0".repeat(40)),
);
check(
  "drift",
  "an unhealthy status is drift",
  health({ status: "unavailable" }).status === STATUS.DRIFT,
);
check(
  "drift",
  "a non-200 response is drift",
  evaluateApiHealth({ httpStatus: 503, redirected: false, document: { status: "ok", service: API_SERVICE_NAME, commit: API_ARTIFACT_A } }).status === STATUS.DRIFT,
);
check(
  "drift",
  "a redirected health response is drift",
  evaluateApiHealth({ httpStatus: 200, redirected: true, document: { status: "ok", service: API_SERVICE_NAME, commit: API_ARTIFACT_A } }).status === STATUS.DRIFT,
);

check(
  "drift",
  "the recorded migration set passes",
  evaluateMigrationSet({ names: [...EXPECTED_MIGRATIONS] }).status === STATUS.PASS,
);
check(
  "drift",
  "the set passes whatever order the server returns it in",
  evaluateMigrationSet({ names: [...EXPECTED_MIGRATIONS].reverse() }).status === STATUS.PASS,
);
const applied008 = evaluateMigrationSet({
  names: [...EXPECTED_MIGRATIONS, "008_provider_ledger.sql"],
});
check(
  "drift",
  "an applied 008 is drift, and the failure names 008 rather than only a set mismatch",
  applied008.status === STATUS.DRIFT
    && applied008.detail.includes(`migration ${FORBIDDEN_MIGRATION_PREFIX} is APPLIED`)
    && applied008.detail.includes("008_provider_ledger.sql"),
);
const missing007 = evaluateMigrationSet({ names: EXPECTED_MIGRATIONS.slice(0, 6) });
check(
  "drift",
  "a missing migration is drift, and the missing file is named",
  missing007.status === STATUS.DRIFT && missing007.detail.includes("007_evidence_bounds.sql"),
);
const duplicated = evaluateMigrationSet({
  names: [...EXPECTED_MIGRATIONS, "007_evidence_bounds.sql"],
});
check(
  "drift",
  "a migration recorded twice is drift",
  duplicated.status === STATUS.DRIFT && duplicated.detail.includes("more than once"),
);
check(
  "drift",
  "a renamed migration is drift, because identity is the complete filename",
  evaluateMigrationSet({
    names: [...EXPECTED_MIGRATIONS.slice(0, 6), "007_something_else.sql"],
  }).status === STATUS.DRIFT,
);

const dbNow = new Date("2026-09-22T14:00:00Z");
const hoursAgo = (hours) => new Date(dbNow.getTime() - hours * 3_600_000);
check(
  "drift",
  "a brief enqueued an hour ago passes",
  evaluateSchedulerLiveness({ latest: hoursAgo(1), now: dbNow }).status === STATUS.PASS,
);
check(
  "drift",
  `a brief exactly ${SCHEDULER_MAX_AGE_HOURS} hours old is still inside the bound`,
  evaluateSchedulerLiveness({ latest: hoursAgo(SCHEDULER_MAX_AGE_HOURS), now: dbNow }).status === STATUS.PASS,
);
const stopped = evaluateSchedulerLiveness({ latest: hoursAgo(49), now: dbNow });
check(
  "drift",
  "a scheduler that missed two days is drift, and the age is stated",
  stopped.status === STATUS.DRIFT && stopped.detail.includes("49.0 hours old"),
);
check(
  "drift",
  "an empty brief_queue is drift, not a pass by absence of evidence",
  evaluateSchedulerLiveness({ latest: null, now: dbNow }).status === STATUS.DRIFT,
);
check(
  "drift",
  "a brief timestamped in the future is drift",
  evaluateSchedulerLiveness({ latest: hoursAgo(-4), now: dbNow }).status === STATUS.DRIFT,
);

check(
  "drift",
  "the recorded gate value passes",
  evaluateDeploymentGate({ value: DEPLOY_AUTOMATION_EXPECTED }).status === STATUS.PASS,
);
const enabledGate = evaluateDeploymentGate({ value: "true" });
check(
  "drift",
  "a gate reading true is drift, and the report says deployment is enabled",
  enabledGate.status === STATUS.DRIFT && enabledGate.detail.includes("ENABLED"),
);
check(
  "drift",
  "an empty gate is drift, because the recorded control has changed",
  evaluateDeploymentGate({ value: "" }).status === STATUS.DRIFT,
);
check(
  "drift",
  "a case variant is drift, because the gate is compared as an exact string",
  evaluateDeploymentGate({ value: "False" }).status === STATUS.DRIFT,
);

const run = (overrides) => ({
  id: 35_448_454_979,
  run_number: 40,
  conclusion: "failure",
  head_branch: DEPLOY_WORKFLOW_BRANCH,
  created_at: "2026-09-19T14:21:00Z",
  ...overrides,
});
check(
  "drift",
  "a history of refused runs passes",
  evaluateWorkflowRefusals({ runs: [run({}), run({ id: 1 })], inspected: 2 }).status === STATUS.PASS,
);
const breached = evaluateWorkflowRefusals({
  runs: [run({ id: 42, conclusion: "success" })],
  inspected: 1,
});
check(
  "drift",
  "a successful production run since the interval began is drift, and the run is identified",
  breached.status === STATUS.DRIFT && breached.observed.includes("42"),
);
check(
  "drift",
  "a success from before the interval began is not drift",
  evaluateWorkflowRefusals({
    runs: [run({ conclusion: "success", created_at: "2026-09-01T00:00:00Z" })],
    inspected: 1,
  }).status === STATUS.PASS,
);
check(
  "drift",
  "a success on another branch is not drift",
  evaluateWorkflowRefusals({
    runs: [run({ conclusion: "success", head_branch: "release-test" })],
    inspected: 1,
  }).status === STATUS.PASS,
);

const beforeExpiry = describeInterval({ now: new Date("2026-09-22T14:00:00Z"), mainSha: "a".repeat(40) });
check(
  "drift",
  "interval context is informational and never gates",
  beforeExpiry.status === STATUS.INFO && !GATING_CHECKS.includes(beforeExpiry.id),
);
check(
  "drift",
  "an expired interval is reported without the monitor deciding anything",
  describeInterval({ now: new Date(Date.parse(INTERVAL_EXPIRY) + 7 * 24 * 3600 * 1000), mainSha: null }).detail
    .includes("This monitor decides nothing"),
);

// --- failclosed ------------------------------------------------------------

const errored = errorResult("api-health", "expected something", "the endpoint timed out");
check(
  "failclosed",
  "a check that could not run reports NOT CHECKED, never a value",
  errored.status === STATUS.ERROR && errored.observed === "NOT CHECKED",
);
check(
  "failclosed",
  "could-not-check outranks drift in the verdict, so the headline says nothing was proven",
  overallVerdict([
    errored,
    evaluateDeploymentGate({ value: "true" }),
  ]) === STATUS.ERROR,
);
check(
  "failclosed",
  "one drift among passes still fails the verdict",
  overallVerdict([
    health(),
    evaluateDeploymentGate({ value: "true" }),
  ]) === STATUS.DRIFT,
);
check(
  "failclosed",
  "an absent gate variable is an ERROR, not a drift reading of a value never read",
  evaluateDeploymentGate({ value: undefined }).status === STATUS.ERROR,
);
check(
  "failclosed",
  "a dropped check is detected rather than silently narrowing what all clear covers",
  missingOrUnexpectedChecks([health()]).missing.length === GATING_CHECKS.length - 1,
);
check(
  "failclosed",
  "a duplicated check is detected",
  missingOrUnexpectedChecks([health(), health()]).duplicated.includes("api-health"),
);

/** A stub response the bounded reader accepts. */
const stubResponse = (value, { status = 200 } = {}) => {
  const body = new TextEncoder().encode(JSON.stringify(value));
  let sent = false;
  return {
    status,
    ok: status >= 200 && status < 300,
    redirected: false,
    headers: { get: (name) => (name === "content-type" ? "application/json" : null) },
    body: {
      getReader: () => ({
        read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: body })),
        cancel: async () => undefined,
        releaseLock: () => undefined,
      }),
    },
  };
};

const stubFetch = async (url) => {
  if (url === API_HEALTH_URL) {
    return stubResponse({
      status: "ok",
      service: API_SERVICE_NAME,
      state: "postgres",
      commit: API_ARTIFACT_A,
    });
  }
  if (String(url).includes(`/actions/workflows/${DEPLOY_WORKFLOW_FILE}/runs`)) {
    return stubResponse({ workflow_runs: [run({ created_at: "2026-09-01T00:00:00Z" })] });
  }
  if (String(url).includes("/git/ref/heads/")) {
    return stubResponse({ object: { sha: "b".repeat(40) } });
  }
  throw new Error(`unexpected request to ${url}`);
};

const withoutSecret = await collect({
  env: { GITHUB_REPOSITORY: "Caposhi/GCD-Agents", GITHUB_TOKEN: "stub", [DEPLOY_GATE_ENV]: "false" },
  runtime: null,
  fetchImpl: stubFetch,
});
const byId = new Map(withoutSecret.results.map((result) => [result.id, result]));
check(
  "failclosed",
  "every registered check still reports when the database secret is missing",
  missingOrUnexpectedChecks(withoutSecret.results).missing.length === 0,
);
check(
  "failclosed",
  "a missing database secret makes both database checks ERROR, never PASS",
  byId.get("migration-set").status === STATUS.ERROR
    && byId.get("scheduler-liveness").status === STATUS.ERROR,
);
check(
  "failclosed",
  "the missing-secret failure names the secret and the environment restriction",
  byId.get("migration-set").detail.includes(DATABASE_URL_ENV)
    && byId.get("migration-set").detail.includes(MONITOR_ENVIRONMENT)
    && byId.get("migration-set").detail.includes("restricted to main"),
);
check(
  "failclosed",
  "the checks that could run still report their real result alongside the failures",
  byId.get("api-health").status === STATUS.PASS
    && byId.get("deployment-gate").status === STATUS.PASS
    && byId.get("workflow-refusals").status === STATUS.PASS,
);
check(
  "failclosed",
  "an incomplete run never reports all clear",
  overallVerdict(withoutSecret.results) === STATUS.ERROR,
);
check(
  "failclosed",
  "no report field can carry a connection string, because none is ever placed in one",
  !JSON.stringify(withoutSecret.results).includes("postgres://")
    && !JSON.stringify(withoutSecret.results).includes("postgresql://"),
);

// --- report ----------------------------------------------------------------

const driftSummary = renderSummary(
  [movedCommit, applied008, stopped, enabledGate, breached, beforeExpiry],
  { startedAt: "2026-09-22T14:00:00Z" },
);
check(
  "report",
  "the summary leads with the verdict, not with a table",
  driftSummary.indexOf("DRIFT DETECTED") < driftSummary.indexOf("| Check |"),
);
for (const result of [movedCommit, applied008, stopped, enabledGate, breached]) {
  check(
    "report",
    `the summary names the check, the expected and the observed for ${result.id}`,
    driftSummary.includes(inert(result.title))
      && driftSummary.includes(inert(result.expected))
      && driftSummary.includes(inert(result.observed)),
  );
}
check(
  "report",
  "an incomplete run's summary says nothing is proven rather than reporting a finding",
  renderSummary([errored], { startedAt: "2026-09-22T14:00:00Z" })
    .includes("it is evidence that the monitor could not tell"),
);
check(
  "report",
  "the summary restates the standing prohibition on any release when something is wrong",
  driftSummary.includes("no unrelated release may occur"),
);
check(
  "report",
  "table-breaking and Markdown-active characters from outside are neutralized",
  !inert("a|b`c<script>*_[x]").includes("|")
    && !inert("a|b`c<script>*_[x]").includes("<")
    && !inert("a|b`c<script>*_[x]").includes("`"),
);
check(
  "report",
  "ordinary text survives inerting legibly",
  inert(`commit ${API_ARTIFACT_A}`) === `commit ${API_ARTIFACT_A}`,
);

const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
console.log(`\nInterval monitor offline self-test passed: ${total} checks`);
for (const group of GROUPS) console.log(`  ${group}: ${counts[group]}`);
