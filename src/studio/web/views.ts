/**
 * The read-only screens' HTML (docs/CONTENT_STUDIO_DESIGN.md §8, §8.1, §8.2,
 * §9.1). Content Studio S5.
 *
 * - **Everything stored is escaped on output** (`escapeHtml`): goals, model
 *   prose, failure messages, display names and artifact names. Nothing is
 *   inserted as raw HTML, no attribute is left unquoted, and no stored value is
 *   ever placed in a URL: links carry only validated UUIDs, enum values and
 *   artifact names (`encodeURIComponent`, after the schema's own name shape).
 * - **No inline script and no inline style.** The page links `/static/studio.css`
 *   and `/static/studio.js`, both served from code; S4's CSP is unchanged.
 * - **Nothing here changes state.** Its only forms are S4's sign-out and, since
 *   S6.2, the report's action buttons (`actionViews.ts`), each a POST to a
 *   route that checks the Origin, the token, the role and the live users row.
 */

import { escapeHtml } from "./html.js";
import {
  groupFindings, KIND_LABELS, LENS_ORDER, needsDecision, OWNER_ORDER, PLATFORM_LABELS, POLL_SECONDS, POLLING_STATES,
  RUN_KINDS, RUN_STATES, RUNS_PAGE_SIZE, readCaptions, readScript, readShotList, stoppedAt,
  type ArtifactMeta, type CaptionCard, type Displayable, type FindingRow, type RequestRow, type RunFilters, type RunLineage,
  type RunListRow, type RunRow,
} from "./runs.js";
import { STATIC_ASSETS } from "./static.js";
import type { StudioUserRow } from "./sessions.js";

/** Characters of a goal the list shows. */
export const GOAL_PREVIEW_CHARS = 140;
/** Hex characters of a fingerprint shown before it is tapped open. */
export const FINGERPRINT_SHORT_CHARS = 12;

export const COPY_BANNER = "The contact line is copied from approved facts, not written by a model. "
  + "Nothing here is approved, scheduled or published.";
export const CANNOT_DISPLAY = "Cannot display; download the file.";
export const REQUIREMENT_UNVERIFIED = "to be confirmed by a person";

/** An attribute value: `escapeHtml`, and a carriage return kept as a reference so the parser cannot fold it. */
export const escapeAttribute = (value: string): string => escapeHtml(value).replace(/\r/g, "&#13;");

const isoNy = (value: Date | null): string => {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hour12: false, timeZoneName: "short",
  }).format(value);
};
const usd = (value: string | null): string => (value === null ? "—" : `$${escapeHtml(value)}`);
const label = (map: Readonly<Record<string, string>>, value: string): string =>
  escapeHtml(Object.hasOwn(map, value) ? map[value]! : value);
const fakeBadge = (runner: string) => (runner === "fake" ? ' <span title="FAKE — wiring test" class="badge badge-fake">FAKE</span>' : "");
const tierBadge = (tier: string | null) =>
  (tier === "archived_unverified" ? ' <span class="badge badge-unverified">not revalidated</span>' : "");
const runLink = (id: string, text: string) => `<a href="/runs/${encodeURIComponent(id)}">${text}</a>`;

/** A sha256 or commit: short, with the full value on tap (§8.2 item 1). */
export function fingerprint(value: string | null): string {
  if (!value) return "—";
  return `<details class="fp"><summary><code>${escapeHtml(value.slice(0, FINGERPRINT_SHORT_CHARS))}…</code></summary>`
    + `<code class="fp-full">${escapeHtml(value)}</code></details>`;
}

/** The page shell shared by the S5 screens: the stylesheet and the one static script, never inline. */
export function shell(input: {
  title: string; user: StudioUserRow; csrfToken: string; body: string; poll: boolean;
  /** S6.2: a page that polls on its own interval (a preflight waiting for its answer). */
  pollSeconds?: number;
}): string {
  const poll = input.pollSeconds ?? (input.poll ? POLL_SECONDS : null);
  return "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
    + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
    + (poll !== null ? `<meta http-equiv="refresh" content="${poll}">` : "")
    + `<title>${escapeHtml(input.title)} — Content Studio</title>`
    + `<link rel="stylesheet" href="${STATIC_ASSETS.css.href}">`
    + `<script src="${STATIC_ASSETS.js.href}" defer></script>`
    + "</head><body>"
    + "<header class=\"top\"><a class=\"brand\" href=\"/\">Content Studio</a><nav><a href=\"/runs\">Runs</a>"
    + (input.user.role === "owner" || input.user.role === "runner" ? "<a href=\"/new\">New run</a>" : "")
    + "<a href=\"/spend\">Spend</a><a href=\"/facts\">Facts</a>"
    // Content Studio S7.3: the owner's screens (§8.7). Hidden from everyone else, and refused at the route anyway (403).
    + (input.user.role === "owner" ? "<a href=\"/users\">Users</a><a href=\"/settings\">Caps and settings</a><a href=\"/audit\">Audit</a>" : "")
    + "</nav>"
    + `<span class="who">${escapeHtml(input.user.display_name ?? "(no display name)")} · ${escapeHtml(input.user.role)}</span>`
    + `<form method="post" action="/auth/logout"><input type="hidden" name="csrf" value="${escapeAttribute(input.csrfToken)}">`
    + "<button type=\"submit\">Sign out</button></form></header>"
    + `<main>${input.body}</main></body></html>\n`;
}

// --- §8.1 The runs list ----------------------------------------------------------

const option = (value: string, text: string, selected: boolean) =>
  `<option value="${escapeAttribute(value)}"${selected ? " selected" : ""}>${escapeHtml(text)}</option>`;

function listQuery(filters: RunFilters, page: number): string {
  const q = new URLSearchParams();
  if (filters.state) q.set("state", filters.state);
  if (filters.kind) q.set("kind", filters.kind);
  if (filters.requester) q.set("requester", filters.requester);
  if (page > 1) q.set("page", String(page));
  const text = q.toString();
  return text ? `/runs?${escapeAttribute(text)}` : "/runs";
}

export function runsListBody(rows: readonly RunListRow[], filters: RunFilters, hasNext: boolean): string {
  const shown = rows.slice(0, RUNS_PAGE_SIZE);
  const filtersForm = "<form class=\"filters\" method=\"get\" action=\"/runs\">"
    + `<label>State <select name="state">${option("", "any", !filters.state)}`
    + RUN_STATES.map((s) => option(s, s, filters.state === s)).join("") + "</select></label>"
    + `<label>Kind <select name="kind">${option("", "any", !filters.kind)}`
    + RUN_KINDS.map((k) => option(k, KIND_LABELS[k], filters.kind === k)).join("") + "</select></label>"
    + (filters.requester ? `<input type="hidden" name="requester" value="${escapeAttribute(filters.requester)}">` : "")
    + "<button type=\"submit\">Filter</button>"
    + (filters.state || filters.kind || filters.requester ? " <a href=\"/runs\">Clear</a>" : "")
    + "</form>";
  const items = shown.map((row) => {
    const goal = row.goal ?? "";
    const preview = goal.length > GOAL_PREVIEW_CHARS ? `${goal.slice(0, GOAL_PREVIEW_CHARS)}…` : goal;
    const counts = row.blocking_findings === null ? "—"
      : `${row.blocking_findings} blocking · ${row.advisory_findings ?? 0} advisory`;
    return "<li class=\"run\">"
      + `<p class="run-goal">${runLink(row.id, escapeHtml(preview || "(no goal)"))}${fakeBadge(row.runner)}${tierBadge(row.import_tier)}</p>`
      + `<p class="run-meta">${isoNy(row.created_at)} · by `
      + `<a href="/runs?requester=${encodeURIComponent(row.requested_by)}">${escapeHtml(row.requester_name ?? "(no display name)")}</a>`
      + ` · ${label(KIND_LABELS, row.kind)}</p>`
      + `<p class="run-state"><span class="state state-${escapeAttribute(row.state)}">${escapeHtml(row.state)}</span>`
      + ` · verdict ${escapeHtml(row.verdict ?? "—")} · ${counts} · cost ${usd(row.actual_usd)}</p>`
      + "</li>";
  }).join("");
  const pager = (filters.page > 1 ? `<a href="${listQuery(filters, filters.page - 1)}">Newer</a>` : "")
    + (hasNext ? `<a href="${listQuery(filters, filters.page + 1)}">Older</a>` : "");
  return `<h1>Runs</h1>${filtersForm}`
    + (shown.length ? `<ol class="runs">${items}</ol>` : "<p>No runs match.</p>")
    + (pager ? `<nav class="pager">${pager}</nav>` : "");
}

export const listPolls = (rows: readonly RunListRow[]): boolean =>
  rows.slice(0, RUNS_PAGE_SIZE).some((row) => (POLLING_STATES as readonly string[]).includes(row.state));

// --- §8.2 The run report -----------------------------------------------------------

export interface ReportInput {
  run: RunRow;
  lineage: RunLineage;
  artifacts: readonly ArtifactMeta[];
  /** The stored bytes of the artifacts the report renders, by name (bounded by the caller). */
  content: ReadonlyMap<string, Buffer>;
  findings: readonly FindingRow[];
  requests: readonly RequestRow[];
  group: "owner" | "lens";
  /** S6.2: the report's action buttons, already rendered (`reportActions`), shown below the header. */
  actions?: string;
  /** S7.2: an import's own section (`importSection`), already rendered, shown below the header. */
  importInfo?: string;
}

/** The artifacts the report reads to render itself. */
export const REPORT_ARTIFACTS = [
  "03-hook-story-script.json", "04-production-direction.json", "05-packaging-adaptation.json", "05b-contact-lines.json",
] as const;

const absentOrCannot = (shown: Displayable<unknown>, file: string, sourceRunId: string | null): string =>
  shown.ok ? "" : shown.reason === "absent"
    ? `<p class="note">This run did not save ${escapeHtml(file)}.${sourceRunId ? ` See its ${runLink(sourceRunId, "source run")}.` : ""}</p>`
    : `<p class="note">${CANNOT_DISPLAY}</p>`;

function header(run: RunRow, lineage: RunLineage, names: readonly string[], requests: readonly RequestRow[]): string {
  const rows: Array<[string, string]> = [
    ["Kind", label(KIND_LABELS, run.kind)],
    ["State", `<span class="state state-${escapeAttribute(run.state)}">${escapeHtml(run.state)}</span>`],
    ["Verdict", escapeHtml(run.verdict ?? "—")],
    ["Platforms", run.platforms?.length ? run.platforms.map((p) => label(PLATFORM_LABELS, p)).join(", ") : "—"],
    ["Scope tags", run.scope_tags?.length ? run.scope_tags.map((t) => escapeHtml(t)).join(", ") : "none (unscoped)"],
    ["Requested", `${isoNy(run.created_at)} by ${escapeHtml(run.requester_name ?? "(no display name)")}`],
    ["Started / finished", `${isoNy(run.started_at)} / ${isoNy(run.finished_at)}`],
    ["Fact version", run.fact_version_id ? `<code>${escapeHtml(run.fact_version_id)}</code>` : "—"],
    ["Approved facts sha256", fingerprint(run.approved_facts_sha256)],
    ["Automotive facts sha256", fingerprint(run.automotive_facts_sha256)],
    ["Evidence pack sha256", fingerprint(run.evidence_pack_sha256)],
    ["Commit", fingerprint(run.code_commit)],
    ["Source run", lineage.parent
      ? (lineage.parent.deleted ? "a deleted run" : runLink(lineage.parent.id, `<code>${escapeHtml(lineage.parent.id)}</code>`)) : "—"],
    ["Runs from this one", lineage.children.length
      ? `<ul>${lineage.children.map((c) => `<li>${runLink(c.id, `${label(KIND_LABELS, c.kind)} · ${escapeHtml(c.state)}`)}</li>`).join("")}</ul>`
      : "none"],
  ];
  const failed = ["failed", "refused", "cancelled", "interrupted"].includes(run.state);
  const failure = failed
    ? "<section class=\"failure\"><h2>Why it stopped</h2><dl>"
      + `<dt>Failure class</dt><dd><code>${escapeHtml(run.failure_class ?? "—")}</code></dd>`
      + `<dt>Message</dt><dd class="prose">${escapeHtml(run.failure_message ?? "—")}</dd>`
      + `<dt>Stopped at</dt><dd>${escapeHtml(stoppedAt(run.kind, names, requests) ?? "after every stage")}</dd>`
      + "</dl></section>"
    : "";
  return `<h1 class="goal prose">${escapeHtml(run.goal ?? "(no goal)")}${fakeBadge(run.runner)}${tierBadge(run.import_tier)}</h1>`
    + `<dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>${failure}`;
}

function captionCard(card: CaptionCard, index: number, copyEnabled: boolean): string {
  const gbp = card.platform === "google_business_profile";
  const button = (text: string, value: string, kind: string) => copyEnabled
    ? `<button type="button" class="copy" data-copy-kind="${kind}" data-copy="${escapeAttribute(value)}">${text}</button>`
    : `<button type="button" class="copy" data-copy-kind="${kind}" disabled>${text}</button>`;
  return `<article class="card" id="caption-${index}"><h3>${label(PLATFORM_LABELS, card.platform)}</h3>`
    + `<p class="caption prose">${escapeHtml(card.caption)}</p>`
    + (card.contactText !== null ? `<p class="contact prose">${escapeHtml(card.contactText)}</p>` : "")
    + "<div class=\"copy-row\">"
    + (gbp ? button("Copy caption", card.copyText, "caption")
      : button("Copy", card.copyText, "full") + button("Copy caption only", card.caption, "caption"))
    + "</div>"
    + (card.cta ? `<p class="cta">Call to action: <strong>${escapeHtml(card.cta.actionType)}</strong> → `
      + `<span class="prose">${escapeHtml(card.cta.url)}</span></p>` : "")
    + (card.hashtags.length ? `<p class="tags prose">${escapeHtml(card.hashtags.join(" "))}</p>` : "")
    + (card.localKeywords.length ? `<p class="keywords">Local keywords: <span class="prose">${escapeHtml(card.localKeywords.join(", "))}</span></p>` : "")
    + "</article>";
}

function findingItem(f: FindingRow, show: "lens" | "owner"): string {
  return `<li class="finding finding-${escapeAttribute(f.severity)}"><span class="sev">${escapeHtml(f.severity)}</span> `
    + `<span class="meta">${escapeHtml(show === "lens" ? f.lens : f.owner)} · ${escapeHtml(f.category)}</span>`
    + `<p class="prose">${escapeHtml(f.issue)}</p></li>`;
}

export function reportBody(input: ReportInput): string {
  const { run, lineage, artifacts, content, findings, requests, group } = input;
  const names = artifacts.map((a) => a.name);
  const copyEnabled = run.import_tier !== "archived_unverified";
  // A deleted source is never linked (its report is a 404).
  const source = lineage.parent && !lineage.parent.deleted ? lineage.parent.id : null;

  const captions = readCaptions(content.get("05-packaging-adaptation.json"), content.get("05b-contact-lines.json"));
  const captionSection = "<section class=\"captions\"><h2>Captions</h2>"
    + `<p class="banner">${escapeHtml(COPY_BANNER)}</p>`
    + (copyEnabled ? "" : "<p class=\"note\">Copy is disabled: this import was not revalidated.</p>")
    + (captions.ok ? captions.value.map((card, i) => captionCard(card, i, copyEnabled)).join("")
      : absentOrCannot(captions, "05-packaging-adaptation.json and 05b-contact-lines.json", source))
    + "</section>";

  const script = readScript(content.get("03-hook-story-script.json"));
  const scriptSection = "<section class=\"script\"><h2>Script</h2>"
    + (script.ok
      ? `<h3>Hook</h3><p class="prose">${escapeHtml(script.value.hook)}</p><h3>Beats</h3><ol>`
        + script.value.beats.map((b) => `<li><span class="meta">${escapeHtml(b.role)}</span> <span class="prose">${escapeHtml(b.beat)}</span></li>`).join("")
        + `</ol><h3>Script</h3><p class="prose">${escapeHtml(script.value.script)}</p>`
      : absentOrCannot(script, "03-hook-story-script.json", source))
    + "</section>";

  const shots = readShotList(content.get("04-production-direction.json"));
  const shotSection = "<section class=\"shots\"><h2>Shot list</h2>"
    + (shots.ok
      ? `<p class="prose">${escapeHtml(shots.value.visualApproach)}</p><ol>`
        + shots.value.shots.map((s, i) => `<li><p><strong>${escapeHtml(s.purpose)}</strong> `
          + `<span class="meta">${escapeHtml(s.framing)} · ${escapeHtml(s.movement)}</span></p>`
          + `<p class="prose">${escapeHtml(s.subject)} — ${escapeHtml(s.action)}</p>`
          + `<p class="prose meta">${escapeHtml(s.composition)} ${escapeHtml(s.continuityNote)}</p>`
          + shots.value.overlays.filter((o) => o.shotIndex === i)
            .map((o) => `<p class="overlay">Overlay (${escapeHtml(o.role)}): <span class="prose">${escapeHtml(o.text)}</span></p>`).join("")
          + "</li>").join("")
        + "</ol><h3>Production requirements</h3><ul>"
        + shots.value.requirements.map((r) => `<li><span class="prose">${escapeHtml(r.requirement)}</span> `
          + `<span class="meta">${escapeHtml(r.category)} — ${REQUIREMENT_UNVERIFIED}</span></li>`).join("")
        + "</ul>"
      : absentOrCannot(shots, "04-production-direction.json", source))
    + "</section>";

  const groups = groupFindings(findings, group);
  const groupTitle = (key: string) => (group === "owner"
    ? (key === "human_review" ? "A person (human_review)" : `Stage owner: ${escapeHtml(key)}`)
    : `Lens: ${escapeHtml(key)}`);
  const toggle = group === "owner"
    ? `<a href="/runs/${encodeURIComponent(run.id)}?group=lens#findings">Group by lens</a>`
    : `<a href="/runs/${encodeURIComponent(run.id)}#findings">Group by stage owner</a>`;
  const findingsSection = "<section class=\"findings\" id=\"findings\"><h2>Findings</h2>"
    + `<p class="toggle">${toggle}</p>`
    + (run.blocking_findings === null && findings.length === 0
      ? "<p class=\"note\">No findings recorded for this run.</p>"
      : `<p>${run.blocking_findings ?? 0} blocking · ${run.advisory_findings ?? 0} advisory</p>`)
    + groups.map((g) => `<h3>${groupTitle(g.key)}</h3><ul>`
      + g.findings.map((f) => findingItem(f, group === "owner" ? "lens" : "owner")).join("") + "</ul>").join("")
    + "</section>";

  const decisions = needsDecision(findings);
  const decisionSection = `<section class="decisions${decisions.length ? " decisions-open" : ""}"><h2>Needs your decision</h2>`
    + (decisions.length
      ? "<p>No model is ever sent these: a person decides each one.</p><ul>"
        + decisions.map((f) => `<li class="finding finding-${escapeAttribute(f.severity)}"><span class="sev">${escapeHtml(f.severity)}</span> `
          + `<span class="meta">${escapeHtml(f.lens)} · ${escapeHtml(f.category)} · ${escapeHtml(f.owner)}</span>`
          + `<p class="prose">${escapeHtml(f.issue)}</p></li>`).join("") + "</ul>"
      : "<p>Nothing needs your decision.</p>")
    + "</section>";

  const costSection = "<section class=\"cost\"><h2>Cost</h2><dl class=\"facts\">"
    + `<dt>Reserved ceiling</dt><dd>${usd(run.reserved_usd)}</dd><dt>Actual cost</dt><dd>${usd(run.actual_usd)}</dd></dl>`
    + (requests.length
      ? "<div class=\"table\"><table><thead><tr><th>#</th><th>Stage or lens</th><th>Model</th><th>In</th><th>Out</th>"
        + "<th>Cost</th><th>Charged</th><th>Outcome</th></tr></thead><tbody>"
        + requests.map((r) => `<tr><td>${r.seq}</td><td>${escapeHtml(r.lens ? `${r.stage}: ${r.lens}` : r.stage)}</td>`
          + `<td>${escapeHtml(r.model)}</td><td>${r.input_tokens ?? "—"}</td><td>${r.output_tokens ?? "—"}</td>`
          + `<td>${usd(r.cost_usd)}</td><td>${usd(r.charged_usd)}</td><td>${escapeHtml(r.outcome)}</td></tr>`).join("")
        + "</tbody></table></div><p class=\"note\">Costs are the repository's own estimate from the provider's token counts, not invoice figures.</p>"
      : `<p class="note">${run.runner === "fake" ? "A fake run makes no provider request." : "No provider request was recorded."}</p>`)
    + "</section>";

  const filesSection = "<section class=\"files\"><h2>Files</h2>"
    + (artifacts.length
      ? `<ul>${artifacts.map((a) => `<li><a href="/runs/${encodeURIComponent(run.id)}/files/${encodeURIComponent(a.name)}">`
        + `${escapeHtml(a.name)}</a> <span class="meta">${a.byte_length} bytes</span> ${fingerprint(a.sha256)}</li>`).join("")}</ul>`
      : "<p class=\"note\">This run saved no files.</p>")
    + "<p class=\"note\">Every file downloads as an attachment, exactly as stored.</p>"
    + (artifacts.length ? `<p><a href="/runs/${encodeURIComponent(run.id)}/bundle">Download the whole run</a> <span class="meta">one JSON `
      + "bundle in the import's format: it re-imports byte for byte</span></p>" : "")
    + "</section>";

  // Design order: header, captions, script, shot list, findings, needs your decision, cost, files.
  return `<article class="report">${header(run, lineage, names, requests)}${input.importInfo ?? ""}${input.actions ?? ""}<div class="sections">`
    + captionSection + scriptSection + shotSection + findingsSection + decisionSection + costSection + filesSection
    + "</div></article>";
}

export const reportPolls = (run: RunRow): boolean => (POLLING_STATES as readonly string[]).includes(run.state);

/** The value sets the report groups by, for the suite: they must be the schema's own. */
export const GROUP_ORDERS = { owner: OWNER_ORDER, lens: LENS_ORDER } as const;
