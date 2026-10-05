/**
 * `studio_findings`, derived (docs/CONTENT_STUDIO_DESIGN.md §4.2: "derived
 * from 06-final-critic.json by the library's own accessors, and rebuildable
 * from the artifact"). Content Studio S5.
 *
 * The worker is the only Studio caller allowed the library, so the derivation
 * lives here, and the web only reads the rows. At run end, in the same
 * transaction as the artifact flush and before the run is closed
 * (`closeRun` in `execute.ts`), `rebuildFindings`:
 *
 *  1. reads the run's OWN stored `06-final-critic.json` back from
 *     `studio_run_artifacts`, through the library's `readSavedStage`;
 *  2. checks it with the library's closed sets (`CRITIC_LENSES`, each lens's
 *     `CRITIC_LENS_CATEGORIES`, `CRITIC_FINDING_SEVERITIES`,
 *     `CRITIC_FINDING_OWNERS`, the issue bound) and its lens counts;
 *  3. marks `owner_item` with `planRevision`'s rule — a `human_review` owner
 *     (any owner outside `REVISABLE_OWNERS`) or a `human_decision` category —
 *     and, wherever `planRevision` itself can plan the panel, requires its
 *     `ownerItems` to be exactly those findings;
 *  4. deletes the run's rows and inserts one per finding, and writes the
 *     run's blocking, advisory and owner-item counts — the counts are the rows'.
 *
 * **A malformed artifact writes no rows and no counts.** The refusal is a
 * failure class in the worker's log (never the artifact's text), and the run's
 * terminal state is the one it would have had: the caller ignores the result,
 * and the read and every write are inside a savepoint, so even a database
 * error here rolls back the findings alone. Nothing here ever fabricates a row.
 */

import * as lib from "../../harness/contentRun/index.js";
import type { ContentRunRuntime, RunSource } from "../../harness/contentRun/index.js";
import type { SqlClient } from "./spend.js";

export const CRITIC_ARTIFACT = "06-final-critic.json";

/** One `studio_findings` row. */
export interface DerivedFinding {
  idx: number;
  lens: string;
  severity: "blocking" | "advisory";
  category: string;
  owner: string;
  issue: string;
  ownerItem: boolean;
}

export type FindingsDerivation =
  | { ok: true; findings: DerivedFinding[]; blocking: number; advisory: number; ownerItems: number }
  | { ok: false; failureClass: "critic_artifact_absent" | "critic_artifact_malformed" | "critic_owner_items_disagree"
    | "findings_write_refused" };

/** A run's stored artifacts as the library's source, read through the run-end transaction's own client. */
function storedSource(client: SqlClient, runId: string): RunSource {
  return {
    label: `studio-run:${runId}`,
    displayLabel: `studio-run:${runId}`,
    name: `studio-run-${runId}`,
    exists: async () => true,
    readArtifact: async (name) => {
      const row = (await client.query(
        "SELECT content FROM studio_run_artifacts WHERE run_id = $1 AND name = $2", [runId, name])).rows[0];
      return row ? new Uint8Array(row.content as Buffer) : undefined;
    },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The findings of one stored panel output, or why there are none. Pure but for
 * reading the artifact; throws nothing.
 */
export async function deriveFindings(rt: ContentRunRuntime, source: RunSource): Promise<FindingsDerivation> {
  if ((await source.readArtifact(CRITIC_ARTIFACT)) === undefined) return { ok: false, failureClass: "critic_artifact_absent" };
  let saved: unknown;
  try {
    saved = await lib.readSavedStage(source, CRITIC_ARTIFACT.replace(/\.json$/, ""), "findings");
  } catch {
    return { ok: false, failureClass: "critic_artifact_malformed" };
  }
  const malformed = { ok: false, failureClass: "critic_artifact_malformed" } as const;
  const provisional = isRecord(saved) && isRecord(saved.output) ? saved.output.provisional : undefined;
  if (!isRecord(provisional) || !Array.isArray(provisional.findings) || !Array.isArray(provisional.lenses)) return malformed;
  const { critic } = rt;
  const lenses = critic.CRITIC_LENSES as readonly string[];
  const raw = provisional.findings as unknown[];
  if (raw.length > lenses.length * critic.FINAL_CRITIC_LIMITS.maxFindings) return malformed;
  // Each lens's summary counts its own findings, in lens order, as the panel aggregates them.
  if (provisional.lenses.length !== lenses.length) return malformed;
  let offset = 0;
  for (const [index, lens] of lenses.entries()) {
    const entry = provisional.lenses[index];
    if (!isRecord(entry) || entry.lens !== lens || !Number.isSafeInteger(entry.findingCount)) return malformed;
    const count = entry.findingCount as number;
    if (count < 0 || offset + count > raw.length) return malformed;
    if (raw.slice(offset, offset + count).some((f) => !isRecord(f) || f.lens !== lens)) return malformed;
    offset += count;
  }
  if (offset !== raw.length) return malformed;

  const findings: DerivedFinding[] = [];
  for (const [idx, f] of raw.entries()) {
    if (!isRecord(f)) return malformed;
    const { lens, severity, category, owner, issue } = f;
    if (typeof lens !== "string" || !lenses.includes(lens)) return malformed;
    if (typeof severity !== "string" || !(critic.CRITIC_FINDING_SEVERITIES as readonly string[]).includes(severity)) return malformed;
    const lensCategories = critic.CRITIC_LENS_CATEGORIES[lens as keyof typeof critic.CRITIC_LENS_CATEGORIES] as readonly string[];
    if (typeof category !== "string" || !lensCategories.includes(category)) return malformed;
    if (typeof owner !== "string" || !(critic.CRITIC_FINDING_OWNERS as readonly string[]).includes(owner)) return malformed;
    if (typeof issue !== "string" || issue.length === 0 || issue.length > critic.FINAL_CRITIC_LIMITS.issueChars) return malformed;
    // planRevision's rule: an owner item is never sent to a model.
    const ownerItem = !critic.REVISABLE_OWNERS.has(owner as never) || category === "human_decision";
    findings.push({ idx, lens, severity: severity as DerivedFinding["severity"], category, owner, issue, ownerItem });
  }

  // Where planRevision can plan this panel, its owner items are exactly these findings.
  let planned: string[] | null = null;
  try {
    const output = (saved as { output: Parameters<ContentRunRuntime["revision"]["planRevision"]>[0] }).output;
    planned = rt.revision.planRevision(output).ownerItems.map((item) => item.id).sort();
  } catch (error) {
    if (!(error instanceof rt.revision.RevisionCapError)) return malformed;
  }
  if (planned !== null) {
    const ours = findings.filter((f) => f.ownerItem).map((f) => rt.payloadContract.revisionFindingId(f.idx)).sort();
    if (JSON.stringify(ours) !== JSON.stringify(planned)) return { ok: false, failureClass: "critic_owner_items_disagree" };
  }
  return {
    ok: true, findings,
    blocking: findings.filter((f) => f.severity === "blocking").length,
    advisory: findings.filter((f) => f.severity === "advisory").length,
    ownerItems: findings.filter((f) => f.ownerItem).length,
  };
}

/**
 * Rebuild one run's `studio_findings` rows and finding counts from its stored
 * panel output, inside the caller's transaction, before the run is closed.
 * Returns the derivation; the caller never lets it change the run's end.
 */
export async function rebuildFindings(
  client: SqlClient, rt: ContentRunRuntime, runId: string,
  log: (event: string, fields?: Record<string, unknown>) => void,
): Promise<FindingsDerivation> {
  // Everything — the artifact's read included — inside one savepoint, so no error here can abort the run's end.
  await client.query("SAVEPOINT studio_findings_rebuild");
  let derived: FindingsDerivation;
  try {
    derived = await deriveFindings(rt, storedSource(client, runId));
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT studio_findings_rebuild");
    log("findings.not_derived", { run: runId, failure_class: "critic_artifact_unreadable" });
    return { ok: false, failureClass: "critic_artifact_malformed" };
  }
  if (!derived.ok) {
    await client.query("RELEASE SAVEPOINT studio_findings_rebuild");
    if (derived.failureClass !== "critic_artifact_absent") log("findings.not_derived", { run: runId, failure_class: derived.failureClass });
    return derived;
  }
  try {
    await client.query("DELETE FROM studio_findings WHERE run_id = $1", [runId]);
    for (const f of derived.findings) {
      await client.query(
        `INSERT INTO studio_findings (run_id, idx, lens, severity, category, owner, issue, owner_item)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [runId, f.idx, f.lens, f.severity, f.category, f.owner, f.issue, f.ownerItem]);
    }
    await client.query(
      "UPDATE studio_runs SET blocking_findings = $2, advisory_findings = $3, owner_item_findings = $4 WHERE id = $1",
      [runId, derived.blocking, derived.advisory, derived.ownerItems]);
    await client.query("RELEASE SAVEPOINT studio_findings_rebuild");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT studio_findings_rebuild");
    const code = (error as { code?: unknown })?.code;
    log("findings.not_derived", { run: runId, failure_class: "findings_write_refused", sqlstate: typeof code === "string" ? code : null });
    return { ok: false, failureClass: "findings_write_refused" };
  }
  log("findings.derived", { run: runId, findings: derived.findings.length, blocking: derived.blocking,
    advisory: derived.advisory, owner_items: derived.ownerItems });
  return derived;
}
