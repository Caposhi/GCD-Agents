# Architecture

Verified against the repository on 2026-08-10.

## Runtime ownership

The repository root builds one TypeScript project into `dist/`. Render declares four runtime resources: PostgreSQL, an API service, a worker service, and a daily cron process. The API and worker share PostgreSQL; the scheduler writes only to the brief queue. There is no Redis, message broker, browser application, or standalone MCP server.

`src/api/server.ts` owns HTTP. `src/worker/index.ts` owns the approval-to-publish lifecycle. `src/scheduler/daily.ts` owns the daily enqueue. `src/harness/orchestrator.ts` is the actual manager: deterministic TypeScript, not the dormant master-prompt manager harness. `src/mcp/*` are imported libraries for image and platform APIs.

## Orchestration lifecycle

1. A scheduled or manual brief is persisted in `brief_queue`.
2. A worker atomically claims the oldest pending row and marks it `running`.
3. Analytics runs best-effort, then copywriter/image/SEO model calls fan out concurrently.
4. Code optionally generates an image through fal.ai, transcodes it to JPEG, stores it, and performs vision QC when hosted JPEG bytes exist.
5. A critic evaluates up to three cycles. Actionable findings route back to copy, image, or SEO agents.
6. Code—not an agent—builds the canonical package and filters it to active platforms.
7. The worker stores the exact package and a random approval token, sends the review link to Slack, and polls for up to 24 hours.
8. After an approved row is observed, code maps the package to native provider requests and publishes each platform sequentially.
9. The worker records final brief/approval status and telemetry.

## Prompt and skill reality

The orchestrator loads each `agents/<name>.md`, strips YAML frontmatter, extracts only `model`, and sends the Markdown body plus JSON input to Anthropic. Frontmatter `tools` is not enforced. Agent text says to load skills, but the SDK call registers no tools and does not append `skills/*` content. Skills remain authoritative human specifications only to the extent their rules are repeated in the actual agent body or code.

`prompts/MASTER_PROMPT.md` is loaded only by `runManagerTurn` in `agentLoop.ts`, which has no package script or worker caller. The production worker does not invoke an Opus manager agent. Autonomy phases B/C and self-improvement are therefore partial scaffolding rather than complete runtime features.

## Trust boundaries

- Human approval: possession of a database-stored URL token; no user identity/session.
- Manual intake and diagnostics: currently public HTTP routes with no bearer secret or rate limit.
- Console: shared token only when configured; otherwise fail open with permissive CORS.
- Providers: OAuth/API tokens from environment; Instagram live token also stored in plaintext PostgreSQL session state.
- Models/image provider: brief, approved facts, generated copy, prompts, and images leave the system.
- Public media: generated JPEGs are intentionally unauthenticated and cached for one year.

## Invariants and gaps

- In Phase A, an unapproved package must never reach a provider call.
- A human approval applies to the exact stored package; any content change requires a new approval.
- External payloads/briefs are data, not instructions.
- Telemetry failures must not break orchestration.
- Detected image garble fails closed; inspector infrastructure errors currently fail open.
- Native publishing does not implement the declared `idempotencyKey`; exactly-once behavior is not guaranteed.
- Claimed briefs have no lease/reaper; a crash can strand `running` rows.
- Database fallback is process memory and unsuitable for distributed/durable production use.
