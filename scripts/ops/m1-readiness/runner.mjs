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

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BOUNDS_SOURCE } from "../lib/aggregateAudit.mjs";
import { computeMigrationState } from "../lib/migrationState.mjs";
import { RUNNER_TOTAL_MS } from "./deadlines.mjs";
import { CONNECTION_ENV, readMigrationState, runAggregateAudit } from "./database.mjs";
import { buildEvidence, renderEvidenceDocument, renderSummary } from "./evidence.mjs";
import { TOKEN_ENV, ciNotEstablished, verifyExactHeadCi } from "./github.mjs";
import { establishArtifact } from "./repository.mjs";
import { withDeadline } from "./runtime.mjs";

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
 * Collect the repository and database portions of M1 readiness evidence.
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
  const repository = await withDeadline(runtime, "M1 readiness runner", RUNNER_TOTAL_MS, async () =>
    establishArtifact({ repoRoot, runtime }),
  );

  const artifactEntries = repository.migration_entries;

  const ci = runtime.interrupted
    ? ciNotEstablished(repository.artifact, "interrupted before the CI evidence read")
    : await verifyExactHeadCi({ artifact: repository.artifact, runtime });

  let migrationState = migrationStateNotAttempted(artifactEntries);
  let aggregateAudit = aggregateAuditNotAttempted();

  if (connectionString && !runtime.interrupted) {
    migrationState = await readMigrationState({
      connectionString,
      milestone: MILESTONE,
      artifactEntries,
      runtime,
    });
  }
  if (connectionString && !runtime.interrupted) {
    aggregateAudit = await runAggregateAudit({ connectionString, repoRoot, runtime });
  }

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

  await mkdir(outDir, { recursive: true });
  const evidencePath = resolve(outDir, EVIDENCE_FILENAME);
  const summaryPath = resolve(outDir, SUMMARY_FILENAME);
  await writeFile(evidencePath, evidenceText, "utf8");
  await writeFile(summaryPath, summaryText, "utf8");

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
    exitCode: runtime.interrupted
      ? EXIT.INTERRUPTED
      : established
        ? EXIT.COMPLETE
        : EXIT.NOT_ESTABLISHED,
  };
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
