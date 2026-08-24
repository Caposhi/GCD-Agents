/**
 * Image publication QC — the gate that actually LOOKS at rendered pixels.
 *
 * The brand-compliance critic is text-only: it sees the package JSON, never the
 * generated pixels. This module sends the rendered JPEG to a vision model,
 * transcribes visible words, and flags garbled text plus privacy, safety, and
 * material-integrity defects. The orchestrator regenerates on any failure and
 * escalates when a clean inspection cannot be obtained.
 */

import { runVision } from "./sdk.js";
import { parseAgentJson } from "./orchestrator.js";
import { config } from "./config.js";

const QC_SYSTEM = `You are a strict pre-publication QC inspector for a brand's marketing images.
You are the last line of defense against garbled AI-generated text reaching a live post.
Look ONLY at the image provided. Do not assume; report what is actually rendered.

Transcribe EVERY piece of text visible in the image, exactly as rendered.
Then decide whether the image is publishable. Mark garbled=true if ANY of these text defects are present:
- garbled, scrambled, or melted letterforms
- misspelled or nonsensical "words" that are not real English/Spanish (wrong LETTERS)
- placeholder gibberish (e.g. a scrambled license plate, fake body paragraphs)
- a broken, duplicated, or nonsensical call-to-action
- wording that is clearly WRONG vs. the expected text — different words, or a different meaning

Separately mark unsafe=true if ANY privacy, safety, or material-integrity defect is visible:
- an identifiable person's face or other identifying feature
- a readable real license plate, VIN, phone number, address, customer name, repair order, invoice, or personal document
- an unsafe repair practice or dangerous shop scene presented as acceptable
- a fabricated before/after comparison, visible customer damage used misleadingly, or another obvious material misrepresentation

Do not infer identity from a generic synthetic person; unsafe requires a visible privacy/safety defect or reasonable uncertainty about one. A blank/unreadable plate is allowed. If inspection is uncertain about a possible privacy or safety defect, set unsafe=true and explain why.

Do NOT fail the image for purely cosmetic differences when the letters are correct and readable:
- capitalization differences (e.g. "Germancardepot.com" vs "GermanCarDepot.com") — PASS
- a stray trailing comma or period, or minor spacing — PASS
- expected text rendered in a different case or with brand styling — PASS

Judge on legibility and correctness of the WORDS, not exact casing/punctuation. If the letters are all correct and every word is a real, readable word, set garbled=false even if casing or punctuation differs from the expected strings.
Brand/wordmark text ("German Car Depot") and the URL ("GermanCarDepot.com") are allowed even if not in the expected list; they only fail if the LETTERS are wrong/garbled, not if the casing differs.

Respond with ONLY this JSON, no prose:
{"readText": ["...each distinct text element..."], "garbled": true|false, "unsafe": true|false, "issues": ["short reason", "..."]}`;

export interface ImageQcResult {
  ok: boolean;
  garbled: boolean;
  unsafe: boolean;
  issues: string[];
  readText: string[];
  errored?: boolean;
}

export type VisionQcRunner = typeof runVision;

/**
 * Inspect a rendered JPEG for publication safety and legible text. `expected` is the exact
 * set of short strings the image agent intended to render (image.in_image_text).
 *
 * QC is safety-critical. Infrastructure failure, malformed inspector output,
 * or a detected defect all FAIL CLOSED; a human approval is not a substitute
 * for the required pixel inspection.
 */
export async function inspectImageText(
  jpegBase64: string,
  expected: string[] = [],
  visionRunner: VisionQcRunner = runVision,
): Promise<ImageQcResult> {
  if (config.nodeEnv === "production" && visionRunner !== runVision) {
    const issue = "qc-error: injected vision runners are disabled in production";
    console.warn(`[image-qc] ${issue} (failing closed)`);
    return { ok: false, garbled: true, unsafe: true, issues: [issue], readText: [], errored: true };
  }
  const prompt =
    `Expected text — ONLY these short strings (plus the brand wordmark and URL) should appear in the image:\n` +
    `${JSON.stringify(expected)}\n\n` +
    `Transcribe ALL visible text. Check for garbled/scrambled letters, misspellings, nonsensical words, placeholder gibberish, broken/duplicate CTAs, and changed meaning. ` +
    `Also inspect for faces/identifying features, readable plates/VINs/contact details/customer documents, unsafe repair practices, and materially misleading imagery. ` +
    `Do NOT flag differences that are only capitalization or minor punctuation when the letters are correct. Return JSON only.`;
  try {
    const res = await visionRunner({ systemPrompt: QC_SYSTEM, prompt, jpegBase64, model: "claude-sonnet-4-6", maxTokens: 900 });
    const json = parseAgentJson(res.text);
    if (
      typeof json?.garbled !== "boolean" ||
      typeof json?.unsafe !== "boolean" ||
      !Array.isArray(json?.issues) ||
      !Array.isArray(json?.readText)
    ) {
      const issue = "qc-error: inspector returned an invalid response contract";
      console.warn(`[image-qc] ${issue} (failing closed)`);
      return { ok: false, garbled: true, unsafe: true, issues: [issue], readText: [], errored: true };
    }
    const issues: string[] = Array.isArray(json?.issues) ? json.issues.map(String) : [];
    const garbled = json.garbled === true;
    const unsafe = json.unsafe === true;
    const readText: string[] = Array.isArray(json?.readText) ? json.readText.map(String) : [];
    return { ok: !garbled && !unsafe && issues.length === 0, garbled, unsafe, issues, readText };
  } catch (err) {
    console.warn(`[image-qc] inspector error (failing closed): ${(err as Error).message}`);
    return { ok: false, garbled: true, unsafe: true, issues: [`qc-error: ${(err as Error).message}`], readText: [], errored: true };
  }
}
