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

## Required validation

Run the relevant build, typecheck, four offline self-tests, simulated dry run, dependency audit, AgentShield scan when available, Markdown-link validation, environment coverage comparison, credential/PII scan with manual triage, `git diff --check`, and complete diff review. Report checks that cannot run and why.
