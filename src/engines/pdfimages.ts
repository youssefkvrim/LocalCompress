/**
 * PDF → pictures, one per page, rendered with pdf.js inside this worker.
 *
 * pdf.js normally starts a worker of its own; here its worker code is loaded
 * into this realm ("fake worker"), so it stays behind the egress guard and
 * no nested worker is created. Fonts, CMaps and decoders are files of the
 * application, handed to pdf.js by the factories below: pdf.js itself
 * fetches nothing. Scripts in the PDF are never run (scripting is off).
 *
 * One page → one picture. Several pages → a ZIP of pictures (stored, they
 * are already compressed), written straight to the local scratch space.
 *
 * A password-protected PDF is opened with the password the user typed for
 * it (kept in memory for this file only); without it, it is left as is.
 */
import { crc32 } from '../lib/crc32';
import { safeName } from '../lib/names';
import { Writer, saveBytes } from '../lib/scratch';
import { ZipWriter, newEntry, readZip } from '../lib/zip';
import { Skip, type Job, type Output } from '../lib/types';
import { encodeJpeg } from './image';

/** 150 dpi: sharp on screen and in print, a reasonable size. */
const DPI = 150;
/** Per page: no edge above this, and never more pixels than this. */
const MAX_EDGE = 6000;
const MAX_PIXELS = 36_000_000;
const QUALITY = 90;

/** Every resource pdf.js may ask for, by file name → URL of the application file. */
const byName = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]));
const RESOURCES: Record<string, Record<string, string>> = {
  standardFontDataUrl: byName(import.meta.glob<string>('/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', { query: '?url', import: 'default', eager: true })),
  cMapUrl: byName(import.meta.glob<string>('/node_modules/pdfjs-dist/cmaps/*.bcmap', { query: '?url', import: 'default', eager: true })),
  wasmUrl: byName(import.meta.glob<string>('/node_modules/pdfjs-dist/wasm/{openjpeg,jbig2,qcms_bg}.wasm', { query: '?url', import: 'default', eager: true })),
};

/** Hands pdf.js the files above; anything else is refused. */
class LocalData {
  // pdf.js passes its options; nothing to keep.
  constructor(_: unknown) {}
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = RESOURCES[kind]?.[filename];
    if (!url) throw new Error(`no local ${kind} for ${filename}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${filename}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

/** Scratch canvases for pdf.js (patterns, masks, groups), without a document. */
class Canvases {
  constructor(_: unknown) {}
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) };
  }
  reset(c: { canvas: OffscreenCanvas }, width: number, height: number) {
    c.canvas.width = width;
    c.canvas.height = height;
  }
  destroy(c: { canvas: OffscreenCanvas | null; context: unknown }) {
    if (c.canvas) c.canvas.width = c.canvas.height = 0;
    c.canvas = null;
    c.context = null;
  }
}

/** SVG filters need a document: transfer functions are skipped (rare, colour-only). */
class NoFilters {
  constructor(_: unknown) {}
  addFilter() {
    return 'none';
  }
  addHCMFilter() {
    return 'none';
  }
  addAlphaFilter() {
    return 'none';
  }
  addLuminosityFilter() {
    return 'none';
  }
  addHighlightHCMFilter() {
    return 'none';
  }
  destroy() {}
}

type Target = 'jpg' | 'png' | 'webp';

/** Open a PDF with pdf.js inside this worker: fake worker, application resources only, no scripting. */
export async function openPdf(data: Uint8Array, password?: string) {
  const g = globalThis as typeof globalThis & { pdfjsWorker?: unknown; fonts?: FontFaceSet };
  g.pdfjsWorker ??= await import('pdfjs-dist/build/pdf.worker.mjs');
  const pdfjs = await import('pdfjs-dist');

  const task = pdfjs.getDocument({
    data,
    password,
    // Workers have their own font set: embedded fonts load as real fonts there.
    ownerDocument: (g.fonts ? { fonts: g.fonts } : undefined) as unknown as HTMLDocument,
    disableFontFace: !g.fonts,
    useSystemFonts: false,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: true,
    enableXfa: false,
    stopAtErrors: false,
    BinaryDataFactory: LocalData,
    CanvasFactory: Canvases,
    FilterFactory: NoFilters,
    standardFontDataUrl: 'local/',
    cMapUrl: 'local/',
    wasmUrl: 'local/',
    verbosity: 0,
  });
  try {
    return await task.promise;
  } catch (e) {
    await task.destroy();
    throw e;
  }
}

export async function pdfToImages(job: Job, target: Target): Promise<Output> {
  let doc: Awaited<ReturnType<typeof openPdf>>;
  try {
    doc = await openPdf(new Uint8Array(await job.file.arrayBuffer()), job.password);
  } catch (e) {
    // pdf.js: code 1 = a password is needed, 2 = the one given is wrong. The user is asked again.
    if ((e as Error).name === 'PasswordException') throw new Skip((e as { code?: number }).code === 2 ? 'password-wrong' : 'password');
    throw new Skip('corrupt');
  }

  try {
    const pages = doc.numPages;
    const base = safeName(job.file.name).replace(/\.[^.]*$/, '') || 'page';
    const digits = Math.max(3, String(pages).length);
    const zip = pages > 1 ? await Writer.create(job.id, 'out.zip') : null;
    const writer = zip ? new ZipWriter(zip) : null;
    let single: Uint8Array | null = null;
    let decoded = 0;

    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      const unit = page.getViewport({ scale: 1 });
      const scale = Math.min(DPI / 72, MAX_EDGE / Math.max(unit.width, unit.height), Math.sqrt(MAX_PIXELS / (unit.width * unit.height)));
      const viewport = page.getViewport({ scale });
      const canvas = new OffscreenCanvas(Math.max(1, Math.floor(viewport.width)), Math.max(1, Math.floor(viewport.height)));
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      // 'print': no animation frames (none in a worker), and what a printout shows.
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport, intent: 'print', background: '#ffffff' }).promise;
      page.cleanup();

      const bytes = await encode(canvas, context, target);
      if (await decodes(bytes, canvas.width, canvas.height)) decoded++;
      if (writer) writer.put(newEntry(`${base}-${String(n).padStart(digits, '0')}.${target}`), new Uint8Array(0), 0, crc32(bytes), bytes.length, bytes);
      else single = bytes;
      canvas.width = canvas.height = 0;
      job.progress((n / pages) * 0.95);
    }

    job.step('verify');
    job.check('Every page rendered', decoded === pages);
    const engine = `pdf.js, ${DPI} dpi → ${target.toUpperCase()}`;
    if (!writer) return { ...(await saveBytes(job.id, `out.${target}`, single!)), ext: target, engine, lossless: false };

    writer.finish(new Uint8Array(0));
    const file = await zip!.close();
    try {
      job.check('One picture per page', (await readZip(file)).entries.length === pages);
    } catch {
      job.check('Archive reopens', false);
    }
    return { file, path: zip!.path, ext: 'zip', engine, lossless: false };
  } finally {
    await doc.destroy();
  }
}

async function encode(canvas: OffscreenCanvas, ctx: OffscreenCanvasRenderingContext2D, target: Target): Promise<Uint8Array> {
  if (target === 'jpg') return encodeJpeg(ctx.getImageData(0, 0, canvas.width, canvas.height), QUALITY, false);
  const blob = await canvas.convertToBlob(target === 'png' ? { type: 'image/png' } : { type: 'image/webp', quality: QUALITY / 100 });
  if (blob.type !== `image/${target}`) throw new Skip('no-codec');
  return new Uint8Array(await blob.arrayBuffer());
}

async function decodes(bytes: Uint8Array, width: number, height: number) {
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
    const ok = bmp.width === width && bmp.height === height;
    bmp.close();
    return ok;
  } catch {
    return false;
  }
}
