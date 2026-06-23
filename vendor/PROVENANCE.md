# Vendor Provenance Ledger

Every file copied from an external repo is recorded here. Rule: copy + pin to a commit SHA + preserve the source LICENSE. Nothing is bulk-installed. Anything with a hook is read line-by-line and passes AgentShield before wiring. No vendored file may touch GCD-SOCIAL guardrails.

All four sources are MIT-licensed; keep each repo's LICENSE under `vendor/<source>/LICENSE`.

## Vendored so far (Phase 1)

Pinned source: **affaan-m/ECC @ `71d22d0a77b7e0684f4e51cba03749b788993cdb`** (default branch `main`), pulled **2026-06-23**. LICENSE preserved at `vendor/ECC/LICENSE` (MIT, © 2026 Affaan Mustafa).

AgentShield: repo scanned with `ecc-agentshield@1.4.0 scan` on 2026-06-23 → **grade A, score 100, 0 findings, exit 0**.

| GCD-SOCIAL path | Source path | Type | Commit SHA | Date | AgentShield | Notes |
|---|---|---|---|---|---|---|
| vendor/ECC/hooks/memory-persistence/ | hooks/memory-persistence | reference contract (json+md, non-exec) | `71d22d0` | 2026-06-23 | pass (A/100) | Read line-by-line. Reference lifecycle only; executables (`scripts/hooks/*.js`) intentionally NOT vendored — they feed ECC continuous-learning observers (forbidden by our propose-only guardrail). Lifecycle implemented in `src/harness/state.ts`. |
| vendor/ECC/skills/strategic-compact/ | skills/strategic-compact | skill (SKILL.md) | `71d22d0` | 2026-06-23 | pass (A/100) | **Correction:** this is a *skill*, not `hooks/strategic-compact` (which does not exist upstream). Compaction *signal* ported to `src/harness/compaction.ts`; no upstream code wired. |

`skills/self-improvement-protocol/SKILL.md` is **adapted from** ECC `skills/continuous-learning-v2` @ `71d22d0` (instinct/confidence mechanics). No upstream files were copied — it is an original GCD-SOCIAL authoring; the propose-don't-apply gate, append-only rule, and core-objective lock take precedence over upstream behavior. ECC's executable learning hooks (`observe.sh`, `session-guardian.sh`, etc.) were deliberately NOT vendored.

## Planned (later phases — not yet vendored)

| GCD-SOCIAL path | Source repo | Source path | Commit SHA | Date | AgentShield | Notes |
|---|---|---|---|---|---|---|
| skills/eval-harness/ | affaan-m/ECC | skills/eval-harness, skills/verification-loop | `<TODO>` | `<TODO>` | `<TODO>` | Phase 7 validation |
| skills/model-routing/ | affaan-m/ECC | skills/cost-aware-llm-pipeline | `<TODO>` | `<TODO>` | `<TODO>` | Opus/Sonnet routing + budget (Phase 2) |
| skills/brand-voice/ (seed) | affaan-m/ECC | skills/brand-voice | `<TODO>` | `<TODO>` | `<TODO>` | Heavily rewritten for GCD (Phase 2) |
| skills/platform-specs/ (seed) | affaan-m/ECC | skills/content-engine | `<TODO>` | `<TODO>` | `<TODO>` | Repurposing patterns (Phase 2) |
| skills/brand-voice/ (anti-slop rules) | Leonxlnx/taste-skill | skills/<design-taste> | `<TODO>` | `<TODO>` | `<TODO>` | Anti-slop / anti-repetition rules only (Phase 2) |
| skills/image-brief/ (seed) | Leonxlnx/taste-skill | skills/brandkit | `<TODO>` | `<TODO>` | `<TODO>` | Brand-kit / image-first pattern (Phase 2) |

Reference-only (NOT vendored): shanraisshan/claude-code-best-practice (wiring patterns), Egonex-AI/Understand-Anything (optional internal repo-mapping tool).
