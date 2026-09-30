/**
 * The three structural protections Content Studio S1 adds around the live
 * `gcd-social-*` services (docs/CONTENT_STUDIO_DESIGN.md §5.4, items 1, 2 and
 * 2a). Each is executed by the offline suite (checks CS1, CS2 and CS3), and
 * each takes its inputs as data, so the suite can also prove it refuses a
 * synthetic violation.
 *
 * 1. `walkImportGraph` — a transitive import-graph walk over the compiled
 *    `dist/` from every live entry point. No path may reach a stage executor,
 *    `stageExecution.js`, `revision.js`, `dist/harness/contentRun/**` or
 *    `dist/studio/**`. It follows every static import, re-export and literal
 *    dynamic import through any number of intermediary modules, and it fails
 *    closed on anything it cannot follow: a non-literal `import()`, a
 *    `require`, an unresolvable or out-of-tree specifier, an undeclared
 *    package, or a string literal naming a forbidden module path.
 * 2. `callerViolations` — the caller allowlist. Only
 *    `scripts/local/content-run.mjs` and `src/studio/worker/**` may import the
 *    content-run library; nothing under `src/studio/web/**` may import it, the
 *    stage-execution boundary or any executor.
 * 2a. `livePathManifestViolations` — the shared-module diff guard. Every module
 *    the live entry points load is pinned by sha256 in
 *    `scripts/ci/live-path-manifest.json`. Editing one, or adding or removing
 *    one from the live set, fails until the manifest is updated in the same
 *    change — which is the declaration: the manifest's diff names every
 *    live-path edit and carries a reason for each (docs/TESTING.md).
 *
 * This module is a checker. Nothing live imports it, and it imports nothing
 * from the pipeline.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Every live entry point, as a compiled module path. Checked against
 * `package.json`'s scripts and `render.yaml`'s commands by
 * `liveEntryPointsFromConfig`, so a new start command cannot be added without
 * being walked.
 */
export const LIVE_ENTRY_POINTS = [
  "dist/api/server.js",
  "dist/worker/index.js",
  "dist/scheduler/daily.js",
  "dist/state/migrate.js",
  "dist/harness/evidence/syncCli.js",
  "dist/harness/dryrun.cli.js",
] as const;

/** Compiled modules no live entry point may reach. */
export const FORBIDDEN_LIVE_MODULES = [
  "dist/harness/agents/strategyConcept.js",
  "dist/harness/agents/automotiveTruth.js",
  "dist/harness/agents/hookStoryScript.js",
  "dist/harness/agents/productionDirection.js",
  "dist/harness/agents/packagingAdaptation.js",
  "dist/harness/agents/finalCritic.js",
  "dist/harness/agents/stageExecution.js",
  "dist/harness/agents/revision.js",
] as const;

/** Compiled trees no live entry point may reach. */
export const FORBIDDEN_LIVE_TREES = ["dist/harness/contentRun/", "dist/studio/"] as const;

/**
 * The other direction (§1.3): nothing the Studio runs — the content-run
 * library now, `dist/studio/**` later — may reach publishing, a provider, the
 * approval path, the Instagram token or the live database module. One module
 * is allowlisted by name: calling the stages loads the pure package validator
 * `posting-tool/validation.js` through `packageMap.js`.
 */
export const STUDIO_FORBIDDEN_TREES = ["dist/mcp/", "dist/api/", "dist/worker/", "dist/scheduler/", "dist/state/"] as const;
export const STUDIO_FORBIDDEN_MODULES = [
  "dist/harness/publicationRunner.js", "dist/harness/hitl.js", "dist/harness/igToken.js", "dist/harness/state.js",
  "dist/harness/googleToken.js",
] as const;
export const STUDIO_ALLOWED_EXCEPTIONS = ["dist/mcp/posting-tool/validation.js"] as const;

/** The Studio side's roots: the library's index, and every compiled Studio module that exists. */
export function studioSideEntryPoints(root: string): string[] {
  const roots = ["dist/harness/contentRun/index.js"];
  const walk = (dir: string) => {
    if (!existsSync(resolve(root, dir))) return;
    for (const name of readdirSync(resolve(root, dir)).sort()) {
      const path = `${dir}/${name}`;
      if (statSync(resolve(root, path)).isDirectory()) walk(path);
      else if (name.endsWith(".js")) roots.push(path);
    }
  };
  walk("dist/studio");
  return roots;
}

/** A string literal naming a forbidden module path, in any live module, fails the walk. */
const FORBIDDEN_PATH_LITERAL = new RegExp(
  "(?:^|[\\\\/])(?:contentRun|studio)[\\\\/]"
  + "|(?:^|[\\\\/])(?:strategyConcept|automotiveTruth|hookStoryScript|productionDirection|packagingAdaptation"
  + "|finalCritic|stageExecution|revision)\\.(?:[cm]?js|ts)$",
);

/** The callers allowed to import the content-run library: one file, and one tree. */
export const CONTENT_RUN_CALLERS = ["scripts/local/content-run.mjs", "src/studio/worker/"] as const;
export const CONTENT_RUN_TREES = ["src/harness/contentRun/", "dist/harness/contentRun/"] as const;
/** The Studio web service: never a path to a model (§5.4 item 2). */
export const STUDIO_WEB_TREE = "src/studio/web/";

export type ModuleReference =
  | { kind: "static" | "dynamic"; specifier: string }
  | { kind: "dynamic-non-literal" | "require"; text: string };

/** Every module reference in one file, and every string literal it holds. */
export function moduleReferences(
  sourceText: string,
  fileName: string,
): { references: ModuleReference[]; stringLiterals: string[] } {
  const kind = /\.[cm]?tsx?$/.test(fileName) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, kind);
  const references: ModuleReference[] = [];
  const stringLiterals: string[] = [];
  // A specifier is analysed as an edge, not again as a loose string.
  const specifierNodes = new Set<ts.Node>();
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      // A type-only import compiles away; everything else is a runtime edge.
      const typeOnly = ts.isImportDeclaration(node)
        ? node.importClause?.isTypeOnly === true
        : node.isTypeOnly;
      if (!typeOnly) references.push({ kind: "static", specifier: node.moduleSpecifier.text });
      specifierNodes.add(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      references.push({ kind: "require", text: node.getText(source) });
    } else if (ts.isCallExpression(node)) {
      const [argument] = node.arguments;
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (argument && ts.isStringLiteralLike(argument)) {
          references.push({ kind: "dynamic", specifier: argument.text });
          specifierNodes.add(argument);
        } else {
          references.push({ kind: "dynamic-non-literal", text: node.getText(source) });
        }
      } else if (ts.isIdentifier(node.expression)
        && (node.expression.text === "require" || node.expression.text === "createRequire")) {
        references.push({ kind: "require", text: node.getText(source) });
      }
    }
    if (ts.isStringLiteralLike(node)) {
      if (!specifierNodes.has(node)) stringLiterals.push(node.text);
    }
    else if (ts.isTemplateExpression(node)) {
      stringLiterals.push(node.head.text, ...node.templateSpans.map((span) => span.literal.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { references, stringLiterals };
}

export interface GraphViolation {
  kind: "forbidden" | "non-literal-dynamic-import" | "require" | "unresolved" | "outside-tree"
    | "undeclared-package" | "forbidden-path-literal";
  /** The module holding the offending reference, repository-relative. */
  file: string;
  detail: string;
  /** Entry point → … → `file`: every intermediary on the path that reached it. */
  chain: string[];
}

const toPosix = (path: string): string => path.split(sep).join("/");
const BUILTINS = new Set(builtinModules);
const packageName = (specifier: string): string => {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
};

/**
 * Walk the compiled import graph from `entryPoints` (repository-relative).
 * Returns every module reached, and every violation with the chain of modules
 * that reached it.
 */
export function walkImportGraph({
  root, entryPoints, forbiddenModules = FORBIDDEN_LIVE_MODULES, forbiddenTrees = FORBIDDEN_LIVE_TREES,
  allowedModules = [], checkPathLiterals = true, allowedPackages, tree = "dist/",
}: {
  root: string;
  entryPoints: readonly string[];
  forbiddenModules?: readonly string[];
  forbiddenTrees?: readonly string[];
  /** Modules exempt from the forbidden trees, by exact path. */
  allowedModules?: readonly string[];
  /** The forbidden-path string rule applies to the live graph, where no such string belongs. */
  checkPathLiterals?: boolean;
  /** Bare package names live code may import: `package.json`'s `dependencies`. */
  allowedPackages: readonly string[];
  /** Every reached module must sit inside this repository-relative tree. */
  tree?: string;
}): { reached: string[]; violations: GraphViolation[] } {
  const parent = new Map<string, string | null>();
  const violations: GraphViolation[] = [];
  const chainOf = (file: string): string[] => {
    const chain: string[] = [];
    for (let at: string | null | undefined = file; at; at = parent.get(at)) chain.unshift(at);
    return chain;
  };
  const isForbidden = (rel: string) => !allowedModules.includes(rel)
    && (forbiddenModules.includes(rel) || forbiddenTrees.some((t) => rel.startsWith(t)));
  const queue: string[] = [];
  for (const entry of entryPoints) {
    if (!existsSync(resolve(root, entry))) {
      violations.push({ kind: "unresolved", file: entry, detail: "entry point does not exist (build first)", chain: [entry] });
      continue;
    }
    if (!parent.has(entry)) { parent.set(entry, null); queue.push(entry); }
  }
  while (queue.length) {
    const file = queue.shift()!;
    const { references, stringLiterals } = moduleReferences(readFileSync(resolve(root, file), "utf8"), file);
    const fail = (kind: GraphViolation["kind"], detail: string) =>
      violations.push({ kind, file, detail, chain: chainOf(file) });
    for (const literal of checkPathLiterals ? stringLiterals : []) {
      if (FORBIDDEN_PATH_LITERAL.test(literal)) fail("forbidden-path-literal", JSON.stringify(literal));
    }
    for (const reference of references) {
      if (!("specifier" in reference)) {
        fail(reference.kind === "require" ? "require" : "non-literal-dynamic-import", reference.text);
        continue;
      }
      const { specifier } = reference;
      if (specifier.startsWith("node:") || BUILTINS.has(specifier)) continue;
      if (!specifier.startsWith(".")) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(specifier) || specifier.startsWith("/")) {
          fail("outside-tree", `${reference.kind} import of ${JSON.stringify(specifier)}`);
        } else if (!allowedPackages.includes(packageName(specifier))) {
          fail("undeclared-package", `${reference.kind} import of ${JSON.stringify(specifier)}`);
        }
        continue;
      }
      const target = toPosix(relative(root, resolve(root, dirname(file), specifier)));
      if (!target.startsWith(tree)) {
        fail("outside-tree", `${reference.kind} import of ${JSON.stringify(specifier)} resolves to ${target}`);
        continue;
      }
      if (!existsSync(resolve(root, target)) || !statSync(resolve(root, target)).isFile()) {
        fail("unresolved", `${reference.kind} import of ${JSON.stringify(specifier)} (${target}) does not exist`);
        continue;
      }
      if (isForbidden(target)) {
        fail("forbidden", `${reference.kind} import reaches ${target}`);
        continue;
      }
      if (!parent.has(target)) { parent.set(target, file); queue.push(target); }
    }
  }
  return { reached: [...parent.keys()].sort(), violations };
}

/** One line per violation, naming the whole chain. */
export function describeViolation(violation: GraphViolation): string {
  return `${violation.kind}: ${violation.detail} — via ${violation.chain.join(" → ")}`;
}

/**
 * The live entry points the repository's own configuration names:
 * `render.yaml`'s start and pre-deploy commands, resolved through
 * `package.json`, plus `package.json`'s other operator commands that run a
 * compiled module against a live environment (`dryrun`, `dryrun:live`,
 * `evidence:sync`). Self-tests are not entry points.
 */
export function liveEntryPointsFromConfig(root: string): { entryPoints: string[]; unresolved: string[] } {
  const scripts = (JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { scripts: Record<string, string> })
    .scripts;
  const render = readFileSync(resolve(root, "render.yaml"), "utf8");
  const unresolved: string[] = [];
  const found = new Set<string>();
  const fromScript = (name: string) => {
    const command = scripts[name];
    const module = command ? /^node\s+(dist\/\S+\.js)(?:\s|$)/.exec(command)?.[1] : undefined;
    if (module) found.add(module);
    else unresolved.push(`npm run ${name}: ${command ?? "(no such script)"}`);
  };
  for (const match of render.matchAll(/^\s*(?:startCommand|preDeployCommand):\s*(.+?)\s*(?:#.*)?$/gm)) {
    const npm = /^npm run ([\w:-]+)$/.exec(match[1]!.trim());
    if (npm) fromScript(npm[1]!);
    else unresolved.push(`render.yaml command not of the form "npm run <script>": ${match[1]}`);
  }
  for (const name of Object.keys(scripts)) {
    if (/^start:|^migrate$|^dryrun(:live)?$|^evidence:sync$/.test(name)) fromScript(name);
  }
  return { entryPoints: [...found].sort(), unresolved };
}

/** Every code file in the repository, keyed by repository-relative path. */
export function repositoryCodeFiles(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const skip = new Set(["node_modules", "dist", ".git", "local-output"]);
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (skip.has(name)) continue;
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (/\.(?:[cm]?[jt]s)$/.test(name) && !name.endsWith(".d.ts")) {
        files.set(toPosix(relative(root, path)), readFileSync(path, "utf8"));
      }
    }
  };
  walk(root);
  return files;
}

const underAny = (path: string, prefixes: readonly string[]) =>
  prefixes.some((prefix) => (prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix));

/**
 * The caller allowlist, over a set of files (repository-relative path → text).
 * A file imports the library when an import, re-export, `import()` or
 * `require` names it — by a specifier resolving into the library's source or
 * compiled tree, by one mentioning `contentRun`, or, for a computed `import()`,
 * when the file also holds a string naming a compiled library module.
 */
export function callerViolations(files: ReadonlyMap<string, string>): Array<{ file: string; detail: string }> {
  const violations: Array<{ file: string; detail: string }> = [];
  const executorSources = FORBIDDEN_LIVE_MODULES
    .filter((m) => !m.endsWith("/revision.js"))
    .flatMap((m) => [m, m.replace(/^dist\//, "src/").replace(/\.js$/, ".ts")]);
  const libraryPathLiteral = /contentRun\/[^\s"'`]*\.[cm]?js\b/;
  for (const [file, text] of files) {
    if (underAny(file, CONTENT_RUN_TREES)) continue;
    const { references, stringLiterals } = moduleReferences(text, file);
    const holdsLibraryPath = stringLiterals.some((literal) => libraryPathLiteral.test(literal));
    for (const reference of references) {
      let target: string | undefined;
      let library = false;
      let describe: string;
      if ("specifier" in reference) {
        if (reference.specifier.startsWith(".")) {
          target = toPosix(join(dirname(file), reference.specifier));
          library = underAny(target, CONTENT_RUN_TREES);
        }
        library ||= reference.specifier.includes("contentRun");
        describe = `${reference.kind} import of ${JSON.stringify(reference.specifier)}`;
      } else {
        library = reference.text.includes("contentRun") || (reference.kind === "dynamic-non-literal" && holdsLibraryPath);
        describe = `${reference.kind}: ${reference.text}`;
      }
      if (library && (file.startsWith(STUDIO_WEB_TREE) || !underAny(file, CONTENT_RUN_CALLERS))) {
        violations.push({ file, detail: `${describe} reaches the content-run library, which only `
          + `${CONTENT_RUN_CALLERS.join(" and ")} may import` });
      } else if (file.startsWith(STUDIO_WEB_TREE) && target !== undefined
        && executorSources.some((m) => target === m || target === m.replace(/\.ts$/, ".js"))) {
        violations.push({ file, detail: `${describe}: the Studio web service may not reach a stage executor or the stage-execution boundary` });
      }
    }
  }
  return violations;
}

export interface LivePathManifest {
  schema: "gcd-live-path-manifest/1";
  entryPoints: string[];
  modules: Array<{ path: string; sha256: string; declared: string }>;
}

export const LIVE_PATH_MANIFEST = "scripts/ci/live-path-manifest.json";

/** The source file a compiled live module is built from. */
export const sourceOf = (compiled: string): string => compiled.replace(/^dist\//, "src/").replace(/\.js$/, ".ts");

const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");

/**
 * The shared-module diff guard: the manifest must name exactly the live set,
 * with each module's current sha256 and a non-empty declaration.
 */
export function livePathManifestViolations(
  manifest: LivePathManifest,
  live: { entryPoints: readonly string[]; modules: ReadonlyMap<string, string> },
): string[] {
  const problems: string[] = [];
  if (manifest?.schema !== "gcd-live-path-manifest/1" || !Array.isArray(manifest.modules)) {
    return ["the manifest is not a gcd-live-path-manifest/1 document"];
  }
  if (JSON.stringify(manifest.entryPoints) !== JSON.stringify([...live.entryPoints])) {
    problems.push(`the manifest's entry points ${JSON.stringify(manifest.entryPoints)} are not the walked ones`);
  }
  const declared = new Map(manifest.modules.map((m) => [m.path, m]));
  if (declared.size !== manifest.modules.length) problems.push("the manifest lists a module twice");
  for (const [path, digest] of live.modules) {
    const entry = declared.get(path);
    if (!entry) problems.push(`${path} is now live-loaded but is not declared`);
    else if (entry.sha256 !== digest) problems.push(`${path} was edited without a declaration (sha256 ${digest}, declared ${entry.sha256})`);
    else if (typeof entry.declared !== "string" || !entry.declared.trim()) problems.push(`${path} carries no declaration reason`);
  }
  for (const path of declared.keys()) {
    if (!live.modules.has(path)) problems.push(`${path} is declared but is no longer live-loaded`);
  }
  const order = manifest.modules.map((m) => m.path);
  if (JSON.stringify(order) !== JSON.stringify([...order].sort())) problems.push("the manifest's modules are not sorted by path");
  return problems;
}

/** The live set as the diff guard pins it: each live module's source file and its sha256. */
export function liveSourceDigests(root: string, reached: readonly string[]): Map<string, string> {
  return new Map(reached.map((compiled) => {
    const source = sourceOf(compiled);
    const path = resolve(root, source);
    return [source, existsSync(path) ? sha256(readFileSync(path)) : "(no source file)"];
  }));
}

/**
 * `node dist/harness/livePathGuards.js [--declare "<reason>"]` prints the live
 * set and any manifest problem; with `--declare` it rewrites the manifest so
 * every changed, added or removed module carries the given reason. The
 * rewritten manifest is the declaration a reviewer reads in the diff.
 */
function cli(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const packages = Object.keys((JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  }).dependencies ?? {});
  const { reached, violations } = walkImportGraph({ root, entryPoints: LIVE_ENTRY_POINTS, allowedPackages: packages });
  for (const violation of violations) console.error(describeViolation(violation));
  const modules = liveSourceDigests(root, reached);
  const manifestPath = resolve(root, LIVE_PATH_MANIFEST);
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8")) as LivePathManifest
    : { schema: "gcd-live-path-manifest/1" as const, entryPoints: [], modules: [] };
  const at = process.argv.indexOf("--declare");
  if (at >= 0) {
    const reason = process.argv[at + 1]?.trim();
    if (!reason) throw new Error("--declare needs a reason naming the change and why it edits the live path");
    const before = new Map(manifest.modules.map((m) => [m.path, m]));
    const next: LivePathManifest = {
      schema: "gcd-live-path-manifest/1",
      entryPoints: [...LIVE_ENTRY_POINTS],
      modules: [...modules].sort(([a], [b]) => (a < b ? -1 : 1)).map(([path, digest]) => {
        const old = before.get(path);
        return old && old.sha256 === digest ? old : { path, sha256: digest, declared: reason };
      }),
    };
    writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    console.log(`Wrote ${LIVE_PATH_MANIFEST}: ${next.modules.length} live module(s).`);
    return;
  }
  const problems = livePathManifestViolations(manifest, { entryPoints: LIVE_ENTRY_POINTS, modules });
  console.log(`${modules.size} live module(s) from ${LIVE_ENTRY_POINTS.length} entry points.`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exitCode = violations.length || problems.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
