/**
 * Image legibility QC — the gate that actually LOOKS at the rendered image.
 *
 * The brand-compliance critic is text-only: it sees the package JSON, never the
 * generated pixels, so garbled in-image text (Ideogram's failure mode on dense
 * or unexpected words) sails right past it. This module sends the rendered JPEG
 * to a vision model, transcribes every visible word, and flags anything garbled,
 * misspelled, nonsensical, placeholder (e.g. a scrambled license plate), or a
 * broken/duplicate CTA. The orchestrator uses the verdict to regenerate and,
 * if it still can't produce legible text, to ESCALATE (never publish).
 */

import { runVision } from "./sdk.js";
import { parseAgentJson } from "./orchestrator.js";

const QC_SYSTEM = `You are a strict pre-publication QC inspector for a brand's marketing images.
You are the last line of defense against garbled AI-generated text reaching a live post.
Look ONLY at the image provided. Do not assume; report what is actually rendered.

Transcribe EVERY piece of text visible in the image, exactly as rendered.
Then decide whether the image is publishable. Mark it NOT publishable (garbled=true) if ANY of these are present:
- garbled, scrambled, or melted letterforms
- misspelled or nonsensical "words" that are not real English/Spanish
- placeholder gibberish (e.g. a scrambled license plate, fake body paragraphs)
- a broken, duplicated, or nonsensical call-to-action
- any text block that does not match the expected text you are given

Be conservative: if text is even partially garbled or you are unsure it reads cleanly, set garbled=true.
Brand/wordmark text ("German Car Depot") and the URL ("GermanCarDepot.com") are allowed even if not in the expected list, but they must be spelled correctly.

Respond with ONLY this JSON, no prose:
{"readText": ["...each distinct text element..."], "garbled": true|false, "issues": ["short reason", "..."]}`;

export interface ImageQcResult {
  ok: boolean;
  garbled: boolean;
  issues: string[];
  readText: string[];
  errored?: boolean;
}

/**
 * Inspect a rendered JPEG for garbled/illegible text. `expected` is the exact
 * set of short strings the image agent intended to render (image.in_image_text).
 *
 * On a QC infrastructure error (vision call fails) we FAIL OPEN (ok:true,
 * errored:true) and log loudly — a transient inspector outage must not block
 * every post, and the human approval gate is still downstream. Detected garble
 * always FAILS CLOSED.
 */
export async function inspectImageText(jpegBase64: string, expected: string[] = []): Promise<ImageQcResult> {
  const prompt =
    `Expected text — ONLY these short strings (plus the brand wordmark and URL) should appear in the image:\n` +
    `${JSON.stringify(expected)}\n\n` +
    `Transcribe ALL visible text and flag anything garbled, misspelled, nonsensical, placeholder, a broken/duplicate CTA, or not in the expected set. Return JSON only.`;
  try {
    const res = await runVision({ systemPrompt: QC_SYSTEM, prompt, jpegBase64, model: "claude-sonnet-4-6", maxTokens: 900 });
    const json = parseAgentJson(res.text);
    const issues: string[] = Array.isArray(json?.issues) ? json.issues.map(String) : [];
    const garbled = json?.garbled === true || issues.length > 0;
    const readText: string[] = Array.isArray(json?.readText) ? json.readText.map(String) : [];
    return { ok: !garbled, garbled, issues, readText };
  } catch (err) {
    console.warn(`[image-qc] inspector error (failing open): ${(err as Error).message}`);
    return { ok: true, garbled: false, issues: [`qc-error: ${(err as Error).message}`], readText: [], errored: true };
  }
}
