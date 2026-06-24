/**
 * Offline self-test for the image tool. Validates content-type → model routing
 * and request shape (no network, no key). Run: npm run build && npm run test:image
 */

import { buildFalRequest, modelFor } from "./fal/models.js";
import { generateImage } from "./index.js";
import { ImageProvider } from "./types.js";

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
check("fal image_size", JSON.stringify(r.body?.image_size) === JSON.stringify({ width: 1080, height: 1350 }));

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
