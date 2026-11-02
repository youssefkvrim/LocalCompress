/**
 * The PDF workshop's operations, with pdf-lib, inside a worker.
 *
 * merge, split, organise (order, rotation, deletion), rotate, watermark.
 * Every result is reopened and its page count checked before it is offered;
 * a split is delivered as a ZIP of PDFs (stored, PDFs are already compressed).
 * Thumbnails are rendered with pdf.js (engines/pdfimages.ts openPdf).
 */
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont } from 'pdf-lib';
import { crc32 } from '../lib/crc32';
import { BlobSink, ZipWriter, newEntry } from '../lib/zip';
import type { NetEntry } from '../lib/types';

export type DeskReason = 'encrypted' | 'corrupt' | 'invalid';
export type PageSpec = { index: number; rotate: number };

export type DeskRequest =
  | { op: 'info'; file: File }
  | { op: 'thumbs'; file: File; width: number }
  | { op: 'merge'; files: File[] }
  | { op: 'split'; file: File; groups: number[][]; base: string }
  | { op: 'organize'; file: File; pages: PageSpec[] }
  | { op: 'rotate'; file: File; angle: number }
  | { op: 'watermark'; file: File; text: string; opacity: number; size: number };

export type DeskReply =
  | { type: 'net'; entry: NetEntry }
  | { type: 'thumb'; index: number; blob: Blob }
  | { type: 'progress'; value: number }
  | { type: 'done'; pages?: number; blob?: Blob; ext?: 'pdf' | 'zip' }
  | { type: 'error'; reason: DeskReason; message: string };

export class DeskError extends Error {
  reason: DeskReason;
  constructor(reason: DeskReason, message: string = reason) {
    super(message);
    this.reason = reason;
  }
}

/** Thumbnails are only drawn for this many pages. */
const MAX_THUMBS = 400;

export async function run(req: DeskRequest, post: (m: DeskReply) => void): Promise<DeskReply> {
  const progress = (value: number) => post({ type: 'progress', value });
  switch (req.op) {
    case 'info':
      return { type: 'done', pages: (await open(req.file)).getPageCount() };
    case 'thumbs':
      await thumbs(req.file, req.width, (index, blob) => post({ type: 'thumb', index, blob }));
      return { type: 'done' };
    case 'merge':
      return pdf(await merge(req.files, progress));
    case 'split':
      return split(req.file, req.groups, req.base, progress);
    case 'organize': {
      const src = await open(req.file);
      checkIndices(req.pages.map((p) => p.index), src.getPageCount());
      return pdf(await subset(src, req.pages));
    }
    case 'rotate': {
      const doc = await open(req.file);
      for (const page of doc.getPages()) page.setRotation(degrees(turn(page.getRotation().angle + req.angle)));
      return pdf(await finish(doc, doc.getPageCount()));
    }
    case 'watermark':
      return pdf(await watermark(req.file, req.text, req.opacity, req.size));
  }
}

async function open(file: File) {
  try {
    return await PDFDocument.load(new Uint8Array(await file.arrayBuffer()), { updateMetadata: false });
  } catch (e) {
    const message = (e as Error).message;
    throw new DeskError(/encrypt/i.test(message) ? 'encrypted' : 'corrupt', message);
  }
}

/** Save, then reopen the result and check its pages: any doubt and nothing is offered. */
async function finish(doc: PDFDocument, expected: number) {
  const bytes = await doc.save({ useObjectStreams: true });
  let pages = -1;
  try {
    pages = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
  } catch {
    /* reported below */
  }
  if (pages !== expected) throw new DeskError('invalid', `expected ${expected} pages, got ${pages}`);
  return bytes;
}

const pdf = (bytes: Uint8Array): DeskReply => ({ type: 'done', blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), ext: 'pdf' });
const turn = (a: number) => (((Math.round(a / 90) * 90) % 360) + 360) % 360;

function checkIndices(indices: number[], count: number) {
  if (!indices.length || indices.some((i) => !Number.isInteger(i) || i < 0 || i >= count)) throw new DeskError('invalid', 'page out of range');
}

async function merge(files: File[], progress: (f: number) => void) {
  const out = await PDFDocument.create();
  let total = 0;
  for (const [i, file] of files.entries()) {
    const src = await open(file);
    for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
    total += src.getPageCount();
    progress(((i + 1) / files.length) * 0.9);
  }
  return finish(out, total);
}

/** A new document with these pages of `src`, in this order, each turned by its own angle. */
async function subset(src: PDFDocument, pages: PageSpec[]) {
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pages.map((p) => p.index));
  copied.forEach((page, i) => {
    if (pages[i].rotate) page.setRotation(degrees(turn(page.getRotation().angle + pages[i].rotate)));
    out.addPage(page);
  });
  return finish(out, pages.length);
}

async function split(file: File, groups: number[][], base: string, progress: (f: number) => void): Promise<DeskReply> {
  const src = await open(file);
  checkIndices(groups.flat(), src.getPageCount());
  if (groups.length === 1) return pdf(await subset(src, groups[0].map((index) => ({ index, rotate: 0 }))));
  const sink = new BlobSink();
  const zip = new ZipWriter(sink);
  const digits = Math.max(2, String(groups.length).length);
  for (const [i, group] of groups.entries()) {
    const bytes = await subset(src, group.map((index) => ({ index, rotate: 0 })));
    zip.put(newEntry(`${base}-${String(i + 1).padStart(digits, '0')}.pdf`), new Uint8Array(0), 0, crc32(bytes), bytes.length, bytes);
    progress(((i + 1) / groups.length) * 0.95);
  }
  zip.finish(new Uint8Array(0));
  return { type: 'done', blob: new Blob(sink.parts, { type: 'application/zip' }), ext: 'zip' };
}

/** The text, diagonally across the middle of every page, in grey. */
async function watermark(file: File, text: string, opacity: number, size: number) {
  const doc = await open(file);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const label = encodable(font, text);
  if (!label) throw new DeskError('invalid', 'empty watermark');
  const alpha = Math.min(0.9, Math.max(0.05, opacity));
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const angle = Math.atan2(height, width);
    // Never wider than the page's diagonal.
    const s = Math.min(size, (Math.hypot(width, height) * 0.8) / Math.max(1, font.widthOfTextAtSize(label, 1)));
    const w = font.widthOfTextAtSize(label, s);
    page.drawText(label, {
      x: width / 2 - (w / 2) * Math.cos(angle) + (s / 3) * Math.sin(angle),
      y: height / 2 - (w / 2) * Math.sin(angle) - (s / 3) * Math.cos(angle),
      size: s,
      font,
      color: rgb(0.45, 0.45, 0.45),
      opacity: alpha,
      rotate: degrees((angle * 180) / Math.PI),
    });
  }
  return finish(doc, doc.getPageCount());
}

/** The standard fonts only cover Latin-1: anything else becomes "?". */
function encodable(font: PDFFont, text: string) {
  const clean = text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().slice(0, 120);
  try {
    font.encodeText(clean);
    return clean;
  } catch {
    return clean.replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
  }
}

async function thumbs(file: File, width: number, post: (index: number, blob: Blob) => void) {
  const { openPdf } = await import('./pdfimages');
  let doc: Awaited<ReturnType<typeof openPdf>>;
  try {
    doc = await openPdf(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    throw new DeskError((e as Error).name === 'PasswordException' ? 'encrypted' : 'corrupt', (e as Error).message);
  }
  try {
    for (let n = 1; n <= Math.min(doc.numPages, MAX_THUMBS); n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
      const canvas = new OffscreenCanvas(Math.max(1, Math.floor(viewport.width)), Math.max(1, Math.floor(viewport.height)));
      const context = canvas.getContext('2d')!;
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport, intent: 'print', background: '#ffffff' }).promise;
      page.cleanup();
      post(n - 1, await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 }));
    }
  } finally {
    await doc.destroy();
  }
}
