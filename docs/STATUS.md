# Current status

**As of:** 2026-08-24
**Evidence:** Phase 0A production discovery, read-only Render service/database metadata, current source/migrations/configuration, Phase 0D GitHub workflows/controller fixtures, and offline validation recorded below. No production setting, secret, database row, deployment, scheduler execution, approval, or provider state was changed by Phase 0D.

## Verified

- Active root: repository root; `package.json` declares Node 22 as the runtime engine.
- Declared runtime: Render API, worker, daily scheduler, and PostgreSQL.
- Five migrations create eight domain tables plus `_migrations`; migration 005 is part of the current production commit.
- Production discovery confirmed workspace `tea-d4fkclpr0fns73abmnh0`, API `srv-d8u0qtpo3t8c73c5o44g`, worker `srv-d8u0qtpo3t8c73c5o440`, scheduler `crn-d8ulb4rtqb8s73bdjctg`, PostgreSQL `dpg-d8u0qaho3t8c73c5nj40-a`, and API live commit `30d06f95f32c46f9952bc63f0bc34a6040d40a09`.
- Comprehensive `CI` runs on pull requests and `main`, using Node 22, the canonical offline suites, the existing disposable PostgreSQL harness on both PostgreSQL 16 compatibility and PostgreSQL 18 production parity, dependency/security/repository checks, gating AgentShield with always-uploaded JSON evidence, and actionlint/YAML validation.
- The separate production workflow is serialized and initially disabled. It admits only the exact successful same-repository `CI` result for a `main` push, rejects stale results after the concurrency wait before any Render command, and once explicitly cut over derives `LIVE_SHA`, handles already-current production without redeploy, blocks migration changes, and performs exact-SHA API → health → worker/startup → scheduler → final-SHA sequencing with bounded redacted failure evidence.
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
9. Native Render auto-deploy is still enabled on API, worker, and scheduler. GitHub deployment automation must remain false until all three native settings are verified off.
10. Checked-in facts override caller input but lack enforced source, confidence, freshness, and last-review metadata; define that research-reference contract before Phase 0B.
11. Production PostgreSQL external access is currently `0.0.0.0/0`; networking remediation is a separate security follow-up.
12. A generated `.DS_Store` remains tracked despite `.gitignore` and was preserved as an unrelated user change.
13. The scheduler artifact was live, but its first scheduled execution had not yet been observed during discovery.
14. External target ownership, provider host/version behavior, owners, scopes, billing, backups, and platform state remain unverified.

## Immediate follow-ups

Keep the GitHub deployment gate false until its secret/variables and `production` environment are configured, all three native Render auto-deploy settings are turned off and verified, and no migration rollout is pending. Restrict PostgreSQL external networking in a separate authorized change and observe the next normal scheduler run without manually triggering it. Then replace transitional shared-secret/token-URL mechanisms, encrypt persisted provider tokens, implement publish idempotency/reconciliation and stale-brief recovery, reconcile prompt/skill loading claims, design media/data retention and backup drills, define fact provenance/freshness before Phase 0B, and verify external ownership/configuration before expanding autonomy.

## Validation results

Phase 0D validation passed under Node 22.23.2: `npm ci` installed 105 locked packages; typecheck and build passed; posting (52), image (10), orchestrator (81), gate (56), and API (51) offline assertions passed; and the simulated dry run stayed offline. The deployment-controller suite passed literal-gate, A-before-B, B-before-A, stale-after-concurrency, current-main, already-current, missing/diverged-history, exact multi-commit migration-range, added/modified/deleted/multiple migration, serial-success, fail-closed Render-state/malformed-output, bounded-evidence, and adversarial-redaction scenarios. Disposable loopback PostgreSQL 16.15 and 18.6 containers each reused the actual Phase 0A harness: all 86 integration assertions per version passed (fresh 12, upgrade 33, durable 41), including the deliberate lock timeout and exactly-one-runner migration behavior. The dedicated production-mode compiled API then passed all 53 localhost HTTP assertions on each version with outbound fetch denied. Both containers and their databases were removed afterward.

`npm audit --omit=dev` found zero vulnerabilities; pinned AgentShield 1.4.0 scored A/100 with zero findings across its nine scoped files. Pinned actionlint 1.7.12 passed after its official archive checksum was verified; both workflows and `render.yaml` parsed. All local targets across 42 current Markdown files resolved, all 33 active/test process-variable reads were covered by the 27 runtime declarations or explicit operating-system/disposable-test classifications, and the safe-output credential/PII scan passed across 101 active tracked/untracked text files. `git diff --check`, whole-document reread, and complete diff review passed.

Read-only Render MCP inspection verified the supplied resource metadata, native auto-deploy state, health/schedule/command fields, and PostgreSQL external allowlist. No log query, production SQL, live diagnostic, model/image request, Slack message, social-provider request, production migration, approval decision, post, deployment, Render/GitHub configuration change, secret creation, commit, push, or PR occurred. The disposable tests and read-only metadata do not establish backup/restore readiness, provider ownership/scopes, live publishing behavior, or a successful future cutover; those remain explicit gates.
