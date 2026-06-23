---
name: image-brief
description: How GCD-SOCIAL plans and generates on-brand images. Defines logo/asset usage, the color palette in imagery, per-platform aspect ratios and formats, model routing by content type, and the brand-consistency checklist. Load for any image task.
---

# Image Brief

Produces brand-consistent imagery for GCD social posts. One coherent image (or set) per package — favor one strong image over many drafts. Pair every image with meaningful alt text. Read `brand-voice` for identity; full color values are in `assets/brand/brand-tokens.json`.

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

## Per-platform sizing (confirm details in `platform-specs`)
| Platform | Primary size | Ratio | Notes |
|---|---|---|---|
| Instagram feed | 1080×1350 | 4:5 | portrait wins reach; 1080×1080 1:1 also fine. **JPEG.** |
| Instagram Stories/Reels cover | 1080×1920 | 9:16 | keep text in safe center |
| Facebook feed | 1080×1350 or 1200×630 | 4:5 / 1.91:1 | |
| X (Twitter) | 1600×900 | 16:9 | note X link-cost in copy, not image |
| Google Business Profile | 1200×900 | 4:3 | clean, literal, local; no heavy text overlay |

## Honesty & safety
- Nothing misleading: don't fabricate a promotion, a price on a graphic, a fake award, or a "before/after" that didn't happen.
- No real license plates, no identifiable customers without permission.
- In-image claims follow the same Claims rules as copy (`brand-voice`): no "best/guaranteed" except the POMG slogan.

## Alt text (required)
Every image ships with concise, meaningful alt text describing what's shown (and any in-image text), in the post's language(s). Example: "Navy graphic with the German Car Depot logo and the text 'Brake fluid flush — book online.'"

## Image pre-publish checklist (the critic runs this)
1. On-brand palette (navy/royal + lemondrop), logo used per rules, not recolored/distorted?
2. Correct aspect ratio/format for the platform (IG = JPEG)?
3. In-image text correct, legible, contrast-safe — no garbled text?
4. Nothing misleading; claims compliant; no plates/identifiable people without consent?
5. Meaningful alt text present (both languages where applicable)?
