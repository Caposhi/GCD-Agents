# CI and Render deployment control

## Current status and authority

Phase 0D adds the deployment-control foundation only; it does not begin Phase 0B. Production discovery on 2026-08-24 confirmed workspace `tea-d4fkclpr0fns73abmnh0`, API `srv-d8u0qtpo3t8c73c5o44g`, worker `srv-d8u0qtpo3t8c73c5o440`, scheduler `crn-d8ulb4rtqb8s73bdjctg`, and PostgreSQL `dpg-d8u0qaho3t8c73c5nj40-a`. All three services followed `main` with native auto-deploy on; the API live commit was `30d06f95f32c46f9952bc63f0bc34a6040d40a09`, its health path was `/healthz`, and its pre-deploy command was `npm run migrate`. Discovery was read-only.

The Phase 0A rollout proved that concurrent native deployments are unsafe: the worker started before migration 005 completed, crashed because `approval_decisions` did not exist, and recovered only after the API migration finished. After the controlled cutover below, `.github/workflows/deploy-production.yml` is intended to be the single unattended deployment authority. Until cutover, native Render auto-deploy remains authoritative and the GitHub controller must remain disabled.

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

For an ordinary release, the controller makes one exact-SHA, wait-for-completion attempt per service, strictly in this order:

1. API; stop if its Render deploy does not reach `live`.
2. `/healthz`; require one successful credential-free HTTPS response within 12 bounded attempts.
3. Worker; require Render `live`, then bounded application logs containing the expected worker started/polling signal and no obvious crash pattern.
4. Scheduler; require Render `live` only. Deployment does not run the cron job.
5. Re-read all three live deploys and require their commit to equal `TARGET_SHA`.

No service deploys concurrently. Application deploy failures are not retried. Read-only Render status/log calls and the public health check have bounded retry behavior only.

## Failure evidence and recovery limits

The controller always writes a human-readable `$GITHUB_STEP_SUMMARY`. For a service-stage failure it records service name/ID, `LIVE_SHA`, `TARGET_SHA`, `CURRENT_MAIN_SHA`, deploy ID/status/error, timestamps, and at most 100 recent build plus 100 recent application log entries from a bounded 30-minute window. Render/API/token families, Authorization/Bearer values, Slack webhooks, OAuth/JWT values, credentialed/database URLs, query credentials, secret assignments, and email addresses are redacted; lines are length-bounded. Stage fields and logs pass through the sanitizer before Markdown output. Raw CLI stdout/stderr and raw production logs are neither echoed nor uploaded, and Phase 0D creates no diagnostic artifact because production logs can contain unpublished or customer-influenced data. Malformed CLI JSON fails closed and is not copied to the summary.

A failed release stops at its current stage. Investigation may inspect the GitHub summary and then use Render MCP read operations. Re-running a failed workflow is an explicit operator action, not an automatic redeploy loop. The automatic controller also refuses a diverged or rollback target because it requires `LIVE_SHA` to be an ancestor of `TARGET_SHA`. An application rollback therefore remains a separately authorized manual release decision. Database migrations are forward-only; neither an application rollback nor a database restore can undo posts, Slack messages, provider calls, or spend.

## GitHub configuration contract

Create these only during an explicitly authorized cutover. Prefer the `production` GitHub environment, restrict its deployment branch to `main`, and add required reviewers if operational latency permits.

| Scope | Name | Required value |
|---|---|---|
| `production` environment secret | `RENDER_API_KEY` | Render API key with only the access needed by the controller; never print or commit it |
| `production` environment variable | `RENDER_WORKSPACE_ID` | `tea-d4fkclpr0fns73abmnh0` |
| `production` environment variable | `RENDER_API_SERVICE_ID` | `srv-d8u0qtpo3t8c73c5o44g` |
| `production` environment variable | `RENDER_WORKER_SERVICE_ID` | `srv-d8u0qtpo3t8c73c5o440` |
| `production` environment variable | `RENDER_SCHEDULER_SERVICE_ID` | `crn-d8ulb4rtqb8s73bdjctg` |
| `production` environment variable | `RENDER_API_HEALTH_URL` | `https://gcd-social-api.onrender.com/healthz` |
| Repository variable | `RENDER_DEPLOY_AUTOMATION_ENABLED` | `false` until every native auto-deploy is verified off; then exactly `true` |

The enable gate must be repository-scoped because the provenance job evaluates it before entering the protected environment; an environment-only gate is unavailable there and will fail closed. The API key is not an application runtime variable and must not be copied into Render service environments. Repository/environment variables are non-secret identifiers only.

## Native auto-deploy cutover

Do not perform this piecemeal while GitHub deployment automation is enabled. The safe order deliberately permits a short period with neither authority active; it never permits both.

1. Merge and validate the CI/deployment foundation while `RENDER_DEPLOY_AUTOMATION_ENABLED=false`. The disabled production workflow is expected to refuse any qualifying run.
2. Create the `production` environment, its secret and five non-secret identifier/health variables, plus the repository-level enable variable above. Keep the gate false. Confirm the key works with read-only CLI operations in the intended workspace.
3. Install the same reviewed CLI version locally or use each service's Render Dashboard. CLI procedure:

   ```bash
   export RENDER_API_KEY='<from approved secret manager>'
   export RENDER_CLI_CONFIG_PATH='<temporary local path>'
   render workspace set tea-d4fkclpr0fns73abmnh0 --confirm -o json
   render services update srv-d8u0qtpo3t8c73c5o44g --auto-deploy=false --confirm -o json
   render services update srv-d8u0qtpo3t8c73c5o440 --auto-deploy=false --confirm -o json
   render services update crn-d8ulb4rtqb8s73bdjctg --auto-deploy=false --confirm -o json
   render services --confirm -o json
   ```

   Dashboard alternative: open each API, worker, and scheduler service, choose **Settings → Auto-Deploy → Off**, and save.
4. Verify all three returned service records by ID show `autoDeploy: "no"` and `autoDeployTrigger: "off"`. If any update or verification fails, leave the GitHub gate false and finish/reconcile the Render change first.
5. Reconfirm no Render deploy is in progress and no migration release is pending. Set `RENDER_DEPLOY_AUTOMATION_ENABLED=true` only after all three native settings are off.
6. Either re-run the last deployment workflow that was refused solely by the false gate or wait for the next eligible `main` push. Observe API health, worker startup evidence, scheduler artifact state, and the final three-SHA check.

Render's exact-commit CLI deploy does not disable native auto-deploy, which is why the cutover is a separate explicit control step. `render.yaml` intentionally does not change the live auto-deploy field in Phase 0D; do not synchronize a Blueprint as a substitute for the verified cutover.

## Recorded follow-ups

- Production PostgreSQL currently exposes external access through `0.0.0.0/0`. Restricting it is a separate security change; Phase 0D does not alter database networking.
- The Phase 0A scheduler artifact deployed successfully, but its first scheduled execution had not completed at discovery time. Do not manually run production cron merely to close this observation gap.
- Review and deliberately update the pinned Render CLI and actionlint versions/checksums; never float either download.
