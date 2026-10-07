/**
 * The users, caps-and-settings and audit screens' HTML
 * (docs/CONTENT_STUDIO_DESIGN.md §6.2, §8.7, §9.1, §9.5). Content Studio S7.3.
 *
 * - **Owner only.** Every route is the owner's (`app.ts`); the users screen
 *   also shows addresses only to an active owner (§9.5), so a page rendered
 *   for anyone else carries none.
 * - **Everything stored is escaped on output** (`escapeHtml`): display names,
 *   addresses, an audit row's action, target and detail — the detail is the
 *   stored JSON as escaped TEXT, never markup — and any typed amount echoed
 *   back. No stored value is placed in a URL: links and form actions carry only
 *   validated UUIDs, and the audit filter's action is percent-encoded.
 * - **No inline script or style**, as in S5; every form is a POST carrying the
 *   session's synchronizer token, and the route checks the Origin, the token,
 *   the role and the live users row.
 * - **There is no email edit** (owner decision 5) and **no control for
 *   `scheduled_runs_enabled`**: the cron resource does not exist (S9).
 */

import { effectiveCaps, type DeploymentCeilings } from "./actions.js";
import { dollars } from "./actionViews.js";
import { escapeHtml } from "./html.js";
import type { StudioUserRow } from "./sessions.js";
import type { ActionContext, AuditListRow, UserListRow } from "./store.js";
import { AUDIT_PAGE_SIZE, capBoundMicros, EMAIL_MAX_CHARS, ROLES, USER_DOMAIN } from "./users.js";
import { escapeAttribute, fingerprint } from "./views.js";

/** What the settings screen says of the scheduled runs (§3.5, §8.7). */
export const SCHEDULED_RUNS_UNAVAILABLE = "Unavailable: the scheduled-run cron job does not exist (Content Studio S9), so this "
  + "setting cannot be changed here.";

const csrfField = (token: string) => `<input type="hidden" name="csrf" value="${escapeAttribute(token)}">`;
const isoNy = (value: Date | null): string => (value === null ? "—" : new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  hour12: false, timeZoneName: "short",
}).format(value));
const nameOf = (name: string | null) => escapeHtml(name ?? "(no display name)");
const usdInput = (micros: number | null) => (micros === null ? "" : (micros / 1_000_000).toFixed(2));

// --- §8.7 Users ---------------------------------------------------------------------------------

/** A user's own daily cap as shown: the stored cap and its effective value, or what having none means for their role. */
export function userCapText(user: Pick<UserListRow, "role" | "dailyCapMicros">, ceilings: DeploymentCeilings): string {
  if (user.dailyCapMicros === null) {
    return user.role === "runner" ? "none — <strong>cannot confirm a paid run</strong> until one is set (a missing cap is zero)"
      : user.role === "owner" ? "none (no per-user cap; the daily and monthly caps still apply)" : "none";
  }
  const effective = Math.min(user.dailyCapMicros, ceilings.dailyMicros);
  return `${dollars(user.dailyCapMicros)}${effective === user.dailyCapMicros ? "" : ` (effective ${dollars(effective)}, the deployment ceiling)`}`;
}

export function usersBody(input: {
  users: readonly UserListRow[]; viewer: StudioUserRow; csrfToken: string; ceilings: DeploymentCeilings;
}): string {
  // §9.5: addresses are the owner's to read. The route is owner-only; this holds for any other caller too.
  const showEmail = input.viewer.role === "owner" && input.viewer.status === "active";
  const token = input.csrfToken;
  const bound = capBoundMicros(input.ceilings.dailyMicros);
  const roleOptions = (current: string) => ROLES.map((r) => `<option value="${r}"${r === current ? " selected" : ""}>${r}</option>`).join("");
  const rows = input.users.map((u) => {
    const id = encodeURIComponent(u.id);
    const self = u.id === input.viewer.id;
    const form = (verb: string, inner: string, button: string, cls = "") =>
      `<form class="inline-form" method="post" action="/users/${id}/${verb}">${csrfField(token)}${inner}`
      + `<button type="submit"${cls ? ` class="${cls}"` : ""}>${button}</button></form>`;
    return "<li class=\"user\">"
      + `<p><strong>${nameOf(u.displayName)}</strong>${self ? " <span class=\"meta\">(you)</span>" : ""} · ${escapeHtml(u.role)}`
      + (u.status === "active" ? "" : " <span class=\"badge badge-unverified\">disabled</span>") + "</p>"
      + (showEmail ? `<p class="meta"><span class="prose">${escapeHtml(u.email)}</span></p>` : "")
      + "<dl class=\"facts\">"
      + `<dt>Google account</dt><dd>${u.googleBound ? "bound at first sign-in" : "not yet bound (has not signed in)"}</dd>`
      + `<dt>Own daily cap</dt><dd>${userCapText(u, input.ceilings)}</dd>`
      + `<dt>Last sign-in</dt><dd>${isoNy(u.lastSignInAt)}</dd>`
      + `<dt>Live sessions</dt><dd>${u.liveSessions}</dd>`
      + `<dt>Added</dt><dd>${isoNy(u.createdAt)}</dd></dl>`
      + "<div class=\"buttons\">"
      + form("role", `<label class="sr">Role <select name="role">${roleOptions(u.role)}</select></label>`, "Change role")
      + form("cap", `<label class="sr">Daily cap, dollars <input type="text" name="cap" inputmode="decimal" maxlength="12" `
        + `value="${escapeAttribute(usdInput(u.dailyCapMicros))}"></label>`, "Set cap")
      + (u.status === "active" ? form("disable", "", "Disable", "danger") : form("enable", "", "Re-enable"))
      + form("revoke-sessions", "", "Revoke sessions")
      + "</div></li>";
  }).join("");
  return "<h1>Users</h1>"
    + "<p class=\"note\">Only the owner sees this page. A user signs in with their Google account at "
    + `${escapeHtml(USER_DOMAIN)}; the address cannot be edited once added (the Google account is the bound identity). `
    + "Disabling a user signs them out at once. The last active owner cannot be demoted or disabled.</p>"
    + "<section><h2>Add a user</h2>"
    + `<form class="action-form" method="post" action="/users">${csrfField(token)}`
    + `<label class="field" for="email">Address <span class="meta">(at ${escapeHtml(USER_DOMAIN)})</span></label>`
    + `<input type="email" id="email" name="email" maxlength="${EMAIL_MAX_CHARS}" required autocomplete="off">`
    + `<label class="field" for="role">Role</label><select id="role" name="role">${roleOptions("viewer")}</select>`
    + `<label class="field" for="cap">Own daily cap, dollars <span class="meta">(optional; under `
    + `${dollars(bound)}; a runner needs one to confirm a paid run)</span></label>`
    + "<input type=\"text\" id=\"cap\" name=\"cap\" inputmode=\"decimal\" maxlength=\"12\">"
    + "<div class=\"buttons\"><button type=\"submit\" class=\"primary\">Add user</button></div></form></section>"
    + `<section><h2>Every user</h2>${rows ? `<ol class="users">${rows}</ol>` : "<p>No user.</p>"}`
    + "<p class=\"note\">A blank cap clears it. Changing a user's role or status makes their open quotes stale.</p></section>";
}

/** The explicit step before the acting owner demotes or disables themself: nothing is written until it is confirmed. */
export function confirmSelfBody(input: { userId: string; verb: "role" | "disable"; role?: string; csrfToken: string }): string {
  const what = input.verb === "role" ? `change your own role to ${escapeHtml(input.role ?? "")}` : "disable your own account";
  return `<h1>Confirm</h1><section class="refusal"><p>You are about to <strong>${what}</strong>. You will lose the owner's role `
    + "and be signed out at once; only another owner can undo it.</p></section>"
    + `<form class="confirm" method="post" action="/users/${encodeURIComponent(input.userId)}/${input.verb}">${csrfField(input.csrfToken)}`
    + (input.verb === "role" ? `<input type="hidden" name="role" value="${escapeAttribute(input.role ?? "")}">` : "")
    + "<input type=\"hidden\" name=\"confirm\" value=\"yes\">"
    + "<div class=\"buttons\"><button type=\"submit\" class=\"danger\">Yes, continue</button><a href=\"/users\">Cancel</a></div></form>";
}

// --- §8.7 Caps and settings -----------------------------------------------------------------------

export function settingsBody(input: { context: ActionContext; ceilings: DeploymentCeilings; csrfToken: string }): string {
  const settings = input.context.settings;
  // The effective cap is the LOWER of the owner's cap and the deployment ceiling (§6.2).
  const caps = effectiveCaps(settings, input.ceilings, null);
  const row = (label: string, owner: number | undefined, ceiling: number, effective: number) =>
    `<tr><td>${label}</td><td>${owner === undefined ? "—" : dollars(owner)}</td><td>${dollars(ceiling)}</td>`
    + `<td><strong>${dollars(effective)}</strong></td></tr>`;
  const version = input.context.activeFactVersion;
  return "<h1>Caps and settings</h1>"
    + "<section><h2>Caps</h2><div class=\"table\"><table><thead><tr><th></th><th>Owner's cap</th><th>Deployment ceiling</th>"
    + "<th>Effective cap</th></tr></thead><tbody>"
    + row("Daily", settings?.dailyCapMicros, input.ceilings.dailyMicros, caps.dailyMicros)
    + row("Monthly", settings?.monthlyCapMicros, input.ceilings.monthlyMicros, caps.monthlyMicros)
    + "</tbody></table></div>"
    + "<p class=\"note\">The effective cap is the lower of the owner's cap and the deployment ceiling (STUDIO_MAX_DAILY_USD, "
    + "STUDIO_MAX_MONTHLY_USD), which only a deployment changes. A cap above the ceiling is allowed but has no effect.</p>"
    + `<form class="action-form" method="post" action="/settings/caps">${csrfField(input.csrfToken)}`
    + `<label class="field" for="daily">Daily cap, dollars <span class="meta">(under ${dollars(capBoundMicros(input.ceilings.dailyMicros))})</span></label>`
    + `<input type="text" id="daily" name="daily" inputmode="decimal" maxlength="12" required value="${escapeAttribute(usdInput(settings?.dailyCapMicros ?? null))}">`
    + `<label class="field" for="monthly">Monthly cap, dollars <span class="meta">(under ${dollars(capBoundMicros(input.ceilings.monthlyMicros))})</span></label>`
    + `<input type="text" id="monthly" name="monthly" inputmode="decimal" maxlength="12" required value="${escapeAttribute(usdInput(settings?.monthlyCapMicros ?? null))}">`
    + "<div class=\"buttons\"><button type=\"submit\" class=\"primary\">Save caps</button></div></form>"
    + "<p class=\"note\">Each runner's own daily cap is set on the <a href=\"/users\">Users</a> page.</p></section>"
    + "<section><h2>Other settings</h2><dl class=\"facts\">"
    + `<dt>Active fact version</dt><dd>${version ? `${fingerprint(version.sha256)} <a href="/facts">Fact versions</a>`
      : "none — <a href=\"/facts\">Fact versions</a>"}</dd>`
    + "<dt>Audit log</dt><dd><a href=\"/audit\">Read the audit log</a></dd>"
    + `<dt>Scheduled runs</dt><dd>Off. ${escapeHtml(SCHEDULED_RUNS_UNAVAILABLE)}</dd>`
    + "</dl></section>";
}

// --- §8.7 The audit log (read-only) ---------------------------------------------------------------

export function auditBody(input: { rows: readonly AuditListRow[]; actions: readonly string[]; action: string | null; page: number;
  hasNext: boolean }): string {
  const shown = input.rows.slice(0, AUDIT_PAGE_SIZE);
  const option = (value: string, text: string, selected: boolean) =>
    `<option value="${escapeAttribute(value)}"${selected ? " selected" : ""}>${escapeHtml(text)}</option>`;
  const link = (page: number) => {
    const q = new URLSearchParams();
    if (input.action) q.set("action", input.action);
    if (page > 1) q.set("page", String(page));
    const text = q.toString();
    return text ? `/audit?${escapeAttribute(text)}` : "/audit";
  };
  const items = shown.map((r) => "<li class=\"audit\">"
    + `<p><code>${escapeHtml(r.action)}</code> <span class="meta">${isoNy(r.at)}</span></p>`
    + `<p class="meta">by ${r.actorId === null ? "no user" : nameOf(r.actorName)}`
    + (r.targetType ? ` · ${escapeHtml(r.targetType)}${r.targetId ? ` <code>${escapeHtml(r.targetId)}</code>` : ""}` : "") + "</p>"
    + `<pre class="detail"><code>${escapeHtml(r.detail)}</code></pre></li>`).join("");
  return "<h1>Audit log</h1>"
    + "<p class=\"note\">Read-only, newest first. Each row's detail is shown exactly as stored, as text.</p>"
    + "<form class=\"filters\" method=\"get\" action=\"/audit\">"
    + `<label>Action <select name="action">${option("", "any", input.action === null)}`
    + input.actions.map((a) => option(a, a, a === input.action)).join("") + "</select></label>"
    + "<button type=\"submit\">Filter</button>" + (input.action ? " <a href=\"/audit\">Clear</a>" : "") + "</form>"
    + (items ? `<ol class="audit-log">${items}</ol>` : "<p>No audit row.</p>")
    + `<p class="pager">${input.page > 1 ? `<a href="${link(input.page - 1)}">Newer</a>` : ""}`
    + `${input.hasNext ? `<a href="${link(input.page + 1)}">Older</a>` : ""}</p>`;
}
