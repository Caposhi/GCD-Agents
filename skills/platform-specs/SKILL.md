---
name: platform-specs
description: Per-platform limits, formats, and conventions for adapting a GCD post to each channel. Load when formatting/assembling a package. Adapted from ECC content-engine (concept only; no code copied).
---

# Platform Specs

Per-platform format conventions plus the deterministic rules the canonical builder enforces. Image sizing is detailed in `image-brief`: the current one-image flow enforces one exact reviewed shared-feed profile (`1080x1350`, `1080x1080`, `1200x900`, or `1200x630`), input/output-header parity, deterministic JPEG quality 90, and a 5 MiB output cap, but does not create platform-specific crops/renditions. Hashtag/keyword strategy lives in `local-seo` + `hashtag-seo-timing`.

**Supported platforms: Instagram, Facebook, Google Business Profile.** X/Twitter is not used. The configured active set comes from `ACTIVE_PLATFORMS`; the checked-in environment example and Render declaration currently select Instagram + Facebook while GBP access is pending. The scheduler creates one daily brief with one item per active platform; authenticated manual triggers can enqueue additional briefs. This skill governs *format*. `hashtag-seo-timing` supplies review-only time recommendations; the current canonical provider payloads do not schedule publication.

## Instagram (Business/Creator)
- Caption: up to 2,200 chars; **first ~125 chars** show before "more" — front-load the hook.
- Hashtags: a **focused 8–15** unique set (local + make + service), not 30 generic tags. The current canonical builder appends them to the caption; it does not implement first-comment placement.
- Feed images: **JPEG**, 1080×1350 (4:5) or 1080×1080 (1:1), both exact runtime-supported profiles. The current flow does not accept the 1080×1920 Stories/Reels-cover profile.
- Emoji: tasteful, sparing. Alt text required.
- "Link in bio" — no clickable links in captions.

## Facebook (Page)
- Text: long is allowed but keep it tight; front-load value. Links render a preview card.
- Hashtags: few or none; lean on local language.
- Feed images: 1080×1350 (4:5) or link image 1200×630 (1.91:1), both exact runtime-supported profiles; runtime does not make a separate Facebook rendition.
- Clickable links are fine (unlike IG).

## Google Business Profile
- **No hashtags.** Plain, local, useful language (`local-seo`).
- Length at most 1,500 chars; front-load the offer/tip.
- Use GBP CTA buttons (Book / Call / Learn more), not "link in bio."
- Feed image 1200×900 (4:3) is an exact runtime-supported profile; keep it clean and literal with minimal text overlay. Runtime does not make a separate GBP rendition.
- One clear topic per post; tie to a real service/event.

## Cross-platform assembly rules
- One brief → tailored per platform; **don't** paste identical copy everywhere (tune length, hashtags, CTA).
- **Scheduled cadence:** one daily brief, producing one tailored item per configured active platform. Manual trigger intake can add more work.
- **Bilingual (EN+ES):** IG/FB use one caption, English then Spanish. The current legacy GBP flow emits exactly one locale per brief, preferring English when available and otherwise using Spanish; a second GBP-language post is not implemented.
- Keep the core message and any claim identical across platforms; only format changes.
- Every package carries meaningful EN/ES alt-text source, and Instagram's provider payload carries the applicable alt text plus AI disclosure. Current FB/GBP payloads carry only the same inspected content-addressed image URL/digest; there is no per-platform crop/resize path. Every package records the proposed post time (`hashtag-seo-timing`) as review metadata; the current canonical builder does not put scheduling fields in generated provider payloads, so they publish immediately.
- All provider-visible formatting is finalized before critique and approval. Deterministic code applies Instagram hashtags and the GBP length cap, constructs language/media/destination/CTA fields, then rejects missing/duplicate active platforms, empty/over-limit copy, invalid language layout, invalid account/location/host/version targets, anything other than exactly one Instagram image with alt/AI disclosure, media URL/digest mismatch, an Instagram provider-visible hashtag set that is not 8–15 unique tokens exactly equal to the canonical list, more than two Facebook hashtags, any GBP hashtag, missing GBP language/topic type, unapproved CTA URLs, mismatched preview/provider content, or non-HTTPS media. Current FB/GBP request builders carry image URL/digest only, so their provider payloads omit unsupported alt/AI fields. The posting step validates and clones only; it never applies a late transform.
