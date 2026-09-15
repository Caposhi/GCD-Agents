/**
 * The runner's only external-process boundary: a fixed set of read-only git
 * reads against the checkout it is already standing in.
 *
 * This is deliberately NOT a command supervisor. There is no exported way to
 * run an arbitrary executable, and no exported way to pass an arbitrary
 * argument vector. Each operation below builds its own complete argv in source;
 * the private `runGit` helper additionally refuses any subcommand outside
 * {@link ALLOWED_SUBCOMMANDS}, so a future caller cannot widen the surface by
 * accident.
 *
 * Properties every invocation has:
 *
 *   - **fixed executable.** `git`, resolved from `PATH`, never a path taken
 *     from configuration or the environment.
 *   - **read-only, lock-free.** `--no-optional-locks` keeps the index untouched,
 *     so running this alongside an operator's own shell cannot contend with it.
 *   - **no hooks, templates, credential helpers, pagers or editors.** Each is
 *     disabled with an inline `-c` override, which configures THIS invocation
 *     only and writes nothing: the runner never modifies git configuration.
 *   - **sanitized environment.** The child's environment is built from scratch,
 *     so `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_CONFIG`,
 *     `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_SSH_COMMAND` and everything else
 *     inherited from the operator's shell cannot redirect the read.
 *   - **a fixed deadline**, supplied by `deadlines.mjs`, with no environment
 *     override.
 *   - **bounded output.** Output is capped; an oversized response is refused
 *     rather than buffered.
 *   - **termination that is awaited.** On a deadline or an operator interrupt
 *     the child is signalled and then AWAITED to its `close` event, so the
 *     runner never reports completion while a process it started is still
 *     running.
 *
 * ## Platform behaviour (macOS and Linux)
 *
 * The only platform-specific step is termination, and it is isolated in
 * {@link terminateChild}. On both Darwin and Linux the child is sent `SIGTERM`,
 * given a fixed grace period, then `SIGKILL`, and awaited either way. No
 * `/proc` entry is read on either platform, and no process-name matching is
 * performed: neither is evidence, and `/proc` does not exist on macOS.
 *
 * No process group is created and no descendant claim is made. Every subcommand
 * on the allowlist is a local read that spawns no child of its own — the pager
 * is disabled, no hook runs, and no transport is involved — so there is nothing
 * to contain, and the runner asserts containment only over the direct child it
 * actually spawned.
 */

import { spawn } from "node:child_process";
import { CategorizedError, LOCAL_ERROR_CATEGORIES } from "../lib/errorCategories.mjs";
import { CHILD_TERMINATION_GRACE_MS, GIT_COMMAND_MS } from "./deadlines.mjs";
import { deadlineSignal, settleWithin } from "./runtime.mjs";

/** The complete set of git subcommands this module may ever run. */
export const ALLOWED_SUBCOMMANDS = Object.freeze(["rev-parse", "cat-file", "status", "ls-tree"]);

/**
 * Inline configuration applied to every invocation. `-c` affects only the
 * process it is passed to; nothing is written to any config file.
 */
const SAFE_CONFIG = Object.freeze([
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.pager=cat",
  "-c", "core.editor=false",
  "-c", "credential.helper=",
  "-c", "init.templateDir=",
  "-c", "advice.detachedHead=false",
]);

/** Output ceiling for any single invocation. */
export const MAX_GIT_OUTPUT_BYTES = 262_144;

export class GitReadError extends Error {
  /** @param {string} reason @param {string} operation */
  constructor(reason, operation) {
    super(`git ${operation}: ${reason}`);
    this.name = "GitReadError";
    this.operation = operation;
  }
}

/**
 * A child environment built from scratch.
 *
 * Only `PATH` and `HOME` are carried across: `PATH` so the fixed executable can
 * be found, `HOME` so git's ordinary `safe.directory` handling still applies to
 * an operator's own checkout. Everything else is chosen here.
 */
const childEnvironment = () => {
  /** @type {Record<string, string>} */
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/local/bin",
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    GIT_ASKPASS: "",
  };
  if (typeof process.env.HOME === "string" && process.env.HOME.length > 0) {
    env.HOME = process.env.HOME;
  }
  return env;
};

/**
 * Signal a child and await its exit. Isolated here because it is the module's
 * only platform-sensitive step; see the header for the macOS/Linux contract.
 *
 * @param {import("node:child_process").ChildProcess} child
 * @param {Promise<void>} closed resolves on the child's `close` event
 */
export const terminateChild = async (child, closed) => {
  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    await settleWithin(closed, CHILD_TERMINATION_GRACE_MS);
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
  // Awaited unconditionally: the runner never returns while a process it
  // started is still open.
  await closed;
};

/**
 * @param {object} input
 * @param {string} input.operation a name chosen in source, for messages
 * @param {readonly string[]} input.args the complete argv after the safe config
 * @param {string} input.cwd
 * @param {import("./runtime.mjs").Runtime} input.runtime
 * @param {number} [input.maxBytes]
 * @returns {Promise<string>} stdout, decoded as UTF-8 with substitution refused
 */
const runGit = async ({ operation, args, cwd, runtime, maxBytes = MAX_GIT_OUTPUT_BYTES }) => {
  const subcommand = args.find((a) => !a.startsWith("-"));
  if (!subcommand || !ALLOWED_SUBCOMMANDS.includes(subcommand)) {
    throw new GitReadError("subcommand is not on the fixed allowlist", operation);
  }
  if (runtime.signal.aborted) {
    throw new CategorizedError(LOCAL_ERROR_CATEGORIES.INTERRUPTED, `${operation} not started`);
  }

  const child = spawn("git", ["--no-optional-locks", ...SAFE_CONFIG, ...args], {
    cwd,
    env: childEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  /** @type {Buffer[]} */
  const chunks = [];
  let bytes = 0;
  let overflow = false;
  child.stdout.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      overflow = true;
      // Stop reading and stop the producer; the failure is reported below.
      child.stdout.destroy();
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      return;
    }
    chunks.push(chunk);
  });
  // stderr is drained so the child cannot block on a full pipe, and then
  // discarded: it can name filesystem paths, and no git message is ever
  // repeated into evidence.
  child.stderr.on("data", () => {});

  /** @type {Promise<{ code: number | null, signal: NodeJS.Signals | null }>} */
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const closedVoid = closed.then(
    () => undefined,
    () => undefined,
  );

  const deadline = deadlineSignal(GIT_COMMAND_MS);
  const stop = AbortSignal.any([runtime.signal, deadline.signal]);
  const onStop = () => {
    void terminateChild(child, closedVoid);
  };
  stop.addEventListener("abort", onStop, { once: true });

  try {
    const { code, signal } = await closed;
    if (overflow) {
      throw new GitReadError(`output exceeded the fixed ${maxBytes}-byte ceiling`, operation);
    }
    if (stop.aborted) {
      throw new CategorizedError(
        runtime.interrupted ? LOCAL_ERROR_CATEGORIES.INTERRUPTED : LOCAL_ERROR_CATEGORIES.DEADLINE_EXCEEDED,
        `${operation} did not complete`,
      );
    }
    if (signal !== null) throw new GitReadError(`terminated by ${signal}`, operation);
    if (code !== 0) throw new GitReadError(`exited ${code}`, operation);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    } catch {
      throw new GitReadError("output is not valid UTF-8", operation);
    }
  } finally {
    deadline.cancel();
    stop.removeEventListener("abort", onStop);
    // Whatever happened above, the child is signalled if still running and
    // awaited before this function returns.
    await terminateChild(child, closedVoid);
  }
};

const FULL_SHA = /^[0-9a-f]{40}$/;

/** @param {string} sha @param {string} operation */
const assertFullSha = (sha, operation) => {
  if (!FULL_SHA.test(sha)) {
    throw new GitReadError("expected a full 40-character lowercase hex object name", operation);
  }
};

/**
 * `HEAD` as a full object name.
 *
 * @param {string} cwd @param {import("./runtime.mjs").Runtime} runtime
 */
export const readHeadSha = async (cwd, runtime) => {
  const out = await runGit({
    operation: "rev-parse HEAD",
    args: ["rev-parse", "HEAD"],
    cwd,
    runtime,
    maxBytes: 4_096,
  });
  const sha = out.trim();
  assertFullSha(sha, "rev-parse HEAD");
  return sha;
};

/**
 * The repository's object format. A SHA-256 repository would make the blob-hash
 * comparison in `repository.mjs` meaningless, so it is established rather than
 * assumed.
 *
 * @param {string} cwd @param {import("./runtime.mjs").Runtime} runtime
 */
export const readObjectFormat = async (cwd, runtime) => {
  const out = await runGit({
    operation: "rev-parse --show-object-format",
    args: ["rev-parse", "--show-object-format"],
    cwd,
    runtime,
    maxBytes: 1_024,
  });
  return out.trim();
};

/**
 * The true type of an object. `git ls-tree` happily enumerates a TREE sha, so a
 * 40-hex check alone would let a tree, blob or annotated-tag object be recorded
 * as the deployed artifact — an object with no commit ancestry, which cannot
 * have an exact-head CI run.
 *
 * @param {string} cwd @param {string} sha @param {import("./runtime.mjs").Runtime} runtime
 */
export const readObjectType = async (cwd, sha, runtime) => {
  assertFullSha(sha, "cat-file -t");
  const out = await runGit({
    operation: "cat-file -t",
    args: ["cat-file", "-t", sha],
    cwd,
    runtime,
    maxBytes: 1_024,
  });
  return out.trim();
};

/**
 * Tracked-file status, NUL-delimited so no path is ever quoted or escaped.
 *
 * `--untracked-files=no` because the question is whether the TRACKED source is
 * clean; an operator's scratch file beside the checkout is not a modification
 * to the artifact. `--no-renames` keeps every record to a single path, so the
 * two-path rename form cannot be misread as two separate entries.
 *
 * @param {string} cwd @param {import("./runtime.mjs").Runtime} runtime
 * @returns {Promise<Array<{ status: string, path: string }>>}
 */
export const readTrackedStatus = async (cwd, runtime) => {
  const out = await runGit({
    operation: "status --porcelain=v1 -z",
    args: ["status", "--porcelain=v1", "-z", "--untracked-files=no", "--no-renames"],
    cwd,
    runtime,
  });
  /** @type {Array<{ status: string, path: string }>} */
  const entries = [];
  for (const record of out.split("\0")) {
    if (record.length === 0) continue;
    if (record.length < 4) throw new GitReadError("malformed status record", "status");
    entries.push({ status: record.slice(0, 2), path: record.slice(3) });
  }
  return entries;
};

/**
 * Entry basenames under one fixed directory at one commit.
 *
 * `-z` emits raw bytes with no quoting and no escaping, so what is compared is
 * what is in the tree; a name is never trimmed, because surrounding whitespace
 * is part of a filename's identity.
 *
 * @param {string} cwd @param {string} sha @param {import("./runtime.mjs").Runtime} runtime
 */
export const readMigrationEntryNames = async (cwd, sha, runtime) => {
  assertFullSha(sha, "ls-tree state/migrations");
  const out = await runGit({
    operation: "ls-tree state/migrations",
    args: ["ls-tree", "-z", "--name-only", sha, "state/migrations/"],
    cwd,
    runtime,
  });
  return out
    .split("\0")
    .filter((line) => line.length > 0)
    .map((line) => line.slice(line.lastIndexOf("/") + 1));
};

/**
 * Blob object names for two fixed paths at one commit.
 *
 * @param {string} cwd @param {string} sha @param {import("./runtime.mjs").Runtime} runtime
 * @returns {Promise<Map<string, { mode: string, type: string, oid: string }>>}
 */
export const readPackageBlobs = async (cwd, sha, runtime) => {
  assertFullSha(sha, "ls-tree package files");
  const out = await runGit({
    operation: "ls-tree package files",
    args: ["ls-tree", "-z", sha, "--", "package.json", "package-lock.json"],
    cwd,
    runtime,
    maxBytes: 8_192,
  });
  /** @type {Map<string, { mode: string, type: string, oid: string }>} */
  const found = new Map();
  for (const record of out.split("\0")) {
    if (record.length === 0) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) throw new GitReadError("malformed ls-tree record", "ls-tree package files");
    const [mode, type, oid] = record.slice(0, tab).split(" ");
    if (!mode || !type || !oid) {
      throw new GitReadError("malformed ls-tree record", "ls-tree package files");
    }
    found.set(record.slice(tab + 1), { mode, type, oid });
  }
  return found;
};
