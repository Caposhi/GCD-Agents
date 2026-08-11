# Credentials and deployment setup

This is a provider-setup checklist, not a credential register. Store real values in Render or an approved secret manager. Record account/owner locations privately, never token values in Git.

## Render Blueprint

1. Connect the intended repository/branch to a Render Blueprint and review `render.yaml`.
2. Confirm it proposes `gcd-social-api`, `gcd-social-worker`, `gcd-social-scheduler`, and `gcd-social-db` in the intended team/environment.
3. Enter every `sync: false` value from the private register. Confirm `AUTONOMY_PHASE=A`, explicit `ACTIVE_PLATFORMS`, and a nonempty `CONSOLE_TOKEN`.
4. Back up an existing database before deployment. The API predeploy runs `npm run migrate` automatically.
5. Keep scheduler and worker suspended until account identity, approval channel, public base URL, and provider test assets are verified.

## Instagram

Current code defaults to the Instagram-login host and requires `IG_USER_ID` plus `IG_ACCESS_TOKEN`. `IG_GRAPH_HOST` and `GRAPH_VERSION` select the request host/version. Configure the provider app/account with the minimum publishing permissions and use a dedicated test professional account for live validation.

The worker seeds the environment token into PostgreSQL and periodically refreshes it. Current storage is plaintext `session_state`; restrict database access and prioritize encryption/managed-secret migration. App ID/secret variables from older instructions are not consumed by active code.

## Facebook Page

Set `FB_PAGE_ID` and `FB_PAGE_ACCESS_TOKEN` for an approved test/production Page with the minimum content-publishing permissions. Active code does not implement Facebook token refresh and does not consume the older `FB_APP_ID` / `FB_APP_SECRET` settings; track renewal/rotation privately.

## Google Business Profile

Obtain Business Profile API access and enable the provider APIs required by the active endpoint. Configure OAuth with the minimum business-management scope. Prefer `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`; `GOOGLE_ACCESS_TOKEN` is only a short-lived fallback. Set `GBP_ACCOUNT_ID` and `GBP_LOCATION_ID` only after verifying the target test/production listing.

Provider approval, endpoint/version validity, scopes, and accessible account/location IDs are external state and must be reverified. `/diag/gbp` currently calls live Google APIs and is unauthenticated; do not expose or use it until gated.

## Anthropic, image generation, Slack, and Arcade

- `ANTHROPIC_API_KEY`: model and vision calls; configure billing/spend alerts.
- `IMAGEGEN_API_KEY`: fal.ai image generation; configure spending and asset-retention expectations.
- `APPROVAL_CHANNEL_WEBHOOK`: Slack incoming webhook to a restricted approval channel. No email fallback is implemented.
- `CONSOLE_TOKEN`: shared with the Arcade server/BFF; nonempty is mandatory because console endpoints otherwise fail open.

## Safe validation

Run the offline commands in `docs/TESTING.md`. Provider validation has no assumed sandbox: use dedicated test accounts/pages/locations and explicit authority. Never run `dryrun:live`, diagnostics, scheduler/worker, migrations, approvals, or publishing merely as a smoke test.

## Rotation and takeover

For each provider, privately record account/app/page/location identity, scopes, credential-store location, billing owner, rotation/expiry, test assets, recovery contact, revoke path, and last verification. Rotate one boundary at a time and reconcile both sides before resuming the worker.
