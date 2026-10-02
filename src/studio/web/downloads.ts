/**
 * One stored artifact, downloaded (docs/CONTENT_STUDIO_DESIGN.md §8.2 item 8,
 * §9.1). Content Studio S5.
 *
 * - **An attachment, never a page:** `Content-Disposition: attachment` with a
 *   filename that must match the schema's artifact-name shape — so no CR, LF,
 *   quote, semicolon or space can reach the header — a `text/plain` or
 *   `application/json` type, `nosniff`, and a CSP of `default-src 'none';
 *   sandbox`, so no stored model text or imported content is ever rendered as a
 *   document on the Studio's origin.
 * - **The bytes exactly as stored,** and only after their sha256 and length are
 *   re-computed and match the stored row; a mismatch is refused, never served.
 * - **The download's header set is exact** (`downloadHeaders`): the handler
 *   replaces the page headers with it, so each header here is load-bearing.
 */

import { createHash } from "node:crypto";

import { ARTIFACT_NAME_SHAPE, type StoredArtifact } from "./runs.js";

export const DOWNLOAD_CSP = "default-src 'none'; sandbox";

/** A filename refused for the header. Never reached through the route, whose parameter has the same shape. */
export class DownloadNameRefusal extends Error {
  constructor() {
    super("an artifact name outside the schema's shape is never put in a header");
    this.name = "DownloadNameRefusal";
  }
}

/** `attachment; filename="<name>"`, only for a name of the schema's artifact-name shape. */
export function attachmentDisposition(name: string): string {
  if (typeof name !== "string" || !ARTIFACT_NAME_SHAPE.test(name)) throw new DownloadNameRefusal();
  return `attachment; filename="${name}"`;
}

/** JSON artifacts as `application/json`; everything else (`summary.md`, `field-measurements.md`) as plain text. */
export const downloadContentType = (name: string): string =>
  (name.endsWith(".json") ? "application/json" : "text/plain; charset=utf-8");

/** Every header a download carries, and no other. */
export function downloadHeaders(name: string, byteLength: number): Record<string, string> {
  return {
    "content-type": downloadContentType(name),
    "content-disposition": attachmentDisposition(name),
    "content-length": String(byteLength),
    "x-content-type-options": "nosniff",
    "content-security-policy": DOWNLOAD_CSP,
    "cache-control": "no-store",
    "strict-transport-security": "max-age=63072000; includeSubDomains",
    "referrer-policy": "no-referrer",
  };
}

/** The stored bytes, only when their sha256 and length match the stored row. */
export function verifiedBytes(stored: StoredArtifact): Buffer | null {
  const digest = createHash("sha256").update(stored.content).digest("hex");
  return digest === stored.sha256 && stored.content.length === stored.byte_length ? stored.content : null;
}
