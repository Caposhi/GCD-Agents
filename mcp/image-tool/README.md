# mcp/image-tool

> Runtime note: despite the directory name, this is an imported TypeScript library, not a standalone MCP server or tool exposed to model calls.

The image MCP tool generates on-brand images via **fal.ai** as a single
aggregator key, **routed by content type**:

| Content type | Model (fal.ai) | Use |
|---|---|---|
| `text-graphic` | Ideogram v3 | offer cards, tips/CTA graphics (legible in-image text) |
| `photoreal` | Flux Pro | shop, cars, hands-on service |
| `graphic-vector` | Recraft v3 | flat branded graphics, logos, icons |

Provider-agnostic interface, so a direct model API could be swapped in later
without changing the agents.

**Implementation in `src/mcp/image-tool/`:**
- `types.ts` — `ImageRequest`, `ImageProvider`, results.
- `fal/models.ts` — content-type → model routing + pure request builder (unit-tested).
- `fal/provider.ts` — executes via fetch + retry.
- `index.ts` — `generateImage()`.
- `selftest.ts` — offline checks (`npm run test:image`).

## Notes
- Model slugs are fal.ai catalog ids and were not provider-verified during Phase 0A; reverify them before live use (isolated in `fal/models.ts`).
- The tool **executes**; it does not author prompts. The active image-agent body repeats core brand guidance, but the referenced `image-brief` skill and `assets/brand/brand-tokens.json` are not automatically injected into current model calls.
- Credential-bound: `IMAGEGEN_API_KEY` = your fal.ai key (Render `sync: false`).
- A generation attempt has a 120-second request timeout and returns a provider URL only as an untrusted intermediate. Runtime normalizes the request to one of four reviewed shared-feed profiles—`1080x1350`, `1080x1080`, `1200x900`, or `1200x630`, defaulting to `1080x1350`—then accepts only direct HTTPS `fal.media` URLs (including subdomains) with no credentials, fragment, or nonstandard port, rejects redirects, and streams at most 20 MiB within 30 seconds. Before decode, a PNG/JPEG header must use an allowed profile and exactly match the requested dimensions; broader safety ceilings remain 4,096 pixels per side/16 million pixels. Runtime checks image content, converts at deterministic JPEG quality 90, rejects output over 5 MiB, revalidates the output header against that exact profile before storage/hash binding, and requires strict vision QC. Production QC rejects injected inspector implementations. The same gate applies to every critic-requested revision. Only passing bytes are stored and exposed as `/media/<uuid>-<sha256>.jpg` through the configured root HTTPS application origin, which must be publicly reachable for live provider use; the provider URL is never the approval/publication URL. The one inspected artifact is shared across active platforms; no separate crops/renditions are produced.
