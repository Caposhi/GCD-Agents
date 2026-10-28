# GCD Content Intelligence roadmap

Last reviewed: 2026-10-17 (the roadmap split's final inspection fix — this file reread whole).

This roadmap is the canonical unfinished-work sequence and the current-phase cursor. It orders work; it does not grant authority to deploy, migrate, call providers, change external configuration, or begin a phase. [Status](STATUS.md) records what is verified true now. Where this file and verified production evidence disagree, resolve the discrepancy rather than following this text. Roadmap continuity is binding — see [`AGENTS.md`](../AGENTS.md). **Completed history is in [Completed roadmap phases](COMPLETED_ROADMAP_PHASES.md)** (since 2026-10-16): the completed-phase records and superseded cursors relocated from this file byte-for-byte, historical only. New records are written here first.

## State vocabulary

| State | Meaning |
|---|---|
| `PLANNED` | In scope and ordered, but not built |
| `IMPLEMENTED` | Code exists and local validation passes |
| `MERGED` | Merged to `main` at a known SHA; says nothing about production |
| `CONFIGURED` | External identifiers/settings exist |
| `ENABLED` | The gate controlling it is actually on |
| `DEPLOYED` | A release carrying it is live in production |
| `PRODUCTION-VALIDATED` | Its behavior has been observed in production |
| `BLOCKED` | A named dependency or decision prevents safe progress |
| `DEFERRED` | Intentionally not scheduled; reason and re-entry condition recorded |
| `SUPERSEDED` | Replaced by a different accepted design; kept for its rationale |

These are not interchangeable and must not be collapsed into "done". `MERGED` in particular is not `DEPLOYED`.

## Implemented repository change awaiting merge

### Reconciliation release preflight checklist — `docs/M2_PREFLIGHT_CHECKLIST.md`; the interval's lapsed bound recorded as an open decision — `IMPLEMENTED`

**State:** `IMPLEMENTED` on branch `claude/m2-preflight-checklist`, based on `origin/main` at `282fe54…`. **Documentation only. Not `MERGED`.** **PR:** none opened. **Authorization:** the owner's request of 2026-10-28, "Write the M2 preflight checklist". **Not authorized and not performed:** any deploy, any Render or database access, any interval decision.

**Delivered scope.** [`docs/M2_PREFLIGHT_CHECKLIST.md`](M2_PREFLIGHT_CHECKLIST.md): owner decisions D1–D6; the target-commit comparison; repository preconditions; live read-only preflight items delegated to the operator; a compatibility gate; the sequence with stop conditions; rollback; the documents to update afterwards; and the unknowns. A row in the root [README](../README.md)'s document table.

**Findings it records, REVIEWER-VERIFIED or LOCAL.** (1) The interval bound `2026-10-22T18:52Z` has passed and **the repository records no decision**; the `Interval monitor` runs #31–#37 stayed green because the monitor never gates on expiry. (2) The design's **M2** (deploy P1–P7, migration `008`) cannot be performed from any existing commit — P1–P7 are unmerged and `main` has migrations `001`–`007` only — so what is being waited on is the *reconciliation release*, a migration-free act the design describes only in a sentence; the checklist recommends recording it as such and not redefining M2. (3) **`A` (`d501523…`, the API's live artifact) already contains the four image/QC fixes** (`7697bf2`, `ebdcbb2`, `10543d8`, `83a5a7d` are ancestors of `A`) and is on `main`. Releasing **the worker and scheduler at `A`** is therefore the smallest reconciliation: no migration, no model change, no monitor edit, the API untouched. This corrects the 2026-10-14 framing, which assumed the fixes could reach production only through a larger release of `main`. LOCAL at `A`: build, typecheck, `test:offline` (nine suites, 1,261 `PASS` lines + 1 + 112) and the simulated dry run pass.

**Material design decisions.** The checklist recommends `A` for the worker and scheduler only, the worker first, with the cadence and image-text changes (PRs #133, #134) and the Sonnet 5 migration as later, separate releases. **Rejected:** releasing current `main` as the closing step (it bundles an unverified model change, 11 changed live modules and the manifest conflict between the two open PRs); a cherry-pick branch on `R` (not on `main`, so neither the controller nor a dashboard commit picker can reach it — see the 2026-10-14 decision's record).

**Migrations:** none. **Automated validation:** `check:markdown-links`, `scan:sensitive`, `git diff --check`, `test:interval-monitor` and `test:content-intelligence` (the documents they bind to are unchanged in the parts they read). **Production evidence:** none. **Rollback:** revert the commit. **Security and privacy:** no credential or URL added; no step weakens the approval gate.

**Accepted limitations / unresolved.** The checklist is unreviewed by the owner; its live items are unverified; the interval decision (D1), the target (D3) and the window (D5) are the owner's. **Documents updated:** this file; [Status](STATUS.md); the root [README](../README.md); the new checklist.

### Roadmap split — completed history relocated to `docs/COMPLETED_ROADMAP_PHASES.md`, byte-for-byte; PR #129 reconciled; PR #129's five inspection notes folded in — `IMPLEMENTED`

**State:** `IMPLEMENTED` on branch `claude/laughing-ptolemy-yjctri`, based directly on `origin/main` at `2cd98e163ac2296ad3d08d09af2286d35e2a0c6e` (the merge of PR #129). **Not `MERGED`.** **Documentation, plus comment text in three source files:** only `docs/**`, `README.md`, one paragraph of [`AGENTS.md`](../AGENTS.md) and four source comments change — the `AGENTS.md` edit statements of fact only, separately authorized by the owner on 2026-10-16 under rule (b) (below); the four comments repointed to the ledger, comment text only, authorized by the owner on 2026-10-16 (below); the 246 tracked files outside them — `.DS_Store`, `src/harness/agents/modelPolicy.ts` and `scripts/ci/live-path-manifest.json` among them — are byte-identical (sha256 compared before and after), and no untracked file was added outside `docs/`. **It performs nothing:** nothing was deployed, restarted, configured or changed on Render, Google or Anthropic; no model was called; no revise was run, priced or prepared. **PR:** this change's own pull request, opened as a draft; it requires independent inspection before merge.

**Authorization:** the routing brief of 2026-10-16 for this change — Lane O: documentation, settled design, read-only GitHub, a branch and a draft pull request; no file outside `docs/**` and `README.md`. **Extended by the owner on 2026-10-16, after the session stopped on the `AGENTS.md` conflict:** "Authorized: edit AGENTS.md, narrowly, under rule (b)" — statements of fact only, every sentence the split makes false, CONTRIBUTING.md checked likewise, the full battery re-run on the final tree. **Extended again by the owner on 2026-10-16, after PR #130 failed independent inspection:** the four source comments that named `docs/ROADMAP.md` for records now in the ledger — `src/harness/agents/overlayContact.ts:61`, `src/harness/contentIntelligence.selftest.ts:6413` and `:6768`, `scripts/ci/payload-contract-mutation.mjs:4569` — repointed, comment text only (no code, test, assertion or mutation definition). Nothing here authorizes a merge, a deploy, a revise, or any Render, Google or Anthropic action.

**Why (rule (d)):** this file had grown to 8,032 lines and 1,382,585 bytes, about 1.15 MB of it completed history. The implementer and the independent inspector of PR #129 each reread it section by section, not as a whole, which [`AGENTS.md`](../AGENTS.md) rule (d) requires of every modified document; PR #129's record says so in its accepted limitations. `AGENTS.md` names the remedy: the completed-phase ledger, introduced once completed history impairs this file as an active planning document. It did: the cursor sat at line 89 behind a 20 KB record, and the next eligible work was spread across eight thousand lines.

**Evidence labels:** **REVIEWER-VERIFIED** — checked by the session recording this change, read-only, in GitHub through its API (PR #129, its merge commit, CI run 303 and its fifteen jobs, `deploy-production` run 95 and its two jobs, open PRs) and in the repository. **LOCAL** — run in this container. **UNCONFIRMED** — not established. Nothing here is OWNER-OBSERVED.

**Preflight (2026-10-16), all passed:** (1) `origin/main` is `2cd98e1…`, the merge of PR #129, with ordered parents `1f19e7b416b41a4e28278d0f9f382acaf13c119a` then `c920201cafb2058b97f7c4342a297e6e8bee3c92`; its tree `3e16ee1e…` equals `c920201`'s; (2) a clean tree on the designated branch; the sha256 of all 274 tracked files recorded by `git ls-files -z | xargs -0 sha256sum` (NUL-separated, so the brand-asset filenames with spaces pair correctly); (3) the only other open PR is #39 (draft, last updated 2026-08-27; `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `docs/ROADMAP.md`, `docs/STATUS.md`) — **it already conflicts** (its base is `a6a4316…`, and [AI handoff](AI_HANDOFF.md) records it as conflicting), and this change deepens that: its `docs/ROADMAP.md` hunk adds a PR #37 record next to the PR #36 record and edits the media-normalization section, both of which this change relocates to the ledger. Left alone.

**Delivered:**

1. **[`docs/COMPLETED_ROADMAP_PHASES.md`](COMPLETED_ROADMAP_PHASES.md), the completed-phase ledger.** 72 blocks of completed history, **1,146,132 bytes, relocated byte-for-byte** from this file at `2cd98e1`, in source order: 70 heading sections (every line from a heading to the line before the next heading) and two heading-less fragments of *Next steps* (source lines 93–120 and 137–150, the cursors superseded between 2026-10-10 and 2026-10-16). The groups: the records under *Merged repository change awaiting rollout* after S8.8 (S8.7 back to the CTO-attested approved-facts expansion, 43 blocks); *Completed / durable history* and the resolved media-normalization incident (7); the eight `MERGED` records from the legacy agent model migration to the critic on Claude Opus 5.5; PR #57, CC5 hardening (PR #63) and the M1 readiness package (PR #60) (3); M1→M2 interval monitoring (1); the Phase 0B prerequisite, 0B.1–0B.6 and the payload-contract reconciliation (8). **Proof:** each block's sha256 over its exact bytes, computed from `git show 2cd98e1:docs/ROADMAP.md` and from the ledger on disk, is identical for all 72 blocks; each block occurs in the ledger exactly once and in source order; the ledger's contents table carries each hash and source line range. **The only new text in the ledger** is its header (what it is, that it is historical, that nothing was altered, the source SHA, how to read relative references), the contents table, two group headings with one introductory paragraph under each, one italic separator line between the two fragments, and one italic closing line after block 72. *(Corrected after inspection: this list first omitted the two introductory paragraphs. The closing line was added after inspection: block 72's own last line is blank, so the ledger ended in a blank line, which `git diff --check` reports and CI run 304 failed on; deleting that line would have changed block 72's bytes, so a line was appended after it instead, and block 72 is unchanged.)*
2. **This file, now 1,472 lines and 0.27 MB on the final tree:** the state vocabulary, this record, the cursor and its live owner decisions, rules, status list and open items, the planned Studio work, the two most recent records (the S8.8 records change and S8.8 — both still carry the cursor or a live follow-up), a new section *Completed history — relocated to the completed-phase ledger*, the Phase 0D.1 cursor, the hardening order, the `maxIds` decision, the open evidence-pack item, the model-lineage note, the active M1→M2 product cursor and interval, the post-MVP backlog, the production-wiring design, Phase 0B, later work and the out-of-band tooling. **Each relocation point keeps a one-line italic pointer** to the ledger.
3. **Every inbound anchor repointed.** One link targeted a moved heading: this file's interval section (as first set) linked `#m1m2-interval-monitoring--daily-read-only-drift-check--merged`; it now links that anchor in the ledger. No link in any other file — `README.md` and `AGENTS.md` included — targeted a moved heading's anchor, and no moved block links to a heading that stays here. The 268 anchorless links to `ROADMAP.md` from other documents (STATUS 110, AI handoff 46, README 38, design 25, Testing 13, Operations 12, and others) still resolve to this file, which now points to the ledger; they are left as written (below). **Anchors checked against GitHub's heading slugs** (code spans kept verbatim, joining characters such as `→` and `—` dropped, duplicates suffixed): **on `2cd98e1`, 359 anchor links in every tracked Markdown file, 0 broken (the figure PR #129 recorded); on the final tree of this change, 452, 0 broken** — the same totals from a CommonMark parser (markdown-it, tables enabled) and from the repository link checker's own link pattern, with fenced code removed or not: **no anchor link sits inside fenced code at either commit**. *(Corrected after inspection: this record first gave 355 and 446, with "359 / 450 counting four inside fenced code blocks"; that explanation was false. 355 and 446 are reproduced exactly by a line-based fence detector that toggles on every line carrying an odd number of triple backticks: [Testing](TESTING.md) line 64 mentions a triple backtick inside inline code, and such a detector takes it for a fence opening and drops the four anchor links in that file's prose after it. The first count's code was not kept, so this is a reproduction of both figures, not a confirmation of what that code did.)* The rise of 93 is the ledger's contents table (72), the new pointers and the links the inspection corrections add; **no link was lost** — every distinct link target present at `2cd98e1` (1,948 links) is still present (2,102 links on the final tree), the one moved anchor at its new place. *(Corrected after inspection: this record first gave 1,924 and 2,067 links, figures that could not be reproduced; the two methods above agree on 1,948.)*
4. **PR #129 reconciled** (REVIEWER-VERIFIED): its record moved here from *Implemented repository change awaiting merge* to *Merged repository change awaiting rollout*, with a dated *State* paragraph and its follow-up discharged — `MERGED` at `2cd98e1…` (2026-10-16T18:14:44Z), `main` CI run 303 (`38945845270`) once, fifteen jobs, all `success` on attempt 1; `deploy-production` run 95 (`38947096421`): gate job `117128860716` refused at *Refuse while production automation is disabled*, release job `117128909750` skipped.
5. **PR #129's five note-only inspection items:** (i) `.node-version` reads `22`, not `22.23.3` — dated notes here and in [Status](STATUS.md) (two lines): Render resolved `22` to 22.23.3; CI's `setup-node` takes `"22"` from the workflow files; (ii) S8.8's moved heading's state word was **replaced** (`IMPLEMENTED` → "`MERGED`, `DEPLOYED` to the Studio; not `PRODUCTION-VALIDATED`"), not appended to — a dated note on PR #129's "Nothing in it was deleted" (checked against `1f19e7b`: every other change to that record was an addition); (iii) the three S8.8 notes in the [Content Studio design](CONTENT_STUDIO_DESIGN.md) (§5.5, §8.2, §8.4) were unlabelled, so by that file's fallback rule read as UNKNOWN / TO VERIFY — now labelled **VERIFIED** (from this repository's dated record), per the file's label table; the older unlabelled dated notes there are left as they are; (iv) PR #129's security sentence said "database ids … already in records" — no database id was added; the environment ids and instance suffixes it added were new to the repository and benign — a dated note; (v) [Operations](OPERATIONS.md) step 6's attorney-review line nested italics inside italics — the inner note is now bracketed.
6. **The cursor:** this change's merge; then, unchanged, **a revise of run `46f5bf15…`, priced first, from hook-story-script ($19.245), under the owner's own authorization** — the observation that would make S8.8 `PRODUCTION-VALIDATED`. **S8.8 stays `DEPLOYED`, not `PRODUCTION-VALIDATED`.** The previous cursor is kept as dated history.
7. **Four source comments repointed to the ledger — comment text only, owner-authorized on 2026-10-16** (above): `src/harness/agents/overlayContact.ts:61` (the closed call-to-action list), `src/harness/contentIntelligence.selftest.ts:6413` (run `2026-09-23T17-07-15-470Z`'s UTF-8 byte measurements) and `:6768` (PR #97's corrected record), and `scripts/ci/payload-contract-mutation.mjs:4569` (the same) now name `docs/COMPLETED_ROADMAP_PHASES.md`, where each record was found. Every line keeps its line number; no code, test, assertion or mutation definition changed. **Anchor coupling was checked first and none found:** the harness applies a mutation by replacing its `from` text, which must occur exactly once in its file, and no `from` text includes these lines (the twelve `OVERLAY_CONTACT_MODULE` mutations anchor on code lines only); neither the selftest nor the harness is itself a mutation target; the one check that reads `overlayContact.ts`, `AF5e`, strips comments before matching; nothing reads these files by line number. **`src/harness/agents/modelPolicy.ts:115` is not changed** — a blocking follow-up (below).

**The `AGENTS.md` edit — separately authorized by the owner on 2026-10-16, under rule (b); statements of fact only.** The split made one paragraph of `AGENTS.md` (*Completed-phase records*) false. The brief allowed only `docs/**` and `README.md` and named this case as a stop condition, so the session stopped and asked; the owner authorized, on 2026-10-16, a narrow edit under rule (b): every sentence of `AGENTS.md` the split makes factually false, statements of fact only, no rule, threshold, obligation, gate, state word or validation requirement changed, and the ledger provision's conditions for introduction left as written. **The whole of `AGENTS.md` was swept:** the continuous-documentation rule, the safety and source hierarchy, the roadmap-continuity rules, the phase-state vocabulary, the mutable-identifier exception and the required-validation list are untouched; *"A completed-phase record in `docs/ROADMAP.md` must preserve …"* is a rule and stays true (records are still written here first, and relocated ones are byte-identical); *"`docs/ROADMAP.md` is the canonical unfinished-work sequence and the current-phase cursor"* stays true. One paragraph changed — the first sentence restated as fact, and one sentence added recording that the condition is met; the provision's own two sentences are unchanged, byte for byte. **Before:**

> Completed-phase records currently live inside `docs/ROADMAP.md`. A separate completed-phase ledger (`docs/COMPLETED_ROADMAP_PHASES.md`) should be introduced only once completed history has grown enough to impair `docs/ROADMAP.md` as an active planning document — judged by whether a maintainer can still find the current cursor and the next eligible work quickly, not by a line count. Introducing it is a documentation change like any other and never deletes the history it relocates.

**After:**

> Completed-phase records are written in `docs/ROADMAP.md`; since 2026-10-16, completed history relocated from it lives in the completed-phase ledger, `docs/COMPLETED_ROADMAP_PHASES.md`. A separate completed-phase ledger (`docs/COMPLETED_ROADMAP_PHASES.md`) should be introduced only once completed history has grown enough to impair `docs/ROADMAP.md` as an active planning document — judged by whether a maintainer can still find the current cursor and the next eligible work quickly, not by a line count. Introducing it is a documentation change like any other and never deletes the history it relocates. That condition was met, and the ledger introduced, on 2026-10-16; the roadmap's record of that change gives the evidence.

**[`CONTRIBUTING.md`](../CONTRIBUTING.md) was checked and makes no claim about where completed records live** (its "`docs/ROADMAP.md` reflects its phase effect" stays true), so it is unchanged.

**Migrations / schema impact:** none.

**Material design decisions:**

- **Unit of relocation: a whole heading section, byte-for-byte**, so each block can be proved by one hash rather than by reading. Blocks keep their original heading levels; the ledger adds group headings only where a moved block would otherwise sit under a heading that stayed here.
- **Two heading-less fragments split from *Next steps*,** because that live section was mostly superseded cursors: the fragments are contiguous line ranges, each hashed, and the live parts between them (the owner decisions of 2026-10-12, the reviewer's Render documentation search, the post-merge verification rule) and after them (the status list, the open items) stay here unaltered. The cursor this change supersedes stays here as dated history; older ones moved.
- **What stayed, and why:** the S8.8 records change (PR #129) and S8.8 carry the cursor and S8.8's open validation; the Phase 0D.1 cursor and *Next hardening* are unfinished work; the `maxIds` decision is a standing rule; the evidence-pack item is open; the M1→M2 product cursor and interval section is live (bound `2026-10-22T18:52Z`) — its superseded interval records stay with it, because they explain the live bound and splitting them buys little; the production-wiring design is accepted and `UNIMPLEMENTED`; Phase 0B, later work and the tooling sections are planning.
- **Relative references are explained, not rewritten:** "above", "below", "at the top of this file" and "under *Merged repository change awaiting rollout*" inside moved blocks — and in dated text here — refer to this file as it was; the ledger's header, the pointers here and Status's introduction say so once. Rewriting them would alter the relocated bytes or rewrite dated history.

**Material rejected alternatives:** summarizing or pruning history (forbidden: rationale and evidence are only relocated); a per-phase file set (more links to break, no gain); moving S8.8's and PR #129's records now (both still carry live follow-ups); splitting the M1→M2 interval section (live, and its history explains the bound); rewriting the relative references inside moved blocks (alters their bytes); repointing the 268 anchorless `ROADMAP.md` links (most sit in dated notes, which would be rewritten; each still resolves, and this file points to the ledger); rewording any `AGENTS.md` rule, or restating the ledger's introduction condition (the owner's authorization covered statements of fact only); editing the comment at `src/harness/agents/modelPolicy.ts:115` in this change — the file is `modules[3]` of `scripts/ci/live-path-manifest.json`, so any byte change fails the live-path guard until the manifest is re-pinned, and the diff would then touch a live-service path, which the Studio release checklist refuses ([Operations](OPERATIONS.md#content-studio-release-checklist--owner-actions-each-separately-authorized) step 6; design §3.4). *(Corrected after inspection: this record first rejected editing all five comments as "outside the brief; comments only" and recorded them as non-blocking; four were then edited under the owner's authorization, above.)*

**Automated validation** *(LOCAL: this container, Node 22.22.0 — Render and CI resolve `.node-version`'s `22` to their own 22.x; no number below depends on the patch; **re-run in full after the inspection fixes, on the final tree**)* — in full in the PR: `npm ci`; the typecheck; the build; **`test:offline` 2,152, equal to the preflight baseline suite by suite** (twelve suites: posting 52, image 18, orchestrator 119, gate 56, api 51, render-identity 1, ownership 112, content intelligence 1,361, interval monitor 94, Studio database 23, Studio worker 73, Studio web 192); `test:m1-readiness`; the simulated dry run ("DRY RUN OK"); the deployment-controller fixtures (PASS); `check:mutation-shards` (15 injected faults refused); `check-yaml.rb`; `check-studio-blueprint.rb --base origin/main` (55 self-test checks); actionlint 1.7.12 (the pinned release, sha256-checked; clean); `npm audit --omit=dev` (0 vulnerabilities); **AgentShield 1.4.0, run pinned with `--path .`: B/86, 20 findings — 10 medium, 10 low, none critical or high; 19 files scanned** — unchanged; `check:markdown-links` (69 files: the ledger is the 69th); the anchor check above; `check:env-coverage` (45 variables); `scan:sensitive` (260 files) and a credential and PII search of the added lines with manual triage; **`git diff --check 2cd98e1` on the final tree: clean** *(corrected after inspection: this record first called it clean when it was not — it reported `docs/COMPLETED_ROADMAP_PHASES.md:6766: new blank line at EOF`, and CI run 304's *Repository whitespace* step failed on it; fixed by the closing line, item 1)*; **the 72 relocation hashes, identical, each block exactly once and in source order, 1,146,132 bytes**; the sha256 of the 246 files outside `docs/**`, `README.md`, `AGENTS.md` and the three source files carrying the four comments, `.DS_Store` among them, identical to preflight. **Because four source comments changed, the source-dependent suites were run too:** the PostgreSQL integration steps of CI on a disposable local PostgreSQL 16.15 (`test:postgres` 208, the HTTP suite 68, `test:m1-readiness-postgres` 60, `test:studio-postgres` 395, `test:studio-worker-postgres` 50, `test:studio-web-postgres` 43 — all pass) and the payload-contract mutation harness, all ten shards (`--shard k/10`, k = 0–9), in a separate worktree carrying the final source: **820 of 820 mutations, every shard ALL PASS**. **Not run locally:** PostgreSQL 18 (not installed here; CI runs it). **Every figure here is from the final tree.** **Reread whole (rule (d)), as the last step before the final push:** this file, top to bottom (1,472 lines); the ledger's header, contents table, group headings and closing line (its relocated blocks are proved by hash, not reread); [Status](STATUS.md), top to bottom (1,117 lines); [README](../README.md)'s changed passages in context; every other modified passage in context, with its surrounding section. *(Corrected after inspection: this record first said this file was reread at 1,464 lines — true of commit `46804f0`; the next commit added six lines after that reread, so the file at `634432b` was 1,470 lines and its last edit was not reread.)* Found while rereading and left as written, being pre-existing and outside this change: Status's *Repository state* says "see [Production state] above" of a section that is below it; the production-wiring section here still carries PR #56's "next cursor" paragraph, dated "as of this merge"; and Status (about 0.3 MB, mostly per-change history) is the next candidate for the same kind of split. **CI on the final head:** recorded in the PR (fifteen jobs).

**Production evidence:** none added; this change records CI and `deploy-production` evidence for PR #129 (REVIEWER-VERIFIED).

**Rollback / recovery:** revert the commit: the ledger's blocks return to their places, byte-for-byte, because they were never altered. No data, schema or external state to restore.

**Security and privacy implications:** no key, connection string, e-mail address, cookie, session id or customer data is added; the moved text was already in the repository. The new identifiers are GitHub run and job ids. The credential and PII scan covers the ledger.

**Accepted limitations:**

- **One source comment still names `docs/ROADMAP.md` for a record now in the ledger:** `src/harness/agents/modelPolicy.ts:115` (the critic's thinking decision); the ledger's header names it. A blocking follow-up (below). *(Until the inspection fixes this item named five comments; four were repointed, above.)*
- **Relative references in moved and dated text are explained, not rewritten** (above).
- **The ledger is not reread; it is verified by hash** — 72 of 72 blocks identical. Its header, contents table, group headings and closing line were reread.

**Unresolved follow-ups:**

- **This PR's merge SHA** (mutable-identifier exception), **its `main` CI run** (fifteen jobs, each `success` on attempt 1) and **the `deploy-production` run for its merge** (*Refuse while production automation is disabled*, release job skipped) — **a BLOCKING follow-up for the next records change**, verified by the reviewer after the merge.
- **The revise of run `46f5bf15…`, priced first, from hook-story-script ($19.245) — an owner action under the owner's own authorization**; its outcome is what would make S8.8 `PRODUCTION-VALIDATED`. Unchanged.
- **The owner question on "web first"** and the owner items, unchanged (the cursor below).
- **`src/harness/agents/modelPolicy.ts:115` — BLOCKING.** Its comment names `docs/ROADMAP.md` for the critic's thinking decision and its rejected alternatives, now in the ledger — an inline operational note that rule (b) reaches. It cannot be repointed here: the file is `modules[3]` of `scripts/ci/live-path-manifest.json` (sha256 `28e55f3b…`), so editing it requires re-pinning the manifest in the same change and makes that change a live-path change, which the Studio release checklist's "touches no live-service path" rule refuses ([Operations](OPERATIONS.md#content-studio-release-checklist--owner-actions-each-separately-authorized) step 6; design §3.4). It needs a change that is reviewed and declared as a live-path change. *(Corrected after inspection: first recorded, with the other four, as non-blocking and "outside the split's scope; comments only".)*
- **The roadmap's own relocation sentence — RESOLVED (2026-10-17, the final inspection fix).** As first written, the sentence in *Completed history — relocated to the completed-phase ledger* read "a later documentation change relocates it, byte-for-byte, once it no longer carries the cursor or a live follow-up" — a criterion that `AGENTS.md` does not state; and the [README](../README.md) pointer that had replaced the same sentence there said that when completed history may be relocated "is governed by `AGENTS.md`", which it is not: `AGENTS.md` (*Completed-phase records*) sets the condition for introducing the ledger and says nothing about relocating a record afterwards. Both were corrected in the same change: the roadmap sentence now describes the split's own choices and says it is not a standing rule; the README pointer now names only the condition `AGENTS.md` sets. No relocation criterion was added to any document; whether one should exist would be an `AGENTS.md` amendment for the owner, and this change proposes none. *(First recorded after inspection as: "states a criterion that `AGENTS.md` does not. The same sentence in README was replaced after inspection by a pointer to `AGENTS.md`; this one is outside the inspection's list and is left for the inspector to decide.")*

**Documents updated:** this file (this record; the cursor and its previous cursor kept; the status list; the open items — the split item, the `AGENTS.md` item, the source comments, the blocking merge-SHA item and the navigation note; PR #129's record moved, reconciled and given four dated notes; S8.8's record unchanged; the relocation pointers; the new *Completed history* section; the PR #36 pointer in *Next hardening*; the interval-monitoring link; "Last reviewed" and the introduction); **the new [completed-phase ledger](COMPLETED_ROADMAP_PHASES.md)**; [`AGENTS.md`](../AGENTS.md) (one paragraph, *Completed-phase records* — statements of fact only, owner-authorized, quoted above); [Status](STATUS.md) (this change's entry; the S8.8 records change's entry and phase row reconciled; this change's phase row; the lease/reaper row's pointer and the two pointers in *Closed production incident* and *Not implemented*; the Content Studio cursor paragraph, the previous kept; the introduction's navigation note; the two `.node-version` lines); [README](../README.md) (the documents table — the roadmap's row and the ledger's new row; the roadmap-continuity paragraph; the Studio bullet's dated note); [AI handoff](AI_HANDOFF.md) (§5's pointer to the completed records; item 4's dated note); [Start here](START_HERE.md) (step 4); [Content Studio design](CONTENT_STUDIO_DESIGN.md) (the three S8.8 notes labelled); [Operations](OPERATIONS.md) (step 6's nested italics). **Amended after inspection (2026-10-16):** the ledger (the closing line after block 72; the header's list of added text and its source-comment note); this record (each correction is marked in place); the cursor, the status list and the source-comments open item; [Status](STATUS.md) (this change's entry and phase row); [README](../README.md) (the relocation criterion replaced by a pointer to `AGENTS.md`; the Studio bullet's dated note); `src/harness/agents/overlayContact.ts`, `src/harness/contentIntelligence.selftest.ts` and `scripts/ci/payload-contract-mutation.mjs` (comment text only). **Amended after the final inspection (2026-10-17):** this record's open item on the relocation sentence (recorded as resolved, its first wording kept); the sentence in *Completed history* (made descriptive); "Last reviewed"; README (the roadmap-continuity paragraph's pointer narrowed to the condition `AGENTS.md` sets).

**Checked and deliberately left unchanged:** every file outside `docs/**`, `README.md`, `AGENTS.md` and the three source files carrying the four comments (246 files byte-identical, `src/harness/agents/modelPolicy.ts` and `scripts/ci/live-path-manifest.json` among them) and, in `AGENTS.md`, every rule and every paragraph but one (above); [`CONTRIBUTING.md`](../CONTRIBUTING.md) (its "`docs/ROADMAP.md` reflects its phase effect" stays true: records are still written there first); [Testing](TESTING.md), [Security and continuity](SECURITY_AND_CONTINUITY.md), [Architecture](ARCHITECTURE.md), [Deployment control](DEPLOYMENT.md), [Data model](DATA_MODEL.md), [Environment](ENVIRONMENT.md) and the other runbooks — nothing they describe changed, and their anchorless "[Roadmap]" pointers still resolve; [Known issues and hardening](KNOWN_ISSUES_AND_HARDENING.md) (its backlog is unchanged and it does not link to the roadmap); the M1→M2 interval section and every moved block (byte-identical by construction).

## Next steps — the roadmap split `IMPLEMENTED`: its merge; then a revise of run `46f5bf15…`, priced first, from hook-story-script, under the owner's own authorization (S8.8 `DEPLOYED`, not yet `PRODUCTION-VALIDATED`); then the owner chooses between S9 (`DEFERRED`) and the rest of the post-MVP list; S8b `PLANNED`, `BLOCKED`, post-MVP

**Posting cadence (2026-10-13):** an `IMPLEMENTED` branch, outside the Studio sequence, awaits the owner's decision on its push. Its order against that sequence *(2026-10-21: rebased onto `282fe54…`; the Studio redeploy it once waited for has happened)*: the Studio release checklist refuses a deploy whose diff changes `scripts/ci/live-path-manifest.json`, which this change does, so merge it knowing the next Studio deploy needs the owner's decision on that rule; the release is then part of the M2 bundle (owner decision of 2026-10-14), not a separate scheduler-only release. The cursor below is unchanged by it.

**The cursor (2026-10-16, recorded by the roadmap split):** **The S8.8 records change is `MERGED`** through PR #129 at `2cd98e1…` (2026-10-16T18:14:44Z; `main` CI run 303, fifteen jobs, all `success` on attempt 1; `deploy-production` run 95 refused at the disabled gate, release job skipped — REVIEWER-VERIFIED); documentation only; its record is under *Merged repository change awaiting rollout* below and its follow-ups are DISCHARGED. **The roadmap split is `IMPLEMENTED`, not merged** (the record at the top of this file): documentation, plus four source comments — completed history relocated, byte-for-byte, to the [completed-phase ledger](COMPLETED_ROADMAP_PHASES.md), `AGENTS.md`'s *Completed-phase records* paragraph brought up to date (facts only, owner-authorized), and four source comments repointed to the ledger (comment text only, owner-authorized); `src/harness/agents/modelPolicy.ts:115`'s comment is a blocking follow-up. **Content Studio S8.8 is unchanged: `MERGED` and `DEPLOYED` to both Studio services at `1f19e7b`, not `PRODUCTION-VALIDATED`.** **The next steps, in order:** (1) **the roadmap split's merge**, after independent inspection (the split also updates one [`AGENTS.md`](../AGENTS.md) paragraph's statements of fact, separately authorized by the owner on 2026-10-16 — the record at the top of this file); then its merge SHA, `main` CI and `deploy-production` refusal, verified by the reviewer; it deploys nothing, so (2) does not wait on it; (2) **a revise of run `46f5bf15…`, priced first, from hook-story-script ($19.245), under the owner's own authorization** — unchanged from the cursor below: its price page should list, under "From the source run's legal review", L2 and L3 (`manufacturer_quotation`, hook-story-script, sent) and L1 (`copyright_reproduction`), L4 and L5 (production-direction, sent) before the owner confirms; 8 requests; **its outcome, recorded by the next records change, is what would make S8.8 `PRODUCTION-VALIDATED`** ([Operations](OPERATIONS.md#content-studio-release-checklist--owner-actions-each-separately-authorized) step 6). Production is unchanged: both Studio services at `1f19e7b` with Studio migration 0005, the live runner `ENABLED`; the live system unchanged ([Status](STATUS.md#content-studio-on-render--the-s88-deploy-2026-10-16)). **The posting gate is a standing per-run rule** (unchanged). **After the revise the next repository change is again the owner's choice** between **S9** (`DEFERRED`; its re-entry condition met; not started) and **the rest of the post-MVP list** (*Planned — Content Studio* below). **The owner question on "web first"** (below) is still open. **Owner items, unchanged in substance:** two-step verification on the owner's Google account by **2026-10-20**; the decision at the interval bound **`2026-10-22T18:52Z`** and the full read-only verification pass owed before it; **the restore drill and adding staff** (eligible, each under the owner's own authorization); **S8b `PLANNED` and `BLOCKED`**, post-MVP. Each owner action is separately authorized; nothing here grants any. **The roadmap split's merge SHA, its `main` CI and its `deploy-production` refusal are the blocking follow-up.**

*(Until 2026-10-16, the roadmap split, this section was headed "Next steps — the S8.8 records change `IMPLEMENTED`: its merge; then a revise of run `46f5bf15…`, priced first, from hook-story-script, under the owner's own authorization (S8.8 `DEPLOYED`, not yet `PRODUCTION-VALIDATED`); then the owner chooses between S9 (`DEFERRED`) and the rest of the post-MVP list; S8b `PLANNED`, `BLOCKED`, post-MVP", and its cursor read:)*

**The cursor (2026-10-16, recorded by the S8.8 records change):** **Content Studio S8.8 — legal findings into revisions; the disclaimer reworded — is `MERGED`** through PR #128 at `1f19e7b…` (2026-10-14; `main` CI runs 300 and 301, fifteen jobs each, all `success` on attempt 1 — CI ran twice, why is UNCONFIRMED; `deploy-production` runs 93 and 94, each refused at the disabled gate, release jobs skipped — REVIEWER-VERIFIED) and **`DEPLOYED`** to both Studio services at `1f19e7b` on 2026-10-16 — web first, **no migration**, the worker ready from `ownership.held` at 17:07:42Z (REVIEWER-VERIFIED through Render's API; the authorization line UNCONFIRMED) — **and not `PRODUCTION-VALIDATED`**; its record is under *Merged repository change awaiting rollout* below and its follow-ups are DISCHARGED. **The S8.8 records change is `IMPLEMENTED`, not merged** (the record at the top of this file): documentation only. **The next steps, in order:** (1) **this records change's merge** (its merge SHA, `main` CI and `deploy-production` refusal then verified by the reviewer); it deploys nothing, so (2) does not wait on it; (2) **a revise of run `46f5bf15…`, priced first, from hook-story-script ($19.245), under the owner's own authorization** — its price page should list, under "From the source run's legal review", L2 and L3 (`manufacturer_quotation`, hook-story-script, sent) and L1 (`copyright_reproduction`), L4 and L5 (production-direction, sent) before the owner confirms; 8 requests; **its outcome, recorded by the next records change, is what would make S8.8 `PRODUCTION-VALIDATED`** — the price page's legal list, the start at hook-story-script, which of L1–L5 were sent and to which stage, `revision-meta.json`'s `legalFindingsSent` / `legalFindingsDropped`, the reworded disclaimer on the revised run's report, and the actual cost against the $19.245 ceiling ([Operations](OPERATIONS.md#content-studio-release-checklist--owner-actions-each-separately-authorized) step 6). Production: both Studio services at `1f19e7b` with Studio migration 0005, the live runner `ENABLED`; the live system unchanged ([Status](STATUS.md#content-studio-on-render--the-s88-deploy-2026-10-16)). **The posting gate is a standing per-run rule** (unchanged): before posting anything from any Studio run — a revised one included — the owner reads that run's own Legal review and resolves its blocking findings; there is no attorney step. **After the revise the next repository change is again the owner's choice** between **S9** (`DEFERRED`; its re-entry condition met; not started) and **the rest of the post-MVP list** (*Planned — Content Studio* below). **An owner question:** whether "web first" in step 6 means the worker deploys only after the web is live (at the S8.8 deploy the two overlapped — harmless without a migration). **Owner items, unchanged in substance:** two-step verification on the owner's Google account by **2026-10-20**; the decision at the interval bound **`2026-10-22T18:52Z`** and the full read-only verification pass owed before it; **the restore drill and adding staff** (eligible, each under the owner's own authorization); **S8b `PLANNED` and `BLOCKED`**, post-MVP. Each owner action is separately authorized; nothing here grants any. **This records change's merge SHA, its `main` CI and its `deploy-production` refusal are the blocking follow-up.**

*(The earlier cursors of this section — those recorded by Content Studio S8.8 (2026-10-14), S8.7, the O6 records change, S8.6, S8.5, S8.4 and the shared-sign-in-limits record (2026-10-12), each with its italic lead-in — are relocated, unaltered, to the [completed-phase ledger](COMPLETED_ROADMAP_PHASES.md#earlier-cursors-of-next-steps--relocated-fragments), fragment 1. The owner decisions, the reviewer's search and the rule that follow were recorded with the shared-sign-in-limits cursor and the CI parallel-mutation change; they are live and stay here.)*

**Owner decision of 2026-10-12 — shared sign-in limits accepted for the MVP; S8b after launch.** Recorded verbatim by the shared-sign-in-limits record from the owner's routing of that day: **"accept shared sign-in limits for MVP; S8b post-MVP"**.

- **The client-address gate before O5 is CLOSED, by acceptance, as an accepted MVP limitation — not fixed.** No code changes. The accepted behaviour, with the limit values copied from source:
  - the sign-in limits key on the **direct peer**, so behind Render they are **shared by all visitors**;
  - `/auth/login` allows **20 a minute**, `/auth/callback` **20 a minute**, and failed sign-ins **10 per 15 minutes** (`LOGIN_LIMIT`, `CALLBACK_LIMIT` and `FAILED_SIGN_IN_LIMIT` in `src/studio/web/rateLimit.ts`; the key is `req.socket.remoteAddress` in `src/studio/web/app.ts`);
  - **the failure mode is a sign-in lockout of up to 15 minutes, repeatable by anyone who knows the URL. It is never a bypass:** no forwarding header is read, and sign-in is Google Internal (`germancardepot.com`) only;
  - **a team member who fails sign-in 10 times also pauses sign-in for everyone.**
- **S8b stays `PLANNED` and `BLOCKED`** on a written statement from a **human** Render engineer (naming the client-address header and whether `X-Forwarded-For` is appended or replaced), **but it is now a post-MVP item, no longer required before O5.** Its own PR and authorization, as before. **Its design fallback is unchanged:** if Render will not commit to a header, key the limits off the client address entirely (a design change), rather than trust an undocumented header.
- **O5 is therefore blocked by no repository change; it still needs the owner's own authorization.** Nothing here authorizes O5.

**The reviewer's search of Render's documentation, 2026-10-12 — REVIEWER-VERIFIED** (the reviewer's own reading; the session recording it contacted no Render system). Source: `render.com/docs/llms-full.txt` ("Generated on: 2026-10-10") plus the per-page `.md` files. **Not found anywhere:** `X-Forwarded-For`, `CF-Connecting-IP`, `True-Client-IP`. **Leads, none of them an answer:** (a) on Pro workspaces and higher, HTTP request logs record a `clientIP` field for each public request ([logging#http-request-logs](https://render.com/docs/logging#http-request-logs)) — this workspace is Hobby; (b) Render sets `FORWARDED_ALLOW_IPS=*` by default for Python services ([environment-variables](https://render.com/docs/environment-variables)) — that implies forwarding headers but says nothing about spoofing, appending or replacing; (c) Render adds the `Rndr-Id` header and passes `CF-Ray` on requests ([logging](https://render.com/docs/logging), [uptime-best-practices](https://render.com/docs/uptime-best-practices)). **Inbound IP rules** (Scale or Enterprise) act on the client address before a request reaches the service ([inbound-ip-rules](https://render.com/docs/inbound-ip-rules)). **Render's community forum has moved to `render.discourse.group`, which the reviewer's container could not reach; searching it is an owner action.** The table is in [Deployment control](DEPLOYMENT.md#content-studio-deployment-authority).

**Owner decision of 2026-10-12 — the Studio's database-connection encryption (the TLS decision): option A for the MVP.** Recorded by the CI parallel-mutation change from the owner's routing of that day. It answers the OPEN, BLOCKING-before-O5 decision the O3/O1/O4 record opened (the Studio's connections are not TLS-encrypted; the worker's connection is logged without "SSL enabled", OWNER-OBSERVED). **Option B — encrypting the Studio's database connections without certificate verification — is `PLANNED` as a post-MVP item** (in *Planned — Content Studio* below). ~~**TO CONFIRM:**~~ **Confirmed 2026-10-12 — REVIEWER-VERIFIED against the reviewer's routing of that day** (the shared-sign-in-limits record): option A means **the Studio's internal database connections stay unencrypted for the MVP**; the TO CONFIRM is cleared. *As recorded until then:* the options' full text is not in the repository; the reviewer reads option A, beside option B as the post-MVP step, as *the MVP proceeds with the Studio's internal connections as they are (unencrypted, on Render's private network) and no code change*, and records that reading for the owner to confirm before O5. No code, `render.studio.yaml` or Render setting changed.

**Rule (owner direction, 2026-10-12) — post-merge verification does not hold the next session.** After a merge, **the next implementer session may start immediately**; it does not wait for that merge's `main` CI or its `deploy-production` run. **The reviewer verifies, after the merge, that merge's `main` CI run** (every job `success` on attempt 1) **and its `deploy-production` run** (*Refuse while production automation is disabled*, release job skipped). **Any failure there is recorded, as soon as it is seen, as a BLOCKING follow-up in this file — and must be resolved before the next merge.** This governs ordering only; it removes no check, and the deploy refusal is still verified for every merge.

*(The cursors before that — recorded by the CI parallel-mutation change, the O3/O1/O4 record, S8.3 (the owner decision of 2026-10-10), S8.2, and the paragraph S8.2 replaced — are relocated, unaltered, to the [ledger](COMPLETED_ROADMAP_PHASES.md#earlier-cursors-of-next-steps--relocated-fragments), fragment 2. In the status list that follows, a record said to be "under *Merged repository change awaiting rollout* below" or "at the top of this file" is in the ledger, unless it is the roadmap split, the S8.8 records change or S8.8.)*

- **The roadmap split is `IMPLEMENTED`**, not merged (the record at the top of this file): documentation, plus four source comments — completed history relocated byte-for-byte to the [completed-phase ledger](COMPLETED_ROADMAP_PHASES.md); PR #129 reconciled; one `AGENTS.md` paragraph's statements of fact updated, owner-authorized (its record); four source comments repointed to the ledger, comment text only, owner-authorized; `modelPolicy.ts:115`'s comment a blocking follow-up.
- **The S8.8 records change is `MERGED`** through PR #129 at `2cd98e1…` (2026-10-16T18:14:44Z); its record is under *Merged repository change awaiting rollout* below; **its follow-ups are DISCHARGED** (REVIEWER-VERIFIED): `main` CI run 303 (`38945845270`), fifteen jobs, all `success` on attempt 1; `deploy-production` run 95 (`38947096421`) — gate job `117128860716` refused at *Refuse while production automation is disabled*, release job `117128909750` skipped. *(Until 2026-10-16, the roadmap split: "`IMPLEMENTED`, not merged … PR #128 reconciled; the S8.8 deploy of 2026-10-16 recorded; S8.8 `DEPLOYED`, not `PRODUCTION-VALIDATED`".)*
- **Content Studio S8.8 — legal findings into revisions; the disclaimer reworded — is `MERGED`** through PR #128 at `1f19e7b…` (2026-10-14) and **`DEPLOYED`** to both Studio services at `1f19e7b` (2026-10-16; no migration), **not `PRODUCTION-VALIDATED`**; its record is under *Merged repository change awaiting rollout* below; **its follow-ups are DISCHARGED** (REVIEWER-VERIFIED): `main` CI runs 300 (`38622691978`) and 301 (`38622717205`), fifteen jobs each, all `success` on attempt 1; `deploy-production` runs 93 (`38624051908`) — gate job `116058586609` refused at *Refuse while production automation is disabled*, release job `116058638442` skipped — and 94 (`38624389244`) — gate job `116059720486` refused there, release job `116059761219` skipped. *(Until 2026-10-16 this item read: **Content Studio S8.8 — legal findings into revisions; the disclaimer reworded — is `IMPLEMENTED`**, not merged (the record at the top of this file): no migration; after its merge the owner redeploys both Studio services at its merge commit, web first, then revises run `46f5bf15…`, priced first.)*
- **Content Studio S8.7 — "Edit these choices" — is `MERGED`** through PR #127 at `36d2996…` (2026-10-14), **`DEPLOYED`** to both Studio services at `36d2996` and **`PRODUCTION-VALIDATED`** (OWNER-OBSERVED); its record is under *Merged repository change awaiting rollout* below; **its follow-ups are DISCHARGED** (REVIEWER-VERIFIED): `main` CI run 297 (`38598228908`), fifteen jobs, all `success` on attempt 1; `deploy-production` run 92 (`38599528731`) — gate job `115974856383` refused at *Refuse while production automation is disabled*, release job `115974913179` skipped. *(Until 2026-10-14 this item read: **Content Studio S8.7 — "Edit these choices" — is `IMPLEMENTED`**, not merged: Studio web only, no migration; after its merge the owner redeploys both Studio services at its merge commit, web first.)*
- **The O6 records change is `MERGED`** through PR #126 at `50b27a1…` (2026-10-14T13:09:24Z); its record is under *Merged repository change awaiting rollout* below; **its follow-ups are DISCHARGED** (REVIEWER-VERIFIED): `main` CI run 295 (`38569461901`), fifteen jobs, all `success` on attempt 1; `deploy-production` run 91 (`38570993288`) — gate job `115875819403` refused at *Refuse while production automation is disabled*, release job `115875857989` skipped. *(Until 2026-10-14 this item read: **The O6 records change is `IMPLEMENTED`**, not merged (the record at the top of this file): documentation only — PR #125 reconciled; the redeploy at `89e798a` and the S8.6 deploy with migration 0005 recorded; runs `8549e829…` and `46f5bf15…`; O6 COMPLETE; the posting gate confirmed and met; the attorney review `DEFERRED`; the disclaimer discrepancy; two post-MVP items.)*
- **Content Studio S8.6 — the legal-risk review and Studio migration 0005 — is `MERGED`** through PR #125 at `dcc7b91…` (2026-10-13T17:17:52Z), **`DEPLOYED`** to both Studio services with 0005 and **`PRODUCTION-VALIDATED`**; its record is under *Merged repository change awaiting rollout* below; **its follow-ups are DISCHARGED** (REVIEWER-VERIFIED): `main` CI run 293 (`38437515231`), fifteen jobs, all `success` on attempt 1; `deploy-production` run 90 (`38438726399`) — gate job `115439421566` refused at *Refuse while production automation is disabled*, release job `115439480017` skipped.
- **Content Studio S8.5 — stage 5's caption target — is `MERGED`** through PR #124 at `89e798a…` (2026-10-13T14:01:47Z), **`DEPLOYED`** (at `89e798a`, then `dcc7b91`) and **`PRODUCTION-VALIDATED`** (stage 5 passed on runs `8549e829…` and `46f5bf15…`); its record is under *Merged repository change awaiting rollout* below; **its follow-ups are DISCHARGED** (REVIEWER-VERIFIED): `main` CI run 289 (`38409877313`); `deploy-production` run 89 (`38411055713`) — gate job `115343172505` on runner `1000001805` refused, release job `115343224739` skipped. *(Until 2026-10-13 this item read: **Content Studio S8.5 — stage 5's caption target — is `IMPLEMENTED`**, not merged (the record at the top of this file): the target is the budget less the measured hashtag text, over 1.4 — Instagram 1,409 (234 words), Facebook 1,400 (233), Google Business Profile 1,071 (178) — with the word count first and "condense, don't restate" in the prompt; the enforced budget, the reserve and "exactly once" unchanged; `payloadContract.ts` byte-identical.)*
- **Content Studio S8.4 — the browser form-POST fix — is `MERGED`** through PR #123 at `fbf3fcc…` (2026-10-12T19:51:33Z), **`DEPLOYED`** to both Studio services at `fbf3fcc` and **`PRODUCTION-VALIDATED`**; its record is under *Merged repository change awaiting rollout* below; **its follow-ups are DISCHARGED** (REVIEWER-VERIFIED): `main` CI run 286 (`38300421547`), fifteen jobs, all `success` on attempt 1; `deploy-production` run 88 (`38301323117`) — gate job `114984688968` on runner `1000001758` refused at *Refuse while production automation is disabled*, release job `114984719014` skipped. *(Until 2026-10-12 this item read: S8.4 `IMPLEMENTED`, not merged: the pages' `Referrer-Policy` is `same-origin`; the Origin and CSRF checks unchanged; `SA154`; the local Chromium check. Not deployed: on `d545e14`, live, every browser form POST is refused.)*
- **The shared-sign-in-limits record is `MERGED`** through PR #122 at `ec8ec99…` (2026-10-12T18:48:31Z); its record is under *Merged repository change awaiting rollout* below; **its follow-ups are DISCHARGED** (REVIEWER-VERIFIED): final-head PR CI run 282 (`38292481371`) and `main` CI run 283 (`38293408123`), fifteen jobs each, all `success` on attempt 1; `deploy-production` run 87 (`38294310638`) — gate job `114961605305` on runner `1000001712` failed at *Refuse while production automation is disabled*, release job `114961636831` skipped. *(Until 2026-10-12 this item read: the shared-sign-in-limits record `IMPLEMENTED`, not merged (the record at the top of this file): documentation only — the owner's decision of 2026-10-12 above, option A's reading verified, the reviewer's Render documentation search, and PR #121's reconciliation.)*
- **The CI parallel-mutation change is `MERGED`** through PR #121 at `d545e14…` (2026-10-12T17:29:42Z); its record is under *Merged repository change awaiting rollout* below; **its follow-ups are DISCHARGED** (REVIEWER-VERIFIED): final-head PR CI run 280 (`38283367053`) and `main` CI run 281 (`38284577238`), fifteen jobs each, all `success` on attempt 1; `deploy-production` run 86 (`38285501573`) — gate job `114932766876` on runner `1000001681` failed at *Refuse while production automation is disabled*, release job `114932810844` skipped. *(Until 2026-10-12 this item read: the CI parallel-mutation change `IMPLEMENTED`, not merged, the record at the top of this file: the mutation harness as ten parallel shard jobs (fifteen CI jobs), the M1 readiness runner accepting exactly one of two job sets, and the records above.)*
- **The O3/O1/O4 record — the owner actions of 2026-10-12 — is `MERGED`** through PR #120 at `88b097e…` (2026-10-12); its record is under *Merged repository change awaiting rollout* below; **its follow-ups are DISCHARGED**: `main` CI run 278 (`38274922690`) green on attempt 1, and `deploy-production` run 85 (`38277539006`) — gate job `114906576028` on runner `1000001635` reached *Refuse while production automation is disabled*, release job `114906608942` skipped. *(Until 2026-10-12 this item read: the O3/O1/O4 record `IMPLEMENTED`, not merged, documentation only, the record at the top of this file.)*
- **S8.3 — the owner's decision narrowing the release freeze, and the live-services check of 2026-10-10 — is `MERGED`** through PR #119 at `68ba72c…` (2026-10-12); its record is under *Merged repository change awaiting rollout* below; its `deploy-production` follow-up is DISCHARGED by run 84 (`38255288950`), which reached *Refuse while production automation is disabled* with its release job skipped. *(Until 2026-10-12 this item read: S8.3 `IMPLEMENTED`, not merged, documentation only, the record at the top of this file.)*
- **S8.2 — pre-launch hardening — is `MERGED`** through PR #118 at `ffe413e…` (2026-10-10); its record is under *Merged repository change awaiting rollout* below; its `deploy-production` follow-up is DISCHARGED by run 83 (`38081159302`), which reached *Refuse while production automation is disabled* with its release job skipped. Not deployed, configured or enabled. *(Until 2026-10-10 this item read: S8.2 `IMPLEMENTED`, not merged, the record at the top of this file: a whitespace-padded `ANTHROPIC_API_KEY` is classed `anthropic_key_padded` and leaves the live runner disabled; `M713`; O4 reads the class from the start-up line; S9 deferred.)*
- **S9 — the cron, built disabled — is `DEFERRED` until after O6** *(2026-10-13, the O6 records change: O6 is COMPLETE, so the re-entry condition is met; S9 stays `DEFERRED` and **not started** until the owner chooses it over the post-MVP list; the design decision and migration below are still needed)* (owner decision of 2026-10-10): not required for the first live run, with scheduled runs off at launch (owner decision 4); the only path that would spend without a person confirming each run, so designed with O6's real cost data; and a schema gap verified from source — no pre-authorization table exists, and a live run requires a user-bound, expiring, single-use quote — so it needs a design decision on how a scheduled run is priced and reserved, and a new migration. *(Until 2026-10-10: the next repository change, pending S8.1's merge.)*
- **S8.1 — pre-O3 readiness — is `MERGED`** through PR #117 at `b7ff939…` (2026-10-10); its record is under *Merged repository change awaiting rollout* below; its `deploy-production` follow-up is DISCHARGED by run 82 (`38057304652`), which reached *Refuse while production automation is disabled* with its release job skipped. Not deployed, configured or enabled. *(Until 2026-10-10 this item read: S8.1 `IMPLEMENTED`, not merged, the record at the top of this file.)*
- **S6b — the live-runner enablement — is `MERGED`** through PR #116 at `bab4f7d…` (2026-10-09); its record is under *Merged repository change awaiting rollout* below; its `deploy-production` follow-up is DISCHARGED by run 81 (`37990630722`), which reached *Refuse while production automation is disabled* with its release job skipped. Not deployed, configured or enabled. *(Until 2026-10-09 this item read: S6b `IMPLEMENTED`, not merged, the record at the top of this file.)* **After S6b, a paid call is possible only on a worker holding `ANTHROPIC_API_KEY`, which no environment has until O4 (after the freeze, separately authorized).** A worker without the key — absent, empty or whitespace only, and since S8.2 a padded key — still refuses every confirmed live run as `live_runs_not_enabled`, its reservation released, with zero runner calls; the web refuses the key in every phase. *(Until 2026-10-09 this item read: until S6b, no Studio code path can spend money — the worker entry point constructed no paid runner and refused `ANTHROPIC_API_KEY`.)*
- **S8 (reduced) is `MERGED`** through PR #115 at `4738532…` (2026-10-09); its record is under *Merged repository change awaiting rollout* below. **Its BLOCKING merge gate is CLOSED AFTER MERGE:** S8 merged at 15:44Z while the gate was open; the owner's dated read-only Blueprint check followed the same day and the reviewer cleared it (the facts are in S8's reconciled record); the check is repeated before O3. **Its `deploy-production` follow-up is DISCHARGED** by run 80 (`37958625111`), attempt 1, which reached *Refuse while production automation is disabled* with its release job skipped. *(Until 2026-10-09 this item read: S8 `IMPLEMENTED`, not merged, its gate OPEN.)*
- **S8b — the O5 client-address fix — is `PLANNED` and `BLOCKED`** (owner decision of 2026-10-08, splitting S8's scope D). **Blocked on:** a written statement from Render support naming the header that carries the client's address and whether `X-Forwarded-For` is appended to or replaced at Render's edge. Render's public documentation names none (searched 2026-10-08). *(2026-10-09, S8.1: **Render support answered through an AI agent, not a human engineer.** It cited documentation naming `cf-connecting-ip` and `True-Client-Ip`, and said the documentation does not state whether `X-Forwarded-For` is appended or replaced, whether a client can set either header, or the request-body limit. **That reply is not the written statement S8b requires; the owner has asked for a human engineer.** S8.1's case-insensitive search of `llms-full.txt` and 116 documentation pages found **none** of `cf-connecting-ip`, `true-client-ip` or `x-forwarded-for`; the documentation says every inbound request to a web service passes Cloudflare and that Render forwards `CF-Ray`, and it documents one route that does not pass Cloudflare — the workspace's private network (port 10000 reaches the web's HTTP server), which a Hobby workspace cannot close per environment. Quotes and URLs in [Deployment control](DEPLOYMENT.md#content-studio-deployment-authority). S8b is not decided.)* **S8b is required before O5**, its own PR and its own authorization: it keys S4's sign-in rate limits on that documented address. **Accepted interim behaviour:** until then the web keys the limits on the direct peer; behind Render's load balancer that is Render's address, so **the limits act as near-global — the failure mode is a sign-in lockout, never a bypass** (no forwarding header is read, so none can be forged to evade them). **Fallback, an owner decision:** if Render support will not commit to a header, key the limits off the client address entirely (a design change) rather than trust an undocumented header. *(2026-10-12, owner decision "accept shared sign-in limits for MVP; S8b post-MVP": **S8b stays `PLANNED` and `BLOCKED` on a human Render engineer's written statement, but is now post-MVP — no longer required before O5**; the interim behaviour above is the accepted MVP behaviour; the fallback is unchanged; the reviewer's documentation search that day found no client-address header — the cursor section above.)*
- ~~**The O5 client-address gate stays BLOCKING and OPEN** until S8b merges.~~ **CLOSED 2026-10-12 by acceptance** (the owner's decision above) — an accepted MVP limitation, not fixed.
- **New, an owner decision after the freeze, separately authorized:** the `gcd-agents` Blueprint has **Auto Sync = Yes**, so a `render.yaml` change merged to `main` would sync the live services outside the controlled deploy path; S8's byte rule is the guard meanwhile. **UNKNOWN:** `render.yaml` changed on `main` on 2026-08-24 (PR #33, PR #34) with no corresponding entry in the Blueprint's sync list. Both are in S8's reconciled record.
- **S7.3 is `MERGED`** through PR #114 at `0f4dda0…`, **S7.2** through PR #113 at `8e9a73d…`, **S7.1** through PR #112 at `1e36054…`, **S6.2** through PR #111 at `4eca3b3…`, **S6.1** through PR #110 at `a22ffd9…`, **S5** through PR #109 at `e9d06a7…` and **S4** through PR #108 at `a80913d…`; their records are under *Merged repository change awaiting rollout* below.
- *(2026-10-12, answered at O3, OWNER-OBSERVED: the creation form offers no Auto Sync switch and no project picker; creation deploys at once; the web's origin is `https://gcd-studio-web.onrender.com`; the database moved by "Move existing services"; the database's plan read $6/month. Still open below: the request-body limit, the client-address header, PITR validation, browser file selection.)* **TO VERIFY for O3 and O5** (pending Render support or observation at O3): Render's request-body limit for an import of up to about **30 MiB** on the wire; the client-address header (S8b); whether the Blueprint creation form offers Auto Sync; whether creation deploys at once; the web's assigned origin; plan prices (*OWNER-OBSERVED 2026-10-09 in the dashboard: web $7, worker $25, database $6 a month plus storage at $0.30 per GB-month — about $40 a month with 5 GB*); *(S8.1)* whether *New > Blueprint* places root-level resources in a project, and whether a database moves between projects by *Move*; how a point-in-time recovery instance is validated without external access; and real browser file and folder selection on the upload and import pages at the first owner use (S7.2).
- **Owner action O2 is OWNER-REPORTED, not reviewer-verified (2026-10-06):** the Anthropic workspace GCD-Content-Studio (`wrkspc_012NWi9g7CY13EuaGT4z1Kcz`, US region) exists with a $300 monthly spend limit (resetting on the 1st, UTC) and an email alert at $150; **no API key exists yet**. The key is created and entered at **O4**, after S6b merges and after the freeze, separately authorized: from that workspace only, in Render on `gcd-studio-worker` only, never on the web, with the caps set first. (S7.2's record has the workspace detail; [Operations](OPERATIONS.md#content-studio-release-checklist--owner-actions-each-separately-authorized) has O4.)
- **O3, O1 and O4 (without the key) were PERFORMED by the owner on 2026-10-12** (the O3/O1/O4 record); **O5 and O6 are not done**; entering the Anthropic key is not done. *(Until 2026-10-12 this item read as follows.)* **The owner actions O1, O3, O4 and O5 are not done**, each separately authorized, in the order of the Studio release checklist in [Operations](OPERATIONS.md#content-studio-release-checklist--owner-actions-each-separately-authorized); O3 waits on the freeze gate and the repeated Blueprint check. *(2026-10-10, S8.3: the freeze gate, as narrowed by the owner that day, no longer holds O3 back; O3 waits only on the owner's own authorization and on the Blueprint check repeated immediately before it; O4 is done without the Anthropic key; O5 waits for S8b.)* *(2026-10-09, S8.1: O3 creates the resources in a **new** Render project, "GCD Content Studio", never in GCD Social or its Production environment, with the database at 5 GB; O1 uses a **new** Google Cloud project under the `germancardepot.com` organization, never the existing GCD-Agents project's consent screen or clients; **O1's prerequisite — two-step verification on the owner's Google account — is due before 2026-10-20**, ahead of the freeze bound, or Google Cloud console access stops (owner-reported); O4's key is pasted without padding.)* *(2026-10-10, S8.2: O4's start-up line now shows a padded key as `anthropic_key_padded`; re-enter it.)*
- Nothing here authorizes enabling any stage, creating any Render service, database, project or OAuth client, creating or entering any API key, applying or syncing any Blueprint, changing Auto Sync, contacting Render support, any Google Cloud action, any release, or any change to the Phase-A approval gate.

**Owner decision of 2026-10-02 — Render native auto-deploy.** Native auto-deploy is always off on the three live services; per-merge re-verification is no longer requested. This is owner attestation, not reviewer-observed evidence. Last observed by screenshot on 2026-10-01. The deploy-production refusal is still verified from GitHub on every merge *(2026-10-05: for S6.1's merge it could not be, because no hosted runner ran the gate; the BLOCKING follow-up above carries it to S6.2's merge)* *(2026-10-06: verified for S6.2's merge — run 76 reached the refusal with its release job skipped; the follow-up is discharged)* *(2026-10-06: verified for S7.1's merge — run 77 reached the refusal with its release job skipped)* *(2026-10-07: verified for S7.2's merge — run 78 reached the refusal with its release job skipped)* *(2026-10-08: verified for S7.3's merge — run 79 reached the refusal with its release job skipped)* *(2026-10-09: verified for S8's merge — run 80 reached the refusal with its release job skipped)* *(2026-10-09: verified for S6b's merge — run 81 reached the refusal with its release job skipped)*. S8's Blueprint auto-sync check is unaffected *(2026-10-09: that check found the live `gcd-agents` Blueprint's **Auto Sync on** — a different path from native auto-deploy; see S8's reconciled record)*. *(Recorded in [Status](STATUS.md) and as a dated note at the design's §10 freeze-gate bullet. It changes how the freeze gate's second condition is evidenced for S4 and later Studio merges, not the condition itself.)*

This section was headed *Next repository change — not chosen*, then *… Content Studio PR 1 (library extraction), pending the owner's approval of the design*, *… Content Studio S1 (library extraction)*, *… Content Studio S2 (Studio schema and migrations), pending S1's merge*, *… Content Studio S2 (Studio schema and migrations), pending the mutation-harness speed-up's merge*, *… Content Studio S3 (worker and queue), pending S2's merge*, *… Content Studio S3 (worker and queue), pending the mutation-harness shards change's merge*, *… Content Studio S4 (authentication), pending S3's merge*, *… Content Studio S5 (read-only screens), pending S4's merge*, *… Content Studio S6 (run and revise actions with caps), pending S5's merge*, *… Content Studio S6.2 (run and revise actions with caps, fake runners only), pending S6.1's merge*, *… Content Studio S7 (fact upload and legacy import), pending S6.2's merge*, *… Content Studio S7.2 (fact upload and versions, legacy import, the whole-run download), pending S7.1's merge*, *… Content Studio S7.3 (the users-and-caps screens), pending S7.2's merge*, *… Content Studio S8 (`render.studio.yaml`, its static check, the release checklist and the O5 client-address fix), pending S7.3's merge*, *… Content Studio S6b (the live-runner enablement), pending S8's merge*, *… Content Studio S9 (the cron, built disabled), pending S6b's merge*, and *… Content Studio S9 (the cron, built disabled), pending S8.1's merge — or S8b, if a human Render engineer's written statement arrives first*. Earlier records refer to it by those names.

Open items, carried unchanged except where S8.2 and S8.3 (now under *Merged repository change awaiting rollout*) and the O3/O1/O4 record, at the top of this file, say otherwise *(2026-10-16, the roadmap split: those three records, and every other record an item below points to as "under *Merged repository change awaiting rollout*" or "at the top of this file" — except the S8.8 records change and S8.8 itself — are now in the [completed-phase ledger](COMPLETED_ROADMAP_PHASES.md#contents))*:

- **`reasoning-standard` output headroom:** 126,000 of the model's 128,000 output tokens since PR #95; recovering it by narrowing the `claimUse[].summary` allowance is open.
- **`brand-compliance-critic` is still on `claude-sonnet-4-6`** (`agents/brand-compliance-critic.md`) — Lane S work; routing it, and the two `sdk.ts` fallbacks with it, is open (see the legacy model migration record).
- **The M1→M2 interval ends `2026-10-22T18:52Z`**; the expiry is a decision point for the owner (see [Status](STATUS.md)). *(2026-10-12: still owed before it — the full read-only verification pass, including the worker's and scheduler's exact deploy commits; the Blueprint gate's screenshot that day showed `gcd-social-api` at `d501523` with Auto-Deploy Off, OWNER-OBSERVED.)* *(2026-10-10, S8.3: unchanged by the owner's narrowing of the freeze; the full read-only verification pass with Render and PostgreSQL access is owed before it — the one scheduled for about 2026-10-08 is not recorded as performed.)*
- **AgentShield grade B/87** (9 medium oversized-agent, 9 low unspecified-model findings; no critical or high). *(2026-10-16, the S8.8 records change: stale — AgentShield 1.4.0 on `1f19e7b` and on this change reports **B/86, 20 findings, 10 medium and 10 low, none critical or high** (LOCAL), as the S8.x records since S8.6 already recorded; the line above is kept as written.)*
- ~~**Splitting completed phases out of this file** into `docs/COMPLETED_ROADMAP_PHASES.md`, a separate documentation change.~~ **`IMPLEMENTED` 2026-10-16 by the roadmap split** (the record at the top of this file), not merged.
- ~~**`AGENTS.md` still says "Completed-phase records currently live inside `docs/ROADMAP.md`"** — false once the roadmap split merges.~~ **Updated in the roadmap split itself** — statements of fact only, separately authorized by the owner on 2026-10-16 under rule (b); before and after quoted in the split's record.
- **Source comments that name `docs/ROADMAP.md` for a record now in the ledger:** four — `src/harness/agents/overlayContact.ts:61`, `src/harness/contentIntelligence.selftest.ts:6413` and `:6768`, `scripts/ci/payload-contract-mutation.mjs:4569` — **repointed in the roadmap split**, comment text only, owner-authorized on 2026-10-16. **One open and BLOCKING:** `src/harness/agents/modelPolicy.ts:115`, a module of `scripts/ci/live-path-manifest.json`, which cannot be edited without a declared live-path change (the split's record gives the reason). *(Until the split's inspection fixes this item read: "Source comments that name `docs/ROADMAP.md` for a record now in the ledger (`src/harness/agents/modelPolicy.ts:115`, `src/harness/agents/overlayContact.ts:61`, `src/harness/contentIntelligence.selftest.ts:6413` and `:6768`, `scripts/ci/payload-contract-mutation.mjs:4569`) — not changed (outside the split's scope; comments only, they change no behaviour); the ledger's header names them. To be repointed by the next change that touches those files, not on their own.")*
- **Stage 2's restrictions can misdescribe the evidence** — a follow-up candidate recorded by the PR #99 record (*Documentation reconciliation — PR #98 recorded as merged, the revision pass's two owner-run rounds, and a corrected "critic gap"*, under *Merged repository change awaiting rollout* below); no fix is chosen.
- **`--resume-from production-direction`** — a follow-up candidate recorded by the contact-in-overlay change (PR #101, under *Merged repository change awaiting rollout* below): a live run refused at stage 4 cannot be resumed there today, so stages 1–3 are paid again; not built.
- Carried from the revision-pass record: describing the identity records in `SCRIPT_CLAIMS` and `PLATFORM_CLAIMS` in the critic prompts; tuning `POLICY_EFFORT.critic` and `THINKING_RESERVE_TOKENS` per lens.
- **`DEFERRED`, as the owner listed them on 2026-09-28** (not previously recorded in this repository; recorded here so they are not lost): Mercedes 223.2 and the round-2 fluids; the DPF/GPF bulk-oil question; the Spanish version.
- ~~**The owner's post-merge fake-runner check of S1** on the real facts file and one real run folder (fake runner only, no cost; the commands are in S1's PR).~~ **Done 2026-09-30** (operator-local; recorded in S1's record below).
- ~~**The mutation step's growth.**~~ **Discharged 2026-10-01 by S3** (its record, now under *Merged repository change awaiting rollout*)**:** PR #106 merged the shards, and every shard's CI step took under 12 minutes on its PR (11m18s, 11m36s, 11m08s; run 36900834356) and under 10 minutes on `main` (9m51s, 6m20s, 8m35s; run 36902831610), comfortably under the owner's 30-minute bar. *As carried until then:* After the speed-up (PR #104, now under *Merged repository change awaiting rollout*) the suite is about 95% of the harness's time and every mutation still runs it whole, so the step still grows with each mutation. The levers left are the owner's: a larger (paid) CI runner with `MAX_WORKERS` raised, a higher `timeout-minutes`, or restructuring the gate. The owner's merge bar for the speed-up is **30 minutes** for the CI mutation step (2026-09-30). *(2026-09-30: the speed-up merged through PR #104 with a CI mutation step of 26m59s on the PR and 26m34s on `main`. S2's first head, adding 11 mutations and 31 sampled clean builds, took 32m15s, over the bar; S2 now samples four per run (2026-10-01), and its revised CI figure is in PR #105. Still open.)* *(2026-10-01: S2 merged through PR #105. Its CI mutation step took **18m09s** on the PR and **30m13s** on `main`, for the same code: runner variance of more than ten minutes, and 13 seconds over the bar on `main`. **The mutation-harness shards change at the top of this file** (`IMPLEMENTED`, not merged) splits the harness into three shards, one in each of the three existing Node and PostgreSQL jobs, with no new job, paid runner or gate change; its local figures are in its record. This item stays open until all three shards have a CI figure from that change's PR, and is discharged only if each is comfortably under 30 minutes. *(PR #106's first run measured shard 0 at 11m19s and shard 2 at 10m35s; shard 1 did not run, because the Studio suite's race failed its job first.)* Those figures are recorded in its PR and reconciled with its merge SHA. Still open until then.)*
- **An independent review of the Content Studio design** before later Studio PRs, carried from the design record.
- **Watch item (2026-10-01): the PostgreSQL jobs' `timeout-minutes: 30` now binds first.** *(2026-10-02, S3's figures: *PostgreSQL 16 integration* 11m31s and *PostgreSQL 18 integration* 14m55s on PR #107's final run, 15m00s and 15m48s on `main`, with shards at 13m23s and 14m10s there; S4's are in its record and PR. Still under the owner's 20-minute stop limit; not a defect today.)* Each PostgreSQL job carries a mutation shard since PR #106, so its 30-minute limit, not the quality job's 60, is the nearest. Totals: *PostgreSQL 16 integration* 13m02s and *PostgreSQL 18 integration* 12m40s on PR #106's final run, 7m41s and 10m11s on `main`; S3's own figures are in its record. The owner's stop limit for this work is 20 minutes for a PostgreSQL job. Levers when it nears: raise `n` (more than one shard step in a job is already allowed by the guard), or the owner's runner and timeout choices. Not a defect today. *(Content Studio S5, Part 1 (2026-10-02): **`n` raised from 3 to 4** — shards 0/4 and 3/4 as two steps of *Node 22 offline quality gates* (60-minute limit), shards 1/4 and 2/4 in the PostgreSQL 16 and 18 jobs; no job, name, timeout or runner changed; `check-mutation-shards.rb` now refuses twelve faults, one more for a dropped shard 3/4. Each PostgreSQL job now carries a quarter of the mutations instead of a third. The PR's CI figures are in S5's record and its PR. The item stays open as a watch item: each new mutation group still grows every shard.)* *(2026-10-05, S5's merged figures: *PostgreSQL 16 integration* 9m42s and *PostgreSQL 18 integration* 10m31s on PR #109's final run, 9m31s and 13m46s on `main`, with shards 8m05s / 8m51s and 7m55s / 12m03s; the quality job 26m28s and 27m50s of 60. Under the owner's 20-minute stop limit. S6.1 adds four mutations. Still a watch item.)* *(2026-10-05, S6.1's merged figures: *PostgreSQL 16 integration* 15m21s and *PostgreSQL 18 integration* 14m16s on PR #110's final run (shards 13m37s and 12m33s), 8m52s and 9m02s on `main` (shards 7m21s and 7m32s); the quality job 22m02s and 24m26s of 60. Under the owner's 20-minute stop limit, though the PR's PostgreSQL 16 job came within five minutes of it. S6.2 adds 24 mutations and ten checks to each PostgreSQL job's Content Studio step. Still a watch item.)* *(2026-10-06, S6.2's merged figures: *PostgreSQL 16 integration* 15m04s and *PostgreSQL 18 integration* 15m06s on PR #111's final run (shards 13m18s and 13m21s), 15m40s and 15m14s on `main` (shards 13m39s and 13m23s); the quality job 28m25s and 20m26s of 60. Under the owner's 20-minute stop limit; the PostgreSQL jobs are now about five minutes from it on every run. S7.1 adds four mutations and about 94 database checks (a few seconds). Still a watch item.)* *(2026-10-06, S7.1's merged figures: *PostgreSQL 16 integration* 16m23s and *PostgreSQL 18 integration* 15m27s on PR #112's run (shards 14m30s and 13m32s), 15m26s and 13m54s on `main` (shards 13m37s and 12m01s); the quality job 27m41s and 27m35s of 60. Under the owner's 20-minute stop limit. S7.2 adds 19 mutations (680 in all), about fifteen PostgreSQL checks and the fact and import groups (about ten seconds more per PostgreSQL job, locally). Still a watch item.)* *(2026-10-07, S7.2's merged figures: *PostgreSQL 16 integration* 16m56s and *PostgreSQL 18 integration* 15m11s on `main` push run 37649627182 (shards 1/4 14m53s and 2/4 13m20s), the quality job 22m17s of 60 (shards 0/4 10m33s and 3/4 10m06s); PR run 37630369368's figures are in S7.2's reconciled record. The PostgreSQL 16 job was three minutes from the owner's 20-minute stop limit.)* *(Content Studio S7.3, Part 1 (2026-10-07): **`n` raised from 4 to 5** — shards 0/5, 3/5 and 4/5 as three steps of *Node 22 offline quality gates* (60-minute limit), shards 1/5 and 2/5 in the PostgreSQL 16 and 18 jobs; no job, name, timeout or runner changed; `check-mutation-shards.rb` re-anchors its faults to `/5` and refuses thirteen, one more for a dropped shard 4/5. Each PostgreSQL job now carries a fifth of the mutations instead of a quarter; the target is each PostgreSQL job well under 20 minutes and the quality job under 45 on PR CI. The PR's CI figures are in S7.3's record and its PR. Still a watch item: each new mutation group grows every shard, and the quality job now runs three.)* *(2026-10-08, S7.3's merged figures: *PostgreSQL 16 integration* 13m53s and *PostgreSQL 18 integration* 10m49s on PR run 37662433060 (shards 1/5 12m00s and 2/5 8m53s), 14m05s and 13m22s on `main` push run 37778096952 (shards 12m13s and 11m18s); the quality job 38m48s and 34m20s of 60 (shards 0/5, 3/5 and 4/5: 12m20s, 12m20s, 12m24s on the PR; 10m54s, 10m46s, 11m01s on `main`). Every PostgreSQL job about six minutes or more under the owner's 20-minute stop limit, and the quality job under 45. S8 adds no mutation and no TypeScript, only a static step of seconds in the validation job. Still a watch item.)* *(2026-10-09, S8's merged figures: *PostgreSQL 16 integration* 14m28s and *PostgreSQL 18 integration* 14m08s on PR run 37941433125 (shards 1/5 12m29s and 2/5 12m10s), 14m27s and 13m03s on `main` push run 37953927623 (shards 12m27s and 11m07s); the quality job 38m17s and 38m06s of 60 (shards 0/5, 3/5 and 4/5: 12m20s, 12m01s, 12m10s on the PR; 12m09s, 12m01s, 12m14s on `main`). S6b adds fourteen mutations (712 in all, about three per shard) and five checks to each PostgreSQL job's Content Studio step (a few seconds). Still a watch item.)* *(2026-10-09, S6b's merged figures: *PostgreSQL 16 integration* 9m01s and *PostgreSQL 18 integration* 9m41s on PR run 37973971631 (shards 1/5 7m02s and 2/5 7m42s), 13m29s and 13m10s on `main` push run 37986661260 (shards 11m26s and 11m12s); the quality job 39m19s and 35m56s of 60 (shards 0/5, 3/5 and 4/5: 12m33s, 12m31s, 12m49s on the PR; 11m26s, 11m22s, 11m29s on `main`). S8.1 adds no mutation and no TypeScript, only two self-test faults to a static step of about a second. Still a watch item.)* *(2026-10-10, S8.1's merged figures: *PostgreSQL 16 integration* 14m57s and *PostgreSQL 18 integration* 14m40s on PR run 37993243692's attempt 2 (shards 1/5 12m56s and 2/5 12m37s; attempt 1 failed both at *Initialize containers*, Docker Hub's pull rate limit), 13m51s and 11m58s on `main` push run 38054799054 (shards 11m52s and 10m02s); the quality job 39m28s and 38m54s of 60 (shards 0/5, 3/5 and 4/5: 12m28s, 12m27s, 12m46s on the PR; 12m20s, 12m20s, 12m29s on `main`). S8.2 adds one mutation (`M713`, shard 2/5) and no PostgreSQL check. Still a watch item.)* *(2026-10-10, S8.2's merged figures: *PostgreSQL 16 integration* 14m45s and *PostgreSQL 18 integration* 14m23s on PR run 38067785156 (shards 1/5 12m47s and 2/5 12m21s), 12m44s and 14m32s on `main` push run 38079019496 (shards 10m45s and 12m33s); the quality job 29m15s and 32m08s of 60 (shards 0/5, 3/5 and 4/5: 9m15s, 9m07s, 9m20s on the PR; 10m02s, 10m05s, 10m24s on `main`). S8.3 is documentation only. Still a watch item.)* *(2026-10-12, S8.3's merged figures: *PostgreSQL 16 integration* 9m53s and *PostgreSQL 18 integration* 15m09s on PR run 38083155773 (shards 1/5 7m57s and 2/5 13m06s), 14m26s and 14m51s on `main` push run 38252338460 (shards 12m18s and 12m48s); the quality job 38m21s and 25m26s of 60 (shards 0/5, 3/5 and 4/5: 12m25s, 12m27s, 12m11s on the PR; 7m46s, 8m24s, 8m07s on `main`). The O3/O1/O4 record is documentation only. Still a watch item.)* *(2026-10-12, the CI parallel-mutation change: **the PostgreSQL jobs no longer run a shard**; the harness runs as ten parallel jobs, *Payload-contract mutations 0/10* … *9/10*, each `timeout-minutes: 30`, so each PostgreSQL job is back to its suites alone (about two minutes on run 278) and each shard job carries a tenth of the mutations. The O3/O1/O4 record's `main` figures (run 278): *PostgreSQL 16 integration* 15m15s and *PostgreSQL 18 integration* 14m37s (shards 13m14s and 12m33s); the quality job 22m18s of 60 (shards 7m06s, 7m06s, 6m59s). The watch item now covers the shard jobs: each new mutation group grows every shard by about a tenth of its size.)*
- **The merge SHA of the roadmap split at the top of this file, its `main` CI run, and the `deploy-production` run for that merge** (which must reach *Refuse while production automation is disabled* with its release job skipped) (mutable-identifier exception) — **blocking**; verified by the reviewer after the merge (the process rule above) and reconciled into that record by the next records change; a failure is a BLOCKING follow-up before the next merge. *(2026-10-16, the roadmap split: until then this item named "the S8.8 records change at the top of this file"; the S8.8 records change's merge-SHA, `main`-CI and `deploy-production` follow-ups are discharged by the roadmap split: `2cd98e1…`, `main` CI run 303 and `deploy-production` run 95.)* *(2026-10-16, the S8.8 records change: until then this item named "Content Studio S8.7 at the top of this file" — S8.8 discharged S8.7's follow-ups but did not rename it. Content Studio S8.8's merge-SHA, `main`-CI and `deploy-production` follow-ups are discharged by the S8.8 records change: `1f19e7b…`, `main` CI runs 300 and 301 (CI ran twice) and `deploy-production` runs 93 and 94; Content Studio S8.7's by S8.8: `36d2996…`, `main` CI run 297 and `deploy-production` run 92.)* *(The O6 records change's merge-SHA, `main`-CI and `deploy-production` follow-ups are discharged by Content Studio S8.7: `50b27a1…`, `main` CI run 295 and `deploy-production` run 91; Content Studio S8.6's merge-SHA, `main`-CI and `deploy-production` follow-ups are discharged by the O6 records change: `dcc7b91…`, `main` CI run 293 and `deploy-production` run 90; Content Studio S8.5's by S8.6: `89e798a…`, `main` CI run 289 and `deploy-production` run 89; Content Studio S8.4's merge-SHA, `main`-CI and `deploy-production` follow-ups are discharged by S8.5: `fbf3fcc…`, `main` CI run 286 and `deploy-production` run 88; the shared-sign-in-limits record's by S8.4: `ec8ec99…`, `main` CI run 283 and `deploy-production` run 87 (re-verified by S8.5); The CI parallel-mutation change's merge-SHA, `main`-CI and `deploy-production` follow-ups are discharged by the shared-sign-in-limits record: `d545e14…`, `main` CI run 281 and `deploy-production` run 86; the Content Studio O3/O1/O4 record's merge-SHA follow-up is discharged by the CI parallel-mutation change: `88b097e…`, and its `deploy-production` follow-up by run 85; Content Studio S8.3's merge-SHA follow-up is discharged by the O3/O1/O4 record: `68ba72c…`, and its `deploy-production` follow-up by run 84; Content Studio S8.2's merge-SHA follow-up is discharged by S8.3: `ffe413e…`, and its `deploy-production` follow-up by run 83; Content Studio S8.1's merge-SHA follow-up is discharged by S8.2: `b7ff939…`, and its `deploy-production` follow-up by run 82; Content Studio S6b's merge-SHA follow-up is discharged by S8.1: `bab4f7d…`, and its `deploy-production` follow-up by run 81; Content Studio S8's merge-SHA follow-up is discharged by S6b: `4738532…`, and its `deploy-production` follow-up by run 80; Content Studio S7.3's merge-SHA follow-up is discharged by S8: `0f4dda0…`; S7.2's by S7.3: `8e9a73d…`; Content Studio S7.1's merge-SHA follow-up, formerly here, is discharged by S7.2: `1e36054…`; Content Studio S6.2's by S7.1: `4eca3b3…`; Content Studio S6.1's by S6.2: `a22ffd9…`; Content Studio S5's by S6.1: `e9d06a7…`; Content Studio S4's by S5: `a80913d…`; Content Studio S3's by S4: `0aae05b…`; the mutation-harness shards change's by S3: `bec4a41…`; Content Studio S2's by the shards change: `fd88a2c…`; the mutation-harness speed-up's by S2: `0bb3f0b…`; S1's by the speed-up: `c1c19f4…`; PR #102's by S1: `4664515…`; PR #101's by PR #102: `f111012…`.)*
- **Watch item (2026-10-10): Docker Hub's pull rate limit on the PostgreSQL service images.** S8.1's PR run 37993243692 lost both PostgreSQL jobs at *Initialize containers*, before checkout: `docker pull postgres:16` / `postgres:18` hit `toomanyrequests: You have reached your unauthenticated pull rate limit`; one owner re-run passed. If it recurs, a registry mirror or an authenticated pull is a CI-only change (`.github/workflows/ci.yml`'s `services.postgres.image`), its own PR and authorization; no test logic changes. A job that fails at container initialization is reported with its step and message, not re-run by an agent.
- **Watch item (2026-10-10): `ubuntu-latest` moves to Ubuntu 26 from 2026-10-19** (GitHub's notice, as relayed by the owner; not found in the job logs read for S8.2, whose runners report Ubuntu 24.04.5, image `ubuntu-24.04`). Every CI and deploy job runs on `ubuntu-latest`; the first run on the new image is checked for PostgreSQL service, Node 22 and Ruby differences. No change made.
- **Watch item (2026-10-10): Node 20 actions forced to Node 24.** Run 37993243692's annotation: "Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4" (the AgentShield job's also names `actions/upload-artifact@v4`). The jobs pass as forced; moving to action versions that target Node 24 is a workflow change, its own PR. No change made.
- ~~**From the shards change's validation:** the race in S2's disposable-PostgreSQL suite (an unhandled pool `'error'` when a test database is dropped while a pooled client is still closing; 4 of 14 local runs under load) — a separate fix; see that record's follow-ups.~~ **Fixed in the shards change itself** (owner decision of 2026-10-01; item 8 of its record).
- **From S2:** the least-privilege database role for the Studio web (design §9.1; S8, once Render's plan is known — *2026-10-08: S8 records the finding, not built: a `CREATE USER` role, the web's `STUDIO_DATABASE_URL` then `sync: false`; a follow-up with its own authorization, see S8's record*), ~~the login-attempt and session purges (S4)~~ *(built by S4, now under *Merged repository change awaiting rollout*: §4.7's retention, by `DELETE`)*, and the audit-log and ledger two-year purge (a future reviewed migration).
- ~~**From S5:** the whole-run JSON bundle download (design §8.2 item 8, in §8.6's import format), deferred to S7, which fixes that format — **assigned to S7.2** (owner decision of 2026-10-06).~~ **Built by S7.2** (`IMPLEMENTED`, at the top of this file).
- ~~**From S7.1, for S7.2:** the fake-source rule's refusal by name, before a quote.~~ **Built by S7.2.**
- ~~**BLOCKING (S7.1): the `deploy-production` run for S7.1's merge must reach *Refuse while production automation is disabled* with its release job skipped.**~~ **DISCHARGED 2026-10-06** by run 77 (`37523842670`), attempt 1: gate job `112475710196` on runner `1000001530` reached the refusal; release job `112475768600` skipped (S7.1's reconciliation below).
- ~~**From S6.1, for S6.2:** the canonical-form `params_sha256` computed identically by the web and the worker; the 30-day purge of preflight requests; the new-run screen's upper bound of in-scope records (tags overlap; the preflight enforces the cap exactly); S3's "until S6" wording restated as S6b.~~ **Built by S6.2** (`IMPLEMENTED`, at the top of this file).
- ~~**BLOCKING (owner, 2026-10-05): the `deploy-production` run for S6.2's merge must reach *Refuse while production automation is disabled* with its release job skipped**~~ **DISCHARGED 2026-10-06** by run 76 (`37486785375`), attempt 1: gate job `112348760063` on runner `1000001488` reached the refusal; release job `112348812149` skipped (S6.2's reconciliation below).
- **From S6.2:** design §8.7's users and caps settings screens — **assigned to S7.3** (owner decision of 2026-10-06).

## Planned — pre-review humanize loop: Pangram detection and Undetectable humanization (owner request of 2026-10-14; recorded 2026-10-19) — `PLANNED`

**State:** `PLANNED`, post-MVP. This is one of the post-MVP items the owner chooses among after the revise of run `46f5bf15…`, and it moves no cursor (*Next steps* above). Nothing is designed in detail, built, configured or enabled:

- no Pangram or Undetectable account, key, secret, environment variable, dependency, provider client or fake exists in this repository;
- **no request has been made to either provider**.

Nothing here authorizes any of the following; each needs its own explicit authorization:

- a provider call, a key or a Render change;
- any change to the posting gate, the legal review, the critic panel or the Phase-A approval gate;
- the start of any H-step.

**Owner request (2026-10-14), recorded in substance:** humanize generated content *before* the human-review phase. Check each draft for AI content with **Pangram**. If it does not read as human, rewrite it with **Undetectable** (Humanization API v2). Check again with Pangram, and repeat until the Pangram reading is 100% human. *(First drafted on 2026-10-14 against `e9d06a7`, before S6–S8.8; rewritten on 2026-10-19 against the current pipeline before it was committed.)*

**Where it sits.** It sits on the six-stage path in `src/harness/contentRun/**`, which the Content Studio worker and the local CLI share, directly after stage 5 and before the deterministic contact line:

```
… → 05 packaging-adaptation → [humanize loop] → 05b contact lines → 06 final-critic → 07 legal review → the owner's posting gate
```

**Why there.** Everything after the loop then judges the exact text that would be posted:

- the critic's four lenses and the legal review (S8.6);
- the owner's per-run posting gate, where the owner reads that run's legal review before posting anything.

That is the invariant in [`skills/platform-specs`](../skills/platform-specs/SKILL.md): *"All provider-visible formatting is finalized before critique and approval."* Placing the loop before `attachContactLines` keeps the contact line out of the humanizer's input by construction. As today, stage 5's saved file stays exactly what stage 5 returned; the loop's result is its own artifact (name TO DECIDE in H0).

**Rejected placements:**

- **After the critic or the legal review.** That would post text neither reviewed.
- **After approval.** That would break the approval subject's SHA-256 binding.

**Out of scope:** the live `runBrief` path in the `gcd-social-*` services, which would be a production-wiring question (P1–P8, *Production-wiring design* below). It is `DEFERRED` until the owner decides it separately.

**The loop, as requested (H0 fixes the details):**

1. **What is sent.** Only each platform's model-authored `caption` prose. Nothing else is sent, and nothing else is changed by the humanizer:
   - hashtags;
   - the contact line;
   - CTA, URLs, phone and address;
   - alt text and the Instagram `is_ai_generated` image disclosure (the honesty guardrail in [`skills/posting-workflow`](../skills/posting-workflow/SKILL.md));
   - overlays, `claimUse`, the evidence pack, the uploaded facts file and the identity records.
2. **Detect.** Pangram: `POST /task` at `https://text.external-api.pangram.com`, header `x-api-key`. Then poll `GET /task/{task_id}` until `STAGE_SUCCESS` or `STAGE_FAILED`. The model selector comes from `GET /models` at run time and is recorded; it is never hard-coded, which is Pangram's instruction.
3. **Target.** "100% human" means `fraction_human` = 1.0 (so `fraction_ai` = `fraction_ai_assisted` = 0), with no window flagged `is_humanized`. That is the owner's default; whether it becomes a threshold is decision H-D4.
4. **Humanize.** Undetectable: `POST https://humanize.undetectable.ai/submit`, header `apikey`. Then poll `POST /document` every 5–10 s (the vendor's guidance), with a timeout.
   - **Proposed parameters:** `readability` "Marketing", `purpose` "Marketing Material", `model` "v11" (English), `strength` "Balanced" on round 1.
   - **Later rounds:** round 2 is `/rehumanize`, which the vendor allows once per document. Round 3, if allowed, resubmits with `strength` "More Human".
   - **REST polling only:** the WebSocket stream and browser token exchange are not used, so the key stays on the worker.
5. **Revalidate every candidate before it can win.** The candidate is put back into stage 5's output, and `revalidatePackagingAdaptationOutput` runs again: budgets net of the contact reserve, claim bindings, forbidden claims and the contact-in-text rules. A candidate that fails is discarded.
6. **Bounded.** A round cap (proposed 3) and a per-run vendor-credit cap stop the loop. If the target is not met within the cap, the loop stops there. The best valid candidate and the original go forward, flagged *"did not reach the Pangram target"*; what happens next is decision H-D3.
7. **Downstream unchanged.** The critic, the legal review, the revision pass and the posting gate run exactly as today on the chosen text. A critic FAIL routes through the existing revision pass and its caps, and the loop adds no revision cycles of its own.
8. **Recorded.** Per platform and round, the run records:
   - the Pangram selector and its three fractions;
   - the Undetectable document id, model and strength;
   - the revalidation result and the credits used.

   The run report shows the original and humanized captions side by side.

**Why H0 (a design) comes first:**

- **Quotes and ceilings.** A Studio live run needs a user-bound, expiring, single-use quote, and the run is held to its printed ceiling. A loop of 1 to N rounds against two vendors that bill in their own units changes those contracts, as the caption-repair item in *Planned — Content Studio* does.
- **Questions H0 must answer:**
  - how the quote prices the round cap at its worst case;
  - how vendor credits join the spend ledger and caps;
  - how a critic replay reuses the recorded result without calling either vendor, and how a revise re-runs the loop on the new stage 5 (`verify.ts`'s reused-file list);
  - whether the key-presence rule that gates the Anthropic runner (S6b) is mirrored for each vendor key.

**Known risks, recorded so they are not discovered live:**

- **Convergence is not assured.** Pangram markets humanizer detection: its windows carry `is_humanized` and `humanizer_score`, and Pangram reports detecting most Undetectable output. Independent studies conflict. "100% human" may be unreachable for many captions, which is why the cap and H-D3 exist. The rate on our own captions is TO VERIFY, offline first and then in H4.
- **Accuracy and voice drift.** The vendor's own documented example changes meaning and adds punctuation errors. That is why step 5 revalidates every candidate and the critic and legal review run after the loop. The extra failure rate is measured in H4.
- **Short captions.** Undetectable needs at least 50 characters. Pangram's reliability on short Google Business Profile or Facebook text is TO VERIFY. Below either minimum, the loop is skipped and the caption is labelled.
- **Language.** `v11` is English-best. The Spanish version stays `DEFERRED` (owner, 2026-09-28).
- **Vendor data.** Undetectable's `/list` returns past documents with their input and output, so captions persist in that account. Pangram keeps bulk results 48 hours; its single-task retention is TO VERIFY. Both vendors' terms and retention are TO VERIFY before O-H1 and O-H2.
- **Vendor-doc inconsistencies (TO VERIFY).**
  - Undetectable documents "insufficient credits" as status 400 in one place and 402 in its error table.
  - Its hand-over example posts to `/submit`.
- **Cost.** Undetectable word credits (`GET /check-user-credits`) and Pangram billing units; prices are TO VERIFY. The calls go behind the paid-call preconditions: every free check first.

**Sequence: serial, each step separately authorized, chosen by the owner from the post-MVP list.**

- **H0 — design.** Placement, artifact name, quote and ceiling pricing, the ledger, replay and revise behaviour, key handling, data handling, the decisions below. Documentation only.
- **H1 — offline library.** Provider interfaces and fakes, the loop controller, caption-only scoping, per-candidate revalidation, the caps and the artifact, inside `src/harness/contentRun/**`, with offline self-tests and a mutation group. No network, environment read or dependency (Node `fetch` suffices).
  - Stage 5's executor (`packagingAdaptation.ts`) is not in `scripts/ci/live-path-manifest.json`, but `payloadContract.ts`, which holds the caption budgets and the contact reserve, is. H1 must leave it byte-identical, or declare a live-path change; H0 checks which.
- **H2 — provider clients.** Both clients, run only by the Studio worker. Request shapes proven by the simulated dry run. Proposed key names `PANGRAM_API_KEY` and `UNDETECTABLE_API_KEY` (final in H2), added to `.env.example` and [Environment](ENVIRONMENT.md) in that change, never committed with values. Quotes and caps per H0. No live call.
- **H3 — Studio surface.** The quote shows the loop's priced ceiling; the run report shows the rounds, the scores, the diff and the non-convergence flag.
- **H4 — first live measurement (owner action).** A bounded set of runs measures:
  - Pangram scores before and after;
  - rounds used;
  - revalidation, critic and legal-review outcomes;
  - the owner's edits and the cost per post.

  The owner then decides: on by default, opt-in per run, or retired.

**Owner actions, named separately:**

- **O-H1:** create the Pangram key.
- **O-H2:** create the Undetectable key.

Each key is entered only in Render on `gcd-studio-worker`, never on the web, never in the live `gcd-social-*` services, never committed, and with its vendor's spend or credit limit set first, as for the Anthropic key at O4.

**Owner decisions, open:**

- **H-D1 — placement among the post-MVP items and S9.** *Recommend* after the revise of run `46f5bf15…` validates S8.8, so the loop is measured against a validated pipeline.
- **H-D2 — the round cap and per-run credit cap.** *Recommend* 3 rounds, with the credit cap set in H0 once prices are verified.
- **H-D3 — when the target is not reached.** *Recommend* forwarding the best valid candidate and the original to the critic, the legal review and the owner, clearly flagged, rather than failing the run.
- **H-D4 — exactly 100% human, or a threshold.** *Recommend* deciding after H4's measurements.

**Gates:**

- H0 accepted by the owner before H1.
- O-H1, O-H2 and the vendor terms reviewed before any live call.
- The M1→M2 interval's terms as then in force for anything touching a service (this track adds none).
- The posting gate, the legal review, the critic panel and the Phase-A approval gate unchanged in every H-step, proven by their existing self-tests.

**Vendor sources (read 2026-10-14):**

- Undetectable Humanization API v2 documentation, as supplied by the owner.
- Pangram REST API overview, as supplied by the owner.
- Pangram result fields from the [`pangram-sdk` README](https://github.com/pangramlabs/pangram-sdk).
- Pangram's humanizer figures from [pangram.com/blog/humanizers-aug-25](https://www.pangram.com/blog/humanizers-aug-25) (vendor-reported).

## Planned — Content Studio (owner decisions of 2026-09-29) — `PLANNED`

**State:** `PLANNED`. The design is [`docs/CONTENT_STUDIO_DESIGN.md`](CONTENT_STUDIO_DESIGN.md), added by the documentation change now recorded under *Merged repository change awaiting rollout* (PR #102). It was first recorded with the owner's approval pending. **The owner approved it on 2026-09-29, with the answers below.** Approval is not implementation. **S1 — the pipeline library and the §5.4 protections — is `IMPLEMENTED`, not merged** (*Content Studio S1*, at the top of this file). *(Corrected 2026-09-30: S1 is `MERGED` through PR #103 at `c1c19f4…`, not deployed or enabled; its record is under *Merged repository change awaiting rollout* below.)* No Studio service exists: no `src/studio/**` code, Studio migration, Render service, database, Google OAuth client, secret or Anthropic key. *(2026-09-30: S2 — `src/studio/db/**` and `studio/migrations/**`, the Studio schema and its runner — is `IMPLEMENTED`, not merged, at the top of this file; still no Render service, database, OAuth client, secret or key, and nothing has been migrated.)* *(2026-10-01: S2 is `MERGED` through PR #105 at `fd88a2c…`, not deployed or enabled; its record is under *Merged repository change awaiting rollout* below. Still no Render service, database, OAuth client, secret or key, and nothing has been migrated.)* *(2026-10-01: S3 — the review-only execution context and the worker, `src/studio/worker/**` — is `IMPLEMENTED`, not merged, fake runner only, at the top of this file. No Render file names the worker; still no Render service, database, OAuth client, secret or key.)* *(2026-10-02: S3 is `MERGED` through PR #107 at `0aae05b…`, not deployed or enabled; its record is under *Merged repository change awaiting rollout* below. S4 — the web service's authentication, `src/studio/web/**`, with `jose` — is `IMPLEMENTED`, not merged, at the top of this file. No Render file names the web service; still no Render service, database, Google OAuth client, consent screen, secret, `STUDIO_PUBLIC_ORIGIN` or key.)* *(2026-10-02: S4 is `MERGED` through PR #108 at `a80913d…`, not deployed, configured or enabled; its record is under *Merged repository change awaiting rollout* below. S5 — the read-only screens — is `IMPLEMENTED`, not merged, at the top of this file. Still no Render service, database, OAuth client, consent screen, secret, origin or key.)* *(2026-10-05: S5 is `MERGED` through PR #109 at `e9d06a7…`, not deployed, configured or enabled; its record is under *Merged repository change awaiting rollout* below. **The owner split S6** (decisions of 2026-10-05, recorded in S6.1's record): S6.1 — Studio migration 0003, the preflight-request table — is `IMPLEMENTED`, not merged, at the top of this file; S6.2 builds the actions with fake runners only; S6b connects the real runner after S8. Still no Render service, database, OAuth client, consent screen, secret, origin or key, and until S6b no Studio code path can spend money.)* *(2026-10-05: S6.1 is `MERGED` through PR #110 at `a22ffd9…`, not deployed, configured or enabled; its record is under *Merged repository change awaiting rollout* below. S6.2 — the run and revise actions with caps, fake runners only — is `IMPLEMENTED`, not merged, at the top of this file. Still no Render service, database, OAuth client, consent screen, secret, origin or key, and until S6b no Studio code path can spend money.)* *(2026-10-06: S6.2 is `MERGED` through PR #111 at `4eca3b3…`, not deployed, configured or enabled; its record is under *Merged repository change awaiting rollout* below. **The owner split S7** (decisions of 2026-10-06, recorded in S7.1's record): S7.1 — Studio migration 0004 and its database tests — is `IMPLEMENTED`, not merged, at the top of this file; S7.2 builds fact upload, import and the whole-run download; S7.3 the users-and-caps screens. Still no Render service, database, OAuth client, consent screen, secret, origin or key, and until S6b no Studio code path can spend money.)* *(2026-10-06: S7.1 is `MERGED` through PR #112 at `1e36054…`, not deployed, configured or enabled; its record is under *Merged repository change awaiting rollout* below. S7.2 — fact upload and versions, the legacy import and the whole-run download — is `IMPLEMENTED`, not merged, at the top of this file. The Anthropic workspace of O2 exists by owner report (no key yet); still no Render service, database, OAuth client, consent screen, secret, origin or key, and until S6b no Studio code path can spend money.)* *(2026-10-08: S7.2 is `MERGED` through PR #113 at `8e9a73d…` and S7.3 through PR #114 at `0f4dda0…`, neither deployed, configured or enabled. S8 (reduced) — `render.studio.yaml`, its static check, the release checklist — is `IMPLEMENTED`, not merged, at the top of this file: a Render file now declares the Studio's three resources, but **none is created**; still no Render service, database, Blueprint, OAuth client, consent screen, secret, origin or key, and until S6b no Studio code path can spend money. The O5 client-address fix is split to S8b, `PLANNED` and `BLOCKED`.)* *(2026-10-09: S8 is `MERGED` through PR #115 at `4738532…`, not deployed, configured or enabled; its record is under *Merged repository change awaiting rollout* below, its Blueprint merge gate closed after merge. S6b — the live-runner enablement — is `IMPLEMENTED`, not merged, at the top of this file: **after S6b, a paid call is possible only on a worker holding `ANTHROPIC_API_KEY`, which no environment has until O4 (after the freeze, separately authorized).** Still no Render service, database, Blueprint for the Studio, OAuth client, consent screen, secret, origin or key.)* *(2026-10-09, later: S6b is `MERGED` through PR #116 at `bab4f7d…`, not deployed, configured or enabled; its record is under *Merged repository change awaiting rollout* below. S8.1 — pre-O3 readiness: the database's storage, `diskSizeGB: 5`, and the checklist additions from the owner's read-only checks — is `IMPLEMENTED`, not merged, at the top of this file. By the owner's read-only check, still no `gcd-studio-*` resource, Blueprint for the Studio, OAuth client, consent screen, secret, origin or key.)* *(2026-10-10: S8.1 is `MERGED` through PR #117 at `b7ff939…`, not deployed, configured or enabled; its record is under *Merged repository change awaiting rollout* below. S8.2 — pre-launch hardening: a whitespace-padded key leaves the worker's live runner disabled, classed `anthropic_key_padded` — is `IMPLEMENTED`, not merged, at the top of this file. **S9 is `DEFERRED` until after O6** (owner decision of 2026-10-10). Still no Studio resource, OAuth client, consent screen, secret, origin or key.)* *(2026-10-12: S8.3 is `MERGED` through PR #119 at `68ba72c…`. **The owner performed O3, O1 and O4 without the key**: the Studio's Blueprint, database, web and worker now exist on Render in the project "GCD Content Studio", its OAuth client and consent screen exist in a new Google Cloud project, and its non-key values are set; no Anthropic key exists on any service. Database `CONFIGURED`, worker `DEPLOYED` with its live runner disabled, web `CONFIGURED` and not running, nothing `PRODUCTION-VALIDATED` — the O3/O1/O4 record, at the top of this file.)* *(2026-10-12, later: the owner chose option A for the Studio's database connections (internal connections unencrypted for the MVP; reading REVIEWER-VERIFIED) and decided "accept shared sign-in limits for MVP; S8b post-MVP" — the client-address gate is CLOSED by acceptance, S8b is post-MVP, and **O5 is blocked by no repository change**, needing only the owner's own authorization; the cursor section above.)* *(2026-10-13, the O6 records change: S8.5 and S8.6 are `DEPLOYED` and `PRODUCTION-VALIDATED` — both services at `dcc7b91`, `gcd-studio-db` at Studio migrations 0001–0005, the live runner `ENABLED`; **O6 is COMPLETE and the Content Studio MVP is live** (OWNER-OBSERVED; the record at the top of this file). Nothing from the Studio has been recorded as posted.)* This entry sits outside the production-wiring sequence: the Studio implements none of P1–P8, performs none of M2–M7, and moves no production-wiring milestone.

**Owner decisions (2026-09-29), recorded verbatim:**

1. Build a web interface that removes manual terminal runs of the content pipeline and lets the owner and staff view every run and report in a browser.
2. **A separate, review-only "Content Studio"** in the same `render.yaml`: its own web service, background worker, optional cron job and its own PostgreSQL database. It is **not** built inside the live `gcd-social-*` services.
3. **Users:** the owner plus a few staff, signing in with Google, restricted to `@germancardepot.com`. The owner decides which users may start paid runs.
4. **Runs are on demand only at launch.** The cron job is designed but disabled until the owner decides otherwise.
5. **The manufacturer facts file** (`config/automotive-facts.local.json`, today only on the owner's Mac) may be uploaded to the Studio and stored in its private database. It is never committed to GitHub.

**Amendment to decision 2 (owner, 2026-09-29).** The Studio gets a **separate Blueprint file, `render.studio.yaml`**, not the shared `render.yaml`. Decision 2 is otherwise unchanged. Whether Render supports a Blueprint at a non-default path is TO VERIFY. If it does not, the Studio's resources are created by hand from that checked-in file, which is the specification. **`render.yaml` is not modified at all by any Studio PR.** Decision 2 above is kept as first given.

**The owner's answers of 2026-09-29 to the design's §11.1** (recorded in full in design §11.1a):

1. **The design is approved** as amended. It stays `PLANNED`, and each S-PR and owner action still needs its own authorization.
2. **Decision 2 is amended** as above.
3. **The freeze covers new services; the default is kept.** No Studio service is created (O3) until the M1→M2 interval (bound `2026-10-22T18:52Z`) is closed, or under whatever terms are then in force.
   *(Dated amendment, owner decision of 2026-10-10, recorded by S8.3: **amended.** The interval's standing prohibition is narrowed so that it no longer covers the Studio's own new resources — `gcd-studio-web`, `gcd-studio-worker` and `gcd-studio-db`, created from `render.studio.yaml` in their own Render project. Every `gcd-social-*` service and `gcd-social-db` stays frozen exactly as before (no release, deploy, restart, sync, setting change or migration); the `gcd-agents` Blueprint is not synced, edited or re-linked; `deploy-production` stays disabled; the bound, the owner, the recovery path and the monitoring are unchanged, and the decision at the bound stays the owner's. Each Studio step (O3, O1, O4) needs the owner's own authorization and follows the release checklist in order, including the §3.6 Blueprint gate immediately before O3; no Anthropic key is entered (O4 without the key); O5 waits for S8b's merge; O6 waits for O5. Decision 3 above is kept as first given; the full record is S8.3's, at the top of this file.)* *(2026-10-12: O5 no longer waits for S8b — the owner accepted shared sign-in limits for the MVP; the cursor section above.)*
4. **Caps:**
   - owner caps $50 a day and $200 a month;
   - deployment ceilings `STUDIO_MAX_DAILY_USD` = 75 and `STUDIO_MAX_MONTHLY_USD` = 300;
   - an Anthropic workspace spend limit of $300 a month for the Studio key.

   The reservation stays at the full printed ceiling. Tightening the estimate is a separate, reviewed future change.
5. **Only the owner is a `runner` at launch;** staff are `viewer`. Runners added later get a $25 per-user daily cap.
6. **Time zone:** `America/New_York`.
7. **Retention:** runs are kept until the owner deletes them. The audit log and spend ledger are kept for 2 years.
8. **The worker starts on `standard`,** is measured, and may move down to `starter`. Plan prices are TO VERIFY.
9. **The P2 conflict is a binding rule.** Whichever comes first, production-wiring P2 or Studio S3, must define an explicit, separately reviewed review-only execution context, so that the local CLI and the Studio keep working. It can never approve or publish, and it sits beside the live authority gate, never replacing it. A dated pointer at P2 in [PRODUCTION_WIRING_DESIGN.md](PRODUCTION_WIRING_DESIGN.md) records it.
10. **A separate Anthropic workspace and key for the Studio is required.** O2 must happen before the first live run.
11. **Fake runs stay in the Studio, owner-only,** labelled on every screen.

**Operational note (owner, 2026-09-29).** `STUDIO_BOOTSTRAP_OWNER_EMAIL` must name a real Google Workspace **user** account, not a shared mailbox, an alias or a group, because the `hd` and `email_verified` checks only work for Workspace user accounts. The owner enters the value in Render; it is never committed.

**Sequence (design §10), serial, each separately authorized:**

- **S1** library extraction — **`MERGED`** through PR #103 at `c1c19f4…` (2026-09-30), not deployed or enabled;
- **S2** Studio schema and migrations — **`MERGED`** through PR #105 at `fd88a2c…` (2026-10-01), not deployed or enabled; *(until 2026-10-01: `IMPLEMENTED`, not merged; until 2026-09-30: the next repository change, pending the mutation-harness speed-up's merge, which is `MERGED` through PR #104 at `0bb3f0b…`)*;
- **S3** worker and queue, and the review-only execution context — **`MERGED`** through PR #107 at `0aae05b…` (2026-10-02), not deployed or enabled, fake runner only; *(until 2026-10-02: `IMPLEMENTED`, not merged; until 2026-10-01: the next repository change, pending S2's merge and then the mutation-harness shards change's, which is `MERGED` through PR #106 at `bec4a41…`)*;
- **S4** authentication — **`MERGED`** through PR #108 at `a80913d…` (2026-10-02), not deployed, configured or enabled; no OAuth client, secret or origin exists *(until 2026-10-02: `IMPLEMENTED`, not merged; until then, the next repository change, pending S3's merge)*;
- **S5** read-only screens — **`MERGED`** through PR #109 at `e9d06a7…` (2026-10-05), not deployed, configured or enabled *(until 2026-10-05: `IMPLEMENTED`, not merged; until 2026-10-02: the next repository change, pending S4's merge)*;
- **S6** run and revise actions with caps — **split by the owner on 2026-10-05** into:
  - **S6.1** the preflight-request schema (Studio migration 0003) — **`MERGED`** through PR #110 at `a22ffd9…` (2026-10-05), not deployed, configured or enabled; 0003 applied only to disposable test databases *(until 2026-10-05: `IMPLEMENTED`, not merged)*;
  - **S6.2** the run and revise actions with caps, on 0003, **fake runners only** — **`MERGED`** through PR #111 at `4eca3b3…` (2026-10-06), not deployed, configured or enabled *(until 2026-10-06: `IMPLEMENTED`, not merged; until 2026-10-05: the next repository change, pending S6.1's merge)*; design §8.7's users and caps settings screens are not in it (S7.3);
  *(until 2026-10-05: S6, the next repository change, pending S5's merge)*;
- **S7** fact upload and legacy import — **split by the owner on 2026-10-06** into:
  - **S7.1** Studio migration 0004 and its database tests, and the worker's claim restricted — **`MERGED`** through PR #112 at `1e36054…` (2026-10-06), not deployed, configured or enabled *(until 2026-10-06: `IMPLEMENTED`, not merged)*;
  - **S7.2** fact upload and versions, legacy import, and the whole-run download — **`MERGED`** through PR #113 at `8e9a73d…` (2026-10-07), not deployed, configured or enabled *(until 2026-10-07: `IMPLEMENTED`, not merged; until 2026-10-06: the next repository change, pending S7.1's merge)*;
  - **S7.3** design §8.7's users-and-caps screens, and the rule that a runner with no `daily_cap_usd` cannot confirm — **`MERGED`** through PR #114 at `0f4dda0…` (2026-10-08), not deployed, configured or enabled *(until 2026-10-08: `IMPLEMENTED`, not merged; until 2026-10-07: planned after S7.2)*;
  *(until 2026-10-06: S7, the next repository change, pending S6.2's merge)*;
- **S8** a new `render.studio.yaml`, with `render.yaml` byte-identical, its static check, the release checklist and the least-privilege role finding — **`MERGED`** (reduced) through PR #115 at `4738532…` (2026-10-09), not deployed, configured or enabled; **its BLOCKING merge gate CLOSED AFTER MERGE** (S8 merged while it was open; the owner's dated Blueprint check followed the same day and the reviewer cleared it — S8's reconciled record) *(until 2026-10-09: `IMPLEMENTED`, not merged, gate OPEN; until 2026-10-08: the next repository change, pending S7.3's merge, and it also carried the O5 client-address fix)*;
- **S8b** the O5 client-address fix — **`PLANNED`, `BLOCKED`** on a written statement from Render support naming the client-address header and whether `X-Forwarded-For` is appended or replaced; **required before O5**; its own PR and authorization (owner decision of 2026-10-08, splitting S8's scope D) *(2026-10-09: Render support's reply came from an AI agent, not a human engineer, and is not that statement; S8b becomes eligible ahead of S9 if a human engineer's written statement arrives first — S8.1's record)* *(2026-10-12, owner decision "accept shared sign-in limits for MVP; S8b post-MVP": still `PLANNED` and `BLOCKED`, now **post-MVP — no longer required before O5**; its fallback unchanged)*;
- **S6b** the live-runner enablement — **`MERGED`** through PR #116 at `bab4f7d…` (2026-10-09), not deployed, configured or enabled *(until 2026-10-09: `IMPLEMENTED`, not merged)*, after S8 and before O6, its own PR and its own authorization (owner decision of 2026-10-05): the worker constructs the existing Anthropic runner only when `ANTHROPIC_API_KEY` is present. **After S6b, a paid call is possible only on a worker holding `ANTHROPIC_API_KEY`, which no environment has until O4 (after the freeze, separately authorized)** *(until 2026-10-09: `PLANNED` — "until S6b, no Studio code path can spend money"; 2026-10-08: the next repository change, pending S8's merge)*;
- **S8.1** pre-O3 readiness (inserted by the owner on 2026-10-09; not a row of design §10) — **`MERGED`** through PR #117 at `b7ff939…` (2026-10-10), not deployed, configured or enabled *(until 2026-10-10: `IMPLEMENTED`, not merged)*: `diskSizeGB: 5` and its static-check rule, the O3/O1/O4 checklist additions, the Render research for S8b;
- **S8.2** pre-launch hardening (inserted by the owner on 2026-10-10; not a row of design §10) — **`MERGED`** through PR #118 at `ffe413e…` (2026-10-10), not deployed, configured or enabled *(until 2026-10-10: `IMPLEMENTED`, not merged)*: a whitespace-padded `ANTHROPIC_API_KEY` is classed `anthropic_key_padded`, the live runner disabled; O4 reads the class from the start-up line;
- **S8.3** the owner's decision narrowing the release freeze, and the live-services check (inserted on 2026-10-10; documentation only; not a row of design §10) — **`MERGED`** through PR #119 at `68ba72c…` (2026-10-12) *(until 2026-10-12: `IMPLEMENTED`, not merged)*;
- **the O3/O1/O4 record** — the owner actions of 2026-10-12 recorded (documentation only; not a row of design §10) — **`MERGED`** through PR #120 at `88b097e…` *(until 2026-10-12: `IMPLEMENTED`, not merged)*;
- **the shared-sign-in-limits record** — the owner's decision of 2026-10-12 accepting shared sign-in limits for the MVP and moving S8b post-MVP, recorded (documentation only; not a row of design §10) — **`MERGED`** through PR #122 at `ec8ec99…` *(until 2026-10-12: `IMPLEMENTED`, not merged)*;
- **S8.4** the browser form-POST fix (inserted on 2026-10-12 after the owner found the defect at O5; not a row of design §10) — **`MERGED`** through PR #123 at `fbf3fcc…` (2026-10-12), **`DEPLOYED`** to both Studio services and **`PRODUCTION-VALIDATED`** *(until 2026-10-12: `IMPLEMENTED`, not merged)*: the pages' `Referrer-Policy` `no-referrer` → `same-origin`, because under `no-referrer` a browser's form POST carries `Origin: null`, which the unchanged exact-Origin check refuses; `SA154`; the local Chromium check. **Required before the rest of O5**: after it merges, both Studio services are redeployed at its merge commit, web first;
- **S8.5** stage 5's caption target (inserted on 2026-10-12 after O6's three attempts failed at stage 5's caption check; not a row of design §10) — **`MERGED`** through PR #124 at `89e798a…` (2026-10-13), **`DEPLOYED`** (at `89e798a`, then `dcc7b91`) and **`PRODUCTION-VALIDATED`** (stage 5 passed on runs `8549e829…` and `46f5bf15…`) *(until 2026-10-13, the O6 records change: not deployed; until 2026-10-13: `IMPLEMENTED`, not merged)*: the target is the enforced budget less `MEASURED_HASHTAG_ALLOWANCE`, over 1.4; the word count first and "condense, don't restate" in the prompt; nothing enforced moves. **Required before the rest of O6**: after it merges, both Studio services are redeployed at its merge commit, web first;
- **S8.6** the legal-risk review step after the critic panel, and Studio migration 0005 (inserted by the owner on 2026-10-13 — the decision "legal lens: defaults"; not a row of design §10) — **`MERGED`** through PR #125 at `dcc7b91…` (2026-10-13), **`DEPLOYED`** to both Studio services with migration 0005 and **`PRODUCTION-VALIDATED`** (the legal review observed live on runs `8549e829…` and `46f5bf15…`) *(until 2026-10-13, the O6 records change: `IMPLEMENTED`, not merged)* (its record under *Merged repository change awaiting rollout*): one request on the critic policy, the owner's three blocking categories and seven for the owner's decision, the run's verdict unable to pass on a blocking finding; +$2.97 a run. **Its deploy applies 0005 and needs its own authorization, both Studio services deployed together at its merge commit.** **The owner's rule: nothing from the Studio is posted until the legal lens exists.** *(2026-10-13: its meaning CONFIRMED by the owner, no attorney step; MET for run `46f5bf15…`'s package — the O6 records change.)* *(2026-10-14: superseded by the owner's per-run rule, "per-run" — the posting gate is a standing rule for every Studio run; the note in the O6 records change's record, under *Merged repository change awaiting rollout*.)* Follow-ups: the attorney's review of `skills/legal-risk/SKILL.md` (~~**OPEN**~~ **`DEFERRED`** by owner decision of 2026-10-13; re-entry: the owner asks); **the live pipeline's equivalent — `PLANNED`**, after the owner's decision at the interval bound, its own design, change and authorization; a recovery action for a run that fails at the legal review — `PLANNED` if the owner wants one;
- **the O6 records change** — PR #125 reconciled, the redeploy at `89e798a` and the S8.6 deploy with migration 0005, runs `8549e829…` and `46f5bf15…`, O6 COMPLETE, the posting gate confirmed and met (documentation only; not a row of design §10) — **`MERGED`** through PR #126 at `50b27a1…` (2026-10-14) *(until 2026-10-14: `IMPLEMENTED`, not merged)*;
- **S8.7** "Edit these choices" (the owner's post-MVP item of 2026-10-12, chosen 2026-10-14 — "proceed with your recommendations"; not a row of design §10) — **`MERGED`** through PR #127 at `36d2996…` (2026-10-14), **`DEPLOYED`** to both Studio services at `36d2996` and **`PRODUCTION-VALIDATED`** (the report's link observed; OWNER-OBSERVED) *(until 2026-10-14, Content Studio S8.8: `IMPLEMENTED`, not merged)* (its record under *Merged repository change awaiting rollout*): New run filled in from a stored full price request or a visible run; the price page's "Edit these choices" and the report's "Start a new run with these choices"; an invalid submission's form shown again with its values; Studio web only, no migration;
- **S8.8** legal findings into revisions, and the disclaimer reworded (the owner's post-MVP items of 2026-10-13, chosen 2026-10-14 — "proceed with your recommendations"; not a row of design §10) — **`MERGED`** through PR #128 at `1f19e7b…` (2026-10-14) and **`DEPLOYED`** to both Studio services at `1f19e7b` (2026-10-16; no migration), **not `PRODUCTION-VALIDATED`** *(until 2026-10-16, the S8.8 records change: `IMPLEMENTED`, not merged)* (its record under *Merged repository change awaiting rollout*): a revision carries every finding of the source run's legal review, each to the writing stage that wrote its quote, in the existing `CRITIC_FINDINGS` block under the existing caps (lens `legal-review`, ids `L<n>`); the round starts at the earliest stage owning a critic blocking finding or any legal finding; the price page, `revision-meta.json` and `summary.md` list them; the disclaimer reads "Screening aid, not legal advice. Read it, and resolve its blocking findings, before posting."; no migration, no live-path file. ~~**After it merges, the owner redeploys both Studio services at its merge commit, web first**, under the owner's own authorization;~~ *(PERFORMED 2026-10-16 at `1f19e7b`.)* **Next, under the owner's own authorization:** a revise of run `46f5bf15…`, priced first (from hook-story-script, $19.245);
- **option B for the Studio's database connections — encryption without certificate verification — `PLANNED`, post-MVP** (owner decision of 2026-10-12, which chose option A for the MVP; see the cursor section above). Its own change and authorization; not before O6 unless the owner reorders;
- **Post-MVP items requested by the owner on 2026-10-12 — each `PLANNED`, its own change and authorization, none before O6 unless the owner reorders** (recorded by S8.5):
  - ~~an **"Edit these choices" button on the quote page** that returns to *New run* with the goal, platforms and tags preserved (O6's first quote had to be abandoned and re-entered to add the `gcd` tag);~~ **Moved 2026-10-14 to Content Studio S8.7** (`IMPLEMENTED`, the record at the top of this file; the S8.7 line above);
  - **showing which facts a scope pulls in before pricing** (O5's check warned that an unscoped run would exceed the 64-record cap);
  - **deciding whether the shop's approved facts are always included** — an owner decision first;
  - **switching the two `claude-opus-5` stages to `claude-opus-5-5`** — a model change, reviewed with its prices and output caps; *(2026-10-13, the O6 records change: the stages are `strategy-concept` and `automotive-truth`, on the `reasoning-heavy` policy; **a live-path change** — `src/harness/agents/modelPolicy.ts` is in `scripts/ci/live-path-manifest.json`)*
  - **a one-time, cost-ceilinged repair call when a caption is over budget** — it changes the "exactly once" and ceiling contracts, so it needs its own design first;
  - **rotating the Studio's Anthropic key**, which was created with no expiry (and was once saved on `gcd-studio-web` by mistake before being removed — O6's record);
  - **the least-privilege database role for the Studio web** — already listed (S8's finding; *From S2* below), not duplicated; and **option B** — already listed (the item above);
- **Post-MVP items added on 2026-10-13 — each `PLANNED`, its own PR and authorization** (recorded by the O6 records change; the other items the owner listed that day were already above, under S8.6's line or in S8.6's follow-ups, and are left as they are):
  - ~~**feeding the owner's legal decisions into revisions** — today legal findings are never sent to a revision (S8.6: they are the owner's), so a legal blocker such as run `46f5bf15…`'s `copyright_reproduction` cannot be cleared by revising; it changes S8.6's rule, so it needs its own design first;~~ **Moved 2026-10-14 to Content Studio S8.8** (`IMPLEMENTED`, the record at the top of this file; the S8.8 line above); *(2026-10-16: S8.8 is `MERGED` and `DEPLOYED`, not yet `PRODUCTION-VALIDATED`; its record is under *Merged repository change awaiting rollout*.)*
  - ~~**rewording the legal disclaimer to match the owner's no-attorney decision** ("forget about the attorney we are just mitigating risk", 2026-10-13) — the shipped text still says "Serious findings go to the owner's attorney before posting." in `LEGAL_REVIEW_DISCLAIMER` (`src/harness/contentRun/legalReview.ts:82`), `LEGAL_NOT_ADVICE` (`src/studio/web/views.ts:41`), `skills/legal-risk/SKILL.md` (lines 1 and 100, with its line 10 status line), the self-test (`src/harness/contentIntelligence.selftest.ts:8515`) and the mutation harness's anchors (`scripts/ci/payload-contract-mutation.mjs:6831` and `:6956`); the literals are held equal by checks, so they change together;~~ **Moved 2026-10-14 to Content Studio S8.8** (`IMPLEMENTED`; reworded everywhere, the rubric's status line replaced); *(2026-10-16: S8.8 is `MERGED` and `DEPLOYED`, not yet `PRODUCTION-VALIDATED`; its record is under *Merged repository change awaiting rollout*.)*
- **Post-MVP item added on 2026-10-14 — `PLANNED`, its own design, PRs and authorizations:** **the pre-review humanize loop** (Pangram detection, Undetectable humanization), the H-series, under *Planned — pre-review humanize loop* above. It changes the quote and ceiling contracts, as the caption-repair item above does, so it begins with its own design (H0). It is one of the post-MVP items the owner chooses among; it moves no cursor.
- **S9** the cron, built disabled — **`DEFERRED` until after O6** *(2026-10-13: O6 is COMPLETE, so the re-entry condition is met; still `DEFERRED`, not started — the owner chooses between it and the post-MVP items)* (owner decision of 2026-10-10: not required for the first live run, scheduled runs off at launch; the only path that would spend without a person confirming each run, so designed with O6's cost data; and a verified schema gap — no pre-authorization table, and a live run requires a user-bound, expiring, single-use quote — needing a pricing-and-reservation design decision and a new migration; S8.2's record) *(until 2026-10-10: the next repository change, pending S8.1's merge, unless the owner reordered or a human Render engineer's written statement made S8b eligible first; until 2026-10-09: pending S6b's merge)*.

**Owner actions, named separately:**

- **O1** create the Google OAuth client; *(2026-10-09, S8.1: in a **new** Google Cloud project under the `germancardepot.com` organization, with an Internal consent screen — never the existing GCD-Agents project's consent screen or clients; prerequisite, two-step verification on the owner's Google account before 2026-10-20, owner-reported)* *(2026-10-12: **PERFORMED** — project GCD-Content-Studio, Audience Internal, client "gcd-studio-web" with one redirect URI; OWNER-OBSERVED; two-step verification still due before 2026-10-20)*
- **O2** create the Studio's Anthropic key; *(2026-10-06, OWNER-REPORTED, not reviewer-verified: the separate workspace GCD-Content-Studio exists with its $300 monthly limit and a $150 alert; the key itself is created at O4 — S7.2's record)*
- **O3** create the Studio resources from `render.studio.yaml`; *(2026-10-09, S8.1: in a **new** Render project, "GCD Content Studio" — never GCD Social or its Production environment — moved there in the dashboard immediately after creation; the database at 5 GB, declared as `diskSizeGB: 5`)* *(2026-10-10, S8.3: **ELIGIBLE** under the owner's own authorization — the owner's narrowing of the freeze that day no longer covers the Studio's own resources; the §3.6 Blueprint gate immediately before it)* *(2026-10-12: **PERFORMED** after the gate — OWNER-OBSERVED; Studio migrations applied about four minutes before the owner's written authorization, a recorded deviation; the O3/O1/O4 record)*
- **O4** set the secrets; *(2026-10-09, S6b: including `ANTHROPIC_API_KEY` — from the GCD-Content-Studio workspace only, entered only in Render on `gcd-studio-worker`, never on the web, after S6b merges, with the caps set first; the worker's ready line then says `live_runner` "enabled")* *(2026-10-09, S8.1: pasted with no leading or trailing whitespace — the start-up line reads `anthropic_key_present` for a padded key too, so the value is checked before saving)* *(2026-10-10, S8.2: still pasted with no surrounding spaces; after the worker restarts the start-up line must read `"provider_key":"anthropic_key_present"` — `anthropic_key_padded` means a space or line break was pasted with it, so re-enter it; any other class is a stop)* *(2026-10-10, S8.3: under the owner's narrowing of the freeze, O4 follows O1 **without the Anthropic key**; entering the key is not covered by the narrowing and remains after the freeze, separately authorized)* *(2026-10-12: **PERFORMED WITHOUT THE KEY** — the web's six values and the worker's two ceilings saved with "Save only"; no `ANTHROPIC_API_KEY` on any service; OWNER-OBSERVED)*
- **O5** the first deploy and setup; *(2026-10-10, S8.3: waits for S8b's merge)* *(2026-10-12: also waits for the owner's TLS decision on the Studio's database connections)* *(2026-10-12, later: the TLS decision is made — option A for the MVP; O5 waits for S8b alone)* *(2026-10-12, later still: the owner accepted shared sign-in limits for the MVP and moved S8b after launch — **O5 waits on no repository change, only on the owner's own authorization**)* *(2026-10-12, S8.4: **PARTIALLY PERFORMED** by the owner under "O5 authorized at d545e14" — both services deployed at `d545e14`, the first sign-in, the caps already at their defaults; every browser form POST refused 403, so **the rest of O5 waits for S8.4's merge and the redeploy of both services at its merge commit, web first** — [Status](STATUS.md#content-studio-on-render--o5-partially-performed-2026-10-12-and-the-form-post-defect))* *(2026-10-12, S8.5: **PERFORMED except the restore drill and adding staff** (owner decision: after O6) — "O5 continued at fbf3fcc" (19:53Z); both services at `fbf3fcc`; the caps form saved, so S8.4 is `PRODUCTION-VALIDATED`; the facts file uploaded and its version activated — OWNER-OBSERVED, [Status](STATUS.md#content-studio-on-render--o5-performed-2026-10-12-and-o6-so-far))* *(2026-10-13, the O6 records change: still PERFORMED except the restore drill and adding staff — **now eligible**, O6 being complete, each under the owner's own authorization)*
- **O6** the first live run. *(2026-10-12, S8.5: **BEGUN, NOT COMPLETE** — "O6 key authorized" (21:06Z) and "O6 run authorized" (21:14Z); the key on `gcd-studio-worker`, the live runner `ENABLED`; three attempts failed at stage 5's caption check; stages 1–4 and the cost path `PRODUCTION-VALIDATED`, packaging and the critic panel not yet observed; the rest waits for S8.5's merge and the redeploy — OWNER-OBSERVED, [Status](STATUS.md#content-studio-on-render--o5-performed-2026-10-12-and-o6-so-far))* *(2026-10-13, S8.6: S8.5 is `MERGED`, not recorded as deployed; **nothing from the Studio is posted until the legal lens exists** — the owner's rule; the legal review becomes part of O6's observation once S8.6 is deployed with migration 0005)* *(2026-10-13, the O6 records change: **COMPLETE** — both services at `dcc7b91` with migration 0005; run `8549e829…` (a resume from packaging of `f23120bd…`, $0.682294), the first complete live run, and its revision `46f5bf15…` ($0.788304) succeeded; stage 5, the critic panel, the legal review, resume and revise `PRODUCTION-VALIDATED`; O6 spend about $2.48; the posting gate CONFIRMED and MET for `46f5bf15…`'s package *(2026-10-14: superseded by the owner's per-run rule, "per-run" — the posting gate is a standing rule for every Studio run; the note in the O6 records change's record, under *Merged repository change awaiting rollout*.)* — OWNER-OBSERVED, [Status](STATUS.md#content-studio-on-render--the-redeploys-of-2026-10-13-migration-0005-and-o6-completed))*

**Gates:**

- ~~**Owner approval of the design.**~~ **Given 2026-09-29.**
- **The release-freeze gate — confirmed by the owner.** The M1→M2 interval is bound at `2026-10-22T18:52Z`, and its prohibition covers "any service". No Studio service is created (O3) until the interval is closed, or under the terms then in force. Merging S1–S9 (S8.1 and S8.2 included) is not a release, while `deploy-production` keeps refusing at its disabled gate and native auto-deploy stays off on the live services (design §10). *(Owner decision of 2026-10-02: native auto-deploy being off is now an owner attestation, not re-verified per merge — last observed by screenshot on 2026-10-01; the `deploy-production` refusal is still verified from GitHub on every merge; S8's Blueprint auto-sync check is unaffected. See the cursor above.)* *(Owner decision of 2026-10-10, recorded by S8.3: **the gate is narrowed.** The interval's standing prohibition no longer covers the Studio's own new resources — `gcd-studio-web`, `gcd-studio-worker`, `gcd-studio-db`, created from `render.studio.yaml` in their own Render project — so O3, O1 and O4 (without the key) may proceed during the interval, each under the owner's own authorization and in the checklist's order, with the §3.6 Blueprint gate immediately before O3. Every `gcd-social-*` service and `gcd-social-db` stays frozen exactly as before; no sync, edit or re-link of the `gcd-agents` Blueprint; `deploy-production` stays disabled; the bound, owner, recovery path and monitoring are unchanged. O5 waits for S8b; O6 for O5. This amends decision 3 above.)* *(2026-10-12: O3, O1 and O4 without the key were performed under it; the gate is otherwise unchanged.)* *(2026-10-12, later: O5 no longer waits for S8b — the owner's decision accepting shared sign-in limits for the MVP.)*
- **The Blueprint check before S8 merges.** Is this repository linked to a Render Blueprint, which file does it read, and is auto-sync on? S8 adds only `render.studio.yaml` and leaves `render.yaml` byte-identical. Any Blueprint or dashboard action touching a `gcd-social-*` resource is a stop condition (design §3.6). *(2026-10-08: S8 records it as its **BLOCKING merge gate — OPEN**, cleared by the reviewer once the owner's dated read-only check is recorded; it is repeated before O3, as step 1 of the release checklist in [Operations](OPERATIONS.md).)* *(2026-10-09: **CLOSED AFTER MERGE.** S8 merged at 15:44Z while the gate was open; the owner's dated read-only check followed the same day and the reviewer cleared it: one Blueprint, `gcd-agents`, Blueprint Path `render.yaml`, Auto Sync Yes, only the four `gcd-social-*` resources, no sync on 2026-10-09. Auto Sync = Yes is a new finding for the owner after the freeze. Repeated before O3.)* *(2026-10-12: **repeated immediately before O3** — OWNER-OBSERVED: three Blueprints, `gcd-qbo-hub`, `gcd-agents`, `gcd-arcade`; `gcd-agents` unchanged, latest sync `55e6c40`; the Studio's own Blueprint, `gcd-content-studio`, was then created with Auto Sync set to No.)*
- ~~**The TLS decision before O5 (recorded 2026-10-12) — `BLOCKING`, OPEN.**~~ **DECIDED 2026-10-12 by the owner: option A for the MVP; option B (encryption without certificate verification) `PLANNED` post-MVP** — the cursor section above, with option A's reading TO CONFIRM *(confirmed 2026-10-12, REVIEWER-VERIFIED: the Studio's internal database connections stay unencrypted for the MVP)*. *As recorded until then:* The Studio's database connections are not TLS-encrypted: the database logs the worker's connection without "SSL enabled" (OWNER-OBSERVED), and no Studio code or design text requires TLS (REVIEWER-VERIFIED in the repository). The owner decides whether, and how, to encrypt them; whether Render's internal certificate matches the internal hostname is to be researched first. Any fix is its own change and authorization.
- ~~**The P2 rule** (design §5.4): whichever comes first, P2 or S3, defines the review-only execution context.~~ **Met by S3** (`IMPLEMENTED`; *`MERGED` through PR #107 since 2026-10-02*): it defines the context and how C2 and C3 would accept it; P2 is unchanged.
- **O2 before O6:** no live Studio run without the separate Anthropic workspace and key.
- **S6b before O6 (owner decision of 2026-10-05):** until S6b connects the real runner, under its own authorization, no Studio code path can spend money. *(2026-10-09: S6b is `IMPLEMENTED`, not merged. After it, a paid call is possible only on a worker holding `ANTHROPIC_API_KEY`, which no environment has until O4 — after the freeze, separately authorized.)* *(2026-10-09: S6b is `MERGED` through PR #116; met in the repository, not deployed.)*
- ~~**The client-address gate before O5 (recorded by S5, 2026-10-02) — `BLOCKING`.**~~ **CLOSED 2026-10-12 by acceptance — the owner's decision "accept shared sign-in limits for MVP; S8b post-MVP"; an accepted MVP limitation, not fixed** (the accepted behaviour and limit values are in the cursor section above; S8b `PLANNED`, `BLOCKED`, post-MVP). *As recorded until then:* S4's rate limits key on the direct peer address; behind Render's proxy every client may share it, so any outsider could lock out every sign-in. S8 must establish Render's trusted client-address header and fix the keying before O5, the first real sign-in. *(2026-10-08, owner decision: the fix is split from S8 into **S8b**, `PLANNED` and `BLOCKED` on Render support's written statement of the client-address header. The gate stays **BLOCKING and OPEN**. Interim: the limits act as near-global — a lockout, never a bypass. Fallback, an owner decision: key the limits off the client address entirely.)* *(2026-10-09, S8.1: still BLOCKING and OPEN. Render support's reply that day was an AI agent's, not the written statement required; Render's documentation names no client-address header and documents a private-network route to the web that does not pass Cloudflare — S8.1's record.)*

**Open questions:** answered by the owner on 2026-09-29 (design §11.1 and §11.1a).

## Merged repository change awaiting rollout

### Posting cadence — three posts a week, Monday / Wednesday / Friday; the rotation index counts posting slots; one brand post on each month's first posting day — `MERGED`

**Reconciled 2026-10-28 (records change):** `MERGED` through [PR #133](https://github.com/Caposhi/GCD-Agents/pull/133) at `516cf63e1de25e9b48499827265b6404ce8559de` (2026-10-28), after PRs #135 and #134; all 15 checks `success` on its head `21e9fb5…` (REVIEWER-VERIFIED in GitHub). **Not `DEPLOYED`.** **`main` CI run #319 (`40729646744`) concluded `success`**; **`deploy-production` run 100 (`40731204631`)** — gate job failed at *Refuse while production automation is disabled*, *Select exact release commit* skipped, the release job skipped: the expected refusal (REVIEWER-VERIFIED, read after completion). The merge-SHA, CI and refusal follow-ups for #133 are **DISCHARGED**. The production scheduler is still the daily one at `44d7336…`. *The record below is as written on the branch: its state words, "PR: #133" and "Merge SHA: not yet known" predate the merge.*


**State:** `IMPLEMENTED` on branch `claude/posting-cadence-mwf`, based on `origin/main` at `680468b` *(updated 2026-10-28 by merging `main` after PR #134; first built on `89e798a`, the merge of PR #124, S8.5)*; `LR12`'s pin re-set to this branch's manifest (`aa460d35…`). **Not `MERGED`, not `DEPLOYED`, not `ENABLED`.** **PR:** #133. **Merge SHA:** not yet known — recording it is a blocking follow-up before this is called complete. **Authorization:** the owner's decisions of 2026-10-13 — "Let's change the frequency of posts to 3 days a week"; "Yes, Mon/Wed/Fri, prepare the branch / All approved" (Monday/Wednesday/Friday, the code-level approach with the cron unchanged, the monthly brand post, a prepared branch with tests and documents). **Not authorized:** pushing, merging or deploying. This is not a Content Studio phase and does not move the Studio cursor below.

**Delivered scope.** `src/harness/contentCalendar.ts`: `POSTING_WEEKDAYS = [1, 3, 5]` (UTC), `isPostingDay`, `nextPostingDay`, `postingSlot`, `isFirstPostingDayOfMonth`, and `briefForDate(d, { force })`, which returns `null` on any other day. `src/scheduler/daily.ts`: decides from the date alone, before any database access, and logs "no post scheduled today" and exits 0 on an off day; `--force` enqueues the next posting day's brief. `scripts/ops/interval-monitor/`: the freshness bound 25 → 50 hours, with its wording. New suite `src/harness/contentCalendar.selftest.ts` (`npm run test:content-calendar`, wired into `test:offline`). Cadence wording in `README.md`, `docs/AI_HANDOFF.md`, `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`, `docs/PRODUCTION_WIRING_DESIGN.md`, `agents/hashtag-seo-timing.md` and `skills/platform-specs/SKILL.md` (the last two are loaded by no Content Intelligence stage, so no stage fingerprint moves).

**Migrations / schema impact:** none. The queue, the worker and the approval payload are unchanged.

**Material design decisions.**

- *The cadence lives in code; the cron stays daily.* CI fails any `render.yaml` change, and the Blueprint `gcd-agents` has Auto Sync on, so a merged `render.yaml` change would sync live services outside the controlled release path. A daily cron that decides in code is also visible in the scheduler's own log on an off day.
- *The rotation counts posting slots.* The previous index was `dayOfYear % 70`. With 70 = 7 × 10 the make was fixed by the weekday, so any fixed three-weekday schedule showed 3 of the 7 makes and 30 of the 70 combinations for a year. Counting posts from the Monday 2024-01-01 anchor advances the index by exactly one per post; a year of posts shows all 7 makes and all 70 combinations with a make-count spread of at most 4 (`CAL7`–`CAL9`, mutation-verified).
- *One brand post per month, on the month's first posting day,* taking that slot's make×service combination for the current pass; the monthly theme rotation is unchanged.
- *The monitor bound is 50 hours:* the longest healthy gap at its 14:00 UTC run is Sunday's 49 hours after Friday's run, and every single missed run is still caught within 26 hours of the next run (the monitor suite simulates each one).
- *`--force` is the only way to post on an off day.* The dashboard's "Trigger Run" passes no argument, so it enqueues nothing on an off day; `OPERATIONS.md` says so.

**Material rejected alternatives.** (1) *Editing the cron to `0 13 * * 1,3,5`, in `render.yaml` or the dashboard* — the first is refused by CI's byte rule and would auto-sync through the Blueprint; the second drifts from the declared Blueprint and is invisible in the repository. (2) *Keeping the day-of-year index and only filtering the weekdays* — shown by the regression test to starve four makes. (3) *Leaving the 25-hour monitor bound* — the monitor would fail every Sunday from the first healthy week; the suite fails at that Sunday check. (4) *Avoiding any live-loaded edit* — impossible: the scheduler entry point and the calendar are the live code, so the change is declared in the manifest instead.

**Automated validation** *(this container, Node 22.22.0)*: typecheck and build; `test:content-calendar` **20/20**; `test:interval-monitor` **99** (was 94); `test:content-intelligence` ALL PASS including `CS3`; `test:offline` **2,192** across thirteen suites (was 2,167 across twelve on `main` at `680468b`); the simulated dry run; the deployment-controller fixtures; M1 readiness; `check:mutation-shards`; `check:markdown-links` (69 files); `check:env-coverage` (45 variables); `scan:sensitive` (261 files, matched values never printed); `npm audit --omit=dev` (0 vulnerabilities); AgentShield 1.4.0 **B/86**, exit 0, unchanged from `main`; `git diff --check`. **Not run:** the Studio PostgreSQL suites (no Studio code or schema changed) and anything against a live environment — no scheduler, worker, database, provider or Render call was made.

**Production evidence:** none. Nothing about this change has been observed in production.

**Rollback / recovery:** revert the commit. Nothing is deployed, so no production state needs undoing; if it were deployed, application rollback selects a prior release and is a separate, explicitly authorized procedure ([Operations](OPERATIONS.md#backup-restore-and-rollback); the deployment controller does not implement rollback).

**Security and privacy:** no credential, token or URL added. The approval gate, the payload hash, the 24-hour TTL and the self-improvement lock are untouched; the scheduler still only enqueues, and every post still passes human approval.

**Accepted limitations.** (1) Until a scheduler-only release, production keeps posting daily, and the merged monitor's 50-hour bound detects a missed daily run a day later than before (no false alarm). (2) `render.yaml`'s comments ("1 brief/day") and `docs/DEPLOYMENT.md`'s description stay as they are, stale on the cadence; `render.yaml` cannot change in a documentation-only edit under CI's byte rule. (3) The posting weekdays are UTC; a 13:00 UTC run is 9:00 a.m. in Florida in summer and 8:00 a.m. in winter, always the same calendar day.

**Unresolved follow-ups / gates.**

- **Merge order.** The Studio release checklist ([Operations](OPERATIONS.md#content-studio-release-checklist--owner-actions-each-separately-authorized)) requires a deploy's diff to leave `scripts/ci/live-path-manifest.json` unchanged, and this change edits it. **Rebased 2026-10-21 onto `282fe54`:** the Studio redeploy at S8.5's merge commit that this once waited for has happened (S8.5 is `DEPLOYED` — [Status](STATUS.md)), so the rule now bites the *next* Studio deploy: any Studio deploy at a commit containing this change is refused unless the owner decides how the checklist applies. **Updated 2026-10-28:** the image incidental-text fix (PR #134) merged first, at `680468b`, and this branch then re-hashed the manifest — it now carries all four declared edits — and re-pinned `LR12` (`aa460d35…`), so the two no longer conflict. **Owner decision** on the Studio rule.
- **The release** of a scheduler-only deploy is frozen on every `gcd-social-*` service until 2026-10-22T18:52Z and needs the owner's separate authorization, or an exception to the freeze. **Owner decision.**
- **Owner decision of 2026-10-14: hold for M2; no exception release.** The recurring license-plate escalations (Oct 14: BMW Oil-Leak Repair, run `d6c1951e-7bbf-42eb-987b-64bf5e964416`) are attributed — not verified — to the worker still being at `44d7336…` without the four image/QC fixes already on `main` (`7697bf2`, `ebdcbb2`, `10543d8`, `83a5a7d`). The owner declined a worker-only exception release of those fixes and chose to carry them, and this cadence change, into the M2 reconciliation after the interval decision at `2026-10-22T18:52Z`. A cherry-pick candidate on `44d7336…` was built and passed the offline suite (362 checks, as recorded for that commit) but was discarded: it is not on `main`, so the controller cannot deploy it, and the dashboard's commit picker is understood (UNVERIFIED) to offer only the service's linked branch. Until M2, plate escalations will continue — nothing is posted on them — and the worker's actual commit remains unconfirmed. M2 itself still needs its own preflight, authorization and the checks the interval record owes.
- **After release:** observe the first off-day run (a "no post scheduled today" log line and no new `brief_queue` row), the first posting day's enqueue, and the monitor staying green through a Sunday — then `PRODUCTION-VALIDATED`.
- **Stale `render.yaml` comments** — fix with the next owner-authorized `render.yaml` change.
- **This change's merge SHA** (mutable-identifier exception) and its `main` CI run — a blocking follow-up.

**Documents updated:** this file (this record; the date; the cursor note); [Status](STATUS.md); [Testing](TESTING.md); [Operations](OPERATIONS.md); [Architecture](ARCHITECTURE.md); [AI handoff](AI_HANDOFF.md); [Production wiring design](PRODUCTION_WIRING_DESIGN.md); the root [README](../README.md); [`AGENTS.md`](../AGENTS.md) (the suite count, twelve → thirteen); `scripts/ci/live-path-manifest.json`.

**Checked and deliberately left unchanged:** `render.yaml` (byte-identical); `.github/workflows/*`, including `interval-monitor.yml` (its schedule and permissions are unchanged); [Deployment control](DEPLOYMENT.md); [Environment](ENVIRONMENT.md) and `.env.example` (no variable changed); [Data model](DATA_MODEL.md) (no schema change); the Content Intelligence stages and their fingerprints; every historical record in this file and `STATUS.md`, which keeps the daily cron where it recorded it.

### Image incidental-text fix — screens, signs and reflections; a text rule on every image attempt; per-surface retries — `MERGED`

**Reconciled 2026-10-28 (records change):** `MERGED` through [PR #134](https://github.com/Caposhi/GCD-Agents/pull/134) at `680468bca68dbcfb211751f99a1784a66570e069`. REVIEWER-VERIFIED in GitHub: all 15 checks `success` on its head `9fde52c…`; **`main` CI run #317 (`40726588164`), fifteen jobs, all `success`, including *Production dependency audit***; **`deploy-production` run 99 (`40728213010`)** — its gate job failed at *Refuse while production automation is disabled*, *Select exact release commit* skipped, the release job skipped: the expected refusal. **Not `DEPLOYED`.** Follow-up (4) below is **DISCHARGED**. *The record below is as written on the branch.*


**State:** `IMPLEMENTED` on branch `claude/image-incidental-text-fix`, based on `origin/main` at `282fe54`. **`MERGED`** through [PR #134](https://github.com/Caposhi/GCD-Agents/pull/134) at `680468bca68dbcfb211751f99a1784a66570e069` (2026-10-28; REVIEWER-VERIFIED in GitHub: all 15 checks `success` on its head `9fde52c…`, which merges `main` after PR #135) — **not `DEPLOYED`, not `ENABLED`.** *(The text below is as written on the branch; it says "IMPLEMENTED" and "PR: none opened" because it was written before the merge.)* **Authorization:** the owner's request of 2026-10-21 — "Yes, write the screens, signs and reflections fix" (code, tests and documents on a branch). **Not authorized:** pushing, merging or deploying. This is outside the Content Studio sequence and does not move its cursor.

**Delivered scope.** `src/harness/orchestrator.ts`: `INCIDENTAL_TEXT_GUARD`, `isIncidentalTextIssue` and `imagePromptFor`, which now build every image attempt's prompt (the loop's inline retry text is gone). `src/mcp/image-tool/fal/models.ts`: the Ideogram negative prompt extended. `agents/image.md`: rule 5 extended from the vehicle to every text-bearing surface. Tests: `IT1`–`IT12` in `test:orchestrator`, `N2a`–`N2c` in `test:image`. `scripts/ci/live-path-manifest.json` declares the two live-loaded edits and `LR12`'s pin moves with it.

**Migrations / schema impact:** none. QC, the approval payload, models and limits are unchanged.

**Material design decisions.** (1) *Take the surfaces out of the picture instead of asking the model to render them correctly* — repeated "render it correctly" asks failed in production (`LANDO ROVER`); the retry and the standing rule change the composition. (2) *The standing rule goes on every attempt, including the first* — two of the last three failures were on screens and reflections the old rules never mentioned, and a retry-only rule would spend an attempt first. (3) *Classify the inspector's free-text findings with broad words,* with `display` matched as a whole word so a headline finding is not taken for a screen. (4) *The third attempt after an incidental-text failure drops the vehicle exterior* for a close shot of a mechanical part — the last resort that gives the loop a different shot to try. (5) *QC is not loosened:* the inspector is working; the generator is what fails.

**Material rejected alternatives.** (1) *Relaxing QC for screens or reflections* — publishing a scrambled screen or a readable plate is the harm the gate exists to stop. (2) *A standing rule on retries only* — see (2) above. (3) *Hand-tuning the negative prompt alone* — the provider's own docs say the positive prompt takes precedence over it. (4) *Editing the image prompt in a new, non-live module* — the loop lives in a live-loaded module either way; declaring the edit is the honest path.

**Automated validation** *(this container, Node 22.22.0)*: typecheck and build; `test:orchestrator` **131** (was 119); `test:image` **21** (was 18); `test:content-intelligence` ALL PASS, including `CS3` and `LR12`; `test:offline` **2,167** across twelve suites (was 2,152); the simulated dry run; the deployment-controller fixtures; `check:mutation-shards`; `npm audit --omit=dev` (0 vulnerabilities); four in-place mutations, each caught and restored. `check:markdown-links` (69 files); `check:env-coverage` (45 variables); `scan:sensitive` (260 files, matched values never printed); `git diff --check`; AgentShield 1.4.0 **B/85, exit 0** — `main` alone scores B/86, and the one new finding is medium and size-only: `agents/image.md` is now 5,927 characters against the scanner's 5,000 threshold (it was 4,917, so no meaningful rule fit under it). **Not run:** the Studio PostgreSQL suites (no Studio code changed) and anything against a live environment — no image, model or provider call was made.

**Production evidence:** none. Whether Ideogram obeys the new rule is **unverified**. The Oct 19 and Oct 21 escalations are the baseline; the evidence is the share of real runs that reach approval after the worker is released.

**Rollback / recovery:** revert the commit. Nothing is deployed.

**Security and privacy:** no credential or URL added; the approval gate and the payload hash are untouched; fewer plates in generated images reduces the privacy risk the QC guards against.

**Accepted limitations.** (1) The model may ignore the rule; the third attempt and QC remain the backstops, and a run can still escalate. (2) A misspelled headline (`SAMOOTH MILE`) is not fixed — it may need a shorter headline from the image agent. (3) The four earlier plate/badge fixes are themselves not deployed, and the worker's actual commit is unconfirmed. (4) `agents/image.md` now trips AgentShield's size threshold (see validation); the runtime appends the rule itself, so the file's copy could be shortened later if the score matters. (5) `README.md` and the other handoff documents were left unchanged where they do not describe image prompts.

**Unresolved follow-ups / gates.** (1) **The release:** the owner's decision of 2026-10-14 holds the worker release for the M1→M2 reconciliation after `2026-10-22T18:52Z`; this change joins that bundle, with its own authorization. (2) **Manifest merge order — DISCHARGED 2026-10-28:** this merged first; `claude/posting-cadence-mwf` (PR #133) then re-hashed and re-pinned `LR12`. The Studio release checklist also refuses a deploy whose diff changes the manifest. (3) **After release:** inspect the first runs and compare the escalation rate with the baseline above. (4) **Merge SHA** — recorded above (`680468b…`); its `main` CI run and the `deploy-production` run for that merge (which must refuse while automation is disabled) are **not yet verified**.

**Documents updated:** this file; [Status](STATUS.md); [Testing](TESTING.md); [Architecture](ARCHITECTURE.md) (the image-attempt paragraph in the orchestration lifecycle); `agents/image.md`; `scripts/ci/live-path-manifest.json`; `src/harness/contentIntelligence.selftest.ts` (`LR12`'s pin).

**Checked and deliberately left unchanged:** `render.yaml`; `.github/workflows/*`; [Operations](OPERATIONS.md), [Deployment control](DEPLOYMENT.md), [Environment](ENVIRONMENT.md) and `.env.example` (no variable or procedure changed); [Data model](DATA_MODEL.md); `src/harness/imageQc.ts` (QC unchanged); the Content Intelligence stages and their fingerprints.

### Dependency fix — the `zod` advisory (GHSA-mrhx-c7xc-m3w5) cleared by an npm override; `npm audit --omit=dev` back to 0 — `MERGED`

**Reconciled 2026-10-28 (records change):** `MERGED` through [PR #135](https://github.com/Caposhi/GCD-Agents/pull/135) at `56bab13b2d95f7a7ab83021fffc976a30282be19` (2026-10-28). REVIEWER-VERIFIED in GitHub: all 15 checks `success` on its head `25ebabb…` — including *Node 22 offline quality gates*, whose *Production dependency audit* step had been failing on every branch; **`main` CI run #314 (`40723571081`) concluded `success`**; **`deploy-production` run 98 (`40725181545`)** — gate job failed at *Refuse while production automation is disabled*, *Select exact release commit* skipped, release job skipped: the expected refusal. **Not `DEPLOYED`:** the live worker and scheduler run the old lockfile. The merge SHA follow-up below is **DISCHARGED**. *The record below is as written on the branch.*


**State:** `IMPLEMENTED` on branch `claude/zod-advisory-fix`, based on `origin/main` at `282fe54…`. **Not `MERGED`, not `DEPLOYED`.** **PR:** none opened. **Authorization:** the owner's 2026-10-28 message, "Yes, push it and look into the zod advisory". **Not authorized:** pushing this branch, merging, deploying.

**The defect.** On 2026-10-28 `npm audit --omit=dev` reported one HIGH advisory — `zod` below 4.6.6, "can exhaust memory while validating oversized constrained collections" (GHSA-mrhx-c7xc-m3w5) — where it had read 0 on 2026-10-21. It is on `main` without any change of ours (the advisory is new). The CI job *Production dependency audit* runs `npm audit --omit=dev`, so **`main`'s CI, and every pull request's, fails that job until it is resolved.** Two copies were affected: the root `zod` 4.4.3 (an optional peer of `@anthropic-ai/sdk`, which `src/` never imports through) and sixteen nested `zod` 3.25.76 copies under `jimp`'s plugins. `jimp` 1.6.1 is its latest release and still depends on zod 3; the zod 3 line has no patched release; the only fix `npm audit` offers is a breaking `jimp` downgrade to 0.22.12.

**Exposure, assessed — not proven.** `src/` imports no `zod`. `jimp` is used in exactly one place, `src/harness/mediaNormalize.ts` (decode, `resize`, JPEG encode), and its plugins use zod to validate small option objects that our code builds from fixed numbers; the advisory needs an oversized constrained collection under an attacker's control, and none was found on that path. The Anthropic SDK's zod is an optional peer for helpers we do not call. **The audit gate is the reason for the change, not a demonstrated exploit.**

**The change.** `package.json` gains `"overrides": { "zod": "^4.6.6" }`; `package-lock.json` is regenerated (the sixteen nested copies are gone; one `zod` 4.6.7 serves `jimp` and the SDK). No source, agent, skill or manifest changed.

**Material design decisions and rejected alternatives.** *Chosen:* the override, tested against the only code that uses the affected package. *Rejected:* (1) the offered `jimp` downgrade to 0.22.12 — a breaking major with a different API (`Jimp.read`, `resize`, `getBuffer` are all called in `mediaNormalize.ts`) and an older, unmaintained decoder stack on the path that handles provider-generated images; (2) `npm audit --audit-level=critical` or an allowlist in CI — it weakens a gate to hide a finding; (3) replacing `jimp` (for example with `sharp`) — a native binary dependency and a rewrite of a live-loaded media path, out of proportion to an advisory with no identified exposure; (4) leaving CI red. **The override's risk, stated:** `jimp`'s plugins were written against zod 3 and now run against zod 4.

**Automated validation** *(this container, Node 22.22.0)*: a clean `npm ci --include=dev` (Render's build command) and build; typecheck; **`npm audit --omit=dev` and plain `npm audit` both 0 vulnerabilities**; `test:offline` **2,152**, unchanged and all passing, including the publication-media normalization checks that decode a real PNG, resize it by a uniform scale and encode a JPEG through `jimp` (`C`, `D`, `F`, `I`, `R4`); the simulated dry run; the deployment-controller fixtures. A direct smoke of `jimp` under zod 4: PNG decode, `resize`, JPEG encode at quality 90, a deliberately invalid `resize` option still refused, and `crop`, `rotate`, `flip` and `blur` constructed without error. **Not run:** the PostgreSQL and Studio jobs (no code or schema changed) and any production deploy; **`jimp`'s other plugins were not exercised beyond that smoke.**

**Production evidence:** none. **Rollback:** revert the commit (the override and the lockfile regenerate together). **Security and privacy:** no credential or data touched; the change reduces the audit's finding count and does not alter any runtime guard.

**Accepted limitations / unresolved.** (1) The override is a standing deviation: **remove it when `jimp` ships a release that depends on zod 4.6.6 or later**, and check `npm audit` when it goes. (2) Render builds with `npm ci --include=dev && npm run build`; a lockfile change reaches production only with a release, and **the live worker and scheduler (`44d7336…`) run the old lock** — it is in no way urgent for them. (3) Any other open branch's CI audit job also needs this change merged first, or the same fix applied. **Merge SHA** and its `main` CI run (mutable-identifier exception).

**Documents updated:** this file; [Status](STATUS.md); [Testing](TESTING.md); [Security and continuity](SECURITY_AND_CONTINUITY.md). **Checked and deliberately left unchanged:** `.github/workflows/ci.yml` (the audit step is the gate and stays as it is); `render.yaml`; `scripts/ci/live-path-manifest.json` (no live-loaded module changed); [Environment](ENVIRONMENT.md).

### Records — Content Studio S8.8 (PR #128) reconciled; the S8.8 deploy of 2026-10-16 recorded; S8.8 `DEPLOYED`, not `PRODUCTION-VALIDATED` — `MERGED`

**State (reconciled 2026-10-16 by the roadmap split, REVIEWER-VERIFIED through GitHub's API, read-only):** **`MERGED`** through [PR #129](https://github.com/Caposhi/GCD-Agents/pull/129) at `2cd98e163ac2296ad3d08d09af2286d35e2a0c6e` (2026-10-16T18:14:44Z; the merge commit's own author and committer time), a merge whose ordered parents are `1f19e7b416b41a4e28278d0f9f382acaf13c119a` then the reviewed head `c920201cafb2058b97f7c4342a297e6e8bee3c92`; **its tree (`3e16ee1e…`) is identical to `c920201`'s** (`git diff --quiet` reports no difference). **`main` CI ran once at `2cd98e1`:** run 303 (`38945845270`), `event: push`, attempt 1, created 18:14:47Z, completed 18:24:26Z, fifteen jobs, all `success` — *Node 22 offline quality gates*, *PostgreSQL 16 integration*, *PostgreSQL 18 integration*, *Workflow and YAML static validation*, *AgentShield 1.4.0* and *Payload-contract mutations 0/10* through *9/10*. (CI ran twice at `1f19e7b`; once here — why it ran twice there stays UNCONFIRMED.) **`deploy-production` run 95** (`38947096421`, `event: workflow_run`, created 18:24:28Z, two seconds after CI completed): gate job `117128860716` passed *Refuse non-main, non-push, or unsuccessful CI runs*, failed at *Refuse while production automation is disabled*, *Select exact release commit* skipped; release job `117128909750` (*Serialized API, worker, scheduler release*) skipped. **Its blocking merge-SHA, `main`-CI and `deploy-production` follow-ups are DISCHARGED.** Documentation only: it deployed nothing. Its record moved from *Implemented repository change awaiting merge* to here; its heading's state word `IMPLEMENTED` is **replaced** by `MERGED`, and otherwise the record is changed only by this paragraph and the dated notes marked "the roadmap split". *As recorded at implementation:*


**State:** `IMPLEMENTED` on branch `claude/upbeat-einstein-vbnf98`, based directly on `origin/main` at `1f19e7b416b41a4e28278d0f9f382acaf13c119a` (the merge of PR #128, S8.8). **Not `MERGED`.** **Documentation only:** only `docs/**` and `README.md` change; every other tracked file — 250 files, among them `render.yaml`, `render.studio.yaml`, `scripts/ci/live-path-manifest.json` and the 49 modules it lists, the five files under `studio/migrations/`, every workflow and the tracked `.DS_Store` — is byte-identical (sha256 compared before and after). **It records evidence; it performs nothing:** nothing was deployed, restarted, configured or changed on Render, Google or Anthropic; no model was called; **no revise was run, priced or prepared.** **PR:** this change's own pull request; its number and merge SHA are reconciled by the next records change (below).

**Authorization:** the routing brief of 2026-10-16 for this change — documentation only, settled design, read-only GitHub and Render access, a branch and a draft pull request, and nothing more. Nothing here authorizes a merge, a deploy, a revise, or any Render, Google or Anthropic action.

**Evidence labels (this record and the Status section it adds):** **REVIEWER-VERIFIED** — checked by the reviewer; here, by the session recording this change, read-only: in GitHub through its API (the pull request, commits, Actions runs and jobs), in Render through its API (the five services' settings, their deploys and logs, and one read-only `_migrations` query on `gcd-social-db`), and in the repository. **UNCONFIRMED** — reported or expected, not established by that session. **LOCAL** — run in this container. **No fact here is OWNER-OBSERVED:** the owner supplied no observation, no authorization line and no revise outcome with the brief. The brief carried a claim set prepared by an earlier review; every line of it was re-checked as above, and **none was contradicted**.

**Preflight (2026-10-16), all passed (LOCAL, REVIEWER-VERIFIED):** (1) `origin/main` is `1f19e7b…`, the merge of PR #128, with ordered parents `36d29964c9faef3bec66f8fd329d8402af3620ec` (the merge of PR #127) then the reviewed head `5022cdaeda75582d4b4d3a3271c4f088dc9e6c33`; `git rev-parse` gives the same tree, `42f1978dc60ca0106ee0c89ebeb741f253ae72df`, for both commits, and `git diff --quiet 1f19e7b 5022cda` reports no difference; (2) a clean tree on the designated branch, `.DS_Store` unmodified; the sha256 of all 274 tracked files recorded — `render.yaml` `e556a176…`, `render.studio.yaml` `5279f9e3…`, `scripts/ci/live-path-manifest.json` `322943ad…` (each of its 49 modules equal to its recorded hash), `.DS_Store` `6b6445e0…`; (3) the only other open pull request is #39 (draft, last updated 2026-08-27; `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `docs/ROADMAP.md`, `docs/STATUS.md`), left alone — none of the passages it edits is edited here; (4) `npm ci`, the typecheck, the build and `test:offline` **2,152** (posting 52, image 18, orchestrator 119, gate 56, api 51, render-identity 1, ownership 112, content intelligence 1,361, interval monitor 94, Studio database 23, Studio worker 73, Studio web 192).

**Delivered:**

1. **PR #128 reconciled (REVIEWER-VERIFIED).** S8.8 is **`MERGED`** through [PR #128](https://github.com/Caposhi/GCD-Agents/pull/128) at `1f19e7b…` (2026-10-14T19:19:22Z), its tree identical to the reviewed head `5022cda` (the method in preflight item 1). **`main` CI ran twice at `1f19e7b`:** run 300 (`38622691978`, created 19:19:26Z, completed 19:29:04Z) and run 301 (`38622717205`, created 19:19:37Z, completed 19:31:23Z), each `event: push` on `main`, attempt 1, fifteen jobs, all `success`. Every earlier merge recorded here shows one (run 297 for PR #127, 295 for #126, 293 for #125). GitHub's API shows both runs as the same push of the same commit by the same actor; **why GitHub started two is UNCONFIRMED** — benign, both green. **`deploy-production` therefore ran twice too**, each `event: workflow_run`, each created two seconds after a CI run completed, as `deploy-production.yml`'s `workflow_run` trigger on CI's completion does: run 93 (`38624051908`, 19:29:06Z) — gate job `116058586609` passed *Refuse non-main, non-push, or unsuccessful CI runs*, failed at *Refuse while production automation is disabled* (*Select exact release commit* skipped), release job `116058638442` skipped; run 94 (`38624389244`, 19:31:25Z) — gate job `116059720486` the same, release job `116059761219` skipped. S8.8's record moved from *Implemented repository change awaiting merge* to *Merged repository change awaiting rollout*, reconciled; **its blocking merge-SHA, `main`-CI and `deploy-production` follow-ups are DISCHARGED.** Nothing in it was deleted. *[2026-10-16, the roadmap split: one word was — the heading's state word `IMPLEMENTED` was **replaced** by "`MERGED`, `DEPLOYED` to the Studio; not `PRODUCTION-VALIDATED`", not appended to; every other change to S8.8's record was an addition (compared against `1f19e7b`).]*
2. **The S8.8 deploy of 2026-10-16 — REVIEWER-VERIFIED through Render's API and logs** (in full in [Status](STATUS.md#content-studio-on-render--the-s88-deploy-2026-10-16)). `gcd-studio-web` (`srv-db6edvqjnfac73dfkk7g`): deploy `dep-db95isei0phs73cd8d80`, created 17:05:53Z, finished 17:07:10Z (1m17s), `trigger: manual`, commit `1f19e7b…`; the pre-deploy `npm run studio:migrate` skipped 0001–0005 ("already applied, sha256 matches"), `[studio-migrate] done` at 17:06:44Z, "Pre-deploy complete!" at 17:06:47Z — **no migration**; ready at 17:07:00Z with commit `1f19e7b…` and `schema_version` `0005_studio_legal_review.sql`; "Your service is live" at 17:07:10Z. `gcd-studio-worker` (`srv-db6edvqjnfac73dfkk70`): deploy `dep-db95itmi0phs73cd8gfg`, created 17:05:58Z, finished 17:06:41Z (42.7s), `trigger: manual`, commit `1f19e7b…`; build at Node 22.23.3 (from `.node-version`) *[2026-10-16, the roadmap split: `.node-version` reads `22`, not a pinned patch version; Render resolved it to 22.23.3 at this build (its build log). CI's `setup-node` takes `"22"` from the workflow files, not `.node-version`, and resolves it to the then-current 22.x; which patch CI ran is not read here]*, 106 packages, 0 vulnerabilities; `live_runner` `enabled` / `anthropic_key_present` at 17:06:42.15Z; `ownership.waiting` at 17:06:42.380Z; **`ownership.held` at 17:07:42.479Z**; `recovery.finished {"interrupted":0,"runs":[]}` at 17:07:42.484Z; ready at 17:07:42.486Z with commit `1f19e7b…` and `live_runner` `enabled`; heartbeats continuing. **The worker has no `preDeployCommand`** (Render's service settings): the Studio's only migration path is the web's `npm run studio:migrate`.
   - **Order — web first, by start time only.** The web's deploy was created 5.7 seconds before the worker's. The two then overlapped: the worker was live (17:06:41.80Z) before the web's pre-deploy finished (17:06:47.66Z) and before the web was live (17:07:10Z) — unlike the S8.7 deploy, whose worker began after the web had finished. With no migration this changed nothing — the database was already at 0005, the schema the worker requires. **On a migration-bearing release the same overlap would start the worker before its schema exists**, and the worker refuses any schema version but its own (`src/studio/worker/startup.ts`; `SW3a`, `SWP1b`) — it fails closed, so the risk is a refused start, not a wrong one. Whether "web first" in the release checklist means "after the web is live" is **an open question for the owner** (below); the rule is unchanged here.
   - **Authorization: UNCONFIRMED.** The release checklist asks for the owner's authorization line, sent on its own before deploying. None was supplied to this session; the deploys' Render trigger is `manual` (a person's action — not native auto-deploy and not the API). The dashboard's wording of that trigger, as relayed in the brief ("Manually deployed by you via Dashboard"), was not seen by this session.
   - **`/healthz` was not read** (outside the brief's read-only GitHub and Render API access): UNCONFIRMED.
3. **Readiness is dated from ownership, not from Render's banner.** For the background worker, Render printed "Your service is live 🎉" at **17:06:41.80Z — 61 seconds before `ownership.held`** (17:07:42.479Z). For a background worker that banner means the new process started; it does not mean the process owns the queue. Until `ownership.held` the earlier instance (`-zs86g`, logging heartbeats from before this deploy's build finished until 17:07:35.6Z) still held ownership, and the new instance (`-7kc92`) logged `ownership.waiting`; it held ownership at 17:07:42.479Z, recovered 0 interrupted jobs at 17:07:42.484Z and logged ready at 17:07:42.486Z. **This record therefore dates the worker's readiness at `1f19e7b` from `ownership.held` / `recovery.finished` / `ready` — 17:07:42Z — and never from the live banner.** A wait of about a minute at a worker deploy is the normal hand-over (S8.7: `ownership.waiting` 16:53:32Z → `ownership.held` 16:54:31Z; S8.6: 17:34:27Z → 17:35:27Z); it is not ownership contention, and a reader of a future deploy should not date readiness a minute early or read this wait as a fault.
4. **The live system is unchanged (REVIEWER-VERIFIED, 2026-10-16).** `gcd-social-api` (`srv-d8u0qtpo3t8c73c5o44g`) live at `dep-dam3dfv40ujc73fgidhg` / `A` = `d5015236672a02bf8f58d342625c32a4f5acc8a1`; `gcd-social-worker` (`srv-d8u0qtpo3t8c73c5o440`) at `dep-da8sjmp42hec73dvhk30` / `R` = `44d7336f2c75ff880cff0d8205d2fafe13eb91b5`; `gcd-social-scheduler` (`crn-d8ulb4rtqb8s73bdjctg`) at `dep-da8siupsrm7s73afv6u0` (`R`), schedule `0 13 * * *`; `autoDeploy: "no"` and `autoDeployTrigger: "off"` on all three; the API's `preDeployCommand` exactly `npm run migrate`; `_migrations` exactly `001`–`007`, `007_evidence_bounds.sql` at `2026-09-17T18:52:22.268131Z`, no `008`. The live services sit in environment `evm-dap7nco473hc73dbpuc0`; the Studio's in `evm-db6ecg3rjlhs738745ag`. **The S8.8 deploy is not a breach of the M1→M2 partial-release interval:** the interval (bound `2026-10-22T18:52Z`, unchanged here) prohibits releases of the live system's services, and the owner's decision of 2026-10-10 narrowed it to exclude the Studio's own resources; the Studio shares no service, database or Blueprint with the live system, and none of the live system's services was released.
5. **State changes** (the vocabulary exactly): **S8.8 — `MERGED` and `DEPLOYED`** (both Studio services at `1f19e7b`, no migration); **not `PRODUCTION-VALIDATED`**. `gcd-studio-db` stays **`CONFIGURED`** at Studio migrations 0001–0005; both Studio services **`DEPLOYED`** at `1f19e7b`; the live runner **`ENABLED`** (the worker's log). S8.7 stays `DEPLOYED` and `PRODUCTION-VALIDATED` (`1f19e7b` carries it). The Studio's state-label table in [Status](STATUS.md#content-studio-on-render--the-s88-deploy-2026-10-16) is updated; the earlier tables stay as dated history.
6. **Discrepancies found and reconciled** (each from source or verified evidence; the prose was corrected, never followed): (a) this file's open item for the blocking merge-SHA follow-up still named "Content Studio S8.7 at the top of this file" — S8.8 had discharged S8.7's but not renamed the item; it now names this change, with S8.7's and S8.8's discharges added; (b) [AI handoff](AI_HANDOFF.md) item 4's latest Studio note was S8.7's ("S8.7 … `IMPLEMENTED`, not merged") — S8.8 had not updated it; a dated current-state note is added; (c) [Operations](OPERATIONS.md#content-studio-release-checklist--owner-actions-each-separately-authorized) step 6's S8.8 line expects "the worker's ready line" to show `schema_version`, but the worker's ready line carries the commit, the state and `live_runner` only (observed; the web's ready line and `/healthz` carry the schema version, `src/studio/web/server.ts`) — a dated note says so; the rule is unchanged; (d) the open item "AgentShield grade B/87 (9 medium …, 9 low …)" — AgentShield 1.4.0 reports B/86 with 10 medium and 10 low findings (LOCAL, this change's run), as the S8.x records already state; a dated note is added.
7. **The cursor** (the section below, and [Status](STATUS.md#current-cursor--the-single-next-safe-operation)): this change's merge; then **a revise of run `46f5bf15…`, priced first, from hook-story-script ($19.245), under the owner's own authorization** — the observation that would make S8.8 `PRODUCTION-VALIDATED`; then the owner's choice between S9 and the rest of the post-MVP list. The previous cursor is kept as dated history.

**Migrations / schema impact:** none from this change. It records that no Studio migration was applied at the S8.8 deploy (0001–0005 skipped) and that the live `_migrations` is unchanged at 001–007.

**Material design decisions:**

- **Readiness is dated from the worker's own ownership and ready lines,** never from Render's live banner, with the reason recorded (item 3).
- **The second CI run is recorded, not explained:** its cause is not visible through GitHub's API, so it is UNCONFIRMED rather than guessed; both runs and both `deploy-production` refusals are recorded.
- **"Web first" is recorded as observed** — by start time, overlapping — and the checklist's meaning is put to the owner rather than rewritten here.
- **The missing authorization line is recorded as UNCONFIRMED,** not inferred from the `manual` trigger.
- **S8.8 is recorded `DEPLOYED`, explicitly not `PRODUCTION-VALIDATED`:** no revise outcome was supplied, and none is inferred.

**Material rejected alternatives:** recording S8.8 `PRODUCTION-VALIDATED` (its new behaviour has not been observed); dating the worker's readiness from "Your service is live" (it precedes ownership by 61 seconds); recording the deploy as owner-authorized because its trigger is `manual` (the trigger says who clicked, not that the authorization line came first); attributing the second CI run to a re-run or a second push (the API shows attempt 1 and one push); changing the checklist's "web first" rule (an owner decision); reading `/healthz` (outside the read-only GitHub and Render access); introducing `docs/COMPLETED_ROADMAP_PHASES.md` (still a separate documentation change, listed under the open items below).

**Automated validation** *(LOCAL: this container, Node 22.22.0)* — in full in the PR: `npm ci`; the typecheck; the build; **`test:offline` 2,152, equal to the preflight baseline suite by suite** (twelve suites); the simulated dry run ("DRY RUN OK"); the deployment-controller fixtures; `check:mutation-shards` (15 injected faults refused); `npm audit --omit=dev` (0 vulnerabilities); AgentShield 1.4.0 (**B/86**: 20 findings, 10 medium and 10 low, none critical or high — unchanged); `check:markdown-links` (68 files); every in-repository anchor in `docs/` and `README.md` resolved against GitHub's heading slugs (359 links, 0 broken; 328 and 0 on `1f19e7b`); `check:env-coverage` (45 variables); `scan:sensitive` (259 files) and a credential and PII search of the added lines with manual triage (prose matches only — "no secret", and a pre-existing "OAuth client" phrase on a line this change extended; the long numbers are GitHub job ids); `git diff --check`; the sha256 of the 250 files outside `docs/**` and `README.md`, `.DS_Store` among them, identical to preflight; every modified document's changed sections and current-state sections reread. **CI on the final head:** recorded in the PR (fifteen jobs).

**Production evidence:** this change records production evidence (items 2–4, REVIEWER-VERIFIED as labelled); it adds none of its own.

**Rollback / recovery:** revert the commit; that removes the record, not the facts. No data, schema or external state to restore. The S8.8 deploy's own recovery is as S8.8's record states: no migration to undo, and the older web still renders a plan stored by S8.8; redeploying both Studio services at an earlier commit is an owner action under the owner's own authorization.

**Security and privacy implications:** no key, connection string, e-mail address, cookie, session id, account address or customer data is recorded. The Render identifiers recorded (service, deploy, environment and database ids, instance suffixes) are already in this repository's records or are operational identifiers without access value; *[2026-10-16, the roadmap split: no database id was added by this change; the environment ids (`evm-…`) and the instance suffixes (`-zs86g`, `-7kc92`) were new to the repository — operational identifiers without access value, benign]*; the log lines quoted carry no secret (`anthropic_key_present` is a class, not a value). The single `_migrations` query was read-only (Render wraps it in a read-only transaction) and returned migration names and times only.

**Accepted limitations:**

- **Why CI ran twice at `1f19e7b` is UNCONFIRMED.**
- **The S8.8 deploy's authorization line is UNCONFIRMED** — not supplied to this session.
- **`/healthz` at `1f19e7b` was not read.**
- **S8.8's new behaviour is not yet observed in production.**
- **The modified documents were reread section by section, not end to end** *[2026-10-16: addressed by the roadmap split, which relocated completed history to the [completed-phase ledger](COMPLETED_ROADMAP_PHASES.md) so that this file can be reread whole]*: `docs/ROADMAP.md` is about 1.35 MB and `docs/STATUS.md` about 0.28 MB; every section this change edits, every current-state section, and every line carrying S8.8's identifiers (`S8.8`, `#128`, `1f19e7b`, `5022cda`, `36d2996`, `46f5bf15`, `$19.245`) were reread; the historical records elsewhere were not.

**Unresolved follow-ups:**

- **This PR's merge SHA** (mutable-identifier exception), **its `main` CI run** (fifteen jobs, each `success` on attempt 1) and **the `deploy-production` run for its merge** (*Refuse while production automation is disabled*, release job skipped) — **a BLOCKING follow-up for the next records change**, verified by the reviewer after the merge. *(DISCHARGED 2026-10-16 by the roadmap split, REVIEWER-VERIFIED: `2cd98e1…`; `main` CI run 303, fifteen jobs, all `success` on attempt 1; `deploy-production` run 95 refused at the disabled gate, release job skipped; the reconciliation above.)*
- **The revise of run `46f5bf15…`, priced first, from hook-story-script ($19.245) — an owner action under the owner's own authorization** ([Operations](OPERATIONS.md#content-studio-release-checklist--owner-actions-each-separately-authorized) step 6): its price page should list, under "From the source run's legal review", L2 and L3 (`manufacturer_quotation`, hook-story-script, sent) and L1 (`copyright_reproduction`), L4 and L5 (production-direction, sent) before the owner confirms; 8 requests. **Its outcome is what would make S8.8 `PRODUCTION-VALIDATED`**: the price page's legal list, the plan starting at hook-story-script, which of L1–L5 were sent and to which stage, `revision-meta.json`'s `legalFindingsSent` / `legalFindingsDropped`, the reworded disclaimer on the revised run's report, and the actual cost against the $19.245 ceiling. Not run, priced or prepared here.
- **An owner question:** does "web first" in step 6 mean the worker's deploy starts only after the web is live? It matters for the next migration-bearing Studio release (item 2).
- **Why CI ran twice at `1f19e7b`** — UNCONFIRMED; to watch on the next merge. *(2026-10-16, the roadmap split: watched — CI ran once at this change's merge `2cd98e1` (run 303); the cause at `1f19e7b` stays UNCONFIRMED and is not pursued further.)*
- The rest of the post-MVP list and the owner items, unchanged (the cursor below).

**Documents updated:** this file (this record; S8.8's record moved to *Merged repository change awaiting rollout* and reconciled; the cursor section — heading, cursor and its S8.8 bullet; the open items' blocking merge-SHA item and AgentShield item; the Studio section's S8.8 line and the two post-MVP items' pointers; dated pointers in the O6 records change's and S8.6's records; "Last reviewed"); [Status](STATUS.md) (this change's entry; S8.8's entry reconciled; the new *the S8.8 deploy (2026-10-16)* section and its state-label table; the phase table's S8.8 and Studio rows and this change's row; the Content Studio paragraph in *Current cursor*; the introduction); [Operations](OPERATIONS.md) (step 6: the S8.8 deploy performed, the worker's ready-line note, the revise still owed; step 7's disclaimer note); [README](../README.md) (the design row and the Studio bullet); [AI handoff](AI_HANDOFF.md) (item 4's current-state note); [Content Studio design](CONTENT_STUDIO_DESIGN.md) (§5.5, §8.2, §8.4: dated notes that S8.8 is merged and deployed, not production-validated); [Security and continuity](SECURITY_AND_CONTINUITY.md), [Testing](TESTING.md) and [Architecture](ARCHITECTURE.md) (a dated note each).

**Checked and deliberately left unchanged:** every file outside `docs/**` and `README.md` (250 files byte-identical); [`AGENTS.md`](../AGENTS.md) and [`CONTRIBUTING.md`](../CONTRIBUTING.md) (still twelve suites; no rule changed); [Environment](ENVIRONMENT.md) and `.env.example` (no variable changed); [Deployment control](DEPLOYMENT.md) (no deploy rule or authority changed — the Studio's deploys stay manual and exact-commit, which this deploy was); [Data model](DATA_MODEL.md) (no table, column or migration changed); the live system's dated table in [Status](STATUS.md#production-state) (its "last verified 2026-09-18" baseline is not re-dated by this change's narrower read; item 4 records the read); every other historical record in this file.

### Content Studio S8.8 — a revision carries the source run's legal-review findings to the writing stages; the legal disclaimer reworded to the owner's no-attorney decision; PR #127 reconciled; the S8.7 deploy recorded — `MERGED`, `DEPLOYED` to the Studio; not `PRODUCTION-VALIDATED`

**State (reconciled 2026-10-16 by the S8.8 records change, REVIEWER-VERIFIED through GitHub's and Render's APIs, read-only):** **`MERGED`** through [PR #128](https://github.com/Caposhi/GCD-Agents/pull/128) at `1f19e7b416b41a4e28278d0f9f382acaf13c119a` (2026-10-14T19:19:22Z — GitHub's `merged_at` and the merge commit's own time agree), a merge whose ordered parents are `36d2996…` then the reviewed head `5022cdaeda75582d4b4d3a3271c4f088dc9e6c33`; **its tree (`42f1978d…`) is identical to `5022cda`'s**. `main` CI ran **twice** at `1f19e7b`, both `event: push`, attempt 1 — run 300 (`38622691978`) and run 301 (`38622717205`), fifteen jobs each, all `success`; `deploy-production` ran twice, once per CI run (`event: workflow_run`) — run 93 (`38624051908`): gate job `116058586609` refused at *Refuse while production automation is disabled*, release job `116058638442` skipped; run 94 (`38624389244`): gate job `116059720486` refused there too, release job `116059761219` skipped. **Its blocking follow-ups are DISCHARGED.** **`DEPLOYED`** to both Studio services at `1f19e7b` on 2026-10-16 — web deploy `dep-db95isei0phs73cd8d80` first, then worker deploy `dep-db95itmi0phs73cd8gfg`; **no migration** (the pre-deploy skipped 0001–0005); the web ready at 17:07:00Z with schema 0005; the worker `ownership.held` at 17:07:42.479Z, 0 interrupted, ready at `1f19e7b` with `live_runner` `enabled`. **Not `PRODUCTION-VALIDATED`:** its new behaviour — legal findings carried into a revision, listed on the price page before confirmation — has not been observed in production; the revise of run `46f5bf15…` that would observe it has not been reported (the cursor). [Status](STATUS.md#content-studio-on-render--the-s88-deploy-2026-10-16); the S8.8 records change at the top of this file. *As recorded at implementation:*

**State:** `IMPLEMENTED` on branch `claude/cool-lamport-q34vhm`, based directly on `origin/main` at `36d29964c9faef3bec66f8fd329d8402af3620ec` (the merge of PR #127, S8.7). **Not `MERGED`, not deployed.** **PR:** this change's own pull request; its number and merge SHA are reconciled by the next records change (below). The shared pipeline library (`src/harness/agents/revision.ts`, `revisionInput.ts`, `src/harness/contentRun/legalReview.ts`, `verify.ts`, `pipeline.ts`, `summary.ts`), the three writing-stage prompts, the legal rubric's three owner-decided lines, the Studio worker's refusal messages (`preflight.ts`, `execute.ts`), the web's price page (`actionViews.ts`) and not-legal-advice line (`views.ts`), the CLI's help text, the four self-test suites and the mutation harness. **No live-path file, Render file, Studio migration, workflow, package file, cap, ceiling, price, model, verdict rule, blocking category, legal-review prompt or critic prompt changed**; no new package.

**Authorization:** the owner's post-MVP items of 2026-10-13 — "feeding the owner's legal decisions into revisions" and "rewording the legal disclaimer to match the owner's no-attorney decision" — and the owner's go-ahead of 2026-10-14, verbatim: **"proceed with your recommendations"**; the owner's routing of 2026-10-14: "the owner authorizes S8.8 as scoped below, and nothing more". Nothing here authorizes a merge, a deploy, or any Render, Google or Anthropic action. No model was called: fake runners and fixtures only.

**The review of PR #128 (2026-10-14, REVIEWER):** one change required, everything else accepted. **Accepted as built:** the category-length call (per-field fit for the issue and fix, the block-level ceiling guard before any request); `LEGAL_REVIEW_DISCLAIMER_S8_6`, accepted read-only and only as that exact literal; the replacement of the rubric's status paragraph. **Required, and made in this PR:** the start stage — the earliest writing stage owning a critic blocking finding or **any** legal finding (item 3), because the real run `46f5bf15…`'s two `manufacturer_quotation` decisions are in the **script**, and the first rule (the earliest stage owning a blocking finding) started its revise at production-direction, sending them to a stage never re-run.

**Preflight (2026-10-14), all passed (LOCAL, REVIEWER-VERIFIED through GitHub's API, read-only):** (1) `origin/main` is `36d2996…`, the merge of PR #127, with ordered parents `50b27a1…` then `5ce67f2aa4d4ef7126bfef5460da579aba936bee`, and its tree (`21cf9ac1…`) identical to `5ce67f2`'s; (2) PR #127 merged — GitHub's `merged_at` reads **2026-10-14T16:27:27Z** and the merge commit's own author and committer time **16:27:26Z** (the figure the owner's routing gave; the one-second difference is GitHub's, recorded rather than resolved); `main` CI run 297 (`38598228908`) at `36d2996` — fifteen jobs, all `success` on attempt 1; `deploy-production` run 92 (`38599528731`) — gate job `115974856383` failed at *Refuse while production automation is disabled*, release job `115974913179` skipped; (3) the only other open PR is #39 (`AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `docs/ROADMAP.md`, `docs/STATUS.md`), left alone; (4) a clean tree, `.DS_Store` unmodified; the sha256 of `render.yaml`, `render.studio.yaml`, the 49 files in `scripts/ci/live-path-manifest.json` (each equal to its recorded hash) and the five files under `studio/migrations/` recorded; (5) `npm ci`, the build, `test:offline` **2,136** (posting 52, image 18, orchestrator 119, gate 56, api 51, render-identity 1, ownership 112, content intelligence 1,348, interval monitor 94, Studio database 23, Studio worker 71, Studio web 191); the Studio PostgreSQL suites on 16.15 **395 / 49 / 43**; the mutation inventory **787**.

**Delivered:**

1. **A revision carries the source run's legal findings.** When the source run holds `07-legal-review.json`, `reviseRun` revalidates it against exactly the package it reviewed (`verifySourceLegalReview`, `verify.ts`: the verified stage 3–5 outputs, stage 5 with its contact lines rebuilt from the pack, the recorded platforms) and the plan (`planRevision`'s new `legal` input) includes **every one of its findings**, blocking and "for your decision" alike. A review that does not revalidate is **refused before any plan, request or directory** (`LV11`), not planned around. **A source with no legal review** (from before S8.6, or stopped before it) **revises exactly as before** — the plan key for key the panel's alone, no legal record in `revision-meta.json` or `summary.md` (`LV6`; CV11–CV22 and SW23/SW23a/SWP34 run on such sources with their assertions unedited).
2. **Each finding goes to the writing stage that wrote its quoted block** (`legalFindingStage`, `legalReview.ts`): `script` → hook-story-script; `production` → production-direction; `captions` → packaging-adaptation; `claims` → the stage whose block holds the quote (`SCRIPT_CLAIMS` → hook-story-script, `PLATFORM_CLAIMS` → packaging-adaptation; in both, the earlier stage), matched exactly as the validator matches a quote (`LV1`).
3. **Eligibility and the start stage (the reviewer's required change, 2026-10-14):** the round starts at **the earliest writing stage owning a critic blocking finding or ANY legal finding, blocking or "for your decision"**, and a run is revisable when at least one of those exists. **Critic advisory findings alone still revise nothing and never move the start.** So every legal finding reaches a stage that re-runs — none is ever "not re-run" (`LV13`, a sweep of 312 plans) — and a review holding only decision items makes a run revisable from the earliest stage owning one (`LV12`). **Run `46f5bf15…`'s real shape** — critic 14 advisory, 0 blocking; L1 `copyright_reproduction` (blocking, production), L2 and L3 `manufacturer_quotation` (decision, **script**), L4 `people_and_releases` and L5 `privacy_exposure` (decision, production) — **starts at hook-story-script**, so the owner's chosen script fixes reach the script (`LV8`). The worker's free preflight refuses as `no_revisable_blocking_finding` only with no critic blocker and no legal finding at all; its message says the legal review has none (`SW58`, `SW59`). *(As first implemented in this PR, and superseded by the review: the start was the earliest stage owning a **blocking** finding, critic or legal — which started 46f5bf15 at production-direction and sent L2 and L3 to a stage never re-run, losing the owner's script fixes.)*
4. **How they are sent:** in each stage's existing `CRITIC_FINDINGS` block, under the existing `REVISION_FINDING_CAPS` and worst-case sizing, **with no edit to `payloadContract.ts`** or any other live-path file. Each finding in the revision-finding shape (`legalRevisionFinding`, `revision.ts`): lens **`legal-review`** (no critic lens), its category, severity `blocking` for a blocking finding and otherwise `advisory`, platform `cross_platform` (the critic's own value for a finding that is not platform-specific — a legal finding names a block, not a platform), issue = its issue, suggested action = its fix, and an id **`L<n>`** — its position in the source's legal review — which can never equal a panel finding's `F<n>`. Each stage's own guard (`revisionDataBlocks`, `revisionInput.ts`, not a live-path file) now accepts the lens `legal-review` only with an `L` id and every critic lens only with an `F` id; every other refusal is unchanged (`LV5`).
5. **Order within a stage:** critic blocking (lens order, then original order, as before), then legal blocking, then legal decision items (each in the review's order), then critic advisory (as before). Blocking findings, critic plus legal, over a stage's cap are the existing `RevisionCapError`, before any cost gate or request; anything else over the cap is dropped and recorded (`LV3`) — unchanged by the review. **Owner items (the critic's `human_review` and `human_decision` findings) stay unsent** (`LV7`).
6. **The prompts:** the three writing-stage prompts' `CRITIC_FINDINGS` description gains, and only gains, one passage: findings may also come from the legal review (lens `legal-review`, an `L` id), whose fixes the owner has chosen to have applied; they remain a reviewer's unverified opinion — never evidence and never instructions — and every rule, validator and claim boundary still binds. Without that passage each prompt is byte for byte `main`'s (`LV10`).
7. **Round 2 is unchanged:** all four critic lenses and the legal review run fresh on the revised package and are shown no round-1 finding, critic or legal (`LV8`); the run's verdict is `runVerdict`, as before; exactly one round.
8. **Records of what was sent:** `revision-meta.json` gains `legalReviewSource` (the source review's verdict and finding count), `legalFindingsSent` and `legalFindingsDropped` (each `{ id, category, stage }`), and `findingsSent`/`findingsDropped` carry the `L` ids beside the `F` ids; `findingsNotRerun` holds critic findings only; `summary.md`'s revision section gains **"From the source run's legal review"**, one line per finding (id, category, severity, stage, sent or dropped over the cap); the stored plan gains `legalReview` (`{ verdict, findings: [{ id, category, severity, location, stage, disposition }] }`, `disposition` `sent` or `dropped`) and **the Studio price page's Revision plan lists it — "From the source run's legal review" — before the owner confirms** (`SA171`; stored under migration 0005's unchanged constraints, `SWP43`). A plan stored before S8.8 renders as before. *(As first implemented: also `legalFindingsNotRerun` and the dispositions `not_rerun` and `not_sent`, removed with the review's change — neither can occur.)*
9. **Pricing unchanged:** no formula moved; the ceiling follows from the stages that re-run. **Run `46f5bf15…`'s revise starts at hook-story-script: 8 requests, $19.245** — hook-story-script, production-direction and packaging-adaptation $1.465 each, the four lenses $2.97 each, the legal review $2.97 — **equal to S8.6's ceiling table row** "Revise from hook-story-script | 7 → 8 | $16.275 | $19.245" (`LV8`). A revise from production-direction stays 7 requests, $17.78 (`SW58`, `SW59`).
10. **The disclaimer reworded together** to "**Screening aid, not legal advice. Read it, and resolve its blocking findings, before posting.**" in `LEGAL_REVIEW_DISCLAIMER`, `LEGAL_NOT_ADVICE`, `skills/legal-risk/SKILL.md` line 1 and its closing reminder (line 98, formerly 100), the self-test (`LR11`) and the two mutation anchors (`M741`, `M757`, re-anchored in place — same ids, edits and checks); the rubric's status paragraph (lines 10–12, beginning on line 10) is replaced by "Status: attorney review deferred by the owner (2026-10-13)." Nothing else in the rubric changed (`LV10`: without those three lines it is byte for byte `main`'s). **One literal is kept, read-only:** `LEGAL_REVIEW_DISCLAIMER_S8_6`, the old line, used only so that a review **saved before S8.8** — runs `8549e829…` and `46f5bf15…` among them — still revalidates byte for byte (`revalidateLegalReviewOutput` takes that one field from the file when it is exactly the old line). Without it an import of any S8.6 bundle would be archived `revalidation_failed` and a revise of `46f5bf15…` refused at its source review. Every new review, `summary.md` and the report show the new line; any other saved line is refused (`LV9`).
11. **S8.6's rule "legal findings are never sent to a revision" is SUPERSEDED** (2026-10-14) — a dated note in S8.6's record keeps the old text and its rationale; the same in [Status](STATUS.md) and the [Content Studio design](CONTENT_STUDIO_DESIGN.md) (§5.5, §8.4).
12. **Records (this change):** PR #127 reconciled — S8.7 **`MERGED`**, **`DEPLOYED`** and **`PRODUCTION-VALIDATED`** (OWNER-OBSERVED), its follow-ups DISCHARGED — in S8.7's record, now under *Merged repository change awaiting rollout*; the two post-MVP items moved here; the cursor.

**Migrations / schema impact:** none. The five Studio migrations are byte-identical; `revise_plan` is `jsonb` bounded at 1 MiB, and the plan's new key fits it (`SWP43`).

**Material design decisions:**

- **The legal review is read where the critic panel is, after the source is proved.** `verifySourceLegalReview` runs in `reviseRun` after `verifySourceRun`, not inside it, so the Studio import's own check of the same file (`importRun.ts` step 5, `SW53`) keeps its own refusal.
- **A present but invalid review refuses the revision**, as a tampered panel output does: its blocking findings decide what is sent, so it is never ignored silently.
- **`L<n>` ids and the lens `legal-review`, checked as a pair** by each stage's own guard: a person, a record and the model can always tell a legal finding from a critic one, and neither can pose as the other.
- **The plan carries the legal record only when the source has a review**, so a source without one plans byte for byte as before.
- **Any legal finding moves the start; critic advisory findings never do** (the reviewer's required change): a legal finding — even a decision item — is a fix the owner has chosen to have applied, so the stage that wrote its quote must re-run; a critic advisory finding stays the critic's suggestion, as before S8.8, so a source without a legal review plans exactly as before.
- **The old disclaimer is accepted only when reading a saved review**, never written or shown; the alternative broke every S8.6-era review.
- **Field fit, proved from the payload contract, not edited into it.** `LV4` proves, against the witness entry `REVISION_FINDING_CAPS` was derived from: the id (`L20`, 3 characters, as `F80`), lens (12 against 20), severity, platform (`cross_platform`, 14 against 23), issue (600 = 600) and suggested action (fix 300 = 300) each within the witness's own field. **The category is the one field longer than its slot:** `endorsement_or_testimonial` is 26 characters against the witness's 25 (`hashtag_keyword_relevance`). **It fits within its entry** — every legal entry renders at least **16 characters under** the witness entry (lens −8, platform −9, category +1) — so every stage's block at its cap, legal and critic findings mixed, stays within `criticFindingsBlockChars` and is accepted by the stage's own runtime guard, which compares the rendered block with that ceiling before any request. **This reads the brief's "every mapped field … within the worst case" at entry level for the category alone** — the reading flagged in the PR for the owner; the smallest live-path change that would make it hold field by field is the witness's category in `payloadContract.ts` set to the longest category of the critic lenses and the legal review together (one more character per entry), which was not made.

**Material rejected alternatives:** a fifth critic lens or a new block (live-path edits to `payloadContract.ts`); starting the round at the earliest stage owning a **blocking** finding only (this PR's first rule — rejected by the review: a legal decision item in an earlier stage would never reach a stage that re-runs, as run `46f5bf15…`'s script decisions would not); letting critic advisory findings move the start too (it would change every source without a legal review, which must plan as before); `F<n>` ids continuing the panel's numbering (`F81`–`F100` would exceed the widest id the block was sized for, and would read as panel positions); shortening or renaming a legal category to fit the witness (the owner asked for "its category"); reading the legal review inside `verifySourceRun` (it would change the import's refusal); ignoring an invalid source review (it would silently drop blocking findings); rewording the stored disclaimer of saved reviews (it would change saved files byte for byte); sending round 2's legal review anywhere (forbidden); a second round (forbidden).

**Automated validation** *(LOCAL: this container, Node 22.22.0, PostgreSQL 16.15)* — in full in the PR and in [Testing](TESTING.md): the build and typecheck; **`test:offline` 2,136 → 2,152** (content intelligence 1,348 → 1,361, `LV1`–`LV13`; Studio worker 71 → 73, `SW58`, `SW59`; Studio web 191 → 192, `SA171`; every other suite unchanged); **the Studio PostgreSQL suites on 16: 395 / 49 / 43 → 395 / 50 / 43** (`SWP43`); **the mutation harness 787 → 820 over 74 captured paths (unchanged)** — a new group, *Content Studio S8.8*, `M788`–`M820`, and `M741`/`M757` re-anchored in place; after the review's change `M788`, `M789` and `M813` were re-anchored in place (the start rule's and the refusal's new lines) and `M818`–`M820` added for the new start rule; locally, the six changed or new mutations (`M788`, `M789`, `M813`, `M818`–`M820`) were run through the harness itself on a filtered copy (4 workers): **each was reported by all its named checks**, every restore byte-for-byte, every compiled restore's incremental rebuild byte-identical to a clean build (`M-inc-restore`, 6 of 6), its tail again stopping at the filtered copy's `M-inc-sample` defect; locally the first 30 were run through the harness itself on a filtered copy (4 workers): **every one was reported by all its named checks**, each restore byte-for-byte, and every compiled restore's incremental rebuild byte-identical to a clean build (`M-inc-restore`, 26 of 26); `M797` was first written as an edit that did not compile (a mutation no check could report) and was rewritten to the parameter's default, then reported by `LV6`; the filtered copy's tail stopped at `M-inc-sample`, whose global sample names ids a filtered run does not hold (a defect of the filtered copy only, as recorded for S8.7) — **the PR's CI run, all ten shards, is the full mutation evidence**; the simulated dry run ("DRY RUN OK"); the deployment-controller fixtures; `check:mutation-shards` (15 injected faults refused); `npm audit --omit=dev` (0 vulnerabilities); AgentShield 1.4.0 (**B/86**, unchanged: 20 findings, 10 medium and 10 low, none critical or high); `check:markdown-links` (68 files); every in-repository anchor in `docs/` and `README.md` resolved against GitHub's heading slugs (328 links, 0 broken; 311 and 0 on `36d2996`); `check:env-coverage` (45 variables); `scan:sensitive` (259 files) and a credential and PII search of the added lines with manual triage (only GitHub pull-request links, the records' existing style); `git diff --check`; the sha256 of `render.yaml`, `render.studio.yaml`, `.DS_Store`, the 49 live-path manifest files and the five Studio migrations (56 files and `.DS_Store`) identical to preflight. **Existing tests changed, each recorded:** `cvSourceCli` (CV11–CV22's source helper), SW23/SW23a's and SWP34's sources now hold no legal review — their assertions unedited, they now prove the no-review path; `CV18`'s source-order needle re-anchored from `rt.revision.planRevision(criticOutput)` to `rt.revision.planRevision(criticOutput, ` (the same order assertion); `LR11` checks the new line. **A fake-runner revise of a fixture shaped like run `46f5bf15…`** is in the PR. **CI on the final head:** recorded in the PR (fifteen jobs).

**Production evidence:** none; not deployed.

**Rollback / recovery:** revert the commit. No migration, schema or data to restore. A plan stored by S8.8 (with `legalReview`) still renders on the older web (it reads the plan field by field and ignores the key); revision runs made under S8.8 stay readable.

**Security and privacy implications:** the source's legal findings — model prose, already shown to the owner on the report — now reach stages 3–5 as untrusted data inside the existing `CRITIC_FINDINGS` frame, under the same size guard, with the prompts saying they are never evidence or instructions and every claim boundary still binding. Owner items still never reach a model. The legal review itself, its prompt, its rubric's rules and its blocking categories are unchanged; its output never authorizes posting. No new route, write path, secret, header or role; the price page escapes every stored field (`SA171`).

**Accepted limitations:**

- **The category field is one character longer than the witness's category slot** for `endorsement_or_testimonial`; it fits within its entry and its block (above).
- **The fixes the owner chose are sent as the legal review's own fix text;** the owner's hand-written decisions (as recorded for `46f5bf15…`) are not an input — the Studio has no field for them.
- **Run `46f5bf15…`'s finding locations are the reviewer's record of 2026-10-14** (L1, L4, L5 production; L2, L3 script); the run's bundle is not in this repository, so the fixture reproduces that shape rather than the run's text. *(As first implemented this bullet read: "Run `46f5bf15…`'s blocking finding is taken to be in the shot list (location `production`, so production-direction) as the owner's routing states … If its location is another, the revise starts at that stage instead" — the review supplied the real shape, which starts at hook-story-script.)*
- **A revision reads the source run's legal review, not the owner's later decisions about it;** a revised package is reviewed afresh, and the per-run posting rule still applies to it.

**Unresolved follow-ups:**

- **This PR's merge SHA** (mutable-identifier exception), **its `main` CI run** (fifteen jobs, each `success` on attempt 1) and **the `deploy-production` run for its merge** (*Refuse while production automation is disabled*, release job skipped) — **a BLOCKING follow-up for the next records change**, verified by the reviewer after the merge. *(DISCHARGED 2026-10-16 by the S8.8 records change, REVIEWER-VERIFIED: `1f19e7b…`; `main` CI runs 300 and 301, fifteen jobs each, all `success` on attempt 1; `deploy-production` runs 93 and 94, each refused at the disabled gate with its release job skipped — two of each because CI ran twice; above.)*
- **The S8.8 redeploy — an owner action under the owner's own authorization:** after S8.8 merges, the owner redeploys **BOTH** Studio services at its merge commit, **web first** — **no migration** (the expected Studio schema stays `0005_studio_legal_review.sql`); the worker claims only jobs of its own commit — [Operations](OPERATIONS.md#content-studio-release-checklist--owner-actions-each-separately-authorized) step 6. Until then production runs `36d2996`. *(PERFORMED 2026-10-16 at `1f19e7b`, web first, no migration — REVIEWER-VERIFIED through Render's API; the owner's authorization line was not supplied to the recording session, UNCONFIRMED — above, and [Status](STATUS.md#content-studio-on-render--the-s88-deploy-2026-10-16).)*
- **Then a revise of run `46f5bf15…`, priced first,** under the owner's own authorization: its price page should show the round starting at **hook-story-script** and list, under "From the source run's legal review", L2 and L3 (`manufacturer_quotation`, hook-story-script, sent) and L1, L4 and L5 (production-direction, sent) before the owner confirms; the quote is 8 requests, **$19.245**. *(2026-10-16: **not yet reported** — still the cursor's next item; S8.8 is not `PRODUCTION-VALIDATED` until it is.)*
- The rest of the post-MVP list, unchanged (*Planned — Content Studio* below).

**Documents updated:** this file (this record; S8.7's record moved to *Merged repository change awaiting rollout* and reconciled; the cursor; the state list; the planned list and the two post-MVP items moved here; S8.6's record and line, and the O6 records change's discrepancy, each with a dated note); [Status](STATUS.md); [Content Studio design](CONTENT_STUDIO_DESIGN.md) (§5.5, §8.2, §8.4); [Operations](OPERATIONS.md) (step 6's S8.7 deploy recorded and the S8.8 redeploy; step 7's disclaimer); [Security and continuity](SECURITY_AND_CONTINUITY.md); [Testing](TESTING.md); [README](../README.md); [Architecture](ARCHITECTURE.md) (a dated note on the revision pass).

**Checked and deliberately left unchanged:** [`AGENTS.md`](../AGENTS.md) and [`CONTRIBUTING.md`](../CONTRIBUTING.md) (still twelve suites); [Environment](ENVIRONMENT.md) and `.env.example` (no variable); [Deployment control](DEPLOYMENT.md) (no deploy rule changed); [Data model](DATA_MODEL.md) (no table or column changed); `agents/legal-review.md` and the critic prompts (out of scope); every historical record in this file except the dated notes named above.

*The records that followed S8.8 under this heading — Content Studio S8.7 back to the CTO-attested approved-facts expansion, 43 blocks, newest first — are relocated, unaltered, to the [completed-phase ledger](COMPLETED_ROADMAP_PHASES.md#records-relocated-from-merged-repository-change-awaiting-rollout). Wherever this file says a record is "under *Merged repository change awaiting rollout*", "above", "below" or "at the top of this file" and that record is not here, it is in the ledger; its [contents table](COMPLETED_ROADMAP_PHASES.md#contents) lists every relocated block.*

## Completed history — relocated to the completed-phase ledger

**Completed-phase records live in [Completed roadmap phases](COMPLETED_ROADMAP_PHASES.md)** (`docs/COMPLETED_ROADMAP_PHASES.md`) from the roadmap split of 2026-10-16. They were moved there byte-for-byte unaltered from this file at `2cd98e163ac2296ad3d08d09af2286d35e2a0c6e`, because completed history had grown to about 1.15 MB of this file's 1.38 MB and the file could no longer be reread whole. The ledger is historical only; this file keeps the current cursor, unfinished and planned work, the state vocabulary and the active open items. Relocated, in their source order:

- the superseded cursors of *Next steps* (two fragments);
- the records under *Merged repository change awaiting rollout* after S8.8 — Content Studio S8.7 back to the CTO-attested approved-facts expansion;
- *Completed / durable history* — Phase 0A, Phase 0D, PR #35, PR #36 and Phase 0B.0 — and the resolved production incident (media publication normalization);
- the eight `MERGED` records from the legacy agent model migration to the critic on Claude Opus 5.5;
- PR #57 (CC5), CC5 whole-file SQL-authority hardening (PR #63) and the M1 readiness evidence package (PR #60);
- M1→M2 interval monitoring — the daily read-only drift check;
- the Phase 0B prerequisite (fact and evidence contract), Phases 0B.1–0B.6 and the payload-contract reconciliation (PR #54).

**A new completed-phase record is still written here first,** in the same change as the work, as [`AGENTS.md`](../AGENTS.md) requires. The split of 2026-10-16 kept the two most recent records here because both still carried the cursor or a live follow-up, and kept the superseded interval records with the live M1→M2 section they explain (*What stayed, and why*, in that change's record at the top of this file); that describes the split's own choices, not a standing rule — `AGENTS.md` sets the condition for introducing the ledger, not a criterion for relocating a later record.

## Current cursor — Phase 0D.1

Phase 0D.1 is the deployment-authority cutover. It is **paused, deliberately, between authorities**, and PR #36 changed what the next safe step is.

The ownership bootstrap is **complete** (operator-reported 2026-08-27): the protected worker is live and its handoff behaviour was proven under real zero-downtime overlap. That unblocks the remaining cutover steps, which were always gated behind it.

**This is an operational follow-up and is not a blocker to Phase 0B product work.** Phase 0B.0 shipped without touching deployment authority, and later Phase 0B slices can do the same. The remaining proof is worth doing on its own schedule, not ahead of the product.

Each step below requires its own explicit authorization. None of them is authorized by this document.

1. **PR #36 merged with exact-head CI green — COMPLETE.**
2. **Read-only production reverification — COMPLETE** (operator, 2026-08-27). Confirm current `main`, all three live SHAs, all three Render native auto-deploy settings off, the GitHub gate `false`, the GitHub `production` environment configuration, and no deployment or migration in flight. Stop on any discrepancy.
3. **Reconcile the August 10 incident against provider account history — COMPLETE.** Checked on Instagram, Facebook, and GBP; the target post was not found on any destination. Check Instagram, Facebook, and Google Business Profile directly for the 2026-08-11 Mini Cooper check-engine content before any production row is mutated. Public search was inconclusive and is not sufficient evidence.
4. **Stale `running` row resolved — COMPLETE**, by startup recovery with `providerMutation = impossible`. Original wording: (`c5e53afe-2657-4e11-811d-53ce5e793245`), so the reconciler's first firing is not performing an unexplained production mutation as a side effect of a deployment.
5. **Manual bootstrap release — COMPLETE.** Original wording:, with native auto-deploy still off and `RENDER_DEPLOY_AUTOMATION_ENABLED` still `false`. Preflight requires zero `running` briefs and **zero pending approvals** — approvals created before this change carry no `brief:approval_requested` marker, so the startup orphan sweep would revoke them on first boot. Draining them first makes that sweep a no-op rather than a surprise.
6. **Bootstrap verified at its exact SHA — COMPLETE.** Original wording: API deployed and exact health identity confirmed; worker ownership acquisition, reconciliation, and readiness observed; scheduler artifact confirmed; all three services reporting the bootstrap SHA.
7. **Worker handoff and contention proof — COMPLETE**, new instance waited ~58s for ownership before readiness. Original wording: performed once both the old and new worker versions contain ownership code: observe the new instance waiting, the old instance shutting down, ownership transferring only afterwards, and readiness appearing only after that.
8. **Now eligible, not yet done:** enabling `RENDER_DEPLOY_AUTOMATION_ENABLED`. Requires its own authorization and immediate re-verification.
9. **Then prove the GitHub controller path** — the already-current/no-deploy route first if possible, then one harmless migration-free real release. Note that migration 006 makes the next Phase 0B release migration-bearing, so it must go through the separately authorized migration rollout rather than the ordinary controller path.

Never re-enable Render native auto-deploy while the GitHub gate is true. Do not combine this cutover with database networking work or with Phase 0B. `IMPLEMENTED`, `MERGED`, `CONFIGURED`, `ENABLED`, `DEPLOYED`, and `PRODUCTION-VALIDATED` remain distinct milestones throughout.

## Next hardening

Keep these changes separable unless a reviewed design shows they must be atomic.

1. **Durable provider operation ledger and idempotency.** Model at least `not_attempted`, `attempted`, `provider_accepted`, `result_unknown`, `published`, `reconciled`, and `failed_safely`. This is the highest-priority remaining item: PR #36's durable phase markers are deliberately its precursor, but they make an ambiguous provider outcome *visible*, not *impossible*. Provider-level `withRetry` can still reissue a request after an ambiguous network outcome, so duplicate publication remains possible.
2. **Provider reconciliation.** Reconcile internal intent and result records with provider-side post identities, and safely resolve unknown outcomes before another attempt is permitted.
3. **PostgreSQL network restriction.** Remove the `0.0.0.0/0` external allowlist — still in place, independently reverified 2026-08-28 — after confirming every required access path. Do not combine with the deployment cutover.
4. **Provider-token lifecycle.** Encrypt or relocate the plaintext default Instagram token and session state, define rotation/expiry/recovery, and review log and outcome redaction.
5. **Control and approval identity.** Replace the shared `CONSOLE_TOKEN`, process-local direct-socket limits, generic reviewer label, and the bearer token in browser/Slack URL history with scoped authenticated identities and a safer review/revocation flow.
6. **Retention, backup, and restore.** Set retention for briefs, approvals, events, sessions, scorecards, proposals, and media; design the reviewed forward migration needed for media deletion; verify backup policy and conduct an isolated restore drill with external-side-effect reconciliation.
7. **External readiness register.** Verify provider account ownership, scopes, app review, versions, quotas, billing, test assets, recovery contacts, and the accuracy and freshness of approved business facts.

The former worker lease/reaper item is `SUPERSEDED` and is no longer active work. Its rationale and re-entry condition are preserved in the PR #36 record, now in the [completed-phase ledger](COMPLETED_ROADMAP_PHASES.md#pr-36--worker-ownership-and-interrupted-brief-recovery).

*(The eight `MERGED` records that followed here — the legacy agent model migration through the critic on Claude Opus 5.5 — are relocated, unaltered, to the [ledger](COMPLETED_ROADMAP_PHASES.md#legacy-agent-model-migration--current-generation-ids-and-explicit-thinking--merged).)*

## Decided — stage 1 `maxIds` stays 12 — `DECIDED`

**Dated addition, 2026-09-25: stage 2's `maxAllowedClaims` is raised to 16 by the owner; `maxIds` stays 12.** After the run of 2026-09-25, in which stage 2's twelve-claim whitelist squeezed out the makes, the oil specification and the records, the owner raised stage 2's cap only — stage 1's `maxIds` and stage 3's `maxClaimUses` stay 12 — and had the identity records attached by code (*Evidence-pack scoping in the local CLI …*, at the top of this file). That supersedes the half of the rejected alternative below that concerned `maxAllowedClaims`; the rest of this decision stands.

**Decided 2026-09-23 by the owner: keep `STRATEGY_LIMITS.maxIds` at 12.** This closes the item
previously recorded here as *Open — decide stage 1 `maxIds` (12) after the next complete run*,
whose text is preserved below.

**Evidence.**

- **Run 1:** stage 1 used 12 of 12; the call-to-action facts went uncited; 5 of stage 2's 12 allowed
  facts went unused downstream.
- **Run 2 (`2026-09-23T17-07-15-470Z`):** stage 1 used 12 of 12; stage 2 permitted 12 of 12, and said
  it "dropped … only for the ceiling"; stage 3 used 10 of the 12; stage 5 used 22 of its 24
  claim-use bindings.
- **Raising stage 1 or stage 2 only moves the bottleneck.** Stage 3 already used fewer than it was
  permitted, and stage 5 sat near its own ceiling; a wider stage 1 would hand downstream stages more
  than they spend.
- **The missing call to action is fixed structurally**, by the deterministic contact line (`MERGED`
  through PR #88; its record is under *Merged repository change awaiting rollout* above): contact
  details no longer compete for citation slots.

**Rejected alternative: raising `maxIds` and `maxAllowedClaims` to 16.** The code treats widening
an id channel as an authority change, not slack — `maxIds` sizes what later stages may cite — and the
measurements above show the extra room would not be used where the defect was; the defect was the
contact facts competing for slots at all.

*Preserved as written before the decision:* On 2026-09-23 `supportingFactIds` was 12 of 12. The
facts the close needed — `approved-facts:perks`, `approved-facts:phone`, `approved-facts:bookingurl`
— went uncited, and 5 of stage 2's 12 allowed facts went unused downstream. The code treats widening
an id channel as an **authority change, not slack** (see the output-field classification record):
`maxIds` sizes what later stages may cite. Decide after the next complete run, on its measurements,
not before.

## Open — the evidence pack is at its 64-record cap — `OPEN`

**Observed 2026-09-23:** the operator's evidence pack held **64 records — 37 local automotive facts
and 27 approved facts — exactly `EVIDENCE_LIMITS.maxProjectedRecords` (64).** `buildEvidencePack`
refuses a pack of more than 64 records, and the local CLI passes no subject or tag scope, so it
projects every record it loads. **The next fact added to either file will be refused** until the
CLI scopes the pack to the brief or the cap changes. Which of those to do — and, for a cap change,
its derivation review, since the cap sizes the `EVIDENCE` block and the stage 1 and 2 payloads — is
**open, and not decided here.**

*Dated addition, 2026-09-25:* the CLI can now scope the pack (`--scope-tags`, with the contact-line
and identity records always included, and `--list-tags` to see what each tag would bring in); see
*Evidence-pack scoping in the local CLI …* at the top of this file. The cap is unchanged at 64, and
an unscoped run still projects every loaded record, so this item stays open until the owner chooses
scopes — or a cap change — for the facts files as they grow.

*Dated addition, 2026-09-26:* Lane S raises approved facts from 27 to 30. With the owner's 37 local
automotive facts, an unscoped run now projects 67 and is intentionally refused before any paid
call. Local runs therefore need `--scope-tags` including `approved-facts` and at least one relevant
automotive tag; the cap remains unchanged. A fake-runner run scoped to `approved-facts,lane-s-auto`
built 31 records and completed all six stages.

*Dated addition, 2026-09-26 (stage 5 `claimUse` cap change):* the owner's scoped dry pass
`2026-09-26T14-27-21-098Z` built a 44-record pack under its recorded `--scope-tags`, and the live
run that followed reached stage 5, where the separate `claimUse` defect refused it (see the record
at the top of this file). Scoping is working as intended; the cap remains 64 and this item stays
open for the same reason as before.

## Model lineage — Claude Opus 5 is now legacy

Claude Opus 5.5 succeeds Claude Opus 5 in the Opus line. Opus 5 remains served and still backs
`reasoning-heavy` (stages 1 and 2), unchanged; the legacy path's pins are unchanged. New Opus-tier
work should name Opus 5.5 explicitly.

*(The records that followed here — PR #57 (CC5), CC5 whole-file SQL-authority hardening (PR #63) and the M1 readiness evidence package (PR #60) — are relocated, unaltered, to the [ledger](COMPLETED_ROADMAP_PHASES.md#pr-57--cc5-proposition-bound-reconciliation-and-bounded-closeout--merged).)*

## Active product cursor — M1 complete and independently verified; M2 not authorized

**M1 is complete and has been independently verified against live provider state (2026-09-18).**
The prior verdict recorded immediately below in this section — `M1 BLOCKED / NO-GO` — was accurate
at the time it was written, when no read-only production access existed. That access was
subsequently obtained and the milestone was performed. **M1 did not authorize and did not begin
M2.** Nothing below grants authority for migration `008`, executor enablement, or any other M2
step; **P1–P8, migration `008`, production wiring, executor enablement, and the proposed Google
Business Profile expansion remain not begun and not authorized.**

**Tier 1 — verified directly against live GitHub/Render/Postgres state.**

- API service `gcd-social-api` (`srv-d8u0qtpo3t8c73c5o44g`) is live at exact artifact `A` =
  `d5015236672a02bf8f58d342625c32a4f5acc8a1`, via deploy `dep-dam3dfv40ujc73fgidhg`
  (status `live`, `trigger: "manual"`, started `2026-09-17T18:51:43.364952Z`, finished
  `2026-09-17T18:52:47.893627Z`). The previously live deploy at exact artifact `R` =
  `44d7336f2c75ff880cff0d8205d2fafe13eb91b5`, `dep-da8sbq0n74is73e0hgcg`, was deactivated at
  `2026-09-17T18:52:47.892086Z`.
- **Migration 007 is production `APPLIED`.** `_migrations` records `007_evidence_bounds.sql` with
  `applied_at 2026-09-17T18:52:22.268131Z` — inside the deploy window, consistent with the API's
  `preDeployCommand: npm run migrate`. The applied set is exactly `001`–`007`, each appearing
  exactly once; no migration `008` exists. No database rollback occurred, and deploy history shows
  no redeploy of `R` after `A`.
- Worker `gcd-social-worker` (`srv-d8u0qtpo3t8c73c5o440`) and scheduler `gcd-social-scheduler`
  (`crn-d8ulb4rtqb8s73bdjctg`) remain live at exact artifact `R`, via `dep-da8sjmp42hec73dvhk30` and
  `dep-da8siupsrm7s73afv6u0` respectively; no deploy on either since 2026-08-28. **This was
  deliberate: M1 deployed the API only**, so migration 007 applied while worker and scheduler stayed
  at `R`.
- All three services report `autoDeploy: "no"` / `autoDeployTrigger: "off"` — native Render
  auto-deploy is disabled. The API's `preDeployCommand` is exactly `npm run migrate`.
- CI run `35235152957` (attempt 1, `head_sha` = `A`) passed all five required jobs, completing
  `2026-09-17T14:50:12Z`.
- **The M1 deploy was not produced by GitHub deployment automation.** The service's own deploy
  history distinguishes `new_commit` (auto-deploy), `api` (Render API call), and `manual`
  (dashboard); the M1 deploy record is `manual`.
- The scheduler's cron continues to run on its normal daily schedule (`0 13 * * *`), most recently
  `2026-09-18T13:01:23Z`. **Correction:** this is expected behavior at `R` with all six executors
  disabled; any statement elsewhere asserting no scheduler runs occur is wrong and has been
  corrected wherever found in this sweep.

**Tier 2 — established by the prior independent inspection, not re-verified here.** All 11
migration-007 constraints validated; all 23 canonical aggregate checks within bounds; all six
executors remain disabled and unreachable; no provider call, approval, or publication occurred.

**Tier 3 — open limitations, recorded rather than resolved.**

- Render exposes no field recording whether the operator selected an immutable specific commit or
  "latest commit" when triggering the manual deploy. This is permanently unanswerable from provider
  evidence. It has no effect on the deployed artifact: the deploy record immutably names commit `A`,
  and **as a dated snapshot at the 2026-09-17 deploy** `main` was at `A` with no commit after it, so
  either selection resolved to `A`. **`main` has since advanced well beyond `A`** — the exact
  current `main` and the exact distance are a Git/GitHub lookup, not fields this file maintains: run
  `git rev-parse origin/main` and `git rev-list --count <A>..origin/main`; see [Status](STATUS.md)
  for the current record. That advance carries documentation and **dormant, undeployed**
  `src/harness/` stage-executor source; it is not documentation alone. It still cannot reach the
  service: auto-deploy is off on all three services, so the deployed artifact cannot drift from `A`
  without a new authorized deploy. The Tier 3 limitation itself is unchanged — which selection the
  operator made is still unanswerable, and still immaterial.
- Render exposes no deploy-level actor-identity field. Who performed the deploy cannot be
  established from provider evidence.
- The repository-scoped GitHub Actions variable `RENDER_DEPLOY_AUTOMATION_ENABLED` was read in the
  authenticated GitHub UI on 2026-09-18 as exact lowercase `false`. Its last-updated timestamp
  predates M1 (2026-09-17), so the variable was not changed by or during M1. This document does
  not claim GitHub deployment automation is currently disabled as a system; the evidenced claims
  are the gate variable's value and the narrower Tier 1 one above, that the M1 deploy specifically
  was not produced by automation.

**The authorized recovery path is unchanged should it ever be needed: redeploy exact `R` to the API
only, leaving migration 007 applied.**

### M1→M2 interval — owner, bound, and monitoring (recorded 2026-09-18)

[PRODUCTION_WIRING_DESIGN.md's M1 exit conditions](PRODUCTION_WIRING_DESIGN.md) state that for the
whole M1→M2 interval, the interval must be **explicitly time-bounded**, actively **monitored**, and
**owned by the named operator** who performed M1. None of those three had been recorded until now.
This section records them; it does not begin, schedule, or imply M2, and it does not authorize
P1–P8, migration `008`, or executor enablement.

**Owner.** Michael Capote, CTO, Alan Gelfand Inc. DBA German Car Depot, attests accountability for
this interval as the operator who performed M1. This is recorded as the operator's own attestation
of accountability, made to satisfy the design's named-owner requirement. **It does not make the M1
deploy attributable in provider logs.** Render exposes no deploy-level actor-identity field (Tier 3,
above), so provider evidence does not and cannot independently establish who performed the M1
deploy; the attestation and that evidentiary gap are separate facts, and this attestation does not
close it.

#### M1→M2 interval — the §3.6 Blueprint gate and the Studio's owner actions (recorded 2026-10-12)

Recorded by the Content Studio O3/O1/O4 record (documentation only); it changes no term of the interval. Under the narrowing below, the owner performed the §3.6 Blueprint gate, O3, O1 and O4 without the key on 2026-10-12. The gate's screenshot (OWNER-OBSERVED) showed `gcd-social-api` live at `d501523` (artifact `A`) with Auto-Deploy Off, and GCD Social's Production environment holding exactly the four `gcd-social-*` resources. The worker's and scheduler's exact deploy commits and the full verification pass remain owed before the bound. The full entry is in [Status](STATUS.md#m1m2-interval--the-36-blueprint-gate-and-the-studios-owner-actions-recorded-2026-10-12).

#### M1→M2 interval — owner decision narrowing the release freeze (recorded 2026-10-10)

Decided by: Michael Capote, the named owner of this interval. The standing prohibition recorded with the 2026-09-22 re-authorization below — "no unrelated release may occur, of any service, for any reason" — is **narrowed** so that it no longer covers the Content Studio's own new resources: `gcd-studio-web`, `gcd-studio-worker` and `gcd-studio-db`, created from `render.studio.yaml` in their own Render project. Every `gcd-social-*` service and `gcd-social-db` stays frozen exactly as before; the bound, the owner, the recovery path and the monitoring are unchanged, and the decision at the bound remains the owner's. The full entry — terms, conditions, the owner's reason and the live-services check of 2026-10-10 — is in [Status](STATUS.md#m1m2-interval--owner-decision-narrowing-the-release-freeze-live-services-check-recorded-2026-10-10) and in Content Studio S8.3's record at the top of this file. The 2026-09-22 text below is kept as written.

#### M1→M2 interval — re-authorization (recorded 2026-09-22)

Authorized by: Michael Capote, CTO, Alan Gelfand Inc. DBA German Car Depot — the named operator who performed M1 and the owner of record for this interval.

Action taken: outcome (b), explicit re-authorization of the partial-release interval under a new bound, decided on 2026-09-22, two days before the `2026-09-24T18:52Z` decision point rather than at it. M2 was not performed and is not declared complete. The worker and scheduler remain at exact artifact `R` = `44d7336f2c75ff880cff0d8205d2fafe13eb91b5`; the API remains at exact artifact `A` = `d5015236672a02bf8f58d342625c32a4f5acc8a1`. The recovery path was not taken.

New bound: `2026-10-22T18:52Z`. This supersedes the `2026-09-24T18:52Z` bound and nothing else. Every other term of the interval remains in force unchanged.

Stated reason. The partial-release state has been verified twice: a read-only human pass on `2026-09-21T15:28:38Z` covering all four required checks, and an automated six-check pass on `2026-09-22T17:08:36Z`. Both found the state unchanged. M2 is a controlled reconciliation requiring its own preflight, gates and post-deployment verification, and is not work that should be compressed to meet a calendar date. Extending the bound is therefore preferred to performing M2 under time pressure, or to performing a production deploy on a demonstrably healthy system in order to take the recovery path.

Monitoring — the condition is now met, for the first time since M1. The prior interval's monitoring requirement went unmet: no daily check was ever established and none ran on any day. That is not retroactively fixable and is not claimed to be. For this interval:

* A daily read-only check runs as the `Interval monitor` GitHub Actions workflow (.github/workflows/interval-monitor.yml, merged in PR #83 at `b8f12f3`), scheduled `0 14 * * *`. It outlives any session and keeps a durable, inspectable run history — the two properties the previous attempt lacked.
* It performs six checks: the API's live artifact and health via `/healthz`; the applied migration set; scheduler liveness via `brief_queue`; the deployment-automation gate variable; the `deploy-production` refusal history; and interval context. A check that cannot be performed reports `NOT CHECKED` and fails the run; it never reports a pass on incomplete evidence.
* That behaviour was demonstrated rather than assumed. Run #1 on `2026-09-22T16:52:36Z` failed because the database credential was wrong, reporting two checks as `NOT CHECKED` and refusing an all-clear. Run #2 on `2026-09-22T17:08:36Z` returned ALL CLEAR: API live at exact `A` and healthy; `_migrations` holding exactly `001`–`007` with no `008`; newest `brief_queue` row `2026-09-22T13:00:52.389Z`, 4.1 hours before database `now()`; `RENDER_DEPLOY_AUTOMATION_ENABLED` exactly `false`; and no `deploy-production` run concluding `success` across 48 runs inspected.
* Two things the automated check does not cover, stated plainly rather than implied: the deploy identity of the worker and scheduler, and the Render native auto-deploy setting. Both require Render credentials the workflow deliberately does not hold, because the only Render API key available is account-wide with write authority and does not belong in an unattended job. Both remain covered by human verification passes.
* Two full read-only verification passes with Render and PostgreSQL access are scheduled: one at approximately `2026-10-08`, and one before the `2026-10-22T18:52Z` decision point. The expiry decision requires the second, exactly as the prior interval's did.
* The compensating controls remain in force and are not a substitute for monitoring: Render native auto-deploy is `no`/`off` on all three services, and the `deploy-production` workflow has refused at its "Refuse while production automation is disabled" step on every `main` merge since the interval began.

Standing prohibitions, unchanged and in force for the whole extended interval: ordinary automated deployment is prohibited and the controller must not be forced past it; no unrelated release may occur, of any service, for any reason; the interval remains explicitly time-bounded, owned as recorded above, and monitored as scoped above.

This re-authorization authorizes nothing else. It does not begin, schedule or imply M2. It does not authorize P1–P8, migration `008`, production wiring, executor enablement, or the Google Business Profile expansion. It does not authorize the recovery path. Each requires its own explicit authorization. The recovery path remains available and unchanged: redeploy the API to exact `R`, leaving migration 007 applied.

Open follow-ups recorded with this authorization:

* The `0 14 * * *` scheduled trigger has never fired. Only `workflow_dispatch` is proven. Confirm the first scheduled run lands on 2026-09-23; a scheduled workflow that silently never runs is the failure mode that ended the previous attempt.
* docs/STATUS.md line 126 still states that `main` "remains at `A` with zero commits after." That is false — `main` has advanced well beyond `A` — and it is corrected by this change.
* The monitor connects with `sslmode=require`, which the current `pg` driver treats as `verify-full` and which will adopt weaker libpq semantics in `pg` v9. Pin the intended mode explicitly before that upgrade.

#### Interval record as first set (recorded 2026-09-18) — bound superseded above

**Interval bound.**
- Start: `2026-09-17T18:52:47.893627Z` — the finish time of the M1 API deploy
  `dep-dam3dfv40ujc73fgidhg`.
- Expiry: `2026-09-24T18:52Z` — **superseded** by the 2026-09-22 re-authorization above, which
  set the new bound `2026-10-22T18:52Z` under outcome (b). Preserved as history.

Expiry is a decision point, not a cliff. On or before expiry, exactly one of the following three
outcomes must occur, and **none of them is automatic**:

  (a) M2 is complete; or
  (b) the interval is explicitly re-authorized by the named owner, with a new stated bound and a
      stated reason; or
  (c) the recovery path (below) is taken.

Each of (a), (b), and (c) requires its own explicit authorization from the owner. **Reaching the
expiry date does not, by itself, authorize M2, and does not, by itself, authorize the recovery
path — it obliges a decision, nothing more.**

**Recovery path.** Exact-`R` post-007 compatibility was established in the 2026-09-16
rollback-compatibility review, so the available recovery path is to redeploy the API to exact
artifact `R` = `44d7336f2c75ff880cff0d8205d2fafe13eb91b5`, returning all three services to
agreement. **This does not unapply migration 007** — the database stays ahead of the code until
007's rollback file (`state/rollback/007_evidence_bounds_rollback.sql`) is separately authorized
and applied.

**Monitoring — prior interval, to the superseded `2026-09-24T18:52Z` bound; preserved as history.** For the extended interval, the monitoring condition is recorded as met in the re-authorization above. The M1 exit conditions require this interval be actively monitored. **That condition is unmet.** No daily automated check was ever established, and none has run on any day of the interval. A Routine was created self-bound to the originating session, fired once as a test whose result was never seen, and does not exist now — a current listing of this account's Routines, including completed ones, returns zero.

In its place, two preventive controls have held, with evidence:

  - Render native auto-deploy off on all three services (`gcd-social-api`, `gcd-social-worker`, `gcd-social-scheduler`) and `RENDER_DEPLOY_AUTOMATION_ENABLED` exactly `false`, both as of the 2026-09-18 verification — a dated observation, not current truth.
  - The `deploy-production` workflow has refused at its "Refuse while production automation is disabled" step on every `main` merge since the interval began: eight runs, run `35368071350` (run #33, 2026-09-18T16:22Z) through run `35448454979` (run #40, 2026-09-19T14:21Z), each failing at exactly that step.

These are compensating controls, not the promised monitoring, and neither one checks the migration set or the API's live artifact/health on any cadence. **An implementation of the promised daily check now exists and is `IMPLEMENTED` — see [the interval monitor record](COMPLETED_ROADMAP_PHASES.md#m1m2-interval-monitoring--daily-read-only-drift-check--merged) below. It does not by itself close this condition:** it is not merged, and it has never fired. A green pull request proves the monitor's logic and its agreement with this record; it does not prove that GitHub schedules the workflow, that the `monitoring` environment resolves its secret, or that the read-only role can read what it is granted. The condition stays **unmet** until a real firing is observed. **Update 2026-09-22:** the monitor has since merged through PR #83 (`b8f12f3`) and fired twice by `workflow_dispatch` on `main`; the re-authorization above records the monitoring condition as met for the extended interval, as scoped there, and records that its `0 14 * * *` scheduled trigger has not yet fired. A single read-only verification of the four checks below is scheduled before the 2026-09-24T18:52Z decision point, and the expiry decision requires it. The re-authorization above records that verification as a read-only human pass on `2026-09-21T15:28:38Z` covering all four checks. The four checks that verification must cover:

  1. no new deploy on `gcd-social-api`, `gcd-social-worker`, or `gcd-social-scheduler`;
  2. the applied migration set is still exactly `001`–`007`, with no `008`;
  3. the API is still live at exact artifact `A` = `d5015236672a02bf8f58d342625c32a4f5acc8a1` and
     reporting healthy;
  4. the scheduler cron is still completing successfully on its `0 13 * * *` schedule.

As of 2026-09-18, the scheduler had completed one full daily cycle after migration 007 was applied
(last success `2026-09-18T13:01:23Z`), so the split has survived at least one cycle.

**Standing prohibition, in force for the whole interval** — quoted from the design's own terms:
"ordinary automated deployment is prohibited" and the controller "must not be forced past it"; and
"no unrelated release may occur, of any service, for any reason."

**`main`/production divergence.** The deployed API artifact is exact `A` =
`d5015236672a02bf8f58d342625c32a4f5acc8a1`. `main` is ahead of `A` by commits that are not
documentation-only — they include `src/harness/` and `agents/` changes, among others — but nothing
under `src/api`, `src/worker`, `src/scheduler`, `state/migrations` or `render.yaml` has changed
since `A`, so none of the advance reaches a deployed service. The exact current `main` is a
Git/GitHub lookup, not a field this file maintains: run `git rev-parse origin/main`. **"Deploy `main`" and "deploy `A`" are not the same instruction**, and
any preflight must name which one it means. `main` must not be described as deployed.

### Prior verdict, superseded above — recorded for history

The following was the accurate verdict between PR #60's merge and the read-only production access
obtained for M1. It is preserved as the historical record of that interval and is superseded by the
verified state recorded above.

**M1 had not begun, was not authorized, and was not complete.** Merging PR #60 delivered the *evidence
package*; it did **not** complete M1 readiness and it authorized nothing. **Current verdict at that
time: `M1 BLOCKED / NO-GO`.** `L` (the commit the live api serves), the three service
commits, `D` (the production `_migrations` identifier set), `P`, comparisons 2–7 of §4.4.2, the A/L
ancestry decision, same-commit `preDeployCommand` behaviour, the §4.1 aggregate audit, and the
rollback artifact `R` with its executed compatibility evidence were all **`NOT YET EXECUTED`** —
there was no read-only production access.

The checked-in operator tooling for the two readings is delivered and exercised against a disposable
database: `scripts/ops/evidence-aggregate-audit.mjs` (§4.1, read-only, aggregate-only) and
`scripts/ops/migration-state-read.mjs` (§4.4.2, all seven comparisons).

**Successive independent inspections found four functional defects in the operator tooling, all now
corrected and all covered by regression cases.** Migration identity was compared by numeric prefix,
so an artifact whose `007` had been renamed returned `decision: pass` with all seven comparisons
`true`; every comparison now uses the complete filename. And **A1** validated only 40 hex characters,
so a Git *tree* SHA was accepted as the artifact; the object type must now be exactly `commit`. A
previous revision's claim that the scripts had **no functional defect** was false and is withdrawn.
A second inspection found two more. Filenames were **trimmed** before comparison, so an artifact whose
`007` carried a trailing space read as canonical and passed — while the runner, which selects on the
real name, would have skipped it and **never applied migration 007**; filenames are now read
NUL-delimited and compared byte for byte. And the failure path echoed a **server-chosen** SQLSTATE,
so a custom `ERRCODE` reached operator logs; both scripts now emit only fixed categories defined in
the script, and `UNKNOWN` for anything unrecognised.

*(The record that followed here — M1→M2 interval monitoring, the daily read-only drift check, `MERGED` — is relocated, unaltered, to the [ledger](COMPLETED_ROADMAP_PHASES.md#m1m2-interval-monitoring--daily-read-only-drift-check--merged).)*

## Post-MVP hardening backlog

Deferred findings are recorded durably in
[`docs/KNOWN_ISSUES_AND_HARDENING.md`](KNOWN_ISSUES_AND_HARDENING.md), which also
defines the backlog entry template, the finding categories, and the two-lane
workflow.

**This backlog is not the immediate feature cursor.** Items here do **not** block
the MVP implementer from continuing unrelated roadmap work. A finding blocks the
MVP lane only when it affects reachable production behaviour, authorization,
publication, secrets, data integrity, migration safety, rollback safety, or when
it makes a PR's stated guarantees false without those guarantees being narrowed.

**Workflow.** Items are taken by a **separate, fresh hardening implementer**
working with an **independent inspector** — not by the author of the original
finding, so the design is reconsidered rather than extended by reflex.

| ID | Title | Status | Origin | Reachability | Must-fix trigger |
|---|---|---|---|---|---|
| `CC5-SYNTAX-001` | Unrecognised English could bypass SQL-comment authority | **RESOLVED BY REPLACEMENT CONTROL — MERGED through PR #63; not production-validated** | PR #57 origin; preserved independently accepted prototype `0904c1ecbc682aa6e1b97f82051ab1deddf67419` | **Dormant, non-runtime.** Raw whole-file identity now makes every uncoordinated byte change fail, including forms the bounded grammar misses. SQL artifacts unchanged; all six executors disabled. | Future legitimate SQL changes must update artifact digest, manifest, and external pin together under review. |

**`CC5-SYNTAX-001` in brief.** The bounded `CC5` grammar still does not reject
*"Migration 007 remained unapplied."*, *"… has remained unapplied."*,
*"… stayed unapplied."*, *"… has stayed unapplied."*, or their contextual-*It*
shapes. That recogniser was not made semantically complete. The defect is
resolved by a replacement control: appending any such text changes the raw
whole-file digest and fails `CC5F` unless the artifact digest, manifest, and
external pin are updated together under review. This remains repository
authority only, and says nothing by itself about production; separately,
**migration 007 is now production `APPLIED`** — see the M1 cursor above.
Full design, evidence, limitations, and ownership are in
[Known issues and hardening](KNOWN_ISSUES_AND_HARDENING.md).

*(The records that followed here — the Phase 0B prerequisite (fact and evidence contract), Phases 0B.1–0B.6 and the payload-contract reconciliation (PR #54) — are relocated, unaltered, to the [ledger](COMPLETED_ROADMAP_PHASES.md#phase-0b-prerequisite--fact-and-evidence-contract). Where the sections below say "above" of them, they are there.)*

## Production-wiring design — `MERGED` as accepted design (PR #56), `UNIMPLEMENTED`

**State:** **`MERGED`** as **accepted repository design** — and **`UNIMPLEMENTED`**. Not a new phase
number. **Accepted means exactly one thing: [`docs/PRODUCTION_WIRING_DESIGN.md`](PRODUCTION_WIRING_DESIGN.md)
is present on `main` as this repository's accepted production-wiring design.** It does **not** mean
production wiring is implemented, and it authorizes **no** implementation PR and **no** operator
milestone. At the time of this merge, none of the eight implementation PRs (P1–P8) existed and none
of the seven operator milestones (M1–M7) had been performed. **M1 has since been performed and
independently verified — see the active product cursor above.** None of P1–P8, and none of
M2–M7, has been performed. The merge itself establishes **no**
deployment, production validation, database readiness, migration application, executor enablement,
model execution, approval, or publication. No stage's `executionEnabled` changed; all six remain
`false`, and no production path reaches any of them. **Production evidence: none.**

**PR / merge / ancestry.** PR #56, *"docs: add the production-wiring design as a reviewable
document"*. Base `e6f9b0275fc25f0c508708f5e421a474daeebbae`; reviewed head
`42f83a122910981f6af3bc9b9024d27ac8b839ff`; merge commit
`53e2c2bb6115e457670c1f99956d11a1a54530cd`, merged 2026-09-08. The merge commit's **ordered parents
are exactly the recorded base then the exact reviewed head** — first parent `e6f9b027…`, second
parent `42f83a12…` — verified by direct Git inspection. These are historical, immutable identifiers.

**Documentation-only scope, with empirical statistics.** `6 files changed, 1724 insertions(+), 19
deletions(-)` across 10 commits: `docs/PRODUCTION_WIRING_DESIGN.md` new at **1,702 lines**, plus
one-line and few-line status reconciliations in `README.md`, `docs/AI_HANDOFF.md`,
`docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and `docs/STATUS.md`. **Every changed path ends `.md`.** No
source, test, migration, workflow, dependency, lockfile, configuration, `render.yaml`, agent, skill,
or prompt file changed.

**Accepted design boundaries.** The design's own boundary statements are what was accepted, and they
are narrow: it implements nothing, enables nothing, deploys nothing, applies no migration, contacts no
provider, and publishes nothing. It grants no authorization. **Each implementation PR and each
operator milestone still requires its own review, its own explicit authorization, and its own
evidence**, and no single approval covers more than the one unit it names. Every live Render and
database fact it discusses remains **`UNKNOWN` unless separately verified** — a merged document is
repository evidence, never production evidence.

**The load-bearing finding.** `executionEnabled` is a *declarative registry field that no execution
path consults*: `invokeStage` never reads it, nor does any of the six executor modules; its only
consumer is `assertPreviewIsInert`, which keeps the preview inert. **Today's dormancy therefore rests
on two structural facts — no production caller, and no default runner — not on the flag.** An
implementer who treats the flag as the safety mechanism would build on something that is not load-bearing.

**Sequence, and the counts that define it.** **Eight implementation PRs (P1–P8)** and **seven
operator milestones (M1–M7)** — different kinds of thing, numbered separately: a PR is reviewed and
merged, a milestone is performed by an authorized operator and produces an evidence record, not a
diff. **Every source change is a numbered PR, including the one that activates the stages (P8).** M4
is one milestone comprising **five separately authorized single-control acts (M4.1–M4.5)**; those
acts are not additional milestones. **Five enforcement checkpoints** are owned by named PRs:
**C1 → P3**, **C2 → P2**, **C3 → P2**, **C4 → P5**, **C5 → P6**.

**Six controls that must never be collapsed.** The design separates, as independent controls:
**registry activation** (`executionEnabled`, moved by P8 and deployed by M3); the **runtime authority
gate** (durable `OFF`/`SHADOW`/`LIVE`, whose effective mode is the *lower* of the gate, the
deployment-time ceiling `CONTENT_INTELLIGENCE_MAX_AUTHORITY`, and any grant's `max_authority`);
**manual dispatch** (layer 4a — ceiling `CONTENT_INTELLIGENCE_MANUAL_DISPATCH_ENABLED`, plus a
bounded, expiring, transactionally consumed grant, so a ceiling without a grant starts nothing);
**scheduled/queue dispatch** (layer 4b — ceiling `CONTENT_INTELLIGENCE_SCHEDULED_DISPATCH_ENABLED`,
owned by **worker and scheduler only**); **approval** (checkpoint C4, api); and **publication**
(checkpoint C5, worker). The two dispatch ceilings are deliberately separate variables. **No act
changes more than one control** — which is why M3 (registry activation) and M4.1 (authority ceiling)
are separate acts with separate deployments. **Scheduled dispatch implies neither approval nor
publication.**

**Migration 007 / 008 ordering.** **M1 applies 007 first**, while `main` still carries no migration
beyond it, and **P1 must not merge before M1** — that is M1's protecting invariant, not a
convenience. P1 then introduces migration **008** with the control plane and grant schema, and **M2**
is the migration-bearing release that applies 008. The design is explicit that 007's application is
neither authorized nor established by anything in it.

**API `preDeployCommand` is the only migration authority.** `render.yaml` gives
`preDeployCommand: npm run migrate` to `gcd-social-api` **and to no other service**, and the standing
rule in [`ROLLOUT_PHASE_0B0.md §5`](ROLLOUT_PHASE_0B0.md) forbids running `npm run migrate` by hand or
applying the SQL through `psql`. The consequence is load-bearing and easy to get wrong: **applying a
migration *is* an API deployment**, not a standalone database operation. The runner
(`src/state/migrate.ts`) is forward-only and **sweeps every pending file in lexical order** — there is
no per-file selector — so the authorized set must be established before the deployment, never assumed
from intent.

**Complete migration-state validation, not pending-only.** The preflight compares the **whole applied
state**, not just what is pending: the migration files at the artifact commit `F(A)`, the `_migrations` rows
`D`, and the computed pending set `P = F(A) − D`, against four expected sets (`E_files`,
`E_applied_pre`, `E_pending`, `E_applied_post`) under **seven conditions**. The reason is exact: a
pending-set difference **cannot see an unexpected already-applied migration**, because such a file
cancels out of `F(A) − D` and leaves the pending set looking correct. The operator record is in **two
timed parts** — Part 1, the pre-deployment record, completed and passing **before** the deployment is
triggered; Part 2, the post-deployment closure (`D_post`, the comparison outcome, and the
validation-versus-rollback decision), completed **after** it, without which the milestone is not
complete.

**A/L deployment ancestry.** For any api deployment in this rollout, with `A` the artifact commit and
`L` the live api commit **read immediately before**: allow `A == L`, or `L` an ancestor of `A`;
**reject** `A` a proper ancestor of `L` (a runtime rollback) and mutual non-ancestry (divergence);
**stop** if `L` cannot be obtained. Equality is tested **first**, because `git merge-base
--is-ancestor` is reflexive and would otherwise mask the same-commit case. `L` is read, never inferred
from repository ordering.

**Rollback-artifact compatibility is an entry gate, not an assumption.** M1's recovery path redeploys
the previously live image **while leaving 007 applied** — old code against a newer schema. Before M1
may be authorized, the rollback artifact `R` (normally the pre-M1 live api artifact, i.e. `L`, named
by full SHA) must be **proven** compatible by executed evidence against a disposable database migrated
through 007, on **PostgreSQL 16 and 18**: startup and readiness, every production-reachable read,
every production-reachable write path, values at and around each new constraint, ordinary existing
rows, and restart behaviour. **"Additive", "`NOT VALID`", and "the old image starts" are explicitly
not compatibility evidence.** If compatibility cannot be established, redeploying `R` is not an
authorized recovery action and M1 must not begin.

**Partial-release handling.** When `A ≠ L`, M1 deliberately advances the api ahead of the worker and
scheduler, creating exactly the service-identity mismatch the automated controller treats as
`PARTIAL_RELEASE_STATE` and refuses to release from. M2 therefore proceeds from a deliberately partial
state and is executed as an **explicitly authorized manual departure from the controller**, carrying
every obligation the controller would otherwise enforce, and it closes the interval by bringing all
three services to one commit with `/healthz` plus durable readiness evidence.

**Same-commit `preDeployCommand` behaviour remains `UNKNOWN`.** Whether an api deployment requested at
a commit equal to the live one re-invokes `preDeployCommand` is **not established in either
direction**, and the design says so rather than guessing. On the `A == L` path the controller confirms
all three services at target and then **deploys nothing**, so obtaining the migration run requires
requesting an api deployment anyway — a deliberate, explicitly authorized departure. If the equality
path may be used, that behaviour must be confirmed first.

**M7 service ownership.** M7 is three separate single-control acts with **different service targets**:
**M7-a** (`CONTENT_INTELLIGENCE_MAX_AUTHORITY` `SHADOW` → `LIVE`, **worker and api**) is a real api
deployment and takes the full §4.4.2 preflight and both record parts; **M7-b**
(`CONTENT_INTELLIGENCE_SCHEDULED_DISPATCH_ENABLED`, **worker and scheduler only**) restarts no api and
takes no migration gate; **M7-c** is a control-plane row, not a deployment. After M7, manual dispatch
requires a **new** separately authorized bounded grant — M7 issues none.

**Material alternatives rejected.** *Treating `executionEnabled` as the dormancy guarantee* was
rejected on read evidence that no execution path consults it. *Validating only the pending set before
a migration-bearing deployment* was rejected because an unexpected already-applied migration cancels
out of the pending difference and is invisible to it. *Running `npm run migrate` standalone, or
applying the SQL through `psql`*, was rejected as prohibited by the standing rule and by there being
one migration authority. *Inferring the live commit `L` from repository ordering, or assuming `A == L`*
was rejected — `L` is read immediately before, or the milestone stops. *Testing ancestry before
equality* was rejected because `--is-ancestor` is reflexive and would mask the same-commit case.
*Accepting "additive", "`NOT VALID`", or "the old image starts" as rollback-compatibility evidence*
was rejected: none establishes that `R`'s **writes** are still accepted. *One combined dispatch
control* was rejected because it would make a scheduled run reachable by way of enabling a manual one.
*Combining registry activation with the authority ceiling in one act* was rejected under the
one-control-per-act rule. *A single approval covering the whole rollout* was rejected: authorization is
per named PR and per named milestone. *Recording the operator's post-deployment readings in the
pre-deployment step* was rejected as a sequence no operator can perform. *A new Render service* was
rejected in favour of existing infrastructure. *Beginning the GBP expansion alongside this work* was
rejected outright.

**Security and privacy implications.** The design adds nothing executable, so it changes no live
attack surface; its security content is in what it refuses to allow later. Every proposed gate fails
**closed**: an absent, unreadable, or unrecognized authority value is `OFF`; the effective mode is the
*lower* of ceiling, gate and grant; a manual grant is bounded, expiring, and consumed transactionally
in the same transaction that creates the run row, so two simultaneous submissions against
`runs_remaining: 1` yield exactly one accepted run; approval (C4) and publication (C5) are refused
until the gate reaches `LIVE` and remain independent controls even then. The proposed authority gate
sits **in front of — never instead of —** the existing Phase 0A approval gate, which is unchanged.
**Content integrity of applied migrations is not verifiable at all**: `_migrations` stores
`name text PRIMARY KEY` and `applied_at`, with **no checksum column**, so identifiers are verifiable
and contents are not — the design states this limitation rather than implying integrity it cannot
prove. No credential was requested or received at any point, no production database or Render state
was inspected, and the document contains no secret, token, credential, customer datum, or raw
analytics value.

**Automated validation and exact-head CI.** At the reviewed head `42f83a12…`: `npm ci` with 0
vulnerabilities, typecheck, build, the **eight offline suites ALL PASS (1,367 assertions)**, **33
payload-contract mutations ALL PASS** with byte-for-byte restoration across exactly 9 target files,
final rebuild, disposable **PostgreSQL 16 — 208 checks** (fresh 59, upgrade 80, durable 69), simulated
dry run, deployment-controller fixtures, Markdown links, environment coverage (35 variables),
credential/PII scan, `npm audit --omit=dev` with 0 production vulnerabilities, YAML parse, AgentShield
**grade A (93/100)**, and `git diff --check` clean. **Exact-head CI: run `34272982709` — all five jobs
`success`, each on attempt 1, every one reporting `head_sha` `42f83a12…`**: Node 22 offline quality
gates, PostgreSQL 16 integration, PostgreSQL 18 integration, AgentShield 1.4.0, and Workflow and YAML
static validation. Every model call in every suite used an injected fake runner. **That is repository
validation for a documentation-only change — not deployment, not production validation.**

**Independent review before acceptance.** The document was corrected in place across **nine rounds of
independent inspection**, on the same branch, with no replacement PR and no rewritten history. The
corrections were substantive, and each is now part of the accepted design rather than an artifact of
review: the **complete migration-state contract** replaced a pending-set-only check once the
cancelling-out defect was identified; the **A/L ancestry predicate** was generalized from M1 to every
api deployment in the rollout and reordered to test equality first; the **rollback-artifact
compatibility gate** was added after "additive" was found to be doing work it cannot do; the
**migration-versus-deployment contradiction** was resolved once `preDeployCommand` was confirmed as
the sole migration authority; **M3/M4 were split into single-control acts** and **M7 into three acts
with distinct service targets**; the **partial-release interval** M1 creates was named and its
controller departure labelled; **same-commit `preDeployCommand`** was recorded as `UNKNOWN` rather
than assumed; and the **operator record was split into a pre-deployment Part 1 and a post-deployment
Part 2** after a reviewer showed the single-step version described a sequence no operator can perform.
Two of those rounds were opened by findings against the reviewer's own prior corrections, and both
were corrected rather than argued. The full round-by-round diff history is preserved in PR #56.

**Rollback / recovery status.** Rollback of this documentation change is to revert merge commit
`53e2c2bb6115e457670c1f99956d11a1a54530cd`, which removes the design document and the status
reconciliations in one step. **No database, Render, provider, approval, publication, or production
cleanup is required, because none was introduced** — the merge applied no migration and changed no
source, workflow, dependency, configuration, `render.yaml`, or `executionEnabled` value. Reverting it
removes an accepted design; it unwinds no operational state, because none was created.

**Production evidence: none.** No production database was inspected, queried, mutated, or
credentialed; no Render service was inspected; no provider or model was contacted; `evidence:sync` was
not run. The only production evidence anywhere near this work remains the operator's **dated**
2026-09-02 aggregate read-only audit recorded under PR #54, which is a dated observation and not a
statement about now.

**Unresolved questions carried forward by the accepted design, as of this merge.** Live Render service versions, health,
and control settings; **`L`, the commit each service currently runs**; whether a same-commit api
deployment re-invokes `preDeployCommand`; whether the rollback artifact `R` tolerates the post-007
schema; the contents of `_migrations` and of the production evidence tables; whether migration 007
had been applied — not established in either direction at that time (**since resolved: migration 007
is now production `APPLIED`, per M1 in the active product cursor above**); whether any executor has ever been invoked
against a real model historically; whether a shadow run should build its evidence pack from
`config/approved-facts.json` via the adapter or require `evidence:sync` to have populated
`content_evidence` first; per-run and per-day cost ceilings and the behaviour on breach; whether one
brief per day remains the right cadence once six stages run per brief; and retention for
`content_intelligence_stage_results`. **Content integrity of applied migrations is not verifiable at
all**, the migration table carrying no checksum.

**Follow-up — the next cursor, stated narrowly.** The next action is **not** "implement production
wiring" and is **not** the Google Business Profile expansion, which stays deferred. It is the accepted
design's own **first prerequisite: a read-only verification of live production identity and database
state** — the three service commits (which establishes `L`, and with it the candidate rollback
artifact `R`), `/healthz`, the control settings, and **the complete migration-state evidence §4.4.2
requires**: the full `_migrations` identifier set `D` **enumerated**, its row count recorded alongside
its distinct-identifier count, and the artifact's migration files `F(A)` at the commit each service
runs, so that `P = F(A) − D` and all **seven** §4.4.2 conditions can be evaluated rather than assumed.
**Collecting the `_migrations` rows alone is not sufficient**, and neither is the pending set: an
unexpected already-applied migration appears in both `F(A)` and `D` and cancels out of `P`, so the
complete applied set must be validated in its own right against an expected inventory. This
verification is **evidence only** — it is not the §4.1 aggregate audit, not the §4.2 decision record,
not the rollback-artifact compatibility proof, and not M1; each of those remains its own separate gate
requiring its own authorization. Performed by an authorized operator, read-only, and recorded as a
dated observation. Everything else the design gates
on depends on facts that verification produces. Only after it, and each under its own separate
authorization, come: the **migration-007 aggregate read-only audit and its committed decision record**
(§4.1–§4.2); **confirmation of same-commit `preDeployCommand` behaviour**, if the `A == L` path may be
used; and **rollback-artifact compatibility planning and executed evidence** for `R`. **This
reconciliation performs none of them, and M1 is not authorized.**

**Documents updated at completion.** In the implementing pull request (PR #56) — `README.md`,
`docs/AI_HANDOFF.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/STATUS.md`, and the new
`docs/PRODUCTION_WIRING_DESIGN.md`. In this post-merge reconciliation — all ten
documents it changes: `README.md`, `docs/AI_HANDOFF.md`, `docs/ARCHITECTURE.md`,
`docs/DATA_MODEL.md`, `docs/PRODUCTION_WIRING_DESIGN.md`, `docs/ROADMAP.md`,
`docs/SECURITY_AND_CONTINUITY.md`, `docs/STATUS.md`, `docs/TESTING.md`, and
`docs/credentials-setup.md`. That reconciliation also carries three non-documentation paths,
recorded in the next paragraph.

**The reconciliation is not documentation-only, and is classified as migration-touching.** Alongside
the ten documents it corrects three authoritative repository inputs that asserted what the
documentation no longer asserts: the **comments** in `state/migrations/007_evidence_bounds.sql` and
`state/rollback/007_evidence_bounds_rollback.sql`, which declared 007 *"has not been applied to
production"*, and the `CC5` regression in `src/harness/contentIntelligence.selftest.ts`, which
required those exact strings and would therefore have rejected a corrected comment. Both comments
now state that 007's live application state is **`UNKNOWN` in either direction**, keep the
2026-08-28 reading of `_migrations` at `001–006` as an explicitly dated observation, and require
read-only verification and separate authorization. `CC5` no longer pins a sentence, no longer keys
on qualifier keywords, and no longer splits prose on punctuation. It **tokenises** each file's
comment prose once — reassembling hard wraps first, so a line break neither manufactures a fragment
nor hides a declaration — and analyses **every** application predicate in place, making five
judgements independently for that one predicate from its own tokens: its subject, or the contextual
antecedent it modifies; its auxiliary/tense frame; its own proposition boundaries; the governing
conditional or epistemic construction, if any; and whether what remains is a categorical
current-state assertion. **No judgement is measured in characters, and no punctuation mark is a
boundary by itself.** Within the **specifically tested bounded grammar**, a predicate declaring
007's application state is refused **in either direction**: positive or negative, present, perfect or past, verbless elliptical (*"Not applied to
production."*), contracted (*"isn't applied"*), bare past (*ran*, *never ran*) or emphatic (*did
run*, *did not run*), in plain and contextual-*It* shapes, with or without the word *production*,
with the auxiliary at any distance from its participle and across a parenthetical or comma-delimited
aside, and finite application assertions remain categorical regardless of procedural wording
following the verb or a `re-` prefix. **That grammar is bounded, not complete English:** past
*remain*/*stay* declarations (*"remained unapplied"*, *"has stayed unapplied"*, and their
contextual-*It* shapes) are **not** rejected, and are recorded as the accepted deferred issue
**`CC5-SYNTAX-001`** in [`docs/KNOWN_ISSUES_AND_HARDENING.md`](KNOWN_ISSUES_AND_HARDENING.md).
**Qualification must
govern the proposition, which is a structural test rather than a vocabulary one.** A subordinator —
*whether*, *if*, *after*, *once*, *when*, *whenever*, *before*, *until*, *unless* or *should* —
counts only when it introduces the very clause the predicate heads: everything between it and the
predicate must be that clause's own subject, matched against a whitelist, so the rule fails closed.
**Every predicate is judged on its own**, so a subordinator cannot reach across a predicate it
already governs and a governed proposition never covers for a categorical sibling. Conversely a
governed proposition keeps its **own internal qualifiers** (*"Whether migration 007, after read-only
verification, is applied remains `UNKNOWN` in either direction."*), because a comma pair or a
parenthesis whose interior carries no finite verb is an interruption inside one proposition rather
than the end of one. **The guarantee is deliberately narrow**: it recognises the supported
authoritative-comment language of these two files and is not a claim of general natural-language
understanding.

Eight earlier forms did not meet that bar, and every one of them was found by independent review
rather than by us. The first accepted a qualifier that merely **co-occurred** in the clause. The
second accepted any subordinator that merely **preceded** the predicate, which let an unrelated
introductory clause launder the assertion behind it (*"Before we verify, migration 007 is
applied."*). The third stopped at the **earliest** predicate and allowed the whole clause once that
one was governed, which let an authorized proposition carry a categorical sibling (*"Whether
migration 007 is applied is UNKNOWN and migration 007 is applied."*); splitting on `and`/`but` would
not have fixed it, since those conjunctions occur inside governed propositions too. The fourth
exempted a **finite** occurrence claim whenever procedural manner or a `re-` prefix followed the
verb, so *"Migration 007 was applied by hand to production."* and *"Migration 007 was re-applied to
production."* passed; the exemption is now bound to the tense frame, and reaches only a genuinely
non-assertive one. The fifth hunted the auxiliary inside a fixed **twenty-eight-character window**
and treated every comma as a clause boundary, so *"Migration 007 has, according to the operator,
been applied to production."* escaped while *"Whether migration 007, after read-only verification,
is applied …"* was wrongly rejected; both are now decided structurally, by associating an auxiliary
with its verb inside one proposition and by recognising an interruption for what it is. The
epistemic statement (*"whether … is `UNKNOWN`"*), the dated observation, verification and
authorization instructions, adjectival uses (*applied set*) and procedural uses in a non-assertive
frame (*applied by hand*) remain allowed — each tested against the specific predicate rather than
the whole sentence. The sixth recognised a balanced aside only when its interior carried no verb of
its own, so a **subordinate** aside severed the outer frame it interrupts (*"Migration 007 has,
after the report was signed, been applied."* read as a bare participle rather than a perfect
assertion), and treated every coordinator as the end of a governor's reach, which wrongly rejected
the authorized coordinated forms (*"Whether or not migration 007 has been applied is `UNKNOWN` in
either direction."*, *"Whether migration 007 was applied or ran in production is `UNKNOWN` in either
direction."*). A balanced pair opened by a subordinator is now an interruption even when it carries
a finite verb — that verb belongs to the aside, and the aside's own subordinator governs nothing
outside it — while a coordinator is stepped over only inside one governed proposition. **The
seventh** was that correction's own limits, again found by independent review. Its opener list took
a **single** token, so natural asides opened by a phrase (*even though*, *now that*, *provided
that*) still severed the frame; commas were paired **greedily with the nearest** one, so two
consecutive asides or a nested one left overlapping pairs a leftward walk fell back inside; the
coordination gap admitted neither a **serial comma** (*was applied, ran, or was re-applied*) nor an
interruption span of its own; and an imperative *do not run* was classified as a categorical do-
support claim. Openers are now matched over one, two or three leading tokens; comma pairing prefers
the **outermost** qualifying opener and resolves shared endpoints to that outermost start, so nested
and consecutive asides are stepped over as one; the coordination gap admits serial commas and skips
validated spans, while still refusing a new subject, an adversative, a bare imperative *do* or any
other word; and bare *do*/*don't* with no subject of its own is read as an instruction, while *does*
and *did* stay declarative and emphatic. Above all, **finite-frame recovery now fails closed and
depends on no list at all**: `been applied` is not a proposition, so when the walk meets a comma it
does not recognise while holding only a non-finite frame, it crosses that aside and keeps looking
for the finite auxiliary rather than reading the participle as non-assertive. **The eighth** was a
pairing bug in that same correction: an opening parenthesis was matched to the FIRST later `)`, so
with nested parentheses the inner close was recorded as the outer one and the real outer close was
left unmatched — a leftward walk then read it as a proposition boundary and *"Migration 007 has
(according to the operator (per the audit)) been applied."* passed as a bare participle. Parentheses
are now paired **by depth**, with a stack, so nested asides yield nested spans and no close is left
dangling. **The ninth** was that same fix's own fail-open: recovery was also taught to **cross** an
unmatched `)`, so one stray close bought a bypass outright — *"Migration 007 has, according to the
operator) been applied to production."* left the whole suite exiting 0, because the walk skipped the
`)`, halted at the noun `operator` before reaching the outer `has`, and read `been applied` as a bare
participle; an authorized `UNKNOWN` sentence beside it changed nothing. An unmatched close is
**malformed prose**, never an aside, so a depth scan of the normalized comment prose now fails `CC5`
**structurally** on any `)` at depth zero, **before** any application predicate is classified, and the
recovery-through-unmatched-close behaviour is **removed**. Balanced parentheses, single and nested,
still pair by depth. The unmatched **opening** parenthesis remains explicitly **unclaimed**.

**Two hundred and fifty-two mutations** in `npm run test:payload-mutation` prove it load-bearing
in both directions: **two hundred and six prohibited** forms that must make `CC5` fail by name, and
**forty-six authorized** forms that must leave the suite green, so an over-broad guard fails in CI
rather than in review. That brings the harness to **two hundred and eighty-five mutations across ten
target files** — **two hundred and thirty-nine prohibited** in total — enumerated from its own
`MUTATIONS` array and run output rather than recalled. Of the prohibited forms, twenty-six are declaration and masking
classes, fourteen introductory-clause and `ran`/`did run` classes against each file, twelve multi-
proposition classes against each file, twenty-three token/proposition classes against each file
(`M118`–`M163`), fourteen balanced-aside and coordinated-sibling classes against each file
(`M174`–`M201`), sixteen natural-aside and instructional classes against each file (`M210`–`M241`),
and **three NESTED-PARENTHESIS classes against each file** (`M242`–`M247`): a positive and a
negative outer perfect frame split by nested parentheses, and a doubly nested contextual-*It* form.

**What each correction is actually load-bearing for was measured, not assumed.** Against `c189d2b`,
seventeen of the twenty-three token/proposition prohibited classes bypassed `CC5` and three of the
five authorized classes added with them were wrongly rejected. Against `83af628`, both finite-aside
forms bypassed on both SQL files and all four coordinated governed forms were wrongly rejected on
both. Against `3f173d5`, all twelve reported forms were misclassified on both files. Against
`4a4c4b2`, the nested-parenthesis forms were misclassified on both files in **both** directions —
two positive and negative claims passing as non-assertive, and a governed proposition carrying
nested parentheses wrongly refused.

**Twelve focused probes measured the current groups**, each altering the built suite in one way, each
re-running every class against the migration file, each followed by a byte-for-byte
restore. Removing **fail-closed finite-frame recovery** lets the two unlisted-opener classes through
(`M238`–`M241`). Removing **multi-token openers** wrongly rejects the modal-aside allowance
(`M256`–`M257`) while the prohibited classes stay caught by recovery. Removing **both** reopens the
bypass for six classes (`M210`–`M213`, `M224`–`M225`, `M236`–`M241`). Reverting **parenthesis
pairing** to first-later-`)` wrongly rejects both nested-parenthesis allowances (`M264`–`M267`); the
nested-parenthesis prohibited classes (`M242`–`M247`) stay caught, now by the **structural
unmatched-close failure**, which refuses the dangling close that pairing bug produces. The earlier
attribution — that reverting both pairing and recovery is what lets `M242`–`M247` escape — is
**superseded**, because recovery through an unmatched `)` no longer exists. Reverting the
coordination gap to a single coordinator with no serial comma wrongly rejects three serial-list
allowances (`M248`–`M249`, `M258`–`M261`); leaving validated spans in that gap wrongly rejects the
parenthetical-carrying allowance (`M250`–`M251`); removing the imperative/declarative `do`
distinction wrongly rejects both instructional allowances (`M254`–`M255`, `M262`–`M263`); and
letting a coordinated chain reach across an independently asserted sibling lets the new-subject and
hidden-*did run* classes through (`M226`–`M227`, `M232`–`M233`). Eight prohibited classes
(`M214`–`M223`, `M228`–`M231`, `M234`–`M235`) and one allowance (`M252`–`M253`) survive every probe,
caught or preserved by other parts of the analysis; they are retained as coverage and are **not**
claimed as proof of any single correction. Re-running the earliest-predicate-only probe against the
twelve multi-proposition classes reproduced the earlier measurement exactly: **eight classes
(sixteen mutations) go undetected**, while the other four stay caught.

**Eighteen mutations (`M268`–`M285`) cover the unmatched closing parenthesis**, nine classes against
each SQL file: the exact reported comma-opened form beside an authorized `UNKNOWN` sentence, a
contextual-*It* form, more than one unmatched close, an unmatched close inside a sentence carrying an
authorized `UNKNOWN` proposition, one before and one after the application predicate, two **no-comma**
forms, and a balanced **single**-parenthesis authorized counterpart.

**What that group is load-bearing for was measured, and the measurement corrected the claim first made
for it.** With the structural failure disabled and everything else intact, the comma-opened classes
(`M268`–`M275`) are **still rejected** — removing the unsafe `)`-crossing lets the pre-existing
fail-closed **comma** recovery jump to the comma before the stray close and recover the outer `has`, so
for those classes the structural check is **redundant** and is **not** claimed as their protection.
Deleting the comma isolates it: `priorComma` has nothing to jump to, the walk halts at the noun, and the
claim escapes — so the **no-comma classes `M282`–`M285` are this correction's load-bearing evidence**,
and they were added because the probe said so rather than because the shape looked plausible. With the
structural failure removed **and** the old `)`-crossing restored — the reviewed head `05b8c4b` —
`M268`–`M275` and `M282`–`M285` all escape, reproducing the reported bypass. `M276`–`M279` survive both
probes, caught by other parts of the analysis, and are retained as coverage only.

**A harness payload-escaping defect was found and corrected in the same round.** One hundred and
fifty-two payloads (`M106`–`M107`, `M118`–`M267`) wrote a **literal backslash and `n`** instead of a
newline, so they produced **one** physical comment line rather than two and **never exercised the
multi-line comment path**, including the hard-wrap reassembly in `sqlComments`. `M106`–`M107` are
*named* for a **newline between the governed proposition and the categorical one** and delivered none.
All one hundred and fifty-two now use real newlines; `M106`–`M107` take `\n-- ` rather than a bare
`\n`, because the escape sits mid-sentence and a bare newline would have written a line with no `--`
prefix — non-comment text injected into executable SQL and invisible to `sqlComments`. Two other
newline-claiming mutations already used real newlines and were left unchanged.

Separately, a manual adversarial matrix ran **ninety-two prohibited forms and thirty authorized
forms against each of the two SQL files** through the real suite: **one hundred and eighty-four
rejections and sixty allowances, zero misclassifications** across two hundred and forty-four
executions, with both scripts restored byte-for-byte after each (migration `fb5128b4ae207e75…`,
rollback `31e0ab0c1f92ccaf…`), `state/` clean and a green final baseline. Two earlier rounds
reported narrower matrices — one hundred and forty-six rejections with forty allowances, then one
hundred and seventy-eight with fifty-six; each figure was accurate for the matrix it described, and
each was superseded when independent review found variants that matrix did not contain. **That
figure is likewise superseded for this round**: it predates the unmatched-close forms, which it did
not contain. Those were verified separately — **ten classes against each of the two SQL files, twenty
executions, zero misclassifications**, each restoring byte-for-byte: six prohibited unmatched-close
forms rejected, a balanced single- and a balanced nested-parenthesis authorized form allowed, and two
balanced categorical forms rejected for their categorical content rather than for balance. Every
unmatched-close class is now held durably as `M268`–`M285` in the harness rather than by a manual
matrix alone.

**Migration-path classification, accepted and not bypassed.** Because that change touches
`state/migrations/**`, `scripts/render/deployment-controller.mjs` evaluates
`git diff --name-only <live>..<target> -- state/migrations/**`, finds a match, sets
`report.result = "blocked"` and stops with **`MIGRATION_ROLLOUT_REQUIRED`**. The guard uses
`--name-only` and **does not distinguish a comment-only edit** from a schema change. That
classification is **correct and deliberately left intact** — the guard was not suppressed, bypassed,
weakened, or excluded, and the controller, workflows and `render.yaml` are unmodified. **Any release
range containing this change therefore requires the separately authorized migration-bearing rollout.**
**No executable SQL changed:** stripping full-line `--` comments and blank lines leaves both scripts
byte-identical to the base — migration `6e39722…`, rollback `21a8ac8…`, 40 and 19 executable lines
respectively — and the disposable PostgreSQL 16/18 suites still apply, enforce, roll back and reapply
007 at 208 checks each. **None of this implies migration 007 was applied, authorized, or deployed by this change; its
live application state is now established `APPLIED`, independently verified via M1
(2026-09-18) — see [Status](STATUS.md).**

## Phase 0B — Content Intelligence runtime

**State:** foundation `MERGED` and `DEPLOYED`; all six executors — `strategy-concept`, `automotive-truth`, `hook-story-script`, `production-direction`, `packaging-adaptation`, and `final-critic` — **`MERGED`** and dormant, the sixth through PR #52; the payload-contract reconciliation **`MERGED`** through PR #54. **None is `ENABLED`, established as `DEPLOYED`, or `PRODUCTION-VALIDATED`**, and none has production evidence. **All six target stages now have a merged executor on `main`**, and every registry entry reports `executionEnabled: false`. Separately, on the deployment-authority track, **M1 (migration 007's rollout as an API-only deployment) is now complete and independently verified** — see the active product cursor above; this did not enable any stage and did not authorize M2.

**Last merged slice: the payload-contract reconciliation, `MERGED` through PR #54** (merge `0c13ab1af9c7ca796a1d48ed37207715a47166e4`), recorded in its own section above. Before it, Phase 0B.6 — the dormant `final-critic` stage executor — was `MERGED` through PR #52; see its dedicated section for the full record and durable identifiers. The reconciliation that gates production wiring is therefore **satisfied in repository state**: it is present on `main`, and it is not established as deployed, not enabled, and not production-validated. Deployment-authority work remains an independent track and must not be combined with any of this. **The separately reviewed production-wiring design is accepted and `MERGED` through PR #56** (merge `53e2c2bb6115e457670c1f99956d11a1a54530cd`), recorded in its own section above, and is **`UNIMPLEMENTED`** — authorizing neither implementation nor operations. **No implementation PR (P1–P8) exists. M1 was performed 2026-09-17 and independently verified 2026-09-18; no other operator milestone (M2–M7) has been performed** — see the active product cursor above. Not a new phase number, and no production wiring, deployment, enablement, migration application, or production validation has occurred.

Separately, the six stage prompts now state the output limits their own validators enforce —
`MERGED` through PR #78, recorded in its own section above. That is a correctness fix to checked-in
prompt text found by a local evaluation run; it moves no cursor, enables no stage, and authorizes
nothing.

Phase 0B.0 delivered the two runtime primitives the rest of the phase depends on:

- **Content evidence** — typed contract, durable schema, deterministic approved-facts adapter, evidence pack builder with conflict and staleness surfacing, and an explicit idempotent operator sync.
- **AgentRegistry** — all six target stages registered with model policy, prompt/skill/reference assets, allowed capabilities, required evidence kinds, input/output validators, and prerequisites. Asset loading is allowlist-rooted and rejects traversal; a missing mandatory asset fails loudly.
- **ContentIntelligenceContext** and a deterministic preview at `POST /console/content-intelligence/preview`, behind the existing console credential.

`executionEnabled` is `false` on every registered stage and the preview asserts it. Registration is not execution: no stage runs a model call, and the live publishing pipeline is untouched.

**Remaining slices, in order:** the payload-contract reconciliation recorded in its own section above is **`MERGED`**, so that prerequisite is met in repository state and no longer blocks the sequence; the **separately reviewed production-wiring design** is now accepted and `MERGED` through PR #56 and remains **`UNIMPLEMENTED`**, authorizing neither implementation nor operations, so the next work is that design's own **first prerequisite** — a read-only verification of live production identity and database state, recorded in its section above and separately unauthorized; then its eight implementation PRs and seven operator milestones, each under its own authorization; then performance ingestion; then governed learning. The proposed future Google Business Profile expansion sits after those and is not part of this repository's scope today. The roughly 22 originally researched specialist roles remain conceptual capabilities — most belong as deterministic services, references, or policy modules, not as mandatory model calls. After the operational prerequisites are accepted, return to the core mission with approximately six primary model reasoning stages:

1. strategy-concept;
2. automotive-truth;
3. hook-story-script;
4. production-direction;
5. packaging-adaptation; and
6. final-critic.

Continue using the existing `AgentRegistry` and shared execution boundary while completing stage-specific skill/reference handling, research/reference retrieval, structured evidence capture, and deterministic input/output validation around the remaining stages. Treat the roughly 22 originally researched specialist roles as conceptual capabilities: most should be deterministic services, references, policy modules, or optional specialists — not 22 mandatory model calls.

Keep human filming and external editing in the loop. Do not add an in-browser video editor unless a later phase explicitly requires it. Preserve human approval and governed change. Do not implement uncontrolled prompt, skill, agent, process, or publishing-rule rewriting.

## Later / deferred

- ingest platform performance with provenance and freshness;
- build content scorecards around reach, qualified followers, repeat viewing, affinity, retention, engagement, authority, and local relevance;
- track creative and causal hypotheses without confusing them with facts;
- learn from GCD empirical performance while retaining research priors;
- generate governed improvement proposals for human review;
- add paid amplification only after the organic engine and controls are reliable; and
- connect attribution, leads, and revenue after attention and audience quality are measurable.

**`DEFERRED` — browser-based video editing.** Humans film and CapCut or another external editor remains the V1 path. Re-entry condition: an explicit later phase that requires in-browser editing.

## Out-of-band tooling — local Content Intelligence evaluation CLI

**This entry is deliberately outside the P1–P8 / M2–M7 sequence above and does not move the
active product cursor.** It exists so German Car Depot can see real agent output from the six
merged-but-dormant reasoning stages before any production-wiring PR is authorized, not as a step
toward authorizing one.

**State:** `IMPLEMENTED` (repository-local only; nothing here is `MERGED` to a tracked roadmap
phase because it is not phase-scoped work). Not `DEPLOYED`. Not `PRODUCTION-VALIDATED`. Touches no
production system, no database, no scheduler, no worker, and no publishing path.

*Corrected 2026-09-28:* the CLI is on `main` — first merged through PR #71 at
`71f2a133b045ba342d3dd968d4eeb7d2911c32c8`, and extended by later merged changes recorded in this
file — so in this file's vocabulary it is `MERGED`, not merely `IMPLEMENTED`. It is still not
phase-scoped, and still not `DEPLOYED` or `PRODUCTION-VALIDATED`.

**What it is.** `scripts/local/content-run.mjs`, a CLI that drives the six merged stage executors
(`strategy-concept` → `automotive-truth` → `hook-story-script` → `production-direction` →
`packaging-adaptation` → `final-critic`) directly and in sequence, exactly as
`src/harness/contentIntelligence.selftest.ts` already proves the wiring works, threading each
stage's validated output into the next. It loads the 27 adapted business-fact records from
`config/approved-facts.json` through the existing pure `adaptApprovedFactsFile` adapter (not
reimplemented), and loads automotive facts from an operator-supplied, gitignored
`config/automotive-facts.local.json` — never invented, never committed; a placeholder-marked
`config/automotive-facts.local.example.json` template is committed in its place. It builds and
validates an evidence pack with the existing `buildEvidencePack` / `assertUsableEvidencePack`
functions and fails loudly, with the actual violation list, if the pack is unusable.

**What it does not do.** It does not flip any stage's `executionEnabled` (still `false` on every
stage, as merged). It authorizes nothing: no approval, no brief, no worker, no scheduler, no
publishing path is reachable from it. Its default `--runner fake` mode makes no network call and
costs nothing, using canned responses that only ever cite real evidence ids already present in the
caller's own evidence pack or in the immediately preceding stage's own validated output. A
`--runner live` mode exists for later, deliberately gated: it refuses to run without an explicit
`--i-understand-this-costs-money` flag and prints the estimated ceiling cost first. No live model
call has been made from this tool as part of implementing it — that is a separate, separately
authorized step, owned by whoever the business decides should spend real budget on it, and gated on
the same read-only production-identity verification prerequisite the production-wiring design (PR
#56) already requires before any of P1–P8 begins.

**Material design decisions.** Reuse the exact merged executors and validators rather than a
parallel implementation, so this tool can never drift from what P1–P8 will actually wire up. Fail
closed on missing automotive facts (`automotive-truth` refuses with a clear message naming the
missing evidence class) rather than degrading to a strategy-only run, so the tool can never be used
to produce automotive claims with no real source behind them.

**Rejected alternative.** Fabricating placeholder automotive facts so every demo run reaches all
six stages. Rejected because the evidence contract's entire purpose is refusing an automotive claim
that lacks a checkable `sourceRef`, real `provenance`, and a `reviewedAt` — inventing one here would
poison the exact guarantee the contract exists to provide, even in a throwaway local tool.

**Automated validation:** build, typecheck, the eight offline suites (`npm run test:offline`),
simulated dry run, deployment-controller fixtures, dependency audit, Markdown-link validation,
environment-coverage comparison, and the sensitive-content scan all pass unchanged, because no
existing source file was modified. The new CLI itself was run end-to-end with `--runner fake`
against a locally-supplied (non-committed) automotive fact and produced six validated stage JSON
files plus a human-readable Markdown summary; it was also exercised against a missing automotive
facts file, which correctly refused at `automotive-truth` rather than fabricating a claim.

**Accepted limitations.** The `--runner live` path is implemented but has never been exercised
end-to-end (doing so costs real money and requires a real `ANTHROPIC_API_KEY`, neither authorized
here). The fake-runner canned responses are wiring fixtures, not creative or factual review — they
prove the pipeline is connected correctly, not that any particular piece of copy is good or true.

**Follow-ups.** None blocking. Running this tool with `--runner live` for the first time is a
separate, explicitly authorized decision the business makes when it wants to spend real budget
evaluating output quality; it requires its own real `config/automotive-facts.local.json` populated
from manufacturer documentation or another checkable source first.

**Later additions to this tool are recorded in their own entries, not here:** the paid-call
preconditions and the rejected-response capture (*Paid-call preconditions*, above), per-run
field measurement — `field-measurements.md` / `.json` beside every run, fake or live, passing or
failing (*Output-field classification*, above) — `run-meta.json` fingerprints, the typed `LIVE`
confirmation and the critic-only `--replay-critic` mode (*Critic on Claude Opus 5.5*, above), and
the deterministic contact line — its free preflight, `05b-contact-lines.json`, the contacted
packages the critic receives, the contact lines in `summary.md` — and the runner-named summary
footer (*Deterministic contact line*, under *Merged repository change awaiting rollout*). Since
that change the CLI runs `main()` only when executed as a script, so importing it runs nothing. The
critic panel then made full runs and `--replay-critic` run four lens requests, grouped `summary.md`
by lens, tagged every saved response and `field-measurements` row with its lens, and counted four
critic requests in the printed cost ceiling (*Narrow critic panel*, under *Merged repository change awaiting rollout*).
Evidence-pack scoping (`--scope-tags`, recorded in `run-meta.json` and the fingerprint and reused by
`--replay-critic`), `--list-tags`, and the free identity-record preflight were added by
*Evidence-pack scoping in the local CLI …* (now under *Merged repository change awaiting rollout*),
which also made `main` exported and `argv`-driven so the offline suite runs it in-process.
*Dated addition, 2026-09-26:* `--resume-from packaging-adaptation <run-dir>` runs stage 5, the
contact lines and the critic panel against a saved run's revalidated stage 1–4 outputs, after the
replay's own free checks (now shared as `verifySourceRun`), into a new sibling directory
(*Stage 5's caption stated below its enforced budget, and `--resume-from` …*, at the top of this file).

**Documents updated with this entry:** `docs/ROADMAP.md` (this section) and `.gitignore` (excludes
the operator-supplied automotive facts file and the tool's local output directory). `README.md` was
not updated because the production handoff it describes is unchanged by a tool that touches no
production system.

## Out-of-band tooling — local Tekmetric oil-service-interval feasibility probe

**This entry is deliberately outside the P1–P8 / M2–M7 sequence above and does not move the
active product cursor.** It authorizes nothing, deploys nothing, touches no production system,
reads no database, and does not represent a decision to build any Tekmetric-backed feature — it
exists only to answer whether Tekmetric repair-order data can support computing an actual observed
oil-service interval (miles and months) for GCD's BMW and Mercedes-Benz customers.

**State:** `IMPLEMENTED` (repository-local script only; not phase-scoped, so not `MERGED` to any
tracked roadmap phase). Not `DEPLOYED`. Not `PRODUCTION-VALIDATED`. Touches no production system,
no database, no scheduler, no worker, and no publishing path in this repository.

*Corrected 2026-09-28:* the probe is on `main`, merged through PR #73 at
`1ba8e45731eb016e8b2c4fc18a09e208830eca71`, so in this file's vocabulary it is `MERGED`, not
merely `IMPLEMENTED`. It is still not phase-scoped, and still not `DEPLOYED` or
`PRODUCTION-VALIDATED`.

**What it is.** `scripts/local/tekmetric-probe.mjs`, a read-only CLI that, given operator-supplied
Tekmetric OAuth2 client-credentials and a shop id, lists that shop's vehicles, filters client-side
to BMW and Mercedes-Benz (the Tekmetric vehicles list endpoint has no `make` filter, and Tekmetric's
actual make spellings are not assumed — the script reports every distinct spelling it observes so
the match can be verified), then lists each matched vehicle's repair orders with `postedDate` in a
lookback window (default 24 months). It implements the exponential-backoff algorithm the
`tekmetric-api` skill specifies for HTTP 429, and bounds its total request count (default cap 400,
printed alongside every run). No data-mutating request is ever issued. The only non-GET request is
the OAuth2 client-credentials token POST to `/api/v1/oauth/token` required to authenticate; every
data request is a GET. It runs against sandbox by default; a `--live-shop-data` flag is required to
target any non-sandbox (e.g. production) `TEKMETRIC_BASE_URL` — without it, a non-sandbox base URL
is refused before the token request is ever made.

**What it does not do.** It never prints or persists a VIN, customer name, address, phone, email,
an RO number tied to an identifiable customer, a free-text note or job-concern body, or any
monetary figure. Where it needs to check whether a job is an oil service, it inspects only the
structured `job.name` field and reports a match count — it never reads or prints free-text note
bodies, and says explicitly in its output that resolving oil-service identifiability further would
require reading free text, which is out of this script's scope and would need its own PII review.
It emits aggregate counts and fill rates only: total ROs, distinct vehicles, `milesIn`/`milesOut`
fill rates broken out both by make and the year the RO's own `postedDate` falls in (whether mileage
capture improved over time — a vehicle model year cannot answer that; a separate model-year
breakdown is reported alongside it, clearly labeled, for a different purpose), the count of vehicles
with two or more usable ROs (the gating number for any future interval computation) with the
ROs-per-vehicle distribution, and a structural count of consecutive-RO mileage deltas
(positive/plausible, zero, negative-or-absurd) — deliberately without computing a median or any
other interval statistic, since that was out of scope for this feasibility check.

**Credential handling.** The client id, client secret, and shop id are read from the environment
variables `TEKMETRIC_CLIENT_ID`, `TEKMETRIC_CLIENT_SECRET`, and `TEKMETRIC_SHOP_ID` — never
hardcoded, never logged, never echoed, never written to disk, and never committed. These variables
are intentionally **not** added to any `.env.example` file: `scripts/ci/check-environment-coverage.mjs`
scans only `src/**/*.ts`, so omitting them there does not weaken that check, and adding them would
falsely imply a deployed API, worker, or scheduler reads them, when none does. The credential
requirement is documented only in the script's own `--help`/usage text.

**Material design decisions.** Filter to target makes client-side rather than assuming a `make`
list-filter exists on the Tekmetric vehicles endpoint (it does not, per the `tekmetric-api` skill),
and report the raw distinct make spellings observed so a reviewer can verify the match logic rather
than trust it blind. Bound total HTTP requests with a hard cap rather than an unbounded per-vehicle
repair-order fetch, since request volume scales with matched-vehicle count and Tekmetric enforces a
per-minute rate limit. Treat mileage deltas above 60,000 miles between consecutive ROs as "absurd"
for the structural-usability count, without asserting this threshold is the right cutover for any
later statistical treatment.

**Rejected alternative.** Reading job or RO free-text note bodies to identify oil-service jobs more
completely. Rejected for this feasibility probe because note bodies routinely contain PII
(customer-stated concerns, sometimes names or contact details pasted into free text), and this
script's entire purpose is to answer a feasibility question without ever handling identifiable
customer data; if free-text classification turns out to be necessary, that is a separate,
separately authorized piece of work with its own PII-handling review.

**Automated validation:** the script was syntax-checked (`node --check`) and exercised for its
`--help` output and its fail-closed behavior with the required Tekmetric environment variables
unset (exits non-zero before making any HTTP call). No existing source file under `src/` was
modified, so build, typecheck, the offline suites, the simulated dry run, deployment-controller
fixtures, dependency audit, Markdown-link validation, environment-coverage comparison, and the
sensitive-content scan all pass unchanged.

**Accepted limitations.** The live Tekmetric run itself (PHASE 2 of the task that produced this
script) has not been executed as of this entry: it requires both an operator-supplied Tekmetric API
credential and Michael Capote's explicit statement, in his own words, that the read-only probe may
run against live Tekmetric data. Neither was present in the session that authored this script, so
no live HTTP request has been made and no data-feasibility conclusion has been reached yet. Running
it live and reporting the resulting aggregate numbers is a separate, explicitly gated follow-up.
Separately, the default request cap of 400 will likely bind before all matched vehicles' repair
orders are fetched on a real shop's data volume; when it does, the GATING NUMBER (result section 4)
is a **floor**, not the true count, and the vehicle whose pagination was interrupted when the cap
was hit has a truncated repair-order list for that run. `--max-requests` should be raised for a real
run once the shop's true vehicle/RO volume is known; the default itself was left unchanged.

**Follow-ups.** Blocking (for reaching a feasibility conclusion, not for this documentation entry):
obtain a Tekmetric API credential and Michael Capote's explicit authorization to run the probe
against live data, then run `scripts/local/tekmetric-probe.mjs` and record its aggregate output.

**Documents updated with this entry:** `docs/ROADMAP.md` (this section) only. `docs/STATUS.md` was
not updated because no production state was verified or changed. `README.md` was not updated
because the production handoff it describes is unchanged by a tool that touches no production
system.
