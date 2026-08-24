# Current status

**As of:** 2026-08-22
**Evidence:** current Phase 0A source diff, SQL migrations, package/lockfile, Render blueprint, agent/skill/prompt Markdown, brand configuration/assets, and local validation recorded below. No production dashboard/database, shared migration, provider account, approval channel, deployment, or live call was accessed.

## Verified

- Active root: repository root; `package.json` declares Node 22 as the runtime engine.
- Declared runtime: Render API, worker, daily scheduler, and PostgreSQL.
- Five migrations create eight domain tables plus `_migrations`; migration 005 is a not-yet-deployed approval/media-integrity rollout boundary.
- Native publishing implementations exist for Instagram, Facebook, and GBP.
- Phase 0A source protects trigger/diagnostic/console routes with the existing `CONSOLE_TOKEN`, bounded input/operations, and process-local rate limits; UUID-shaped approval review/decision routes use a 300/minute direct-socket global bucket plus 30/minute per direct-socket+approval UUID.
- Exact provider content, non-secret destination, and media byte digest are constructed/validated before the final critic, then canonically hash-bound to an expiring/revocable approval. The complete subject must be nonempty, strict-valid item by item, and unique by platform before creation/decision, on durable load, and throughout publication. The posting tool validates at entry and its unforgeable native guard revalidates durable current approval/exact payload, the whole subject, runtime destination, hosted-media digest, and live 5-MiB/JPEG/allowed-profile policy immediately before every provider HTTP attempt, including reads, polls, retries, and multi-step requests; no autonomy phase or boolean bypass remains.
- Caller-supplied facts/media trust is removed from the publication path. Runtime image acquisition normalizes to four exact shared-feed profiles, requires input/output header parity, emits quality-90 JPEG under 5 MiB, and applies fail-closed QC to initial and revised artifacts.
- API, worker, and scheduler entry points require durable PostgreSQL connectivity plus migration-005 approval/media columns, both approval integrity constraints, and four integrity triggers before starting; offline in-memory state remains only for harness/self-tests and cannot publish.
- Worker approval delivery requires an exact HTTPS Slack webhook in every environment; production also validates the public HTTPS review origin. Delivery is bounded/non-redirecting, and failed/uncertain notification must produce confirmed revocation or a composite error requiring reconciliation.
- Deterministic orchestration, image generation/QC on initial and revised images, platform-gated token refresh/acquisition, content-addressed public passing media, and Arcade console feed remain in source. The still-image platform flow and one-locale GBP behavior are preserved, but new approved packages require target and media-digest fields.
- Historical phase/build/Arcade prompts were separated from current operations.

## Material risks and incomplete features

1. Approval review still transports a bearer token in Slack/browser URL history and records only a generic `human` label; revocation has no HTTP/operator UI.
2. Control routes share one secret, and their in-process direct-socket rate limits are not distributed, identity-aware, or trusted-proxy-aware.
3. Default Instagram-login tokens remain plaintext in PostgreSQL `session_state`; alternate Facebook-login token lifecycle and provider/error-data redaction need review.
4. No durable provider idempotency key/operation ledger or reconciliation.
5. Worker crashes can strand running briefs; no lease/reaper.
6. Events, approvals, and packages have no retention policy/task; migration 005 deliberately blocks every media deletion, so retention requires a reviewed forward migration.
7. Agent skill-loading/tool claims do not match runtime wiring; the master manager prompt is dormant.
8. Autonomy B/C, analytics access, scorecard writes, and self-improvement proposal writes remain incomplete and were intentionally not expanded in Phase 0A.
9. Migration 005 requires legacy worker/scheduler shutdown as a hard pre-migration gate, then controlled drain/revoke/fresh-review rollout; the legacy publisher ignores `revoked_at`, and production migration/deployment remains unverified.
10. Checked-in facts override caller input but lack enforced source, confidence, freshness, and last-review metadata; define that research-reference contract before Phase 0B.
11. External production configuration, target ownership, provider host/version behavior, owners, scopes, billing, backups, and platform state remain unverified.
12. A generated `.DS_Store` remains tracked despite `.gitignore` and was preserved as an unrelated user change.

## Immediate follow-ups

Plan a controlled migration 005 rollout only after backing up and stopping the legacy worker/scheduler as a hard gate; keep them stopped because they ignore `revoked_at`, drain/reject legacy approvals, assess the actual approval/media volume and digest backfill/locks, and use exactly one migration runner/process. Start only the compatible services, verify their consumer contract, and require fresh approvals after migration. Then replace transitional shared-secret/token-URL mechanisms, encrypt persisted provider tokens, implement publish idempotency/reconciliation and stale-brief recovery, reconcile prompt/skill loading claims, design media/data retention and backup drills, define fact provenance/freshness before Phase 0B, and verify external ownership/configuration before expanding autonomy.

## Validation results

Local Phase 0A validation passed under the declared Node 22 runtime (22.23.2): `npm ci` installed 105 packages; typecheck and build passed; posting (52), image (10), orchestrator (81), gate (56), and API (51) offline assertions all passed; the simulated dry run and the same command invoked with `NODE_ENV=production` both passed without entering live mode. A disposable loopback PostgreSQL 16.15 container exercised the actual compiled migration runner against both a fresh database and a seeded 001–004 upgrade database: 86 integration assertions passed (fresh schema 12, upgrade 33, durable application/publication boundary 41), including the deliberate 10-second lock-timeout rollback probe, concurrent decision behavior, real Jimp JPEG media, and publication through the durable guard with outbound transport stubbed. A separate production-mode compiled API process bound to `127.0.0.1` passed 53 end-to-end HTTP assertions against a disposable migrated database with a minimal secret-free environment and outbound fetch denied, including the global incomplete-header deadline, raw partial-body early-rejection socket closure, and the route parser deadline.

`npm audit --omit=dev` found zero vulnerabilities; pinned AgentShield 1.4.0 scored A/100 with zero findings; `render.yaml` parsed; all 18 local links across 41 tracked Markdown files resolved; all 27 active environment reads matched the 27 `.env.example` declarations; high-confidence credential scanning found no secret, and manual PII triage found only the checked-in public business phone plus intentional development placeholders/adversarial fake credential-bearing URLs. `git diff --check`, whole-document reread, and complete source/diff review passed. No live diagnostic, model/image request, Slack message, social-provider request, shared/production migration, API/worker/scheduler process against provider credentials, human or non-disposable approval decision, post, deploy, commit, or push was performed or substituted for these isolated checks.

The disposable tests do not establish production table size, lock availability, backup/restore readiness, public media reachability, provider account ownership/scopes, live Render settings, or real platform behavior. Those remain rollout gates; no shared or production access is authorized or claimed by this status update.
