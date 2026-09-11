/**
 * CC5-SYNTAX-001 closure: structural authority over the two authoritative SQL
 * comment blocks.
 *
 * WHY THIS EXISTS. `CC5` in contentIntelligence.selftest.ts classifies English
 * application-state predicates with a bespoke bounded grammar. Every round of
 * review has found another construction it does not recognise; the latest,
 * recorded as CC5-SYNTAX-001, is the past `remain`/`stay` family ("Migration 007
 * remained unapplied."). Teaching the grammar one more phrase closes one more
 * form and leaves the class open, because the space of English paraphrase is not
 * finite and the grammar is a DENYLIST over it.
 *
 * WHAT THIS DOES INSTEAD. It inverts the quantifier. The authoritative comment
 * prose of both 007 artifacts is FROZEN by exact content, and additions are
 * confined to one designated zone whose contents must match an explicit
 * ALLOWLIST of authorized sentences. Nothing is interpreted. A sentence is
 * accepted because it is byte-identical to approved text, not because a parser
 * judged its tense frame. Any wording the allowlist does not contain fails
 * closed, whatever its grammar — including every CC5-SYNTAX-001 form and every
 * paraphrase nobody has thought of yet.
 *
 * WHAT THIS DOES NOT CLAIM. No semantic understanding, no arbitrary-English
 * coverage, and no evidence about migration 007's production state. This is a
 * repository-content control. It proves what the files SAY, never what the
 * database DID. `CC5`'s grammar is retained unchanged alongside it: this is an
 * additional structural layer, not a replacement, so no protected class it
 * already covers can regress.
 *
 * CHANGING THE AUTHORITY IS DELIBERATELY VISIBLE. A legitimate edit to the
 * frozen prose, or a new authorized sentence, requires editing
 * sqlAuthority.json — a reviewable diff carrying the exact text and its digest.
 * Wording variation cannot pass through silently.
 */

import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Raw-byte SHA-256. Never hash a decoded string: decoding is lossy for the
 * byte sequences this control exists to pin (invalid UTF-8 becomes U+FFFD, and
 * distinct malformed inputs collapse onto one digest). */
export const sha256Bytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** SHA-256 of a string's UTF-8 encoding, used for manifest text fields. */
export const sha256Text = (text: string): string =>
  sha256Bytes(Buffer.from(text, "utf8"));

/** Decode with FATAL UTF-8. Text used for canonical-statement comparison must
 * fail on malformed input rather than silently becoming replacement
 * characters — otherwise two different byte sequences compare equal. */
export const decodeUtf8Fatal = (bytes: Uint8Array): string =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);

const HEX64 = /^[0-9a-f]{64}$/;

/** The manifest's closed key sets. Any other key is a violation. */
const SEGMENT_KEYS = new Set(["text", "sha256"]);
const ARTIFACT_KEYS = new Set([
  "path", "executableSha256", "leadingSegment", "trailingSegment",
]);
const ROOT_KEYS = new Set(["version", "artifacts", "authorizedSentences"]);

/** Exactly these two paths, in this order. Nothing else is an authority. */
export const AUTHORITATIVE_SQL_PATHS = [
  "state/migrations/007_evidence_bounds.sql",
  "state/rollback/007_evidence_bounds_rollback.sql",
] as const;

export const SQL_AUTHORITY_MANIFEST = "src/harness/sqlAuthority.json";

// ---------------------------------------------------------------------------
// Duplicate-aware JSON parsing
// ---------------------------------------------------------------------------
//
// `JSON.parse` silently keeps the LAST of duplicated property names. A manifest
// carrying two `sha256` members would therefore be read as whichever one came
// second, while a reviewer reading the diff sees both. That is a real authority
// bypass: the reviewed text and the enforced text differ.
//
// The duplicate check must happen DURING parsing, per object scope, on DECODED
// names -- `"path"` and `"path"` are the same property and must collide.
// A regex pre-scan cannot do this (it cannot tell a key from a string value,
// and does not decode escapes), and a post-`JSON.parse` check cannot do it
// either (the duplicate is already gone). So this is a real parser.

class JsonSyntaxError extends Error {}

class DuplicateAwareJsonParser {
  private i = 0;

  constructor(private readonly s: string) {}

  static parse(text: string): unknown {
    const p = new DuplicateAwareJsonParser(text);
    p.ws();
    const value = p.value();
    p.ws();
    if (p.i !== p.s.length) p.fail("trailing content after the top-level value");
    return value;
  }

  private fail(why: string): never {
    throw new JsonSyntaxError(`${why} at offset ${this.i}`);
  }

  private ws(): void {
    while (this.i < this.s.length && " \t\n\r".includes(this.s[this.i]!)) this.i += 1;
  }

  private lit(word: string): void {
    if (this.s.startsWith(word, this.i)) this.i += word.length;
    else this.fail(`expected ${word}`);
  }

  private value(): unknown {
    const c = this.s[this.i];
    if (c === undefined) this.fail("unexpected end of input");
    if (c === "{") return this.object();
    if (c === "[") return this.array();
    if (c === '"') return this.string();
    if (c === "t") { this.lit("true"); return true; }
    if (c === "f") { this.lit("false"); return false; }
    if (c === "n") { this.lit("null"); return null; }
    return this.number();
  }

  private object(): Record<string, unknown> {
    this.i += 1; // "{"
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    // One `seen` set PER OBJECT SCOPE, so the same name in two sibling objects
    // is legitimate reuse while the same name twice in one object is not.
    const seen = new Set<string>();
    this.ws();
    if (this.s[this.i] === "}") { this.i += 1; return out; }
    for (;;) {
      this.ws();
      if (this.s[this.i] !== '"') this.fail("expected a property name");
      const key = this.string();
      if (seen.has(key)) this.fail(`duplicate property name ${JSON.stringify(key)}`);
      seen.add(key);
      this.ws();
      if (this.s[this.i] !== ":") this.fail("expected ':'");
      this.i += 1;
      this.ws();
      out[key] = this.value();
      this.ws();
      const c = this.s[this.i];
      if (c === ",") { this.i += 1; continue; }
      if (c === "}") { this.i += 1; return out; }
      this.fail("expected ',' or '}'");
    }
  }

  private array(): unknown[] {
    this.i += 1; // "["
    const out: unknown[] = [];
    this.ws();
    if (this.s[this.i] === "]") { this.i += 1; return out; }
    for (;;) {
      this.ws();
      out.push(this.value());
      this.ws();
      const c = this.s[this.i];
      if (c === ",") { this.i += 1; continue; }
      if (c === "]") { this.i += 1; return out; }
      this.fail("expected ',' or ']'");
    }
  }

  private string(): string {
    this.i += 1; // opening quote
    let out = "";
    for (;;) {
      const c = this.s[this.i];
      if (c === undefined) this.fail("unterminated string");
      if (c === '"') { this.i += 1; return out; }
      if (c === "\\") { out += this.escape(); continue; }
      // Raw control characters are not permitted inside a JSON string.
      if (c < " ") this.fail("raw control character in a string");
      out += c;
      this.i += 1;
    }
  }

  private escape(): string {
    this.i += 1; // backslash
    const c = this.s[this.i];
    this.i += 1;
    switch (c) {
      case '"': return '"';
      case "\\": return "\\";
      case "/": return "/";
      case "b": return "\b";
      case "f": return "\f";
      case "n": return "\n";
      case "r": return "\r";
      case "t": return "\t";
      case "u": {
        const hex = this.s.slice(this.i, this.i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("bad \\u escape");
        this.i += 4;
        // Returned as a lone code unit. A surrogate PAIR written as two \u
        // escapes reassembles naturally through string concatenation, so
        // "😀" decodes to the same key as a literal emoji and the two
        // spellings collide in `seen`, which is the required behaviour.
        return String.fromCharCode(parseInt(hex, 16));
      }
      default: return this.fail("unknown escape");
    }
  }

  private number(): number {
    const start = this.i;
    if (this.s[this.i] === "-") this.i += 1;
    while (this.i < this.s.length && this.s[this.i]! >= "0" && this.s[this.i]! <= "9") this.i += 1;
    if (this.s[this.i] === ".") {
      this.i += 1;
      while (this.i < this.s.length && this.s[this.i]! >= "0" && this.s[this.i]! <= "9") this.i += 1;
    }
    if (this.s[this.i] === "e" || this.s[this.i] === "E") {
      this.i += 1;
      if (this.s[this.i] === "+" || this.s[this.i] === "-") this.i += 1;
      while (this.i < this.s.length && this.s[this.i]! >= "0" && this.s[this.i]! <= "9") this.i += 1;
    }
    const raw = this.s.slice(start, this.i);
    if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(raw)) {
      this.i = start;
      this.fail("malformed number");
    }
    return Number(raw);
  }
}

/** Parses JSON, rejecting duplicate decoded property names within any one
 * object scope. Throws on malformed JSON. */
export const parseJsonRejectingDuplicateKeys = (text: string): unknown =>
  DuplicateAwareJsonParser.parse(text);

// ---------------------------------------------------------------------------
// File access
// ---------------------------------------------------------------------------

/**
 * Reads a file that must be a REGULAR file and not a symlink.
 *
 * `lstat` does not follow the final component, so a symlink is seen as a
 * symlink. Without this, an authority file could be replaced by a link to
 * byte-identical content elsewhere: every digest would still match while the
 * bytes under review came from a path nobody reviewed, and the link target
 * could be changed afterwards without touching anything the manifest pins.
 */
export const readRegularFileBytes = (absolutePath: string): Buffer => {
  const st = lstatSync(absolutePath);
  if (st.isSymbolicLink()) throw new Error(`${absolutePath} is a symbolic link`);
  if (!st.isFile()) throw new Error(`${absolutePath} is not a regular file`);
  return readFileSync(absolutePath);
};

const LF = 0x0a;
const DASH = 0x2d;

/** True when a raw line's first non-blank bytes are `--`. Decided on BYTES, so
 * no decoding happens before the executable digest is taken. */
const isCommentLineBytes = (line: Uint8Array): boolean => {
  let k = 0;
  while (k < line.length && (line[k] === 0x20 || line[k] === 0x09 || line[k] === 0x0d)) k += 1;
  return line[k] === DASH && line[k + 1] === DASH;
};

const splitLinesBytes = (bytes: Uint8Array): Uint8Array[] => {
  const out: Uint8Array[] = [];
  let start = 0;
  for (let k = 0; k < bytes.length; k += 1) {
    if (bytes[k] === LF) { out.push(bytes.subarray(start, k)); start = k + 1; }
  }
  out.push(bytes.subarray(start));
  return out;
};

/**
 * The file's EXECUTABLE bytes: every line that is not a full-line comment,
 * rejoined with LF, as raw bytes. Authorized prose additions are full-line
 * comments, so this digest is invariant under them while any change to the SQL
 * the database actually runs moves it.
 */
export const executableBytes = (fileBytes: Uint8Array): Buffer => {
  const kept = splitLinesBytes(fileBytes).filter((l) => !isCommentLineBytes(l));
  const parts: number[] = [];
  kept.forEach((line, idx) => {
    if (idx > 0) parts.push(LF);
    for (const b of line) parts.push(b);
  });
  return Buffer.from(parts);
};

/** The authoritative prose: full-line comments, `--` stripped, joined with one
 * space so a hard-wrapped sentence is one string. Mirrors `sqlComments` in the
 * Content Intelligence self-test so both judge the same text. */
export const commentStream = (sql: string): string => sql
  .split("\n")
  .filter((line) => /^\s*--/.test(line))
  .map((line) => line.replace(/^\s*--\s?/, ""))
  .join(" ");

// ---------------------------------------------------------------------------
// Manifest shape
// ---------------------------------------------------------------------------

export type AuthoritySegment = { readonly text: string; readonly sha256: string };
export type AuthorityArtifact = {
  readonly path: string;
  readonly executableSha256: string;
  readonly leadingSegment: AuthoritySegment;
  readonly trailingSegment: AuthoritySegment;
};
export type SqlAuthority = {
  readonly version: number;
  readonly artifacts: readonly AuthorityArtifact[];
  readonly authorizedSentences: readonly AuthoritySegment[];
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const checkClosedKeys = (
  obj: Record<string, unknown>, allowed: ReadonlySet<string>, where: string,
  violations: string[],
): void => {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) violations.push(`${where}: unexpected field ${JSON.stringify(key)}`);
  }
  for (const key of allowed) {
    if (!(key in obj)) violations.push(`${where}: missing required field ${JSON.stringify(key)}`);
  }
};

const readSegment = (
  v: unknown, where: string, violations: string[],
): AuthoritySegment | undefined => {
  if (!isPlainObject(v)) { violations.push(`${where}: not an object`); return undefined; }
  checkClosedKeys(v, SEGMENT_KEYS, where, violations);
  const { text, sha256 } = v;
  if (typeof text !== "string" || text.length === 0) {
    violations.push(`${where}.text: not a non-empty string`); return undefined;
  }
  if (typeof sha256 !== "string" || !HEX64.test(sha256)) {
    violations.push(`${where}.sha256: not a lowercase 64-character hex digest`); return undefined;
  }
  if (sha256Text(text) !== sha256) {
    violations.push(`${where}: sha256 does not match its own text`); return undefined;
  }
  return { text, sha256 };
};

/**
 * Validates the manifest against a CLOSED schema and returns it, or returns the
 * violations found. Nothing partially-valid is ever returned: a caller cannot
 * accidentally enforce half an authority.
 */
export const validateManifest = (
  parsed: unknown,
): { authority?: SqlAuthority; violations: string[] } => {
  const violations: string[] = [];
  if (!isPlainObject(parsed)) return { violations: ["manifest: not a JSON object"] };
  checkClosedKeys(parsed, ROOT_KEYS, "manifest", violations);

  if (parsed.version !== 1) violations.push("manifest.version: must be exactly 1");

  const artifacts: AuthorityArtifact[] = [];
  if (!Array.isArray(parsed.artifacts)) {
    violations.push("manifest.artifacts: not an array");
  } else if (parsed.artifacts.length !== AUTHORITATIVE_SQL_PATHS.length) {
    violations.push(
      `manifest.artifacts: must describe exactly ${AUTHORITATIVE_SQL_PATHS.length} artifacts`);
  } else {
    parsed.artifacts.forEach((raw, idx) => {
      const where = `manifest.artifacts[${idx}]`;
      if (!isPlainObject(raw)) { violations.push(`${where}: not an object`); return; }
      checkClosedKeys(raw, ARTIFACT_KEYS, where, violations);
      const expectedPath = AUTHORITATIVE_SQL_PATHS[idx];
      if (expectedPath === undefined) { violations.push(`${where}: unexpected extra artifact`); return; }
      if (raw.path !== expectedPath) {
        violations.push(`${where}.path: must be exactly ${JSON.stringify(expectedPath)}`);
      }
      const exec = raw.executableSha256;
      if (typeof exec !== "string" || !HEX64.test(exec)) {
        violations.push(`${where}.executableSha256: not a lowercase 64-character hex digest`);
      }
      const leading = readSegment(raw.leadingSegment, `${where}.leadingSegment`, violations);
      const trailing = readSegment(raw.trailingSegment, `${where}.trailingSegment`, violations);
      if (typeof exec === "string" && leading && trailing && raw.path === expectedPath) {
        artifacts.push({
          path: expectedPath, executableSha256: exec,
          leadingSegment: leading, trailingSegment: trailing,
        });
      }
    });
  }

  const sentences: AuthoritySegment[] = [];
  if (!Array.isArray(parsed.authorizedSentences)) {
    violations.push("manifest.authorizedSentences: not an array");
  } else {
    const seenText = new Set<string>();
    parsed.authorizedSentences.forEach((raw, idx) => {
      const seg = readSegment(raw, `manifest.authorizedSentences[${idx}]`, violations);
      if (!seg) return;
      if (seenText.has(seg.text)) {
        violations.push(`manifest.authorizedSentences[${idx}]: duplicate sentence`);
        return;
      }
      seenText.add(seg.text);
      sentences.push(seg);
    });
  }

  if (violations.length) return { violations };
  return {
    authority: { version: 1, artifacts, authorizedSentences: sentences },
    violations: [],
  };
};

// ---------------------------------------------------------------------------
// The control
// ---------------------------------------------------------------------------

/**
 * Decomposes the open zone into authorized sentences.
 *
 * The zone is the space between the two frozen segments. It is empty in the
 * checked-in files; a mutation that inserts authorized prose puts exactly that
 * prose here. Matching is LONGEST-FIRST so a sentence that is a prefix of a
 * longer approved one cannot shadow it. Anything left over is unauthorized.
 */
export const decomposeOpenZone = (
  zone: string, authorized: readonly AuthoritySegment[],
): { ok: boolean; residue: string } => {
  const byLength = [...authorized].sort((a, b) => b.text.length - a.text.length);
  let rest = zone.trim();
  for (;;) {
    if (rest.length === 0) return { ok: true, residue: "" };
    const hit = byLength.find((s) => rest === s.text || rest.startsWith(`${s.text} `));
    if (!hit) return { ok: false, residue: rest };
    rest = rest.slice(hit.text.length).trim();
  }
};

export type AuthorityCheck = {
  readonly violations: readonly string[];
  /** Digests actually observed, for evidence reporting. */
  readonly observed: ReadonlyArray<{ path: string; executableSha256: string; rawSha256: string }>;
};

/**
 * Runs the whole control against a repository root.
 *
 * Every failure mode is a violation string rather than a thrown error, so the
 * self-test reports a named failure instead of aborting — an abort is
 * indistinguishable from a crash to the mutation harness.
 */
export const checkSqlAuthority = (repoRoot: string): AuthorityCheck => {
  const violations: string[] = [];
  const observed: Array<{ path: string; executableSha256: string; rawSha256: string }> = [];

  let manifestBytes: Buffer;
  try {
    manifestBytes = readRegularFileBytes(resolve(repoRoot, SQL_AUTHORITY_MANIFEST));
  } catch (error) {
    return { violations: [`manifest unreadable: ${(error as Error).message}`], observed };
  }

  let manifestText: string;
  try {
    manifestText = decodeUtf8Fatal(manifestBytes);
  } catch {
    return { violations: ["manifest is not valid UTF-8"], observed };
  }

  let parsed: unknown;
  try {
    parsed = parseJsonRejectingDuplicateKeys(manifestText);
  } catch (error) {
    return { violations: [`manifest JSON rejected: ${(error as Error).message}`], observed };
  }

  const { authority, violations: schemaViolations } = validateManifest(parsed);
  if (!authority) return { violations: schemaViolations, observed };

  for (const artifact of authority.artifacts) {
    const abs = resolve(repoRoot, artifact.path);
    let bytes: Buffer;
    try {
      bytes = readRegularFileBytes(abs);
    } catch (error) {
      violations.push(`${artifact.path}: ${(error as Error).message}`);
      continue;
    }

    const rawSha256 = sha256Bytes(bytes);
    const execSha = sha256Bytes(executableBytes(bytes));
    observed.push({ path: artifact.path, executableSha256: execSha, rawSha256 });
    if (execSha !== artifact.executableSha256) {
      violations.push(
        `${artifact.path}: executable SQL digest ${execSha} does not match the authority `
        + `${artifact.executableSha256}`);
    }

    let sql: string;
    try {
      sql = decodeUtf8Fatal(bytes);
    } catch {
      violations.push(`${artifact.path}: not valid UTF-8`);
      continue;
    }

    const stream = commentStream(sql);
    const leading = artifact.leadingSegment.text;
    const trailing = artifact.trailingSegment.text;
    if (!stream.startsWith(leading)) {
      violations.push(`${artifact.path}: the frozen leading comment block is altered or displaced`);
      continue;
    }
    if (!stream.endsWith(trailing)) {
      violations.push(`${artifact.path}: the frozen trailing comment block is altered or displaced`);
      continue;
    }
    const middle = stream.slice(leading.length, stream.length - trailing.length);
    const { ok, residue } = decomposeOpenZone(middle, authority.authorizedSentences);
    if (!ok) {
      violations.push(
        `${artifact.path}: unauthorized comment prose: ${JSON.stringify(residue.slice(0, 200))}`);
    }
  }

  return { violations, observed };
};
