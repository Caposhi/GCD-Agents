# GCD-SOCIAL — Build Plan (v2)

Autonomous multi-agent social posting system. Anthropic-native (Claude Agent SDK), orchestrator–worker core with an evaluator-optimizer manager, staged autonomy ramp. This version folds in four GitHub repos as **vendored components**, not installed dependencies.

---

## Locked decisions
- **New, isolated repo.** No code shared with `gcd-webhook-server`. Separate secrets, deploy cadence, and blast radius.
- **Render**, not Vercel (long-running stateful agent runs exceed serverless timeouts). Blueprint: web service (webhook/trigger receiver) + background worker (orchestration) + Postgres (state, approval queue, brand scorecard, modification lineage).
- **Aggregator (Ayrshare)** for publishing the three platforms (Instagram, Facebook, Google Business Profile); native APIs only if a specific limit forces it.
- **Staged autonomy:** approval gate → shadow/canary → full autonomy, with promotion gates defined up front.

---

## Vendoring policy (applies to every external file)
All four repos are MIT-licensed, so copying in is fine **if** we follow this discipline. Treat every imported file as untrusted until read.

1. **Copy, don't install.** No `/plugin install` of large third-party packs. Copy the specific files into our repo under `vendor/<source>/…`.
2. **Pin to a commit.** Record source repo + commit SHA + date in `vendor/PROVENANCE.md`. Preserve each repo's MIT LICENSE/copyright notice.
3. **Read before run.** Anything containing a hook (shell on tool events) gets read line-by-line and run through AgentShield before it's wired in.
4. **No imported file may touch the guardrails.** Vendored skills can't modify the posting deny-rules, the approval gate, or the self-improvement core-objective lock.
5. **Adapt, then own.** Once adapted into a GCD-SOCIAL skill it's ours — we maintain it; we don't auto-pull upstream changes.

---

## Vendoring manifest — what comes from where

### From `affaan-m/ECC` (the main source)
| Component | ECC path | Becomes in GCD-SOCIAL | Purpose |
|---|---|---|---|
| Instinct-based self-improvement | `skills/continuous-learning-v2` (+ `/instinct-*`, `/evolve`) | `skills/self-improvement-protocol` | Review-gated propose-don't-apply learning loop |
| Eval scaffolding | `skills/eval-harness`, `skills/verification-loop` | `skills/eval-harness` | Pre-go-live validation (paper-trading equivalent) |
| State + token control | `hooks/memory-persistence`, `hooks/strategic-compact` | `hooks/` | Cross-run state; compaction to control ~15x token cost |
| Security auditor | `skills/security-scan` + `npx ecc-agentshield` | CI + Phase 0 gate | Red-team agent configs/skills/hooks/MCP for injection risk |
| Subagent context pattern | `skills/iterative-retrieval` | reference | How subagents progressively retrieve context |
| Model routing / budget | `skills/cost-aware-llm-pipeline` | `skills/model-routing` | Opus-manager / Sonnet-worker cost discipline |
| Brand voice (draft) | `skills/brand-voice` | seed for `skills/brand-voice` | Starting point — heavily rewritten for GCD |
| Multi-platform content (draft) | `skills/content-engine` | seed for `skills/platform-specs` + copywriter | Repurposing one brief across platforms |

### From `Leonxlnx/taste-skill`
| Component | Becomes | Purpose |
|---|---|---|
| Anti-slop / anti-repetition rules (em-dash ban, "no generic AI tone") | inputs to `skills/brand-voice` + copywriter subagent | Make copy sound like GCD, not a bot |
| `brandkit` image-gen skill | seed for `skills/image-brief` | Logo directions, palettes, type, identity boards |
| Image-first pipeline pattern | image-creation subagent design | Generate reference → analyze → finalize |

### From `shanraisshan/claude-code-best-practice` — reference only, nothing copied
- `orchestration-workflow` (Command → Agent → Skill) = the wiring template for manager → subagent → skill.
- Scheduled Tasks = posting-cadence trigger reference.
- Subagents / hooks / MCP / settings docs = canonical how-to while wiring.

### From `Egonex-AI/Understand-Anything` — optional internal tool
- Point it at the GCD-SOCIAL repo itself once it's large enough, to keep an onboarding/knowledge graph. Not a posting building block. (No longer needed for the repo decision — that's settled.)

---

## Revised phased build sequence

### Phase 0 — Spec, guardrails & security baseline
- Finalize architecture; write the master prompt and the `self-improvement-protocol` (propose-don't-apply, append-only guardrails, core-objective lock).
- Define promotion gates (e.g., zero compliance escalations + <10% rework over N posts before advancing each stage).
- Stand up AgentShield in CI now (`npx ecc-agentshield`) and create `vendor/PROVENANCE.md`. AgentShield gate must pass before any vendored file with a hook is wired in.

### Phase 1 — Repo & harness
- New repo, `render.yaml` Blueprint (web + worker + Postgres), Claude Agent SDK, secrets/IAM scoped to this project only.
- Harness skeleton: agent loop, context compaction (seed from ECC `strategic-compact`), state persistence (seed from ECC `memory-persistence`), error/retry, HITL interrupt hooks, cost logging (`total_cost_usd`).

### Phase 2 — Foundational skills (start from vendored drafts)
- `brand-voice` ← rewrite from ECC `brand-voice` + taste-skill anti-slop rules, anchored to real GCD materials (logo, palette, best past posts).
- `platform-specs` ← informed by ECC `content-engine`; per-platform limits and formats (IG, FB, GBP).
- `image-brief` ← seed from taste-skill `brandkit` + image-first pattern; model routing by content type (Ideogram for text-in-image, Gemini/Flux for photoreal).
- `compliance-checklist`, `posting-workflow`, `local-seo`, `analytics-readout`, `self-improvement-protocol`, `model-routing` (← ECC `cost-aware-llm-pipeline`).

### Phase 3 — Tool / MCP layer
- Ayrshare-wrapped posting tool + image-gen tool as MCP servers; clear non-overlapping definitions. Unit-test against a dedicated **test social account** (Ayrshare has no true sandbox — all calls are live).

### Phase 4 — Subagents
- Copywriter, image, platform-formatter, brand/compliance critic, hashtag/SEO+timing, analytics, posting. Restricted tools each; Sonnet workers, Opus manager. Use ECC `iterative-retrieval` as the subagent context pattern.

### Phase 5 — Manager + evaluator-optimizer loop
- Wire delegation, the critique loop (capped cycles), and the approve/reject decision. Wiring template: best-practice repo's `orchestration-workflow`.

### Phase 6 — Approval gate (Autonomy Phase A)
- `canUseTool` / `PreToolUse` hook + a **deny rule** on the posting tool (deny rules hold even in bypass mode). Run `plan`/dry-run first. Everything requires human approval.

### Phase 7 — Eval & simulation (paper-trading equivalent)
- Run simulated briefs end-to-end using ECC `eval-harness` / `verification-loop`. Watch step-by-step, tune prompts, populate the brand-quality scorecard. Promotion gate check.

### Phase 8 — Shadow / canary (Autonomy Phase B)
- Shadow mode, then canary % ramp (5 → 25 → 50 → 100) using Ayrshare `requiresApproval`. Advance only when promotion gates are met.

### Phase 9 — Full autonomy + self-improvement (Autonomy Phase C)
- Flip posting tool to auto-approve (or dynamic mode switch). Human-on-the-loop monitoring.
- Enable the review-gated self-improvement loop seeded from ECC `continuous-learning-v2`: agent extracts instincts → confidence-scored → **proposed** for your review → only promoted into skills via `/evolve` after approval. Append-only; core-objective lock enforced; AgentShield re-scans any proposed change.

---

## Still open before Phase 1 (gates writing the master prompt)
These don't block repo setup but do block the master prompt. Items 1/3/4/6 are now **resolved** (locked in `prompts/MASTER_PROMPT.md` v1.0, 2026-06-23):

1. ~~Approval-gate scope (every post vs risk-threshold).~~ **Resolved:** human approval on every post (Phase A).
2. ~~Posts/platform/week target.~~ **Resolved:** 1 post per platform per day. **Platforms = IG, FB, GBP (X/Twitter dropped).**
3. ~~Brand assets available to seed `brand-voice` / `image-brief`.~~ **Resolved:** palette + logo loaded from real artwork (`assets/brand/`, `brand-tokens.json`); skills anchored. Pending: best past posts + true vector logo reissue (current is raster-in-SVG).
4. ~~IG = Business/Creator linked to a FB Page? GBP verified 60+ days?~~ **Resolved:** confirmed ready (IG↔FB linked; GBP verified 60+ days).
5. Existing Ayrshare account? (X Developer App no longer needed — X dropped.)
6. ~~Human approver + channel (Slack/email/dashboard) for the HITL interrupt.~~ **Resolved:** `ApprovalChannel` = Slack (primary), email fallback.
7. ~~Self-improvement from day one (review-gated) or only after posting autonomy is stable?~~ **Resolved:** active from day one, review-gated / propose-only.
8. Timing agent autonomous, or fixed calendar you set?
9. Opus-for-manager acceptable, or Sonnet manager + Opus only on escalation?
10. Analytics read-access at launch (feeds self-improvement) or publish-only v1?
