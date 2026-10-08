/**
 * Header-only inspection. Dimensions are read *before* any decode so a
 * "pixel bomb" (tiny file, gigantic canvas) is rejected without allocating.
 */

export type RasterFormat = 'jpeg' | 'png' | 'webp' | 'avif';

export interface Probe {
  width: number;
  height: number;
  animated: boolean;
  hasMetadata: boolean;
}

/** 120 megapixels ≈ 480 MB of RGBA. Above this we refuse to decode. */
export const MAX_PIXELS = 120_000_000;

export function probe(b: Uint8Array, format: RasterFormat): Probe | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (format === 'png') {
      const width = v.getUint32(16);
      const height = v.getUint32(20);
      const types = pngChunkTypes(b);
      return {
        width,
        height,
        animated: types.includes('acTL'),
        hasMetadata: types.some((t) => ['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME'].includes(t)),
      };
    }
    if (format === 'jpeg') {
      let p = 2;
      let hasMetadata = false;
      while (p + 9 < b.length) {
        if (b[p] !== 0xff) return null;
        const marker = b[p + 1];
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
          p += 2;
          continue;
        }
        const len = v.getUint16(p + 2);
        if (marker === 0xe1 || marker === 0xed || marker === 0xfe) hasMetadata = true; // EXIF/XMP, IPTC, comment
        // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: v.getUint16(p + 5), width: v.getUint16(p + 7), animated: false, hasMetadata };
        }
        p += 2 + len;
      }
      return null;
    }
    if (format === 'webp') {
      const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (chunk === 'VP8X') {
        const flags = b[20];
        const width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
        const height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
        return { width, height, animated: (flags & 0x02) !== 0, hasMetadata: (flags & 0x0c) !== 0 };
      }
      if (chunk === 'VP8 ') return { width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff, animated: false, hasMetadata: false };
      if (chunk === 'VP8L') {
        const bits = v.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, animated: false, hasMetadata: false };
      }
      return null;
    }
    if (format === 'avif') {
      // Find the 'ispe' property box (image spatial extents).
      for (let i = 0; i + 20 < Math.min(b.length, 1 << 16); i++) {
        if (b[i] === 0x69 && b[i + 1] === 0x73 && b[i + 2] === 0x70 && b[i + 3] === 0x65) {
          return { width: v.getUint32(i + 8), height: v.getUint32(i + 12), animated: false, hasMetadata: true };
        }
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

export function pngChunkTypes(b: Uint8Array): string[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: string[] = [];
  for (let p = 8; p + 12 <= b.length; ) {
    const len = v.getUint32(p);
    out.push(String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]));
    p += 12 + len;
  }
  return out;
}

export function magicMatches(b: Uint8Array, format: RasterFormat): boolean {
  switch (format) {
    case 'jpeg':
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'png':
      return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    case 'webp':
      return String.fromCharCode(...b.subarray(8, 12)) === 'WEBP';
    case 'avif':
      return String.fromCharCode(...b.subarray(4, 8)) === 'ftyp';
  }
}
