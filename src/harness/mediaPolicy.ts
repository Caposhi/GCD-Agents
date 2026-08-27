/**
 * Side-effect-free byte-header and dimension policy for publication media.
 *
 * Two policies live here and they are deliberately NOT the same check:
 *
 *  - DECODE SAFETY applies to bytes we are willing to *process*. A provider
 *    render only has to be a supported format within safe decode bounds.
 *  - PUBLICATION PROFILE applies to the bytes we are willing to *publish*.
 *    Those must be JPEG at one of the four reviewed cross-platform profiles.
 *
 * Conflating the two is what broke scheduled posting: the publication
 * allowlist was asserted against the raw provider download, so a perfectly
 * good provider-native 4:5 render (896x1120) was rejected before the pipeline
 * ever had the chance to normalize it. Image providers guarantee composition,
 * not exact publication pixels; producing the exact artifact is this
 * application's job, and only the artifact it produces is held to the profile.
 */

const MAX_IMAGE_DIMENSION = 4_096;
const MAX_IMAGE_PIXELS = 16_000_000;
export const MAX_PUBLICATION_JPEG_BYTES = 5 * 1024 * 1024;
const DEFAULT_PUBLICATION_IMAGE_SIZE = Object.freeze({ width: 1_080, height: 1_350 });
const PLATFORM_SAFE_IMAGE_SIZES = new Set([
  "1080x1350", // 4:5 portrait feed
  "1080x1080", // square feed
  "1200x900", // 4:3 landscape feed
  "1200x630", // 1.91:1 landscape feed
]);

/**
 * Exact rational aspect equality, by integer cross-multiplication.
 *
 * A near-ratio tolerance cannot express this invariant. 897x1121 sits within
 * 0.0002 of 4:5, but scaling it to 1080x1350 gives scaleX 1.204013 and scaleY
 * 1.204282 — a real, if subtle, stretch of a text-bearing brand graphic. Only
 * exact ratio equality guarantees scaleX === scaleY, which is what "pure
 * uniform scale" actually means.
 *
 * Both dimensions are already bounded to 4,096, so the cross-products cannot
 * exceed 16,777,216 and stay far inside the safe-integer range. This is exact
 * integer arithmetic with no floating-point comparison anywhere.
 */
export function aspectRatiosAreExactlyEqual(
  source: { width: number; height: number },
  target: { width: number; height: number },
): boolean {
  return source.width * target.height === target.width * source.height;
}

/**
 * A deterministic media-contract failure, as opposed to a creative/QC failure.
 *
 * The distinction decides retry policy. Re-prompting can fix "the render has
 * unreadable text"; it cannot fix "the provider composed 1:1 when we asked for
 * 4:5", because the request is byte-identical on every attempt. Retrying the
 * latter burns paid generations to reproduce the same failure, so anything
 * thrown as this type must escalate after exactly one generation.
 */
export class MediaContractError extends Error {
  readonly retryable = false as const;
  constructor(message: string) {
    super(message);
    this.name = "MediaContractError";
  }
}

export interface GeneratedImageHeader {
  format: "jpeg" | "png";
  width: number;
  height: number;
}

/** Bounds that make bytes safe to decode. Says nothing about publishability. */
function safelyDecodableDimensions(
  format: "jpeg" | "png",
  width: number,
  height: number,
): GeneratedImageHeader {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
    || width > MAX_IMAGE_DIMENSION
    || height > MAX_IMAGE_DIMENSION
    || width * height > MAX_IMAGE_PIXELS
  ) throw new Error(`image dimensions ${width}x${height} exceed the safe decode policy`);
  return { format, width, height };
}

/** True only for the exact reviewed cross-platform feed profiles. */
export function isApprovedPublicationProfile(width: number, height: number): boolean {
  return PLATFORM_SAFE_IMAGE_SIZES.has(`${width}x${height}`);
}

/** The reviewed profiles, for diagnostics and tests. Never mutated at runtime. */
export function approvedPublicationProfiles(): string[] {
  return [...PLATFORM_SAFE_IMAGE_SIZES];
}

/** Fail closed unless these are exactly publishable dimensions. */
export function assertApprovedPublicationProfile(width: number, height: number): void {
  if (!isApprovedPublicationProfile(width, height)) {
    throw new Error(`image dimensions ${width}x${height} are not an approved cross-platform feed profile`);
  }
}

/** Normalize model-authored sizing to reviewed, shared feed profiles only. */
export function publicationImageDimensions(width: unknown, height: unknown): { width: number; height: number } {
  const candidateWidth = Number(width);
  const candidateHeight = Number(height);
  if (
    Number.isInteger(candidateWidth)
    && Number.isInteger(candidateHeight)
    && PLATFORM_SAFE_IMAGE_SIZES.has(`${candidateWidth}x${candidateHeight}`)
  ) return { width: candidateWidth, height: candidateHeight };
  return { ...DEFAULT_PUBLICATION_IMAGE_SIZE };
}

/**
 * Parse dimensions without decoding pixels, enforcing DECODE SAFETY only.
 *
 * Accepts any supported, safely-bounded provider render — including the PNG
 * that fal returns even when JPEG is requested, and provider-native sizes such
 * as 896x1120. Publishability is asserted separately, on the final artifact.
 */
export function validateGeneratedImageHeader(bytes: Uint8Array): GeneratedImageHeader {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pngSignature = "89504e470d0a1a0a";
  if (data.length >= 24 && data.subarray(0, 8).toString("hex") === pngSignature) {
    if (data.readUInt32BE(8) !== 13 || data.subarray(12, 16).toString("ascii") !== "IHDR") {
      throw new Error("malformed PNG header");
    }
    return safelyDecodableDimensions("png", data.readUInt32BE(16), data.readUInt32BE(20));
  }

  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset < data.length) {
      while (offset < data.length && data[offset] === 0xff) offset++;
      if (offset >= data.length) break;
      const marker = data[offset++]!;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > data.length) throw new Error("malformed JPEG segment header");
      const segmentLength = data.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > data.length) throw new Error("malformed JPEG segment length");
      const isStartOfFrame =
        (marker >= 0xc0 && marker <= 0xc3)
        || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb)
        || (marker >= 0xcd && marker <= 0xcf);
      if (isStartOfFrame) {
        if (segmentLength < 7) throw new Error("malformed JPEG frame header");
        // SOF stores height before width.
        return safelyDecodableDimensions("jpeg", data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3));
      }
      offset += segmentLength;
    }
    throw new Error("JPEG dimensions are missing or malformed");
  }
  throw new Error("unsupported generated image format; only JPEG and PNG are accepted");
}

/**
 * Exact byte policy reused by hosting and every durable publication recheck.
 *
 * This is the PUBLICATION PROFILE boundary and it is unchanged in strength:
 * JPEG, within the size cap, safely decodable, and at exactly one of the
 * reviewed profiles. The profile assertion is now explicit here rather than
 * inherited from the shared header parser, because the parser is also used on
 * raw provider renders that are legitimately not yet publishable.
 */
export function assertPlatformSafePublicationJpeg(bytes: Uint8Array): GeneratedImageHeader {
  if (bytes.byteLength > MAX_PUBLICATION_JPEG_BYTES) {
    throw new Error("hosted publication media exceeds the 5 MiB safety cap");
  }
  const header = validateGeneratedImageHeader(bytes);
  if (header.format !== "jpeg") throw new Error("hosted publication media is not JPEG");
  assertApprovedPublicationProfile(header.width, header.height);
  return header;
}

/**
 * Decide whether a provider render can become a publication artifact by pure
 * uniform scaling, and refuse every other transformation.
 *
 * Cropping is not a fallback we declined to implement — it is forbidden. A 1:1
 * render cropped into 4:5 loses 20% of its width, which on a text-bearing brand
 * graphic cuts through the headline. Padding would alter the composition a
 * reviewer approved. So the only sanctioned transformation is a scale that
 * preserves the entire frame.
 *
 * "Uniform" is enforced literally, by exact rational aspect equality rather
 * than a near-ratio tolerance: only exact equality guarantees the horizontal
 * and vertical scale factors are the same number, so nothing can be stretched
 * on the grounds that its ratio was merely close.
 */
export function planPublicationResize(
  source: { width: number; height: number },
  target: { width: number; height: number },
): { scale: number } {
  assertApprovedPublicationProfile(target.width, target.height);
  if (source.width <= 0 || source.height <= 0) {
    throw new MediaContractError(`unusable source dimensions ${source.width}x${source.height}`);
  }
  if (!aspectRatiosAreExactlyEqual(source, target)) {
    throw new MediaContractError(
      `image provider returned ${source.width}x${source.height} (${describeAspect(source.width, source.height)}) `
      + `for requested ${target.width}x${target.height} (${describeAspect(target.width, target.height)}) publication media; `
      + "automatic cropping and stretching are forbidden",
    );
  }
  // Exact ratio equality makes these the same number; assert it so the
  // "uniform" claim is checked rather than merely intended.
  const scale = target.width / source.width;
  if (scale !== target.height / source.height) {
    throw new MediaContractError(
      `refusing a non-uniform scale for ${source.width}x${source.height} -> ${target.width}x${target.height}`,
    );
  }
  return { scale };
}

/** Small human-readable ratio for operator-facing errors, e.g. "4:5". */
export function describeAspect(width: number, height: number): string {
  if (width <= 0 || height <= 0) return `${width}x${height}`;
  const divisor = greatestCommonDivisor(Math.round(width), Math.round(height));
  return `${Math.round(width) / divisor}:${Math.round(height) / divisor}`;
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}
