/**
 * Turn a provider render into the exact publication artifact.
 *
 * This is the only place an image's pixels may change, and it runs BEFORE
 * quality control, hashing, hosting, and approval — so the bytes a reviewer
 * approves are byte-for-byte the bytes that publish. There is deliberately no
 * post-approval transformation anywhere in the pipeline.
 *
 * Image providers guarantee composition, not exact publication pixels. fal
 * normalizes a requested `image_size` to its own resolution buckets (a live
 * 2026-08-27 Ideogram v3 diagnostic requested 1024x1280 and received 896x1120)
 * and may return PNG even when JPEG is requested. Both are expected inputs.
 * Producing the reviewed profile is this application's job.
 *
 * The only sanctioned transformation is a pure uniform scale. Cropping and
 * padding are refused rather than unimplemented: cropping 1:1 into 4:5 would
 * discard 20% of the frame straight through the headline of a text-bearing
 * brand graphic, and padding would alter the composition under review.
 */

import {
  assertPlatformSafePublicationJpeg,
  describeAspect,
  GeneratedImageHeader,
  planPublicationResize,
  validateGeneratedImageHeader,
} from "./mediaPolicy.js";

export interface NormalizedPublicationImage {
  bytes: Buffer;
  /** What the provider actually delivered, before normalization. */
  source: GeneratedImageHeader;
  /** 1 when the provider already matched the profile exactly. */
  scale: number;
  resized: boolean;
}

const PUBLICATION_JPEG_QUALITY = 90;

/**
 * Decode-safety check, uniform-scale plan, resize, JPEG transcode, then the
 * publication-profile assertion. Any step may fail closed; none may crop.
 */
export async function normalizeToPublicationJpeg(
  bytes: Uint8Array,
  target: { width: number; height: number },
): Promise<NormalizedPublicationImage> {
  // DECODE SAFETY only — a provider-native size or PNG is a valid input here.
  const source = validateGeneratedImageHeader(bytes);

  // Refuses every transformation that is not a pure uniform scale.
  const { scale } = planPublicationResize(source, target);

  const { Jimp, JimpMime } = await import("jimp");
  const image = await Jimp.read(Buffer.from(bytes));
  const resized = source.width !== target.width || source.height !== target.height;
  if (resized) image.resize({ w: target.width, h: target.height });

  const output = (await image.getBuffer(JimpMime.jpeg, { quality: PUBLICATION_JPEG_QUALITY })) as Buffer;

  // PUBLICATION PROFILE boundary: JPEG, size-capped, exactly a reviewed profile.
  const outputHeader = assertPlatformSafePublicationJpeg(output);
  if (outputHeader.width !== target.width || outputHeader.height !== target.height) {
    throw new Error(`normalized image is ${outputHeader.width}x${outputHeader.height}; expected ${target.width}x${target.height}`);
  }
  return { bytes: output, source, scale, resized };
}

/** Operator-facing one-liner describing what normalization did. */
export function describeNormalization(result: NormalizedPublicationImage, target: { width: number; height: number }): string {
  const src = `${result.source.width}x${result.source.height} (${describeAspect(result.source.width, result.source.height)}, ${result.source.format})`;
  if (!result.resized) return `provider returned ${src}; already the requested publication profile`;
  return `provider returned ${src}; normalized by uniform ${result.scale.toFixed(4)}x scale to ${target.width}x${target.height}`;
}
