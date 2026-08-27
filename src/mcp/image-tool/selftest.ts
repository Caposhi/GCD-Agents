/**
 * Offline self-test for the image tool. Validates content-type → model routing
 * and request shape (no network, no key). Run: npm run build && npm run test:image
 */

import { buildFalRequest, modelFor, sourceRenderSizeFor, sourceRenderSizeTable } from "./fal/models.js";
import { generateImage } from "./index.js";
import { ImageProvider } from "./types.js";
import { falRedirectPolicyForSelfTest, providerMetadata } from "./fal/provider.js";

let failures = 0;
function check(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
}

// routing
check("route text-graphic -> ideogram", modelFor("text-graphic") === "fal-ai/ideogram/v3");
check("route photoreal -> flux", modelFor("photoreal") === "fal-ai/flux-pro/v1.1");
check("route graphic-vector -> recraft", modelFor("graphic-vector") === "fal-ai/recraft/v3/text-to-image");

// request shape
const r = buildFalRequest({ contentType: "text-graphic", prompt: "Brake fluid flush — book online", width: 1080, height: 1350 });
check("fal url", r.url === "https://fal.run/fal-ai/ideogram/v3");
check("fal prompt", r.body?.prompt === "Brake fluid flush — book online");
// N. The request carries the provider-friendly SOURCE size, not the publication
// size. A live 2026-08-27 diagnostic showed requesting 1080x1350 produced a 1:1
// render while requesting 1024x1280 produced a correct 4:5 one.
check(
  "N. text-graphic 1080x1350 requests the provider-friendly 4:5 source 1024x1280",
  JSON.stringify(r.body?.image_size) === JSON.stringify({ width: 1024, height: 1280 }),
);
check("N2. jpeg is still requested (advisory; provider may return png)", r.body?.output_format === "jpeg");

// Every reviewed source size must have EXACTLY its target's aspect ratio,
// because the pipeline refuses any non-uniform resize.
{
  let allExact = true;
  for (const [profile, source] of Object.entries(sourceRenderSizeTable())) {
    const [tw, th] = profile.split("x").map(Number);
    if (Math.abs(source.width / source.height - tw! / th!) > 1e-9) {
      console.log(`   mismatch: ${profile} <- ${source.width}x${source.height}`);
      allExact = false;
    }
  }
  check("N3. every source-render mapping has exactly its target aspect ratio", allExact);
}
check(
  "N4. an unmapped profile falls back to the target itself (aspect correct by construction)",
  JSON.stringify(sourceRenderSizeFor(999, 111)) === JSON.stringify({ width: 999, height: 111 }),
);

// O + P. Provider metadata is preserved when present and never required.
{
  const live = providerMetadata({
    url: "https://v3.fal.media/files/x/y.png",
    content_type: "image/png",
    file_name: "y.png",
    file_size: 1_234_567,
  });
  check("O. provider png content_type is preserved as raw-source metadata", live?.contentType === "image/png");
  check("O2. provider file_name/file_size are preserved", live?.fileName === "y.png" && live?.fileSize === 1_234_567);
  check("P. absent provider width/height does not fail extraction", live !== undefined && live.width === undefined && live.height === undefined);
  check("P2. an asset with no usable metadata yields undefined rather than throwing", providerMetadata({}) === undefined);
  check("P3. non-object provider asset is tolerated", providerMetadata(null) === undefined);
}
check("fal credential-bearing POST refuses redirects", falRedirectPolicyForSelfTest() === "error");

// missing prompt guard
let threw = false;
try {
  buildFalRequest({ contentType: "photoreal", prompt: "", width: 1080, height: 1080 });
} catch {
  threw = true;
}
check("missing prompt throws", threw);

// provider error path: no api key
async function run(): Promise<void> {
  const noKey = await generateImage(
    { contentType: "photoreal", prompt: "a clean BMW in the shop", width: 1080, height: 1080 },
    "",
  );
  check("no api key -> ok:false", noKey.ok === false);

  // fake provider returns a url
  const fake: ImageProvider = { name: "fake", async generate() { return { ok: true, url: "https://x/y.jpg", model: "m" }; } };
  const okRes = await generateImage(
    { contentType: "text-graphic", prompt: "hi", width: 1080, height: 1350 },
    "FAKEKEY",
    fake,
  );
  check("fake provider returns url", okRes.ok && okRes.url === "https://x/y.jpg");

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

void run();
