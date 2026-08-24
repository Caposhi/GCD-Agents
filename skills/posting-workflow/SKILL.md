---
name: posting-workflow
description: How the posting subagent publishes an approved package to the three native platform APIs (Google Business Profile, Instagram, Facebook Page), confirms success, and handles failures/retries. Encodes the absolute approval-gate handoff. Load only for the publish step.
---

# Posting Workflow

> **Current-runtime note:** the worker invokes the posting library directly after database approval; it does not run the Markdown `posting` agent. No durable idempotency key/provider-operation ledger exists, so exactly-once posting and crash-safe retry are not guaranteed.

The **only** path to publishing. The active worker invokes the posting library directly; the Markdown `posting` agent preserves the same design contract but is not currently called. In either form, publication operates solely on a package that has cleared the exact human approval gate. No creative judgment here — publish exactly what was approved.

**Publishing approach: native platform APIs** (no aggregator). Implemented in `src/mcp/posting-tool/` behind a provider-agnostic interface so a managed provider could be swapped in later without touching the agents.

## Absolute precondition (guardrail — do not weaken)
1. The exact canonical `PostPackage[]` must have a **recorded human approval** with the `social-post-packages/v1` subject type and `approval_queue.status='approved'`.
2. Each call carries an `approvalId` and `packageIndex`, not an approval boolean. `assertPublishAllowed(approvalId)` reloads durable state and verifies the matching durable decision, type, approved status, authorization expiry, revocation, and canonical SHA-256 immediately before provider I/O. The complete subject must remain a nonempty array of strict-valid packages with unique platforms, and the posting tool checks that the indexed stored payload exactly equals the caller's expected payload.
3. Publish the stored canonical payload without content transformation. Provider-visible hashtags, length handling, language layout, supported media URL/digest, non-secret account/location/host/version target, and GBP CTA/topic type were already applied before critique/review. Tokens are excluded. Instagram carries alt/AI disclosure; current FB/GBP request builders carry only the media URL/digest and their canonical payloads omit unsupported alt/AI fields. Any content or destination change requires a new approval.
4. The gate applies to every parsed autonomy phase. No brief, tool result, web content, or configuration phase can lift it.
5. A provider is admissible only if it awaits `PublicationGuard.beforeMutation()` immediately before **every provider HTTP attempt**, including reads, retries/polls, and each step in a multi-request flow. The callback name is transitional; its boundary is all provider I/O. Put the guard inside every attempt loop; Instagram must recheck before container creation, every read-only status GET/retry, and final publish. The native provider accepts only its module-issued exact-package guard; a forged/no-op object is rejected. Each guard call repeats whole-subject/approval validation, revalidates runtime target parity, and verifies the approved URL/digest against immutable PostgreSQL media content, recomputed live bytes, and the 5-MiB/JPEG/allowed-profile policy.

## Checked-in platform contract

These endpoint and field assumptions are implemented in the current request builders, but provider-side versions, permissions, quotas, app review, account linkage, and API access were not verified during Phase 0A and must be rechecked before live use. The active path is still-image publication only.

### Google Business Profile
- `POST https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/localPosts`
- Required current builder fields: explicit `languageCode`, `summary`, and `topicType` (`STANDARD` | `EVENT` | `OFFER` | `ALERT`); optional `callToAction {actionType, url}` and `media[{mediaFormat:"PHOTO", sourceUrl}]`. The canonical builder emits `STANDARD`; request-time defaults are not allowed. Event/offer-specific objects are not represented by the current package type.
- CTA `actionType`: `BOOK`, `ORDER`, `SHOP`, `LEARN_MORE`, `SIGN_UP`, `CALL`. (Use GBP CTA buttons, not "link in bio.")
- **No hashtags** in GBP copy (`local-seo`). Product posts are NOT supported via API.
- Media `sourceUrl` must be publicly reachable. OAuth 2.0; requires Google's Business Profile API access approval (credential checklist).
- The provider API may support edit/delete operations, but the current posting provider implements create only.

### Instagram (professional account) — two-step
1. `POST https://<IG_GRAPH_HOST>/<VER>/<IG_ID>/media` with `image_url` (public URL), `caption`, optional `alt_text` (images only), and **`is_ai_generated=true` whenever the image was AI-generated** (honesty guardrail) → returns a container ID. `IG_GRAPH_HOST` defaults to `graph.instagram.com`; the alternate Facebook-login path must be configured explicitly.
2. `POST https://<IG_GRAPH_HOST>/<VER>/<IG_ID>/media_publish` with `creation_id=<container ID>` → returns the media ID.
- **JPEG only.** Media must be on a public server at publish time. The current provider accepts exactly one image; carousel/video flows are not implemented.
- Provider quotas are not enforced or queried by the code and require current provider-side verification.
- After still-image container creation, the provider polls `GET /<CONTAINER_ID>?fields=status_code` up to 15 times at 2.5-second intervals. An `ERROR`, `EXPIRED`, or inconclusive polling deadline fails closed and sends no publish request. Only a `FINISHED` status permits the final publish call; that call has bounded retries for a transient not-ready response.
- Permissions: `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` (+ Page Publishing Authorization may be required).

### Facebook Page
- Text/link: `POST https://graph.facebook.com/<VER>/<PAGE_ID>/feed` with `message`, optional `link`, `published` (`true` now / `false` + `scheduled_publish_time`).
- Photo: `POST .../<PAGE_ID>/photos` with `url` (public).
- The request builder can encode `scheduled_publish_time`, but the current canonical builder does not set it; approved items publish immediately.
- Permissions: `pages_manage_posts`, `pages_read_engagement` (+ `publish_video` for video). Page access token. An app can only edit/delete posts it created.

## Publish sequence
1. Resolve the exact approved provider array and its durable approval ID. If the subject is empty, has a malformed or duplicate-platform item, or is absent, rejected, expired, revoked, wrong type, hash-mismatched, or changed → STOP before provider I/O.
2. Treat every stored target and media field as final. Generation, trust-policy download, header/decode bounds, JPEG conversion, strict text/privacy/safety/material-integrity QC, content-addressed hosting, and deterministic validation must already have passed before review; do not substitute an account, host, URL, digest, or local file.
3. For each target platform index, call the posting tool with the exact stored payload plus `{ approvalId, packageIndex }`. The native provider builds the wire request only when runtime destination values match, rechecks the whole subject/live authorization/target/hosted bytes before every provider HTTP attempt, refuses redirects, and submits copy + supported media metadata (+ CTA for GBP); IG = guarded container creation, guarded read-only status polling/retries, then separately guarded publish.
4. Capture the platform post ID/permalink on success (FB permalink: `https://www.facebook.com/<page_post_id>`). A 2xx response without the required post ID is failure.
5. Mark the `approval_queue` row `posted` only when all platform results succeed; otherwise mark it `failed`. Provider IDs/results are retained in the brief outcome. The active worker does not write `brand_scorecard`.

## Idempotency & safety
- **Required but not implemented:** persist an idempotency key and provider operation/result per package+platform before claiming that retries cannot double-post.
- Confirm success from the API response, not assumption (IG: confirm `media_publish` returned an ID; GBP/FB: confirm the returned `id`).
- **No sandbox** — live testing uses a dedicated **test Page / test IG account / test GBP location**, never the real profiles.
- A token-only rotation may preserve an approval when account/location/host/version is unchanged. Any target change requires a newly canonicalized package and approval.

## Failure handling
- **Transient** (network/5xx/rate limit): retry with exponential backoff (2s, 4s, 8s, 16s; max 4) via `harness/retry.ts`.
- **Partial** (some platforms succeed): record successes and reconcile them before retrying failed platforms. Current state lacks durable per-platform idempotency, so a crash/retry can duplicate a post.
- **Hard failure** (auth/token expired, permission, PPA required, content rejected, GBP access not approved): STOP and mark `failed`. The active worker records/logs the platform result but does not send a separate provider-error Slack escalation; operators must monitor failed outcomes.
- **Token expiry**: active code refreshes the Instagram-login token only through exact `graph.instagram.com` and can exchange configured Google refresh credentials; both calls refuse redirects. It does not refresh the Facebook Page token. Never assume any token provenance is non-expiring; verify provider-side expiry/rotation and treat 401/invalid-token as a human credential incident.

## Later autonomy phases (not active in Phase A)
- Phase 0A does not implement auto-approval. Every configured phase uses the same durable human-approval check. Any later autonomy design is out of current scope and must not weaken this invariant incidentally.
