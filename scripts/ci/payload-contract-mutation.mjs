#!/usr/bin/env node
/**
 * Focused mutation tests for the payload-contract derivations.
 *
 * A regression that cannot fail is decoration. This script proves each
 * load-bearing derivation in `src/harness/agents/payloadContract.ts` and the
 * related repository-authority controls is actually load-bearing across twenty-five
 * captured paths: it applies one focused mutation in a disposable no-Git copy,
 * rebuilds there, runs the Content Intelligence offline suite, and
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
 * The last group covers the deterministic contact line attached to every stage 5
 * package: the contact-line reserve in stage 5's caption budget and in its
 * prompt, the critic's refusal of a missing or edited contact line, byte-exact
 * copying and the owner-reviewed template, the fail-closed missing-record
 * check, the critic's packaging ceiling, the local CLI's footer, contact
 * handoff and free preflight, and the two prompt rules. Those targets add the
 * contact module, the CLI and two prompts to the captured paths; the CLI and
 * prompts are read at runtime and need no rebuild. Since the narrow critic
 * panel, the critic-side prompt rule lives in the evidence-fidelity lens prompt.
 *
 * The next group covers the narrow critic panel: the lens category
 * restriction, the aggregation verdict rule, the no-merge deterministic summary
 * and the no-dedup union, the reviewer-only caveat exposure, fail-closed on one
 * lens failing, the lens-scoped instruction channel, the lens label never
 * reaching the provider, the per-lens token budget, and the contact line's shop
 * name read from its approved-facts record. It adds no captured path. Its three
 * verdict mutations were repointed at the owner-aware rule's lines when that
 * rule replaced "any blocking finding -> needs_revision"; their ids and expected
 * checks are unchanged.
 *
 * The next group follows up the panel's acceptance run. It covers each arm of
 * the owner-aware verdict — the revision arm reverting to any blocking finding,
 * the human-owned blocking arm dropped, the two arms decided in the wrong order,
 * and the last arm no longer yielding provisional_pass — and the evidence lens's
 * per-shot `shotFactIds` on `OVERLAY_TEXT`: dropped, not filtered to the
 * overlay's own shot, carrying stage 4's direction-summary prose, the lens shown
 * stage 4's whole output, the block ceiling no longer counting the ids, and each
 * of the two prompt sentences that tell the lens what the ids are and to use
 * them. It adds no captured path.
 *
 * The next group (M398-M417) makes stage 2's restrictions binding on the writing stages
 * and gives every writer the claim-boundaries skill: a writer dropping the
 * skill, stage 4 or 5 no longer receiving the two restriction blocks, those
 * blocks carrying stage 2's assessment, stage 5 shown stage 2's whole output,
 * the stage 3, 4 and 5 prompts no longer binding the lists (or calling them
 * advisory again), the stage 4 ceiling no longer counting the blocks, the
 * attribution rule weakened three ways, and the skill naming a make or a
 * number, and the evidence-lens and stage 2 prompts reverting to wording that
 * called the lists writer-free or advisory. It adds seven captured paths: the
 * registry, stage 4's module, stage 2's module (where the shared renderers now
 * live — the earlier mutation of the evidence lens's caveat block was
 * repointed there, its id and expected checks unchanged), the stage 2, stage 3
 * and stage 4 prompts, and the skill.
 *
 * The last group (M418-M445) covers evidence-pack scoping in the local CLI, the
 * shop's identity records bound on every stage 5 platform by code, and stage
 * 2's whitelist at 16: the pack builder or the CLI dropping the always-included
 * records under a scope, an unscoped run's record or fingerprint changing, the
 * scope leaving the fingerprint, the tags no longer normalized, an empty scope
 * read as none, a missing always-included record no longer refused, a replay
 * rebuilding with the command line's scope or accepting a different one or a
 * different always-included set, `--list-tags` running on into a run, printing
 * claim text or accepting a goal, the full run's identity preflight dropped, an
 * identity record read from outside the usable facts or with any attribute, the
 * identity module typing a make, stage 5's claim set or per-platform bindings
 * losing the identity records or binding one twice, the identity records
 * rescuing a script with no used claims, stage 5's and the critic's claim-block
 * ceilings no longer counting them, the contract counting one, and stage 2's
 * whitelist, or its prompt, going back to 12, and stage 5's prompt dropping the
 * descriptive-use rule for makes. It adds one captured path, the identity
 * module; the CLI, the pack builder, stage 5, the contract and both prompts
 * were already captured.
 *
 * The final appended mutation (M446) changes one of Lane S's owner-approved
 * values in `config/approved-facts.json` and requires the exact-text regression
 * to name the drift. The configuration file is captured and restored like every
 * other target; no authoritative byte is ever mutated.
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
// The deterministic contact line and the surfaces that must agree with it.
// The CLI and the prompts are read at runtime, so mutating them needs no rebuild.
const CONTACT_LINE = "src/harness/agents/contactLine.ts";
const CONTENT_RUN_CLI = "scripts/local/content-run.mjs";
const PACKAGING_PROMPT = "agents/packaging-adaptation.md";
// The critic panel's evidence-fidelity lens prompt: the prompt that carries the
// contact-line rule since the single critic prompt was split into four lenses.
const EVIDENCE_LENS_PROMPT = "agents/final-critic-evidence.md";
// Stage 2's restrictions bind the writing stages, and every writer loads the
// claim-boundaries skill. The prompts and the skill are read at runtime, so
// mutating them needs no rebuild.
const REGISTRY = "src/harness/agents/registry.ts";
const AUTOMOTIVE_TRUTH = "src/harness/agents/automotiveTruth.ts";
const PRODUCTION_DIRECTION = "src/harness/agents/productionDirection.ts";
const SCRIPT_PROMPT = "agents/hook-story-script.md";
const DIRECTION_PROMPT = "agents/production-direction.md";
const CLAIM_BOUNDARIES_SKILL = "skills/claim-boundaries/SKILL.md";
const TRUTH_PROMPT = "agents/automotive-truth.md";
// The shop's identity records, bound on every stage 5 platform by code.
const IDENTITY_FACTS_MODULE = "src/harness/agents/identityFacts.ts";
const APPROVED_FACTS = "config/approved-facts.json";

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

// The field-classification margins. Appended after every earlier group so no
// existing mutation id moves. Each targets `payloadContract.ts` alone — the
// classification, the stated figures and the enforced limits all live there.
const FIELD_MARGIN_MUTATIONS = [
  {
    name: "an internal-plumbing margin is narrowed below the declared minimum",
    file: PAYLOAD,
    from: "  rationaleChars: 6_000,",
    to: "  rationaleChars: 3_000,",
    expect: ["CD0c."],
  },
  {
    name: "a plumbing margin pushes a policy's derived output floor past its model's output cap",
    file: PAYLOAD,
    from: "  summaryChars: 800,",
    to: "  summaryChars: 3_000,",
    expect: ["CC19a.", "CC22."],
  },
  {
    name: "a product-bearing field is given a hidden margin",
    file: PAYLOAD,
    // The critic's fields are keyed per lens since the narrow critic panel; a
    // lens summary is product-bearing and must not be given a stated figure.
    from: '  "packaging-adaptation.claimUse[].summary": 400,',
    to: '  "packaging-adaptation.claimUse[].summary": 400,\n  "final-critic:evidence-fidelity.summary": 750,',
    expect: ["CD0f."],
  },
  {
    name: "a plumbing field is reclassified product-bearing while keeping its margin",
    file: PAYLOAD,
    from: '  "strategy-concept.rationale": plumbing(',
    to: '  "strategy-concept.rationale": product(',
    expect: ["CD0f."],
  },
  {
    name: "a plumbing character field loses its stated figure, so the prompt's number no longer matches",
    file: PAYLOAD,
    from: '  "automotive-truth.assessment": 2_000,\n',
    to: "",
    expect: ["CD0f.", "CD2 (automotive-truth)."],
  },
];

// The critic on Claude Opus 5.5, the reviewer-only margin, stop-reason
// handling and the Google Business Profile keyword cap. Appended after every
// earlier group so no existing mutation id moves.
const CRITIC_POLICY_MUTATIONS = [
  {
    name: "the model-keyed rule that some models reject disabled thinking at every effort is dropped",
    file: MODEL_POLICY,
    from: '  if (thinking.type === "disabled" && MODELS_REQUIRING_THINKING.has(model)) {',
    to: '  if (false && thinking.type === "disabled" && MODELS_REQUIRING_THINKING.has(model)) {',
    expect: ["CI3.", "CI4.", "CI6."],
  },
  {
    name: "the critic's declared effort is validated and then silently not sent",
    file: STAGE_EXECUTION,
    from: "      ...(resolved.effort !== undefined ? { effort: resolved.effort } : {}),",
    to: "",
    expect: ["CI5."],
  },
  {
    name: "the critic's budget falls back to its contract floor, leaving no room for thinking",
    file: MODEL_POLICY,
    from: "  critic: POLICY_MODEL_OUTPUT_CAPS.critic,\n};",
    to: "  critic: POLICY_OUTPUT_TOKEN_FLOORS.critic!,\n};",
    expect: ["CC19.", "CC21.", "CI1.", "CI5."],
  },
  {
    name: "the thinking reserve grows past the critic's headroom under its cap",
    file: MODEL_POLICY,
    from: "export const THINKING_RESERVE_TOKENS = 16_000;",
    to: "export const THINKING_RESERVE_TOKENS = 20_000;",
    expect: ["CC19.", "CC19b."],
  },
  {
    name: "the stage path stops checking stop_reason before reading content",
    file: SDK,
    from: "    assertStageResponseComplete(response, model, request.max_tokens);\n",
    to: "",
    expect: ["CH1.", "CH2.", "CH3.", "CH4.", "CH6."],
  },
  {
    name: "a refusal is no longer named as a refusal",
    file: SDK,
    from: '    case "refusal":\n      throw new StageRefusalError(model, response);\n',
    to: "",
    expect: ["CH2.", "CH3.", "CH6."],
  },
  {
    name: "the reviewer-only margin allow-list is widened to a second product-bearing field",
    file: PAYLOAD,
    // Per lens since the narrow critic panel: the allow-list is each lens's
    // findings[].issue, and widening it to a lens summary must fail.
    from: "  CRITIC_LENSES.map((lens) => `${criticLensSpecId(lens)}.findings[].issue`),\n);",
    to: "  [...CRITIC_LENSES.map((lens) => `${criticLensSpecId(lens)}.findings[].issue`), "
      + '"final-critic:evidence-fidelity.summary"],\n);',
    expect: ["CD0f2."],
  },
  {
    name: "the critic issue margin is collapsed back onto its stated figure",
    file: PAYLOAD,
    from: "  issueChars: 600,",
    to: "  issueChars: 400,",
    expect: ["CD0c."],
  },
  {
    name: "Google Business Profile's local keyword cap is widened back to the pipeline ceiling",
    file: PACKAGING,
    from: "  google_business_profile: GBP_LOCAL_KEYWORD_MAX,\n};",
    to: "  google_business_profile: PACKAGING_FIELD_LIMITS.maxLocalKeywords,\n};",
    expect: ["BQ36a.", "CD7a (google_business_profile)."],
  },
];

// The deterministic contact line: attached by code after stage 5, copied byte
// for byte from the approved-facts records, with room reserved for it in each
// platform's limit. Appended after every earlier group so no existing mutation
// id moves.
const CONTACT_LINE_MUTATIONS = [
  {
    name: "stage 5's validator stops subtracting the contact-line reserve from the caption budget",
    file: PACKAGING,
    from: "    const captionBudget = captionMax - contactReserve;",
    to: "    const captionBudget = captionMax;",
    expect: ["BX18.", "CK7.", "CK9."],
  },
  {
    name: "a contact reserve moves in the contract while the prompt keeps the old caption budget",
    file: PAYLOAD,
    from: "  facebook: 192,",
    to: "  facebook: 133,",
    expect: ["CD6 (facebook).", "CD3 (packaging-adaptation)."],
  },
  {
    name: "the critic's packaging ceiling stops counting the call-to-action link",
    file: PAYLOAD,
    from: "    + CONTACT_TEXT_MAX_CHARS // contact text, at the widest reserve less its separator\n"
      + "    + CONTACT_CTA_URL_CHARS\n",
    to: "    + CONTACT_TEXT_MAX_CHARS // contact text, at the widest reserve less its separator\n",
    expect: ["CK13b."],
  },
  {
    name: "the critic stops comparing a supplied contact line with the one rebuilt from the pack",
    file: CONTACT_LINE,
    from: "    if (canonicalJson(suppliedContacts[index]) !== canonicalJson(pkg.contact)) {",
    to: "    if (false && canonicalJson(suppliedContacts[index]) !== canonicalJson(pkg.contact)) {",
    expect: ["CK10.", "CK11."],
  },
  {
    name: "the critic stops requiring a contact line on every package",
    file: CONTACT_LINE,
    from: '    if (!("contact" in (entry as Record<string, unknown>))) {',
    to: "    if (false) {",
    expect: ["CK10."],
  },
  {
    name: "a contact value is normalized instead of copied byte for byte",
    file: CONTACT_LINE,
    from: "  const value = record!.claim.slice(prefix.length);",
    to: '  const value = record!.claim.slice(prefix.length).replace(/[()]/g, "");',
    expect: ["CK1.", "CG11."],
  },
  {
    name: "the Instagram template drifts from the owner-reviewed wording",
    file: CONTACT_LINE,
    from: "text: `Call ${values.shop}: ${values.phone}`, sourceFactIds };",
    to: "text: `Call us: ${values.phone}`, sourceFactIds };",
    expect: ["CK1.", "CG11."],
  },
  {
    name: "a missing contact record no longer fails closed with a named error",
    file: CONTACT_LINE,
    from: "  if (!record) {\n    fail(",
    to: "  if (false) {\n    fail(",
    expect: ["CK4.", "CK4a."],
  },
  {
    name: "the summary footer is hardcoded to the fake runner again",
    file: CONTENT_RUN_CLI,
    from: '  lines.push("---", summaryFooter(runner));',
    to: '  lines.push("---", "_Fake-runner output. Not reviewed. Not publishable. Authorizes nothing._");',
    expect: ["CE8."],
  },
  {
    name: "the full run hands the critic stage 5's output without its contact lines",
    file: CONTENT_RUN_CLI,
    from: "    scriptOutput: script.output, directionOutput: direction.output, packagingOutput: contacted,",
    to: "    scriptOutput: script.output, directionOutput: direction.output, packagingOutput: packaging.output,",
    expect: ["CG1.", "CE9."],
  },
  {
    name: "the full run no longer checks the contact records before any spend",
    file: CONTENT_RUN_CLI,
    from: "  // stages. All three are in the pack already built, so check now, for free.\n"
      + "  rt.contact.assertContactFactsAvailable(pack, platforms);\n",
    to: "",
    expect: ["CE9."],
  },
  {
    name: "stage 5's prompt no longer tells the model not to name a contact or booking channel",
    file: PACKAGING_PROMPT,
    from: "- **No contact or booking channels.** Do not name a phone number, a website, online booking, "
      + "or any other way to reach the shop, in a caption,",
    to: "- Do not name any other way to reach the shop, in a caption,",
    expect: ["CK15."],
  },
  {
    name: "the critic's prompt no longer says a contact line is never an uncited implication",
    file: EVIDENCE_LENS_PROMPT,
    from: "Do not flag a contact line, or the link inside it, as an `uncited_implication` or a "
      + "`claim_fidelity` problem — no stage wrote it. ",
    to: "",
    expect: ["CK16."],
  },
  {
    name: "a caption refused on UTF-8 bytes under the reserve-lowered budget no longer names the reserve",
    file: PACKAGING,
    from: "    fail(`\"${field}\" exceeds ${max} UTF-8 bytes or contains non-serializable text${note}`);",
    to: "    fail(`\"${field}\" exceeds ${max} UTF-8 bytes or contains non-serializable text`);",
    expect: ["CK9c."],
  },
];

/**
 * The narrow critic panel: final-critic reviews through four lenses — one
 * request per lens, concurrently, no retries — and code aggregates the four
 * validated answers. Each mutation breaks one of the panel's load-bearing
 * rules: the lens category restriction, the aggregation verdict rule, the
 * no-merge deterministic summary and the no-dedup union, the reviewer-only
 * caveat exposure, fail-closed on one lens failing, the lens-scoped
 * instruction channel, the lens label never reaching the provider, the
 * per-lens budget, and the shop name read from its approved-facts record.
 * Appended after every earlier group, so no existing id moves.
 */
const CRITIC_PANEL_MUTATIONS = [
  {
    name: "a lens accepts every category, not only its own and human_decision",
    file: FINAL_CRITIC,
    from: "      category: requireEnum(lensFail, obj.category, categories, `findings[${index}].category`),",
    to: "      category: requireEnum(lensFail, obj.category, CRITIC_FINDING_CATEGORIES, `findings[${index}].category`),",
    expect: ["CL1.", "CL5."],
  },
  {
    name: "the voice lens is widened into the evidence lens's category",
    file: FINAL_CRITIC,
    from: '  "voice-and-craft": ["voice_clarity", "human_decision"],',
    to: '  "voice-and-craft": ["voice_clarity", "claim_fidelity", "human_decision"],',
    expect: ["CL2.", "CL5."],
  },
  {
    name: "the panel verdict ignores blocking findings owned by a revisable stage",
    file: FINAL_CRITIC,
    from: '  if (blocking.some((f) => REVISABLE_OWNERS.has(f.owner))) return "needs_revision";\n',
    to: "",
    expect: ["CL9.", "BT1."],
  },
  {
    name: "the panel verdict ignores human_decision findings",
    file: FINAL_CRITIC,
    from: '\n    || findings.some((f) => f.category === "human_decision")',
    to: "",
    expect: ["CL8."],
  },
  {
    name: "the panel verdict ignores a lens's own needs_human_review verdict",
    file: FINAL_CRITIC,
    from: '\n    || lensOutputs.some((o) => o.provisional.verdict === "needs_human_review")) {',
    to: ") {",
    expect: ["CL10."],
  },
  {
    name: "the panel summary merges the lenses' model-written summaries",
    file: FINAL_CRITIC,
    from: "      summary: criticPanelSummary(lensOutputs, verdict),",
    to: '      summary: lensOutputs.map((o) => o.provisional.summary).join(" "),',
    expect: ["CL14.", "CL15.", "BT10."],
  },
  {
    name: "each lens's summary is replaced by a merge of every lens's summary",
    file: FINAL_CRITIC,
    from: "        summary: o.provisional.summary,",
    to: '        summary: lensOutputs.map((x) => x.provisional.summary).join(" "),',
    expect: ["CL15.", "BT10."],
  },
  {
    name: "the aggregator deduplicates identical findings across lenses",
    file: FINAL_CRITIC,
    from: "    findings.push(...output.provisional.findings);",
    to: "    findings.push(...output.provisional.findings.filter((f) => !findings.some((g) => g.issue === f.issue)));",
    expect: ["CL12."],
  },
  {
    name: "stage 2's caveats reach the voice lens too",
    file: PAYLOAD,
    from: '    { label: "COPY", bodyChars: VOICE_COPY_BLOCK_CHARS },\n',
    to: '    { label: "COPY", bodyChars: VOICE_COPY_BLOCK_CHARS },\n'
      + '    { label: "REQUIRED_CAVEATS", bodyChars: REQUIRED_CAVEATS_BLOCK_CHARS },\n',
    expect: ["BU11."],
  },
  {
    name: "the evidence lens's caveat block carries stage 2's withheld assessment",
    // The renderer moved to stage 2's module, shared with stages 4 and 5.
    file: AUTOMOTIVE_TRUTH,
    from: "  return JSON.stringify(truthOutput.provisional.requiredCaveats, null, 2);",
    to: "  return JSON.stringify([...truthOutput.provisional.requiredCaveats, truthOutput.provisional.assessment], null, 2);",
    expect: ["BU5.", "BU6."],
  },
  {
    name: "a failed lens no longer fails the panel with a named CriticPanelError",
    file: FINAL_CRITIC,
    from: "  if (lensFailures.length) {\n    throw new CriticPanelError(",
    to: "  if (lensFailures.length > 1) {\n    throw new CriticPanelError(",
    expect: ["CL18.", "CL19."],
  },
  {
    name: "a lens request's instruction channel carries every lens's prompt and skills",
    file: STAGE_EXECUTION,
    from: '    if (selected && asset.role !== "reference" && !selected.has(asset.path)) {',
    to: "    if (false) {",
    expect: ["BV1.", "BV11.", "BV12."],
  },
  {
    name: "a multi-prompt stage may run without naming its instruction assets",
    file: STAGE_EXECUTION,
    from: '  } else if (assets.filter((a) => a.role === "prompt").length > 1) {',
    to: "  } else if (false) {",
    expect: ["CL22."],
  },
  {
    name: "the production runner forwards the lens label to the provider request",
    file: STAGE_EXECUTION,
    from: "    ...(request.responseFormatSchema ? { responseFormatSchema: request.responseFormatSchema } : {}),",
    to: "    ...(request.responseFormatSchema ? { responseFormatSchema: request.responseFormatSchema } : {}),\n"
      + "    ...(request.lens !== undefined ? { lens: request.lens } : {}),",
    expect: ["CL26."],
  },
  {
    name: "a lens contract grows past the thinking reserve under the critic's max_tokens",
    file: PAYLOAD,
    from: "    maxFindings: CRITIC_FIELD_LIMITS.maxFindings,",
    to: "    maxFindings: CRITIC_FIELD_LIMITS.maxFindings * 2,",
    expect: ["CC19c."],
  },
  {
    name: "the contact line's shop name is typed into the module again instead of read from its record",
    file: CONTACT_LINE,
    from: "text: `Call ${values.shop}: ${values.phone}`, sourceFactIds };",
    to: "text: `Call German Car Depot: ${values.phone}`, sourceFactIds };",
    expect: ["CK4c."],
  },
  {
    name: "Instagram's contact line stops reading the shop record",
    file: CONTACT_LINE,
    from: '  instagram: ["shop", "phone"],',
    to: '  instagram: ["phone"],',
    expect: ["CK2.", "CK4d."],
  },
];

/**
 * The owner-aware panel verdict and the evidence lens's per-shot bindings on
 * `OVERLAY_TEXT`. Appended after every earlier group so no existing id moves.
 */
const CRITIC_PANEL_FOLLOW_UP_MUTATIONS = [
  {
    name: "the panel verdict reverts to any blocking finding -> needs_revision, whatever its owner",
    file: FINAL_CRITIC,
    from: '  if (blocking.some((f) => REVISABLE_OWNERS.has(f.owner))) return "needs_revision";',
    to: '  if (blocking.length > 0) return "needs_revision";',
    expect: ["CL27.", "CL27b.", "BY16."],
  },
  {
    name: "the panel verdict ignores a blocking finding owned by human_review",
    file: FINAL_CRITIC,
    from: '  if (blocking.some((f) => f.owner === "human_review")\n    || findings',
    to: "  if (findings",
    expect: ["CL27b."],
  },
  {
    name: "the human-review arm is decided before the revision arm",
    file: FINAL_CRITIC,
    from: '  if (blocking.some((f) => REVISABLE_OWNERS.has(f.owner))) return "needs_revision";\n'
      + '  if (blocking.some((f) => f.owner === "human_review")\n',
    to: '  if (blocking.some((f) => f.owner === "human_review")) return "needs_human_review";\n'
      + '  if (blocking.some((f) => REVISABLE_OWNERS.has(f.owner))) return "needs_revision";\n'
      + "  if (false\n",
    expect: ["CL28."],
  },
  {
    name: "the panel verdict's last arm no longer yields provisional_pass",
    file: FINAL_CRITIC,
    from: '    return "needs_human_review";\n  }\n  return "provisional_pass";\n}',
    to: '    return "needs_human_review";\n  }\n  return "needs_human_review";\n}',
    expect: ["CL6.", "CL7."],
  },
  {
    name: "OVERLAY_TEXT drops the ids stage 4 bound to each overlay's shot",
    file: FINAL_CRITIC,
    from: "    shotFactIds: bindings.filter((b) => b.shotIndex === o.shotIndex).map((b) => b.factId),\n",
    to: "",
    expect: ["BU3.", "BU22.", "BU23."],
  },
  {
    name: "an overlay carries every stage 4 binding, not only its own shot's",
    file: FINAL_CRITIC,
    from: "bindings.filter((b) => b.shotIndex === o.shotIndex)",
    to: "bindings.filter(() => true)",
    expect: ["BU23."],
  },
  {
    name: "OVERLAY_TEXT carries stage 4's model-written direction summary beside each id",
    file: FINAL_CRITIC,
    from: ".map((b) => b.factId),\n",
    to: ".map((b) => `${b.factId}: ${b.provisionalDirectionSummary}`),\n",
    expect: ["BU3.", "BU22.", "BU24."],
  },
  {
    name: "the evidence lens is shown stage 4's complete output as well as its overlay projection",
    file: PAYLOAD,
    from: '    { label: "OVERLAY_TEXT", bodyChars: OVERLAY_TEXT_BLOCK_CHARS },\n',
    to: '    { label: "OVERLAY_TEXT", bodyChars: OVERLAY_TEXT_BLOCK_CHARS },\n'
      + '    { label: "PRODUCTION_OUTPUT", bodyChars: DIRECTION_OUTPUT.transportChars },\n',
    // BU1 cannot see it — it compares the prompt with this same contract — so
    // BU24, which checks what of stage 4 actually reached the lens, owns it.
    expect: ["BU24."],
  },
  {
    name: "the OVERLAY_TEXT ceiling stops counting the per-shot ids",
    file: PAYLOAD,
    from: "    + DIRECTION_FIELD_LIMITS.maxClaimVisuals * EVIDENCE_LIMITS.idChars\n",
    to: "",
    expect: ["BU25."],
  },
  {
    name: "the evidence lens prompt no longer tells the lens to compare overlay wording with the bound records",
    file: EVIDENCE_LENS_PROMPT,
    from: "Compare each overlay's wording with the record or records its `shotFactIds` name — the claim behind "
      + "that shot. ",
    to: "",
    expect: ["BU26."],
  },
  {
    name: "the evidence lens prompt no longer says what shotFactIds is",
    file: EVIDENCE_LENS_PROMPT,
    from: ", and **`shotFactIds`**: the ids of the records stage 4 bound to that shot, in stage 4's order.",
    to: ".",
    expect: ["BU26."],
  },
];

/**
 * Stage 2's restrictions bind the writing stages, and every writer is given the
 * claim-boundaries skill. Each mutation breaks one of: a writer loading the
 * skill, stage 4 or 5 receiving the two restriction blocks, those blocks
 * carrying nothing of stage 2 but the two lists, stages 4 and 5 never seeing
 * stage 2's assessment, the stage prompts binding the lists (and no longer
 * calling them advisory), the stage 4 ceiling counting the blocks, the
 * attribution rule, and the skill staying fact-free. Appended after every
 * earlier group so no existing id moves.
 */
const WRITER_RESTRICTION_MUTATIONS = [
  {
    name: "hook-story-script stops loading claim-boundaries",
    file: REGISTRY,
    from: '    skillPaths: ["skills/script-craft/SKILL.md", "skills/claim-boundaries/SKILL.md"],',
    to: '    skillPaths: ["skills/script-craft/SKILL.md"],',
    expect: ["CM1.", "AZ19.", "AT8."],
  },
  {
    name: "production-direction stops loading claim-boundaries",
    file: REGISTRY,
    from: '    skillPaths: ["skills/production-craft/SKILL.md", "skills/claim-boundaries/SKILL.md"],',
    to: '    skillPaths: ["skills/production-craft/SKILL.md"],',
    expect: ["CM1.", "BI20.", "BC11."],
  },
  {
    name: "packaging-adaptation stops loading claim-boundaries",
    file: REGISTRY,
    from: '    skillPaths: ["skills/adaptation-craft/SKILL.md", "skills/claim-boundaries/SKILL.md"],',
    to: '    skillPaths: ["skills/adaptation-craft/SKILL.md"],',
    expect: ["CM1.", "BS21.", "BL13."],
  },
  {
    name: "stage 4 stops sending stage 2's restriction blocks",
    file: PRODUCTION_DIRECTION,
    from: "      { label: \"SCRIPT_CLAIMS\", body: renderScriptClaims(scriptOutput, truthOutput, pack) },\n"
      + "      ...restrictionBlocks,\n",
    to: "      { label: \"SCRIPT_CLAIMS\", body: renderScriptClaims(scriptOutput, truthOutput, pack) },\n",
    expect: ["CM2."],
  },
  {
    name: "stage 5 stops sending stage 2's restriction blocks",
    file: PACKAGING,
    from: "        body: renderPackagingScriptClaims(scriptOutput, truthOutput, pack),\n      },\n"
      + "      ...restrictionBlocks,\n",
    to: "        body: renderPackagingScriptClaims(scriptOutput, truthOutput, pack),\n      },\n",
    expect: ["CM3."],
  },
  {
    name: "the writers' caveat block renders stage 2's whole provisional channel, assessment included",
    file: PRODUCTION_DIRECTION,
    from: "    REQUIRED_CAVEATS: renderRequiredCaveats(truthOutput),",
    to: "    REQUIRED_CAVEATS: JSON.stringify(truthOutput.provisional, null, 2),",
    expect: ["CM2.", "CM3.", "CM5.", "BB10.", "BK9."],
  },
  {
    name: "stage 5 is shown stage 2's complete output beside its restriction blocks",
    file: PACKAGING,
    from: "      ...restrictionBlocks,\n    ],\n  });",
    to: "      ...restrictionBlocks,\n      { label: \"TRUTH_OUTPUT\", body: JSON.stringify(truthOutput, null, 2) },\n"
      + "    ],\n  });",
    expect: ["CM3.", "CM5.", "BK9."],
  },
  {
    name: "stage 3's prompt calls stage 2's forbidden claims advisory again",
    file: SCRIPT_PROMPT,
    from: "Its `requiredCaveats` and `forbiddenClaims` are **binding restrictions** on what this script may say",
    to: "`forbiddenClaims` is advisory: it tells you what stage 2 rejected and why. Its `requiredCaveats` are "
      + "context on what this script may say",
    expect: ["CM6."],
  },
  {
    name: "stage 3's prompt stops saying the restrictions only narrow and never permit",
    file: SCRIPT_PROMPT,
    from: "These lists can only **narrow** what you may say. They never permit anything: ",
    to: "",
    expect: ["CM6."],
  },
  {
    name: "stage 3's prompt stops sending an unmet caveat to an open question",
    file: SCRIPT_PROMPT,
    from: "leave that content out of the script and record what a human would need to verify in `openQuestions`",
    to: "state what the caveat needs",
    expect: ["CM6."],
  },
  {
    name: "stage 4's prompt drops the binding-restriction section",
    file: DIRECTION_PROMPT,
    from: "## Stage 2's restrictions bind you",
    to: "## Stage 2's lists, for context",
    expect: ["CM7."],
  },
  {
    name: "stage 5's prompt stops naming FORBIDDEN_CLAIMS as an input",
    file: PACKAGING_PROMPT,
    from: "- **`FORBIDDEN_CLAIMS`** — the claims stage 2 said may not be made.\n",
    to: "",
    expect: ["CM7."],
  },
  {
    name: "stage 4's assembled ceiling stops counting the restriction blocks",
    file: PAYLOAD,
    from: "      { label: \"SCRIPT_CLAIMS\", bodyChars: SCRIPT_CLAIMS_BLOCK_CHARS },\n"
      + "      ...WRITER_RESTRICTION_BLOCKS,\n    ]),\n    \"packaging-adaptation\"",
    to: "      { label: \"SCRIPT_CLAIMS\", bodyChars: SCRIPT_CLAIMS_BLOCK_CHARS },\n    ]),\n    \"packaging-adaptation\"",
    expect: ["CM10."],
  },
  {
    name: "the attribution rule stops forbidding merged lists",
    file: CLAIM_BOUNDARIES_SKILL,
    from: "- **Never merge two sources' lists into one attributed list.**",
    to: "- **Prefer to keep two sources' lists apart.**",
    expect: ["CM8."],
  },
  {
    name: "the attribution rule stops forbidding \"both\" without each record",
    file: CLAIM_BOUNDARIES_SKILL,
    from: "  unless each named source's own record says that thing.",
    to: "  when the sources broadly agree.",
    expect: ["CM8."],
  },
  {
    name: "the attribution rule drops the one-source's-wording-over-another's rule",
    file: CLAIM_BOUNDARIES_SKILL,
    from: "- **Never place one source's wording over another source's material.**",
    to: "- **Prefer each source's wording over its own material.**",
    expect: ["CM8."],
  },
  {
    name: "claim-boundaries names a vehicle make",
    file: CLAIM_BOUNDARIES_SKILL,
    from: "When a claim names or implies a source — a manufacturer, a manual, an",
    to: "When a claim names or implies a source — a manufacturer such as BMW, a manual, an",
    expect: ["CM9.", "AL6."],
  },
  {
    name: "claim-boundaries states a number",
    file: CLAIM_BOUNDARIES_SKILL,
    from: "names three conditions and another names two",
    to: "names 3 conditions and another names 2",
    expect: ["CM9."],
  },
  {
    name: "the evidence-lens prompt says again that no writing stage after stage 3 sees the lists",
    file: EVIDENCE_LENS_PROMPT,
    from: "The writing stages (3, 4 and 5) receive these same lists as binding restrictions, so copy that "
      + "ignores them has broken a rule it was given.",
    to: "`REQUIRED_CAVEATS` and `FORBIDDEN_CLAIMS` are shown to you and to no writing stage after stage 3.",
    expect: ["CM11."],
  },
  {
    name: "stage 2's prompt calls forbiddenClaims advisory again",
    file: TRUTH_PROMPT,
    from: "`requiredCaveats` and `forbiddenClaims` are passed to stages 3–5 as binding restrictions and to the "
      + "critic as its yardstick, so write each one precisely and only where the evidence warrants it.",
    to: "`forbiddenClaims` is advisory: it tells later stages and human reviewers what you rejected and why.",
    expect: ["CM11."],
  },
];

/**
 * Evidence-pack scoping in the local CLI, the shop's identity records bound on
 * every stage 5 platform by code, and stage 2's whitelist at 16 (the owner's
 * decisions of 2026-09-25). Appended after every earlier group.
 */
const IDENTITY_SCOPE_MUTATIONS = [
  {
    name: "the pack builder stops keeping the always-included records under a scope",
    file: EVIDENCE_PACK,
    from: "  if (alwaysIncludeIds && alwaysIncludeIds.includes(record.id)) return true;\n",
    to: "",
    expect: ["CN2."],
  },
  {
    name: "a scoped run stops passing the always-included records to the pack builder",
    file: CONTENT_RUN_CLI,
    from: "    ...(scope ? { tags: scope.tags, alwaysIncludeIds: scope.alwaysIncludedIds } : {}),",
    to: "    ...(scope ? { tags: scope.tags } : {}),",
    expect: ["CN4."],
  },
  {
    name: "an unscoped run's run-meta.json gains an evidenceScope key",
    file: CONTENT_RUN_CLI,
    from: "    ...(scope ? { evidenceScope: scope } : {}),\n    ...fingerprints,",
    to: "    evidenceScope: scope,\n    ...fingerprints,",
    expect: ["CN3."],
  },
  {
    name: "the pack fingerprint stops including the scope",
    file: CONTENT_RUN_CLI,
    from: "  if (scope) hash.update(`${JSON.stringify(scope)}\\n`, \"utf8\");\n",
    to: "",
    // CN8's refusals still fire: a changed or removed scope changes the pack
    // itself, so the projection alone no longer matches the recorded digest.
    expect: ["CN4."],
  },
  {
    name: "the pack fingerprint hashes a scope even when there is none",
    file: CONTENT_RUN_CLI,
    from: "  if (scope) hash.update(`${JSON.stringify(scope)}\\n`, \"utf8\");\n",
    to: "  hash.update(`${JSON.stringify(scope)}\\n`, \"utf8\");\n",
    expect: ["CN3."],
  },
  {
    name: "the scope tags stop being sorted and deduplicated",
    file: CONTENT_RUN_CLI,
    from: ".map((t) => t.trim()).filter(Boolean))].sort();",
    to: ".map((t) => t.trim()).filter(Boolean))];",
    expect: ["CN4."],
  },
  {
    name: "an empty --scope-tags is read as no scope",
    file: CONTENT_RUN_CLI,
    from: "  if (!tags.length) throw new Error(\"--scope-tags needs at least one tag (a,b,c); omit the flag for no scope\");",
    to: "  if (!tags.length) return undefined;",
    expect: ["CN5."],
  },
  {
    name: "a scoped run stops refusing when an always-included record was not loaded",
    file: CONTENT_RUN_CLI,
    from: "    if (missing.length) {\n      throw new EvidenceScopeError(",
    to: "    if (false && missing.length) {\n      throw new EvidenceScopeError(",
    expect: ["CN13."],
  },
  {
    name: "a replay rebuilds with the command line's scope instead of the source run's",
    file: CONTENT_RUN_CLI,
    from: "    scopeTags: recordedTags ?? undefined,",
    to: "    scopeTags: args.scopeTags,",
    expect: ["CN6."],
  },
  {
    name: "a replay stops refusing a --scope-tags that differs from the recorded scope",
    file: CONTENT_RUN_CLI,
    from: "  if (args.scopeTags && JSON.stringify(args.scopeTags) !== JSON.stringify(recordedTags)) {",
    to: "  if (false) {",
    expect: ["CN7."],
  },
  {
    name: "a replay stops comparing the recorded always-included records with this CLI's",
    file: CONTENT_RUN_CLI,
    from: "    if (JSON.stringify(recordedScope.alwaysIncludedIds) !== JSON.stringify(currentAlways)) {",
    to: "    if (false) {",
    expect: ["CN8."],
  },
  {
    name: "--list-tags no longer returns before the run is built",
    file: CONTENT_RUN_CLI,
    from: "  if (args.listTags) return listTags(rt, args);\n",
    to: "",
    expect: ["CN9.", "CN11."],
  },
  {
    name: "--list-tags prints claim text",
    file: CONTENT_RUN_CLI,
    from: "  for (const tag of tags) console.log(`${tag.padEnd(width)}  ${counts.get(tag)}`);",
    to: "  for (const tag of tags) console.log(`${tag.padEnd(width)}  ${counts.get(tag)}`);\n"
      + "  for (const record of records) console.log(record.claim);",
    expect: ["CN10."],
  },
  {
    name: "--list-tags accepts a goal",
    file: CONTENT_RUN_CLI,
    from: "  if (args.listTags && (args.replayCritic || args.goal !== undefined)) {",
    to: "  if (false) {",
    expect: ["CN12."],
  },
  {
    name: "a full run drops the free identity preflight",
    file: CONTENT_RUN_CLI,
    from: "  // the critic would refuse after four paid stages. Check now, for free.\n"
      + "  rt.identity.assertIdentityFactsAvailable(pack);\n",
    to: "  // the critic would refuse after four paid stages. Check now, for free.\n",
    expect: ["CN14."],
  },
  {
    name: "an identity record is accepted from outside the usable facts",
    file: IDENTITY_FACTS_MODULE,
    from: "  const record = (pack?.allowedFacts ?? []).find((r) => r.id === id);",
    to: "  const record = [...(pack?.allowedFacts ?? []), ...(pack?.staleEvidence ?? []), "
      + "...(pack?.conflictedEvidence ?? [])].find((r) => r.id === id);",
    expect: ["CN17."],
  },
  {
    name: "an identity record's attribute stops being checked",
    file: IDENTITY_FACTS_MODULE,
    from: "  if (record.attribute !== field) {\n"
      + "    fail(`\"${id}\" carries attribute ${JSON.stringify(record.attribute)}, not \"${field}\"`);\n  }\n",
    to: "",
    expect: ["CN17."],
  },
  {
    name: "the identity module types a make",
    file: IDENTITY_FACTS_MODULE,
    from: "  makes: { id: \"approved-facts:makes\", field: \"makes\" },",
    to: "  makes: { id: \"approved-facts:makes\", field: \"makes\", example: \"BMW\" },",
    expect: ["CN23."],
  },
  {
    name: "stage 5's claim set stops carrying the identity records",
    file: PACKAGING,
    from: "  return [...used, ...identityFactRecords(pack).filter((record) => !usedIds.has(record.id))];",
    to: "  return used;",
    expect: ["CN19.", "BK6."],
  },
  {
    name: "code stops binding the identity records on every platform",
    file: PACKAGING,
    from: "  return [...modelBound, ...identityFactRecords(pack).filter((record) => !boundIds.has(record.id))];",
    to: "  return modelBound;",
    expect: ["CN20.", "CN21."],
  },
  {
    name: "an identity record the model also cited is bound twice",
    file: PACKAGING,
    from: "  return [...modelBound, ...identityFactRecords(pack).filter((record) => !boundIds.has(record.id))];",
    to: "  return [...modelBound, ...identityFactRecords(pack)];",
    expect: ["CN20."],
  },
  {
    name: "the identity records rescue a script with no used claims",
    file: PACKAGING,
    from: "  const usedClaims = scriptUsedClaimRecordsForPackaging(scriptOutput, truthOutput, pack);",
    to: "  const usedClaims = packagingClaimUniverse(scriptOutput, truthOutput, pack);",
    // The model call is then made (BO2); the canned answer still fails
    // validation afterwards, so BO1's rejection alone does not speak.
    expect: ["BO2."],
  },
  {
    name: "stage 5's SCRIPT_CLAIMS ceiling stops counting the identity records",
    file: PAYLOAD,
    from: "  SCRIPT_FIELD_LIMITS.maxClaimUses + IDENTITY_CLAIM_MAX_RECORDS,\n);",
    to: "  SCRIPT_FIELD_LIMITS.maxClaimUses,\n);",
    expect: ["CN27."],
  },
  {
    name: "PLATFORM_CLAIMS stops counting the identity ids",
    file: PAYLOAD,
    from: "    * (PACKAGING_FIELD_LIMITS.maxClaimUses + IDENTITY_CLAIM_MAX_RECORDS)\n",
    to: "    * PACKAGING_FIELD_LIMITS.maxClaimUses\n",
    expect: ["CN27."],
  },
  {
    name: "the contract counts one identity record",
    file: PAYLOAD,
    from: "export const IDENTITY_CLAIM_MAX_RECORDS = 2;",
    to: "export const IDENTITY_CLAIM_MAX_RECORDS = 1;",
    expect: ["CN15."],
  },
  {
    name: "stage 2's whitelist goes back to 12",
    file: PAYLOAD,
    from: "  maxAllowedClaims: 16,",
    to: "  maxAllowedClaims: 12,",
    expect: ["CN26."],
  },
  {
    name: "stage 2's prompt states 12 allowed claims again",
    file: TRUTH_PROMPT,
    from: "  \"allowedClaims\": [                // at most 16 entries",
    to: "  \"allowedClaims\": [                // at most 12 entries",
    expect: ["CN25."],
  },
  {
    name: "stage 5's prompt drops the descriptive-use rule for makes",
    file: PACKAGING_PROMPT,
    from: "- **A make is descriptive use only.** ",
    to: "- A make may be named. ",
    expect: ["CN24."],
  },
];

const LANE_S_APPROVED_FACTS_MUTATIONS = [
  {
    name: "a Lane S owner-approved value changes",
    file: APPROVED_FACTS,
    from: "This is our professional judgment and hands-on experience, not the result of oil-analysis testing.",
    to: "This is our professional judgment and documented analysis, not the result of oil-analysis testing.",
    expect: ["CO2."],
  },
];

const MUTATIONS = [
  ...LEGACY_MUTATIONS, ...RAW_IDENTITY_MUTATIONS, ...FIELD_MARGIN_MUTATIONS, ...CRITIC_POLICY_MUTATIONS,
  ...CONTACT_LINE_MUTATIONS, ...CRITIC_PANEL_MUTATIONS, ...CRITIC_PANEL_FOLLOW_UP_MUTATIONS,
  ...WRITER_RESTRICTION_MUTATIONS, ...IDENTITY_SCOPE_MUTATIONS, ...LANE_S_APPROVED_FACTS_MUTATIONS,
];

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
