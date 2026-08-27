# Credentials and deployment setup

This is a provider-setup checklist, not a credential register. Store real values in Render or an approved secret manager. Record account/owner locations privately, never token values in Git.

## Render Blueprint

1. Connect the intended repository/branch to a Render Blueprint and review `render.yaml`.
2. Confirm it proposes `gcd-social-api`, `gcd-social-worker`, `gcd-social-scheduler`, and `gcd-social-db` in the intended team/environment.
3. Enter every `sync: false` value from the private register. Confirm `AUTONOMY_PHASE=A`, explicit `ACTIVE_PLATFORMS`, a strong nonempty `CONSOLE_TOKEN`, an exact HTTPS `hooks.slack.com/services/...` webhook on the worker, a public root HTTPS `PUBLIC_BASE_URL`, and an identified `DATABASE_URL`. The worker approval-delivery flow requires the validated Slack webhook in every environment, while production additionally requires the public HTTPS origin. The API, worker, and scheduler all require and probe durable PostgreSQL plus migration-005 approval/media columns, both approval integrity constraints, and four integrity triggers at startup.
4. Back up an existing database before a migration release. The API pre-deploy runs `npm run migrate`, but the Phase 0D controller stops before API deployment whenever `LIVE_SHA..TARGET_SHA` changes `state/migrations/**`. Migration 005 is already applied; its rollout demonstrated that consumers must not race the single migration runner. For every future migration: stop worker/scheduler, take a backup, drain or revoke old/incompatible approvals, assess actual table/media volume plus data/lock/timeout effects, run exactly one migration runner/process, start only compatible services after confirmed success, and issue fresh approvals. Investigate a timeout or partial rollout rather than looping it.
5. Keep scheduler and worker suspended during any future controlled migration until account identity, canonical approved facts/CTA URLs, approval channel, public HTTPS media origin, migration state, and provider test assets are verified. The checked-in Blueprint keeps model/image/approval-webhook secrets on the worker, not the API; the API retains provider credentials only for authenticated diagnostics. Read-only discovery inspected service metadata, not secret values, so verify live secret scope separately before an authorized rollout.

## GitHub deployment controller

Read-only verification on 2026-08-24 found the GitHub `production` environment already configured with secret name `RENDER_API_KEY`, the five non-secret Render workspace/service/health variables, and the `main` deployment restriction. The secret value was not retrieved. Repository variable `RENDER_DEPLOY_AUTOMATION_ENABLED` was present and `false`, because the provenance job checks it before the deployment job enters the environment. None of this has been reverified since. Do not put the API key in a repository variable, Render service environment, local `.env`, command argument, log, or artifact.

At that same verification the live API, worker, and scheduler had native auto-deploy off. The system is deliberately between authorities: GitHub is configured but not enabled or proven. **Setting the gate is not the next step.** The worker ownership fix is merged to `main` but not deployed, and enabling automated deployment authority over an unprotected worker is the larger risk. Follow [Deployment control](DEPLOYMENT.md), which holds the authoritative ordering: reverify read-only, then perform the separately authorized manual ownership bootstrap and its handoff proof with the gate still `false`, and only afterwards consider setting the gate to exactly `true` and performing the controlled proof. Never enable both authorities. The controller blocks any new/changed migration and never runs production SQL itself.

## Instagram

Current code defaults to the Instagram-login host and requires `IG_USER_ID` plus `IG_ACCESS_TOKEN`. `IG_GRAPH_HOST` is limited to `graph.instagram.com` or `graph.facebook.com`; `GRAPH_VERSION` defaults to `v25.0`. The non-secret ID/host/version is inserted into the canonical package before model work and shown in review, while the token is excluded. Request construction and the guard before every provider HTTP attempt—including status GETs and retries—fail if runtime values differ from the approved target. Configure the provider app/account with the minimum publishing permissions and use a dedicated test professional account for live validation.

When Instagram is present in `ACTIVE_PLATFORMS`, the worker starts the startup/12-hour token job. On the default `graph.instagram.com` path it seeds/refreshes the environment token through plaintext PostgreSQL `session_state`; on the alternate `graph.facebook.com` path it returns the environment token without module-managed refresh/storage. After approval it invokes the helper only when the approved array contains Instagram. Restrict database access and prioritize encryption/managed-secret migration for the default path. App ID/secret variables from older instructions are not consumed by active code.

## Facebook Page

Set `FB_PAGE_ID` and `FB_PAGE_ACCESS_TOKEN` for an approved test/production Page with the minimum content-publishing permissions. The canonical target binds the Page ID, fixed `graph.facebook.com` host, and `GRAPH_VERSION`; tokens remain outside review. Active code does not implement Facebook token refresh and does not consume the older `FB_APP_ID` / `FB_APP_SECRET` settings. Do not assume any Page token provenance is universally non-expiring; verify expiry and rotation privately.

## Google Business Profile

Obtain Business Profile API access and enable the provider APIs required by the active endpoint. Configure OAuth with the minimum business-management scope. Prefer `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`; `GOOGLE_ACCESS_TOKEN` is only a short-lived fallback. Set `GBP_ACCOUNT_ID` and `GBP_LOCATION_ID` only after verifying the target test/production listing. Those IDs plus fixed `mybusiness.googleapis.com/v4` become the approval-bound destination; runtime mismatch blocks request construction and the guard before every provider HTTP attempt.

Provider approval, endpoint/version validity, scopes, and accessible account/location IDs are external state and must be reverified. `/diag/gbp` calls only its fixed/allowlisted live Google origins, refuses redirects, requires `CONSOLE_TOKEN`, is process-limited, and has time bounds; those controls do not authorize using it against an unidentified environment. Meta diagnostics likewise validate the exact allowlisted host and refuse redirects.

The worker attempts Google OAuth refresh after approval only when the immutable approved array contains GBP. If refresh fails it logs the error and the provider path may use `GOOGLE_ACCESS_TOKEN` as the already-loaded fallback; keep that fallback current if your rollout depends on it.

## Anthropic, image generation, Slack, and Arcade

- `ANTHROPIC_API_KEY`: model and vision calls; configure billing/spend alerts.
- `IMAGEGEN_API_KEY`: fal.ai image generation; configure spending and asset-retention expectations.
- `APPROVAL_CHANNEL_WEBHOOK`: Slack incoming webhook to a restricted approval channel. Every environment running worker approval delivery requires an exact HTTPS `hooks.slack.com/services/<a>/<b>/<c>` URL; blank is valid only when that flow is not run, such as a direct offline `createApproval` test. Delivery refuses redirects and retries use a 10-second timeout per attempt. Failed/uncertain delivery must end in confirmed revocation; failure to confirm raises a composite error requiring reconciliation. Summary text is a sanitized inert preview; only the labeled authoritative review URL/page contains the decision subject. No email fallback is implemented.
- `CONSOLE_TOKEN`: transitional shared secret for manual triggers, provider diagnostics, and Arcade console endpoints. Protected routes fail closed if it is absent. Configure the same value in the authorized Arcade consumer and send it only via `Authorization: Bearer` or `x-console-token`; query-string tokens are rejected.

Approval decision URLs contain a separate one-time random token that defaults to 24-hour expiry. Only its SHA-256 is stored in PostgreSQL after migration 005, but Slack/browser history still carries the plaintext URL. Keep the approval channel private and treat link exposure as credential exposure. Publication authorization has a separate default 24-hour lifetime and may be revoked in code; no additional environment variable configures these current constants.

Only UUID-shaped approval IDs route. Review GET and decision POST share a process-local 300 requests/minute bucket keyed by the API's direct socket address plus a 30 requests/minute bucket keyed by direct socket and approval UUID. The global bucket can become service-wide behind an unconfigured reverse proxy; neither bucket substitutes for authenticated reviewer identity.

## Safe validation

Run the offline commands in `docs/TESTING.md`. Provider validation has no assumed sandbox: use dedicated test accounts/pages/locations and explicit authority. Never run `dryrun:live`, diagnostics, scheduler/worker, migrations, approvals, or publishing merely as a smoke test.

## Rotation and takeover

For each provider, privately record account/app/page/location identity, approved host/version, scopes, credential-store location, billing owner, rotation/expiry, test assets, recovery contact, revoke path, and last verification. A token-only rotation can preserve an approval when the target is unchanged; an account/location/host/version change requires a new canonical package and human review. Rotate one boundary at a time and reconcile both sides before resuming the worker.
