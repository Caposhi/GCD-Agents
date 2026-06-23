# Vendor Provenance Ledger

Every file copied from an external repo is recorded here. Rule: copy + pin to a commit SHA + preserve the source LICENSE. Nothing is bulk-installed. Anything with a hook is read line-by-line and passes AgentShield before wiring. No vendored file may touch GCD-SOCIAL guardrails. Fill SHAs at vendoring time.

All four sources are MIT-licensed; keep each repo's LICENSE under `vendor/<source>/LICENSE`.

| GCD-SOCIAL path | Source repo | Source path | Commit SHA | Date pulled | AgentShield | Notes |
|---|---|---|---|---|---|---|
| skills/self-improvement-protocol/ | affaan-m/ECC | skills/continuous-learning-v2 | `<TODO>` | `<TODO>` | `<pass/NA>` | Mechanics reused; guardrails are ours and take precedence |
| skills/eval-harness/ | affaan-m/ECC | skills/eval-harness, skills/verification-loop | `<TODO>` | `<TODO>` | `<TODO>` | Phase 7 validation |
| hooks/memory-persistence/ | affaan-m/ECC | hooks/memory-persistence | `<TODO>` | `<TODO>` | **required** | Hook — must pass AgentShield |
| hooks/strategic-compact/ | affaan-m/ECC | hooks/strategic-compact | `<TODO>` | `<TODO>` | **required** | Hook — must pass AgentShield |
| skills/model-routing/ | affaan-m/ECC | skills/cost-aware-llm-pipeline | `<TODO>` | `<TODO>` | `<TODO>` | Opus/Sonnet routing + budget |
| skills/brand-voice/ (seed) | affaan-m/ECC | skills/brand-voice | `<TODO>` | `<TODO>` | `<TODO>` | Heavily rewritten for GCD |
| skills/platform-specs/ (seed) | affaan-m/ECC | skills/content-engine | `<TODO>` | `<TODO>` | `<TODO>` | Repurposing patterns |
| skills/brand-voice/ (anti-slop rules) | Leonxlnx/taste-skill | skills/<design-taste> | `<TODO>` | `<TODO>` | `<TODO>` | Anti-slop / anti-repetition rules only |
| skills/image-brief/ (seed) | Leonxlnx/taste-skill | skills/brandkit | `<TODO>` | `<TODO>` | `<TODO>` | Brand-kit / image-first pattern |

Reference-only (NOT vendored): shanraisshan/claude-code-best-practice (wiring patterns), Egonex-AI/Understand-Anything (optional internal repo-mapping tool).
