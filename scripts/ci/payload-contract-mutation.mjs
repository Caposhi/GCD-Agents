#!/usr/bin/env node
/**
 * Focused mutation tests for the payload-contract derivations.
 *
 * A regression that cannot fail is decoration. This script proves each
 * load-bearing derivation in `src/harness/agents/payloadContract.ts` and the
 * related repository-authority controls is actually load-bearing across thirty-nine
 * captured paths: it applies one focused mutation in a disposable no-Git copy,
 * rebuilds there, runs the Content Intelligence offline suite, and
 * requires the NAMED check that owns that derivation to fail. Then it restores
 * the file byte-for-byte — verified by SHA-256 against the bytes captured
 * before the mutation — rebuilds, and requires the suite to pass again.
 *
 * The rebuild is skipped only where it cannot matter: `dist/` is compiled from
 * `src/` alone, and the suite reads `state/**` at RUNTIME, so a mutation to a
 * SQL file needs no compile. A `src/` mutation's restore is rebuilt AT ONCE,
 * before its worker takes the next mutation, so no copy's `dist/` is ever left
 * compiled from mutated sources: the rule is still "rebuild whenever `dist/`
 * could differ from its sources". Nothing else changes: every mutation still
 * runs the whole suite, and a `src/` mutation that fails to compile is still
 * not a pass.
 *
 * The builds are INCREMENTAL. Each worker keeps one long-lived compiler for its
 * own copy (`--incremental-build-server` below): TypeScript's own builder
 * program, which `tsc --incremental` is built on, holding the previous program
 * in memory, so an unchanged file is neither re-parsed nor re-checked, and a
 * one-file mutation re-checks and re-emits only what it affects. Errors are
 * decided by `tsc`'s own `emitFilesAndReportErrorsAndGetExitStatus`. It is still
 * a full type-check of everything affected: nothing is transpiled without
 * checking. It is proven, not trusted:
 *   - `M-inc0`: every copy's first build is byte-identical to a clean full build
 *     (`tsc -p tsconfig.json`, no incremental state) of the same sources;
 *   - `M-inc-restore`: after EVERY compiled mutation, the rebuild of the restored
 *     sources is byte-identical to that clean build;
 *   - `M-inc-end`: after its last mutation, each worker does a fresh clean full
 *     build and requires its incremental `dist/` to be byte-identical to it,
 *     before the final suite pass (`M-end`);
 *   - `M-inc-tsc`: a source state holding an injected type error fails real `tsc`
 *     AND the incremental compiler (non-zero status), and both return 0 once it
 *     is removed — the two agree on the case that decides "did not compile";
 *   - `M-inc-fault`: the comparison and the compiler's error verdict are shown
 *     to FAIL on injected faults — a type error is refused, and an orphaned
 *     output, a stale output that the incremental compiler does not re-emit, and
 *     a missing file are each reported as a difference from the clean build.
 *   - `M-inc-sample` (Content Studio S2): for exactly four compiled mutations,
 *     each from a different group, chosen deterministically from a seed
 *     (`GITHUB_SHA` when set, else INC_SAMPLE_DEFAULT_SEED) so successive
 *     commits sample different mutations, the MUTATED sources also get a clean
 *     `tsc` build (into the worker's own `sample-dist/`), which must be
 *     byte-identical to the incremental `dist/` the suite ran against; the seed
 *     and the sampled ids are printed. `M-inc-sample-fault` shows that
 *     comparison failing on a source edited and not rebuilt.
 * The suite runs with Node's compile cache in the worker's own directory, which
 * caches V8 bytecode for byte-identical module sources only; it changes no
 * result. A mutation may name the suite it runs (`suite`; the Content
 * Intelligence suite by default); `M0` and `M-end` require every such suite to
 * pass in every copy.
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
 * The next group (M418-M445) covers evidence-pack scoping in the local CLI, the
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
 * The next appended mutation (M446) changes one of Lane S's owner-approved
 * values in `config/approved-facts.json` and requires the exact-text regression
 * to name the drift. The configuration file is captured and restored like every
 * other target; no authoritative byte is ever mutated.
 *
 * The next appended group (M447-M453) covers stage 5's `claimUse` cap, derived
 * as stage 3's claim-use cardinality times the contract's maximum
 * requested-platform count: the cap going back to a fixed 24, being hand-kept
 * at today's product, or multiplying a typed platform count; the validator
 * no longer counting a model-listed identity entry toward the cap, or letting
 * one entry past it; and the prompt stating the old cap or letting the model
 * list the identity records again.
 * It adds no captured path.
 *
 * The next appended group (M454-M465) covers stage 5's caption target stated
 * below its enforced budget, and `--resume-from packaging-adaptation`: the
 * target collapsing onto the budget, moving to 88% or rounding up; the
 * validator enforcing the target instead of the budget; the response schema or
 * the prompt stating the budget; the run's measurement reporting the budget as
 * the stated figure; and a resume no longer requiring the pack fingerprint,
 * accepting another resume point, pricing a whole run, skipping stage 4's
 * revalidation, or dropping the typed LIVE guard. It adds no captured path.
 *
 * The next appended group (M466-M468) covers the comparison rule in
 * `skills/claim-boundaries`: a comparison is its own claim, needing a record
 * that states it, credited to the source whose record makes it; the rule no
 * longer requiring that record, crediting the comparison to the source quoted
 * beside it, or carrying the motivating runs' own wording. It adds no captured
 * path.
 *
 * The next appended group (M469-M492) covers the opt-in revision pass: a
 * stage's findings cap typed instead of derived, sized without PREVIOUS_OUTPUT,
 * or its ceiling without the escaping allowance; MAX_PAYLOAD_CHARS raised to fit
 * an uncapped request; a stage accepting another stage's, a human_decision or an
 * over-cap finding; the plan sending a human_decision finding, starting at the
 * latest blocking owner, not re-running later stages, keeping advisory findings
 * ahead of blocking ones, or not refusing blocking findings over a cap; the CLI
 * not recording dropped findings, handing round 2's critic round 1's findings,
 * skipping the saved panel's revalidation or the recorded fingerprints, writing
 * a failure into round 1's directory, proceeding with nothing to revise,
 * dropping the typed LIVE gate, pricing a whole run, or making a second round;
 * stage 4 not appending the blocks; and the prompts dropping stage 4's
 * contact-in-overlay rule or letting a finding permit. It adds two captured
 * paths: `revision.ts` and `revisionInput.ts`.
 *
 * The next appended group (M493-M507) covers stage 4's contact-in-overlay
 * rule enforced in code: the validator no longer calling the check; the North
 * American, 7-digit local and digit-run guards of the phone pattern, the
 * approved phone digits, the bare-domain and email URL patterns and the
 * approved booking host each dropped; a phrase removed from, or bare "visit"
 * added to, the closed call-to-action list; NFKC, whitespace collapsing or
 * case folding dropped; the refusal echoing the overlay text; and the prompt
 * no longer saying code rejects it. It adds one captured path:
 * `overlayContact.ts`.
 *
 * Content Studio S1 moved the local CLI's pipeline core into
 * `src/harness/contentRun/**`. Twenty-six earlier mutations that targeted
 * `scripts/local/content-run.mjs` now target the library file holding the code
 * they break, with their ids and expected checks unchanged; six stay on the CLI,
 * whose argument parsing, `--list-tags` printing and dispatch did not move
 * (M423, M424, M429-M431, M462). Where the typed library needed it, a `to` text
 * was adapted to compile the same break: M365, M481 and M486 gained a type
 * cast, M427 a runtime-false guard, and M482 passes its extra key by spread;
 * M485 relabels the failure sink as the source directory, since the library
 * holds no directory of its own; M489 starts its second round from the same
 * source; and M465 and M487 drop the injected consent call.
 *
 * The final appended group (M508-M522) covers S1 itself: the library's
 * scope-tag normalizer and resume points drifting from the CLI's parse-time
 * copies; a live full run never asking the injected consent; a replay ignoring
 * the injected UNPROVEN refusal; a live entry point importing the library, an
 * intermediary that names no executor but reaches one, or a computed import;
 * a shared live module lazily importing `revision.js`; the library reaching the
 * posting tool; the walked entry points dropping one; a script outside the
 * caller allowlist importing the library, or the allowlist widened to all of
 * `src/studio`; and undeclared live-path edits — to a shared module, a
 * comment-only one to an entry point, and the manifest no longer naming a live
 * module. Its checks are CS1-CS6. It adds eleven captured paths: seven library
 * files, the scheduler entry point, the tekmetric probe script, the guards
 * module and the live-path manifest (thirty-nine in all).
 *
 * The Content Studio S2 group (M523-M533) covers the Studio migration runner's
 * offline-testable refusals and runs the Studio offline suite
 * (`dist/studio/db/migrate.offline.selftest.js`): the DATABASE_URL refusal, the
 * STUDIO_DATABASE_URL-only read (a fallback to DATABASE_URL's value, a
 * look-alike variable read first, the presence no longer reported), the
 * migration-sha256 refusal, and the identity decision (another database name,
 * live-schema tables, a live ledger, a missing identity row, any _migrations
 * read as the tripwire, and identity decided only after statements have run).
 * Its checks are SM1-SM5. It adds two captured paths, the runner and its entry
 * point (forty-one in all).
 *
 * The Content Studio S3 groups follow. `M534`–`M546` cover the review-only
 * execution context (design §5.4): each paid path of the library no longer
 * requiring it, the verifier accepting a look-alike, the context gaining an
 * approval capability, the constructor accepting another caller, the
 * construction allowlist widened, a live module naming the context, and the
 * context's module gaining a run-time import (`CS7`–`CS9`, `CS3`); and the
 * library's per-unit check skipped, checked per lens, or letting an unpriced
 * request through (`SW7`–`SW7b`, run in the Studio worker's offline suite, the
 * only tree besides the CLI allowed to construct a context). `M547`–`M589`
 * cover the worker's safety refusals, each run in the Studio worker's offline
 * suite (`dist/studio/worker/worker.offline.selftest.js`) and each failing a
 * named `SW` check: the start-up refusals (a forbidden variable, `ANTHROPIC_API_KEY`
 * in S3, the `IG_`/`FB_`/`GBP_` prefixes, the commit, the entry point reading
 * `DATABASE_URL` or loading the worker first, or being given a paid runner);
 * a missing cap no longer zero, a ceiling rounded down; the identity and
 * schema-version refusals; the ownership key and the heartbeat interval; every
 * refusal of the paid-unit decision and the settlement; the provider runner
 * factory and the refusals before any work; the sink's rewritten files and
 * immutability; and the claim, the run's end and recovery. They add ten
 * captured paths: the context's module and nine worker modules (fifty-one in
 * all).
 *
 * It is offline and deterministic: no network, no database, no provider, no
 * credential. The mutations run in parallel on up to MAX_WORKERS workers (the
 * runner's available parallelism, capped), each worker in its OWN disposable
 * no-Git copy; mutation ids, expected checks and the printed order are fixed by
 * position in MUTATIONS and do not depend on which worker ran what (see
 * `runMutation` and `main` below). The authoritative checkout is read-only after
 * the copies are prepared. Catchable signals stop every child build and suite,
 * restore every in-flight file and remove every copy when possible; SIGKILL may
 * strand the disposable directories, but cannot dirty the authoritative
 * checkout.
 *
 * SHARDS. `--shard k/n` runs exactly the mutations whose zero-based index
 * modulo n is k (see `parseShard`), so shards 0 to n-1 are disjoint and together
 * run every mutation. CI runs n = 3: shard 0 in the Node 22 quality job, shards 1
 * and 2 in the PostgreSQL 16 and 18 jobs, and the workflow-validation job's
 * `scripts/ci/check-mutation-shards.rb` refuses a `ci.yml` that does not run each
 * shard exactly once with the same n, or that runs the harness without
 * `--shard`. Every per-run proof runs in every shard. `M-inc-sample` keeps its
 * global seeded sample and compares only the ids the shard owns. `M-shard`
 * prints k, n, the mutation count and the ids the shard ran, and checks them
 * against the closed-form count of indices congruent to k. With no `--shard`
 * the run is shard 0/1, every mutation.
 *
 * Run: npm run test:payload-mutation [-- --shard k/n]
 */

import { createHash } from "node:crypto";
import { execFile, execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism, tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const AUTHORITATIVE_REPO_ROOT = resolve(dirname(SCRIPT_PATH), "../..");

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
// The revision pass: its plan and the two blocks a writing stage appends.
const REVISION_MODULE = "src/harness/agents/revision.ts";
const REVISION_INPUT_MODULE = "src/harness/agents/revisionInput.ts";
// Stage 4's deterministic contact-in-overlay check.
const OVERLAY_CONTACT_MODULE = "src/harness/agents/overlayContact.ts";
// Content Studio S1: the CLI's pipeline core moved into the content-run
// library. Mutations of moved code target the library file that holds it now,
// with the same expected checks; argument parsing and dispatch stayed in the CLI.
const CONTENT_RUN_EVIDENCE = "src/harness/contentRun/evidence.ts";
const CONTENT_RUN_PRICING = "src/harness/contentRun/pricing.ts";
const CONTENT_RUN_RECORDING = "src/harness/contentRun/recording.ts";
const CONTENT_RUN_SUMMARY = "src/harness/contentRun/summary.ts";
const CONTENT_RUN_VERIFY = "src/harness/contentRun/verify.ts";
const CONTENT_RUN_PIPELINE = "src/harness/contentRun/pipeline.ts";
const CONTENT_RUN_CONSENT = "src/harness/contentRun/consent.ts";
// The §5.4 protections: a live entry point, a local script outside the
// library's allowlist, the guards themselves and the live-path manifest (data,
// read at runtime, so mutating it needs no rebuild).
const LIVE_SCHEDULER_ENTRY = "src/scheduler/daily.ts";
const LOCAL_TEKMETRIC_PROBE = "scripts/local/tekmetric-probe.mjs";
const LIVE_PATH_GUARDS = "src/harness/livePathGuards.ts";
const LIVE_PATH_MANIFEST = "scripts/ci/live-path-manifest.json";
// Content Studio S2: the Studio migration runner and its entry point, proven by
// the Studio offline suite rather than the Content Intelligence one.
const STUDIO_DB_RUNNER = "src/studio/db/runner.ts";
const STUDIO_DB_ENTRY = "src/studio/db/migrate.ts";
// Content Studio S3: the review-only execution context, and the worker's
// modules, proven by the Studio worker's offline suite.
const CONTENT_RUN_CONTEXT = "src/harness/contentRun/executionContext.ts";
const STUDIO_WORKER_STARTUP = "src/studio/worker/startup.ts";
const STUDIO_WORKER_MAIN = "src/studio/worker/main.ts";
const STUDIO_WORKER_MONEY = "src/studio/worker/money.ts";
const STUDIO_WORKER_SPEND = "src/studio/worker/spend.ts";
const STUDIO_WORKER_SESSION = "src/studio/worker/session.ts";
const STUDIO_WORKER_JOBS = "src/studio/worker/jobs.ts";
const STUDIO_WORKER_SINK = "src/studio/worker/runSink.ts";
const STUDIO_WORKER_EXECUTE = "src/studio/worker/execute.ts";
const STUDIO_WORKER_LIFECYCLE = "src/studio/worker/worker.ts";
const CONTENT_INTELLIGENCE_SUITE = "dist/harness/contentIntelligence.selftest.js";
const STUDIO_DB_SUITE = "dist/studio/db/migrate.offline.selftest.js";
const STUDIO_WORKER_SUITE = "dist/studio/worker/worker.offline.selftest.js";

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
    file: CONTENT_RUN_SUMMARY,
    from: '  lines.push("---", summaryFooter(runner));',
    to: '  lines.push("---", "_Fake-runner output. Not reviewed. Not publishable. Authorizes nothing._");',
    expect: ["CE8."],
  },
  {
    name: "the full run hands the critic stage 5's output without its contact lines",
    file: CONTENT_RUN_PIPELINE,
    from: "    scriptOutput: script.output, directionOutput: direction.output, packagingOutput: contacted,",
    to: "    scriptOutput: script.output, directionOutput: direction.output, packagingOutput: packaging.output as never,",
    expect: ["CG1.", "CE9."],
  },
  {
    name: "the full run no longer checks the contact records before any spend",
    file: CONTENT_RUN_PIPELINE,
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
    // Its site moved when the revision blocks were appended after the
    // restriction blocks; the mutation and its expected checks are unchanged.
    from: "      ...restrictionBlocks,\n      // A revision request only: PREVIOUS_OUTPUT, then CRITIC_FINDINGS.\n",
    to: "      ...restrictionBlocks,\n      { label: \"TRUTH_OUTPUT\", body: JSON.stringify(truthOutput, null, 2) },\n"
      + "      // A revision request only: PREVIOUS_OUTPUT, then CRITIC_FINDINGS.\n",
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
    // Its site moved into WRITER_STAGE_BLOCKS, which STAGE_ASSEMBLED_CEILINGS
    // now reads; the mutation and its expected check are unchanged.
    from: "    { label: \"SCRIPT_CLAIMS\", bodyChars: SCRIPT_CLAIMS_BLOCK_CHARS },\n"
      + "    ...WRITER_RESTRICTION_BLOCKS,\n  ],\n  \"packaging-adaptation\"",
    to: "    { label: \"SCRIPT_CLAIMS\", bodyChars: SCRIPT_CLAIMS_BLOCK_CHARS },\n  ],\n  \"packaging-adaptation\"",
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
    file: CONTENT_RUN_EVIDENCE,
    from: "    ...(scope ? { tags: scope.tags, alwaysIncludeIds: scope.alwaysIncludedIds } : {}),",
    to: "    ...(scope ? { tags: scope.tags } : {}),",
    expect: ["CN4."],
  },
  {
    name: "an unscoped run's run-meta.json gains an evidenceScope key",
    file: CONTENT_RUN_PIPELINE,
    from: "    ...(scope ? { evidenceScope: scope } : {}),\n    ...fingerprints,",
    to: "    evidenceScope: scope,\n    ...fingerprints,",
    expect: ["CN3."],
  },
  {
    name: "the pack fingerprint stops including the scope",
    file: CONTENT_RUN_EVIDENCE,
    from: "  if (scope) hash.update(`${JSON.stringify(scope)}\\n`, \"utf8\");\n",
    to: "",
    // CN8's refusals still fire: a changed or removed scope changes the pack
    // itself, so the projection alone no longer matches the recorded digest.
    expect: ["CN4."],
  },
  {
    name: "the pack fingerprint hashes a scope even when there is none",
    file: CONTENT_RUN_EVIDENCE,
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
    file: CONTENT_RUN_EVIDENCE,
    from: "    if (missing.length) {\n      throw new EvidenceScopeError(",
    to: "    if (false && missing.length) {\n      throw new EvidenceScopeError(",
    expect: ["CN13."],
  },
  {
    name: "a replay rebuilds with the command line's scope instead of the source run's",
    file: CONTENT_RUN_VERIFY,
    from: "    scopeTags: recordedTags ?? undefined,",
    to: "    scopeTags: args.scopeTags,",
    expect: ["CN6."],
  },
  {
    name: "a replay stops refusing a --scope-tags that differs from the recorded scope",
    file: CONTENT_RUN_VERIFY,
    from: "  if (args.scopeTags && JSON.stringify(args.scopeTags) !== JSON.stringify(recordedTags)) {",
    to: "  if (args.scopeTags && Date.now() < 0) {",
    expect: ["CN7."],
  },
  {
    name: "a replay stops comparing the recorded always-included records with this CLI's",
    file: CONTENT_RUN_VERIFY,
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
    file: CONTENT_RUN_PIPELINE,
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

// Stage 5's claimUse cap, derived from the contract. Appended after every
// earlier group so no existing mutation id moves.
const PACKAGING_CLAIM_USE_CAP_MUTATIONS = [
  {
    name: "stage 5's claimUse cap goes back to a fixed 24",
    file: PAYLOAD,
    from: "  maxClaimUses: SCRIPT_FIELD_LIMITS.maxClaimUses * PACKAGING_MAX_REQUESTED_PLATFORMS,",
    to: "  maxClaimUses: 24,",
    expect: ["CP1.", "CP2."],
  },
  {
    name: "stage 5's claimUse cap is hand-kept at today's product",
    file: PAYLOAD,
    from: "  maxClaimUses: SCRIPT_FIELD_LIMITS.maxClaimUses * PACKAGING_MAX_REQUESTED_PLATFORMS,",
    to: "  maxClaimUses: 36,",
    expect: ["CP1."],
  },
  {
    name: "stage 5's claimUse cap multiplies a typed platform count",
    file: PAYLOAD,
    from: "  maxClaimUses: SCRIPT_FIELD_LIMITS.maxClaimUses * PACKAGING_MAX_REQUESTED_PLATFORMS,",
    to: "  maxClaimUses: SCRIPT_FIELD_LIMITS.maxClaimUses * 3,",
    expect: ["CP1."],
  },
  {
    name: "stage 5's validator stops counting identity entries toward the cap",
    file: PACKAGING,
    from: "  if (rawClaimUse.length > PACKAGING_LIMITS.maxClaimUses) {",
    to: "  if (rawClaimUse.filter((entry) => !String((entry as { factId?: unknown } | null)?.factId)"
      + ".startsWith(\"approved-facts:\")).length > PACKAGING_LIMITS.maxClaimUses) {",
    expect: ["CP3."],
  },
  {
    name: "stage 5's validator lets one entry past the cap",
    file: PACKAGING,
    from: "  if (rawClaimUse.length > PACKAGING_LIMITS.maxClaimUses) {",
    to: "  if (rawClaimUse.length > PACKAGING_LIMITS.maxClaimUses + 1) {",
    expect: ["CP3."],
  },
  {
    name: "stage 5's prompt states the old claimUse cap",
    file: PACKAGING_PROMPT,
    from: "  - `claimUse` — at most 36 entries",
    to: "  - `claimUse` — at most 24 entries",
    expect: ["CP4."],
  },
  {
    name: "stage 5's prompt lets the model list the identity records again",
    file: PACKAGING_PROMPT,
    from: "Do not list them in `claimUse`; code binds them on every platform.",
    to: "You need not list them in `claimUse`.",
    expect: ["CP4."],
  },
];

// Stage 5's stated caption target and `--resume-from packaging-adaptation`.
// Appended after every earlier group so no existing mutation id moves.
const STATED_CAPTION_AND_RESUME_MUTATIONS = [
  {
    name: "stage 5's caption target collapses back onto the enforced budget",
    file: PAYLOAD,
    from: "export const STATED_CAPTION_TARGET_PERCENT = 85;",
    to: "export const STATED_CAPTION_TARGET_PERCENT = 100;",
    expect: ["CQ1.", "CQ5."],
  },
  {
    name: "stage 5's caption target moves to the 88% the measurement does not support",
    file: PAYLOAD,
    from: "export const STATED_CAPTION_TARGET_PERCENT = 85;",
    to: "export const STATED_CAPTION_TARGET_PERCENT = 88;",
    expect: ["CQ1.", "CQ4."],
  },
  {
    name: "stage 5's caption target rounds up toward the budget",
    file: PAYLOAD,
    from: "  return Math.floor((enforcedBudget * STATED_CAPTION_TARGET_PERCENT) / 100);",
    to: "  return Math.ceil((enforcedBudget * STATED_CAPTION_TARGET_PERCENT) / 100);",
    expect: ["CQ1."],
  },
  {
    name: "stage 5's validator enforces the stated target instead of the budget",
    file: PACKAGING,
    from: "    const captionBudget = captionMax - contactReserve;",
    to: "    const captionBudget = statedCaptionTarget(captionMax - contactReserve);",
    expect: ["CQ2.", "CQ3.", "CQ7.", "BQ33."],
  },
  {
    name: "stage 5's response schema states the enforced budget instead of the target",
    file: PACKAGING,
    from: "  return statedCaptionTarget(effectiveCaptionBudget(platform));",
    to: "  return effectiveCaptionBudget(platform);",
    expect: ["CQ1.", "CK14."],
  },
  {
    name: "stage 5's prompt states Instagram's enforced budget again",
    file: PACKAGING_PROMPT,
    from: "and the canonical hashtag list, at most 1,815 characters.",
    to: "and the canonical hashtag list, at most 2,136 characters.",
    expect: ["CD6 (instagram).", "CD3 (packaging-adaptation)."],
  },
  {
    name: "the run's caption measurement reports the budget as the stated figure",
    file: CONTENT_RUN_RECORDING,
    from: "        caps.caption, caps.captionStated, \"product-bearing\");",
    to: "        caps.caption, caps.caption, \"product-bearing\");",
    expect: ["CQ6."],
  },
  {
    name: "a resume stops requiring a recorded evidence-pack fingerprint",
    file: CONTENT_RUN_VERIFY,
    from: "        meta.evidencePackSha256 ? null : \"evidencePackSha256\",\n",
    to: "",
    expect: ["CR4."],
  },
  {
    name: "a resume accepts a resume point other than packaging-adaptation",
    file: CONTENT_RUN_CLI,
    from: "export const RESUME_POINTS = [\"packaging-adaptation\"];",
    to: "export const RESUME_POINTS = [\"packaging-adaptation\", \"production-direction\"];",
    expect: ["CR7."],
  },
  {
    name: "a resume prices a whole run instead of only its own requests",
    file: CONTENT_RUN_PIPELINE,
    from: "  const requests = resumePolicies(rt, resumeAt);",
    to: "  const requests = allStagePolicies(rt);",
    expect: ["CR8.", "CR9."],
  },
  {
    name: "a resume or replay stops revalidating the saved stage 4 output",
    file: CONTENT_RUN_VERIFY,
    from: "  const directionOutput = rt.direction.revalidateProductionDirectionOutput(\n"
      + "    saved.direction.output, scriptOutput, truthOutput, pack);",
    to: "  const directionOutput = saved.direction.output;",
    expect: ["CR6.", "CE7."],
  },
  {
    name: "a live resume drops the typed LIVE guard",
    file: CONTENT_RUN_PIPELINE,
    from: "    await io.consent({ kind: \"resume\", label: `one run resumed at ${resumeAt}`, ceiling });\n",
    to: "",
    expect: ["CR8.", "CR9."],
  },
];

/**
 * The comparison rule in `skills/claim-boundaries`, a precaution. Four
 * owner-run live runs of 2026-09-26 were first recorded as crediting a
 * manufacturer with a comparison its record does not make, unflagged by any
 * lens; the owner's check of 2026-09-28 found BMW's own record makes that
 * city-versus-long-distance comparison, so there was no critic gap (see PR
 * #97's corrected record in docs/ROADMAP.md). Appended after every earlier group.
 */
const COMPARISON_CLAIM_MUTATIONS = [
  {
    name: "the comparison rule no longer needs a record that states the comparison",
    file: CLAIM_BOUNDARIES_SKILL,
    from: "- **A comparison needs a record that states that comparison.** A record that\n"
      + "  describes one side says nothing about how it compares with the other, however\n"
      + "  naturally the comparison seems to follow. If no citable record states the\n"
      + "  comparison, it may not be made.",
    to: "- **A comparison may follow from a record that describes one side**, where the\n"
      + "  comparison naturally follows from it.",
    expect: ["CM12."],
  },
  {
    name: "a comparison is credited to the source quoted beside it",
    file: CLAIM_BOUNDARIES_SKILL,
    from: "something else, the comparison belongs to the second record's source. Never\n"
      + "  attach a comparison to a source whose own record does not make it, even when\n"
      + "  that source's record is quoted in the same sentence.",
    to: "something else, the comparison may be credited to the first source, whose record\n"
      + "  is quoted in the same sentence.",
    expect: ["CM12."],
  },
  {
    name: "the comparison rule carries the motivating runs' own wording",
    file: CLAIM_BOUNDARIES_SKILL,
    from: "its own, separate from anything said about either side.",
    to: "its own, separate from anything said about either side — city driving versus long, steady "
      + "highway driving, say.",
    expect: ["CM12."],
  },
];

/**
 * The opt-in revision pass (the owner's decisions of 2026-09-26 and 2026-09-28):
 * each writing stage's findings cap derived from the payload contract so no
 * revision request exceeds an unmoved MAX_PAYLOAD_CHARS; only owned, non-human
 * findings reach a stage; the earliest blocking owner starts the one round; the
 * source is verified first; and the typed LIVE gate holds. Appended after every
 * earlier group.
 */
const REVISION_PASS_MUTATIONS = [
  {
    name: "a stage's findings cap is typed instead of derived from the contract",
    file: PAYLOAD,
    from: "    let cap = 0;\n    while (cap < MAX_PANEL_FINDINGS\n"
      + "      && assembledCeiling(revisionStageBlocks(stage, cap + 1)) <= MAX_PAYLOAD_CHARS) {\n"
      + "      cap += 1;\n    }\n    return [stage, cap];",
    to: "    return [stage, ({ \"hook-story-script\": 69, \"production-direction\": 80, \"packaging-adaptation\": 31 } "
      + "as Record<string, number>)[stage]];",
    expect: ["CV1."],
  },
  {
    name: "a revision request is sized without its PREVIOUS_OUTPUT block",
    file: PAYLOAD,
    from: "    { label: \"PREVIOUS_OUTPUT\", bodyChars: REVISION_PREVIOUS_OUTPUT_CHARS[stage] },\n",
    to: "",
    expect: ["CV2."],
  },
  {
    name: "the CRITIC_FINDINGS ceiling drops the escaping allowance",
    file: PAYLOAD,
    from: "    count * (CRITIC_FIELD_LIMITS.issueChars + CRITIC_FIELD_LIMITS.suggestedActionChars),\n  );\n}",
    to: "    count * (CRITIC_FIELD_LIMITS.issueChars + CRITIC_FIELD_LIMITS.suggestedActionChars),\n    1,\n  );\n}",
    expect: ["CV3."],
  },
  {
    name: "MAX_PAYLOAD_CHARS is raised to fit an uncapped revision request",
    file: PAYLOAD,
    from: "  return Math.ceil(largest / 10_000) * 10_000;",
    to: "  return Math.max(Math.ceil(largest / 10_000) * 10_000, 510_000);",
    expect: ["CV2."],
  },
  {
    name: "a stage accepts a finding owned by another stage",
    file: REVISION_INPUT_MODULE,
    from: "    if (f.owner !== stage) fail(`\"${at}\" is owned by ${JSON.stringify(f.owner)}, not this stage`);\n",
    to: "",
    expect: ["CV5."],
  },
  {
    name: "a stage accepts a human_decision finding",
    file: REVISION_INPUT_MODULE,
    from: "    if (f.category === \"human_decision\") fail(`\"${at}\" is a human_decision finding; it never reaches a model`);\n",
    to: "",
    expect: ["CV5."],
  },
  {
    name: "a stage accepts more findings than its derived cap",
    file: REVISION_INPUT_MODULE,
    from: "  if (revision.findings.length > cap) {",
    to: "  if (revision.findings.length > cap + 1000) {",
    expect: ["CV5."],
  },
  {
    name: "the plan sends a human_decision finding owned by a writing stage",
    file: REVISION_MODULE,
    from: "  !REVISABLE_OWNERS.has(f.owner) || f.category === \"human_decision\";",
    to: "  !REVISABLE_OWNERS.has(f.owner);",
    expect: ["CV6.", "CV13."],
  },
  {
    name: "the round starts at the latest blocking owner instead of the earliest",
    file: REVISION_MODULE,
    from: "  const startIndex = REVISABLE_STAGES.findIndex((stage) =>",
    to: "  const startIndex = REVISABLE_STAGES.length - 1 - [...REVISABLE_STAGES].reverse().findIndex((stage) =>",
    expect: ["CV7.", "CV16."],
  },
  {
    name: "the later writing stages are not re-run after the start stage",
    file: REVISION_MODULE,
    from: "  const stages = REVISABLE_STAGES.slice(startIndex).map(",
    to: "  const stages = REVISABLE_STAGES.slice(startIndex, startIndex + 1).map(",
    expect: ["CV6.", "CV7."],
  },
  {
    name: "over a cap, advisory findings are kept ahead of blocking ones",
    file: REVISION_MODULE,
    from: "        Number(b.finding.severity === \"blocking\") - Number(a.finding.severity === \"blocking\")",
    to: "        Number(a.finding.severity === \"blocking\") - Number(b.finding.severity === \"blocking\")",
    expect: ["CV8.", "CV21."],
  },
  {
    name: "a stage owning more blocking findings than its cap is not refused",
    file: REVISION_MODULE,
    from: "    if (blocking > cap) throw new RevisionCapError(stage, blocking, cap);\n",
    to: "",
    expect: ["CV8.", "CV22."],
  },
  {
    name: "revision-meta.json no longer records the findings dropped over a cap",
    file: CONTENT_RUN_PIPELINE,
    from: "    findingsDropped: plan.stages.flatMap(",
    to: "    findingsDropped: ([] as typeof plan.stages).flatMap(",
    expect: ["CV21."],
  },
  {
    name: "round 2's critic panel is handed round 1's findings",
    file: CONTENT_RUN_PIPELINE,
    from: "    scriptOutput: script, directionOutput: direction, packagingOutput: contacted,\n",
    to: "    scriptOutput: script, directionOutput: direction, packagingOutput: contacted,\n"
      + "    ...{ roundOneFindings: criticOutput.provisional.findings },\n",
    expect: ["CV14."],
  },
  {
    name: "a revision reads round 1's findings without revalidating the saved panel output",
    file: CONTENT_RUN_VERIFY,
    from: "    criticOutput = rt.critic.revalidateFinalCriticOutput(\n"
      + "      saved.critic.output, platforms, contacted, scriptOutput, truthOutput, pack);",
    to: "    criticOutput = saved.critic.output;",
    expect: ["CV18."],
  },
  {
    name: "a revision stops requiring the recorded fingerprints",
    file: CONTENT_RUN_VERIFY,
    from: "  if (resumeAt || revise) {",
    to: "  if (resumeAt) {",
    expect: ["CV18."],
  },
  {
    name: "a failed revised stage's paid response is written into round 1's directory",
    file: CONTENT_RUN_PIPELINE,
    from: "    sink, transcript, writeMeasurements,\n    finalize:",
    to: "    sink: { ...sink, label: source.label }, transcript, writeMeasurements,\n    finalize:",
    expect: ["CV19."],
  },
  {
    name: "a round with no revisable blocking finding still proceeds",
    file: CONTENT_RUN_PIPELINE,
    from: "  if (plan.kind === \"no_revision\") {",
    to: "  if ((plan.kind as string) === \"never\") {",
    expect: ["CV20."],
  },
  {
    name: "a live revision drops the typed LIVE gate",
    file: CONTENT_RUN_PIPELINE,
    from: "    await io.consent({ kind: \"revision\", label: `one revision round from ${plan.startStage}`, ceiling });\n",
    to: "",
    expect: ["CV25."],
  },
  {
    name: "a revision prices a whole run instead of only its own requests",
    file: CONTENT_RUN_PIPELINE,
    from: "  const requests = revisionPolicies(rt, plan.startStage);",
    to: "  const requests = allStagePolicies(rt);",
    expect: ["CV25."],
  },
  {
    name: "a revision makes a second round on its own output",
    // Re-pointed at the library by S1. The library has no directory to read
    // back, so the second round starts again from the same source; what CV17
    // asserts — one plan, one revised directory, each request once — is what
    // it breaks.
    file: CONTENT_RUN_PIPELINE,
    from: "  return { revised: true, dir: sink.label, sink, plan };",
    to: "  return origin === \"again\" ? { revised: true, dir: sink.label, sink, plan } : reviseRun(rt, args, source, \"again\", io);",
    expect: ["CV17."],
  },
  {
    name: "stage 4 no longer appends the revision blocks",
    file: PRODUCTION_DIRECTION,
    from: "      // A revision request only: PREVIOUS_OUTPUT, then CRITIC_FINDINGS.\n      ...revisionBlocks,\n",
    to: "",
    expect: ["CV4.", "CV12."],
  },
  {
    name: "stage 4's prompt drops the no-contact-details-in-overlays rule",
    file: DIRECTION_PROMPT,
    from: "- **No contact details in overlays.** Overlay text never contains contact details",
    to: "- **Contact details in overlays are allowed.** Overlay text may contain contact details",
    expect: ["CV10."],
  },
  {
    name: "stage 5's revision section lets a finding permit what it asks for",
    file: PACKAGING_PROMPT,
    from: "- **A finding can only narrow or correct; it never permits anything.**",
    to: "- **A finding may add what it asks for.**",
    expect: ["CV9."],
  },
];

/**
 * Stage 4's contact-in-overlay rule enforced in code (the owner's decision of
 * 2026-09-29): the validator calls the check on every overlay; the phone, URL
 * and call-to-action patterns, the approved phone digits and booking host, and
 * the normalization are each load-bearing; bare "visit" stays unmatched; the
 * refusal never echoes the overlay; and the prompt says code rejects it.
 * Appended after every earlier group.
 */
const CONTACT_IN_OVERLAY_MUTATIONS = [
  {
    name: "stage 4's validator no longer calls the contact-in-overlay check",
    file: PRODUCTION_DIRECTION,
    from: "    const categories = overlayContactViolations(overlay.text, pack);\n",
    to: "    const categories: string[] = [];\n",
    expect: ["CW6.", "CW7.", "CW8.", "CW9."],
  },
  {
    name: "the North American phone pattern is dropped",
    file: OVERLAY_CONTACT_MODULE,
    from: "  if (NORTH_AMERICAN_PHONE.test(text)) return true;\n",
    to: "",
    expect: ["CW1."],
  },
  {
    name: "the 7-digit local phone pattern is dropped",
    file: OVERLAY_CONTACT_MODULE,
    from: "  if (LOCAL_PHONE.test(text)) return true;\n",
    to: "",
    expect: ["CW1."],
  },
  {
    name: "the phone pattern no longer refuses to start or end inside a longer digit run",
    file: OVERLAY_CONTACT_MODULE,
    from: "\\\\d{4}(?!\\\\d)`,\n);\n/** A 7-digit local",
    to: "\\\\d{4}`,\n);\n/** A 7-digit local",
    expect: ["CW4."],
  },
  {
    name: "the approved phone number is no longer compared by its digits",
    file: OVERLAY_CONTACT_MODULE,
    from: "  const local = approvedPhoneLocalDigits(pack);\n",
    to: "  const local = undefined as string | undefined;\n",
    expect: ["CW5."],
  },
  {
    name: "the bare-domain URL pattern is dropped",
    file: OVERLAY_CONTACT_MODULE,
    from: "  if (URL_BARE_DOMAIN.test(text)) return true;\n",
    to: "",
    expect: ["CW2."],
  },
  {
    name: "the email pattern is dropped",
    file: OVERLAY_CONTACT_MODULE,
    from: "  if (URL_EMAIL.test(text)) return true;\n",
    to: "",
    expect: ["CW2."],
  },
  {
    name: "the approved booking link's host is no longer matched",
    file: OVERLAY_CONTACT_MODULE,
    from: "  if (host && text.includes(host)) return true;\n",
    to: "",
    expect: ["CW5."],
  },
  {
    name: "one phrase is removed from the call-to-action list",
    file: OVERLAY_CONTACT_MODULE,
    from: "  \"book online\",\n",
    to: "",
    expect: ["CW3."],
  },
  {
    name: "the call-to-action list matches bare \"visit\"",
    file: OVERLAY_CONTACT_MODULE,
    from: "  \"visit us\",\n",
    to: "  \"visit\",\n  \"visit us\",\n",
    expect: ["CW4."],
  },
  {
    name: "overlay text is no longer NFKC-normalized",
    file: OVERLAY_CONTACT_MODULE,
    from: "    .normalize(\"NFKC\")\n",
    to: "",
    expect: ["CW3."],
  },
  {
    name: "overlay whitespace is no longer collapsed",
    file: OVERLAY_CONTACT_MODULE,
    from: "    .replace(/\\s+/g, \" \")\n",
    to: "",
    expect: ["CW3."],
  },
  {
    name: "overlay text is no longer compared case-insensitively",
    file: OVERLAY_CONTACT_MODULE,
    from: "    .trim()\n    .toLowerCase();\n",
    to: "    .trim();\n",
    expect: ["CW2.", "CW3."],
  },
  {
    name: "the refusal echoes the overlay text",
    file: PRODUCTION_DIRECTION,
    from: "\"code attaches the contact line, so an overlay may not carry a phone number, a URL or a call to action\");",
    to: "\"code attaches the contact line, so an overlay may not carry a phone number, a URL or a call to action: \" "
      + "+ overlay.text);",
    expect: ["CW7.", "CW8."],
  },
  {
    name: "stage 4's prompt no longer says code rejects an overlay carrying contact details",
    file: DIRECTION_PROMPT,
    from: " An overlay containing a phone number, a URL or web address, or a call to action such as \"book online\" "
      + "or \"call us\" is rejected by code, and the whole response fails.",
    to: "",
    expect: ["CW10."],
  },
];

/**
 * Content Studio S1 (docs/CONTENT_STUDIO_DESIGN.md §5.4): the library's two
 * injected gates, the CLI's parse-time copies held equal to the library's, and
 * the three structural protections around the live services — each proven to
 * fail BY NAME. The import-graph mutations include an intermediary a fixed-file
 * check cannot see: the scheduler importing `overlayContact.js`, which names no
 * executor but reaches `packagingAdaptation.js` through `contactLine.js` (the
 * AQ18a smoke check, which reads only the scheduler's own text, stays green).
 */
const CONTENT_STUDIO_S1_MUTATIONS = [
  {
    name: "the library's scope-tag normalizer stops sorting, drifting from the CLI's parse-time copy",
    file: CONTENT_RUN_EVIDENCE,
    from: ".map((t) => t.trim()).filter(Boolean))].sort();",
    to: ".map((t) => t.trim()).filter(Boolean))];",
    expect: ["CS4."],
  },
  {
    name: "the library accepts a resume point the CLI's parse-time copy refuses",
    file: CONTENT_RUN_PRICING,
    from: "export const RESUME_POINTS = [\"packaging-adaptation\"];",
    to: "export const RESUME_POINTS = [\"packaging-adaptation\", \"production-direction\"];",
    expect: ["CS4."],
  },
  {
    name: "a live full run never asks the injected paid-action consent",
    file: CONTENT_RUN_PIPELINE,
    from: "    await io.consent({\n      kind: \"full-run\",",
    to: "    void ({\n      kind: \"full-run\",",
    expect: ["CS6.", "CG10."],
  },
  {
    name: "a replay ignores the injected UNPROVEN confirmation's refusal",
    file: CONTENT_RUN_VERIFY,
    from: "    if (!decision.confirmed) {",
    to: "    if (!decision.confirmed && Date.now() < 0) {",
    expect: ["CS5."],
  },
  {
    name: "a live entry point imports the content-run library",
    file: LIVE_SCHEDULER_ENTRY,
    appendText: "\nimport \"../harness/contentRun/index.js\";\n",
    expect: ["CS1."],
  },
  {
    name: "a live entry point reaches a stage executor through an intermediary that names none",
    file: LIVE_SCHEDULER_ENTRY,
    appendText: "\nimport \"../harness/agents/overlayContact.js\";\n",
    expect: ["CS1."],
  },
  {
    name: "a live entry point gains a computed import the walk cannot follow",
    file: LIVE_SCHEDULER_ENTRY,
    appendText: "\nexport async function s1Probe(target: string): Promise<unknown> { return import(target); }\n",
    expect: ["CS1."],
  },
  {
    name: "a shared live module lazily imports revision.js",
    file: SDK,
    appendText: "\nexport const s1Probe = () => import(\"./agents/revision.js\");\n",
    expect: ["CS1."],
  },
  {
    name: "the content-run library reaches the posting tool's publishing module",
    file: CONTENT_RUN_CONSENT,
    appendText: "\nexport const s1Probe = () => import(\"../../mcp/posting-tool/index.js\");\n",
    expect: ["CS1c."],
  },
  {
    name: "the walked entry points drop one the configuration names",
    file: LIVE_PATH_GUARDS,
    from: "  \"dist/harness/dryrun.cli.js\",\n] as const;",
    to: "] as const;",
    expect: ["CS1a."],
  },
  {
    name: "a local script outside the allowlist imports the content-run library",
    file: LOCAL_TEKMETRIC_PROBE,
    appendText: "\nexport const s1Probe = () => import(\"../../dist/harness/contentRun/index.js\");\n",
    expect: ["CS2."],
  },
  {
    name: "the caller allowlist widens from the Studio worker to all of src/studio",
    file: LIVE_PATH_GUARDS,
    from: "export const CONTENT_RUN_CALLERS = [\"scripts/local/content-run.mjs\", \"src/studio/worker/\"] as const;",
    to: "export const CONTENT_RUN_CALLERS = [\"scripts/local/content-run.mjs\", \"src/studio/\"] as const;",
    expect: ["CS2."],
  },
  {
    name: "a shared live module is edited without a live-path declaration",
    file: SDK,
    appendText: "\n// an undeclared live-path edit\n",
    expect: ["CS3."],
  },
  {
    name: "a comment-only edit to a live entry point goes undeclared",
    file: LIVE_SCHEDULER_ENTRY,
    appendText: "\n// comment-only, and still a live-path edit\n",
    expect: ["CS3."],
  },
  {
    name: "the live-path manifest stops naming a module the live services load",
    file: LIVE_PATH_MANIFEST,
    from: "\"path\": \"src/api/approvalReview.ts\",",
    to: "\"path\": \"src/api/approvalReviewRenamed.ts\",",
    expect: ["CS3."],
  },
];

// Content Studio S2's offline-testable safety refusals (docs/CONTENT_STUDIO_DESIGN.md
// §3.7). Each runs the Studio offline suite (`suite`), whose SM checks must name it.
const CONTENT_STUDIO_S2_MUTATIONS = [
  {
    name: "the Studio runner no longer refuses when DATABASE_URL is present",
    file: STUDIO_DB_RUNNER,
    from: "  if (env.databaseUrlPresent) {",
    to: "  if (env.databaseUrlPresent && Date.now() < 0) {",
    expect: ["SM1.", "SM1a."],
    suite: STUDIO_DB_SUITE,
  },
  {
    name: "the Studio entry point stops reporting DATABASE_URL's presence",
    file: STUDIO_DB_ENTRY,
    from: "    databaseUrlPresent: process.env.DATABASE_URL !== undefined,",
    to: "    databaseUrlPresent: false,",
    expect: ["SM1a.", "SM2b."],
    suite: STUDIO_DB_SUITE,
  },
  {
    name: "the Studio entry point falls back to DATABASE_URL's value",
    file: STUDIO_DB_ENTRY,
    from: "    studioDatabaseUrl: process.env.STUDIO_DATABASE_URL,",
    to: "    studioDatabaseUrl: process.env.STUDIO_DATABASE_URL ?? process.env.DATABASE_URL,",
    expect: ["SM2b."],
    suite: STUDIO_DB_SUITE,
  },
  {
    name: "the Studio entry point reads a look-alike variable before STUDIO_DATABASE_URL",
    file: STUDIO_DB_ENTRY,
    from: "    studioDatabaseUrl: process.env.STUDIO_DATABASE_URL,",
    to: "    studioDatabaseUrl: process.env.STUDIO_DB_URL ?? process.env.STUDIO_DATABASE_URL,",
    expect: ["SM2a.", "SM2b."],
    suite: STUDIO_DB_SUITE,
  },
  {
    name: "the Studio ledger no longer refuses a recorded migration whose sha256 changed",
    file: STUDIO_DB_RUNNER,
    from: "    } else if (file.sha256 !== row.sha256) {",
    to: "    } else if (file.sha256 !== row.sha256 && Date.now() < 0) {",
    expect: ["SM3."],
    suite: STUDIO_DB_SUITE,
  },
  {
    name: "the Studio identity decision accepts a database not named gcd_studio",
    file: STUDIO_DB_RUNNER,
    from: "  if (probe.currentDatabase !== STUDIO_DATABASE_NAME) {",
    to: "  if (probe.currentDatabase !== STUDIO_DATABASE_NAME && Date.now() < 0) {",
    expect: ["SM4."],
    suite: STUDIO_DB_SUITE,
  },
  {
    name: "the Studio identity decision ignores live-schema tables",
    file: STUDIO_DB_RUNNER,
    from: "  if (probe.liveTables.length > 0) {",
    to: "  if (probe.liveTables.length > 0 && Date.now() < 0) {",
    expect: ["SM4a.", "SM5."],
    suite: STUDIO_DB_SUITE,
  },
  {
    name: "the Studio identity decision accepts a live _migrations ledger",
    file: STUDIO_DB_RUNNER,
    from: "  if (probe.migrationsTable === \"live\") {",
    to: "  if (probe.migrationsTable === \"live\" && Date.now() < 0) {",
    expect: ["SM4b."],
    suite: STUDIO_DB_SUITE,
  },
  {
    name: "the Studio identity decision accepts a missing or mismatched identity row",
    file: STUDIO_DB_RUNNER,
    from: "  if (rows.length !== 1 || rows[0]!.database_name !== STUDIO_DATABASE_NAME || rows[0]!.marker !== STUDIO_IDENTITY_MARKER) {",
    to: "  if ((rows.length !== 1 || rows[0]!.database_name !== STUDIO_DATABASE_NAME || rows[0]!.marker !== STUDIO_IDENTITY_MARKER) && Date.now() < 0) {",
    expect: ["SM4c."],
    suite: STUDIO_DB_SUITE,
  },
  {
    name: "the Studio probe reads any _migrations table as the tripwire",
    file: STUDIO_DB_RUNNER,
    from: "      if (tripwire.rows.length === 1 && tripwire.rows[0]!.definition === \"CHECK (false)\") migrationsTable = \"tripwire\";",
    to: "      migrationsTable = \"tripwire\";",
    expect: ["SM5."],
    suite: STUDIO_DB_SUITE,
  },
  {
    name: "the Studio runner decides identity only inside its first transaction, after statements have run",
    file: STUDIO_DB_RUNNER,
    from: "  const probe = await probeStudioIdentity(client);\n  decideStudioIdentity(probe);\n",
    to: "  const probe = await probeStudioIdentity(client);\n",
    expect: ["SM5."],
    suite: STUDIO_DB_SUITE,
  },
];

// Content Studio S3, part 1: the review-only execution context (docs/CONTENT_STUDIO_DESIGN.md §5.4).
// Its CS checks are in the Content Intelligence suite; the library's per-unit gate is proven by the
// Studio worker's offline suite (SW7), the only tree besides the CLI allowed to construct a context.
const CONTENT_STUDIO_S3_CONTEXT_MUTATIONS = [
  {
    name: "a live full run no longer requires the review-only execution context",
    file: CONTENT_RUN_PIPELINE,
    from: "    requireReviewOnlyExecutionContext(io.execution, \"full-run\");\n",
    to: "",
    expect: ["CS7a."],
  },
  {
    name: "a live resume no longer requires the review-only execution context",
    file: CONTENT_RUN_PIPELINE,
    from: "    requireReviewOnlyExecutionContext(io.execution, \"resume\");\n",
    to: "",
    expect: ["CS7a."],
  },
  {
    name: "a live critic replay no longer requires the review-only execution context",
    file: CONTENT_RUN_PIPELINE,
    from: "    requireReviewOnlyExecutionContext(io.execution, \"critic-replay\");\n",
    to: "",
    expect: ["CS7a."],
  },
  {
    name: "a live revision no longer requires the review-only execution context",
    file: CONTENT_RUN_PIPELINE,
    from: "    requireReviewOnlyExecutionContext(io.execution, \"revision\");\n",
    to: "",
    expect: ["CS7a."],
  },
  {
    name: "the context check accepts any frozen look-alike, not only a context the library issued",
    file: CONTENT_RUN_CONTEXT,
    from: "  if (typeof value !== \"object\" || value === null || !issued.has(value) || !Object.isFrozen(value)) return false;",
    to: "  if (typeof value !== \"object\" || value === null || !Object.isFrozen(value)) return false;",
    expect: ["CS7.", "CS7a."],
  },
  {
    name: "the context gains an approval capability",
    file: CONTENT_RUN_CONTEXT,
    from: "  const context = Object.freeze({ kind: \"review-only\" as const, caller, checkRequests });",
    to: "  const context = Object.freeze({ kind: \"review-only\" as const, caller, checkRequests, approve: async () => {} });",
    expect: ["CS7b."],
  },
  {
    name: "the context constructor accepts any caller",
    file: CONTENT_RUN_CONTEXT,
    from: "  if (!(REVIEW_ONLY_CALLERS as readonly string[]).includes(caller)) {",
    to: "  if (!(REVIEW_ONLY_CALLERS as readonly string[]).includes(caller) && Date.now() < 0) {",
    expect: ["CS7."],
  },
  {
    name: "the library stops checking each request unit before it is sent",
    file: CONTENT_RUN_CONTEXT,
    from: "      await check(stage, (line) => line.label === stage);\n",
    to: "",
    expect: ["SW7.", "SW7a."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "the critic panel's lenses are checked one by one instead of as one unit",
    file: CONTENT_RUN_CONTEXT,
    from: "      panel ??= check(stage, (line) => line.label.startsWith(\"final-critic:\"));",
    to: "      panel = check(stage, (line) => line.label.startsWith(\"final-critic:\"));",
    expect: ["SW7.", "SW7b."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "the gate sends a request outside the action's priced requests",
    file: CONTENT_RUN_CONTEXT,
    from: "    if (requests.length === 0) {",
    to: "    if (requests.length === 0 && Date.now() < 0) {",
    expect: ["SW7b."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "the construction allowlist widens to the whole repository",
    file: LIVE_PATH_GUARDS,
    from: "export const REVIEW_ONLY_CONSTRUCTORS = CONTENT_RUN_CALLERS;",
    to: "export const REVIEW_ONLY_CONSTRUCTORS = [...CONTENT_RUN_CALLERS, \"src/\", \"scripts/\"] as const;",
    expect: ["CS8."],
  },
  {
    name: "a live module names the review-only context's type",
    file: LIVE_SCHEDULER_ENTRY,
    appendText: "\nexport type ReviewOnlyProbe = import(\"../harness/contentRun/executionContext.js\").ReviewOnlyExecutionContext;\n",
    expect: ["CS9.", "CS3."],
  },
  {
    name: "the context's module gains a run-time import",
    file: CONTENT_RUN_CONTEXT,
    from: "import type { CostCeiling, CostCeilingLine, PaidActionKind, RunnerKind } from \"./types.js\";",
    to: "import type { CostCeiling, CostCeilingLine, PaidActionKind, RunnerKind } from \"./types.js\";\nimport \"./types.js\";",
    expect: ["CS9."],
  },
];

// Content Studio S3, part 2: the worker's safety refusals (§3.2, §5.3, §6.2), each proven by a named
// check of the Studio worker's offline suite (`suite`).
const CONTENT_STUDIO_S3_WORKER_MUTATIONS = [
  {
    name: "the worker starts beside a forbidden variable",
    file: STUDIO_WORKER_STARTUP,
    from: "  if (forbidden.length) {",
    to: "  if (forbidden.length && Date.now() < 0) {",
    expect: ["SW1.", "SW1b."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "the worker stops refusing ANTHROPIC_API_KEY in S3",
    file: STUDIO_WORKER_STARTUP,
    from: "export const S3_FORBIDDEN_VARIABLES = [\"ANTHROPIC_API_KEY\"] as const;",
    to: "export const S3_FORBIDDEN_VARIABLES = [] as const;",
    expect: ["SW1.", "SW1b."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "the worker stops refusing IG_, FB_ and GBP_ names",
    file: STUDIO_WORKER_STARTUP,
    from: "  return [...new Set(names)].filter((name) => exact.has(name) || FORBIDDEN_PREFIXES.some((p) => name.startsWith(p))).sort();",
    to: "  return [...new Set(names)].filter((name) => exact.has(name)).sort();",
    expect: ["SW1.", "SW1b."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "the worker starts without a full commit SHA",
    file: STUDIO_WORKER_STARTUP,
    from: "  if (!/^[0-9a-f]{40}$/.test(commit)) {",
    to: "  if (!/^[0-9a-f]{40}$/.test(commit) && Date.now() < 0) {",
    expect: ["SW1a.", "SW1b."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "the entry point falls back to DATABASE_URL's value",
    file: STUDIO_WORKER_MAIN,
    from: "    studioDatabaseUrl: process.env.STUDIO_DATABASE_URL,",
    to: "    studioDatabaseUrl: process.env.STUDIO_DATABASE_URL ?? process.env.DATABASE_URL,",
    expect: ["SW1c."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "the entry point loads the worker before deciding its environment",
    file: STUDIO_WORKER_MAIN,
    from: "import { decideWorkerStartup, WorkerStartupRefusal } from \"./startup.js\";",
    to: "import { decideWorkerStartup, WorkerStartupRefusal } from \"./startup.js\";\nimport \"./worker.js\";",
    expect: ["SW1c."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "the entry point is given a paid stage runner",
    file: STUDIO_WORKER_MAIN,
    from: "    ready: (line) => console.log(line),",
    to: "    ready: (line) => console.log(line),\n    paidStageRunner: (async () => ({ text: \"{}\" })) as never,",
    expect: ["SW8."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "a missing or unreadable deployment cap becomes a default instead of zero",
    file: STUDIO_WORKER_MONEY,
    from: "  if (typeof raw !== \"string\" || !/^\\d{1,6}(?:\\.\\d{1,6})?$/.test(raw.trim())) return 0;",
    to: "  if (typeof raw !== \"string\" || !/^\\d{1,6}(?:\\.\\d{1,6})?$/.test(raw.trim())) return 75_000_000;",
    expect: ["SW2."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "a ceiling rounds down instead of up",
    file: STUDIO_WORKER_MONEY,
    from: "  return Math.ceil(Number((usd * MICROS_PER_USD).toFixed(3)));",
    to: "  return Math.floor(Number((usd * MICROS_PER_USD).toFixed(3)));",
    expect: ["SW2a."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "the worker accepts an unmigrated database",
    file: STUDIO_WORKER_STARTUP,
    from: "  if (decideStudioIdentity(probe).kind !== \"studio\") {",
    to: "  if (decideStudioIdentity(probe).kind !== \"studio\" && Date.now() < 0) {",
    expect: ["SW3."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "the worker accepts a database whose recorded schema is another version",
    file: STUDIO_WORKER_STARTUP,
    from: "  if (JSON.stringify(recorded) !== JSON.stringify(expected)) {",
    to: "  if (JSON.stringify(recorded) !== JSON.stringify(expected) && Date.now() < 0) {",
    expect: ["SW3a."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "the worker's ownership key is the live worker's",
    file: STUDIO_WORKER_SESSION,
    from: "  return [digest.readInt32BE(0), digest.readInt32BE(4)];",
    to: "  return [LIVE_WORKER_OWNERSHIP_KEY[0], LIVE_WORKER_OWNERSHIP_KEY[1]];",
    expect: ["SW4."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "the heartbeat is written every minute instead of every 30 seconds",
    file: STUDIO_WORKER_LIFECYCLE,
    from: "export const HEARTBEAT_INTERVAL_MS: number = 30_000;",
    to: "export const HEARTBEAT_INTERVAL_MS: number = 60_000;",
    expect: ["SW4a."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "a paid unit is sent after the job was cancelled",
    file: STUDIO_WORKER_SPEND,
    from: "  if (!s.job || s.job.cancelRequested || s.job.state !== \"running\") {",
    to: "  if (!s.job || s.job.state !== \"running\") {",
    expect: ["SW5.", "SW5a."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "a paid unit is sent past the job's wall-clock limit",
    file: STUDIO_WORKER_SPEND,
    from: "  if (!(timing.elapsedMs <= timing.limitMs)) {",
    to: "  if (!(timing.elapsedMs <= timing.limitMs) && Date.now() < 0) {",
    expect: ["SW5.", "SW5a."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "a paid unit is sent without a live reservation",
    file: STUDIO_WORKER_SPEND,
    from: "  if (reserved === null || !(reserved > 0) || s.run.quoteId === null || s.reserves.length !== 1 || s.reserves[0] !== reserved) {",
    to: "  if (reserved === null || !(reserved > 0)) {",
    expect: ["SW5."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "a paid unit is sent on a reservation already settled",
    file: STUDIO_WORKER_SPEND,
    from: "  if (s.settled) return no(\"reservation_settled\",",
    to: "  if (s.settled && Date.now() < 0) return no(\"reservation_settled\",",
    expect: ["SW5."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "a paid unit is sent on another user's quote",
    file: STUDIO_WORKER_SPEND,
    from: "  if (!s.quote || !s.quote.consumed || s.quote.userId !== s.run.requestedBy || QUOTE_ACTION[s.run.kind] !== s.quote.action) {",
    to: "  if (!s.quote || !s.quote.consumed || QUOTE_ACTION[s.run.kind] !== s.quote.action) {",
    expect: ["SW5."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "a paid unit is sent for a requester no longer an active owner or runner",
    file: STUDIO_WORKER_SPEND,
    from: "  if (!s.requester || s.requester.status !== \"active\" || ![\"owner\", \"runner\"].includes(s.requester.role)) {",
    to: "  if (!s.requester) {",
    expect: ["SW5."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "a paid unit with no price row is sent",
    file: STUDIO_WORKER_SPEND,
    from: "  if ([...price.requestCeilings, ...price.remainingCeilings].some((c) => c === undefined || !Number.isSafeInteger(c) || c <= 0)",
    to: "  if ([...price.requestCeilings, ...price.remainingCeilings].some((c) => c !== undefined && c < 0)",
    expect: ["SW5."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "a paid unit is sent while the run's charge exceeds its reservation",
    file: STUDIO_WORKER_SPEND,
    from: "  if (s.chargedMicros > reserved) {",
    to: "  if (s.chargedMicros > reserved && Date.now() < 0) {",
    expect: ["SW5."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "a paid unit is sent when the ceiling still to come does not fit the reservation",
    file: STUDIO_WORKER_SPEND,
    from: "  if (sum(price.remainingCeilings as number[]) > reserved - s.chargedMicros) {",
    to: "  if (sum(price.requestCeilings as number[]) > reserved - s.chargedMicros) {",
    expect: ["SW5."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "a paid unit is sent while an overrun is unacknowledged",
    file: STUDIO_WORKER_SPEND,
    from: "  if (s.unacknowledgedOverruns > 0) {",
    to: "  if (s.unacknowledgedOverruns > 1) {",
    expect: ["SW5.", "SW5a."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "the worker's own daily ceiling is ignored",
    file: STUDIO_WORKER_SPEND,
    from: "  const dailyCap = Math.min(caps.dailyMicros, s.settings?.dailyCapMicros ?? 0);",
    to: "  const dailyCap = s.settings?.dailyCapMicros ?? 0;",
    expect: ["SW5."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "an unreadable settings row lifts the daily cap",
    file: STUDIO_WORKER_SPEND,
    from: "  const dailyCap = Math.min(caps.dailyMicros, s.settings?.dailyCapMicros ?? 0);",
    to: "  const dailyCap = Math.min(caps.dailyMicros, s.settings?.dailyCapMicros ?? Number.MAX_SAFE_INTEGER);",
    expect: ["SW5."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "the monthly cap is ignored",
    file: STUDIO_WORKER_SPEND,
    from: "  if (!(s.monthSpendMicros <= monthlyCap)) return no(\"cap_exceeded_monthly\",",
    to: "  if (!(s.monthSpendMicros <= monthlyCap) && Date.now() < 0) return no(\"cap_exceeded_monthly\",",
    expect: ["SW5."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "the per-user daily cap is ignored",
    file: STUDIO_WORKER_SPEND,
    from: "  if (s.requester.dailyCapMicros !== null && !(s.userDaySpendMicros <= s.requester.dailyCapMicros)) {",
    to: "  if (s.requester.dailyCapMicros !== null && !(s.userDaySpendMicros <= s.requester.dailyCapMicros) && Date.now() < 0) {",
    expect: ["SW5."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "an overrun is never booked",
    file: STUDIO_WORKER_SPEND,
    from: "  if (chargedMicros > reservedMicros) return { entry: \"overrun\", micros: chargedMicros - reservedMicros };",
    to: "",
    expect: ["SW6."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "the worker's runtime builds a provider runner when it was given none",
    file: STUDIO_WORKER_EXECUTE,
    from: "        if (!paid) throw new WorkerStop(\"live_runs_not_enabled\", \"live runs are not enabled in this worker (Content Studio S6)\");",
    to: "        if (!paid) return base.stageExecution.createAnthropicStageRunner();",
    expect: ["SW8."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "a live run starts on a worker with no paid runner",
    file: STUDIO_WORKER_EXECUTE,
    from: "  if (!b.worker.paidRunner) {",
    to: "  if (!b.worker.paidRunner && Date.now() < 0) {",
    expect: ["SW11."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "a paid job runs on a quote for another worker commit",
    file: STUDIO_WORKER_EXECUTE,
    from: "  if (!q || q.workerCommit !== b.worker.commit || q.approvedFactsSha256 !== b.worker.approvedFactsSha256",
    to: "  if (!q || q.approvedFactsSha256 !== b.worker.approvedFactsSha256",
    expect: ["SW11."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "a paid job runs on a quote for another price table",
    file: STUDIO_WORKER_EXECUTE,
    from: "    || q.factVersionId !== b.run.factVersionId || q.priceTableSha256 !== b.worker.priceTableSha256) {",
    to: "    || q.factVersionId !== b.run.factVersionId) {",
    expect: ["SW11."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "the sink stores a rewritten file at its first write",
    file: STUDIO_WORKER_SINK,
    from: "  \"resume-meta.json\", \"revision-meta.json\", \"field-measurements.json\", \"field-measurements.md\",\n] as const;",
    to: "  \"resume-meta.json\", \"field-measurements.json\", \"field-measurements.md\",\n] as const;",
    expect: ["SW9."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "the sink lets an immutable artifact be written twice",
    file: STUDIO_WORKER_SINK,
    from: "    if (this.written.has(name)) {",
    to: "    if (this.written.has(name) && Date.now() < 0) {",
    expect: ["SW9."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "a claim is made without proving ownership",
    file: STUDIO_WORKER_JOBS,
    from: "  return session.tx(async (client) => {\n    if (!(await holdsOwnership(client))) throw new Error(\"ownership_lost: this session no longer holds the Studio worker lock\");\n    const job = (await client.query(",
    to: "  return session.tx(async (client) => {\n    const job = (await client.query(",
    expect: ["SW12."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "a claim waits on a locked job instead of skipping it",
    file: STUDIO_WORKER_JOBS,
    from: "        LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];",
    to: "        LIMIT 1 FOR UPDATE`)).rows[0];",
    expect: ["SW12."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "a claim takes paid and fake jobs before free preflight jobs",
    file: STUDIO_WORKER_JOBS,
    from: "        ORDER BY (kind = 'preflight') DESC, created_at, id",
    to: "        ORDER BY created_at, id",
    expect: ["SW12."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "a claim takes an expired job",
    file: STUDIO_WORKER_JOBS,
    from: "        WHERE state = 'queued' AND expires_at > now() AND cancel_requested_at IS NULL",
    to: "        WHERE state = 'queued' AND cancel_requested_at IS NULL",
    expect: ["SW12."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "a run ends with its unfinished request rows left started",
    file: STUDIO_WORKER_JOBS,
    from: "    \"UPDATE studio_run_requests SET outcome = 'failed', finished_at = now() WHERE run_id = $1 AND outcome = 'started'\", [runId]);",
    to: "    \"SELECT 1 WHERE $1::uuid IS NOT NULL\", [runId]);",
    expect: ["SW13."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "an overrun no longer fails a run that otherwise succeeded",
    file: STUDIO_WORKER_JOBS,
    from: "      if (settlement?.entry === \"overrun\" && runState === \"succeeded\") {",
    to: "      if (settlement?.entry === \"overrun\" && runState === \"succeeded\" && Date.now() < 0) {",
    expect: ["SW13."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "restart recovery marks a running run failed instead of interrupted",
    file: STUDIO_WORKER_JOBS,
    from: "        runState: \"interrupted\", jobState: \"finished\", failureClass: \"worker_restart\",",
    to: "        runState: \"failed\", jobState: \"finished\", failureClass: \"worker_restart\",",
    expect: ["SW13a."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "restart recovery runs without proving ownership",
    file: STUDIO_WORKER_JOBS,
    from: "  return session.tx(async (client) => {\n    if (!(await holdsOwnership(client))) throw new Error(\"ownership_lost: this session no longer holds the Studio worker lock\");\n    const runs = (await client.query(",
    to: "  return session.tx(async (client) => {\n    const runs = (await client.query(",
    expect: ["SW13a."],
    suite: STUDIO_WORKER_SUITE,
  },
  {
    name: "an expired queued job is cancelled instead of expired",
    file: STUDIO_WORKER_JOBS,
    from: "        ? { runState: \"cancelled\", jobState: \"expired\", failureClass: \"job_expired\",",
    to: "        ? { runState: \"cancelled\", jobState: \"cancelled\", failureClass: \"job_expired\",",
    expect: ["SW13a."],
    suite: STUDIO_WORKER_SUITE,
  },
];

// Every group, in order. MUTATIONS is their concatenation; the groups exist
// only so `M-inc-sample` can spread its sample across them.
const MUTATION_GROUPS = [
  ["legacy", LEGACY_MUTATIONS], ["raw identity", RAW_IDENTITY_MUTATIONS], ["field margin", FIELD_MARGIN_MUTATIONS],
  ["critic policy", CRITIC_POLICY_MUTATIONS], ["contact line", CONTACT_LINE_MUTATIONS],
  ["critic panel", CRITIC_PANEL_MUTATIONS], ["critic panel follow-up", CRITIC_PANEL_FOLLOW_UP_MUTATIONS],
  ["writer restriction", WRITER_RESTRICTION_MUTATIONS], ["identity scope", IDENTITY_SCOPE_MUTATIONS],
  ["Lane S approved facts", LANE_S_APPROVED_FACTS_MUTATIONS], ["packaging claimUse cap", PACKAGING_CLAIM_USE_CAP_MUTATIONS],
  ["stated caption and resume", STATED_CAPTION_AND_RESUME_MUTATIONS], ["comparison claim", COMPARISON_CLAIM_MUTATIONS],
  ["revision pass", REVISION_PASS_MUTATIONS], ["contact in overlay", CONTACT_IN_OVERLAY_MUTATIONS],
  ["Content Studio S1", CONTENT_STUDIO_S1_MUTATIONS], ["Content Studio S2", CONTENT_STUDIO_S2_MUTATIONS],
  ["Content Studio S3 context", CONTENT_STUDIO_S3_CONTEXT_MUTATIONS], ["Content Studio S3 worker", CONTENT_STUDIO_S3_WORKER_MUTATIONS],
];
const MUTATIONS = MUTATION_GROUPS.flatMap(([, group]) => group);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const decodeUtf8Strict = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const MUTATION_TARGETS = [
  ...new Set([...MUTATIONS.map((mutation) => mutation.file), SQL_AUTHORITY_SOURCE]),
].sort();

// Every suite a mutation runs. M0 and M-end prove each green on every copy.
const SUITES = [...new Set([CONTENT_INTELLIGENCE_SUITE, ...MUTATIONS.map((mutation) => mutation.suite ?? CONTENT_INTELLIGENCE_SUITE)])];

/**
 * `M-inc-sample`: the compiled mutations whose MUTATED sources also get a clean
 * `tsc` build, compared byte for byte with the incremental `dist/` the suite ran
 * against. Exactly INC_SAMPLE_SIZE of them, each from a different group, chosen
 * deterministically from a seed: `GITHUB_SHA` when it is set (in CI, the commit
 * the run tests, so successive commits sample different mutations), otherwise
 * INC_SAMPLE_DEFAULT_SEED. The groups that compile are ordered by
 * sha256(seed, group name) and the first INC_SAMPLE_SIZE taken; within each, the
 * compiled mutation at sha256(seed, group name, "mutation") modulo its compiled
 * count. A clean build costs about 10 CPU-seconds, and every restore is already
 * compared byte for byte (`M-inc-restore`), so a small rotating sample suffices.
 */
const isCompiledMutation = (mutation) => (mutation.file.startsWith("src/") && !mutation.file.endsWith(".json"))
  || Boolean(mutation.coordinatedAuthority);
const INC_SAMPLE_SIZE = 4;
const INC_SAMPLE_DEFAULT_SEED = "gcd-payload-mutation:inc-sample:v1";
const INC_SAMPLE_SEED_SOURCE = process.env.GITHUB_SHA ? "GITHUB_SHA" : "default";
const INC_SAMPLE_SEED = process.env.GITHUB_SHA || INC_SAMPLE_DEFAULT_SEED;
/** Sampled mutation index -> the name of its group. */
const INC_SAMPLE = new Map();
{
  const draw = (...parts) => createHash("sha256").update(parts.join("\0")).digest();
  const compiledGroups = [];
  let offset = 0;
  for (const [name, group] of MUTATION_GROUPS) {
    const compiled = group.flatMap((mutation, position) => (isCompiledMutation(mutation) ? [offset + position] : []));
    if (compiled.length) compiledGroups.push({ name, compiled, rank: draw(INC_SAMPLE_SEED, name).toString("hex") });
    offset += group.length;
  }
  compiledGroups.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
  for (const { name, compiled } of compiledGroups.slice(0, INC_SAMPLE_SIZE)) {
    INC_SAMPLE.set(compiled[draw(INC_SAMPLE_SEED, name, "mutation").readUInt32BE(0) % compiled.length], name);
  }
}
const INC_SAMPLE_IDS = [...INC_SAMPLE.keys()].sort((a, b) => a - b).map((index) => `M${index + 1}`);

/**
 * `--shard k/n`: run exactly the mutations whose zero-based index modulo `n` is
 * `k`. The selection depends on the index alone, so shards `0` to `n - 1` are
 * disjoint and together run every mutation; CI runs three, one in each of three
 * existing jobs, and `scripts/ci/check-mutation-shards.rb` checks that
 * `.github/workflows/ci.yml` runs each exactly once with the same `n`. Without
 * `--shard` the run is shard 0/1: every mutation, as before. Every per-run proof
 * (`M0`, `M-isolation`, `M-kill`, `M-capture`, the `M-inc` checks, `M-end`,
 * `M-copies`, `M-authority`, `M-order`) runs in every shard; `M-inc-sample` keeps
 * its global sample and compares the sampled ids this shard owns; `M-shard`
 * prints and checks the shard's own ids. Anything else spelled `--shard…`, a
 * second `--shard`, or a malformed or out-of-range value is refused before any
 * work starts.
 */
const parseShard = (args) => {
  const flags = args.flatMap((arg, at) => (arg.startsWith("--shard") ? [at] : []));
  if (flags.length === 0) return { k: 0, n: 1, sharded: false };
  if (flags.length > 1) return { error: "--shard may be given once" };
  if (args[flags[0]] !== "--shard") return { error: `unknown option ${args[flags[0]]}; use --shard k/n` };
  const value = args[flags[0] + 1] ?? "";
  const match = /^(0|[1-9][0-9]*)\/([1-9][0-9]*)$/.exec(value);
  if (!match) return { error: `--shard needs k/n with whole numbers, got "${value}"` };
  const k = Number(match[1]);
  const n = Number(match[2]);
  if (k >= n) return { error: `--shard ${value}: k must be less than n` };
  if (n > MUTATIONS.length) return { error: `--shard ${value}: n is more than the ${MUTATIONS.length} mutations` };
  return { k, n, sharded: true };
};
const SHARD = parseShard(process.argv.slice(2));
/** This run's mutation indices, ascending: every index i with i % n === k. */
const SHARD_INDICES = SHARD.error ? [] : MUTATIONS.flatMap((_, index) => (index % SHARD.n === SHARD.k ? [index] : []));
const SHARD_LABEL = SHARD.error ? "" : `${SHARD.k}/${SHARD.n}`;
/** The sampled mutations this shard owns, ascending. */
const SHARD_SAMPLE = SHARD_INDICES.filter((index) => INC_SAMPLE.has(index));

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

// The authoritative checkout's own `dist/` is not copied: every copy's first
// build writes its `dist/` from nothing, so nothing a copy's suite loads, and
// nothing the clean-build comparisons see, is left over from an older build.
const AUTHORITATIVE_DIST = resolve(AUTHORITATIVE_REPO_ROOT, "dist");

const prepareDisposableWorkspace = () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "gcd-payload-mutation-"));
  const workspace = join(tempRoot, basename(AUTHORITATIVE_REPO_ROOT));
  cpSync(AUTHORITATIVE_REPO_ROOT, workspace, {
    recursive: true,
    filter: (source) => ![".git", "node_modules"].includes(basename(source)) && source !== AUTHORITATIVE_DIST,
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

/**
 * The mutations run in parallel, on WORKER_COUNT workers. Each worker owns one
 * disposable no-Git copy and runs its mutations there one at a time, exactly as
 * a single sequential run would: mutate, rebuild when needed, run the suite,
 * restore byte-for-byte, verify the restoration, and rebuild the restored
 * sources when the mutation was compiled. No two workers share a copy, a
 * `dist/`, a compiler, a mutated file or a child process. Workers take the next
 * mutation id from one shared queue, so which worker runs which mutation varies
 * with timing, but no result depends on it: every copy starts from the same
 * bytes, and every mutation is restored — sources and `dist/` — before its
 * worker takes the next one. Mutation ids are fixed by position in MUTATIONS,
 * and results are printed strictly in id order.
 *
 * The worker count is the runner's available parallelism, capped at
 * MAX_WORKERS (each worker runs a compiler and a suite, so memory, not only CPU,
 * bounds it), and never more than the number of mutations this shard runs.
 */
const MAX_WORKERS = 4;
const WORKER_COUNT = Math.max(1, Math.min(MAX_WORKERS, availableParallelism(), SHARD_INDICES.length));

// Each build and suite runs as the leader of its own process group, so a
// signal can stop it together with everything it started (the suite spawns the
// local CLI). The workers' long-lived compilers are process-group leaders too.
const activeChildren = new Set();
const runChild = (command, args, cwd, env = process.env) => new Promise((resolveRun) => {
  const child = execFile(command, args, {
    cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, detached: true,
  }, (error, stdout) => {
    activeChildren.delete(child);
    resolveRun({ ok: error === null, status: error === null ? 0 : error.code, stdout: `${stdout ?? ""}` });
  });
  activeChildren.add(child);
});

// Wall time spent in each kind of work, summed over the workers; printed at the
// end, and per mutation with `--profile <file>`.
const timing = new Map();
const timed = async (kind, work) => {
  const started = performance.now();
  try {
    return await work();
  } finally {
    const entry = timing.get(kind) ?? { count: 0, ms: 0 };
    entry.count += 1;
    entry.ms += performance.now() - started;
    timing.set(kind, entry);
  }
};

/**
 * The worker's long-lived incremental compiler, started once per copy. One
 * `build` line in, one JSON line out: `tsc`'s own exit status for the build.
 * If it dies, every later build of that copy fails, so no mutation can pass on
 * a `dist/` nobody built.
 */
const startCompiler = (worker) => {
  const child = spawn(process.execPath, [SCRIPT_PATH, "--incremental-build-server"], {
    cwd: worker.workspace, stdio: ["pipe", "pipe", "inherit"], detached: true,
  });
  activeChildren.add(child);
  const waiting = [];
  let alive = true;
  createInterface({ input: child.stdout }).on("line", (line) => {
    let reply;
    try {
      reply = JSON.parse(line);
    } catch {
      reply = { status: -1, diagnostics: [`unreadable compiler reply: ${line.slice(0, 200)}`] };
    }
    waiting.shift()?.(reply);
  });
  child.on("exit", () => {
    alive = false;
    activeChildren.delete(child);
    for (const settle of waiting.splice(0)) settle({ status: -1, diagnostics: ["the compiler exited"] });
  });
  child.stdin.on("error", () => {});
  worker.compile = () => new Promise((settle) => {
    if (!alive) {
      settle({ status: -1, diagnostics: ["the compiler is not running"] });
      return;
    }
    waiting.push(settle);
    child.stdin.write("build\n");
  });
  worker.stopCompiler = () => {
    if (alive) child.stdin.end();
  };
};

/** An incremental build of the worker's copy into its `dist/`. True only for exit status 0. */
const build = async (worker, kind) => {
  const reply = await timed(kind, () => worker.compile());
  worker.lastStatus = reply.status;
  worker.lastDiagnostics = reply.diagnostics ?? [];
  return reply.status === 0;
};

/**
 * A clean full build: `tsc -p tsconfig.json` with no incremental state at all,
 * into the worker's `clean-dist/`, which is emptied first. It is the reference
 * every incremental `dist/` is compared with.
 */
const cleanBuild = async (worker, outDir = worker.cleanDist, kind = "clean build") => {
  rmSync(outDir, { recursive: true, force: true });
  const tsc = resolve(worker.workspace, "node_modules/typescript/bin/tsc");
  return (await timed(kind, () => runChild(process.execPath,
    [tsc, "-p", "tsconfig.json", "--incremental", "false", "--outDir", outDir], worker.workspace))).ok;
};

/**
 * `M-inc-sample`'s comparison: a clean full build of the copy's CURRENT sources
 * (for a sampled mutation, the mutated ones) into the worker's own `sample-dist/`,
 * compared with the incremental `dist/`. Every difference, or a clean build that
 * does not compile.
 */
const sampleComparison = async (worker) => ((await cleanBuild(worker, worker.sampleDist, "sample clean build"))
  ? treeDifferences(treeSnapshot(distOf(worker)), treeSnapshot(worker.sampleDist))
  : ["the clean build of the mutated sources did not compile"]);

const runSuite = async (worker, suite = CONTENT_INTELLIGENCE_SUITE) => {
  const { ok, stdout } = await timed("suite", () => runChild(process.execPath,
    [suite], worker.workspace, worker.suiteEnv));
  if (ok) return { failed: [], crashed: false };
  const failed = stdout.split("\n")
    .filter((line) => line.startsWith("FAIL  "))
    .map((line) => line.slice("FAIL  ".length));
  return { failed, crashed: failed.length === 0 };
};

/** Every suite in SUITES, one after another; failed lines are joined and any crash is a crash. */
const runEverySuite = async (worker) => {
  const runs = [];
  for (const suite of SUITES) runs.push(await runSuite(worker, suite));
  return { failed: runs.flatMap((run) => run.failed), crashed: runs.some((run) => run.crashed) };
};

/** Every file under `dir`, by relative path, with its bytes (null for anything not a regular file). */
const treeSnapshot = (dir) => {
  const files = new Map();
  const walk = (at, prefix) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      const key = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(path);
      if (stat.isDirectory()) walk(path, key);
      else files.set(key, stat.isFile() ? readFileSync(path) : null);
    }
  };
  if (existsSync(dir)) walk(dir, "");
  return files;
};

/** Every way `actual` differs from `expected`: a file missing, unexpected, or with other bytes. */
const treeDifferences = (actual, expected) => {
  const differences = [];
  for (const [file, bytes] of expected) {
    if (!actual.has(file)) {
      differences.push(`${file} missing`);
      continue;
    }
    const other = actual.get(file);
    if (bytes === null || other === null || !other.equals(bytes) || sha256(other) !== sha256(bytes)) {
      differences.push(`${file} differs`);
    }
  }
  for (const file of actual.keys()) if (!expected.has(file)) differences.push(`${file} unexpected`);
  return differences;
};

const distOf = (worker) => resolve(worker.workspace, "dist");
const summarize = (differences) => (differences.length > 5
  ? `${differences.slice(0, 5).join("; ")}; and ${differences.length - 5} more`
  : differences.join("; "));

const inFlight = new Map();
const disposableTempRoots = new Set();
let restoringOnSignal = false;
const stopChildren = () => {
  for (const child of activeChildren) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // The group has already exited.
    }
  }
  activeChildren.clear();
};
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
  // Children first, so no build or suite still writes into a copy being removed.
  stopChildren();
  restoreAll();
  for (const tempRoot of disposableTempRoots) {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // Best effort during process teardown. The authoritative tree was never a write target.
    }
  }
  disposableTempRoots.clear();
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

/**
 * The long-lived compiler one worker's copy builds with (its cwd is the copy).
 * It uses the copy's own TypeScript, re-reads `tsconfig.json` for every build,
 * and keeps the previous builder program, and every unchanged source file's
 * syntax tree, in memory — exactly what `tsc --watch` keeps — so each build
 * re-checks and re-emits only the files a change affects. The exit status is
 * computed by `tsc`'s own `emitFilesAndReportErrorsAndGetExitStatus`: 0 only
 * when there is no diagnostic of any kind, and outputs are written even on error,
 * as `tsc` writes them. It exits when its input closes, so a killed harness
 * cannot leave it running.
 */
const incrementalBuildServer = () => {
  const root = process.cwd();
  const ts = createRequire(resolve(root, "package.json"))("typescript");
  const configPath = resolve(root, "tsconfig.json");
  const sourceFiles = new Map();
  let previous;
  const formatHost = {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n",
  };
  const buildOnce = () => {
    const diagnostics = [];
    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, undefined, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    if (!parsed) return { status: 1, diagnostics };
    const host = ts.createIncrementalCompilerHost(parsed.options, ts.sys);
    const createSourceFile = host.getSourceFile;
    // An unchanged file keeps its syntax tree: the same object is handed back
    // only when its bytes and parse options are the same as last time.
    host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
      const text = ts.sys.readFile(fileName);
      const options = typeof languageVersionOrOptions === "object"
        ? languageVersionOrOptions : { languageVersion: languageVersionOrOptions };
      const key = text === undefined ? undefined : [options.languageVersion, options.impliedNodeFormat,
        options.jsDocParsingMode, sha256(Buffer.from(text, "utf8"))].join("\0");
      const cached = sourceFiles.get(fileName);
      if (key !== undefined && cached?.key === key && !shouldCreateNewSourceFile) return cached.sourceFile;
      const sourceFile = createSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
      if (sourceFile && key !== undefined && sourceFile.text === text) sourceFiles.set(fileName, { key, sourceFile });
      else sourceFiles.delete(fileName);
      return sourceFile;
    };
    previous = ts.createEmitAndSemanticDiagnosticsBuilderProgram(parsed.fileNames, parsed.options, host, previous,
      ts.getConfigFileParsingDiagnostics(parsed), parsed.projectReferences);
    const status = ts.emitFilesAndReportErrorsAndGetExitStatus(previous, (diagnostic) => diagnostics.push(diagnostic));
    return { status, diagnostics };
  };
  createInterface({ input: process.stdin }).on("line", (line) => {
    if (line !== "build") return;
    let reply;
    try {
      const { status, diagnostics } = buildOnce();
      reply = {
        status,
        diagnostics: diagnostics.slice(0, 20).map((diagnostic) => ts.formatDiagnostic(diagnostic, formatHost).trim()),
      };
    } catch (error) {
      reply = { status: -1, diagnostics: [`the compiler threw: ${error instanceof Error ? error.message : String(error)}`] };
    }
    process.stdout.write(`${JSON.stringify(reply)}\n`);
  });
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

const mutationBytes = (mutation, original, root) => {
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
    return readFileSync(resolve(root, mutation.replaceWithFile));
  }
  if (mutation.symlinkTo !== undefined) return null;
  throw new Error(`mutation ${mutation.name} has no mutation operation`);
};

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

// The clean full build of the unmutated sources, captured once before any
// mutation: every restored copy's `dist/` must equal it byte for byte.
let cleanBaseline;
const restoreProblems = [];
let restoreRebuilds = 0;
const sampleProblems = [];
let sampleComparisons = 0;
const profile = [];

/**
 * One mutation, in one worker's copy. It returns its check results rather than
 * printing them, so they can be printed in id order whichever worker ran it.
 */
const runMutation = async (worker, mutation, index) => {
  const results = [];
  const record = (name, ok, detail = "") => { results.push({ name, ok, detail }); };
  const root = worker.workspace;
  const id = `M${index + 1}`;
  const path = resolve(root, mutation.file);
  const original = readFileSync(path);
  const touched = [];
  const started = performance.now();
  const spent = { build: 0, suite: 0, restore: 0, sample: 0 };
  let mutated;
  try {
    mutated = mutationBytes(mutation, original, root);
  } catch (error) {
    record(`${id}. ${mutation.name}`, false, error instanceof Error ? error.message : String(error));
    return results;
  }

  const touch = (target, bytes) => {
    if (!inFlight.has(target)) {
      inFlight.set(target, bytes);
      touched.push([target, bytes]);
    }
  };

  const compiled = (mutation.file.startsWith("src/") && !mutation.file.endsWith(".json"))
    || mutation.coordinatedAuthority;
  let built = false;
  try {
    touch(path, original);
    if (mutation.symlinkTo !== undefined) {
      rmSync(path, { force: true });
      symlinkSync(resolve(root, mutation.symlinkTo), path);
    } else {
      writeFileSync(path, mutated);
    }

    if (mutation.coordinatedAuthority) {
      const manifestPath = resolve(root, SQL_AUTHORITY);
      const manifestOriginal = readFileSync(manifestPath);
      const manifestText = decodeUtf8Strict(manifestOriginal);
      const oldArtifactDigest = sha256(original);
      const artifactOccurrences = manifestText.split(oldArtifactDigest).length - 1;
      record(`${id}a. the changed artifact has exactly one manifest digest to update`,
        artifactOccurrences === 1, `found ${artifactOccurrences}`);
      if (artifactOccurrences !== 1) return results;
      touch(manifestPath, manifestOriginal);
      const manifestMutated = Buffer.from(
        manifestText.replace(oldArtifactDigest, sha256(mutated)), "utf8",
      );
      writeFileSync(manifestPath, manifestMutated);

      const sourcePath = resolve(root, SQL_AUTHORITY_SOURCE);
      const sourceOriginal = readFileSync(sourcePath);
      const sourceText = decodeUtf8Strict(sourceOriginal);
      const oldManifestDigest = sha256(manifestOriginal);
      const pinOccurrences = sourceText.split(oldManifestDigest).length - 1;
      record(`${id}b. the changed manifest has exactly one independent source pin to update`,
        pinOccurrences === 1, `found ${pinOccurrences}`);
      if (pinOccurrences !== 1) return results;
      touch(sourcePath, sourceOriginal);
      writeFileSync(sourcePath, Buffer.from(
        sourceText.replace(oldManifestDigest, sha256(manifestMutated)), "utf8",
      ));
    }

    let buildFailed = false;
    if (compiled) {
      built = true;
      const buildStarted = performance.now();
      buildFailed = !(await build(worker, "build"));
      spent.build = performance.now() - buildStarted;
    }
    const suiteStarted = performance.now();
    const result = buildFailed ? { failed: [], crashed: true } : await runSuite(worker, mutation.suite);
    spent.suite = performance.now() - suiteStarted;

    // M-inc-sample: for a sampled compiled mutation, the incremental dist/ the
    // suite just ran is compared with a clean build of the same MUTATED sources.
    if (compiled && INC_SAMPLE.has(index)) {
      const sampleStarted = performance.now();
      sampleComparisons += 1;
      const differences = buildFailed ? ["the mutated copy did not compile incrementally"] : await sampleComparison(worker);
      if (differences.length) sampleProblems.push(`${id}: ${summarize(differences)}`);
      spent.sample = performance.now() - sampleStarted;
    }

    if (mutation.mustPass) {
      record(`${id}. ${mutation.name} — the suite stays green with coordinated authority`,
        !buildFailed && !result.crashed && result.failed.length === 0,
        buildFailed ? "the mutated copy did not compile"
          : result.crashed ? "the suite aborted"
          : `wrongly reported: ${result.failed.map((line) => line.split(".")[0]).join(", ")}`);
    } else {
      const named = mutation.expect.filter((prefix) =>
        result.failed.some((line) => line.startsWith(prefix)));
      record(`${id}. ${mutation.name} — the suite reports it by name `
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
      record(`${id}r. ${restorePath.slice(root.length + 1)} is restored byte-for-byte`,
        restored.equals(restoreBytes) && sha256(restored) === sha256(restoreBytes),
        `sha256 before=${sha256(restoreBytes)} after=${sha256(restored)}`);
    }
  }

  // The restored sources are rebuilt now, before this worker takes another
  // mutation, and the result must be the clean build exactly. On any difference
  // the copy's `dist/` is rebuilt from nothing, so no later mutation inherits it.
  if (built) {
    const restoreStarted = performance.now();
    restoreRebuilds += 1;
    const ok = await build(worker, "restore build");
    const differences = ok ? treeDifferences(treeSnapshot(distOf(worker)), cleanBaseline)
      : [`the restored sources did not compile: ${worker.lastDiagnostics.join(" | ")}`];
    if (differences.length) {
      restoreProblems.push(`${id}: ${summarize(differences)}`);
      worker.stopCompiler();
      rmSync(distOf(worker), { recursive: true, force: true });
      startCompiler(worker);
      await build(worker, "recovery build");
    }
    spent.restore = performance.now() - restoreStarted;
  }
  profile.push({ id: index + 1, file: mutation.file, compiled, ...spent, total: performance.now() - started });
  return results;
};

async function main() {
  const startedAt = Date.now();
  const profileAt = process.argv.indexOf("--profile");
  const profilePath = profileAt >= 0 ? process.argv[profileAt + 1] : undefined;
  if (SHARD.error) {
    console.error(`payload-contract-mutation: ${SHARD.error}`);
    process.exit(2);
  }
  console.log("Payload-contract mutation tests\n");
  const coordinatedCount = MUTATIONS.filter((mutation) => mutation.mustPass).length;
  const prohibitedCount = MUTATIONS.length - coordinatedCount;
  console.log(`Source inventory: ${MUTATIONS.length} mutations (${prohibitedCount} prohibited, `
    + `${coordinatedCount} coordinated-authority-update)`);
  if (SHARD.sharded) {
    console.log(`Shard: ${SHARD_LABEL} — the ${SHARD_INDICES.length} of ${MUTATIONS.length} mutations whose `
      + `zero-based index modulo ${SHARD.n} is ${SHARD.k}`);
  }
  console.log(`Workers: ${WORKER_COUNT} (available parallelism ${availableParallelism()}, `
    + `maximum ${MAX_WORKERS}), each in its own disposable no-Git copy`);
  console.log(`M-inc-sample seed: ${INC_SAMPLE_SEED} (${INC_SAMPLE_SEED_SOURCE}); sampled: ${INC_SAMPLE_IDS.join(", ")} `
    + `(${[...INC_SAMPLE].sort(([a], [b]) => a - b).map(([, group]) => group).join(", ")})`
    + `${SHARD.sharded ? `; this shard's share: ${SHARD_SAMPLE.map((index) => `M${index + 1}`).join(", ") || "none"}` : ""}\n`);

  const authoritativeBefore = snapshotAuthoritative();
  const workers = [];
  for (let slot = 0; slot < WORKER_COUNT; slot += 1) {
    const prepared = prepareDisposableWorkspace();
    disposableTempRoots.add(prepared.tempRoot);
    const compileCache = join(prepared.tempRoot, "compile-cache");
    mkdirSync(compileCache);
    workers.push({
      ...prepared,
      cleanDist: join(prepared.tempRoot, "clean-dist"),
      sampleDist: join(prepared.tempRoot, "sample-dist"),
      suiteEnv: { ...process.env, NODE_COMPILE_CACHE: compileCache },
    });
  }
  const workspaces = workers.map((worker) => worker.workspace);
  check("M-isolation. every mutation, build, suite, and restoration targets a disposable no-Git copy, "
    + "one per worker, shared by no other worker",
  workspaces.every((workspace) => workspace !== AUTHORITATIVE_REPO_ROOT
    && !workspace.startsWith(`${AUTHORITATIVE_REPO_ROOT}/`)
    && !existsSync(resolve(workspace, ".git")))
    && new Set(workers.map((worker) => worker.tempRoot)).size === WORKER_COUNT
    && workers.every((worker) => workers.every((other) => other === worker
      || !worker.tempRoot.startsWith(`${other.tempRoot}/`))));
  check(`M-capture. captured raw bytes and Git status for all ${MUTATION_TARGETS.length} authoritative targets`,
    authoritativeBefore.files.size === MUTATION_TARGETS.length);
  const interruption = await runAbruptInterruptionProof(authoritativeBefore);
  check("M-kill. the harness was killed by SIGKILL while its disposable target was modified, "
    + "and authoritative bytes/status were unchanged during and after it",
  interruption.disposableWasActivelyMutated
    && interruption.unchangedDuring
    && interruption.unchangedAfter);

  for (const worker of workers) startCompiler(worker);
  const [baselines, cleanOk] = await Promise.all([
    Promise.all(workers.map(async (worker) => ((await build(worker, "first build"))
      ? runEverySuite(worker)
      : { failed: [], crashed: true, buildFailed: true }))),
    cleanBuild(workers[0]),
  ]);
  check(`M0. every unmutated disposable copy (${WORKER_COUNT}) builds and every suite a mutation runs passes `
    + `(${SUITES.length}: ${SUITES.map((suite) => basename(suite)).join(", ")})`,
    baselines.every((baseline) => !baseline.crashed && baseline.failed.length === 0),
    baselines.map((baseline, slot) => `copy ${slot + 1}: `
      + (baseline.buildFailed ? "did not compile"
        : baseline.crashed ? "crashed" : baseline.failed.join(" | ") || "green")).join("; "));
  cleanBaseline = treeSnapshot(workers[0].cleanDist);
  const firstDifferences = workers.map((worker) => treeDifferences(treeSnapshot(distOf(worker)), cleanBaseline));
  check(`M-inc0. every copy's first incremental dist/ is byte-identical to a clean full build of the same `
    + `sources (${cleanBaseline.size} files)`,
  cleanOk && cleanBaseline.size > 0 && firstDifferences.every((differences) => differences.length === 0),
  cleanOk ? firstDifferences.map((differences, slot) => `copy ${slot + 1}: ${summarize(differences) || "identical"}`)
    .join("; ") : "the clean build did not compile");
  if (failures) {
    console.log("\nBaseline or isolation proof is not green; mutation results would be meaningless.");
    process.exit(1);
  }

  // Workers take the shard's mutations in index order from one shared queue;
  // `outcomes` and `ran` are by position in SHARD_INDICES.
  const outcomes = new Array(SHARD_INDICES.length);
  const ran = [];
  const printed = [];
  let nextPosition = 0;
  let nextToPrint = 0;
  const printInOrder = () => {
    while (nextToPrint < outcomes.length && outcomes[nextToPrint] !== undefined) {
      for (const { name, ok, detail } of outcomes[nextToPrint]) check(name, ok, detail);
      printed.push(SHARD_INDICES[nextToPrint]);
      nextToPrint += 1;
    }
  };
  const runWorker = async (worker) => {
    while (nextPosition < SHARD_INDICES.length) {
      const position = nextPosition;
      nextPosition += 1;
      const index = SHARD_INDICES[position];
      ran.push(index);
      outcomes[position] = await runMutation(worker, MUTATIONS[index], index);
      printInOrder();
    }
  };
  await Promise.all(workers.map(runWorker));
  printInOrder();
  check(`M-order. every mutation ${SHARD.sharded ? `in shard ${SHARD_LABEL} ` : ""}ran exactly once and its results `
    + "were printed in id order",
  nextToPrint === SHARD_INDICES.length && outcomes.every((outcome) => Array.isArray(outcome))
    && printed.length === SHARD_INDICES.length && printed.every((index, at) => index === SHARD_INDICES[at]
      && (at === 0 || printed[at - 1] < index)));

  // M-shard: the ids this run actually took from the queue, checked against
  // the closed-form count of indices congruent to k modulo n, not against the
  // filter that chose them.
  const ranSorted = [...ran].sort((a, b) => a - b);
  const expectedCount = SHARD.k < MUTATIONS.length ? Math.floor((MUTATIONS.length - 1 - SHARD.k) / SHARD.n) + 1 : 0;
  console.log(`\nM-shard: k=${SHARD.k}, n=${SHARD.n}${SHARD.sharded ? "" : " (no --shard: every mutation)"}; `
    + `${MUTATIONS.length} mutations in all; this shard ran ${ran.length}: `
    + `${ranSorted.map((index) => `M${index + 1}`).join(", ")}\n`);
  check(`M-shard. shard ${SHARD_LABEL} ran exactly the ${expectedCount} of ${MUTATIONS.length} mutations whose `
    + `zero-based index is ${SHARD.k} modulo ${SHARD.n}, each once, with 0 <= k < n <= ${MUTATIONS.length}`,
  Number.isInteger(SHARD.k) && Number.isInteger(SHARD.n) && SHARD.k >= 0 && SHARD.k < SHARD.n
    && SHARD.n <= MUTATIONS.length && expectedCount > 0
    && ran.length === expectedCount && new Set(ran).size === ran.length
    && ranSorted.every((index, at) => index === SHARD.k + at * SHARD.n),
  `ran ${ran.length}, expected ${expectedCount}`);

  const compiledCount = SHARD_INDICES.filter((index) => isCompiledMutation(MUTATIONS[index])).length;
  check(`M-inc-restore. after every compiled mutation (${restoreRebuilds} of ${compiledCount}), the incremental `
    + "rebuild of its restored sources is byte-identical to the clean full build",
  restoreRebuilds === compiledCount && restoreProblems.length === 0, summarize(restoreProblems));
  const shardSampleIds = SHARD_SAMPLE.map((index) => `M${index + 1}`);
  check(`M-inc-sample. for ${sampleComparisons} of ${compiledCount} compiled mutations (`
    + (SHARD.sharded ? `${shardSampleIds.join(", ") || "none"}: this shard's share of the global sample `
      + `${INC_SAMPLE_IDS.join(", ")}, ` : `${INC_SAMPLE_IDS.join(", ")}, `)
    + `one from each of ${new Set(INC_SAMPLE.values()).size} groups, seed ${INC_SAMPLE_SEED_SOURCE}), a clean tsc `
    + "build of the MUTATED sources is byte-identical to the incremental dist/ the suite ran against",
  sampleComparisons === SHARD_SAMPLE.length && INC_SAMPLE.size === INC_SAMPLE_SIZE
    && new Set(INC_SAMPLE.values()).size === INC_SAMPLE_SIZE
    && [...INC_SAMPLE.keys()].every((index) => isCompiledMutation(MUTATIONS[index]))
    && SHARD_SAMPLE.every((index) => index % SHARD.n === SHARD.k)
    && sampleProblems.length === 0,
  summarize(sampleProblems));

  const finals = await Promise.all(workers.map(async (worker) => {
    const incremental = await build(worker, "final build");
    const clean = await cleanBuild(worker);
    const differences = !incremental ? [`the restored copy did not compile: ${worker.lastDiagnostics.join(" | ")}`]
      : !clean ? ["the clean full build did not compile"]
      : treeDifferences(treeSnapshot(distOf(worker)), treeSnapshot(worker.cleanDist));
    const run = incremental ? await runEverySuite(worker) : { failed: [], crashed: true, buildFailed: true };
    return { differences, run };
  }));
  check("M-inc-end. after its last mutation, every copy's incremental dist/ is byte-identical to a fresh clean "
    + "full build of its restored sources, before the final suite pass",
  finals.every(({ differences }) => differences.length === 0),
  finals.map(({ differences }, slot) => `copy ${slot + 1}: ${summarize(differences) || "identical"}`).join("; "));
  check("M-end. after every raw mutation is reverted every disposable copy's suites all pass again",
    finals.every(({ run }) => !run.crashed && run.failed.length === 0),
    finals.map(({ run }, slot) => `copy ${slot + 1}: `
      + (run.buildFailed ? "did not compile"
        : run.crashed ? "crashed" : run.failed.join(" | ") || "green")).join("; "));

  // Injected faults, in the first copy, after its final suite pass: each must
  // make the incremental build or its comparison with the clean build fail.
  const faulted = workers[0];

  // M-inc-sample-fault: the sample comparison FAILS when the incremental dist/
  // does not reflect the mutated sources (a stale build of a real source edit),
  // passes once the incremental compiler has built them, and the copy is then
  // restored byte for byte and rebuilt to the clean build exactly.
  const sampleFaultTarget = resolve(faulted.workspace, PAYLOAD);
  const sampleFaultOriginal = readFileSync(sampleFaultTarget);
  inFlight.set(sampleFaultTarget, sampleFaultOriginal);
  writeFileSync(sampleFaultTarget, Buffer.concat([sampleFaultOriginal,
    Buffer.from("\nexport const mutationHarnessSampleFault = 1;\n", "utf8")]));
  const staleSample = await sampleComparison(faulted);
  const sampleRebuilt = await build(faulted, "fault build");
  const freshSample = await sampleComparison(faulted);
  restoreRaw(sampleFaultTarget, sampleFaultOriginal);
  inFlight.delete(sampleFaultTarget);
  const sampleRestored = await build(faulted, "fault build")
    && readFileSync(sampleFaultTarget).equals(sampleFaultOriginal)
    && treeDifferences(treeSnapshot(distOf(faulted)), treeSnapshot(faulted.cleanDist)).length === 0;
  check("M-inc-sample-fault. the sample comparison reports a stale incremental dist/ (a source edited and not "
    + "rebuilt) as a difference from the clean build of the edited sources, reports none once the incremental "
    + "compiler has built them, and the copy is restored and rebuilt to the clean build exactly",
  staleSample.length === 1 && staleSample[0] === "harness/agents/payloadContract.js differs"
    && sampleRebuilt && freshSample.length === 0 && sampleRestored,
  `stale: ${staleSample.join(", ") || "none"}; rebuilt: ${sampleRebuilt}; after the build: `
    + `${freshSample.join(", ") || "none"}; restored: ${sampleRestored}`);

  const clean = treeSnapshot(faulted.cleanDist);
  const faultSource = resolve(faulted.workspace, "src/harness/mutationHarnessInjectedFault.ts");
  // Real `tsc` checks the same source state (`--noEmit`, so it writes nothing).
  const realTsc = async () => (await timed("fault build", () => runChild(process.execPath,
    [resolve(faulted.workspace, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json", "--noEmit"],
    faulted.workspace))).status;
  writeFileSync(faultSource, "export const injectedFault: number = \"not a number\";\n");
  const tscWithFault = await realTsc();
  const typeErrorRefused = !(await build(faulted, "fault build"))
    && faulted.lastDiagnostics.some((line) => line.includes("TS2322"));
  const compilerWithFault = faulted.lastStatus;
  rmSync(faultSource);
  const tscWithoutFault = await realTsc();
  const orphanBuilt = await build(faulted, "fault build");
  const compilerWithoutFault = faulted.lastStatus;
  check("M-inc-tsc. a source state with an injected type error fails real tsc and fails the incremental compiler "
    + "with a non-zero status; with the fault removed, both return 0",
  tscWithFault !== 0 && compilerWithFault !== 0 && tscWithoutFault === 0 && compilerWithoutFault === 0,
  `real tsc: ${tscWithFault} with the fault, ${tscWithoutFault} without; `
    + `incremental compiler: ${compilerWithFault} with the fault, ${compilerWithoutFault} without`);
  const orphan = treeDifferences(treeSnapshot(distOf(faulted)), clean);
  rmSync(resolve(distOf(faulted), "harness/mutationHarnessInjectedFault.js"), { force: true });
  const staleTarget = "harness/agents/payloadContract.js";
  const staleBytes = Buffer.from(readFileSync(resolve(distOf(faulted), staleTarget)));
  staleBytes[staleBytes.length - 1] ^= 0x01;
  writeFileSync(resolve(distOf(faulted), staleTarget), staleBytes);
  const staleBuilt = await build(faulted, "fault build");
  const stale = treeDifferences(treeSnapshot(distOf(faulted)), clean);
  const withoutOne = new Map(clean);
  withoutOne.delete(staleTarget);
  const missing = treeDifferences(withoutOne, clean);
  check("M-inc-fault. the incremental compiler refuses an injected type error, and the comparison with the clean "
    + "build reports an orphaned output, a stale output the incremental compiler does not re-emit, and a missing file",
  typeErrorRefused
    && orphanBuilt && orphan.length === 1 && orphan[0] === "harness/mutationHarnessInjectedFault.js unexpected"
    && staleBuilt && stale.length === 1 && stale[0] === `${staleTarget} differs`
    && missing.length === 1 && missing[0] === `${staleTarget} missing`
    && treeDifferences(clean, clean).length === 0,
  `type error refused: ${typeErrorRefused}; orphan: ${orphan.join(", ") || "none"}; `
    + `stale: ${stale.join(", ") || "none"}; missing: ${missing.join(", ") || "none"}`);

  check("M-copies. every worker's copy of every target is byte-identical to the authoritative bytes "
    + "captured before the run",
  workspaces.every((workspace) => [...authoritativeBefore.files].every(([file, before]) => {
    const target = resolve(workspace, file);
    if (!lstatSync(target).isFile()) return false;
    const after = readFileSync(target);
    return after.equals(before) && sha256(after) === sha256(before);
  })));
  check("M-authority. authoritative target bytes and Git status stayed unchanged",
    authoritativeSnapshotMatches(authoritativeBefore));

  for (const worker of workers) worker.stopCompiler();
  if (profilePath) writeFileSync(profilePath, `${JSON.stringify(profile.sort((a, b) => a.id - b.id), null, 1)}\n`);
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  const duration = `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
  console.log(`\nTime, summed over workers: ${[...timing].map(([kind, { count, ms }]) =>
    `${count} ${kind}${count === 1 ? "" : "s"} ${Math.round(ms / 1000)}s`).join(", ")}`);
  const ranLabel = SHARD.sharded ? `shard ${SHARD_LABEL}: ${SHARD_INDICES.length} of ${MUTATIONS.length} mutations`
    : `${MUTATIONS.length} mutations`;
  console.log(failures === 0
    ? `\nALL PASS — ${ranLabel}, ${WORKER_COUNT} workers, ${duration}`
    : `\n${failures} FAILURE(S) — ${ranLabel}, ${WORKER_COUNT} workers, ${duration}`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv[2] === "--interrupt-probe-child") {
  interruptionProbeChild();
} else if (process.argv[2] === "--incremental-build-server") {
  incrementalBuildServer();
} else {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
