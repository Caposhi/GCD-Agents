/**
 * The fact-version and import screens' HTML (docs/CONTENT_STUDIO_DESIGN.md
 * §8.5, §8.6, §9.1, §9.5). Content Studio S7.2.
 *
 * - **Everything stored or uploaded is escaped on output** (`escapeHtml`):
 *   field names, refusal messages, tags, display names and file names.
 *   Nothing is inserted as raw HTML, and no stored value is placed in a URL:
 *   links and form actions carry only validated UUIDs.
 * - **No inline script or style.** The upload and import pages are plain
 *   forms the one static script (`static.ts`) completes client-side: it reads
 *   the chosen file or folder, base64-encodes each file beside its sha256,
 *   puts ONE JSON document in the form's `document` field and submits the
 *   form (a POST with the session's synchronizer token, as every form is). The
 *   file inputs carry no name, so no file is sent any other way.
 * - **Versions are listed to every signed-in user** — sha256 (short, full on
 *   tap), date, uploader, record count, tag counts, status and which is
 *   active; their bytes and every action are the owner's alone (§9.5). The
 *   list never offers retiring the active version (the schema refuses it too).
 */

import { escapeHtml } from "./html.js";
import type { FactCheckView, FactVersionListRow } from "./store.js";
import { escapeAttribute, fingerprint } from "./views.js";
import { PACK_RECORD_CAP } from "./actions.js";

/** Seconds between polls of a fact check not yet answered. */
export const FACT_CHECK_POLL_SECONDS = 5;

const csrfField = (token: string) => `<input type="hidden" name="csrf" value="${escapeAttribute(token)}">`;
const isoNy = (value: Date | null): string => (value === null ? "—" : new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  hour12: false, timeZoneName: "short",
}).format(value));

/** Tag counts as a short list: each tag escaped, with its count. */
export function tagCountsList(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (!entries.length) return "<span class=\"meta\">no tags</span>";
  return `<ul class="tag-counts">${entries.map(([tag, n]) => `<li><span class="prose">${escapeHtml(tag)}</span> `
    + `<span class="meta">${Number.isSafeInteger(n) ? n : 0}</span></li>`).join("")}</ul>`;
}

// --- §8.5 The versions list ----------------------------------------------------------------------

export function versionsBody(input: { versions: readonly FactVersionListRow[]; isOwner: boolean; csrfToken: string }): string {
  const owner = input.isOwner;
  const action = (id: string, verb: "activate" | "retire" | "restore", label: string, cls = "") =>
    `<form method="post" action="/facts/versions/${encodeURIComponent(id)}/${verb}">${csrfField(input.csrfToken)}`
    + `<button type="submit"${cls ? ` class="${cls}"` : ""}>${label}</button></form>`;
  const rows = input.versions.map((v) => {
    const buttons = owner
      ? [
        `<a href="/facts/versions/${encodeURIComponent(v.id)}/file">Download</a>`,
        v.status === "active" && !v.isActive ? action(v.id, "activate", "Make active", "primary") : "",
        // Never offered for the active version: the schema refuses it anyway.
        v.status === "active" && !v.isActive ? action(v.id, "retire", "Retire", "danger") : "",
        v.status === "retired" ? action(v.id, "restore", "Restore") : "",
      ].join("")
      : "";
    return `<li class="version">`
      + `<p>${fingerprint(v.sha256)} ${v.isActive ? "<span class=\"badge badge-active\">ACTIVE</span>" : ""}`
      + `<span class="state state-${escapeAttribute(v.status)}">${escapeHtml(v.status)}</span></p>`
      + `<p class="meta">Uploaded ${isoNy(v.uploadedAt)} by ${escapeHtml(v.uploaderName ?? "(no display name)")} · `
      + `${v.recordCount} records · ${v.byteLength} bytes`
      + (v.statusChangedAt ? ` · status changed ${isoNy(v.statusChangedAt)}` : "") + "</p>"
      + (v.recordCount > PACK_RECORD_CAP ? `<p class="note">Over the evidence pack's ${PACK_RECORD_CAP}-record cap: an unscoped run will be refused.</p>` : "")
      + `<details><summary>Tag counts</summary>${tagCountsList(v.tagCounts)}</details>`
      + (buttons ? `<div class="buttons">${buttons}</div>` : "")
      + "</li>";
  }).join("");
  return "<h1>Fact versions</h1>"
    + (owner ? "<p class=\"buttons\"><a href=\"/facts/upload\">Upload a facts file</a><a href=\"/imports/new\">Import a run folder</a></p>" : "")
    + "<p class=\"note\">The automotive facts file each run pins. Tag counts are this file's records only; the new-run page adds "
    + "the approved facts' own. Only the owner may download a version's bytes or change which is active.</p>"
    + (rows ? `<ol class="versions">${rows}</ol>` : "<p>No fact version yet.</p>");
}

// --- §8.5 The upload --------------------------------------------------------------------------

export function uploadBody(input: { csrfToken: string }): string {
  return "<h1>Upload a facts file</h1>"
    + "<p class=\"note\">One JSON file of at most 1 MiB. Your browser reads it and sends its exact bytes with their sha256; the "
    + "worker then checks it with the CLI's own loader and a dry-run evidence pack. Nothing is a version until that check accepts it, "
    + "and only then can it be made active.</p>"
    + `<form class="action-form" method="post" action="/facts/upload" data-upload="facts">${csrfField(input.csrfToken)}`
    + "<input type=\"hidden\" name=\"document\" value=\"\">"
    + "<label class=\"field\" for=\"facts-file\">Facts file</label>"
    + "<input id=\"facts-file\" type=\"file\" accept=\"application/json,.json\" required>"
    + "<div class=\"buttons\"><button type=\"submit\" class=\"primary\">Upload and check</button></div>"
    + "<p class=\"note\" data-upload-status role=\"status\"></p></form>"
    + "<p><a href=\"/facts\">Fact versions</a></p>";
}

// --- §8.5 The check's result -------------------------------------------------------------------

export function checkBody(input: { view: FactCheckView }): string {
  const v = input.view;
  const head = `<h1>Fact check</h1><p class="meta">File sha256 ${fingerprint(v.sha256)} · ${v.byteLength} bytes · `
    + `uploaded ${isoNy(v.createdAt)}</p>`;
  const unknown = v.unknownFields?.length
    ? "<section class=\"banner banner-warn\"><h2>Field names the loader ignores</h2><p>The loader reads only its known fields and ignores "
      + "these; they are listed so a stray export is noticed (names only, never values).</p>"
      + `<ul>${v.unknownFields.map((name) => `<li><code>${escapeHtml(name)}</code></li>`).join("")}</ul></section>`
    : "";
  if (v.outcome === null) {
    const waiting = v.jobState === "queued" || v.jobState === "running";
    return head + (waiting
      ? "<p class=\"banner\">Waiting for the worker's fact check. This page refreshes itself.</p>"
      : `<p class="banner banner-bad">This check ended without an answer (its job is ${escapeHtml(v.jobState)}). Upload the file again.</p>`)
      + "<p><a href=\"/facts\">Fact versions</a></p>";
  }
  if (v.outcome === "refused") {
    return head + "<section class=\"refusal\"><h2>Refused</h2>"
      + `<p><code>${escapeHtml(v.refusalClass ?? "refused")}</code></p><p class="prose">${escapeHtml(v.refusalMessage ?? "")}</p>`
      + "<p>Nothing became a version, and the staged bytes were deleted.</p></section>" + unknown
      + "<p><a href=\"/facts/upload\">Upload another file</a> · <a href=\"/facts\">Fact versions</a></p>";
  }
  const version = v.version;
  return head + "<section class=\"banner\"><h2>Accepted</h2>"
    + (v.existing ? "<p>These bytes were already a fact version; nothing new was stored.</p>" : "<p>A new fact version was stored, "
      + "byte for byte. It is not active until you make it so.</p>")
    + (version ? `<p>${version.recordCount} records · status ${escapeHtml(version.status)}</p>${tagCountsList(version.tagCounts)}`
      : "<p class=\"note\">Its version has since been deleted.</p>")
    + "</section>"
    + (v.overCap ? `<p class="banner banner-warn">With the approved facts this file is over the evidence pack's ${PACK_RECORD_CAP}-record `
      + "cap: an unscoped run will be refused; a scoped run that fits is not.</p>" : "")
    + unknown + "<p><a href=\"/facts\">Fact versions</a></p>";
}

// --- §8.6 The import ------------------------------------------------------------------------------

export function importBody(input: { csrfToken: string; knownNames: readonly string[] }): string {
  return "<h1>Import a run folder</h1>"
    + "<p class=\"note\">Choose one run folder from <code>local-output/content-intelligence/</code>. Your browser reads only the "
    + "CLI's known files from it and sends their exact bytes, each with its sha256, as one document of at most 10 MiB. The worker "
    + "then revalidates the run against the approved facts at its commit and the fact version the folder names: upload that facts "
    + "file first. A run that does not revalidate is kept as an archive and can never be the source of a paid action.</p>"
    + `<form class="action-form" method="post" action="/imports" data-upload="import" `
    + `data-known-names="${escapeAttribute(input.knownNames.join(" "))}">${csrfField(input.csrfToken)}`
    + "<input type=\"hidden\" name=\"document\" value=\"\">"
    + "<label class=\"field\" for=\"run-folder\">Run folder</label>"
    + "<input id=\"run-folder\" type=\"file\" webkitdirectory multiple required>"
    + "<div class=\"buttons\"><button type=\"submit\" class=\"primary\">Import</button></div>"
    + "<p class=\"note\" data-upload-status role=\"status\"></p></form>"
    + `<details><summary>The known files</summary><ul class="files">${input.knownNames.map((n) => `<li><code>${escapeHtml(n)}</code></li>`).join("")}</ul></details>`
    + "<p><a href=\"/runs\">Runs</a></p>";
}

// --- §8.6 An import's own section on its report ---------------------------------------------------

/**
 * The tier, its reason when archived, and the files the run's metadata
 * recorded, by base name only (an imported `run-meta.json` may hold an
 * absolute path from the owner's computer; its bytes are kept, never shown).
 */
export function importSection(input: { tier: string | null; state: string; failureClass: string | null; failureMessage: string | null;
  recordedFiles: ReadonlyArray<[string, string]> }): string {
  const files = input.recordedFiles.length
    ? `<dl class="facts">${input.recordedFiles.map(([label, base]) => `<dt>${escapeHtml(label)}</dt><dd><code>${escapeHtml(base)}</code></dd>`).join("")}</dl>`
    : "";
  if (input.tier === "verified") {
    return "<section class=\"import\"><h2>Imported run</h2><p class=\"banner\">Revalidated: the approved facts at the worker's commit, "
      + "the pinned fact version, every saved output and the critic panel all verified. It may be the source of a paid action.</p>"
      + files + "</section>";
  }
  if (input.tier === "archived_unverified") {
    return "<section class=\"import\"><h2>Imported run</h2><div class=\"banner banner-bad\"><p><strong>Not revalidated.</strong> Kept as "
      + "an archive: it can never be the source of a paid action, and its Copy buttons are disabled.</p>"
      + `<p><code>${escapeHtml(input.failureClass ?? "not_revalidated")}</code></p>`
      + `<p class="prose">${escapeHtml(input.failureMessage ?? "")}</p></div>${files}</section>`;
  }
  return "<section class=\"import\"><h2>Imported run</h2><p class=\"banner\">Waiting for the worker to revalidate this import.</p>"
    + `${files}</section>`;
}
