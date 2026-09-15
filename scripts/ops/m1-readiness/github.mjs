/**
 * Exact-head CI evidence for the artifact `A`.
 *
 * ## The workflow identity is fixed in source
 *
 * The owner, repository, workflow id, workflow path, workflow name and the
 * complete set of expected job names are constants below. There is no flag and
 * no environment variable that can replace any of them: an operator pointing
 * this at a different workflow would be pointing it at different evidence, and
 * a gate whose subject is configurable is not a gate. The only value read from
 * the environment anywhere in this module is an optional API token, which is
 * used and never recorded.
 *
 * ## What is accepted
 *
 * A run counts as exact-head CI evidence for `A` only when ALL of these hold:
 *
 *   - it belongs to workflow id {@link WORKFLOW_ID} at path {@link WORKFLOW_PATH};
 *   - its head SHA is exactly `A`;
 *   - its event is `push`;
 *   - its status is `completed` and its conclusion is `success`;
 *   - its run attempt is exactly 1.
 *
 * and exactly one such run exists. A run whose `run_attempt` is greater than 1
 * has been re-run, so a later successful retry can never satisfy the gate: the
 * attempt-1 evidence either stands on its own or the gate is not met. Two
 * matching runs are a refusal, not a choice.
 *
 * Its attempt-1 jobs must then be exactly the five expected jobs — no missing
 * job, no duplicate name, no unexpected name — each `completed` and `success`
 * on attempt 1.
 *
 * ## Fail-closed
 *
 * Every response is decoded with fatal UTF-8, parsed by the strict reader, and
 * validated against a closed schema whose enumerations are fixed. A response
 * this module cannot fully understand — including a status or conclusion
 * outside the documented set — yields `NOT ESTABLISHED`, never an optimistic
 * pass.
 */

import { GITHUB_PHASE_TOTAL_MS, GITHUB_REQUEST_MS } from "./deadlines.mjs";
import {
  StrictDataError,
  arr,
  enumOf,
  int,
  nullable,
  obj,
  readStrictJson,
  str,
  validateCounting,
} from "./strictData.mjs";
import { withDeadline } from "./runtime.mjs";

/** The repository this evidence is about. Fixed; not configurable. */
export const OWNER = "Caposhi";
export const REPO = "GCD-Agents";

/** The immutable identity of the CI workflow. Fixed; not configurable. */
export const WORKFLOW_ID = 341_444_424;
export const WORKFLOW_PATH = ".github/workflows/ci.yml";
export const WORKFLOW_NAME = "CI";

/**
 * The five jobs `.github/workflows/ci.yml` produces. The two PostgreSQL entries
 * are the expansions of its `postgres-version: ["16", "18"]` matrix.
 */
export const EXPECTED_JOB_NAMES = Object.freeze([
  "Node 22 offline quality gates",
  "PostgreSQL 16 integration",
  "PostgreSQL 18 integration",
  "AgentShield 1.4.0",
  "Workflow and YAML static validation",
]);

export const EXPECTED_EVENT = "push";
export const EXPECTED_STATUS = "completed";
export const EXPECTED_CONCLUSION = "success";
export const EXPECTED_RUN_ATTEMPT = 1;

/**
 * The branch the artifact must have been pushed to. §4.4 defines the M1
 * artifact as the reviewed head of `main`, so a successful run of the same
 * workflow on any other branch — a fork branch, a release branch, an
 * attacker-named branch — is not evidence about `A`.
 */
export const EXPECTED_BRANCH = "main";

/** The repository the response must itself claim to describe. */
export const REPOSITORY_FULL_NAME = `${OWNER}/${REPO}`;

/** `A` must be a full, lowercase, 40-character object name everywhere. */
const FULL_SHA = /^[0-9a-f]{40}$/;

/** The optional token. Read, used, and never written to evidence. */
export const TOKEN_ENV = "GITHUB_TOKEN";

const API = "https://api.github.com";

/** Ceiling for any single response body. */
export const MAX_RESPONSE_BYTES = 2_000_000;

/** One page only: the runner refuses a truncated view rather than paginating. */
const PER_PAGE = 100;

// --- closed schemas --------------------------------------------------------
//
// `unknown: "discard"` appears ONLY here, on the external-GitHub objects. GitHub
// adds response fields without notice, and a readiness runner that refuses to
// run because an unrelated field appeared is a runner an operator will bypass.
// Discarded keys are counted, never read, and never carried into evidence. Every
// field the gate actually consumes is named, typed and bounded, and the
// evidence schemas in `evidence.mjs` are closed with no discard at all.

const RUN_STATUS = enumOf([
  "completed",
  "action_required",
  "cancelled",
  "failure",
  "neutral",
  "skipped",
  "stale",
  "success",
  "timed_out",
  "in_progress",
  "queued",
  "requested",
  "waiting",
  "pending",
]);

const RUN_CONCLUSION = nullable(
  enumOf([
    "success",
    "failure",
    "neutral",
    "cancelled",
    "skipped",
    "timed_out",
    "action_required",
    "stale",
    "startup_failure",
  ]),
);

/**
 * The repository a run claims to belong to. Required, not discarded: the URL
 * this runner builds already names one repository, but a gate that trusts only
 * the URL it sent cannot detect a redirect, a proxy, or a cached response from
 * elsewhere. The response must say so itself.
 */
const REPOSITORY = obj(
  { full_name: str({ min: 3, max: 256 }), id: int({ min: 1 }) },
  { unknown: "discard" },
);

const RUN = obj(
  {
    id: int({ min: 1 }),
    name: nullable(str({ max: 256 })),
    head_sha: str({ min: 40, max: 40 }),
    path: str({ max: 512 }),
    event: str({ max: 64 }),
    status: RUN_STATUS,
    conclusion: RUN_CONCLUSION,
    workflow_id: int({ min: 1 }),
    // Required, not optional: the gate turns on the attempt number, so a
    // response that omits it cannot be accepted "as if" it were attempt 1.
    run_attempt: int({ min: 1, max: 100_000 }),
    run_number: int({ min: 0 }),
    html_url: str({ max: 1_024 }),
    // Required for the same reason: an absent branch is not `main`.
    head_branch: nullable(str({ max: 512 })),
    repository: REPOSITORY,
  },
  { optional: ["name"], unknown: "discard" },
);

const RUNS_PAGE = obj(
  { total_count: int({ min: 0, max: 1_000_000 }), workflow_runs: arr(RUN, { max: PER_PAGE }) },
  { unknown: "discard" },
);

const JOB = obj(
  {
    id: int({ min: 1 }),
    // Required and checked against the accepted run: a job list is fetched by
    // run id, but a response is free to return jobs from a different run.
    run_id: int({ min: 1 }),
    name: str({ max: 256 }),
    status: RUN_STATUS,
    conclusion: RUN_CONCLUSION,
    run_attempt: int({ min: 1, max: 100_000 }),
  },
  { unknown: "discard" },
);

const JOBS_PAGE = obj(
  { total_count: int({ min: 0, max: 1_000_000 }), jobs: arr(JOB, { max: PER_PAGE }) },
  { unknown: "discard" },
);

/**
 * The fixed identity, as recorded in evidence. Built here so a phase the runner
 * skips still reports the same immutable workflow identity as one that ran.
 *
 * @param {boolean} authenticated whether a token was supplied; the token itself
 *   is never carried
 */
export const ciIdentity = (authenticated) => ({
  owner: OWNER,
  repo: REPO,
  workflow_id: WORKFLOW_ID,
  workflow_path: WORKFLOW_PATH,
  workflow_name: WORKFLOW_NAME,
  expected_jobs: [...EXPECTED_JOB_NAMES],
  expected_event: EXPECTED_EVENT,
  expected_branch: EXPECTED_BRANCH,
  expected_repository: REPOSITORY_FULL_NAME,
  expected_run_attempt: EXPECTED_RUN_ATTEMPT,
  identity_source: "fixed in scripts/ops/m1-readiness/github.mjs; no environment override",
  authenticated,
});

/**
 * A refusal that was never attempted against the API — used when the runner is
 * interrupted before the CI phase, so the evidence still states the identity the
 * gate would have required.
 *
 * @param {string} artifact @param {string} reason a message written in source
 */
export const ciNotEstablished = (artifact, reason) => ({
  status: "NOT ESTABLISHED",
  identity: ciIdentity(false),
  artifact,
  reason,
});

export class GithubEvidenceError extends Error {
  /** @param {string} reason a message written in source */
  constructor(reason) {
    super(reason);
    this.name = "GithubEvidenceError";
  }
}

/**
 * Read a response body under a hard ceiling, without buffering past it.
 *
 * @param {Response} response
 */
const readBoundedBody = async (response) => {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_RESPONSE_BYTES) {
    throw new GithubEvidenceError("response exceeds the fixed size ceiling");
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new GithubEvidenceError("response exceeds the fixed size ceiling");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

/**
 * One GitHub GET, under its own fixed per-operation deadline.
 *
 * @param {object} input
 * @param {string} input.path an API path built from constants in this file
 * @param {object} input.schema
 * @param {import("./runtime.mjs").Runtime} input.runtime
 * @param {string | undefined} input.token
 */
const getJson = async ({ path, schema, runtime, token }) =>
  withDeadline(runtime, `GitHub GET ${path}`, GITHUB_REQUEST_MS, async (signal) => {
    /** @type {Record<string, string>} */
    const headers = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "gcd-m1-readiness-runner",
    };
    if (token) headers.authorization = `Bearer ${token}`;

    const response = await fetch(`${API}${path}`, { method: "GET", headers, signal });
    if (!response.ok) {
      // The status line is ours to report; the body is not repeated, because a
      // GitHub error body can echo request headers.
      throw new GithubEvidenceError(`GitHub responded ${response.status}`);
    }
    const bytes = await readBoundedBody(response);
    const parsed = readStrictJson(bytes, { maxBytes: MAX_RESPONSE_BYTES });
    return validateCounting(parsed, schema);
  });

/**
 * Verify exact-head CI for `A`.
 *
 * Never throws for an evidence failure: a refusal is a recorded verdict, so the
 * evidence file is still written and still says `NOT ESTABLISHED`.
 *
 * @param {object} input
 * @param {string} input.artifact the verified full `HEAD`
 * @param {import("./runtime.mjs").Runtime} input.runtime
 */
export const verifyExactHeadCi = async ({ artifact, runtime }) => {
  const token = process.env[TOKEN_ENV];
  const identity = ciIdentity(Boolean(token));

  try {
    if (!FULL_SHA.test(artifact)) {
      throw new GithubEvidenceError("the artifact is not a full 40-character lowercase object name");
    }
    return await withDeadline(runtime, "CI evidence", GITHUB_PHASE_TOTAL_MS, async () => {
      const runsPage = await getJson({
        path:
          `/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_ID}/runs` +
          `?head_sha=${artifact}&per_page=${PER_PAGE}`,
        schema: RUNS_PAGE,
        runtime,
        token,
      });
      const runs = runsPage.value.workflow_runs;
      // Internal consistency, not just "not truncated": a page whose declared
      // total disagrees with what it actually carries is a response this runner
      // cannot reason about in either direction, so neither reading is used.
      if (runsPage.value.total_count !== runs.length) {
        throw new GithubEvidenceError(
          "the run list's declared total disagrees with the runs it returned",
        );
      }
      if (runsPage.value.total_count > PER_PAGE) {
        throw new GithubEvidenceError("the run list spans more than one page; this runner refuses a partial view");
      }

      const forArtifact = runs.filter(
        (r) =>
          r.head_sha === artifact &&
          r.workflow_id === WORKFLOW_ID &&
          r.path === WORKFLOW_PATH &&
          r.repository.full_name === REPOSITORY_FULL_NAME,
      );
      const accepted = forArtifact.filter(
        (r) =>
          r.event === EXPECTED_EVENT &&
          r.head_branch === EXPECTED_BRANCH &&
          r.status === EXPECTED_STATUS &&
          r.conclusion === EXPECTED_CONCLUSION &&
          r.run_attempt === EXPECTED_RUN_ATTEMPT,
      );
      const retried = forArtifact.filter((r) => r.run_attempt !== EXPECTED_RUN_ATTEMPT);

      if (accepted.length === 0) {
        return {
          status: "NOT ESTABLISHED",
          identity,
          artifact,
          reason:
            retried.length > 0
              ? "the only matching run has been re-run; a later successful retry is not accepted"
              : "no completed, successful, first-attempt push run of this workflow exists for the artifact",
          matching_run_count: forArtifact.length,
          retried_run_count: retried.length,
          discarded_unknown_fields: runsPage.discarded_unknown_fields,
        };
      }
      if (accepted.length > 1) {
        return {
          status: "NOT ESTABLISHED",
          identity,
          artifact,
          reason: "more than one run satisfies the acceptance conditions; duplicates are refused",
          matching_run_count: forArtifact.length,
          retried_run_count: retried.length,
          discarded_unknown_fields: runsPage.discarded_unknown_fields,
        };
      }

      const run = accepted[0];
      const jobsPage = await getJson({
        path:
          `/repos/${OWNER}/${REPO}/actions/runs/${run.id}` +
          `/attempts/${EXPECTED_RUN_ATTEMPT}/jobs?per_page=${PER_PAGE}`,
        schema: JOBS_PAGE,
        runtime,
        token,
      });
      const jobs = jobsPage.value.jobs;
      if (jobsPage.value.total_count !== jobs.length) {
        throw new GithubEvidenceError(
          "the job list's declared total disagrees with the jobs it returned",
        );
      }
      if (jobsPage.value.total_count > PER_PAGE) {
        throw new GithubEvidenceError("the job list spans more than one page; this runner refuses a partial view");
      }
      // Every job must belong to the run that was accepted. The list was
      // requested by run id, but nothing about a response guarantees that is
      // what came back, and a job from another run is evidence about that run.
      const foreign = jobs.filter((j) => j.run_id !== run.id);
      if (foreign.length > 0) {
        throw new GithubEvidenceError("the job list contains a job belonging to a different run");
      }

      const names = jobs.map((j) => j.name);
      const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
      const unexpected = names.filter((n) => !EXPECTED_JOB_NAMES.includes(n));
      const missing = EXPECTED_JOB_NAMES.filter((n) => !names.includes(n));
      const notSucceeded = jobs
        .filter(
          (j) =>
            j.status !== EXPECTED_STATUS ||
            j.conclusion !== EXPECTED_CONCLUSION ||
            j.run_attempt !== EXPECTED_RUN_ATTEMPT,
        )
        .map((j) => j.name);

      const failures = [];
      if (jobs.length !== EXPECTED_JOB_NAMES.length) {
        failures.push(`expected ${EXPECTED_JOB_NAMES.length} jobs, saw ${jobs.length}`);
      }
      if (duplicates.length > 0) failures.push("duplicate job names");
      if (unexpected.length > 0) failures.push("unexpected job names");
      if (missing.length > 0) failures.push("missing job names");
      if (notSucceeded.length > 0) failures.push("a job did not succeed on attempt 1");

      return {
        status: failures.length === 0 ? "ESTABLISHED" : "NOT ESTABLISHED",
        identity,
        artifact,
        run: {
          id: run.id,
          run_number: run.run_number,
          run_attempt: run.run_attempt,
          event: run.event,
          status: run.status,
          conclusion: run.conclusion,
          head_sha: run.head_sha,
          head_branch: run.head_branch,
          path: run.path,
          html_url: run.html_url,
        },
        jobs: jobs.map((j) => ({
          name: j.name,
          status: j.status,
          conclusion: j.conclusion,
          run_attempt: j.run_attempt,
        })),
        job_count: jobs.length,
        duplicate_job_names: [...new Set(duplicates)],
        unexpected_job_names: unexpected,
        missing_job_names: missing,
        jobs_not_succeeded_on_attempt_1: notSucceeded,
        retried_run_count: retried.length,
        matching_run_count: forArtifact.length,
        failures,
        discarded_unknown_fields:
          runsPage.discarded_unknown_fields + jobsPage.discarded_unknown_fields,
      };
    });
  } catch (error) {
    // A transport failure, a deadline, an interrupt, or a response the strict
    // contract refuses. None of them may leak a token or a response body.
    const reason =
      error instanceof GithubEvidenceError
        ? error.message
        : error instanceof StrictDataError
          ? `the response did not satisfy the strict data contract (${error.reason})`
          : "the CI evidence read did not complete";
    return { status: "NOT ESTABLISHED", identity, artifact, reason };
  }
};
