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
 * - **Content Studio S5's read-only screens** (design §8.1, §8.2): `GET /runs`,
 *   `GET /runs/:id`, `GET /runs/:id/files/:name` and the two static files, each
 *   `viewer`. A route parameter is matched as one non-empty path segment and
 *   then validated by its handler — a run id as a UUID, a file name by the
 *   schema's artifact-name shape — so anything else is a 404, as an unknown or
 *   deleted run is. Every S5 route is a GET and changes nothing.
 * - **Content Studio S6.2's actions** (design §6.1–§6.4, §8.3, §8.4): the new-run
 *   form and its price request, a derived action's price request from a
 *   report, the preflight's answer and its quote, the confirmation, the
 *   cancellation, the owner's fake run and overrun acknowledgement, and the
 *   spend panel. Every action is a POST under S4's Origin and CSRF checks, and
 *   is checked server-side against the live users row: by the route's minimum
 *   role here, and again in the decision (`actions.ts`) and by the schema's
 *   triggers. **The web never computes a price**; a quote is the worker's.
 * - **Content Studio S7.2's fact versions and imports** (design §8.2 item 8,
 *   §8.5, §8.6): the versions list (viewer), the owner's upload, its check's
 *   result, activation, retirement and restoration, a version's bytes, the
 *   owner's import of a CLI run folder, and the whole-run bundle (viewer). The
 *   upload and the import post ONE JSON document, which the static script
 *   puts in the form's one `document` field (so the script makes no request
 *   itself, and S4's form token and Origin check apply unchanged); each route
 *   declares its own body bound, enforced while reading, and the document's
 *   own bound is checked before it is parsed (`bundle.ts`). Every owner edit
 *   runs in one transaction that declares its actor (`declareActor`, `store.ts`).
 * - **Content Studio S7.3's users, caps and audit screens** (design §8.7, §6.2,
 *   §9.5): every route is the owner's, refused to anyone else (403) before the
 *   store is read. A user is added by address (lower-cased; the schema refuses
 *   another domain and a duplicate), and their role, own daily cap and status
 *   change, or their sessions are revoked — each ONE owner edit through
 *   `declareActor`, audited by the schema. **There is no email edit** (owner
 *   decision 5). The last active owner is never removed (409, by the store's
 *   decision and the schema's trigger). Demoting or disabling oneself needs an
 *   explicit confirmation, and signs one out at once. The owner's daily and
 *   monthly caps are shown beside the deployment ceilings and the effective
 *   cap; the audit log is read-only and escaped; `scheduled_runs_enabled` is
 *   shown as unavailable, with no control.
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
import { escapeHtml } from "./html.js";
import type { Refusal } from "./actions.js";
import { downloadHeaders, verifiedBytes } from "./downloads.js";
import {
  ARTIFACT_NAME_SHAPE, MAX_DISPLAY_ARTIFACT_BYTES, parseGrouping, parseRunFilters, runVisible, RUNS_PAGE_SIZE, UUID_SHAPE,
} from "./runs.js";
import { STATIC_ASSETS, STATIC_CACHE_CONTROL } from "./static.js";
import { listPolls, REPORT_ARTIFACTS, reportBody, reportPolls, runsListBody, shell } from "./views.js";
import {
  localDay, offeredTags, parseNewRun, preflightRequest, sourceActions, workerOnline, type PaidAction,
} from "./actions.js";
import {
  newRunBody, preflightBody, PREFLIGHT_POLL_SECONDS, refusalBody, reportActions, spendBody,
} from "./actionViews.js";
import { stoppedAt } from "./runs.js";
import {
  baseName, decodeFactUpload, decodeRunBundle, documentField, encodeRunBundle, FACT_UPLOAD_MAX_FORM_BYTES, IMPORT_MAX_FORM_BYTES,
  importRunner, lineageKey,
} from "./bundle.js";
import { checkBody, FACT_CHECK_POLL_SECONDS, importBody, importSection, uploadBody, versionsBody } from "./factViews.js";
import { STUDIO_IMPORT_FILE_NAMES } from "../db/runner.js";
import {
  AUDIT_PAGE_SIZE, losesOwnSeat, normalizeNewUserEmail, parseAuditFilters, parseCapInput, parseRole, type UserChange,
} from "./users.js";
import { auditBody, confirmSelfBody, settingsBody, usersBody } from "./userViews.js";

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
/**
 * Content Studio S6.2: the new-run form's own bound. A goal of 2,000 characters
 * can be 8,000 UTF-8 bytes, three times that once form-encoded, beside the
 * platforms and the scope tags; every other route keeps MAX_FORM_BYTES.
 */
export const NEW_RUN_MAX_FORM_BYTES = 65_536;

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
  /** The route's `:name` segments, percent-decoded, not yet validated (each handler validates its own). */
  params: Readonly<Record<string, string>>;
  /** A POST's form, read (bounded) and its CSRF token checked before the handler runs; null for a GET. */
  form: URLSearchParams | null;
}

export interface RouteDeclaration {
  method: "GET" | "POST";
  /** A literal path, or one with `:name` segments (each one non-empty path segment). */
  path: string;
  minRole: MinRole;
  /** False for routes that never read a session (`/healthz`). */
  session?: boolean;
  /** A POST's own body bound, in bytes, where it is not MAX_FORM_BYTES (S6.2: the new-run form; S7.2: the upload and the import). */
  maxFormBytes?: number;
}
export interface Route extends RouteDeclaration {
  handle(ctx: RouteContext): Promise<void>;
}

/** The route table: every route the service ships, each with its minimum role (S4's five, S5's five, S6.2's nine, S7.2's eleven, then S7.3's ten). */
export const STUDIO_ROUTE_TABLE: readonly RouteDeclaration[] = Object.freeze([
  { method: "GET", path: "/", minRole: "public" },
  { method: "GET", path: "/healthz", minRole: "public", session: false },
  { method: "GET", path: "/auth/login", minRole: "public" },
  { method: "GET", path: "/auth/callback", minRole: "public" },
  { method: "POST", path: "/auth/logout", minRole: "viewer" },
  { method: "GET", path: "/runs", minRole: "viewer" },
  { method: "GET", path: "/runs/:id", minRole: "viewer" },
  { method: "GET", path: "/runs/:id/files/:name", minRole: "viewer" },
  { method: "GET", path: STATIC_ASSETS.css.path, minRole: "viewer" },
  { method: "GET", path: STATIC_ASSETS.js.path, minRole: "viewer" },
  { method: "GET", path: "/new", minRole: "runner" },
  { method: "POST", path: "/new/price", minRole: "runner", maxFormBytes: NEW_RUN_MAX_FORM_BYTES },
  { method: "POST", path: "/new/fake", minRole: "owner", maxFormBytes: NEW_RUN_MAX_FORM_BYTES },
  { method: "POST", path: "/runs/:id/price", minRole: "runner" },
  { method: "POST", path: "/runs/:id/cancel", minRole: "runner" },
  { method: "GET", path: "/preflights/:id", minRole: "runner" },
  { method: "POST", path: "/quotes/:id/confirm", minRole: "runner" },
  { method: "GET", path: "/spend", minRole: "viewer" },
  { method: "POST", path: "/spend/overruns/:id/acknowledge", minRole: "owner" },
  { method: "GET", path: "/facts", minRole: "viewer" },
  { method: "GET", path: "/facts/upload", minRole: "owner" },
  { method: "POST", path: "/facts/upload", minRole: "owner", maxFormBytes: FACT_UPLOAD_MAX_FORM_BYTES },
  { method: "GET", path: "/facts/checks/:id", minRole: "owner" },
  { method: "POST", path: "/facts/versions/:id/activate", minRole: "owner" },
  { method: "POST", path: "/facts/versions/:id/retire", minRole: "owner" },
  { method: "POST", path: "/facts/versions/:id/restore", minRole: "owner" },
  { method: "GET", path: "/facts/versions/:id/file", minRole: "owner" },
  { method: "GET", path: "/imports/new", minRole: "owner" },
  { method: "POST", path: "/imports", minRole: "owner", maxFormBytes: IMPORT_MAX_FORM_BYTES },
  { method: "GET", path: "/runs/:id/bundle", minRole: "viewer" },
  { method: "GET", path: "/users", minRole: "owner" },
  { method: "POST", path: "/users", minRole: "owner" },
  { method: "POST", path: "/users/:id/role", minRole: "owner" },
  { method: "POST", path: "/users/:id/cap", minRole: "owner" },
  { method: "POST", path: "/users/:id/disable", minRole: "owner" },
  { method: "POST", path: "/users/:id/enable", minRole: "owner" },
  { method: "POST", path: "/users/:id/revoke-sessions", minRole: "owner" },
  { method: "GET", path: "/settings", minRole: "owner" },
  { method: "POST", path: "/settings/caps", minRole: "owner" },
  { method: "GET", path: "/audit", minRole: "owner" },
] as const);

/**
 * A request path against a route path: the `:name` segments, percent-decoded,
 * when it matches; null otherwise. A parameter is exactly one non-empty segment.
 */
export function matchRoute(pattern: string, pathname: string): Record<string, string> | null {
  const want = pattern.split("/");
  const have = pathname.split("/");
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (const [index, segment] of want.entries()) {
    const actual = have[index]!;
    if (!segment.startsWith(":")) {
      if (segment !== actual) return null;
      continue;
    }
    if (actual === "") return null;
    try {
      params[segment.slice(1)] = decodeURIComponent(actual);
    } catch {
      return null;
    }
  }
  return params;
}

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
  purge(): Promise<{ loginAttempts: number; sessions: number; preflightRequests: number; factChecks: number }>;
}

// --- Responses -----------------------------------------------------------------

export { escapeHtml } from "./html.js";

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

/** An S5 page, already rendered by `views.ts`. */
function htmlPage(res: ServerResponse, status: number, html: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(html);
}

const notFound = (res: ServerResponse) => page(res, 404, "Not found", "<h1>Not found</h1>");

/** A static file: its own type, nosniff and the CSP (every response's), cached for a year (the URL carries its version). */
function staticFile(res: ServerResponse, asset: (typeof STATIC_ASSETS)[keyof typeof STATIC_ASSETS]): void {
  res.statusCode = 200;
  res.setHeader("content-type", asset.contentType);
  res.setHeader("cache-control", STATIC_CACHE_CONTROL);
  res.setHeader("content-length", String(asset.body.length));
  res.end(asset.body);
}

const signedOutPage = (res: ServerResponse) => page(res, 200, "Sign in",
  "<h1>Content Studio</h1><p><a href=\"/auth/login\">Sign in with Google</a></p>");
const notAuthorizedPage = (res: ServerResponse) => page(res, 403, "Not authorized",
  "<h1>Not authorized</h1><p>This account cannot sign in to the Content Studio.</p><p><a href=\"/\">Back</a></p>");
const signedInPage = (res: ServerResponse, user: StudioUserRow, csrfToken: string) => page(res, 200, "Signed in",
  `<h1>Content Studio</h1><p>Signed in as <strong>${escapeHtml(user.display_name ?? "(no display name)")}</strong>`
  + ` — role: <strong>${escapeHtml(user.role)}</strong></p><p><a href="/runs">Runs</a></p>`
  + `<form method="post" action="/auth/logout"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">`
  + "<button type=\"submit\">Sign out</button></form>");

/** The direct peer: forwarding headers are spoofable and are not trusted (as on the live API). */
const clientAddress = (req: IncomingMessage): string => req.socket.remoteAddress ?? "unknown";

function readForm(req: IncomingMessage, limit: number = MAX_FORM_BYTES): Promise<URLSearchParams | null> {
  return new Promise((settle) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { settle(null); req.destroy(); return; }
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

/** S6.2: a write the schema refused — a check, a uniqueness, or a row it references that is missing. */
const isRefusedActionWrite = (error: unknown): boolean =>
  isRefusedWrite(error) || (error as { code?: unknown })?.code === "23503";

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

  /** A refused action: its class and message (escaped), and the class alone in the log. */
  const refused = (ctx: RouteContext, status: number, title: string, refusal: { refusal: string; message: string }, back: string) =>
    htmlPage(ctx.res, status, shell({
      title, user: ctx.user!, csrfToken: csrfTokenFor(ctx.sessionCookie!), poll: false, body: refusalBody(title, refusal, back),
    }));

  /** §6.1 step 1: the preflight job and its request, in one transaction; then the page that waits for the answer. */
  const askPrice = async (ctx: RouteContext, request: ReturnType<typeof preflightRequest>) => {
    let created: { requestId: string; jobId: string };
    try {
      created = await store.createPreflightRequest(request);
    } catch (error) {
      if (!isRefusedActionWrite(error)) throw error;
      log("preflight.request_refused", { user: ctx.user!.id, action: request.action });
      return refused(ctx, 409, "Not requested", { refusal: "request_refused",
        message: "the database refused this request: your account, the source run or the fact version may have changed" }, "/new");
    }
    log("preflight.request", { user: ctx.user!.id, request: created.requestId, action: request.action });
    redirect(ctx.res, 303, `/preflights/${created.requestId}`);
  };

  /** S7.2: activate, retire or restore a version — one owner edit each, refused with its reason (the schema refuses too). */
  const versionEdit = async (ctx: RouteContext, verb: "activate" | "retire" | "restore") => {
    const id = ctx.params.id!;
    if (!UUID_SHAPE.test(id)) return notFound(ctx.res);
    const ownerId = ctx.user!.id;
    let result;
    try {
      result = verb === "activate" ? await store.activateFactVersion({ ownerId, versionId: id })
        : await store.setFactVersionStatus({ ownerId, versionId: id, status: verb === "retire" ? "retired" : "active" });
    } catch (error) {
      if (!isRefusedActionWrite(error)) throw error;
      result = { ok: false as const, refusal: "edit_refused",
        message: "the database refused this change: the active version is retired only after another is made active" };
    }
    if (!result.ok) {
      log("facts.version_refused", { user: ownerId, version: id, verb, refusal: result.refusal });
      return refused(ctx, 409, "Not changed", result, "/facts");
    }
    log("facts.version", { user: ownerId, version: id, verb });
    redirect(ctx.res, 303, "/facts");
  };

  // --- Content Studio S7.3's helpers -------------------------------------------------------------------

  const userRefused = (ctx: RouteContext, status: number, refusal: { refusal: string; message: string }) => {
    log("user.edit_refused", { user: ctx.user!.id, refusal: refusal.refusal });
    return refused(ctx, status, "Not changed", refusal, "/users");
  };
  const capsRefused = (ctx: RouteContext, refusal: { refusal: string; message: string }, status = 400) => {
    log("settings.caps_refused", { user: ctx.user!.id, refusal: refusal.refusal });
    return refused(ctx, status, "Not changed", refusal, "/settings");
  };
  /** A typed amount echoed back in a refusal: bounded, and escaped where it is shown. */
  const quoted = (value: string | null) => `"${(value ?? "").slice(0, 40)}"`;
  /** An owner edit the schema may still refuse (the actor no longer an active owner, the last owner): a refusal, never a 500. */
  const ownerWrite = async <T extends { ok: boolean }>(ctx: RouteContext, write: () => Promise<T>): Promise<T | ({ ok: false } & Refusal)> => {
    try {
      return await write();
    } catch (error) {
      if (!isRefusedActionWrite(error)) throw error;
      log("user.edit_refused_by_schema", { user: ctx.user!.id, error_class: errorClass(error) });
      return { ok: false, refusal: "edit_refused", message: "the database refused this change: the last active owner must remain, and "
        + "your account must still be an active owner" };
    }
  };
  /** The acting owner lost their seat: this session is already revoked; its cookie is cleared and they leave. */
  const signedOut = (ctx: RouteContext) => {
    addCookie(ctx.res, clearCookie(SESSION_COOKIE));
    log("auth.signed_out_by_change", { user: ctx.user!.id });
    redirect(ctx.res, 303, "/");
  };
  /** A role or status change: self-demotion and self-disabling first need `confirm=yes`; nothing is written before. */
  const userChange = async (ctx: RouteContext, change: UserChange) => {
    const id = ctx.params.id!;
    if (!UUID_SHAPE.test(id)) return notFound(ctx.res);
    const owner = ctx.user!;
    if (losesOwnSeat(owner.id, id, change) && ctx.form!.get("confirm") !== "yes") {
      return htmlPage(ctx.res, 200, shell({
        title: "Confirm", user: owner, csrfToken: csrfTokenFor(ctx.sessionCookie!), poll: false,
        body: confirmSelfBody({ userId: id, verb: change.kind === "role" ? "role" : "disable",
          role: change.kind === "role" ? change.role : undefined, csrfToken: csrfTokenFor(ctx.sessionCookie!) }),
      }));
    }
    const result = await ownerWrite(ctx, () => store.changeUser({ ownerId: owner.id, userId: id, change }));
    if (!result.ok) return userRefused(ctx, result.refusal === "no_user" ? 404 : 409, result);
    log("user.change", { user: owner.id, target: id, kind: change.kind, value: change.kind === "role" ? change.role : change.status });
    if (result.signedOut) return signedOut(ctx);
    redirect(ctx.res, 303, "/users");
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

    "GET /runs": async (ctx) => {
      const decision = parseRunFilters(ctx.url.searchParams);
      if (!decision.ok) {
        log("runs.filter_refused", {});
        return page(ctx.res, 400, "Bad request", "<h1>Bad request</h1><p>That filter is not one the runs list accepts.</p>"
          + "<p><a href=\"/runs\">All runs</a></p>");
      }
      const { page: pageNumber, ...filters } = decision.filters;
      // One row past the page tells whether an older page exists; never more than the page is shown.
      const rows = await store.listRuns(filters, RUNS_PAGE_SIZE + 1, (pageNumber - 1) * RUNS_PAGE_SIZE);
      const shown = rows.slice(0, RUNS_PAGE_SIZE);
      htmlPage(ctx.res, 200, shell({
        title: "Runs", user: ctx.user!, csrfToken: csrfTokenFor(ctx.sessionCookie!), poll: listPolls(shown),
        body: runsListBody(shown, decision.filters, rows.length > RUNS_PAGE_SIZE),
      }));
    },

    "GET /runs/:id": async (ctx) => {
      const id = ctx.params.id!;
      const group = parseGrouping(ctx.url.searchParams);
      if (group === null) return page(ctx.res, 400, "Bad request", "<h1>Bad request</h1><p>Unknown grouping.</p>");
      const run = UUID_SHAPE.test(id) ? await store.findRun(id) : null;
      if (!runVisible(run)) return notFound(ctx.res);
      const [lineage, artifacts, findings, requests] = await Promise.all([
        store.runLineage(run), store.listArtifacts(run.id), store.listFindings(run.id), store.listRequests(run.id),
      ]);
      const content = new Map<string, Buffer>();
      for (const name of REPORT_ARTIFACTS) {
        const meta = artifacts.find((a) => a.name === name);
        if (!meta) continue;
        // Too large to parse, or failing its sha256: shown as "cannot display; download the file" (an empty
        // buffer never parses), and never read past its row's length.
        const stored = meta.byte_length > MAX_DISPLAY_ARTIFACT_BYTES ? null : await store.readArtifact(run.id, name);
        content.set(name, (stored ? verifiedBytes(stored) : null) ?? Buffer.alloc(0));
      }
      // S6.2: what this user may do from here — a derived action (revise, critic replay, resume) for an owner or
      // runner, and Cancel for an owner or the run's own runner — each re-checked by its POST route.
      const user = ctx.user!;
      const acts = user.role === "owner" || user.role === "runner";
      const actions = reportActions({
        runId: run.id, csrfToken: csrfTokenFor(ctx.sessionCookie!), fake: run.runner === "fake",
        actions: acts ? sourceActions(run, stoppedAt(run.kind, artifacts.map((a) => a.name), requests)) : [],
        cancellable: acts && (user.role === "owner" || run.requested_by === user.id) && (run.state === "queued" || run.state === "running"),
      });
      // S7.2: an import's tier and reason, and the files its metadata recorded, by base name only.
      let importInfo: string | undefined;
      if (run.kind === "imported") {
        const recorded: Array<[string, string]> = [];
        for (const [name, fields] of [["run-meta.json", [["approvedFacts", "Approved facts file"], ["automotiveFacts", "Automotive facts file"]]],
          ["revision-meta.json", [["sourceRunDir", "Revised from folder"]]]] as const) {
          const meta = artifacts.find((a) => a.name === name);
          const stored = meta && meta.byte_length <= MAX_DISPLAY_ARTIFACT_BYTES ? await store.readArtifact(run.id, name) : null;
          const bytes = stored ? verifiedBytes(stored) : null;
          let parsed: Record<string, unknown> | null = null;
          try { parsed = bytes ? JSON.parse(bytes.toString("utf8")) : null; } catch { parsed = null; }
          for (const [field, label] of fields) {
            const value = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>)[field] : undefined;
            const base = baseName(value !== null && typeof value === "object" ? (value as Record<string, unknown>).path : value);
            if (base) recorded.push([label, base]);
          }
        }
        importInfo = importSection({ tier: run.import_tier, state: run.state, failureClass: run.failure_class,
          failureMessage: run.failure_message, recordedFiles: recorded });
      }
      htmlPage(ctx.res, 200, shell({
        title: "Run report", user, csrfToken: csrfTokenFor(ctx.sessionCookie!), poll: reportPolls(run),
        body: reportBody({ run, lineage, artifacts, content, findings, requests, group, actions, importInfo }),
      }));
    },

    "GET /runs/:id/files/:name": async (ctx) => {
      const { id, name } = ctx.params as { id: string; name: string };
      if (!UUID_SHAPE.test(id) || !ARTIFACT_NAME_SHAPE.test(name)) return notFound(ctx.res);
      const run = await store.findRun(id);
      const stored = runVisible(run) ? await store.readArtifact(run.id, name) : null;
      if (!stored) return notFound(ctx.res);
      const bytes = verifiedBytes(stored);
      if (!bytes) {
        log("download.refused", { run: run!.id, reason: "sha256-mismatch" });
        return page(ctx.res, 500, "Integrity check failed",
          "<h1>This file failed its integrity check</h1><p>It does not match its stored sha256, so it was not served.</p>");
      }
      // The page headers are replaced by the download's exact set (downloads.ts).
      for (const header of ctx.res.getHeaderNames()) ctx.res.removeHeader(header);
      for (const [header, value] of Object.entries(downloadHeaders(name, bytes.length))) ctx.res.setHeader(header, value);
      ctx.res.statusCode = 200;
      log("download", { run: run!.id, bytes: bytes.length });
      ctx.res.end(bytes);
    },

    [`GET ${STATIC_ASSETS.css.path}`]: async ({ res }) => staticFile(res, STATIC_ASSETS.css),
    [`GET ${STATIC_ASSETS.js.path}`]: async ({ res }) => staticFile(res, STATIC_ASSETS.js),

    // --- Content Studio S6.2: the actions ---------------------------------------------------------

    "GET /new": async (ctx) => {
      const context = await store.actionContext();
      htmlPage(ctx.res, 200, shell({
        title: "New run", user: ctx.user!, csrfToken: csrfTokenFor(ctx.sessionCookie!), poll: false,
        body: newRunBody({
          csrfToken: csrfTokenFor(ctx.sessionCookie!), isOwner: ctx.user!.role === "owner",
          activeFactVersion: context.activeFactVersion,
          tags: offeredTags(context.heartbeat?.tagCounts, context.activeFactVersion?.tagCounts),
          workerOnline: workerOnline(context.nowMs, context.heartbeat?.beatAtMs),
        }),
      }));
    },

    "POST /new/price": async (ctx) => {
      const user = ctx.user!;
      const context = await store.actionContext();
      const version = context.activeFactVersion;
      // No fact version, no price (S7 adds the upload): nothing is written.
      if (!version) return refused(ctx, 409, "No price offered", { refusal: "no_fact_version",
        message: "no fact version is active, so no price can be offered" }, "/new");
      const tags = offeredTags(context.heartbeat?.tagCounts, version.tagCounts);
      const parsed = parseNewRun(ctx.form!, new Set(tags.map((t) => t.tag)));
      if (!parsed.ok) return refused(ctx, 400, "Not a valid request", parsed, "/new");
      return askPrice(ctx, preflightRequest({
        userId: user.id, action: "full", goal: parsed.goal, platforms: parsed.platforms, scopeTags: parsed.scopeTags,
        sourceRunId: null, factVersionId: version.id,
      }));
    },

    "POST /new/fake": async (ctx) => {
      const context = await store.actionContext();
      const tags = offeredTags(context.heartbeat?.tagCounts, context.activeFactVersion?.tagCounts);
      const parsed = parseNewRun(ctx.form!, new Set(tags.map((t) => t.tag)));
      if (!parsed.ok) return refused(ctx, 400, "Not a valid request", parsed, "/new");
      let created: { runId: string; jobId: string };
      try {
        created = await store.createFakeRun({ ownerId: ctx.user!.id, goal: parsed.goal, platforms: parsed.platforms,
          scopeTags: parsed.scopeTags, factVersionId: context.activeFactVersion?.id ?? null });
      } catch (error) {
        if (!isRefusedActionWrite(error)) throw error;
        return refused(ctx, 403, "Refused", { refusal: "not_permitted", message: "fake runs are owner-only" }, "/new");
      }
      log("run.fake", { user: ctx.user!.id, run: created.runId });
      redirect(ctx.res, 303, `/runs/${created.runId}`);
    },

    "POST /runs/:id/price": async (ctx) => {
      const id = ctx.params.id!;
      const run = UUID_SHAPE.test(id) ? await store.findRun(id) : null;
      if (!runVisible(run)) return notFound(ctx.res);
      // S7.2 (owner decision of 2026-10-06; migration 0004 refuses the confirmation): refused by name, before anything is written.
      if (run.runner === "fake") {
        log("preflight.request_refused", { user: ctx.user!.id, refusal: "fake_source" });
        return refused(ctx, 409, "Not offered", { refusal: "fake_source",
          message: "a fake run can never be the source of a paid action" }, `/runs/${run.id}`);
      }
      const action = ctx.form!.getAll("action");
      const [artifacts, requests] = await Promise.all([store.listArtifacts(run.id), store.listRequests(run.id)]);
      const offered = sourceActions(run, stoppedAt(run.kind, artifacts.map((a) => a.name), requests));
      if (action.length !== 1 || !offered.includes(action[0] as PaidAction)) {
        return refused(ctx, 409, "Not offered", { refusal: "action_not_offered",
          message: "this run does not offer that action" }, `/runs/${run.id}`);
      }
      return askPrice(ctx, preflightRequest({
        userId: ctx.user!.id, action: action[0] as PaidAction, goal: null, platforms: [...run.platforms!],
        scopeTags: run.scope_tags === null ? null : [...run.scope_tags].sort(), sourceRunId: run.id,
        factVersionId: run.fact_version_id!,
      }));
    },

    "GET /preflights/:id": async (ctx) => {
      const id = ctx.params.id!;
      const view = UUID_SHAPE.test(id) ? await store.findPreflightRequest(id) : null;
      const user = ctx.user!;
      // A request, its refusal and its quote are shown to its user and to an owner; to anyone else it does not exist.
      if (!view || (view.userId !== user.id && user.role !== "owner")) return notFound(ctx.res);
      const [context, spend] = await Promise.all([store.actionContext(), store.spendView(localDay(ctx.now))]);
      const source = view.sourceRunId ? await store.findRun(view.sourceRunId) : null;
      const mineRow = spend.users.find((u) => u.id === view.userId);
      const pending = view.outcome === null && (view.jobState === "queued" || view.jobState === "running");
      htmlPage(ctx.res, 200, shell({
        title: "Price", user, csrfToken: csrfTokenFor(ctx.sessionCookie!), poll: false, pollSeconds: pending ? PREFLIGHT_POLL_SECONDS : undefined,
        body: preflightBody({
          view, csrfToken: csrfTokenFor(ctx.sessionCookie!), mine: view.userId === user.id, nowMs: context.nowMs,
          workerOnline: workerOnline(context.nowMs, context.heartbeat?.beatAtMs), sourceGoal: source?.goal ?? null,
          capsLeft: { ceilings: config.ceilings, spend, userDayMicros: mineRow?.dayMicros ?? 0,
            userDailyCapMicros: mineRow?.dailyCapMicros ?? null, userRole: mineRow?.role ?? null },
        }),
      }));
    },

    "POST /quotes/:id/confirm": async (ctx) => {
      const id = ctx.params.id!;
      if (!UUID_SHAPE.test(id)) return notFound(ctx.res);
      const result = await store.confirmQuote({ quoteId: id, userId: ctx.user!.id, ceilings: config.ceilings });
      if (!result.ok) {
        log("quote.confirm_refused", { user: ctx.user!.id, refusal: result.refusal });
        return refused(ctx, result.refusal === "no_quote" ? 404 : 409, "Not confirmed", result, "/new");
      }
      log("run.confirm", { user: ctx.user!.id, run: result.runId });
      redirect(ctx.res, 303, `/runs/${result.runId}`);
    },

    "POST /runs/:id/cancel": async (ctx) => {
      const id = ctx.params.id!;
      if (!UUID_SHAPE.test(id)) return notFound(ctx.res);
      const user = ctx.user!;
      const result = await store.cancelRun({ runId: id, user: { id: user.id, role: user.role, status: user.status } });
      if (!result.ok) {
        log("run.cancel_refused", { user: user.id, refusal: result.refusal });
        if (result.refusal === "no_run") return notFound(ctx.res);
        return refused(ctx, result.refusal === "not_your_run" ? 403 : 409, "Not cancelled", result, `/runs/${id}`);
      }
      log("run.cancel", { user: user.id, run: id, was: result.kind });
      redirect(ctx.res, 303, `/runs/${id}`);
    },

    "GET /spend": async (ctx) => {
      const view = await store.spendView(localDay(ctx.now));
      htmlPage(ctx.res, 200, shell({
        title: "Spend", user: ctx.user!, csrfToken: csrfTokenFor(ctx.sessionCookie!), poll: false,
        body: spendBody({ view, ceilings: config.ceilings, csrfToken: csrfTokenFor(ctx.sessionCookie!), isOwner: ctx.user!.role === "owner" }),
      }));
    },

    "POST /spend/overruns/:id/acknowledge": async (ctx) => {
      const id = ctx.params.id!;
      if (!UUID_SHAPE.test(id)) return notFound(ctx.res);
      if (!(await store.acknowledgeOverrun({ runId: id, ownerId: ctx.user!.id }))) {
        return refused(ctx, 409, "Nothing to acknowledge", { refusal: "no_open_overrun",
          message: "this run has no overrun waiting for acknowledgement" }, "/spend");
      }
      log("spend.overrun_acknowledged", { user: ctx.user!.id, run: id });
      redirect(ctx.res, 303, "/spend");
    },

    // --- Content Studio S7.2: fact versions, the fact check, imports and the whole-run bundle -----------

    "GET /facts": async (ctx) => {
      const versions = await store.listFactVersions();
      htmlPage(ctx.res, 200, shell({
        title: "Fact versions", user: ctx.user!, csrfToken: csrfTokenFor(ctx.sessionCookie!), poll: false,
        body: versionsBody({ versions, isOwner: ctx.user!.role === "owner", csrfToken: csrfTokenFor(ctx.sessionCookie!) }),
      }));
    },

    "GET /facts/upload": async (ctx) => {
      htmlPage(ctx.res, 200, shell({
        title: "Upload facts", user: ctx.user!, csrfToken: csrfTokenFor(ctx.sessionCookie!), poll: false,
        body: uploadBody({ csrfToken: csrfTokenFor(ctx.sessionCookie!) }),
      }));
    },

    "POST /facts/upload": async (ctx) => {
      const document = documentField(ctx.form!);
      const decoded = document.ok ? decodeFactUpload(document.value) : document;
      if (!decoded.ok) {
        log("facts.upload_refused", { user: ctx.user!.id, refusal: decoded.refusal });
        return refused(ctx, decoded.refusal === "too_large" ? 413 : 400, "Not uploaded", decoded, "/facts/upload");
      }
      let staged;
      try {
        staged = await store.stageFactUpload({ ownerId: ctx.user!.id, content: decoded.value.content, sha256: decoded.value.sha256 });
      } catch (error) {
        if (!isRefusedActionWrite(error)) throw error;
        log("facts.upload_refused", { user: ctx.user!.id, refusal: "upload_refused" });
        return refused(ctx, 409, "Not uploaded", { refusal: "upload_refused",
          message: "the database refused this upload: your account may no longer be an active owner" }, "/facts/upload");
      }
      if (!staged.ok) {
        log("facts.upload_refused", { user: ctx.user!.id, refusal: staged.refusal });
        return refused(ctx, 409, "Not uploaded", staged, "/facts/upload");
      }
      log("facts.upload", { user: ctx.user!.id, check: staged.checkId, bytes: decoded.value.content.length });
      redirect(ctx.res, 303, `/facts/checks/${staged.checkId}`);
    },

    "GET /facts/checks/:id": async (ctx) => {
      const id = ctx.params.id!;
      const view = UUID_SHAPE.test(id) ? await store.findFactCheck(id) : null;
      if (!view) return notFound(ctx.res);
      const pending = view.outcome === null && (view.jobState === "queued" || view.jobState === "running");
      htmlPage(ctx.res, 200, shell({
        title: "Fact check", user: ctx.user!, csrfToken: csrfTokenFor(ctx.sessionCookie!), poll: false,
        pollSeconds: pending ? FACT_CHECK_POLL_SECONDS : undefined, body: checkBody({ view }),
      }));
    },

    "POST /facts/versions/:id/activate": async (ctx) => versionEdit(ctx, "activate"),
    "POST /facts/versions/:id/retire": async (ctx) => versionEdit(ctx, "retire"),
    "POST /facts/versions/:id/restore": async (ctx) => versionEdit(ctx, "restore"),

    "GET /facts/versions/:id/file": async (ctx) => {
      const id = ctx.params.id!;
      const version = UUID_SHAPE.test(id) ? await store.readFactVersion(id) : null;
      if (!version) return notFound(ctx.res);
      const name = `automotive-facts-${version.sha256.slice(0, 12)}.json`;
      if (!verifiedBytes({ name, content: version.content, sha256: version.sha256, byte_length: version.content.length })) {
        log("download.refused", { version: id, reason: "sha256-mismatch" });
        return page(ctx.res, 500, "Integrity check failed",
          "<h1>This file failed its integrity check</h1><p>It does not match its stored sha256, so it was not served.</p>");
      }
      for (const header of ctx.res.getHeaderNames()) ctx.res.removeHeader(header);
      for (const [header, value] of Object.entries(downloadHeaders(name, version.content.length))) ctx.res.setHeader(header, value);
      ctx.res.statusCode = 200;
      log("facts.download", { user: ctx.user!.id, version: id, bytes: version.content.length });
      ctx.res.end(version.content);
    },

    "GET /imports/new": async (ctx) => {
      htmlPage(ctx.res, 200, shell({
        title: "Import a run", user: ctx.user!, csrfToken: csrfTokenFor(ctx.sessionCookie!), poll: false,
        body: importBody({ csrfToken: csrfTokenFor(ctx.sessionCookie!), knownNames: STUDIO_IMPORT_FILE_NAMES }),
      }));
    },

    "POST /imports": async (ctx) => {
      const document = documentField(ctx.form!);
      const decoded = document.ok ? decodeRunBundle(document.value) : document;
      if (!decoded.ok) {
        log("import.refused", { user: ctx.user!.id, refusal: decoded.refusal });
        return refused(ctx, decoded.refusal === "too_large" ? 413 : 400, "Not imported", decoded, "/imports/new");
      }
      let created;
      try {
        created = await store.createImport({ ownerId: ctx.user!.id, runner: importRunner(decoded.value), files: decoded.value,
          lineage: lineageKey(decoded.value) });
      } catch (error) {
        if (!isRefusedActionWrite(error)) throw error;
        log("import.refused", { user: ctx.user!.id, refusal: "import_refused" });
        return refused(ctx, 409, "Not imported", { refusal: "import_refused",
          message: "the database refused this import: your account may no longer be an active owner, or its files exceed the import's bounds" },
        "/imports/new");
      }
      log("import.create", { user: ctx.user!.id, run: created.runId, files: decoded.value.length, lineage: created.sourceRunId !== null });
      redirect(ctx.res, 303, `/runs/${created.runId}`);
    },

    "GET /runs/:id/bundle": async (ctx) => {
      const id = ctx.params.id!;
      const run = UUID_SHAPE.test(id) ? await store.findRun(id) : null;
      if (!runVisible(run)) return notFound(ctx.res);
      const files: Array<{ name: string; content: Buffer }> = [];
      for (const meta of await store.listArtifacts(run.id)) {
        const stored = await store.readArtifact(run.id, meta.name);
        const bytes = stored ? verifiedBytes(stored) : null;
        if (!bytes) {
          log("download.refused", { run: run.id, reason: "sha256-mismatch" });
          return page(ctx.res, 500, "Integrity check failed",
            "<h1>A file failed its integrity check</h1><p>It does not match its stored sha256, so no bundle was served.</p>");
        }
        files.push({ name: meta.name, content: bytes });
      }
      const bundle = encodeRunBundle(files);
      if (!bundle.ok) {
        log("download.refused", { run: run.id, reason: bundle.refusal });
        return refused(ctx, 409, "No bundle", bundle, `/runs/${run.id}`);
      }
      const name = `run-${run.id}.json`;
      for (const header of ctx.res.getHeaderNames()) ctx.res.removeHeader(header);
      for (const [header, value] of Object.entries(downloadHeaders(name, bundle.value.length))) ctx.res.setHeader(header, value);
      ctx.res.statusCode = 200;
      log("download.bundle", { run: run.id, files: files.length, bytes: bundle.value.length });
      ctx.res.end(bundle.value);
    },

    // --- Content Studio S7.3: users, caps and settings, and the audit log (owner only) -----------------------

    "GET /users": async (ctx) => {
      const users = await store.listUsers();
      htmlPage(ctx.res, 200, shell({
        title: "Users", user: ctx.user!, csrfToken: csrfTokenFor(ctx.sessionCookie!), poll: false,
        body: usersBody({ users, viewer: ctx.user!, csrfToken: csrfTokenFor(ctx.sessionCookie!), ceilings: config.ceilings }),
      }));
    },

    "POST /users": async (ctx) => {
      const form = ctx.form!;
      const owner = ctx.user!;
      const email = form.getAll("email").length === 1 ? normalizeNewUserEmail(form.get("email")) : normalizeNewUserEmail(null);
      if (!email.ok) return userRefused(ctx, 400, email);
      const role = parseRole(form.get("role"));
      if (!role.ok || form.getAll("role").length !== 1) return userRefused(ctx, 400, role.ok ? { refusal: "invalid_role", message: "choose one role" } : role);
      const cap = parseCapInput(form.get("cap") ?? "", config.ceilings.dailyMicros, true);
      if (!cap.ok) return userRefused(ctx, 400, cap);
      let created;
      try {
        created = await store.createUser({ ownerId: owner.id, email: email.value, role: role.value, dailyCapMicros: cap.value });
      } catch (error) {
        const code = (error as { code?: unknown })?.code;
        if (code === "23505") return userRefused(ctx, 409, { refusal: "duplicate", message: "a user with that address already exists" });
        if (!isRefusedActionWrite(error)) throw error;
        return userRefused(ctx, 409, { refusal: "add_refused",
          message: "the database refused this user: the address must be at the Studio's domain, and your account an active owner" });
      }
      log("user.create", { user: owner.id, target: created.userId, role: role.value });
      redirect(ctx.res, 303, "/users");
    },

    "POST /users/:id/role": async (ctx) => {
      const role = parseRole(ctx.form!.get("role"));
      if (!role.ok || ctx.form!.getAll("role").length !== 1) return userRefused(ctx, 400, role.ok ? { refusal: "invalid_role", message: "choose one role" } : role);
      return userChange(ctx, { kind: "role", role: role.value });
    },
    "POST /users/:id/disable": async (ctx) => userChange(ctx, { kind: "status", status: "disabled" }),
    "POST /users/:id/enable": async (ctx) => userChange(ctx, { kind: "status", status: "active" }),

    "POST /users/:id/cap": async (ctx) => {
      const id = ctx.params.id!;
      if (!UUID_SHAPE.test(id)) return notFound(ctx.res);
      if (ctx.form!.getAll("cap").length !== 1) return userRefused(ctx, 400, { refusal: "invalid_cap", message: "give one amount" });
      const cap = parseCapInput(ctx.form!.get("cap"), config.ceilings.dailyMicros, true);
      if (!cap.ok) return userRefused(ctx, 400, cap);
      const result = await ownerWrite(ctx, () => store.setUserCap({ ownerId: ctx.user!.id, userId: id, dailyCapMicros: cap.value }));
      if (!result.ok) return userRefused(ctx, result.refusal === "no_user" ? 404 : 409, result);
      log("user.cap", { user: ctx.user!.id, target: id, cleared: cap.value === null });
      redirect(ctx.res, 303, "/users");
    },

    "POST /users/:id/revoke-sessions": async (ctx) => {
      const id = ctx.params.id!;
      if (!UUID_SHAPE.test(id)) return notFound(ctx.res);
      const result = await ownerWrite(ctx, () => store.revokeUserSessions({ ownerId: ctx.user!.id, userId: id }));
      if (!result.ok) return userRefused(ctx, result.refusal === "no_user" ? 404 : 409, result);
      log("user.sessions_revoked", { user: ctx.user!.id, target: id, sessions: result.revoked });
      // Revoking one's own sessions ends this one too.
      if (id === ctx.user!.id) return signedOut(ctx);
      redirect(ctx.res, 303, "/users");
    },

    "GET /settings": async (ctx) => {
      const context = await store.actionContext();
      htmlPage(ctx.res, 200, shell({
        title: "Caps and settings", user: ctx.user!, csrfToken: csrfTokenFor(ctx.sessionCookie!), poll: false,
        body: settingsBody({ context, ceilings: config.ceilings, csrfToken: csrfTokenFor(ctx.sessionCookie!) }),
      }));
    },

    "POST /settings/caps": async (ctx) => {
      const form = ctx.form!;
      if (form.getAll("daily").length !== 1 || form.getAll("monthly").length !== 1) {
        return capsRefused(ctx, { refusal: "invalid_cap", message: "give one daily and one monthly amount" });
      }
      const daily = parseCapInput(form.get("daily"), config.ceilings.dailyMicros, false);
      if (!daily.ok) return capsRefused(ctx, { refusal: daily.refusal, message: `daily cap ${quoted(form.get("daily"))}: ${daily.message}` });
      const monthly = parseCapInput(form.get("monthly"), config.ceilings.monthlyMicros, false);
      if (!monthly.ok) return capsRefused(ctx, { refusal: monthly.refusal, message: `monthly cap ${quoted(form.get("monthly"))}: ${monthly.message}` });
      const result = await ownerWrite(ctx, () => store.setCaps({ ownerId: ctx.user!.id, dailyCapMicros: daily.value!, monthlyCapMicros: monthly.value! }));
      if (!result.ok) return capsRefused(ctx, result, 409);
      log("settings.caps", { user: ctx.user!.id });
      redirect(ctx.res, 303, "/settings");
    },

    "GET /audit": async (ctx) => {
      const filters = parseAuditFilters(ctx.url.searchParams);
      if (!filters.ok) {
        return page(ctx.res, 400, "Bad request", "<h1>Bad request</h1><p>That filter is not one the audit view accepts.</p>"
          + "<p><a href=\"/audit\">The whole log</a></p>");
      }
      const { action, page: pageNumber } = filters.value;
      // One row past the page tells whether an older page exists; never more than the page is shown.
      const [rows, actions] = await Promise.all([
        store.listAudit(action, AUDIT_PAGE_SIZE + 1, (pageNumber - 1) * AUDIT_PAGE_SIZE), store.auditActions(),
      ]);
      htmlPage(ctx.res, 200, shell({
        title: "Audit log", user: ctx.user!, csrfToken: csrfTokenFor(ctx.sessionCookie!), poll: false,
        body: auditBody({ rows, actions, action, page: pageNumber, hasNext: rows.length > AUDIT_PAGE_SIZE }),
      }));
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
    const declared = routes.filter((route) => matchRoute(route.path, url.pathname) !== null);
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
    let form: URLSearchParams | null = null;
    if (req.method === "POST") {
      form = await readForm(req, route.maxFormBytes ?? MAX_FORM_BYTES);
      if (form === null) return page(res, 413, "Too large", "<h1>Request too large</h1>");
      const presented = form.get("csrf") ?? req.headers["x-csrf-token"];
      if (csrfHash === null || !csrfMatches(presented, csrfHash)) {
        log("csrf.refused", { check: "token" });
        return page(res, 403, "Forbidden", "<h1>Forbidden</h1>");
      }
    }
    await route.handle({ req, res, url, now, user, sessionCookie, form, params: matchRoute(route.path, url.pathname)! });
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
      log("purge", { login_attempts: result.loginAttempts, sessions: result.sessions, preflight_requests: result.preflightRequests,
        fact_checks: result.factChecks });
      return result;
    },
  };
}
