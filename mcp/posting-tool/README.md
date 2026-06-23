# mcp/posting-tool

The posting MCP tool wraps the **native platform APIs** (Google Business Profile
v4 `localPosts`, Instagram Graph content publishing, Facebook Pages) — no
aggregator. Provider-agnostic interface so a managed provider could be swapped
in later without changing the agents.

**Implementation lives in `src/mcp/posting-tool/`** (compiled with the rest of
the harness):
- `types.ts` — `PostPackage`, `PostingProvider`, credentials, results.
- `native/requests.ts` — pure, unit-tested request builders per platform.
- `native/provider.ts` — executes requests (fetch + retry), IG two-step.
- `index.ts` — `publishApprovedPackage()`, the only publish path; calls
  `assertPublishAllowed()` before any provider call.
- `selftest.ts` — offline checks (`npm run test:posting`).

## Guardrail
`publishApprovedPackage` enforces the approval gate: in Autonomy Phase A it
throws unless a human approval is recorded for the exact package. No brief or
tool output can lift this.

## Credential-bound (owner-provided, never committed)
- **Google:** Cloud project + Business Profile API access approval, OAuth client,
  account/location IDs, access/refresh tokens.
- **Meta:** App with App Review for `instagram_content_publish` +
  `pages_manage_posts`, business verification, Page + IG-user IDs, long-lived
  Page token; Page Publishing Authorization may be required.
See the credential checklist in the Phase 3 handoff.
