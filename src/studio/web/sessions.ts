/**
 * The Studio web service's session, cookie, CSRF, role and sign-in decisions
 * (docs/CONTENT_STUDIO_DESIGN.md §7.2, §7.3). Each is a pure function over
 * data — a stored row, a header, a clock — so the offline suite proves every
 * refusal and the mutation harness proves each one load-bearing. The store
 * (`store.ts`) returns rows as they are; it filters nothing these decide.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 random bytes, base64url: a session cookie, a state, a nonce or a PKCE verifier (43 characters). */
export const randomToken = (): string => randomBytes(32).toString("base64url");
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const sha256Hex = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

// --- Cookies -------------------------------------------------------------------

export const SESSION_COOKIE = "__Host-gcd_studio_session";
export const LOGIN_COOKIE = "__Host-gcd_studio_login";
/** Every cookie's attributes (design §7.3): `__Host-` requires Secure, `Path=/` and no `Domain`. */
export const COOKIE_ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Lax";
/** The login cookie lives as long as its attempt. */
export const LOGIN_COOKIE_MAX_AGE_SECONDS = 600;

export function setCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; ${COOKIE_ATTRIBUTES}; Max-Age=${maxAgeSeconds}`;
}
export function clearCookie(name: string): string {
  return `${name}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}

/** One cookie's value from a `Cookie` header, only when it has the token shape. A repeated name is refused. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (typeof header !== "string") return null;
  const values = header.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  if (values.length !== 1) return null;
  return TOKEN_SHAPE.test(values[0]!) ? values[0]! : null;
}

// --- Sessions ------------------------------------------------------------------

export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
/** How stale `last_seen_at` may be before a request writes it again. */
export const SESSION_TOUCH_MS = 60 * 1000;
/**
 * The purges' retention (design §4.7, PROPOSED there): a login attempt is
 * deleted 1 day after it expires, and a session 30 days after it ends — its
 * idle or absolute expiry, or its revocation. (Consuming an attempt already
 * deletes it, expired or not.)
 */
export const LOGIN_ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** The session id is only ever stored as its sha256 (design §4.1). */
export const sessionIdHash = (cookieValue: string): string => sha256Hex(cookieValue);

/**
 * The per-session synchronizer token: an HMAC of a fixed label keyed by the
 * session's 32 random bytes. It is unique to the session, unforgeable without
 * the HttpOnly cookie, and only its sha256 is stored.
 */
export const csrfTokenFor = (cookieValue: string): string =>
  createHmac("sha256", Buffer.from(cookieValue, "base64url")).update("gcd-studio:csrf-token:v1").digest("base64url");
export const csrfTokenHash = (token: string): string => sha256Hex(token);

/** A presented CSRF token against the session's stored hash, compared in constant time. */
export function csrfMatches(presented: unknown, storedHash: string): boolean {
  if (typeof presented !== "string" || presented.length === 0 || presented.length > 128) return false;
  if (!/^[0-9a-f]{64}$/.test(storedHash)) return false;
  return timingSafeEqual(Buffer.from(csrfTokenHash(presented), "hex"), Buffer.from(storedHash, "hex"));
}

/** The request's `Origin` must be exactly the Studio's origin; missing or "null" is refused. */
export function originAllowed(origin: string | string[] | undefined, publicOrigin: string): boolean {
  return typeof origin === "string" && origin !== "null" && origin === publicOrigin;
}

export type Role = "owner" | "runner" | "viewer";
export interface StudioUserRow {
  id: string;
  email: string;
  google_sub: string | null;
  display_name: string | null;
  role: Role;
  status: "active" | "disabled";
}
export interface SessionRow {
  id_hash: string;
  csrf_token_hash: string;
  created_at: Date;
  last_seen_at: Date;
  idle_expires_at: Date;
  absolute_expires_at: Date;
  revoked_at: Date | null;
  /** The live users row, read in the same statement. */
  user: StudioUserRow;
}

/** A new session's times: 12 hours idle, 7 days absolute (design §7.3), within the schema's constraints. */
export function newSessionTimes(now: number): { createdAt: Date; idleExpiresAt: Date; absoluteExpiresAt: Date } {
  return {
    createdAt: new Date(now),
    idleExpiresAt: new Date(now + SESSION_IDLE_MS),
    absoluteExpiresAt: new Date(now + SESSION_ABSOLUTE_MS),
  };
}

export type SessionDecision =
  | { ok: true; user: StudioUserRow; csrfHash: string; touch: { lastSeenAt: Date; idleExpiresAt: Date } | null }
  | { ok: false; reason: "unknown" | "revoked" | "expired-absolute" | "expired-idle" | "user-disabled" };

/**
 * A stored session, decided: refused when there is none, it was revoked, it is
 * past its absolute or idle expiry, or its user is not active. A live one is
 * extended to 12 hours idle (never past its absolute expiry) at most once a minute.
 */
export function decideSession(row: SessionRow | null, now: number): SessionDecision {
  if (!row) return { ok: false, reason: "unknown" };
  if (row.revoked_at !== null) return { ok: false, reason: "revoked" };
  if (row.absolute_expires_at.getTime() <= now) return { ok: false, reason: "expired-absolute" };
  if (row.idle_expires_at.getTime() <= now) return { ok: false, reason: "expired-idle" };
  if (row.user.status !== "active") return { ok: false, reason: "user-disabled" };
  const touch = now - row.last_seen_at.getTime() >= SESSION_TOUCH_MS
    ? { lastSeenAt: new Date(now), idleExpiresAt: new Date(Math.min(now + SESSION_IDLE_MS, row.absolute_expires_at.getTime())) }
    : null;
  return { ok: true, user: row.user, csrfHash: row.csrf_token_hash, touch };
}

// --- Roles ---------------------------------------------------------------------

/** Every route declares one of these; anything else is denied. */
export type MinRole = "public" | "viewer" | "runner" | "owner";
export const ROLE_RANK: Readonly<Record<string, number>> = Object.freeze({ viewer: 1, runner: 2, owner: 3 });

/**
 * Whether a user (or nobody) may use a route declaring `minRole`, checked
 * against the live users row. Default deny: an undeclared or unknown role, or
 * a user whose role is unknown, is refused.
 */
export function roleAllows(minRole: unknown, user: StudioUserRow | null): boolean {
  if (minRole === "public") return true;
  if (!user || user.status !== "active") return false;
  const need = typeof minRole === "string" && Object.hasOwn(ROLE_RANK, minRole) ? ROLE_RANK[minRole] : undefined;
  const have = Object.hasOwn(ROLE_RANK, user.role) ? ROLE_RANK[user.role] : undefined;
  if (need === undefined || have === undefined) return false;
  return have >= need;
}

// --- Sign-in -------------------------------------------------------------------

export type SignInPlan =
  | { kind: "existing"; user: StudioUserRow; setSub: boolean }
  | { kind: "bootstrap" }
  | { kind: "refuse"; reason: "user-disabled" | "subject-mismatch" | "not-listed" | "bootstrap-unset" };

/**
 * After every token check has passed (design §7.1, §7.2): an ACTIVE users row
 * for the email is required, and its `google_sub` is set at first sign-in and
 * must match after that. With no row, the one exception is the bootstrap:
 * while no active owner exists, the email equal to the (lower-cased)
 * `STUDIO_BOOTSTRAP_OWNER_EMAIL` becomes the owner. The variable is ignored
 * once an owner exists, and an unset one refuses the bootstrap.
 */
export function planSignIn(input: {
  identity: { email: string; sub: string };
  user: StudioUserRow | null;
  activeOwnerExists: boolean;
  bootstrapOwnerEmail: string | null;
}): SignInPlan {
  const { identity, user } = input;
  if (user) {
    if (user.status !== "active") return { kind: "refuse", reason: "user-disabled" };
    if (user.google_sub === null) return { kind: "existing", user, setSub: true };
    if (user.google_sub !== identity.sub) return { kind: "refuse", reason: "subject-mismatch" };
    return { kind: "existing", user, setSub: false };
  }
  if (input.activeOwnerExists) return { kind: "refuse", reason: "not-listed" };
  if (input.bootstrapOwnerEmail === null) return { kind: "refuse", reason: "bootstrap-unset" };
  if (identity.email !== input.bootstrapOwnerEmail) return { kind: "refuse", reason: "not-listed" };
  return { kind: "bootstrap" };
}
