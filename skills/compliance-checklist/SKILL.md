---
name: compliance-checklist
description: The actionable pass/fail checklist the brand-compliance-critic runs against every candidate package before the approval gate. Codifies the critique rubric — voice, claims, platform fit, image, accessibility, local SEO. Load for every critique pass.
---

# Compliance Checklist

The independent model gate every package must clear before it reaches the human approval queue. On every revision cycle, deterministic code runs the formatter, constructs the complete canonical preview and exact provider payloads, validates them, recursively freezes them, and only then invokes the critic. A package **passes only if deterministic validation passes and every blocking checklist issue passes**. On failure, return specific, grounded feedback to the responsible subagent (critique loop, cap 3 cycles). Authority: checked-in approved facts plus `brand-voice` for voice/claims, `image-brief` for imagery, `platform-specs` for limits, and `local-seo` for GBP.

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
- [ ] Every **specific** factual claim (price, offer, hours, capability, warranty, turnaround, opening date, address/city, stat) traces to an **approved source**. If not → cut or escalate. Never invented.
- [ ] No named-competitor disparagement (incl. dealers); contrast approach, not insults.

**Not a failure** (don't block — note at most): common abbreviations / equivalent brand names (VW ↔ Volkswagen, MINI ↔ Mini Cooper); reasonable paraphrases of approved positioning that keep the meaning; optional omission of a perk; stylistic word choice. Block only when a claim's *substance* is wrong, unsupported, or contradicts approved facts.

## 3. Platform fit (→ platform-formatter)
- [ ] Within the platform's character/format limits (`platform-specs`).
- [ ] Exact coverage of configured active platforms with no duplicates or empty provider text. Every payload carries the valid runtime-owned account/location/host/version target; tokens are absent.
- [ ] Provider-visible hashtags: Instagram has 8–15 unique tokens exactly equal to its canonical list and appended to the caption; Facebook has at most two; GBP has none.
- [ ] IG carries exactly one public HTTPS content-addressed image URL/digest with alt text and AI disclosure. Current Facebook/GBP provider payloads carry the image URL/digest only and must not imply unsupported alt/disclosure transmission.
- [ ] Review destination/text/language/media/digest/CTA and supported metadata match the exact provider payload; GBP is at most 1,500 characters, has explicit language code/topic type, and uses only an approved HTTPS CTA URL.

## 4. Image (→ image)
- [ ] On-brand palette (navy/royal + lemondrop); logo used per `image-brief` (not recolored/distorted/upscaled past native).
- [ ] The shared artifact is an inspected quality-90 JPEG no larger than 5 MiB. Runtime normalizes the request to an approved feed profile (`1080x1350`, `1080x1080`, `1200x900`, or `1200x630`; default `1080x1350`) and requires both the returned PNG/JPEG input header and transcoded JPEG output header to match it exactly before storage/hash binding. The broader safety ceilings are 4,096 pixels per side/16 million pixels. Do not claim separate platform-specific crops/renditions; the one passing artifact is shared.
- [ ] Runtime inspection has passed its strict response contract for the initial artifact and any critic-requested revision; infrastructure errors or malformed output are blocking, not review fallbacks.
- [ ] In-image text is transcribed, correct, and legible (no garbled letters); contrast-safe (no small yellow text on white).
- [ ] Nothing misleading or unsafe: no identifiable people/features, readable plates/VIN/contact/customer documents, unsafe shop practice, fake before/after, or invented promo.

## 5. Accessibility
- [ ] Meaningful EN/ES alt-text source is present for every image and Instagram's exact provider payload carries the applicable alt text. Do not require unsupported alt/disclosure fields in current Facebook/GBP payloads.
- [ ] Text contrast meets WCAG AA (4.5:1 body, 3:1 large).

## 6. Local SEO (GBP especially) (→ hashtag-seo-timing)
- [ ] GBP posts carry relevant local keywords (city/neighborhood + make + service) **without stuffing** (`local-seo`).
- [ ] NAP (name/address/phone) consistent with approved data (Hollywood, FL — 2130 Fillmore St).

## Verdict
- **PASS** → the already-built exact canonical package may be sent to the approval gate without any later content transformation.
- **FAIL** → list each failed item with the exact fix and the owning subagent; revise (cycle ≤3).
- **3× FAIL or any unsubstantiated claim that can't be sourced** → STOP without creating an approval. The runtime records escalation and may send a best-effort Slack escalation message; never ship a failing package.
