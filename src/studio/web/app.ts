/**
 * The Studio web service's request handling (docs/CONTENT_STUDIO_DESIGN.md §3.3,
 * §7, §9.2), on `node:http` as the live API is, with no web framework.
 *
 * - **One route table.** Every route declares its minimum role (`public`,
 *   `viewer`, `runner` or `owner`). A path the table does not declare is denied
 *   (404), a method it does not declare is refused (405), and a route whose role
 *   is not one of those four is denied to everyone (`roleAllows`). The role is
 *   checked on every request against the live `studio_users` row the session
 *   lookup reads.
 * - **Every response** — errors, 404s and `/healthz` included — carries the
 *   security headers (`SECURITY_HEADERS`) and no CORS header.
 * - **Every POST** requires `Origin` to equal `STUDIO_PUBLIC_ORIGIN` exactly, a
 *   live session, and its synchronizer token. No GET changes state.
 * - **Every URL** is derived from `STUDIO_PUBLIC_ORIGIN`, never from `Host`.
 * - **Logs** are structured lines of ids, classes and counts (design §9.2):
 *   never an email, token, code, state, nonce, cookie, secret or error message.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { JWTVerifyGetKey } from "jose";

import {
  authorizationUrl, checkIdentityClaims, exchangeCode, GOOGLE_OIDC, JWKS_TIMEOUT_MS, pkceChallenge, remoteKeySet,
  sha256Hex, SignInRefusal, TOKEN_EXCHANGE_TIMEOUT_MS, verifyIdToken, type OidcProvider,
} from "./oidc.js";
import { CALLBACK_LIMIT, FAILED_SIGN_IN_LIMIT, LOGIN_LIMIT, WindowLimiter } from "./rateLimit.js";
import {
  clearCookie, csrfMatches, csrfTokenFor, csrfTokenHash, decideSession, LOGIN_COOKIE, LOGIN_COOKIE_MAX_AGE_SECONDS,
  LOGIN_ATTEMPT_RETENTION_MS, newSessionTimes, originAllowed, planSignIn, randomToken, readCookie, roleAllows,
  SESSION_ABSOLUTE_MS, SESSION_COOKIE, SESSION_RETENTION_MS, sessionIdHash, setCookie, type MinRole, type StudioUserRow,
} from "./sessions.js";
import type { WebConfig } from "./startup.js";
import type { WebStore } from "./store.js";

export const STUDIO_WEB_SERVICE = "gcd-studio-web";

/** On every response (design §7.3). */
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
});

/** The largest POST body read, in bytes. */
export const MAX_FORM_BYTES = 4_096;

/** One structured log line's fields: ids, classes and counts only. */
export type WebLog = (event: string, fields?: Record<string, string | number | boolean | null>) => void;

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  now: number;
  /** The live users row of the request's session, or null. */
  user: StudioUserRow | null;
  /** The session cookie's value, when the session is live. */
  sessionCookie: string | null;
}

export interface RouteDeclaration {
  method: "GET" | "POST";
  path: string;
  minRole: MinRole;
  /** False for routes that never read a session (`/healthz`). */
  session?: boolean;
}
export interface Route extends RouteDeclaration {
  handle(ctx: RouteContext): Promise<void>;
}

/** The S4 route table: every route the service ships, each with its minimum role. */
export const STUDIO_ROUTE_TABLE: readonly RouteDeclaration[] = Object.freeze([
  { method: "GET", path: "/", minRole: "public" },
  { method: "GET", path: "/healthz", minRole: "public", session: false },
  { method: "GET", path: "/auth/login", minRole: "public" },
  { method: "GET", path: "/auth/callback", minRole: "public" },
  { method: "POST", path: "/auth/logout", minRole: "viewer" },
] as const);

export interface StudioWebOptions {
  store: WebStore;
  config: WebConfig;
  commit: string;
  log: WebLog;
  /**
   * Tests only: a fake issuer. The entry point never passes one, so the
   * service always uses Google's constants (`GOOGLE_OIDC`).
   */
  oidc?: OidcProvider;
  /** Tests only: extra routes (a test-only owner route). The entry point passes none. */
  extraRoutes?: readonly Route[];
  now?: () => number;
  tokenTimeoutMs?: number;
  jwksTimeoutMs?: number;
}

export interface StudioWebApp {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  readonly oidc: OidcProvider;
  readonly routes: readonly Route[];
  purge(): Promise<{ loginAttempts: number; sessions: number }>;
}

// --- Responses -----------------------------------------------------------------

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function addCookie(res: ServerResponse, cookie: string): void {
  const existing = res.getHeader("set-cookie");
  const list = Array.isArray(existing) ? existing : typeof existing === "string" ? [existing] : [];
  res.setHeader("set-cookie", [...list, cookie]);
}

function page(res: ServerResponse, status: number, title: string, body: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html>\n<html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} — Content Studio</title>`
    + `</head><body><main>${body}</main></body></html>\n`);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, status: 302 | 303, location: string): void {
  res.statusCode = status;
  res.setHeader("location", location);
  res.end();
}

const signedOutPage = (res: ServerResponse) => page(res, 200, "Sign in",
  "<h1>Content Studio</h1><p><a href=\"/auth/login\">Sign in with Google</a></p>");
const notAuthorizedPage = (res: ServerResponse) => page(res, 403, "Not authorized",
  "<h1>Not authorized</h1><p>This account cannot sign in to the Content Studio.</p><p><a href=\"/\">Back</a></p>");
const signedInPage = (res: ServerResponse, user: StudioUserRow, csrfToken: string) => page(res, 200, "Signed in",
  `<h1>Content Studio</h1><p>Signed in as <strong>${escapeHtml(user.display_name ?? "(no display name)")}</strong>`
  + ` — role: <strong>${escapeHtml(user.role)}</strong></p>`
  + `<form method="post" action="/auth/logout"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">`
  + "<button type=\"submit\">Sign out</button></form>");

/** The direct peer: forwarding headers are spoofable and are not trusted (as on the live API). */
const clientAddress = (req: IncomingMessage): string => req.socket.remoteAddress ?? "unknown";

function readForm(req: IncomingMessage): Promise<URLSearchParams | null> {
  return new Promise((settle) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_FORM_BYTES) { settle(null); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => settle(new URLSearchParams(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", () => settle(null));
  });
}

const errorClass = (error: unknown): string => {
  const name = (error as { name?: unknown })?.name;
  return typeof name === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : "Error";
};

const isRefusedWrite = (error: unknown): boolean => {
  const code = (error as { code?: unknown })?.code;
  return code === "23514" || code === "23505";
};

// --- The app -------------------------------------------------------------------

export function createStudioWebApp(options: StudioWebOptions): StudioWebApp {
  const { store, config, log } = options;
  const oidc = options.oidc ?? GOOGLE_OIDC;
  const clock = options.now ?? Date.now;
  const keys: JWTVerifyGetKey = remoteKeySet(oidc, options.jwksTimeoutMs ?? JWKS_TIMEOUT_MS);
  const tokenTimeoutMs = options.tokenTimeoutMs ?? TOKEN_EXCHANGE_TIMEOUT_MS;
  const redirectUri = `${config.publicOrigin}/auth/callback`;
  const loginLimiter = new WindowLimiter(LOGIN_LIMIT.limit, LOGIN_LIMIT.windowMs);
  const callbackLimiter = new WindowLimiter(CALLBACK_LIMIT.limit, CALLBACK_LIMIT.windowMs);
  const failedLimiter = new WindowLimiter(FAILED_SIGN_IN_LIMIT.limit, FAILED_SIGN_IN_LIMIT.windowMs);

  const tooMany = (res: ServerResponse, limiter: string) => {
    log("rate_limit.tripped", { limiter });
    res.setHeader("retry-after", "60");
    page(res, 429, "Too many requests", "<h1>Too many requests</h1><p>Try again shortly.</p>");
  };

  const refuseSignIn = async (ctx: RouteContext, reason: string) => {
    failedLimiter.hit(clientAddress(ctx.req), ctx.now);
    log("auth.sign_in.refused", { reason });
    try {
      await store.audit({ action: "auth.sign_in_refused", actorUserId: null, targetType: null, targetId: null, detail: { reason } });
    } catch (error) {
      log("audit.failed", { action: "auth.sign_in_refused", error_class: errorClass(error) });
    }
    notAuthorizedPage(ctx.res);
  };

  const handlers: Record<string, (ctx: RouteContext) => Promise<void>> = {
    "GET /": async (ctx) => {
      if (ctx.user && ctx.sessionCookie) signedInPage(ctx.res, ctx.user, csrfTokenFor(ctx.sessionCookie));
      else signedOutPage(ctx.res);
    },

    "GET /healthz": async ({ res }) => {
      try {
        const health = await store.health();
        json(res, 200, {
          service: STUDIO_WEB_SERVICE, commit: options.commit, state: "postgres",
          schema_version: health.schemaVersion, worker_heartbeat_age_seconds: health.workerHeartbeatAgeSeconds,
        });
      } catch (error) {
        log("healthz.failed", { error_class: errorClass(error) });
        json(res, 503, { service: STUDIO_WEB_SERVICE, commit: options.commit, state: "unavailable" });
      }
    },

    "GET /auth/login": async (ctx) => {
      if (!loginLimiter.hit(clientAddress(ctx.req), ctx.now)) return tooMany(ctx.res, "login");
      const state = randomToken();
      const nonce = randomToken();
      const verifier = randomToken();
      await store.createLoginAttempt({ stateHash: sha256Hex(state), nonceHash: sha256Hex(nonce), verifier });
      addCookie(ctx.res, setCookie(LOGIN_COOKIE, state, LOGIN_COOKIE_MAX_AGE_SECONDS));
      log("auth.login.started", {});
      redirect(ctx.res, 302, authorizationUrl(oidc, {
        clientId: config.clientId, redirectUri, state, nonce, codeChallenge: pkceChallenge(verifier), hd: config.allowedHd,
      }));
    },

    "GET /auth/callback": async (ctx) => {
      const address = clientAddress(ctx.req);
      if (failedLimiter.exhausted(address, ctx.now)) return tooMany(ctx.res, "failed-sign-in");
      if (!callbackLimiter.hit(address, ctx.now)) return tooMany(ctx.res, "callback");
      const query = ctx.url.searchParams;
      const loginCookie = readCookie(ctx.req.headers.cookie, LOGIN_COOKIE);
      addCookie(ctx.res, clearCookie(LOGIN_COOKIE));
      let signedIn: StudioUserRow;
      let bootstrap = false;
      try {
        // The ID token is accepted only from the token response.
        if (query.has("id_token") || query.has("access_token")) throw new SignInRefusal("token-in-url");
        if (query.has("error")) throw new SignInRefusal("provider-error");
        const state = query.get("state");
        if (!state) throw new SignInRefusal("state-missing");
        if (loginCookie === null || loginCookie.length !== state.length || sha256Hex(loginCookie) !== sha256Hex(state)) {
          throw new SignInRefusal("state-cookie-mismatch");
        }
        // Single use, and refused once expired: the schema's own function deletes the attempt.
        const attempt = await store.consumeLoginAttempt(sha256Hex(state));
        if (!attempt) throw new SignInRefusal("state-unknown");
        const code = query.get("code");
        if (!code || code.length > 2_048) throw new SignInRefusal("code-missing");
        const idToken = await exchangeCode(oidc, {
          code, verifier: attempt.verifier, clientId: config.clientId, clientSecret: config.clientSecret, redirectUri,
          timeoutMs: tokenTimeoutMs,
        });
        const payload = await verifyIdToken(idToken, keys, { issuers: oidc.issuers, clientId: config.clientId, now: ctx.now });
        const identity = checkIdentityClaims(payload, { nonceHash: attempt.nonceHash, allowedHd: config.allowedHd });
        const user = await store.findUserByEmail(identity.email);
        const plan = planSignIn({
          identity, user, activeOwnerExists: await store.activeOwnerExists(), bootstrapOwnerEmail: config.bootstrapOwnerEmail,
        });
        if (plan.kind === "refuse") throw new SignInRefusal(plan.reason);
        bootstrap = plan.kind === "bootstrap";
        const presented = readCookie(ctx.req.headers.cookie, SESSION_COOKIE);
        const sessionValue = randomToken();
        const times = newSessionTimes(ctx.now);
        try {
          signedIn = await store.transaction(async (tx) => {
            // Rotation: a session presented at sign-in is revoked, never reused.
            if (presented !== null) await tx.revokeSession(sessionIdHash(presented), new Date(ctx.now));
            let account: StudioUserRow;
            if (plan.kind === "bootstrap") {
              account = await tx.createBootstrapOwner({ email: identity.email, sub: identity.sub, displayName: identity.displayName });
              await tx.audit({ action: "auth.bootstrap_owner", actorUserId: account.id, targetType: "studio_user",
                targetId: account.id, detail: { role: "owner" } });
            } else {
              account = plan.user;
              if (plan.setSub && !(await tx.setGoogleSub(account.id, identity.sub))) {
                const again = await tx.findUserByEmail(identity.email);
                if (again?.google_sub !== identity.sub) throw new SignInRefusal("subject-mismatch");
              }
            }
            await tx.createSession({
              idHash: sessionIdHash(sessionValue), userId: account.id, csrfHash: csrfTokenHash(csrfTokenFor(sessionValue)),
              ...times,
            });
            await tx.audit({ action: "auth.sign_in", actorUserId: account.id, targetType: "studio_user", targetId: account.id,
              detail: { rotated: presented !== null, bootstrap: plan.kind === "bootstrap" } });
            return account;
          });
        } catch (error) {
          if (error instanceof SignInRefusal) throw error;
          if (isRefusedWrite(error)) throw new SignInRefusal(plan.kind === "bootstrap" ? "bootstrap-refused" : "sign-in-conflict");
          throw error;
        }
        addCookie(ctx.res, setCookie(SESSION_COOKIE, sessionValue, SESSION_ABSOLUTE_MS / 1000));
      } catch (error) {
        const reason = error instanceof SignInRefusal ? error.reason : "internal-error";
        if (!(error instanceof SignInRefusal)) log("auth.sign_in.error", { error_class: errorClass(error) });
        return refuseSignIn(ctx, reason);
      }
      log("auth.sign_in", { user: signedIn.id, bootstrap });
      // Always "/": no return-to parameter, so no open redirect.
      redirect(ctx.res, 303, "/");
    },

    "POST /auth/logout": async (ctx) => {
      const user = ctx.user!;
      await store.revokeSession(sessionIdHash(ctx.sessionCookie!), new Date(ctx.now));
      await store.audit({ action: "auth.sign_out", actorUserId: user.id, targetType: "studio_user", targetId: user.id, detail: {} });
      addCookie(ctx.res, clearCookie(SESSION_COOKIE));
      log("auth.sign_out", { user: user.id });
      redirect(ctx.res, 303, "/");
    },
  };

  const routes: Route[] = STUDIO_ROUTE_TABLE.map((declaration) => {
    const handle = handlers[`${declaration.method} ${declaration.path}`];
    if (!handle) throw new Error(`route ${declaration.method} ${declaration.path} has no handler`);
    return { ...declaration, handle };
  });
  routes.push(...(options.extraRoutes ?? []));

  const dispatch = async (req: IncomingMessage, res: ServerResponse) => {
    const now = clock();
    // Parsed against the configured origin: the Host header is never read.
    const url = new URL(req.url ?? "/", config.publicOrigin);
    const declared = routes.filter((route) => route.path === url.pathname);
    if (declared.length === 0) {
      log("http.denied", { status: 404 });
      return page(res, 404, "Not found", "<h1>Not found</h1>");
    }
    const route = declared.find((candidate) => candidate.method === req.method);
    if (!route) {
      res.setHeader("allow", [...new Set(declared.map((candidate) => candidate.method))].join(", "));
      log("http.denied", { status: 405 });
      return page(res, 405, "Method not allowed", "<h1>Method not allowed</h1>");
    }
    if (req.method === "POST" && !originAllowed(req.headers.origin, config.publicOrigin)) {
      log("csrf.refused", { check: "origin" });
      return page(res, 403, "Forbidden", "<h1>Forbidden</h1>");
    }
    let user: StudioUserRow | null = null;
    let sessionCookie: string | null = null;
    let csrfHash: string | null = null;
    if (route.session !== false) {
      const cookie = readCookie(req.headers.cookie, SESSION_COOKIE);
      if (cookie !== null) {
        const decision = decideSession(await store.findSession(sessionIdHash(cookie)), now);
        if (decision.ok) {
          user = decision.user;
          sessionCookie = cookie;
          csrfHash = decision.csrfHash;
          if (decision.touch) await store.touchSession(sessionIdHash(cookie), decision.touch.lastSeenAt, decision.touch.idleExpiresAt);
        } else {
          log("session.refused", { reason: decision.reason });
          addCookie(res, clearCookie(SESSION_COOKIE));
        }
      }
    }
    if (!roleAllows(route.minRole, user)) {
      log("http.denied", { status: user ? 403 : 401 });
      return user ? page(res, 403, "Forbidden", "<h1>Forbidden</h1>")
        : page(res, 401, "Sign in", "<h1>Sign in required</h1><p><a href=\"/auth/login\">Sign in with Google</a></p>");
    }
    if (req.method === "POST") {
      const form = await readForm(req);
      if (form === null) return page(res, 413, "Too large", "<h1>Request too large</h1>");
      const presented = form.get("csrf") ?? req.headers["x-csrf-token"];
      if (csrfHash === null || !csrfMatches(presented, csrfHash)) {
        log("csrf.refused", { check: "token" });
        return page(res, 403, "Forbidden", "<h1>Forbidden</h1>");
      }
    }
    await route.handle({ req, res, url, now, user, sessionCookie });
  };

  return {
    oidc,
    routes,
    async handle(req, res) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
      try {
        await dispatch(req, res);
      } catch (error) {
        log("http.error", { error_class: errorClass(error) });
        if (!res.headersSent) page(res, 500, "Error", "<h1>Something went wrong</h1>");
        else res.destroy();
      }
    },
    async purge() {
      const now = clock();
      const result = await store.purge(new Date(now - LOGIN_ATTEMPT_RETENTION_MS), new Date(now - SESSION_RETENTION_MS));
      log("purge", { login_attempts: result.loginAttempts, sessions: result.sessions });
      return result;
    },
  };
}
