import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DeploymentStop,
  normalizeDeploys,
  runDeployment,
  sanitizeDiagnostic,
  selectLiveDeploy,
} from "./deployment-controller.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const oldSha = "1".repeat(40);
const targetSha = "2".repeat(40);
const newerSha = "3".repeat(40);
const divergentSha = "4".repeat(40);
const ids = {
  api: "srv-d8u0qtpo3t8c73c5o44g",
  worker: "srv-d8u0qtpo3t8c73c5o440",
  scheduler: "crn-d8ulb4rtqb8s73bdjctg",
};

async function fixture(name) {
  return JSON.parse(await readFile(resolve(here, "fixtures", name), "utf8"));
}

function baseEnv(overrides = {}) {
  return {
    RENDER_DEPLOY_AUTOMATION_ENABLED: "true",
    RENDER_API_KEY: "fixture-only-key",
    RENDER_WORKSPACE_ID: "tea-d4fkclpr0fns73abmnh0",
    RENDER_API_SERVICE_ID: ids.api,
    RENDER_WORKER_SERVICE_ID: ids.worker,
    RENDER_SCHEDULER_SERVICE_ID: ids.scheduler,
    RENDER_API_HEALTH_URL: "https://example.invalid/healthz",
    TARGET_SHA: targetSha,
    ...overrides,
  };
}

function result(code, value = "") {
  return { code, stdout: typeof value === "string" ? value : JSON.stringify(value), stderr: "" };
}

function deployRecord(serviceId, sha, status = "live") {
  return {
    id: `dep-${serviceId}-${sha.slice(0, 6)}-${status.replace(/\W+/g, "-")}`,
    status,
    commit: { id: sha },
    createdAt: "2026-08-24T13:00:00Z",
    finishedAt: "2026-08-24T13:03:00Z",
  };
}

function deployList(serviceId, sha, status = "live") {
  return [{ deploy: deployRecord(serviceId, sha, status) }];
}

function createGitFixture(options = {}) {
  const calls = [];
  const {
    currentMainSha = targetSha,
    migrations = "",
    migrationExit = 0,
    targetExists = true,
    liveSha = oldSha,
    liveExists = true,
    targetReachable = true,
    liveAncestor = true,
  } = options;
  const git = async (args) => {
    calls.push(args);
    if (args[0] === "cat-file") {
      const sha = args[2].slice(0, 40);
      if (sha === targetSha) return result(targetExists ? 0 : 1);
      if (sha === liveSha) return result(liveExists ? 0 : 1);
      return result(1);
    }
    if (args[0] === "rev-parse") return result(0, `${currentMainSha}\n`);
    if (args[0] === "merge-base") {
      return result(args[3] === "origin/main" ? (targetReachable ? 0 : 1) : (liveAncestor ? 0 : 1));
    }
    if (args[0] === "diff") return result(migrationExit, migrations);
    throw new Error(`unexpected Git call: ${args.join(" ")}`);
  };
  return { calls, git };
}

function createRenderFixture(options = {}) {
  const calls = [];
  const deployed = new Set();
  const {
    initialSha = oldSha,
    statusByService = {},
    malformedService,
    workerLogs = [{ message: "[worker] gcd-social-worker started" }],
    failureLogs = [],
  } = options;
  const render = async (args) => {
    calls.push(args);
    if (args[0] === "workspace") return result(0, { id: baseEnv().RENDER_WORKSPACE_ID });
    if (args[0] === "deploys" && args[1] === "create") {
      const serviceId = args[2];
      if (serviceId === malformedService) return result(0, "not-json Bearer raw-render-secret");
      const status = statusByService[serviceId] ?? "live";
      deployed.add(serviceId);
      return result(0, deployRecord(serviceId, targetSha, status));
    }
    if (args[0] === "deploys" && args[1] === "list") {
      const serviceId = args[2];
      if (deployed.has(serviceId) && (statusByService[serviceId] ?? "live") === "live") {
        return result(0, deployList(serviceId, targetSha));
      }
      return result(0, deployList(serviceId, initialSha));
    }
    if (args[0] === "logs") {
      if (failureLogs.length) return result(0, failureLogs);
      return result(0, args.includes(ids.worker) ? workerLogs : []);
    }
    throw new Error(`unexpected Render call: ${args.join(" ")}`);
  };
  return { calls, render };
}

async function expectStop(operation, code) {
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof DeploymentStop);
  assert.equal(caught.code, code);
}

function createCalls(calls) {
  return calls.filter((args) => args[0] === "deploys" && args[1] === "create");
}

const liveFixture = await fixture("api-live.json");
assert.equal(normalizeDeploys(liveFixture).length, 1);
assert.equal(selectLiveDeploy(liveFixture).commit.id, oldSha);
assert.equal(normalizeDeploys({ deploy: deployRecord(ids.api, targetSha) }).length, 1);

const credentialSeparator = String.fromCharCode(64);
const secretSamples = [
  ["Authorization: Basic dXNlcjpwYXNz", "dXNlcjpwYXNz"],
  ["Bearer secret-value", "secret-value"],
  ["https://hooks.slack.com/services/T000/B000/secret", "/T000/B000/secret"],
  [`postgresql://user:password${credentialSeparator}db.example/gcd`, "user:password"],
  [`redis://user:password${credentialSeparator}cache.example:6379/0`, "user:password"],
  ["RENDER_API_KEY=opaque-fixture-secret", "opaque-fixture-secret"],
  ["ACCESS_TOKEN=oauth-fixture-secret", "oauth-fixture-secret"],
  ["rnd_renderfixture123", "renderfixture123"],
  ["xoxb-slackfixture123", "slackfixture123"],
  ["ya29.oauthfixture123", "oauthfixture123"],
  ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature", "signature"],
  ["https://example.invalid/path?access_token=query-secret", "query-secret"],
  ["user@example.com", "user@example.com"],
];
for (const [sample, secret] of secretSamples) {
  const sanitized = sanitizeDiagnostic(sample);
  assert(!sanitized.includes(secret), sample);
}
assert.equal(sanitizeDiagnostic("x".repeat(600)).length, 500);

// The repository gate accepts the literal string true only and touches neither Git nor Render otherwise.
for (const disabledValue of [undefined, "", "TRUE", "1", "yes", " true", "true "]) {
  const renderCalls = [];
  const gitCalls = [];
  await expectStop(() => runDeployment({
    env: baseEnv({ RENDER_DEPLOY_AUTOMATION_ENABLED: disabledValue }),
    render: async (args) => { renderCalls.push(args); return result(1); },
    git: async (args) => { gitCalls.push(args); return result(1); },
    writeSummary: async () => {},
  }), "AUTOMATION_DISABLED");
  assert.equal(renderCalls.length, 0);
  assert.equal(gitCalls.length, 0);
}

// A completes before B: A is still current main and can deploy coherently.
{
  const { calls, render } = createRenderFixture();
  const { git } = createGitFixture({ currentMainSha: targetSha });
  let summary = "";
  const report = await runDeployment({
    env: baseEnv(), render, git, fetchFn: async () => ({ ok: true }), sleep: async () => {},
    writeSummary: async (value) => { summary = value; },
  });
  assert.equal(report.result, "success");
  assert.deepEqual(createCalls(calls).map((args) => args[2]), [ids.api, ids.worker, ids.scheduler]);
  assert(summary.includes(`CURRENT_MAIN_SHA: \`${targetSha}\``));
}

// B completes before A: when A finally enters the serialized controller it is superseded.
for (const scenario of ["B completes before A", "stale while waiting for concurrency"]) {
  const renderCalls = [];
  const { git } = createGitFixture({ currentMainSha: newerSha });
  let summary = "";
  const env = baseEnv();
  delete env.RENDER_API_KEY;
  const report = await runDeployment({
    env,
    render: async (args) => { renderCalls.push(args); return result(1); },
    git,
    writeSummary: async (value) => { summary = value; },
  });
  assert.equal(report.result, "superseded", scenario);
  assert.equal(renderCalls.length, 0, scenario);
  assert(summary.includes("SUPERSEDED RELEASE — NO DEPLOYMENT"), scenario);
}

// Production already equals current main: verify all three service records and perform no deploy.
{
  const { calls, render } = createRenderFixture({ initialSha: targetSha });
  const { git } = createGitFixture({ currentMainSha: targetSha, liveSha: targetSha });
  let summary = "";
  const report = await runDeployment({
    env: baseEnv(), render, git, sleep: async () => {}, writeSummary: async (value) => { summary = value; },
  });
  assert.equal(report.result, "success");
  assert.equal(createCalls(calls).length, 0);
  assert(summary.includes("Production already reports TARGET_SHA"));
}

// Diverged, rollback, force-pushed, and unknown live histories fail before migration evaluation/deploy.
for (const [scenario, gitOptions] of [
  ["missing target commit", { targetExists: false }],
  ["target not reachable from expected main", { targetReachable: false }],
]) {
  const renderCalls = [];
  const { git } = createGitFixture(gitOptions);
  await expectStop(() => runDeployment({
    env: baseEnv(),
    render: async (args) => { renderCalls.push(args); return result(1); },
    git,
    sleep: async () => {},
    writeSummary: async () => {},
  }), "TARGET_HISTORY_ERROR");
  assert.equal(renderCalls.length, 0, scenario);
}
{
  const { calls, render } = createRenderFixture({ initialSha: divergentSha });
  const { calls: gitCalls, git } = createGitFixture({ liveSha: divergentSha, liveAncestor: false });
  await expectStop(() => runDeployment({
    env: baseEnv(), render, git, sleep: async () => {}, writeSummary: async () => {},
  }), "DIVERGED_RELEASE_BASE");
  assert.equal(createCalls(calls).length, 0);
  assert(!gitCalls.some((args) => args[0] === "diff"));
}
{
  const { calls, render } = createRenderFixture();
  const { git } = createGitFixture({ liveExists: false });
  await expectStop(() => runDeployment({
    env: baseEnv(), render, git, sleep: async () => {}, writeSummary: async () => {},
  }), "LIVE_HISTORY_ERROR");
  assert.equal(createCalls(calls).length, 0);
}

// Added, modified, deleted, multiple, and multi-commit-behind migration changes all block exact-range release.
const migrationCases = [
  ["added", "state/migrations/006_added.sql\n"],
  ["modified", "state/migrations/005_approval_integrity.sql\n"],
  ["deleted", "state/migrations/004_removed.sql\n"],
  ["multiple", "state/migrations/004_removed.sql\nstate/migrations/006_added.sql\n"],
  ["production several commits behind", "state/migrations/003_old.sql\nstate/migrations/006_added.sql\n"],
];
for (const [scenario, migrations] of migrationCases) {
  const { calls, render } = createRenderFixture();
  const { calls: gitCalls, git } = createGitFixture({ migrations });
  let summary = "";
  await expectStop(() => runDeployment({
    env: baseEnv(), render, git, sleep: async () => {}, writeSummary: async (value) => { summary = value; },
  }), "MIGRATION_ROLLOUT_REQUIRED");
  assert.equal(createCalls(calls).length, 0, scenario);
  const diff = gitCalls.find((args) => args[0] === "diff");
  assert.deepEqual(diff, ["diff", "--name-only", `${oldSha}..${targetSha}`, "--", "state/migrations/**"], scenario);
  assert(summary.includes("CONTROLLED MIGRATION ROLLOUT REQUIRED"), scenario);
}

// Every non-live or malformed create result fails closed and cannot reach a downstream service.
for (const status of ["unknown", "timed_out", "cancelled", "build_failed", "update_failed", "deactivated"]) {
  const { calls, render } = createRenderFixture({ statusByService: { [ids.api]: status } });
  const { git } = createGitFixture();
  await expectStop(() => runDeployment({
    env: baseEnv(), render, git, sleep: async () => {}, writeSummary: async () => {},
  }), "SERVICE_DEPLOY_FAILED");
  assert.deepEqual(createCalls(calls).map((args) => args[2]), [ids.api], status);
}
{
  const { calls, render } = createRenderFixture({ malformedService: ids.api });
  const { git } = createGitFixture();
  let summary = "";
  await expectStop(() => runDeployment({
    env: baseEnv(), render, git, sleep: async () => {}, writeSummary: async (value) => { summary = value; },
  }), "SERVICE_DEPLOY_FAILED");
  assert.deepEqual(createCalls(calls).map((args) => args[2]), [ids.api]);
  assert(!summary.includes("raw-render-secret"));
}

// Failure evidence is bounded and sanitized before it reaches the step summary.
{
  const failedFixture = await fixture("deploy-failed.json");
  const failureLogs = Array.from({ length: 150 }, (_, index) => ({
    timestamp: "2026-08-24T13:02:00Z",
    message: index === 0
      ? `bounded-line-0 Authorization: Bearer log-secret DATABASE_URL=postgresql://user:pass${credentialSeparator}db.example/gcd https://hooks.slack.com/services/T/B/secret`
      : `bounded-line-${index}`,
  }));
  const calls = [];
  let createAttempted = false;
  const render = async (args) => {
    calls.push(args);
    if (args[0] === "workspace") return result(0, { id: baseEnv().RENDER_WORKSPACE_ID });
    if (args[0] === "deploys" && args[1] === "create") {
      createAttempted = true;
      return result(1, "RENDER_API_KEY=opaque-cli-secret");
    }
    if (args[0] === "deploys" && args[1] === "list") return result(0, createAttempted ? failedFixture : liveFixture);
    if (args[0] === "logs") return result(0, failureLogs);
    throw new Error(`unexpected Render call: ${args.join(" ")}`);
  };
  const { git } = createGitFixture();
  let summary = "";
  await expectStop(() => runDeployment({
    env: baseEnv(), render, git, sleep: async () => {}, writeSummary: async (value) => { summary = value; },
  }), "SERVICE_DEPLOY_FAILED");
  assert.equal(createCalls(calls).length, 1);
  assert(summary.includes("Bounded failure evidence"));
  assert(summary.includes("build_failed"));
  assert(summary.includes("bounded-line-99"));
  assert(!summary.includes("bounded-line-100"));
  for (const secret of ["log-secret", "user:pass", "/T/B/secret", "opaque-cli-secret", "fixture-only-key"]) {
    assert(!summary.includes(secret));
  }
}

console.log("deployment controller self-test: PASS (gate, stale ordering, ancestry, migration range, already-current, sequencing, fail-closed states, redaction)");
