---
name: eval-harness
description: How to validate GCD-SOCIAL before and during go-live — simulated and live dry runs, what to inspect at each stage, the brand scorecard, and the autonomy promotion gates. Load when running evals or deciding whether to advance an autonomy phase.
---

# Eval Harness

The pre-go-live validation loop (the "paper-trading" equivalent). Adapted in
spirit from ECC `eval-harness` / `verification-loop`. Nothing here publishes.

## Dry runs

`src/harness/dryrun.ts` runs a brief through the **real manager loop** and proves
the resulting package maps to **valid platform API requests** — without posting.

- **Simulated** (`npm run dryrun`): canned, representative agent outputs. No API
  keys. Validates the pipeline + the package→request chain + escalation paths.
- **Live**: pass the SDK runner (needs `ANTHROPIC_API_KEY` + fal key) to exercise
  the real agents. Still stops at the built requests — never publishes. Run this
  on Render (or locally with keys) and **watch each stage**.

## What to inspect at each stage
1. **Copy** — voice, reading level, claims sourced, EN+ES present.
2. **Image** — on-brand, legible in-image text, alt text present.
3. **Critic** — does it actually FAIL bad inputs? (seed a deliberately
   non-compliant brief and confirm it escalates after 3 cycles).
4. **Package** — `toPostPackages` yields one valid request per post (IG JPEG +
   public URL, GBP CTA, no hashtags on GBP).
5. **Approval** — the Slack message renders; the review link works; approve →
   publishes, reject/timeout → nothing posts.

## Brand scorecard
Each run records: platform, compliance pass/fail, critique cycles, reworked
(cycles > 1), and (post-publish) performance metrics. The scorecard is the
evidence base for the promotion gates and the propose-only self-improvement loop.

## Autonomy promotion gates (must pass before advancing a phase)
- **A → B (shadow/canary):** over the last **N≥20** posts — **zero** compliance
  escalations that reached a human as failures, and **<10% rework rate**
  (packages needing >1 critique cycle). At least one deliberate bad-brief test
  caught by the critic.
- **B → C (full autonomy):** sustained metrics through the canary ramp
  (5 → 25 → 50 → 100%) with no compliance incident and stable brand-scorecard
  quality. Human-on-the-loop monitoring in place.

Advancing a phase changes `AUTONOMY_PHASE`; the posting deny-rule + approval gate
stay in force until the phase is explicitly promoted.

## First live test (recommended sequence)
1. `npm run dryrun` (simulated) — confirm the chain is green.
2. Live dry run with real keys — inspect real copy/image; confirm requests build.
3. One real post to a **test IG/FB** via the approval flow (IG/FB are ready; GBP
   waits on Google API access). Approve in Slack, verify it posted, then iterate.
