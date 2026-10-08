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
