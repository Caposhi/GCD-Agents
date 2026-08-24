# mcp/posting-tool

> Runtime note: despite the directory name, this is an imported TypeScript library called directly by the worker, not a standalone MCP server or model-exposed tool.

The posting MCP tool wraps the **native platform APIs** (Google Business Profile
v4 `localPosts`, Instagram Graph content publishing, Facebook Pages) — no
aggregator. Provider-agnostic interface so a managed provider could be swapped
in later without changing the agents.

**Implementation lives in `src/mcp/posting-tool/`** (compiled with the rest of
the harness):
- `types.ts` — `PostPackage`, non-secret `PublicationTarget`, `PublicationAuthorization`, provider, credentials, results.
- `native/requests.ts` — pure, unit-tested request builders per platform.
- `native/provider.ts` — executes requests (fetch + retry), IG two-step.
- `index.ts` — `publishApprovedPackage()`, the only publish path; resolves live
  durable approval at entry and supplies the per-provider-request guard.
- `selftest.ts` — offline checks (`npm run test:posting`).

## Guardrail
`publishApprovedPackage(pkg, { approvalId, packageIndex }, creds)` treats the
caller's package only as an expected value. At entry and through the request
guard it reloads the typed canonical `PostPackage[]` approval subject, requires
the complete array to be nonempty, strict-valid, and unique by platform,
recomputes its SHA-256, checks the matching durable decision, approved status,
authorization expiry, revocation, item index, and exact package equality, and
publishes a frozen clone from storage. A fabricated boolean, another payload's
approval, altered copy/destination/media/CTA, missing or wrong index,
expired/revoked record, or storage hash mismatch is blocked.
No `AUTONOMY_PHASE` value, brief, or tool output can lift the gate.

Every `PostingProvider` implementation receives a `PublicationGuard` and is
admissible only if it awaits `guard.beforeMutation()` immediately before every
provider HTTP attempt, including reads, retries, and every step of a
multi-request flow. The callback name is transitional; its required boundary is
all provider I/O. The check belongs inside the retry/poll attempt, not around
the loop. Instagram therefore rechecks before container creation, every
read-only container-status GET and retry, and final publish. This makes expiry,
revocation, decision-state change, or subject tampering that occurs during
preparation/backoff effective before the next external request.

The native provider additionally accepts only a module-issued guard bound to
the exact stored package; a caller-supplied no-op object is rejected before
fetch. Each guard call revalidates runtime account/location/host/version and
verifies every image's content-addressed URL/digest against the immutable
PostgreSQL content fields, recomputed live byte hash, and 5-MiB/JPEG/allowed-
profile policy. Native request builders independently require the same target
match, use those approved fields for the URL, and never include tokens in
review. All native provider requests refuse redirects, and a 2xx without the
required provider post ID is failure.

All externally visible formatting—including provider-visible hashtags,
platform length handling, language layout, supported media metadata/digest,
publication target, and GBP CTA/topic type—is complete before approval.
Instagram carries exactly one image plus alt text and AI disclosure; current
FB/GBP request builders carry the image URL but not unsupported alt/AI fields.
GBP requires explicit language code and topic type rather than using a
request-time default. The posting tool performs provider protocol encoding only;
an externally visible content or destination change requires a new approval.

New canonical media uses `/media/<uuid>-<sha256>.jpg`. The legacy UUID-only GET
route remains readable for already-published URLs, but it is not accepted as a
new Phase-0A package reference. Migration 005 makes each row's id/MIME/bytes/
digest immutable and rejects every delete; retention requires a later reviewed
migration.

## Credential-bound (owner-provided, never committed)
- **Google:** Cloud project + Business Profile API access approval, OAuth client,
  account/location IDs, access/refresh tokens.
- **Meta:** runtime uses `IG_USER_ID`/`IG_ACCESS_TOKEN` for Instagram and
  `FB_PAGE_ID`/`FB_PAGE_ACCESS_TOKEN` for Facebook. Provider permissions,
  business verification, app review, token type, and Page authorization must be
  verified against the selected provider login path before live use.
The reviewed target is derived before canonicalization: Instagram uses
`IG_USER_ID`, allowlisted `IG_GRAPH_HOST`, and `GRAPH_VERSION`; Facebook uses
`FB_PAGE_ID`, fixed `graph.facebook.com`, and `GRAPH_VERSION`; GBP uses its
account/location IDs and fixed `mybusiness.googleapis.com/v4`. Changing one of
those values requires a fresh package/review; rotating only a token does not.
See [`docs/credentials-setup.md`](../../docs/credentials-setup.md).
