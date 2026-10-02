/**
 * The read-only screens' data (docs/CONTENT_STUDIO_DESIGN.md §8.1, §8.2):
 * the run rows the web reads, the list's filters, and the report's view of a
 * run's stored artifacts. Content Studio S5.
 *
 * - **Every filter is validated before any query** against the schema's own
 *   value sets (`studio_runs_state`, `studio_runs_kind`) or as a UUID; an
 *   invalid one is a 400, and nothing unvalidated reaches SQL.
 * - **Stored stage JSON is untrusted data.** Each artifact is size-bounded,
 *   parsed in a `try`, and read field by field; an unexpected shape becomes
 *   "cannot display; download the file" and never throws.
 * - **The Copy text is never re-implemented here.** Instagram and Facebook copy
 *   exactly `providerTextWithContact(caption, hashtags, contact)` — the leaf
 *   module the contacted package itself is assembled with — over the stored
 *   `05-packaging-adaptation.json` and `05b-contact-lines.json`. Google
 *   Business Profile copies its caption alone; its BOOK call to action is shown
 *   as a separate item (§8.2).
 * - **The web derives nothing about findings.** `owner_item` and the counts
 *   are the worker's rows (`src/studio/worker/findings.ts`); "Needs your
 *   decision" is exactly the rows whose `owner_item` is true.
 */

import { providerTextWithContact, type ContactLine } from "../../harness/agents/providerText.js";

// --- The schema's own shapes ---------------------------------------------------

/** `studio_runs_state`. */
export const RUN_STATES = ["queued", "running", "succeeded", "failed", "refused", "cancelled", "interrupted"] as const;
/** `studio_runs_kind`. */
export const RUN_KINDS = ["full", "revise", "replay_critic", "resume_packaging", "imported"] as const;
export type RunState = (typeof RUN_STATES)[number];
export type RunKind = (typeof RUN_KINDS)[number];
/** A run id, a user id: a UUID, in the lower-case form PostgreSQL prints. */
export const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** `studio_run_artifacts_name_shape`, exactly. */
export const ARTIFACT_NAME_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** The list's page size: never more than 50 rows (§8.1). */
export const RUNS_PAGE_SIZE = 50;
/** The highest page number the list accepts. */
export const RUNS_MAX_PAGE = 10_000;
/** The states a list or report polls for (§8.1: by polling, no live socket). */
export const POLLING_STATES: readonly RunState[] = ["queued", "running"];
/** Seconds between polls: a `<meta http-equiv="refresh">`, only while such a run is shown. */
export const POLL_SECONDS = 15;

export const KIND_LABELS: Readonly<Record<RunKind, string>> = Object.freeze({
  full: "Full run", revise: "Revise", replay_critic: "Critic replay", resume_packaging: "Resume from packaging", imported: "Import",
});

// --- Rows ----------------------------------------------------------------------

export interface RunListRow {
  id: string;
  kind: string;
  state: string;
  runner: string;
  goal: string | null;
  verdict: string | null;
  blocking_findings: number | null;
  advisory_findings: number | null;
  actual_usd: string | null;
  import_tier: string | null;
  created_at: Date;
  requested_by: string;
  requester_name: string | null;
}

export interface RunRow extends RunListRow {
  source_run_id: string | null;
  platforms: string[] | null;
  scope_tags: string[] | null;
  fact_version_id: string | null;
  approved_facts_sha256: string | null;
  automotive_facts_sha256: string | null;
  evidence_pack_sha256: string | null;
  code_commit: string | null;
  reserved_usd: string | null;
  owner_item_findings: number | null;
  failure_class: string | null;
  failure_message: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  /** The owner's tombstone (§4.7): a deleted run is never shown. */
  deleted_at: Date | null;
}

/**
 * Whether a run may be shown: it exists and was not deleted. The store returns
 * a run as stored, tombstone included, and this decides (as S4's sessions are
 * decided), so the report and its files share one rule.
 */
export const runVisible = (run: RunRow | null): run is RunRow => run !== null && run.deleted_at === null;

export interface RunLineage {
  /** The run this one read, if any; `deleted` when it has been tombstoned. */
  parent: { id: string; deleted: boolean } | null;
  /** Live runs that read this one. */
  children: Array<{ id: string; kind: string; state: string }>;
}

export interface ArtifactMeta { name: string; sha256: string; byte_length: number }
export interface StoredArtifact extends ArtifactMeta { content: Buffer }

export interface FindingRow {
  idx: number;
  lens: string;
  severity: string;
  category: string;
  owner: string;
  issue: string;
  owner_item: boolean;
}

export interface RequestRow {
  seq: number;
  stage: string;
  lens: string | null;
  model: string;
  ceiling_usd: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: string | null;
  charged_usd: string;
  outcome: string;
}

// --- The list's filters --------------------------------------------------------

export interface RunFilters {
  state: RunState | null;
  kind: RunKind | null;
  requester: string | null;
  /** 1-based. */
  page: number;
}

export type FilterDecision = { ok: true; filters: RunFilters } | { ok: false; reason: string };

/**
 * The list's query string, validated: `state` and `kind` against the schema's
 * value sets, `requester` as a UUID, `page` a whole number from 1. A repeated
 * key or an invalid value is refused; an empty value means no filter; any other
 * key is ignored.
 */
export function parseRunFilters(query: URLSearchParams): FilterDecision {
  const one = (key: string): string | null | undefined => {
    const values = query.getAll(key);
    if (values.length > 1) return undefined;
    return values.length === 0 || values[0] === "" ? null : values[0]!;
  };
  const state = one("state");
  const kind = one("kind");
  const requester = one("requester");
  const page = one("page");
  if (state === undefined || kind === undefined || requester === undefined || page === undefined) {
    return { ok: false, reason: "a filter was given more than once" };
  }
  if (state !== null && !(RUN_STATES as readonly string[]).includes(state)) return { ok: false, reason: "unknown state" };
  if (kind !== null && !(RUN_KINDS as readonly string[]).includes(kind)) return { ok: false, reason: "unknown kind" };
  if (requester !== null && !UUID_SHAPE.test(requester)) return { ok: false, reason: "requester is not a user id" };
  if (page !== null && !/^[1-9][0-9]{0,4}$/.test(page)) return { ok: false, reason: "page is not a page number" };
  const pageNumber = page === null ? 1 : Number(page);
  if (pageNumber > RUNS_MAX_PAGE) return { ok: false, reason: "page is not a page number" };
  return { ok: true, filters: { state: state as RunState | null, kind: kind as RunKind | null, requester, page: pageNumber } };
}

/** The report's `?group=`: by stage owner (the default) or by lens; anything else is refused. */
export function parseGrouping(query: URLSearchParams): "owner" | "lens" | null {
  const values = query.getAll("group");
  if (values.length === 0) return "owner";
  if (values.length > 1) return null;
  return values[0] === "lens" ? "lens" : values[0] === "owner" || values[0] === "" ? "owner" : null;
}

// --- Findings ------------------------------------------------------------------

/** The stage owners, in stage order (3, 4, 5), then the person. */
export const OWNER_ORDER = ["hook-story-script", "production-direction", "packaging-adaptation", "human_review"] as const;
/** The critic lenses, in panel order. */
export const LENS_ORDER = ["evidence-fidelity", "platform-and-local", "voice-and-craft", "production-coherence"] as const;
const SEVERITY_RANK: Readonly<Record<string, number>> = { blocking: 0, advisory: 1 };

export interface FindingGroup { key: string; findings: FindingRow[] }

/**
 * Findings grouped by stage owner (§8.2 item 5) or, with `?group=lens`, by
 * lens; within a group, blocking first, then advisory, then the panel's order.
 * A value outside the known order is grouped after them, never dropped.
 */
export function groupFindings(rows: readonly FindingRow[], by: "owner" | "lens"): FindingGroup[] {
  const order: readonly string[] = by === "owner" ? OWNER_ORDER : LENS_ORDER;
  const keyOf = (row: FindingRow) => (by === "owner" ? row.owner : row.lens);
  const keys = [...order, ...[...new Set(rows.map(keyOf))].filter((k) => !order.includes(k)).sort()];
  return keys.map((key) => ({
    key,
    findings: rows.filter((row) => keyOf(row) === key)
      .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 2) - (SEVERITY_RANK[b.severity] ?? 2) || a.idx - b.idx),
  })).filter((group) => group.findings.length > 0);
}

/** "Needs your decision" (§8.2 item 6): exactly the worker's owner items, in the panel's order. */
export function needsDecision(rows: readonly FindingRow[]): FindingRow[] {
  return rows.filter((row) => row.owner_item === true).sort((a, b) => a.idx - b.idx);
}

// --- Stored artifacts, as untrusted data -----------------------------------------

/** The largest artifact the report parses; a larger one is offered for download only. */
export const MAX_DISPLAY_ARTIFACT_BYTES = 1_048_576;
/** The longest string field shown, and the most entries a list may hold. */
const MAX_FIELD_CHARS = 20_000;
const MAX_ENTRIES = 200;

export type Displayable<T> = { ok: true; value: T } | { ok: false; reason: "absent" | "cannot-display" };

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown): string | null =>
  typeof value === "string" && value.length <= MAX_FIELD_CHARS ? value : null;
const list = (value: unknown): unknown[] | null => (Array.isArray(value) && value.length <= MAX_ENTRIES ? value : null);
const texts = (value: unknown): string[] | null => {
  const entries = list(value);
  if (!entries) return null;
  const out = entries.map(text);
  return out.every((entry) => entry !== null) ? out as string[] : null;
};

class Unexpected extends Error {}
const need = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Unexpected();
  return value;
};

/** One stored artifact's JSON, bounded and parsed; never throws. */
export function parseStoredJson(bytes: Buffer | undefined): Displayable<unknown> {
  if (bytes === undefined) return { ok: false, reason: "absent" };
  if (bytes.length > MAX_DISPLAY_ARTIFACT_BYTES) return { ok: false, reason: "cannot-display" };
  try {
    return { ok: true, value: JSON.parse(bytes.toString("utf8")) as unknown };
  } catch {
    return { ok: false, reason: "cannot-display" };
  }
}

function shaped<T>(bytes: Buffer | undefined, read: (parsed: unknown) => T): Displayable<T> {
  const parsed = parseStoredJson(bytes);
  if (!parsed.ok) return parsed;
  try {
    return { ok: true, value: read(parsed.value) };
  } catch {
    return { ok: false, reason: "cannot-display" };
  }
}

const provisionalOf = (parsed: unknown) => need(record(need(record(need(record(parsed))?.output))?.provisional));

export interface ScriptView { hook: string; beats: Array<{ beat: string; role: string }>; script: string }

/** §8.2 item 3, from `03-hook-story-script.json`. */
export function readScript(bytes: Buffer | undefined): Displayable<ScriptView> {
  return shaped(bytes, (parsed) => {
    const p = provisionalOf(parsed);
    return {
      hook: need(text(p.hook)),
      beats: need(list(p.storyBeats)).map((b) => {
        const beat = need(record(b));
        return { beat: need(text(beat.beat)), role: need(text(beat.role)) };
      }),
      script: need(text(p.script)),
    };
  });
}

export interface ShotListView {
  visualApproach: string;
  shots: Array<{ purpose: string; subject: string; framing: string; movement: string; action: string; composition: string;
    continuityNote: string }>;
  overlays: Array<{ text: string; shotIndex: number; role: string }>;
  /** Every requirement is unverified (`availabilityVerified: false`): "to be confirmed by a person". */
  requirements: Array<{ requirement: string; category: string }>;
}

/** §8.2 item 4, from `04-production-direction.json`. */
export function readShotList(bytes: Buffer | undefined): Displayable<ShotListView> {
  return shaped(bytes, (parsed) => {
    const p = provisionalOf(parsed);
    return {
      visualApproach: need(text(p.visualApproach)),
      shots: need(list(p.shots)).map((s) => {
        const shot = need(record(s));
        return {
          purpose: need(text(shot.purpose)), subject: need(text(shot.subject)), framing: need(text(shot.framing)),
          movement: need(text(shot.movement)), action: need(text(shot.action)), composition: need(text(shot.composition)),
          continuityNote: need(text(shot.continuityNote)),
        };
      }),
      overlays: need(list(p.overlayText)).map((o) => {
        const overlay = need(record(o));
        const shotIndex = overlay.shotIndex;
        if (typeof shotIndex !== "number" || !Number.isSafeInteger(shotIndex) || shotIndex < 0) throw new Unexpected();
        return { text: need(text(overlay.text)), shotIndex, role: need(text(overlay.role)) };
      }),
      requirements: need(list(p.productionRequirements)).map((r) => {
        const requirement = need(record(r));
        // A requirement this pipeline claims was verified is not one it could produce.
        if (requirement.availabilityVerified !== false) throw new Unexpected();
        return { requirement: need(text(requirement.requirement)), category: need(text(requirement.category)) };
      }),
    };
  });
}

export const PLATFORM_LABELS: Readonly<Record<string, string>> = Object.freeze({
  instagram: "Instagram", facebook: "Facebook", google_business_profile: "Google Business Profile",
});

export interface CaptionCard {
  platform: string;
  caption: string;
  hashtags: string[];
  localKeywords: string[];
  /** The deterministic contact text, or null (Google Business Profile). */
  contactText: string | null;
  /** Google Business Profile's call to action, shown as its own item. */
  cta: { actionType: string; url: string } | null;
  /** What the main Copy button copies. */
  copyText: string;
}

/**
 * §8.2 item 2, from the stored `05-packaging-adaptation.json` and
 * `05b-contact-lines.json`: one card per platform, in the packages' order. The
 * two files must name the same platforms in the same order.
 */
export function readCaptions(packaging: Buffer | undefined, contacts: Buffer | undefined): Displayable<CaptionCard[]> {
  const pkgs = shaped(packaging, (parsed) => need(list(provisionalOf(parsed).packages)));
  const lines = shaped(contacts, (parsed) => need(list(need(record(parsed)).packages)));
  if (!pkgs.ok) return pkgs;
  if (!lines.ok) return lines;
  try {
    if (pkgs.value.length !== lines.value.length || pkgs.value.length === 0) throw new Unexpected();
    return {
      ok: true,
      value: pkgs.value.map((p, index) => {
        const pkg = need(record(p));
        const entry = need(record(lines.value[index]));
        const platform = need(text(pkg.platform));
        if (!Object.hasOwn(PLATFORM_LABELS, platform) || entry.platform !== platform) throw new Unexpected();
        const contact = need(record(entry.contact));
        if (contact.kind !== "deterministic_contact") throw new Unexpected();
        const contactText = contact.text === null ? null : need(text(contact.text));
        const gbp = contact.gbpCta === undefined ? null : need(record(contact.gbpCta));
        const cta = gbp ? { actionType: need(text(gbp.actionType)), url: need(text(gbp.url)) } : null;
        const caption = need(text(pkg.caption));
        const hashtags = need(texts(pkg.hashtags));
        const isGbp = platform === "google_business_profile";
        // Google Business Profile carries no contact text, only its call to action; anything else is unexpected.
        if (isGbp !== (contactText === null) || isGbp !== (cta !== null)) throw new Unexpected();
        const line: ContactLine = { kind: "deterministic_contact", text: contactText, sourceFactIds: [] };
        return {
          platform, caption, hashtags, localKeywords: need(texts(pkg.localKeywords)), contactText, cta,
          copyText: isGbp ? caption : providerTextWithContact(caption, hashtags, line),
        };
      }),
    };
  } catch {
    return { ok: false, reason: "cannot-display" };
  }
}

/** The stage files in pipeline order, for "the stage it stopped at". */
export const STAGE_FILES = [
  ["strategy-concept", "01-strategy-concept.json"], ["automotive-truth", "02-automotive-truth.json"],
  ["hook-story-script", "03-hook-story-script.json"], ["production-direction", "04-production-direction.json"],
  ["packaging-adaptation", "05-packaging-adaptation.json"], ["final-critic", "06-final-critic.json"],
] as const;

/**
 * The stage a run that did not succeed stopped at: the stage of its last
 * request that did not succeed, where it made one; otherwise the first stage
 * whose file it did not save (a critic replay writes only the critic's); null
 * when it saved every stage file.
 */
export function stoppedAt(kind: string, names: readonly string[], requests: readonly RequestRow[]): string | null {
  const unfinished = [...requests].reverse().find((r) => r.outcome !== "succeeded");
  if (unfinished) return unfinished.lens ? `${unfinished.stage} (${unfinished.lens})` : unfinished.stage;
  const files = kind === "replay_critic" ? STAGE_FILES.slice(5) : STAGE_FILES;
  return files.find(([, file]) => !names.includes(file))?.[0] ?? null;
}
