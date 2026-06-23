---
name: model-routing
description: Cost-aware model routing for GCD-SOCIAL. Which Claude model runs the manager vs each subagent, when to escalate, image-model routing, and the cost-discipline rules (critique-loop cap, one strong image, cumulative cost reporting). Load when spawning agents or budgeting a run.
---

# Model Routing

Match model power to the job. Judgment runs on Opus; mechanical work runs on Sonnet or Haiku. Adapted from ECC `cost-aware-llm-pipeline` (concept only; no code copied).

## Default routing
| Role | Model | ID | Why |
|---|---|---|---|
| **Manager** (orchestration, critique, approval decision) | Opus 4.8 | `claude-opus-4-8` | Hardest judgment in the system; the one place quality compounds. |
| **copywriter** | Sonnet 4.6 | `claude-sonnet-4-6` | Strong writing at lower cost; escalate to Opus only if it fails critique twice. |
| **brand-compliance-critic** | Sonnet 4.6 | `claude-sonnet-4-6` | Independent second opinion; bump to Opus for high-stakes/legal-adjacent claims. |
| **image** (prompt authoring) | Sonnet 4.6 | `claude-sonnet-4-6` | Image generation itself is routed separately (below). |
| **platform-formatter** | Haiku 4.5 | `claude-haiku-4-5-20251001` | Mechanical reformatting to platform limits. |
| **hashtag-seo-timing** | Sonnet 4.6 | `claude-sonnet-4-6` | Local-SEO judgment matters for GBP. |
| **analytics** | Haiku 4.5 | `claude-haiku-4-5-20251001` | Read/summarize metrics. |
| **posting** | Haiku 4.5 | `claude-haiku-4-5-20251001` | Executes an approved package; no creative judgment. |

> Open question #9: the manager defaults to Opus. If cost requires, switch to a Sonnet manager that escalates to Opus only on critique/approval decisions — change here, not in individual agents.

## Escalation triggers (worker → stronger model)
- A worker fails the critique rubric **twice** on the same package → re-run that worker one tier up.
- A claim is legal/safety-adjacent or a comparison is involved → critic runs on Opus.
- Never escalate more than one tier without manager note; never escalate the **posting** agent.

## Image-model routing (see `image-brief`)
- Text-in-image (offer cards, tips with words) → Ideogram-class (legible in-image text).
- Photoreal (shop, cars, service) → Flux/Gemini-class.
- Flat graphics → cheapest model that renders clean palette shapes.
- Prefer **one strong image** over multiple drafts. Re-generate only on a concrete critic finding.

## Cost discipline (hard)
1. **Critique loop cap: 3 cycles.** After 3 fails, escalate to human — do not keep spending.
2. **One image** per package unless a set is explicitly required; never one image agent per platform.
3. **Don't over-delegate.** A single-platform text tweak = copywriter + critic only.
4. **Track `total_cost_usd`** from each SDK result (see `harness/cost.ts`); the manager reports **cumulative run cost** in its final output (`cost_discipline` in MASTER_PROMPT).
5. Prefer Haiku for anything mechanical; don't pay Opus rates for formatting.
