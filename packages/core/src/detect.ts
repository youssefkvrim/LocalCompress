import type { Detection, OfficeFlavor } from './types';
import { extOf } from './format';

/** Number of leading bytes needed by {@link sniff}. */
export const SNIFF_BYTES = 4096;

const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));
const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

const VIDEO_BRANDS = new Set([
  'isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4VH', 'M4VP', 'qt  ',
  'dash', 'MSNV', 'NDAS', 'f4v ', 'mmp4', '3gp4', '3gp5', '3gp6', '3g2a', 'XAVC', 'hvc1', 'av01',
]);
const IMAGE_BRANDS = new Set(['avif', 'avis', 'heic', 'heix', 'mif1', 'msf1', 'heim', 'heis']);

/**
 * Identify a file from its leading bytes. The extension is only used to
 * flag mismatches — never to decide which engine touches the bytes.
 */
export function sniff(head: Uint8Array, name: string): Detection {
  const ext = extOf(name);
  const d = (kind: Detection['kind'], format: string, label: string, exts: string[]): Detection => ({
    kind,
    format,
    label,
    extensionMismatch: ext !== '' && !exts.includes(ext),
  });

  if (startsWith(head, [0xff, 0xd8, 0xff])) return d('image', 'jpeg', 'JPEG image', ['jpg', 'jpeg', 'jfif', 'jpe']);
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return d('image', 'png', 'PNG image', ['png']);
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return d('image', 'webp', 'WebP image', ['webp']);
  if (ascii(head, 0, 4) === 'GIF8') return { ...d('image', 'gif', 'GIF image', ['gif']), kind: 'unsupported' };

  if (ascii(head, 4, 4) === 'ftyp') {
    const major = ascii(head, 8, 4);
    if (IMAGE_BRANDS.has(major)) {
      return major.startsWith('avi')
        ? d('image', 'avif', 'AVIF image', ['avif'])
        : { ...d('image', 'heic', 'HEIC image', ['heic', 'heif']), kind: 'unsupported' };
    }
    if (VIDEO_BRANDS.has(major) || major.startsWith('3g')) {
      const qt = major === 'qt  ';
      return d('video', qt ? 'mov' : 'mp4', qt ? 'QuickTime video' : 'MPEG-4 video', ['mp4', 'm4v', 'mov', '3gp', '3g2', 'f4v']);
    }
  }
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) {
    const isWebm = ascii(head, 0, Math.min(64, head.length)).includes('webm');
    return d('video', isWebm ? 'webm' : 'mkv', isWebm ? 'WebM video' : 'Matroska video', ['webm', 'mkv', 'mk3d']);
  }

  // PDF header may legally appear anywhere in the first 1024 bytes.
  const pdfAt = indexOf(head.subarray(0, 1024), [0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (pdfAt >= 0) return d('pdf', 'pdf', 'PDF document', ['pdf']);

  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])) {
    return d('zip', 'zip', 'ZIP archive', ['zip']);
  }
  if (startsWith(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) {
    return { ...d('unsupported', '7z', '7-Zip archive', ['7z']) };
  }
  return { kind: 'unsupported', format: ext || 'unknown', label: ext ? `.${ext} file` : 'Unknown file', extensionMismatch: false };
}

const OFFICE: Record<string, { flavor: OfficeFlavor; macro: OfficeFlavor; label: string }> = {
  'ppt/': { flavor: 'pptx', macro: 'pptm', label: 'PowerPoint presentation' },
  'xl/': { flavor: 'xlsx', macro: 'xlsm', label: 'Excel workbook' },
  'word/': { flavor: 'docx', macro: 'docm', label: 'Word document' },
};

/**
 * A ZIP may really be an Office Open XML package. Decide from the entry
 * list (read from the central directory, not from the extension).
 */
export function refineZip(base: Detection, entryNames: string[], name: string): Detection {
  if (!entryNames.includes('[Content_Types].xml')) return base;
  const ext = extOf(name);
  for (const [prefix, o] of Object.entries(OFFICE)) {
    if (!entryNames.some((n) => n.startsWith(prefix))) continue;
    const macro = entryNames.some((n) => /(^|\/)vbaProject\.bin$/i.test(n)) || ext === o.macro;
    const flavor = macro ? o.macro : o.flavor;
    return {
      kind: 'office',
      format: flavor,
      label: macro ? `${o.label} (macro-enabled)` : o.label,
      macroEnabled: macro,
      extensionMismatch: ext !== flavor,
    };
  }
  return base;
}

function indexOf(hay: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
