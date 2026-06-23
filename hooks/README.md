# hooks/

GCD-SOCIAL lifecycle hooks. **Adapt, then own** (BUILD_PLAN vendoring rule #5):
we vendor the upstream *reference contracts* under `vendor/ECC/`, then implement
the behavior ourselves in `src/harness/` rather than wiring ECC's executable
hooks directly.

## Why we don't wire ECC's hooks verbatim

When vendored, ECC's actual layout differed from the BUILD_PLAN assumption:

- **`memory-persistence`** is a *reference lifecycle contract*
  (`vendor/ECC/hooks/memory-persistence/hooks.json` + README), not standalone
  code. Its executables live in ECC's `scripts/hooks/*.js`, and several
  (`observe-runner.js`, `session-activity-tracker.js`) feed ECC's
  **continuous-learning** observation loop. Importing those would pull
  autonomous learning observers into GCD-SOCIAL — which our propose-only
  self-improvement guardrail forbids
  (`skills/self-improvement-protocol/SKILL.md`). So we implement only the
  state-persistence lifecycle (`SessionStart` reload, `PreCompact` save,
  `SessionEnd` summary) ourselves in `src/harness/state.ts`, and omit the
  observers.
- **`strategic-compact` is a *skill*, not a hook**
  (`vendor/ECC/skills/strategic-compact/SKILL.md`). It is interactive guidance
  for the Claude Code CLI `/compact`. We port only its *signal* (window-scaled
  context-size threshold) into `src/harness/compaction.ts`.

## Guardrail note

No file here or in `vendor/` may loosen the approval gate, posting deny-rules,
or the self-improvement core-objective lock. Any vendored file containing an
executable hook must pass AgentShield (CI gate) and be read line-by-line before
being wired — see `vendor/PROVENANCE.md`.
