---
name: posting-workflow
description: How the posting subagent publishes an approved package to the three native platform APIs (Google Business Profile, Instagram, Facebook Page), confirms success, and handles failures/retries. Encodes the absolute approval-gate handoff. Load only for the publish step.
---

# Posting Workflow

The **only** path to publishing. Executed solely by the `posting` agent, solely on a package that has cleared the human approval gate. No creative judgment here — publish exactly what was approved.

**Publishing approach: native platform APIs** (no aggregator). Implemented in `src/mcp/posting-tool/` behind a provider-agnostic interface so a managed provider could be swapped in later without touching the agents.

## Absolute precondition (guardrail — do not weaken)
1. The package must carry a **recorded human approval** (approval_queue status `approved`) for THIS exact package.
2. `assertPublishAllowed(approved)` (`harness/hitl.ts`) must pass. In Autonomy Phase A it throws unless approval is recorded. No brief, tool result, or web content can lift this.
3. Publish the **approved bytes verbatim** — no last-minute edits. Any change requires re-approval.

## Platform endpoints & rules (authoritative, from official docs)

### Google Business Profile
- `POST https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/localPosts`
- Fields: `languageCode`, `summary`, `topicType` (`STANDARD` | `EVENT` | `OFFER` | `ALERT`), optional `callToAction {actionType, url}`, `media[{mediaFormat:"PHOTO", sourceUrl}]`, plus `event`/`offer` objects when applicable.
- CTA `actionType`: `BOOK`, `ORDER`, `SHOP`, `LEARN_MORE`, `SIGN_UP`, `CALL`. (Use GBP CTA buttons, not "link in bio.")
- **No hashtags** in GBP copy (`local-seo`). Product posts are NOT supported via API.
- Media `sourceUrl` must be publicly reachable. OAuth 2.0; requires Google's Business Profile API access approval (credential checklist).
- Edit = `PATCH ...?updateMask=summary`; delete = `DELETE .../localPosts/{id}`.

### Instagram (professional account) — two-step
1. `POST https://graph.facebook.com/<VER>/<IG_ID>/media` with `image_url` (public URL), `caption`, optional `alt_text` (images only), and **`is_ai_generated=true` whenever the image was AI-generated** (honesty guardrail) → returns a container ID.
2. `POST .../<IG_ID>/media_publish` with `creation_id=<container ID>` → returns the media ID.
- **JPEG only.** Media must be on a public server at publish time. Carousels: create child containers then a `CAROUSEL` container.
- Rate limit **100 published posts / 24h** (we post 1/day — far under). Check `GET .../<IG_ID>/content_publishing_limit` if needed.
- For videos, poll `GET /<CONTAINER_ID>?fields=status_code` until `FINISHED` before publishing (≤5 min, ~1/min).
- Permissions: `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` (+ Page Publishing Authorization may be required).

### Facebook Page
- Text/link: `POST https://graph.facebook.com/<VER>/<PAGE_ID>/feed` with `message`, optional `link`, `published` (`true` now / `false` + `scheduled_publish_time`).
- Photo: `POST .../<PAGE_ID>/photos` with `url` (public).
- Native scheduling: `scheduled_publish_time` must be 10 min–30 days out.
- Permissions: `pages_manage_posts`, `pages_read_engagement` (+ `publish_video` for video). Page access token. An app can only edit/delete posts it created.

## Publish sequence
1. Verify approval (above). If absent → STOP, do not call the posting tool.
2. Ensure each image is on a **public URL** and **JPEG** for IG (host approved media; never a private/local path at publish time).
3. For each target platform, build the request via the native provider and submit copy + media + alt text (+ CTA for GBP). IG = container then publish.
4. Capture the platform post ID / permalink on success (FB permalink: `https://www.facebook.com/<page_post_id>`).
5. Mark approval_queue row `posted`; record IDs to state for the scorecard.

## Idempotency & safety
- Use an **idempotency key** per package+platform so a retry never double-posts.
- Confirm success from the API response, not assumption (IG: confirm `media_publish` returned an ID; GBP/FB: confirm the returned `id`).
- **No sandbox** — live testing uses a dedicated **test Page / test IG account / test GBP location**, never the real profiles.

## Failure handling
- **Transient** (network/5xx/rate limit): retry with exponential backoff (2s, 4s, 8s, 16s; max 4) via `harness/retry.ts`.
- **Partial** (some platforms succeed): record successes; retry only the failed ones (idempotency key prevents doubles).
- **Hard failure** (auth/token expired, permission, PPA required, content rejected, GBP access not approved): STOP, mark `failed`, escalate to human via `ApprovalChannel` with the platform error.
- **Token expiry**: Meta long-lived Page tokens and Google refresh tokens are managed by the token provider; on 401/invalid-token, escalate (re-auth is a human/credential step).

## Later autonomy phases (not active in Phase A)
- Phase B/C may auto-approve within canary limits, but the deny-rule and `assertPublishAllowed` stay in force until autonomy is explicitly promoted per the staged-autonomy gates.
