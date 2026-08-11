# Contributing

## Workflow

1. Read `AGENTS.md`, the root README, `docs/STATUS.md`, and the affected runbook/agent/skill.
2. Inspect `git status`; preserve unrelated changes.
3. Trace behavior through API, worker, scheduler, harness, provider, migration, Render, and prompt/skill callers before editing.
4. Keep provider calls behind recorded approval and use offline builders/fakes for normal validation.
5. Update code, migrations, prompts, agent definitions, skills, environment references, diagrams, and runbooks together.
6. Run validation and review the complete diff.

## State changes

SQL migrations are forward-only. Create a new lexical migration, review it for locks/data loss, test against a disposable PostgreSQL database, and back up production before deployment. Database rollback cannot undo social posts, messages, or API/model spend.

## Agent and publishing changes

Treat prompt/agent/skill changes as behavioral code. Add a self-test or dry-run fixture that proves claims boundaries, critique routing, package construction, approval enforcement, and provider request shape. A tool name in frontmatter does not grant or restrict a runtime capability; enforcement must exist in TypeScript/provider code.

## Definition of done

- Build/typecheck and relevant offline self-tests pass.
- Simulated dry run builds valid requests without network or publishing.
- Approval, idempotency, retry, partial-failure, and recovery implications are documented.
- Every active environment read appears safely in `.env.example` and `docs/ENVIRONMENT.md`.
- Links, credential/PII scan, whitespace check, modified-document reread, and complete diff review pass.
- `AGENTS.md` documentation acceptance criteria are satisfied.

Do not use a live model call, image generation, provider diagnostic, approval, scheduler run, or social post merely as a smoke test.
