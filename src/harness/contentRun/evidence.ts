/**
 * The facts a run reads, the evidence pack it builds from them, and the
 * fingerprints a later replay, resume or revision uses to prove it rebuilt the
 * same pack. Moved unchanged in behaviour from `scripts/local/content-run.mjs`
 * (Content Studio S1).
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type { ContentRunRuntime } from "./runtime.js";
import type { FactFile, RunFacts, RunReporter } from "./types.js";

/** sha256 of exact file bytes — the same digest the registry records per asset. */
export function sha256OfBytes(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** sha256 of a facts file's bytes, or null when the file does not exist. */
export async function factFingerprint(file: FactFile): Promise<string | null> {
  if (!file.exists()) return null;
  return sha256OfBytes(await file.read());
}

/** A facts file on disk. `displayPath` is what run metadata records for it. */
export function factFileAt(path: string, displayPath: string = path): FactFile {
  return {
    path,
    displayPath,
    exists: () => existsSync(path),
    read: () => readFile(path),
  };
}

type AutomotiveRecord = Record<string, unknown> & { id: unknown; kind: "verified_automotive_fact"; tags: unknown };

/**
 * Parse an operator-supplied automotive facts file.
 *
 * This file is never committed with real content (see .gitignore) and this
 * function never invents a fact: every record must already carry the
 * checkable sourceRef, provenance, and reviewedAt the evidence contract
 * requires. `label` names the file in every refusal — the CLI passes its path.
 */
export function parseAutomotiveFacts(
  bytes: string | Uint8Array,
  { label, now }: { label: string; now: number },
): AutomotiveRecord[] {
  const raw = typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("utf8");
  const parsed = JSON.parse(raw);
  const entries = Array.isArray(parsed) ? parsed : parsed.facts;
  if (!Array.isArray(entries)) {
    throw new Error(`${label} must be a JSON array, or an object with a "facts" array`);
  }
  const nowIso = new Date(now).toISOString();
  const required = ["id", "claim", "subject", "tags", "sourceType", "sourceRef", "provenance", "reviewedAt"];
  return entries.map((entry: any, index: number) => {
    const missing = required.filter((field) => entry[field] === undefined || entry[field] === null);
    if (missing.length) {
      throw new Error(`${label}: entry ${index} (id=${entry.id ?? "?"}) is missing required field(s): ${missing.join(", ")}`);
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
}

/**
 * Load the automotive facts file.
 *
 * A missing file is not an error here — automotive-truth simply refuses to run
 * later, with a clear message — because an operator who has not yet populated
 * it should still be able to inspect strategy-concept. `bytes` is the content
 * read, kept so the caller fingerprints exactly what was parsed.
 */
async function loadAutomotiveFacts(
  file: FactFile,
  now: number,
): Promise<{ records: AutomotiveRecord[]; warning: string | undefined; bytes: Uint8Array | null }> {
  if (!file.exists()) {
    return {
      records: [],
      warning: `no automotive facts file at ${file.path} (copy config/automotive-facts.local.example.json and fill in real, sourced facts)`,
      bytes: null,
    };
  }
  const bytes = await file.read();
  return { records: parseAutomotiveFacts(bytes, { label: file.path, now }), warning: undefined, bytes };
}

/** The path wrapper: the automotive facts file at `path`, loaded exactly as a run loads it. */
export async function loadAutomotiveFactsFile(
  path: string,
  now: number,
): Promise<{ records: AutomotiveRecord[]; warning: string | undefined }> {
  const { records, warning } = await loadAutomotiveFacts(factFileAt(path), now);
  return { records, warning };
}

/**
 * `--scope-tags` as the effective tag list: trimmed, deduplicated and sorted, so
 * the same scope always records and fingerprints identically however it was
 * typed. An empty list is refused rather than read as "no scope". The CLI
 * parses its flag with its own copy of this function, because it must refuse
 * before any compiled module is loaded; the offline suite holds the two equal.
 */
export function normalizeScopeTags(value: unknown): string[] {
  const tags = [...new Set(String(value ?? "").split(",").map((t) => t.trim()).filter(Boolean))].sort();
  if (!tags.length) throw new Error("--scope-tags needs at least one tag (a,b,c); omit the flag for no scope");
  return tags;
}

/**
 * The records every run needs, whatever the scope: the contact-line records
 * (shop name, phone, booking link) and the identity records (makes, service
 * area), in that order. Read from the modules that use them, never retyped here.
 */
export function alwaysIncludedIds(rt: Pick<ContentRunRuntime, "contact" | "identity">): string[] {
  return [...Object.values(rt.contact.CONTACT_FACTS).map((fact) => fact.id), ...rt.identity.IDENTITY_FACT_IDS];
}

export interface EvidenceScope {
  schema: "gcd-evidence-scope/1";
  tags: string[];
  alwaysIncludedIds: string[];
}

/**
 * The effective scope a scoped run records and fingerprints, or null for no
 * scope. Null is today's behaviour exactly: every loaded record.
 */
export function effectiveEvidenceScope(
  rt: Pick<ContentRunRuntime, "contact" | "identity">,
  scopeTags: string[] | undefined,
): EvidenceScope | null {
  if (!scopeTags) return null;
  return { schema: "gcd-evidence-scope/1", tags: [...scopeTags], alwaysIncludedIds: alwaysIncludedIds(rt) };
}

/**
 * The evidence-pack fingerprint: sha256 of the exact projection a stage model
 * is shown. For a scoped run the effective scope is hashed in front of the
 * projection, so two runs that differ only in scope never share a fingerprint
 * and an older CLI that ignores the scope refuses to replay the run. With no
 * scope it is exactly the digest it always was.
 */
export function evidencePackFingerprint(rendered: string, scope: EvidenceScope | null | undefined): string {
  const hash = createHash("sha256");
  if (scope) hash.update(`${JSON.stringify(scope)}\n`, "utf8");
  return hash.update(rendered, "utf8").digest("hex");
}

/** A scope refusal: always before any pack is used or any model is called. */
export class EvidenceScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceScopeError";
  }
}

export interface LoadedRecords {
  approvedFactsBytes: Uint8Array;
  automotiveFactsBytes: Uint8Array | null;
  records: any[];
  warning: string | undefined;
}

/** Load every business and automotive record a run would put in a pack. */
export async function loadRecords(
  rt: Pick<ContentRunRuntime, "approved">,
  { facts, now, reviewedAt }: { facts: RunFacts; now: number; reviewedAt: string },
): Promise<LoadedRecords> {
  const approvedFactsBytes = await facts.approvedFacts.read();
  const { records: businessRecords } = rt.approved.adaptApprovedFactsFile(
    Buffer.from(approvedFactsBytes).toString("utf8"), { reviewedAt, now },
  );
  const { records: automotiveRecords, warning, bytes } = await loadAutomotiveFacts(facts.automotiveFacts, now);
  return {
    approvedFactsBytes, automotiveFactsBytes: bytes, records: [...businessRecords, ...automotiveRecords], warning,
  };
}

export interface RunFingerprints {
  approvedFacts: { path: string; sha256: string };
  automotiveFacts: { path: string; present: boolean; sha256: string | null };
  evidencePackSha256: string;
}

/**
 * Build and validate the evidence pack exactly as a full run does, and return
 * the fingerprints a later replay needs to prove it rebuilt the same pack.
 */
export async function buildRunEvidence(
  rt: ContentRunRuntime,
  args: { goal: string; now: number; reviewedAt: string; runner: string; scopeTags?: string[] | undefined; facts: RunFacts },
  reporter: RunReporter,
): Promise<{ pack: any; scope: EvidenceScope | null; fingerprints: RunFingerprints }> {
  const { goal, now, facts } = args;
  const { approvedFactsBytes, automotiveFactsBytes, records, warning } = await loadRecords(rt, args);
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
    reporter.warn(`warning: ${warning}`);
  }

  // A scope may only narrow what else the pack carries. The records every run
  // needs are always included, so a scoped run refuses here — free, before the
  // cost gate — if any of them was not even loaded.
  const scope = effectiveEvidenceScope(rt, args.scopeTags);
  if (scope) {
    const loaded = new Set(records.map((r) => r.id));
    const missing = scope.alwaysIncludedIds.filter((id) => !loaded.has(id));
    if (missing.length) {
      throw new EvidenceScopeError(
        `the loaded facts have no ${missing.join(", ")} record(s), which every run needs whatever the scope; `
        + "refusing before any paid call",
      );
    }
  }

  const pack = rt.packModule.assertUsableEvidencePack(rt.packModule.buildEvidencePack({
    goal,
    records,
    now,
    ...(scope ? { tags: scope.tags, alwaysIncludeIds: scope.alwaysIncludedIds } : {}),
  }));
  return {
    pack,
    scope,
    fingerprints: {
      approvedFacts: { path: facts.approvedFacts.displayPath, sha256: sha256OfBytes(approvedFactsBytes) },
      automotiveFacts: {
        path: facts.automotiveFacts.displayPath,
        present: automotiveFactsBytes !== null,
        sha256: automotiveFactsBytes === null ? null : sha256OfBytes(automotiveFactsBytes),
      },
      // The exact projection a stage model is shown. It excludes review and
      // creation timestamps, so it is stable for the same facts and the same
      // freshness instant. A scoped run hashes its scope in front of it.
      evidencePackSha256: evidencePackFingerprint(rt.packModule.renderEvidencePackForStage(pack), scope),
    },
  };
}

export interface TagCounts {
  /** Every loaded record. The CLI prints none of their text. */
  records: any[];
  counts: Map<string, number>;
  /** Sorted. */
  tags: string[];
  warning: string | undefined;
  /** With scope tags: how many records that scope would put in the pack. */
  scope?: { tags: string[]; inScope: number; alwaysIncludedLoaded: number; packCap: number };
}

/**
 * `--list-tags` as data: each tag and how many loaded records carry it, and
 * with scope tags the size of that scope, the always-included records counted.
 * Builds no pack and reaches no registry, stage, runner or price.
 */
export async function countTags(
  rt: Pick<ContentRunRuntime, "approved" | "contact" | "identity" | "payloadContract">,
  { facts, now, reviewedAt, scopeTags }: { facts: RunFacts; now: number; reviewedAt: string; scopeTags?: string[] | undefined },
): Promise<TagCounts> {
  const { records, warning } = await loadRecords(rt, { facts, now, reviewedAt });
  const counts = new Map<string, number>();
  for (const record of records) {
    for (const tag of new Set<string>(record.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const tags = [...counts.keys()].sort();
  if (!scopeTags) return { records, counts, tags, warning };
  const always = new Set(alwaysIncludedIds(rt));
  const inScope = records.filter((r) => always.has(r.id) || r.tags.some((t: string) => scopeTags.includes(t)));
  return {
    records, counts, tags, warning,
    scope: {
      tags: scopeTags,
      inScope: inScope.length,
      alwaysIncludedLoaded: [...always].filter((id) => records.some((r) => r.id === id)).length,
      packCap: rt.payloadContract.EVIDENCE_LIMITS.maxProjectedRecords,
    },
  };
}
