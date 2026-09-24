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
 * Every run writes `run-meta.json` beside its stage files: the goal, the run's
 * instant, the attributed review time, and sha256 fingerprints of
 * config/approved-facts.json, of the automotive facts file, and of the evidence
 * pack projection — what a later `--replay-critic` needs to prove it rebuilt the
 * same evidence.
 *
 * Requires `npm run build` first (this script imports the compiled `dist/`
 * output, the same way `npm run test:offline` and the other `scripts/*.mjs`
 * tools in this repository do).
 *
 * Usage:
 *   node scripts/local/content-run.mjs "<goal text>" [options]
 *   node scripts/local/content-run.mjs --replay-critic <run-dir> ["<goal text>"] [options]
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
 *   --automotive-facts <path> Default config/automotive-facts.local.json.
 *   --platforms a,b,c          Default instagram,facebook,google_business_profile.
 *   --out-dir <path>           Default local-output/content-intelligence.
 *   --reviewed-at <iso8601>    Attributed review time for approved-facts.json.
 *                              Default: now (mirrors evidence:sync's own default).
 *   -h, --help
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const DIST_HARNESS = resolve(REPO_ROOT, "dist/harness");

/**
 * Set once the run directory exists, so the failure handler can persist the
 * raw provider responses the run already paid for. Null until then, and left
 * null entirely for failures that happen before any request is made.
 */
let failureContext = null;

function usage() {
  console.log(`Usage: node scripts/local/content-run.mjs "<goal text>" [options]

       node scripts/local/content-run.mjs --replay-critic <run-dir> ["<goal text>"] [options]

Options:
  --runner fake|live               Default "fake". "live" requires --i-understand-this-costs-money,
                                   then typing LIVE at the prompt.
  --i-understand-this-costs-money  Required to use --runner live.
  --replay-critic <run-dir>        Run only final-critic against a saved run; writes a new sibling directory.
  --automotive-facts <path>        Default config/automotive-facts.local.json
  --platforms a,b,c                Default instagram,facebook,google_business_profile
  --out-dir <path>                 Default local-output/content-intelligence
  --reviewed-at <iso8601>          Default: now
  -h, --help
`);
}

function parseArgs(argv) {
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
    if (token.startsWith("--")) { throw new Error(`unknown option: ${token}`); }
    if (args.goal === undefined) { args.goal = token; continue; }
    throw new Error(`unexpected extra argument: ${token}`);
  }
  return args;
}

function requireDist() {
  const marker = resolve(DIST_HARNESS, "agents/registry.js");
  if (!existsSync(marker)) {
    throw new Error(
      `compiled output not found at ${marker}\n` +
      "Run \"npm run build\" first — this CLI drives the compiled stage executors, " +
      "the same way \"npm run test:offline\" does.",
    );
  }
}

/**
 * Load the operator-supplied automotive facts file.
 *
 * This file is never committed with real content (see .gitignore) and this
 * function never invents a fact: every record must already carry the
 * checkable sourceRef, provenance, and reviewedAt the evidence contract
 * requires. A missing file is not an error here — automotive-truth simply
 * refuses to run later, with a clear message — because an operator who has
 * not yet populated it should still be able to inspect strategy-concept.
 */
async function loadAutomotiveFacts(path, now) {
  if (!existsSync(path)) {
    return { records: [], warning: `no automotive facts file at ${path} (copy config/automotive-facts.local.example.json and fill in real, sourced facts)` };
  }
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  const entries = Array.isArray(parsed) ? parsed : parsed.facts;
  if (!Array.isArray(entries)) {
    throw new Error(`${path} must be a JSON array, or an object with a "facts" array`);
  }
  const nowIso = new Date(now).toISOString();
  const required = ["id", "claim", "subject", "tags", "sourceType", "sourceRef", "provenance", "reviewedAt"];
  const records = entries.map((entry, index) => {
    const missing = required.filter((field) => entry[field] === undefined || entry[field] === null);
    if (missing.length) {
      throw new Error(`${path}: entry ${index} (id=${entry.id ?? "?"}) is missing required field(s): ${missing.join(", ")}`);
    }
    return {
      id: entry.id,
      kind: "verified_automotive_fact",
      claim: entry.claim,
      subject: entry.subject,
      attribute: entry.attribute,
      tags: entry.tags,
      sourceType: entry.sourceType,
      sourceRef: entry.sourceRef,
      provenance: entry.provenance,
      confidence: entry.confidence,
      observedAt: entry.observedAt,
      reviewedAt: entry.reviewedAt,
      reviewedBy: entry.reviewedBy,
      reviewBy: entry.reviewBy,
      expiresAt: entry.expiresAt,
      createdAt: entry.createdAt ?? nowIso,
      lifecycle: entry.lifecycle ?? "active",
    };
  });
  return { records, warning: undefined };
}

function short(text, max) {
  const s = String(text);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Canned, deterministic per-stage responses for `--runner fake`.
 *
 * Every citation these responses make is a real evidence id drawn from the
 * caller's own evidence pack or from the immediately preceding stage's own
 * validated output — never an invented fact. That is what makes this safe to
 * run with no model call: the wiring is exercised, not the facts.
 */
function buildFakeStageResponses(goal, pack) {
  const bizIds = pack.allowedFacts.filter((r) => r.kind === "verified_business_fact").map((r) => r.id);
  const autoIds = pack.allowedFacts.filter((r) => r.kind === "verified_automotive_fact").map((r) => r.id);

  return {
    strategyConcept() {
      return {
        angle: `A "peace of mind, done right the first time" angle for: ${short(goal, 160)}`,
        concept: "Short-form piece pairing a real shop fact with the goal, framed around trust and transparency rather than a discount.",
        rationale: "Anchoring on verified business facts (warranty, diagnostics process, ownership) keeps the piece defensible; automotive-truth reviews every citation before anything downstream can use it.",
        supportingFactIds: bizIds.slice(0, 3),
        observationIds: [],
        performanceSignalIds: [],
        hypotheses: [{ statement: "Leading with the warranty term increases trust before price is ever mentioned.", basis: "creative" }],
        assumptions: ["The audience has not worked with GCD before."],
      };
    },
    automotiveTruth() {
      const allowedClaims = [
        ...autoIds.slice(0, 3).map((factId) => ({
          factId, claimClass: "automotive",
          restatement: "Restated plainly, without adding a number, interval, or guarantee the source does not state.",
        })),
        ...bizIds.slice(0, 2).map((factId) => ({
          factId, claimClass: "business",
          restatement: "Restated plainly from the approved business fact, unchanged in meaning.",
        })),
      ];
      return {
        assessment: allowedClaims.length
          ? `${allowedClaims.length} claim(s) are citable against the supplied evidence; everything else stage 1 proposed is forbidden pending real evidence.`
          : "No automotive fact was supplied, so no automotive claim may be made; only business facts remain citable.",
        allowedClaims,
        forbiddenClaims: [{ claim: "Any specific mileage, price, or timeframe not stated verbatim in the cited evidence.", reason: "no_citable_fact" }],
        requiredCaveats: ["Every number or interval in the final copy must trace to a cited fact, verbatim."],
        openQuestions: ["Is there a verified, sourced maintenance interval for the specific system this piece is about?"],
      };
    },
    hookStoryScript(truthOutput) {
      const permitted = truthOutput.constraints.allowed.map((a) => a.factId);
      const claimUse = permitted.slice(0, 2).map((factId, i) => ({
        factId, usedIn: i === 0 ? "hook" : "script",
        paraphrase: "Used exactly as automotive-truth permitted it, with no added specifics.",
      }));
      return {
        hook: `Here's what "${short(goal, 80)}" actually looks like at a shop that shows you the diagnosis first.`,
        storyBeats: [
          { beat: "Open on the customer's problem and the uncertainty of not knowing what a shop will find.", role: "setup" },
          { beat: "Show the permitted fact in action — the process, not a promise.", role: "insight" },
          { beat: "Close on the invitation to book, no pressure.", role: "closing" },
        ],
        script: "VO: You don't have to guess what a repair will cost or whether it's needed. That's what the permitted facts back up here, and nothing more than that.",
        claimUse,
        openQuestions: [],
      };
    },
    productionDirection(scriptOutput) {
      const usedIds = scriptOutput.claimUse.used.map((u) => u.factId);
      return {
        visualApproach: "Handheld, in-bay footage that shows the work rather than describing it.",
        shots: [
          {
            purpose: "establishing", subject: "The bay, mid-inspection.", framing: "wide", movement: "static",
            action: "Technician reviewing a diagnostic readout.",
            composition: "Vehicle on the lift, readout visible but not legible on camera.",
            continuityNote: "Same technician and bay across every shot in this piece.",
          },
          {
            purpose: "demonstration", subject: "The permitted fact, shown rather than narrated.", framing: "medium", movement: "handheld",
            action: "Technician points to the specific component the permitted fact is about.",
            composition: "Over-the-shoulder, hands and part in frame.",
            continuityNote: "Same lighting as the establishing shot.",
          },
        ],
        overlayText: [],
        productionRequirements: [{ requirement: "Written customer/vehicle consent to film in the bay.", category: "permission" }],
        claimVisuals: usedIds.slice(0, 1).map((factId) => ({
          factId, shotIndex: 1,
          directionSummary: "The second shot exists specifically to show this permitted fact, not to illustrate anything beyond it.",
        })),
        openQuestions: [],
      };
    },
    packagingAdaptation(scriptOutput, platforms) {
      const usedIds = scriptOutput.claimUse.used.map((u) => u.factId);
      const factId = usedIds[0];
      const packages = platforms.map((platform) => {
        const base = "Real diagnosis before real work — that's the whole method. No guessing, no upsell theater.";
        if (platform === "instagram") {
          return {
            platform, caption: base,
            hashtags: ["GermanCarDepot", "BMWRepair", "MercedesRepair", "AudiRepair", "PorscheRepair", "EuroCarCare", "HollywoodFL", "DealershipAlternative"].map((t) => `#${t}`),
            localKeywords: ["Hollywood FL European auto repair", "BMW Mercedes Audi Porsche service Broward"],
            recommendedTime: "09:00 ET",
            openQuestions: [],
          };
        }
        if (platform === "facebook") {
          return {
            platform, caption: base,
            hashtags: ["#GermanCarDepot", "#EuroCarCare"],
            localKeywords: ["Hollywood FL European auto repair"],
            recommendedTime: "12:00 ET",
            openQuestions: [],
          };
        }
        return {
          platform, caption: base,
          hashtags: [],
          localKeywords: ["European auto repair Hollywood FL"],
          recommendedTime: "10:00 ET",
          openQuestions: [],
        };
      });
      const claimUse = factId
        ? platforms.map((platform) => ({ platform, factId, summary: "This platform's caption relies on the same permitted, script-used fact and no other." }))
        : [];
      return { packages, claimUse };
    },
    /**
     * One canned answer per critic lens. The executor sends four requests,
     * each labelled with its lens; each answer uses only that lens's categories.
     */
    finalCritic(packagingOutput, platforms, lens) {
      const bound = platforms.flatMap((platform) => {
        const use = packagingOutput.claimUse.used.find((u) => u.platform === platform);
        return use ? [{ platform, factId: use.factId }] : [];
      });
      switch (lens) {
        case "evidence-fidelity":
          return {
            verdict: "provisional_pass",
            summary: "Fake-runner evidence lens: every caption relies on the same bound fact. Nothing here was reviewed by a person.",
            findings: [{
              severity: "advisory", category: "claim_fidelity", platform: "cross_platform", owner: "packaging-adaptation",
              issue: "The caption is identical across platforms; check each still says only what its own platform's bound claim supports.",
              suggestedAction: "Vary phrasing per platform while keeping the same permitted fact and the same claim boundary.",
            }],
            claimFindingUse: bound.map(({ platform, factId }) => ({
              findingIndex: 0, platform, factId, summary: "The same fact this platform's caption already cites.",
            })),
          };
        case "platform-and-local":
          return {
            verdict: "provisional_pass",
            summary: "Fake-runner platform lens: no platform-fit concern raised by canned output.",
            findings: [],
            claimFindingUse: [],
          };
        case "voice-and-craft":
          return {
            verdict: "provisional_pass",
            summary: "Fake-runner voice lens: no voice concern raised by canned output.",
            findings: [],
          };
        case "production-coherence":
          return {
            verdict: "provisional_pass",
            summary: "Fake-runner production lens: canned output, not a reviewed piece of content.",
            findings: [{
              severity: "advisory", category: "human_decision", platform: "cross_platform", owner: "human_review",
              issue: "This is a canned, fake-runner demonstration output, not a reviewed piece of content.",
              suggestedAction: "A human must review the real evidence, the real script, and the real package before anything here is used.",
            }],
          };
        default:
          throw new Error(`fake runner: no canned answer for critic lens ${JSON.stringify(lens)}`);
      }
    },
  };
}

/** sha256 of exact file bytes — the same digest the registry records per asset. */
function sha256OfBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** sha256 of a file's bytes, or null when the file does not exist. */
async function fileFingerprint(path) {
  if (!existsSync(path)) return null;
  return sha256OfBytes(await readFile(path));
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

/**
 * The run timestamp a run directory's name encodes. `main` names each run
 * `new Date(now).toISOString()` with ":" and "." replaced by "-", so the
 * original instant is recoverable exactly for runs that predate run-meta.json.
 */
function nowFromRunDirName(name) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(name);
  if (!m) return undefined;
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return Number.isFinite(ms) ? ms : undefined;
}

/** The compiled modules this CLI drives. Imported once, after `requireDist`. */
async function loadRuntime() {
  const approved = await import(resolve(DIST_HARNESS, "evidence/approvedFacts.js"));
  const packModule = await import(resolve(DIST_HARNESS, "evidence/pack.js"));
  const registryModule = await import(resolve(DIST_HARNESS, "agents/registry.js"));
  const stageExecution = await import(resolve(DIST_HARNESS, "agents/stageExecution.js"));
  const strategy = await import(resolve(DIST_HARNESS, "agents/strategyConcept.js"));
  const truth = await import(resolve(DIST_HARNESS, "agents/automotiveTruth.js"));
  const script = await import(resolve(DIST_HARNESS, "agents/hookStoryScript.js"));
  const direction = await import(resolve(DIST_HARNESS, "agents/productionDirection.js"));
  const packaging = await import(resolve(DIST_HARNESS, "agents/packagingAdaptation.js"));
  const critic = await import(resolve(DIST_HARNESS, "agents/finalCritic.js"));
  const modelPolicy = await import(resolve(DIST_HARNESS, "agents/modelPolicy.js"));
  const payloadContract = await import(resolve(DIST_HARNESS, "agents/payloadContract.js"));
  const contact = await import(resolve(DIST_HARNESS, "agents/contactLine.js"));
  return {
    approved, packModule, registryModule, stageExecution, strategy, truth, script, direction,
    packaging, critic, modelPolicy, payloadContract, contact,
  };
}

/**
 * Rough, non-billing-accurate prices for the cost-ceiling estimate. Mirrors
 * `PRICE` in src/harness/sdk.ts, which is not exported; an offline regression
 * asserts every model a stage policy resolves to has a row here.
 */
const PRICE = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
};

/**
 * Print the rough ceiling for the given model requests; returns the total. Each
 * entry is one request: a full run is five stage requests plus the critic
 * panel's four lens requests, and a critic-only replay is the four lens
 * requests.
 */
function printCostCeiling(rt, stagePolicies, label) {
  const { resolveModelPolicy, modelBearingPolicies, POLICY_MAX_TOKENS } = rt.modelPolicy;
  const { MAX_PAYLOAD_CHARS } = rt.payloadContract;
  // Worst-case output tokens per stage (the one number this pipeline derives
  // and bounds) plus a ~4-chars-per-token estimate of the largest input this
  // pipeline would assemble. For a thinking policy the output ceiling includes
  // the thinking tokens, because they are billed as output and count against
  // the same `max_tokens`.
  let total = 0;
  console.log("Estimated ceiling cost per model request (rough, not billing-accurate):");
  for (const [stage, policy] of stagePolicies) {
    const resolved = resolveModelPolicy(policy);
    const price = PRICE[resolved.model];
    const inputTokensEstimate = Math.ceil(MAX_PAYLOAD_CHARS / 4);
    const cost = price ? (inputTokensEstimate * price.in + resolved.maxTokens * price.out) / 1e6 : undefined;
    total += cost ?? 0;
    console.log(`  ${stage.padEnd(35)} ${resolved.model.padEnd(20)} out<=${resolved.maxTokens} tokens  ~$${cost?.toFixed(2) ?? "?"}`);
  }
  console.log(`Estimated ceiling for ${label} (${stagePolicies.length} model requests): ~$${total.toFixed(2)}`);
  console.log(`(policies checked: ${modelBearingPolicies().join(", ")}; POLICY_MAX_TOKENS=${JSON.stringify(POLICY_MAX_TOKENS)})`);
  return total;
}

/** The critic panel: one `critic` request per lens, in lens order. */
export function criticLensPolicies(rt) {
  return rt.payloadContract.CRITIC_LENSES.map((lens) => [`final-critic:${lens}`, "critic"]);
}

/** Every model request one full run makes: five stages, then the four critic lenses. */
export function allStagePolicies(rt) {
  return [
    ["strategy-concept", "reasoning-heavy"], ["automotive-truth", "reasoning-heavy"],
    ["hook-story-script", "reasoning-standard"], ["production-direction", "reasoning-standard"],
    ["packaging-adaptation", "reasoning-standard"], ...criticLensPolicies(rt),
  ];
}

/**
 * Build and validate the evidence pack exactly as a full run does, and return
 * the fingerprints a later replay needs to prove it rebuilt the same pack.
 */
async function buildRunEvidence(rt, args) {
  const { goal, now, reviewedAt, automotiveFactsPath } = args;
  const approvedFactsPath = resolve(REPO_ROOT, "config/approved-facts.json");
  const approvedFactsBytes = await readFile(approvedFactsPath);
  const { records: businessRecords } = rt.approved.adaptApprovedFactsFile(approvedFactsBytes.toString("utf8"), {
    reviewedAt, now,
  });
  const { records: automotiveRecords, warning } = await loadAutomotiveFacts(automotiveFactsPath, now);
  if (warning) {
    // A live run must never buy a stage against an evidence pack the operator
    // did not mean to send. On 2026-09-21 this was a warning: the run scrolled
    // past it, billed a full Opus 5 stage-1 call, and the pack it reasoned over
    // held zero automotive facts. Nothing about that was recoverable after the
    // fact, and everything needed to prevent it was already known here, for
    // free, before the first request.
    if (args.runner === "live") {
      throw new Error(
        `${warning}\n  Refusing to start a LIVE run against an incomplete evidence pack. `
        + "Re-run with --runner fake to inspect the pack at no cost, or pass "
        + "--automotive-facts <path> to point at the file you meant.",
      );
    }
    console.warn(`warning: ${warning}`);
  }

  const pack = rt.packModule.assertUsableEvidencePack(rt.packModule.buildEvidencePack({
    goal,
    records: [...businessRecords, ...automotiveRecords],
    now,
  }));
  return {
    pack,
    fingerprints: {
      approvedFacts: { path: displayPath(approvedFactsPath), sha256: sha256OfBytes(approvedFactsBytes) },
      automotiveFacts: {
        path: displayPath(automotiveFactsPath),
        present: existsSync(automotiveFactsPath),
        sha256: await fileFingerprint(automotiveFactsPath),
      },
      // The exact projection a stage model is shown. It excludes review and
      // creation timestamps, so it is stable for the same facts and the same
      // freshness instant.
      evidencePackSha256: createHash("sha256")
        .update(rt.packModule.renderEvidencePackForStage(pack), "utf8").digest("hex"),
    },
  };
}

/**
 * The run's record-keeping: a transcript of every raw provider response, and
 * the field measurements. Shared by the full run and the replay.
 */
function createRunRecorder(rt, runDir) {
  const { OUTPUT_FIELD_BOUNDS, statedCeiling } = rt.payloadContract;
  const {
    PLATFORM_PACKAGING_POLICY, PACKAGING_LIMITS, proposedProviderText, effectiveLocalKeywordMax,
    effectiveCaptionBudget,
  } = rt.packaging;
  // Validation runs after the provider returns, and one rejection ends the run
  // with no retry — so a response that fails a size ceiling is a response the
  // operator has already paid for. Record every raw response as it arrives; on
  // failure the catch handler writes them next to the run. This changes no
  // validation outcome: a rejected payload is still rejected, and nothing
  // recorded here is ever read back as stage output.
  const transcript = [];
  // Every run, fake or live, passing or failing, measures what it received, so
  // the next field that outgrows its limit arrives as data rather than as
  // another paid round trip.
  const writeMeasurements = () => {
    const rows = measureFields(transcript, {
      bounds: OUTPUT_FIELD_BOUNDS, statedCeiling, providerText: proposedProviderText,
      // The same caps the stage 5 validator applies: the caption budget is the
      // smaller of the provider and pipeline limits, less the contact-line
      // reserve that the deterministic contact line is appended into.
      platformCaps: (platform) => ({
        caption: PLATFORM_PACKAGING_POLICY[platform] ? effectiveCaptionBudget(platform) : 0,
        hashtags: Math.min(PLATFORM_PACKAGING_POLICY[platform]?.hashtagMax ?? 0, PACKAGING_LIMITS.maxHashtags),
        localKeywords: PLATFORM_PACKAGING_POLICY[platform] ? effectiveLocalKeywordMax(platform) : 0,
      }),
    });
    writeFileSync(resolve(runDir, "field-measurements.json"), JSON.stringify(rows, null, 2), "utf8");
    writeFileSync(resolve(runDir, "field-measurements.md"), measurementTable(rows), "utf8");
    return rows;
  };
  return { transcript, writeMeasurements };
}

/**
 * Wrap a stage runner so every response — and every response a stop-reason
 * error carries — is recorded before anything else happens to it.
 *
 * The stage boundary refuses a response that stopped at `max_tokens`, was
 * refused, or ended for any other reason than `end_turn`, and raises a named
 * error carrying the provider's complete message. That message was billed, so
 * it is saved exactly like a response a validator rejected.
 */
function recordingRunner(transcript, stage, inner) {
  return async (...callArgs) => {
    // The critic panel labels each request with its lens; every saved response
    // and every measurement row carries it, so four lens responses stay apart.
    const lens = typeof callArgs[0]?.lens === "string" ? callArgs[0].lens : undefined;
    let response;
    try {
      response = await inner(...callArgs);
    } catch (error) {
      const message = error?.response;
      if (message && typeof message === "object") {
        const text = Array.isArray(message.content)
          ? message.content.filter((b) => b?.type === "text").map((b) => b.text).join("")
          : null;
        transcript.push({
          stage,
          ...(lens ? { lens } : {}),
          receivedAt: new Date().toISOString(),
          failure: error?.name ?? "Error",
          stopReason: message.stop_reason ?? null,
          stopDetails: message.stop_details ?? null,
          chars: typeof text === "string" ? text.length : null,
          usage: message.usage ?? null,
          text,
          rawResponse: message,
        });
      }
      throw error;
    }
    transcript.push({
      stage,
      ...(lens ? { lens } : {}),
      receivedAt: new Date().toISOString(),
      chars: typeof response?.text === "string" ? response.text.length : null,
      usage: response?.usage ?? null,
      totalCostUsd: response?.totalCostUsd ?? null,
      text: response?.text ?? null,
    });
    return response;
  };
}

/**
 * Every output field's observed size against its limit, for every response the
 * run received — accepted or rejected, fake or live.
 *
 * Measured from the raw provider text, not the validated output, so a response
 * that failed a ceiling is measured too: that is the one that matters. Keys are
 * `OUTPUT_FIELD_BOUNDS`' own `<stage>.<field token>` — `final-critic:<lens>.<field
 * token>` for a critic lens response — so each row carries the
 * enforced limit, the figure the prompt states, and the field's class. The
 * binding size is UTF-8 bytes — every bound caps code units and bytes with one
 * number, and bytes are never fewer. Stage 5's caption and hashtag count are
 * measured per platform — the caption as the provider-visible text the
 * validator compares — against that platform's effective cap, and so is the
 * local keyword count. Read-only:
 * nothing here changes a validation outcome.
 */
function measureFields(transcript, { bounds, statedCeiling, platformCaps, providerText }) {
  const rows = [];
  const bytes = (text) => Buffer.byteLength(text, "utf8");
  const row = (stage, field, observed, enforced, stated, fieldClass) => rows.push({
    stage, field, observed, enforced, stated, class: fieldClass,
    pctOfStated: stated > 0 ? Math.round((observed / stated) * 100) : null, over: observed > enforced,
  });
  for (const { stage: stageId, lens, text } of transcript) {
    // A critic lens response is measured against its own lens's contract.
    const stage = lens ? `${stageId}:${lens}` : stageId;
    let raw;
    try { raw = JSON.parse(text); } catch { rows.push({ stage, field: "(response)", observed: "not JSON" }); continue; }
    const seen = new Map();
    const note = (path, n) => seen.set(path, Math.max(seen.get(path) ?? 0, n));
    const walk = (value, path) => {
      if (typeof value === "string") note(path, bytes(value));
      else if (Array.isArray(value)) { note(path, value.length); value.forEach((v) => walk(v, `${path}[]`)); }
      else if (value && typeof value === "object") {
        for (const [key, v] of Object.entries(value)) walk(v, path ? `${path}.${key}` : key);
      }
    };
    walk(raw, "");
    for (const [path, observed] of seen) {
      const key = `${stage}.${path}`;
      const bound = bounds[key];
      if (!bound || key === "packaging-adaptation.packages[].caption"
        || key === "packaging-adaptation.packages[].hashtags"
        || key === "packaging-adaptation.packages[].localKeywords") continue;
      row(stage, path, observed, bound.enforced, statedCeiling(key, bound.enforced), bound.class);
    }
    for (const pkg of (stageId === "packaging-adaptation" && Array.isArray(raw?.packages) ? raw.packages : [])) {
      if (typeof pkg?.caption !== "string") continue;
      const caps = platformCaps(pkg.platform);
      const tags = Array.isArray(pkg.hashtags) ? pkg.hashtags.filter((t) => typeof t === "string") : [];
      row(stage, `packages[${pkg.platform}].caption+hashtags`, bytes(providerText(pkg.caption, tags)),
        caps.caption, caps.caption, "product-bearing");
      row(stage, `packages[${pkg.platform}].hashtags`, tags.length, caps.hashtags, caps.hashtags, "product-bearing");
      if (Array.isArray(pkg.localKeywords)) {
        row(stage, `packages[${pkg.platform}].localKeywords`, pkg.localKeywords.length,
          caps.localKeywords, caps.localKeywords, "product-bearing");
      }
    }
  }
  return rows;
}

function measurementTable(rows) {
  const lines = ["# Field measurements", "",
    "Observed size of every bounded output field against its limit, per provider response. "
      + "Sizes are UTF-8 bytes (never fewer than characters). `stated` is what the prompt tells the model.", "",
    "| stage | field | class | observed | stated | enforced | % of stated | over |",
    "|---|---|---|---:|---:|---:|---:|---|"];
  for (const r of rows) {
    lines.push(`| ${r.stage} | \`${r.field}\` | ${r.class ?? ""} | ${r.observed} | ${r.stated ?? ""} | `
      + `${r.enforced ?? ""} | ${r.pctOfStated ?? ""} | ${r.over ? "**OVER**" : ""} |`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The summary footer names the runner that actually produced the run. It used to
 * say "Fake-runner output" for every run, live ones included (found on the
 * 2026-09-23T17:07Z live run). The disclaimer after it holds for both runners.
 */
export function summaryFooter(runner) {
  const label = runner === "live" ? "Live" : runner === "fake" ? "Fake" : String(runner);
  return `_${label}-runner output. Not reviewed. Not publishable. Authorizes nothing._`;
}

/**
 * The human review surface. `packaging` is stage 5's output with the
 * deterministic contact line attached to every package; each platform's contact
 * line and Google Business Profile's call to action are rendered beside its
 * caption, labelled as code-attached rather than model-written. The critic
 * panel is rendered as the panel's computed verdict and counts, then one
 * section per lens: that lens's verdict, its own summary, and its findings.
 */
export function markdownSummary({ goal, runner, timestamp, script, direction, packaging, critic }) {
  const lines = [];
  lines.push(`# Content Intelligence local run`, "");
  lines.push(`- Goal: ${goal}`);
  lines.push(`- Runner: ${runner}`);
  lines.push(`- Generated: ${timestamp}`);
  lines.push("", "## Hook", "", script.provisional.hook, "");
  lines.push("## Script", "", script.provisional.script, "");
  lines.push("## Shot list", "");
  direction.provisional.shots.forEach((shot, i) => {
    lines.push(`${i + 1}. **${shot.purpose}** (${shot.framing}, ${shot.movement}) — ${shot.action}`);
  });
  lines.push("", "## Captions", "");
  packaging.provisional.packages.forEach((pkg) => {
    lines.push(`### ${pkg.platform}`, "", pkg.caption, "");
    if (pkg.hashtags.length) lines.push(pkg.hashtags.join(" "), "");
    const contact = pkg.contact;
    if (contact?.text) {
      lines.push(`Contact line (fixed, attached by code from approved facts): ${contact.text}`, "");
    }
    if (contact?.gbpCta) {
      lines.push(`Call to action (fixed, attached by code from approved facts): `
        + `${contact.gbpCta.actionType} → ${contact.gbpCta.url}`, "");
    }
  });
  lines.push("## Critic panel", "");
  lines.push(`**${critic.provisional.verdict}** — ${critic.provisional.summary}`, "");
  lines.push("_Verdict and counts are computed by code from the four lens answers; no model merged them._", "");
  for (const lens of critic.provisional.lenses) {
    lines.push(`### ${lens.lens} — ${lens.verdict}`, "", lens.summary, "");
    const own = critic.provisional.findings.filter((f) => f.lens === lens.lens);
    if (!own.length) lines.push("No findings from this lens.", "");
    own.forEach((f) => {
      lines.push(`- [${f.severity}/${f.category}/${f.platform}/${f.owner}] ${f.issue} — ${f.suggestedAction}`);
    });
    if (own.length) lines.push("");
  }
  lines.push("---", summaryFooter(runner));
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.goal && !args.replayCritic)) { usage(); process.exit(args.help ? 0 : 1); }
  if (args.runner !== "fake" && args.runner !== "live") {
    throw new Error(`--runner must be "fake" or "live", got: ${args.runner}`);
  }

  requireDist();
  const rt = await loadRuntime();
  if (args.replayCritic) return replayCritic(rt, args);

  const { AgentRegistry, TARGET_STAGE_IDS } = rt.registryModule;
  const { createAnthropicStageRunner } = rt.stageExecution;
  const { PACKAGING_PLATFORMS } = rt.packaging;

  const platforms = args.platforms ?? [...PACKAGING_PLATFORMS];
  for (const p of platforms) {
    if (!PACKAGING_PLATFORMS.includes(p)) throw new Error(`unknown platform: ${p} (known: ${PACKAGING_PLATFORMS.join(", ")})`);
  }

  const now = Date.now();
  const { pack, fingerprints } = await buildRunEvidence(rt, {
    goal: args.goal, now, reviewedAt: args.reviewedAt,
    automotiveFactsPath: args.automotiveFactsPath, runner: args.runner,
  });
  console.log(`Evidence pack built: ${JSON.stringify(pack.counts)}`);

  const registry = new AgentRegistry();
  await registry.verifyAllAssets();

  // Every stage's required evidence classes are declared statically in the
  // registry and the pack is fully built here, so the whole six-stage
  // requirement is knowable before the first request. `stageExecution.ts`
  // checks this per stage as each one runs, which means a class only stage 2
  // needs is discovered after stage 1 has already been paid for. Check all six
  // up front instead: same rule, same source of truth, nothing billed.
  const availableKinds = new Set(pack.allowedFacts.map((r) => r.kind));
  const unmet = [];
  for (const stage of TARGET_STAGE_IDS) {
    const missing = registry.get(stage).requiredEvidenceKinds
      .filter((kind) => !availableKinds.has(kind));
    if (missing.length) unmet.push(`${stage} requires ${missing.join(", ")}`);
  }
  if (unmet.length) {
    throw new Error(
      "evidence pack cannot satisfy every stage, so the run would fail partway "
      + `after paying for the stages before it:\n  - ${unmet.join("\n  - ")}`,
    );
  }

  // The deterministic contact line needs the approved-facts shop-name, phone
  // and booking records; without them the critic would refuse after five paid
  // stages. All three are in the pack already built, so check now, for free.
  rt.contact.assertContactFactsAvailable(pack, platforms);

  if (args.runner === "live") {
    printCostCeiling(rt, allStagePolicies(rt), "one full six-stage run");
    await requireLiveConsent(args);
  }

  const runner = args.runner === "live"
    ? createAnthropicStageRunner()
    : undefined; // per-stage fake runners are built below, once real ids are known

  const timestamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  const runDir = resolve(args.outDir, timestamp);
  await mkdir(runDir, { recursive: true });
  const writeStage = (name, payload) => writeFile(resolve(runDir, `${name}.json`), JSON.stringify(payload, null, 2), "utf8");

  // What a later critic-only replay needs to prove it rebuilt this run's
  // evidence: the exact instant, the review time attributed to the business
  // facts, and a fingerprint of both facts files and of the pack projection.
  await writeFile(resolve(runDir, "run-meta.json"), JSON.stringify({
    schema: "gcd-content-run-meta/1",
    goal: args.goal,
    runner: args.runner,
    platforms,
    now,
    nowIso: new Date(now).toISOString(),
    reviewedAt: args.reviewedAt,
    ...fingerprints,
  }, null, 2), "utf8");

  const { transcript, writeMeasurements } = createRunRecorder(rt, runDir);
  failureContext = { runDir, transcript, writeMeasurements };

  const fake = buildFakeStageResponses(args.goal, pack);
  const runnerFor = (stage, buildResponse) => recordingRunner(transcript, stage, args.runner === "live"
    ? runner
    : async (request) => ({
      text: JSON.stringify(buildResponse(request)), totalCostUsd: 0, usage: { input_tokens: 0, output_tokens: 0 },
    }));

  console.log("Running stage 1/6: strategy-concept");
  const strategy = await rt.strategy.executeStrategyConcept({
    goal: args.goal, evidencePack: pack, registry,
    runner: runnerFor("strategy-concept", () => fake.strategyConcept()),
  });
  await writeStage("01-strategy-concept", strategy);

  console.log("Running stage 2/6: automotive-truth");
  const truth = await rt.truth.executeAutomotiveTruth({
    strategyOutput: strategy.output, evidencePack: pack, registry,
    runner: runnerFor("automotive-truth", () => fake.automotiveTruth()),
  });
  await writeStage("02-automotive-truth", truth);

  console.log("Running stage 3/6: hook-story-script");
  const script = await rt.script.executeHookStoryScript({
    strategyOutput: strategy.output, truthOutput: truth.output, evidencePack: pack, registry,
    runner: runnerFor("hook-story-script", () => fake.hookStoryScript(truth.output)),
  });
  await writeStage("03-hook-story-script", script);

  console.log("Running stage 4/6: production-direction");
  const direction = await rt.direction.executeProductionDirection({
    scriptOutput: script.output, truthOutput: truth.output, evidencePack: pack, registry,
    runner: runnerFor("production-direction", () => fake.productionDirection(script.output)),
  });
  await writeStage("04-production-direction", direction);

  console.log("Running stage 5/6: packaging-adaptation");
  const packaging = await rt.packaging.executePackagingAdaptation({
    scriptOutput: script.output, directionOutput: direction.output, truthOutput: truth.output,
    evidencePack: pack, requestedPlatforms: platforms, registry,
    runner: runnerFor("packaging-adaptation", () => fake.packagingAdaptation(script.output, platforms)),
  });
  await writeStage("05-packaging-adaptation", packaging);

  // Deterministic, not a model call: attach each package's fixed contact line
  // from the approved-facts records. Stage 5's saved file stays exactly what
  // stage 5 returned, so a later replay revalidates it and attaches afresh.
  const contacted = rt.contact.attachContactLines(packaging.output, pack);
  await writeContactLines(runDir, contacted);

  console.log(`Running stage 6/6: final-critic — ${rt.payloadContract.CRITIC_LENSES.length} lens requests, concurrently`);
  const critic = await rt.critic.executeFinalCritic({
    scriptOutput: script.output, directionOutput: direction.output, packagingOutput: contacted,
    truthOutput: truth.output, evidencePack: pack, requestedPlatforms: platforms, registry,
    runner: runnerFor("final-critic", (request) => fake.finalCritic(contacted, platforms, request?.lens)),
  });
  await writeStage("06-final-critic", critic);

  const summaryMd = markdownSummary({
    goal: args.goal, runner: args.runner, timestamp: new Date(now).toISOString(),
    script: script.output, direction: direction.output, packaging: contacted, critic: critic.output,
  });
  await writeFile(resolve(runDir, "summary.md"), summaryMd, "utf8");
  const measured = writeMeasurements();

  console.log(`\nDone. Wrote 6 stage JSON files, 05b-contact-lines.json, run-meta.json, summary.md and field-measurements.md to: ${runDir}`);
  console.log(`Measured ${measured.length} field(s); largest share of a stated figure: `
    + `${Math.max(0, ...measured.map((r) => r.pctOfStated ?? 0))}%`);
  console.log(`Critic verdict: ${critic.output.provisional.verdict}`);
}

/**
 * Record each package's deterministic contact line beside the stage files. A
 * record for the operator, never read back: a replay rebuilds the lines from the
 * pack rather than trusting a saved copy.
 */
async function writeContactLines(dir, contacted) {
  await writeFile(resolve(dir, "05b-contact-lines.json"), JSON.stringify({
    schema: "gcd-content-contact-lines/1",
    note: "Attached by code from approved-facts records after stage 5 validated. Not model-written.",
    packages: contacted.provisional.packages.map((pkg) => ({ platform: pkg.platform, contact: pkg.contact })),
  }, null, 2), "utf8");
}

/** Read one saved stage file from a run directory, or fail naming it. */
async function readSavedStage(runDir, name) {
  const path = resolve(runDir, `${name}.json`);
  if (!existsSync(path)) throw new Error(`replay source is missing ${name}.json in ${runDir}`);
  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || !("output" in parsed)) {
    throw new Error(`${name}.json in ${runDir} has no "output" — not a saved stage result`);
  }
  return parsed;
}

/**
 * Run ONLY final-critic against an existing run's saved stage outputs.
 *
 * Fail-closed order, and why: every check below is free, so all of them run
 * before the spend guard and before any request exists.
 *
 *  1. The saved stage files load, and the source run is left untouched: output
 *     goes to a new sibling directory that must not already exist.
 *  2. `config/approved-facts.json` is byte-identical to the file the run used,
 *     by the sha256 the run recorded (run-meta.json, or — for runs that predate
 *     it — the per-asset sha256 every stage's metadata carries). Refused on any
 *     mismatch, or if no digest was recorded at all.
 *  3. The automotive facts file matches the run's recorded fingerprint. A run
 *     that predates the fingerprint cannot prove it; that is printed as a
 *     warning and requires typed confirmation.
 *  4. The evidence pack is rebuilt at the run's own instant, and, where the run
 *     recorded one, its projection fingerprint must match.
 *  5. Every saved prior output is revalidated through its owning stage's own
 *     validator against the rebuilt pack.
 *  6. Only then the cost ceiling and the same live guard a full run uses.
 */
async function replayCritic(rt, args) {
  const { AgentRegistry } = rt.registryModule;
  const { createAnthropicStageRunner } = rt.stageExecution;
  const sourceDir = args.replayCritic;
  if (!existsSync(sourceDir)) throw new Error(`replay source run directory not found: ${sourceDir}`);

  const metaPath = resolve(sourceDir, "run-meta.json");
  const meta = existsSync(metaPath) ? JSON.parse(await readFile(metaPath, "utf8")) : undefined;
  const saved = {
    strategy: await readSavedStage(sourceDir, "01-strategy-concept"),
    truth: await readSavedStage(sourceDir, "02-automotive-truth"),
    script: await readSavedStage(sourceDir, "03-hook-story-script"),
    direction: await readSavedStage(sourceDir, "04-production-direction"),
    packaging: await readSavedStage(sourceDir, "05-packaging-adaptation"),
  };

  // --- the run's goal, instant and attributed review time -----------------
  let goal = meta?.goal;
  if (!goal) {
    const summaryPath = resolve(sourceDir, "summary.md");
    if (existsSync(summaryPath)) {
      goal = /^- Goal: (.*)$/m.exec(await readFile(summaryPath, "utf8"))?.[1]?.trim();
    }
  }
  goal = goal || args.goal;
  if (!goal) {
    throw new Error("the source run records no goal (no run-meta.json and no summary.md); pass it as the positional argument");
  }
  if (meta?.goal && args.goal && args.goal !== meta.goal) {
    throw new Error("the goal given on the command line differs from the one the source run recorded");
  }
  const now = typeof meta?.now === "number" ? meta.now : nowFromRunDirName(basename(sourceDir));
  if (now === undefined) {
    throw new Error("cannot establish the source run's instant: no run-meta.json and the directory name is not a run timestamp");
  }
  const reviewedAt = meta?.reviewedAt ?? (args.reviewedAtExplicit ? args.reviewedAt : new Date(now).toISOString());

  // --- 2. approved-facts identity ---------------------------------------
  const recordedApproved = new Set();
  if (meta?.approvedFacts?.sha256) recordedApproved.add(meta.approvedFacts.sha256);
  for (const stage of Object.values(saved)) {
    for (const asset of stage?.metadata?.assets ?? []) {
      if (asset?.path === "config/approved-facts.json" && typeof asset.sha256 === "string") {
        recordedApproved.add(asset.sha256);
      }
    }
  }
  const currentApproved = await fileFingerprint(resolve(REPO_ROOT, "config/approved-facts.json"));
  if (recordedApproved.size === 0) {
    throw new Error("the source run records no sha256 of config/approved-facts.json, so the replay cannot prove it rebuilt the same evidence");
  }
  if (recordedApproved.size > 1) {
    throw new Error(`the source run records conflicting approved-facts digests: ${[...recordedApproved].join(", ")}`);
  }
  const [expectedApproved] = recordedApproved;
  if (currentApproved !== expectedApproved) {
    throw new Error(
      `config/approved-facts.json has changed since the source run: recorded ${expectedApproved}, `
      + `now ${currentApproved}. Refusing: the rebuilt evidence pack would not be the one the run used.`,
    );
  }
  console.log(`approved-facts.json matches the source run: sha256 ${currentApproved}`);

  // --- 3. automotive facts identity -------------------------------------
  const currentAutomotive = await fileFingerprint(args.automotiveFactsPath);
  let automotiveIdentity;
  if (meta?.automotiveFacts && "sha256" in meta.automotiveFacts) {
    if (currentAutomotive !== meta.automotiveFacts.sha256) {
      throw new Error(
        `the automotive facts file ${displayPath(args.automotiveFactsPath)} does not match the source run: `
        + `recorded ${meta.automotiveFacts.sha256 ?? "absent"}, now ${currentAutomotive ?? "absent"}. `
        + "Refusing: the rebuilt evidence pack would not be the one the run used.",
      );
    }
    automotiveIdentity = "matched";
    console.log(`automotive facts match the source run: sha256 ${currentAutomotive ?? "(file absent in both)"}`);
  } else {
    console.warn(
      "WARNING: the source run predates the automotive-facts fingerprint, so the identity of "
      + `${displayPath(args.automotiveFactsPath)} (now sha256 ${currentAutomotive ?? "absent"}) cannot be proven `
      + "to be the file the run used. Revalidation below still requires every saved fact id to bind to it.",
    );
    const typed = await askLine("Type UNPROVEN to continue with an unproven automotive facts file (anything else cancels): ");
    if (typed !== "UNPROVEN") {
      throw new Error(`replay cancelled: the automotive facts file's identity cannot be proven and was not confirmed (received ${JSON.stringify(typed)})`);
    }
    automotiveIdentity = "unproven-confirmed";
  }

  // --- 4. the rebuilt pack ------------------------------------------------
  const { pack, fingerprints } = await buildRunEvidence(rt, {
    goal, now, reviewedAt, automotiveFactsPath: args.automotiveFactsPath, runner: args.runner,
  });
  if (meta?.evidencePackSha256 && meta.evidencePackSha256 !== fingerprints.evidencePackSha256) {
    throw new Error(
      `the rebuilt evidence pack does not match the source run: recorded ${meta.evidencePackSha256}, `
      + `rebuilt ${fingerprints.evidencePackSha256}. Refusing.`,
    );
  }
  console.log(`Evidence pack rebuilt at the source run's instant ${new Date(now).toISOString()}: ${JSON.stringify(pack.counts)}`);

  // --- 5. revalidate every saved prior output ---------------------------
  // Stage 1 is not an input to the critic, but it is a saved prior output, so
  // it is revalidated too — through its own validator, rebuilt from its saved
  // typed form exactly as automotive-truth rebuilds it.
  const s1 = saved.strategy.output;
  rt.strategy.validateStrategyConceptOutput({
    angle: s1?.provisional?.angle,
    concept: s1?.provisional?.concept,
    rationale: s1?.provisional?.rationale,
    hypotheses: s1?.provisional?.hypotheses,
    assumptions: s1?.provisional?.assumptions,
    supportingFactIds: s1?.evidence?.supportingFactIds,
    observationIds: s1?.evidence?.observationIds,
    performanceSignalIds: s1?.evidence?.performanceSignalIds,
  }, pack);
  const truthOutput = rt.truth.revalidateAutomotiveTruthOutput(saved.truth.output, pack);
  const scriptOutput = rt.script.revalidateHookStoryScriptOutput(saved.script.output, truthOutput, pack);
  const directionOutput = rt.direction.revalidateProductionDirectionOutput(
    saved.direction.output, scriptOutput, truthOutput, pack);
  const packagingOutput = rt.packaging.revalidatePackagingAdaptationOutput(
    saved.packaging.output, scriptOutput, truthOutput, pack);
  const platforms = packagingOutput.provisional.packages.map((p) => p.platform);
  if (Array.isArray(meta?.platforms) && meta.platforms.join() !== platforms.join()) {
    throw new Error(`saved stage 5 packages (${platforms.join(",")}) differ from the run's recorded platforms (${meta.platforms.join(",")})`);
  }
  console.log("Every saved prior output revalidated through its owning stage's validator.");

  // The same deterministic step a full run applies, so the critic sees the same
  // package shape either way. Free, and before the spend guard.
  rt.contact.assertContactFactsAvailable(pack, platforms);
  const contacted = rt.contact.attachContactLines(packagingOutput, pack);
  console.log("Contact lines attached from the approved-facts shop-name, phone and booking records.");

  const registry = new AgentRegistry();
  await registry.verifyAllAssets();

  // --- 6. the spend guard --------------------------------------------------
  if (args.runner === "live") {
    printCostCeiling(rt, criticLensPolicies(rt), "one critic-only replay");
    await requireLiveConsent(args);
  }

  const replayedAt = new Date();
  const replayDir = resolve(dirname(sourceDir),
    `${basename(sourceDir)}-critic-replay-${replayedAt.toISOString().replace(/[:.]/g, "-")}`);
  if (existsSync(replayDir)) throw new Error(`refusing to overwrite an existing directory: ${replayDir}`);
  await mkdir(replayDir, { recursive: false });
  await writeFile(resolve(replayDir, "replay-meta.json"), JSON.stringify({
    schema: "gcd-content-critic-replay/1",
    sourceRunDir: displayPath(sourceDir),
    replayedAt: replayedAt.toISOString(),
    runner: args.runner,
    goal,
    sourceNow: now,
    reviewedAt,
    platforms,
    approvedFactsSha256: currentApproved,
    automotiveFacts: { ...fingerprints.automotiveFacts, identity: automotiveIdentity },
    evidencePackSha256: fingerprints.evidencePackSha256,
    evidencePackFingerprintChecked: Boolean(meta?.evidencePackSha256),
  }, null, 2), "utf8");

  await writeContactLines(replayDir, contacted);

  const { transcript, writeMeasurements } = createRunRecorder(rt, replayDir);
  failureContext = { runDir: replayDir, transcript, writeMeasurements };
  const fake = buildFakeStageResponses(goal, pack);
  const runner = recordingRunner(transcript, "final-critic", args.runner === "live"
    ? createAnthropicStageRunner()
    : async (request) => ({
      text: JSON.stringify(fake.finalCritic(contacted, platforms, request?.lens)),
      totalCostUsd: 0, usage: { input_tokens: 0, output_tokens: 0 },
    }));

  console.log(`Running final-critic only — ${rt.payloadContract.CRITIC_LENSES.length} lens requests, concurrently — `
    + "against the saved stage 2-5 outputs and fresh contact lines");
  const critic = await rt.critic.executeFinalCritic({
    scriptOutput, directionOutput, packagingOutput: contacted, truthOutput, evidencePack: pack,
    requestedPlatforms: platforms, registry, runner,
  });
  await writeFile(resolve(replayDir, "06-final-critic.json"), JSON.stringify(critic, null, 2), "utf8");
  writeMeasurements();
  console.log(`\nDone. Wrote 06-final-critic.json, 05b-contact-lines.json, replay-meta.json and field-measurements.md to: ${replayDir}`);
  console.log(`The source run at ${sourceDir} was not modified.`);
  console.log(`Critic verdict: ${critic.output.provisional.verdict}`);
}

/**
 * Whatever went wrong, anything the provider already returned was billed. Write
 * it out before reporting the failure so the operator keeps what they bought and
 * can see exactly what the model produced.
 */
function reportFailure(err) {
  if (failureContext?.transcript?.length) {
    try {
      const over = failureContext.writeMeasurements().filter((r) => r.over);
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
  if (err?.name === "EvidencePackBoundsError" || err?.name === "EvidencePackSemanticError") {
    console.error(`${err.name}: ${err.message}`);
    if (Array.isArray(err.violations)) for (const v of err.violations) console.error(`  - ${v}`);
  } else if (err?.name === "EvidenceValidationError") {
    console.error(`${err.name}: ${err.message}`);
    if (Array.isArray(err.issues)) for (const i of err.issues) console.error(`  - ${i}`);
  } else if (err?.name === "StageExecutionError" || err?.name === "CriticPanelError") {
    console.error(`${err.name}: ${err.message}`);
  } else if (["StageOutputTruncatedError", "StageRefusalError", "StageUnexpectedStopError", "ContactLineError"]
    .includes(err?.name)) {
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
