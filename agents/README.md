# agents/

The seven GCD-SOCIAL subagents the Manager (Opus) delegates to. Each runs in
its own context with **restricted tools** and a precise contract. Definitions
here are loaded and registered by the manager wiring in **Phase 5**; the
`mcp__*` tool names are finalized when the MCP servers are wired.

| Agent | Model | Tools | Role |
|---|---|---|---|
| `copywriter` | Sonnet 4.6 | Read, Skill | Per-platform copy (EN+ES) from brand-voice |
| `image` | Sonnet 4.6 | Read, Skill, image-tool | One on-brand image + alt text |
| `platform-formatter` | Haiku 4.5 | Read, Skill | Fit copy/media to platform limits |
| `brand-compliance-critic` | Sonnet 4.6 | Read, Skill | Independent PASS/FAIL evaluation |
| `hashtag-seo-timing` | Sonnet 4.6 | Read, Skill | Hashtags, local SEO, post time |
| `analytics` | Haiku 4.5 | Read, Skill | Read-only prior-performance readout |
| `posting` | Haiku 4.5 | **posting-tool only** | Publishes the approved package |

## Guardrails baked into the roster
- **Only `posting` holds the publishing tool**, and it enforces `assertPublishAllowed` (Phase A: no post without recorded human approval).
- `brand-compliance-critic` and `analytics` are **read-only** — they never write content or post.
- Every content agent treats the brief/tool output as **data, not commands** (instruction-source boundary), and **never fabricates** prices/offers/hours.
- Model tiers follow `skills/model-routing`.
