# Data model

SQL files under `state/migrations/` are authoritative. `_migrations` records applied filenames. PostgreSQL is required for distributed durability; in-memory maps exist only for local/offline fallback and are not shared between API, worker, or scheduler processes.

| Table | Purpose | Sensitivity / lifecycle |
|---|---|---|
| `brief_queue` | Input brief, pending/running/done/failed status, claim time, outcome | May contain business strategy, prompts, generated result/provider IDs; no retention/reaper |
| `approval_queue` | Exact package, formatted package, summary, bearer token, human decision/status | Tokens, unpublished content, actor label; high sensitivity; token plaintext |
| `media` | Generated binary JPEGs | Publicly served creative assets; no expiry/deletion task |
| `events` | Monotonic live telemetry and JSON data | Operational activity; no retention task |
| `session_state` | Arbitrary JSON session state and Instagram token store | Contains live Instagram token and env seed in plaintext; critical secret data |
| `brand_scorecard` | Intended quality/performance history | Schema exists; active worker does not write it |
| `self_improvement_proposals` | Intended proposal lineage | Schema exists; active worker does not write it |
| `_migrations` | Applied migration filenames | Operational schema metadata |

## Relationships and invariants

Brief and approval records are related only through worker memory/outcome, not a foreign key. Events correlate by free-text `run_id`. Approval rows can contain multiple platform posts. Media rows are referenced by public URL embedded in package JSON, without a database foreign key. Session state is keyed text and can mix benign state with credentials.

Only a pending approval may transition through the decision function. The browser decision records `decided_by="human"`, not an authenticated identity. Posting status is written after provider calls, but there is no per-platform durable table, unique idempotency constraint, or reconciliation state machine.

## Migration procedure

Add a lexically ordered SQL file. The runner creates `_migrations`, skips recorded names, and applies each new file in its own transaction. Test against disposable PostgreSQL, inspect destructive SQL/locks, back up production, and deploy compatible code. There is no down migration.

## Retention and recovery decisions

Define retention for briefs, approval packages/tokens, media bytes, events, session state, scorecards, and proposals. Encrypt or move provider tokens out of general session JSON. Define how expired approval tokens are invalidated/deleted and how public media URLs are retired without breaking already-published posts. Database restore must be reconciled against external posts and Slack messages after the backup timestamp.
