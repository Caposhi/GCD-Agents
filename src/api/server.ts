/**
 * Trigger/webhook receiver (Render `web` service). Minimal Node http server.
 *   GET  /healthz                 — liveness (Render healthCheckPath)
 *   GET  /diag/ig|gbp             — authenticated, read-only credential diagnostics
 *   POST /triggers                — authenticated brief intake for the worker
 *   GET  /approvals/:id?token=     — human review page (shows package + buttons)
 *   POST /approvals/:id/decision   — record approve/reject (token-guarded)
 *
 * The web service never publishes; it only queues briefs and records the human
 * decision. The worker runs the orchestration and (on approval) the posting.
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { config } from "../harness/config.js";
import { initState, stateEnabled, enqueueBrief, getApproval, decideApproval, getMedia, recentEvents, consoleSnapshot, verifyApprovalToken } from "../harness/state.js";
import { buildApiHealthDocument } from "../harness/renderIdentity.js";
import { credsFromEnv } from "../harness/creds.js";
import { effectiveIgToken, igTokenStatus, validatedIgGraphHost } from "../harness/igToken.js";
import { getGoogleAccessToken, googleOAuthConfigured } from "../harness/googleToken.js";
import { IG_API_HOSTS, validatePublicationTarget } from "../mcp/posting-tool/validation.js";
import {
  authorizeSharedSecret,
  BoundedRateLimiter,
  isAllowedCredentialEndpoint,
  isJsonContentType,
  MAX_REQUEST_BODY_BYTES,
  OperationTimeoutError,
  parseMediaPath,
  parseTriggerBody,
  readBoundedBody,
  RequestBodyError,
  withOperationTimeout,
} from "./security.js";
import { renderApprovalReview } from "./approvalReview.js";

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}
function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  });
  res.end(body);
}
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- console contract (consumed by the gcd-arcade hub) ----

/** Static description of this app for the hub launcher / home screen. */
const CONSOLE_MANIFEST = {
  id: "gcd-social",
  name: "GCD-SOCIAL",
  tagline: "Autonomous social posting — Instagram + Facebook",
  description:
    "A multi-agent manager that drafts, illustrates, fact-checks, and (on human approval) publishes daily posts for German Car Depot.",
  theme: { palette: ["#182848", "#18479F", "#F8E000"], style: "8-bit shop floor", icon: "🔧" },
  agents: ["analytics", "copywriter", "image", "hashtag-seo-timing", "brand-compliance-critic", "platform-formatter", "posting"],
  endpoints: { state: "/console/state", stream: "/console/stream" },
};

// Phase 0A transitional control plane: reuse the already-declared CONSOLE_TOKEN
// rather than introducing an undeployed secret. Split route credentials later.
const triggerLimiter = new BoundedRateLimiter(5, 60_000);
const diagnosticLimiter = new BoundedRateLimiter(20, 60_000);
const consoleLimiter = new BoundedRateLimiter(120, 60_000);
const approvalGlobalLimiter = new BoundedRateLimiter(300, 60_000);
const approvalIdLimiter = new BoundedRateLimiter(30, 60_000);
const authFailureLimiter = new BoundedRateLimiter(60, 60_000);
const DIAGNOSTIC_TIMEOUT_MS = 15_000;
const REQUEST_RECEIVE_TIMEOUT_MS = 10_000;
const CONNECTION_DEADLINE_SCAN_MS = 1_000;
const GOOGLE_DIAGNOSTIC_HOSTS = new Set([
  "mybusinessaccountmanagement.googleapis.com",
  "mybusinessbusinessinformation.googleapis.com",
]);

function clientKey(req: IncomingMessage): string {
  // Do not trust spoofable forwarding headers without an explicit trusted-proxy
  // configuration. On a reverse proxy this intentionally behaves as a safer
  // service-wide limit until that configuration exists.
  return req.socket.remoteAddress ?? "unknown";
}

function protectControlPlane(
  req: IncomingMessage,
  res: ServerResponse,
  limiter: BoundedRateLimiter,
  closeUnreadBodyOnFailure = false,
): boolean {
  const auth = authorizeSharedSecret(process.env.CONSOLE_TOKEN || undefined, {
    authorization: req.headers.authorization,
    sharedToken: req.headers["x-console-token"],
  });
  if (!auth.ok) {
    if (closeUnreadBodyOnFailure) closeUnreadRequest(req, res);
    const authRate = authFailureLimiter.check(clientKey(req));
    if (!authRate.allowed) {
      res.setHeader("retry-after", String(authRate.retryAfterSeconds));
      json(res, 429, { error: "too many requests" });
      return false;
    }
    if (auth.status === 401) res.setHeader("www-authenticate", "Bearer");
    json(res, auth.status, { error: auth.status === 503 ? "service unavailable" : "unauthorized" });
    return false;
  }

  return applyRateLimit(req, res, limiter, clientKey(req), closeUnreadBodyOnFailure);
}

function applyRateLimit(
  req: IncomingMessage,
  res: ServerResponse,
  limiter: BoundedRateLimiter,
  key = clientKey(req),
  closeUnreadBodyOnFailure = false,
): boolean {
  const rate = limiter.check(key);
  res.setHeader("x-ratelimit-limit", String(limiter.limit));
  res.setHeader("x-ratelimit-remaining", String(rate.remaining));
  if (!rate.allowed) {
    if (closeUnreadBodyOnFailure) closeUnreadRequest(req, res);
    res.setHeader("retry-after", String(rate.retryAfterSeconds));
    json(res, 429, { error: "too many requests" });
    return false;
  }
  return true;
}

function closeUnreadRequest(req: IncomingMessage, res: ServerResponse): void {
  if (!res.headersSent) res.setHeader("connection", "close");
  if (res.writableFinished) {
    req.destroy();
    return;
  }
  res.once("finish", () => req.destroy());
}

async function readRouteBody(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
  const declaredLength = Number(req.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    closeUnreadRequest(req, res);
    json(res, 413, { error: "request body too large" });
    return null;
  }
  try {
    return await readBoundedBody(req);
  } catch (err) {
    if (!(err instanceof RequestBodyError)) throw err;
    closeUnreadRequest(req, res);
    const message = err.status === 408 ? "request body timeout" : err.status === 413 ? "request body too large" : "invalid request body";
    json(res, err.status, { error: message });
    return null;
  }
}

function sseFrame(e: { id: number; kind: string }): string {
  return `id: ${e.id}\nevent: ${e.kind}\ndata: ${JSON.stringify(e)}\n\n`;
}

/** Server-Sent Events feed of live activity for the "live game view". */
async function streamConsole(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-content-type-options": "nosniff",
  });
  let cursor = Number(url.searchParams.get("since") ?? 0) || 0;
  let open = true;
  req.on("close", () => {
    open = false;
  });
  // Backlog so a freshly-opened view isn't blank, then tail new events.
  for (let first = true; open; first = false) {
    if (!first) await sleep(1500);
    let batch: Awaited<ReturnType<typeof recentEvents>> = [];
    try {
      batch = await recentEvents({ sinceId: cursor, limit: first ? 50 : 100 });
    } catch {
      batch = [];
    }
    for (const e of batch) {
      res.write(sseFrame(e));
      cursor = e.id;
    }
    res.write(": ping\n\n"); // heartbeat keeps proxies from closing the stream
  }
  res.end();
}

/** Mask a secret to "set (…1234)" so diagnostics can confirm presence without leaking. */
function maskPresence(v: string | undefined): string {
  return v ? "SET" : "MISSING";
}

/** GET an allowlisted provider endpoint with a bearer token; never throws. */
async function credentialGet(
  urlStr: string,
  token: string,
  operationSignal: AbortSignal,
  allowedHosts: ReadonlySet<string>,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    if (!isAllowedCredentialEndpoint(urlStr, allowedHosts)) {
      throw new Error("BLOCKED: diagnostic URL is not on an allowlisted provider origin");
    }
    const res = await fetch(urlStr, {
      headers: { authorization: `Bearer ${token}` },
      // Never replay a bearer token to a provider-controlled redirect target.
      redirect: "error",
      signal: AbortSignal.any([operationSignal, AbortSignal.timeout(10_000)]),
    });
    const text = await res.text();
    let body: unknown;
    try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    if (operationSignal.aborted) throw err;
    return { ok: false, status: 0, body: (err as Error).message };
  }
}

/**
 * Read-only Instagram/Facebook credential diagnostic. Confirms — without running a
 * brief or posting anything — whether the configured IG token + host + user-id are
 * valid (the exact auth context ig:createContainer uses) and whether the Page has a
 * linked IG Business account (the Facebook-Login path). Echoes Meta's own error so
 * code 190 etc. is visible. Never returns token values.
 */
async function diagIg(operationSignal: AbortSignal): Promise<unknown> {
  const c = credsFromEnv();
  const ver = c.graphVersion ?? "v25.0";
  const igHost = validatedIgGraphHost(c.igGraphHost);
  const metaEndpointPolicy = validatePublicationTarget("instagram", {
    accountId: "diagnostic-policy-check",
    apiHost: igHost,
    apiVersion: ver,
  });
  if (!metaEndpointPolicy.ok) {
    throw new Error(`BLOCKED: invalid diagnostic Meta endpoint configuration: ${metaEndpointPolicy.issues.join("; ")}`);
  }
  const out: Record<string, unknown> = {
    env: {
      IG_USER_ID: c.igUserId ?? "MISSING",
      IG_ACCESS_TOKEN: maskPresence(c.igAccessToken),
      IG_GRAPH_HOST: igHost,
      FB_PAGE_ID: c.fbPageId ?? "MISSING",
      FB_PAGE_ACCESS_TOKEN: maskPresence(c.fbPageAccessToken),
      GRAPH_VERSION: ver,
    },
  };

  // 1) Does the LIVE token (DB store first, env fallback) resolve? This tests the
  // exact token the worker publishes with — so a green check means posting is green,
  // regardless of whether the static env seed has drifted from the refreshed token.
  const live = await effectiveIgToken();
  operationSignal.throwIfAborted();
  out.igTokenSource = live.source; // "db-store" once the worker has seeded; "env" before then
  if (live.token && c.igUserId) {
    out.igTokenCheck = await credentialGet(
      `https://${igHost}/${ver}/${encodeURIComponent(c.igUserId)}?fields=id,username,account_type`,
      live.token,
      operationSignal,
      IG_API_HOSTS,
    );
  } else {
    out.igTokenCheck = { skipped: "need a live IG token (env seed or DB store) and IG_USER_ID" };
  }

  // 2) Is an IG Business account linked to the Page? (Facebook-Login path readiness.)
  if (c.fbPageAccessToken && c.fbPageId) {
    out.pageLinkCheck = await credentialGet(
      `https://graph.facebook.com/${ver}/${encodeURIComponent(c.fbPageId)}?fields=instagram_business_account{id,username}`,
      c.fbPageAccessToken,
      operationSignal,
      IG_API_HOSTS,
    );
  } else {
    out.pageLinkCheck = { skipped: "need FB_PAGE_ACCESS_TOKEN and FB_PAGE_ID" };
  }

  // 3) Auto-refresh state (Instagram-Login path only).
  operationSignal.throwIfAborted();
  out.igTokenStore = await igTokenStatus(Date.now());

  return out;
}

/**
 * Read-only Google Business Profile diagnostic. Confirms the Google token,
 * lists the accessible accounts + locations (so you can copy the exact
 * GBP_ACCOUNT_ID / GBP_LOCATION_ID), and never returns the token value.
 */
async function diagGbp(operationSignal: AbortSignal): Promise<unknown> {
  const out: Record<string, unknown> = {
    env: {
      GBP_ACCOUNT_ID: process.env.GBP_ACCOUNT_ID ?? "MISSING",
      GBP_LOCATION_ID: process.env.GBP_LOCATION_ID ?? "MISSING",
      googleAuth: googleOAuthConfigured()
        ? "refresh-token configured (self-renewing)"
        : process.env.GOOGLE_ACCESS_TOKEN
          ? "static GOOGLE_ACCESS_TOKEN only (expires hourly)"
          : "MISSING",
      ACTIVE_PLATFORMS: config.activePlatforms.join(","),
    },
  };

  let token: string | undefined;
  try {
    token = await getGoogleAccessToken(Date.now(), operationSignal);
  } catch (err) {
    if (operationSignal.aborted) throw err;
    out.tokenError = (err as Error).message;
    return out;
  }
  if (!token) {
    out.tokenError = "no Google token — set GOOGLE_REFRESH_TOKEN + GOOGLE_CLIENT_ID/SECRET (preferred) or GOOGLE_ACCESS_TOKEN";
    return out;
  }

  // Accounts (My Business Account Management API v1)
  out.accounts = await credentialGet(
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    token,
    operationSignal,
    GOOGLE_DIAGNOSTIC_HOSTS,
  );

  // Locations for the chosen account (env first, else the first account returned)
  let acctId = process.env.GBP_ACCOUNT_ID;
  const firstName = (out.accounts as any)?.body?.accounts?.[0]?.name; // "accounts/123"
  if (!acctId && typeof firstName === "string") acctId = firstName.split("/")[1];
  if (acctId) {
    out.locations = await credentialGet(
      `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${encodeURIComponent(acctId)}/locations?readMask=name,title,storefrontAddress`,
      token,
      operationSignal,
      GOOGLE_DIAGNOSTIC_HOSTS,
    );
    out.suggested = {
      GBP_ACCOUNT_ID: acctId,
      note: "GBP_LOCATION_ID = the number after 'locations/' in locations[].name",
    };
  }
  return out;
}

const server = createServer({
  requestTimeout: REQUEST_RECEIVE_TIMEOUT_MS,
  headersTimeout: REQUEST_RECEIVE_TIMEOUT_MS,
  connectionsCheckingInterval: CONNECTION_DEADLINE_SCAN_MS,
}, async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (req.method === "GET" && path === "/healthz") {
      try {
        return json(res, 200, buildApiHealthDocument(
          config.autonomyPhase,
          stateEnabled() ? "postgres" : "ephemeral",
        ));
      } catch {
        return json(res, 503, { status: "unavailable", service: "gcd-social-api" });
      }
    }

    // Read-only credential diagnostic for the Instagram/Facebook auth setup.
    if (req.method === "GET" && path === "/diag/ig") {
      if (!protectControlPlane(req, res, diagnosticLimiter)) return;
      const controller = new AbortController();
      try {
        return json(res, 200, await withOperationTimeout(
          diagIg(controller.signal),
          DIAGNOSTIC_TIMEOUT_MS,
          () => controller.abort(),
        ));
      } catch (err) {
        if (err instanceof OperationTimeoutError) return json(res, 504, { error: "diagnostic timed out" });
        throw err;
      }
    }

    // Read-only Google Business Profile diagnostic (lists accounts + locations).
    if (req.method === "GET" && path === "/diag/gbp") {
      if (!protectControlPlane(req, res, diagnosticLimiter)) return;
      const controller = new AbortController();
      try {
        return json(res, 200, await withOperationTimeout(
          diagGbp(controller.signal),
          DIAGNOSTIC_TIMEOUT_MS,
          () => controller.abort(),
        ));
      } catch (err) {
        if (err instanceof OperationTimeoutError) return json(res, 504, { error: "diagnostic timed out" });
        throw err;
      }
    }

    // ---- console contract (hub launcher + live game view) ----
    if (path.startsWith("/console/")) {
      if (!protectControlPlane(req, res, consoleLimiter)) return;
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "GET" && path === "/console/manifest") {
        return json(res, 200, CONSOLE_MANIFEST);
      }
      if (req.method === "GET" && path === "/console/state") {
        const snap = await consoleSnapshot();
        return json(res, 200, {
          id: "gcd-social",
          autonomyPhase: config.autonomyPhase,
          activePlatforms: config.activePlatforms,
          state: stateEnabled() ? "postgres" : "ephemeral",
          igToken: await igTokenStatus(Date.now()),
          ...snap,
          recentEvents: await recentEvents({ limit: 20 }),
        });
      }
      if (req.method === "GET" && path === "/console/stream") {
        return streamConsole(req, res, url);
      }
      return json(res, 404, { error: "unknown console endpoint" });
    }

    // Hosted media: serve transcoded JPEGs to the social platforms.
    const media = parseMediaPath(path);
    if (req.method === "GET" && media) {
      const m = await getMedia(media.id);
      if (!m) return json(res, 404, { error: "not found" });
      if (media.contentSha256 && media.contentSha256 !== m.contentSha256) {
        return json(res, 404, { error: "not found" });
      }
      res.writeHead(200, {
        "content-type": m.mime,
        "content-length": String(m.bytes.length),
        "cache-control": "public, max-age=31536000, immutable",
        etag: `"sha256-${m.contentSha256}"`,
        "x-content-type-options": "nosniff",
      });
      res.end(m.bytes);
      return;
    }

    if (req.method === "POST" && path === "/triggers") {
      if (!protectControlPlane(req, res, triggerLimiter, true)) return;
      if (!isJsonContentType(req.headers["content-type"])) {
        closeUnreadRequest(req, res);
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const raw = await readRouteBody(req, res);
      if (raw === null) return;
      const parsed = parseTriggerBody(raw);
      if (!parsed.ok) {
        const message =
          parsed.code === "invalid_json"
            ? "invalid JSON"
            : parsed.code === "goal_too_long"
              ? "goal is too long"
              : parsed.code === "unexpected_fields"
                ? "only the goal field is allowed"
                : "a non-empty goal string is required";
        return json(res, 400, { error: message });
      }
      const id = await enqueueBrief(parsed.brief);
      return json(res, 202, { accepted: true, briefId: id });
    }

    // /approvals/:id  and  /approvals/:id/decision
    const m = path.match(/^\/approvals\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(\/decision)?$/i);
    if (m) {
      const id = m[1]!;
      if (!applyRateLimit(req, res, approvalGlobalLimiter)) return;
      if (!applyRateLimit(req, res, approvalIdLimiter, `${clientKey(req)}:${id.toLowerCase()}`)) return;
      const isDecision = !!m[2];
      const row = await getApproval(id);
      if (!row) return html(res, 404, "<h2>Not found</h2>");

      if (req.method === "GET" && !isDecision) {
        const token = url.searchParams.get("token") ?? "";
        const verified = await verifyApprovalToken(id, token);
        if (!verified.ok) return html(res, 403, "<h2>Invalid, expired, or revoked token</h2>");
        if (row.status !== "pending") return html(res, 200, `<h2>Already ${esc(row.status)}</h2>`);
        try {
          return html(res, 200, renderApprovalReview({
            id,
            token,
            summary: row.summary,
            subjectType: row.subjectType,
            subject: row.subject,
            payloadSha256: row.payloadSha256,
            tokenExpiresAt: row.tokenExpiresAt,
            authorizationExpiresAt: row.authorizationExpiresAt,
          }));
        } catch {
          return html(res, 409, "<h2>Approval subject failed its integrity check</h2>");
        }
      }

      if (req.method === "POST" && isDecision) {
        const contentType = typeof req.headers["content-type"] === "string"
          ? req.headers["content-type"].split(";", 1)[0]?.trim().toLowerCase()
          : undefined;
        if (contentType !== "application/x-www-form-urlencoded") {
          closeUnreadRequest(req, res);
          return html(res, 415, "<h2>Unsupported form content type</h2>");
        }
        const body = await readRouteBody(req, res);
        if (body === null) return;
        const params = new URLSearchParams(body);
        const token = params.get("token") ?? "";
        const action = params.get("action");
        if (action !== "approve" && action !== "reject") return html(res, 400, "<h2>Bad action</h2>");
        const decision = action === "approve" ? "approved" : "rejected";
        const result = await decideApproval(id, token, decision);
        if (!result.ok) return html(res, 403, `<h2>Could not record decision: ${esc(result.reason ?? "")}</h2>`);
        return html(res, 200, `<h2>Recorded: ${decision}.</h2><p>You can close this window.</p>`);
      }
    }

    return json(res, 404, { error: "not found" });
  } catch (err) {
    const errorName = err instanceof Error ? err.name : "UnknownError";
    console.error(`[api] request failed (${req.method ?? "UNKNOWN"})`, errorName);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    return json(res, 500, { error: "internal server error" });
  }
});

async function main(): Promise<void> {
  // Render-owned commit identity is part of the production health contract.
  // Resolve it before binding so a missing/malformed identity fails closed.
  buildApiHealthDocument(config.autonomyPhase, "postgres");
  await initState({ requireDurable: true });
  server.listen(config.port, config.apiBindHost, () => {
    console.log(
      `[api] gcd-social-api listening on ${config.apiBindHost ?? "all interfaces"}:${config.port} `
      + `(phase ${config.autonomyPhase})`,
    );
  });
}

main().catch((err) => {
  console.error("[api] fatal:", err);
  process.exit(1);
});
