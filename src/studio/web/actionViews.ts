/**
 * The action screens' HTML (docs/CONTENT_STUDIO_DESIGN.md §6.1, §6.4, §8.3,
 * §8.4). Content Studio S6.2.
 *
 * - **Everything stored is escaped on output** (`escapeHtml`): the goal, the
 *   revise plan's finding text, every quote line, a refusal's message and every
 *   name. Nothing is inserted as raw HTML, and no stored value is placed in a
 *   URL: links and form actions carry only validated UUIDs.
 * - **No inline script or style**, as in S5: the one static script only counts
 *   the scope's upper bound as tags are ticked.
 * - **Every form is a POST** carrying the session's synchronizer token; the
 *   route checks the Origin, the token, the role and the live users row.
 * - **The web shows prices, never computes them**: a quote's lines and ceiling
 *   are the worker's (§6.1). What remains of a cap is the effective cap less
 *   the ledger's spend.
 */

import {
  ACTION_LABELS, effectiveCaps, GOAL_MAX_CHARS, PACK_RECORD_CAP, PLATFORMS, type DeploymentCeilings, type PaidAction,
} from "./actions.js";
import { escapeHtml } from "./html.js";
import { PLATFORM_LABELS } from "./runs.js";
import type { ActionContext, PreflightView, SpendView } from "./store.js";
import { escapeAttribute } from "./views.js";

/** Seconds between polls of a preflight not yet answered (a free check takes seconds). */
export const PREFLIGHT_POLL_SECONDS = 5;
/** The label every fake run carries (§6.3). */
export const FAKE_LABEL = "FAKE — wiring test";
/** What the quote page says the numbers are, and are not. */
export const QUOTE_NOTE = "These figures are the worker's, from the CLI's own cost-ceiling computation: rough, not "
  + "billing-accurate. The web does not compute prices. Confirming reserves the whole ceiling against the caps; the unused part "
  + "is released when the run ends.";
/**
 * Whether a confirmed live run is sent depends on the worker (Content Studio S6b): only a worker holding the
 * provider key runs it. The web cannot see the worker's key, so the page states both cases.
 */
export const S6B_NOTE = "A confirmed live run is sent only by a worker that holds the Anthropic key; a worker without "
  + "it refuses every confirmed live run (live_runs_not_enabled) before any request and releases its reservation: "
  + "nothing is spent.";

/** Micro-dollars as dollars and cents for a person (the stored amounts keep their six decimals). */
export const dollars = (micros: number): string => {
  const cents = Math.round(micros / 10_000);
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
};
const csrfField = (token: string) => `<input type="hidden" name="csrf" value="${escapeAttribute(token)}">`;
const isoNy = (value: Date | number): string => new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  hour12: false, timeZoneName: "short",
}).format(value);
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const str = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value.slice(0, 500) : []);

// --- The worker's status ---------------------------------------------------------------------

export function workerStatus(online: boolean): string {
  return online ? "<p class=\"note\">The worker is online.</p>"
    : "<p class=\"banner banner-warn\">The worker is offline: no heartbeat in the last two minutes. A price can be asked "
      + "for, but it is answered only once the worker is back, and no quote can be confirmed until then.</p>";
}

// --- §8.3 New run ---------------------------------------------------------------------------

export interface NewRunInput {
  csrfToken: string;
  isOwner: boolean;
  activeFactVersion: ActionContext["activeFactVersion"];
  /** The tags offered: the approved facts' and the active fact version's counts, merged. */
  tags: Array<{ tag: string; count: number }>;
  workerOnline: boolean;
  /** A refusal of the last submission (its message), shown above the form. */
  error?: string | null;
}

export function newRunBody(input: NewRunInput): string {
  const version = input.activeFactVersion;
  const error = input.error ? `<p class="banner banner-bad prose">${escapeHtml(input.error)}</p>` : "";
  const versionLine = version
    ? `<p class="note">Fact version: <code>${escapeHtml(version.sha256.slice(0, 12))}…</code>, ${version.recordCount} records.</p>`
    : "<p class=\"banner banner-warn\">No fact version is active, so no price can be offered. The owner uploads the automotive "
      + "facts file and marks a version active (fact upload arrives with Content Studio S7).</p>";
  const platforms = PLATFORMS.map((p) => `<label class="check"><input type="checkbox" name="platform" value="${escapeAttribute(p)}" checked>`
    + ` ${escapeHtml(PLATFORM_LABELS[p] ?? p)}</label>`).join("");
  const tags = input.tags.length
    ? input.tags.map((t) => `<label class="check"><input type="checkbox" name="tag" value="${escapeAttribute(t.tag)}" data-count="${t.count}">`
      + ` <span class="prose">${escapeHtml(t.tag)}</span> <span class="meta">(${t.count} record${t.count === 1 ? "" : "s"})</span></label>`).join("")
    : "<p class=\"note\">No tag counts yet: the worker publishes them with its heartbeat.</p>";
  const priceButton = version
    ? "<button type=\"submit\" class=\"primary\">Check and get a price</button>"
    : "<button type=\"submit\" disabled>Check and get a price</button>";
  const fakeButton = input.isOwner
    ? `<button type="submit" formaction="/new/fake" class="fake">Start ${escapeHtml(FAKE_LABEL)} (no quote, no cost)</button>` : "";
  return `<h1>New run</h1>${workerStatus(input.workerOnline)}${versionLine}${error}`
    + `<form class="action-form" method="post" action="/new/price">${csrfField(input.csrfToken)}`
    + `<label class="field" for="goal">Goal <span class="meta">(1 to ${GOAL_MAX_CHARS.toLocaleString("en-US")} characters)</span></label>`
    + `<textarea id="goal" name="goal" rows="4" maxlength="${GOAL_MAX_CHARS}" required></textarea>`
    + `<fieldset><legend>Platforms</legend>${platforms}</fieldset>`
    + `<fieldset><legend>Scope tags <span class="meta">(none chosen: an unscoped run)</span></legend>${tags}`
    + "<p class=\"note\" data-scope-bound>Choose tags to see an upper bound of the records they put in the pack.</p>"
    + `<p class="note">The count shown is an upper bound: tags overlap, so a record carrying two chosen tags is counted twice. `
    + `The contact and identity records every run needs are added to it. The worker's free check enforces the pack's `
    + `${PACK_RECORD_CAP}-record cap exactly, before any price.</p></fieldset>`
    + `<div class="buttons">${priceButton}${fakeButton}</div></form>`
    + "<p class=\"note\">Checking is free: the worker runs every check the CLI makes for a run, and makes no request.</p>";
}

// --- §6.1 The price request and its quote ---------------------------------------------------------

export interface CapsLeft {
  ceilings: DeploymentCeilings;
  spend: Pick<SpendView, "dayMicros" | "monthMicros" | "settings">;
  userDayMicros: number;
  userDailyCapMicros: number | null;
  /** S7.3: the asking user's role — a runner with no daily cap cannot confirm (a missing cap is zero). */
  userRole?: string | null;
}

/** What remains of each effective cap: the cap less the ledger's spend (never a price). */
export function capsLeftList(left: CapsLeft): string {
  const caps = effectiveCaps(left.spend.settings, left.ceilings, left.userDailyCapMicros);
  const item = (label: string, cap: number, spent: number) =>
    `<dt>${label}</dt><dd>${dollars(Math.max(0, cap - spent))} of ${dollars(cap)}</dd>`;
  return "<dl class=\"facts\">" + item("Left today", caps.dailyMicros, left.spend.dayMicros)
    + item("Left this month", caps.monthlyMicros, left.spend.monthMicros)
    + (caps.userDailyMicros === null ? "" : item("Left of your own daily cap", caps.userDailyMicros, left.userDayMicros))
    + (caps.userDailyMicros === null && left.userRole === "runner"
      ? "<dt>Your own daily cap</dt><dd>none — a runner without one cannot confirm (a missing cap is zero); the owner sets it</dd>" : "")
    + "</dl>";
}

/** A quote's breakdown, as the worker stored it: one row per item, the critic panel's four lenses one item. */
export function breakdownTable(breakdown: unknown): string {
  const items = list(breakdown).map(record).filter((x): x is Record<string, unknown> => x !== null);
  const rows = items.map((item) => {
    const lines = list(item.lines).map(record).filter((x): x is Record<string, unknown> => x !== null);
    const panel = item.unit === "critic-panel";
    const label = panel ? `${escapeHtml(str(item.item))} panel — ${lines.length} lenses, run together, one item` : escapeHtml(str(item.item));
    const models = [...new Set(lines.map((l) => str(l.model)))].map(escapeHtml).join(", ");
    const tokens = lines.map((l) => str(l.maxTokens)).map(escapeHtml).join(" + ");
    const detail = panel ? `<ul class="lines">${lines.map((l) => `<li>${escapeHtml(str(l.label))} · ${escapeHtml(str(l.model))} · `
      + `${escapeHtml(str(l.maxTokens))} max output tokens</li>`).join("")}</ul>` : "";
    return `<tr><td>${label}${detail}</td><td>${models}</td><td>${tokens}</td><td>$${escapeHtml(str(item.ceilingUsd))}</td></tr>`;
  }).join("");
  return "<div class=\"table\"><table><thead><tr><th>Item</th><th>Model</th><th>Max output tokens</th><th>Ceiling</th></tr></thead>"
    + `<tbody>${rows}</tbody></table></div>`;
}

/** planRevision's plan (§8.4), as stored: untrusted JSON, read field by field and escaped. */
export function revisePlanSection(plan: unknown): string {
  const p = record(plan);
  if (!p) return "";
  const finding = (f: Record<string, unknown>) => `<li><span class="meta">${escapeHtml(str(f.id))} · ${escapeHtml(str(f.lens))} · `
    + `${escapeHtml(str(f.severity))}${f.category ? ` · ${escapeHtml(str(f.category))}` : ""}</span>`
    + (f.issue ? `<p class="prose">${escapeHtml(str(f.issue))}</p>` : "")
    + (f.suggestedAction ? `<p class="prose meta">${escapeHtml(str(f.suggestedAction))}</p>` : "") + "</li>";
  const stages = list(p.stages).map(record).filter((x): x is Record<string, unknown> => x !== null);
  const owners = list(p.ownerItems).map(record).filter((x): x is Record<string, unknown> => x !== null);
  const notRerun = list(p.notRerun).map(record).filter((x): x is Record<string, unknown> => x !== null);
  return "<section class=\"plan\"><h2>Revision plan</h2>"
    + (p.kind === "no_revision"
      ? "<p>No blocking finding has a revisable owner, so there is nothing to revise and no quote.</p>"
      : `<p>The round starts at <strong>${escapeHtml(str(p.startStage))}</strong> and re-runs: `
        + `${stages.map((s) => escapeHtml(str(s.stage))).join(", ")}, then the critic panel.</p>`)
    + stages.map((s) => `<h3>${escapeHtml(str(s.stage))}</h3><p class="meta">sends ${list(s.sent).length} of ${escapeHtml(str(s.owned))} `
      + `owned finding(s), ${escapeHtml(str(s.blocking))} blocking; cap ${escapeHtml(str(s.cap))}</p>`
      + `<ul>${list(s.sent).map(record).filter((x): x is Record<string, unknown> => x !== null).map(finding).join("")}</ul>`
      + (list(s.dropped).length ? `<p class="meta">Dropped (advisory, over the cap):</p><ul>`
        + list(s.dropped).map(record).filter((x): x is Record<string, unknown> => x !== null).map(finding).join("") + "</ul>" : "")).join("")
    + (notRerun.length ? `<h3>Not re-run (owned by an earlier stage)</h3><ul>${notRerun.map(finding).join("")}</ul>` : "")
    + (owners.length ? `<h3>Held back for a person — never sent to a model</h3><ul>${owners.map(finding).join("")}</ul>` : "")
    + "</section>";
}

export interface PreflightPageInput {
  view: PreflightView;
  csrfToken: string;
  /** Whether the viewer is the request's user (only they may confirm its quote). */
  mine: boolean;
  nowMs: number;
  workerOnline: boolean;
  capsLeft: CapsLeft;
  /** The source run's goal, for a revise, replay or resume. */
  sourceGoal: string | null;
}

export function preflightBody(input: PreflightPageInput): string {
  const v = input.view;
  const action = (Object.hasOwn(ACTION_LABELS, v.action) ? ACTION_LABELS[v.action as PaidAction] : v.action);
  const goal = v.goal ?? input.sourceGoal;
  const head = `<h1>Price: ${escapeHtml(action)}</h1>`
    + `<p class="goal prose">${escapeHtml(goal ?? "(no goal)")}</p>`
    + "<dl class=\"facts\">"
    + `<dt>Platforms</dt><dd>${v.platforms.map((p) => escapeHtml(PLATFORM_LABELS[p] ?? p)).join(", ")}</dd>`
    + `<dt>Scope tags</dt><dd>${v.scopeTags?.length ? v.scopeTags.map(escapeHtml).join(", ") : "none (unscoped)"}</dd>`
    + (v.sourceRunId ? `<dt>Source run</dt><dd><a href="/runs/${encodeURIComponent(v.sourceRunId)}"><code>${escapeHtml(v.sourceRunId)}</code></a></dd>` : "")
    + `<dt>Asked</dt><dd>${isoNy(v.createdAt)}</dd></dl>`;
  if (v.outcome === null) {
    const waiting = v.jobState === "queued" || v.jobState === "running";
    return head + (waiting
      ? "<p class=\"banner\">Checking. The worker's free preflight runs every check the CLI makes for this action, and makes no "
        + "request. This page refreshes itself.</p>" + workerStatus(input.workerOnline)
      : `<p class="banner banner-warn">This check was not answered (its job is ${escapeHtml(v.jobState)}). Ask for a new price.</p>`);
  }
  if (v.outcome === "refused") {
    return head + `<section class="refusal"><h2>Refused before any cost</h2><p><code>${escapeHtml(v.refusalClass ?? "")}</code></p>`
      + `<p class="prose">${escapeHtml(v.refusalMessage ?? "")}</p></section>` + revisePlanSection(v.revisePlan);
  }
  const q = v.quote!;
  const expired = input.nowMs > q.expiresAt.getTime();
  const state = q.consumedAt !== null
    ? `<p class="banner">This quote was confirmed${q.runId ? `: <a href="/runs/${encodeURIComponent(q.runId)}">see its run</a>` : ""}.</p>`
    : expired ? "<p class=\"banner banner-warn\">This quote has expired. Ask for a new price.</p>"
      : !input.mine ? "<p class=\"note\">Only the user who asked for this price can confirm it.</p>"
        : `<form class="confirm" method="post" action="/quotes/${encodeURIComponent(q.id)}/confirm">${csrfField(input.csrfToken)}`
          + `<button type="submit" class="primary">Confirm and reserve ${dollars(q.ceilingMicros)}</button></form>`;
  return head + revisePlanSection(v.revisePlan)
    + "<section class=\"quote\"><h2>Quote</h2>" + breakdownTable(q.breakdown)
    + `<p class="total">Total ceiling: <strong>${dollars(q.ceilingMicros)}</strong> <span class="meta">($${escapeHtml(q.ceilingUsd)})</span></p>`
    + `<p>Expires ${isoNy(q.expiresAt)}.</p>`
    + capsLeftList(input.capsLeft)
    + `<p class="note">${escapeHtml(QUOTE_NOTE)}</p><p class="note">${escapeHtml(S6B_NOTE)}</p>`
    + workerStatus(input.workerOnline) + state + "</section>";
}

/** A refused action: its class and its message, escaped, with a way back. */
export function refusalBody(title: string, refusal: { refusal: string; message: string }, back: string): string {
  return `<h1>${escapeHtml(title)}</h1><section class="refusal"><p><code>${escapeHtml(refusal.refusal)}</code></p>`
    + `<p class="prose">${escapeHtml(refusal.message)}</p></section><p><a href="${escapeAttribute(back)}">Back</a></p>`;
}

// --- §8.2 The report's actions ------------------------------------------------------------------

export function reportActions(input: {
  runId: string; csrfToken: string; actions: readonly PaidAction[]; cancellable: boolean; fake: boolean;
}): string {
  const id = encodeURIComponent(input.runId);
  const forms = input.actions.map((a) => `<form method="post" action="/runs/${id}/price">${csrfField(input.csrfToken)}`
    + `<input type="hidden" name="action" value="${escapeAttribute(a)}"><button type="submit">${escapeHtml(ACTION_LABELS[a])}</button></form>`);
  const cancel = input.cancellable ? `<form method="post" action="/runs/${id}/cancel">${csrfField(input.csrfToken)}`
    + "<button type=\"submit\" class=\"danger\">Cancel</button></form>" : "";
  const fake = input.fake ? `<p class="banner banner-fake">${escapeHtml(FAKE_LABEL)}: no provider request, no quote, no cost.</p>` : "";
  if (!forms.length && !cancel) return fake;
  return `${fake}<section class="actions"><h2>Actions</h2><div class="buttons">${forms.join("")}${cancel}</div>`
    + (forms.length ? "<p class=\"note\">Each asks the worker's free preflight for a price first; nothing is spent until a quote is confirmed. "
      + "The source run is never modified.</p>" : "") + "</section>";
}

// --- §6.4 The spend panel -------------------------------------------------------------------------

export function spendBody(input: { view: SpendView; ceilings: DeploymentCeilings; csrfToken: string; isOwner: boolean }): string {
  const v = input.view;
  const caps = effectiveCaps(v.settings, input.ceilings, null);
  const row = (label: string, spent: number, cap: number, owner: number | undefined, ceiling: number) =>
    `<tr><td>${label}</td><td>${dollars(spent)}</td><td>${dollars(cap)}</td><td>${owner === undefined ? "—" : dollars(owner)}</td>`
    + `<td>${dollars(ceiling)}</td></tr>`;
  const totals = "<div class=\"table\"><table><thead><tr><th></th><th>Spent</th><th>Effective cap</th><th>Owner's cap</th>"
    + "<th>Deployment ceiling</th></tr></thead><tbody>"
    + row(`Today (${escapeHtml(v.day)})`, v.dayMicros, caps.dailyMicros, v.settings?.dailyCapMicros, input.ceilings.dailyMicros)
    + row(`This month (from ${escapeHtml(v.month)})`, v.monthMicros, caps.monthlyMicros, v.settings?.monthlyCapMicros, input.ceilings.monthlyMicros)
    + "</tbody></table></div>";
  const users = "<div class=\"table\"><table><thead><tr><th>User</th><th>Role</th><th>Today</th><th>This month</th><th>Own daily cap</th>"
    + "</tr></thead><tbody>" + v.users.map((u) => `<tr><td>${escapeHtml(u.name ?? "(no display name)")}</td>`
      + `<td>${escapeHtml(u.role)}${u.status === "active" ? "" : ` (${escapeHtml(u.status)})`}</td><td>${dollars(u.dayMicros)}</td>`
      + `<td>${dollars(u.monthMicros)}</td><td>${u.dailyCapMicros === null ? (u.role === "runner" ? "none — cannot confirm" : "—")
        : dollars(Math.min(u.dailyCapMicros, input.ceilings.dailyMicros))}</td></tr>`).join("")
    + "</tbody></table></div>";
  const overruns = v.overruns.length
    ? "<ul class=\"overruns\">" + v.overruns.map((o) => `<li><a href="/runs/${encodeURIComponent(o.runId)}"><code>${escapeHtml(o.runId)}</code></a> `
      + `<span class="meta">${escapeHtml(o.day)}</span> overran by <strong>${dollars(o.amountMicros)}</strong> — `
      + (o.acknowledged ? "acknowledged"
        : `<strong>not acknowledged: every confirmation is locked</strong>${input.isOwner
          ? `<form method="post" action="/spend/overruns/${encodeURIComponent(o.runId)}/acknowledge">${csrfField(input.csrfToken)}`
            + "<button type=\"submit\">Acknowledge</button></form>" : ""}`) + "</li>").join("") + "</ul>"
    : "<p>No overrun.</p>";
  return "<h1>Spend</h1>" + totals + "<h2>Per user</h2>" + users + "<h2>Overruns</h2>" + overruns
    + "<p class=\"note\">Spend is Σreserve − Σrelease + Σoverrun, booked to each run's reserve day in America/New_York. Costs are "
    + "the repository's own estimates from the provider's token counts, not invoice figures. The effective cap is the lower of the "
    + "owner's cap and the deployment ceiling.</p>";
}
