# Testing

Normal validation is offline and must not publish or call production providers.

```bash
npm ci
npm run build
npm run typecheck
npm run test:posting
npm run test:image
npm run test:orchestrator
npm run test:gate
npm run dryrun
npm audit --omit=dev
git diff --check
```

The self-tests are executable scripts, not a unified test framework:

- `test:posting` validates request builders and Phase-A assertion with a fake provider.
- `test:image` validates fal model routing/request shape and a fake provider.
- `test:orchestrator` validates JSON parsing, pass/revision/escalation cycles, and that orchestration never invokes posting.
- `test:gate` validates in-memory queue/approval/token/wait/assert behavior.
- `dryrun` uses canned agent output and builds provider request shapes without network.

These do not verify PostgreSQL concurrency/migrations, API authentication, Slack delivery, model output, image pixels, public media reachability, provider scopes/tokens, duplicate prevention, crash recovery, partial publishing, Render deployment, or external platform behavior.

`dryrun:live`, `/diag/*`, actual API/worker/scheduler processes, migrations, Slack approval, image generation, and provider calls require explicit authority, an identified non-production environment, controlled test accounts, spend limits, and external reconciliation. There is no provider sandbox assumed by the code.

Repository validation must also check all Markdown links, active environment reads versus `.env.example`, agent/model/skill loading claims, migration inventory, credential/PII patterns with manual triage, generated/vendor boundaries, whitespace, and the complete diff.
