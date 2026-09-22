/**
 * The M1→M2 interval monitor: one read-only pass over five checks, run daily by
 * `.github/workflows/interval-monitor.yml`.
 *
 * This is the only file in `scripts/ops/interval-monitor/` that performs I/O.
 * `expected.mjs` holds what should be true, `checks.mjs` decides whether an
 * observation matches, `report.mjs` renders — none of them opens a socket. This
 * file gathers observations and is the single place where a failure to gather
 * one is turned into a verdict.
 *
 * ## Strictly read-only
 *
 * No write reaches the database, the repository, or any external system, and no
 * deployment of any kind is performed or requested. The database session is
 * opened through `../m1-readiness/database.mjs`, which sets
 * `default_transaction_read_only`, runs inside `BEGIN TRANSACTION READ ONLY`,
 * and VERIFIES both with `SHOW` rather than assuming the server honoured them.
 * The three statements are fixed strings declared below; nothing is interpolated
 * from argv or the environment. The GitHub calls are `GET`s. The standing
 * prohibition — no unrelated release may occur, of any service, for any reason —
 * is in force for the whole interval, and this program has no code path that
 * could violate it.
 *
 * ## Fail-closed
 *
 * `process.exitCode` is set to 1 before any work begins and is cleared to 0 only
 * at the very end, after the verdict is `PASS` **and** the result set has been
 * proven to contain exactly the registered gating checks. Every path that
 * returns early, throws, or produces fewer results than expected therefore
 * fails. A check that could not be performed reports `ERROR`, which fails the
 * job exactly as drift does, and the summary says the run proved nothing rather
 * than reporting all clear. That distinction is the reason this workflow exists:
 * its predecessor could not tell "checked, fine" from "never ran".
 *
 * ## Credential handling
 *
 * The connection string is read once from the environment, passed directly to
 * the driver, and never logged, never interpolated into a URL, never placed on a
 * command line, and never included in any report. Database failures are reported
 * as fixed categories from `../lib/errorCategories.mjs`, because a driver's own
 * message can carry the database user, host or port, and a server can choose its
 * own error text.
 */

import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { categorizeError } from "../lib/errorCategories.mjs";
import { MIGRATION_STATE_SQL } from "../lib/migrationState.mjs";
import { withReadOnlySession } from "../m1-readiness/database.mjs";
import { MIGRATION_STATE_TOTAL_MS } from "../m1-readiness/deadlines.mjs";
import { Runtime } from "../m1-readiness/runtime.mjs";
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
  DEPLOY_GATE_ENV,
  DEPLOY_WORKFLOW_BRANCH,
  DEPLOY_WORKFLOW_FILE,
  MONITOR_ENVIRONMENT,
  WORKFLOW_REFUSAL_SINCE,
} from "./expected.mjs";
import { overallVerdict, plain, renderConsole, renderSummary } from "./report.mjs";

/** `/healthz` returns a small fixed document; anything larger is rejected unread. */
export const MAX_HEALTH_BODY_BYTES = 4_096;

/** One `/healthz` request, start to finished body. */
export const HEALTH_REQUEST_MS = 15_000;

/** Every individual GitHub API request. */
export const GITHUB_REQUEST_MS = 20_000;

/** A GitHub listing page; 100 is the API maximum. */
export const RUNS_PER_PAGE = 100;

/**
 * How far back the deploy-workflow history may be paged.
 *
 * Reaching this bound without having paged past the interval start is an
 * `ERROR`, not a `PASS`: an un-enumerated tail could contain the successful run
 * the check exists to find.
 */
export const MAX_RUN_PAGES = 5;

/** Fixed, read-only, and touching only columns the monitoring role is granted. */
export const DATABASE_CLOCK_SQL = "SELECT now() AS now";
export const BRIEF_QUEUE_LIVENESS_SQL = "SELECT max(created_at) AS latest FROM brief_queue";

/** `owner/repo`, validated before it is ever placed in a URL. */
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** Bounded read of a response body. The stream is cancelled the moment it overruns. */
const readBoundedBody = async (response, maxBytes) => {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isInteger(length) || length < 0 || length > maxBytes) {
      throw new Error(`the response declared ${plain(declared)} bytes, past its ${maxBytes}-byte bound`);
    }
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("the response carried no body");
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("response exceeded its byte bound").catch(() => undefined);
        throw new Error(`the response exceeded its ${maxBytes}-byte bound`);
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
};

/**
 * Observe `/healthz`.
 *
 * The destination is the checked-in constant, never a value from the
 * environment, so this program cannot be pointed at another host by
 * reconfiguration.
 */
export const observeApiHealth = async ({ fetchImpl = fetch } = {}) => {
  const response = await fetchImpl(API_HEALTH_URL, {
    method: "GET",
    redirect: "follow",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(HEALTH_REQUEST_MS),
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
    throw new Error(`the health endpoint answered with content-type ${plain(contentType) || "(none)"}`);
  }
  const text = await readBoundedBody(response, MAX_HEALTH_BODY_BYTES);
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw new Error("the health endpoint answered with a body that is not valid JSON");
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("the health endpoint answered with JSON that is not an object");
  }
  return { httpStatus: response.status, redirected: response.redirected === true, document };
};

const githubHeaders = (token) => ({
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "x-github-api-version": "2022-11-28",
  "user-agent": "gcd-interval-monitor",
});

const githubGet = async (url, token, fetchImpl) => {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: githubHeaders(token),
    signal: AbortSignal.timeout(GITHUB_REQUEST_MS),
  });
  if (!response.ok) {
    // The status is this API's, not free text from the response body, which is
    // deliberately not read into the report.
    throw new Error(`GitHub answered HTTP ${response.status} for ${plain(url)}`);
  }
  return JSON.parse(await readBoundedBody(response, 4_194_304));
};

/** Only the fields the check reads, so nothing else can reach a report. */
const pickRunFields = (run) => ({
  id: run?.id,
  run_number: run?.run_number,
  conclusion: run?.conclusion,
  head_branch: run?.head_branch,
  created_at: run?.created_at,
});

/**
 * Every `deploy-production` run, newest first, paged back past the interval start.
 *
 * The branch and conclusion filters the API offers are deliberately NOT used.
 * A server-side filter that over-restricted would hide a breaching run and turn
 * this check into a false `PASS`; filtering a complete listing in
 * `evaluateWorkflowRefusals`, from each run's own fields, cannot do that.
 */
export const observeDeployWorkflowRuns = async ({ repository, token, fetchImpl = fetch }) => {
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error("GITHUB_REPOSITORY is not a valid owner/repo value");
  }
  const sinceMs = Date.parse(WORKFLOW_REFUSAL_SINCE);
  const runs = [];
  for (let page = 1; page <= MAX_RUN_PAGES; page += 1) {
    const url = `https://api.github.com/repos/${repository}/actions/workflows/`
      + `${DEPLOY_WORKFLOW_FILE}/runs?per_page=${RUNS_PER_PAGE}&page=${page}`;
    const body = await githubGet(url, token, fetchImpl);
    const pageRuns = body?.workflow_runs;
    if (!Array.isArray(pageRuns)) {
      throw new Error("the GitHub run listing was not in the expected shape");
    }
    for (const run of pageRuns) runs.push(pickRunFields(run));
    // The listing is newest-first, so one run older than the interval start
    // proves the whole interval has been enumerated.
    if (runs.some((run) => Date.parse(run.created_at) < sinceMs)) return runs;
    if (pageRuns.length < RUNS_PER_PAGE) return runs;
  }
  throw new Error(
    `the ${DEPLOY_WORKFLOW_FILE} history could not be enumerated back to`
    + ` ${WORKFLOW_REFUSAL_SINCE} within ${MAX_RUN_PAGES} pages`,
  );
};

/** Current `main`, for context only. A failure here never fails the job. */
export const observeMainSha = async ({ repository, token, fetchImpl = fetch }) => {
  if (!REPOSITORY_PATTERN.test(repository)) return null;
  try {
    const url = `https://api.github.com/repos/${repository}/git/ref/heads/`
      + `${DEPLOY_WORKFLOW_BRANCH}`;
    const body = await githubGet(url, token, fetchImpl);
    const sha = body?.object?.sha;
    return typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
};

/**
 * The single database session: the applied migration set, the server's clock,
 * and the newest brief.
 *
 * One session serves both database checks, so a connection failure fails both
 * together and neither can report a stale success.
 */
export const observeDatabase = async ({ connectionString, runtime }) => {
  const outcome = await withReadOnlySession(
    {
      connectionString,
      runtime,
      label: "interval monitor read-only database read",
      totalMs: MIGRATION_STATE_TOTAL_MS,
      applicationName: "gcd-interval-monitor",
    },
    async (client) => {
      const migrations = await client.query(MIGRATION_STATE_SQL);
      const clock = await client.query(DATABASE_CLOCK_SQL);
      const brief = await client.query(BRIEF_QUEUE_LIVENESS_SQL);
      return {
        migrationNames: migrations.rows.map((row) => row.name),
        now: clock.rows[0]?.now ?? null,
        latest: brief.rows[0]?.latest ?? null,
      };
    },
  );
  const value = outcome.value;
  if (!(value.now instanceof Date) || Number.isNaN(value.now.getTime())) {
    throw new Error("the database did not return a usable current timestamp");
  }
  if (value.latest !== null && !(value.latest instanceof Date)) {
    throw new Error("the database returned a brief timestamp that is not a timestamp");
  }
  if (!value.migrationNames.every((name) => typeof name === "string")) {
    throw new Error("the database returned a migration identifier that is not text");
  }
  return value;
};

/**
 * Run every check, whatever any individual one does.
 *
 * Each observation is isolated, so one failure never suppresses the others:
 * "all results reported before the job exits" is a requirement, not a
 * convenience. The verdict is computed from the complete set afterwards.
 */
export const collect = async ({ env, runtime, fetchImpl = fetch, now = () => new Date() }) => {
  const results = [];
  const startedAt = now().toISOString();

  // --- 1. API artifact and health ---
  try {
    results.push(evaluateApiHealth(await observeApiHealth({ fetchImpl })));
  } catch (error) {
    results.push(errorResult(
      "api-health",
      `${API_HEALTH_URL} reporting status "ok", service "${API_SERVICE_NAME}",`
      + ` commit ${API_ARTIFACT_A}`,
      `The API health endpoint could not be read: ${plain(error?.message) || "unknown failure"}.`
      + " Whether the API is still serving artifact A is UNKNOWN.",
    ));
  }

  // --- 2 and 3. The two database checks, from one read-only session ---
  const connectionString = env[DATABASE_URL_ENV];
  if (typeof connectionString !== "string" || connectionString === "") {
    const cause = `The ${DATABASE_URL_ENV} secret was not available to this run. It is an`
      + ` environment secret on the "${MONITOR_ENVIRONMENT}" GitHub environment, which is`
      + " restricted to main, so a run on any other ref cannot reach it. The applied migration"
      + " set and scheduler liveness are UNKNOWN for this run.";
    results.push(errorResult("migration-set", "the applied set is exactly 001-007, no 008", cause));
    results.push(errorResult("scheduler-liveness", "a recent brief_queue row", cause));
  } else {
    try {
      const observed = await observeDatabase({ connectionString, runtime });
      results.push(evaluateMigrationSet({ names: observed.migrationNames }));
      results.push(evaluateSchedulerLiveness({ latest: observed.latest, now: observed.now }));
    } catch (error) {
      // A fixed category, never the driver's or the server's own message: both
      // can name the database user, host or port.
      const cause = `The read-only database session failed (${categorizeError(error)}). The`
        + " applied migration set and scheduler liveness are UNKNOWN for this run. The driver's"
        + " own message is withheld because it can contain connection identity.";
      results.push(errorResult("migration-set", "the applied set is exactly 001-007, no 008", cause));
      results.push(errorResult("scheduler-liveness", "a recent brief_queue row", cause));
    }
  }

  // --- 4. Deployment gate ---
  results.push(evaluateDeploymentGate({ value: env[DEPLOY_GATE_ENV] }));

  // --- 5. Workflow refusals ---
  const repository = env.GITHUB_REPOSITORY ?? "";
  const token = env.GITHUB_TOKEN ?? "";
  const refusalExpectation = `no ${DEPLOY_WORKFLOW_FILE} run on ${DEPLOY_WORKFLOW_BRANCH}`
    + ` concluded "success" since ${WORKFLOW_REFUSAL_SINCE}`;
  let mainSha = null;
  if (!repository || !token) {
    results.push(errorResult(
      "workflow-refusals",
      refusalExpectation,
      "The job did not supply GITHUB_REPOSITORY and GITHUB_TOKEN, so the production workflow's"
      + " run history was never read. Whether a release occurred is UNKNOWN.",
    ));
  } else {
    try {
      const runs = await observeDeployWorkflowRuns({ repository, token, fetchImpl });
      results.push(evaluateWorkflowRefusals({ runs, inspected: runs.length }));
    } catch (error) {
      results.push(errorResult(
        "workflow-refusals",
        refusalExpectation,
        `The production workflow's run history could not be read: ${plain(error?.message)
          || "unknown failure"}. Whether a release occurred is UNKNOWN.`,
      ));
    }
    mainSha = await observeMainSha({ repository, token, fetchImpl });
  }

  // --- Informational ---
  results.push(describeInterval({ now: now(), mainSha }));

  return { results, startedAt };
};

/**
 * The result set covers exactly the registered gating checks — no more, no fewer.
 *
 * Without this, a check that threw before pushing a record would simply vanish
 * from the report, and the remaining four passing would read as all clear. That
 * is the same defect as reporting "couldn't check" as "checked, fine", arrived
 * at by a different route.
 */
export const missingOrUnexpectedChecks = (results) => {
  const seen = results.map((result) => result.id).filter((id) => GATING_CHECKS.includes(id));
  const missing = GATING_CHECKS.filter((id) => !seen.includes(id));
  const duplicated = seen.filter((id, index) => seen.indexOf(id) !== index);
  return { missing, duplicated };
};

const writeSummary = (text) => {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  try {
    appendFileSync(path, text);
  } catch (error) {
    // Never fatal on its own, and never silent: the console report below still
    // carries every finding.
    process.stderr.write(`could not write the job summary: ${plain(error?.message)}\n`);
  }
};

const annotate = (results) => {
  for (const result of results) {
    if (result.status !== STATUS.DRIFT && result.status !== STATUS.ERROR) continue;
    process.stdout.write(
      `::error title=${plain(result.title)}::${plain(result.status)}:`
      + ` expected ${plain(result.expected)}; observed ${plain(result.observed)}.`
      + ` ${plain(result.detail)}\n`,
    );
  }
};

export const main = async () => {
  // Fail-closed: nothing below clears this except a complete, wholly passing run.
  process.exitCode = 1;

  const runtime = new Runtime();
  runtime.installSignalHandlers((signal) => {
    process.stderr.write(`\nreceived ${signal}: cancelling in-flight read-only checks\n`);
  });

  try {
    const { results, startedAt } = await collect({ env: process.env, runtime });
    const { missing, duplicated } = missingOrUnexpectedChecks(results);
    process.stdout.write(renderConsole(results, { startedAt }));
    writeSummary(renderSummary(results, { startedAt }));
    annotate(results);

    if (missing.length || duplicated.length) {
      process.stdout.write(
        "::error title=Incomplete monitor run::The monitor did not produce a result for every"
        + ` registered check (missing: ${missing.join(", ") || "none"};`
        + ` duplicated: ${duplicated.join(", ") || "none"}). This run proves nothing.\n`,
      );
      return;
    }
    if (overallVerdict(results) === STATUS.PASS) process.exitCode = 0;
  } catch (error) {
    // Any escape at all leaves the exit code at 1 and says so where it is seen.
    const message = plain(error?.message) || "unknown failure";
    process.stdout.write(
      `::error title=Interval monitor failed::The monitor did not complete (${message}).`
      + " No check result should be trusted from this run.\n",
    );
    writeSummary(
      "# M1 to M2 interval monitor\n\n## CHECK FAILED — the monitor did not complete\n\n"
      + "The run ended before every check reported. It is not evidence that production is"
      + " unchanged.\n",
    );
  } finally {
    await runtime.shutdown();
    runtime.removeSignalHandlers();
  }
};

// Run only when this file IS the program, so the offline suite can import the
// observation and assembly functions without performing a production read.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
