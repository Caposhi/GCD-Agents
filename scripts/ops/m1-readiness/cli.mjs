#!/usr/bin/env node
/**
 * M1 readiness evidence runner — repository and database portions only.
 *
 * REQUIRES OPERATOR ACTION for the database phases. No agent session in this
 * repository has been given, or may request, a production database credential.
 *
 * Usage, from a normal clean checkout, AFTER the repository's ordinary locked
 * installation command (`npm ci`):
 *
 *   node scripts/ops/m1-readiness/cli.mjs [--out-dir <path>]
 *
 * With no connection string the repository and CI phases run and the two
 * database phases are recorded as `NOT ATTEMPTED`. To include them, set the
 * read-only connection in your OWN shell:
 *
 *   export GCD_AUDIT_DATABASE_URL='postgres://READONLY_USER@host:5432/dbname'
 *
 * The variable is deliberately not `DATABASE_URL`, so this cannot run by
 * accident against whatever happens to be exported in a deploy shell. Never
 * paste a production credential into chat, into a pull request, or into source
 * control. `GITHUB_TOKEN`, if set, raises the API rate limit; it is used and
 * never recorded.
 *
 * The artifact `A` is the verified `HEAD` of this checkout. There is no flag and
 * no environment variable that can supply a different one.
 *
 * Exit codes: 0 every attempted phase established its fact; 1 evidence was
 * written but something was not established; 2 a repository precondition
 * failed and no evidence was written; 130 interrupted.
 */

import { realpathSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { categorizeError } from "../lib/errorCategories.mjs";
import { PreconditionError } from "./repository.mjs";
import { EXIT, collectEvidence, readConnectionString, readToken } from "./runner.mjs";
import { STOP_OUTCOME } from "./runtime.mjs";
import { Runtime } from "./runtime.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

const USAGE = `M1 readiness evidence runner (repository and database portions only)

  node scripts/ops/m1-readiness/cli.mjs [--out-dir <path>]

  --out-dir <path>  where the evidence file and summary are written.
                    Default: a new directory under the system temp directory,
                    so the checkout this runner is reading stays clean.
  --help            print this message.

The artifact A is the verified HEAD of this checkout and cannot be overridden.
Set GCD_AUDIT_DATABASE_URL in your own shell to include the two read-only
database phases; without it they are recorded as NOT ATTEMPTED.
`;

const parseArgs = (argv) => {
  /** @type {{ outDir: string | null, help: boolean }} */
  const out = { outDir: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--out-dir") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--out-dir requires a path");
      }
      out.outDir = value;
      i += 1;
    } else {
      throw new Error(`unrecognised argument ${JSON.stringify(arg)}`);
    }
  }
  return out;
};

/**
 * The exact operator-facing report for a run that did not complete.
 *
 * Pure, and exported, so the offline suite asserts the REAL bytes an operator
 * sees rather than a paraphrase of them.
 *
 * Whether this run could CONFIRM it removed its own output is a fact SEPARATE
 * from whether the work acknowledged cancellation. A run can stop perfectly
 * cooperatively — `cancellation_acknowledged`, `confirmedStopped === true` — and
 * still have failed to remove a file it had already published. So no branch may
 * claim that nothing was written until cleanup is known to have been confirmed.
 *
 * @param {{ error: any, interrupted: boolean, outDir: string }} input
 * @returns {{ text: string, exitCode: number }}
 */
export const describeFailure = ({ error, interrupted, outDir }) => {
  const cleanupUnconfirmed = error?.externalCleanupConfirmed === false;
  // The output directory is named because the operator has to go and look at it.
  // Nothing else is: not the connection string, not the token, and not any path
  // this run was merely reading.
  const residual = cleanupUnconfirmed
    ? "WARNING: this run could not confirm that it removed its own output.\n" +
      `Files may remain in: ${outDir}\n` +
      "Do NOT trust or use any evidence file in that directory. This run did not complete, so\n" +
      "anything left there is either incomplete or not this run's output. Inspect the directory\n" +
      "and remove its contents manually before relying on any evidence or rerunning.\n"
    : "";

  if (interrupted) {
    return {
      text:
        (cleanupUnconfirmed
          ? "interrupted; this run's output was NOT confirmed removed\n"
          : "interrupted before evidence could be written\n") + residual,
      exitCode: EXIT.INTERRUPTED,
    };
  }
  if (error instanceof PreconditionError) {
    return {
      text: `repository precondition failed — ${error.message}\n` + residual,
      exitCode: EXIT.PRECONDITION_FAILED,
    };
  }
  // Nothing from the error's own message is repeated: it may have come from a
  // driver or a remote response. What IS reported is the categorized stop
  // outcome, because "the promise settled" and "the work was cancelled" are
  // different facts and an operator acts on them differently.
  const category = categorizeError(error);
  const phrasing = {
    [STOP_OUTCOME.CANCELLATION_ACKNOWLEDGED]: "stop_confirmed=cancellation acknowledged",
    [STOP_OUTCOME.EXTERNAL_CLEANUP_CONFIRMED]:
      "stop_confirmed=no (external resources released, but the work never acknowledged cancellation)",
    [STOP_OUTCOME.SETTLED_WITHOUT_CANCELLATION]:
      "stop_confirmed=no (the work IGNORED cancellation and then completed normally — nothing was cancelled)",
    [STOP_OUTCOME.STOP_UNCONFIRMED]:
      "stop_confirmed=NO (the work never confirmed it finished — it may still be running)",
  };
  const outcome = error?.stopOutcome ? ` ${phrasing[error.stopOutcome] ?? ""}` : "";
  const by = error?.stoppedBy ? ` stopped_by=${error.stoppedBy}` : "";
  return {
    text: `M1 readiness runner did not complete. error_category=${category}${by}${outcome}\n` + residual,
    exitCode: EXIT.NOT_ESTABLISHED,
  };
};

const main = async () => {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exitCode = EXIT.PRECONDITION_FAILED;
    return;
  }
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  const runtime = new Runtime();
  runtime.installSignalHandlers((signal) => {
    process.stderr.write(`\nreceived ${signal}: stopping new work and cancelling in-flight reads\n`);
  });

  const connectionString = readConnectionString();
  const token = readToken();
  const outDir = args.outDir
    ? resolve(process.cwd(), args.outDir)
    : await mkdtemp(join(tmpdir(), "gcd-m1-readiness-"));

  try {
    const result = await collectEvidence({
      repoRoot: REPO_ROOT,
      outDir,
      runtime,
      connectionString,
      token,
    });
    process.stdout.write(result.summaryText);
    process.stdout.write(`\nevidence: ${result.evidencePath}\nsummary:  ${result.summaryPath}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    const { text, exitCode } = describeFailure({
      error,
      interrupted: runtime.interrupted,
      outDir,
    });
    process.stderr.write(text);
    process.exitCode = exitCode;
  } finally {
    // Every registered cleanup is awaited before the process is allowed to end,
    // so no child process and no database CLIENT connection this process opened
    // outlives this call. Server-side backend termination is bounded by the
    // session's configured timeouts, not by this shutdown.
    await runtime.shutdown();
    runtime.removeSignalHandlers();
  }
};

// Run only when this file IS the program. Importing it — which the offline suite
// does, to assert the exact operator-facing text of `describeFailure` rather
// than a paraphrase of it — must not execute a readiness run as a side effect.
// The suite also asserts that invoking this file as a program still works.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await main();
}
