/**
 * The library's `RunSink`, `RunSource` and `RunOutputs` over the Studio
 * database (docs/CONTENT_STUDIO_DESIGN.md §4.2, §5.1).
 *
 * - **Artifacts are byte for byte the CLI's files.** `writeArtifact` stores
 *   exactly the bytes the library hands it — a string as UTF-8, as the CLI's
 *   `writeFileSync` writes it — with its sha256 and length.
 * - **Rows are immutable once written** (the schema refuses an UPDATE), but
 *   the library rewrites a few files during a run, as the CLI overwrites them:
 *   `resume-meta.json`, `revision-meta.json` and the two field-measurement
 *   files. Those are held here and stored once, with their final bytes, when
 *   the run ends (`flush`). Every other artifact is stored as it is written.
 * - **A request row is committed before its request is sent** (by the unit
 *   check in `execute.ts`) and completed here, when the response arrives,
 *   with its measured tokens and cost. A cost that is unknown, or not a usable
 *   number, is left null, so the row stays charged its full ceiling.
 */

import { createHash } from "node:crypto";

import type { RecordedRequest, RunOutputs, RunSink, RunSource } from "../../harness/contentRun/index.js";
import { measuredMicros, microsToNumeric } from "./money.js";
import type { WorkerSession } from "./session.js";
import type { SqlClient } from "./spend.js";

/** Files the library writes more than once in a run; stored once, at the end, with their final bytes. */
export const REWRITTEN_ARTIFACTS = [
  "resume-meta.json", "revision-meta.json", "field-measurements.json", "field-measurements.md",
] as const;

const toBuffer = (bytes: string | Uint8Array) => (typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes));
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export const runLabel = (runId: string) => `studio-run:${runId}`;

async function insertArtifact(client: SqlClient, runId: string, name: string, bytes: Buffer): Promise<void> {
  await client.query(
    "INSERT INTO studio_run_artifacts (run_id, name, content, sha256, byte_length) VALUES ($1, $2, $3, $4, $5)",
    [runId, name, bytes, sha256(bytes), bytes.length]);
}

export class DbRunSink implements RunSink {
  readonly label: string;
  /** The final bytes of every artifact, by name, as the run wrote them. */
  readonly written = new Map<string, Buffer>();
  private readonly held = new Map<string, Buffer>();
  /** Set when the run's output is measured as live: request rows are completed. */
  constructor(private readonly session: WorkerSession, readonly runId: string, private readonly live: boolean) {
    this.label = runLabel(runId);
  }

  async writeArtifact(name: string, bytes: string | Uint8Array): Promise<void> {
    const buffer = toBuffer(bytes);
    if ((REWRITTEN_ARTIFACTS as readonly string[]).includes(name)) {
      this.held.set(name, buffer);
      this.written.set(name, buffer);
      return;
    }
    if (this.written.has(name)) {
      throw new Error(`the run wrote ${name} twice; a Studio artifact is immutable once stored`);
    }
    this.written.set(name, buffer);
    await this.session.run((client) => insertArtifact(client, this.runId, name, buffer));
  }

  /** Completes the response's `started` row: tokens, cost (or null), and its outcome. */
  async recordRequest(entry: RecordedRequest): Promise<void> {
    if (!this.live) return;
    const usage = (entry.usage ?? null) as Record<string, unknown> | null;
    const tokens = (key: string) => (Number.isSafeInteger(usage?.[key]) && (usage![key] as number) >= 0 ? usage![key] : null);
    const cost = measuredMicros(entry.totalCostUsd);
    const completed = await this.session.query(
      `UPDATE studio_run_requests SET outcome = $4, finished_at = now(), input_tokens = $5, output_tokens = $6, cost_usd = $7
        WHERE run_id = $1 AND stage = $2 AND lens IS NOT DISTINCT FROM $3 AND outcome = 'started'`,
      [this.runId, entry.stage, entry.lens ?? null, entry.failure ? "failed" : "succeeded",
        tokens("input_tokens"), tokens("output_tokens"), cost === null ? null : microsToNumeric(cost)]);
    if (completed.rowCount !== 1) {
      throw new Error(`a ${entry.stage} response arrived with no started request row; refusing to continue`);
    }
  }

  /** Stores every held artifact with its final bytes, in the caller's transaction, before the run ends. */
  async flush(client: SqlClient): Promise<void> {
    for (const name of [...this.held.keys()].sort()) await insertArtifact(client, this.runId, name, this.held.get(name)!);
    this.held.clear();
  }
}

/** A Studio run's artifacts as the library's source of a replay, resume or revision. */
export function dbRunSource(session: WorkerSession, runId: string): RunSource {
  return {
    label: runLabel(runId),
    displayLabel: runLabel(runId),
    name: `studio-run-${runId}`,
    exists: async () => (await session.query(
      "SELECT 1 FROM studio_runs WHERE id = $1 AND deleted_at IS NULL", [runId])).rows.length === 1,
    readArtifact: async (name) => {
      const row = (await session.query(
        "SELECT content FROM studio_run_artifacts WHERE run_id = $1 AND name = $2", [runId, name])).rows[0];
      return row ? new Uint8Array(row.content as Buffer) : undefined;
    },
  };
}

/**
 * The job's one run as the library's outputs. The library opens exactly one
 * output per action; a second open is refused. `opened` tells the worker
 * whether a failure came before or after the paid-action gate.
 */
export function dbRunOutputs(sink: DbRunSink): RunOutputs & { readonly opened: boolean } {
  let opened = false;
  const open = () => {
    if (opened) throw new Error("a Studio job opens exactly one run output");
    opened = true;
    return sink;
  };
  return {
    get opened() { return opened; },
    openFullRun: () => open(),
    openDerivedRun: () => open(),
  };
}
