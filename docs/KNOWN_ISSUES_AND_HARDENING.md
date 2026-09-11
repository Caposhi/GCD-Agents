# Known issues and post-MVP hardening backlog

This document is the durable record of **accepted, deferred** defects and the
process for handling them. It is active documentation, not an archive.

An entry here is **not** a fixed defect. It is a defect that has been
**reproduced, scoped, and deliberately deferred** under named compensating
controls and a mandatory completion trigger. Nothing in this file may be read as
a claim that the underlying limitation is resolved, harmless, or
production-validated.

---

## Two-lane workflow

Work in this repository runs in two lanes.

1. **MVP delivery lane.** The primary implementer continues roadmap features.
2. **Hardening lane.** A *separate, fresh* implementer takes bounded items from
   this backlog and works with an **independent inspector**. The hardening
   implementer is not the author of the deferred finding, so the design is
   reconsidered rather than extended by reflex.

### When a finding blocks the MVP lane

A finding **blocks** the MVP lane when it affects any of:

- reachable production behaviour;
- authorization;
- publication;
- secrets;
- data integrity;
- migration safety;
- rollback safety;
- **or when it makes the current PR's stated guarantees false** unless those
  guarantees are narrowed to match reality.

A finding **may be deferred** when it is dormant or defence-in-depth **only if**
it is explicitly documented here with compensating controls and a mandatory
must-fix trigger. Silent deferral is not permitted. Narrowing the claim is not
optional: if a guarantee is overstated, the guarantee is corrected in the same
PR that defers the defect.

---

## Backlog entry template

Every deferred finding is recorded with all of the following fields.

| Field | Meaning |
|---|---|
| **Issue ID** | Stable identifier, e.g. `CC5-SYNTAX-001`. Never reused or renumbered. |
| **Date / originating PR / head** | When it was found, in which PR, at which exact commit. |
| **Exact reproduction** | Verbatim input and the observed wrong outcome. Copy-pasteable. |
| **Affected control** | The specific guard, check, or invariant that fails. |
| **Reachability and production impact** | Dormant vs production-reachable, and what an attacker or careless author could actually achieve. |
| **Severity** | Judged on reachability and blast radius, not on how surprising the bug is. |
| **Reason for deferral** | Why it is not being fixed now. |
| **Compensating control** | What holds the risk down until it is closed. |
| **Must-fix trigger** | The event that makes it mandatory. |
| **Owner / workstream** | Which lane owns it. |
| **Definition of done** | What closing evidence is required. |
| **Status and closing evidence** | Open/deferred/closed, plus the head and CI that closed it. |

### Categories

- **Syntax / grammar guard hardening** — bounded-grammar validators and their
  recognition gaps.
- **Mutation-harness integrity** — defects in the regression harness itself,
  including payloads that do not exercise what their names claim.
- **Documentation and operational-instruction parity** — active documentation or
  agent instructions that contradict the measured contract.
- **Dormant-path versus production-reachable defects** — tracking which findings
  are unreachable today and what would make them reachable.

---

## CC5-SYNTAX-001 — Past `remain`/`stay` application-state declarations

| Field | Value |
|---|---|
| **Issue ID** | `CC5-SYNTAX-001` |
| **Category** | Syntax / grammar guard hardening |
| **Date** | 2026-09-11 |
| **Originating PR** | PR #57 |
| **Originating head** | `8238f37622b816e043b2f449f2b0e33da685eb58` |
| **Affected control** | `CC5` in `src/harness/contentIntelligence.selftest.ts` |
| **Severity** | Low — dormant, non-runtime, test-only false negative |
| **Reachability** | Dormant. Not production-reachable. |
| **Status** | **OPEN — accepted and deferred** |
| **Owner / workstream** | Hardening lane (post-MVP), fresh implementer + independent inspector |

### Exact reproduction

Appending any of these lines to **either** authoritative SQL comment file leaves
the complete Content Intelligence suite **exiting 0** — `CC5` does **not**
reject them:

```
-- Migration 007 remained unapplied.
-- Migration 007 has remained unapplied.
-- Migration 007 stayed unapplied.
-- Migration 007 has stayed unapplied.
```

The equivalent **contextual-`It`** forms are part of the **same unresolved
class** and behave identically:

```
-- It remained unapplied.
-- It has remained unapplied.
-- It stayed unapplied.
-- It has stayed unapplied.
```

Reproduced at head `8238f37` against both
`state/migrations/007_evidence_bounds.sql` and
`state/rollback/007_evidence_bounds_rollback.sql`: **8 forms × 2 files = 16
executions, all escaping.** A control form
(`-- Migration 007 has been applied to production.`) was rejected in the same
run, and both files restored byte-for-byte.

**Mechanism.** `FINITE_AUX` matches `remains?` and `stays?` — the present-tense
forms only. The past forms `remained` and `stayed` match neither `FINITE_AUX`
nor `APPLICATION_VERB`, so the leftward walk collects no finite frame, the
predicate resolves to frame `none`, and it is not classified as assertive.

### Scope and impact

- This is a **false negative in the repository's `CC5` comment-validation
  test**. It is a test-only recognition gap.
- It **does not change executable SQL**. Comment-stripped SHA-256 of both 007
  scripts is identical to base.
- **Neither authoritative file currently contains any of those claims.**
- **Migration 007's production application state remains `UNKNOWN in either
  direction`**, and nothing here establishes it in either direction.
- **All six executors remain disabled and unreachable**
  (`executionEnabled: false`; `executionEnabled: true` appears zero times in
  `src/`).
- **No production route is enabled by accepting this limitation.**
- **The risk** is that a future author could add one of these unsupported
  categorical statements to an authoritative comment block **without `CC5`
  rejecting it**, leaving a false application-state claim in the repository.

This defect is **not** fixed, **not** resolved, **not** harmless, and **not**
production-validated. It is reproduced, bounded, and deferred.

### Reason for deferral

Repeated expansion of a bespoke natural-language classifier has consumed
disproportionate MVP time and has continued to expose new grammatical edge cases
with each round. The accepted direction is to **stop expanding that parser inside
PR #57** and to handle the broader control design as a separate hardening
workstream, where the approach itself can be reconsidered rather than extended
one construction at a time.

### Compensating controls

In force until this item is closed:

1. **Substantive changes to the application-state comment blocks** in migration
   007 or its rollback **require explicit independent review.**
2. Those comments **must continue to state `UNKNOWN in either direction`.**
3. **No PR may claim `CC5` provides comprehensive English or semantic
   validation.** `CC5` enforces a specifically tested bounded grammar plus
   structural invariants — nothing wider.
4. **The known reproduction forms above must remain listed in this backlog**, in
   full, so a future author can check against them directly.
5. **This limitation must be rechecked** before any production enablement, and
   before merging any future substantive modification to those authoritative
   comment blocks.

No automated control is added here: any non-trivial automation would restart the
grammar-parser work this deferral exists to stop.

### Must-fix trigger

This item becomes **mandatory** before the first of:

- **production enablement of the Content Intelligence execution chain**;
- **removal of the current comment freeze**;
- **any claim that `CC5` comprehensively rejects past/perfect application-state
  declarations.**

Until one of those occurs it may remain in the post-MVP hardening lane.

### Definition of done

The hardening implementer must **choose and document one defensible approach**.
The design is deliberately **not** predetermined here. Two examples of
defensible directions:

- a **deliberately bounded grammar** that adds the missing past/perfect forms
  together with adversarial mutations proving the new boundary; or
- a **simpler canonical-comment or approved-block invariant** that stops
  pretending to understand arbitrary English — for example, requiring the
  application-state block to match an approved canonical text exactly.

Whichever is chosen, closing this item requires **all** of:

- **paired migration and rollback regressions** — every new class asserted
  against both authoritative files;
- **mutation evidence** in the durable harness, with each target restoring
  byte-for-byte;
- **truthful documentation** — the guarantee stated must match the implemented
  behaviour, with anything unclaimed stated explicitly;
- **independent inspection** by someone other than the implementer;
- **exact-head CI** with every job green at the closing head.

### Status and closing evidence

**OPEN — accepted and deferred at head `8238f37622b816e043b2f449f2b0e33da685eb58`
(PR #57).** No grammar fix was attempted in the closeout that recorded this
entry. Closing evidence to be recorded here when the hardening lane closes it.
