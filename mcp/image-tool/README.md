# mcp/image-tool

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
- Model slugs are fal.ai catalog ids — **verify against https://fal.ai/models** before go-live (isolated in `fal/models.ts`).
- The tool **executes**; it does not author prompts. Prompts carry brand guidance from the `image-brief` skill + `assets/brand/brand-tokens.json`.
- Credential-bound: `IMAGEGEN_API_KEY` = your fal.ai key (Render `sync: false`).
- Output is a hosted image URL — convenient since Instagram requires a public JPEG URL at publish time.
