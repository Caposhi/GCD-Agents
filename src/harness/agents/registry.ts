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
    purpose: "Establish and constrain the automotive claims the content may make, citing only citable evidence.",
    modelPolicy: "reasoning-heavy",
    promptPaths: [],
    skillPaths: ["skills/compliance-checklist/SKILL.md"],
    referencePaths: ["config/approved-facts.json"],
    allowedCapabilities: ["read_evidence_pack"],
    // The stage whose entire job is truth must be given the fact classes.
    requiredEvidenceKinds: ["verified_automotive_fact", "verified_business_fact"],
    inputSchema: objectValidator("AutomotiveTruthInput", ["concept", "evidencePack"]),
    outputSchema: objectValidator("AutomotiveTruthOutput", ["allowedClaims", "forbiddenClaims"]),
    mandatory: true,
    prerequisites: ["evidence_pack_built", "strategy-concept"],
    executionEnabled: false,
  },
  {
    id: "hook-story-script",
    order: 3,
    purpose: "Write the hook, story beats, and script within the established truth constraints.",
    modelPolicy: "reasoning-standard",
    promptPaths: ["agents/copywriter.md"],
    skillPaths: ["skills/brand-voice/SKILL.md"],
    referencePaths: [],
    allowedCapabilities: ["read_evidence_pack"],
    requiredEvidenceKinds: ["verified_business_fact"],
    inputSchema: objectValidator("HookStoryScriptInput", ["concept", "allowedClaims"]),
    outputSchema: objectValidator("HookStoryScriptOutput", ["hook", "script"]),
    mandatory: true,
    prerequisites: ["automotive-truth"],
    executionEnabled: false,
  },
  {
    id: "production-direction",
    order: 4,
    purpose: "Direct what is filmed or generated: shots, framing, on-image text, and production notes.",
    modelPolicy: "reasoning-standard",
    promptPaths: ["agents/image.md"],
    skillPaths: ["skills/image-brief/SKILL.md"],
    referencePaths: [],
    allowedCapabilities: ["read_evidence_pack"],
    requiredEvidenceKinds: [],
    inputSchema: objectValidator("ProductionDirectionInput", ["script"]),
    outputSchema: objectValidator("ProductionDirectionOutput", ["shots", "imageSpecification"]),
    mandatory: true,
    prerequisites: ["hook-story-script"],
    executionEnabled: false,
  },
  {
    id: "packaging-adaptation",
    order: 5,
    purpose: "Adapt the package per platform: caption, hashtags, timing, and platform constraints.",
    modelPolicy: "reasoning-standard",
    promptPaths: ["agents/platform-formatter.md", "agents/hashtag-seo-timing.md"],
    skillPaths: ["skills/platform-specs/SKILL.md", "skills/local-seo/SKILL.md"],
    referencePaths: [],
    allowedCapabilities: ["read_evidence_pack"],
    requiredEvidenceKinds: [],
    inputSchema: objectValidator("PackagingAdaptationInput", ["script", "platforms"]),
    outputSchema: objectValidator("PackagingAdaptationOutput", ["perPlatform"]),
    mandatory: true,
    prerequisites: ["production-direction"],
    executionEnabled: false,
  },
  {
    id: "final-critic",
    order: 6,
    purpose: "Adversarially check the finished package against brand, compliance, and evidence constraints.",
    modelPolicy: "critic",
    promptPaths: ["agents/brand-compliance-critic.md"],
    skillPaths: ["skills/compliance-checklist/SKILL.md"],
    referencePaths: ["config/approved-facts.json"],
    allowedCapabilities: ["read_evidence_pack"],
    requiredEvidenceKinds: ["verified_business_fact"],
    inputSchema: objectValidator("FinalCriticInput", ["package", "evidencePack"]),
    outputSchema: objectValidator("FinalCriticOutput", ["verdict", "findings"]),
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
