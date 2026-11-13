---
name: image-brief
description: How GCD-SOCIAL plans and generates on-brand images. Defines logo/asset usage, the color palette in imagery, per-platform aspect ratios and formats, the single text-free model route, and the brand-consistency checklist. Load for any image task.
---

# Image Brief

Produces brand-consistent imagery for GCD social posts. The current runtime accepts one coherent image per package and shares it across active platforms. **Every generated publication image is text-free:** no words, letters, numbers, logos, wordmarks, watermarks, captions, buttons or signage — the caption carries the message, the CTA and the brand name. Runtime enforces this (see *Runtime media boundary*). Pair it with meaningful alt text. Read `brand-voice` for identity; full color values are in `assets/brand/brand-tokens.json`.

## Brand assets (source of truth)
- **Logo:** `assets/brand/GCD LOGO 2026.svg` — royal-blue wordmark ("GERMAN CAR DEPOT") on the lemondrop-yellow disc.
- **POMG badge:** `assets/brand/GCD POMG Badge.svg` — "Peace of Mind Guaranteed."
- Both SVGs wrap **high-res embedded rasters** (logo ~2540px, POMG ~2976px). Treat as raster: scale **down** only, never upscale past native. If a crisp small-size or recolored vector is needed, escalate for a true vector reissue rather than tracing/recreating the logo.

## Logo usage rules
Generated publication images carry **no logo or wordmark** (they are text-free); these rules govern every other use of the supplied files.
- **Never** recolor, distort, rotate, add effects to, or re-typeset the logo. Use the supplied files.
- Keep clear space around the disc equal to ~10% of its diameter. Don't crowd it with text or other elements.
- Place on backgrounds that preserve contrast: the logo sits well on white, navy `#182848`, or photography with a clean area. Don't place the yellow disc on a yellow field.
- Minimum legible size: don't shrink the disc below ~120px on screen.
- The POMG badge is a secondary mark — use it for trust/reassurance moments, not stacked on top of the main logo.

## Color in imagery
- Lead with **navy `#182848` / royal `#18479F`** structure + **lemondrop `#F8E000`** accents; `#FFF6C5` for soft backgrounds.
- Red `#FF0000` only as a tiny accent, never a large fill.
- Generated publication images carry no text, so the brand shows through color and light, not lettering. Where text is ever set on a brand asset by hand: navy or royal on light; white or yellow on navy. **Never small text in yellow on white** (fails contrast — see accessibility note in tokens). Verify WCAG AA for any such text.
- No off-brand color schemes; no rainbow gradients; keep it clean and confident.

## Content type and model route
Every publication image is a premium, **text-free photographic composition** (a clean European car, a bay, hands-on service, a mechanical part) generated on **one route: Ideogram** (`text-graphic`, a historical name). It is the only route whose `negative_prompt` and `expand_prompt: false` were verified against the live provider schema, so runtime forces it whatever `contentType` the image agent returns. The Flux (`photoreal`) and Recraft (`graphic-vector`) routes still exist in the image tool but the publication pipeline does not use them. Offer cards, price/CTA graphics and any other word-bearing image are **not produced**: put the words in the caption. (Compositing real text onto an image in code is a separate, planned design, not built.)
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
- Generated images carry no text, so no in-image claims; the caption's claims follow the Claims rules (`brand-voice`): no "best/guaranteed" except the POMG slogan.

## Runtime media boundary

The image agent returns a specification only. Runtime discards any model-authored URL, QC result, hosted flag, digest, or provenance, then calls the configured generator. The returned URL is an untrusted intermediate: only direct HTTPS `fal.media` hosts without credentials, fragments, nonstandard ports, or redirects are accepted. Downloads are limited to 30 seconds and 20 MiB, and the input header must exactly match the normalized approved profile before decode. Image content must decode; bytes are converted at deterministic JPEG quality 90, output over 5 MiB is rejected, and the output header is revalidated against that same profile before storage/hash binding. Every attempt's prompt carries a standing no-text rule, and the image agent's `in_image_text` is ignored: generation and QC both expect **no text**. Mandatory vision inspection must return the strict `{readText, garbled, unsafe, issues}` shape, and production refuses an injected inspector runner. Inspector errors/malformed output, **any visible text (garbled or correctly spelled, the wordmark and URL included)**, identifiable people/features, readable plates/VIN/contact/customer documents, unsafe shop practice, materially misleading imagery, or exhausted attempts fail closed without approval. Initial generation and every critic-requested revision use this gate. Only passing JPEG bytes are stored at a content-addressed application URL containing their SHA-256; runtime sets the AI provenance.

## Alt text (required)
Every image ships with concise, meaningful alt text describing the scene, in the post's language(s). The image has no text, so the alt text quotes none. Example: "A technician's gloved hands fit a new brake caliper on a BMW wheel hub in a clean service bay."

## Image pre-publish checklist (the critic runs this)
1. On-brand palette (navy/royal + lemondrop) carried by color and light; no logo, wordmark or other text in the image?
2. Runtime quality-90 JPEG conversion/output cap passed, and did both input and output headers exactly match the normalized approved feed profile? Confirm visually that the one shared composition works on every active platform; no separate crop is produced.
3. Strict runtime inspection passed with **no visible text** — any in-image text, garbled or correctly spelled (wordmark and URL included), is a defect, not something to transcribe — and no inspector error?
4. Nothing unsafe or misleading; claims compliant; no identifiable people/features, readable plates/VIN/contact/customer documents, unsafe shop practice, or material misrepresentation?
5. Meaningful alt text present (both languages where applicable)?
