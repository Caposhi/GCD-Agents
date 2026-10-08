/**
 * The users, caps and audit screens' decisions (docs/CONTENT_STUDIO_DESIGN.md
 * §4.1, §6.2, §7.2, §8.7, §9.5). Content Studio S7.3.
 *
 * Every decision is a pure function over data the store read or a form sent,
 * so the offline suite proves each refusal and the mutation harness proves
 * each one load-bearing. The schema keeps its own rules and is relied on, not
 * re-implemented: the address's domain and case, the one active owner that
 * must remain, a disabled user's sessions revoked with the change, and every
 * user and settings edit audited with the transaction's declared actor
 * (migration 0004).
 */

import { MICROS_PER_USD } from "../db/runner.js";
import type { Refusal } from "./actions.js";
import type { Role } from "./sessions.js";

export const ROLES: readonly Role[] = Object.freeze(["owner", "runner", "viewer"]);
/** The Studio's one domain (`studio_users_email_domain`); the bootstrap and the allowed `hd` are the same. */
export const USER_DOMAIN = ["germancardepot", "com"].join(".");
/** The longest address the form accepts (RFC 5321's path limit). */
export const EMAIL_MAX_CHARS = 254;
/** Audit rows per page, newest first. */
export const AUDIT_PAGE_SIZE = 50;
/** `studio_audit_log_action_shape`: what an action filter may be. */
export const AUDIT_ACTION_SHAPE = /^[a-z][a-z0-9_.:-]{0,63}$/;
/** The audit view's furthest page (a bound on the offset, not on the log). */
export const AUDIT_MAX_PAGE = 10_000;

type Parsed<T> = { ok: true; value: T } | ({ ok: false } & Refusal);
const no = (refusal: string, message: string): { ok: false } & Refusal => ({ ok: false, refusal, message });

/**
 * An address to add, as the schema stores it: trimmed and LOWER-CASED, one
 * `@`, at the Studio's domain, at most 254 characters. The schema refuses any
 * other (`studio_users_email_lowercase`, `studio_users_email_domain`).
 */
export function normalizeNewUserEmail(raw: unknown): Parsed<string> {
  if (typeof raw !== "string") return no("invalid_email", "give one address");
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > EMAIL_MAX_CHARS || !/^[^@\s]+@[^@\s]+$/.test(email)) {
    return no("invalid_email", "that is not an email address");
  }
  if (!email.endsWith(`@${USER_DOMAIN}`)) return no("wrong_domain", `only an address at ${USER_DOMAIN} can be added`);
  return { ok: true, value: email };
}

export function parseRole(raw: unknown): Parsed<Role> {
  return typeof raw === "string" && (ROLES as readonly string[]).includes(raw)
    ? { ok: true, value: raw as Role } : no("invalid_role", "choose owner, runner or viewer");
}

/**
 * The exclusive upper bound of a cap the owner may type: the next power of ten
 * above the deployment ceiling's whole dollars ($75 → under $100, $300 →
 * under $1,000), and never below $10. A cap above the ceiling is allowed —
 * the effective cap is the lower of the two (`effectiveCaps`) — but not one of
 * a larger order of magnitude.
 */
export function capBoundMicros(ceilingMicros: number): number {
  const dollars = Math.max(0, Math.floor(ceilingMicros / MICROS_PER_USD));
  return 10 ** Math.max(1, String(dollars).length) * MICROS_PER_USD;
}

/**
 * A cap as typed: a non-negative amount in dollars with at most two decimals,
 * no sign, exponent, separator or leading zero, below `capBoundMicros`. Blank
 * is "no cap" only where `allowBlank` (a user's own daily cap); never for the
 * owner's daily and monthly caps, which the schema requires.
 */
export function parseCapInput(raw: unknown, ceilingMicros: number, allowBlank: boolean): Parsed<number | null> {
  if (typeof raw !== "string") return no("invalid_cap", "give one amount");
  const text = raw.trim();
  if (text === "") return allowBlank ? { ok: true, value: null } : no("invalid_cap", "give an amount");
  const match = /^(0|[1-9][0-9]{0,8})(?:\.([0-9]{1,2}))?$/.exec(text);
  if (!match) return no("invalid_cap", "an amount in dollars, at most two decimals, such as 25 or 12.50");
  const micros = Number(match[1]) * MICROS_PER_USD + Number((match[2] ?? "").padEnd(2, "0")) * 10_000;
  const bound = capBoundMicros(ceilingMicros);
  if (!(micros < bound)) {
    return no("cap_too_large", `an amount under $${(bound / MICROS_PER_USD).toLocaleString("en-US")}, the deployment ceiling's order of magnitude`);
  }
  return { ok: true, value: micros };
}

/** One change to one user's row; never the email (owner decision 5: no email edit). */
export type UserChange = { kind: "role"; role: Role } | { kind: "status"; status: "active" | "disabled" };

/** Whether this change takes owner away from the acting owner themself: it needs an explicit confirmation. */
export function losesOwnSeat(actorId: string, targetId: string, change: UserChange): boolean {
  if (actorId !== targetId) return false;
  return change.kind === "role" ? change.role !== "owner" : change.status === "disabled";
}

/**
 * Whether a role or status change may be written, read under the active
 * owners' row locks: the user exists, it changes something, and it never
 * removes the last active owner (the schema's trigger refuses that too).
 */
export function decideUserChange(input: {
  target: { id: string; role: string; status: string } | null; change: UserChange; activeOwnerIds: readonly string[];
}): { ok: true } | ({ ok: false } & Refusal) {
  const t = input.target;
  if (!t) return no("no_user", "there is no such user");
  const c = input.change;
  if (c.kind === "role" ? t.role === c.role : t.status === c.status) return no("no_change", "the user already has that");
  const wasActiveOwner = t.role === "owner" && t.status === "active";
  const staysActiveOwner = c.kind === "role" ? c.role === "owner" && t.status === "active" : c.status === "active" && t.role === "owner";
  if (wasActiveOwner && !staysActiveOwner && !input.activeOwnerIds.some((id) => id !== t.id)) {
    return no("last_owner", "the last active owner cannot be demoted or disabled: make another user an active owner first");
  }
  return { ok: true };
}

/** The audit view's query: an optional action (the schema's shape) and a page. Anything else is refused. */
export function parseAuditFilters(query: URLSearchParams): Parsed<{ action: string | null; page: number }> {
  for (const key of query.keys()) if (key !== "action" && key !== "page") return no("invalid_filter", "unknown filter");
  const actions = query.getAll("action");
  const pages = query.getAll("page");
  if (actions.length > 1 || pages.length > 1) return no("invalid_filter", "one action and one page at most");
  const action = actions[0] ?? "";
  if (action !== "" && !AUDIT_ACTION_SHAPE.test(action)) return no("invalid_filter", "not an action name");
  const page = pages.length ? (/^[1-9][0-9]{0,4}$/.test(pages[0]!) ? Number(pages[0]) : NaN) : 1;
  if (!Number.isSafeInteger(page) || page > AUDIT_MAX_PAGE) return no("invalid_filter", "not a page number");
  return { ok: true, value: { action: action === "" ? null : action, page } };
}
