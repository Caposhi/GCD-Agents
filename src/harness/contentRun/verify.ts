/**
 * Proving a saved run before anything is bought against it. Moved from
 * `scripts/local/content-run.mjs` (Content Studio S1); the operator's UNPROVEN
 * confirmation is now injected, so a caller that cannot ask — the Studio
 * worker — refuses instead (docs/CONTENT_STUDIO_DESIGN.md §5.2).
 */

import {
  EvidenceScopeError, alwaysIncludedIds, buildRunEvidence, factFingerprint, normalizeScopeTags,
} from "./evidence.js";
import type { ContentRunRuntime } from "./runtime.js";
import type { RunIo, RunOptions, RunSource } from "./types.js";

const utf8 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("utf8");

/**
 * The run timestamp a run directory's name encodes. `main` names each run
 * `new Date(now).toISOString()` with ":" and "." replaced by "-", so the
 * original instant is recoverable exactly for runs that predate run-meta.json.
 */
export function nowFromRunDirName(name: string): number | undefined {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(name);
  if (!m) return undefined;
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return Number.isFinite(ms) ? ms : undefined;
}

/** Read one saved stage file from a source run, or fail naming it. */
export async function readSavedStage(source: RunSource, name: string, purpose = "replay"): Promise<any> {
  const bytes = await source.readArtifact(`${name}.json`);
  if (bytes === undefined) throw new Error(`${purpose} source is missing ${name}.json in ${source.label}`);
  const parsed = JSON.parse(utf8(bytes));
  if (!parsed || typeof parsed !== "object" || !("output" in parsed)) {
    throw new Error(`${name}.json in ${source.label} has no "output" — not a saved stage result`);
  }
  return parsed;
}

/** The saved stage 1–4 files a resumed run reuses, in stage order. */
export const REUSED_STAGE_FILES = [
  "01-strategy-concept", "02-automotive-truth", "03-hook-story-script", "04-production-direction",
];

/**
 * Prove a saved run's evidence and outputs before anything is bought against
 * them. Shared by the critic-only replay, the resumed run and the revision round,
 * so they cannot drift apart.
 *
 * Fail-closed order, and why: every check below is free, so all of them run
 * before the spend guard and before any request exists.
 *
 *  1. The saved stage files load — stages 1–5 for a replay, stages 1–4 for a
 *     resume from packaging-adaptation — and the source run is left untouched:
 *     output goes to a new sibling directory that must not already exist. The
 *     evidence scope is the one the source run recorded — none, for a run that
 *     recorded none — and a `--scope-tags` that differs from it is refused.
 *  2. `config/approved-facts.json` is byte-identical to the file the run used,
 *     by the sha256 the run recorded (run-meta.json, or — for runs that predate
 *     it — the per-asset sha256 every stage's metadata carries). Refused on any
 *     mismatch, or if no digest was recorded at all.
 *  3. The automotive facts file matches the run's recorded fingerprint. For a
 *     replay, a run that predates the fingerprint cannot prove it; that is
 *     printed as a warning and requires the injected UNPROVEN confirmation
 *     (the CLI's typed word; the Studio worker's always refuses).
 *  4. The evidence pack is rebuilt at the run's own instant, and, where the run
 *     recorded one, its projection fingerprint must match.
 *  5. Every saved prior output is revalidated through its owning stage's own
 *     validator against the rebuilt pack.
 *
 * A resume makes **new** paid requests on top of the saved outputs, so it takes
 * no unproven path: it refuses unless run-meta.json records all three
 * fingerprints — approved facts, automotive facts, evidence pack — and each
 * matches. The caller then runs the cost ceiling and the same live guard a full
 * run uses.
 *
 * A revision (`{ revise: true }`) makes new paid requests too, so it takes the
 * same no-unproven-path rule; it reads stages 1–5 and `06-final-critic.json`,
 * and adds a sixth free check: the saved critic panel output is revalidated
 * (`revalidateFinalCriticOutput`) against the packages the critic saw.
 */
export async function verifySourceRun(
  rt: ContentRunRuntime,
  args: RunOptions,
  source: RunSource,
  resumeAt: string | null,
  io: Pick<RunIo, "reporter" | "confirmUnproven">,
  { revise = false }: { revise?: boolean } = {},
) {
  const purpose = revise ? "revision" : resumeAt ? "resume" : "replay";
  if (!(await source.exists())) throw new Error(`${purpose} source run directory not found: ${source.label}`);

  const metaBytes = await source.readArtifact("run-meta.json");
  const meta: any = metaBytes !== undefined ? JSON.parse(utf8(metaBytes)) : undefined;
  if (resumeAt || revise) {
    const unrecorded = meta
      ? [
        meta.approvedFacts?.sha256 ? null : "approvedFacts.sha256",
        meta.automotiveFacts && "sha256" in meta.automotiveFacts ? null : "automotiveFacts.sha256",
        meta.evidencePackSha256 ? null : "evidencePackSha256",
        typeof meta.now === "number" ? null : "now",
      ].filter(Boolean)
      : ["run-meta.json"];
    if (unrecorded.length) {
      const why = revise ? "a revision makes new paid requests on the "
        : "a resumed run makes new paid requests on the ";
      throw new Error(
        `the ${purpose} source records no ${unrecorded.join(", ")}; ${why}`
        + "saved outputs, so it must prove it rebuilt the same evidence. Refusing.",
      );
    }
  }
  const saved: Record<string, any> = {
    strategy: await readSavedStage(source, REUSED_STAGE_FILES[0]!, purpose),
    truth: await readSavedStage(source, REUSED_STAGE_FILES[1]!, purpose),
    script: await readSavedStage(source, REUSED_STAGE_FILES[2]!, purpose),
    direction: await readSavedStage(source, REUSED_STAGE_FILES[3]!, purpose),
    // A resume from packaging-adaptation reads no stage 5 file: the source run
    // usually has none, because stage 5 is what failed.
    ...(resumeAt ? {} : { packaging: await readSavedStage(source, "05-packaging-adaptation", purpose) }),
    // A revision reads round 1's findings from the saved panel output.
    ...(revise ? { critic: await readSavedStage(source, "06-final-critic", purpose) } : {}),
  };

  // --- 1a. the evidence scope: the source run's, and only the source run's --
  // A run that recorded no scope was unscoped (every run before scoping
  // existed was). The recorded scope is reused, never re-derived from the
  // command line, and a --scope-tags that differs from it is refused.
  const recordedScope = meta?.evidenceScope ?? null;
  const currentAlways = alwaysIncludedIds(rt);
  if (recordedScope !== null) {
    const wellFormed = recordedScope && typeof recordedScope === "object"
      && recordedScope.schema === "gcd-evidence-scope/1"
      && Array.isArray(recordedScope.tags) && recordedScope.tags.length > 0
      && recordedScope.tags.every((t: unknown) => typeof t === "string")
      && JSON.stringify(normalizeScopeTags(recordedScope.tags.join(","))) === JSON.stringify(recordedScope.tags)
      && Array.isArray(recordedScope.alwaysIncludedIds);
    if (!wellFormed) {
      throw new EvidenceScopeError("the source run's recorded evidenceScope is malformed; refusing to guess its scope");
    }
    if (JSON.stringify(recordedScope.alwaysIncludedIds) !== JSON.stringify(currentAlways)) {
      throw new EvidenceScopeError(
        `the source run always included ${recordedScope.alwaysIncludedIds.join(", ")}, but this CLI always `
        + `includes ${currentAlways.join(", ")}; refusing: the rebuilt pack would not be the one the run used`,
      );
    }
  }
  const recordedTags = recordedScope ? recordedScope.tags : null;
  if (args.scopeTags && JSON.stringify(args.scopeTags) !== JSON.stringify(recordedTags)) {
    throw new EvidenceScopeError(
      `--scope-tags ${args.scopeTags.join(",")} differs from the source run's recorded scope `
      + `(${recordedTags ? recordedTags.join(",") : "none — the run was unscoped"}); a ${purpose} reuses the `
      + "source run's scope, so omit --scope-tags or pass exactly the recorded tags",
    );
  }

  // --- the run's goal, instant and attributed review time -----------------
  let goal: string | undefined = meta?.goal;
  if (!goal) {
    const summary = await source.readArtifact("summary.md");
    if (summary !== undefined) {
      goal = /^- Goal: (.*)$/m.exec(utf8(summary))?.[1]?.trim();
    }
  }
  goal = goal || args.goal;
  if (!goal) {
    throw new Error("the source run records no goal (no run-meta.json and no summary.md); pass it as the positional argument");
  }
  if (meta?.goal && args.goal && args.goal !== meta.goal) {
    throw new Error("the goal given on the command line differs from the one the source run recorded");
  }
  const now = typeof meta?.now === "number" ? meta.now : nowFromRunDirName(source.name);
  if (now === undefined) {
    throw new Error("cannot establish the source run's instant: no run-meta.json and the directory name is not a run timestamp");
  }
  const reviewedAt = meta?.reviewedAt ?? (args.reviewedAtExplicit ? args.reviewedAt : new Date(now).toISOString());

  // --- 2. approved-facts identity ---------------------------------------
  const recordedApproved = new Set<string>();
  if (meta?.approvedFacts?.sha256) recordedApproved.add(meta.approvedFacts.sha256);
  for (const stage of Object.values(saved)) {
    for (const asset of stage?.metadata?.assets ?? []) {
      if (asset?.path === "config/approved-facts.json" && typeof asset.sha256 === "string") {
        recordedApproved.add(asset.sha256);
      }
    }
  }
  const currentApproved = await factFingerprint(args.facts.approvedFacts);
  if (recordedApproved.size === 0) {
    throw new Error(`the source run records no sha256 of config/approved-facts.json, so the ${purpose} cannot prove it rebuilt the same evidence`);
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
  io.reporter.log(`approved-facts.json matches the source run: sha256 ${currentApproved}`);

  // --- 3. automotive facts identity -------------------------------------
  const currentAutomotive = await factFingerprint(args.facts.automotiveFacts);
  let automotiveIdentity: "matched" | "unproven-confirmed";
  if (meta?.automotiveFacts && "sha256" in meta.automotiveFacts) {
    if (currentAutomotive !== meta.automotiveFacts.sha256) {
      throw new Error(
        `the automotive facts file ${args.facts.automotiveFacts.displayPath} does not match the source run: `
        + `recorded ${meta.automotiveFacts.sha256 ?? "absent"}, now ${currentAutomotive ?? "absent"}. `
        + "Refusing: the rebuilt evidence pack would not be the one the run used.",
      );
    }
    automotiveIdentity = "matched";
    io.reporter.log(`automotive facts match the source run: sha256 ${currentAutomotive ?? "(file absent in both)"}`);
  } else {
    io.reporter.warn(
      "WARNING: the source run predates the automotive-facts fingerprint, so the identity of "
      + `${args.facts.automotiveFacts.displayPath} (now sha256 ${currentAutomotive ?? "absent"}) cannot be proven `
      + "to be the file the run used. Revalidation below still requires every saved fact id to bind to it.",
    );
    const decision = await io.confirmUnproven({
      automotiveFactsDisplayPath: args.facts.automotiveFacts.displayPath, currentSha256: currentAutomotive,
    });
    if (!decision.confirmed) {
      throw new Error(`replay cancelled: the automotive facts file's identity cannot be proven and was not confirmed (${decision.reason})`);
    }
    automotiveIdentity = "unproven-confirmed";
  }

  // --- 4. the rebuilt pack ------------------------------------------------
  const { pack, scope, fingerprints } = await buildRunEvidence(rt, {
    goal, now, reviewedAt, facts: args.facts, runner: args.runner,
    scopeTags: recordedTags ?? undefined,
  }, io.reporter);
  if (JSON.stringify(scope) !== JSON.stringify(recordedScope)) {
    throw new EvidenceScopeError("the rebuilt evidence scope does not match the source run's recorded scope. Refusing.");
  }
  if (meta?.evidencePackSha256 && meta.evidencePackSha256 !== fingerprints.evidencePackSha256) {
    throw new Error(
      `the rebuilt evidence pack does not match the source run: recorded ${meta.evidencePackSha256}, `
      + `rebuilt ${fingerprints.evidencePackSha256}. Refusing.`,
    );
  }
  io.reporter.log(`Evidence pack rebuilt at the source run's instant ${new Date(now).toISOString()}: ${JSON.stringify(pack.counts)}`);

  // --- 5. revalidate every saved prior output ---------------------------
  // Stage 1 is not an input to the critic or to stage 5, but it is a saved
  // prior output, so it is revalidated too — through its own validator,
  // rebuilt from its saved typed form exactly as automotive-truth rebuilds it.
  const s1 = saved.strategy.output;
  const strategyOutput = rt.strategy.validateStrategyConceptOutput({
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
  const packagingOutput: any = saved.packaging
    ? rt.packaging.revalidatePackagingAdaptationOutput(saved.packaging.output, scriptOutput, truthOutput, pack)
    : undefined;
  io.reporter.log("Every saved prior output revalidated through its owning stage's validator.");

  // --- 6. a revision: the saved critic panel output --------------------------
  // Round 1's findings decide what a revision sends to a model, so the panel
  // output is revalidated too: split back into its four lens answers, each
  // through the lens validator against the packages the critic saw (stage 5
  // with its contact lines rebuilt from the pack), re-aggregated, and required
  // to equal the saved output exactly.
  let platforms: any;
  let criticOutput: any;
  if (revise) {
    if (!Array.isArray(meta.platforms)) throw new Error("the revision source's run-meta.json records no platforms");
    platforms = rt.packaging.validateRequestedPlatforms(meta.platforms);
    if (args.platforms && args.platforms.join() !== platforms.join()) {
      throw new Error(`--platforms ${args.platforms.join(",")} differs from the source run's recorded platforms `
        + `(${platforms.join(",")}); a revision reuses the source run's platforms`);
    }
    const contacted = rt.contact.attachContactLines(packagingOutput, pack);
    criticOutput = rt.critic.revalidateFinalCriticOutput(
      saved.critic.output, platforms, contacted, scriptOutput, truthOutput, pack);
    io.reporter.log("The saved critic panel output revalidated: every lens answer, and its aggregation.");
  }

  return {
    meta, goal, now, reviewedAt, pack, scope, fingerprints, automotiveIdentity, currentApproved,
    strategyOutput, truthOutput, scriptOutput, directionOutput, packagingOutput, platforms, criticOutput,
  };
}
