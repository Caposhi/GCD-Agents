/**
 * Repository preconditions, and the establishment of the artifact `A`.
 *
 * The runner executes from a normal clean checkout **after** the operator has
 * run the repository's ordinary locked installation command (`npm ci`). It does
 * not clone, does not install, does not touch `node_modules`, does not invoke
 * npm, does not generate any helper, and does not modify git configuration. It
 * reads the checkout it is standing in and refuses to proceed if that checkout
 * is not a sound basis for evidence.
 *
 * ## `A` is the verified `HEAD` of this checkout, and nothing else
 *
 * {@link establishArtifact} returns the full object name of `HEAD`. There is no
 * parameter, no flag and no environment variable by which a different value can
 * be supplied: a branch name, a tag, an abbreviation, an environment override
 * and a separately supplied SHA are all simply unrepresentable here. Every
 * repository, CI, migration and report field downstream binds to this one
 * value.
 *
 * ## The `.DS_Store` allowance
 *
 * A tracked `.DS_Store` exists in this repository. It is disclosed as unrelated
 * generated OS metadata that is intentionally out of scope (`docs/STATUS.md`,
 * `README.md`), and `docs/AI_HANDOFF.md` requires that an existing `.DS_Store`
 * modification be PRESERVED rather than reverted. So the one condition the
 * clean-tree check tolerates is a modification whose path is exactly
 * `.DS_Store`. The runner records that it was tolerated, and it never opens,
 * hashes, stages, reverts or otherwise touches the file: the allowance is
 * granted from git's status line alone.
 *
 * Any other dirty entry — including an added, deleted or renamed `.DS_Store`,
 * or a second modified path — makes the checkout unusable as an artifact.
 */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { REPOSITORY_PHASE_TOTAL_MS } from "./deadlines.mjs";
import {
  readHeadSha,
  readMigrationEntryNames,
  readObjectFormat,
  readObjectType,
  readPackageBlobs,
  readTrackedStatus,
} from "./gitRead.mjs";
import { withDeadline } from "./runtime.mjs";

/** The Node major this repository is built and tested against. */
export const REQUIRED_NODE_MAJOR = 22;

/** The one tolerated dirty path, and the only statuses tolerated for it. */
export const TOLERATED_DIRTY_PATH = ".DS_Store";
const TOLERATED_DIRTY_STATUSES = Object.freeze([" M", "M ", "MM"]);

/** The two files that must belong to the artifact commit byte for byte. */
export const PINNED_PACKAGE_FILES = Object.freeze(["package.json", "package-lock.json"]);

export class PreconditionError extends Error {
  /** @param {string} check @param {string} reason */
  constructor(check, reason) {
    super(`${check}: ${reason}`);
    this.name = "PreconditionError";
    this.check = check;
  }
}

/**
 * The git blob object name of some bytes, computed here rather than by shelling
 * out again. A blob's name is `sha1("blob " + byteLength + "\0" + content)`.
 *
 * @param {Buffer} bytes
 */
export const gitBlobSha1 = (bytes) =>
  createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");

/**
 * Node 22, established from the running process and cross-checked against the
 * two places this repository declares it.
 *
 * @param {string} repoRoot
 */
const checkNodeVersion = async (repoRoot) => {
  const running = process.versions.node;
  const major = Number.parseInt(running.split(".")[0] ?? "", 10);
  const declaredFile = (await readFile(resolve(repoRoot, ".node-version"), "utf8")).trim();
  const pkg = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8"));
  const declaredEngine = pkg?.engines?.node;
  if (major !== REQUIRED_NODE_MAJOR) {
    throw new PreconditionError("node_version", `running Node ${running}; this runner requires ${REQUIRED_NODE_MAJOR}.x`);
  }
  if (declaredFile !== String(REQUIRED_NODE_MAJOR)) {
    throw new PreconditionError("node_version", ".node-version no longer declares the required major");
  }
  if (declaredEngine !== `${REQUIRED_NODE_MAJOR}.x`) {
    throw new PreconditionError("node_version", "package.json engines.node no longer declares the required major");
  }
  return { running, major, declared_node_version_file: declaredFile, declared_engines_node: declaredEngine };
};

/**
 * Clean tracked source, with the single disclosed `.DS_Store` allowance.
 *
 * Pure, so the allowance can be tested exhaustively without a working tree in
 * every state it has to judge.
 *
 * @param {ReadonlyArray<{ status: string, path: string }>} entries
 */
export const evaluateTrackedSource = (entries) => {
  const offending = entries.filter(
    (e) => !(e.path === TOLERATED_DIRTY_PATH && TOLERATED_DIRTY_STATUSES.includes(e.status)),
  );
  if (offending.length > 0) {
    // Paths are repository-relative and tracked, so naming them is safe and is
    // the only way an operator can act on the refusal.
    throw new PreconditionError(
      "clean_tracked_source",
      `tracked source is not clean: ${offending.map((e) => e.path).sort().join(", ")}`,
    );
  }
  const tolerated = entries.length > 0;
  return {
    dirty_entry_count: entries.length,
    ds_store_modification_tolerated: tolerated,
    tolerated_path: tolerated ? TOLERATED_DIRTY_PATH : null,
    ds_store_contents_read: false,
    policy_reference: "docs/STATUS.md, README.md, docs/AI_HANDOFF.md",
  };
};

/**
 * The package manifest and lockfile on disk are byte-identical to the blobs at
 * `A`.
 *
 * The clean-tree check above already implies this, but it is established
 * independently: a clean tree is a claim about the index, and the artifact
 * binding deserves a direct content comparison rather than an inference.
 *
 * @param {string} repoRoot @param {string} artifact
 * @param {import("./runtime.mjs").Runtime} runtime
 */
const checkPackageFilesBelongToArtifact = async (repoRoot, artifact, runtime) => {
  const objectFormat = await readObjectFormat(repoRoot, runtime);
  if (objectFormat !== "sha1") {
    throw new PreconditionError(
      "package_binding",
      `repository object format is ${objectFormat}; this comparison is defined for sha1`,
    );
  }
  const blobs = await readPackageBlobs(repoRoot, artifact, runtime);
  /** @type {Record<string, { blob_oid: string, on_disk_oid: string, bytes: number }>} */
  const bound = {};
  for (const file of PINNED_PACKAGE_FILES) {
    const entry = blobs.get(file);
    if (!entry) throw new PreconditionError("package_binding", `${file} is absent from the artifact commit`);
    if (entry.type !== "blob") {
      throw new PreconditionError("package_binding", `${file} is a ${entry.type} at the artifact commit`);
    }
    const bytes = await readFile(resolve(repoRoot, file));
    const onDisk = gitBlobSha1(bytes);
    if (onDisk !== entry.oid) {
      throw new PreconditionError("package_binding", `${file} on disk does not match the artifact commit`);
    }
    bound[file] = { blob_oid: entry.oid, on_disk_oid: onDisk, bytes: bytes.byteLength };
  }
  return { object_format: objectFormat, files: bound };
};

/**
 * `pg` resolves from THIS checkout, at the version the lockfile pins.
 *
 * Resolution goes through Node's own resolver rooted at this file, and the
 * result is required to sit under this checkout's `node_modules`. A `pg`
 * satisfied from a parent directory, a global prefix or a linked workspace
 * would mean the evidence was collected against a driver the artifact does not
 * pin. Nothing is installed, and npm is not invoked: an absent or mismatched
 * `pg` is reported so the operator can run the repository's ordinary locked
 * installation command themselves.
 *
 * @param {string} repoRoot
 */
const checkPgResolvesFromCheckout = async (repoRoot) => {
  const require = createRequire(import.meta.url);
  let resolved;
  try {
    resolved = require.resolve("pg");
  } catch {
    throw new PreconditionError(
      "pg_resolution",
      "pg does not resolve; run the repository's ordinary locked installation command first",
    );
  }
  const expectedPrefix = `${resolve(repoRoot, "node_modules")}${sep}`;
  if (!resolved.startsWith(expectedPrefix)) {
    throw new PreconditionError("pg_resolution", "pg resolves from outside this checkout's node_modules");
  }
  const installed = JSON.parse(
    await readFile(resolve(repoRoot, "node_modules/pg/package.json"), "utf8"),
  );
  const lock = JSON.parse(await readFile(resolve(repoRoot, "package-lock.json"), "utf8"));
  const pinned = lock?.packages?.["node_modules/pg"]?.version;
  if (typeof pinned !== "string" || pinned.length === 0) {
    throw new PreconditionError("pg_resolution", "package-lock.json does not pin node_modules/pg");
  }
  if (installed.version !== pinned) {
    throw new PreconditionError("pg_resolution", "the installed pg is not the version the lockfile pins");
  }
  return {
    resolved_inside_checkout: true,
    installed_version: installed.version,
    lockfile_pinned_version: pinned,
    npm_invoked: false,
  };
};

/**
 * Run every repository precondition and establish `A`.
 *
 * @param {object} input
 * @param {string} input.repoRoot
 * @param {import("./runtime.mjs").Runtime} input.runtime
 */
export const establishArtifact = async ({ repoRoot, runtime }) =>
  withDeadline(runtime, "repository preconditions", REPOSITORY_PHASE_TOTAL_MS, async () => {
    const node = await checkNodeVersion(repoRoot);
    const cleanliness = evaluateTrackedSource(await readTrackedStatus(repoRoot, runtime));

    // `A` is read here, from the checkout, and never from anywhere else.
    const artifact = await readHeadSha(repoRoot, runtime);
    if (!/^[0-9a-f]{40}$/.test(artifact)) {
      throw new PreconditionError("artifact", "HEAD is not a full 40-character object name");
    }
    const type = await readObjectType(repoRoot, artifact, runtime);
    if (type !== "commit") {
      throw new PreconditionError("artifact", `HEAD names a ${type} object, not a commit`);
    }

    const packageBinding = await checkPackageFilesBelongToArtifact(repoRoot, artifact, runtime);
    const pg = await checkPgResolvesFromCheckout(repoRoot);
    const migrationEntries = await readMigrationEntryNames(repoRoot, artifact, runtime);

    return {
      artifact,
      artifact_source: "verified HEAD of this clean checkout",
      node,
      working_tree: cleanliness,
      package_binding: packageBinding,
      pg,
      migration_entries: migrationEntries,
      not_performed: Object.freeze([
        "clone",
        "checkout of another tree",
        "dependency installation",
        "node_modules modification",
        "npm invocation",
        "helper generation",
        "git configuration modification",
        ".DS_Store inspection or alteration",
      ]),
    };
  });
