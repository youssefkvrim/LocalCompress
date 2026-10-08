/**
 * Identify a file from its first bytes. The extension is never trusted.
 */

export type Kind = 'image' | 'video' | 'pdf' | 'zip' | 'other';

const text = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const has = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

export function sniff(b: Uint8Array): { kind: Kind; format: string } {
  if (has(b, [0xff, 0xd8, 0xff])) return { kind: 'image', format: 'jpeg' };
  if (has(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'image', format: 'png' };
  if (text(b, 0, 4) === 'RIFF' && text(b, 8, 4) === 'WEBP') return { kind: 'image', format: 'webp' };
  if (text(b, 0, 4) === 'GIF8') return { kind: 'image', format: 'gif' };
  if (text(b, 4, 4) === 'ftyp') {
    const brand = text(b, 8, 4);
    if (/^(avi|hei|mif|msf)/.test(brand)) return { kind: 'image', format: brand.startsWith('avi') ? 'avif' : 'heic' };
    return { kind: 'video', format: 'mp4' };
  }
  if (has(b, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'video', format: 'mkv' };
  if (text(b, 0, Math.min(1024, b.length)).includes('%PDF-')) return { kind: 'pdf', format: 'pdf' };
  if (has(b, [0x50, 0x4b, 0x03, 0x04]) || has(b, [0x50, 0x4b, 0x05, 0x06])) return { kind: 'zip', format: 'zip' };
  return { kind: 'other', format: '' };
}

/** A ZIP is an Office document when its parts say so. */
export function office(names: string[]): { ext: string; macro: boolean } | null {
  if (!names.includes('[Content_Types].xml')) return null;
  const macro = names.some((n) => /(^|\/)vbaProject\.bin$/i.test(n));
  for (const [prefix, ext] of [['ppt/', 'ppt'], ['xl/', 'xls'], ['word/', 'doc']]) {
    if (names.some((n) => n.startsWith(prefix))) return { ext: ext + (macro ? 'm' : 'x'), macro };
  }
  return null;
}

/** What the user sees: the family of a file, from its name. */
export type Category = 'image' | 'pdf' | 'presentation' | 'spreadsheet' | 'document' | 'video' | 'audio' | 'archive' | 'other';

const CATEGORY_OF: Record<string, Category> = {};
for (const [category, exts] of Object.entries({
  image: 'jpg jpeg jfif png webp avif heic heif bmp tif tiff gif',
  pdf: 'pdf',
  presentation: 'pptx pptm odp',
  spreadsheet: 'xlsx xlsm ods',
  document: 'docx docm odt',
  video: 'mp4 m4v mov mkv webm',
  audio: 'wav mp3 m4a',
  archive: 'zip',
})) for (const ext of exts.split(' ')) CATEGORY_OF[ext] = category as Category;

export const categoryOf = (name: string): Category => CATEGORY_OF[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'other';

/**
 * Width and height of a JPEG or PNG read from its header only, before any
 * decoding (a small file can declare a gigantic image). Null if unreadable.
 */
export function imageSize(b: Uint8Array, format: 'jpeg' | 'png'): { width: number; height: number; animated: boolean } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (format === 'png') return { width: v.getUint32(16), height: v.getUint32(20), animated: pngChunkTypes(b).includes('acTL') };
    for (let p = 2; p + 9 < b.length; ) {
      if (b[p] !== 0xff) return null;
      const m = b[p + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) {
        p += m === 0xff ? 1 : 2;
        continue;
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: v.getUint16(p + 5), width: v.getUint16(p + 7), animated: false };
      p += 2 + v.getUint16(p + 2);
    }
  } catch {
    /* truncated */
  }
  return null;
}

function pngChunkTypes(png: Uint8Array): string[] {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const types: string[] = [];
  for (let p = 8; p + 12 <= png.length; p += 12 + v.getUint32(p)) types.push(String.fromCharCode(...png.subarray(p + 4, p + 8)));
  return types;
}
