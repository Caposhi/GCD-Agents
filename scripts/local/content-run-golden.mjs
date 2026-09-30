#!/usr/bin/env node
/**
 * Fake-runner golden test for `scripts/local/content-run.mjs`.
 *
 * Content Studio S1 moved the CLI's pipeline core into
 * `src/harness/contentRun/**` and left the CLI a thin shell. Its approved
 * design (docs/CONTENT_STUDIO_DESIGN.md §10, S1) requires that the move change
 * no behaviour: full, `--replay-critic`, `--resume-from packaging-adaptation`,
 * `--revise-from` and `--revise-once` runs write byte-identical files before and
 * after, `--list-tags` prints the same thing, and every refused flag
 * combination gives the same message and exit code. This script is that test.
 *
 * It drives a CLI as a child process through a fixed scenario matrix, fake
 * runner only, with:
 *   - the clock pinned (a preload replaces `Date` with one fixed instant, so run
 *     directory names, `now`, `reviewedAt` and every other timestamp repeat);
 *   - asynchronous file reads made to complete in the order they were issued,
 *     so the critic panel's four concurrent lens requests finish in the same
 *     order every time. Without this the lens order — and so the order of
 *     field-measurement rows, `modelRequests` and the revision's console line
 *     — varies between two runs of the SAME CLI (measured on `main` at
 *     4664515 before S1: 48 differences between two unpinned captures);
 *   - a synthetic automotive-facts fixture it writes itself (never a real facts
 *     file, and nothing is committed);
 *   - no provider credential in the child's environment and the provider base
 *     URL pointed at an unreachable local port, so even a regression that
 *     reached a live path could contact nothing. Every live-runner scenario is
 *     a refusal before the first request: no scenario ever types LIVE.
 *
 * Everything is written under one fixed work directory, so absolute paths in
 * files and console output repeat between two captures.
 *
 * Usage:
 *   node scripts/local/content-run-golden.mjs capture --cli <content-run.mjs> --work <dir> --save <dir>
 *   node scripts/local/content-run-golden.mjs compare <saved-a> <saved-b>
 *   node scripts/local/content-run-golden.mjs --base <git-rev> [--work <dir>] [--allow-stack-frames]
 *
 * `capture` runs the matrix in `--work` (emptied first), then moves the result to
 * `--save`. `compare` reports every difference between two saved captures and
 * exits non-zero on any: file names and bytes, exit codes, stdout, and stderr.
 * Stderr is compared twice — exactly, and with Node's `    at …` stack-frame
 * lines removed — because a plain `Error` is reported with its stack, whose
 * frames name source files and line numbers that move whenever code moves. A
 * difference confined to those frames is printed as COSMETIC; it still counts
 * as a difference and the exit code says so unless `--allow-stack-frames` is
 * given, which the report then states.
 *
 * `--base <rev>` does both: it checks `<rev>` out into a temporary Git worktree,
 * builds it (with this checkout's `node_modules`), captures that CLI, captures
 * this checkout's CLI (build it first), and compares the two. It needs Git.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PINNED_INSTANT = "2026-09-29T12:00:00.000Z";

const PRELOAD = `// Written by content-run-golden.mjs: pins the clock for a golden capture.
const FIXED = Date.parse(${JSON.stringify(PINNED_INSTANT)});
const RealDate = Date;
class PinnedDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(FIXED); else super(...args); }
  static now() { return FIXED; }
}
globalThis.Date = PinnedDate;
// The critic panel's four lens requests run concurrently, and each reads its
// assets with fs/promises; left alone, those reads finish in I/O order, so the
// lenses finish — and are recorded — in a different order from run to run, on
// any version of the CLI. Serialize every such read so each completes in the
// order it was issued. This pins scheduling only; it changes no bytes read.
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const realReadFile = fsp.readFile;
let tail = Promise.resolve();
fsp.readFile = function readFileInIssueOrder(...args) {
  const run = tail.then(() => realReadFile.apply(fsp, args));
  tail = run.catch(() => {});
  return run;
};
syncBuiltinESMExports();
`;

/** A clearly synthetic fixture: four records, two carrying the golden scope tag. */
function syntheticFacts(suffix = "") {
  return JSON.stringify({
    facts: [0, 1, 2, 3].map((i) => ({
      id: `synthetic-golden-fact-${i}`,
      claim: `SYNTHETIC GOLDEN TEST FIXTURE ${i}${suffix} - not a real automotive fact.`,
      subject: "synthetic-golden-subject",
      attribute: `synthetic-golden-attr-${i}`,
      tags: i < 2 ? ["golden-scope", "synthetic-golden"] : ["synthetic-golden"],
      sourceType: "repository_config",
      sourceRef: "synthetic://golden-test-fixture",
      provenance: "synthetic golden test fixture; not a real source",
      reviewedAt: "2026-09-01T00:00:00.000Z",
    })),
  }, null, 2);
}

function editJson(path, edit) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  edit(value);
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

function copyRun(from, to, edit = () => {}) {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  edit(to);
  return to;
}

const onlyChild = (parent) => {
  const names = existsSync(parent) ? readdirSync(parent).sort() : [];
  return names.length ? join(parent, names[0]) : join(parent, "missing");
};

/** The scenario matrix. Each step is run in order; some prepare fixtures from earlier output. */
function scenarios(W) {
  const F = join(W, "facts", "synthetic-golden-facts.json");
  const OTHER = join(W, "facts", "synthetic-golden-other-facts.json");
  const BAD_FIELD = join(W, "facts", "synthetic-golden-missing-field.json");
  const BAD_SHAPE = join(W, "facts", "synthetic-golden-bad-shape.json");
  const ABSENT = join(W, "facts", "absent.json");
  const runs = (name) => join(W, "runs", name);
  const full = () => onlyChild(runs("full"));
  const scoped = () => onlyChild(runs("scoped"));
  const facts = ["--automotive-facts", F];
  const live = ["--runner", "live"];
  const flag = "--i-understand-this-costs-money";

  return [
    { id: "setup", prepare: () => {
      mkdirSync(dirname(F), { recursive: true });
      writeFileSync(F, syntheticFacts(), "utf8");
      writeFileSync(OTHER, syntheticFacts(" (edited)"), "utf8");
      const missing = JSON.parse(syntheticFacts());
      delete missing.facts[1].provenance;
      writeFileSync(BAD_FIELD, JSON.stringify(missing, null, 2), "utf8");
      writeFileSync(BAD_SHAPE, JSON.stringify({ records: [] }), "utf8");
    } },

    // --- argument and flag-combination refusals (no files) -----------------
    { id: "flags-none", argv: [] },
    { id: "flags-help", argv: ["--help"] },
    { id: "flags-h", argv: ["-h"] },
    { id: "flags-runner-bogus", argv: ["goal", "--runner", "bogus"] },
    { id: "flags-runner-missing", argv: ["goal", "--runner"] },
    { id: "flags-unknown-option", argv: ["goal", "--bogus"] },
    { id: "flags-extra-positional", argv: ["goal", "extra"] },
    { id: "flags-resume-bad-stage", argv: ["--resume-from", "production-direction", W] },
    { id: "flags-resume-no-stage", argv: ["--resume-from"] },
    { id: "flags-resume-no-dir", argv: ["--resume-from", "packaging-adaptation"] },
    { id: "flags-resume-flag-as-dir", argv: ["--resume-from", "packaging-adaptation", "--runner"] },
    { id: "flags-resume-with-replay", argv: ["--resume-from", "packaging-adaptation", W, "--replay-critic", W] },
    { id: "flags-resume-with-list", argv: ["--resume-from", "packaging-adaptation", W, "--list-tags"] },
    { id: "flags-list-with-goal", argv: ["--list-tags", "a goal"] },
    { id: "flags-list-with-replay", argv: ["--list-tags", "--replay-critic", W] },
    { id: "flags-revise-no-dir", argv: ["--revise-from"] },
    { id: "flags-revise-flag-as-dir", argv: ["--revise-from", "--runner"] },
    { id: "flags-revise-with-replay", argv: ["--revise-from", W, "--replay-critic", W] },
    { id: "flags-revise-with-list", argv: ["--revise-from", W, "--list-tags"] },
    { id: "flags-revise-with-resume", argv: ["--revise-from", W, "--resume-from", "packaging-adaptation", W] },
    { id: "flags-revise-with-once", argv: ["--revise-from", W, "--revise-once"] },
    { id: "flags-once-no-goal", argv: ["--revise-once"] },
    { id: "flags-once-with-replay", argv: ["goal", "--revise-once", "--replay-critic", W] },
    { id: "flags-once-with-list", argv: ["--revise-once", "--list-tags"] },
    { id: "flags-once-with-resume", argv: ["goal", "--revise-once", "--resume-from", "packaging-adaptation", W] },
    { id: "flags-scope-empty", argv: ["goal", "--scope-tags", " , "] },
    { id: "flags-scope-missing", argv: ["goal", "--scope-tags"] },
    { id: "flags-scope-before-runner", argv: ["goal", "--scope-tags", " , ", "--runner", "bogus"] },
    { id: "flags-unknown-platform", argv: ["goal", ...facts, "--platforms", "instagram,myspace", "--out-dir", runs("bad-platform")] },

    // --- --list-tags ---------------------------------------------------------
    { id: "list", argv: ["--list-tags", ...facts] },
    { id: "list-scoped", argv: ["--list-tags", ...facts, "--scope-tags", "golden-scope, synthetic-golden,golden-scope"] },
    { id: "list-live-runner", argv: ["--list-tags", ...facts, ...live, "--out-dir", runs("list-out")] },
    { id: "list-absent-facts", argv: ["--list-tags", "--automotive-facts", ABSENT] },

    // --- full runs -----------------------------------------------------------
    { id: "full", argv: ["Golden synthetic goal", ...facts, "--out-dir", runs("full")] },
    { id: "full-scoped", argv: ["Golden synthetic goal", ...facts, "--out-dir", runs("scoped"), "--scope-tags", "golden-scope"] },
    { id: "full-platforms-reviewed-at", argv: ["Golden synthetic goal", ...facts, "--out-dir", runs("platforms"),
      "--platforms", "facebook,instagram", "--reviewed-at", "2026-09-02T03:04:05.000Z"] },
    { id: "full-revise-once", argv: ["Golden synthetic goal", "--revise-once", ...facts, "--out-dir", runs("once")] },
    { id: "full-absent-facts", argv: ["Golden synthetic goal", "--automotive-facts", ABSENT, "--out-dir", runs("absent")] },
    { id: "full-missing-field", argv: ["Golden synthetic goal", "--automotive-facts", BAD_FIELD, "--out-dir", runs("bad-field")] },
    { id: "full-bad-shape", argv: ["Golden synthetic goal", "--automotive-facts", BAD_SHAPE, "--out-dir", runs("bad-shape")] },
    { id: "full-scope-matches-nothing", argv: ["Golden synthetic goal", ...facts, "--out-dir", runs("scope-none"), "--scope-tags", "no-record-has-this"] },
    { id: "full-live-no-flag", argv: ["Golden synthetic goal", ...facts, ...live, "--out-dir", runs("live-a")] },
    { id: "full-live-wrong-word", argv: ["Golden synthetic goal", ...facts, ...live, flag, "--out-dir", runs("live-b")], input: "live\n" },
    { id: "full-live-empty-input", argv: ["Golden synthetic goal", ...facts, ...live, flag, "--out-dir", runs("live-c")], input: "" },
    { id: "full-once-live", argv: ["Golden synthetic goal", "--revise-once", ...facts, ...live, flag, "--out-dir", runs("live-d")], input: "" },
    { id: "full-live-absent-facts", argv: ["Golden synthetic goal", "--automotive-facts", ABSENT, ...live, flag, "--out-dir", runs("live-e")] },

    // --- --replay-critic -----------------------------------------------------
    { id: "replay", argv: () => ["--replay-critic", full(), ...facts] },
    { id: "replay-again-refused", argv: () => ["--replay-critic", full(), ...facts] },
    { id: "replay-scoped-matching-flag", argv: () => ["--replay-critic", scoped(), ...facts, "--scope-tags", "golden-scope"] },
    { id: "replay-scoped-other-flag", argv: () => ["--replay-critic", scoped(), ...facts, "--scope-tags", "synthetic-golden"] },
    { id: "replay-goal-mismatch", argv: () => ["--replay-critic", full(), "a different goal", ...facts] },
    { id: "replay-other-facts", argv: () => ["--replay-critic", full(), "--automotive-facts", OTHER] },
    { id: "replay-missing-source", argv: ["--replay-critic", join(W, "no-such-run"), ...facts] },
    { id: "replay-live-no-flag", argv: () => ["--replay-critic", full(), ...facts, ...live] },
    { id: "replay-live-empty-input", argv: () => ["--replay-critic", full(), ...facts, ...live, flag], input: "" },
    { id: "prepare-legacy", prepare: () => {
      for (const label of ["legacy-refused", "legacy-confirmed"]) {
        copyRun(full(), join(W, label, "2026-09-29T12-00-00-000Z"), (dir) =>
          editJson(join(dir, "run-meta.json"), (m) => { delete m.automotiveFacts; }));
      }
      copyRun(full(), join(W, "approved-changed", "2026-09-29T12-00-00-000Z"), (dir) => {
        editJson(join(dir, "run-meta.json"), (m) => { m.approvedFacts.sha256 = "0".repeat(64); });
        for (const name of readdirSync(dir).filter((n) => /^0[1-5]-.*\.json$/.test(n))) {
          editJson(join(dir, name), (stage) => {
            for (const asset of stage.metadata?.assets ?? []) {
              if (asset.path === "config/approved-facts.json") asset.sha256 = "0".repeat(64);
            }
          });
        }
      });
      copyRun(full(), join(W, "no-meta", "2026-09-29T12-00-00-000Z"), (dir) => rmSync(join(dir, "run-meta.json")));
      copyRun(full(), join(W, "no-pack-sha", "2026-09-29T12-00-00-000Z"), (dir) =>
        editJson(join(dir, "run-meta.json"), (m) => { delete m.evidencePackSha256; }));
      copyRun(full(), join(W, "stage-invalid", "2026-09-29T12-00-00-000Z"), (dir) =>
        editJson(join(dir, "04-production-direction.json"), (s) => { s.output.claimVisuals.used[0].factId = "fabricated-fact-id"; }));
      copyRun(full(), join(W, "stage-missing", "2026-09-29T12-00-00-000Z"), (dir) =>
        rmSync(join(dir, "03-hook-story-script.json")));
      copyRun(full(), join(W, "no-output", "2026-09-29T12-00-00-000Z"), (dir) =>
        writeFileSync(join(dir, "01-strategy-concept.json"), "{}", "utf8"));
      copyRun(full(), join(W, "not-a-timestamp", "some-run"), (dir) => rmSync(join(dir, "run-meta.json")));
    } },
    { id: "replay-unproven-refused", argv: () => ["--replay-critic", onlyChild(join(W, "legacy-refused")), ...facts], input: "" },
    { id: "replay-unproven-confirmed", argv: () => ["--replay-critic", onlyChild(join(W, "legacy-confirmed")), ...facts], input: "UNPROVEN\n" },
    { id: "replay-approved-changed", argv: () => ["--replay-critic", onlyChild(join(W, "approved-changed")), ...facts] },
    { id: "replay-no-meta", argv: () => ["--replay-critic", onlyChild(join(W, "no-meta")), ...facts] },
    { id: "replay-no-meta-no-timestamp", argv: () => ["--replay-critic", join(W, "not-a-timestamp", "some-run"), ...facts], input: "UNPROVEN\n" },
    { id: "replay-stage-invalid", argv: () => ["--replay-critic", onlyChild(join(W, "stage-invalid")), ...facts] },

    // --- --resume-from packaging-adaptation ------------------------------------
    { id: "resume", argv: () => ["--resume-from", "packaging-adaptation", full(), ...facts] },
    { id: "resume-again-refused", argv: () => ["--resume-from", "packaging-adaptation", full(), ...facts] },
    { id: "resume-scoped", argv: () => ["--resume-from", "packaging-adaptation", scoped(), ...facts] },
    { id: "resume-scoped-other-flag", argv: () => ["--resume-from", "packaging-adaptation", scoped(), ...facts, "--scope-tags", "synthetic-golden"] },
    { id: "resume-platforms-mismatch", argv: () => ["--resume-from", "packaging-adaptation", full(), ...facts, "--platforms", "instagram"] },
    { id: "resume-no-meta", argv: () => ["--resume-from", "packaging-adaptation", onlyChild(join(W, "no-meta")), ...facts] },
    { id: "resume-no-pack-sha", argv: () => ["--resume-from", "packaging-adaptation", onlyChild(join(W, "no-pack-sha")), ...facts] },
    { id: "resume-legacy", argv: () => ["--resume-from", "packaging-adaptation", onlyChild(join(W, "legacy-refused")), ...facts], input: "UNPROVEN\n" },
    { id: "resume-stage-missing", argv: () => ["--resume-from", "packaging-adaptation", onlyChild(join(W, "stage-missing")), ...facts] },
    { id: "resume-no-output", argv: () => ["--resume-from", "packaging-adaptation", onlyChild(join(W, "no-output")), ...facts] },
    { id: "resume-live-no-flag", argv: () => ["--resume-from", "packaging-adaptation", scoped(), ...facts, ...live] },
    { id: "resume-live-wrong-word", argv: () => ["--resume-from", "packaging-adaptation", scoped(), ...facts, ...live, flag], input: "nope\n" },
    { id: "replay-of-resumed", argv: () => {
      const resumed = readdirSync(runs("full")).sort().find((n) => n.includes("-resume-packaging-adaptation-"));
      return ["--replay-critic", join(runs("full"), resumed ?? "missing"), ...facts];
    } },

    // --- --revise-from ---------------------------------------------------------
    { id: "revise", argv: () => ["--revise-from", full(), ...facts] },
    { id: "revise-again-refused", argv: () => ["--revise-from", full(), ...facts] },
    { id: "revise-scoped", argv: () => ["--revise-from", scoped(), ...facts] },
    { id: "revise-platforms-mismatch", argv: () => ["--revise-from", scoped(), ...facts, "--platforms", "instagram"] },
    { id: "revise-no-pack-sha", argv: () => ["--revise-from", onlyChild(join(W, "no-pack-sha")), ...facts] },
    { id: "revise-legacy", argv: () => ["--revise-from", onlyChild(join(W, "legacy-refused")), ...facts], input: "UNPROVEN\n" },
    { id: "revise-stage-invalid", argv: () => ["--revise-from", onlyChild(join(W, "stage-invalid")), ...facts] },
    { id: "revise-live-no-flag", argv: () => ["--revise-from", onlyChild(runs("platforms")), ...facts, ...live] },
    { id: "revise-live-wrong-word", argv: () => ["--revise-from", onlyChild(runs("platforms")), ...facts, ...live, flag], input: "LIVE?\n" },
    { id: "revise-platforms-run", argv: () => ["--revise-from", onlyChild(runs("platforms")), ...facts] },
  ];
}

function capture(cli, work, save) {
  const W = resolve(work);
  rmSync(W, { recursive: true, force: true });
  mkdirSync(W, { recursive: true });
  const preloadDir = mkdtempSync(join(tmpdir(), "gcd-golden-preload-"));
  const preload = join(preloadDir, "pin-clock.mjs");
  writeFileSync(preload, PRELOAD, "utf8");
  const env = { ...process.env, ANTHROPIC_BASE_URL: "http://127.0.0.1:9" };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  const transcript = [];
  try {
    for (const step of scenarios(W)) {
      if (step.prepare) { step.prepare(); continue; }
      const argv = typeof step.argv === "function" ? step.argv() : step.argv;
      const result = spawnSync(process.execPath, ["--import", preload, resolve(cli), ...argv], {
        cwd: W, env, input: step.input ?? "", encoding: "utf8", timeout: 120_000,
      });
      transcript.push({
        id: step.id, argv, input: step.input ?? "", status: result.status, signal: result.signal,
        stdout: result.stdout, stderr: result.stderr,
      });
      process.stdout.write(`${step.id}: exit ${result.status}\n`);
    }
  } finally {
    rmSync(preloadDir, { recursive: true, force: true });
  }
  writeFileSync(join(W, "golden-transcript.json"), JSON.stringify(transcript, null, 2), "utf8");
  if (save) {
    rmSync(resolve(save), { recursive: true, force: true });
    mkdirSync(dirname(resolve(save)), { recursive: true });
    renameSync(W, resolve(save));
  }
}

function tree(root) {
  const files = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.set(relative(root, path), readFileSync(path));
    }
  };
  walk(root);
  return files;
}

const withoutFrames = (text) => text.split("\n").filter((line) => !/^\s+at /.test(line)).join("\n");

function compare(a, b, { allowStackFrames = false } = {}) {
  const ta = tree(resolve(a));
  const tb = tree(resolve(b));
  let differences = 0;
  let cosmetic = 0;
  const say = (line) => { console.log(line); };
  const transcriptName = "golden-transcript.json";
  const names = [...new Set([...ta.keys(), ...tb.keys()])].filter((n) => n !== transcriptName).sort();
  for (const name of names) {
    if (!ta.has(name) || !tb.has(name)) { differences += 1; say(`FILE ${name}: only in ${ta.has(name) ? "A" : "B"}`); continue; }
    if (!ta.get(name).equals(tb.get(name))) { differences += 1; say(`FILE ${name}: bytes differ`); }
  }
  const xa = JSON.parse(ta.get(transcriptName)?.toString("utf8") ?? "[]");
  const xb = JSON.parse(tb.get(transcriptName)?.toString("utf8") ?? "[]");
  if (xa.length !== xb.length) { differences += 1; say(`TRANSCRIPT: ${xa.length} vs ${xb.length} scenarios`); }
  for (let i = 0; i < Math.min(xa.length, xb.length); i += 1) {
    const [sa, sb] = [xa[i], xb[i]];
    if (sa.id !== sb.id || JSON.stringify(sa.argv) !== JSON.stringify(sb.argv)) { differences += 1; say(`SCENARIO ${i}: ${sa.id} vs ${sb.id}`); continue; }
    if (sa.status !== sb.status || sa.signal !== sb.signal) { differences += 1; say(`${sa.id}: exit ${sa.status} vs ${sb.status}`); }
    if (sa.stdout !== sb.stdout) { differences += 1; say(`${sa.id}: stdout differs`); }
    if (sa.stderr !== sb.stderr) {
      if (withoutFrames(sa.stderr) === withoutFrames(sb.stderr)) {
        cosmetic += 1;
        say(`${sa.id}: stderr differs ONLY in stack-frame lines (COSMETIC: the reported message is identical)`);
      } else {
        differences += 1;
        say(`${sa.id}: stderr differs`);
      }
    }
  }
  const files = names.length;
  say(`\n${files} file(s) and ${xa.length} scenario(s) compared: ${differences} difference(s), `
    + `${cosmetic} stack-frame-only stderr difference(s)`);
  if (cosmetic && allowStackFrames) say("--allow-stack-frames: stack-frame-only differences are reported above and not counted");
  return differences + (allowStackFrames ? 0 : cosmetic);
}

function againstBase(rev, work, options) {
  const base = mkdtempSync(join(tmpdir(), "gcd-golden-base-"));
  const tree = join(base, "tree");
  const W = resolve(work ?? join(tmpdir(), "gcd-golden-work"));
  try {
    execFileSync("git", ["worktree", "add", "--detach", tree, rev], { cwd: REPO_ROOT, stdio: "inherit" });
    symlinkSync(resolve(REPO_ROOT, "node_modules"), join(tree, "node_modules"), "dir");
    execFileSync("npx", ["tsc", "-p", "tsconfig.json"], { cwd: tree, stdio: "inherit" });
    capture(join(tree, "scripts/local/content-run.mjs"), W, join(base, "before"));
    capture(join(REPO_ROOT, "scripts/local/content-run.mjs"), W, join(base, "after"));
    return compare(join(base, "before"), join(base, "after"), options);
  } finally {
    try { execFileSync("git", ["worktree", "remove", "--force", tree], { cwd: REPO_ROOT, stdio: "ignore" }); } catch { /* best effort */ }
    rmSync(base, { recursive: true, force: true });
  }
}

const option = (argv, name) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};

const [command, ...rest] = process.argv.slice(2);
if (command === "capture") {
  capture(option(rest, "--cli") ?? join(REPO_ROOT, "scripts/local/content-run.mjs"), option(rest, "--work") ?? join(tmpdir(), "gcd-golden-work"), option(rest, "--save"));
} else if (command === "compare") {
  const [a, b] = rest.filter((arg) => !arg.startsWith("--"));
  process.exit(compare(a, b, { allowStackFrames: rest.includes("--allow-stack-frames") }) === 0 ? 0 : 1);
} else if (command === "--base") {
  process.exit(againstBase(rest[0], option(rest, "--work"), { allowStackFrames: rest.includes("--allow-stack-frames") }) === 0 ? 0 : 1);
} else {
  console.log("Usage: content-run-golden.mjs capture --cli <path> --work <dir> --save <dir> | compare <a> <b> [--allow-stack-frames] | --base <rev> [--work <dir>] [--allow-stack-frames]");
  process.exit(command ? 1 : 0);
}
