# Known issues and post-MVP hardening backlog

This document is the durable record of **accepted, deferred, and closed**
hardening defects and the process for handling them. It is active documentation,
not an archive. Each entry's status governs whether its compensating controls or
closing evidence apply; a closed repository control is not thereby deployed or
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

## CC5-SYNTAX-001 — closed by whole-file SQL authority

| Field | Value |
|---|---|
| **Issue ID** | `CC5-SYNTAX-001` |
| **Category** | Syntax / grammar guard hardening; replacement-control closure |
| **Date found / closed** | Found 2026-09-11; replacement prototype independently accepted 2026-09-14 |
| **Originating PR / head** | PR #57 / `8238f37622b816e043b2f449f2b0e33da685eb58` |
| **Affected control** | Legacy `CC5` bounded grammar in `src/harness/contentIntelligence.selftest.ts` |
| **Severity / reachability** | Low; dormant, non-runtime, repository-test false negative |
| **Status** | **RESOLVED BY REPLACEMENT CONTROL — MERGED through PR #63; not deployed, enabled, or production-validated** |
| **Owner / workstream** | Hardening lane; future legitimate SQL changes require coordinated author/reviewer authority updates |

### Original reproduction and threat

At the originating head, appending any of these lines to either authoritative SQL
artifact left the complete Content Intelligence suite exiting 0:

```
-- Migration 007 remained unapplied.
-- Migration 007 has remained unapplied.
-- Migration 007 stayed unapplied.
-- Migration 007 has stayed unapplied.
-- It remained unapplied.
-- It has remained unapplied.
-- It stayed unapplied.
-- It has stayed unapplied.
```

The 8 forms against 2 files produced 16 escaping executions. `FINITE_AUX`
recognised present `remain`/`stay` forms but not their past forms, so the
classifier did not treat those predicates as assertions. The wider bypass class
was not those eight phrases alone: any unrecognised English construction could
place an unreviewed application-state claim in either authoritative SQL file
while a grammar-based test continued to pass.

### Selected replacement design

The system no longer relies on recognising arbitrary English in
`state/migrations/007_evidence_bounds.sql` or
`state/rollback/007_evidence_bounds_rollback.sql`. A closed, versioned manifest
owns exactly those two ordered paths and pins the SHA-256 of each file's **raw,
whole-file bytes**. The manifest's own raw SHA-256 is pinned independently in
`src/harness/sqlAuthority.ts` and checked before fatal UTF-8 decoding or JSON
parsing.

No SQL parsing, comment filtering, trimming, normalization, newline conversion,
or decode/re-encode step participates in artifact identity. SQL, comments,
whitespace, line endings, byte-order marks, malformed encodings, and
dollar-quoted bodies therefore all remain inside the reviewed identity. The
manifest parser rejects duplicate decoded keys recursively, including literal
and escaped-equivalent spellings, enforces a closed schema and exact ordered path
ownership, and accepts only regular files opened without following symlinks.

A legitimate SQL or comment change requires one coordinated, review-visible
change to the artifact bytes, that artifact's manifest digest, and the
independent manifest pin. Those coordinated changes are the only positive
authority-update cases. The previous comment freeze is superseded by this
stronger whole-file authority rather than removed without replacement.

### Rejected alternatives

- Continuing to expand the English recogniser was rejected because the recurring
  bypass class was unrecognised language, not one missing verb conjugation.
- Comment stripping or an executable-SQL-only digest was rejected because it
  leaves comments, whitespace, encoding, and parser-boundary bytes outside
  review authority.
- A canonical insertion zone or approved-sentence allowlist was rejected because
  placement and concatenation recreate a language/parser boundary and permit
  unreviewed bytes outside the approved block.
- A manifest that authenticates itself was rejected because coordinated manifest
  tampering would redefine the authority. Its digest is pinned outside it.
- Parsing or decoding before hashing was rejected because normalization or lossy
  decoding can collapse distinct byte sequences.
- Mutating the authoritative checkout and restoring it in a `finally` block was
  rejected because `SIGKILL`, host loss, or an uncatchable crash can bypass
  cleanup.

### Trust boundary and mutation evidence

This is **repository-content authority**, not proof of production database
state. Repository bytes establish neither application nor non-application by
themselves. Separately, **migration 007 is now production `APPLIED`**: M1 (an
API-only deployment of exact artifact `A` = `d5015236672a02bf8f58d342625c32a4f5acc8a1`)
was independently verified 2026-09-18 — see [Status](STATUS.md).

The mutation harness prepares a disposable no-Git copy, links the locked
dependencies into it, and performs every mutation, build, suite run, and
byte-for-byte restoration there. The authoritative checkout is snapshotted and
is never a mutation target. A bounded child-process proof kills the harness with
`SIGKILL` while the disposable target is actively modified, then verifies the
authoritative Git status and all captured raw bytes stayed unchanged during and
after interruption; the stranded disposable directory is explicitly removed.

The independently accepted prototype at
`0904c1ecbc682aa6e1b97f82051ab1deddf67419` contains 341 unique mutations:
339 prohibited cases and 2 coordinated-authority-update cases. The prohibited
set includes every former grammar `mustPass` case because an uncoordinated byte
change is no longer authorized. It also covers raw comment/SQL/whitespace and
encoding changes, path and schema tampering, literal and escaped-equivalent
duplicate keys, malformed UTF-8, symlinks, and cross-artifact substitution. The
two positive cases update the changed SQL digest, manifest, and external source
pin together. The packaging branch reproduced all 341 passes under Node 22.23.2,
including no-Git isolation and the bounded `SIGKILL` proof; an independent source
derivation confirmed 317 legacy plus 24 raw-identity definitions, 46 former
allowances, the 339/2 result split, and 12 captured paths. Its complete local
validation contract passed, including PostgreSQL 16.15 and 18.6 plus bound HTTP
integration, checksum-verified actionlint 1.7.12, independent YAML parsing, and
AgentShield 1.4.0 with zero critical/high findings. PR #63 subsequently merged reviewed head
`c89f38a6f11805cb609deed89ef42cf86b95931b` as
`9e1efc2ae47761f3e2d3d4230c84ff314e745ab4` (ordered parents
`1c9e89ee514c7e88189ef0c385ad6403bfd9b0ab` then that reviewed head). Post-merge CI run
`34874131925` completed five successful first-attempt jobs. Deployment workflow run
`34875056304` accepted CI provenance and then refused at the disabled-automation gate; release
selection and the zero-step serialized deployment job were skipped, so
`deployment-controller.mjs` did not run.

### Legacy checks and limitations

The bounded legacy grammar checks remain as defence-in-depth and as historical
regression coverage. They are **not semantic truth verification** and do not
recognise arbitrary English. The past `remain`/`stay` examples above may
still evade that classifier; they no longer evade repository-content authority
because any added byte fails the whole-file digest.

This control cannot prevent a reviewer-approved coordinated malicious change to
the SQL artifact, manifest digest, and external pin. It does not authenticate the
reviewer, prove that reviewed bytes were deployed, prove which migration rows
exist, or inspect a production database. Production evidence for this
replacement is **none**. All six executors remain disabled and unreachable.

### Rollback implications

Application rollback is an ordinary revert of the repository control while the
SQL artifacts remain unchanged. Reverting the control weakens repository
authority and would reopen `CC5-SYNTAX-001`; it does not apply or roll back
migration 007 and performs no production cleanup. **Migration 007 is now
production `APPLIED`, via M1** (independently verified 2026-09-18; see
[Status](STATUS.md)); its separate SQL rollback, `state/rollback/007_evidence_bounds_rollback.sql`,
remains a separately authorized database operation should it ever be needed.
The authorized recovery path if M1 must be undone is to redeploy exact
artifact `R` = `44d7336f2c75ff880cff0d8205d2fafe13eb91b5` to the API only,
leaving migration 007 applied.

### Independent inspection and follow-up ownership

The whole-file prototype was independently inspected at exact head
`0904c1ecbc682aa6e1b97f82051ab1deddf67419` with verdict
`PROTOTYPE READY FOR PR PACKAGING`. The historical prototype branch is
inspection evidence only; it remains preserved at that head and was not rebased, rewritten,
merged, deployed, or repurposed.

The independent prototype inspection and independent packaging-PR inspection are complete. PR #63
merged exactly the reviewed 10-file `+1,572/−252` scope after updated-base validation; the SQL
artifacts remained absent from its diff. Any future legitimate SQL change is owned by that change's
author and reviewer as one coordinated artifact/manifest/source-pin review. Production or migration
operations remain separately owned and separately authorized.
