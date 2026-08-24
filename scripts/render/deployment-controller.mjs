#!/usr/bin/env node

import { execFile } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const MAX_COMMAND_BYTES = 4 * 1024 * 1024;
const MAX_LOG_LINES = 100;
const MAX_LOG_CHARS = 500;

export class DeploymentStop extends Error {
  constructor(message, code = "DEPLOYMENT_STOP") {
    super(message);
    this.name = "DeploymentStop";
    this.code = code;
  }
}

function commandResult(error, stdout = "", stderr = "") {
  return {
    code: typeof error?.code === "number" ? error.code : error ? 1 : 0,
    stdout: String(stdout ?? error?.stdout ?? ""),
    stderr: String(stderr ?? error?.stderr ?? ""),
  };
}

async function runExecutable(command, args, env) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      env,
      encoding: "utf8",
      maxBuffer: MAX_COMMAND_BYTES,
    });
    return commandResult(null, stdout, stderr);
  } catch (error) {
    return commandResult(error);
  }
}

function parseJson(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) throw new Error("empty JSON output");
  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean).reverse();
    for (const line of lines) {
      try {
        return JSON.parse(line);
      } catch {
        // Continue to the previous JSON line.
      }
    }
    throw new Error("unparseable JSON output");
  }
}

function arrayPayload(value) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "items", "results", "deploys", "logs"]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

export function normalizeDeploys(value) {
  const array = arrayPayload(value);
  if (array.length) return array.map((item) => item?.deploy ?? item).filter(Boolean);
  const single = value?.deploy ?? value?.data?.deploy ?? value?.data ?? value;
  return single && typeof single === "object" && !Array.isArray(single) ? [single] : [];
}

function deployCommit(deploy) {
  return deploy?.commit?.id ?? deploy?.commit?.sha ?? deploy?.commitId ?? deploy?.commitSha ?? "";
}

function deployStatus(deploy) {
  return String(deploy?.status ?? deploy?.state ?? "unknown");
}

function deployError(deploy) {
  return deploy?.errorMessage ?? deploy?.error ?? deploy?.message ?? "";
}

function deployTimestamp(deploy, ...keys) {
  for (const key of keys) if (deploy?.[key]) return String(deploy[key]);
  return "unavailable";
}

export function selectLiveDeploy(value) {
  return normalizeDeploys(value).find((deploy) => deployStatus(deploy) === "live");
}

export function selectTargetDeploy(value, targetSha) {
  return normalizeDeploys(value).find((deploy) => deployCommit(deploy) === targetSha);
}

export function sanitizeDiagnostic(value) {
  return String(value ?? "")
    .replace(/https:\/\/hooks\.slack\.com\/services\/\S+/gi, "[REDACTED_SLACK_WEBHOOK]")
    .replace(/\b(?:postgres(?:ql)?|mysql|redis|rediss):\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/\bhttps?:\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/gi, "[REDACTED_CREDENTIAL_URL]")
    .replace(/\bAuthorization\s*[:=]\s*[^\r\n]+/gi, "Authorization: [REDACTED]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:rnd_|sk-ant-|gh[pousr]_|xox[a-z]-|ya29\.)[A-Za-z0-9._-]+\b/gi, "[REDACTED_TOKEN]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/\b(RENDER_API_KEY|DATABASE_URL|ACCESS_TOKEN|REFRESH_TOKEN|CLIENT_SECRET|API_KEY|TOKEN|SECRET|PASSWORD)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[REDACTED]")
    .replace(/([?&](?:access_token|api_key|key|token|secret|signature)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/[\r\n]+/g, " ")
    .slice(0, MAX_LOG_CHARS);
}

function logEntries(value) {
  return arrayPayload(value).slice(0, MAX_LOG_LINES).map((entry) => {
    if (typeof entry === "string") return sanitizeDiagnostic(entry);
    const timestamp = entry?.timestamp ?? entry?.time ?? entry?.createdAt ?? "";
    const message = entry?.message ?? entry?.text ?? entry?.log ?? entry?.body ?? "";
    return sanitizeDiagnostic(`${timestamp ? `${timestamp} ` : ""}${message}`.trim());
  }).filter(Boolean);
}

function requireValue(env, name, pattern) {
  const value = String(env[name] ?? "").trim();
  if (!value) throw new DeploymentStop(`${name} is required`, "CONFIGURATION_ERROR");
  if (pattern && !pattern.test(value)) throw new DeploymentStop(`${name} has an invalid format`, "CONFIGURATION_ERROR");
  return value;
}

function markdownCode(value) {
  return `\`${sanitizeDiagnostic(value).replace(/`/g, "'")}\``;
}

function renderSummary(report) {
  const lines = [
    "# Render production deployment report",
    "",
    `- Result: **${report.result}**`,
    `- Started: ${markdownCode(report.startedAt)}`,
    `- Finished: ${markdownCode(report.finishedAt ?? "unavailable")}`,
    `- LIVE_SHA: ${markdownCode(report.liveSha ?? "unavailable")}`,
    `- TARGET_SHA: ${markdownCode(report.targetSha ?? "unavailable")}`,
    `- CURRENT_MAIN_SHA: ${markdownCode(report.currentMainSha ?? "unavailable")}`,
    "",
  ];
  if (report.migrations?.length) {
    lines.push("## Migration safety gate", "", "**CONTROLLED MIGRATION ROLLOUT REQUIRED**", "");
    for (const file of report.migrations) lines.push(`- ${markdownCode(file)}`);
    lines.push("");
  }
  if (report.stages.length) {
    lines.push("## Service stages", "", "| Service | ID | Deploy | Status | Commit |", "|---|---|---|---|---|");
    for (const stage of report.stages) {
      lines.push(`| ${stage.name} | ${markdownCode(stage.id)} | ${markdownCode(stage.deployId ?? "unavailable")} | ${markdownCode(stage.status)} | ${markdownCode(stage.commit ?? "unavailable")} |`);
    }
    lines.push("");
  }
  if (report.evidence.length) {
    lines.push("## Bounded failure evidence", "");
    for (const evidence of report.evidence) {
      lines.push(`### ${evidence.name}`, "",
        `- Service ID: ${markdownCode(evidence.id)}`,
        `- Deploy ID: ${markdownCode(evidence.deployId ?? "unavailable")}`,
        `- Deploy status: ${markdownCode(evidence.status ?? "unavailable")}`,
        `- Render error: ${sanitizeDiagnostic(evidence.error || "unavailable")}`,
        `- Created: ${markdownCode(evidence.createdAt ?? "unavailable")}`,
        `- Finished: ${markdownCode(evidence.finishedAt ?? "unavailable")}`,
        "", "Build logs (sanitized, bounded):", "");
      lines.push(...(evidence.buildLogs.length ? evidence.buildLogs.map((line) => `- ${line}`) : ["- unavailable"]));
      lines.push("", "Runtime logs (sanitized, bounded):", "");
      lines.push(...(evidence.runtimeLogs.length ? evidence.runtimeLogs.map((line) => `- ${line}`) : ["- unavailable"]));
      lines.push("");
    }
  }
  if (report.notes.length) lines.push("## Notes", "", ...report.notes.map((note) => `- ${sanitizeDiagnostic(note)}`), "");
  return `${lines.join("\n")}\n`;
}

export async function runDeployment(options = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const render = options.render ?? ((args) => runExecutable("render", args, env));
  const git = options.git ?? ((args) => runExecutable("git", args, env));
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const summaryPath = env.GITHUB_STEP_SUMMARY;
  const report = {
    result: "failed",
    startedAt: now().toISOString(),
    finishedAt: undefined,
    liveSha: undefined,
    targetSha: undefined,
    currentMainSha: undefined,
    migrations: [],
    stages: [],
    evidence: [],
    notes: [],
  };

  async function writeSummary() {
    report.finishedAt = now().toISOString();
    const summary = renderSummary(report);
    if (options.writeSummary) await options.writeSummary(summary);
    else if (summaryPath) await appendFile(summaryPath, summary, { encoding: "utf8" });
  }

  async function readRenderJson(args, attempts = 3) {
    let lastFailure = "read failed";
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const result = await render(args);
      if (result.code === 0) {
        try {
          return parseJson(result.stdout);
        } catch (error) {
          lastFailure = error.message;
        }
      } else {
        lastFailure = `Render CLI exited ${result.code}`;
      }
      if (attempt < attempts) await sleep(attempt * 1_000);
    }
    throw new DeploymentStop(lastFailure, "RENDER_READ_FAILED");
  }

  async function listDeploys(serviceId) {
    return readRenderJson(["deploys", "list", serviceId, "--confirm", "-o", "json"]);
  }

  async function boundedLogs(serviceId, type, start) {
    try {
      const value = await readRenderJson([
        "logs", "--resources", serviceId, "--start", start, "--limit", String(MAX_LOG_LINES),
        "--type", type, "--direction", "backward", "--confirm", "-o", "json",
      ]);
      return logEntries(value);
    } catch {
      return [];
    }
  }

  async function collectEvidence(service, knownDeploy) {
    let deploy = knownDeploy;
    if (!deploy) {
      try {
        deploy = selectTargetDeploy(await listDeploys(service.id), report.targetSha);
      } catch {
        deploy = undefined;
      }
    }
    const start = new Date(now().getTime() - 30 * 60 * 1_000).toISOString();
    const [buildLogs, runtimeLogs] = await Promise.all([
      boundedLogs(service.id, "build", start),
      boundedLogs(service.id, "app", start),
    ]);
    report.evidence.push({
      name: service.name,
      id: service.id,
      deployId: deploy?.id,
      status: deploy ? deployStatus(deploy) : "unavailable",
      error: deploy ? deployError(deploy) : "",
      createdAt: deployTimestamp(deploy, "createdAt", "startedAt"),
      finishedAt: deployTimestamp(deploy, "finishedAt", "updatedAt"),
      buildLogs,
      runtimeLogs,
    });
  }

  async function gitOk(args) {
    return (await git(args)).code === 0;
  }

  async function resolveGitSha(ref, code) {
    const resolved = await git(["rev-parse", "--verify", `${ref}^{commit}`]);
    const sha = resolved.stdout.trim();
    if (resolved.code !== 0 || !SHA_PATTERN.test(sha)) {
      throw new DeploymentStop(`${ref} could not be resolved to a full commit SHA`, code);
    }
    return sha;
  }

  async function deployService(service) {
    const stageStartedAt = now().toISOString();
    const attempt = await render([
      "deploys", "create", service.id, "--commit", report.targetSha,
      "--wait", "--confirm", "-o", "json",
    ]);
    let deploy;
    if (attempt.code === 0) {
      try {
        const created = normalizeDeploys(parseJson(attempt.stdout));
        deploy = created.length === 1 ? created[0] : selectTargetDeploy(created, report.targetSha);
      } catch {
        deploy = undefined;
      }
    }
    const stage = {
      name: service.name,
      id: service.id,
      deployId: deploy?.id,
      status: deploy ? deployStatus(deploy) : `cli_exit_${attempt.code}`,
      commit: deploy ? deployCommit(deploy) : "unavailable",
    };
    report.stages.push(stage);
    if (attempt.code !== 0 || !deploy?.id || deployCommit(deploy) !== report.targetSha || deployStatus(deploy) !== "live") {
      await collectEvidence(service, deploy);
      throw new DeploymentStop(`${service.name} deployment failed`, "SERVICE_DEPLOY_FAILED");
    }
    return { deploy, stageStartedAt };
  }

  try {
    if (env.RENDER_DEPLOY_AUTOMATION_ENABLED !== "true") {
      throw new DeploymentStop("RENDER_DEPLOY_AUTOMATION_ENABLED must be exactly true", "AUTOMATION_DISABLED");
    }
    const targetSha = requireValue(env, "TARGET_SHA", SHA_PATTERN);
    report.targetSha = targetSha;

    if (!await gitOk(["cat-file", "-e", `${targetSha}^{commit}`])) {
      throw new DeploymentStop("TARGET_SHA is unavailable in fetched Git history", "TARGET_HISTORY_ERROR");
    }
    const currentMainSha = await resolveGitSha("origin/main", "CURRENT_MAIN_UNKNOWN");
    report.currentMainSha = currentMainSha;
    if (targetSha !== currentMainSha) {
      report.result = "superseded";
      report.notes.push("SUPERSEDED RELEASE — NO DEPLOYMENT: TARGET_SHA no longer equals CURRENT_MAIN_SHA.");
      return report;
    }
    if (!await gitOk(["merge-base", "--is-ancestor", targetSha, "origin/main"])) {
      throw new DeploymentStop("TARGET_SHA is not reachable from origin/main", "TARGET_HISTORY_ERROR");
    }

    requireValue(env, "RENDER_API_KEY");
    const workspaceId = requireValue(env, "RENDER_WORKSPACE_ID", /^tea-[a-z0-9]+$/);
    const services = {
      api: { name: "gcd-social-api", id: requireValue(env, "RENDER_API_SERVICE_ID", /^srv-[a-z0-9]+$/) },
      worker: { name: "gcd-social-worker", id: requireValue(env, "RENDER_WORKER_SERVICE_ID", /^srv-[a-z0-9]+$/) },
      scheduler: { name: "gcd-social-scheduler", id: requireValue(env, "RENDER_SCHEDULER_SERVICE_ID", /^crn-[a-z0-9]+$/) },
    };
    const healthUrl = new URL(requireValue(env, "RENDER_API_HEALTH_URL"));
    if (healthUrl.protocol !== "https:" || healthUrl.username || healthUrl.password || healthUrl.search || healthUrl.hash) {
      throw new DeploymentStop("RENDER_API_HEALTH_URL must be a credential-free HTTPS URL", "CONFIGURATION_ERROR");
    }

    const workspaceSelection = await render(["workspace", "set", workspaceId, "--confirm", "-o", "json"]);
    if (workspaceSelection.code !== 0) {
      throw new DeploymentStop("Render CLI could not select RENDER_WORKSPACE_ID", "WORKSPACE_SELECTION_FAILED");
    }
    const workspace = await readRenderJson(["workspace", "current", "--confirm", "-o", "json"]);
    const currentWorkspaceId = workspace?.id ?? workspace?.workspace?.id ?? workspace?.data?.id;
    if (currentWorkspaceId !== workspaceId) {
      throw new DeploymentStop("Render CLI workspace does not match RENDER_WORKSPACE_ID", "WORKSPACE_MISMATCH");
    }

    const apiDeploys = await listDeploys(services.api.id);
    const liveDeploy = selectLiveDeploy(apiDeploys);
    const liveSha = deployCommit(liveDeploy);
    if (!SHA_PATTERN.test(liveSha)) {
      throw new DeploymentStop("LIVE_SHA could not be determined from the API's live deploy", "LIVE_SHA_UNKNOWN");
    }
    report.liveSha = liveSha;
    if (!await gitOk(["cat-file", "-e", `${liveSha}^{commit}`])) {
      throw new DeploymentStop("LIVE_SHA is unavailable in fetched Git history", "LIVE_HISTORY_ERROR");
    }
    if (liveSha === targetSha) {
      for (const service of Object.values(services)) {
        const current = selectLiveDeploy(await listDeploys(service.id));
        if (deployCommit(current) !== targetSha) {
          throw new DeploymentStop("API is at TARGET_SHA but another service is not; controlled recovery is required", "PARTIAL_RELEASE_STATE");
        }
      }
      report.notes.push("Production already reports TARGET_SHA for API, worker, and scheduler; no deployment was triggered.");
      report.result = "success";
      return report;
    }
    if (!await gitOk(["merge-base", "--is-ancestor", liveSha, targetSha])) {
      throw new DeploymentStop("LIVE_SHA is not an ancestor of TARGET_SHA; controlled recovery is required", "DIVERGED_RELEASE_BASE");
    }

    const migrationDiff = await git(["diff", "--name-only", `${liveSha}..${targetSha}`, "--", "state/migrations/**"]);
    if (migrationDiff.code !== 0) throw new DeploymentStop("migration diff could not be evaluated", "MIGRATION_GATE_ERROR");
    report.migrations = migrationDiff.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    if (report.migrations.length) {
      report.result = "blocked";
      throw new DeploymentStop("CONTROLLED MIGRATION ROLLOUT REQUIRED", "MIGRATION_ROLLOUT_REQUIRED");
    }

    await deployService(services.api);
    let healthVerified = false;
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      try {
        const response = await fetchFn(healthUrl, {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
          headers: { accept: "application/json" },
        });
        if (response.ok) {
          healthVerified = true;
          break;
        }
      } catch {
        // Retry only this bounded, read-only health request.
      }
      if (attempt < 12) await sleep(10_000);
    }
    if (!healthVerified) {
      await collectEvidence(services.api);
      throw new DeploymentStop("API /healthz verification failed", "API_HEALTH_FAILED");
    }
    report.notes.push("API /healthz passed bounded verification.");

    const workerResult = await deployService(services.worker);
    const workerLogs = await boundedLogs(services.worker.id, "app", workerResult.stageStartedAt);
    const workerText = workerLogs.join("\n");
    const crashPattern = /\b(?:fatal|panic|uncaught|crash(?:ed|ing)?|exited with (?:code|status) [1-9])\b/i;
    const startupPattern = /\[worker\] gcd-social-worker started|\[worker\] polling brief queue/i;
    if (crashPattern.test(workerText) || !startupPattern.test(workerText)) {
      await collectEvidence(services.worker, workerResult.deploy);
      throw new DeploymentStop("worker startup verification failed", "WORKER_STARTUP_FAILED");
    }
    report.notes.push("Worker reached live state and emitted the expected bounded startup/polling signal.");

    await deployService(services.scheduler);

    for (const service of Object.values(services)) {
      const current = selectLiveDeploy(await listDeploys(service.id));
      if (deployCommit(current) !== targetSha) {
        await collectEvidence(service, current);
        throw new DeploymentStop(`${service.name} does not report TARGET_SHA after deployment`, "FINAL_SHA_MISMATCH");
      }
    }
    report.notes.push("API, worker, and scheduler all report TARGET_SHA.");
    report.notes.push("Scheduler deployment verifies its live artifact only; the next scheduled execution remains a separate observation.");
    report.result = "success";
    return report;
  } catch (error) {
    if (!(error instanceof DeploymentStop)) throw error;
    if (report.result !== "blocked") report.result = "failed";
    report.notes.push(`${error.code}: ${error.message}`);
    throw error;
  } finally {
    await writeSummary();
  }
}

async function main() {
  try {
    await runDeployment();
  } catch (error) {
    const message = error instanceof DeploymentStop ? `${error.code}: ${error.message}` : "unexpected deployment controller failure";
    console.error(`::error::${sanitizeDiagnostic(message)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
