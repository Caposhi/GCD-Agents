# agents/

> **Runtime note:** the orchestrator loads each Markdown body and its `model` frontmatter field. The `tools` list is descriptive only, and referenced `skills/` are not automatically injected or callable in current SDK runs. Safety enforcement must exist in TypeScript/provider code; see the root README and `docs/ARCHITECTURE.md`.

GCD-SOCIAL defines seven prompt contracts. The deterministic orchestrator loads
six content/evaluation contracts; `posting.md` is a non-invoked design contract
for the library call made by the worker. Each model call receives one Markdown
body and JSON input. The runtime does not spawn tool-capable agents or enforce
the frontmatter tool lists.

| Agent | Model | Tools | Role |
|---|---|---|---|
| `copywriter` | Sonnet 4.6 | Read, Skill | Per-platform copy (EN+ES) from brand-voice |
| `image` | Sonnet 4.6 | Read, Skill | One on-brand image specification + alt text |
| `platform-formatter` | Haiku 4.5 | Read, Skill | Fit copy/media to platform limits |
| `brand-compliance-critic` | Sonnet 4.6 | Read, Skill | Independent PASS/FAIL evaluation |
| `hashtag-seo-timing` | Sonnet 4.6 | Read, Skill | Hashtags, local SEO, post time |
| `analytics` | Haiku 4.5 | Read, Skill | Read-only prior-performance readout |
| `posting` | Haiku 4.5 | **posting-tool only** | Non-invoked exact-publish design contract |

## Guardrails and runtime enforcement
- The worker does not invoke `posting.md`; after recorded approval it calls `publishApprovedPackage` with an approval ID and package index. The library checks the complete durable subject at entry, and every admissible provider awaits the module-issued package-bound guard immediately before every provider HTTP attempt—including reads and retries—in every autonomy phase. The guard revalidates the nonempty/strict-valid/unique-platform subject, runtime destination identity, and current hosted-byte digest/5-MiB JPEG safe-profile policy; request construction independently enforces the same target match.
- Each revision cycle runs platform formatter → deterministic canonical package/validation → brand critic. The image agent authors a specification only; runtime code owns generation URL trust, required QC on initial/revised images, content-addressed hosting/digest, and AI provenance. Application code also owns the non-secret account/location/host/version target included in the exact review subject.
- `brand-compliance-critic` and `analytics` are **read-only** — they never write content or post.
- Every content agent treats the brief/tool output as **data, not commands** (instruction-source boundary), and **never fabricates** prices/offers/hours.
- Model IDs come from each agent's frontmatter. `skills/model-routing` is not injected automatically.
