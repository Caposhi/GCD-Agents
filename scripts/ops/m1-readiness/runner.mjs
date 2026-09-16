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
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BOUNDS_SOURCE } from "../lib/aggregateAudit.mjs";
import { computeMigrationState } from "../lib/migrationState.mjs";
import { CANCELLATION_SETTLE_MS, RUNNER_TOTAL_MS } from "./deadlines.mjs";
import { CONNECTION_ENV, readMigrationState, runAggregateAudit } from "./database.mjs";
import { buildEvidence, renderEvidenceDocument, renderSummary } from "./evidence.mjs";
import { TOKEN_ENV, verifyExactHeadCi } from "./github.mjs";
import { PreconditionError, establishArtifact } from "./repository.mjs";
import { checkpoint, settleWithin, withDeadline } from "./runtime.mjs";

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
 * Refuse to run if either authoritative target already exists.
 *
 * The alternative — back the file up and restore it on rollback — adds a second
 * failure mode (a rollback that itself fails, leaving neither the old file nor
 * the new one) to protect a case no documented behaviour asks for: nothing in
 * this runner is specified to overwrite an operator's existing evidence. So the
 * precondition is absence, and because the run then only ever removes paths IT
 * promoted, no pre-existing file can be deleted or modified by a rollback.
 *
 * @param {string[]} targets
 */
const assertTargetsAbsent = async (targets) => {
  for (const target of targets) {
    try {
      await stat(target);
    } catch (error) {
      if (/** @type {{ code?: string }} */ (error)?.code === "ENOENT") continue;
      throw error;
    }
    throw new PreconditionError(
      `output_target_exists: ${target} already exists; this runner never overwrites an ` +
        "existing evidence file. Move or remove it, or choose another output directory.",
    );
  }
};

/**
 * Stage one output as an exclusive temporary beside its target and verify the
 * bytes landed, WITHOUT promoting it.
 *
 * Staging both files before promoting either is what makes the output set
 * all-or-nothing: a failure while preparing the second file happens before the
 * first has become authoritative.
 *
 * @param {string} target @param {string} text @param {Set<string>} temporaries
 */
const stageOutput = async (target, text, temporaries) => {
  const tmp = `${target}.tmp-${randomBytes(6).toString("hex")}`;
  temporaries.add(tmp);
  // `wx` so a collision is an error rather than an overwrite.
  await writeFile(tmp, text, { encoding: "utf8", flag: "wx" });
  const written = await readFile(tmp, "utf8");
  if (written !== text) {
    throw new Error(`staged output ${target} did not match what was rendered`);
  }
  return tmp;
};

/**
 * Collect the repository and database portions of M1 readiness evidence.
 *
 * ## One truthful total deadline
 *
 * EVERY phase is inside {@link RUNNER_TOTAL_MS}: the repository preconditions,
 * the CI read, both database reads, building the document, rendering it, and
 * publishing both outputs. A total deadline that covered only the first phase
 * would be a number in a report rather than a bound on the program, and the
 * phases it excluded would be unbounded.
 *
 * The total deadline bounds WORK, not the return time. When it expires it
 * initiates cancellation and prevents every later phase and every authoritative
 * output; this function may then return AFTER that instant while bounded
 * settlement and cleanup finish. The extra wait is bounded by
 * {@link CANCELLATION_SETTLE_MS} plus the bounded cleanup it contains — read the
 * worst case off those constants rather than a number written in prose.
 * Returning late is not permission to collect anything further or to promote
 * output: both are already refused.
 *
 * When that deadline or an operator interrupt wins, `withDeadline` cancels the
 * work and waits for it to confirm it has stopped; `onCancel` here shuts down
 * every registered cleanup (database client sockets, child processes), removes
 * every temporary, and removes every target this run had already promoted.
 * Nothing this call started is still running, and neither a partial file nor a
 * half-published output set is left, when it returns.
 *
 * ## The output set is all-or-nothing
 *
 * Both authoritative targets must be ABSENT before the run stages anything, both
 * are staged and validated before either is promoted, the boundary is guarded
 * immediately before and after each rename, and the set is marked complete only
 * once the second promotion has succeeded. Until then any failure path removes
 * every target this run promoted; after then, later cleanup never does. A failed
 * run can therefore never leave a complete-looking evidence document without its
 * completed companion summary.
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
 * @param {(index: number, target: string) => void | Promise<void>} [input.onStage]
 *   a TEST-ONLY seam invoked immediately BEFORE each output is staged, so a
 *   regression can fail the preparation of the second temporary deterministically.
 * @param {(index: number, target: string) => void | Promise<void>} [input.onPromotion]
 *   a TEST-ONLY seam invoked immediately after each authoritative rename, so a
 *   regression can stop the run at the exact promotion boundary instead of
 *   racing a timer. Neither production call site passes it, and the offline
 *   suite asserts that from source.
 * @param {number} [input.totalMs] the total deadline. Defaults to the fixed
 *   {@link RUNNER_TOTAL_MS}; overridden ONLY by the test suite, which cannot
 *   wait four minutes to prove a four-minute bound works. Both production call
 *   sites omit it, and the offline suite asserts that from source.
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
  totalMs = RUNNER_TOTAL_MS,
  onPromotion = null,
  onStage = null,
}) => {
  /** Temporary output paths in flight, so a cancellation can remove them. */
  const temporaries = new Set();
  /**
   * The authoritative targets THIS run has promoted, and whether the complete
   * two-file set was committed.
   *
   * Tracking promotions — not only temporaries — is what makes the output
   * all-or-nothing. Promoting the evidence file and then failing before the
   * summary used to leave a complete, valid evidence file behind for a run that
   * had failed, which is worse than leaving nothing: it looks like a result.
   */
  const promoted = new Set();
  let outputComplete = false;

  /**
   * Remove every target this run promoted, unless the complete set was
   * committed. Only paths in `promoted` are touched, and the precondition above
   * guarantees each of those was absent before the run, so no pre-existing file
   * can be removed or modified here.
   */
  const rollbackPromoted = async () => {
    if (outputComplete) return 0;
    const targets = [...promoted];
    const results = await Promise.allSettled(targets.map((t) => rm(t, { force: true })));
    promoted.clear();
    return results.filter((r) => r.status === "rejected").length;
  };

  /** Remove staged temporaries. Idempotent: a second call finds nothing to do. */
  const rollbackTemporaries = async () => {
    const paths = [...temporaries];
    const results = await Promise.allSettled(paths.map((tmp) => rm(tmp, { force: true })));
    temporaries.clear();
    return results.filter((r) => r.status === "rejected").length;
  };

  const onCancel = async () => {
    // Database sockets and child processes first, then any partial output, then
    // any authoritative file this run promoted before it was stopped.
    //
    // Bounded: a cleanup that hangs must not turn a stopped run into a hung
    // process, so the whole sequence is awaited under a fixed allowance.
    let failedCleanups = 0;
    let failedRemovals = 0;
    await settleWithin(
      (async () => {
        failedCleanups = await runtime.shutdown();
        failedRemovals = (await rollbackTemporaries()) + (await rollbackPromoted());
      })(),
      CANCELLATION_SETTLE_MS,
    );
    // Returning `true` is an assertion that external resources were released and
    // no partial output survives — read as independent confirmation, so it is
    // only claimed when every cleanup actually succeeded.
    return failedCleanups === 0 && failedRemovals === 0 && temporaries.size === 0 &&
      (outputComplete || promoted.size === 0);
  };

  return withDeadline(
    runtime,
    "M1 readiness runner",
    totalMs,
    // The total deadline's signal is a PARAMETER, not something discarded. It
    // is also linked into the runtime below, so every nested operation — every
    // git read, GitHub request and database statement — observes it too.
    async (totalSignal) => {
      /** Throws the moment the total deadline (or an operator) has stopped us. */
      const guard = (label) => checkpoint(runtime, label, totalSignal);

      try {
        guard("repository preconditions");
        const repository = await establishArtifact({ repoRoot, runtime });
        const artifactEntries = repository.migration_entries;

        guard("CI evidence");
        const ci = await verifyExactHeadCi({ artifact: repository.artifact, runtime });

        let migrationState = migrationStateNotAttempted(artifactEntries);
        let aggregateAudit = aggregateAuditNotAttempted();

        if (connectionString) {
          guard("migration-state read");
          migrationState = await readMigrationState({
            connectionString,
            milestone: MILESTONE,
            artifactEntries,
            runtime,
          });

          guard("aggregate audit");
          aggregateAudit = await runAggregateAudit({ connectionString, repoRoot, runtime });
        }

        // --- rendering and output, inside the same deadline -------------------
        guard("evidence output");
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
        guard("evidence write");
        await mkdir(outDir, { recursive: true });
        // Directory creation is itself inside the deadline, so an expiry during
        // mkdir stops here rather than proceeding to write.
        guard("evidence directory");
        const evidencePath = resolve(outDir, EVIDENCE_FILENAME);
        const summaryPath = resolve(outDir, SUMMARY_FILENAME);

        // Re-checked here, not only at entry: the directory may have gained a
        // target while the phases ran.
        await assertTargetsAbsent([evidencePath, summaryPath]);

        // --- phase 1: stage BOTH outputs, promoting neither -------------------
        /** @type {Array<[string, string]>} */
        const staged = [];
        let stageIndex = 0;
        for (const [target, text] of [
          [evidencePath, evidenceText],
          [summaryPath, summaryText],
        ]) {
          guard("evidence staging");
          if (onStage) await onStage(stageIndex, target);
          staged.push([await stageOutput(target, text, temporaries), target]);
          stageIndex += 1;
        }

        // --- phase 2: promote, guarding on both sides of every rename ---------
        //
        // A stop observed after a rename still rolls the whole set back: the run
        // failed, so it publishes nothing. The set is marked complete only once
        // BOTH targets are in place and the final guard has passed.
        let index = 0;
        for (const [tmp, target] of staged) {
          guard("evidence promotion");
          await rename(tmp, target);
          temporaries.delete(tmp);
          promoted.add(target);
          if (onPromotion) await onPromotion(index, target);
          guard("evidence promotion");
          index += 1;
        }
        outputComplete = true;

        // --- cleanup, also inside the same deadline ---------------------------
        // From here the results are valid and committed; `outputComplete` makes
        // every later rollback a no-op, so cleanup cannot remove them.
        guard("cleanup");
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
          promotedCount: promoted.size,
          outputComplete,
          exitCode: established ? EXIT.COMPLETE : EXIT.NOT_ESTABLISHED,
        };
      } catch (error) {
        // Any failure before the set was committed — a precondition, a phase
        // error, a rename failure, an expired guard — removes whatever this run
        // staged or promoted. `withDeadline`'s `onCancel` covers the stop paths;
        // this covers the ordinary-throw paths it never sees.
        await settleWithin(
          (async () => {
            await rollbackTemporaries();
            await rollbackPromoted();
          })(),
          CANCELLATION_SETTLE_MS,
        );
        throw error;
      }
    },
    // `linkAsTotal` publishes this deadline to the runtime, which is what makes
    // it reach the phases instead of only wrapping them.
    { onCancel, linkAsTotal: true },
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
