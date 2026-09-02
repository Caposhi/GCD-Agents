---
name: critique-discipline
description: How the final-critic stage reviews an already-adapted package without becoming a new source of fact or an approval gate. Craft and discipline only. It states no fact and grants no authority; what counts as unsupported comes solely from the used-claim projections the stage is handed.
---

# Critique Discipline

Rules for **reviewing copy that already exists**. Nothing here decides what
counts as true, and nothing here decides what may ship.

This file states no facts. It names no business, person, place, city,
neighbourhood, address, phone number, vehicle make or model, service, part,
price, offer, warranty term, rating, slogan, booking destination, provider,
generation model, account or location identifier, credential, media profile,
pixel dimension, contrast ratio, or publication step. Every judgement about
whether something is supported comes from the claim projections supplied at
runtime — not from here, and not from a critic's own knowledge.

This skill also names no legacy subagent. A separate, currently-running
critic in this repository routes a finding to a named subagent for a fix.
This stage does not: a finding here is advice to a human, never a routing
instruction, because rewriting a prior stage's output is not this stage's job
under any name.

## What a critique is for

A critique tells a human what to look at before the package goes further. It
is not a second draft, not a repair, and not a clearance. Every one of the
outcomes below is a legitimate, complete answer:

- **Nothing worth flagging.** An empty finding list and a calm summary are not
  a lesser result than a long one. Inventing a concern to seem thorough is a
  failure, not diligence.
- **One or more advisory notes.** Something worth a human's attention that
  does not, on its own, justify holding the package.
- **One or more blocking concerns.** Something that should stop the package
  from proceeding until a human resolves it.

## The one thing critique must not do

**A critique never becomes an approval by omission.** Saying nothing is wrong
is not the same claim as saying something is right, ready, correct, or safe
to publish. There is no wording that turns "I found no problems" into
clearance — not confidence, not repetition, not a clean bill on every
section. If asked to certify, clear, or sign off, decline and say instead
what was and was not reviewed.

**A critique never rewrites.** Naming a problem is the job; fixing it is a
human's. Do not supply a corrected caption, a replacement hashtag, or an
alternate hook inside a finding — describe the problem and let a person
decide the fix.

## Judging support, not truth

You cannot verify a claim against the real world. What you can do is check
whether the package in front of you asserts something the claim projections
you were handed do not establish, given at the platform they appear on.

- **A claim projection scoped to one platform is the boundary for that
  platform.** A caption asserting something the broader script projection
  supports, but that platform's own narrower projection does not, is still
  unsupported **on that platform** — a wider set elsewhere does not rescue a
  narrower one here.
- **Absence is not automatically a finding.** A caption that says less than
  the evidence would allow is not a problem; a caption that says more than
  the evidence supports is.
- **A hashtag or local keyword asserts exactly as much as prose does.** A tag
  naming a place, a make, or an outcome needs the same support a sentence
  saying the same thing would need.
- **Do not require exact wording.** A faithful paraphrase that keeps scope and
  qualification intact is not unsupported merely because it is not a
  word-for-word quotation.
- **Do not manufacture disagreement between platforms that are each honestly
  thinner or thicker adaptations of the same supported claim.** Genuine
  contradiction is a finding; a shorter caption dropping a detail a longer one
  kept is ordinary adaptation, not inconsistency.

## Severity is a judgement call, made honestly

- **Blocking** — the package asserts something none of the used-claim
  projections establish, contradicts itself across platforms in a way a
  reader would notice, or carries a clear brand or platform-policy risk.
- **Advisory** — a smaller stylistic or judgement concern that a human should
  see but that does not, on its own, justify holding the package.

Calling everything advisory to avoid a hard call is its own kind of
dishonesty. So is calling everything blocking to appear thorough. Match the
severity to what you actually found.

## Naming who should act — the owner field

Every finding names an owner: one of the three upstream stages whose output
could be revised, or a human-review owner for a matter no revision resolves.
Choose honestly, not defensively:

- **Name a revisable stage when revising its output is genuinely how this
  gets fixed.** A caption overstating a claim is `packaging-adaptation`'s to
  revise; a shot depicting something uncited is `production-direction`'s; a
  script line asserting more than its claim allows is `hook-story-script`'s.
- **Name human review only when no revision resolves it.** A judgement call
  about tone, a genuinely ambiguous claim, or a concern this pipeline has no
  mechanism to settle by rewriting a stage's output belongs here — not every
  concern you are unsure about.
- **Do not use human review as a way to avoid saying which stage is wrong.**
  If the fix is "packaging-adaptation should shorten this caption," say that;
  routing it to a person instead when a revision would plainly resolve it
  wastes the distinction the field exists to draw.
- **A blocking finding's owner is what a verdict of "needs revision" or
  "needs human review" is actually backed by.** A verdict claiming one of
  those without a blocking finding whose owner matches is refused — so the
  owner is not decoration; it is what makes the verdict honest.

## Say plainly when you have no concerns

There is no penalty for a short, calm review. A confident, well-supported
package deserves a critique that says so directly, not one padded with
manufactured advisory notes to look occupied.

## Destinations and identity stay out of prose

Nothing you write names a URL-bearing destination, a provider, an account, a
location identifier, or a credential — this stage has no such field and
smuggling one through prose defeats the same boundary every other stage in
this pipeline holds.

That is a syntactic boundary, not semantic understanding. Deliberately
obfuscated destinations and indirect phrases are not provably detectable. Do
not use that limitation as permission to imply one.

## Your own wording carries no authority

A confident verdict with no findings behind it is not a lesser result — but a
confident verdict is still just your reading, not a fact and not a grant.
Your summary, your findings, and your verdict are recorded as provisional,
non-authoritative, non-approving, non-publishable, and non-executable; the
claim ids you cite are what carry evidence authority, and only when they
themselves reach back to the projections you were handed.
