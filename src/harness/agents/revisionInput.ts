/**
 * The two data blocks a writing stage receives in a revision request, and the
 * checks each stage applies to them before its model call.
 *
 * A revision request is one of stages 3–5 re-run once, after the critic panel,
 * with its ordinary inputs plus:
 *
 *  - `PREVIOUS_OUTPUT` — the stage's own round-1 output;
 *  - `CRITIC_FINDINGS` — only the round-1 panel findings that name this stage as
 *    their owner, each with its id, severity, category, platform, lens, issue
 *    and suggested action.
 *
 * Both are untrusted data. A finding is a reviewer's unverified opinion: it may
 * only narrow or correct what the stage writes, and never permits anything —
 * the stage's claim block stays its only source of assertable fact, and every
 * validator applies unchanged. That rule lives in each stage's prompt; this
 * module holds the structural part, which a prompt cannot.
 *
 * **What the executor checks here, and what it does not.** It refuses, before
 * the request exists: a finding owned by any other stage or by `human_review`;
 * a `human_decision` finding; more findings than the stage's derived cap; an
 * unknown lens or severity; a malformed id; an issue or suggested action over
 * the critic's own limits; and a `PREVIOUS_OUTPUT` larger than the stage's own
 * output contract. It does not re-derive which findings a stage should get, or
 * prove a previous output came from a real run: the CLI selects the findings
 * (`revision.ts`) from a critic output it has revalidated, and revalidates each
 * previous output against the round-1 inputs it was produced from.
 *
 * A leaf module on purpose: it imports no stage module, so every writing stage
 * can import it without a cycle through the critic.
 */

import {
  CRITIC_FIELD_LIMITS,
  CRITIC_LENSES,
  MAX_PANEL_FINDINGS,
  REVISION_FINDING_CAPS,
  REVISION_PREVIOUS_OUTPUT_CHARS,
  criticFindingsBlockChars,
  isBoundedSerializableText,
  revisionFindingId,
  type RevisableStage,
} from "./payloadContract.js";

/** The two labels, in the order they follow a stage's ordinary blocks. */
export const REVISION_BLOCK_LABELS = ["PREVIOUS_OUTPUT", "CRITIC_FINDINGS"] as const;

/** Severities a panel finding carries. Mirrors `CRITIC_FINDING_SEVERITIES`. */
const SEVERITIES = ["blocking", "advisory"] as const;

/**
 * One round-1 finding, as selected for the stage that owns it. `owner` is
 * carried so the executor can refuse a finding that is not its own; it is not
 * rendered, because every rendered finding has the same owner.
 */
export interface RevisionFinding {
  /** `F<n>`: the finding's 1-based position in the round-1 panel's findings. */
  id: string;
  lens: string;
  owner: string;
  severity: string;
  category: string;
  platform: string;
  issue: string;
  suggestedAction: string;
}

/** What a writing stage's invocation carries when it is a revision request. */
export interface StageRevisionInput {
  /** The stage's own round-1 output, as validated. Untrusted data. */
  previousOutput: unknown;
  /** Only the findings this stage owns, at most its derived cap. May be empty. */
  findings: readonly RevisionFinding[];
}

/**
 * `CRITIC_FINDINGS`, rendered. Exactly the fields a stage is told about, in a
 * fixed order; `payloadContract.ts` sizes the block from the same field list.
 */
export function renderCriticFindings(findings: readonly RevisionFinding[]): string {
  return JSON.stringify(findings.map((f) => ({
    id: f.id,
    severity: f.severity,
    category: f.category,
    platform: f.platform,
    lens: f.lens,
    issue: f.issue,
    suggestedAction: f.suggestedAction,
  })), null, 2);
}

const ID_PATTERN = /^F[1-9][0-9]*$/;
const MAX_ID_CHARS = revisionFindingId(MAX_PANEL_FINDINGS - 1).length;
const ENUM_TOKEN = /^[a-z][a-z_]{0,31}$/;

/**
 * The two revision blocks for `stage`, or none for an ordinary request.
 *
 * Every refusal goes through the stage's own `fail`, so it is attributed to the
 * stage and happens before any request is built.
 */
export function revisionDataBlocks(
  stage: RevisableStage,
  revision: StageRevisionInput | undefined,
  fail: (message: string) => never,
): Array<{ label: string; body: string }> {
  if (revision === undefined) return [];
  if (!revision || typeof revision !== "object") fail('"revision" must be an object');
  if (!Array.isArray(revision.findings)) fail('"revision.findings" must be an array');
  const cap = REVISION_FINDING_CAPS[stage];
  if (revision.findings.length > cap) {
    fail(`"revision.findings" carries ${revision.findings.length} findings, over this stage's derived cap of ${cap}`);
  }
  const seen = new Set<string>();
  revision.findings.forEach((f, index) => {
    const at = `revision.findings[${index}]`;
    if (!f || typeof f !== "object") fail(`"${at}" must be an object`);
    // The two properties a revision request must never break: a stage sees only
    // its own findings, and a human's decision never reaches a model.
    if (f.owner !== stage) fail(`"${at}" is owned by ${JSON.stringify(f.owner)}, not this stage`);
    if (f.category === "human_decision") fail(`"${at}" is a human_decision finding; it never reaches a model`);
    if (typeof f.id !== "string" || !ID_PATTERN.test(f.id) || f.id.length > MAX_ID_CHARS) {
      fail(`"${at}.id" must be a panel finding id (F1 to ${revisionFindingId(MAX_PANEL_FINDINGS - 1)})`);
    }
    if (seen.has(f.id)) fail(`"${at}.id" repeats ${f.id}`);
    seen.add(f.id);
    if (!(CRITIC_LENSES as readonly string[]).includes(f.lens)) fail(`"${at}.lens" is not a critic lens`);
    if (!(SEVERITIES as readonly string[]).includes(f.severity)) fail(`"${at}.severity" must be blocking or advisory`);
    // Category and platform are the critic's closed enums, already enforced on
    // the critic output the caller selected from; here only their token shape.
    for (const field of ["category", "platform"] as const) {
      if (typeof f[field] !== "string" || !ENUM_TOKEN.test(f[field])) fail(`"${at}.${field}" must be an enum token`);
    }
    for (const [field, max] of [
      ["issue", CRITIC_FIELD_LIMITS.issueChars], ["suggestedAction", CRITIC_FIELD_LIMITS.suggestedActionChars],
    ] as const) {
      const value = f[field];
      if (typeof value !== "string" || !value.trim() || !isBoundedSerializableText(value, max)) {
        fail(`"${at}.${field}" must be non-empty serializable text within ${max} characters`);
      }
    }
  });
  if (!revision.previousOutput || typeof revision.previousOutput !== "object") {
    fail('"revision.previousOutput" must be the stage\'s own previous output');
  }
  const previous = JSON.stringify(revision.previousOutput, null, 2);
  const previousMax = REVISION_PREVIOUS_OUTPUT_CHARS[stage];
  if (previous.length > previousMax) {
    fail(`"revision.previousOutput" exceeds this stage's own output ceiling of ${previousMax} characters`);
  }
  // The same guard every block has: the rendered body never exceeds the ceiling
  // the payload contract derived for it, so the cap's arithmetic is the real bound.
  const findingsBody = renderCriticFindings(revision.findings);
  const findingsMax = criticFindingsBlockChars(revision.findings.length);
  if (findingsBody.length > findingsMax) {
    fail(`"CRITIC_FINDINGS" exceeds its derived ceiling of ${findingsMax} characters`);
  }
  return [
    { label: "PREVIOUS_OUTPUT", body: previous },
    { label: "CRITIC_FINDINGS", body: findingsBody },
  ];
}
