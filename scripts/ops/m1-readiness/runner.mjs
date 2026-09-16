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
import { link, lstat, mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
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

/** The one message an occupied output target produces, wherever it is detected. */
const targetExists = (target) =>
  new PreconditionError(
    "output_target_exists",
    `${target} already exists; this runner never overwrites an existing evidence file. ` +
      "Move or remove it, or choose another output directory.",
  );

/**
 * An EARLY, FRIENDLY refusal when either authoritative target already exists.
 *
 * This check is deliberately NOT the no-overwrite guarantee. It is a `stat`, and
 * between it and the promotion below there is a window in which a concurrent
 * process can create the target; `rename()` would then silently replace that
 * file, because POSIX rename has no no-clobber mode. The authoritative guarantee
 * is the `link()` in {@link promoteOutput}, which either creates the name or
 * fails with `EEXIST` atomically. This function exists only so the common case —
 * the operator reruns into a directory that already holds evidence — fails
 * immediately with a clear message instead of after a full run.
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
    throw targetExists(target);
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
  // Beside its target, so the hard link that promotes it cannot cross a
  // filesystem boundary — `link()` is EXDEV across devices.
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
 * Promote one staged temporary to its authoritative name, atomically and
 * without ever overwriting anything.
 *
 * `rename()` cannot be used here: POSIX rename REPLACES an existing destination,
 * so a file created between the absence check and the promotion is destroyed
 * silently — and, because the target then joins the promoted set, deleted again
 * by rollback. `link()` is the atomic no-overwrite primitive: it either creates
 * the name or fails with `EEXIST`, leaving whatever is there untouched, and it
 * does so for a regular file, a directory and a symlink alike.
 *
 * The run-owned identity is read from the TEMPORARY, not from the target after
 * linking. The temporary was created `wx` in this directory by this run, so its
 * device and inode are ours by construction; the hard link shares them. Reading
 * the identity off the target instead would reintroduce a race, because a target
 * unlinked and recreated by someone else between `link` and `lstat` would then be
 * recorded as ours and deleted by rollback.
 *
 * The promotion is recorded BEFORE the temporary name is removed, so a failure in
 * that `unlink` still leaves a tracked authoritative target that rollback will
 * remove: it can never leave an unreported published file behind.
 *
 * @param {string} tmp @param {string} target
 * @param {Set<string>} temporaries @param {Map<string, {dev: number, ino: number}>} promoted
 */
const promoteOutput = async (tmp, target, temporaries, promoted) => {
  const staged = await lstat(tmp);
  try {
    await link(tmp, target);
  } catch (error) {
    // The authoritative no-overwrite answer. Whatever occupies the name — a file
    // that appeared after the early check, a directory, a symlink — is left
    // exactly as it is, and this run publishes nothing over it.
    if (/** @type {{ code?: string }} */ (error)?.code === "EEXIST") throw targetExists(target);
    throw error;
  }
  promoted.set(target, { dev: staged.dev, ino: staged.ino });
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
 * are staged and validated before either is promoted, each promotion is an atomic
 * no-overwrite `link()` guarded on both sides, and the set is marked complete only
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
 *   a TEST-ONLY seam invoked between the authoritative `link()` and the removal
 *   of the temporary name, so a regression can stop the run at the exact
 *   promotion boundary — or fail that removal — instead of racing a timer.
 *   Neither production call site passes it, and the offline suite asserts that
 *   from source.
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
  /** @type {Map<string, {dev: number, ino: number}>} */
  const promoted = new Map();
  /** Paths this run could not clean up, and so must warn the operator about. */
  const residual = new Set();
  let outputComplete = false;

  /**
   * Remove every target this run promoted, unless the complete set was
   * committed — and remove ONLY those, identified by filesystem identity rather
   * than by path.
   *
   * A path is not an identity. Between promotion and rollback the operator (or
   * any other process) may have replaced the file at that path with their own,
   * and deleting it because the name matches would destroy their data. So each
   * candidate is `lstat`-ed — never `stat`, so a symlink planted at the name is
   * inspected rather than followed — and unlinked only while its device and
   * inode still equal the ones this run published there.
   *
   * Three outcomes, all of them safe:
   *   - gone already: nothing to do, and not a failure;
   *   - still ours: unlinked;
   *   - someone else's now: left ALONE, counted as a failure, and recorded as
   *     residual so the operator is told the directory needs inspecting.
   */
  const rollbackPromoted = async () => {
    if (outputComplete) return 0;
    let failures = 0;
    for (const [target, identity] of promoted) {
      try {
        const current = await lstat(target);
        if (current.dev !== identity.dev || current.ino !== identity.ino) {
          // Not what we published. Never delete another writer's file.
          failures += 1;
          residual.add(target);
          continue;
        }
        await unlink(target);
      } catch (error) {
        if (/** @type {{ code?: string }} */ (error)?.code === "ENOENT") continue;
        failures += 1;
        residual.add(target);
      }
    }
    promoted.clear();
    return failures;
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
    // only claimed when every cleanup actually succeeded AND nothing was left
    // behind that this run could not remove.
    return failedCleanups === 0 && failedRemovals === 0 && temporaries.size === 0 &&
      residual.size === 0 && (outputComplete || promoted.size === 0);
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

        // --- phase 2: promote, guarding on both sides of every link -----------
        //
        // A stop observed after a promotion still rolls the whole set back: the run
        // failed, so it publishes nothing. The set is marked complete only once
        // BOTH targets are in place and the final guard has passed.
        let index = 0;
        for (const [tmp, target] of staged) {
          guard("evidence promotion");
          await promoteOutput(tmp, target, temporaries, promoted);
          // The seam fires between the link and the removal of the temporary
          // name, which is the only window in which requirement 12 — a failed
          // unlink after a successful link — can be injected deterministically.
          if (onPromotion) await onPromotion(index, target, tmp);
          // Only now is the temporary name removed. If this throws, the promotion
          // is already tracked, so the catch below rolls the target back rather
          // than leaving an unreported authoritative file.
          await unlink(tmp);
          temporaries.delete(tmp);
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
        // error, an occupied target, an expired guard — removes whatever this run
        // staged or promoted. `withDeadline`'s `onCancel` covers the stop paths;
        // this covers the ordinary-throw paths it never sees.
        let failedRemovals = 0;
        await settleWithin(
          (async () => {
            failedRemovals = (await rollbackTemporaries()) + (await rollbackPromoted());
          })(),
          CANCELLATION_SETTLE_MS,
        );
        // The PRIMARY error is preserved and rethrown — a cleanup failure must
        // not mask the reason the run failed. The cleanup result is recorded ON
        // it instead, so the CLI can warn about residual output without losing
        // the original cause. A stop-path error already carries a value computed
        // by `onCancel`; that one is authoritative and is never overwritten here.
        if (error && typeof error === "object") {
          const annotated = /** @type {{ externalCleanupConfirmed?: boolean, residualOutputs?: string[] }} */ (error);
          if (annotated.externalCleanupConfirmed === undefined) {
            annotated.externalCleanupConfirmed =
              failedRemovals === 0 && residual.size === 0 && temporaries.size === 0;
          }
          if (residual.size > 0) annotated.residualOutputs = [...residual];
        }
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
