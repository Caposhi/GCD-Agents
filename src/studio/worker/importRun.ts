/**
 * The worker's revalidation of an imported run (docs/CONTENT_STUDIO_DESIGN.md
 * §4.5, §8.6; the S7 analysis's items 7–10, accepted by the owner on
 * 2026-10-06). Content Studio S7.2. **It makes no request** and runs no runner.
 *
 * The import's files were written by the web, with its run and this job, in
 * one transaction (migration 0004 checks it at commit). The worker:
 *
 * 1. requires a complete folder — `run-meta.json` and stages 1–6, what
 *    revision mode reads — so replay folders and failed runs are archived
 *    (`incomplete_folder`);
 * 2. requires the approved-facts sha256 the folder records to be the
 *    approved facts at this worker's commit (`approved_facts_changed`);
 * 3. requires the fact version whose sha256 the folder names to exist — or,
 *    for an import whose lineage was proven at its creation, the source's
 *    pinned version, which must be that same file (`fact_version_missing`,
 *    `fact_version_mismatch`);
 * 4. runs the library's own `verifySourceRun` in revision mode against those
 *    two files: the fingerprints, the recorded scope, the rebuilt pack, every
 *    saved output through its stage's validator, and the saved critic panel
 *    lens by lens (`revalidation_failed`, with the library's own message).
 *
 * **verified** — `succeeded`, with every fingerprint, the fact version and the
 * worker's commit (set at the claim), and the goal, platforms and scope taken
 * from `verifySourceRun`'s result. **Otherwise archived_unverified** —
 * `succeeded`, with the class and the reason, and only bounded metadata from
 * the folder's own `run-meta.json`: a goal of 1–2,000 characters, platforms
 * the library's validator accepts, a well-formed scope; each else null.
 *
 * The outcome — the metadata, the findings rebuilt from the stored critic
 * artifact, the run's end with its tier, the job's end and an audit row — is
 * written in ONE transaction (`writeImportOutcome`).
 */

import * as lib from "../../harness/contentRun/index.js";
import type { ContentRunRuntime, FactFile, RunSource } from "../../harness/contentRun/index.js";
import { APPROVED_FACTS_PATH, AUTOMOTIVE_FACTS_DISPLAY_PATH, type WorkerJobContext, type WorkerLog } from "./execute.js";
import { rebuildFindings } from "./findings.js";
import { audit, terminalize, type ClaimedJob } from "./jobs.js";
import type { WorkerSession } from "./session.js";
import type { SqlClient } from "./spend.js";

/** The files revision mode reads: only a folder holding all of them can be verified. */
export const IMPORT_REQUIRED_FILES = [
  "run-meta.json", "01-strategy-concept.json", "02-automotive-truth.json", "03-hook-story-script.json",
  "04-production-direction.json", "05-packaging-adaptation.json", "06-final-critic.json",
] as const;
/** An archived import's goal is kept only at 1–2,000 characters (the live trigger's and the new-run form's bound). */
export const IMPORT_GOAL_MAX_CHARS = 2_000;
/** An archived import's scope is kept only when well formed and within the new-run form's bounds. */
export const IMPORT_SCOPE_MAX_TAGS = 200;
export const IMPORT_SCOPE_MAX_TAG_CHARS = 200;
/** `failure_message`: the same 4,000-character bound as every Studio refusal. */
export const IMPORT_MESSAGE_MAX = 4_000;
const VERDICTS = ["provisional_pass", "needs_revision", "needs_human_review"];
const HEX64 = /^[0-9a-f]{64}$/;

export interface ImportFactVersion { id: string; sha256: string; content: Buffer }

export interface ImportMetadata { goal: string | null; platforms: string[] | null; scopeTags: string[] | null }

export type ImportDecision =
  | (ImportMetadata & {
    tier: "verified"; factVersionId: string; approvedFactsSha256: string; automotiveFactsSha256: string; evidencePackSha256: string;
  })
  | (ImportMetadata & {
    tier: "archived_unverified"; failureClass: string; message: string;
    /** The folder's recorded fingerprints, kept only in their shape; the automotive one only with a matching pin. */
    approvedFactsSha256: string | null; evidencePackSha256: string | null;
  });

const bounded = (message: string): string => {
  const text = [...(message || "this import was not revalidated")];
  return text.length > IMPORT_MESSAGE_MAX ? text.slice(0, IMPORT_MESSAGE_MAX).join("") : text.join("");
};
const isPlainObject = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hexOrNull = (value: unknown): string | null => (typeof value === "string" && HEX64.test(value) ? value : null);

/**
 * The only metadata an archived import keeps from its untrusted `run-meta.json`:
 * each value bounded, else null. A verified import's come from `verifySourceRun`.
 */
export function boundedImportMetadata(rt: Pick<ContentRunRuntime, "packaging">, meta: unknown): ImportMetadata {
  if (!isPlainObject(meta)) return { goal: null, platforms: null, scopeTags: null };
  const goalChars = typeof meta.goal === "string" ? [...meta.goal].length : 0;
  const goal = typeof meta.goal === "string" && meta.goal.trim() && goalChars <= IMPORT_GOAL_MAX_CHARS
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(meta.goal) ? meta.goal : null;
  let platforms: string[] | null = null;
  try {
    platforms = [...rt.packaging.validateRequestedPlatforms(meta.platforms)];
  } catch {
    platforms = null;
  }
  const tags = meta.evidenceScope?.tags;
  let scopeTags: string[] | null = null;
  if (Array.isArray(tags) && tags.length > 0 && tags.length <= IMPORT_SCOPE_MAX_TAGS
    && tags.every((t: unknown) => typeof t === "string" && t.length > 0 && [...t].length <= IMPORT_SCOPE_MAX_TAG_CHARS)) {
    try {
      const normalized = lib.normalizeScopeTags(tags.join(","));
      if (JSON.stringify(normalized) === JSON.stringify(tags)) scopeTags = normalized;
    } catch {
      scopeTags = null;
    }
  }
  return { goal, platforms, scopeTags };
}

/**
 * The import's decision. `source` is the import's own stored files; `pinned` is
 * the fact version its lineage copied at creation (null without lineage);
 * `versionBySha` finds a fact version by sha256, whatever its status.
 */
export async function decideImport(input: {
  source: RunSource;
  pinned: ImportFactVersion | null;
  versionBySha: (sha256: string) => Promise<ImportFactVersion | null>;
  approvedFacts: { bytes: Buffer; sha256: string };
  runtime: ContentRunRuntime;
}): Promise<ImportDecision> {
  const rt = input.runtime;
  const metaBytes = await input.source.readArtifact("run-meta.json");
  let meta: unknown;
  try {
    meta = metaBytes === undefined ? undefined : JSON.parse(Buffer.from(metaBytes).toString("utf8"));
  } catch {
    meta = undefined;
  }
  const bounds = boundedImportMetadata(rt, meta);
  const recorded = isPlainObject(meta)
    ? { approved: hexOrNull(meta.approvedFacts?.sha256), pack: hexOrNull(meta.evidencePackSha256) }
    : { approved: null, pack: null };
  const archived = (failureClass: string, message: string): ImportDecision => ({
    tier: "archived_unverified", failureClass, message: bounded(message), ...bounds,
    approvedFactsSha256: recorded.approved, evidencePackSha256: recorded.pack,
  });

  // 1. A complete folder.
  const missing: string[] = [];
  for (const name of IMPORT_REQUIRED_FILES) if ((await input.source.readArtifact(name)) === undefined) missing.push(name);
  if (missing.length) {
    return archived("incomplete_folder", `the folder has no ${missing.join(", ")}; only a complete run folder (run-meta.json and `
      + "stages 1–6) can be revalidated, so replay folders and failed runs are kept as archives");
  }
  if (!isPlainObject(meta)) return archived("incomplete_folder", "run-meta.json is not a JSON object, so the run cannot be revalidated");
  // 2. The approved facts at this worker's commit.
  if (recorded.approved !== input.approvedFacts.sha256) {
    return archived("approved_facts_changed", `config/approved-facts.json has changed since this run: recorded `
      + `${recorded.approved ?? "no sha256"}, now ${input.approvedFacts.sha256}; the rebuilt evidence pack would not be the one the run used`);
  }
  // 3. The fact version the folder names (or its source's pin, which must be that same file).
  const named = hexOrNull(meta.automotiveFacts?.sha256);
  if (named === null) {
    return archived("fact_version_missing", "run-meta.json records no automotive facts sha256, so no fact version can be pinned");
  }
  const version = input.pinned ?? await input.versionBySha(named);
  if (!version) {
    return archived("fact_version_missing", `no fact version has sha256 ${named}; upload that facts file, then import the folder again`);
  }
  if (version.sha256 !== named) {
    return archived("fact_version_mismatch", `the source import's pinned fact version (sha256 ${version.sha256}) is not the facts `
      + `file this folder names (sha256 ${named})`);
  }
  // 4. The library's own verification, in revision mode.
  const automotiveFacts: FactFile = {
    path: `studio fact version ${version.sha256}`, displayPath: AUTOMOTIVE_FACTS_DISPLAY_PATH,
    exists: () => true, read: async () => new Uint8Array(version.content),
  };
  const approvedFacts: FactFile = {
    path: APPROVED_FACTS_PATH, displayPath: APPROVED_FACTS_PATH, exists: () => true,
    read: async () => new Uint8Array(input.approvedFacts.bytes),
  };
  let verified: Awaited<ReturnType<typeof lib.verifySourceRun>>;
  try {
    verified = await lib.verifySourceRun(rt, {
      runner: "live", facts: { approvedFacts, automotiveFacts }, reviewedAt: new Date().toISOString(), reviewedAtExplicit: false,
    }, input.source, null, { reporter: { log: () => {}, warn: () => {} }, confirmUnproven: lib.refuseUnprovenAutomotiveFacts },
    { revise: true });
  } catch (error) {
    return archived("revalidation_failed", String((error as Error)?.message ?? error));
  }
  return {
    tier: "verified",
    goal: verified.goal,
    platforms: [...verified.platforms],
    scopeTags: verified.scope ? [...verified.scope.tags] : null,
    factVersionId: version.id,
    approvedFactsSha256: verified.fingerprints.approvedFacts.sha256,
    automotiveFactsSha256: verified.fingerprints.automotiveFacts.sha256!,
    evidencePackSha256: verified.fingerprints.evidencePackSha256,
  };
}

/** The critic's verdict, when the stored artifact names one of the schema's three. */
function storedVerdict(bytes: Uint8Array | undefined): string | null {
  try {
    const verdict = bytes ? JSON.parse(Buffer.from(bytes).toString("utf8"))?.output?.provisional?.verdict : null;
    return VERDICTS.includes(verdict) ? verdict : null;
  } catch {
    return null;
  }
}

/**
 * The outcome, in ONE transaction, in this order: the run's metadata (and, on
 * a verified import, its fact version and automotive fingerprint, while the
 * run is still running); the findings rebuilt from its stored critic
 * artifact; the run's end — `succeeded`, with its tier, its other fingerprints
 * and, when archived, its class and reason — while its import job is running,
 * as migration 0004 requires of `verified`; the job's end; and an audit row of
 * classes only.
 */
export async function writeImportOutcome(
  session: Pick<WorkerSession, "tx">, ids: { runId: string; jobId: string }, decision: ImportDecision,
  verdict: string | null, findings: (client: SqlClient) => Promise<unknown>,
): Promise<void> {
  await session.tx(async (client) => {
    await client.query(
      `UPDATE studio_runs SET goal = $2, platforms = $3, scope_tags = $4,
              fact_version_id = COALESCE(fact_version_id, $5::uuid), automotive_facts_sha256 = $6
        WHERE id = $1 AND state = 'running'`,
      [ids.runId, decision.goal, decision.platforms, decision.scopeTags,
        decision.tier === "verified" ? decision.factVersionId : null,
        decision.tier === "verified" ? decision.automotiveFactsSha256 : null]);
    await findings(client);
    const ended = await client.query(
      `UPDATE studio_runs SET state = 'succeeded', import_tier = $2, failure_class = $3, failure_message = $4, verdict = $5,
              approved_facts_sha256 = $6, evidence_pack_sha256 = $7, finished_at = now()
        WHERE id = $1 AND state = 'running'`,
      [ids.runId, decision.tier, decision.tier === "verified" ? null : decision.failureClass,
        decision.tier === "verified" ? null : decision.message, verdict, decision.approvedFactsSha256, decision.evidencePackSha256]);
    if (ended.rowCount !== 1) throw new Error("the import is no longer running");
    await client.query("UPDATE studio_jobs SET state = 'finished' WHERE id = $1", [ids.jobId]);
    await audit(client, "import.outcome", "studio_runs", ids.runId, decision.tier === "verified"
      ? { tier: "verified" } : { tier: "archived_unverified", failure_class: decision.failureClass });
  });
}

/** An import's stored files, as the library's source. */
function storedSource(session: WorkerSession, runId: string): RunSource {
  return {
    label: `studio-import:${runId}`, displayLabel: `studio-import:${runId}`, name: `studio-import-${runId}`,
    exists: async () => true,
    readArtifact: async (name) => {
      const row = (await session.query("SELECT content FROM studio_run_artifacts WHERE run_id = $1 AND name = $2", [runId, name])).rows[0];
      return row ? new Uint8Array(row.content as Buffer) : undefined;
    },
  };
}

/** One claimed import job, revalidated and ended. Logs classes only (design §9.2). */
export async function runImport(ctx: WorkerJobContext, job: ClaimedJob, log: WorkerLog): Promise<string> {
  const { session } = ctx;
  const runId = job.runId!;
  const run = (await session.query(
    `SELECT r.kind, r.fact_version_id::text AS fact_version_id, v.sha256 AS v_sha, v.content AS v_content
       FROM studio_runs r LEFT JOIN studio_fact_versions v ON v.id = r.fact_version_id WHERE r.id = $1`, [runId])).rows[0];
  const source = storedSource(session, runId);
  let decision: ImportDecision;
  if (run?.kind !== "imported") {
    decision = { tier: "archived_unverified", failureClass: "not_an_import", message: "an import job runs only an import",
      goal: null, platforms: null, scopeTags: null, approvedFactsSha256: null, evidencePackSha256: null };
  } else {
    try {
      decision = await decideImport({
        source,
        pinned: run.fact_version_id ? { id: run.fact_version_id, sha256: run.v_sha, content: run.v_content as Buffer } : null,
        versionBySha: async (sha) => {
          const row = (await session.query(
            "SELECT id::text AS id, sha256, content FROM studio_fact_versions WHERE sha256 = $1", [sha])).rows[0];
          return row ? { id: row.id, sha256: row.sha256, content: row.content as Buffer } : null;
        },
        approvedFacts: ctx.approvedFacts, runtime: ctx.runtime,
      });
    } catch (error) {
      decision = { tier: "archived_unverified", failureClass: "revalidation_failed", message: bounded(String((error as Error)?.message ?? error)),
        goal: null, platforms: null, scopeTags: null, approvedFactsSha256: null, evidencePackSha256: null };
    }
  }
  const verdict = storedVerdict(await source.readArtifact("06-final-critic.json"));
  try {
    await writeImportOutcome(session, { runId, jobId: job.jobId }, decision, verdict,
      (client) => rebuildFindings(client, ctx.runtime, runId, log));
  } catch {
    // The database refused the outcome: the import is archived instead, in one transaction with its job's end;
    // should that be refused too, the run is ended failed and the schema archives it (fail closed).
    if (session.lost) throw session.lost;
    const fallback: ImportDecision = { tier: "archived_unverified", failureClass: "outcome_refused",
      message: "the database refused this import's outcome; it is kept as an archive", goal: null, platforms: null, scopeTags: null,
      approvedFactsSha256: null, evidencePackSha256: null };
    try {
      await writeImportOutcome(session, { runId, jobId: job.jobId }, fallback, null, async () => undefined);
      decision = fallback;
    } catch {
      if (session.lost) throw session.lost;
      await session.tx((client) => terminalize(client, runId, job.jobId, {
        runState: "failed", jobState: "finished", failureClass: "outcome_not_written",
        failureMessage: "the import's outcome could not be written; it is kept as an archive",
      }));
      return "outcome_not_written";
    }
  }
  return decision.tier;
}
