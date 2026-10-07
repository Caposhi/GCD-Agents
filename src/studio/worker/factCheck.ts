/**
 * The worker's fact check (docs/CONTENT_STUDIO_DESIGN.md §8.5, §9.4; the S7
 * analysis's items 2–5 and 9, accepted by the owner on 2026-10-06). Content
 * Studio S7.2. **It makes no request** and runs no runner.
 *
 * 1. **The staged bytes, by the check's sha256.** The singleton staging row
 *    may have been replaced since the check was asked for; bytes that are not
 *    the check's are never checked (`staging_missing`).
 * 2. **Bytes that already are a version** are accepted at once, naming that
 *    version, and nothing is inserted.
 * 3. **The existing loader** reads them exactly as a run reads the facts file
 *    (`loadRecords`, so `parseAutomotiveFacts` and the approved facts'
 *    adapter): every loader error is a refusal with the loader's own message
 *    (`loader_refused`).
 * 4. **The pack check, on a pack that fits.** `buildEvidencePack` validates
 *    every record before its cap, then `assertUsableEvidencePack` checks the
 *    pack — over the uploaded records plus the approved facts, as a dry run.
 *    When those exceed the pack's record cap, the check runs over windows
 *    that fit (the approved facts plus a slice of the upload), so every record
 *    is validated and checked in a pack, and the over-cap file is a WARNING —
 *    an unscoped run will be refused — never a refusal. Any library error is a
 *    refusal with its own message (`pack_refused`).
 * 5. **Warnings, names only:** every entry field outside the loader's known
 *    set (`AUTOMOTIVE_FACT_FIELDS`, exported by the library — never a second
 *    list) and every top-level key besides `facts`.
 * 6. **Counts over the uploaded records only:** the record count and each
 *    tag's count, because the new-run screen adds the heartbeat's
 *    approved-facts counts itself.
 *
 * The outcome — on acceptance the version, inserted from the staged bytes
 * while this check's job is running — then the check's outcome, the staging
 * row's deletion (for both outcomes), the job's end and an audit row of
 * classes and counts, is written in ONE transaction (`writeFactCheckOutcome`).
 * A refusal's message is stored for the owner and never logged.
 */

import * as lib from "../../harness/contentRun/index.js";
import type { ContentRunRuntime, FactFile } from "../../harness/contentRun/index.js";
import { APPROVED_FACTS_PATH, AUTOMOTIVE_FACTS_DISPLAY_PATH, failureClassOf, type WorkerJobContext } from "./execute.js";
import { audit, type ClaimedJob } from "./jobs.js";
import type { WorkerSession } from "./session.js";
import type { SqlClient } from "./spend.js";

/** `studio_fact_checks_refusal_message_bounded`: 1–4,000 characters. */
export const FACT_CHECK_MESSAGE_MAX = 4_000;
/** `studio_fact_checks_unknown_fields`: at most 200 names, 16 KiB in all. */
export const UNKNOWN_FIELDS_MAX = 200;
export const UNKNOWN_FIELDS_MAX_BYTES = 16_384;
/** A name longer than this is shown cut, with an ellipsis. */
export const UNKNOWN_FIELD_NAME_MAX = 120;
/** What the loader names the upload in its own messages. */
export const UPLOAD_LABEL = "the uploaded facts file";
/** The dry run's goal: the pack needs one, and this one carries nothing of the upload. */
export const DRY_RUN_GOAL = "Content Studio fact check (dry run)";

export type FactCheckDecision =
  | {
    outcome: "accepted"; recordCount: number; tagCounts: Record<string, number>; unknownFields: string[] | null;
    /** True when the upload with the approved facts exceeds the pack's record cap: an unscoped run will be refused. */
    overCap: boolean;
  }
  | { outcome: "refused"; refusalClass: string; message: string; unknownFields: string[] | null };

const bounded = (message: string): string => {
  const text = [...(message || "the fact check refused this file")];
  return text.length > FACT_CHECK_MESSAGE_MAX ? text.slice(0, FACT_CHECK_MESSAGE_MAX).join("") : text.join("");
};
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const shown = (name: string): string => {
  const chars = [...name];
  return chars.length > UNKNOWN_FIELD_NAME_MAX ? `${chars.slice(0, UNKNOWN_FIELD_NAME_MAX).join("")}…` : name;
};

/**
 * The field names outside the loader's known set, as `facts[].<name>` for an
 * entry's field and `<name>` for a top-level key besides `facts`; sorted,
 * bounded to what the schema holds. Null when there are none (or the bytes are
 * not JSON, which the loader then refuses).
 */
export function unknownFieldNames(bytes: Uint8Array): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return null;
  }
  const known = new Set(lib.AUTOMOTIVE_FACT_FIELDS);
  const names = new Set<string>();
  const entries = Array.isArray(parsed) ? parsed : isPlainObject(parsed) ? parsed.facts : undefined;
  if (isPlainObject(parsed)) for (const key of Object.keys(parsed)) if (key !== "facts") names.add(shown(key));
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (!isPlainObject(entry)) continue;
      for (const key of Object.keys(entry)) if (!known.has(key)) names.add(`facts[].${shown(key)}`);
    }
  }
  const list: string[] = [];
  let bytesUsed = 0;
  for (const name of [...names].sort()) {
    const size = Buffer.byteLength(name, "utf8");
    if (list.length >= UNKNOWN_FIELDS_MAX || bytesUsed + size > UNKNOWN_FIELDS_MAX_BYTES) break;
    list.push(name);
    bytesUsed += size;
  }
  return list.length ? list : null;
}

/** Each tag's count over the uploaded records only (a record counts once per tag). */
export function uploadedTagCounts(records: ReadonlyArray<{ tags?: unknown }>): Record<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const tags = Array.isArray(record.tags) ? record.tags.filter((t): t is string => typeof t === "string") : [];
    for (const tag of new Set(tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.keys()].sort().map((tag) => [tag, counts.get(tag)!]));
}

/**
 * The fact check's decision for one upload. Pure of the database: the caller
 * reads the staged bytes and writes the outcome. It makes no request.
 */
export async function decideFactCheck(input: {
  bytes: Uint8Array; approvedFacts: { bytes: Buffer }; runtime: ContentRunRuntime; now: number;
}): Promise<FactCheckDecision> {
  const unknownFields = unknownFieldNames(input.bytes);
  const rt = input.runtime;
  const reviewedAt = new Date(input.now).toISOString();
  const automotiveFacts: FactFile = {
    path: UPLOAD_LABEL, displayPath: AUTOMOTIVE_FACTS_DISPLAY_PATH, exists: () => true, read: async () => input.bytes,
  };
  const approvedFacts: FactFile = {
    path: APPROVED_FACTS_PATH, displayPath: APPROVED_FACTS_PATH, exists: () => true,
    read: async () => new Uint8Array(input.approvedFacts.bytes),
  };
  // 3. The existing loader, exactly as a run reads the files.
  let approvedRecords: any[];
  let uploaded: any[];
  try {
    const all = await lib.loadRecords(rt, { facts: { approvedFacts: approvedFacts, automotiveFacts }, now: input.now, reviewedAt });
    uploaded = lib.parseAutomotiveFacts(input.bytes, { label: UPLOAD_LABEL, now: input.now });
    approvedRecords = all.records.slice(0, all.records.length - uploaded.length);
  } catch (error) {
    return { outcome: "refused", refusalClass: "loader_refused", message: bounded(String((error as Error)?.message ?? error)), unknownFields };
  }
  // 4. The pack check on packs that fit: every record validated, and checked in a pack.
  const cap = rt.payloadContract.EVIDENCE_LIMITS.maxProjectedRecords;
  const overCap = approvedRecords.length + uploaded.length > cap;
  const room = cap - approvedRecords.length;
  const windows: any[][] = [];
  if (!overCap) windows.push(uploaded);
  else if (room > 0) for (let at = 0; at < uploaded.length; at += room) windows.push(uploaded.slice(at, at + room));
  else windows.push(uploaded);
  try {
    for (const window of windows) {
      rt.packModule.assertUsableEvidencePack(rt.packModule.buildEvidencePack({
        goal: DRY_RUN_GOAL, records: [...approvedRecords, ...window], now: input.now,
      }));
    }
  } catch (error) {
    return { outcome: "refused", refusalClass: "pack_refused", message: bounded(String((error as Error)?.message ?? error)), unknownFields };
  }
  return { outcome: "accepted", recordCount: uploaded.length, tagCounts: uploadedTagCounts(uploaded), unknownFields, overCap };
}

/** The check as the worker reads it (`studio_fact_checks`). */
export interface FactCheckRow {
  id: string;
  jobId: string;
  requestedBy: string;
  sha256: string;
  byteLength: number;
}

/** What is written: the decision, and whether the bytes were already a version. */
export type FactCheckOutcome =
  | (Extract<FactCheckDecision, { outcome: "accepted" }> & { existing: boolean })
  | Extract<FactCheckDecision, { outcome: "refused" }>;

/**
 * The outcome, in ONE transaction, in this order: on a new acceptance the
 * version, inserted from the staged bytes (the schema requires this check's
 * job to be running and the staged bytes present); the check's outcome; the
 * staging row's deletion — for both outcomes, and only of this check's bytes;
 * the job's end; and an audit row of classes and counts. Neither half is ever
 * written without the other.
 */
export async function writeFactCheckOutcome(
  session: Pick<WorkerSession, "tx">, check: FactCheckRow, outcome: FactCheckOutcome,
): Promise<void> {
  await session.tx(async (client) => {
    if (outcome.outcome === "accepted" && !outcome.existing) {
      const inserted = await client.query(
        `INSERT INTO studio_fact_versions (sha256, content, byte_length, record_count, tag_counts, uploaded_by)
         SELECT s.sha256, s.content, s.byte_length, $2, $3, s.uploaded_by FROM studio_fact_uploads s WHERE s.sha256 = $1`,
        [check.sha256, outcome.recordCount, JSON.stringify(outcome.tagCounts)]);
      if (inserted.rowCount !== 1) throw new Error("the staged bytes are no longer present; no version was created");
    }
    const written = outcome.outcome === "accepted"
      ? await client.query(
        "UPDATE studio_fact_checks SET outcome = 'accepted', unknown_fields = $2 WHERE id = $1 AND outcome IS NULL",
        [check.id, outcome.unknownFields])
      : await client.query(
        `UPDATE studio_fact_checks SET outcome = 'refused', refusal_class = $2, refusal_message = $3, unknown_fields = $4
          WHERE id = $1 AND outcome IS NULL`,
        [check.id, outcome.refusalClass, outcome.message, outcome.unknownFields]);
    if (written.rowCount !== 1) throw new Error("the fact check already has an outcome");
    await deleteStagedBytes(client, check.sha256);
    await client.query("UPDATE studio_jobs SET state = 'finished' WHERE id = $1", [check.jobId]);
    await audit(client, "fact_check.outcome", "studio_fact_checks", check.id, outcome.outcome === "accepted"
      ? { outcome: "accepted", existing: outcome.existing, over_cap: outcome.overCap, records: outcome.recordCount,
        unknown_fields: outcome.unknownFields?.length ?? 0 }
      : { outcome: "refused", refusal_class: outcome.refusalClass, unknown_fields: outcome.unknownFields?.length ?? 0 });
  });
}

/** The staging row, only while it holds these bytes. */
async function deleteStagedBytes(client: SqlClient, sha256: string): Promise<void> {
  await client.query("DELETE FROM studio_fact_uploads WHERE sha256 = $1", [sha256]);
}

/**
 * One claimed fact_check job, answered: the check read by its job, decided,
 * and its outcome written. Logs classes and counts only — never a field name,
 * a value or a refusal's message (design §9.2).
 */
export async function runFactCheck(ctx: WorkerJobContext, job: ClaimedJob): Promise<{ outcome: string; refusalClass: string | null }> {
  const { session } = ctx;
  const row = (await session.query(
    `SELECT id::text AS id, job_id::text AS job_id, requested_by::text AS requested_by, sha256, byte_length, outcome
       FROM studio_fact_checks WHERE job_id = $1`, [job.jobId])).rows[0];
  if (!row || row.outcome !== null) {
    // Nothing to answer: the job is closed, never retried.
    await session.tx(async (client) => {
      await client.query("UPDATE studio_jobs SET state = 'finished' WHERE id = $1", [job.jobId]);
      await audit(client, "job.fact_check_refused", "studio_jobs", job.jobId, { reason: row ? "already_answered" : "no_check" });
    });
    return { outcome: row ? "already_answered" : "no_check", refusalClass: null };
  }
  const check: FactCheckRow = {
    id: row.id, jobId: row.job_id, requestedBy: row.requested_by, sha256: row.sha256, byteLength: Number(row.byte_length),
  };
  const staged = (await session.query(
    "SELECT content FROM studio_fact_uploads WHERE sha256 = $1 AND uploaded_by = $2 AND byte_length = $3",
    [check.sha256, check.requestedBy, check.byteLength])).rows[0];
  const existing = (await session.query("SELECT 1 FROM studio_fact_versions WHERE sha256 = $1", [check.sha256])).rows.length === 1;
  let outcome: FactCheckOutcome;
  if (!staged) {
    outcome = { outcome: "refused", refusalClass: "staging_missing",
      message: "the staged bytes this check was asked for are no longer staged (another upload replaced them); upload the file again",
      unknownFields: null };
  } else if (existing) {
    outcome = { outcome: "accepted", existing: true, recordCount: 0, tagCounts: {}, overCap: false,
      unknownFields: unknownFieldNames(staged.content as Buffer) };
  } else {
    try {
      const decision = await decideFactCheck({ bytes: staged.content as Buffer, approvedFacts: ctx.approvedFacts, runtime: ctx.runtime,
        now: Date.now() });
      outcome = decision.outcome === "accepted" ? { ...decision, existing: false } : decision;
    } catch (error) {
      outcome = { outcome: "refused", refusalClass: failureClassOf(error), message: bounded(String((error as Error)?.message ?? error)),
        unknownFields: null };
    }
  }
  try {
    await writeFactCheckOutcome(session, check, outcome);
  } catch {
    // The database refused the outcome (the requester is no longer an active owner, say): the check is answered as
    // refused instead, still in one transaction with the staging row's deletion and the job's end. Should that be
    // refused too, the job alone is closed, so the queue never stops on one check.
    if (session.lost) throw session.lost;
    outcome = { outcome: "refused", refusalClass: "outcome_refused",
      message: "the database refused this check's outcome; the requester may no longer be an active owner", unknownFields: null };
    try {
      await writeFactCheckOutcome(session, check, outcome);
    } catch {
      if (session.lost) throw session.lost;
      await session.tx(async (client) => {
        await client.query("UPDATE studio_jobs SET state = 'finished' WHERE id = $1 AND state = 'running'", [job.jobId]);
        await audit(client, "job.fact_check_refused", "studio_jobs", job.jobId, { reason: "outcome_not_written" });
      });
      return { outcome: "not_written", refusalClass: null };
    }
  }
  return { outcome: outcome.outcome, refusalClass: outcome.outcome === "refused" ? outcome.refusalClass : null };
}
