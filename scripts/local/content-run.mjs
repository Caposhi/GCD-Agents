#!/usr/bin/env node
/**
 * Local, offline-first driver for the six Content Intelligence reasoning
 * stages, run by hand against the real merged executors.
 *
 * This is deliberately OUTSIDE the P1-P8 / M2-M7 production-wiring sequence
 * (see docs/ROADMAP.md). It calls no HTTP route, no worker, no scheduler, no
 * approval path, and no publishing path. It authorizes nothing and enables
 * nothing: every stage's `executionEnabled` flag stays exactly as merged.
 *
 * It threads the six executors exactly as
 * `src/harness/contentIntelligence.selftest.ts` proves works:
 *   strategy-concept -> automotive-truth -> hook-story-script ->
 *   production-direction -> packaging-adaptation -> final-critic
 * with each stage's validated output passed into the next. `final-critic` is a
 * panel of four lenses — evidence-fidelity, platform-and-local, voice-and-craft,
 * production-coherence — each one model request, run concurrently, aggregated
 * deterministically by the executor. Full runs and `--replay-critic` both run
 * the whole panel.
 *
 * After stage 5 validates, a deterministic step attaches each package's fixed
 * contact line — copied byte for byte from the evidence pack's approved-facts
 * shop-name, phone and booking-link records, never written by a model — and the critic
 * receives the contacted packages, in a full run and in `--replay-critic` alike.
 * Every record a contact line needs is checked before the cost gate, so a
 * missing phone record costs nothing. See `src/harness/agents/contactLine.ts`.
 *
 * Stage 5 is also given the shop's two identity records — the approved-facts
 * makes and service-area records — and code binds them on every platform, so a
 * make- or place-naming hashtag or keyword is supported. Both are checked before
 * the cost gate too. See `src/harness/agents/identityFacts.ts`.
 *
 * `--scope-tags` narrows the evidence pack to records carrying at least one of
 * the named tags, through the pack builder's own tag scope. The records every
 * run needs — the contact-line records and the identity records — are always
 * included whatever the scope, and a scoped run refuses before the cost gate if
 * any of them is missing from the loaded facts. With no flag the pack is exactly
 * what it was before the flag existed: every loaded record, the same fingerprint,
 * the same run-meta.json. `--list-tags` prints each tag and how many loaded
 * records carry it, and nothing else — no claim text — then exits before a pack
 * is built or any model is called.
 *
 * Every run writes `run-meta.json` beside its stage files: the goal, the run's
 * instant, the attributed review time, and sha256 fingerprints of
 * config/approved-facts.json, of the automotive facts file, and of the evidence
 * pack projection — what a later `--replay-critic` needs to prove it rebuilt the
 * same evidence. A scoped run also records its effective scope
 * (`evidenceScope`), and that scope is part of the pack fingerprint; a replay
 * rebuilds with the recorded scope and refuses a `--scope-tags` that differs.
 *
 * `--resume-from packaging-adaptation <run-dir>` runs stage 5, the contact
 * lines and the critic panel against a saved run's stage 1–4 outputs — for a
 * run whose paid stages 1–4 validated and whose stage 5 was refused. It makes
 * the same free checks as `--replay-critic` (fingerprints, recorded scope,
 * revalidation of every reused output through its owning validator) with no
 * unproven path, prices only the requests it makes, keeps the typed LIVE gate,
 * and writes a new sibling directory; the source run is never modified.
 *
 * `--revise-from <run-dir>` makes one opt-in revision round on a completed run,
 * and `--revise-once` makes the same round right after a full run. It verifies
 * the source exactly as a resume does — fingerprints, recorded scope, every
 * saved stage 1–5 output — and also revalidates the saved critic panel output.
 * Then it re-runs, once, the earliest writing stage that owns a blocking
 * finding and every later writing stage through stage 5, each given its own
 * round-1 output (`PREVIOUS_OUTPUT`) and only the findings it owns
 * (`CRITIC_FINDINGS`, at most its derived cap); re-attaches the contact lines;
 * and runs all four critic lenses fresh, shown no round-1 finding or verdict.
 * Findings owned by `human_review`, and every `human_decision` finding, never
 * reach a model: they are listed as owner items. No revisable blocking finding
 * means no request at all. It prices only the requests it makes, keeps the typed
 * LIVE gate, and writes a new `<source>-revised-<timestamp>` sibling; the
 * source run is never modified. See `src/harness/agents/revision.ts`.
 *
 * Since Content Studio S1 this script is a thin shell. The pipeline core —
 * the evidence pack, every free check, the six stages, the saved-run paths,
 * the fake runner, the field measurements and the cost-ceiling computation —
 * lives in `src/harness/contentRun/**`, compiled to `dist/harness/contentRun/`,
 * so the Content Studio worker (`src/studio/worker/**`, S3) runs the same code
 * (docs/CONTENT_STUDIO_DESIGN.md §5.1). This file keeps argument parsing, the
 * typed LIVE and UNPROVEN prompts, console output and file writing, and hands
 * the library its paid-action consent, its UNPROVEN confirmation, its
 * review-only execution context (§5.4; every paid path requires one) and a
 * run-directory sink. Behaviour, flags, file names and bytes are unchanged
 * (`scripts/local/content-run-golden.mjs` proves it against a base revision).
 *
 * Requires `npm run build` first (this script imports the compiled `dist/`
 * output, the same way `npm run test:offline` and the other `scripts/*.mjs`
 * tools in this repository do).
 *
 * Usage:
 *   node scripts/local/content-run.mjs "<goal text>" [options]
 *   node scripts/local/content-run.mjs --replay-critic <run-dir> ["<goal text>"] [options]
 *   node scripts/local/content-run.mjs --resume-from packaging-adaptation <run-dir> [options]
 *   node scripts/local/content-run.mjs --revise-from <run-dir> [options]
 *   node scripts/local/content-run.mjs "<goal text>" --revise-once [options]
 *   node scripts/local/content-run.mjs --list-tags [--automotive-facts <path>] [--scope-tags a,b,c]
 *
 * Options:
 *   --runner fake|live         Default "fake": canned responses, no network,
 *                              no cost. "live" calls the real Anthropic API
 *                              through the production stage boundary and
 *                              REQUIRES --i-understand-this-costs-money, then
 *                              the word LIVE typed at the prompt.
 *   --i-understand-this-costs-money
 *                              Required to use --runner live.
 *   --replay-critic <run-dir>  Run ONLY final-critic — all four lens requests —
 *                              against an existing run
 *                              directory's saved stage 1-5 outputs. Writes to a
 *                              new sibling directory and never touches the
 *                              source run. Refuses unless the rebuilt evidence
 *                              matches the run's recorded fingerprints, and
 *                              revalidates every saved output before any model
 *                              call. The goal is read from the run's
 *                              run-meta.json when present, else from its
 *                              summary.md, else from the positional argument.
 *   --resume-from packaging-adaptation <run-dir>
 *                              Run stage 5, the contact lines and final-critic
 *                              (five model requests) against an existing run's
 *                              saved stage 1-4 outputs; stages 1-4 make no
 *                              request. Writes to a new sibling directory and
 *                              never touches the source run. Refuses unless
 *                              run-meta.json records, and the rebuilt evidence
 *                              matches, the approved-facts, automotive-facts and
 *                              pack fingerprints, and unless every saved stage
 *                              1-4 output is present and revalidates. Reuses the
 *                              recorded goal, scope and platforms.
 *                              packaging-adaptation is the only resume point.
 *   --revise-from <run-dir>    One revision round on a completed run (it must hold
 *                              run-meta.json with all three fingerprints, saved
 *                              stage 1-5 outputs and 06-final-critic.json). Re-runs
 *                              the earliest writing stage owning a blocking finding
 *                              and every later writing stage, then all four critic
 *                              lenses fresh. Stages 1-2 are never re-run. No
 *                              revisable blocking finding: no request. Writes
 *                              <run-dir>-revised-<timestamp>; never touches the
 *                              source run.
 *   --revise-once              With a goal: a full run, then the same single
 *                              revision round on it. Round 1's run directory is
 *                              kept exactly as written. Live: the revision is
 *                              priced after round 1 and asks for LIVE again.
 *   --scope-tags a,b,c         Narrow the evidence pack to records carrying any of
 *                              these tags. The contact-line and identity records
 *                              are always included. Default: no scope — every
 *                              loaded record, exactly as before. A replay reuses
 *                              the source run's recorded scope; if given there it
 *                              must match it.
 *   --list-tags                Print each tag and its record count from the loaded
 *                              records (no claim text) and exit. Builds no pack and
 *                              makes no model call.
 *   --automotive-facts <path> Default config/automotive-facts.local.json.
 *   --platforms a,b,c          Default instagram,facebook,google_business_profile.
 *   --out-dir <path>           Default local-output/content-intelligence.
 *   --reviewed-at <iso8601>    Attributed review time for approved-facts.json.
 *                              Default: now (mirrors evidence:sync's own default).
 *   -h, --help
 */

import { existsSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const DIST_HARNESS = resolve(REPO_ROOT, "dist/harness");
/** The compiled pipeline library this CLI drives (src/harness/contentRun/). */
const LIBRARY = resolve(DIST_HARNESS, "contentRun/index.js");

/**
 * The library, loaded once when this module is imported — but only if it has
 * been built. Without it, argument parsing and usage still work, and `main`
 * refuses with the build instruction exactly as before (`requireDist`).
 */
const lib = existsSync(LIBRARY) ? await import(LIBRARY) : undefined;

/**
 * Set once the run directory exists, so the failure handler can persist the
 * raw provider responses the run already paid for. Null until then, and left
 * null entirely for failures that happen before any request is made.
 */
let failureContext = null;

function usage() {
  console.log(`Usage: node scripts/local/content-run.mjs "<goal text>" [options]

       node scripts/local/content-run.mjs --replay-critic <run-dir> ["<goal text>"] [options]
       node scripts/local/content-run.mjs --resume-from packaging-adaptation <run-dir> [options]
       node scripts/local/content-run.mjs --revise-from <run-dir> [options]
       node scripts/local/content-run.mjs "<goal text>" --revise-once [options]
       node scripts/local/content-run.mjs --list-tags [--automotive-facts <path>] [--scope-tags a,b,c]

Options:
  --runner fake|live               Default "fake". "live" requires --i-understand-this-costs-money,
                                   then typing LIVE at the prompt.
  --i-understand-this-costs-money  Required to use --runner live.
  --replay-critic <run-dir>        Run only final-critic against a saved run; writes a new sibling directory.
  --resume-from packaging-adaptation <run-dir>
                                   Run stage 5 and final-critic against a saved run's stage 1-4 outputs;
                                   writes a new sibling directory. packaging-adaptation is the only resume point.
  --revise-from <run-dir>          One revision round on a completed run: re-run the earliest writing stage that owns
                                   a blocking finding and every later one, then the critic panel fresh. Human items
                                   never reach a model. Writes <run-dir>-revised-<timestamp>.
  --revise-once                    With a goal: a full run, then the same single revision round on it.
  --scope-tags a,b,c               Narrow the evidence pack to records with any of these tags. Contact-line and
                                   identity records are always included. Default: no scope (every record).
  --list-tags                      Print each tag and its record count (no claim text) and exit; no model call.
  --automotive-facts <path>        Default config/automotive-facts.local.json
  --platforms a,b,c                Default instagram,facebook,google_business_profile
  --out-dir <path>                 Default local-output/content-intelligence
  --reviewed-at <iso8601>          Default: now
  -h, --help
`);
}

export function parseArgs(argv) {
  const args = {
    goal: undefined,
    runner: "fake",
    understandsCost: false,
    automotiveFactsPath: resolve(REPO_ROOT, "config/automotive-facts.local.json"),
    platforms: undefined,
    outDir: resolve(REPO_ROOT, "local-output/content-intelligence"),
    reviewedAt: new Date().toISOString(),
    reviewedAtExplicit: false,
    replayCritic: undefined,
    resumeFrom: undefined,
    reviseFrom: undefined,
    reviseOnce: false,
    scopeTags: undefined,
    listTags: false,
    help: false,
  };
  const rest = [...argv];
  while (rest.length) {
    const token = rest.shift();
    if (token === "-h" || token === "--help") { args.help = true; continue; }
    if (token === "--runner") { args.runner = rest.shift(); continue; }
    if (token === "--i-understand-this-costs-money") { args.understandsCost = true; continue; }
    if (token === "--automotive-facts") { args.automotiveFactsPath = resolve(process.cwd(), rest.shift()); continue; }
    if (token === "--platforms") { args.platforms = (rest.shift() ?? "").split(",").map((p) => p.trim()).filter(Boolean); continue; }
    if (token === "--out-dir") { args.outDir = resolve(process.cwd(), rest.shift()); continue; }
    if (token === "--reviewed-at") { args.reviewedAt = rest.shift(); args.reviewedAtExplicit = true; continue; }
    if (token === "--replay-critic") { args.replayCritic = resolve(process.cwd(), rest.shift() ?? ""); continue; }
    if (token === "--resume-from") { args.resumeFrom = parseResumeFrom(rest.shift(), rest.shift()); continue; }
    if (token === "--revise-from") { args.reviseFrom = parseReviseFrom(rest.shift()); continue; }
    if (token === "--revise-once") { args.reviseOnce = true; continue; }
    if (token === "--scope-tags") { args.scopeTags = normalizeScopeTags(rest.shift()); continue; }
    if (token === "--list-tags") { args.listTags = true; continue; }
    if (token.startsWith("--")) { throw new Error(`unknown option: ${token}`); }
    if (args.goal === undefined) { args.goal = token; continue; }
    throw new Error(`unexpected extra argument: ${token}`);
  }
  return args;
}

/** The stages `--resume-from` accepts. Only packaging-adaptation in this change. */
export const RESUME_POINTS = ["packaging-adaptation"];

/** `--resume-from <stage> <run-dir>`, refused unless the stage is a resume point and a directory follows. */
export function parseResumeFrom(stage, dir) {
  if (!RESUME_POINTS.includes(stage)) {
    throw new Error(`--resume-from accepts only ${RESUME_POINTS.join(", ")} as the resume point, `
      + `got: ${stage === undefined ? "(nothing)" : JSON.stringify(stage)}`);
  }
  if (!dir || dir.startsWith("--")) {
    throw new Error(`--resume-from ${stage} needs a run directory: --resume-from ${stage} <run-dir>`);
  }
  return { stage, dir: resolve(process.cwd(), dir) };
}

/** `--revise-from <run-dir>`, refused unless a directory follows. */
export function parseReviseFrom(dir) {
  if (!dir || dir.startsWith("--")) throw new Error("--revise-from needs a run directory: --revise-from <run-dir>");
  return resolve(process.cwd(), dir);
}

/**
 * `--scope-tags` as the effective tag list: trimmed, deduplicated and sorted, so
 * the same scope always records and fingerprints identically however it was
 * typed. An empty list is refused rather than read as "no scope".
 */
export function normalizeScopeTags(value) {
  const tags = [...new Set(String(value ?? "").split(",").map((t) => t.trim()).filter(Boolean))].sort();
  if (!tags.length) throw new Error("--scope-tags needs at least one tag (a,b,c); omit the flag for no scope");
  return tags;
}

function requireDist() {
  for (const marker of [resolve(DIST_HARNESS, "agents/registry.js"), LIBRARY]) {
    if (!existsSync(marker)) {
      throw new Error(
        `compiled output not found at ${marker}\n` +
        "Run \"npm run build\" first — this CLI drives the compiled stage executors, " +
        "the same way \"npm run test:offline\" does.",
      );
    }
  }
}

/** A repository-relative path where possible, so a record does not name a home directory. */
function displayPath(path) {
  const rel = relative(REPO_ROOT, path);
  return rel && !rel.startsWith("..") ? rel : path;
}

/**
 * Read one line from stdin after printing `question`.
 *
 * Works for a terminal and for piped input alike; end of input reads as an
 * empty answer, which every caller treats as a refusal.
 */
function askLine(question) {
  return new Promise((resolveAnswer) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
    let answered = false;
    process.stderr.write(question);
    rl.once("line", (line) => { answered = true; rl.close(); resolveAnswer(line.trim()); });
    rl.once("close", () => { if (!answered) resolveAnswer(""); });
  });
}

/**
 * The spend guard, shared by the full run and the critic-only replay so the
 * two cannot drift apart: the explicit cost flag, then the exact word LIVE
 * typed at the prompt. Either missing refuses before any request is built.
 */
async function requireLiveConsent(args) {
  if (!args.understandsCost) {
    throw new Error('--runner live requires --i-understand-this-costs-money (this makes real, billed Anthropic API calls)');
  }
  const typed = await askLine("Type LIVE to make real, billed model calls (anything else cancels): ");
  if (typed !== "LIVE") {
    throw new Error(`live run cancelled: expected the exact word LIVE, received ${JSON.stringify(typed)}`);
  }
  console.log("Proceeding with LIVE model calls — this will incur real cost.");
}

/** Print the library's cost ceiling exactly as this CLI always has. */
function printCostCeiling({ lines, totalUsd, policiesChecked, policyMaxTokens }, label) {
  console.log("Estimated ceiling cost per model request (rough, not billing-accurate):");
  for (const line of lines) {
    console.log(`  ${line.label.padEnd(35)} ${line.model.padEnd(20)} out<=${line.maxTokens} tokens  ~$${line.costUsd?.toFixed(2) ?? "?"}`);
  }
  console.log(`Estimated ceiling for ${label} (${lines.length} model requests): ~$${totalUsd.toFixed(2)}`);
  console.log(`(policies checked: ${policiesChecked.join(", ")}; POLICY_MAX_TOKENS=${JSON.stringify(policyMaxTokens)})`);
}

/**
 * This CLI's paid-action consent, which the library calls after every free
 * check and after pricing, before any request exists: the ceiling for exactly
 * the requests about to be made, then the cost flag and the typed word LIVE.
 */
function liveConsent(args) {
  return async (request) => {
    printCostCeiling(request.ceiling, request.label);
    if (request.revisionRoundMaxRequests !== undefined) {
      console.log(`--revise-once: the revision round is not included above. After round 1 it prints the ceiling for `
        + `exactly the requests it will make (at most ${request.revisionRoundMaxRequests}) `
        + "and asks for LIVE again.");
    }
    await requireLiveConsent(args);
  };
}

/** This CLI's UNPROVEN confirmation: the operator types the word, or the replay is cancelled. */
async function confirmUnprovenAtPrompt() {
  const typed = await askLine("Type UNPROVEN to continue with an unproven automotive facts file (anything else cancels): ");
  return typed === "UNPROVEN" ? { confirmed: true } : { confirmed: false, reason: `received ${JSON.stringify(typed)}` };
}

/** A run directory as the library's sink. Writes are synchronous, so the failure path stays synchronous. */
function directorySink(dir) {
  return {
    label: dir,
    writeArtifact: (name, bytes) => writeFileSync(resolve(dir, name), bytes),
    recordRequest: () => {},
  };
}

/** A saved run directory as the library's source. */
function directorySource(dir) {
  return {
    label: dir,
    displayLabel: displayPath(dir),
    name: basename(dir),
    exists: () => existsSync(dir),
    readArtifact: async (name) => {
      const path = resolve(dir, name);
      return existsSync(path) ? readFile(path) : undefined;
    },
  };
}

/**
 * Where runs are written: a full run in `--out-dir/<timestamp>`, and a replay,
 * resume or revision in a new sibling of its source, never over an existing one.
 */
function directoryOutputs(args) {
  return {
    async openFullRun({ now }) {
      const runDir = resolve(args.outDir, new Date(now).toISOString().replace(/[:.]/g, "-"));
      await mkdir(runDir, { recursive: true });
      return directorySink(runDir);
    },
    async openDerivedRun({ kind, source, at, resumeAt }) {
      const suffix = kind === "resume" ? `resume-${resumeAt}` : kind === "critic-replay" ? "critic-replay" : "revised";
      const dir = resolve(dirname(source.label),
        `${basename(source.label)}-${suffix}-${at.toISOString().replace(/[:.]/g, "-")}`);
      if (existsSync(dir)) throw new Error(`refusing to overwrite an existing directory: ${dir}`);
      await mkdir(dir, { recursive: false });
      return directorySink(dir);
    },
  };
}

/**
 * The facts a run reads. `args.approvedFactsPath` exists only so the offline
 * suite can point this at an edited copy; no command-line option sets it, and
 * every run reads `config/approved-facts.json`.
 */
function cliFacts(args) {
  const approvedFactsPath = args.approvedFactsPath ?? resolve(REPO_ROOT, "config/approved-facts.json");
  return {
    approvedFacts: lib.factFileAt(approvedFactsPath, displayPath(approvedFactsPath)),
    automotiveFacts: lib.factFileAt(args.automotiveFactsPath, displayPath(args.automotiveFactsPath)),
  };
}

const cliReporter = { log: (message) => console.log(message), warn: (message) => console.warn(message) };

/**
 * The review-only execution context this CLI hands every run (Content Studio
 * S3; docs/CONTENT_STUDIO_DESIGN.md §5.4). The library refuses every paid path
 * without one. Its per-request check allows every request unit, because this
 * CLI's consent for the whole priced action — the cost flag and the typed
 * LIVE — is given before the first request; so nothing this CLI does changes.
 * Made once, and only after the compiled library is known to exist.
 */
let cliContext;
export function cliExecutionContext() {
  cliContext ??= lib.createReviewOnlyExecutionContext({ caller: "local-cli", checkRequests: async () => {} });
  return cliContext;
}

/** The collaborators this CLI hands the library for one run. */
function cliIo(args) {
  return {
    reporter: cliReporter,
    consent: liveConsent(args),
    confirmUnproven: confirmUnprovenAtPrompt,
    outputs: directoryOutputs(args),
    execution: cliExecutionContext(),
    onFailureContext: (context) => {
      failureContext = context && { ...context, runDir: context.sink.label };
    },
  };
}

/** The parsed flags as the library's run options. */
function runOptions(args) {
  return {
    runner: args.runner,
    facts: cliFacts(args),
    goal: args.goal,
    platforms: args.platforms,
    scopeTags: args.scopeTags,
    reviewedAt: args.reviewedAt,
    reviewedAtExplicit: args.reviewedAtExplicit,
    reviseOnce: args.reviseOnce,
  };
}

/** The compiled modules this CLI drives. Loaded after `requireDist`. */
export async function loadRuntime() {
  return lib.loadRuntime();
}

/**
 * The library itself, for the offline suite: it may reach the library only
 * through this CLI (the caller allowlist, docs/CONTENT_STUDIO_DESIGN.md §5.4).
 */
export const contentRunLibrary = lib;

// The library's pure helpers, re-exported so the offline suite can exercise
// them through this CLI (it may import the library only through here).
export const {
  allStagePolicies, criticLensPolicies, resumePolicies, revisionPolicies, alwaysIncludedIds,
  effectiveEvidenceScope, evidencePackFingerprint, markdownSummary, summaryFooter, revisionSummaryLines,
} = lib ?? {};

/**
 * Build and validate the evidence pack exactly as a full run does, and return
 * the fingerprints a later replay needs to prove it rebuilt the same pack.
 */
export async function buildRunEvidence(rt, args) {
  return lib.buildRunEvidence(rt, {
    goal: args.goal, now: args.now, reviewedAt: args.reviewedAt, runner: args.runner, scopeTags: args.scopeTags,
    facts: cliFacts(args),
  }, cliReporter);
}

/**
 * `--list-tags`: each tag and how many loaded records carry it, sorted by tag,
 * and nothing else from any record — no id, no claim text. With `--scope-tags`
 * it also prints how many records that scope would put in the pack, the always-
 * included records counted. Builds no pack and makes no model call.
 */
export async function listTags(rt, args) {
  const { records, counts, tags, warning, scope } = await lib.countTags(rt, {
    facts: cliFacts(args), now: Date.now(), reviewedAt: args.reviewedAt, scopeTags: args.scopeTags,
  });
  if (warning) console.warn(`warning: ${warning}`);
  const width = Math.max(3, ...tags.map((t) => t.length));
  console.log(`${records.length} loaded record(s); ${tags.length} tag(s). No claim text is shown.`);
  console.log(`${"tag".padEnd(width)}  records`);
  for (const tag of tags) console.log(`${tag.padEnd(width)}  ${counts.get(tag)}`);
  if (scope) {
    console.log(`--scope-tags ${scope.tags.join(",")} would include ${scope.inScope} record(s), `
      + `${scope.alwaysIncludedLoaded} of them always included `
      + `(pack cap ${scope.packCap}).`);
  }
}

/** `--resume-from packaging-adaptation <run-dir>`, through the library. */
export async function resumeFromPackaging(rt, args) {
  return lib.resumeFromPackaging(rt, runOptions(args), directorySource(args.resumeFrom.dir), args.resumeFrom.stage,
    cliIo(args));
}

/** `--replay-critic <run-dir>`, through the library. */
async function replayCritic(rt, args) {
  return lib.replayCritic(rt, runOptions(args), directorySource(args.replayCritic), cliIo(args));
}

/**
 * One revision round — `--revise-from <run-dir>`, and the same round
 * `--revise-once` makes on the run it just wrote — through the library.
 */
export async function reviseRun(rt, args, sourceDir, origin) {
  return lib.reviseRun(rt, runOptions(args), directorySource(sourceDir), origin, cliIo(args));
}

/**
 * The CLI. `argv` defaults to the process's own arguments; the offline suite
 * passes its own to drive fake runs in-process.
 */
export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || (!args.goal && !args.replayCritic && !args.listTags && !args.resumeFrom && !args.reviseFrom)) {
    usage(); process.exit(args.help ? 0 : 1);
  }
  if (args.runner !== "fake" && args.runner !== "live") {
    throw new Error(`--runner must be "fake" or "live", got: ${args.runner}`);
  }
  if (args.resumeFrom && (args.replayCritic || args.listTags)) {
    throw new Error("--resume-from cannot be combined with --replay-critic or --list-tags");
  }
  if (args.listTags && (args.replayCritic || args.goal !== undefined)) {
    throw new Error("--list-tags takes no goal and no --replay-critic: it only prints tag counts and exits");
  }
  if (args.reviseFrom && (args.replayCritic || args.listTags || args.resumeFrom || args.reviseOnce)) {
    throw new Error("--revise-from cannot be combined with --replay-critic, --resume-from, --list-tags or --revise-once");
  }
  if (args.reviseOnce && (args.replayCritic || args.listTags || args.resumeFrom || args.goal === undefined)) {
    throw new Error("--revise-once applies only to a full run: give a goal, and no --replay-critic, --resume-from or --list-tags");
  }

  requireDist();
  const rt = await loadRuntime();
  // Before any pack is built, any registry is loaded, or any runner exists.
  if (args.listTags) return listTags(rt, args);
  if (args.replayCritic) return replayCritic(rt, args);
  if (args.resumeFrom) return resumeFromPackaging(rt, args);
  if (args.reviseFrom) return reviseRun(rt, args, args.reviseFrom, "revise-from");

  const { sink } = await lib.runFullPipeline(rt, runOptions(args), cliIo(args));

  // Exactly one round, verified from what round 1 just wrote, exactly as
  // --revise-from would verify it. Round 1's directory is never touched again.
  if (args.reviseOnce) {
    console.log("\n--revise-once: one revision round on the run above.");
    await reviseRun(rt, args, sink.label, "revise-once");
  }
}

/**
 * Whatever went wrong, anything the provider already returned was billed. Write
 * it out before reporting the failure so the operator keeps what they bought and
 * can see exactly what the model produced — into the directory of the run that
 * failed, and nowhere else. Exported so the offline suite can drive it without
 * exiting the process.
 */
export function saveFailureRecords(err) {
  try {
    failureContext?.finalize?.(err);
  } catch (finalizeErr) {
    console.error(`could not record the failure: ${finalizeErr?.message ?? finalizeErr}`);
  }
  if (failureContext?.transcript?.length) {
    try {
      const over = failureContext.writeMeasurements().rows.filter((r) => r.over);
      console.error(`Wrote field measurements to ${resolve(failureContext.runDir, "field-measurements.md")}`
        + (over.length ? ` — over: ${over.map((r) => `${r.stage}.${r.field} ${r.observed}/${r.enforced}`).join(", ")}` : ""));
    } catch (measureErr) {
      console.error(`could not write field measurements: ${measureErr?.message ?? measureErr}`);
    }
    const target = resolve(failureContext.runDir, "rejected-responses.json");
    try {
      writeFileSync(target, JSON.stringify(failureContext.transcript, null, 2), "utf8");
      console.error(
        `Saved ${failureContext.transcript.length} raw provider response(s) — already paid for — to:\n  ${target}`,
      );
    } catch (writeErr) {
      console.error(`could not save raw provider responses: ${writeErr?.message ?? writeErr}`);
    }
  }
}

/** Save what was paid for, name the failure, and exit non-zero. */
function reportFailure(err) {
  saveFailureRecords(err);
  if (err?.name === "EvidencePackBoundsError" || err?.name === "EvidencePackSemanticError") {
    console.error(`${err.name}: ${err.message}`);
    if (Array.isArray(err.violations)) for (const v of err.violations) console.error(`  - ${v}`);
  } else if (err?.name === "EvidenceValidationError") {
    console.error(`${err.name}: ${err.message}`);
    if (Array.isArray(err.issues)) for (const i of err.issues) console.error(`  - ${i}`);
  } else if (err?.name === "StageExecutionError" || err?.name === "CriticPanelError") {
    console.error(`${err.name}: ${err.message}`);
  } else if (["StageOutputTruncatedError", "StageRefusalError", "StageUnexpectedStopError", "ContactLineError",
    "IdentityFactError", "EvidenceScopeError", "RevisionCapError"].includes(err?.name)) {
    console.error(`${err.name}: ${err.message}`);
  } else {
    console.error(err?.stack ?? String(err));
  }
  process.exit(1);
}

/**
 * Run only when executed as a script. Importing this module — the offline suite
 * does, to exercise `markdownSummary` and `summaryFooter` directly — defines the
 * functions and runs nothing.
 */
function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint()) main().catch(reportFailure);
