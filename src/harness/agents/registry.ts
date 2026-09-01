/**
 * AgentRegistry — the Phase 0B foundation.
 *
 * This PR registers the six target Content Intelligence reasoning stages and
 * resolves their assets. It deliberately does NOT execute them: adding six live
 * model calls is a separate slice, and wiring execution before the evidence
 * contract exists is how a reasoning pipeline ends up inventing facts.
 *
 * The roughly 22 originally researched specialist roles stay conceptual
 * capabilities. Most belong as deterministic services, references, or policy
 * modules — not as mandatory model calls.
 *
 * Asset loading is deliberately narrow. A registry that resolves paths from
 * declarations is one string away from arbitrary filesystem reads, so paths are
 * repository-relative, are rejected if they escape an allowlisted root, and a
 * missing mandatory asset fails loudly. Silently continuing without a required
 * skill would mean shipping a stage that quietly lost its instructions.
 */

import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { EvidenceKind } from "../evidence/contract.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Repository root, derived from this module's location. */
export const REPOSITORY_ROOT = resolve(__dirname, "../../..");

/** The only directories a registered stage may load assets from. */
export const ALLOWED_ASSET_ROOTS = ["agents", "skills", "prompts", "config"] as const;

export type AgentStageId =
  | "strategy-concept"
  | "automotive-truth"
  | "hook-story-script"
  | "production-direction"
  | "packaging-adaptation"
  | "final-critic";

/**
 * Model class, not a model id. Pinning concrete model ids in the registry would
 * scatter them across the codebase; the execution slice resolves a class to an
 * id in one place.
 */
export type ModelPolicy = "reasoning-heavy" | "reasoning-standard" | "critic" | "deterministic-only";

export interface StageValidator {
  /** Human-readable contract name, surfaced by the preview. */
  name: string;
  validate(value: unknown): { ok: boolean; issues: string[] };
}

export interface AgentStageDefinition {
  id: AgentStageId;
  /** Execution order within the target pipeline. */
  order: number;
  purpose: string;
  modelPolicy: ModelPolicy;
  /** Repository-relative prompt bodies. */
  promptPaths: string[];
  /** Repository-relative skill specifications. */
  skillPaths: string[];
  /** Repository-relative supporting references. */
  referencePaths: string[];
  /** Capability names this stage may use. Enforcement lives in TypeScript. */
  allowedCapabilities: string[];
  /** Evidence classes the stage requires to run meaningfully. */
  requiredEvidenceKinds: EvidenceKind[];
  inputSchema: StageValidator;
  outputSchema: StageValidator;
  /** Optional stages may be skipped by a plan; mandatory ones may not. */
  mandatory: boolean;
  /** Deterministic work that must complete before this stage is eligible. */
  prerequisites: string[];
  /**
   * False for every stage in this PR. Registration is not execution, and the
   * preview asserts this so no one can quietly flip a stage on without a
   * reviewed change.
   */
  executionEnabled: boolean;
}

export class AgentRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRegistryError";
  }
}

/**
 * Resolve a repository-relative asset path, refusing anything that escapes an
 * allowlisted root. Absolute paths, `..` traversal, and roots outside the
 * allowlist are all rejected before the filesystem is touched.
 */
export function resolveAssetPath(relativePath: string): string {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw new AgentRegistryError("asset path must be a non-empty string");
  }
  if (isAbsolute(relativePath)) {
    throw new AgentRegistryError(`asset path must be repository-relative: ${relativePath}`);
  }
  if (relativePath.includes("\0")) {
    throw new AgentRegistryError("asset path contains a null byte");
  }
  const normalized = normalize(relativePath);
  if (normalized.startsWith("..") || normalized.split(/[\\/]/).includes("..")) {
    throw new AgentRegistryError(`asset path may not traverse upward: ${relativePath}`);
  }
  const root = normalized.split(/[\\/]/)[0]!;
  if (!(ALLOWED_ASSET_ROOTS as readonly string[]).includes(root)) {
    throw new AgentRegistryError(
      `asset root "${root}" is not allowlisted (allowed: ${ALLOWED_ASSET_ROOTS.join(", ")})`,
    );
  }
  const absolute = resolve(REPOSITORY_ROOT, normalized);
  // Belt and braces: even after the checks above, the result must still sit
  // inside the repository.
  if (absolute !== REPOSITORY_ROOT && !absolute.startsWith(REPOSITORY_ROOT + sep)) {
    throw new AgentRegistryError(`asset path escapes the repository: ${relativePath}`);
  }
  return absolute;
}

/** Minimal structural validators. The execution slice will deepen these. */
function objectValidator(name: string, requiredKeys: string[]): StageValidator {
  return {
    name,
    validate(value: unknown) {
      const issues: string[] = [];
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, issues: [`${name} must be an object`] };
      }
      for (const key of requiredKeys) {
        if (!(key in (value as Record<string, unknown>))) issues.push(`${name} is missing "${key}"`);
      }
      return { ok: issues.length === 0, issues };
    },
  };
}

/**
 * The six target reasoning stages.
 *
 * Assets point at material that already exists in the repository. Where a stage
 * has no dedicated prompt yet, it registers the skills and references that
 * define its job and leaves `promptPaths` empty rather than pointing at a file
 * that does not exist — an unwritten prompt is honest; a dangling path is not.
 */
const STAGE_DEFINITIONS: AgentStageDefinition[] = [
  {
    id: "strategy-concept",
    order: 1,
    purpose: "Choose the strategic angle and content concept for the goal, given evidence and brand position.",
    modelPolicy: "reasoning-heavy",
    // Phase 0B.1: a dedicated prompt. `agents/analytics.md` was registered as a
    // placeholder, but it defines a performance-readout subagent — different
    // output contract, its own pinned model, and declared tools. Executing this
    // stage against it would have meant running one contract while claiming
    // another. The analytics skill stays: past performance still informs the
    // angle, it just never becomes a fact.
    promptPaths: ["agents/strategy-concept.md"],
    skillPaths: ["skills/brand-voice/SKILL.md", "skills/analytics-readout/SKILL.md"],
    referencePaths: ["config/approved-facts.json"],
    allowedCapabilities: ["read_evidence_pack"],
    requiredEvidenceKinds: ["verified_business_fact"],
    inputSchema: objectValidator("StrategyConceptInput", ["goal", "evidencePack"]),
    outputSchema: objectValidator("StrategyConceptOutput", ["angle", "concept", "rationale"]),
    mandatory: true,
    prerequisites: ["evidence_pack_built"],
    executionEnabled: false,
  },
  {
    id: "automotive-truth",
    order: 2,
    purpose: "Review the complete typed Stage 1 output and structurally constrain claims to classified citable evidence.",
    modelPolicy: "reasoning-heavy",
    // Phase 0B.2: a dedicated prompt, and a deliberately narrow skill.
    //
    // `skills/compliance-checklist/SKILL.md` was registered here and has been
    // removed. It is the final package critic's rubric: provider payloads,
    // hashtag counts, image profiles and pixel limits, WCAG contrast, GBP
    // fields, and a PASS/FAIL verdict against a built package. None of that is
    // this stage's contract, and injecting it as instruction would have told a
    // stage that decides what may be *claimed* to behave like a stage that
    // reviews what was *produced*. It also carries concrete facts — an address,
    // a city, a slogan — which must never enter the instruction channel of the
    // stage whose whole job is to refuse claims that lack evidence. It stays
    // registered on `final-critic`, where it is exactly right.
    //
    // `skills/claim-boundaries/SKILL.md` replaces it with the claim-level
    // subset that does belong here, written to contain no facts of its own.
    promptPaths: ["agents/automotive-truth.md"],
    skillPaths: ["skills/claim-boundaries/SKILL.md"],
    referencePaths: ["config/approved-facts.json"],
    allowedCapabilities: ["read_evidence_pack"],
    // The stage whose entire job is truth must be given the fact classes.
    requiredEvidenceKinds: ["verified_automotive_fact", "verified_business_fact"],
    inputSchema: objectValidator("AutomotiveTruthInput", ["strategyOutput", "evidencePack"]),
    outputSchema: objectValidator("AutomotiveTruthOutput", ["allowedClaims", "forbiddenClaims"]),
    mandatory: true,
    prerequisites: ["evidence_pack_built", "strategy-concept"],
    executionEnabled: false,
  },
  {
    id: "hook-story-script",
    order: 3,
    purpose: "Write the channel-neutral hook, ordered story beats, and script using only the claims automotive-truth permitted.",
    modelPolicy: "reasoning-standard",
    // Phase 0B.3: a dedicated tool-free prompt, and a craft-only skill.
    //
    // `agents/copywriter.md` was registered here and has been removed. It is a
    // different contract: it pins its own model in frontmatter, declares
    // `tools: Read, Skill`, reads a runtime brief this stage never receives, and
    // returns per-platform × per-language post bodies with CTAs and character
    // counts — platform adaptation and translation, both of which belong to
    // later stages. Executing this stage against it would have meant running one
    // contract while claiming another. It stays in the repository for the
    // current orchestrator flow, which still uses it.
    //
    // `skills/brand-voice/SKILL.md` was registered here and has been removed
    // too. It is a genuine style authority, but it also carries concrete facts —
    // a founding year, a locality, a street address, a registered slogan, makes
    // and models, and booking CTAs. Injecting it as instruction would let stage 3
    // reacquire, from a style file, a fact stage 2 declined to permit. It stays
    // registered on `strategy-concept` and remains the authority for the
    // orchestrator's current copywriter path.
    //
    // `skills/script-craft/SKILL.md` replaces it with the craft-only subset that
    // belongs here, written to contain no facts of its own.
    promptPaths: ["agents/hook-story-script.md"],
    skillPaths: ["skills/script-craft/SKILL.md"],
    referencePaths: [],
    allowedCapabilities: ["read_evidence_pack"],
    // Inherited sanity check only. This stage's real authority gate is the
    // claim whitelist `automotive-truth` produced, not the pack's contents.
    requiredEvidenceKinds: ["verified_business_fact"],
    inputSchema: objectValidator(
      "HookStoryScriptInput",
      ["strategyOutput", "truthOutput", "evidencePack"],
    ),
    outputSchema: objectValidator("HookStoryScriptOutput", ["hook", "script"]),
    mandatory: true,
    prerequisites: ["automotive-truth"],
    executionEnabled: false,
  },
  {
    id: "production-direction",
    order: 4,
    purpose: "Direct the channel-neutral visual plan — approach, ordered shots, framing, movement, continuity, overlay wording, and production requirements — using only the claims hook-story-script actually used.",
    modelPolicy: "reasoning-standard",
    // Phase 0B.4: a dedicated tool-free prompt, and a craft-only skill.
    //
    // `agents/image.md` was registered here and has been removed. It is a
    // different contract: it pins its own model in frontmatter, declares
    // `tools: Read, Skill`, expects a runtime brief and a `platforms` list,
    // states that copy generation "runs concurrently and is not an input to this
    // call" — so it never consumes Stage 3 — routes between image providers by
    // content type, picks one of four runtime feed profiles, requests bilingual
    // alt text, and writes CTAs and a URL into the frame. It also describes
    // runtime generation, fetch, QC, and hosting. Executing this stage against it
    // would have meant running one contract while claiming another. It stays in
    // the repository for the existing image-generation flow, which still uses it.
    //
    // `skills/image-brief/SKILL.md` was registered here and has been removed
    // too. It mixes genuine production craft with concrete brand assets, exact
    // hex colors, the registered slogan, per-platform feed profiles, provider
    // and model routing, generation, hosting, QC, accessibility, and
    // publication-era checklist rules. Injecting it as instruction would let a
    // stage that only directs reacquire factual and platform authority the
    // pipeline deliberately withheld. Both files are preserved byte-for-byte:
    // `agents/image.md` loads the skill by name, `skills/compliance-checklist`,
    // `skills/model-routing`, `skills/brand-voice` and `skills/platform-specs`
    // all cross-reference it, and `prompts/MASTER_PROMPT.md` names the image
    // subagent. Removing them from this registry entry removes nothing from the
    // existing image-generation flow.
    //
    // `skills/production-craft/SKILL.md` replaces it with the craft-only subset
    // that belongs here, written to contain no facts of its own.
    promptPaths: ["agents/production-direction.md"],
    skillPaths: ["skills/production-craft/SKILL.md"],
    // No factual reference asset. This stage's factual surface is the set of
    // claims hook-story-script actually used; a reference here would be a second,
    // wider source competing with it.
    referencePaths: [],
    allowedCapabilities: ["read_evidence_pack"],
    // No pack-level requirement. This stage's authority gate is the Stage 3
    // used-claim set, enforced by the executor, not a class present in the pack.
    requiredEvidenceKinds: [],
    inputSchema: objectValidator(
      "ProductionDirectionInput",
      ["scriptOutput", "truthOutput", "evidencePack"],
    ),
    outputSchema: objectValidator(
      "ProductionDirectionOutput",
      ["visualApproach", "shots", "claimVisuals"],
    ),
    mandatory: true,
    prerequisites: ["hook-story-script"],
    executionEnabled: false,
  },
  {
    id: "packaging-adaptation",
    order: 5,
    purpose: "Adapt the written script into proposed per-platform captions, hashtags, local-keyword suggestions, and review-only timing, using only the claims hook-story-script actually used.",
    modelPolicy: "reasoning-standard",
    // Phase 0B.5: one dedicated tool-free prompt, and a craft-only skill.
    //
    // Four assets were registered here and have all been removed. Verified from
    // the merged files:
    //
    //  - `agents/platform-formatter.md` pins a concrete model id in its own
    //    frontmatter, declares `tools: Read, Skill`, consumes a runtime brief and an "assembled
    //    candidate (copy, image ref, hashtags, alt text)", reads
    //    `brief.approvedFacts`, emits per-platform CTAs with URLs, and describes
    //    what deterministic application code does when it builds provider
    //    payloads.
    //  - `agents/hashtag-seo-timing.md` pins a different concrete model id, declares
    //    `tools: Read, Skill`, consumes a runtime brief plus an analytics readout,
    //    and names concrete locations. It is a *separate* subagent call from the
    //    formatter, so registering both would have implied two model contracts
    //    where this stage has exactly one.
    //  - `skills/platform-specs/SKILL.md` mixes genuinely useful format guidance
    //    with media profiles, provider payload construction, the `ACTIVE_PLATFORMS`
    //    environment state, runtime publication behaviour, CTA behaviour, alt-text
    //    handling, scheduling behaviour, and current production implementation
    //    detail.
    //  - `skills/local-seo/SKILL.md` states concrete business, location, make and
    //    service claims - a street address, a list of cities, positioning
    //    slogans, and makes that the classified evidence may not establish.
    //    Injecting it would let this stage reacquire factual authority from a
    //    keyword file, which is exactly what the pipeline withholds.
    //
    // All four are preserved byte-for-byte for the orchestrator flow and the
    // subagents that still load them by name.
    promptPaths: ["agents/packaging-adaptation.md"],
    skillPaths: ["skills/adaptation-craft/SKILL.md"],
    // No factual reference asset. This stage's factual surface is the set of
    // claims hook-story-script actually used; a reference here would be a second,
    // wider source competing with it.
    referencePaths: [],
    allowedCapabilities: ["read_evidence_pack"],
    // No pack-level requirement. This stage's authority gate is the Stage 3
    // used-claim set, enforced by the executor and subordinate to nothing here.
    requiredEvidenceKinds: [],
    inputSchema: objectValidator(
      "PackagingAdaptationInput",
      ["scriptOutput", "directionOutput", "truthOutput", "evidencePack", "requestedPlatforms"],
    ),
    outputSchema: objectValidator("PackagingAdaptationOutput", ["packages", "claimUse"]),
    mandatory: true,
    prerequisites: ["production-direction"],
    executionEnabled: false,
  },
  {
    id: "final-critic",
    order: 6,
    purpose: "Adversarially review the finished, per-platform-adapted package against what hook-story-script actually used and packaging-adaptation actually bound, and return a non-authoritative verdict, summary, and findings — never an approval, and never a replacement for the existing brand-compliance-critic publishing gate.",
    modelPolicy: "critic",
    // Phase 0B.6: a dedicated tool-free prompt, and a craft-only skill.
    //
    // `agents/brand-compliance-critic.md` was registered here and has been
    // removed. It pins a concrete model, declares `tools: Read, Skill`, reads
    // `brief.approvedFacts` (a runtime-injected fact set this stage never
    // receives), evaluates the exact provider payloads GCD's live posting path
    // builds (account/location ids, API hosts and versions, image digests, alt
    // text as transmitted), and returns a routing field naming one of the
    // *legacy* subagents (`copywriter`/`image`/`hashtag-seo-timing`/
    // `platform-formatter`) as the owner of a fix. None of that exists in this
    // pipeline: there is no provider payload, no brief, no approved-facts
    // injection, and no legacy subagent to route a fix to. It stays in the
    // repository for the existing orchestrator flow, which still uses it.
    //
    // `skills/compliance-checklist/SKILL.md` was registered here and has been
    // removed too. It is that critic's rubric, and it states concrete facts of
    // its own — an address, a city, a warranty term, a slogan, image pixel and
    // file-size ceilings, WCAG contrast numbers, and GBP field policy.
    // Injecting it here would hand a stage whose only job is to critique what
    // hook-story-script and packaging-adaptation actually claimed a second,
    // wider, unclassified source of "fact" to reach for.
    //
    // `config/approved-facts.json` was registered here and has been removed as
    // well. It is GCD's canonical business-fact reference, already the
    // evidence system's source for `verified_business_fact` records; a second,
    // raw copy handed straight to this stage's model would compete with the
    // classified, pack-bound projection that is supposed to be the sole
    // factual input.
    //
    // All three are preserved byte-for-byte: the orchestrator's existing
    // critic call site, and the checklist the critic loads, are unchanged.
    //
    // `skills/critique-discipline/SKILL.md` replaces the checklist with the
    // craft-only subset that belongs here, written to state no fact and name
    // no legacy subagent.
    promptPaths: ["agents/final-critic.md"],
    skillPaths: ["skills/critique-discipline/SKILL.md"],
    // No factual reference asset, for the same reason stage 4 and stage 5
    // declare none: this stage's factual surface is hook-story-script's used
    // claims, narrowed per platform by packaging-adaptation's own bindings. A
    // reference here would be a second, wider source competing with it.
    referencePaths: [],
    allowedCapabilities: ["read_evidence_pack"],
    // No pack-level requirement. This stage's authority gate is the stage 3
    // used-claim set, enforced by the executor, not a class present in the pack.
    requiredEvidenceKinds: [],
    inputSchema: objectValidator(
      "FinalCriticInput",
      ["scriptOutput", "directionOutput", "packagingOutput", "truthOutput", "evidencePack", "requestedPlatforms"],
    ),
    outputSchema: objectValidator("FinalCriticOutput", ["provisional", "claimFindingUse"]),
    mandatory: true,
    prerequisites: ["packaging-adaptation"],
    executionEnabled: false,
  },
];

export interface ResolvedStageAsset {
  path: string;
  role: "prompt" | "skill" | "reference";
  bytes: number;
  sha256: string;
}

export interface StagePlanEntry {
  id: AgentStageId;
  order: number;
  purpose: string;
  modelPolicy: ModelPolicy;
  mandatory: boolean;
  executionEnabled: boolean;
  prerequisites: string[];
  requiredEvidenceKinds: EvidenceKind[];
  allowedCapabilities: string[];
  inputSchema: string;
  outputSchema: string;
  assets: { prompts: string[]; skills: string[]; references: string[] };
  /** Evidence classes the pack could not supply. Reported, never fatal here. */
  missingEvidenceKinds: EvidenceKind[];
}

export class AgentRegistry {
  private readonly stages = new Map<AgentStageId, AgentStageDefinition>();

  constructor(definitions: AgentStageDefinition[] = STAGE_DEFINITIONS) {
    for (const definition of definitions) this.register(definition);
  }

  /** Duplicate ids are a configuration error, not a last-one-wins merge. */
  register(definition: AgentStageDefinition): void {
    if (this.stages.has(definition.id)) {
      throw new AgentRegistryError(`duplicate stage id: ${definition.id}`);
    }
    for (const path of [...definition.promptPaths, ...definition.skillPaths, ...definition.referencePaths]) {
      // Validate eagerly: a traversal attempt should fail at registration, not
      // at the first request that happens to load that asset.
      resolveAssetPath(path);
    }
    this.stages.set(definition.id, definition);
  }

  has(id: AgentStageId): boolean {
    return this.stages.has(id);
  }

  get(id: AgentStageId): AgentStageDefinition {
    const definition = this.stages.get(id);
    if (!definition) throw new AgentRegistryError(`unknown stage: ${id}`);
    return definition;
  }

  /** Always ordered by pipeline order then id, never by insertion. */
  list(): AgentStageDefinition[] {
    return [...this.stages.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  ids(): AgentStageId[] {
    return this.list().map((s) => s.id);
  }

  /**
   * Read and hash every declared asset.
   *
   * A missing mandatory asset throws. That is the point: a stage silently
   * running without its skill file is worse than a stage that refuses to start.
   */
  async loadStageAssets(id: AgentStageId): Promise<ResolvedStageAsset[]> {
    const { createHash } = await import("node:crypto");
    const definition = this.get(id);
    const wanted: Array<{ path: string; role: ResolvedStageAsset["role"] }> = [
      ...definition.promptPaths.map((path) => ({ path, role: "prompt" as const })),
      ...definition.skillPaths.map((path) => ({ path, role: "skill" as const })),
      ...definition.referencePaths.map((path) => ({ path, role: "reference" as const })),
    ];
    const assets: ResolvedStageAsset[] = [];
    for (const { path, role } of wanted) {
      const absolute = resolveAssetPath(path);
      let contents: Buffer;
      try {
        contents = await readFile(absolute);
      } catch (err) {
        throw new AgentRegistryError(
          `stage ${id} is missing a mandatory ${role} asset: ${path} (${(err as Error).message})`,
        );
      }
      assets.push({
        path,
        role,
        bytes: contents.byteLength,
        sha256: createHash("sha256").update(contents).digest("hex"),
      });
    }
    return assets;
  }

  /**
   * Load stage assets **with their contents**, through the same allowlisted
   * path mechanism as `loadStageAssets`.
   *
   * The execution boundary needs the actual instruction text, and it must not
   * acquire it by reading the filesystem itself — routing it through here keeps
   * one traversal-checked door into repository content rather than two.
   */
  async loadStageAssetContents(
    id: AgentStageId,
  ): Promise<Array<ResolvedStageAsset & { text: string }>> {
    const assets = await this.loadStageAssets(id);
    const withText: Array<ResolvedStageAsset & { text: string }> = [];
    for (const asset of assets) {
      // Re-resolve rather than trusting the returned path string: the checks are
      // cheap and this keeps the guarantee local to the read.
      const text = await readFile(resolveAssetPath(asset.path), "utf8");
      withText.push({ ...asset, text });
    }
    return withText;
  }

  /** Verify every stage's assets resolve. Used by the preview and self-tests. */
  async verifyAllAssets(): Promise<void> {
    for (const stage of this.list()) await this.loadStageAssets(stage.id);
  }

  /**
   * The plan a later execution slice would follow.
   *
   * `availableEvidenceKinds` lets the plan report which stages could not be
   * meaningfully run yet. It reports rather than throws, because an empty
   * evidence store is a normal early state, not a fault.
   */
  buildStagePlan(availableEvidenceKinds: ReadonlySet<EvidenceKind>): StagePlanEntry[] {
    return this.list().map((stage) => ({
      id: stage.id,
      order: stage.order,
      purpose: stage.purpose,
      modelPolicy: stage.modelPolicy,
      mandatory: stage.mandatory,
      executionEnabled: stage.executionEnabled,
      prerequisites: [...stage.prerequisites],
      requiredEvidenceKinds: [...stage.requiredEvidenceKinds],
      allowedCapabilities: [...stage.allowedCapabilities],
      inputSchema: stage.inputSchema.name,
      outputSchema: stage.outputSchema.name,
      assets: {
        prompts: [...stage.promptPaths],
        skills: [...stage.skillPaths],
        references: [...stage.referencePaths],
      },
      missingEvidenceKinds: stage.requiredEvidenceKinds.filter((k) => !availableEvidenceKinds.has(k)),
    }));
  }
}

/** The six target stages, for tests and callers that want the raw definitions. */
export function targetStageDefinitions(): AgentStageDefinition[] {
  return STAGE_DEFINITIONS.map((s) => ({ ...s }));
}

export const TARGET_STAGE_IDS: AgentStageId[] = [
  "strategy-concept",
  "automotive-truth",
  "hook-story-script",
  "production-direction",
  "packaging-adaptation",
  "final-critic",
];
