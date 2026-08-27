# Repository instructions

These instructions apply to every file and subdirectory in this repository.

## Binding continuous-documentation rule

Documentation is part of every change. A repository change is not complete until the author has:

a. identified every Markdown file, environment example, runbook, diagram, command, path, inline operational note, and external setup description affected by the change;

b. updated those references in the same atomic change as the code, configuration, infrastructure, schema, integration, or process change;

c. removed or explicitly archived instructions that no longer apply;

d. reread every modified document as a whole and confirmed unchanged sections remain correct for the current edition;

e. verified documented paths, commands, variables, ports, service names, routes, schedules, links, and identifiers against source;

f. updated the root handoff README whenever architecture, data flow, deployment, security, operations, ownership, recovery, or external dependencies change; and

g. recorded unresolved uncertainty, manual prerequisites, rollout gates, and external-system dependencies instead of presenting them as completed.

This rule applies to humans, Codex, all other AI agents, automated refactors, dependency updates, generated code, and emergency work. Documentation-only follow-up is not an acceptable substitute except for a genuine emergency hotfix; any exception must be recorded as a blocking follow-up before closure.

## Safety and source hierarchy

- Preserve unrelated working-tree changes and never reset or overwrite them.
- Executable source, migrations, self-tests, and checked-in configuration outrank plans, prompts, agent prose, and skills.
- `README.md` is the canonical handoff; current runbooks live in `docs/`; `docs/archive/` is historical only.
- Agent/skill/prompt text is executable input. Treat changes to claims, tools, models, approval, autonomy, or publishing instructions like code changes and test them.
- Never commit provider tokens, Slack webhooks, OAuth material, approval URLs/tokens, customer data, raw analytics, platform exports, or database dumps.
- Never run migrations, live diagnostics, the scheduler/worker, `dryrun:live`, model/image calls, approval decisions, or publishing against an unidentified environment.
- Do not commit, push, merge, deploy, rotate credentials, rewrite history, delete data, or contact external systems unless explicitly authorized.
- Never weaken the Phase-A approval gate or self-improvement core-objective lock as an incidental change.

## Roadmap continuity is mandatory

- [`docs/ROADMAP.md`](docs/ROADMAP.md) is the canonical unfinished-work sequence and the current-phase cursor. [`docs/STATUS.md`](docs/STATUS.md) records verified current reality. Read both before selecting, beginning, continuing, or completing any phase.
- A change that implements, reorders, blocks, expands, narrows, supersedes, or **completes** roadmap scope must update `docs/ROADMAP.md` in the same change. Finishing implementation is itself a roadmap-state change, not merely the end of one.
- Never infer the next phase from chat history, pull-request chronology, memory, or an unchecked issue when `docs/ROADMAP.md` supplies the current cursor.
- When executable source or verified production evidence contradicts roadmap prose, record and resolve the discrepancy. Never follow stale planning text because it is written down.

### Phase state vocabulary

These states are distinct and must not be collapsed into "done", "complete", or "shipped" wherever the distinction changes what an operator may safely do next:

`PLANNED` · `IMPLEMENTED` · `MERGED` · `CONFIGURED` · `ENABLED` · `DEPLOYED` · `PRODUCTION-VALIDATED` · `BLOCKED` · `DEFERRED` · `SUPERSEDED`

Code merged to `main` is `MERGED`. It is not `DEPLOYED` until a release carrying it is live, and not `PRODUCTION-VALIDATED` until its behavior has been observed in production. Configuration that exists is `CONFIGURED`; it is `ENABLED` only when its gate is actually on.

### Completed-phase records

A completed-phase record in `docs/ROADMAP.md` must preserve: phase name; PR number; merge SHA when known; delivered scope; migrations/schema impact; material design decisions; material rejected alternatives and why they were rejected; automated validation; production evidence where applicable; rollback/recovery status; security and privacy implications; accepted limitations; unresolved follow-ups; and the documents updated at completion. Rationale and evidence are never deleted, only relocated.

Completed-phase records currently live inside `docs/ROADMAP.md`. A separate completed-phase ledger (`docs/COMPLETED_ROADMAP_PHASES.md`) should be introduced only once completed history has grown enough to impair `docs/ROADMAP.md` as an active planning document — judged by whether a maintainer can still find the current cursor and the next eligible work quickly, not by a line count. Introducing it is a documentation change like any other and never deletes the history it relocates.

### Mutable identifiers

Git and GitHub are authoritative for the exact current `main` SHA. Version-controlled documentation cannot be a self-updating pointer to it, because every merge — including the merge that publishes the documentation — changes `main`. `docs/STATUS.md` therefore records a **dated verified repository baseline**, not a live mirror. Read `git rev-parse origin/main` when the exact value matters.

A post-merge documentation follow-up is required only when the merge creates a **semantic fact that could not have existed before it merged**, such as:

- a completed-phase record needing its actual merge SHA;
- a phase state moving from `IMPLEMENTED` to `MERGED`; or
- the roadmap cursor changing as a result of the merge.

**A newer `main` hash than the one recorded is normal and is not, by itself, a defect or a blocking follow-up.** Requiring a fresh pull request every time `main` moves would recurse without end, since that pull request would itself move `main`. Do not open follow-up work merely to refresh a recorded SHA.

This is a narrow exception for facts that are genuinely unknowable in-change, and it is not a licence for ordinary documentation drift: same-change documentation remains the normal rule, and everything knowable at authoring time is still updated in the same atomic change.

Historical merge SHAs stay permanently in `docs/ROADMAP.md` phase records. Production and live SHAs may appear in `docs/STATUS.md` only with a freshness or evidence timestamp. Relative commit distance ("N merges behind") is a dated observation, never durable current truth — prefer semantic state such as "PR #36 merged, not deployed". Prefer pointing to `docs/STATUS.md` over repeating a mutable SHA in more documents than necessary, and label any dated snapshot as a snapshot.

## Required validation

Run the relevant build, typecheck, the offline self-test suite (`npm run test:offline`, currently seven suites), simulated dry run, deployment-controller fixtures, dependency audit, AgentShield scan when available, Markdown-link validation, environment coverage comparison, credential/PII scan with manual triage, `git diff --check`, and complete diff review. Report checks that cannot run and why.
