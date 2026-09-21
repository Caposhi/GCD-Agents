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
 * with each stage's validated output passed into the next.
 *
 * Requires `npm run build` first (this script imports the compiled `dist/`
 * output, the same way `npm run test:offline` and the other `scripts/*.mjs`
 * tools in this repository do).
 *
 * Usage:
 *   node scripts/local/content-run.mjs "<goal text>" [options]
 *
 * Options:
 *   --runner fake|live         Default "fake": canned responses, no network,
 *                              no cost. "live" calls the real Anthropic API
 *                              through the production stage boundary and
 *                              REQUIRES --i-understand-this-costs-money.
 *   --i-understand-this-costs-money
 *                              Required to use --runner live.
 *   --automotive-facts <path> Default config/automotive-facts.local.json.
 *   --platforms a,b,c          Default instagram,facebook,google_business_profile.
 *   --out-dir <path>           Default local-output/content-intelligence.
 *   --reviewed-at <iso8601>    Attributed review time for approved-facts.json.
 *                              Default: now (mirrors evidence:sync's own default).
 *   -h, --help
 */

import { existsSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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

Options:
  --runner fake|live               Default "fake". "live" requires --i-understand-this-costs-money.
  --i-understand-this-costs-money  Required to use --runner live.
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
    if (token === "--reviewed-at") { args.reviewedAt = rest.shift(); continue; }
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
    finalCritic(packagingOutput, platforms) {
      const findings = [
        {
          severity: "advisory", category: "claim_fidelity", platform: "cross_platform", owner: "packaging-adaptation",
          issue: "The caption is identical across platforms; Instagram and Facebook audiences may read it as copy-pasted.",
          suggestedAction: "Vary phrasing per platform while keeping the same permitted fact and the same claim boundary.",
        },
        {
          severity: "blocking", category: "human_decision", platform: "cross_platform", owner: "human_review",
          issue: "This is a canned, fake-runner demonstration output, not a reviewed piece of content.",
          suggestedAction: "A human must review the real evidence, the real script, and the real package before anything here is used.",
        },
      ];
      const claimFindingUse = platforms.flatMap((platform) => {
        const bound = packagingOutput.claimUse.used.find((u) => u.platform === platform);
        if (!bound) return [];
        return [{ findingIndex: 0, platform, factId: bound.factId, summary: "The same fact this platform's caption already cites." }];
      });
      return {
        verdict: "needs_human_review",
        summary: "Wiring exercised end-to-end with a fake runner. Every claim traces to supplied evidence, but nothing here has been reviewed by a person and nothing here is publishable.",
        findings,
        claimFindingUse,
      };
    },
  };
}

function markdownSummary({ goal, runner, timestamp, script, direction, packaging, critic }) {
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
  });
  lines.push("## Critic verdict", "");
  lines.push(`**${critic.provisional.verdict}** — ${critic.provisional.summary}`, "");
  critic.provisional.findings.forEach((f) => {
    lines.push(`- [${f.severity}/${f.owner}] ${f.issue} — ${f.suggestedAction}`);
  });
  lines.push("", "---", "_Fake-runner output. Not reviewed. Not publishable. Authorizes nothing._");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.goal) { usage(); process.exit(args.help ? 0 : 1); }
  if (args.runner !== "fake" && args.runner !== "live") {
    throw new Error(`--runner must be "fake" or "live", got: ${args.runner}`);
  }

  requireDist();

  const { adaptApprovedFactsFile } = await import(resolve(DIST_HARNESS, "evidence/approvedFacts.js"));
  const { buildEvidencePack, assertUsableEvidencePack, EvidencePackBoundsError } =
    await import(resolve(DIST_HARNESS, "evidence/pack.js"));
  const { EvidenceValidationError } = await import(resolve(DIST_HARNESS, "evidence/contract.js"));
  const { AgentRegistry, TARGET_STAGE_IDS } = await import(resolve(DIST_HARNESS, "agents/registry.js"));
  const { StageExecutionError, createAnthropicStageRunner } =
    await import(resolve(DIST_HARNESS, "agents/stageExecution.js"));
  const { executeStrategyConcept } = await import(resolve(DIST_HARNESS, "agents/strategyConcept.js"));
  const { executeAutomotiveTruth } = await import(resolve(DIST_HARNESS, "agents/automotiveTruth.js"));
  const { executeHookStoryScript } = await import(resolve(DIST_HARNESS, "agents/hookStoryScript.js"));
  const { executeProductionDirection } = await import(resolve(DIST_HARNESS, "agents/productionDirection.js"));
  const { executePackagingAdaptation, PACKAGING_PLATFORMS } =
    await import(resolve(DIST_HARNESS, "agents/packagingAdaptation.js"));
  const { executeFinalCritic } = await import(resolve(DIST_HARNESS, "agents/finalCritic.js"));
  const { resolveModelPolicy, modelBearingPolicies, POLICY_MAX_TOKENS } =
    await import(resolve(DIST_HARNESS, "agents/modelPolicy.js"));
  const { MAX_PAYLOAD_CHARS } = await import(resolve(DIST_HARNESS, "agents/payloadContract.js"));

  const platforms = args.platforms ?? [...PACKAGING_PLATFORMS];
  for (const p of platforms) {
    if (!PACKAGING_PLATFORMS.includes(p)) throw new Error(`unknown platform: ${p} (known: ${PACKAGING_PLATFORMS.join(", ")})`);
  }

  const now = Date.now();
  const approvedFactsRaw = await readFile(resolve(REPO_ROOT, "config/approved-facts.json"), "utf8");
  const { records: businessRecords } = adaptApprovedFactsFile(approvedFactsRaw, {
    reviewedAt: args.reviewedAt, now,
  });
  const { records: automotiveRecords, warning } = await loadAutomotiveFacts(args.automotiveFactsPath, now);
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

  const pack = assertUsableEvidencePack(buildEvidencePack({
    goal: args.goal,
    records: [...businessRecords, ...automotiveRecords],
    now,
  }));
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

  if (args.runner === "live") {
    // Rough, non-billing-accurate ceiling: worst-case output tokens per stage
    // (the one number this pipeline actually derives and bounds) plus a
    // ~4-chars-per-token estimate of the largest input this pipeline would
    // assemble. Mirrors src/harness/sdk.ts's own "not billing-accurate" price
    // table; kept local here because that table is not exported.
    const PRICE = { "claude-opus-5": { in: 5, out: 25 }, "claude-sonnet-5": { in: 2, out: 10 }, "claude-sonnet-4-6": { in: 3, out: 15 } };
    const STAGE_POLICIES = [
      ["strategy-concept", "reasoning-heavy"], ["automotive-truth", "reasoning-heavy"],
      ["hook-story-script", "reasoning-standard"], ["production-direction", "reasoning-standard"],
      ["packaging-adaptation", "reasoning-standard"], ["final-critic", "critic"],
    ];
    let total = 0;
    console.log("Estimated ceiling cost per stage (rough, not billing-accurate):");
    for (const [stage, policy] of STAGE_POLICIES) {
      const resolved = resolveModelPolicy(policy);
      const price = PRICE[resolved.model];
      const inputTokensEstimate = Math.ceil(MAX_PAYLOAD_CHARS / 4);
      const cost = price ? (inputTokensEstimate * price.in + resolved.maxTokens * price.out) / 1e6 : undefined;
      total += cost ?? 0;
      console.log(`  ${stage.padEnd(22)} ${resolved.model.padEnd(20)} out<=${resolved.maxTokens} tokens  ~$${cost?.toFixed(2) ?? "?"}`);
    }
    console.log(`Estimated ceiling for one full six-stage run: ~$${total.toFixed(2)}`);
    console.log(`(policies checked: ${modelBearingPolicies().join(", ")}; POLICY_MAX_TOKENS=${JSON.stringify(POLICY_MAX_TOKENS)})`);
    if (!args.understandsCost) {
      throw new Error('--runner live requires --i-understand-this-costs-money (this makes real, billed Anthropic API calls)');
    }
    console.log("Proceeding with LIVE model calls — this will incur real cost.");
  }

  const runner = args.runner === "live"
    ? createAnthropicStageRunner()
    : undefined; // per-stage fake runners are built below, once real ids are known

  const timestamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  const runDir = resolve(args.outDir, timestamp);
  await mkdir(runDir, { recursive: true });
  const writeStage = (name, payload) => writeFile(resolve(runDir, `${name}.json`), JSON.stringify(payload, null, 2), "utf8");

  // Validation runs after the provider returns, and one rejection ends the run
  // with no retry — so a response that fails a size ceiling is a response the
  // operator has already paid for. Discarding it outright, as this CLI did
  // until now, throws away both the money and the only evidence of what the
  // model actually produced. Record every raw response as it arrives; on
  // failure the catch handler writes them next to the run. This changes no
  // validation outcome: a rejected payload is still rejected, and nothing
  // recorded here is ever read back as stage output.
  const transcript = [];
  failureContext = { runDir, transcript };

  const fake = buildFakeStageResponses(args.goal, pack);
  const runnerFor = (stage, buildResponse) => {
    const inner = args.runner === "live"
      ? runner
      : async () => ({ text: JSON.stringify(buildResponse()), totalCostUsd: 0, usage: { input_tokens: 0, output_tokens: 0 } });
    return async (...callArgs) => {
      const response = await inner(...callArgs);
      transcript.push({
        stage,
        receivedAt: new Date().toISOString(),
        chars: typeof response?.text === "string" ? response.text.length : null,
        usage: response?.usage ?? null,
        totalCostUsd: response?.totalCostUsd ?? null,
        text: response?.text ?? null,
      });
      return response;
    };
  };

  console.log("Running stage 1/6: strategy-concept");
  const strategy = await executeStrategyConcept({
    goal: args.goal, evidencePack: pack, registry,
    runner: runnerFor("strategy-concept", () => fake.strategyConcept()),
  });
  await writeStage("01-strategy-concept", strategy);

  console.log("Running stage 2/6: automotive-truth");
  const truth = await executeAutomotiveTruth({
    strategyOutput: strategy.output, evidencePack: pack, registry,
    runner: runnerFor("automotive-truth", () => fake.automotiveTruth()),
  });
  await writeStage("02-automotive-truth", truth);

  console.log("Running stage 3/6: hook-story-script");
  const script = await executeHookStoryScript({
    strategyOutput: strategy.output, truthOutput: truth.output, evidencePack: pack, registry,
    runner: runnerFor("hook-story-script", () => fake.hookStoryScript(truth.output)),
  });
  await writeStage("03-hook-story-script", script);

  console.log("Running stage 4/6: production-direction");
  const direction = await executeProductionDirection({
    scriptOutput: script.output, truthOutput: truth.output, evidencePack: pack, registry,
    runner: runnerFor("production-direction", () => fake.productionDirection(script.output)),
  });
  await writeStage("04-production-direction", direction);

  console.log("Running stage 5/6: packaging-adaptation");
  const packaging = await executePackagingAdaptation({
    scriptOutput: script.output, directionOutput: direction.output, truthOutput: truth.output,
    evidencePack: pack, requestedPlatforms: platforms, registry,
    runner: runnerFor("packaging-adaptation", () => fake.packagingAdaptation(script.output, platforms)),
  });
  await writeStage("05-packaging-adaptation", packaging);

  console.log("Running stage 6/6: final-critic");
  const critic = await executeFinalCritic({
    scriptOutput: script.output, directionOutput: direction.output, packagingOutput: packaging.output,
    truthOutput: truth.output, evidencePack: pack, requestedPlatforms: platforms, registry,
    runner: runnerFor("final-critic", () => fake.finalCritic(packaging.output, platforms)),
  });
  await writeStage("06-final-critic", critic);

  const summaryMd = markdownSummary({
    goal: args.goal, runner: args.runner, timestamp: new Date(now).toISOString(),
    script: script.output, direction: direction.output, packaging: packaging.output, critic: critic.output,
  });
  await writeFile(resolve(runDir, "summary.md"), summaryMd, "utf8");

  console.log(`\nDone. Wrote 6 stage JSON files and summary.md to: ${runDir}`);
  console.log(`Critic verdict: ${critic.output.provisional.verdict}`);
}

main().catch((err) => {
  // Whatever went wrong, anything the provider already returned was billed.
  // Write it out before reporting the failure so the operator keeps what they
  // bought and can see exactly what the model produced.
  if (failureContext?.transcript?.length) {
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
  } else if (err?.name === "StageExecutionError") {
    console.error(`${err.name}: ${err.message}`);
  } else {
    console.error(err?.stack ?? String(err));
  }
  process.exit(1);
});
