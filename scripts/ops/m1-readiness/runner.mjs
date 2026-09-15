/**
 * The orchestration module: four read-only phases, one evidence document.
 *
 *   1. repository preconditions, which also establish the artifact `A`;
 *   2. exact-head CI evidence for `A`;
 *   3. the §4.4.2 migration-state read, bound to `A`;
 *   4. the §4.1 aggregate-only evidence audit.
 *
 * Phases 3 and 4 run only when the operator has supplied a read-only connection
 * string; without one they are recorded as `NOT ATTEMPTED`, which is a fact, not
 * a failure. Phase 2 never blocks the run: a refusal is a recorded verdict.
 *
 * The whole run is wrapped in the fixed total deadline, and an operator
 * interrupt stops new phases immediately. Whatever happens after `A` is
 * established, the evidence document is written, so a partial run leaves a
 * record that says exactly how far it got and asserts nothing further.
 */

import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BOUNDS_SOURCE } from "../lib/aggregateAudit.mjs";
import { computeMigrationState } from "../lib/migrationState.mjs";
import { RUNNER_TOTAL_MS } from "./deadlines.mjs";
import { CONNECTION_ENV, readMigrationState, runAggregateAudit } from "./database.mjs";
import { buildEvidence, renderEvidenceDocument, renderSummary } from "./evidence.mjs";
import { TOKEN_ENV, verifyExactHeadCi } from "./github.mjs";
import { establishArtifact } from "./repository.mjs";
import { checkpoint, withDeadline } from "./runtime.mjs";

export const EVIDENCE_FILENAME = "m1-readiness-evidence.json";
export const SUMMARY_FILENAME = "m1-readiness-summary.txt";

/** The only milestone this runner knows. */
export const MILESTONE = "M1";

export const EXIT = Object.freeze({
  COMPLETE: 0,
  NOT_ESTABLISHED: 1,
  PRECONDITION_FAILED: 2,
  INTERRUPTED: 130,
});

/** @param {readonly string[]} artifactEntries */
const migrationStateNotAttempted = (artifactEntries) => ({
  status: "NOT ATTEMPTED",
  error_category: null,
  session: null,
  ...computeMigrationState({
    milestone: MILESTONE,
    artifactEntries,
    appliedNames: null,
  }),
});

const aggregateAuditNotAttempted = () => ({
  status: "NOT ATTEMPTED",
  error_category: null,
  verdict: "NOT ESTABLISHED",
  bounds_source: BOUNDS_SOURCE,
  session: null,
});

/**
 * Write a file atomically: a uniquely named temporary beside the target, then a
 * rename.
 *
 * A reader of the output directory therefore sees either no file or a complete
 * one, never a half-written evidence document. The temporary path is handed to
 * the caller so a cancellation can remove it: a run that was stopped must leave
 * no partial output behind either.
 *
 * @param {string} target
 * @param {string} text
 * @param {Set<string>} temporaries
 */
const writeAtomic = async (target, text, temporaries) => {
  const tmp = `${target}.tmp-${randomBytes(6).toString("hex")}`;
  temporaries.add(tmp);
  try {
    // `wx` so a collision is an error rather than an overwrite.
    await writeFile(tmp, text, { encoding: "utf8", flag: "wx" });
    await rename(tmp, target);
    temporaries.delete(tmp);
  } catch (error) {
    await rm(tmp, { force: true });
    temporaries.delete(tmp);
    throw error;
  }
};

/**
 * Collect the repository and database portions of M1 readiness evidence.
 *
 * ## One truthful total deadline
 *
 * EVERYTHING is inside {@link RUNNER_TOTAL_MS}: the repository preconditions,
 * the CI read, both database reads, building the document, rendering it,
 * writing both outputs atomically, cleaning up, and returning. A total deadline
 * that covered only the first phase would be a number in a report rather than a
 * bound on the program, and the phases it excluded would be unbounded.
 *
 * When that deadline or an operator interrupt wins, `withDeadline` cancels the
 * work and waits for it to confirm it has stopped; `onCancel` here shuts down
 * every registered cleanup (database sockets, child processes) and removes any
 * temporary output. Nothing this call started is still running, and no partial
 * file is left, when it returns.
 *
 * Each phase boundary is a checkpoint, so a stop is observed BEFORE the next
 * phase begins rather than after it has already run.
 *
 * @param {object} input
 * @param {string} input.repoRoot the checkout to read; never cloned or changed
 * @param {string} input.outDir where the two output files are written
 * @param {import("./runtime.mjs").Runtime} input.runtime
 * @param {string} [input.connectionString] a READ-ONLY production connection
 * @param {string} [input.token] an optional GitHub API token
 * @param {() => string} [input.now] injected only so tests are deterministic
 * @param {string} [input.entrypoint]
 */
export const collectEvidence = async ({
  repoRoot,
  outDir,
  runtime,
  connectionString,
  token,
  now = () => new Date().toISOString(),
  entrypoint = "scripts/ops/m1-readiness/cli.mjs",
}) => {
  /** Temporary output paths in flight, so a cancellation can remove them. */
  const temporaries = new Set();

  const onCancel = async () => {
    // Database sockets and child processes first, then any partial output.
    await runtime.shutdown();
    await Promise.all([...temporaries].map((tmp) => rm(tmp, { force: true })));
    temporaries.clear();
  };

  return withDeadline(
    runtime,
    "M1 readiness runner",
    RUNNER_TOTAL_MS,
    async () => {
      checkpoint(runtime, "repository preconditions");
      const repository = await establishArtifact({ repoRoot, runtime });
      const artifactEntries = repository.migration_entries;

      checkpoint(runtime, "CI evidence");
      const ci = await verifyExactHeadCi({ artifact: repository.artifact, runtime });

      let migrationState = migrationStateNotAttempted(artifactEntries);
      let aggregateAudit = aggregateAuditNotAttempted();

      if (connectionString) {
        checkpoint(runtime, "migration-state read");
        migrationState = await readMigrationState({
          connectionString,
          milestone: MILESTONE,
          artifactEntries,
          runtime,
        });

        checkpoint(runtime, "aggregate audit");
        aggregateAudit = await runAggregateAudit({ connectionString, repoRoot, runtime });
      }

      // --- rendering and output, inside the same deadline -------------------
      checkpoint(runtime, "evidence output");
      const document = buildEvidence({
        generatedAt: now(),
        entrypoint,
        runtime: { interrupted: runtime.interrupted, interruptedBy: runtime.interruptedBy },
        repository,
        ci,
        migrationState,
        aggregateAudit,
      });

      const secrets = { connectionString, token };
      const evidenceText = renderEvidenceDocument(document, secrets);
      const summaryText = renderSummary(document, secrets);

      // Re-checked after rendering: an interrupt that arrived while the document
      // was being built must not produce a file.
      checkpoint(runtime, "evidence write");
      await mkdir(outDir, { recursive: true });
      const evidencePath = resolve(outDir, EVIDENCE_FILENAME);
      const summaryPath = resolve(outDir, SUMMARY_FILENAME);
      await writeAtomic(evidencePath, evidenceText, temporaries);
      await writeAtomic(summaryPath, summaryText, temporaries);

      // --- cleanup, also inside the same deadline ---------------------------
      await runtime.shutdown();

      const established =
        ci.status === "ESTABLISHED" &&
        migrationState.status === "READ" &&
        aggregateAudit.status === "AUDITED";

      return {
        document,
        evidenceText,
        summaryText,
        evidencePath,
        summaryPath,
        temporariesRemaining: temporaries.size,
        exitCode: established ? EXIT.COMPLETE : EXIT.NOT_ESTABLISHED,
      };
    },
    { onCancel },
  );
};

/**
 * The connection string, read from the operator's own shell.
 *
 * Deliberately NOT `DATABASE_URL`, so this cannot run by accident against
 * whatever happens to be exported in a deploy shell. Absent is a supported
 * state: the run then records the two database phases as `NOT ATTEMPTED`.
 */
export const readConnectionString = () => process.env[CONNECTION_ENV];

/** The optional GitHub token. Used, never recorded. */
export const readToken = () => process.env[TOKEN_ENV];
