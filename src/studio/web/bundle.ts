/**
 * The Studio's two untrusted uploads, and the whole-run bundle
 * (docs/CONTENT_STUDIO_DESIGN.md §8.2 item 8, §8.5, §8.6, §9.1). Content
 * Studio S7.2. Pure functions over bytes: no database, no file system.
 *
 * - **Transport.** The static script puts the document in the form's one
 *   `document` field and submits the form, so the script makes no request of
 *   its own and S4's form token and Origin check apply; each route's body bound
 *   allows a document at its own bound under the worst percent-encoding (three
 *   bytes for each base64 `+` or `/`), and the document's own bound is checked
 *   on its bytes before it is parsed.
 * - **The run bundle** is ONE JSON document — the import's format and the
 *   whole-run download's, exactly:
 *   `{"schema":"gcd-studio-run-bundle/1","files":[{"name","sha256","base64"},…]}`,
 *   each file's bytes base64-encoded beside their sha256, so no byte-order
 *   mark, line ending or invalid UTF-8 is altered on the way. A downloaded
 *   bundle re-imports byte for byte.
 * - **Its bound is checked before parsing:** a document over 10 MiB (§8.6's
 *   "10 MB", the S7 analysis's item 10) is refused unread, as is one with more
 *   than twenty files; then every name must be one of the CLI's known files
 *   (`STUDIO_IMPORT_FILE_NAMES`), named once, every base64 canonical, and every
 *   sha256 recomputed and equal. Migration 0004 bounds the stored bytes at
 *   10 MiB as a backstop.
 * - **A fact upload** is `{"sha256","base64"}`: at most 1 MiB of bytes, the
 *   sha256 recomputed and equal.
 * - **Lineage** (the S7 analysis's item 8): a revised folder's `run-meta.json`
 *   and `round-1-06-final-critic.json` are byte copies of its source's
 *   `run-meta.json` and `06-final-critic.json`; a source is recorded only when
 *   exactly one non-deleted import matches.
 */

import { createHash } from "node:crypto";

import { FACT_UPLOAD_MAX_BYTES, STUDIO_IMPORT_FILE_NAMES } from "../db/runner.js";

export const RUN_BUNDLE_SCHEMA = "gcd-studio-run-bundle/1";
/** The posted import document's bound, checked before parsing: 10 MiB. */
export const IMPORT_MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
/** Design §8.6's file bound (0004's sixteen known names bound it tighter). */
export const IMPORT_MAX_FILES = 20;
/** A fact upload's document: 1 MiB as base64 (1,398,104 characters) and its sha256, with room for the JSON around them. */
export const FACT_UPLOAD_MAX_DOCUMENT_BYTES = 1_400_000;
/** The form a document arrives in may percent-encode each of its bytes as three, plus the token and the field names. */
const formBound = (documentBytes: number): number => 3 * documentBytes + 8_192;
/** The import route's declared body bound. */
export const IMPORT_MAX_FORM_BYTES = formBound(IMPORT_MAX_DOCUMENT_BYTES);
/** The upload route's declared body bound. */
export const FACT_UPLOAD_MAX_FORM_BYTES = formBound(FACT_UPLOAD_MAX_DOCUMENT_BYTES);
/** Why a bundle over the bound is refused. */
export const BUNDLE_TOO_LARGE = "too large to re-import";

export type Decoded<T> = { ok: true; value: T } | { ok: false; refusal: string; message: string };
export interface BundleFile { name: string; sha256: string; content: Buffer }

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const HEX64 = /^[0-9a-f]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const no = <T>(refusal: string, message: string): Decoded<T> => ({ ok: false, refusal, message });
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
/** A name as a message may quote it: bounded, and escaped by the page that shows it. */
const quoted = (value: unknown): string => JSON.stringify(String(value).slice(0, 120));

/** Strict base64: canonical (it re-encodes to itself), so one document has exactly one decoding. */
function strictBase64(value: string): Buffer | null {
  if (!BASE64.test(value)) return null;
  const bytes = Buffer.from(value, "base64");
  return bytes.toString("base64") === value ? bytes : null;
}

/** Strict UTF-8 JSON: a document that is not valid UTF-8 is refused, never repaired. */
function parseJson(raw: Buffer): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) };
  } catch {
    return { ok: false };
  }
}

/** The form's one `document` field, as bytes: exactly one, never parsed here. */
export function documentField(form: URLSearchParams): Decoded<Buffer> {
  const values = form.getAll("document");
  if (values.length !== 1) return no("invalid_document", "the form carries exactly one document");
  return { ok: true, value: Buffer.from(values[0]!, "utf8") };
}

/** An import document, decoded: its bound first, unread; then its shape, names, base64 and every sha256. */
export function decodeRunBundle(raw: Buffer): Decoded<BundleFile[]> {
  if (raw.length > IMPORT_MAX_DOCUMENT_BYTES) {
    return no("too_large", `the import document is ${raw.length} bytes; at most ${IMPORT_MAX_DOCUMENT_BYTES} (10 MiB) is accepted`);
  }
  const parsed = parseJson(raw);
  if (!parsed.ok) return no("invalid_json", "the import document is not valid UTF-8 JSON");
  const doc = parsed.value;
  if (!isPlainObject(doc) || doc.schema !== RUN_BUNDLE_SCHEMA || !Array.isArray(doc.files)
    || Object.keys(doc).some((key) => key !== "schema" && key !== "files")) {
    return no("invalid_bundle", `the import document is not a ${RUN_BUNDLE_SCHEMA} bundle`);
  }
  if (doc.files.length === 0) return no("no_files", "the import document holds no file");
  if (doc.files.length > IMPORT_MAX_FILES) {
    return no("too_many_files", `the import document holds ${doc.files.length} files; at most ${IMPORT_MAX_FILES} are accepted`);
  }
  const files: BundleFile[] = [];
  const seen = new Set<string>();
  for (const entry of doc.files) {
    if (!isPlainObject(entry) || typeof entry.name !== "string" || typeof entry.sha256 !== "string" || typeof entry.base64 !== "string"
      || Object.keys(entry).some((key) => key !== "name" && key !== "sha256" && key !== "base64")) {
      return no("invalid_bundle", "every file is exactly a name, a sha256 and base64 content");
    }
    if (!STUDIO_IMPORT_FILE_NAMES.includes(entry.name)) {
      return no("unknown_name", `${quoted(entry.name)} is not one of the CLI's known run files`);
    }
    if (seen.has(entry.name)) return no("duplicate_name", `${quoted(entry.name)} appears twice`);
    seen.add(entry.name);
    const content = strictBase64(entry.base64);
    if (content === null) return no("invalid_base64", `${quoted(entry.name)} is not canonical base64`);
    if (!HEX64.test(entry.sha256) || sha256(content) !== entry.sha256) {
      return no("sha_mismatch", `${quoted(entry.name)}: its bytes do not hash to the sha256 sent with them`);
    }
    files.push({ name: entry.name, sha256: entry.sha256, content });
  }
  return { ok: true, value: files };
}

/** The whole-run bundle: every file, by name; refused, with its reason, when it could not be imported again. */
export function encodeRunBundle(files: ReadonlyArray<{ name: string; content: Buffer }>): Decoded<Buffer> {
  if (files.length === 0) return no("bundle_empty", "this run saved no files, so there is nothing to bundle");
  if (files.length > IMPORT_MAX_FILES || files.some((f) => !STUDIO_IMPORT_FILE_NAMES.includes(f.name))) {
    return no("bundle_not_importable", "this run holds a file the import does not accept, so no bundle is offered");
  }
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const bytes = Buffer.from(JSON.stringify({
    schema: RUN_BUNDLE_SCHEMA,
    files: sorted.map((f) => ({ name: f.name, sha256: sha256(f.content), base64: f.content.toString("base64") })),
  }), "utf8");
  if (bytes.length > IMPORT_MAX_DOCUMENT_BYTES) {
    return no("bundle_too_large", `the bundle would be ${bytes.length} bytes, over the import's 10 MiB: ${BUNDLE_TOO_LARGE}`);
  }
  return { ok: true, value: bytes };
}

/** A fact upload's document: the bytes, at most 1 MiB, and their sha256 recomputed. */
export function decodeFactUpload(raw: Buffer): Decoded<{ content: Buffer; sha256: string }> {
  if (raw.length > FACT_UPLOAD_MAX_DOCUMENT_BYTES) return no("too_large", "the upload is larger than a 1 MiB facts file");
  const parsed = parseJson(raw);
  if (!parsed.ok) return no("invalid_json", "the upload is not valid UTF-8 JSON");
  const doc = parsed.value;
  if (!isPlainObject(doc) || typeof doc.sha256 !== "string" || typeof doc.base64 !== "string"
    || Object.keys(doc).some((key) => key !== "sha256" && key !== "base64")) {
    return no("invalid_upload", "the upload is exactly a sha256 and base64 content");
  }
  const content = strictBase64(doc.base64);
  if (content === null) return no("invalid_base64", "the file's content is not canonical base64");
  if (content.length === 0) return no("empty_file", "the file is empty");
  if (content.length > FACT_UPLOAD_MAX_BYTES) return no("too_large", `the file is ${content.length} bytes; at most 1 MiB is accepted`);
  if (!HEX64.test(doc.sha256) || sha256(content) !== doc.sha256) {
    return no("sha_mismatch", "the file's bytes do not hash to the sha256 sent with them");
  }
  return { ok: true, value: { content, sha256: doc.sha256 } };
}

/**
 * The runner an import records: `live` only when every meta file the folder
 * holds that names a runner names `live`, and `run-meta.json` is one of them;
 * otherwise `fake`, fail closed, so it can never be a paid action's source.
 */
export function importRunner(files: ReadonlyArray<{ name: string; content: Buffer }>): "live" | "fake" {
  const metas = ["run-meta.json", "resume-meta.json", "replay-meta.json", "revision-meta.json"];
  let runMetaLive = false;
  for (const file of files) {
    if (!metas.includes(file.name)) continue;
    const parsed = parseJson(file.content);
    const runner = parsed.ok && isPlainObject(parsed.value) ? parsed.value.runner : undefined;
    if (file.name === "run-meta.json") {
      if (runner !== "live") return "fake";
      runMetaLive = true;
    } else if (runner !== undefined && runner !== "live") {
      return "fake";
    }
  }
  return runMetaLive ? "live" : "fake";
}

/** The bytes a lineage match compares, or null for a folder that is not a revision's. */
export function lineageKey(files: ReadonlyArray<{ name: string; content: Buffer }>): { runMeta: Buffer; roundOneCritic: Buffer } | null {
  const runMeta = files.find((f) => f.name === "run-meta.json")?.content;
  const roundOneCritic = files.find((f) => f.name === "round-1-06-final-critic.json")?.content;
  return runMeta && roundOneCritic ? { runMeta, roundOneCritic } : null;
}

/** A source only when exactly one non-deleted import matched; otherwise none (absent, or ambiguous). */
export function decideLineage<T extends { id: string }>(matches: readonly T[]): T | null {
  return matches.length === 1 ? matches[0]! : null;
}

/** A recorded path's last segment, for display: an absolute path from the owner's computer shows only its base name. */
export function baseName(path: unknown): string | null {
  if (typeof path !== "string" || !path) return null;
  const segments = path.split(/[\\/]+/).filter(Boolean);
  return segments.length ? segments[segments.length - 1]! : null;
}
