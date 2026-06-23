---
name: compliance-checklist
description: The actionable pass/fail checklist the brand-compliance-critic runs against every candidate package before the approval gate. Codifies the critique rubric — voice, claims, platform fit, image, accessibility, local SEO. Load for every critique pass.
---

# Compliance Checklist

The independent gate every package must clear before it reaches the human approval queue. A package **passes only if every section passes**. On any fail, return specific, grounded feedback to the responsible subagent (critique loop, cap 3 cycles). Authority: `brand-voice` for voice/claims, `image-brief` for imagery, `platform-specs` for limits, `local-seo` for GBP.

## 1. Voice (→ copywriter)
- [ ] Sounds like GCD: friendly, professional, plain-spoken (~5th-grade reading level), car terms kept but explained.
- [ ] No generic AI cadence ("It's not just…", "Whether you're…"), no rule-of-three padding.
- [ ] ≤1 em-dash; ≤1 exclamation mark; no ALL-CAPS shouting (brand initialisms OK).
- [ ] No banned hype words (unleash, elevate, seamless, game-changer, cutting-edge, look no further, …).
- [ ] Brand "we" / "you"; light humor OK, never gimmicky or high-pressure.
- [ ] Spanish version (when present) is localized and on-voice, not literal MT.

## 2. Claims (→ copywriter; escalate if unsure)
- [ ] No absolute/unverifiable claims: best, #1, always, never, cheapest, perfect.
- [ ] **"Guaranteed" appears ONLY inside the exact POMG slogan** — nowhere else.
- [ ] Every factual claim (price, offer, hours, capability, warranty, turnaround, opening date) traces to an **approved source**. If not → cut or escalate. Never invented.
- [ ] No named-competitor disparagement (incl. dealers); contrast approach, not insults.

## 3. Platform fit (→ platform-formatter)
- [ ] Within the platform's character/format limits (`platform-specs`).
- [ ] Hashtag count/placement correct per platform; **no hashtags on GBP**.
- [ ] IG images are **JPEG**, correct aspect ratio.

## 4. Image (→ image)
- [ ] On-brand palette (navy/royal + lemondrop); logo used per `image-brief` (not recolored/distorted/upscaled past native).
- [ ] Correct aspect ratio + format for the platform.
- [ ] In-image text correct & legible (no garbled letters); contrast-safe (no small yellow text on white).
- [ ] Nothing misleading; no real plates / identifiable people without consent; no fake before/after or invented promo.

## 5. Accessibility
- [ ] Meaningful alt text present for every image, in the post's language(s).
- [ ] Text contrast meets WCAG AA (4.5:1 body, 3:1 large).

## 6. Local SEO (GBP especially) (→ hashtag-seo-timing)
- [ ] GBP posts carry relevant local keywords (city/neighborhood + make + service) **without stuffing** (`local-seo`).
- [ ] NAP (name/address/phone) consistent with approved data; correct location (Doral vs Hollywood/Wiley St).

## Verdict
- **PASS** → assemble final package, send to approval gate.
- **FAIL** → list each failed item with the exact fix and the owning subagent; revise (cycle ≤3).
- **3× FAIL or any unsubstantiated claim that can't be sourced** → STOP, escalate to human via `ApprovalChannel`. Never ship a failing package.
