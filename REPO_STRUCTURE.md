# GCD-SOCIAL — Repo Structure

Target layout for the new, isolated repo. Phase 0/1 establishes the skeleton; later phases fill `agents/`, `skills/`, `mcp/`.

```
gcd-social/
├── README.md
├── BUILD_PLAN.md                      # the v2 plan (separate artifact)
├── render.yaml                        # Render Blueprint: web + worker + Postgres
├── .env.example                       # env template (real .env is gitignored)
├── .gitignore
├── package.json                       # (or pyproject.toml if Python)
│
├── .github/
│   └── workflows/
│       └── agentshield.yml            # Phase 0 security gate
│
├── prompts/
│   └── MASTER_PROMPT.md               # manager agent system prompt
│
├── agents/                            # subagent definitions (Phase 4)
│   ├── copywriter.md
│   ├── image.md
│   ├── platform-formatter.md
│   ├── brand-compliance-critic.md
│   ├── hashtag-seo-timing.md
│   ├── analytics.md
│   └── posting.md
│
├── skills/                            # foundational skills (Phase 2)
│   ├── brand-voice/SKILL.md
│   ├── platform-specs/SKILL.md
│   ├── image-brief/SKILL.md
│   ├── compliance-checklist/SKILL.md
│   ├── posting-workflow/SKILL.md
│   ├── local-seo/SKILL.md
│   ├── analytics-readout/SKILL.md
│   ├── model-routing/SKILL.md
│   ├── eval-harness/SKILL.md
│   └── self-improvement-protocol/SKILL.md
│
├── hooks/                             # vendored from ECC, AgentShield-cleared (Phase 1)
│   ├── memory-persistence/
│   └── strategic-compact/
│
├── mcp/                               # MCP servers (Phase 3)
│   ├── posting-tool/                  # native APIs (GBP/IG/FB); impl in src/mcp/posting-tool
│   └── image-tool/                    # wraps image-gen providers
│
├── harness/                           # agent loop, state, retries, HITL interrupts, cost logging (Phase 1)
│
├── state/                             # migrations/schemas for Postgres (approval queue, scorecard, lineage)
│
└── vendor/                            # copied third-party files, pinned
    ├── PROVENANCE.md
    ├── ECC/ (+ LICENSE)
    └── taste-skill/ (+ LICENSE)
```

Reference repos (not vendored): `shanraisshan/claude-code-best-practice` for wiring, `Egonex-AI/Understand-Anything` as an optional tool to map this repo as it grows.
