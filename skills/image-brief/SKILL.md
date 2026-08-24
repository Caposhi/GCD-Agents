---
name: image-brief
description: How GCD-SOCIAL plans and generates on-brand images. Defines logo/asset usage, the color palette in imagery, per-platform aspect ratios and formats, model routing by content type, and the brand-consistency checklist. Load for any image task.
---

# Image Brief

Produces brand-consistent imagery for GCD social posts. The current runtime accepts one coherent image per package and shares it across active platforms. Pair it with meaningful alt text. Read `brand-voice` for identity; full color values are in `assets/brand/brand-tokens.json`.

## Brand assets (source of truth)
- **Logo:** `assets/brand/GCD LOGO 2026.svg` — royal-blue wordmark ("GERMAN CAR DEPOT") on the lemondrop-yellow disc.
- **POMG badge:** `assets/brand/GCD POMG Badge.svg` — "Peace of Mind Guaranteed."
- Both SVGs wrap **high-res embedded rasters** (logo ~2540px, POMG ~2976px). Treat as raster: scale **down** only, never upscale past native. If a crisp small-size or recolored vector is needed, escalate for a true vector reissue rather than tracing/recreating the logo.

## Logo usage rules
- **Never** recolor, distort, rotate, add effects to, or re-typeset the logo. Use the supplied files.
- Keep clear space around the disc equal to ~10% of its diameter. Don't crowd it with text or other elements.
- Place on backgrounds that preserve contrast: the logo sits well on white, navy `#182848`, or photography with a clean area. Don't place the yellow disc on a yellow field.
- Minimum legible size: don't shrink the disc below ~120px on screen.
- The POMG badge is a secondary mark — use it for trust/reassurance moments, not stacked on top of the main logo.

## Color in imagery
- Lead with **navy `#182848` / royal `#18479F`** structure + **lemondrop `#F8E000`** accents; `#FFF6C5` for soft backgrounds.
- Red `#FF0000` only as a tiny accent, never a large fill.
- Text on images: navy or royal on light; white or yellow on navy. **Never small text in yellow on white** (fails contrast — see accessibility note in tokens). Verify WCAG AA for any text baked into an image.
- No off-brand color schemes; no rainbow gradients; keep it clean and confident.

## Content types → model routing
Route by what the image needs (cost-aware; see `model-routing`):
- **Text-in-image** (offer cards, tips with words, price/CTA graphics) → a model strong at legible in-image text (e.g., Ideogram-class). In-image text must be **correct and legible** — no garbled letters.
- **Photoreal** (shop, bays, a clean European car, hands-on service) → a photoreal model (e.g., Flux/Gemini-class). Realistic, not uncanny.
- **Graphic/illustrative** (simple branded backgrounds, icons) → whatever renders clean flat shapes in palette.
Prefer real GCD photography when available over generated photoreal of the shop/team; never imply a generated image is a real photo of GCD's actual location, staff, or a specific customer car.

## Runtime-enforced shared feed profiles

The image agent may request exactly one of the four reviewed feed profiles below. Any other/malformed model size is normalized to `1080×1350`. Runtime parses the returned PNG/JPEG header before decode and rejects it unless the dimensions are an approved profile and exactly match the normalized request; the broader safety ceilings are 4,096 pixels on either side and 16 million pixels total. All active providers share that one inspected JPEG, so there is no separate crop/rendition per platform. The current flow does not support the `1080×1920` Stories/Reels-cover profile.

| Approved size | Ratio | Typical use |
|---|---|---|
| 1080×1350 | 4:5 | Default; Instagram/Facebook portrait feed |
| 1080×1080 | 1:1 | Instagram/Facebook square feed |
| 1200×900 | 4:3 | GBP/feed landscape |
| 1200×630 | 1.91:1 | Facebook/link landscape |

## Honesty & safety
- Nothing misleading: don't fabricate a promotion, a price on a graphic, a fake award, or a "before/after" that didn't happen.
- No identifiable people/features, readable license plates or VINs, contact/customer documents, or unsafe shop practices.
- In-image claims follow the same Claims rules as copy (`brand-voice`): no "best/guaranteed" except the POMG slogan.

## Runtime media boundary

The image agent returns a specification only. Runtime discards any model-authored URL, QC result, hosted flag, digest, or provenance, then calls the configured generator. The returned URL is an untrusted intermediate: only direct HTTPS `fal.media` hosts without credentials, fragments, nonstandard ports, or redirects are accepted. Downloads are limited to 30 seconds and 20 MiB, and the input header must exactly match the normalized approved profile before decode. Image content must decode; bytes are converted at deterministic JPEG quality 90, output over 5 MiB is rejected, and the output header is revalidated against that same profile before storage/hash binding. Mandatory vision inspection must return the strict `{readText, garbled, unsafe, issues}` shape, and production refuses an injected inspector runner. Inspector errors/malformed output, garbled text, identifiable people/features, readable plates/VIN/contact/customer documents, unsafe shop practice, materially misleading imagery, or exhausted attempts fail closed without approval. Initial generation and every critic-requested revision use this gate. Only passing JPEG bytes are stored at a content-addressed application URL containing their SHA-256; runtime sets the AI provenance.

## Alt text (required)
Every image ships with concise, meaningful alt text describing what's shown (and any in-image text), in the post's language(s). Example: "Navy graphic with the German Car Depot logo and the text 'Brake fluid flush — book online.'"

## Image pre-publish checklist (the critic runs this)
1. On-brand palette (navy/royal + lemondrop), logo used per rules, not recolored/distorted?
2. Runtime quality-90 JPEG conversion/output cap passed, and did both input and output headers exactly match the normalized approved feed profile? Confirm visually that the one shared composition works on every active platform; no separate crop is produced.
3. Strict runtime inspection passed; in-image text is transcribed, correct, legible, and contrast-safe — no garbled text or inspector error?
4. Nothing unsafe or misleading; claims compliant; no identifiable people/features, readable plates/VIN/contact/customer documents, unsafe shop practice, or material misrepresentation?
5. Meaningful alt text present (both languages where applicable)?
