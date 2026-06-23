---
name: platform-specs
description: Per-platform limits, formats, and conventions for adapting a GCD post to each channel. Load when formatting/assembling a package. Adapted from ECC content-engine (concept only; no code copied).
---

# Platform Specs

Per-platform rules the `platform-formatter` applies. Image sizes are summarized here and detailed in `image-brief`. Hashtag/keyword strategy lives in `local-seo` + `hashtag-seo-timing`.

> **OPEN — 5th platform (BUILD_PLAN "five platforms"):** four are confirmed below (Instagram, Facebook, X, Google Business Profile). The **fifth is unconfirmed** — likely TikTok, YouTube, or LinkedIn. Specs for it are a TODO pending confirmation; do not invent one.
>
> **OPEN — cadence (question #2):** posts/platform/week is unset. This skill governs *format*, not *frequency*; scheduling cadence is configured separately once #2 is answered.

## Instagram (Business/Creator — confirmed linked)
- Caption: up to 2,200 chars; **first ~125 chars** show before "more" — front-load the hook.
- Hashtags: a **focused 8–15** set (local + make + service), not 30 generic tags. Can sit at caption end or first comment.
- Images: **JPEG**, 1080×1350 (4:5, best reach) or 1080×1080 (1:1). Stories/Reels cover 1080×1920 (9:16), keep text center-safe.
- Emoji: tasteful, sparing. Alt text required.
- "Link in bio" — no clickable links in captions.

## Facebook (Page — confirmed linked to IG)
- Text: long is allowed but keep it tight; front-load value. Links render a preview card.
- Hashtags: few or none; lean on local language.
- Images: 1080×1350 (4:5) or link image 1200×630 (1.91:1).
- Clickable links are fine (unlike IG).

## X / Twitter
- **280 characters** (free tier). Count everything.
- **Link cost:** a URL consumes ~23 chars of the budget and tends to reduce reach; note the link's cost in the package and keep copy tight. Put the essential message before the link.
- Hashtags: 1–2 max.
- Image: 1600×900 (16:9). Alt text required.

## Google Business Profile (verified 60+ days — confirmed)
- **No hashtags.** Plain, local, useful language (`local-seo`).
- Length ~1,500 chars; front-load the offer/tip.
- Use GBP CTA buttons (Book / Call / Learn more), not "link in bio."
- Image 1200×900 (4:3); clean, literal, minimal text overlay.
- One clear topic per post; tie to a real service/event.

## Cross-platform assembly rules
- One brief → tailored per platform; **don't** paste identical copy everywhere (tune length, links, hashtags, CTA).
- **Bilingual (EN+ES):** per platform, decide one combined bilingual post vs separate EN/ES posts — default: IG/FB combined caption (EN then ES), GBP separate per language, X separate (space). Confirm with cadence once #2 is set.
- Keep the core message and any claim identical across platforms; only format changes.
- Every image carries alt text; every package records the proposed post time (`hashtag-seo-timing`).
