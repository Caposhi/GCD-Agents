/** Side-effect-free byte-header and dimension policy for publication media. */

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

export interface GeneratedImageHeader {
  format: "jpeg" | "png";
  width: number;
  height: number;
}

function checkedDimensions(format: "jpeg" | "png", width: number, height: number): GeneratedImageHeader {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
    || width > MAX_IMAGE_DIMENSION
    || height > MAX_IMAGE_DIMENSION
    || width * height > MAX_IMAGE_PIXELS
  ) throw new Error(`image dimensions ${width}x${height} exceed the safe decode policy`);
  if (!PLATFORM_SAFE_IMAGE_SIZES.has(`${width}x${height}`)) {
    throw new Error(`image dimensions ${width}x${height} are not an approved cross-platform feed profile`);
  }
  return { format, width, height };
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

/** Parse and validate dimensions without decoding pixels. */
export function validateGeneratedImageHeader(bytes: Uint8Array): GeneratedImageHeader {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pngSignature = "89504e470d0a1a0a";
  if (data.length >= 24 && data.subarray(0, 8).toString("hex") === pngSignature) {
    if (data.readUInt32BE(8) !== 13 || data.subarray(12, 16).toString("ascii") !== "IHDR") {
      throw new Error("malformed PNG header");
    }
    return checkedDimensions("png", data.readUInt32BE(16), data.readUInt32BE(20));
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
        return checkedDimensions("jpeg", data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3));
      }
      offset += segmentLength;
    }
    throw new Error("JPEG dimensions are missing or malformed");
  }
  throw new Error("unsupported generated image format; only JPEG and PNG are accepted");
}

/** Exact byte policy reused by hosting and every durable publication recheck. */
export function assertPlatformSafePublicationJpeg(bytes: Uint8Array): GeneratedImageHeader {
  if (bytes.byteLength > MAX_PUBLICATION_JPEG_BYTES) {
    throw new Error("hosted publication media exceeds the 5 MiB safety cap");
  }
  const header = validateGeneratedImageHeader(bytes);
  if (header.format !== "jpeg") throw new Error("hosted publication media is not JPEG");
  return header;
}
