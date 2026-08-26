# Contributing

## Workflow

1. Read `AGENTS.md`, `docs/AI_HANDOFF.md`, `docs/STATUS.md`, `docs/ROADMAP.md`, and the affected specialized runbook/agent/skill.
2. Inspect `git status`; preserve unrelated changes.
3. Trace behavior through API, worker, scheduler, harness, provider, migration, Render, and prompt/skill callers before editing.
4. Keep provider calls behind recorded approval and use offline builders/fakes for normal validation.
5. Update code, migrations, prompts, agent definitions, skills, environment references, diagrams, and runbooks together.
6. Run validation and review the complete diff.

Pull requests and `main` must pass `.github/workflows/ci.yml`. A successful manual CI dispatch is diagnostic only. Production delivery is a separate serialized workflow. Render native auto-deploy is off, while the GitHub enable gate remains false pending controlled proof; never enable, bypass, or restore either authority as part of an ordinary source change.

## State changes

SQL migrations are forward-only. Create a new lexical migration, review it for locks/data loss, test against a disposable PostgreSQL database, and back up production before deployment. Database rollback cannot undo social posts, messages, or API/model spend.

## Agent and publishing changes

Treat prompt/agent/skill changes as behavioral code. Add a self-test or dry-run fixture that proves claims boundaries, critique routing, package construction, approval enforcement, and provider request shape. A tool name in frontmatter does not grant or restrict a runtime capability; enforcement must exist in TypeScript/provider code.

## Definition of done

- Build/typecheck and relevant offline self-tests pass.
- Simulated dry run builds valid requests without network or publishing.
- Approval, idempotency, retry, partial-failure, and recovery implications are documented.
- Every active environment read appears safely in `.env.example` and `docs/ENVIRONMENT.md`, or is explicitly classified and documented as operating-system-, platform-, or disposable-test-provided.
- Links, credential/PII scan, whitespace check, modified-document reread, and complete diff review pass.
- `AGENTS.md` documentation acceptance criteria are satisfied.
- Deployment changes include controller fixture coverage and keep migration-bearing releases fail-closed before any service deploy.

### Roadmap continuity

A change that touches roadmap scope is not complete until:

- `docs/ROADMAP.md` reflects its phase effect — implemented, reordered, blocked, expanded, narrowed, superseded, or completed — using the `AGENTS.md` state vocabulary;
- `docs/STATUS.md` reflects verified state where applicable, and leaves unverified external state explicitly labelled as unverified rather than silently refreshed;
- `README.md` is updated when handoff-level behavior changes;
- `docs/AI_HANDOFF.md` is updated when the current state or the next safe action changes;
- every affected specialized runbook is updated in the same change; and
- any reconciliation that genuinely cannot happen in-change — a merge SHA, a live SHA — is recorded as a blocking follow-up before the phase is called complete.

Do not use a live model call, image generation, provider diagnostic, approval, scheduler run, or social post merely as a smoke test.
