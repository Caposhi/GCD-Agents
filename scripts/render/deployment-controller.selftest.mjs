import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  apiHealthResponseMatches,
  assertWorkerStabilized,
  DeploymentStop,
  inertDiagnostic,
  MAX_HEALTH_BODY_BYTES,
  normalizeDeploys,
  normalizeLogRecords,
  parseJsonValues,
  renderSummary,
  runDeployment,
  sanitizeDiagnostic,
  selectWorkerReadiness,
  selectLiveDeploy,
  validateApiHealthUrl,
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
    RENDER_API_HEALTH_URL: "https://gcd-social-api.onrender.com/healthz",
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

function logRecord(id, message, options = {}) {
  const instance = options.instance === undefined ? "instance-target" : options.instance;
  return {
    id,
    timestamp: options.timestamp ?? "2026-08-24T13:03:01Z",
    message,
    labels: instance ? [{ name: "instance", value: instance }] : [],
  };
}

function readyMessage(sha = targetSha, instance = "instance-target") {
  return `[worker] ready ${JSON.stringify({
    service: "gcd-social-worker",
    commit: sha,
    instance,
    state: "postgres",
  })}`;
}

function readyLog(sha = targetSha, options = {}) {
  const instance = options.instance === undefined ? "instance-target" : options.instance;
  return logRecord(options.id ?? `log-ready-${sha.slice(0, 6)}-${instance ?? "none"}`, readyMessage(sha, instance), {
    ...options,
    instance,
  });
}

function jsonSequence(entries, separator = "") {
  return entries.map((entry) => JSON.stringify(entry, null, 2)).join(separator);
}

const textEncoder = new TextEncoder();

function healthResponse(body = {
  status: "ok",
  service: "gcd-social-api",
  state: "postgres",
  commit: targetSha,
}, overrides = {}) {
  const contentType = overrides.contentType ?? "application/json; charset=utf-8";
  const text = overrides.text ?? JSON.stringify(body);
  const bytes = overrides.bytes ?? textEncoder.encode(text);
  const metrics = {
    pulls: 0,
    bytesProduced: 0,
    cancellations: 0,
    maxRequestedBytes: 0,
  };
  let offset = 0;
  const stream = Object.hasOwn(overrides, "body") ? overrides.body : new ReadableStream({
    type: "bytes",
    pull(controller) {
      metrics.pulls += 1;
      overrides.onPull?.();
      if (overrides.stall) return;
      if (overrides.streamErrorAtByte !== undefined && offset >= overrides.streamErrorAtByte) {
        controller.error(new Error("fixture stream failure"));
        return;
      }
      if (offset >= bytes.byteLength) {
        controller.close();
        controller.byobRequest?.respond(0);
        return;
      }
      const request = controller.byobRequest;
      if (!request) {
        controller.error(new Error("fixture requires a BYOB reader"));
        return;
      }
      metrics.maxRequestedBytes = Math.max(metrics.maxRequestedBytes, request.view.byteLength);
      const chunkSize = overrides.chunkSize ?? request.view.byteLength;
      const count = Math.min(chunkSize, request.view.byteLength, bytes.byteLength - offset);
      request.view.set(bytes.subarray(offset, offset + count));
      offset += count;
      metrics.bytesProduced += count;
      request.respond(count);
    },
    cancel() {
      metrics.cancellations += 1;
    },
  });
  const contentLength = Object.hasOwn(overrides, "contentLength")
    ? overrides.contentLength
    : String(bytes.byteLength);
  return {
    ok: overrides.ok ?? true,
    redirected: overrides.redirected ?? false,
    headers: {
      get: (name) => {
        if (name.toLowerCase() === "content-type") return contentType;
        if (name.toLowerCase() === "content-length") return contentLength;
        return null;
      },
    },
    body: stream,
    metrics,
  };
}

function healthJsonAtByteLength(byteLength, marker = "") {
  const body = {
    status: "ok",
    service: "gcd-social-api",
    state: "postgres",
    commit: targetSha,
    padding: "",
    marker,
  };
  const emptyLength = textEncoder.encode(JSON.stringify(body)).byteLength;
  assert(emptyLength <= byteLength);
  body.padding = "x".repeat(byteLength - emptyLength);
  const text = JSON.stringify(body);
  assert.equal(textEncoder.encode(text).byteLength, byteLength);
  return text;
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
    workerLogBatches = [[readyLog()], [readyLog()]],
    failureLogs = [],
  } = options;
  let workerLogRead = 0;
  const render = async (args) => {
    calls.push(args);
    if (args[0] === "workspace") return result(0, { id: baseEnv().RENDER_WORKSPACE_ID });
    if (args[0] === "deploys" && args[1] === "create") {
      const serviceId = args[2];
      if (serviceId === malformedService) {
        return result(0, `garbage Bearer raw-render-secret\n${JSON.stringify(deployRecord(serviceId, targetSha))}`);
      }
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
      if (failureLogs.length) return result(0, jsonSequence(failureLogs));
      if (!args.includes(ids.worker)) return result(0, jsonSequence([]));
      const batch = workerLogBatches[Math.min(workerLogRead, workerLogBatches.length - 1)] ?? [];
      workerLogRead += 1;
      return result(0, jsonSequence(batch));
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

function maximumWorkerAppReadsForOneWindow(calls) {
  const counts = new Map();
  for (const args of calls.filter((item) => (
    item[0] === "logs"
    && item.includes(ids.worker)
    && item[item.indexOf("--type") + 1] === "app"
  ))) {
    const start = args[args.indexOf("--start") + 1];
    counts.set(start, (counts.get(start) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
}

const liveFixture = await fixture("api-live.json");
assert.equal(normalizeDeploys(liveFixture).length, 1);
assert.equal(selectLiveDeploy(liveFixture).commit.id, oldSha);
assert.equal(normalizeDeploys({ deploy: deployRecord(ids.api, targetSha) }).length, 1);
const workerFixture = normalizeLogRecords([await fixture("worker-startup-logs.json")]);
const fixtureReady = selectWorkerReadiness(workerFixture, targetSha);
assert.equal(fixtureReady.commit, targetSha);
assert.equal(assertWorkerStabilized(workerFixture, fixtureReady, targetSha), true);

// Render CLI 2.22.0 writes adjacent sequential pretty-printed log objects, not an array.
{
  const records = [
    readyLog(targetSha),
    logRecord("log-braces", "message with { braces } and an escaped \"quote\"", { instance: "instance-target" }),
  ];
  const parsed = normalizeLogRecords(parseJsonValues(jsonSequence(records)));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].instanceId, "instance-target");
  assert.equal(parsed[1].message, "message with { braces } and an escaped \"quote\"");
  assert.equal(parseJsonValues(jsonSequence(records, "\n")).length, 2);
  assert.throws(() => parseJsonValues('{"id":"incomplete"'), /incomplete JSON log output/);
  assert.throws(() => parseJsonValues('garbage {"id":"log"}'), /unexpected non-JSON log output/);
}

// Health verification is pinned to the reviewed GCD API origin and exact path.
assert.equal(validateApiHealthUrl("https://gcd-social-api.onrender.com/healthz").href,
  "https://gcd-social-api.onrender.com/healthz");
for (const invalidUrl of [
  "https://example.invalid/healthz",
  "https://gcd-social-api.onrender.com.evil.invalid/healthz",
  "https://gcd-social-api.onrender.com/healthz/extra",
  "http://gcd-social-api.onrender.com/healthz",
  "https://user:password@gcd-social-api.onrender.com/healthz",
  "https://gcd-social-api.onrender.com/healthz?probe=1",
  "https://gcd-social-api.onrender.com/healthz#fragment",
]) {
  assert.throws(() => validateApiHealthUrl(invalidUrl), DeploymentStop, invalidUrl);
}
assert.equal(await apiHealthResponseMatches(healthResponse(), targetSha), true);

// Node 22's real fetch-compatible Response body supports the bounded BYOB path.
{
  const response = new Response(JSON.stringify({
    status: "ok", service: "gcd-social-api", state: "postgres", commit: targetSha,
  }), { headers: { "content-type": "application/json" } });
  assert.equal(await apiHealthResponseMatches(response, targetSha), true);
}

// Health bodies are counted in transport bytes, with one byte of overflow detection only.
{
  const small = healthResponse(undefined, { chunkSize: 3 });
  assert.equal(await apiHealthResponseMatches(small, targetSha), true);
  assert.equal(small.metrics.bytesProduced, textEncoder.encode(JSON.stringify({
    status: "ok", service: "gcd-social-api", state: "postgres", commit: targetSha,
  })).byteLength);

  const exactText = healthJsonAtByteLength(MAX_HEALTH_BODY_BYTES, "€");
  const exact = healthResponse(undefined, { text: exactText, chunkSize: 1 });
  assert.equal(await apiHealthResponseMatches(exact, targetSha), true);
  assert.equal(exact.metrics.bytesProduced, MAX_HEALTH_BODY_BYTES);
  assert.equal(exact.metrics.cancellations, 0);

  const oneOver = healthResponse(undefined, {
    text: `${exactText} `,
    contentLength: null,
    chunkSize: 257,
  });
  assert(`${exactText} `.length <= MAX_HEALTH_BODY_BYTES);
  assert.equal(await apiHealthResponseMatches(oneOver, targetSha), false);
  assert.equal(oneOver.metrics.bytesProduced, MAX_HEALTH_BODY_BYTES + 1);
  assert.equal(oneOver.metrics.cancellations, 1);

  const megabyte = new Uint8Array(1024 * 1024).fill(0x78);
  const huge = healthResponse(undefined, { bytes: megabyte, contentLength: null });
  assert.equal(await apiHealthResponseMatches(huge, targetSha), false);
  assert.equal(huge.metrics.bytesProduced, MAX_HEALTH_BODY_BYTES + 1);
  assert.equal(huge.metrics.maxRequestedBytes, MAX_HEALTH_BODY_BYTES + 1);
  assert.equal(huge.metrics.cancellations, 1);
  assert(huge.metrics.bytesProduced < megabyte.byteLength);

  const falseSmallLength = healthResponse(undefined, {
    bytes: megabyte,
    contentLength: "64",
  });
  assert.equal(await apiHealthResponseMatches(falseSmallLength, targetSha), false);
  assert.equal(falseSmallLength.metrics.bytesProduced, MAX_HEALTH_BODY_BYTES + 1);
  assert.equal(falseSmallLength.metrics.cancellations, 1);

  const declaredOversize = healthResponse(undefined, {
    contentLength: String(MAX_HEALTH_BODY_BYTES + 1),
  });
  assert.equal(await apiHealthResponseMatches(declaredOversize, targetSha), false);
  assert.equal(declaredOversize.metrics.pulls, 0);
  assert.equal(declaredOversize.metrics.bytesProduced, 0);
  assert.equal(declaredOversize.metrics.cancellations, 1);

  for (const invalidLength of ["", "-1", "4096x", "1e9", "4096, 4096", "9".repeat(100)]) {
    const invalid = healthResponse(undefined, { contentLength: invalidLength });
    assert.equal(await apiHealthResponseMatches(invalid, targetSha), false, invalidLength);
    assert.equal(invalid.metrics.pulls, 0, invalidLength);
    assert.equal(invalid.metrics.cancellations, 1, invalidLength);
  }

  const zeroLength = healthResponse(undefined, { contentLength: "0" });
  assert.equal(await apiHealthResponseMatches(zeroLength, targetSha), false);
  assert.equal(zeroLength.metrics.pulls, 0);
  assert.equal(zeroLength.metrics.cancellations, 1);

  const absentLengthSmall = healthResponse(undefined, { contentLength: null, chunkSize: 2 });
  assert.equal(await apiHealthResponseMatches(absentLengthSmall, targetSha), true);

  const malformedPrefix = textEncoder.encode(JSON.stringify({
    status: "ok", service: "gcd-social-api", state: "postgres", commit: targetSha, note: "",
  }).replace('"note":""}', '"note":"'));
  const malformedSuffix = textEncoder.encode('"}');
  const malformedBytes = new Uint8Array(malformedPrefix.byteLength + 1 + malformedSuffix.byteLength);
  malformedBytes.set(malformedPrefix);
  malformedBytes[malformedPrefix.byteLength] = 0xff;
  malformedBytes.set(malformedSuffix, malformedPrefix.byteLength + 1);
  const permissivelyDecoded = JSON.parse(new TextDecoder().decode(malformedBytes));
  assert.equal(permissivelyDecoded.status, "ok");
  assert.equal(permissivelyDecoded.service, "gcd-social-api");
  assert.equal(permissivelyDecoded.state, "postgres");
  assert.equal(permissivelyDecoded.commit, targetSha);
  const malformedUtf8 = healthResponse(undefined, { bytes: malformedBytes });
  assert.equal(await apiHealthResponseMatches(malformedUtf8, targetSha), false);

  const streamFailure = healthResponse(undefined, { chunkSize: 5, streamErrorAtByte: 5 });
  assert.equal(await apiHealthResponseMatches(streamFailure, targetSha), false);
  assert(streamFailure.metrics.bytesProduced <= 5);

  const empty = healthResponse(undefined, { bytes: new Uint8Array(), contentLength: null });
  assert.equal(await apiHealthResponseMatches(empty, targetSha), false);

  const missingBody = healthResponse(undefined, { body: null, contentLength: null });
  let unsafeTextFallbackCalls = 0;
  missingBody.text = async () => { unsafeTextFallbackCalls += 1; return "{}"; };
  assert.equal(await apiHealthResponseMatches(missingBody, targetSha), false);
  assert.equal(unsafeTextFallbackCalls, 0);

  const nonByteStream = healthResponse(undefined, {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(textEncoder.encode("{}"));
        controller.close();
      },
    }),
    contentLength: null,
  });
  assert.equal(await apiHealthResponseMatches(nonByteStream, targetSha), false);

  const abortController = new AbortController();
  const stalled = healthResponse(undefined, {
    contentLength: null,
    stall: true,
    onPull: () => abortController.abort(new Error("fixture health timeout")),
  });
  const abortedResult = await Promise.race([
    apiHealthResponseMatches(stalled, targetSha, { signal: abortController.signal }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("health abort was not bounded")), 250)),
  ]);
  assert.equal(abortedResult, false);
  assert.equal(stalled.metrics.cancellations, 1);
}

for (const [scenario, response] of [
  ["redirect", healthResponse(undefined, { redirected: true })],
  ["unrelated 200", healthResponse({ status: "ok", service: "other", state: "postgres", commit: targetSha })],
  ["HTML 200", healthResponse(undefined, { contentType: "text/html" })],
  ["malformed JSON", healthResponse(undefined, { text: "{not-json" })],
  ["wrong service", healthResponse({ status: "ok", service: "wrong", state: "postgres", commit: targetSha })],
  ["wrong state", healthResponse({ status: "ok", service: "gcd-social-api", state: "ephemeral", commit: targetSha })],
  ["wrong commit", healthResponse({ status: "ok", service: "gcd-social-api", state: "postgres", commit: oldSha })],
  ["missing commit", healthResponse({ status: "ok", service: "gcd-social-api", state: "postgres" })],
  ["non-2xx", healthResponse(undefined, { ok: false })],
]) {
  assert.equal(await apiHealthResponseMatches(response, targetSha), false, scenario);
}

const credentialSeparator = String.fromCharCode(64);
const secretSamples = [
  ["Authorization: Basic dXNlcjpwYXNz", "dXNlcjpwYXNz"],
  ["Bearer secret-value", "secret-value"],
  ["https://hooks.slack.com/services/T000/B000/secret", "/T000/B000/secret"],
  [`postgresql://user:password${credentialSeparator}db.example/gcd`, "user:password"],
  [`redis://user:password${credentialSeparator}cache.example:6379/0`, "user:password"],
  ["RENDER_API_KEY=opaque-fixture-secret", "opaque-fixture-secret"],
  ["ACCESS_TOKEN=oauth-fixture-secret", "oauth-fixture-secret"],
  ["GOOGLE_ACCESS_TOKEN=google-prefixed-secret", "google-prefixed-secret"],
  ['FOO_PASSWORD="password-prefixed-secret"', "password-prefixed-secret"],
  ["rnd_renderfixture123", "renderfixture123"],
  ["xoxb-slackfixture123", "slackfixture123"],
  ["ya29.oauthfixture123", "oauthfixture123"],
  ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature", "signature"],
  ["https://example.invalid/path?access_token=query-secret", "query-secret"],
  ["https://example.invalid/path?token=query-token-secret", "query-token-secret"],
  ["user@example.com", "user@example.com"],
  ['{"access_token":"json-access-secret"}', "json-access-secret"],
  ['{"refresh_token":"json-refresh-secret","password":"json-password-secret"}', "json-refresh-secret"],
  ['{"refresh_token":"json-refresh-secret","password":"json-password-secret"}', "json-password-secret"],
  ['{"Authorization":"Basic json-basic-secret"}', "json-basic-secret"],
  ['{"nested":{"client_secret":"json-client-secret"}}', "json-client-secret"],
  ['[{"token":"json-array-secret"}]', "json-array-secret"],
  ['prefix {"access_token":"mixed-json-secret"} suffix', "mixed-json-secret"],
  ['{\\"access_token\\":\\"escaped-json-secret\\"}', "escaped-json-secret"],
  [String.raw`{\\"access_token\\":\\"double-escaped-secret\\"}`, "double-escaped-secret"],
  ["Authorization: Basic basic-secret", "basic-secret"],
  [`https://user:url-secret${credentialSeparator}example.com/path`, "url-secret"],
];
for (const [sample, secret] of secretSamples) {
  const sanitized = sanitizeDiagnostic(sample);
  assert(!sanitized.includes(secret), sample);
}

function percentEncodeAll(value, lowerCaseHex = false) {
  return Array.from(textEncoder.encode(value), (byte) => {
    const hex = byte.toString(16).padStart(2, "0");
    return `%${lowerCaseHex ? hex : hex.toUpperCase()}`;
  }).join("");
}

const encodedSecretSamples = [
  ["Authorization%3A%20Bearer%20EncodedBearerSecret123", "EncodedBearerSecret123"],
  ["Authorization%3a%20Basic%20EncodedBasicSecret123", "EncodedBasicSecret123"],
  [percentEncodeAll("Authorization: Bearer FullyByteEncodedAuthSecret123"), "FullyByteEncodedAuthSecret123"],
  [percentEncodeAll("Authorization: Basic LowerByteEncodedAuthSecret123", true), "LowerByteEncodedAuthSecret123"],
  ["Authorization%253A%2520Basic%2520DoubleEncodedSecret123", "DoubleEncodedSecret123"],
  ["Authorization%3A+Bearer+PlusEncodedSecret123", "PlusEncodedSecret123"],
  ["https%3A%2F%2Fhooks.slack.com%2Fservices%2FT000%2FB000%2FEncodedWebhookSecret123", "EncodedWebhookSecret123"],
  [percentEncodeAll("https://hooks.slack.com/services/T000/B000/FullyByteEncodedWebhook123"), "FullyByteEncodedWebhook123"],
  ["https%3A%2F%2Fuser%3AEncodedUrlSecret123%40example.com%2Fpath", "EncodedUrlSecret123"],
  ["postgresql%3A%2F%2Fuser%3AEncodedPostgresSecret123%40host%2Fdb", "EncodedPostgresSecret123"],
  ["redis%3a%2f%2fuser%3aEncodedRedisSecret123%40host%2f0", "EncodedRedisSecret123"],
  ["access%5Ftoken%3DEncodedAccessSecret123", "EncodedAccessSecret123"],
  ["refresh%5ftoken%3dEncodedRefreshSecret123", "EncodedRefreshSecret123"],
  ["api%5Fkey%3DEncodedApiSecret123", "EncodedApiSecret123"],
  ["token%3D%46%75%6C%6C%79%45%6E%63%6F%64%65%64%53%65%63%72%65%74%31%32%33", "FullyEncodedSecret123"],
  ["secret%3DEncodedGenericSecret123", "EncodedGenericSecret123"],
  ["password%3DEncodedPasswordSecret123", "EncodedPasswordSecret123"],
  ["signature%3DEncodedSignatureSecret123", "EncodedSignatureSecret123"],
  ["%7B%22access_token%22%3A%22EncodedJsonSecret123%22%7D", "EncodedJsonSecret123"],
  [percentEncodeAll("TOKEN => EncodedArrowSecret123"), "EncodedArrowSecret123"],
  ["prefix%20Authorization%3A%20Bearer%20MixedEncodedSecret123%20suffix", "MixedEncodedSecret123"],
  ["%ZZprefix%20Authorization%3A%20Bearer%20MalformedPrefixSecret123", "MalformedPrefixSecret123"],
  ["%FFAuthorization%3A%20Bearer%20InvalidBytePrefixSecret123", "InvalidBytePrefixSecret123"],
];
for (const [sample, secret] of encodedSecretSamples) {
  assert.equal(sanitizeDiagnostic(sample), "[REDACTED_DIAGNOSTIC]", sample);
  assert(!sanitizeDiagnostic(sample).includes(secret), sample);
}

const alternateAssignmentSamples = [
  ["TOKEN => AlternateSecret123", "AlternateSecret123"],
  ["TOKEN->TightSecret123", "TightSecret123"],
  ['password => "QuotedPasswordSecret123"', "QuotedPasswordSecret123"],
  ['"access_token" => "QuotedAccessSecret123"', "QuotedAccessSecret123"],
  ["'refresh_token' -> 'QuotedRefreshSecret123'", "QuotedRefreshSecret123"],
  ['"Authorization" => Bearer QuotedAuthSecret123', "QuotedAuthSecret123"],
  ["'Authorization' -> Basic QuotedBasicSecret123", "QuotedBasicSecret123"],
  ['"token" => Bearer QuotedTokenSchemeSecret123', "QuotedTokenSchemeSecret123"],
];
for (const [sample, secret] of alternateAssignmentSamples) {
  assert(!sanitizeDiagnostic(sample).includes(secret), sample);
}

assert.equal(sanitizeDiagnostic("x".repeat(600)).length, 500);
assert(sanitizeDiagnostic('{"tokenizer":"harmless-value"}').includes("harmless-value"));
assert(sanitizeDiagnostic("FOO_TOKENIZER=harmless-assignment").includes("harmless-assignment"));
assert(sanitizeDiagnostic("FOO_TOKENIZER => HarmlessArrowValue123").includes("HarmlessArrowValue123"));
assert(sanitizeDiagnostic("tokenizer->HarmlessTightValue123").includes("HarmlessTightValue123"));
assert(sanitizeDiagnostic("tokenizer%3DHarmlessEncodedValue123").includes("HarmlessEncodedValue123"));
assert.equal(sanitizeDiagnostic("%3Cscript%3Eencoded-markup-only%3C%2Fscript%3E"),
  "%3Cscript%3Eencoded-markup-only%3C%2Fscript%3E");
assert.equal(sanitizeDiagnostic(`${encodedSecretSamples[0][0]}${"x".repeat(25_000)}`), "[REDACTED_DIAGNOSTIC]");
assert(inertDiagnostic("`".repeat(500)).length <= 5_100);

function summaryContaining(sample) {
  return renderSummary({
    result: "failed",
    startedAt: sample,
    finishedAt: sample,
    liveSha: sample,
    targetSha,
    currentMainSha: targetSha,
    migrations: [sample],
    stages: [{ name: sample, id: sample, deployId: sample, status: sample, commit: sample }],
    evidence: [{
      name: sample,
      id: sample,
      deployId: sample,
      status: sample,
      error: sample,
      createdAt: sample,
      finishedAt: sample,
      buildLogs: [sample],
      runtimeLogs: [sample],
    }],
    notes: [sample],
  });
}

for (const [sample, secret] of secretSamples) {
  const summary = summaryContaining(sample);
  assert(!summary.includes(secret), sample);
  assert(summary.includes("<code>"), sample);
}

for (const [sample, secret] of [...encodedSecretSamples, ...alternateAssignmentSamples]) {
  const summary = summaryContaining(sample);
  assert(!summary.includes(sample), sample);
  assert(!summary.includes(secret), sample);
  assert(summary.includes("<code>"), sample);
}

for (const [sample, secret, activeMarkup] of [
  ["Authorization%3A%20Bearer%20EncodedMarkdownSecret123 ![image](https://example.invalid/tracker)", "EncodedMarkdownSecret123", "![image](https://example.invalid/tracker)"],
  ["https%3A%2F%2Fhooks.slack.com%2Fservices%2FT%2FB%2FEncodedHtmlSecret123 <img src='https://example.invalid/tracker'>", "EncodedHtmlSecret123", "<img src='https://example.invalid/tracker'>"],
  ["TOKEN => ArrowMarkdownSecret123 `inline` [click](https://example.invalid)", "ArrowMarkdownSecret123", "`inline` [click](https://example.invalid)"],
]) {
  assert(!sanitizeDiagnostic(sample).includes(secret), sample);
  const summary = summaryContaining(sample);
  assert(!summary.includes(sample), sample);
  assert(!summary.includes(secret), sample);
  assert(!summary.includes(activeMarkup), sample);
  assert(summary.includes("<code>"), sample);
}

const markdownSamples = [
  "![image](https://example.invalid/tracker)",
  "[click](https://example.invalid)",
  '<img src="https://example.invalid/tracker">',
  "<script>alert(1)</script>",
  "# fake heading",
  "| fake | table |",
  "`inline`",
  "```fence```",
  "> quote",
  "- fake list item",
  '![secret](https://example.invalid/?access_token=markdown-secret)',
];
for (const sample of markdownSamples) {
  const summary = summaryContaining(sample);
  assert(!summary.includes(sample), sample);
  assert(!summary.includes("markdown-secret"), sample);
  assert(summary.includes("<code>"), sample);
}

// Readiness accepts only one exact target marker and preserves instance binding.
{
  const startedOnly = normalizeLogRecords([[logRecord("log-started", "[worker] gcd-social-worker started")]]);
  assert.equal(selectWorkerReadiness(startedOnly, targetSha), null);
  assert.equal(selectWorkerReadiness([], targetSha), null);

  const oldReady = normalizeLogRecords([[readyLog(oldSha, { id: "log-old", instance: "instance-old" })]]);
  assert.equal(selectWorkerReadiness(oldReady, targetSha), null);

  const mixed = normalizeLogRecords([[
    readyLog(oldSha, { id: "log-old", instance: "instance-old", timestamp: "2026-08-24T13:03:00Z" }),
    readyLog(targetSha, { id: "log-target", instance: "instance-target", timestamp: "2026-08-24T13:03:01Z" }),
  ]]);
  const ready = selectWorkerReadiness(mixed, targetSha);
  assert.equal(ready.commit, targetSha);
  assert.equal(ready.instance, "instance-target");

  const malformed = normalizeLogRecords([[
    logRecord("log-malformed", "[worker] ready {not-json"),
  ]]);
  assert.throws(() => selectWorkerReadiness(malformed, targetSha), (error) => error?.code === "WORKER_READINESS_FAILED");

  const wrongIdentity = normalizeLogRecords([[
    logRecord("log-wrong", `[worker] ready ${JSON.stringify({
      service: "gcd-social-worker", commit: "short", instance: "instance-target", state: "postgres",
    })}`),
  ]]);
  assert.throws(() => selectWorkerReadiness(wrongIdentity, targetSha), (error) => error?.code === "WORKER_READINESS_FAILED");

  const mismatchedLabel = normalizeLogRecords([[
    readyLog(targetSha, { id: "log-mismatch", instance: "marker-instance" }),
  ]]);
  mismatchedLabel[0].instanceId = "different-log-instance";
  assert.throws(() => selectWorkerReadiness(mismatchedLabel, targetSha), (error) => error?.code === "WORKER_READINESS_FAILED");

  const stable = normalizeLogRecords([[
    readyLog(targetSha, { id: "log-stable", timestamp: "2026-08-24T13:03:01Z" }),
    logRecord("log-benign", "[worker] running brief: write copy about crash safety", {
      timestamp: "2026-08-24T13:03:04Z",
    }),
  ]]);
  const stableReady = selectWorkerReadiness(stable, targetSha);
  assert.equal(assertWorkerStabilized(stable, stableReady, targetSha), true);

  for (const [index, crashMessage] of [
    "[worker] fatal: startup dependency lost",
    "Process exited with status 10",
    "==> Exited with status 1",
    "worker exited with code 127",
    "UncaughtException: boom",
    "UnhandledRejection: boom",
  ].entries()) {
    const crashed = normalizeLogRecords([[
      readyLog(targetSha, { id: "log-stable", timestamp: "2026-08-24T13:03:01Z" }),
      logRecord(`log-crash-${index}`, crashMessage, { timestamp: "2026-08-24T13:03:05Z" }),
    ]]);
    assert.throws(() => assertWorkerStabilized(crashed, stableReady, targetSha),
      (error) => error?.code === "WORKER_STABILIZATION_FAILED", crashMessage);
  }
  assert.throws(() => assertWorkerStabilized([], stableReady, targetSha),
    (error) => error?.code === "WORKER_LOGS_AMBIGUOUS");

  const restarted = normalizeLogRecords([[
    readyLog(targetSha, { id: "log-stable", timestamp: "2026-08-24T13:03:01Z" }),
    readyLog(targetSha, { id: "log-restart", instance: "instance-restart", timestamp: "2026-08-24T13:03:06Z" }),
  ]]);
  assert.throws(() => assertWorkerStabilized(restarted, stableReady, targetSha),
    (error) => error?.code === "WORKER_STABILIZATION_FAILED");

  const replacementCrash = normalizeLogRecords([[
    readyLog(targetSha, { id: "log-stable", timestamp: "2026-08-24T13:03:01Z" }),
    logRecord("log-replacement-crash", "Process exited with status 1", {
      instance: "instance-replacement",
      timestamp: "2026-08-24T13:03:06Z",
    }),
  ]]);
  assert.throws(() => assertWorkerStabilized(replacementCrash, stableReady, targetSha),
    (error) => error?.code === "WORKER_STABILIZATION_FAILED");

  const oldCommitReplacement = normalizeLogRecords([[
    readyLog(targetSha, { id: "log-stable", timestamp: "2026-08-24T13:03:01Z" }),
    readyLog(oldSha, {
      id: "log-old-replacement",
      instance: "instance-old-replacement",
      timestamp: "2026-08-24T13:03:06Z",
    }),
  ]]);
  assert.throws(() => assertWorkerStabilized(oldCommitReplacement, stableReady, targetSha),
    (error) => error?.code === "WORKER_STABILIZATION_FAILED");

  const uncorrelatedReady = normalizeLogRecords([[
    readyLog(targetSha, { id: "log-no-instance", instance: null, timestamp: "2026-08-24T13:03:01Z" }),
    logRecord("log-later-instance", "[worker] ordinary post-ready output", {
      instance: "instance-appeared-later",
      timestamp: "2026-08-24T13:03:06Z",
    }),
  ]]);
  const readyWithoutInstance = selectWorkerReadiness(uncorrelatedReady, targetSha);
  assert.equal(readyWithoutInstance.instance, null);
  assert.throws(() => assertWorkerStabilized(uncorrelatedReady, readyWithoutInstance, targetSha),
    (error) => error?.code === "WORKER_STABILIZATION_FAILED");

  for (const malformedEntries of [
    [null, readyLog()],
    [{}, readyLog()],
    [{ ...readyLog(), message: {} }],
    [{ ...readyLog(), timestamp: 1 }],
    [{ ...readyLog(), timestamp: "1" }],
    [{ ...readyLog(), labels: [{ name: "instance", value: 123 }] }],
  ]) {
    const malformedWindow = normalizeLogRecords([malformedEntries]);
    assert.throws(() => selectWorkerReadiness(malformedWindow, targetSha),
      (error) => error?.code === "WORKER_LOGS_AMBIGUOUS");
  }

  const saturated = normalizeLogRecords([[...Array.from({ length: 100 }, (_, index) => (
    logRecord(`log-${index}`, `ordinary log ${index}`, { timestamp: `2026-08-24T13:03:${String(index % 60).padStart(2, "0")}Z` })
  ))]]);
  assert.throws(() => selectWorkerReadiness(saturated, targetSha),
    (error) => error?.code === "WORKER_LOGS_AMBIGUOUS");
  const saturatedBeforeValidation = normalizeLogRecords([[
    null,
    readyLog(targetSha, { id: "log-ready-among-100" }),
    ...Array.from({ length: 98 }, (_, index) => logRecord(`log-valid-${index}`, `ordinary log ${index}`)),
  ]]);
  assert.equal(saturatedBeforeValidation.length, 100);
  assert.throws(() => selectWorkerReadiness(saturatedBeforeValidation, targetSha),
    (error) => error?.code === "WORKER_LOGS_AMBIGUOUS");
}

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
    env: baseEnv(), render, git, fetchFn: async () => healthResponse(), sleep: async () => {},
    writeSummary: async (value) => { summary = value; },
  });
  assert.equal(report.result, "success");
  assert.deepEqual(createCalls(calls).map((args) => args[2]), [ids.api, ids.worker, ids.scheduler]);
  assert(summary.includes(`<code>${targetSha}</code>`));
}

// A misbound health URL fails before any fetch or Render command.
{
  let fetchCalls = 0;
  const renderCalls = [];
  const { git } = createGitFixture();
  await expectStop(() => runDeployment({
    env: baseEnv({ RENDER_API_HEALTH_URL: "https://gcd-social-api.onrender.com.evil.invalid/healthz" }),
    git,
    render: async (args) => { renderCalls.push(args); return result(1); },
    fetchFn: async () => { fetchCalls += 1; return healthResponse(); },
    sleep: async () => {},
    writeSummary: async () => {},
  }), "CONFIGURATION_ERROR");
  assert.equal(fetchCalls, 0);
  assert.equal(renderCalls.length, 0);
}

// Health timeouts are bounded and stop before the worker deployment.
{
  const { calls, render } = createRenderFixture();
  const { git } = createGitFixture();
  let fetchCalls = 0;
  await expectStop(() => runDeployment({
    env: baseEnv(), render, git,
    fetchFn: async () => { fetchCalls += 1; throw new Error("fixture timeout"); },
    sleep: async () => {},
    writeSummary: async () => {},
  }), "API_HEALTH_FAILED");
  assert.equal(fetchCalls, 12);
  assert.deepEqual(createCalls(calls).map((args) => args[2]), [ids.api]);
}

async function expectWorkerGateFailure(workerLogBatches, expectedCode) {
  const { calls, render } = createRenderFixture({ workerLogBatches });
  const { git } = createGitFixture();
  const sleeps = [];
  await expectStop(() => runDeployment({
    env: baseEnv(), render, git,
    fetchFn: async () => healthResponse(),
    sleep: async (duration) => { sleeps.push(duration); },
    writeSummary: async () => {},
  }), expectedCode);
  assert.deepEqual(createCalls(calls).map((args) => args[2]), [ids.api, ids.worker]);
  return { calls, sleeps };
}

const startedOnlyFailure = await expectWorkerGateFailure(
  [[logRecord("log-started-only", "[worker] gcd-social-worker started")]],
  "WORKER_READINESS_FAILED",
);
assert.equal(maximumWorkerAppReadsForOneWindow(startedOnlyFailure.calls), 12);
assert.equal(startedOnlyFailure.sleeps.filter((duration) => duration === 5_000).length, 11);
const missingReadyFailure = await expectWorkerGateFailure([[]], "WORKER_READINESS_FAILED");
assert.equal(maximumWorkerAppReadsForOneWindow(missingReadyFailure.calls), 12);
assert.equal(missingReadyFailure.sleeps.filter((duration) => duration === 5_000).length, 11);
await expectWorkerGateFailure(
  [[readyLog(oldSha, { id: "log-old-only", instance: "instance-old" })]],
  "WORKER_READINESS_FAILED",
);
await expectWorkerGateFailure(
  [[logRecord("log-malformed-ready", "[worker] ready {not-json")]],
  "WORKER_READINESS_FAILED",
);
await expectWorkerGateFailure([
  [readyLog(targetSha, { id: "log-ready-fatal", timestamp: "2026-08-24T13:03:01Z" })],
  [
    readyLog(targetSha, { id: "log-ready-fatal", timestamp: "2026-08-24T13:03:01Z" }),
    logRecord("log-fatal-after-ready", "[worker] fatal: immediate initialization loss", {
      timestamp: "2026-08-24T13:03:06Z",
    }),
  ],
], "WORKER_STABILIZATION_FAILED");
await expectWorkerGateFailure([
  [readyLog(targetSha, { id: "log-ready-missing-observation" })],
  [],
], "WORKER_LOGS_AMBIGUOUS");

// Old-instance output can coexist, but only the exact target marker qualifies.
{
  const mixed = [
    readyLog(oldSha, { id: "log-old-coexist", instance: "instance-old", timestamp: "2026-08-24T13:03:00Z" }),
    readyLog(targetSha, { id: "log-target-coexist", instance: "instance-target", timestamp: "2026-08-24T13:03:01Z" }),
  ];
  const { calls, render } = createRenderFixture({ workerLogBatches: [mixed, mixed] });
  const { git } = createGitFixture();
  const report = await runDeployment({
    env: baseEnv(), render, git,
    fetchFn: async () => healthResponse(),
    sleep: async () => {},
    writeSummary: async () => {},
  });
  assert.equal(report.result, "success");
  assert.deepEqual(createCalls(calls).map((args) => args[2]), [ids.api, ids.worker, ids.scheduler]);
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
  assert(summary.includes("SUPERSEDED RELEASE") && summary.includes("NO DEPLOYMENT"), scenario);
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
  assert(summary.includes("Production already reports"));
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
  assert(summary.includes(inertDiagnostic("build_failed")));
  assert(summary.includes("bounded&#45;line&#45;99"));
  assert(!summary.includes("bounded&#45;line&#45;100"));
  for (const secret of ["log-secret", "user:pass", "/T/B/secret", "opaque-cli-secret", "fixture-only-key"]) {
    assert(!summary.includes(secret));
  }
}

console.log("deployment controller self-test: PASS (gate, byte-bounded exact health, target readiness/stabilization, sequencing, fail-closed states, encoded/fallback redaction, inert summaries)");
