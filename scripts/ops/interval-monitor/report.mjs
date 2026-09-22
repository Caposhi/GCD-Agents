/**
 * Rendering for the interval monitor: one plain-text report for the log, one
 * Markdown-inert report for `$GITHUB_STEP_SUMMARY`.
 *
 * Both are pure. The caller supplies finished verdict records and decides where
 * the text goes.
 *
 * Why the summary is inerted. Three of the values it prints come from outside
 * this repository — the `/healthz` document, `_migrations` identifiers, and
 * GitHub workflow-run fields. None is attacker-controlled in any expected
 * state, but "expected state" is exactly what a monitor exists to doubt: the
 * interesting runs are the ones where something is not as recorded. Every
 * external value is therefore length-bounded, stripped of control characters,
 * and HTML-entity-escaped outside a narrow readable allowlist before it reaches
 * a rendered surface. Entities render as the original characters, so inerting
 * costs nothing in legibility.
 *
 * The summary is written so a drift failure can be read on the run page without
 * opening a log: the verdict is the first line, and every non-passing check is
 * restated underneath with its name, what was expected, and what was observed.
 * (GitHub's own notification email carries the workflow and run identity with a
 * link; this summary is what that link lands on.)
 */

import { GATING_CHECKS, STATUS } from "./checks.mjs";
import {
  API_ARTIFACT_A,
  INTERVAL_EXPIRY,
  INTERVAL_START,
  MONITOR_ENVIRONMENT,
} from "./expected.mjs";

/** Each rendered field is bounded; nothing external sets the size of this report. */
export const MAX_FIELD_CHARS = 300;

/** Readable, and incapable of forming Markdown, HTML or a table-cell break. */
const SAFE_CHARACTER = /^[A-Za-z0-9 .,:;()/+@'"?!=-]$/;

/** Control characters out, whitespace collapsed, length bounded. */
export const plain = (value) => String(value ?? "")
  .slice(0, MAX_FIELD_CHARS * 2)
  .replace(/[\u0000-\u001f\u007f]+/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, MAX_FIELD_CHARS);

/** {@link plain}, then entity-escaped outside the allowlist. Renders as itself. */
export const inert = (value) => Array.from(plain(value), (char) => (
  SAFE_CHARACTER.test(char) ? char : `&#${char.codePointAt(0)};`
)).join("");

/**
 * The job's single verdict.
 *
 * `ERROR` outranks `DRIFT`: when some check could not run at all, the honest
 * headline is that the run proved nothing, not that it found a problem.
 */
export const overallVerdict = (results) => {
  const gating = results.filter((result) => GATING_CHECKS.includes(result.id));
  if (gating.some((result) => result.status === STATUS.ERROR)) return STATUS.ERROR;
  if (gating.some((result) => result.status === STATUS.DRIFT)) return STATUS.DRIFT;
  return STATUS.PASS;
};

const HEADLINE = Object.freeze({
  [STATUS.PASS]: "ALL CLEAR — every check ran and every check matched the record",
  [STATUS.DRIFT]: "DRIFT DETECTED — production no longer matches the recorded M1 state",
  [STATUS.ERROR]: "CHECK FAILED — at least one check could not be performed, so nothing is proven",
});

const LEAD = Object.freeze({
  [STATUS.PASS]: "Every check below was performed and passed. This is evidence for the day it ran"
    + " and for nothing else.",
  [STATUS.DRIFT]: "At least one observation disagrees with the recorded M1 state. The named owner"
    + " must look at this before the interval's expiry decision.",
  [STATUS.ERROR]: "At least one check could not be performed. This run is NOT evidence that"
    + " production is unchanged — it is evidence that the monitor could not tell.",
});

/** `## Interval monitor` heading line, then the state, for the log. */
export const renderConsole = (results, meta) => {
  const verdict = overallVerdict(results);
  const lines = [
    "M1 to M2 interval monitor",
    `Verdict: ${HEADLINE[verdict]}`,
    `Run at: ${plain(meta.startedAt)}`,
    `Interval: ${plain(INTERVAL_START)} to ${plain(INTERVAL_EXPIRY)}`,
    `Expected API artifact A: ${plain(API_ARTIFACT_A)}`,
    "",
  ];
  for (const result of results) {
    lines.push(
      `[${result.status}] ${plain(result.title)}`,
      `    expected: ${plain(result.expected)}`,
      `    observed: ${plain(result.observed)}`,
      `    detail:   ${plain(result.detail)}`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
};

/** The `$GITHUB_STEP_SUMMARY` document. Every external value is inerted. */
export const renderSummary = (results, meta) => {
  const verdict = overallVerdict(results);
  const lines = [
    "# M1 to M2 interval monitor",
    "",
    `## ${HEADLINE[verdict]}`,
    "",
    LEAD[verdict],
    "",
    `- Run at: ${inert(meta.startedAt)}`,
    `- Interval: ${inert(INTERVAL_START)} to ${inert(INTERVAL_EXPIRY)}`,
    `- Expected API artifact A: ${inert(API_ARTIFACT_A)}`,
    `- GitHub environment: ${inert(MONITOR_ENVIRONMENT)}`,
    "",
    "This job is read-only. It writes nothing to the database, the repository, or any",
    "external system, and deploys nothing.",
    "",
    "| Check | Result | Expected | Observed |",
    "|---|---|---|---|",
  ];
  for (const result of results) {
    lines.push(
      `| ${inert(result.title)} | **${inert(result.status)}** |`
      + ` ${inert(result.expected)} | ${inert(result.observed)} |`,
    );
  }
  lines.push("");

  const problems = results.filter((result) => (
    result.status === STATUS.DRIFT || result.status === STATUS.ERROR
  ));
  if (problems.length) {
    lines.push("## What to act on", "");
    for (const result of problems) {
      lines.push(
        `### ${inert(result.status)} — ${inert(result.title)}`,
        "",
        `- Expected: ${inert(result.expected)}`,
        `- Observed: ${inert(result.observed)}`,
        `- Detail: ${inert(result.detail)}`,
        "",
      );
    }
    lines.push(
      "The standing prohibition remains in force: no unrelated release may occur, of any",
      "service, for any reason. Investigate read-only first; do not deploy, roll back, or",
      "apply a migration in response to this report without the named owner's explicit",
      "authorization.",
      "",
    );
  }
  return `${lines.join("\n")}\n`;
};
