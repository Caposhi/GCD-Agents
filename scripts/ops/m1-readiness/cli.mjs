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

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { categorizeError } from "../lib/errorCategories.mjs";
import { PreconditionError } from "./repository.mjs";
import { EXIT, collectEvidence, readConnectionString, readToken } from "./runner.mjs";
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
    if (runtime.interrupted) {
      process.stderr.write("interrupted before evidence could be written\n");
      process.exitCode = EXIT.INTERRUPTED;
    } else if (error instanceof PreconditionError) {
      process.stderr.write(`repository precondition failed — ${error.message}\n`);
      process.exitCode = EXIT.PRECONDITION_FAILED;
    } else {
      // Nothing from the error's own message is repeated: it may have come from
      // a driver or a remote response.
      process.stderr.write(
        `M1 readiness runner did not complete. error_category=${categorizeError(error)}\n`,
      );
      process.exitCode = EXIT.NOT_ESTABLISHED;
    }
  } finally {
    // Every registered cleanup is awaited before the process is allowed to end,
    // so no child process and no database session outlives this call.
    await runtime.shutdown();
    runtime.removeSignalHandlers();
  }
};

await main();
