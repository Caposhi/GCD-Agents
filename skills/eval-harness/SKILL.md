---
name: eval-harness
description: How to validate the current GCD-SOCIAL flow with offline self-tests and dry runs, plus the explicit boundaries around live/provider testing. Load when running evals or reviewing readiness.
---

# Eval Harness

Validation for the current Phase 0A flow. Offline checks do not publish and do
not establish provider, migration, deployment, or production readiness.

## Dry runs

`src/harness/dryrun.cli.ts` is the command boundary; it loads
`src/harness/dryrun.ts` after any simulated-mode scrub. The harness runs a brief
through the deterministic orchestrator and builds the native request shapes for
its exact provider packages without approval or posting.

- **Simulated** (`npm run dryrun`): `dryrun.cli.ts` imports only the environment-
  preparation helper statically, removes the fixed provider/model/Slack/
  database/control key list, forces `NODE_ENV=test`, and only then dynamically
  imports configuration-bearing dry-run/orchestrator modules. Injected canned
  agent, inspected-image, and dummy publication-target fixtures provide the
  other no-network boundaries. It must reach approval-ready state and build at
  least one valid request shape, even if the caller began in production mode.
- **Live** (`npm run dryrun:live`): preserves caller environment, uses no
  simulated seams, and makes real Anthropic/fal calls and spend, but still stops
  at built request shapes and never calls approval or publishing.
  Run only with explicit authority in an identified non-production environment;
  it is not a routine validation command.

## What to inspect at each stage
1. **Trusted inputs** — caller facts are discarded, checked-in canonical facts
   replace only `approvedFacts`, and scheduler fields such as make/service/theme
   remain available.
2. **Image** — model-returned URLs/provenance are ignored; generation accepts
   only direct allowlisted fal media URLs without credentials/fragments/
   nonstandard ports/redirects, bounds intermediate bytes/time, normalizes the
   request to one of four exact feed profiles, and requires input/header parity.
   It emits deterministic quality-90 JPEG at no more than 5 MiB, rechecks output
   header parity, and fails closed on strict text/privacy/safety/material-
   integrity QC for initial and critic-requested revisions.
3. **Ordering** — every revision runs formatter → canonical provider package →
   deterministic validation → recursive freeze → final critic.
4. **Package** — exact active-platform coverage, approval-bound non-secret
   destinations, language layout, provider-visible hashtag counts, content-
   addressed media digest parity, and approved GBP CTA are already final before
   critique/review; `toPostPackages` validates/clones without mutation.
5. **Approval/publication gate** — use `test:gate`, `test:api`, and
   `test:posting` for full-subject/hash/token/decision/revocation/rate/input and
   per-provider-HTTP-attempt guard behavior, including reads and retries. Do not
   create a real approval or provider post as an offline smoke test.
6. **Seam boundary** — production rejects injected agent, image resolver,
   publication target, and vision inspector implementations. Their use in this
   skill is valid only because simulated/offline execution forces test mode.

## Scorecard limitation

The dry-run report computes an in-memory scorecard-shaped summary of compliance,
cycle count, and rework. The active worker does not write `brand_scorecard`, and
no post-publish analytics or promotion evidence is persisted by this flow.

## Autonomy boundary

Phase A is the only approved operating mode. B/C parse as configuration but do
not implement promotion, canary, auto-approval, or a completed learning system;
every parsed phase uses the same durable exact-payload human approval gate.

## Validation sequence

1. Run build, typecheck, all five offline self-tests, and simulated dry run as
   listed in `docs/TESTING.md`.
2. In any environment being migrated, stop its legacy worker/scheduler first;
   that binary ignores `revoked_at` and must not coexist with migration 005.
   Test migration 005 separately in disposable PostgreSQL; it intentionally
   revokes legacy pending/approved reviews, enforces a NULL plaintext-token
   column and nonnull equal copies for bound Phase0A subjects without historical
   subject backfill, backfills media byte digests, and makes decisions/approval
   metadata/media content immutable. Include startup column/constraint/trigger
   probes, media id/MIME/bytes/digest UPDATE rejection, and rejection of every
   media DELETE.
3. Run live dry-run, Slack approval, diagnostics, or a provider post only under
   separate explicit authority with dedicated non-production accounts, spend
   limits, and external reconciliation. No provider account/linkage/readiness or
   production migration/deployment is asserted by this skill.
