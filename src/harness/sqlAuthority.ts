/**
 * CC5-SYNTAX-001 closure: raw whole-file identity for the two authoritative
 * migration-007 SQL artifacts.
 *
 * This control does not interpret SQL or English and has no insertion zone.
 * Every byte is review authority: SQL, comments, whitespace, line endings,
 * encoding markers, and bytes inside dollar-quoted bodies. A legitimate change
 * requires a coordinated, review-visible update to the artifact digest in the
 * manifest and then to the manifest digest pinned below.
 *
 * The manifest does not authenticate itself. Its raw digest is independently
 * pinned in this source file. The pin is checked before the manifest is decoded
 * or parsed, and the observed digest is reported by the check.
 */

import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const AUTHORITATIVE_SQL_PATHS = [
  "state/migrations/007_evidence_bounds.sql",
  "state/rollback/007_evidence_bounds_rollback.sql",
] as const;

export const SQL_AUTHORITY_MANIFEST = "src/harness/sqlAuthority.json";

/** Independent review pin over the manifest's exact raw bytes. */
export const SQL_AUTHORITY_MANIFEST_SHA256 =
  "a420015da9d25133b6572f93eeb83e5a70109589fbafce77fbffbbce2e296121";

const HEX64 = /^[0-9a-f]{64}$/;
const ROOT_KEYS = new Set(["version", "artifacts"]);
const ARTIFACT_KEYS = new Set(["path", "sha256"]);

export const sha256Bytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export const decodeUtf8Fatal = (bytes: Uint8Array): string =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);

class JsonSyntaxError extends Error {}

class DuplicateAwareJsonParser {
  private index = 0;

  constructor(private readonly text: string) {}

  static parse(text: string): unknown {
    const parser = new DuplicateAwareJsonParser(text);
    parser.whitespace();
    const value = parser.value();
    parser.whitespace();
    if (parser.index !== parser.text.length) parser.fail("trailing content");
    return value;
  }

  private fail(message: string): never {
    throw new JsonSyntaxError(`${message} at offset ${this.index}`);
  }

  private whitespace(): void {
    while (this.index < this.text.length && " \t\n\r".includes(this.text[this.index]!)) {
      this.index += 1;
    }
  }

  private literal(token: string, value: boolean | null): boolean | null {
    if (!this.text.startsWith(token, this.index)) this.fail(`expected ${token}`);
    this.index += token.length;
    return value;
  }

  private value(): unknown {
    const char = this.text[this.index];
    if (char === undefined) this.fail("unexpected end of input");
    if (char === "{") return this.object();
    if (char === "[") return this.array();
    if (char === "\"") return this.string();
    if (char === "t") return this.literal("true", true);
    if (char === "f") return this.literal("false", false);
    if (char === "n") return this.literal("null", null);
    return this.number();
  }

  private object(): Record<string, unknown> {
    this.index += 1;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const names = new Set<string>();
    this.whitespace();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return result;
    }
    for (;;) {
      this.whitespace();
      if (this.text[this.index] !== "\"") this.fail("expected a property name");
      const name = this.string();
      if (names.has(name)) this.fail(`duplicate decoded property name ${JSON.stringify(name)}`);
      names.add(name);
      this.whitespace();
      if (this.text[this.index] !== ":") this.fail("expected ':'");
      this.index += 1;
      this.whitespace();
      result[name] = this.value();
      this.whitespace();
      const separator = this.text[this.index];
      if (separator === ",") {
        this.index += 1;
        continue;
      }
      if (separator === "}") {
        this.index += 1;
        return result;
      }
      this.fail("expected ',' or '}'");
    }
  }

  private array(): unknown[] {
    this.index += 1;
    const result: unknown[] = [];
    this.whitespace();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return result;
    }
    for (;;) {
      this.whitespace();
      result.push(this.value());
      this.whitespace();
      const separator = this.text[this.index];
      if (separator === ",") {
        this.index += 1;
        continue;
      }
      if (separator === "]") {
        this.index += 1;
        return result;
      }
      this.fail("expected ',' or ']'");
    }
  }

  private string(): string {
    this.index += 1;
    let result = "";
    for (;;) {
      const char = this.text[this.index];
      if (char === undefined) this.fail("unterminated string");
      if (char === "\"") {
        this.index += 1;
        return result;
      }
      if (char === "\\") {
        result += this.escape();
        continue;
      }
      if (char < " ") this.fail("raw control character in string");
      result += char;
      this.index += 1;
    }
  }

  private escape(): string {
    this.index += 1;
    const char = this.text[this.index];
    this.index += 1;
    switch (char) {
      case "\"": return "\"";
      case "\\": return "\\";
      case "/": return "/";
      case "b": return "\b";
      case "f": return "\f";
      case "n": return "\n";
      case "r": return "\r";
      case "t": return "\t";
      case "u": {
        const hex = this.text.slice(this.index, this.index + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("bad \\u escape");
        this.index += 4;
        return String.fromCharCode(parseInt(hex, 16));
      }
      default: return this.fail("unknown escape");
    }
  }

  private number(): number {
    const match = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
    match.lastIndex = this.index;
    const found = match.exec(this.text);
    if (!found) this.fail("malformed number");
    this.index = match.lastIndex;
    return Number(found[0]);
  }
}

/** Rejects duplicate decoded property names recursively before returning an object. */
export const parseJsonRejectingDuplicateKeys = (text: string): unknown =>
  DuplicateAwareJsonParser.parse(text);

export const readRegularFileBytes = (absolutePath: string): Buffer => {
  // Open without following the final path component, then inspect and read the
  // same descriptor. That avoids a check/read race in which a regular file
  // could otherwise be replaced with a symlink after lstat.
  let descriptor: number;
  try {
    descriptor = openSync(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP") throw new Error(`${absolutePath} is a symbolic link`);
    throw error;
  }
  try {
    if (!fstatSync(descriptor).isFile()) throw new Error(`${absolutePath} is not a regular file`);
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

type AuthorityArtifact = {
  readonly path: string;
  readonly sha256: string;
};

type SqlAuthority = {
  readonly version: 2;
  readonly artifacts: readonly AuthorityArtifact[];
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const checkClosedKeys = (
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  where: string,
  violations: string[],
): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) violations.push(`${where}: unexpected field ${JSON.stringify(key)}`);
  }
  for (const key of allowed) {
    if (!(key in value)) violations.push(`${where}: missing required field ${JSON.stringify(key)}`);
  }
};

const validateManifest = (parsed: unknown): { authority?: SqlAuthority; violations: string[] } => {
  const violations: string[] = [];
  if (!isPlainObject(parsed)) return { violations: ["manifest: not a JSON object"] };
  checkClosedKeys(parsed, ROOT_KEYS, "manifest", violations);
  if (parsed.version !== 2) violations.push("manifest.version: must be exactly 2");

  const artifacts: AuthorityArtifact[] = [];
  if (!Array.isArray(parsed.artifacts)) {
    violations.push("manifest.artifacts: not an array");
  } else if (parsed.artifacts.length !== AUTHORITATIVE_SQL_PATHS.length) {
    violations.push(
      `manifest.artifacts: must describe exactly ${AUTHORITATIVE_SQL_PATHS.length} artifacts`,
    );
  } else {
    parsed.artifacts.forEach((raw, index) => {
      const where = `manifest.artifacts[${index}]`;
      if (!isPlainObject(raw)) {
        violations.push(`${where}: not an object`);
        return;
      }
      checkClosedKeys(raw, ARTIFACT_KEYS, where, violations);
      const expectedPath = AUTHORITATIVE_SQL_PATHS[index];
      if (expectedPath === undefined) {
        violations.push(`${where}: unexpected artifact index`);
        return;
      }
      if (raw.path !== expectedPath) {
        violations.push(`${where}.path: must be exactly ${JSON.stringify(expectedPath)}`);
      }
      if (typeof raw.sha256 !== "string" || !HEX64.test(raw.sha256)) {
        violations.push(`${where}.sha256: not a lowercase 64-character hex digest`);
      }
      if (raw.path === expectedPath && typeof raw.sha256 === "string" && HEX64.test(raw.sha256)) {
        artifacts.push({ path: expectedPath, sha256: raw.sha256 });
      }
    });
  }

  if (violations.length > 0) return { violations };
  return { authority: { version: 2, artifacts }, violations: [] };
};

export type AuthorityCheck = {
  readonly violations: readonly string[];
  readonly manifest?: {
    readonly path: string;
    readonly rawSha256: string;
    readonly expectedSha256: string;
  };
  readonly observed: ReadonlyArray<{
    readonly path: string;
    readonly rawSha256: string;
    readonly expectedSha256: string;
  }>;
};

export const checkSqlAuthority = (repoRoot: string): AuthorityCheck => {
  const violations: string[] = [];
  const observed: Array<{
    path: string;
    rawSha256: string;
    expectedSha256: string;
  }> = [];

  let manifestBytes: Buffer;
  try {
    manifestBytes = readRegularFileBytes(resolve(repoRoot, SQL_AUTHORITY_MANIFEST));
  } catch (error) {
    return { violations: [`manifest unreadable: ${(error as Error).message}`], observed };
  }

  // Hash first. No decoding, parsing, normalization, or self-described value
  // participates in establishing the manifest's identity.
  const manifestRawSha256 = sha256Bytes(manifestBytes);
  const manifest = {
    path: SQL_AUTHORITY_MANIFEST,
    rawSha256: manifestRawSha256,
    expectedSha256: SQL_AUTHORITY_MANIFEST_SHA256,
  };
  if (manifestRawSha256 !== SQL_AUTHORITY_MANIFEST_SHA256) {
    violations.push(
      `manifest raw digest ${manifestRawSha256} does not match independent review pin `
      + SQL_AUTHORITY_MANIFEST_SHA256,
    );
  }

  let manifestText: string;
  try {
    manifestText = decodeUtf8Fatal(manifestBytes);
  } catch {
    violations.push("manifest is not valid UTF-8");
    return { violations, manifest, observed };
  }

  let parsed: unknown;
  try {
    parsed = parseJsonRejectingDuplicateKeys(manifestText);
  } catch (error) {
    violations.push(`manifest JSON rejected: ${(error as Error).message}`);
    return { violations, manifest, observed };
  }

  const validated = validateManifest(parsed);
  if (!validated.authority) {
    violations.push(...validated.violations);
    return { violations, manifest, observed };
  }

  for (const artifact of validated.authority.artifacts) {
    let bytes: Buffer;
    try {
      bytes = readRegularFileBytes(resolve(repoRoot, artifact.path));
    } catch (error) {
      violations.push(`${artifact.path}: ${(error as Error).message}`);
      continue;
    }
    const rawSha256 = sha256Bytes(bytes);
    observed.push({ path: artifact.path, rawSha256, expectedSha256: artifact.sha256 });
    if (rawSha256 !== artifact.sha256) {
      violations.push(
        `${artifact.path}: raw digest ${rawSha256} does not match review authority `
        + artifact.sha256,
      );
    }
  }

  return { violations, manifest, observed };
};
