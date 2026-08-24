/**
 * Offline HTTP end-to-end validation for the compiled Phase-0A API.
 *
 * Preconditions:
 *   - DATABASE_URL names a disposable, migrated PostgreSQL database on loopback.
 *   - `npm run build` has produced this file and `dist/api/server.js`.
 *
 * This harness starts the real compiled server with production configuration,
 * creates approval records through the durable application state API, and sends
 * real TCP/HTTP requests to 127.0.0.1. The child process receives no provider,
 * model, image, OAuth, or Slack credentials. A preload guard also blocks and
 * records every attempted child-process fetch so the test cannot silently reach
 * a live provider.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { access } from "node:fs/promises";
import { createServer as createTcpServer, type AddressInfo, createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

interface HttpResult {
  status: number;
  headers: Headers;
  body: string;
}

interface ChildCapture {
  child: ChildProcess;
  output(): string;
}

const OUTBOUND_FETCH_MARKER = "PHASE0A_HTTP_E2E_BLOCKED_OUTBOUND_FETCH";
const TEST_TIMEOUT_MS = 5_000;
let passes = 0;
let failures = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passes += 1;
    console.log(`PASS  ${name}`);
    return;
  }
  failures += 1;
  console.error(`FAIL  ${name}${detail ? ` (${detail})` : ""}`);
}

function parseJson(body: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(body);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function htmlEscape(value: string): string {
  return value.replace(
    /[&<>\"]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character]!,
  );
}

function assertDisposableLoopbackDatabase(raw: string | undefined): string {
  if (!raw) throw new Error("DATABASE_URL must explicitly name the disposable PostgreSQL database");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL is invalid");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use postgres:// or postgresql://");
  }
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if (!loopbackHosts.has(url.hostname.toLowerCase())) {
    throw new Error("refusing HTTP E2E: DATABASE_URL host is not loopback");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database || ["postgres", "template0", "template1"].includes(database.toLowerCase())) {
    throw new Error("refusing HTTP E2E: DATABASE_URL must name a non-default disposable database");
  }
  return raw;
}

async function reservePort(): Promise<number> {
  const server = createTcpServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo | null;
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  if (!address?.port) throw new Error("could not reserve a localhost API port");
  return address.port;
}

async function request(baseUrl: string, path: string, init: RequestInit = {}): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
  });
  return { status: response.status, headers: response.headers, body: await response.text() };
}

function securityHeadersArePresent(result: HttpResult, kind: "json" | "html"): boolean {
  const common = result.headers.get("cache-control") === "no-store"
    && result.headers.get("x-content-type-options") === "nosniff";
  if (kind === "json") return common;
  return common
    && result.headers.get("content-security-policy")?.includes("frame-ancestors 'none'") === true
    && result.headers.get("referrer-policy") === "no-referrer"
    && result.headers.get("permissions-policy")?.includes("camera=()") === true;
}

function startApi(
  serverEntrypoint: string,
  databaseUrl: string,
  port: number,
  consoleToken: string,
  renderCommit: string | null = "2".repeat(40),
): ChildCapture {
  const networkGuard = [
    `const marker=${JSON.stringify(OUTBOUND_FETCH_MARKER)};`,
    "globalThis.fetch=async()=>{process.stderr.write(marker+'\\n');throw new Error(marker);};",
  ].join("");
  const childEnv: NodeJS.ProcessEnv = {
    // Deliberately do not inherit the parent environment wholesale: the
    // validation child receives only runtime basics plus explicit test config.
    PATH: process.env.PATH ?? "",
    LANG: process.env.LANG ?? "C",
    TZ: process.env.TZ ?? "UTC",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    NODE_ENV: "production",
    RENDER_INSTANCE_ID: "http-e2e-instance",
    NODE_OPTIONS: "",
    PORT: String(port),
    API_BIND_HOST: "127.0.0.1",
    DATABASE_URL: databaseUrl,
    CONSOLE_TOKEN: consoleToken,
    AUTONOMY_PHASE: "A",
    ACTIVE_PLATFORMS: "instagram,facebook",
    PUBLIC_BASE_URL: "",
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    IMAGEGEN_API_KEY: "",
    FAL_KEY: "",
    FAL_API_KEY: "",
    APPROVAL_CHANNEL_WEBHOOK: "",
    SLACK_WEBHOOK_URL: "",
    IG_USER_ID: "",
    IG_ACCESS_TOKEN: "",
    FB_PAGE_ID: "",
    FB_PAGE_ACCESS_TOKEN: "",
    GOOGLE_ACCESS_TOKEN: "",
    GOOGLE_REFRESH_TOKEN: "",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    GBP_ACCOUNT_ID: "",
    GBP_LOCATION_ID: "",
    IG_GRAPH_HOST: "graph.instagram.com",
    GRAPH_VERSION: "v25.0",
  };
  if (renderCommit !== null) childEnv.RENDER_GIT_COMMIT = renderCommit;

  const child = spawn(process.execPath, [
    "--import",
    `data:text/javascript,${encodeURIComponent(networkGuard)}`,
    serverEntrypoint,
  ], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let captured = "";
  const append = (chunk: Buffer | string): void => {
    captured = `${captured}${String(chunk)}`.slice(-64 * 1024);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return { child, output: () => captured };
}

async function waitForApi(capture: ChildCapture, baseUrl: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (capture.child.exitCode !== null) {
      throw new Error(`compiled API exited before readiness (exit ${capture.child.exitCode}): ${capture.output()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(500) });
      if (response.status === 200) {
        await response.arrayBuffer();
        return;
      }
    } catch {
      // The TCP listener is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`compiled API did not become ready: ${capture.output()}`);
}

async function stopApi(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    once(child, "exit").then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000)),
  ]);
  if (stopped || child.exitCode !== null) return;
  child.kill("SIGKILL");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
}

async function waitForExit(child: ChildProcess, timeoutMs = TEST_TIMEOUT_MS): Promise<boolean> {
  if (child.exitCode !== null) return true;
  return Promise.race([
    once(child, "exit").then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

/** Send an approval form body that never finishes, exercising the real 10-second parser deadline. */
async function partialApprovalRequest(port: number, approvalId: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(Buffer.concat(chunks).toString("utf8"));
    };
    socket.setTimeout(15_000, () => finish(new Error("partial request exceeded the parser timeout allowance")));
    socket.once("error", (err) => finish(chunks.length > 0 ? undefined : err));
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("end", () => finish());
    socket.once("close", () => finish());
    socket.once("connect", () => {
      const partialBody = "token=incomplete";
      socket.write([
        `POST /approvals/${approvalId}/decision HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        "Content-Type: application/x-www-form-urlencoded",
        "Content-Length: 128",
        "Connection: close",
        "",
        partialBody,
      ].join("\r\n"));
    });
  });
}

/** Send a partial trigger body and require an early rejection to close the socket promptly. */
async function partialRejectedTrigger(
  port: number,
  headers: readonly string[],
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(Buffer.concat(chunks).toString("utf8"));
    };
    socket.setTimeout(3_000, () => finish(new Error("early trigger rejection did not close its partial-body socket")));
    socket.once("error", (err) => finish(chunks.length > 0 ? undefined : err));
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("end", () => finish());
    socket.once("close", () => finish());
    socket.once("connect", () => {
      socket.write([
        "POST /triggers HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        ...headers,
        "Content-Length: 128",
        "Connection: keep-alive",
        "",
        '{"goal":"incomplete',
      ].join("\r\n"));
    });
  });
}

/** Leave the HTTP header block incomplete so Node's server-level deadline must close it. */
async function partialHeaderRequest(port: number, marker: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(Buffer.concat(chunks).toString("utf8"));
    };
    socket.setTimeout(15_000, () => finish(new Error("partial headers exceeded the global receive-timeout allowance")));
    socket.once("error", (err) => finish(chunks.length > 0 ? undefined : err));
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("end", () => finish());
    socket.once("close", () => finish());
    socket.once("connect", () => {
      socket.write([
        "POST /triggers HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        `X-Partial-Marker: ${marker}`,
      ].join("\r\n"));
    });
  });
}

async function main(): Promise<void> {
  const databaseUrl = assertDisposableLoopbackDatabase(process.env.DATABASE_URL);
  const serverEntrypoint = fileURLToPath(new URL("./server.js", import.meta.url));
  await access(serverEntrypoint);

  const state = await import("../harness/state.js");
  const subject = [{
    platform: "facebook",
    target: {
      accountId: `phase0a-http-e2e-${randomUUID()}`,
      apiHost: "graph.facebook.com",
      apiVersion: "v25.0",
    },
    text: `Exact canonical Phase 0A HTTP review payload ${randomUUID()}`,
  }];
  const expiresSoon = new Date(Date.now() + 10 * 60_000);
  let validApproval: Awaited<ReturnType<typeof state.createApproval>>;
  let expiredApproval: Awaited<ReturnType<typeof state.createApproval>>;
  await state.initState({ requireDurable: true });
  try {
    validApproval = await state.createApproval("Bound-server exact payload review", subject, {
      tokenExpiresAt: expiresSoon,
      authorizationExpiresAt: expiresSoon,
    });
    expiredApproval = await state.createApproval("Expired bound-server capability", subject, {
      tokenExpiresAt: new Date(Date.now() - 60_000),
      authorizationExpiresAt: expiresSoon,
    });
  } finally {
    await state.closeState();
  }

  const database = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: TEST_TIMEOUT_MS });
  const consoleToken = `phase0a-http-e2e-${randomBytes(24).toString("base64url")}`;
  const wrongConsoleToken = `wrong-console-${randomBytes(12).toString("hex")}`;
  const badApprovalToken = `bad-approval-${randomBytes(12).toString("hex")}`;
  const malformedMarker = `malformed-${randomBytes(12).toString("hex")}`;
  const missingIdentityPort = await reservePort();
  const missingIdentityCapture = startApi(
    serverEntrypoint,
    databaseUrl,
    missingIdentityPort,
    consoleToken,
    null,
  );
  const missingIdentityExited = await waitForExit(missingIdentityCapture.child);
  check(
    "production API refuses to bind without Render commit identity",
    missingIdentityExited
      && missingIdentityCapture.child.exitCode === 1
      && missingIdentityCapture.output().includes("RENDER_GIT_COMMIT is required")
      && !missingIdentityCapture.output().includes(`listening on 127.0.0.1:${missingIdentityPort}`),
  );
  await stopApi(missingIdentityCapture.child);

  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const capture = startApi(serverEntrypoint, databaseUrl, port, consoleToken);

  try {
    await waitForApi(capture, baseUrl);
    const listenLog = `listening on 127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 25 && !capture.output().includes(listenLog); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    check(
      "actual API listener is restricted to the requested loopback host",
      capture.output().includes(listenLog),
    );

    const health = await request(baseUrl, "/healthz");
    const healthJson = parseJson(health.body);
    check("actual compiled API health route returns 200", health.status === 200);
    check(
      "health reports production Phase A with durable PostgreSQL state",
      healthJson?.status === "ok"
        && healthJson.service === "gcd-social-api"
        && healthJson.autonomyPhase === "A"
        && healthJson.state === "postgres"
        && healthJson.commit === "2".repeat(40),
    );
    check("JSON security headers are present", securityHeadersArePresent(health, "json"));

    const unauthTrigger = await partialRejectedTrigger(port, ["Content-Type: application/json"]);
    const unauthTriggerLower = unauthTrigger.toLowerCase();
    check("POST /triggers without authentication fails", unauthTrigger.startsWith("HTTP/1.1 401"));
    check("unauthenticated trigger advertises Bearer authentication", unauthTriggerLower.includes("www-authenticate: bearer"));
    check("unauthenticated trigger response does not echo credentials", !unauthTrigger.includes(consoleToken));
    check("unauthenticated partial trigger closes instead of retaining unread body bytes", unauthTriggerLower.includes("connection: close"));

    const triggerHeaders = { "x-console-token": consoleToken };
    const badContentType = await partialRejectedTrigger(port, [
      `X-Console-Token: ${consoleToken}`,
      "Content-Type: text/plain",
    ]);
    const badContentTypeLower = badContentType.toLowerCase();
    check("authenticated trigger rejects non-JSON Content-Type", badContentType.startsWith("HTTP/1.1 415"));
    check("authenticated trigger exposes bounded rate-limit metadata", badContentTypeLower.includes("x-ratelimit-limit: 5"));
    check("invalid-Content-Type partial trigger closes instead of retaining unread body bytes", badContentTypeLower.includes("connection: close"));

    const malformed = await request(baseUrl, "/triggers", {
      method: "POST",
      headers: { ...triggerHeaders, "content-type": "application/json; charset=utf-8" },
      body: `{"goal":"${malformedMarker}`,
    });
    check("authenticated trigger rejects malformed JSON", malformed.status === 400 && malformed.body.includes("invalid JSON"));
    check("malformed-JSON error does not echo request content", !malformed.body.includes(malformedMarker));

    const oversized = await request(baseUrl, "/triggers", {
      method: "POST",
      headers: { ...triggerHeaders, "content-type": "application/json" },
      body: JSON.stringify({ goal: "x".repeat(17 * 1024) }),
    });
    check("trigger enforces the configured 16 KiB request limit", oversized.status === 413);
    check("oversized-body response closes the connection", oversized.headers.get("connection") === "close");

    const untrustedGoal = `phase0a approvedFacts rejection ${randomUUID()}`;
    const untrustedBefore = await database.query(
      `SELECT count(*)::int AS count FROM brief_queue WHERE brief->>'goal'=$1`,
      [untrustedGoal],
    );
    const approvedFactsAttempt = await request(baseUrl, "/triggers", {
      method: "POST",
      headers: { ...triggerHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        goal: untrustedGoal,
        approvedFacts: { bookingUrl: "https://attacker.example" },
      }),
    });
    const untrustedAfter = await database.query(
      `SELECT count(*)::int AS count FROM brief_queue WHERE brief->>'goal'=$1`,
      [untrustedGoal],
    );
    check("trigger rejects approvedFacts and every unexpected field", approvedFactsAttempt.status === 400 && approvedFactsAttempt.body.includes("only the goal field"));
    check(
      "rejected approvedFacts input is not enqueued",
      untrustedBefore.rows[0]?.count === untrustedAfter.rows[0]?.count,
    );
    check("unexpected-field error does not echo attacker URL", !approvedFactsAttempt.body.includes("attacker.example"));

    const validGoal = `phase0a bound-server allowed input ${randomUUID()}`;
    const validTrigger = await request(baseUrl, "/triggers", {
      method: "POST",
      headers: { ...triggerHeaders, "content-type": "application/json" },
      body: JSON.stringify({ goal: `  ${validGoal}  ` }),
    });
    const validTriggerJson = parseJson(validTrigger.body);
    const briefId = typeof validTriggerJson?.briefId === "string" ? validTriggerJson.briefId : "";
    const persistedBrief = briefId
      ? await database.query(`SELECT brief, status FROM brief_queue WHERE id=$1`, [briefId])
      : { rows: [] as Array<Record<string, unknown>> };
    const brief = persistedBrief.rows[0]?.brief as Record<string, unknown> | undefined;
    check("authenticated valid trigger is accepted without running a worker", validTrigger.status === 202 && validTriggerJson?.accepted === true);
    check(
      "valid trigger durably enqueues only the trimmed goal",
      brief?.goal === validGoal && Object.keys(brief).length === 1 && persistedBrief.rows[0]?.status === "pending",
    );

    for (const path of ["/diag/ig", "/diag/gbp"]) {
      const result = await request(baseUrl, path);
      check(`${path} fails without authentication`, result.status === 401);
      check(`${path} unauthenticated response does not echo the console token`, !result.body.includes(consoleToken));
    }

    const unauthConsole = await request(baseUrl, "/console/manifest");
    check("console route fails without authentication", unauthConsole.status === 401);
    const wrongConsole = await request(baseUrl, "/console/manifest", {
      headers: { authorization: `Bearer ${wrongConsoleToken}` },
    });
    check("incorrect console token fails", wrongConsole.status === 401);
    check("incorrect console token is not echoed", !wrongConsole.body.includes(wrongConsoleToken));
    const queryCredential = await request(baseUrl, `/console/manifest?token=${encodeURIComponent(consoleToken)}`);
    check("query-string console credentials are rejected", queryCredential.status === 401);
    check("query-string credential is not echoed", !queryCredential.body.includes(consoleToken));

    const attackerOrigin = "https://attacker.example";
    const consoleManifest = await request(baseUrl, "/console/manifest", {
      headers: { authorization: `Bearer ${consoleToken}`, origin: attackerOrigin },
    });
    const manifestJson = parseJson(consoleManifest.body);
    check("correct test token permits the expected console manifest", consoleManifest.status === 200 && manifestJson?.id === "gcd-social");
    check("control-plane success does not echo the control token", !consoleManifest.body.includes(consoleToken));
    check(
      "unapproved Origin receives no credentialed CORS grant",
      consoleManifest.headers.get("access-control-allow-origin") === null
        && consoleManifest.headers.get("access-control-allow-credentials") === null,
    );

    const authenticatedPreflight = await request(baseUrl, "/console/manifest", {
      method: "OPTIONS",
      headers: {
        authorization: `Bearer ${consoleToken}`,
        origin: attackerOrigin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    check("authenticated console preflight follows the documented no-CORS behavior", authenticatedPreflight.status === 204);
    check(
      "preflight grants neither attacker origin nor credentials",
      authenticatedPreflight.headers.get("access-control-allow-origin") === null
        && authenticatedPreflight.headers.get("access-control-allow-credentials") === null,
    );

    const unknownConsole = await request(baseUrl, "/console/not-an-endpoint", {
      headers: { authorization: `Bearer ${consoleToken}` },
    });
    check("correct token does not make unknown control-plane routes succeed", unknownConsole.status === 404);

    const badReview = await request(
      baseUrl,
      `/approvals/${validApproval.id}?token=${encodeURIComponent(badApprovalToken)}`,
    );
    check("bad approval capability fails", badReview.status === 403);
    check("bad approval capability is not echoed in the error", !badReview.body.includes(badApprovalToken));
    check("approval error has hardened HTML security headers", securityHeadersArePresent(badReview, "html"));

    const badDecision = await request(baseUrl, `/approvals/${validApproval.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: badApprovalToken, action: "approve" }),
    });
    check("bad decision capability fails", badDecision.status === 403);
    check("bad decision capability is not echoed", !badDecision.body.includes(badApprovalToken));

    const expiredReview = await request(
      baseUrl,
      `/approvals/${expiredApproval.id}?token=${encodeURIComponent(expiredApproval.token)}`,
    );
    check("expired approval capability fails", expiredReview.status === 403);
    check("expired approval capability is not echoed", !expiredReview.body.includes(expiredApproval.token));

    const partialHeaderMarker = `partial-header-${randomBytes(12).toString("hex")}`;
    const [partialHeaderResponse, partialResponse] = await Promise.all([
      partialHeaderRequest(port, partialHeaderMarker),
      partialApprovalRequest(port, validApproval.id),
    ]);
    check("incomplete headers reach the real server receive deadline", partialHeaderResponse.startsWith("HTTP/1.1 408"));
    check("server-timeout response does not echo partial header content", !partialHeaderResponse.includes(partialHeaderMarker));
    check("incomplete request body reaches the real parser deadline", partialResponse.startsWith("HTTP/1.1 408"));
    check("parser-timeout response is generic", partialResponse.includes("request body timeout") && !partialResponse.includes("incomplete"));

    const validReview = await request(
      baseUrl,
      `/approvals/${validApproval.id}?token=${encodeURIComponent(validApproval.token)}`,
    );
    const canonicalPretty = JSON.stringify(JSON.parse(state.canonicalApprovalJson(subject)), null, 2);
    check("valid review capability displays the real pending review", validReview.status === 200 && validReview.body.includes("Review exact provider payload"));
    check("valid review displays the exact bound canonical SHA-256", validReview.body.includes(validApproval.payloadSha256));
    check("valid review displays the complete canonical payload bytes", validReview.body.includes(htmlEscape(canonicalPretty)));
    check("valid review has hardened HTML security headers", securityHeadersArePresent(validReview, "html"));
    check("approval review response never contains provider/model/Slack secrets", !/Bearer\s|hooks\.slack\.com\/services|sk-ant-|fal_key/i.test(validReview.body));

    check("no tested route attempted an outbound child-process fetch", !capture.output().includes(OUTBOUND_FETCH_MARKER));
    check("compiled API remained running through the E2E suite", capture.child.exitCode === null);
  } finally {
    await database.end().catch(() => {});
    await stopApi(capture.child);
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : "FAILED"} (${passes} passed, ${failures} failed)`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  failures += 1;
  console.error(`FATAL HTTP E2E: ${err instanceof Error ? err.message : "unknown error"}`);
  process.exitCode = 1;
});
