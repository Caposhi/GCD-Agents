#!/usr/bin/env node
/**
 * Focused mutation tests for the payload-contract derivations.
 *
 * A regression that cannot fail is decoration. This script proves each
 * load-bearing derivation in `src/harness/agents/payloadContract.ts` (and the
 * nine files that must agree with it) is actually load-bearing: it applies one
 * focused mutation in a disposable no-Git copy, rebuilds there, runs the Content Intelligence offline suite, and
 * requires the NAMED check that owns that derivation to fail. Then it restores
 * the file byte-for-byte — verified by SHA-256 against the bytes captured
 * before the mutation — rebuilds, and requires the suite to pass again.
 *
 * The rebuild is skipped only where it cannot matter: `dist/` is compiled from
 * `src/` alone, and the suite reads `state/**` at RUNTIME, so a mutation to a
 * SQL file needs no compile. It still rebuilds when the PREVIOUS mutation
 * touched `src/`, because that mutation's restore left `dist/` compiled from
 * mutated sources. Nothing else changes: every mutation still runs the whole
 * suite, and a `src/` mutation that fails to compile is still not a pass.
 *
 * The final group is not a derivation but an epistemic invariant: migration
 * 007's live application state is UNKNOWN in either direction, and neither the
 * migration nor its rollback script may declare it. Those mutations insert
 * positive and negative declarations in the present, perfect, past, bare past
 * (`ran`, `never ran`) and emphatic (`did run`, `did not run`) forms, with and
 * without the word `production`, in plain and contextual-`It` shapes; masking
 * forms that place a declaration beside the required UNKNOWN sentence across a
 * semicolon, a comma-conjunction, a newline, reported speech and an adjacent
 * sentence; laundering forms that put an unrelated introductory clause in front
 * of the assertion, closed by a comma, an em dash, a semicolon or nothing at
 * all; and MULTI-PROPOSITION forms that pair a genuinely authorized proposition
 * with a categorical sibling in the same clause, joined by `and`, `but`, a
 * conditional, a parenthetical, a newline, an em dash or a semicolon, in either
 * order and in contextual-`It` shape. Each requires CC5 to report the failure BY
 * NAME. The multi-proposition group is load-bearing only because CC5 enumerates
 * EVERY predicate: with an earliest-predicate-only check SIXTEEN of those
 * twenty-four mutations — eight of the twelve classes — pass unnoticed, measured
 * by restoring that behaviour and re-running them. The other four classes are
 * still caught by another part of the check, so the group is load-bearing
 * without being uniquely so.
 *
 * A later group (M118-M163) covers the token/proposition analysis that replaced
 * the clause-splitting form: finite occurrence claims whose procedural manner or
 * `re-` prefix follows the verb (`was applied by hand`, `has been re-applied`);
 * predicates whose auxiliary is separated from its participle by a
 * comma-delimited aside, a parenthetical, a long adverbial run or a degree
 * modifier; copular predicates with intervening adverbs; participial adjuncts
 * whose contextual antecedent IS 007; and combinations pairing any of these with
 * a genuinely governed proposition in the same sentence. Seventeen of those
 * twenty-three classes bypassed CC5 at the reviewed head c189d2b; the other six
 * were already caught there and are carried for coverage, not as new bypasses.
 *
 * A third group (M174-M209) covers the balanced-aside and coordination rules:
 * an outer finite frame split by a SUBORDINATE aside that carries its own verb
 * ("has, after the report was signed, been applied"), in comma and parenthetical
 * shapes, in perfect, past and present frames, positive and negative, with
 * explicit `Migration 007` and contextual `It` subjects, with several words
 * between the auxiliary and the participle, and with a conditional hidden inside
 * the aside that must not qualify the outer claim; plus categorical siblings
 * placed beside a genuinely governed COORDINATED proposition, joined by an
 * adversative, by a coordinator introducing a new subject, and by a sentence
 * boundary in either order.
 *
 * A fourth group (M210-M257) covers natural subordinate asides and instructional
 * wording: outer finite frames split by an aside a single-token opener list does
 * not reach -- two-token openers ("even though", "now that", "provided that"),
 * two CONSECUTIVE asides, a NESTED aside, negative and contextual-`It` shapes,
 * and openers on no list at all ("seeing as", "considering") that only
 * fail-closed finite-frame recovery catches; a new subject after a serial comma;
 * an unrelated aside following a governed proposition; an emphatic `did run`
 * hidden behind an imperative clause; and, in the other direction, serial
 * coordinated lists, a coordinated predicate carrying its own parenthetical, a
 * governed proposition with several internal qualifiers, a modal frame split by
 * an aside, and instructional imperatives. All twelve forms an independent
 * review reported were misclassified at 3f173d5 on BOTH SQL files.
 *
 * A fifth group (M242-M247, M264-M267) covers NESTED PARENTHESES. Pairing an
 * opening parenthesis with the first later ")" recorded an inner close as the
 * outer one and left the real outer close unmatched, so "has (according to the
 * operator (per the audit)) been applied" read as a bare participle and passed.
 * Pairing is depth-aware now, and the two allowed cases -- a governed
 * proposition and a modal frame, each carrying nested parentheses -- depend on
 * that pairing alone. These prohibited BALANCED cases are rejected for their
 * categorical content.
 *
 * A sixth group covers the UNMATCHED CLOSING PARENTHESIS. Depth-aware pairing
 * had been paired with a fail-OPEN: recovery was taught to CROSS an unmatched
 * ")", so "has, according to the operator) been applied" skipped the stray
 * close, halted at the noun before it, never recovered the outer `has`, and
 * passed with the suite exiting 0. An unmatched close is malformed prose, so
 * CC5 now fails STRUCTURALLY on a ")" at depth zero before any predicate is
 * classified, and the recovery-through-unmatched-close behaviour is REMOVED.
 * Which guard is load-bearing for which case was MEASURED, not assumed. With
 * the structural failure disabled and the rest intact, the comma-opened forms
 * are still rejected, because fail-closed COMMA recovery jumps to the comma
 * before the stray ")" and recovers the outer auxiliary; they are retained as
 * coverage, not claimed as proof. The NO-COMMA forms escape -- comma recovery
 * has nothing to jump to -- so those are the classes the structural failure
 * uniquely protects, and they are this correction's load-bearing evidence.
 *
 * PAYLOAD NEWLINE ESCAPES, corrected in this round. 152 payloads (M106-M107,
 * M118-M267) carried "\\n" -- a literal backslash and an 'n' -- instead of
 * "\n". They wrote that literal into the SQL file, so each produced ONE
 * physical comment line rather than two, left \n-- embedded in the analysed
 * prose as stray tokens, and NEVER exercised the multi-line comment path,
 * including the hard-wrap reassembly in sqlComments(). M106-M107 were the
 * worst case: they are NAMED for a newline between the governed proposition
 * and the categorical one, and delivered no newline at all.
 *
 * All 152 now use real newlines. M106-M107 needed a DIFFERENT repair: their
 * escape sits mid-sentence, so a bare \n would have written a line with no
 * '--' prefix -- non-comment text injected into executable SQL, and invisible
 * to sqlComments() -- so they take '\n-- ' and both propositions stay comment
 * lines. Two other newline-claiming mutations already used real newlines and
 * were left alone. Every corrected payload was re-run and compared
 * mutation-by-mutation against the pre-correction log.
 *
 * The historical `mustPass` prose cases are no longer treated as authority.
 * Whole-file identity makes every uncoordinated byte change prohibited. Two
 * dedicated positive cases update the changed artifact digest and the separate
 * manifest source pin together, proving legitimate reviewed evolution remains
 * possible without an English allowlist.
 *
 * It is offline and deterministic: no network, no database, no provider, no
 * credential. The authoritative checkout is read-only after a disposable copy
 * is prepared. Catchable signals clean that copy when possible; SIGKILL may
 * strand the disposable directory, but cannot dirty the authoritative checkout.
 *
 * Run: npm run test:payload-mutation
 */

import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const AUTHORITATIVE_REPO_ROOT = resolve(dirname(SCRIPT_PATH), "../..");
let REPO_ROOT = AUTHORITATIVE_REPO_ROOT;

const PAYLOAD = "src/harness/agents/payloadContract.ts";
const MIGRATION = "state/migrations/007_evidence_bounds.sql";
const PACKAGING = "src/harness/agents/packagingAdaptation.ts";
const FINAL_CRITIC = "src/harness/agents/finalCritic.ts";
const MODEL_POLICY = "src/harness/agents/modelPolicy.ts";
const EVIDENCE_CONTRACT = "src/harness/evidence/contract.ts";
const EVIDENCE_PACK = "src/harness/evidence/pack.ts";
const STAGE_EXECUTION = "src/harness/agents/stageExecution.ts";
const SDK = "src/harness/sdk.ts";
const ROLLBACK = "state/rollback/007_evidence_bounds_rollback.sql";
// The CC5-SYNTAX-001 closure's authority manifest. Data, not code: it is read
// at runtime from `src/`, so mutating it needs no rebuild.
const SQL_AUTHORITY = "src/harness/sqlAuthority.json";
const SQL_AUTHORITY_SOURCE = "src/harness/sqlAuthority.ts";

/**
 * Each mutation names the derivation it breaks, the single edit that breaks it,
 * and the check prefix that must report the break. `expect` is a prefix rather
 * than a whole line so a wording change to a check does not silently turn a
 * mutation test into a no-op — the id is the stable part.
 */
const LEGACY_MUTATION_DEFINITIONS = [
  {
    // Not the constant itself — a change there is a type error, because the
    // regressions compare against its literal type. The derivation's USE of it
    // is the load-bearing part: drop the factor and every ceiling loses the
    // allowance escaping needs, so real maximal outputs stop fitting and the
    // transport ceiling collapses onto the ordinary-character one.
    name: "the escape factor stops being applied when a ceiling is derived",
    file: PAYLOAD,
    from: "  expansion: number = MAX_JSON_ESCAPE_EXPANSION,",
    to: "  expansion: number = 1,",
    expect: ["CC11.", "CC13.", "BX23."],
  },
  {
    name: "a producer's ceiling loses one of its three id channels",
    file: PAYLOAD,
    from: "export const STRATEGY_ID_CHANNELS = 3;",
    to: "export const STRATEGY_ID_CHANNELS = 2;",
    // The transport ceiling still covers it — the escape factor leaves that
    // much headroom for ASCII ids — but the ordinary-character ceiling, which
    // the token budget is derived from, does not. CC12 is the check that owns
    // that side, and it is the one that must speak.
    expect: ["CC12."],
  },
  {
    name: "an evidence bound diverges from the migration that enforces it",
    file: PAYLOAD,
    from: "  claimChars: 1_000,",
    to: "  claimChars: 1_200,",
    expect: ["CC1."],
  },
  {
    name: "the migration diverges from the TypeScript bound it mirrors",
    file: MIGRATION,
    from: "    CHECK (length(claim) <= 1000 AND octet_length(claim) <= 1000),",
    to: "    CHECK (length(claim) <= 1200 AND octet_length(claim) <= 1200),",
    expect: ["CC1."],
  },
  {
    // The first draft of this migration wrote the per-tag bound as
    // `NOT EXISTS (SELECT 1 FROM unnest(tags) ...)`. PostgreSQL rejects a
    // subquery inside a CHECK, so it failed at apply time in the PostgreSQL
    // job rather than offline. CC2 now refuses the shape outright, so the
    // same mistake is caught without a database.
    name: "the per-tag bound is written as a subquery a CHECK cannot contain",
    file: MIGRATION,
    from: "      AND gcd_content_evidence_tags_within_v007(tags, 60)",
    to: "      AND NOT EXISTS (SELECT 1 FROM unnest(tags) AS t WHERE length(t) > 60)",
    expect: ["CC2."],
  },
  {
    name: "the worst-case tokens-per-byte ceiling is loosened below the lossless bound",
    file: PAYLOAD,
    from: "export const MAX_TOKENS_PER_UTF8_BYTE = 1;",
    to: "export const MAX_TOKENS_PER_UTF8_BYTE = 0.1;",
    expect: ["CC18.", "CC22."],
  },
  {
    name: "a token budget is hand-chosen again instead of derived",
    file: MODEL_POLICY,
    from: '  "reasoning-standard": POLICY_OUTPUT_TOKEN_FLOORS["reasoning-standard"]!,',
    to: '  "reasoning-standard": 3_000,',
    expect: ["CC19.", "CC21."],
  },
  {
    name: "a consumer's guard is raised above its producer's ceiling",
    file: FINAL_CRITIC,
    from: "  packagingOutputChars: PACKAGING_OUTPUT_SERIALIZED_CEILING,",
    to: "  packagingOutputChars: PACKAGING_OUTPUT_SERIALIZED_CEILING + 1,",
    expect: ["CC13.", "BX22.", "BX23."],
  },
  {
    name: "the pipeline caption cap stops narrowing the provider limit",
    file: PACKAGING,
    from: "    const captionMax = Math.min(policy.captionMax, PACKAGING_LIMITS.pipelineCaptionChars);",
    to: "    const captionMax = policy.captionMax;",
    expect: ["BX18."],
  },
  {
    name: "the pack builder stops enforcing maxProjectedRecords",
    file: EVIDENCE_PACK,
    from: "  if (scoped.length > EVIDENCE_LIMITS.maxProjectedRecords) {",
    to: "  if (false && scoped.length > EVIDENCE_LIMITS.maxProjectedRecords) {",
    expect: ["CC32."],
  },
  {
    name: "the consumer boundary stops enforcing maxProjectedConflicts",
    file: EVIDENCE_PACK,
    from: "  if (pack.conflicts.length > EVIDENCE_LIMITS.maxProjectedConflicts) {",
    to: "  if (false && pack.conflicts.length > EVIDENCE_LIMITS.maxProjectedConflicts) {",
    expect: ["CC31."],
  },
  {
    name: "detail validation falls back to compact JavaScript JSON length",
    file: EVIDENCE_CONTRACT,
    from: "      const canonicalUpperBound = postgresJsonbTextUpperBoundBytes(record.detail);",
    to: "      const canonicalUpperBound = JSON.stringify(record.detail).length;",
    expect: ["CC29."],
  },
  {
    name: "the TypeScript relation-note validator exceeds its owning bound",
    file: EVIDENCE_CONTRACT,
    from: "    boundedText(relation.note, \"note\", EVIDENCE_LIMITS.relationNoteChars, push);",
    to: "    boundedText(relation.note, \"note\", EVIDENCE_LIMITS.relationNoteChars + 1, push);",
    expect: ["CC30."],
  },
  {
    name: "bounded output text stops enforcing its UTF-8 byte allowance",
    file: PAYLOAD,
    from: "  return value.length <= max && utf8ByteLength(value) <= max && isSerializableText(value);",
    to: "  return value.length <= max && isSerializableText(value);",
    expect: ["CC33."],
  },
  {
    name: "the PostgreSQL tag helper accepts NULL elements",
    file: MIGRATION,
    from: "    t IS NOT NULL AND length(t) <= max_len AND octet_length(t) <= max_len",
    to: "    (t IS NULL OR length(t) <= max_len) AND octet_length(coalesce(t, '')) <= max_len",
    expect: ["CC35."],
  },
  {
    name: "migration 007 regains overwrite authority over a pre-existing helper",
    file: MIGRATION,
    from: "CREATE FUNCTION gcd_content_evidence_tags_within_v007(tags text[], max_len integer)",
    to: "CREATE OR REPLACE FUNCTION gcd_content_evidence_tags_within_v007(tags text[], max_len integer)",
    expect: ["CC4.", "CC34."],
  },
  {
    name: "the structured stage request regains adaptive thinking inside the visible output ceiling",
    file: STAGE_EXECUTION,
    from: "      thinking: resolved.thinking,",
    to: '      thinking: { type: "adaptive" } as never,',
    expect: ["CC36."],
  },
  {
    name: "the JSONB numeric upper bound loses the sign byte for -5e-324",
    file: EVIDENCE_CONTRACT,
    from: '  if (typeof value === "number") return 327;',
    to: '  if (typeof value === "number") return 326;',
    expect: ["CC37."],
  },
  {
    name: "the pack builder stops validating its input evidence records",
    file: EVIDENCE_PACK,
    from: "  for (const record of input.records) assertValidEvidenceRecord(record);",
    to: "  for (const record of input.records) if (false) assertValidEvidenceRecord(record);",
    expect: ["CC38."],
  },
  {
    // The semantic validator is the whole of findings 1 and 2. If the shared
    // executor boundary stops calling it, a hand-built pack that promotes a
    // hypothesis into `allowedFacts` reaches a model again — which is exactly
    // the state this branch was reviewed in.
    name: "the shared executor boundary stops validating pack semantics",
    file: STAGE_EXECUTION,
    // Removed rather than swapped for the weaker bounds-only assert: that
    // symbol is no longer imported here, so a swap would be a type error and
    // the mutation would prove nothing about the runtime.
    from: "  assertUsableEvidencePack(pack);",
    to: "",
    // Only the cases this boundary alone catches. Removing it does NOT reopen
    // the hypothesis- and stale-promotion cases, because `unusableEvidenceIds`
    // and the pack renderer call the same validator on the same synchronous
    // path — defense in depth working as intended, recorded here rather than
    // papered over with a wider expectation that would quietly stop meaning
    // anything.
    expect: ["CC56.", "CC67."],
  },
  {
    // Section membership without a kind rule is how a valid hypothesis became
    // a citable fact: every field validated, every bound respected, wrong
    // section. Widening one section's permitted kinds is the smallest edit
    // that reopens it.
    name: "a section stops constraining which evidence kinds it may hold",
    file: EVIDENCE_PACK,
    from: "  allowedFacts: new Set([\"verified_automotive_fact\", \"verified_business_fact\"]),",
    to: "  allowedFacts: new Set(EVIDENCE_KINDS),",
    expect: ["CC48."],
  },
  {
    // Freshness anchored at builtAt is the documented decision. Removing the
    // citability check leaves a lapsed fact citable.
    name: "allowedFacts stops being checked for citability at builtAt",
    file: EVIDENCE_PACK,
    from: "    if (!isCitableAsFact(record, builtAt)) {",
    to: "    if (false && !isCitableAsFact(record, builtAt)) {",
    expect: ["CC49."],
  },
  {
    // The conflict projection was cardinality-only. Dropping the per-field
    // bound restores the 50,000-character subject the reviewer found.
    name: "conflict fields stop being bounded, leaving only the cardinality check",
    file: EVIDENCE_PACK,
    from: '    boundedField(conflict.subject, "subject", EVIDENCE_LIMITS.subjectChars, true);',
    to: "",
    expect: ["CC55.", "CC56."],
  },
  {
    name: "counts stop being compared against the sections they describe",
    file: EVIDENCE_PACK,
    from: "      if (value !== expected) {",
    to: "      if (false && value !== expected) {",
    expect: ["CC62."],
  },
  {
    // Finding 3. The SDK default is two retries, so removing the explicit
    // zero silently restores up to three wire requests behind a documented
    // one-request guarantee.
    name: "stage requests stop disabling SDK retries, restoring the default of two",
    file: SDK,
    from: "    maxRetries: STAGE_REQUEST_MAX_RETRIES,",
    // The SDK's own default, written literally. `undefined` would not compile
    // now that `StageRequestOptions.maxRetries` is `number` rather than
    // `number | undefined`, and a mutation that fails to build proves nothing.
    to: "    maxRetries: 2,",
    expect: ["CC39."],
  },
  {
    name: "the stage stream deadline is pinned to the old 90-second value instead of derived",
    file: PAYLOAD,
    from: "export function stageStreamDeadlineMs(maxOutputTokens: number): number {",
    to: "export function stageStreamDeadlineMs(maxOutputTokens: number): number {\n  if (maxOutputTokens > 0) return 90_000;",
    expect: ["CC41.", "CC42."],
  },
  {
    // Finding 2. The SDK's `timeout` bounds the fetch only — for a streaming
    // request it is cleared once headers arrive. Removing the abort leaves a
    // stalled stream with nothing at all to stop it, which is the state this
    // branch was reviewed in.
    name: "the total stream deadline stops aborting a stalled stream",
    file: SDK,
    from: "    deadlineExpired = true;\n    stream.abort();",
    to: "    deadlineExpired = true;",
    expect: ["CC45."],
  },
  {
    name: "the deadline timer is never cleared, leaking a timer past every stage call",
    file: SDK,
    from: "    timers.clearTimeout(handle);",
    to: "    void handle;",
    expect: ["CC44."],
  },
  {
    name: "the request-setup timeout is conflated with the total stream deadline",
    file: SDK,
    from: "    requestSetupTimeoutMs: STAGE_REQUEST_SETUP_TIMEOUT_MS,",
    to: "    requestSetupTimeoutMs: stageStreamDeadlineMs(maxOutputTokens),",
    expect: ["CC41."],
  },
  {
    // Finding 1. The semantic validator is where both conflict-pack defects
    // lived. Reverting the endpoint rule to the pre-correction form — which
    // demanded only that an endpoint exist somewhere — reopens the case a
    // conflicted record left citable in a usable section.
    name: "a conflict endpoint may live in any section again, not conflictedEvidence",
    file: EVIDENCE_PACK,
    from: '      if (home !== "conflictedEvidence") {',
    to: "      if (false) {",
    expect: ["CC61."],
  },
  {
    // The snapshot rule. Without it a hand-built pack can show a model claim
    // text no record in the pack ever made.
    name: "conflict claim and subject snapshots stop being compared to their records",
    file: EVIDENCE_PACK,
    // Compared to itself rather than short-circuited: `false &&` would stop
    // narrowing `recordA` for the body and the tree would not compile.
    from: "    if (recordA && conflict.aClaim !== recordA.claim) {",
    to: "    if (recordA && conflict.aClaim !== conflict.aClaim) {",
    expect: ["CC76."],
  },
  {
    name: "conflict fields lose their UTF-8 byte allowance, keeping only code units",
    file: EVIDENCE_PACK,
    from: '      if (utf8ByteLength(value) > max) push(`${at}.${field} exceeds ${max} UTF-8 bytes`);',
    to: "",
    expect: ["CC80.", "CC81."],
  },
  {
    // The builder half of finding 1: routing conflicted records back to their
    // ordinary sections is exactly what made legitimate packs invalid.
    name: "the builder stops routing conflicted records into conflictedEvidence",
    file: EVIDENCE_PACK,
    from: "    if (conflicted.has(record.id)) {\n      conflictedEvidence.push(record);\n      continue;\n    }",
    to: "",
    expect: ["CC70.", "CC73."],
  },
  // --- CC5: migration 007's applied state is UNKNOWN in either direction ------
  //
  // These two files are authoritative repository inputs. Neither may declare
  // whether 007 is applied to production, because no production database has
  // been inspected since 2026-08-28 and neither direction is established. CC5
  // enforces the claim CLASS, not a fixed sentence, so each mutation below
  // inserts a different declarative form and requires CC5 to catch it. The
  // positive forms are the ones an earlier CC5 missed: it forbade the negative
  // wording and `is applied`, so `has been applied` and `was applied` passed.
  //
  // Every insertion leaves the required UNKNOWN sentence in place, so these
  // prove CC5 rejects a declaration even when the epistemic statement is still
  // present — not merely that it requires the epistemic statement.
  {
    name: "the migration comment declares 007 applied, in the perfect (`has been applied`)",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Migration 007 has been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007 applied, in the past (`was applied`)",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- It was applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007 applied, in the present (`is applied`)",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Migration 007 is already applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment reinstates the unsupported negative declaration",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- It has not been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007 applied, in the perfect (`has been applied`)",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Migration 007 has been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment reinstates the unsupported negative declaration",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Not applied to production.",
    expect: ["CC5."],
  },

  // --- CC5 adversarial coverage: every masking and omission class ------------
  //
  // These are the bypasses an independent inspection demonstrated against an
  // earlier CC5, which required the word "production" near the predicate and
  // accepted any qualifier word anywhere in a period-delimited sentence. Each
  // one is now a standing regression, run against BOTH files, and each leaves
  // the canonical UNKNOWN sentence in place — so they prove CC5 rejects a
  // declaration even when the required epistemic statement is still present,
  // not merely that it demands that statement.
  {
    name: "the migration comment declares 007's application state — negative `remains unapplied`, with no mention of production",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Migration 007 remains unapplied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — negative `remains unapplied`, with no mention of production",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Migration 007 remains unapplied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — negative `has never been applied`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Migration 007 has never been applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — negative `has never been applied`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Migration 007 has never been applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — negative `is not yet applied`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Migration 007 is not yet applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — negative `is not yet applied`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Migration 007 is not yet applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — contextual `It ...` negative form, subject carried from context",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- It remains unapplied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — contextual `It ...` negative form, subject carried from context",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- It remains unapplied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — positive declaration that never says `production`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — positive declaration that never says `production`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — semicolon masking: assertion, then a verification instruction",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Migration 007 is applied to production; verify before acting.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — semicolon masking: assertion, then a verification instruction",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Migration 007 is applied to production; verify before acting.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — comma/conjunction masking: assertion, then an UNKNOWN clause",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Migration 007 is applied, but its status is UNKNOWN.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — comma/conjunction masking: assertion, then an UNKNOWN clause",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Migration 007 is applied, but its status is UNKNOWN.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — newline masking: assertion, line break, then a verification instruction",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Migration 007 is applied to production.\n-- Verify read-only before acting.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — newline masking: assertion, line break, then a verification instruction",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Migration 007 is applied to production.\n-- Verify read-only before acting.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — reported speech: `We observed ... is applied`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- We observed migration 007 is applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — reported speech: `We observed ... is applied`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- We observed migration 007 is applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — a categorical declaration sitting directly beside the required UNKNOWN sentence",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Migration 007 is applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — a categorical declaration sitting directly beside the required UNKNOWN sentence",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Migration 007 is applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — introductory subordinate clause in front of a positive declaration",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Before we verify, migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — introductory subordinate clause in front of a positive declaration",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Before we verify, migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — introductory conditional clause in front of a positive declaration",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- If this note is read, migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — introductory conditional clause in front of a positive declaration",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- If this note is read, migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — introductory adverbial in front of a positive declaration",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Once more, migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — introductory adverbial in front of a positive declaration",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Once more, migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — introductory subordinate clause in front of a contextual `It` declaration",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Before we verify, it is applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — introductory subordinate clause in front of a contextual `It` declaration",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Before we verify, it is applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — comma-less introductory frame in front of a positive declaration",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- When in doubt migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — comma-less introductory frame in front of a positive declaration",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- When in doubt migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — introductory clause closed by an em dash rather than a comma",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Before we verify — migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — introductory clause closed by an em dash rather than a comma",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Before we verify — migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — introductory clause closed by a semicolon, followed by a bare past declaration",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- If this note is read; migration 007 ran in production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — introductory clause closed by a semicolon, followed by a bare past declaration",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- If this note is read; migration 007 ran in production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — a subordinator-shaped opener that governs nothing, then an emphatic declaration",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Whether or not you check, migration 007 did run in production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — a subordinator-shaped opener that governs nothing, then an emphatic declaration",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Whether or not you check, migration 007 did run in production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — bare past positive — `ran`, no auxiliary at all",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Migration 007 ran in production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — bare past positive — `ran`, no auxiliary at all",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Migration 007 ran in production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — bare past negative — `never ran`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Migration 007 never ran in production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — bare past negative — `never ran`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Migration 007 never ran in production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — emphatic positive — `did run`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Migration 007 did run in production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — emphatic positive — `did run`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Migration 007 did run in production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — emphatic negative — `did not run`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Migration 007 did not run in production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — emphatic negative — `did not run`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Migration 007 did not run in production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — contextual `It` bare past — `It ran`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- It ran in production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — contextual `It` bare past — `It ran`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- It ran in production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007's application state — contextual `It` emphatic negative — `It did not run`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- It did not run in production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007's application state — contextual `It` emphatic negative — `It did not run`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- It did not run in production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment masks a categorical assertion behind a governed proposition — authorized UNKNOWN proposition, then a categorical assertion joined by `and`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Whether migration 007 is applied is UNKNOWN and migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment masks a categorical assertion behind a governed proposition — authorized UNKNOWN proposition, then a categorical assertion joined by `and`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Whether migration 007 is applied is UNKNOWN and migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment masks a categorical assertion behind a governed proposition — authorized UNKNOWN proposition, then a categorical assertion joined by `but`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Whether it has been applied is UNKNOWN but it has been applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment masks a categorical assertion behind a governed proposition — authorized UNKNOWN proposition, then a categorical assertion joined by `but`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Whether it has been applied is UNKNOWN but it has been applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment masks a categorical assertion behind a governed proposition — conditional proposition, then a categorical assertion",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- If migration 007 has been applied then operators must stop and migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment masks a categorical assertion behind a governed proposition — conditional proposition, then a categorical assertion",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- If migration 007 has been applied then operators must stop and migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment masks a categorical assertion behind a governed proposition — parenthetical qualification, then a categorical assertion",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Whether migration 007 is applied is UNKNOWN (pending verification) and it is applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment masks a categorical assertion behind a governed proposition — parenthetical qualification, then a categorical assertion",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Whether migration 007 is applied is UNKNOWN (pending verification) and it is applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment masks a categorical assertion behind a governed proposition — categorical assertion FIRST, authorized UNKNOWN proposition second",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Migration 007 is applied and whether it is applied is UNKNOWN.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment masks a categorical assertion behind a governed proposition — categorical assertion FIRST, authorized UNKNOWN proposition second",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Migration 007 is applied and whether it is applied is UNKNOWN.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment masks a categorical assertion behind a governed proposition — two categorical predicates in one clause, positive then negative",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Migration 007 is applied and it has never been applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment masks a categorical assertion behind a governed proposition — two categorical predicates in one clause, positive then negative",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Migration 007 is applied and it has never been applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment masks a categorical assertion behind a governed proposition — contextual `It` sibling — UNKNOWN, then `but it has been applied`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Whether it is applied is UNKNOWN but it has been applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment masks a categorical assertion behind a governed proposition — contextual `It` sibling — UNKNOWN, then `but it has been applied`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Whether it is applied is UNKNOWN but it has been applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment masks a categorical assertion behind a governed proposition — contextual `It` sibling — UNKNOWN, then `and it did not run`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Whether migration 007 is applied is UNKNOWN and it did not run in production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment masks a categorical assertion behind a governed proposition — contextual `It` sibling — UNKNOWN, then `and it did not run`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Whether migration 007 is applied is UNKNOWN and it did not run in production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment masks a categorical assertion behind a governed proposition — bare-past sibling — UNKNOWN over `ran`, then a categorical `ran`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Whether it ran is UNKNOWN and it ran in production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment masks a categorical assertion behind a governed proposition — bare-past sibling — UNKNOWN over `ran`, then a categorical `ran`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Whether it ran is UNKNOWN and it ran in production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment masks a categorical assertion behind a governed proposition — newline between the governed proposition and the categorical one",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Whether it has been applied is UNKNOWN\n-- and migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment masks a categorical assertion behind a governed proposition — newline between the governed proposition and the categorical one",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Whether it has been applied is UNKNOWN\n-- and migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment masks a categorical assertion behind a governed proposition — em dash between the governed proposition and the categorical one",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Whether it is applied is UNKNOWN — migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment masks a categorical assertion behind a governed proposition — em dash between the governed proposition and the categorical one",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Whether it is applied is UNKNOWN — migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment masks a categorical assertion behind a governed proposition — semicolon between the governed proposition and the categorical one",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Whether it is applied is UNKNOWN; migration 007 ran in production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment masks a categorical assertion behind a governed proposition — semicolon between the governed proposition and the categorical one",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Whether it is applied is UNKNOWN; migration 007 ran in production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment carries authorized wording — the epistemic form over the bare past — `whether ... ran ... is UNKNOWN`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Whether migration 007 ran in production is UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording — the epistemic form over the bare past — `whether ... ran ... is UNKNOWN`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Whether migration 007 ran in production is UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment carries authorized wording — the explicitly dated 2026-08-28 observation of 001-006, as history only",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- As observed on 2026-08-28, only migrations 001-006 were applied to production.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording — the explicitly dated 2026-08-28 observation of 001-006, as history only",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- As observed on 2026-08-28, only migrations 001-006 were applied to production.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment carries authorized wording — the not-established form requiring read-only verification",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Whether it was applied is not established and requires read-only verification.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording — the not-established form requiring read-only verification",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Whether it was applied is not established and requires read-only verification.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment declares 007 applied in a FINITE past frame whose procedural manner follows the verb \u2014 `was applied by hand`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 was applied by hand to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007 applied in a FINITE past frame whose procedural manner follows the verb \u2014 `was applied by hand`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 was applied by hand to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007 applied in a FINITE perfect frame whose procedural manner follows the verb \u2014 `has been applied by hand`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has been applied by hand to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007 applied in a FINITE perfect frame whose procedural manner follows the verb \u2014 `has been applied by hand`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has been applied by hand to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007 applied in a FINITE past frame, contextual `It`, procedural manner after the verb",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- It was applied by hand after the 2026-08-28 reading.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007 applied in a FINITE past frame, contextual `It`, procedural manner after the verb",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- It was applied by hand after the 2026-08-28 reading.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007 applied in a FINITE past frame behind a `re-` prefix \u2014 `was re-applied`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 was re-applied to production after rollback.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007 applied in a FINITE past frame behind a `re-` prefix \u2014 `was re-applied`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 was re-applied to production after rollback.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007 applied in a FINITE perfect frame behind a `re-` prefix \u2014 `has been re-applied`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has been re-applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007 applied in a FINITE perfect frame behind a `re-` prefix \u2014 `has been re-applied`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has been re-applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares 007 applied in a FINITE past frame combining both procedural forms \u2014 `was re-applied by hand`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- It was re-applied by hand after the rollback.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares 007 applied in a FINITE past frame combining both procedural forms \u2014 `was re-applied by hand`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- It was re-applied by hand after the rollback.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment separates the auxiliary from its participle with a comma-delimited aside \u2014 `has, according to the operator, been applied`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has, according to the operator, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment separates the auxiliary from its participle with a comma-delimited aside \u2014 `has, according to the operator, been applied`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has, according to the operator, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment separates the auxiliary from its participle with a comma-delimited aside, contextual `It`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- It has, per the 2026-09-02 audit, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment separates the auxiliary from its participle with a comma-delimited aside, contextual `It`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- It has, per the 2026-09-02 audit, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment separates a past auxiliary from its participle with a one-word comma-delimited aside",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 was, regrettably, applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment separates a past auxiliary from its participle with a one-word comma-delimited aside",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 was, regrettably, applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment separates the auxiliary from its participle with a PARENTHETICAL aside \u2014 `has (according to the operator) been applied`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has (according to the operator) been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment separates the auxiliary from its participle with a PARENTHETICAL aside \u2014 `has (according to the operator) been applied`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has (according to the operator) been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment separates a past auxiliary from its participle with a PARENTHETICAL aside",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 was (per the audit) applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment separates a past auxiliary from its participle with a PARENTHETICAL aside",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 was (per the audit) applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment separates the auxiliary from its participle with a long run of adverbs \u2014 beyond any fixed lookup window",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has definitely and indisputably already been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment separates the auxiliary from its participle with a long run of adverbs \u2014 beyond any fixed lookup window",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has definitely and indisputably already been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment separates the auxiliary from its participle with a long adverbial run carrying degree modifiers, contextual `It`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- It has quite deliberately and quite unambiguously already been applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment separates the auxiliary from its participle with a long adverbial run carrying degree modifiers, contextual `It`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- It has quite deliberately and quite unambiguously already been applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment separates a copula from its participle with comma-separated adverbs \u2014 `is absolutely, unequivocally applied`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 is absolutely, unequivocally applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment separates a copula from its participle with comma-separated adverbs \u2014 `is absolutely, unequivocally applied`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 is absolutely, unequivocally applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment separates a copula from its participle with a comma-delimited aside, contextual `It`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- It is, without question, applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment separates a copula from its participle with a comma-delimited aside, contextual `It`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- It is, without question, applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment separates `remains` from its participle with a comma-delimited aside",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 remains, as of today, applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment separates `remains` from its participle with a comma-delimited aside",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 remains, as of today, applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment asserts application in a comma-delimited participial adjunct whose antecedent IS 007",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007, applied to production, bounds every evidence row.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment asserts application in a comma-delimited participial adjunct whose antecedent IS 007",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007, applied to production, bounds every evidence row.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment asserts application in a PARENTHETICAL participial adjunct whose antecedent IS 007",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 (applied to production) bounds every evidence row.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment asserts application in a PARENTHETICAL participial adjunct whose antecedent IS 007",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 (applied to production) bounds every evidence row.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment pairs a governed UNKNOWN proposition with a categorical FINITE procedural sibling",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Whether migration 007 is applied is UNKNOWN and migration 007 was applied by hand.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment pairs a governed UNKNOWN proposition with a categorical FINITE procedural sibling",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Whether migration 007 is applied is UNKNOWN and migration 007 was applied by hand.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment pairs a categorical FINITE procedural proposition FIRST with a governed UNKNOWN sibling second",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has been applied by hand and whether it ran is UNKNOWN.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment pairs a categorical FINITE procedural proposition FIRST with a governed UNKNOWN sibling second",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has been applied by hand and whether it ran is UNKNOWN.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment pairs a governed UNKNOWN proposition with a categorical sibling whose auxiliary is interrupted by an aside",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Whether it ran is UNKNOWN and it has, per the audit, been applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment pairs a governed UNKNOWN proposition with a categorical sibling whose auxiliary is interrupted by an aside",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Whether it ran is UNKNOWN and it has, per the audit, been applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment pairs a categorical `re-applied` proposition FIRST with a governed UNKNOWN sibling second",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 was re-applied and whether it is applied is UNKNOWN.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment pairs a categorical `re-applied` proposition FIRST with a governed UNKNOWN sibling second",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 was re-applied and whether it is applied is UNKNOWN.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment pairs a governed proposition carrying its OWN internal qualifier with a categorical sibling",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Whether migration 007, after read-only verification, is applied is UNKNOWN and it is applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment pairs a governed proposition carrying its OWN internal qualifier with a categorical sibling",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Whether migration 007, after read-only verification, is applied is UNKNOWN and it is applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment carries authorized wording \u2014 a governed proposition whose subordinate clause carries a comma-delimited internal qualifier",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Whether migration 007, after read-only verification, is applied remains UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording \u2014 a governed proposition whose subordinate clause carries a comma-delimited internal qualifier",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Whether migration 007, after read-only verification, is applied remains UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment carries authorized wording \u2014 a governed proposition whose subordinate clause carries a parenthetical internal qualifier",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Whether migration 007 (after read-only verification) is applied remains UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording \u2014 a governed proposition whose subordinate clause carries a parenthetical internal qualifier",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Whether migration 007 (after read-only verification) is applied remains UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment carries authorized wording \u2014 a conditional whose own qualifier is fronted inside the conditional clause",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- If, after read-only verification, migration 007 is applied, operators must stop.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording \u2014 a conditional whose own qualifier is fronted inside the conditional clause",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- If, after read-only verification, migration 007 is applied, operators must stop.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment carries authorized wording \u2014 procedural manner in a NON-assertive present frame that is not about 007",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- The rollback is applied by hand under its own authorization.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording \u2014 procedural manner in a NON-assertive present frame that is not about 007",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- The rollback is applied by hand under its own authorization.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment carries authorized wording \u2014 a participial adjunct whose antecedent is this file, not 007",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- This file is documented SQL, run by hand under its own authorization.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording \u2014 a participial adjunct whose antecedent is this file, not 007",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- This file is documented SQL, run by hand under its own authorization.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment splits an outer perfect frame with a comma-delimited SUBORDINATE aside carrying its own finite verb",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has, after the report was signed, been applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits an outer perfect frame with a comma-delimited SUBORDINATE aside carrying its own finite verb",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has, after the report was signed, been applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits an outer perfect frame with a comma-delimited subordinate aside, contextual `It` subject",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- It has, after the report was signed, been applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits an outer perfect frame with a comma-delimited subordinate aside, contextual `It` subject",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- It has, after the report was signed, been applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits an outer perfect frame with a PARENTHETICAL subordinate aside carrying its own finite verb",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has (after the report was signed) been applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits an outer perfect frame with a PARENTHETICAL subordinate aside carrying its own finite verb",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has (after the report was signed) been applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits an outer perfect frame with a parenthetical subordinate aside, contextual `It` subject",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- It has (after the report was signed) been applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits an outer perfect frame with a parenthetical subordinate aside, contextual `It` subject",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- It has (after the report was signed) been applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits an outer perfect frame with a finite aside AND several words between the auxiliary and the verb",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has, because the audit was completed, already clearly been applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits an outer perfect frame with a finite aside AND several words between the auxiliary and the verb",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has, because the audit was completed, already clearly been applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits a NEGATIVE outer perfect frame with a comma-delimited finite aside",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has not, after the report was signed, been applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits a NEGATIVE outer perfect frame with a comma-delimited finite aside",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has not, after the report was signed, been applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits a negative outer perfect frame with a finite aside, contextual `It` subject",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- It has not, since the audit was completed, been applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits a negative outer perfect frame with a finite aside, contextual `It` subject",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- It has not, since the audit was completed, been applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits an outer PAST frame with a comma-delimited finite aside",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 was, while the operator was present, applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits an outer PAST frame with a comma-delimited finite aside",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 was, while the operator was present, applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits an outer PRESENT frame with a comma-delimited finite aside",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 is, as the record shows, applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits an outer PRESENT frame with a comma-delimited finite aside",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 is, as the record shows, applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment hides a conditional inside a balanced aside, which must not qualify the outer assertion",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has, if the audit is repeated, been applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment hides a conditional inside a balanced aside, which must not qualify the outer assertion",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has, if the audit is repeated, been applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment pairs a governed COORDINATED proposition with an adversative categorical sibling",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Whether migration 007 was applied or ran is UNKNOWN, but migration 007 was applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment pairs a governed COORDINATED proposition with an adversative categorical sibling",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Whether migration 007 was applied or ran is UNKNOWN, but migration 007 was applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment pairs a governed coordinated conditional with a categorical sibling after a new subject",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- If migration 007 was applied or ran, operators must stop, and migration 007 was applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment pairs a governed coordinated conditional with a categorical sibling after a new subject",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- If migration 007 was applied or ran, operators must stop, and migration 007 was applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment follows an allowed coordinated UNKNOWN proposition with a categorical contextual-`It` assertion",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Whether migration 007 was applied or ran is UNKNOWN in either direction. It is applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment follows an allowed coordinated UNKNOWN proposition with a categorical contextual-`It` assertion",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Whether migration 007 was applied or ran is UNKNOWN in either direction. It is applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment precedes an allowed coordinated UNKNOWN proposition with a categorical assertion",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 is applied to production. Whether migration 007 was applied or ran is UNKNOWN in either direction.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment precedes an allowed coordinated UNKNOWN proposition with a categorical assertion",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 is applied to production. Whether migration 007 was applied or ran is UNKNOWN in either direction.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment carries authorized wording \u2014 a coordinator inside the governed clause \u2014 `whether or not ... has been applied`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Whether or not migration 007 has been applied is UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording \u2014 a coordinator inside the governed clause \u2014 `whether or not ... has been applied`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Whether or not migration 007 has been applied is UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment carries authorized wording \u2014 coordinated auxiliaries inside the governed clause \u2014 `has or has not been applied`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Whether migration 007 has or has not been applied remains UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording \u2014 coordinated auxiliaries inside the governed clause \u2014 `has or has not been applied`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Whether migration 007 has or has not been applied remains UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment carries authorized wording \u2014 coordinated predicates sharing one governed subject \u2014 `was applied or ran`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Whether migration 007 was applied or ran in production is UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording \u2014 coordinated predicates sharing one governed subject \u2014 `was applied or ran`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Whether migration 007 was applied or ran in production is UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment carries authorized wording \u2014 coordinated predicates sharing one conditional subject \u2014 `if ... was applied or ran`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- If migration 007 was applied or ran, operators must stop.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording \u2014 coordinated predicates sharing one conditional subject \u2014 `if ... was applied or ran`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- If migration 007 was applied or ran, operators must stop.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment splits an outer perfect frame with a two-token subordinate aside \u2014 `even though`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has, even though the report was signed, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits an outer perfect frame with a two-token subordinate aside \u2014 `even though`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has, even though the report was signed, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits an outer perfect frame with a two-token subordinate aside \u2014 `now that`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has, now that approval was recorded, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits an outer perfect frame with a two-token subordinate aside \u2014 `now that`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has, now that approval was recorded, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits an outer perfect frame with a two-token subordinate aside \u2014 `provided that`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has, provided that the report was signed, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits an outer perfect frame with a two-token subordinate aside \u2014 `provided that`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has, provided that the report was signed, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits an outer perfect frame with a subordinate aside opened by `notwithstanding`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has, notwithstanding that the report was signed, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits an outer perfect frame with a subordinate aside opened by `notwithstanding`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has, notwithstanding that the report was signed, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits an outer perfect frame with a subordinate aside opened by `whereas`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has, whereas the report was signed, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits an outer perfect frame with a subordinate aside opened by `whereas`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has, whereas the report was signed, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits an outer perfect frame with TWO consecutive asides between auxiliary and participle",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has, after the report was signed, according to the operator, been applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits an outer perfect frame with TWO consecutive asides between auxiliary and participle",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has, after the report was signed, according to the operator, been applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits an outer perfect frame with a NESTED comma aside inside a subordinate aside",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has, because the report, once reviewed, was signed, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits an outer perfect frame with a NESTED comma aside inside a subordinate aside",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has, because the report, once reviewed, was signed, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits an outer perfect frame with a two-token subordinate aside, contextual `It` subject",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- It has, even though the report was signed, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits an outer perfect frame with a two-token subordinate aside, contextual `It` subject",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- It has, even though the report was signed, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment places a new SUBJECT after a serial comma inside an otherwise governed proposition",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Whether migration 007 was applied, migration 007 was applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment places a new SUBJECT after a serial comma inside an otherwise governed proposition",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Whether migration 007 was applied, migration 007 was applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment hides a categorical assertion behind an unrelated aside that follows a governed proposition",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Whether it is applied is UNKNOWN, if you must know, migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment hides a categorical assertion behind an unrelated aside that follows a governed proposition",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Whether it is applied is UNKNOWN, if you must know, migration 007 is applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment pairs an aside-split perfect assertion with a coordinated bare-past sibling",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has, even though the report was signed, been applied to production, and it ran.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment pairs an aside-split perfect assertion with a coordinated bare-past sibling",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has, even though the report was signed, been applied to production, and it ran.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment hides an emphatic `did run` behind an imperative clause in the same sentence",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Whether it is applied is UNKNOWN, do not run the rollback, and migration 007 did run.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment hides an emphatic `did run` behind an imperative clause in the same sentence",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Whether it is applied is UNKNOWN, do not run the rollback, and migration 007 did run.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment declares the emphatic negative before a `whereas` clause",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 did not run in production, whereas the rollback was documented.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment declares the emphatic negative before a `whereas` clause",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 did not run in production, whereas the rollback was documented.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits a NEGATIVE outer perfect frame with a two-token subordinate aside, contextual `It`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- It has, now that approval was recorded, not been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits a NEGATIVE outer perfect frame with a two-token subordinate aside, contextual `It`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- It has, now that approval was recorded, not been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits an outer perfect frame with a subordinate aside whose opener is on NO list \u2014 `seeing as`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has, seeing as the report was signed, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits an outer perfect frame with a subordinate aside whose opener is on NO list \u2014 `seeing as`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has, seeing as the report was signed, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits an outer perfect frame with a subordinate aside whose opener is on no list \u2014 `considering`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- It has, considering the report was signed, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits an outer perfect frame with a subordinate aside whose opener is on no list \u2014 `considering`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- It has, considering the report was signed, been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits an outer perfect frame with NESTED parentheses",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has (according to the operator (per the 2026-09-02 audit)) been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits an outer perfect frame with NESTED parentheses",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has (according to the operator (per the 2026-09-02 audit)) been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits a NEGATIVE outer perfect frame with nested parentheses",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 has not (according to the operator (per the 2026-09-02 audit)) been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits a NEGATIVE outer perfect frame with nested parentheses",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 has not (according to the operator (per the 2026-09-02 audit)) been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment splits an outer perfect frame with doubly nested parentheses, contextual `It` subject",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- It has ((per the audit)) been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment splits an outer perfect frame with doubly nested parentheses, contextual `It` subject",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- It has ((per the audit)) been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment carries authorized wording \u2014 a governed SERIAL list of coordinated predicates \u2014 `was applied, ran, or was re-applied`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Whether migration 007 was applied, ran, or was re-applied remains UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording \u2014 a governed SERIAL list of coordinated predicates \u2014 `was applied, ran, or was re-applied`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Whether migration 007 was applied, ran, or was re-applied remains UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment carries authorized wording \u2014 a coordinated predicate carrying its own parenthetical interruption",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Whether migration 007 was applied or (after read-only verification) ran remains UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording \u2014 a coordinated predicate carrying its own parenthetical interruption",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Whether migration 007 was applied or (after read-only verification) ran remains UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment carries authorized wording \u2014 a governed proposition with multiple internal qualifiers, one of them parenthetical",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Whether migration 007, after read-only verification, and (per the operator) after a fresh audit, is applied remains UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording \u2014 a governed proposition with multiple internal qualifiers, one of them parenthetical",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Whether migration 007, after read-only verification, and (per the operator) after a fresh audit, is applied remains UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment carries authorized wording \u2014 an instructional imperative after a governed conditional \u2014 `do not run the rollback`",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Unless migration 007 is applied, do not run the rollback.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording \u2014 an instructional imperative after a governed conditional \u2014 `do not run the rollback`",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Unless migration 007 is applied, do not run the rollback.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment carries authorized wording \u2014 a MODAL frame split by a subordinate aside, which stays non-assertive",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 may, even though the report was signed, have been applied.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording \u2014 a MODAL frame split by a subordinate aside, which stays non-assertive",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 may, even though the report was signed, have been applied.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment carries authorized wording \u2014 a governed serial list closing with the plain epistemic form",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Whether migration 007 was applied, ran, or was re-applied is UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording \u2014 a governed serial list closing with the plain epistemic form",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Whether migration 007 was applied, ran, or was re-applied is UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment carries authorized wording \u2014 a conditional governing a serial list of coordinated predicates",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- If migration 007 was applied, ran, or was re-applied, operators must stop.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording \u2014 a conditional governing a serial list of coordinated predicates",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- If migration 007 was applied, ran, or was re-applied, operators must stop.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment carries authorized wording \u2014 an instructional imperative carrying procedural manner",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Unless migration 007 is applied, do not run this rollback by hand.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording \u2014 an instructional imperative carrying procedural manner",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Unless migration 007 is applied, do not run this rollback by hand.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment carries authorized wording \u2014 a governed proposition whose internal qualifier carries NESTED parentheses",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Whether migration 007 (per the operator (after read-only verification)) is applied remains UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording \u2014 a governed proposition whose internal qualifier carries NESTED parentheses",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Whether migration 007 (per the operator (after read-only verification)) is applied remains UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the migration comment carries authorized wording \u2014 a MODAL frame split by nested parentheses, which stays non-assertive",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation."
      + "\n-- Migration 007 may (per the operator (after the audit)) have been applied.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording \u2014 a MODAL frame split by nested parentheses, which stays non-assertive",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first."
      + "\n-- Migration 007 may (per the operator (after the audit)) have been applied.",
    mustPass: true,
    expect: [],
  },
  // ---------------------------------------------------------------------------
  // UNMATCHED CLOSING PARENTHESIS -- a STRUCTURAL CC5 failure.
  //
  // The previous correction paired parentheses by depth and then also taught
  // finite-frame recovery to CROSS an unmatched ")". That second half was a
  // fail-OPEN: a single stray close bought a bypass outright, because the walk
  // skipped the ")", halted at the noun before it, and never recovered the outer
  // auxiliary. The reported input
  //   "Migration 007 has, according to the operator) been applied to production."
  // left the whole suite exiting 0 with the categorical claim unrejected, and an
  // authorized UNKNOWN sentence beside it changed nothing.
  //
  // An unmatched close is MALFORMED PROSE, never an interruption boundary. CC5
  // now scans the normalized authoritative-comment prose by depth and fails
  // immediately on a ")" at depth zero, BEFORE any application predicate is
  // classified -- so no recovery heuristic is consulted about it and no
  // authorized sentence elsewhere can mask it. The recovery-through-unmatched-
  // close behaviour is removed outright.
  //
  // These prohibited cases are load-bearing on the STRUCTURAL BALANCE FAILURE
  // ALONE: removing only that failure lets every one of them escape (probe
  // below). Depth-aware pairing and finite-frame recovery do NOT catch them and
  // are not credited with doing so. The allowed cases below prove the rule is
  // structural rather than a ban on parentheses: balanced single and balanced
  // nested parentheses stay accepted when the wording is otherwise authorized,
  // and the balanced categorical forms above are still rejected for their
  // CATEGORICAL CONTENT, not for their balance.
  {
    name: "the migration comment carries the exact reported form -- a comma-opened aside closed by an UNMATCHED `)`, beside an authorized UNKNOWN sentence",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Whether migration 007 is applied is UNKNOWN in either direction.\n"
      + "-- Migration 007 has, according to the operator) been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment carries the exact reported form -- a comma-opened aside closed by an UNMATCHED `)`, beside an authorized UNKNOWN sentence",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Whether migration 007 is applied is UNKNOWN in either direction.\n"
      + "-- Migration 007 has, according to the operator) been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment carries an UNMATCHED `)` with a contextual `It` subject",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- It has, according to the operator) been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment carries an UNMATCHED `)` with a contextual `It` subject",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- It has, according to the operator) been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment carries MORE THAN ONE unmatched `)` in a single sentence",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Migration 007 has, per the operator) per the 2026-09-02 audit) been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment carries MORE THAN ONE unmatched `)` in a single sentence",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Migration 007 has, per the operator) per the 2026-09-02 audit) been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment carries an unmatched `)` INSIDE a sentence that also carries an authorized UNKNOWN proposition",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Whether 007 is applied is UNKNOWN in either direction, yet it has, per the operator) been applied.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment carries an unmatched `)` INSIDE a sentence that also carries an authorized UNKNOWN proposition",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Whether 007 is applied is UNKNOWN in either direction, yet it has, per the operator) been applied.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment carries an unmatched `)` BEFORE the application predicate",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Per the operator) migration 007 has been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment carries an unmatched `)` BEFORE the application predicate",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Per the operator) migration 007 has been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment carries an unmatched `)` AFTER the application predicate",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Migration 007 has been applied to production (per the operator)).",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment carries an unmatched `)` AFTER the application predicate",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Migration 007 has been applied to production (per the operator)).",
    expect: ["CC5."],
  },
  {
    name: "the migration comment carries authorized wording \u2014 a governed proposition whose internal qualifier carries BALANCED SINGLE parentheses",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Whether migration 007 (per the operator) is applied remains UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  {
    name: "the rollback comment carries authorized wording \u2014 a governed proposition whose internal qualifier carries BALANCED SINGLE parentheses",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Whether migration 007 (per the operator) is applied remains UNKNOWN in either direction.",
    mustPass: true,
    expect: [],
  },
  // The two classes below are the ones the STRUCTURAL BALANCE FAILURE uniquely
  // protects, and they were added because the load-bearing probe said so rather
  // than because the shape looked plausible.
  //
  // Measured: with the structural failure disabled and everything else intact,
  // the comma-opened forms above (M268-M275) are STILL rejected -- the
  // pre-existing fail-closed COMMA recovery jumps to the comma before the stray
  // ")" and recovers the outer `has`, so the perfect frame is seen after all.
  // For those classes the structural check is redundant, and it is NOT claimed
  // as their sole protection.
  //
  // Remove the comma and that recovery has nothing to jump to: `priorComma`
  // returns null, the walk halts at the noun, `been applied` reads as a bare
  // participle, and the claim ESCAPES. These two classes therefore fail only
  // because an unmatched ")" is refused structurally, before any predicate is
  // classified. They are the load-bearing evidence for this correction.
  {
    name: "the migration comment carries an unmatched `)` with NO comma before it, which ONLY the structural balance failure catches",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Migration 007 has according to the operator) been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment carries an unmatched `)` with NO comma before it, which ONLY the structural balance failure catches",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- Migration 007 has according to the operator) been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the migration comment carries an unmatched `)` with NO comma before it, contextual `It` subject -- structural failure only",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- It has per the 2026-09-02 audit) been applied to production.",
    expect: ["CC5."],
  },
  {
    name: "the rollback comment carries an unmatched `)` with NO comma before it, contextual `It` subject -- structural failure only",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- It has per the 2026-09-02 audit) been applied to production.",
    expect: ["CC5."],
  },

  // --- CC5-SYNTAX-001 closure: the frozen-authority control (CC5F) ----------
  //
  // CC5's bounded grammar does not recognise these forms and never will without
  // being taught each one. They are caught here because every raw byte of both
  // authoritative files is pinned, not because any English is interpreted.
  {
    name: "CC5-SYNTAX-001: the migration comment carries the unauthorized past form `Migration 007 remained unapplied.` in the authorized-insertion zone -- the exact class CC5's grammar does not recognise",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n-- Migration 007 remained unapplied.",
    expect: ["CC5F."],
  },
  {
    name: "CC5-SYNTAX-001: the migration comment carries the unauthorized past form `Migration 007 has remained unapplied.` in the authorized-insertion zone -- the exact class CC5's grammar does not recognise",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n-- Migration 007 has remained unapplied.",
    expect: ["CC5F."],
  },
  {
    name: "CC5-SYNTAX-001: the migration comment carries the unauthorized past form `Migration 007 stayed unapplied.` in the authorized-insertion zone -- the exact class CC5's grammar does not recognise",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n-- Migration 007 stayed unapplied.",
    expect: ["CC5F."],
  },
  {
    name: "CC5-SYNTAX-001: the migration comment carries the unauthorized past form `Migration 007 has stayed unapplied.` in the authorized-insertion zone -- the exact class CC5's grammar does not recognise",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n-- Migration 007 has stayed unapplied.",
    expect: ["CC5F."],
  },
  {
    name: "CC5-SYNTAX-001: the migration comment carries the unauthorized past form `It remained unapplied.` in the authorized-insertion zone -- the exact class CC5's grammar does not recognise",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n-- It remained unapplied.",
    expect: ["CC5F."],
  },
  {
    name: "CC5-SYNTAX-001: the migration comment carries the unauthorized past form `It has remained unapplied.` in the authorized-insertion zone -- the exact class CC5's grammar does not recognise",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n-- It has remained unapplied.",
    expect: ["CC5F."],
  },
  {
    name: "CC5-SYNTAX-001: the migration comment carries the unauthorized past form `It stayed unapplied.` in the authorized-insertion zone -- the exact class CC5's grammar does not recognise",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n-- It stayed unapplied.",
    expect: ["CC5F."],
  },
  {
    name: "CC5-SYNTAX-001: the migration comment carries the unauthorized past form `It has stayed unapplied.` in the authorized-insertion zone -- the exact class CC5's grammar does not recognise",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n-- It has stayed unapplied.",
    expect: ["CC5F."],
  },
  {
    name: "CC5-SYNTAX-001: the rollback comment carries the unauthorized past form `Migration 007 remained unapplied.` in the authorized-insertion zone -- the exact class CC5's grammar does not recognise",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n-- Migration 007 remained unapplied.",
    expect: ["CC5F."],
  },
  {
    name: "CC5-SYNTAX-001: the rollback comment carries the unauthorized past form `Migration 007 has remained unapplied.` in the authorized-insertion zone -- the exact class CC5's grammar does not recognise",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n-- Migration 007 has remained unapplied.",
    expect: ["CC5F."],
  },
  {
    name: "CC5-SYNTAX-001: the rollback comment carries the unauthorized past form `Migration 007 stayed unapplied.` in the authorized-insertion zone -- the exact class CC5's grammar does not recognise",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n-- Migration 007 stayed unapplied.",
    expect: ["CC5F."],
  },
  {
    name: "CC5-SYNTAX-001: the rollback comment carries the unauthorized past form `Migration 007 has stayed unapplied.` in the authorized-insertion zone -- the exact class CC5's grammar does not recognise",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n-- Migration 007 has stayed unapplied.",
    expect: ["CC5F."],
  },
  {
    name: "CC5-SYNTAX-001: the rollback comment carries the unauthorized past form `It remained unapplied.` in the authorized-insertion zone -- the exact class CC5's grammar does not recognise",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n-- It remained unapplied.",
    expect: ["CC5F."],
  },
  {
    name: "CC5-SYNTAX-001: the rollback comment carries the unauthorized past form `It has remained unapplied.` in the authorized-insertion zone -- the exact class CC5's grammar does not recognise",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n-- It has remained unapplied.",
    expect: ["CC5F."],
  },
  {
    name: "CC5-SYNTAX-001: the rollback comment carries the unauthorized past form `It stayed unapplied.` in the authorized-insertion zone -- the exact class CC5's grammar does not recognise",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n-- It stayed unapplied.",
    expect: ["CC5F."],
  },
  {
    name: "CC5-SYNTAX-001: the rollback comment carries the unauthorized past form `It has stayed unapplied.` in the authorized-insertion zone -- the exact class CC5's grammar does not recognise",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n-- It has stayed unapplied.",
    expect: ["CC5F."],
  },
  {
    name: "CC5-SYNTAX-001: the migration carries `Migration 007 remained unapplied.` appended after the frozen trailing comment block",
    file: MIGRATION,
    from: "-- TypeScript computes a conservative upper bound for this same form.",
    to: "-- TypeScript computes a conservative upper bound for this same form.\n-- Migration 007 remained unapplied.",
    expect: ["CC5F."],
  },
  {
    name: "CC5-SYNTAX-001: the rollback carries `Migration 007 remained unapplied.` appended after the frozen trailing comment block",
    file: ROLLBACK,
    from: "-- rollback would later remove. Dropped after the calling constraint.",
    to: "-- rollback would later remove. Dropped after the calling constraint.\n-- Migration 007 remained unapplied.",
    expect: ["CC5F."],
  },
  {
    name: "the migration's dated 2026-08-28 observation is advanced from 001-006 to 001-007 -- a false history no grammar check reads",
    file: MIGRATION,
    from: "`_migrations` holding 001-006; a dated observation is not a statement about now.",
    to: "`_migrations` holding 001-007; a dated observation is not a statement about now.",
    expect: ["CC5F."],
  },
  {
    name: "the rollback's dated 2026-08-28 observation is advanced from 001-006 to 001-007 -- a false history no grammar check reads",
    file: ROLLBACK,
    from: "-- 001-006. Disposable PostgreSQL tests exercise this script; any production run",
    to: "-- 001-007. Disposable PostgreSQL tests exercise this script; any production run",
    expect: ["CC5F."],
  },
  {
    name: "the migration's executable SQL is changed by one semantically neutral byte -- the raw-byte executable digest still moves",
    file: MIGRATION,
    from: "    CHECK (length(id) <= 200 AND octet_length(id) <= 200),",
    to: "    CHECK (length(id) <= 200  AND octet_length(id) <= 200),",
    expect: ["CC5F."],
  },
  {
    name: "the rollback's executable SQL is changed by one semantically neutral byte -- the raw-byte executable digest still moves",
    file: ROLLBACK,
    from: "DELETE FROM _migrations WHERE name = '007_evidence_bounds.sql';",
    to: "DELETE  FROM _migrations WHERE name = '007_evidence_bounds.sql';",
    expect: ["CC5F."],
  },

  // --- the authority manifest itself is a mutation target --------------------
  //
  // A freeze is only as good as the manifest that defines it, so the manifest is
  // attacked the same way the artifacts are.
  {
    name: "the authority's migration whole-file digest is altered by one character, so the pinned identity no longer names the reviewed bytes",
    file: SQL_AUTHORITY,
    from: "\"sha256\": \"fb5128b4ae207e75b7c6b2798519594c72b7d91191b7055a674c22fafdf2ddca\"",
    to: "\"sha256\": \"fb5128b4ae207e75b7c6b2798519594c72b7d91191b7055a674c22fafdf2ddc0\"",
    expect: ["CC5F."],
  },
  {
    name: "the authority's rollback whole-file digest is altered, so it no longer names the reviewed bytes",
    file: SQL_AUTHORITY,
    from: "\"sha256\": \"31e0ab0c1f92ccafbd30fb827b4ece9856257a997c39ad5fb031bc18cebfe122\"",
    to: "\"sha256\": \"31e0ab0c1f92ccafbd30fb827b4ece9856257a997c39ad5fb031bc18cebfe120\"",
    expect: ["CC5F."],
  },
  {
    name: "the authority's rollback digest is UPPERCASED -- a digest that is not lowercase 64-hex is refused rather than normalised",
    file: SQL_AUTHORITY,
    from: "\"sha256\": \"31e0ab0c1f92ccafbd30fb827b4ece9856257a997c39ad5fb031bc18cebfe122\"",
    to: "\"sha256\": \"31E0AB0C1F92CCAFBD30FB827B4ECE9856257A997C39AD5FB031BC18CEBFE122\"",
    expect: ["CC5F."],
  },
  {
    name: "the manifest raw bytes gain insignificant JSON whitespace without updating the independent source pin",
    file: SQL_AUTHORITY,
    from: "{\n  \"version\": 2,",
    to: "{\n \n  \"version\": 2,",
    expect: ["CC5F."],
  },
  {
    name: "the authority carries a DUPLICATE top-level property name -- JSON.parse would silently keep the last, so the reviewed text and the enforced text would differ",
    file: SQL_AUTHORITY,
    from: "  \"version\": 2,",
    to: "  \"version\": 2,\n  \"version\": 2,",
    expect: ["CC5F."],
  },
  {
    name: "the authority carries a duplicate `sha256` in ONE artifact object, the second an ESCAPED-EQUIVALENT spelling",
    file: SQL_AUTHORITY,
    from: "      \"sha256\": \"fb5128b4ae207e75b7c6b2798519594c72b7d91191b7055a674c22fafdf2ddca\"",
    to: "      \"sha256\": \"fb5128b4ae207e75b7c6b2798519594c72b7d91191b7055a674c22fafdf2ddca\",\n      \"\\u0073ha256\": \"fb5128b4ae207e75b7c6b2798519594c72b7d91191b7055a674c22fafdf2ddca\"",
    expect: ["CC5F."],
  },
  {
    name: "the authority carries an UNEXPECTED extra top-level field -- the schema is closed",
    file: SQL_AUTHORITY,
    from: "  \"version\": 2,",
    to: "  \"version\": 2,\n  \"note\": \"informational\",",
    expect: ["CC5F."],
  },
  {
    name: "the authority's version is not 2 -- an unrecognised authority format is refused, never best-effort interpreted",
    file: SQL_AUTHORITY,
    from: "  \"version\": 2,",
    to: "  \"version\": 3,",
    expect: ["CC5F."],
  },
  {
    name: "the authority names a path that is not one of the two authoritative artifacts",
    file: SQL_AUTHORITY,
    from: "\"path\": \"state/migrations/007_evidence_bounds.sql\"",
    to: "\"path\": \"state/migrations/007_evidence_bounds_copy.sql\"",
    expect: ["CC5F."],
  },
  {
    name: "the authority's JSON is malformed -- a manifest that cannot be parsed is a failure, never an empty authority",
    file: SQL_AUTHORITY,
    from: "  \"artifacts\": [",
    to: "  \"artifacts\": [[{",
    expect: ["CC5F."],
  },
];

// The former insertion-zone model classified 46 English mutations as
// authorized merely because their sentence appeared in one global allowlist.
// Whole-file authority intentionally invalidates that premise: without a
// coordinated artifact digest and manifest-pin update, every byte change is
// prohibited. Preserve each historical name and make the changed trust model
// explicit in the executed inventory.
const LEGACY_MUTATIONS = LEGACY_MUTATION_DEFINITIONS.map((mutation) => {
  if (!mutation.mustPass) return mutation;
  const { mustPass: _invalidLegacyAuthorization, ...rest } = mutation;
  return {
    ...rest,
    name: `${mutation.name} — changed without coordinated whole-file authority`,
    expect: ["CC5F."],
  };
});

const RAW_IDENTITY_MUTATIONS = [
  {
    name: "a full-line SQL comment is inserted inside the dollar-quoted helper body after AS $$",
    file: MIGRATION,
    from: "AS $$\n  SELECT coalesce(bool_and(",
    to: "AS $$\n-- This file is documented SQL, run by hand under its own authorization.\n"
      + "  SELECT coalesce(bool_and(",
    expect: ["CC5F."],
  },
  {
    name: "two migration comment lines are relocated while executable-line order is preserved",
    file: MIGRATION,
    from: "-- Phase 0B.0 gave every evidence field a *presence* rule and no *size* rule:\n"
      + "-- `claim` and `subject` had to be non-empty and nothing more.",
    to: "-- `claim` and `subject` had to be non-empty and nothing more.\n"
      + "-- Phase 0B.0 gave every evidence field a *presence* rule and no *size* rule:",
    expect: ["CC5F."],
  },
  {
    name: "rollback-only documented-SQL wording is inserted in the forward migration",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- This file is documented SQL, run by hand under its own authorization.",
    expect: ["CC5F."],
  },
  {
    name: "a blank double-dash line changes migration identity",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n--",
    expect: ["CC5F."],
  },
  {
    name: "hard-wrapping an apparently acceptable sentence changes migration identity",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- This file is documented SQL, run by hand\n-- under its own authorization.",
    expect: ["CC5F."],
  },
  {
    name: "a double-dash tab line changes migration identity",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n--\t",
    expect: ["CC5F."],
  },
  {
    name: "duplicating an existing comment line changes migration identity",
    file: MIGRATION,
    from: "-- Establish the current applied set by read-only verification before acting on it.",
    to: "-- Establish the current applied set by read-only verification before acting on it.\n"
      + "-- Establish the current applied set by read-only verification before acting on it.",
    expect: ["CC5F."],
  },
  {
    name: "converting the complete migration from LF to CRLF changes identity",
    file: MIGRATION,
    transform: "crlf",
    expect: ["CC5F."],
  },
  {
    name: "prepending a UTF-8 BOM to the migration changes identity",
    file: MIGRATION,
    prependBytes: [0xef, 0xbb, 0xbf],
    expect: ["CC5F."],
  },
  {
    name: "adding a decomposed Unicode-normalization alternative changes migration identity",
    file: MIGRATION,
    appendText: "\n-- cafe\u0301\n",
    expect: ["CC5F."],
  },
  {
    name: "adding an inline SQL comment changes migration identity",
    file: MIGRATION,
    from: "SET LOCAL lock_timeout = '10s';",
    to: "SET LOCAL lock_timeout = '10s'; -- unchanged behavior",
    expect: ["CC5F."],
  },
  {
    name: "adding a block SQL comment changes migration identity",
    file: MIGRATION,
    from: "SET LOCAL lock_timeout = '10s';",
    to: "SET LOCAL lock_timeout = '10s'; /* unchanged behavior */",
    expect: ["CC5F."],
  },
  {
    name: "a partial apparently authorized sentence changes migration identity",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- This file is documented SQL",
    expect: ["CC5F."],
  },
  {
    name: "concatenating apparently authorized sentences changes migration identity",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Whether it was applied is not established and requires read-only verification."
      + "This file is documented SQL, run by hand under its own authorization.",
    expect: ["CC5F."],
  },
  {
    name: "prefix residue after an apparently authorized sentence changes migration identity",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- This file is documented SQL, run by hand under its own authorization.EXTRA",
    expect: ["CC5F."],
  },
  {
    name: "repeated spaces in an apparently authorized sentence change migration identity",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- This  file is documented SQL, run by hand under its own authorization.",
    expect: ["CC5F."],
  },
  {
    name: "the rollback artifact is substituted for the forward migration",
    file: MIGRATION,
    replaceWithFile: ROLLBACK,
    expect: ["CC5F."],
  },
  {
    name: "the forward migration artifact is substituted for the rollback",
    file: ROLLBACK,
    replaceWithFile: MIGRATION,
    expect: ["CC5F."],
  },
  {
    name: "the migration is replaced by a symlink to the rollback",
    file: MIGRATION,
    symlinkTo: ROLLBACK,
    expect: ["CC5F."],
  },
  {
    name: "the authority manifest is replaced by a symlink to regular JSON bytes",
    file: SQL_AUTHORITY,
    symlinkTo: "package.json",
    expect: ["CC5F."],
  },
  {
    name: "the authority manifest ends in malformed UTF-8",
    file: SQL_AUTHORITY,
    appendBytes: [0x80],
    expect: ["CC5F."],
  },
  {
    name: "the authority carries an escaped-equivalent duplicate top-level version key",
    file: SQL_AUTHORITY,
    from: "  \"version\": 2,",
    to: "  \"\\u0076ersion\": 2,\n  \"version\": 2,",
    expect: ["CC5F."],
  },
  {
    name: "a reviewed migration comment change succeeds only with its artifact digest and manifest pin updated",
    file: MIGRATION,
    from: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.",
    to: "-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.\n"
      + "-- Whether migration 007 ran in production remains UNKNOWN in either direction.",
    coordinatedAuthority: true,
    mustPass: true,
    expect: [],
  },
  {
    name: "rollback-specific documented-SQL wording succeeds only with the rollback digest and manifest pin updated",
    file: ROLLBACK,
    from: "-- current applied set to be established by read-only verification first.",
    to: "-- current applied set to be established by read-only verification first.\n"
      + "-- This file is documented SQL, run by hand under its own authorization.",
    coordinatedAuthority: true,
    mustPass: true,
    expect: [],
  },
];

const MUTATIONS = [...LEGACY_MUTATIONS, ...RAW_IDENTITY_MUTATIONS];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const decodeUtf8Strict = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const MUTATION_TARGETS = [
  ...new Set([...MUTATIONS.map((mutation) => mutation.file), SQL_AUTHORITY_SOURCE]),
].sort();

const gitStatus = () => execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
  cwd: AUTHORITATIVE_REPO_ROOT,
  encoding: "utf8",
});

const snapshotAuthoritative = () => ({
  status: gitStatus(),
  files: new Map(MUTATION_TARGETS.map((file) => [
    file,
    readFileSync(resolve(AUTHORITATIVE_REPO_ROOT, file)),
  ])),
});

const authoritativeSnapshotMatches = (snapshot) => {
  if (gitStatus() !== snapshot.status) return false;
  return [...snapshot.files].every(([file, before]) => {
    const after = readFileSync(resolve(AUTHORITATIVE_REPO_ROOT, file));
    return after.equals(before) && sha256(after) === sha256(before);
  });
};

const prepareDisposableWorkspace = () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "gcd-payload-mutation-"));
  const workspace = join(tempRoot, basename(AUTHORITATIVE_REPO_ROOT));
  cpSync(AUTHORITATIVE_REPO_ROOT, workspace, {
    recursive: true,
    filter: (source) => ![".git", "node_modules"].includes(basename(source)),
  });
  const dependencies = resolve(AUTHORITATIVE_REPO_ROOT, "node_modules");
  if (existsSync(dependencies)) {
    symlinkSync(realpathSync(dependencies), resolve(workspace, "node_modules"), "dir");
  }
  if (existsSync(resolve(workspace, ".git"))) {
    throw new Error("disposable mutation copy unexpectedly contains Git metadata");
  }
  return { tempRoot, workspace };
};

const restoreRaw = (path, original) => {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) rmSync(path, { force: true });
  } catch {
    // A missing target is recreated below.
  }
  writeFileSync(path, original);
};

const build = () => {
  execFileSync("npx", ["tsc", "-p", "tsconfig.json"], {
    cwd: REPO_ROOT, stdio: "pipe", encoding: "utf8",
  });
};

const runSuite = () => {
  let stdout = "";
  try {
    stdout = execFileSync("node", ["dist/harness/contentIntelligence.selftest.js"], {
      cwd: REPO_ROOT, stdio: "pipe", encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    });
    return { failed: [], crashed: false };
  } catch (error) {
    stdout = `${error.stdout ?? ""}`;
    const failed = stdout.split("\n")
      .filter((line) => line.startsWith("FAIL  "))
      .map((line) => line.slice("FAIL  ".length));
    return { failed, crashed: failed.length === 0 };
  }
};

const inFlight = new Map();
let disposableTempRoot = null;
let restoringOnSignal = false;
const restoreAll = () => {
  for (const [path, original] of inFlight) {
    try {
      restoreRaw(path, original);
    } catch {
      // Best effort only; the disposable directory is removed next.
    }
  }
  inFlight.clear();
};
const cleanupDisposable = () => {
  restoreAll();
  if (disposableTempRoot !== null) {
    try {
      rmSync(disposableTempRoot, { recursive: true, force: true });
    } catch {
      // Best effort during process teardown. The authoritative tree was never a write target.
    }
    disposableTempRoot = null;
  }
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (restoringOnSignal) return;
    restoringOnSignal = true;
    cleanupDisposable();
    process.exit(130);
  });
}
process.on("exit", cleanupDisposable);

const interruptionProbeChild = () => {
  const prepared = prepareDisposableWorkspace();
  const target = resolve(prepared.workspace, PAYLOAD);
  const original = readFileSync(target);
  const text = decodeUtf8Strict(original);
  const probe = LEGACY_MUTATIONS[0];
  const mutated = Buffer.from(text.replace(probe.from, () => probe.to), "utf8");
  writeFileSync(target, mutated);
  process.stdout.write(`${JSON.stringify({
    tempRoot: prepared.tempRoot,
    target,
    originalDigest: sha256(original),
  })}\n`);
  setInterval(() => {}, 60_000);
};

const runAbruptInterruptionProof = async (authoritativeBefore) => {
  const child = spawn(process.execPath, [SCRIPT_PATH, "--interrupt-probe-child"], {
    cwd: AUTHORITATIVE_REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const line = await new Promise((resolveLine, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`interruption probe timed out: ${stderr}`));
    }, 30_000);
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const newline = stdout.indexOf("\n");
      if (newline >= 0) {
        clearTimeout(timer);
        resolveLine(stdout.slice(0, newline));
      }
    });
  });
  const probe = JSON.parse(line);
  const unchangedDuring = authoritativeSnapshotMatches(authoritativeBefore);
  child.kill("SIGKILL");
  await new Promise((resolveExit) => child.once("exit", resolveExit));
  try {
    const disposableWasActivelyMutated = existsSync(probe.target)
      && sha256(readFileSync(probe.target)) !== probe.originalDigest;
    return {
      disposableWasActivelyMutated,
      unchangedDuring,
      unchangedAfter: authoritativeSnapshotMatches(authoritativeBefore),
    };
  } finally {
    rmSync(probe.tempRoot, { recursive: true, force: true });
  }
};

const mutationBytes = (mutation, original) => {
  if (mutation.from !== undefined) {
    const originalText = decodeUtf8Strict(original);
    const occurrences = originalText.split(mutation.from).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `the mutation site appears ${occurrences} times in ${mutation.file}; it must be unique`,
      );
    }
    return Buffer.from(originalText.replace(mutation.from, () => mutation.to), "utf8");
  }
  if (mutation.appendBytes !== undefined) {
    return Buffer.concat([original, Buffer.from(mutation.appendBytes)]);
  }
  if (mutation.prependBytes !== undefined) {
    return Buffer.concat([Buffer.from(mutation.prependBytes), original]);
  }
  if (mutation.appendText !== undefined) {
    return Buffer.concat([original, Buffer.from(mutation.appendText, "utf8")]);
  }
  if (mutation.transform === "crlf") {
    return Buffer.from(decodeUtf8Strict(original).replace(/\r?\n/g, "\r\n"), "utf8");
  }
  if (mutation.replaceWithFile !== undefined) {
    return readFileSync(resolve(REPO_ROOT, mutation.replaceWithFile));
  }
  if (mutation.symlinkTo !== undefined) return null;
  throw new Error(`mutation ${mutation.name} has no mutation operation`);
};

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  console.log("Payload-contract mutation tests\n");
  const coordinatedCount = MUTATIONS.filter((mutation) => mutation.mustPass).length;
  const prohibitedCount = MUTATIONS.length - coordinatedCount;
  console.log(`Source inventory: ${MUTATIONS.length} mutations (${prohibitedCount} prohibited, `
    + `${coordinatedCount} coordinated-authority-update)\n`);

  const authoritativeBefore = snapshotAuthoritative();
  const prepared = prepareDisposableWorkspace();
  disposableTempRoot = prepared.tempRoot;
  REPO_ROOT = prepared.workspace;
  check("M-isolation. every mutation, build, suite, and restoration targets a disposable no-Git copy",
    REPO_ROOT !== AUTHORITATIVE_REPO_ROOT && !existsSync(resolve(REPO_ROOT, ".git")));
  check(`M-capture. captured raw bytes and Git status for all ${MUTATION_TARGETS.length} authoritative targets`,
    authoritativeBefore.files.size === MUTATION_TARGETS.length);
  const interruption = await runAbruptInterruptionProof(authoritativeBefore);
  check("M-kill. the harness was killed by SIGKILL while its disposable target was modified, "
    + "and authoritative bytes/status were unchanged during and after it",
  interruption.disposableWasActivelyMutated
    && interruption.unchangedDuring
    && interruption.unchangedAfter);

  build();
  const baseline = runSuite();
  check("M0. the unmutated disposable copy builds and the whole suite passes",
    !baseline.crashed && baseline.failed.length === 0,
    `failed: ${baseline.failed.join(" | ") || "(crashed)"}`);
  if (failures) {
    console.log("\nBaseline or isolation proof is not green; mutation results would be meaningless.");
    process.exit(1);
  }

  let distStale = false;
  for (const [index, mutation] of MUTATIONS.entries()) {
    const id = `M${index + 1}`;
    const path = resolve(REPO_ROOT, mutation.file);
    const original = readFileSync(path);
    const touched = [];
    let mutated;
    try {
      mutated = mutationBytes(mutation, original);
    } catch (error) {
      check(`${id}. ${mutation.name}`, false, error instanceof Error ? error.message : String(error));
      continue;
    }

    const touch = (target, bytes) => {
      if (!inFlight.has(target)) {
        inFlight.set(target, bytes);
        touched.push([target, bytes]);
      }
    };

    try {
      touch(path, original);
      if (mutation.symlinkTo !== undefined) {
        rmSync(path, { force: true });
        symlinkSync(resolve(REPO_ROOT, mutation.symlinkTo), path);
      } else {
        writeFileSync(path, mutated);
      }

      if (mutation.coordinatedAuthority) {
        const manifestPath = resolve(REPO_ROOT, SQL_AUTHORITY);
        const manifestOriginal = readFileSync(manifestPath);
        const manifestText = decodeUtf8Strict(manifestOriginal);
        const oldArtifactDigest = sha256(original);
        const artifactOccurrences = manifestText.split(oldArtifactDigest).length - 1;
        check(`${id}a. the changed artifact has exactly one manifest digest to update`,
          artifactOccurrences === 1, `found ${artifactOccurrences}`);
        if (artifactOccurrences !== 1) continue;
        touch(manifestPath, manifestOriginal);
        const manifestMutated = Buffer.from(
          manifestText.replace(oldArtifactDigest, sha256(mutated)), "utf8",
        );
        writeFileSync(manifestPath, manifestMutated);

        const sourcePath = resolve(REPO_ROOT, SQL_AUTHORITY_SOURCE);
        const sourceOriginal = readFileSync(sourcePath);
        const sourceText = decodeUtf8Strict(sourceOriginal);
        const oldManifestDigest = sha256(manifestOriginal);
        const pinOccurrences = sourceText.split(oldManifestDigest).length - 1;
        check(`${id}b. the changed manifest has exactly one independent source pin to update`,
          pinOccurrences === 1, `found ${pinOccurrences}`);
        if (pinOccurrences !== 1) continue;
        touch(sourcePath, sourceOriginal);
        writeFileSync(sourcePath, Buffer.from(
          sourceText.replace(oldManifestDigest, sha256(manifestMutated)), "utf8",
        ));
      }

      const compiled = (mutation.file.startsWith("src/") && !mutation.file.endsWith(".json"))
        || mutation.coordinatedAuthority;
      let buildFailed = false;
      if (compiled || distStale) {
        try {
          build();
        } catch {
          buildFailed = true;
        }
      }
      distStale = compiled;
      const result = buildFailed ? { failed: [], crashed: true } : runSuite();

      if (mutation.mustPass) {
        check(`${id}. ${mutation.name} — the suite stays green with coordinated authority`,
          !buildFailed && !result.crashed && result.failed.length === 0,
          buildFailed ? "the mutated copy did not compile"
            : result.crashed ? "the suite aborted"
            : `wrongly reported: ${result.failed.map((line) => line.split(".")[0]).join(", ")}`);
      } else {
        const named = mutation.expect.filter((prefix) =>
          result.failed.some((line) => line.startsWith(prefix)));
        check(`${id}. ${mutation.name} — the suite reports it by name `
          + `(${mutation.expect.join(", ")})`,
        !buildFailed && !result.crashed && named.length === mutation.expect.length,
        buildFailed ? "the mutated copy did not compile, so no check could report it"
          : result.crashed ? "the suite aborted instead of naming a failing check"
          : `reported: ${result.failed.map((line) => line.split(".")[0]).join(", ") || "nothing"}`);
      }
    } finally {
      for (const [restorePath, restoreBytes] of [...touched].reverse()) {
        restoreRaw(restorePath, restoreBytes);
        inFlight.delete(restorePath);
        const restored = readFileSync(restorePath);
        check(`${id}r. ${restorePath.slice(REPO_ROOT.length + 1)} is restored byte-for-byte`,
          restored.equals(restoreBytes) && sha256(restored) === sha256(restoreBytes),
          `sha256 before=${sha256(restoreBytes)} after=${sha256(restored)}`);
      }
    }
  }

  build();
  const restoredRun = runSuite();
  check("M-end. after every raw mutation is reverted the disposable suite passes again",
    !restoredRun.crashed && restoredRun.failed.length === 0,
    `failed: ${restoredRun.failed.join(" | ") || "(crashed)"}`);
  check("M-authority. authoritative target bytes and Git status stayed unchanged",
    authoritativeSnapshotMatches(authoritativeBefore));

  console.log(failures === 0
    ? `\nALL PASS — ${MUTATIONS.length} mutations`
    : `\n${failures} FAILURE(S) — ${MUTATIONS.length} mutations`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv[2] === "--interrupt-probe-child") {
  interruptionProbeChild();
} else {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
