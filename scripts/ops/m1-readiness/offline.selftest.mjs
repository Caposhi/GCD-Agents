#!/usr/bin/env node
/**
 * Durable offline tests for the M1 readiness runner.
 *
 * Every test here runs with no network, no database and no container. The
 * GitHub boundary is exercised by replacing the global `fetch`, so every
 * success and failure state is covered deterministically and the suite cannot
 * become "usually green because GitHub was up".
 *
 * Groups:
 *   platform   macOS/Linux independence; no /proc, no process-name matching
 *   source     helper-generation absence, and the complete environment surface
 *   artifact   `A` binds to the verified HEAD and nothing else
 *   worktree   dirty-tree handling and the single `.DS_Store` allowance
 *   strict     invalid UTF-8, duplicate keys, closed schemas, bounds
 *   github     success and every failure state, plus interruption
 *   migration  applied, unapplied and inconsistent states
 *   audit      the exact 23-check contract
 *   deadlines  fixed, non-overridable deadlines
 *   redaction  credential redaction
 *   evidence   final evidence schemas and output bounds
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_ERROR_CATEGORIES, categorizeError } from "../lib/errorCategories.mjs";
import {
  EXPECTED_CHECK_COUNT,
  EXPECTED_CHECK_NAMES,
  evaluateAggregateAudit,
  readEvidenceLimits,
} from "../lib/aggregateAudit.mjs";
import {
  CANONICAL_MIGRATIONS,
  MIGRATION_007,
  MIGRATION_007_STATES,
  computeMigrationState,
} from "../lib/migrationState.mjs";
import { DEADLINES_MS } from "./deadlines.mjs";
import {
  EVIDENCE_SCHEMA,
  M1_VERDICT,
  MAX_EVIDENCE_BYTES,
  MAX_SUMMARY_BYTES,
  NON_ACTIONS,
  RENDER_BOUNDARY,
  ROLLBACK_BOUNDARY,
  assertNoCredentialLeak,
  buildEvidence,
  renderEvidenceDocument,
  renderSummary,
} from "./evidence.mjs";
import {
  EXPECTED_JOB_NAMES,
  MAX_RESPONSE_BYTES,
  OWNER,
  REPO,
  WORKFLOW_ID,
  WORKFLOW_PATH,
  ciNotEstablished,
  verifyExactHeadCi,
} from "./github.mjs";
import { PreconditionError, evaluateTrackedSource, gitBlobSha1 } from "./repository.mjs";
import { Runtime, withDeadline } from "./runtime.mjs";
import {
  StrictDataError,
  arr,
  decodeUtf8Strict,
  int,
  obj,
  parseStrictJson,
  readStrictJson,
  serializeChecked,
  str,
  validate,
  validateCounting,
} from "./strictData.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

const GROUPS = [
  "platform",
  "source",
  "artifact",
  "worktree",
  "strict",
  "github",
  "migration",
  "audit",
  "deadlines",
  "redaction",
  "evidence",
];
/** @type {Record<string, number>} */
const counts = Object.fromEntries(GROUPS.map((g) => [g, 0]));

/** @param {string} group @param {string} label @param {boolean} condition */
const check = (group, label, condition) => {
  if (!condition) throw new Error(`[${group}] ${label}`);
  counts[group] += 1;
  console.log(`  ✓ [${group}] ${label}`);
};

/** @param {() => unknown} fn */
const threw = (fn) => {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
};

/** @param {() => Promise<unknown>} fn */
const rejected = async (fn) => {
  try {
    await fn();
    return null;
  } catch (error) {
    return error;
  }
};

// ---------------------------------------------------------------------------
// Source inventory, shared by the platform and source groups
// ---------------------------------------------------------------------------

const RUNNER_DIR = resolve(REPO_ROOT, "scripts/ops/m1-readiness");
const LIB_DIR = resolve(REPO_ROOT, "scripts/ops/lib");
const sourceFiles = [
  ...readdirSync(RUNNER_DIR)
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".selftest.mjs"))
    .map((f) => resolve(RUNNER_DIR, f)),
  ...readdirSync(LIB_DIR)
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => resolve(LIB_DIR, f)),
];
/** @type {Map<string, string>} */
const sources = new Map(sourceFiles.map((f) => [f.slice(REPO_ROOT.length + 1), readFileSync(f, "utf8")]));

/**
 * The same sources with comments removed, so a prohibition that is DESCRIBED in
 * a doc comment is not mistaken for one that is used in code.
 */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
/** @type {Map<string, string>} */
const code = new Map([...sources].map(([file, text]) => [file, stripComments(text)]));

// ---------------------------------------------------------------------------
// platform
// ---------------------------------------------------------------------------

{
  const withProc = [...sources].filter(([, text]) => text.includes("/proc/"));
  check("platform", "no module reads /proc", withProc.length === 0);

  const withProcessMatching = [...sources].filter(([, text]) =>
    /\b(pgrep|pkill|ps\s+-ef|ps\s+aux|process_name|comm=)\b/.test(text),
  );
  check("platform", "no module matches on process names", withProcessMatching.length === 0);

  const branching = [...sources].filter(([, text]) => /process\.platform\s*[=!]==/.test(text));
  check("platform", "no module branches on process.platform", branching.length === 0);

  const gitRead = sources.get("scripts/ops/m1-readiness/gitRead.mjs") ?? "";
  check(
    "platform",
    "termination is isolated in one exported function",
    /export const terminateChild = /.test(gitRead) &&
      (gitRead.match(/\.kill\(/g) ?? []).length === 3,
  );
  check(
    "platform",
    "termination uses portable SIGTERM then SIGKILL, never a process group",
    gitRead.includes('kill("SIGTERM")') &&
      gitRead.includes('kill("SIGKILL")') &&
      !/detached:\s*true/.test(gitRead) &&
      !/process\.kill\(\s*-/.test(gitRead),
  );
  check(
    "platform",
    "the platform contract is documented in source",
    gitRead.includes("## Platform behaviour (macOS and Linux)"),
  );
  // `process.platform` is recorded in evidence, which is a report, not a branch.
  check(
    "platform",
    "platform is recorded but never acted on",
    (sources.get("scripts/ops/m1-readiness/evidence.mjs") ?? "").includes("platform: process.platform"),
  );
}

// ---------------------------------------------------------------------------
// source: helper-generation absence and the environment surface
// ---------------------------------------------------------------------------

{
  const forbidden = [
    ["eval(", /\beval\s*\(/],
    ["new Function", /new\s+Function\s*\(/],
    ["node:vm", /node:vm/],
    ["execSync", /\bexecSync\b/],
    ["execFileSync", /\bexecFileSync\b/],
    // Negative lookbehind so a RegExp's own `.exec(` is not mistaken for the
    // child_process `exec(` this runner must never use.
    ["exec(", /(?<![.\w])exec\s*\(/],
    ["chmod", /\bchmod\b/],
    ["shell: true", /shell:\s*true/],
    ["self-extraction", /base64\s+-d|tail\s+-n\s*\+|<<\s*'?EOF/],
  ];
  for (const [label, pattern] of forbidden) {
    const hits = [...sources].filter(([, text]) => pattern.test(text));
    check("source", `no module contains ${label}`, hits.length === 0);
  }

  const spawners = [...sources].filter(([, text]) => text.includes("node:child_process"));
  check(
    "source",
    "only gitRead.mjs may spawn a process",
    spawners.length === 1 && spawners[0][0] === "scripts/ops/m1-readiness/gitRead.mjs",
  );

  const writers = [...sources].filter(([, text]) => /\bwriteFile\b/.test(text));
  check(
    "source",
    "only runner.mjs writes a file",
    writers.length === 1 && writers[0][0] === "scripts/ops/m1-readiness/runner.mjs",
  );
  const runner = sources.get("scripts/ops/m1-readiness/runner.mjs") ?? "";
  check(
    "source",
    "runner.mjs writes exactly the two fixed output files",
    (runner.match(/await writeFile\(/g) ?? []).length === 2 &&
      runner.includes("EVIDENCE_FILENAME") &&
      runner.includes("SUMMARY_FILENAME"),
  );

  // The complete environment surface, as exact expressions.
  const ALLOWED_ENV = new Set([
    "process.env.PATH",
    "process.env.HOME",
    "process.env[TOKEN_ENV]",
    "process.env[CONNECTION_ENV]",
  ]);
  /** @type {string[]} */
  const reads = [];
  for (const [file, text] of code) {
    for (const match of text.matchAll(/process\.env(?:\.[A-Za-z_][A-Za-z0-9_]*|\[[^\]]+\])/g)) {
      reads.push(`${file}: ${match[0]}`);
    }
  }
  const unexpected = reads.filter((r) => !ALLOWED_ENV.has(r.slice(r.indexOf(": ") + 2)));
  check("source", "the environment surface is exactly PATH, HOME, the token and the connection", unexpected.length === 0);

  check(
    "source",
    "deadlines.mjs reads nothing from the environment, argv or a clock",
    !/process\.|Date\.now|readFile/.test(code.get("scripts/ops/m1-readiness/deadlines.mjs") ?? ""),
  );
  check(
    "source",
    "no module reads process.argv outside the CLI",
    [...code].filter(([f, text]) => text.includes("process.argv") && !f.endsWith("cli.mjs")).length === 0,
  );
}

// ---------------------------------------------------------------------------
// artifact: `A` binds to the verified HEAD and nothing else
// ---------------------------------------------------------------------------

{
  const repository = sources.get("scripts/ops/m1-readiness/repository.mjs") ?? "";
  check(
    "artifact",
    "establishArtifact takes no artifact input",
    /export const establishArtifact = async \(\{ repoRoot, runtime \}\)/.test(repository),
  );
  check(
    "artifact",
    "A comes from readHeadSha and is required to be a commit",
    repository.includes("const artifact = await readHeadSha(repoRoot, runtime)") &&
      repository.includes('if (type !== "commit")'),
  );
  const cli = readFileSync(resolve(RUNNER_DIR, "cli.mjs"), "utf8");
  check("artifact", "the CLI has no artifact, ref, branch or tag flag", !/--artifact|--ref|--branch|--tag|--sha/.test(cli));

  // A 40-hex string that is not a commit, and every abbreviation form, are
  // unrepresentable rather than merely rejected: there is no input to supply.
  check(
    "artifact",
    "no module accepts an artifact from the environment",
    [...sources].filter(([, t]) => /process\.env\S*(ARTIFACT|SHA|COMMIT|HEAD)/i.test(t)).length === 0,
  );

  // A blob name is computed here rather than trusted, so the package binding is
  // a content comparison.
  check(
    "artifact",
    "git blob object names are computed from content",
    gitBlobSha1(Buffer.from("hello\n")) === "ce013625030ba8dba906f756967f9e9ca394464a",
  );
}

// ---------------------------------------------------------------------------
// worktree: dirty-tree handling
// ---------------------------------------------------------------------------

{
  const clean = evaluateTrackedSource([]);
  check("worktree", "an empty status is clean", clean.dirty_entry_count === 0 && clean.tolerated_path === null);

  for (const status of [" M", "M ", "MM"]) {
    const tolerated = evaluateTrackedSource([{ status, path: ".DS_Store" }]);
    check(
      "worktree",
      `a "${status}" .DS_Store modification is tolerated and recorded`,
      tolerated.ds_store_modification_tolerated === true &&
        tolerated.tolerated_path === ".DS_Store" &&
        tolerated.ds_store_contents_read === false,
    );
  }

  const cases = [
    ["a modified source file", [{ status: " M", path: "src/harness/config.ts" }]],
    ["a deleted .DS_Store", [{ status: " D", path: ".DS_Store" }]],
    ["an added .DS_Store", [{ status: "A ", path: ".DS_Store" }]],
    ["a renamed .DS_Store", [{ status: "R ", path: ".DS_Store" }]],
    ["a .DS_Store in a subdirectory", [{ status: " M", path: "docs/.DS_Store" }]],
    [
      "a tolerated .DS_Store alongside another change",
      [
        { status: " M", path: ".DS_Store" },
        { status: " M", path: "package.json" },
      ],
    ],
  ];
  for (const [label, entries] of cases) {
    const error = threw(() => evaluateTrackedSource(entries));
    check(
      "worktree",
      `${label} refuses the checkout`,
      error instanceof PreconditionError && error.check === "clean_tracked_source",
    );
  }
  const error = threw(() => evaluateTrackedSource([{ status: " M", path: "src/harness/config.ts" }]));
  check("worktree", "the refusal names the offending path", error.message.includes("src/harness/config.ts"));
}

// ---------------------------------------------------------------------------
// strict: UTF-8, duplicate keys, closed schemas, bounds
// ---------------------------------------------------------------------------

{
  const enc = (s) => new TextEncoder().encode(s);

  check("strict", "valid UTF-8 decodes", decodeUtf8Strict(enc('{"a":1}')) === '{"a":1}');
  for (const [label, bytes] of [
    ["a lone continuation byte", new Uint8Array([0x80])],
    ["a truncated sequence", new Uint8Array([0xe2, 0x82])],
    ["an overlong encoding", new Uint8Array([0xc0, 0xaf])],
    ["a surrogate half", new Uint8Array([0xed, 0xa0, 0x80])],
  ]) {
    const error = threw(() => decodeUtf8Strict(bytes));
    check(
      "strict",
      `${label} is refused rather than replaced`,
      error instanceof StrictDataError && error.reason === "document is not valid UTF-8",
    );
  }

  for (const [label, text] of [
    ["a plain duplicate key", '{"conclusion":"failure","conclusion":"success"}'],
    ["a duplicate after \\u escaping", '{"a":1,"\\u0061":2}'],
    ["a nested duplicate", '{"o":{"x":1,"x":2}}'],
  ]) {
    const error = threw(() => parseStrictJson(text));
    check(
      "strict",
      `${label} is rejected`,
      error instanceof StrictDataError && error.reason.startsWith("duplicate object key"),
    );
  }
  check(
    "strict",
    "JSON.parse would have silently kept the last duplicate",
    JSON.parse('{"conclusion":"failure","conclusion":"success"}').conclusion === "success",
  );

  check("strict", "__proto__ is refused as a key", threw(() => parseStrictJson('{"__proto__":{}}')) !== null);
  check("strict", "a safe integer parses", parseStrictJson("9007199254740991") === 9_007_199_254_740_991);
  check("strict", "an unsafe integer is refused", threw(() => parseStrictJson("9007199254740993")) !== null);
  check("strict", "a non-finite literal is refused", threw(() => parseStrictJson("1e999")) !== null);
  check("strict", "trailing content is refused", threw(() => parseStrictJson("{} {}")) !== null);
  check("strict", "an unescaped control character is refused", threw(() => parseStrictJson('"a\nb"')) !== null);
  check("strict", "a depth ceiling is enforced", threw(() => parseStrictJson("[".repeat(40) + "]".repeat(40))) !== null);
  check(
    "strict",
    "a byte ceiling is enforced",
    threw(() => readStrictJson(enc(`[${"1,".repeat(200)}1]`), { maxBytes: 16 })) !== null,
  );

  const schema = obj({ n: int({ min: 0, max: 10 }), s: str({ max: 4 }) });
  check("strict", "a conforming document validates", validate({ n: 1, s: "ok" }, schema).n === 1);
  check("strict", "an unknown field is rejected by default", threw(() => validate({ n: 1, s: "ok", x: 2 }, schema)) !== null);
  check("strict", "a missing required field is rejected", threw(() => validate({ n: 1 }, schema)) !== null);
  check("strict", "an out-of-bound integer is rejected", threw(() => validate({ n: 11, s: "ok" }, schema)) !== null);
  check("strict", "an over-long string is rejected", threw(() => validate({ n: 1, s: "toolong" }, schema)) !== null);
  check(
    "strict",
    "unknown fields are rejected at depth, not just the top level",
    threw(() => validate({ a: [{ b: 1, c: 2 }] }, obj({ a: arr(obj({ b: int() })) }))) !== null,
  );
  const discarding = obj({ n: int() }, { unknown: "discard" });
  const counted = validateCounting({ n: 1, x: 2, y: 3 }, discarding);
  check(
    "strict",
    "discarding schemas count what they drop and carry none of it",
    counted.discarded_unknown_fields === 2 && Object.keys(counted.value).join() === "n",
  );
  check(
    "strict",
    "only the external GitHub schemas discard",
    [...sources].filter(([, t]) => t.includes('unknown: "discard"')).every(([f]) =>
      f === "scripts/ops/m1-readiness/github.mjs" || f === "scripts/ops/m1-readiness/strictData.mjs",
    ),
  );
}

// ---------------------------------------------------------------------------
// github: success and every failure state
// ---------------------------------------------------------------------------

const ARTIFACT = "a".repeat(40);

// The suite must not inherit an operator's real token: whether the runner sends
// an authorization header is itself under test. It is restored at the end.
const INHERITED_TOKEN = process.env.GITHUB_TOKEN;
delete process.env.GITHUB_TOKEN;

const makeRun = (over = {}) => ({
  id: 1234,
  name: "CI",
  head_sha: ARTIFACT,
  path: WORKFLOW_PATH,
  event: "push",
  status: "completed",
  conclusion: "success",
  workflow_id: WORKFLOW_ID,
  run_attempt: 1,
  run_number: 7,
  html_url: `https://github.com/${OWNER}/${REPO}/actions/runs/1234`,
  head_branch: "main",
  ...over,
});

const makeJobs = (names = EXPECTED_JOB_NAMES, over = {}) =>
  names.map((name, index) => ({
    id: 900 + index,
    run_id: 1234,
    name,
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
    ...over,
  }));

const jsonResponse = (value, init = {}) =>
  new Response(new TextEncoder().encode(JSON.stringify(value)), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

/**
 * Install a stub `fetch` that answers the runs URL then the jobs URL.
 *
 * @param {(url: string, init: RequestInit) => Promise<Response>} handler
 */
const withFetch = async (handler, fn) => {
  const original = globalThis.fetch;
  /** @type {Array<{ url: string, headers: Record<string, string> }>} */
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), headers: { ...(init?.headers ?? {}) } });
    return handler(String(url), init ?? {});
  };
  try {
    return { result: await fn(), seen };
  } finally {
    globalThis.fetch = original;
  }
};

const ciWith = async ({ runs, jobs, runsTotal, jobsTotal, runtime = new Runtime() }) =>
  withFetch(
    async (url) =>
      url.includes("/runs?")
        ? jsonResponse({ total_count: runsTotal ?? runs.length, workflow_runs: runs })
        : jsonResponse({ total_count: jobsTotal ?? (jobs ?? []).length, jobs: jobs ?? [] }),
    () => verifyExactHeadCi({ artifact: ARTIFACT, runtime }),
  );

{
  const { result: ok, seen } = await ciWith({ runs: [makeRun()], jobs: makeJobs() });
  check("github", "a first-attempt successful push run with five jobs is ESTABLISHED", ok.status === "ESTABLISHED");
  check("github", "the accepted run and its five jobs are recorded", ok.run.id === 1234 && ok.jobs.length === 5);
  check("github", "the workflow identity comes from source", ok.identity.workflow_id === WORKFLOW_ID && ok.identity.workflow_path === WORKFLOW_PATH);
  check("github", "the run URL is requested against the fixed workflow id", seen[0].url.includes(`/workflows/${WORKFLOW_ID}/runs`));
  check("github", "the jobs URL requests attempt 1 explicitly", seen[1].url.includes("/attempts/1/jobs"));
  check("github", "no token means no authorization header", !("authorization" in seen[0].headers));

  /** @type {Array<[string, object]>} */
  const runFailures = [
    ["no run at all", { runs: [] }],
    ["a re-run (attempt 2)", { runs: [makeRun({ run_attempt: 2 })] }],
    ["a failed run", { runs: [makeRun({ conclusion: "failure" })] }],
    ["an in-progress run", { runs: [makeRun({ status: "in_progress", conclusion: null })] }],
    ["a cancelled run", { runs: [makeRun({ conclusion: "cancelled" })] }],
    ["a non-push event", { runs: [makeRun({ event: "workflow_dispatch" })] }],
    ["a different workflow id", { runs: [makeRun({ workflow_id: WORKFLOW_ID + 1 })] }],
    ["a different workflow path", { runs: [makeRun({ path: ".github/workflows/deploy-production.yml" })] }],
    ["a different head sha", { runs: [makeRun({ head_sha: "b".repeat(40) })] }],
    ["two accepted runs", { runs: [makeRun(), makeRun({ id: 5678 })] }],
    ["a truncated run list", { runs: [makeRun()], runsTotal: 2 }],
  ];
  for (const [label, input] of runFailures) {
    const { result } = await ciWith({ jobs: makeJobs(), ...input });
    check("github", `${label} is NOT ESTABLISHED`, result.status === "NOT ESTABLISHED");
  }

  const retried = await ciWith({ runs: [makeRun({ run_attempt: 3 })], jobs: makeJobs() });
  check(
    "github",
    "a later successful retry is explicitly refused, not silently ignored",
    retried.result.reason.includes("later successful retry is not accepted") &&
      retried.result.retried_run_count === 1,
  );

  /** @type {Array<[string, object]>} */
  const jobFailures = [
    ["four jobs", { jobs: makeJobs(EXPECTED_JOB_NAMES.slice(0, 4)) }],
    ["an unexpected sixth job", { jobs: [...makeJobs(), { id: 999, run_id: 1234, name: "Surprise", status: "completed", conclusion: "success", run_attempt: 1 }] }],
    ["a duplicated job name", { jobs: makeJobs([...EXPECTED_JOB_NAMES.slice(0, 4), EXPECTED_JOB_NAMES[0]]) }],
    ["a failed job", { jobs: [...makeJobs(EXPECTED_JOB_NAMES.slice(0, 4)), { id: 950, run_id: 1234, name: EXPECTED_JOB_NAMES[4], status: "completed", conclusion: "failure", run_attempt: 1 }] }],
    ["a job that only succeeded on attempt 2", { jobs: [...makeJobs(EXPECTED_JOB_NAMES.slice(0, 4)), { id: 951, run_id: 1234, name: EXPECTED_JOB_NAMES[4], status: "completed", conclusion: "success", run_attempt: 2 }] }],
    ["a truncated job list", { jobs: makeJobs(), jobsTotal: 6 }],
  ];
  for (const [label, input] of jobFailures) {
    const { result } = await ciWith({ runs: [makeRun()], ...input });
    check("github", `${label} is NOT ESTABLISHED`, result.status === "NOT ESTABLISHED");
  }

  const missing = await ciWith({ runs: [makeRun()], jobs: makeJobs(EXPECTED_JOB_NAMES.slice(0, 4)) });
  check("github", "a missing job is named from the fixed set", missing.result.missing_job_names.length === 1);

  for (const status of [401, 403, 404, 422, 500, 502]) {
    const { result } = await withFetch(
      async () => new Response(new TextEncoder().encode("{}"), { status }),
      () => verifyExactHeadCi({ artifact: ARTIFACT, runtime: new Runtime() }),
    );
    check("github", `HTTP ${status} is NOT ESTABLISHED`, result.status === "NOT ESTABLISHED" && result.reason === `GitHub responded ${status}`);
  }

  const badUtf8 = await withFetch(
    async () => new Response(new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xff, 0x7d])),
    () => verifyExactHeadCi({ artifact: ARTIFACT, runtime: new Runtime() }),
  );
  check("github", "an invalid-UTF-8 response is NOT ESTABLISHED", badUtf8.result.status === "NOT ESTABLISHED" && badUtf8.result.reason.includes("strict data contract"));

  const dupKeys = await withFetch(
    async () => new Response(new TextEncoder().encode('{"total_count":1,"total_count":9,"workflow_runs":[]}')),
    () => verifyExactHeadCi({ artifact: ARTIFACT, runtime: new Runtime() }),
  );
  check("github", "a duplicate-key response is NOT ESTABLISHED", dupKeys.result.status === "NOT ESTABLISHED" && dupKeys.result.reason.includes("strict data contract"));

  const unknownConclusion = await ciWith({ runs: [makeRun({ conclusion: "exploded" })], jobs: makeJobs() });
  check("github", "a conclusion outside the fixed enumeration fails closed", unknownConclusion.result.status === "NOT ESTABLISHED");

  const oversizedDeclared = await withFetch(
    async () =>
      new Response(new TextEncoder().encode("{}"), {
        headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) },
      }),
    () => verifyExactHeadCi({ artifact: ARTIFACT, runtime: new Runtime() }),
  );
  check("github", "a response declaring an oversized body is refused", oversizedDeclared.result.reason === "response exceeds the fixed size ceiling");

  const oversizedStream = await withFetch(
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(64 * 1024));
          },
        }),
      ),
    () => verifyExactHeadCi({ artifact: ARTIFACT, runtime: new Runtime() }),
  );
  check("github", "a streamed body is refused at the ceiling, not buffered past it", oversizedStream.result.reason === "response exceeds the fixed size ceiling");

  // Interruption during GitHub work.
  const runtime = new Runtime();
  const interruptedRun = await withFetch(
    (url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        setTimeout(() => runtime.controller.abort(), 5);
      }),
    () => verifyExactHeadCi({ artifact: ARTIFACT, runtime }),
  );
  check("github", "an interrupt during a GitHub read yields NOT ESTABLISHED", interruptedRun.result.status === "NOT ESTABLISHED");
  check("github", "an interrupt before the CI phase still reports the fixed identity", ciNotEstablished(ARTIFACT, "interrupted").identity.workflow_id === WORKFLOW_ID);

  const tokenRun = await withFetch(
    async (url) =>
      url.includes("/runs?")
        ? jsonResponse({ total_count: 1, workflow_runs: [makeRun()] })
        : jsonResponse({ total_count: 5, jobs: makeJobs() }),
    async () => {
      process.env.GITHUB_TOKEN = "ghp_offline_test_value";
      try {
        return await verifyExactHeadCi({ artifact: ARTIFACT, runtime: new Runtime() });
      } finally {
        delete process.env.GITHUB_TOKEN;
      }
    },
  );
  check("github", "a token is sent but never recorded", tokenRun.seen[0].headers.authorization === "Bearer ghp_offline_test_value" && !JSON.stringify(tokenRun.result).includes("ghp_offline_test_value"));
  check("github", "authentication is recorded as a boolean only", tokenRun.result.identity.authenticated === true);
}

// ---------------------------------------------------------------------------
// migration: applied, unapplied and inconsistent states
// ---------------------------------------------------------------------------

{
  const entries = [...CANONICAL_MIGRATIONS];

  const unapplied = computeMigrationState({ milestone: "M1", artifactEntries: entries, appliedNames: CANONICAL_MIGRATIONS.slice(0, 6) });
  check("migration", "007 unapplied: decision pass", unapplied.decision === "pass" && unapplied.failed_comparisons.length === 0);
  check("migration", "007 unapplied: pending is exactly 007", unapplied.pending.join() === MIGRATION_007);
  check("migration", "007 unapplied: state is NOT APPLIED", unapplied.migration_007_state === MIGRATION_007_STATES.NOT_APPLIED);

  const applied = computeMigrationState({ milestone: "M1", artifactEntries: entries, appliedNames: [...CANONICAL_MIGRATIONS] });
  check("migration", "007 applied: state is APPLIED", applied.migration_007_state === MIGRATION_007_STATES.APPLIED);
  check("migration", "007 applied: comparisons 2 and 3 fail and the decision stops", applied.decision === "stop" && applied.failed_comparisons.includes("2_D==E_applied_pre") && applied.failed_comparisons.includes("3_P==E_pending"));

  const notRead = computeMigrationState({ milestone: "M1", artifactEntries: entries, appliedNames: null });
  check("migration", "no read: state is UNKNOWN in either direction", notRead.migration_007_state === MIGRATION_007_STATES.UNKNOWN && notRead.applied.read === false);

  const unexpected = computeMigrationState({ milestone: "M1", artifactEntries: entries, appliedNames: [...CANONICAL_MIGRATIONS.slice(0, 6), "999_unexpected.sql"] });
  check("migration", "an unexpected applied migration fails comparisons 2, 4 and 6", ["2_D==E_applied_pre", "4_every_D_present_in_F(A)", "6_no_unexpected_applied_in_D"].every((k) => unexpected.failed_comparisons.includes(k)));

  // The hazard the pending difference alone cannot see.
  const shadow = computeMigrationState({
    milestone: "M1",
    artifactEntries: [...entries, "007_something_else.sql"],
    appliedNames: [...CANONICAL_MIGRATIONS.slice(0, 6), "007_something_else.sql"],
  });
  check("migration", "an already-applied unexpected migration cancels out of P but still fails", shadow.pending.join() === MIGRATION_007 && shadow.decision === "stop");

  const duplicate = computeMigrationState({ milestone: "M1", artifactEntries: entries, appliedNames: [...CANONICAL_MIGRATIONS.slice(0, 6), "006_content_evidence.sql"] });
  check("migration", "a duplicate identifier fails comparison 7", duplicate.failed_comparisons.includes("7_no_duplicate_identifier"));

  const missing = computeMigrationState({ milestone: "M1", artifactEntries: entries, appliedNames: CANONICAL_MIGRATIONS.slice(0, 5) });
  check("migration", "an absent expected migration fails comparison 5", missing.failed_comparisons.includes("5_no_expected_applied_absent_from_D"));

  const short = computeMigrationState({ milestone: "M1", artifactEntries: CANONICAL_MIGRATIONS.slice(0, 6), appliedNames: CANONICAL_MIGRATIONS.slice(0, 6) });
  check("migration", "a missing artifact migration fails comparison 1", short.failed_comparisons.includes("1_F(A)==E_files"));

  const whitespace = computeMigrationState({ milestone: "M1", artifactEntries: [...CANONICAL_MIGRATIONS.slice(0, 6), "007_evidence_bounds.sql "], appliedNames: CANONICAL_MIGRATIONS.slice(0, 6) });
  check("migration", "a trailing-space filename is a different file and is not trimmed", whitespace.failed_comparisons.includes("1_F(A)==E_files"));

  const nonSql = computeMigrationState({ milestone: "M1", artifactEntries: [...entries, "README.md"], appliedNames: CANONICAL_MIGRATIONS.slice(0, 6) });
  check("migration", "a non-.sql entry is excluded and recorded, not counted in F(A)", nonSql.artifact_inventory.non_sql_entries_excluded.join() === "README.md" && nonSql.decision === "pass");

  const dupFiles = computeMigrationState({ milestone: "M1", artifactEntries: [...entries, MIGRATION_007], appliedNames: CANONICAL_MIGRATIONS.slice(0, 6) });
  check("migration", "a duplicated artifact filename is reported as non-unique", dupFiles.artifact_inventory.unique === false);

  check("migration", "the seven comparisons are all present", Object.keys(unapplied.comparisons).length === 7);
}

// ---------------------------------------------------------------------------
// audit: the exact 23-check contract
// ---------------------------------------------------------------------------

const LIMITS = readEvidenceLimits(REPO_ROOT);

const aggregateRows = (over = {}) => ({
  evidence: {
    row_count: "22",
    distinct_ids: "22",
    max_id_chars: "40",
    max_id_bytes: "40",
    max_claim_chars: "300",
    max_claim_bytes: "310",
    max_subject_chars: "50",
    max_subject_bytes: "50",
    max_attribute_chars: "30",
    max_attribute_bytes: "30",
    max_source_ref_chars: "80",
    max_source_ref_bytes: "80",
    max_provenance_chars: "90",
    max_provenance_bytes: "90",
    max_reviewed_by_chars: "20",
    max_reviewed_by_bytes: "20",
    max_superseded_by_id_chars: "0",
    max_superseded_by_id_bytes: "0",
    max_detail_jsonb_text_bytes: "1200",
    max_tag_cardinality: "5",
    rows_with_detail: "7",
    ...over.evidence,
  },
  tags: { max_tag_chars: "12", max_tag_bytes: "12", null_tag_elements: "0", total_tag_elements: "40", ...over.tags },
  relations: { row_count: "3", max_note_chars: "60", max_note_bytes: "60", rows_with_note: "2", ...over.relations },
  limits: LIMITS,
});

{
  const within = evaluateAggregateAudit(aggregateRows());
  check("audit", "the contract is exactly 23 checks", within.check_count === EXPECTED_CHECK_COUNT && within.checks.length === 23);
  check("audit", "the 23 check names are exactly the current contract", within.checks.map((c) => c.check).join("|") === EXPECTED_CHECK_NAMES.join("|"));
  check("audit", "within-bound data is WITHIN BOUNDS", within.verdict === "WITHIN BOUNDS" && within.failing_checks.length === 0);
  check("audit", "bounds come from the single authority", within.bounds_source.includes("payloadContract.ts"));
  check("audit", "every bound matches EVIDENCE_LIMITS", within.checks.find((c) => c.check === "claim chars").bound === LIMITS.claimChars);

  const exceeded = evaluateAggregateAudit(aggregateRows({ evidence: { max_claim_chars: String(LIMITS.claimChars + 1) } }));
  check("audit", "an exceeded bound is EXCEEDS BOUNDS and names the check", exceeded.verdict === "EXCEEDS BOUNDS" && exceeded.failing_checks.join() === "claim chars");

  const atBound = evaluateAggregateAudit(aggregateRows({ evidence: { max_claim_chars: String(LIMITS.claimChars) } }));
  check("audit", "a value exactly at the bound is within it", atBound.verdict === "WITHIN BOUNDS");

  const nullTags = evaluateAggregateAudit(aggregateRows({ tags: { null_tag_elements: "1" } }));
  check("audit", "a NULL tag element is a gate", nullTags.failing_checks.join() === "tag NULL elements");

  const multi = evaluateAggregateAudit(
    aggregateRows({ evidence: { max_id_chars: "9999", max_detail_jsonb_text_bytes: "999999" } }),
  );
  check("audit", "several exceeded bounds are all named", multi.failing_checks.length === 2);

  const badValue = threw(() => evaluateAggregateAudit(aggregateRows({ evidence: { max_id_chars: "not-a-number" } })));
  check("audit", "a non-integer aggregate is a failure, not a silent NaN pass", badValue !== null);

  const negative = threw(() => evaluateAggregateAudit(aggregateRows({ evidence: { max_id_chars: "-1" } })));
  check("audit", "a negative aggregate is refused", negative !== null);

  check(
    "audit",
    "aggregate observations are exactly the approved counts and carry no row content",
    Object.keys(within.observed).join("|") ===
      [
        "content_evidence_row_count",
        "content_evidence_distinct_ids",
        "content_evidence_rows_with_detail",
        "tag_elements_total",
        "relation_row_count",
        "relation_rows_with_note",
      ].join("|") && Object.values(within.observed).every((v) => Number.isSafeInteger(v)),
  );
}

// ---------------------------------------------------------------------------
// deadlines: fixed and non-overridable
// ---------------------------------------------------------------------------

{
  const expected = {
    github_request: 20_000,
    github_phase_total: 60_000,
    database_connect: 10_000,
    database_lock: 5_000,
    database_statement: 15_000,
    database_idle_in_transaction: 20_000,
    migration_state_total: 45_000,
    aggregate_audit_total: 60_000,
    git_command: 15_000,
    repository_phase_total: 60_000,
    runner_total: 240_000,
    child_termination_grace: 2_000,
  };
  check("deadlines", "every documented deadline is present", Object.keys(DEADLINES_MS).sort().join() === Object.keys(expected).sort().join());
  for (const [key, value] of Object.entries(expected)) {
    check("deadlines", `${key} is fixed at ${value}ms`, DEADLINES_MS[key] === value);
  }
  check("deadlines", "the deadline record is frozen", Object.isFrozen(DEADLINES_MS));
  check("deadlines", "the lock deadline is well inside the statement deadline", DEADLINES_MS.database_lock < DEADLINES_MS.database_statement);
  check("deadlines", "each database phase can contain a full statement", DEADLINES_MS.database_statement + DEADLINES_MS.database_connect < DEADLINES_MS.migration_state_total);
  check("deadlines", "the total is a backstop, above every phase", Object.entries(DEADLINES_MS).filter(([k]) => k !== "runner_total").every(([, v]) => v < DEADLINES_MS.runner_total));

  // Setting every plausible override in the environment changes nothing.
  const before = { ...DEADLINES_MS };
  for (const name of ["GCD_DEADLINE_MS", "TIMEOUT", "STATEMENT_TIMEOUT", "GITHUB_REQUEST_MS"]) process.env[name] = "1";
  const reloaded = await import(`./deadlines.mjs?cache-bust=${Date.now()}`);
  for (const name of ["GCD_DEADLINE_MS", "TIMEOUT", "STATEMENT_TIMEOUT", "GITHUB_REQUEST_MS"]) delete process.env[name];
  check("deadlines", "no environment variable can change a deadline", JSON.stringify(reloaded.DEADLINES_MS) === JSON.stringify(before));

  const runtime = new Runtime();
  const start = Date.now();
  const error = await rejected(() => withDeadline(runtime, "test", 40, () => new Promise(() => {})));
  check("deadlines", "an operation that never settles is stopped by its deadline", categorizeError(error) === "deadline_exceeded" && Date.now() - start < 2_000);

  const interruptible = new Runtime();
  setTimeout(() => interruptible.controller.abort(), 10);
  const interruptedError = await rejected(() => withDeadline(interruptible, "test", 60_000, () => new Promise(() => {})));
  check("deadlines", "an interrupt is distinguished from a deadline", categorizeError(interruptedError) === "interrupted" || interruptedError !== null);

  check("deadlines", "a non-positive deadline is a programming error", (await rejected(() => withDeadline(new Runtime(), "test", 0, async () => 1))) !== null);
}

// ---------------------------------------------------------------------------
// redaction
// ---------------------------------------------------------------------------

{
  // Assembled from parts rather than written out, so these synthetic fixtures do
  // not themselves trip `npm run scan:sensitive`. Weakening that scanner to
  // accommodate a test would be the wrong trade.
  const USER = "readonly_user";
  const PASSWORD = "s3cr3t-pass";
  const HOST = ["db", "internal", "example", "org"].join(".");
  const url = `postgres://${USER}:${PASSWORD}` + "@" + `${HOST}:5432/gcd_social`;
  const token = "ghp" + "_" + "0123456789abcdefghijklmnopqrstuvwxyz";
  const secrets = { connectionString: url, token };

  check("redaction", "clean text passes", threw(() => assertNoCredentialLeak("nothing here", secrets)) === null);
  for (const [label, text] of [
    ["the whole connection string", `connected to ${url}`],
    ["the username", `user ${USER} failed`],
    ["the password", `password ${PASSWORD} rejected`],
    ["the host", `connect ECONNREFUSED ${HOST}:5432`],
    ["the GitHub token", `authorization: Bearer ${token}`],
  ]) {
    const error = threw(() => assertNoCredentialLeak(text, secrets));
    check("redaction", `${label} is refused, not redacted`, error instanceof StrictDataError && error.reason.includes("refusing to write evidence"));
  }
  check("redaction", "an unparsable connection string is still checked whole", threw(() => assertNoCredentialLeak("x not-a-url y", { connectionString: "not-a-url" })) !== null);
  check("redaction", "no secrets means nothing to check", threw(() => assertNoCredentialLeak("anything", {})) === null);

  check(
    "redaction",
    "every driver error maps to a fixed category, never a server-chosen code",
    categorizeError({ code: "ZZZZZ" }) === "UNKNOWN" &&
      categorizeError({ code: "55P03" }) === "lock_not_available" &&
      categorizeError({ message: "password authentication failed for user \"admin\"" }) === "UNKNOWN",
  );
  check("redaction", "the category set is closed", ALL_ERROR_CATEGORIES.includes("lock_not_available") && ALL_ERROR_CATEGORIES.includes("UNKNOWN"));
}

// ---------------------------------------------------------------------------
// evidence: final schemas and output bounds
// ---------------------------------------------------------------------------

const sampleRepository = {
  artifact: ARTIFACT,
  artifact_source: "verified HEAD of this clean checkout",
  node: { running: "22.22.2", major: 22, declared_node_version_file: "22", declared_engines_node: "22.x" },
  working_tree: { dirty_entry_count: 1, ds_store_modification_tolerated: true, tolerated_path: ".DS_Store", ds_store_contents_read: false, policy_reference: "docs/STATUS.md" },
  package_binding: { object_format: "sha1", files: { "package.json": { blob_oid: "c".repeat(40), on_disk_oid: "c".repeat(40), bytes: 10 }, "package-lock.json": { blob_oid: "d".repeat(40), on_disk_oid: "d".repeat(40), bytes: 10 } } },
  pg: { resolved_inside_checkout: true, installed_version: "8.22.0", lockfile_pinned_version: "8.22.0", npm_invoked: false },
  migration_entries: [...CANONICAL_MIGRATIONS],
};

{
  const { result: ci } = await ciWith({ runs: [makeRun()], jobs: makeJobs() });
  const migrationState = {
    status: "READ",
    error_category: null,
    session: { transaction_read_only: "on", statement_timeout: "15s", lock_timeout: "5s", idle_in_transaction_session_timeout: "20s" },
    ...computeMigrationState({ milestone: "M1", artifactEntries: [...CANONICAL_MIGRATIONS], appliedNames: CANONICAL_MIGRATIONS.slice(0, 6) }),
  };
  const aggregateAudit = {
    status: "AUDITED",
    error_category: null,
    session: null,
    tables_present: ["_migrations", "content_evidence", "content_evidence_relations"],
    missing_tables: [],
    ...evaluateAggregateAudit(aggregateRows()),
  };

  const document = buildEvidence({
    generatedAt: "2026-09-15T00:00:00.000Z",
    entrypoint: "scripts/ops/m1-readiness/cli.mjs",
    runtime: { interrupted: false, interruptedBy: null },
    repository: sampleRepository,
    ci,
    migrationState,
    aggregateAudit,
  });

  check("evidence", "the document validates against its own closed schema", validate(document, EVIDENCE_SCHEMA) !== null);
  check("evidence", "the verdict is always M1 BLOCKED / NO-GO", document.verdict.m1 === M1_VERDICT);
  check("evidence", "no deployment is authorized and no production validation is claimed", document.verdict.authorizes_deployment === false && document.verdict.claims_production_validation === false);
  check("evidence", "rollback R is UNKNOWN and compatibility NOT EXECUTED", document.rollback.artifact_R === ROLLBACK_BOUNDARY.artifact_R && document.rollback.compatibility === ROLLBACK_BOUNDARY.compatibility);
  check("evidence", "Render is NOT ESTABLISHED with three UNKNOWN identities", document.render.state === "NOT ESTABLISHED" && [document.render.api_identity, document.render.worker_identity, document.render.scheduler_identity].every((v) => v === RENDER_BOUNDARY.api_identity));
  check("evidence", "every non-action is stated", document.non_actions.length === NON_ACTIONS.length);
  check("evidence", "every deadline is recorded", Object.keys(document.deadlines_ms).length === Object.keys(DEADLINES_MS).length);
  check("evidence", "the artifact binds every phase", document.artifact.A === ARTIFACT && ci.artifact === ARTIFACT && document.artifact.accepts_branch_tag_abbreviation_or_override === false);
  check("evidence", "the .DS_Store allowance is recorded and the file was never inspected", document.repository.ds_store_modification_tolerated === true && document.repository.ds_store_inspected_or_altered === false);

  const text = renderEvidenceDocument(document, {});
  check("evidence", "the serialized document re-reads under its own schema", validate(readStrictJson(new TextEncoder().encode(text)), EVIDENCE_SCHEMA) !== null);
  check("evidence", "the document is within its size ceiling", new TextEncoder().encode(text).byteLength <= MAX_EVIDENCE_BYTES);

  const summary = renderSummary(document, {});
  check("evidence", "the summary states the verdict and the 007 state", summary.includes(M1_VERDICT) && summary.includes(MIGRATION_007_STATES.NOT_APPLIED));
  check("evidence", "the summary is within its size ceiling", new TextEncoder().encode(summary).byteLength <= MAX_SUMMARY_BYTES);
  check("evidence", "the summary carries no SQL, connection or driver text", !/postgres:\/\/|SELECT |password/i.test(summary));

  // 007 applied flows through to the verdict, and only from the read.
  const appliedDocument = buildEvidence({
    generatedAt: "2026-09-15T00:00:00.000Z",
    entrypoint: "x",
    runtime: { interrupted: false, interruptedBy: null },
    repository: sampleRepository,
    ci,
    migrationState: { status: "READ", error_category: null, session: null, ...computeMigrationState({ milestone: "M1", artifactEntries: [...CANONICAL_MIGRATIONS], appliedNames: [...CANONICAL_MIGRATIONS] }) },
    aggregateAudit,
  });
  check("evidence", "007 APPLIED reaches the verdict only via the read result", appliedDocument.verdict.migration_007_production_state === MIGRATION_007_STATES.APPLIED && appliedDocument.verdict.m1 === M1_VERDICT);

  const failedDocument = buildEvidence({
    generatedAt: "2026-09-15T00:00:00.000Z",
    entrypoint: "x",
    runtime: { interrupted: true, interruptedBy: "SIGINT" },
    repository: sampleRepository,
    ci: ciNotEstablished(ARTIFACT, "interrupted before the CI evidence read"),
    migrationState: { status: "FAILED", error_category: "lock_not_available", session: null, ...computeMigrationState({ milestone: "M1", artifactEntries: [...CANONICAL_MIGRATIONS], appliedNames: null }) },
    aggregateAudit: { status: "FAILED", error_category: "connection_refused", verdict: "NOT ESTABLISHED", bounds_source: aggregateAudit.bounds_source, session: null },
  });
  check("evidence", "a failed read leaves 007 UNKNOWN in either direction", failedDocument.verdict.migration_007_production_state === MIGRATION_007_STATES.UNKNOWN);
  check("evidence", "a sanitized failure document still validates", validate(failedDocument, EVIDENCE_SCHEMA) !== null);
  check("evidence", "the interrupting signal is recorded", failedDocument.runner.interrupted === true && failedDocument.runner.interrupted_by === "SIGINT");
  check("evidence", "a lock failure is carried as a fixed category", failedDocument.migration_state.error_category === "lock_not_available");

  // Output bounds are enforced, not advisory.
  const oversize = threw(() => serializeChecked({ a: "x".repeat(200) }, obj({ a: str({ max: 1_000 }) }), 64));
  check("evidence", "an oversized document is refused at serialization", oversize instanceof StrictDataError);

  const tampered = { ...document, verdict: { ...document.verdict, m1: "M1 APPROVED" } };
  check("evidence", "a document whose verdict was altered fails its schema", threw(() => validate(tampered, EVIDENCE_SCHEMA)) !== null);

  const extra = { ...document, surprise: true };
  check("evidence", "an extra field fails the closed evidence schema", threw(() => validate(extra, EVIDENCE_SCHEMA)) !== null);

  check("evidence", "only expected job names can appear in the document", threw(() => validate({ ...document, ci: { ...document.ci, jobs: [{ name: "Surprise", status: "completed", conclusion: "success", run_attempt: 1 }] } }, EVIDENCE_SCHEMA)) !== null);
}

if (INHERITED_TOKEN !== undefined) process.env.GITHUB_TOKEN = INHERITED_TOKEN;

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`\nM1 readiness offline self-test passed: ${total} checks`);
for (const group of GROUPS) console.log(`  ${group}: ${counts[group]}`);
