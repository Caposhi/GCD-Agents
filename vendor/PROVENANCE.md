# Vendor Provenance Ledger

Every file copied from an external repo is recorded here. Rule: copy + pin to a commit SHA + preserve the source LICENSE. Nothing is bulk-installed. Anything with a hook is read line-by-line and passes AgentShield before wiring. No vendored file may touch GCD-SOCIAL guardrails.

All five sources are MIT-licensed — the four surveyed in Phase 1, and Hallmark, added 2026-10-17; keep each repo's LICENSE under `vendor/<source>/LICENSE`.

## Vendored so far (Phase 1)

Pinned source: **affaan-m/ECC @ `71d22d0a77b7e0684f4e51cba03749b788993cdb`** (default branch `main`), pulled **2026-06-23**. LICENSE preserved at `vendor/ECC/LICENSE` (MIT, © 2026 Affaan Mustafa).

AgentShield: repo scanned with `ecc-agentshield@1.4.0 scan` on 2026-06-23 → **grade A, score 100, 0 findings, exit 0**.

| GCD-SOCIAL path | Source path | Type | Commit SHA | Date | AgentShield | Notes |
|---|---|---|---|---|---|---|
| vendor/ECC/hooks/memory-persistence/ | hooks/memory-persistence | reference contract (json+md, non-exec) | `71d22d0` | 2026-06-23 | pass (A/100) | Read line-by-line. Reference lifecycle only; executables (`scripts/hooks/*.js`) intentionally NOT vendored — they feed ECC continuous-learning observers (forbidden by our propose-only guardrail). Lifecycle implemented in `src/harness/state.ts`. |
| vendor/ECC/skills/strategic-compact/ | skills/strategic-compact | skill (SKILL.md) | `71d22d0` | 2026-06-23 | pass (A/100) | **Correction:** this is a *skill*, not `hooks/strategic-compact` (which does not exist upstream). Compaction *signal* ported to `src/harness/compaction.ts`; no upstream code wired. |

`skills/self-improvement-protocol/SKILL.md` is **adapted from** ECC `skills/continuous-learning-v2` @ `71d22d0` (instinct/confidence mechanics). No upstream files were copied — it is an original GCD-SOCIAL authoring; the propose-don't-apply gate, append-only rule, and core-objective lock take precedence over upstream behavior. ECC's executable learning hooks (`observe.sh`, `session-guardian.sh`, etc.) were deliberately NOT vendored.

## Vendored so far (Hallmark, 2026-10-17)

Pinned source: **Nutlope/hallmark @ `13ac0ec7e148655948100b6396439e481361d690`**, pulled **2026-10-17**. LICENSE preserved at `vendor/hallmark/LICENSE` (MIT, © 2026 Hallmark contributors).

AgentShield: **not applicable to these files.** `ecc-agentshield@1.4.0` reads only `.js`, `.ts`, `.cjs` and `.mjs`; it read neither file below, and the repository scan's grade says nothing about them. *(2026-10-29, after merging `main`: the whole-repository scan reads **B/85, 21 findings — 0 critical, 0 high, 11 medium, 10 low — exit 0**, over 19 files, of which the only ones it actually reads are the eleven `agents/*.md`. It was **B/86, 20 findings** when these files were vendored on 2026-10-17; the move is `main`'s, from PR #134 pushing `agents/image.md` past the scanner's size threshold, and **no file this change adds or edits is in the scanner's input at all**.)* `vendor/` is also excluded from `scan:sensitive`, so these files are not machine-scanned at all. **The assurance for both is a line-by-line human read**, recorded in the pull request that added them.

| GCD-SOCIAL path | Source path | Type | Commit SHA | Date | AgentShield | Notes |
|---|---|---|---|---|---|---|
| vendor/hallmark/LICENSE | LICENSE | license (text, non-exec) | `13ac0ec` | 2026-10-17 | not scanned (text, not `.js/.ts/.cjs/.mjs`) | Read line-by-line (21 lines): the unmodified MIT text, © 2026 Hallmark contributors. sha256 `06088a8b94598626f27612dea42300154bf7be967c85d9d3eee4490cb056af7d`, equal upstream and in tree. |
| vendor/hallmark/reference-css/tokens.css | site/css/tokens.css | reference contract (css, non-exec) | `13ac0ec` | 2026-10-17 | not scanned (css, not `.js/.ts/.cjs/.mjs`) | **Only the token file was taken.** Read line-by-line (1,221 lines): custom-property declarations under `:root` and `[data-theme=...]` selectors, plus three `color-scheme` declarations — **no `url()`, no `@import`, no at-rule of any kind, no `@font-face`, no `src:`, no `data:` URI, no script**. Values are `oklch()` colours, three hex literals, lengths, `clamp()`, `cubic-bezier()`, durations and font-**family names only**; no font is fetched. sha256 `5418e4ee538f456af5112aaa59baa662f6c4209c5ff82161443683f0f848e0c7`, equal upstream and in tree. **`base.css` was deliberately NOT vendored**: it carries a Google Fonts `@import url("https://fonts.googleapis.com/...")`, an external fetch embedded in vendored bytes, which GCD-SOCIAL will not take. `components.css` and `sections.css` were not taken either — not needed for a token contract, and not read. Comments inside the file cite upstream paths (`references/themes/{carnival,lumen,hum}.md`) that are **not vendored and do not exist here**; they are inert prose, not links. **The comments also name 27 third-party brands and organizations**, listed here in full — Anthropic, Stripe, Linear, Vercel, Duolingo, PostHog, ElevenLabs, GitBook, Firecrawl, Fly.io, Modal, Granola, Adept, Cluely, Together AI, Are.na, Frieze, e-flux, Dropout TV, Stones Throw, Third Man Records, Gretel, Frame, 14islands, Floret, Botanical Interests and brilliant.org — **and one personal name, "Mathieu Triay"**, in the theme-inspiration comments. They are upstream editorial prose naming design references; none is a GCD customer, supplier, credential or claim, none is rendered by anything here, and **the file is deliberately left unedited** — the sha256 recorded earlier in this row is the byte-identity proof, and any edit would destroy it. **No Hallmark prose was copied into any GCD-authored file.** Wired into nothing: it is reference only, is loaded by no service, and is absent from `scripts/ci/live-path-manifest.json`. |

### Tracked-file hash manifest — method, recorded

The byte-identity claims in the roadmap and status records ("N of M pre-existing tracked files are byte-identical, sha256 compared before and after") are produced with a **null-safe** manifest, because two tracked brand assets carry spaces in their names — `assets/brand/GCD LOGO 2026.svg` and `assets/brand/GCD POMG Badge.svg`. The exact command is:

```sh
git ls-files -z | sort -z | xargs -0 sha256sum | sha256sum
```

`git ls-files -z` emits NUL-separated paths and `xargs -0` consumes them, so a space in a path is part of the path. **A whitespace-splitting pipeline must not be used:** `git ls-files | xargs sha256sum` splits those two paths into six words, reports six `No such file or directory` errors, and hashes 277 of the 279 tracked files — silently omitting both brand assets from the manifest it claims to cover.

**Unresolved (recorded, not reconciled):** an earlier manifest digest quoted as `0932d174…` **could not be reproduced and does not appear anywhere in this repository** — not in any tracked file, in this branch's history, or in the pull request's comments. Its generating command was never recorded, so whether it predates a tree change or came from the whitespace-splitting pipeline above cannot be determined. It is therefore **superseded, not matched**: the command above is the method of record from 2026-10-29, and any future digest must name the command that produced it. **Dated snapshot, not mutable current truth:** on this branch's final tree of 2026-10-29 that command prints `e22c58e2…` over 279 tracked files; it changes with every commit, so reproduce it rather than citing it.

## Adapted concepts, not vendored files

The current GCD-authored skills under `skills/` cite conceptual influences in their own text. No additional upstream files from ECC or taste-skill are present under `vendor/`, so placeholder provenance rows are not retained as if copies were still planned. Any future copied file must be pinned, licensed, scanned, and added to this ledger before use.

`skills/studio-design/SKILL.md` is **adapted from** Hallmark (`Nutlope/hallmark` @ `13ac0ec`) — the method of a bounded token contract themed by data attribute. **Two Hallmark files were copied verbatim and pinned** in the same change — `vendor/hallmark/LICENSE` and `vendor/hallmark/reference-css/tokens.css`, both recorded in the table above; **this skill file is not one of them.** It copies no upstream file and reproduces no upstream prose — it is an original GCD-SOCIAL authoring, the same precedent as `skills/self-improvement-protocol/SKILL.md`. Its three binding rules (no third-party requests from Studio output, no URL fetching as design work, design guidance is inert data), its accessibility floor and its `audit` posture are GCD-SOCIAL rules with no upstream counterpart — not modifications of one. No Hallmark skill, prose or executable is vendored, loaded or run here, so there is no upstream behavior for them to take precedence over. It is development-time guidance only: no registry resolves it, no stage or lens declares it, and it is wired into nothing. `vendor/hallmark/reference-css/tokens.css` is the exemplar it cites; GCD authors its own values.

Reference-only (NOT vendored): shanraisshan/claude-code-best-practice (wiring patterns), Egonex-AI/Understand-Anything (optional internal repo-mapping tool).
