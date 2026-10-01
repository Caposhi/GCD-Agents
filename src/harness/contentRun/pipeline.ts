/**
 * The six-stage run and the three saved-run paths — a critic-only replay, a
 * resume at packaging-adaptation, and one revision round. Moved from
 * `scripts/local/content-run.mjs` (Content Studio S1) with every free check,
 * every refusal and every byte written unchanged.
 *
 * What changed is only who is asked. Output goes through the caller's
 * `RunOutputs` and `RunSink`, progress through its `RunReporter`, and a live
 * run's spend through its `PaidActionConsent` — called after every free check
 * and after pricing, before any runner exists and before any output is
 * created, exactly where the CLI's `requireLiveConsent` stood. A fake run
 * makes no request and asks no consent.
 *
 * Every paid path also requires the review-only execution context
 * (`io.execution`, Content Studio S3), checked next to the consent and before
 * it. When a context is supplied, its per-request check runs immediately
 * before every request unit, fake or live (`executionContext.ts`).
 */

import { buildRunEvidence } from "./evidence.js";
import { gateRequestUnits, requireReviewOnlyExecutionContext } from "./executionContext.js";
import { buildFakeStageResponses, fakeStageRunner } from "./fakes.js";
import { allStagePolicies, computeCostCeiling, criticLensPolicies, resumePolicies, revisionPolicies } from "./pricing.js";
import { createRunRecorder, recordingRunner } from "./recording.js";
import type { ContentRunRuntime } from "./runtime.js";
import { markdownSummary } from "./summary.js";
import type { CostCeiling, PaidActionKind, RunIo, RunnerKind, RunOptions, RunSink, RunSource } from "./types.js";
import { REUSED_STAGE_FILES, verifySourceRun } from "./verify.js";

type Runner = (...callArgs: any[]) => Promise<any>;

/**
 * Each stage runner behind the review-only context's per-unit check, when a
 * context is supplied, and unchanged when none is (only a fake run may have
 * none). Built after consent and before any output exists, so a supplied
 * object that is not a context refuses before anything is written.
 */
function unitGate(io: RunIo, action: PaidActionKind, runner: RunnerKind, price: () => CostCeiling) {
  if (io.execution === undefined) return (_stage: string, inner: Runner): Runner => inner;
  return gateRequestUnits(requireReviewOnlyExecutionContext(io.execution, action), { action, runner, ceiling: price() });
}

/** Copy one saved artifact byte for byte from a source run into a new one. */
async function copyArtifact(source: RunSource, sink: RunSink, name: string, as: string = name): Promise<void> {
  const bytes = await source.readArtifact(name);
  if (bytes === undefined) throw new Error(`cannot copy ${name}: the source run ${source.label} holds no such file`);
  await sink.writeArtifact(as, bytes);
}

/**
 * One full run: the evidence pack, every free preflight, the paid-action gate
 * for a live runner, then stages 1-5, the contact lines and the critic panel.
 */
export async function runFullPipeline(rt: ContentRunRuntime, args: RunOptions, io: RunIo) {
  const { AgentRegistry, TARGET_STAGE_IDS } = rt.registryModule;
  const { createAnthropicStageRunner } = rt.stageExecution;
  const { PACKAGING_PLATFORMS } = rt.packaging;

  const platforms: any[] = args.platforms ?? [...PACKAGING_PLATFORMS];
  for (const p of platforms) {
    if (!(PACKAGING_PLATFORMS as readonly string[]).includes(p)) throw new Error(`unknown platform: ${p} (known: ${PACKAGING_PLATFORMS.join(", ")})`);
  }
  const goal = args.goal as string;

  const now = Date.now();
  const { pack, scope, fingerprints } = await buildRunEvidence(rt, {
    goal, now, reviewedAt: args.reviewedAt,
    facts: args.facts, runner: args.runner, scopeTags: args.scopeTags,
  }, io.reporter);
  if (scope) {
    io.reporter.log(`Evidence scope: tags ${scope.tags.join(",")}; always included: ${scope.alwaysIncludedIds.join(", ")}`);
  }
  io.reporter.log(`Evidence pack built: ${JSON.stringify(pack.counts)}`);

  const registry = new AgentRegistry();
  await registry.verifyAllAssets();

  // Every stage's required evidence classes are declared statically in the
  // registry and the pack is fully built here, so the whole six-stage
  // requirement is knowable before the first request. `stageExecution.ts`
  // checks this per stage as each one runs, which means a class only stage 2
  // needs is discovered after stage 1 has already been paid for. Check all six
  // up front instead: same rule, same source of truth, nothing billed.
  const availableKinds = new Set(pack.allowedFacts.map((r: any) => r.kind));
  const unmet: string[] = [];
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
  // Stage 5 binds the identity records on every platform; without them it and
  // the critic would refuse after four paid stages. Check now, for free.
  rt.identity.assertIdentityFactsAvailable(pack);

  // --- the paid-action gate: after every free check, and after pricing -------
  if (args.runner === "live") {
    requireReviewOnlyExecutionContext(io.execution, "full-run");
    const ceiling = computeCostCeiling(rt, allStagePolicies(rt));
    await io.consent({
      kind: "full-run", label: "one full six-stage run", ceiling,
      ...(args.reviseOnce
        ? { revisionRoundMaxRequests: revisionPolicies(rt, rt.revision.REVISABLE_STAGES[0]!).length } : {}),
    });
  }

  const runner = args.runner === "live"
    ? createAnthropicStageRunner()
    : undefined; // per-stage fake runners are built below, once real ids are known
  const gated = unitGate(io, "full-run", args.runner, () => computeCostCeiling(rt, allStagePolicies(rt)));

  const sink = await io.outputs.openFullRun({ now });
  const writeStage = (name: string, payload: unknown) => sink.writeArtifact(`${name}.json`, JSON.stringify(payload, null, 2));

  // What a later critic-only replay needs to prove it rebuilt this run's
  // evidence: the exact instant, the review time attributed to the business
  // facts, and a fingerprint of both facts files and of the pack projection.
  await sink.writeArtifact("run-meta.json", JSON.stringify({
    schema: "gcd-content-run-meta/1",
    goal,
    runner: args.runner,
    platforms,
    now,
    nowIso: new Date(now).toISOString(),
    reviewedAt: args.reviewedAt,
    // Written only for a scoped run, so an unscoped run's record is byte-for-byte
    // what it was before scoping existed. Absent means no scope.
    ...(scope ? { evidenceScope: scope } : {}),
    ...fingerprints,
  }, null, 2));

  const { transcript, writeMeasurements } = createRunRecorder(rt, sink);
  io.onFailureContext?.({ sink, transcript, writeMeasurements });

  const fake = buildFakeStageResponses(goal, pack);
  const runnerFor = (stage: string, buildResponse: (request: any) => unknown) => recordingRunner(transcript, stage,
    gated(stage, args.runner === "live" ? runner! : fakeStageRunner(buildResponse)), sink);

  io.reporter.log("Running stage 1/6: strategy-concept");
  const strategy = await rt.strategy.executeStrategyConcept({
    goal, evidencePack: pack, registry,
    runner: runnerFor("strategy-concept", () => fake.strategyConcept()),
  });
  await writeStage("01-strategy-concept", strategy);

  io.reporter.log("Running stage 2/6: automotive-truth");
  const truth = await rt.truth.executeAutomotiveTruth({
    strategyOutput: strategy.output, evidencePack: pack, registry,
    runner: runnerFor("automotive-truth", () => fake.automotiveTruth()),
  });
  await writeStage("02-automotive-truth", truth);

  io.reporter.log("Running stage 3/6: hook-story-script");
  const script = await rt.script.executeHookStoryScript({
    strategyOutput: strategy.output, truthOutput: truth.output, evidencePack: pack, registry,
    runner: runnerFor("hook-story-script", () => fake.hookStoryScript(truth.output)),
  });
  await writeStage("03-hook-story-script", script);

  io.reporter.log("Running stage 4/6: production-direction");
  const direction = await rt.direction.executeProductionDirection({
    scriptOutput: script.output, truthOutput: truth.output, evidencePack: pack, registry,
    runner: runnerFor("production-direction", () => fake.productionDirection(script.output)),
  });
  await writeStage("04-production-direction", direction);

  io.reporter.log("Running stage 5/6: packaging-adaptation");
  const packaging = await rt.packaging.executePackagingAdaptation({
    scriptOutput: script.output, directionOutput: direction.output, truthOutput: truth.output,
    evidencePack: pack, requestedPlatforms: platforms as never, registry,
    runner: runnerFor("packaging-adaptation", () => fake.packagingAdaptation(script.output, platforms)),
  });
  await writeStage("05-packaging-adaptation", packaging);

  // Deterministic, not a model call: attach each package's fixed contact line
  // from the approved-facts records. Stage 5's saved file stays exactly what
  // stage 5 returned, so a later replay revalidates it and attaches afresh.
  const contacted = rt.contact.attachContactLines(packaging.output, pack);
  await writeContactLines(sink, contacted);

  io.reporter.log(`Running stage 6/6: final-critic — ${rt.payloadContract.CRITIC_LENSES.length} lens requests, concurrently`);
  const critic = await rt.critic.executeFinalCritic({
    scriptOutput: script.output, directionOutput: direction.output, packagingOutput: contacted,
    truthOutput: truth.output, evidencePack: pack, requestedPlatforms: platforms as never, registry,
    runner: runnerFor("final-critic", (request) => fake.finalCritic(contacted, platforms, request?.lens)),
  });
  await writeStage("06-final-critic", critic);

  const summaryMd = markdownSummary({
    goal, runner: args.runner, timestamp: new Date(now).toISOString(),
    script: script.output, direction: direction.output, packaging: contacted, critic: critic.output,
  });
  await sink.writeArtifact("summary.md", summaryMd);
  const { rows: measured, written } = writeMeasurements();
  await written;

  io.reporter.log(`\nDone. Wrote 6 stage JSON files, 05b-contact-lines.json, run-meta.json, summary.md and field-measurements.md to: ${sink.label}`);
  io.reporter.log(`Measured ${measured.length} field(s); largest share of a stated figure: `
    + `${Math.max(0, ...measured.map((r) => r.pctOfStated ?? 0))}%`);
  io.reporter.log(`Critic verdict: ${critic.output.provisional.verdict}`);
  return { sink, measured, verdict: critic.output.provisional.verdict };
}

/**
 * Record each package's deterministic contact line beside the stage files. A
 * record for the operator, never read back: a replay rebuilds the lines from the
 * pack rather than trusting a saved copy.
 */
async function writeContactLines(sink: RunSink, contacted: any): Promise<void> {
  await sink.writeArtifact("05b-contact-lines.json", JSON.stringify({
    schema: "gcd-content-contact-lines/1",
    note: "Attached by code from approved-facts records after stage 5 validated. Not model-written.",
    packages: contacted.provisional.packages.map((pkg: any) => ({ platform: pkg.platform, contact: pkg.contact })),
  }, null, 2));
}

/**
 * Resume a saved run at packaging-adaptation: run stage 5, attach the contact
 * lines, and run the critic panel against the run's saved stage 1–4 outputs.
 *
 * Why it exists: on 2026-09-26 two owner-run live runs paid for stages 1–4,
 * kept every one of them validated, and then lost stage 5 to a validator
 * refusal (`2026-09-26T14-28-27-677Z`, the `claimUse` cap; `2026-09-26T17-04-00-636Z`,
 * the Instagram caption). Re-running from stage 1 would buy stages 1–4 again
 * for outputs already paid for and already valid.
 *
 * Every free check `verifySourceRun` makes runs first, with no unproven path;
 * then the free preflights a full run makes before stage 5 — the contact-line
 * and identity records, and the evidence classes stages 5 and 6 require; then
 * the cost ceiling for exactly the requests this makes (stage 5 and the four
 * critic lenses) and the same typed LIVE guard. Output goes to a new sibling
 * directory; the source run is never modified. The new directory also holds
 * byte-for-byte copies of the source's run-meta.json and stage 1–4 files, so a
 * later `--replay-critic` can verify it exactly as it verifies a full run.
 *
 * No stage 1–4 executor is called: those stages make no request.
 */
export async function resumeFromPackaging(
  rt: ContentRunRuntime, args: RunOptions, source: RunSource, resumeAt: string, io: RunIo,
) {
  const { AgentRegistry } = rt.registryModule;
  const { createAnthropicStageRunner } = rt.stageExecution;
  const {
    meta, goal, now, reviewedAt, pack, scope, fingerprints, automotiveIdentity, currentApproved,
    truthOutput, scriptOutput, directionOutput,
  } = await verifySourceRun(rt, args, source, resumeAt, io);

  // The run's recorded platforms, never re-derived. Stage 5's own request check
  // refuses an unknown, repeated or excess platform.
  if (!Array.isArray(meta.platforms)) throw new Error("the resume source's run-meta.json records no platforms");
  const platforms = rt.packaging.validateRequestedPlatforms(meta.platforms);
  if (args.platforms && args.platforms.join() !== platforms.join()) {
    throw new Error(`--platforms ${args.platforms.join(",")} differs from the source run's recorded platforms `
      + `(${platforms.join(",")}); a resume reuses the source run's platforms`);
  }

  // The free preflights a full run makes before any spend, for the stages this
  // will run: the contact-line and identity records, and every evidence class
  // stages 5 and 6 require.
  rt.contact.assertContactFactsAvailable(pack, platforms);
  rt.identity.assertIdentityFactsAvailable(pack);
  const registry = new AgentRegistry();
  await registry.verifyAllAssets();
  const requests = resumePolicies(rt, resumeAt);
  const availableKinds = new Set(pack.allowedFacts.map((r: any) => r.kind));
  const unmet = [...new Set(requests.map(([label]) => label.split(":")[0]))].flatMap((stage) => {
    const missing = registry.get(stage as never).requiredEvidenceKinds.filter((kind) => !availableKinds.has(kind));
    return missing.length ? [`${stage} requires ${missing.join(", ")}`] : [];
  });
  if (unmet.length) {
    throw new Error(`evidence pack cannot satisfy the resumed stages:\n  - ${unmet.join("\n  - ")}`);
  }

  // --- the spend guard --------------------------------------------------------
  if (args.runner === "live") {
    requireReviewOnlyExecutionContext(io.execution, "resume");
    const ceiling = computeCostCeiling(rt, requests);
    await io.consent({ kind: "resume", label: `one run resumed at ${resumeAt}`, ceiling });
  }
  const gated = unitGate(io, "resume", args.runner, () => computeCostCeiling(rt, requests));

  const resumedAt = new Date();
  const sink = await io.outputs.openDerivedRun({ kind: "resume", source, at: resumedAt, resumeAt });
  for (const name of ["run-meta.json", ...REUSED_STAGE_FILES.map((n) => `${n}.json`)]) {
    await copyArtifact(source, sink, name);
  }
  const resumeMeta = {
    schema: "gcd-content-resume/1",
    sourceRunDir: source.displayLabel,
    resumedAt: resumedAt.toISOString(),
    resumeFrom: resumeAt,
    reusedStages: REUSED_STAGE_FILES,
    runner: args.runner,
    goal,
    sourceNow: now,
    reviewedAt,
    platforms,
    approvedFactsSha256: currentApproved,
    automotiveFacts: { ...fingerprints.automotiveFacts, identity: automotiveIdentity },
    ...(scope ? { evidenceScope: scope } : {}),
    evidencePackSha256: fingerprints.evidencePackSha256,
    evidencePackFingerprintChecked: true,
  };
  const writeResumeMeta = (extra = {}) => sink.writeArtifact("resume-meta.json",
    JSON.stringify({ ...resumeMeta, ...extra }, null, 2));
  await writeResumeMeta();
  const writeStage = (name: string, payload: unknown) => sink.writeArtifact(`${name}.json`, JSON.stringify(payload, null, 2));

  const { transcript, writeMeasurements } = createRunRecorder(rt, sink);
  io.onFailureContext?.({ sink, transcript, writeMeasurements });
  const fake = buildFakeStageResponses(goal, pack);
  const liveRunner = args.runner === "live" ? createAnthropicStageRunner() : undefined;
  const runnerFor = (stage: string, buildResponse: (request: any) => unknown) => recordingRunner(transcript, stage,
    gated(stage, liveRunner ?? fakeStageRunner(buildResponse)), sink);

  io.reporter.log(`Resuming at ${resumeAt}: stages 1-4 reused from ${source.label}, revalidated, not re-requested`);
  io.reporter.log("Running stage 5/6: packaging-adaptation");
  const packaging = await rt.packaging.executePackagingAdaptation({
    scriptOutput, directionOutput, truthOutput,
    evidencePack: pack, requestedPlatforms: platforms as never, registry,
    runner: runnerFor("packaging-adaptation", () => fake.packagingAdaptation(scriptOutput, platforms)),
  });
  await writeStage("05-packaging-adaptation", packaging);

  const contacted = rt.contact.attachContactLines(packaging.output, pack);
  await writeContactLines(sink, contacted);

  io.reporter.log(`Running stage 6/6: final-critic — ${rt.payloadContract.CRITIC_LENSES.length} lens requests, concurrently`);
  const critic = await rt.critic.executeFinalCritic({
    scriptOutput, directionOutput, packagingOutput: contacted,
    truthOutput, evidencePack: pack, requestedPlatforms: platforms as never, registry,
    runner: runnerFor("final-critic", (request) => fake.finalCritic(contacted, platforms, request?.lens)),
  });
  await writeStage("06-final-critic", critic);

  const summaryMd = markdownSummary({
    goal, runner: args.runner, timestamp: new Date(now).toISOString(),
    script: scriptOutput, direction: directionOutput, packaging: contacted, critic: critic.output,
    resumedFrom: { sourceRunDir: source.displayLabel, stage: resumeAt },
  });
  await sink.writeArtifact("summary.md", summaryMd);
  await writeMeasurements().written;
  // Which requests this run actually made, from the transcript: stage 5 and the
  // critic lenses, and nothing before the resume point.
  await writeResumeMeta({ modelRequests: transcript.map((t) => (t.lens ? `${t.stage}:${t.lens}` : t.stage)) });

  io.reporter.log(`\nDone. Wrote 05-packaging-adaptation.json, 05b-contact-lines.json, 06-final-critic.json, `
    + `summary.md, resume-meta.json and field-measurements.md to: ${sink.label}`);
  io.reporter.log(`The source run at ${source.label} was not modified.`);
  io.reporter.log(`Critic verdict: ${critic.output.provisional.verdict}`);
  return { sink, verdict: critic.output.provisional.verdict };
}

/**
 * Run ONLY final-critic against an existing run's saved stage outputs.
 *
 * Every free check in `verifySourceRun` runs first — the approved-facts and
 * automotive identity, the rebuilt pack's fingerprint, and the revalidation of
 * every saved stage 1–5 output; then the contact-line and identity preflights;
 * only then the cost ceiling and the same live guard a full run uses.
 */
export async function replayCritic(rt: ContentRunRuntime, args: RunOptions, source: RunSource, io: RunIo) {
  const { AgentRegistry } = rt.registryModule;
  const { createAnthropicStageRunner } = rt.stageExecution;
  const {
    meta, goal, now, reviewedAt, pack, scope, fingerprints, automotiveIdentity, currentApproved,
    truthOutput, scriptOutput, directionOutput, packagingOutput,
  } = await verifySourceRun(rt, args, source, null, io);
  const platforms: any[] = packagingOutput.provisional.packages.map((p: any) => p.platform);
  if (Array.isArray(meta?.platforms) && meta.platforms.join() !== platforms.join()) {
    throw new Error(`saved stage 5 packages (${platforms.join(",")}) differ from the run's recorded platforms (${meta.platforms.join(",")})`);
  }

  // The same deterministic step a full run applies, so the critic sees the same
  // package shape either way. Free, and before the spend guard.
  rt.contact.assertContactFactsAvailable(pack, platforms);
  rt.identity.assertIdentityFactsAvailable(pack);
  const contacted = rt.contact.attachContactLines(packagingOutput, pack);
  io.reporter.log("Contact lines attached from the approved-facts shop-name, phone and booking records.");

  const registry = new AgentRegistry();
  await registry.verifyAllAssets();

  // --- 6. the spend guard --------------------------------------------------
  if (args.runner === "live") {
    requireReviewOnlyExecutionContext(io.execution, "critic-replay");
    const ceiling = computeCostCeiling(rt, criticLensPolicies(rt));
    await io.consent({ kind: "critic-replay", label: "one critic-only replay", ceiling });
  }
  const gated = unitGate(io, "critic-replay", args.runner, () => computeCostCeiling(rt, criticLensPolicies(rt)));

  const replayedAt = new Date();
  const sink = await io.outputs.openDerivedRun({ kind: "critic-replay", source, at: replayedAt });
  await sink.writeArtifact("replay-meta.json", JSON.stringify({
    schema: "gcd-content-critic-replay/1",
    sourceRunDir: source.displayLabel,
    replayedAt: replayedAt.toISOString(),
    runner: args.runner,
    goal,
    sourceNow: now,
    reviewedAt,
    platforms,
    approvedFactsSha256: currentApproved,
    automotiveFacts: { ...fingerprints.automotiveFacts, identity: automotiveIdentity },
    ...(scope ? { evidenceScope: scope } : {}),
    evidencePackSha256: fingerprints.evidencePackSha256,
    evidencePackFingerprintChecked: Boolean(meta?.evidencePackSha256),
  }, null, 2));

  await writeContactLines(sink, contacted);

  const { transcript, writeMeasurements } = createRunRecorder(rt, sink);
  io.onFailureContext?.({ sink, transcript, writeMeasurements });
  const fake = buildFakeStageResponses(goal, pack);
  const runner = recordingRunner(transcript, "final-critic", gated("final-critic", args.runner === "live"
    ? createAnthropicStageRunner()
    : fakeStageRunner((request) => fake.finalCritic(contacted, platforms, request?.lens))), sink);

  io.reporter.log(`Running final-critic only — ${rt.payloadContract.CRITIC_LENSES.length} lens requests, concurrently — `
    + "against the saved stage 2-5 outputs and fresh contact lines");
  const critic = await rt.critic.executeFinalCritic({
    scriptOutput, directionOutput, packagingOutput: contacted, truthOutput, evidencePack: pack,
    requestedPlatforms: platforms as never, registry, runner,
  });
  await sink.writeArtifact("06-final-critic.json", JSON.stringify(critic, null, 2));
  await writeMeasurements().written;
  io.reporter.log(`\nDone. Wrote 06-final-critic.json, 05b-contact-lines.json, replay-meta.json and field-measurements.md to: ${sink.label}`);
  io.reporter.log(`The source run at ${source.label} was not modified.`);
  io.reporter.log(`Critic verdict: ${critic.output.provisional.verdict}`);
  return { sink, verdict: critic.output.provisional.verdict };
}

/** Each writing stage's saved file name. */
export const WRITER_STAGE_FILES: Record<string, string> = {
  "hook-story-script": "03-hook-story-script",
  "production-direction": "04-production-direction",
  "packaging-adaptation": "05-packaging-adaptation",
};

/**
 * One revision round on a completed run — `--revise-from <run-dir>`, and the
 * same function `--revise-once` calls on the run it just wrote.
 *
 * Fail-closed order; everything before the cost gate is free:
 *
 *  1. `verifySourceRun` in revision mode: run-meta.json with all three
 *     fingerprints (no unproven path), the recorded scope, every saved stage
 *     1–5 output revalidated through its owning validator, and the saved critic
 *     panel output revalidated lens by lens and re-aggregated.
 *  2. The plan (`planRevision`): owner items set aside, never sent; no
 *     revisable blocking finding → print that, write nothing, make no request;
 *     a stage owning more blocking findings than its derived cap → refused.
 *  3. The free preflights for the stages this re-runs.
 *  4. The cost ceiling for exactly the requests this makes, and the typed LIVE
 *     gate.
 *  5. A new `<source>-revised-<timestamp>` sibling. Reused files are copied
 *     byte for byte; round 1's panel output is kept as
 *     round-1-06-final-critic.json; the source run is never modified.
 *  6. The start stage and every later writing stage re-run, in order, each with
 *     its ordinary inputs (revised upstream outputs where those changed),
 *     `PREVIOUS_OUTPUT` and only its own findings. Every validator applies
 *     unchanged; a rejected response is saved as today and the run stops.
 *  7. Contact lines re-attached from the pack; all four critic lenses run fresh
 *     — the executor has no input for round-1 findings or verdicts.
 *
 * Exactly one round: nothing here plans from the round-2 panel.
 */
export type ReviseRunResult =
  | { revised: false; plan: ReturnType<ContentRunRuntime["revision"]["planRevision"]> }
  | { revised: true; dir: string; sink: RunSink; plan: ReturnType<ContentRunRuntime["revision"]["planRevision"]> };

export async function reviseRun(
  rt: ContentRunRuntime, args: RunOptions, source: RunSource, origin: string, io: RunIo,
): Promise<ReviseRunResult> {
  // Whatever an earlier round recorded is not this round's to write: a failure
  // before this round's directory exists must not add a file to round 1's.
  io.onFailureContext?.(null);
  const { AgentRegistry } = rt.registryModule;
  const { createAnthropicStageRunner } = rt.stageExecution;
  const {
    goal, now, reviewedAt, pack, scope, fingerprints, automotiveIdentity, currentApproved,
    strategyOutput, truthOutput, scriptOutput, directionOutput, packagingOutput, platforms, criticOutput,
  } = await verifySourceRun(rt, args, source, null, io, { revise: true });

  // --- 2. the plan ------------------------------------------------------------
  const plan = rt.revision.planRevision(criticOutput);
  if (plan.ownerItems.length) {
    io.reporter.log(`Owner items — never sent to any model: ${plan.ownerItems
      .map((f) => `${f.id} (${f.owner}, ${f.category}, ${f.severity})`).join(", ")}`);
  }
  if (plan.kind === "no_revision") {
    io.reporter.log("No blocking finding has a revisable owner (hook-story-script, production-direction or "
      + "packaging-adaptation): no revision request was made, and nothing was written.");
    return { revised: false, plan };
  }
  for (const stage of plan.stages) {
    io.reporter.log(`Revision plan: ${stage.stage} — sends ${stage.sent.length} of ${stage.owned} owned finding(s) `
      + `(${stage.blocking} blocking; cap ${stage.cap})${stage.dropped.length
        ? `; drops ${stage.dropped.map((f) => f.id).join(", ")} (advisory, over the cap)` : ""}`);
  }

  // --- 3. the free preflights for what this re-runs ---------------------------
  rt.contact.assertContactFactsAvailable(pack, platforms);
  rt.identity.assertIdentityFactsAvailable(pack);
  const registry = new AgentRegistry();
  await registry.verifyAllAssets();
  const requests = revisionPolicies(rt, plan.startStage);
  const availableKinds = new Set(pack.allowedFacts.map((r: any) => r.kind));
  const unmet = [...new Set(requests.map(([label]) => label.split(":")[0]))].flatMap((stage) => {
    const missing = registry.get(stage as never).requiredEvidenceKinds.filter((kind) => !availableKinds.has(kind));
    return missing.length ? [`${stage} requires ${missing.join(", ")}`] : [];
  });
  if (unmet.length) throw new Error(`evidence pack cannot satisfy the revised stages:\n  - ${unmet.join("\n  - ")}`);

  // --- 4. the spend guard -----------------------------------------------------
  if (args.runner === "live") {
    requireReviewOnlyExecutionContext(io.execution, "revision");
    const ceiling = computeCostCeiling(rt, requests);
    await io.consent({ kind: "revision", label: `one revision round from ${plan.startStage}`, ceiling });
  }
  const gated = unitGate(io, "revision", args.runner, () => computeCostCeiling(rt, requests));

  // --- 5. the new directory ---------------------------------------------------
  const revisedAt = new Date();
  const sink = await io.outputs.openDerivedRun({ kind: "revision", source, at: revisedAt });
  const rerun: string[] = plan.stages.map((s) => s.stage);
  const reusedFiles = ["run-meta.json", "01-strategy-concept.json", "02-automotive-truth.json",
    ...rt.revision.REVISABLE_STAGES.filter((stage) => !rerun.includes(stage)).map((stage) => `${WRITER_STAGE_FILES[stage]}.json`)];
  for (const name of reusedFiles) await copyArtifact(source, sink, name);
  await copyArtifact(source, sink, "06-final-critic.json", "round-1-06-final-critic.json");

  const findingRef = ({ id, lens, severity }: { id: string; lens: string; severity: string }) => ({ id, lens, severity });
  const revisionMeta = {
    schema: "gcd-content-revision/1",
    origin,
    sourceRunDir: source.displayLabel,
    revisedAt: revisedAt.toISOString(),
    runner: args.runner,
    goal,
    sourceNow: now,
    reviewedAt,
    platforms,
    approvedFactsSha256: currentApproved,
    automotiveFacts: { ...fingerprints.automotiveFacts, identity: automotiveIdentity },
    ...(scope ? { evidenceScope: scope } : {}),
    evidencePackSha256: fingerprints.evidencePackSha256,
    evidencePackFingerprintChecked: true,
    rounds: 1,
    startStage: plan.startStage,
    rerunStages: rerun,
    reusedFiles,
    findingCaps: { ...rt.revision.REVISION_FINDING_CAPS },
    findingsSent: Object.fromEntries(plan.stages.map((stage) => [stage.stage, stage.sent.map((f) => f.id)])),
    findingsDropped: plan.stages.flatMap((stage) => stage.dropped.map((f) => ({ ...findingRef(f), stage: stage.stage }))),
    findingsNotRerun: plan.notRerun.map((f) => ({ ...findingRef(f), owner: f.owner })),
    ownerItems: plan.ownerItems.map((f) => ({ ...findingRef(f), owner: f.owner, category: f.category })),
    round1: { verdict: criticOutput.provisional.verdict, summary: criticOutput.provisional.summary },
  };
  const { transcript, writeMeasurements } = createRunRecorder(rt, sink);
  const writeRevisionMeta = (extra: Record<string, unknown>) => sink.writeArtifact("revision-meta.json", JSON.stringify({
    ...revisionMeta,
    ...extra,
    modelRequests: transcript.map((t) => (t.lens ? `${t.stage}:${t.lens}` : t.stage)),
    costs: {
      requests: transcript.map((t) => ({
        request: t.lens ? `${t.stage}:${t.lens}` : t.stage, totalCostUsd: t.totalCostUsd ?? null, usage: t.usage ?? null,
      })),
      totalUsd: transcript.reduce((total, t) => total + (typeof t.totalCostUsd === "number" ? t.totalCostUsd : 0), 0),
    },
  }, null, 2));
  await writeRevisionMeta({ status: "started" });
  // A rejected revised stage: its raw response is saved here as in any run, the
  // revision stops, and round 1 — the source directory — is left as it was.
  io.onFailureContext?.({
    sink, transcript, writeMeasurements,
    finalize: (err: any) => writeRevisionMeta({ status: "failed", failure: `${err?.name ?? "Error"}: ${err?.message ?? err}` }),
  });
  const writeStage = (name: string, payload: unknown) => sink.writeArtifact(`${name}.json`, JSON.stringify(payload, null, 2));

  const fake = buildFakeStageResponses(goal, pack);
  const liveRunner = args.runner === "live" ? createAnthropicStageRunner() : undefined;
  const runnerFor = (stage: string, buildResponse: (request: any) => unknown) => recordingRunner(transcript, stage,
    gated(stage, liveRunner ?? fakeStageRunner(buildResponse)), sink);
  const sentFor = (stage: string): any => plan.stages.find((s) => s.stage === stage)!.sent;

  // --- 6. the re-run writing stages, in order --------------------------------
  io.reporter.log(`Revising from ${plan.startStage}. Reused from ${source.label}, revalidated, not re-requested: `
    + reusedFiles.filter((name) => name !== "run-meta.json").join(", "));
  let script = scriptOutput;
  if (rerun.includes("hook-story-script")) {
    io.reporter.log(`Revising stage 3/6: hook-story-script — ${sentFor("hook-story-script").length} finding(s)`);
    const result = await rt.script.executeHookStoryScript({
      strategyOutput, truthOutput, evidencePack: pack, registry,
      revision: { previousOutput: scriptOutput, findings: sentFor("hook-story-script") },
      runner: runnerFor("hook-story-script", () => fake.hookStoryScript(truthOutput)),
    });
    await writeStage(WRITER_STAGE_FILES["hook-story-script"]!, result);
    script = result.output;
  }
  let direction = directionOutput;
  if (rerun.includes("production-direction")) {
    io.reporter.log(`Revising stage 4/6: production-direction — ${sentFor("production-direction").length} finding(s)`);
    const result = await rt.direction.executeProductionDirection({
      scriptOutput: script, truthOutput, evidencePack: pack, registry,
      revision: { previousOutput: directionOutput, findings: sentFor("production-direction") },
      runner: runnerFor("production-direction", () => fake.productionDirection(script)),
    });
    await writeStage(WRITER_STAGE_FILES["production-direction"]!, result);
    direction = result.output;
  }
  io.reporter.log(`Revising stage 5/6: packaging-adaptation — ${sentFor("packaging-adaptation").length} finding(s)`);
  const packaging = await rt.packaging.executePackagingAdaptation({
    scriptOutput: script, directionOutput: direction, truthOutput,
    evidencePack: pack, requestedPlatforms: platforms as never, registry,
    revision: { previousOutput: packagingOutput, findings: sentFor("packaging-adaptation") },
    runner: runnerFor("packaging-adaptation", () => fake.packagingAdaptation(script, platforms)),
  });
  await writeStage(WRITER_STAGE_FILES["packaging-adaptation"]!, packaging);

  // --- 7. contact lines, then the critic panel, fresh ------------------------
  const contacted = rt.contact.attachContactLines(packaging.output, pack);
  await writeContactLines(sink, contacted);
  io.reporter.log(`Running stage 6/6: final-critic — ${rt.payloadContract.CRITIC_LENSES.length} lens requests, `
    + "concurrently, fresh: no round-1 finding or verdict is sent");
  const critic = await rt.critic.executeFinalCritic({
    scriptOutput: script, directionOutput: direction, packagingOutput: contacted,
    truthOutput, evidencePack: pack, requestedPlatforms: platforms as never, registry,
    runner: runnerFor("final-critic", (request) => fake.finalCritic(contacted, platforms, request?.lens)),
  });
  await writeStage("06-final-critic", critic);

  const summaryMd = markdownSummary({
    goal, runner: args.runner, timestamp: new Date(now).toISOString(),
    script, direction, packaging: contacted, critic: critic.output,
    revision: {
      sourceRunDir: source.displayLabel, origin, rerunStages: rerun, reusedFiles, plan,
      round1: criticOutput.provisional, round2: critic.output.provisional,
    },
  });
  await sink.writeArtifact("summary.md", summaryMd);
  await writeMeasurements().written;
  await writeRevisionMeta({
    status: "completed",
    round2: { verdict: critic.output.provisional.verdict, summary: critic.output.provisional.summary },
  });
  io.onFailureContext?.(null);

  io.reporter.log(`\nDone. Revised ${rerun.join(", ")} and re-ran the critic panel. Model requests made: `
    + transcript.map((t) => (t.lens ? `${t.stage}:${t.lens}` : t.stage)).join(", "));
  io.reporter.log(`Wrote ${rerun.map((stage) => `${WRITER_STAGE_FILES[stage]}.json`).join(", ")}, 05b-contact-lines.json, `
    + `06-final-critic.json, round-1-06-final-critic.json, revision-meta.json, summary.md and field-measurements.md to: ${sink.label}`);
  io.reporter.log(`The source run at ${source.label} was not modified.`);
  io.reporter.log(`Critic verdict: round 1 ${criticOutput.provisional.verdict} → round 2 ${critic.output.provisional.verdict}`);
  return { revised: true, dir: sink.label, sink, plan };
}
