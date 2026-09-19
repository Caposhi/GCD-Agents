---
name: model-routing
description: Cost-aware model routing for GCD-SOCIAL. Which Claude model runs the manager vs each subagent, when to escalate, image-model routing, and the cost-discipline rules (critique-loop cap, one strong image, cumulative cost reporting). Load when spawning agents or budgeting a run.
---

# Model Routing

> **Current-runtime note:** the production worker has no Opus manager call. Deterministic TypeScript invokes the listed worker models directly. The manager row describes the dormant `agentLoop.ts` harness/future design.

Match model power to the job. Judgment runs on Opus; mechanical work runs on Sonnet or Haiku. Adapted from ECC `cost-aware-llm-pipeline` (concept only; no code copied).

## Default routing
| Role | Model | ID | Why |
|---|---|---|---|
| **Manager** (orchestration, critique, approval decision) | Opus 5 | `claude-opus-5` | Hardest judgment in the system; the one place quality compounds. Dormant path — the default in `agentLoop.ts`, which no worker calls. |
| **copywriter** | Sonnet 5 | `claude-sonnet-5` | Strong writing at lower cost; escalate to Opus only if it fails critique twice. |
| **brand-compliance-critic** | Sonnet 4.6 | `claude-sonnet-4-6` | Independent second opinion; bump to Opus for high-stakes/legal-adjacent claims. **Not moved with the others** — it is the independent evaluator feeding the Phase-A approval gate and is routed separately. |
| **image** (prompt authoring) | Sonnet 5 | `claude-sonnet-5` | Image generation itself is routed separately (below). |
| **image QC inspector** (vision) | Sonnet 5 | `claude-sonnet-5` | Reads rendered pixels in `imageQc.ts`; not an agent contract, but the same routing decision. |
| **platform-formatter** | Haiku 4.5 | `claude-haiku-4-5` | Mechanical reformatting to platform limits. |
| **hashtag-seo-timing** | Sonnet 5 | `claude-sonnet-5` | Local-SEO judgment matters for GBP. |
| **analytics** | Haiku 4.5 | `claude-haiku-4-5` | Read/summarize metrics. |
| **posting** | Haiku 4.5 | `claude-haiku-4-5` | Executes an approved package; no creative judgment. |

> **Canonical ids carry no date suffix.** `claude-haiku-4-5` and `claude-haiku-4-5-20251001` name the same model at the same published rate ($1/$5 per MTok); the unsuffixed alias is canonical and is what these agents pin.

> **Thinking on this path is explicit, not inherited.** Omitting the `thinking` parameter runs **adaptive thinking** on `claude-sonnet-5` and `claude-opus-5`, and **no thinking** on `claude-haiku-4-5` and `claude-sonnet-4-6`. The legacy agent path is non-streaming, defaults to `max_tokens: 3000`, and times out at 90 seconds, and `max_tokens` bounds thinking and visible text together — so `sdk.ts` pins `thinking: { type: "disabled" }` for the ids this path routes that would otherwise think by omission (currently `claude-sonnet-5`; `claude-opus-5` is excluded because only the dormant `agentLoop.ts` manager sends it here). Changing a row above to such a model therefore changes request semantics, not just a string.

> Open question #9: the manager defaults to Opus. If cost requires, switch to a Sonnet manager that escalates to Opus only on critique/approval decisions — change here, not in individual agents.

> **Rates** (published, per million tokens, input/output): Opus 5 $5/$25 · Sonnet 5 $2/$10 · Sonnet 4.6 $3/$15 · Haiku 4.5 $1/$5. The cost meter's table in `src/harness/sdk.ts` must carry a row for every id named above, or a run's spend silently stops being counted.

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
