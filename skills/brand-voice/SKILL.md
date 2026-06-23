---
name: brand-voice
description: The voice, tone, language, and visual-identity rules for German Car Depot (GCD) social content. Load for every copywriting and critique task. Defines who GCD is, how it sounds, the color palette, bilingual policy, the POMG tagline exception, and the anti-slop rules that keep copy from sounding like a bot.
---

# GCD Brand Voice

German Car Depot (GCD) is an independent European-vehicle repair shop in South Florida, family-run since 1992, positioned as **"The Dealership Alternative."** Dealer-level expertise on BMW, Mercedes-Benz, Audi, VW, Porsche, Volvo, MINI and other European makes — without dealer pricing or pressure. Main shop serves greater Doral/South Florida; a second location is opening on **Wiley St, Hollywood, FL**.

This skill is the source of truth for how GCD sounds and looks. The `brand-compliance-critic` enforces it.

## Who we're talking to
European-car owners who love their car and want it cared for by people who actually know it. They're smart but not necessarily mechanics. They've felt dealer up-sells and want a shop they can trust. Talk **with** them, not down to them.

## Voice in one line
> Friendly and professional — the knowledgeable neighbor who happens to be a European-car expert and explains things in plain English.

## The five voice principles

1. **Friendly + professional.** Warm, human, helpful. We use "we" / "our team" (collective brand voice), and we speak to the reader as "you." Light, tasteful humor is welcome; never gimmicky, never goofy, never high-pressure.
2. **Expert, spoken simply.** We have deep expertise and it shows in *accuracy*, not jargon. Write at roughly a **5th-grade reading level**: short sentences, common words, active voice, one idea per sentence. Keep real names and terms (BMW, M3, timing chain, brake fluid flush) — just explain them in plain words the first time. Don't dumb down the car knowledge; do simplify the language around it.
3. **Trustworthy and straight.** No hype, no fear-mongering, no pressure. We explain the "why," give honest options, and respect the reader's wallet and intelligence.
4. **Local and proud.** We're a South Florida family shop, not a chain. Reference the community, the two locations, and the European-specialist niche naturally.
5. **Never deceptive.** Every claim is true and substantiated (see Claims rules). We never disparage named competitors, including dealers — we contrast our *approach*, not insult anyone.

## Tone by intent (it flexes, the voice doesn't)
- **Educational / tips** → patient, clear, genuinely useful.
- **Promotional / offers** → friendly and direct; the value is the hook, not pressure.
- **Community / behind-the-scenes** → warm, personable, a little playful.
- **Service reminders** → helpful and matter-of-fact, never alarmist.

## Bilingual policy (English + Spanish)
Doral/South Florida is heavily bilingual, so most posts ship in **English plus a parallel Spanish version**.
- Spanish is **localized, not literally machine-translated** — natural, conversational South-Florida Spanish that carries the same warmth and reading level.
- Keep model names, the GCD name, and "POMG" unchanged across languages.
- The Spanish version follows the *same* voice and compliance rules.
- For GBP/local SEO, include local keywords naturally in both languages (see `local-seo`).
- Platform handling (one bilingual post vs. separate EN/ES posts) is decided per platform in `platform-specs`.

## The POMG tagline — approved exception
GCD's motto is **"POMG — Peace of Mind Guaranteed."** The word "Guaranteed" is normally a banned absolute claim (see Claims), but the **exact registered slogan** is an approved brand asset and may be used verbatim.
- ✅ Allowed: "POMG — Peace of Mind Guaranteed," "POMG," "Peace of Mind."
- ❌ Not allowed: extending "guaranteed" to anything else ("guaranteed lowest price," "guaranteed fix," "results guaranteed"). The exception covers the slogan only.

## Claims rules (hard)
- No absolute or unverifiable claims: **best, #1, always, never, guaranteed** (except the POMG slogan), cheapest, perfect.
- Every factual claim — pricing, offers, hours, service capability, warranty, turnaround — must trace to an **approved source**. If it doesn't, cut it or escalate. Never invent a price, promo, or capability.
- Comparisons stay about approach ("dealer-level service without the dealer markup"), never a named competitor put-down.

## Anti-slop rules (so it doesn't read like AI)
1. **No em-dash spam.** At most one em-dash per post; prefer periods. Don't chain clauses with dashes.
2. **Ban hollow hype words:** *unleash, elevate, supercharge, game-changer, revolutionary, seamless, cutting-edge, in today's fast-paced world, look no further, nestled, testament, dive in, unlock.*
3. **No generic AI cadence.** Vary sentence length and openings. Avoid the "It's not just X, it's Y" and "Whether you're…or…" templates. Avoid rule-of-three list padding.
4. **Show, don't boast.** Concrete specifics ("a coolant flush on your 5 Series") beat adjectives ("amazing service").
5. **Emoji:** tasteful and sparing — fine on IG/FB, minimal on X, **none** on Google Business Profile. Never use emoji to replace words or stack them.
6. **No clickbait, no false urgency** ("act now!!!", "you won't believe").
7. **Punctuation:** at most one exclamation mark per post; no ALL-CAPS shouting (brand names/initialisms like BMW, POMG are fine).

## Lexicon
**Lean in:** peace of mind, European specialists, dealer alternative, honest, the right way, our team, your car, since 1992, factory-trained-level, no surprises.
**Avoid:** cheap (use "fair" / "honest pricing"), guys (use "team"), stealership / dealer insults, generic "vehicle" when "car" is warmer, hype adjectives.

## Calls to action (pick one, keep it light)
- "Book online" / "Schedule a visit"
- "Call us" / "Give us a call"
- "Stop by" (name the location when relevant: Doral or Hollywood/Wiley St)
Standardize contact details against approved sources only; never guess a phone number, hours, or the Hollywood opening date — escalate if unknown.

## Visual identity (full palette in `assets/brand/brand-tokens.json`)
| Role | Name | Hex |
|---|---|---|
| Primary | Royal Blue | `#18479F` |
| Secondary | Lemondrop Yellow | `#F8E000` |
| Secondary tint | Pale Lemon | `#FFF6C5` |
| Tertiary | Navy Blue | `#182848` |
| Accent | Red | `#FF0000` (sparing) |
| Neutral | Shadow Gray / White | `#BABABA` / `#FFFFFF` |

- Signature lockup is **royal-blue wordmark on the lemondrop disc**. Yellow is a fill/accent, **not a text color on white** (fails contrast). Use navy/royal for text.
- Logo and POMG badge live in `assets/brand/`. See `image-brief` for usage, clear-space, and generation rules.

## Quick good/bad
- ❌ "Unleash your BMW's true potential with our seamless, cutting-edge service — book now!!!"
- ✅ "Your BMW runs best when the little things stay on schedule. We'll handle the oil, brakes, and fluids the right way — no surprises. Book online when you're ready."
- ✅ (ES) "Tu BMW funciona mejor cuando el mantenimiento está al día. Nos encargamos del aceite, los frenos y los líquidos como se debe, sin sorpresas. Reserva en línea cuando quieras."

## Pre-publish voice check (the critic runs this)
1. Sounds like a knowledgeable, friendly local — not a bot? 2. ~5th-grade reading level, car terms kept but explained? 3. No banned hype words, ≤1 em-dash, ≤1 "!"? 4. Every claim substantiated; no stray "guaranteed" outside POMG? 5. Spanish version localized and on-voice? 6. CTA present and low-pressure? 7. Colors/logo used per palette rules?
