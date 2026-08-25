# CI and Render deployment control

## Current status and authority

Phase 0D is merged and production-deployed; it does not begin Phase 0B. Read-only verification at 2026-08-24 21:32 UTC confirmed workspace `tea-d4fkclpr0fns73abmnh0`, API `srv-d8u0qtpo3t8c73c5o44g`, worker `srv-d8u0qtpo3t8c73c5o440`, scheduler `crn-d8ulb4rtqb8s73bdjctg`, and PostgreSQL `dpg-d8u0qaho3t8c73c5nj40-a`. API, worker, and scheduler were live at `10098de73667797120da8c7dfa4da83f336ff6ba`; no deploy was in progress. The exact `/healthz` identity and worker readiness marker passed, and no recent error/critical logs were observed.

### Current cutover status

| Capability | State |
|---|---|
| Phase 0D controller source | **Implemented** and merged in PR #34 |
| Current controller source in production | **Deployed** through the previous native Render mechanism |
| GitHub `production` environment | **Configured** with secret name, five non-secret variables, and `main` restriction |
| Render native auto-deploy | **Off** for API, worker, and scheduler (`autoDeploy: no`, `autoDeployTrigger: off`) |
| GitHub repository enable gate | **Disabled**: `RENDER_DEPLOY_AUTOMATION_ENABLED=false` |
| GitHub controller as production authority | **Not enabled; not proven in production** |
| Current unattended deployment authorities | **Zero, intentionally** |

The next separately authorized operation is to reverify this zero-authority/no-in-flight state, set the GitHub gate to exactly `true`, prove the already-current/no-deployment path if possible, and then prove one harmless migration-free release. Never re-enable Render native auto-deploy while GitHub control is enabled.

The Phase 0A rollout proved that concurrent native deployments are unsafe: the worker started before migration 005 completed, failed twice because `approval_decisions` did not exist, and recovered after the API migration finished. Schema-dependent services must not be released concurrently with their migration authority.

An interactive Codex task may use the official Render MCP for read-only service discovery, deploy history/details, bounded logs, metrics, and PostgreSQL metadata. MCP availability does not authorize a deploy, configuration/environment change, production SQL, approval decision, or publishing action. Those writes still require explicit authority under `AGENTS.md`. GitHub Actions uses the pinned Render CLI non-interactively instead of MCP.

## Pull-request and main CI

`.github/workflows/ci.yml` runs for pull requests targeting `main`, pushes to `main`, and manual diagnostic dispatches. A successful run requires:

- Node.js 22, `npm ci`, typecheck, build, all offline self-tests, and the simulated dry run;
- the existing Phase 0A disposable PostgreSQL harness plus the bound API HTTP suite against both PostgreSQL 16 compatibility and PostgreSQL 18 production-parity services;
- `npm audit --omit=dev`, pinned AgentShield 1.4.0, Markdown-link validation, active environment coverage, a high-confidence credential/PII scan that prints locations and categories but never matched values, and whole-tree whitespace validation; AgentShield's nonzero exit fails its required job, while an `if: always()` step retains its JSON report artifact even after scan failure;
- deployment-controller fixture tests; and
- YAML parsing plus pinned actionlint 1.7.12 with a verified archive checksum.

CI does not receive production credentials and must not call Anthropic, fal.ai, Meta, Google, Slack, publishing providers, Render, or production PostgreSQL. The PostgreSQL job uses only its disposable loopback service. The `push` trigger on `main` is required because the production workflow is gated by a successful `CI` `workflow_run` for that exact main-branch push. A manual CI dispatch never authorizes deployment.

## Production workflow

The production workflow is separate, serialized by concurrency group `production-render-deploy` with `cancel-in-progress: false`, and has read-only repository permissions. Its only trigger is completion of the workflow named `CI`. The non-secret authorization job independently requires the triggering workflow name to equal `CI`, conclusion `success`, event `push`, head branch `main`, and head repository name and numeric ID to equal this repository; it takes `TARGET_SHA` only from that triggering run. It also fails unless repository variable `RENDER_DEPLOY_AUTOMATION_ENABLED` is exactly `true`. Values such as missing, empty, `TRUE`, `1`, or `yes` fail. There is no production `workflow_dispatch`, PR/comment/issue trigger, artifact input, or caller-supplied SHA. Only after that job succeeds can the dependent job enter the GitHub `production` environment and reference `RENDER_API_KEY`.

The deployment job checks out the exact CI-tested SHA with full history and refreshes `origin/main` after acquiring the workflow's serialized concurrency slot. Immediately before any Render command, the controller resolves current `origin/main` and requires `TARGET_SHA == CURRENT_MAIN_SHA`. A result that completed out of order reports `SUPERSEDED RELEASE — NO DEPLOYMENT`, exits successfully, and does not require or invoke Render. Once a current release actually begins, a later push does not interrupt it; `cancel-in-progress: false` lets it complete coherently.

The workflow installs reviewed Render CLI 2.22.0 from the [official versioned GitHub release](https://github.com/render-oss/cli/releases/tag/v2.22.0), never from `latest` or an install script. It verifies the Linux AMD64 ZIP against pinned SHA-256 `6cdcd11897b7bd7e673317e6f4aaf041b654d818444f3b1efec7240a835f79ec` before extracting exactly one executable and authenticates only through `RENDER_API_KEY`. To upgrade, select a specific official release, review its CLI/JSON contract, independently verify the release archive digest, update the version and checksum together, and rerun controller fixtures plus workflow/YAML validation; never float the version or checksum.

After the current-main check, the controller selects and verifies the configured workspace and finds `LIVE_SHA` from the most recent API deploy whose Render status is exactly `live`. It fails closed when the target or live commit is missing from fetched repository history, when target reachability cannot be verified, or when live is not an ancestor of target. Divergence, rollback, force-push, and unknown history are not ordinary automatic releases. If API `LIVE_SHA == TARGET_SHA`, the controller confirms API, worker, and scheduler all report that target and performs no deployment; a partial three-service state fails for controlled recovery. The release range is always `LIVE_SHA..TARGET_SHA`; it never assumes `HEAD^`.

Before any deploy, the controller runs the equivalent of:

```bash
git diff --name-only "$LIVE_SHA..$TARGET_SHA" -- 'state/migrations/**'
```

Any result stops the workflow with `CONTROLLED MIGRATION ROLLOUT REQUIRED`, reports both SHAs and every changed migration path, and triggers no API, worker, scheduler, or migration action. A separately authorized migration workflow is not part of Phase 0D. The API's existing `npm run migrate` pre-deploy remains in place for ordinary releases with no new or changed migration and should find nothing pending. Exactly one migration runner remains the invariant.

For every separately authorized migration rollout: stop the worker and scheduler; take a backup; drain or revoke old/incompatible approvals; assess actual table and media volume, data changes, locks, and deadlines; run exactly one migration runner/process; investigate any timeout or partial result rather than retrying blindly; start only compatible services after confirmed success; and issue fresh approvals after migration. Do not allow another service pre-deploy or operator session to become a second migration authority.

For an ordinary release, the controller makes one exact-SHA, wait-for-completion attempt per service, strictly in this order:

1. API; stop if its Render deploy does not reach `live`.
2. API health; within 12 bounded attempts require a non-redirecting JSON response from exactly `https://gcd-social-api.onrender.com/healthz`. The required fields are `status: "ok"`, `service: "gcd-social-api"`, `state: "postgres"`, and `commit: TARGET_SHA`. HTTPS, the exact origin/path, no credentials/query/fragment, JSON content type, valid JSON, and HTTP success are mandatory. The same 10-second abort covers fetch and body read. A present Content-Length must be decimal, nonzero, and at most 4,096 bytes, but it is only an early rejection hint: the controller independently requires a nonempty BYOB byte stream, collects through a fixed 4,097-byte buffer, cancels as soon as the one-byte overflow probe arrives, and decodes the accepted bytes with fatal UTF-8 handling. Missing/non-byte-readable bodies, invalid length metadata, stream errors, aborts, malformed UTF-8, and empty bodies fail closed.
3. Worker; require Render `live`, then poll bounded recent Render CLI JSON logs up to 12 times at five-second intervals for exactly one target marker: `[worker] ready {"service":"gcd-social-worker","commit":"<TARGET_SHA>","instance":"<Render instance ID>","state":"postgres"}`; `instance` is JSON `null` when Render supplies no instance ID. Generic started/polling messages are not readiness, and old-commit events cannot qualify. After readiness, wait 10 seconds and re-read the bounded window from that event; the authoritative event must remain present, with no ambiguous restart, unknown replacement instance, or ready-instance fatal/panic/uncaught/crash/nonzero-exit evidence. Empty, malformed, conflicting, or saturated critical log windows fail closed.
4. Scheduler; require Render `live` only. Deployment does not run the cron job.
5. Re-read all three live deploys and require their commit to equal `TARGET_SHA`.

No service deploys concurrently. Application deploy failures are not retried. Read-only Render status/log calls and the public health check have bounded retry behavior only.

## Failure evidence and recovery limits

The controller always writes a human-readable `$GITHUB_STEP_SUMMARY`. For a service-stage failure it records service name/ID, `LIVE_SHA`, `TARGET_SHA`, `CURRENT_MAIN_SHA`, deploy ID/status/error, timestamps, and at most 100 recent build plus 100 recent application log entries from a bounded 30-minute window. Valid diagnostic JSON is recursively redacted by exact case-insensitive secret-bearing keys. The defensive fallback then handles the implemented mixed/escaped JSON, authorization, Slack webhook, OAuth/JWT, credentialed/database/cache URL, query credential, email, and explicit secret-key assignment forms; `:`, `=`, `=>`, and `->` separators use the same restricted key policy. Up to four percent-decoded shadows are private detection inputs only. A recognized encoded credential replaces the original diagnostic wholesale with `[REDACTED_DIAGNOSTIC]`; decoded attacker text is never emitted. Every untrusted summary value then passes through the same inert renderer, which numeric-entity encodes Markdown/HTML punctuation inside trusted static `<code>` markup. Raw CLI stdout/stderr and raw production logs are neither echoed nor uploaded, and Phase 0D creates no diagnostic artifact because production logs can contain unpublished or customer-influenced data. These layers are defense in depth for recognized forms, not proof against arbitrary future encodings or secret syntax; production summaries remain sensitive and not public-safe. Malformed CLI JSON fails closed and is not copied to the summary.

A failed release stops at its current stage. Investigation may inspect the GitHub summary and then use Render MCP read operations. Re-running a failed workflow is an explicit operator action, not an automatic redeploy loop. The automatic controller also refuses a diverged or rollback target because it requires `LIVE_SHA` to be an ancestor of `TARGET_SHA`. An application rollback therefore remains a separately authorized manual release decision. Database migrations are forward-only; neither an application rollback nor a database restore can undo posts, Slack messages, provider calls, or spend.

## GitHub configuration contract

The following configuration was verified present read-only on 2026-08-24. The secret value was not retrieved. Any future change still requires explicit authorization.

| Scope | Name | Required value |
|---|---|---|
| `production` environment secret | `RENDER_API_KEY` | Render API key with only the access needed by the controller; never print or commit it |
| `production` environment variable | `RENDER_WORKSPACE_ID` | `tea-d4fkclpr0fns73abmnh0` |
| `production` environment variable | `RENDER_API_SERVICE_ID` | `srv-d8u0qtpo3t8c73c5o44g` |
| `production` environment variable | `RENDER_WORKER_SERVICE_ID` | `srv-d8u0qtpo3t8c73c5o440` |
| `production` environment variable | `RENDER_SCHEDULER_SERVICE_ID` | `crn-d8ulb4rtqb8s73bdjctg` |
| `production` environment variable | `RENDER_API_HEALTH_URL` | `https://gcd-social-api.onrender.com/healthz` |
| Repository variable | `RENDER_DEPLOY_AUTOMATION_ENABLED` | currently `false`; next cutover step sets exactly `true` only after immediate re-verification |

The enable gate must be repository-scoped because the provenance job evaluates it before entering the protected environment; an environment-only gate is unavailable there and will fail closed. `RENDER_API_HEALTH_URL` cannot select another destination: the controller accepts only the exact reviewed value shown above. The API key is not an application runtime variable and must not be copied into Render service environments. Repository/environment variables are non-secret identifiers only.

## Deployment-authority cutover

The safe sequence never permits dual authority. Steps 1–7 are complete; steps 8–10 remain:

1. Merge and validate Phase 0D with the GitHub gate false. **Complete.**
2. Deploy Phase 0D through the previous native Render path. **Complete.**
3. Create/restrict the GitHub `production` environment. **Complete.**
4. Configure the secret name and five non-secret variables without exposing the key. **Complete.**
5. Keep the repository enable gate false. **Complete/current.**
6. Turn native Render auto-deploy off on all three services. **Complete.**
7. Verify all three settings off and no deployment/migration in flight. **Complete at the verification time above; recheck immediately before step 8.**
8. Under explicit authorization, set `RENDER_DEPLOY_AUTOMATION_ENABLED=true`. **Not done.**
9. Prove the controller against the already-current/no-deploy route if possible. **Not done.**
10. Prove one harmless migration-free real release, including exact API health, target-bound worker readiness/stabilization, scheduler artifact, and final three-SHA equality. **Not done.**

If any prerequisite changes, stop rather than enabling the second authority. Render's exact-commit CLI deploy does not disable native auto-deploy. Do not synchronize the Blueprint or re-enable a native setting as a substitute for the controlled proof.

## Recorded follow-ups

- Production PostgreSQL currently exposes external access through `0.0.0.0/0`. Restricting it is a separate security change; Phase 0D does not alter database networking.
- A normal scheduler execution succeeded on 2026-08-24 before Phase 0D deployed. The current Phase 0D scheduler artifact is live, but its next normal scheduled execution has not yet been observed. Do not manually run production cron merely to close this gap.
- Review and deliberately update the pinned Render CLI and actionlint versions/checksums; never float either download.

## Release engineering lessons

- A process marked `live` is not worker readiness. The required order is durable state initialization → mandatory initialization → release identity validation → readiness emission → queue consumption.
- Worker readiness binds service, full commit, optional instance identity, and PostgreSQL state. API health binds application plus release identity at exactly `https://gcd-social-api.onrender.com/healthz`.
- The health body is bounded during transport: 4,096 accepted bytes plus one overflow probe byte, with cancellation and fatal UTF-8 handling.
- Diagnostic redaction recursively understands structured JSON and reviewed realistic fallback/encoded secret forms. Decoded attacker content is detection-only and is never emitted.
- Runtime-controlled GitHub summary values are rendered Markdown/HTML inert.
- Independent adversarial review is a release gate, not optional polish:

  `IMPLEMENT → REAL CI → INDEPENDENT ADVERSARIAL REVIEW → SURGICAL REMEDIATION → EXACT-HEAD CI → FOCUSED RE-REVIEW → HUMAN MERGE CHECKPOINT → PRODUCTION VERIFICATION → SEPARATE AUTHORITY CUTOVER`
