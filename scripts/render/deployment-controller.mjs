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
const MAX_DIAGNOSTIC_INPUT_CHARS = 20_000;
export const MAX_HEALTH_BODY_BYTES = 4_096;
const EXPECTED_API_HEALTH_ORIGIN = "https://gcd-social-api.onrender.com";
const EXPECTED_API_HEALTH_PATH = "/healthz";
const WORKER_READY_PREFIX = "[worker] ready ";
const WORKER_READY_ATTEMPTS = 12;
const WORKER_READY_INTERVAL_MS = 5_000;
const WORKER_STABILIZATION_MS = 10_000;

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
    throw new Error("unparseable JSON output");
  }
}

/** Parse the Render CLI's sequential, optionally pretty-printed JSON values. */
export function parseJsonValues(text) {
  const source = String(text ?? "").trim();
  if (!source) throw new Error("empty JSON output");
  const values = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (start < 0) {
      if (/\s/.test(char)) continue;
      if (char !== "{" && char !== "[") throw new Error("unexpected non-JSON log output");
      start = index;
      depth = 1;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") depth -= 1;
    if (depth < 0) throw new Error("unbalanced JSON log output");
    if (depth === 0) {
      values.push(JSON.parse(source.slice(start, index + 1)));
      start = -1;
    }
  }
  if (start >= 0 || inString || !values.length) throw new Error("incomplete JSON log output");
  return values;
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

const SECRET_KEY_NAMES = new Set([
  "authorization",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "renderapikey",
  "databaseurl",
  "clientsecret",
  "password",
  "passwd",
  "token",
  "secret",
  "signature",
]);
const SECRET_KEY_SOURCE = [
  "authorization",
  "access[_-]?token",
  "refresh[_-]?token",
  "api[_-]?key",
  "render[_-]?api[_-]?key",
  "database[_-]?url",
  "client[_-]?secret",
  "password",
  "passwd",
  "token",
  "secret",
  "signature",
].join("|");
const FALLBACK_SECRET_KEY_SOURCE = `(?:[A-Za-z][A-Za-z0-9]*[_-])*(?:${SECRET_KEY_SOURCE})`;

function normalizedSecretKey(key) {
  return String(key).toLowerCase().replace(/[_-]/g, "");
}

function redactStructuredValue(value, depth = 0) {
  if (depth > 20) return "[REDACTED_DEPTH]";
  if (Array.isArray(value)) return value.map((item) => redactStructuredValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const redacted = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    redacted[key] = SECRET_KEY_NAMES.has(normalizedSecretKey(key))
      ? "[REDACTED]"
      : redactStructuredValue(item, depth + 1);
  }
  return redacted;
}

function structuredDiagnostic(source) {
  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== "object") return source;
    return JSON.stringify(redactStructuredValue(parsed));
  } catch {
    return source;
  }
}

function unescapeQuotedDiagnostic(value) {
  let diagnostic = value;
  for (let depth = 0; depth < 4; depth += 1) {
    const unescaped = diagnostic.replace(/\\"/g, '"').replace(/\\'/g, "'");
    if (unescaped === diagnostic) break;
    diagnostic = unescaped;
  }
  return diagnostic;
}

function fallbackRedactDiagnostic(value) {
  const separator = "(?:=>|->|[:=])";
  const assignment = new RegExp(
    `((?:["'](?:${FALLBACK_SECRET_KEY_SOURCE})["']|\\b(?:${FALLBACK_SECRET_KEY_SOURCE}))\\s*${separator}\\s*)`
      + `(?:(?:Basic|Bearer)\\s+)?(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\s,;}\\]]+)`,
    "gi",
  );
  return value
    .replace(assignment, '$1"[REDACTED]"')
    .replace(/https:\/\/hooks\.slack\.com\/services\/[^\s"'<>)}\]]+/gi, "[REDACTED_SLACK_WEBHOOK]")
    .replace(/\b(?:postgres(?:ql)?|mysql|redis|rediss):\/\/[^\s"'<>)}\]]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/\bhttps?:\/\/[^\s/@:]+:[^\s/@]+@[^\s"'<>)}\]]+/gi, "[REDACTED_CREDENTIAL_URL]")
    .replace(/\bBearer\s+[^\s,;}\]]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:rnd_|sk-ant-|gh[pousr]_|xox[a-z]-|ya29\.)[A-Za-z0-9._-]+\b/gi, "[REDACTED_TOKEN]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/([?&](?:access_token|refresh_token|api_key|key|token|secret|signature|password)=)[^&\s"'<>]+/gi, "$1[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");
}

function percentDecodedShadows(value) {
  const shadows = [];
  let shadow = value;
  for (let depth = 0; depth < 4; depth += 1) {
    const decoded = shadow.replace(/%([0-9a-f]{2})/gi, (_encoded, hex) => (
      String.fromCharCode(Number.parseInt(hex, 16))
    ));
    if (decoded === shadow) break;
    shadows.push(decoded);
    if (decoded.includes("+")) shadows.push(decoded.replace(/\+/g, " "));
    shadow = decoded;
  }
  return shadows;
}

function hasRecognizedEncodedCredential(value) {
  for (const shadow of percentDecodedShadows(value)) {
    const unescaped = unescapeQuotedDiagnostic(shadow);
    const structured = structuredDiagnostic(unescaped);
    if (structured.includes("[REDACTED]")) return true;
    if (fallbackRedactDiagnostic(unescaped) !== unescaped) return true;
  }
  return false;
}

export function sanitizeDiagnostic(value) {
  try {
    const source = String(value ?? "").slice(0, MAX_DIAGNOSTIC_INPUT_CHARS);
    const diagnostic = unescapeQuotedDiagnostic(structuredDiagnostic(source));
    if (hasRecognizedEncodedCredential(diagnostic)) return "[REDACTED_DIAGNOSTIC]";
    return fallbackRedactDiagnostic(diagnostic)
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .slice(0, MAX_LOG_CHARS);
  } catch {
    return "[REDACTED_DIAGNOSTIC]";
  }
}

function instanceLabel(entry) {
  if (entry?.labels === undefined) return { instanceId: "", valid: true };
  if (!Array.isArray(entry.labels)) return { instanceId: "", valid: false };
  if (entry.labels.some((item) => (
    !item
    || typeof item !== "object"
    || Array.isArray(item)
    || typeof item.name !== "string"
    || !item.name
    || typeof item.value !== "string"
    || !item.value
  ))) return { instanceId: "", valid: false };
  const values = entry.labels
    .filter((item) => item?.name === "instance")
    .map((item) => item?.value)
    .filter((value) => typeof value === "string" && value);
  if (new Set(values).size > 1) return { instanceId: "", valid: false };
  return { instanceId: values[0] ?? "", valid: true };
}

export function normalizeLogRecords(values) {
  const entries = values.flatMap((value) => {
    const array = arrayPayload(value);
    return array.length ? array : [value];
  });
  return entries.slice(0, MAX_LOG_LINES + 1).map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { id: "", timestamp: "", message: "[malformed log record]", instanceId: "", metadataValid: false };
    }
    const instance = instanceLabel(entry);
    const id = typeof entry?.id === "string" ? entry.id : "";
    const rawTimestamp = entry?.timestamp ?? entry?.time ?? entry?.createdAt;
    const rawMessage = entry?.message ?? entry?.text ?? entry?.log ?? entry?.body;
    const timestamp = typeof rawTimestamp === "string" ? rawTimestamp : "";
    const message = typeof rawMessage === "string" && rawMessage ? rawMessage : "[malformed log record]";
    return {
      id,
      timestamp,
      message,
      instanceId: instance.instanceId,
      metadataValid: instance.valid
        && Boolean(id)
        && typeof rawTimestamp === "string"
        && Boolean(timestamp)
        && typeof rawMessage === "string"
        && Boolean(rawMessage),
    };
  });
}

function logDiagnostic(entry) {
  const instance = entry.instanceId ? ` instance=${entry.instanceId}` : "";
  return sanitizeDiagnostic(`${entry.timestamp}${instance} ${entry.message}`.trim());
}

function requireValue(env, name, pattern) {
  const value = String(env[name] ?? "").trim();
  if (!value) throw new DeploymentStop(`${name} is required`, "CONFIGURATION_ERROR");
  if (pattern && !pattern.test(value)) throw new DeploymentStop(`${name} has an invalid format`, "CONFIGURATION_ERROR");
  return value;
}

export function validateApiHealthUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new DeploymentStop("RENDER_API_HEALTH_URL is invalid", "CONFIGURATION_ERROR");
  }
  if (
    url.protocol !== "https:"
    || url.origin !== EXPECTED_API_HEALTH_ORIGIN
    || url.pathname !== EXPECTED_API_HEALTH_PATH
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new DeploymentStop(
      `RENDER_API_HEALTH_URL must be exactly ${EXPECTED_API_HEALTH_ORIGIN}${EXPECTED_API_HEALTH_PATH}`,
      "CONFIGURATION_ERROR",
    );
  }
  return url;
}

function requestStreamCancel(stream, reason) {
  try {
    const cancellation = stream?.cancel?.(reason);
    if (cancellation && typeof cancellation.catch === "function") cancellation.catch(() => {});
  } catch {
    // A failed cancellation must not expose or retain the rejected body.
  }
}

function abortReason(signal) {
  return signal?.reason instanceof Error ? signal.reason : new Error("health response body aborted");
}

async function readWithAbort(reader, view, signal) {
  if (!signal) return reader.read(view);
  if (signal.aborted) throw abortReason(signal);
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([reader.read(view), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function readBoundedHealthBody(response, signal) {
  const body = response?.body;
  if (!body || typeof body.getReader !== "function") return null;
  if (signal?.aborted) {
    requestStreamCancel(body, "health response aborted");
    return null;
  }

  const contentLength = response.headers?.get?.("content-length");
  if (contentLength !== null && contentLength !== undefined) {
    const normalized = String(contentLength).trim();
    if (!/^\d+$/.test(normalized)) {
      requestStreamCancel(body, "invalid health response content length");
      return null;
    }
    const declaredBytes = BigInt(normalized);
    if (declaredBytes === 0n || declaredBytes > BigInt(MAX_HEALTH_BODY_BYTES)) {
      requestStreamCancel(body, "health response content length rejected");
      return null;
    }
  }

  let reader;
  try {
    reader = body.getReader({ mode: "byob" });
  } catch {
    requestStreamCancel(body, "health response body is not a readable byte stream");
    return null;
  }

  let bytes = new Uint8Array(MAX_HEALTH_BODY_BYTES + 1);
  let totalBytes = 0;
  try {
    while (true) {
      const result = await readWithAbort(reader, bytes.subarray(totalBytes), signal);
      const value = result?.value;
      if (
        !(value instanceof Uint8Array)
        || value.buffer.byteLength !== MAX_HEALTH_BODY_BYTES + 1
        || value.byteOffset !== totalBytes
      ) {
        throw new Error("health response returned an invalid byte-stream chunk");
      }
      bytes = new Uint8Array(value.buffer);
      if (result.done) {
        if (value.byteLength !== 0) throw new Error("health response ended with an invalid byte-stream chunk");
        break;
      }
      if (value.byteLength === 0) throw new Error("health response byte stream made no progress");
      totalBytes += value.byteLength;
      if (totalBytes > MAX_HEALTH_BODY_BYTES) {
        requestStreamCancel(reader, "health response body exceeded byte limit");
        return null;
      }
    }
    if (totalBytes === 0) return null;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, totalBytes));
  } catch {
    requestStreamCancel(reader, "health response body rejected");
    return null;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The response remains rejected even if releasing a failed reader throws.
    }
  }
}

export async function apiHealthResponseMatches(response, targetSha, options = {}) {
  try {
    if (!response?.ok || response.redirected) {
      requestStreamCancel(response?.body, "health response status rejected");
      return false;
    }
    const contentType = response.headers?.get?.("content-type") ?? "";
    if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
      requestStreamCancel(response?.body, "health response content type rejected");
      return false;
    }
    const text = await readBoundedHealthBody(response, options.signal);
    if (!text) return false;
    const body = JSON.parse(text);
    return body?.status === "ok"
      && body?.service === "gcd-social-api"
      && body?.state === "postgres"
      && body?.commit === targetSha;
  } catch {
    requestStreamCancel(response?.body, "health response rejected");
    return false;
  }
}

const INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const CRASH_PATTERN = /^\s*(?:==>\s*)?(?:\[worker\]\s+(?:fatal|panic|uncaught(?:exception)?|unhandledrejection|crash(?:ed|ing)?)(?::|\b)|(?:fatal|panic|uncaught(?:\s+(?:exception|error)|exception)?|unhandledrejection)(?::|\b)|(?:(?:process|instance|worker)\s+)?(?:exited|exit)(?:\s+with)?\s+(?:code|status)\s+[1-9]\d*\b|(?:(?:process|instance|worker)\s+)?crashed\b)/i;

function strictLogWindow(records) {
  if (!records.length) throw new DeploymentStop("worker logs are missing", "WORKER_LOGS_AMBIGUOUS");
  if (records.length >= MAX_LOG_LINES) {
    throw new DeploymentStop("worker log window reached its safety bound", "WORKER_LOGS_AMBIGUOUS");
  }
  const byId = new Map();
  for (const record of records) {
    const timestampMs = Date.parse(record.timestamp);
    if (!record.metadataValid || !RFC3339_PATTERN.test(record.timestamp) || !Number.isFinite(timestampMs)) {
      throw new DeploymentStop("worker log metadata is malformed", "WORKER_LOGS_AMBIGUOUS");
    }
    if (record.instanceId && !INSTANCE_ID_PATTERN.test(record.instanceId)) {
      throw new DeploymentStop("worker log instance identity is malformed", "WORKER_LOGS_AMBIGUOUS");
    }
    const previous = byId.get(record.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(record)) {
      throw new DeploymentStop("worker log IDs conflict", "WORKER_LOGS_AMBIGUOUS");
    }
    byId.set(record.id, { ...record, timestampMs });
  }
  return [...byId.values()].sort((left, right) => (
    left.timestampMs - right.timestampMs || left.id.localeCompare(right.id)
  ));
}

function parseWorkerReadyRecord(record) {
  if (!record.message.startsWith(WORKER_READY_PREFIX)) return null;
  let identity;
  try {
    identity = JSON.parse(record.message.slice(WORKER_READY_PREFIX.length));
  } catch {
    throw new DeploymentStop("worker readiness marker is malformed", "WORKER_READINESS_FAILED");
  }
  const plainObject = identity
    && typeof identity === "object"
    && !Array.isArray(identity)
    && Object.getPrototypeOf(identity) === Object.prototype;
  const instanceValid = identity?.instance === null
    || (typeof identity?.instance === "string" && INSTANCE_ID_PATTERN.test(identity.instance));
  if (
    !plainObject
    || identity.service !== "gcd-social-worker"
    || identity.state !== "postgres"
    || typeof identity.commit !== "string"
    || !SHA_PATTERN.test(identity.commit)
    || !instanceValid
    || (identity.instance && record.instanceId && identity.instance !== record.instanceId)
  ) {
    throw new DeploymentStop("worker readiness identity is invalid", "WORKER_READINESS_FAILED");
  }
  return {
    id: record.id,
    timestamp: record.timestamp,
    timestampMs: record.timestampMs,
    commit: identity.commit,
    instance: identity.instance || record.instanceId || null,
  };
}

export function selectWorkerReadiness(records, targetSha) {
  if (!records.length) return null;
  const window = strictLogWindow(records);
  const markers = window.map(parseWorkerReadyRecord).filter(Boolean);
  const targetMarkers = markers.filter((marker) => marker.commit === targetSha);
  if (!targetMarkers.length) return null;
  if (targetMarkers.length !== 1) {
    throw new DeploymentStop("multiple target worker readiness events are ambiguous", "WORKER_READINESS_FAILED");
  }
  return targetMarkers[0];
}

export function assertWorkerStabilized(records, ready, targetSha) {
  const window = strictLogWindow(records);
  const markers = window.map(parseWorkerReadyRecord).filter(Boolean);
  const authoritative = markers.find((marker) => marker.id === ready.id && marker.commit === targetSha);
  if (!authoritative) {
    throw new DeploymentStop("authoritative readiness event is missing during stabilization", "WORKER_STABILIZATION_FAILED");
  }
  if (markers.some((marker) => marker.commit === targetSha && marker.id !== ready.id)) {
    throw new DeploymentStop("worker restarted during stabilization", "WORKER_STABILIZATION_FAILED");
  }
  if (markers.some((marker) => marker.commit !== targetSha && marker.timestampMs >= ready.timestampMs)) {
    throw new DeploymentStop("non-target worker instance appeared after readiness", "WORKER_STABILIZATION_FAILED");
  }
  const knownOldInstances = new Set(markers
    .filter((marker) => marker.commit !== targetSha && marker.instance && marker.timestampMs < ready.timestampMs)
    .map((marker) => marker.instance));
  for (const record of window) {
    if (record.timestampMs < ready.timestampMs) continue;
    if (!ready.instance && record.instanceId) {
      if (knownOldInstances.has(record.instanceId)) continue;
      throw new DeploymentStop("worker instance is ambiguous after readiness", "WORKER_STABILIZATION_FAILED");
    }
    if (ready.instance && record.instanceId && record.instanceId !== ready.instance) {
      if (knownOldInstances.has(record.instanceId)) continue;
      throw new DeploymentStop("unknown worker instance appeared after readiness", "WORKER_STABILIZATION_FAILED");
    }
    if (CRASH_PATTERN.test(record.message)) {
      throw new DeploymentStop("worker emitted a crash signal after readiness", "WORKER_STABILIZATION_FAILED");
    }
  }
  return true;
}

export function inertDiagnostic(value) {
  const safe = Array.from(sanitizeDiagnostic(value), (char) => (
    /^[A-Za-z0-9 ]$/.test(char) ? char : `&#${char.codePointAt(0)};`
  )).join("");
  return `<code>${safe}</code>`;
}

export function renderSummary(report) {
  const lines = [
    "# Render production deployment report",
    "",
    `- Result: ${inertDiagnostic(report.result)}`,
    `- Started: ${inertDiagnostic(report.startedAt)}`,
    `- Finished: ${inertDiagnostic(report.finishedAt ?? "unavailable")}`,
    `- LIVE_SHA: ${inertDiagnostic(report.liveSha ?? "unavailable")}`,
    `- TARGET_SHA: ${inertDiagnostic(report.targetSha ?? "unavailable")}`,
    `- CURRENT_MAIN_SHA: ${inertDiagnostic(report.currentMainSha ?? "unavailable")}`,
    "",
  ];
  if (report.migrations?.length) {
    lines.push("## Migration safety gate", "", "**CONTROLLED MIGRATION ROLLOUT REQUIRED**", "");
    for (const file of report.migrations) lines.push(`- ${inertDiagnostic(file)}`);
    lines.push("");
  }
  if (report.stages.length) {
    lines.push("## Service stages", "", "| Service | ID | Deploy | Status | Commit |", "|---|---|---|---|---|");
    for (const stage of report.stages) {
      lines.push(`| ${inertDiagnostic(stage.name)} | ${inertDiagnostic(stage.id)} | ${inertDiagnostic(stage.deployId ?? "unavailable")} | ${inertDiagnostic(stage.status)} | ${inertDiagnostic(stage.commit ?? "unavailable")} |`);
    }
    lines.push("");
  }
  if (report.evidence.length) {
    lines.push("## Bounded failure evidence", "");
    for (const evidence of report.evidence) {
      lines.push("### Service evidence", "",
        `- Service: ${inertDiagnostic(evidence.name)}`,
        `- Service ID: ${inertDiagnostic(evidence.id)}`,
        `- Deploy ID: ${inertDiagnostic(evidence.deployId ?? "unavailable")}`,
        `- Deploy status: ${inertDiagnostic(evidence.status ?? "unavailable")}`,
        `- Render error: ${inertDiagnostic(evidence.error || "unavailable")}`,
        `- Created: ${inertDiagnostic(evidence.createdAt ?? "unavailable")}`,
        `- Finished: ${inertDiagnostic(evidence.finishedAt ?? "unavailable")}`,
        "", "Build logs (sanitized, bounded):", "");
      lines.push(...(evidence.buildLogs.length ? evidence.buildLogs.map((line) => `- ${inertDiagnostic(line)}`) : ["- unavailable"]));
      lines.push("", "Runtime logs (sanitized, bounded):", "");
      lines.push(...(evidence.runtimeLogs.length ? evidence.runtimeLogs.map((line) => `- ${inertDiagnostic(line)}`) : ["- unavailable"]));
      lines.push("");
    }
  }
  if (report.notes.length) lines.push("## Notes", "", ...report.notes.map((note) => `- ${inertDiagnostic(note)}`), "");
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

  async function readRenderLogs(args, attempts = 3) {
    let lastFailure = "log read failed";
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const result = await render(args);
      if (result.code === 0) {
        try {
          return normalizeLogRecords(parseJsonValues(result.stdout));
        } catch (error) {
          lastFailure = error.message;
        }
      } else {
        lastFailure = `Render CLI exited ${result.code}`;
      }
      if (attempt < attempts) await sleep(attempt * 1_000);
    }
    throw new DeploymentStop(lastFailure, "RENDER_LOG_READ_FAILED");
  }

  async function boundedLogs(serviceId, type, start, attempts = 3) {
    try {
      return await readRenderLogs([
        "logs", "--resources", serviceId, "--start", start, "--limit", String(MAX_LOG_LINES),
        "--type", type, "--direction", "backward", "--confirm", "-o", "json",
      ], attempts);
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
      buildLogs: buildLogs.slice(0, MAX_LOG_LINES).map(logDiagnostic),
      runtimeLogs: runtimeLogs.slice(0, MAX_LOG_LINES).map(logDiagnostic),
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
    const healthUrl = validateApiHealthUrl(requireValue(env, "RENDER_API_HEALTH_URL"));

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
        const healthSignal = AbortSignal.timeout(10_000);
        const response = await fetchFn(healthUrl, {
          method: "GET",
          redirect: "error",
          signal: healthSignal,
          headers: { accept: "application/json" },
        });
        if (await apiHealthResponseMatches(response, targetSha, { signal: healthSignal })) {
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
    report.notes.push("API /healthz proved the expected GCD API, durable state, and TARGET_SHA.");

    const workerResult = await deployService(services.worker);
    let workerReady = null;
    for (let attempt = 1; attempt <= WORKER_READY_ATTEMPTS; attempt += 1) {
      const workerLogs = await boundedLogs(services.worker.id, "app", workerResult.stageStartedAt, 1);
      workerReady = selectWorkerReadiness(workerLogs, targetSha);
      if (workerReady) break;
      if (attempt < WORKER_READY_ATTEMPTS) await sleep(WORKER_READY_INTERVAL_MS);
    }
    if (!workerReady) {
      await collectEvidence(services.worker, workerResult.deploy);
      throw new DeploymentStop("worker did not emit exact TARGET_SHA readiness", "WORKER_READINESS_FAILED");
    }
    await sleep(WORKER_STABILIZATION_MS);
    const stabilizationLogs = await boundedLogs(services.worker.id, "app", workerReady.timestamp, 1);
    try {
      assertWorkerStabilized(stabilizationLogs, workerReady, targetSha);
    } catch (error) {
      await collectEvidence(services.worker, workerResult.deploy);
      throw error;
    }
    report.notes.push("Worker emitted exact TARGET_SHA readiness and passed a bounded 10-second stabilization observation.");

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
