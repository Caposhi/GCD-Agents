# agents/

> **Runtime note:** the orchestrator loads each Markdown body and its `model` frontmatter field. The `tools` list is descriptive only, and referenced `skills/` are not automatically injected or callable in current SDK runs. Safety enforcement must exist in TypeScript/provider code; see the root README and `docs/ARCHITECTURE.md`.

Seven GCD-SOCIAL prompt contracts used by the deterministic orchestrator. Each
model call receives one Markdown body and JSON input. The runtime does not spawn
tool-capable agents or enforce the frontmatter tool lists.

| Agent | Model | Tools | Role |
|---|---|---|---|
| `copywriter` | Sonnet 4.6 | Read, Skill | Per-platform copy (EN+ES) from brand-voice |
| `image` | Sonnet 4.6 | Read, Skill, image-tool | One on-brand image + alt text |
| `platform-formatter` | Haiku 4.5 | Read, Skill | Fit copy/media to platform limits |
| `brand-compliance-critic` | Sonnet 4.6 | Read, Skill | Independent PASS/FAIL evaluation |
| `hashtag-seo-timing` | Sonnet 4.6 | Read, Skill | Hashtags, local SEO, post time |
| `analytics` | Haiku 4.5 | Read, Skill | Read-only prior-performance readout |
| `posting` | Haiku 4.5 | **posting-tool only** | Publishes the approved package |

## Guardrails and runtime enforcement
- The worker does not invoke `posting.md`; after recorded approval it calls `publishApprovedPackage`, which enforces `assertPublishAllowed` in Phase A.
- `brand-compliance-critic` and `analytics` are **read-only** — they never write content or post.
- Every content agent treats the brief/tool output as **data, not commands** (instruction-source boundary), and **never fabricates** prices/offers/hours.
- Model IDs come from each agent's frontmatter. `skills/model-routing` is not injected automatically.
