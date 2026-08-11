# Security and continuity

## Current trust findings

- `/triggers`, `/diag/ig`, and `/diag/gbp` have no authentication or rate limiting. Triggers can create model/image cost and eventual approval spam; diagnostics call providers and disclose identifiers/status.
- `/console/*` fails open when `CONSOLE_TOKEN` is empty and accepts a query-string key.
- Approval is a bearer token stored plaintext in PostgreSQL and transported in URL/query/Slack history. There is no authenticated approver identity.
- Instagram tokens and the original environment seed are persisted plaintext in `session_state`.
- Provider errors may include response text in logs/database outcomes. Review redaction before broad log access.
- Generated media is intentionally public and cached for one year; rejected images may remain stored/public.
- Image QC fails open when the vision inspector errors. Human approval remains downstream, but automation does not clearly surface an infrastructure error as a blocking decision.
- No durable publish idempotency or recovery ledger exists.

## Sensitive tracked content

`config/approved-facts.json`, brand/agent/skill content, and the master prompt intentionally contain public business identity, service, address, phone, claims, and a public booking capability URL. These are executable content inputs, not credentials. Their continued publication and accuracy require business-owner review; do not mechanically redact them and silently change marketing behavior. Personal contact fallbacks and production platform numeric IDs do not belong in current setup documentation.

The credential-history pattern scan matched an embedded raster inside a brand SVG, not a provider credential, after manual triage. Pattern scans remain incomplete evidence.

## Secret handling

Keep database URLs, Anthropic/fal keys, Slack webhooks, Meta/Google tokens and secrets, console tokens, approval tokens/links, database exports, private analytics, and unpublished packages out of Git, chat, issues, screenshots, and fixtures. Base64 and embedded JSON are not encryption.

If a credential is discovered in current files or history, revoke/rotate at the provider first, assess logs/use, then make a coordinated history-cleanup decision. Never rewrite history as an incidental documentation change.

## Private continuity register

Maintain outside Git: business/technical/social/approval/billing owners; Render team/services/domains/deploy controls; database owner/backup retention/restore evidence; every secret's storage location and last rotation; provider tenants/apps/pages/accounts/locations/scopes/test assets/revoke paths; Slack channel/webhook owners; Arcade counterpart; public site/booking ownership; incident contacts and vendor support routes. Record locations/owners, never values.

## Takeover

1. Obtain authorized source, Render, database backup, Slack, Anthropic, fal.ai, Meta, Google, Arcade, DNS/domain, and website/booking access.
2. Suspend scheduler/worker until platform identity, active platforms, autonomy phase, queue, approvals, and external posts are reconciled.
3. Rotate one boundary at a time, update all consuming services, and validate with offline/read-only checks.
4. Move persisted tokens to an encrypted/managed store before relying on long-term unattended operation.
5. Restore into isolation, then reconcile every external post/message/cost after the backup timestamp before resuming.

## Decisions required

Choose authentication/rate limits for intake/diagnostics; require console fail-closed behavior; redesign approval identity/token transport; encrypt provider tokens; define image-QC failure policy; implement durable publish idempotency and stale-brief recovery; set data/media/event retention; and assign named owners plus restore-test cadence.
