/**
 * PDF, rewritten object by object with pdf-lib.
 *
 * Lossless: JPEG images re-coded losslessly, streams re-deflated with
 *           libdeflate, identical streams merged, unused objects dropped,
 *           object streams.
 * Lossy:    JPEG images (RGB / grey) re-encoded with MozJPEG and downscaled.
 *
 * Never touched: encrypted or signed PDFs. Sensitivity labels survive
 * metadata removal.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, type PDFContext, type PDFObject } from 'pdf-lib';
import { optimizeJpegLossless, sameCoefficients } from './jpeg';
import { encodeJpeg } from './image';
import { BEST_MAX, inflate, zlibBest } from '../lib/deflate';
import { saveBytes } from '../lib/scratch';
import { Skip, type Engine, type Mode } from '../lib/types';

const N = PDFName.of;
/** pdf-lib holds the whole document in memory and rewrites it: keep it reasonable. */
const MAX_PDF = 500 * 1024 ** 2;
const LOSSY: Record<Mode, { quality: number; maxEdge: number } | null> = {
  lossless: null,
  balanced: { quality: 78, maxEdge: 2400 },
  compact: { quality: 62, maxEdge: 1600 },
};
/** Purview / AIP sensitivity labels and classification markings. */
const LABEL = /MSIP_Label|Classification|Sensitivity|Confidentiality/i;

export const pdfEngine: Engine = async (job) => {
  if (job.file.size > MAX_PDF) throw new Skip('too-large');
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(new Uint8Array(await job.file.arrayBuffer()), { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  } catch {
    throw new Skip('corrupt');
  }
  if (doc.isEncrypted) throw new Skip('encrypted');
  const ctx = doc.context;
  if (isSigned(ctx)) throw new Skip('signed');
  const pages = doc.getPageCount();
  const lossy = LOSSY[job.mode];

  const streams = ctx.enumerateIndirectObjects().filter((o): o is [PDFRef, PDFRawStream] => o[1] instanceof PDFRawStream);
  // Images used as masks stay lossless.
  const masks = new Set(streams.flatMap(([, s]) => [s.dict.get(N('SMask')), s.dict.get(N('Mask'))]).filter((r) => r instanceof PDFRef).map((r) => (r as PDFRef).tag));
  let i = 0;
  for (const [ref, s] of streams) {
    job.progress((i++ / streams.length) * 0.9);
    const filter = s.dict.lookup(N('Filter'));
    const only = (name: string) => filter instanceof PDFName ? filter.decodeText() === name : filter instanceof PDFArray && filter.size() === 1 && filter.lookup(0) instanceof PDFName && (filter.lookup(0) as PDFName).decodeText() === name;
    try {
      if (only('DCTDecode')) await optimizeJpegStream(ctx, ref, s, masks.has(ref.tag) ? null : lossy);
      else if (only('FlateDecode') || !filter) recompress(ctx, ref, s, !filter, await inflateOrNull(s, !filter));
    } catch {
      /* malformed stream: leave it as it is */
    }
  }

  if (job.stripMetadata) stripMetadata(doc);
  mergeDuplicates(ctx);
  dropUnused(ctx);
  job.step('verify');
  const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });

  try {
    const again = await PDFDocument.load(bytes, { updateMetadata: false });
    job.check('Reopens and parses', true);
    job.check('Page count preserved', again.getPageCount() === pages);
  } catch {
    job.check('Reopens and parses', false);
  }
  return { ...(await saveBytes(job.id, 'out.pdf', bytes)), ext: 'pdf', engine: 'pdf-lib · JPEG · libdeflate', lossless: !lossy };
};

async function inflateOrNull(s: PDFRawStream, raw: boolean) {
  if (raw) return s.contents;
  return inflate(s.contents, 'deflate', BEST_MAX).catch(() => null);
}

/** Lossless JPEG first; a lossy re-encode must beat it by 10 %. */
async function optimizeJpegStream(ctx: PDFContext, ref: PDFRef, s: PDFRawStream, lossy: (typeof LOSSY)[Mode]) {
  let best: { data: Uint8Array; width?: number; height?: number } | null = null;
  const lossless = optimizeJpegLossless(s.contents, { stripMetadata: true });
  if (lossless && sameCoefficients(s.contents, lossless.bytes)) best = { data: lossless.bytes };

  const gray = colorComponents(ctx, s.dict);
  const w = s.dict.lookup(N('Width'));
  const h = s.dict.lookup(N('Height'));
  const pixels = w instanceof PDFNumber && h instanceof PDFNumber ? w.asNumber() * h.asNumber() : Infinity;
  if (lossy && gray !== null && pixels <= 120_000_000 && !s.dict.has(N('Decode')) && !(s.dict.get(N('Mask')) instanceof PDFArray)) {
    const bmp = await createImageBitmap(new Blob([s.contents as BlobPart], { type: 'image/jpeg' }), { colorSpaceConversion: 'none', imageOrientation: 'none' });
    const scale = Math.min(1, lossy.maxEdge / Math.max(bmp.width, bmp.height));
    const width = Math.max(1, Math.round(bmp.width * scale));
    const height = Math.max(1, Math.round(bmp.height * scale));
    const c = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!;
    c.imageSmoothingQuality = 'high';
    c.drawImage(bmp, 0, 0, width, height);
    bmp.close();
    const data = await encodeJpeg(c.getImageData(0, 0, width, height), lossy.quality, gray);
    if (data.length < (best?.data.length ?? s.contents.length) * 0.9) best = { data, width, height };
  }
  if (!best || best.data.length >= s.contents.length) return;
  const dict = s.dict.clone(ctx);
  if (best.width) {
    dict.set(N('Width'), PDFNumber.of(best.width));
    dict.set(N('Height'), PDFNumber.of(best.height!));
    dict.set(N('BitsPerComponent'), PDFNumber.of(8));
  }
  ctx.assign(ref, PDFRawStream.of(dict, best.data));
}

/** true = grey, false = RGB, null = anything else (left alone). */
function colorComponents(ctx: PDFContext, dict: PDFDict): boolean | null {
  const cs = ctx.lookup(dict.get(N('ColorSpace')));
  if (cs instanceof PDFName) return cs.decodeText() === 'DeviceGray' ? true : cs.decodeText() === 'DeviceRGB' ? false : null;
  if (cs instanceof PDFArray && cs.size() === 2 && (ctx.lookup(cs.get(0)) as PDFName)?.decodeText?.() === 'ICCBased') {
    const n = (ctx.lookup(cs.get(1)) as PDFStream | undefined)?.dict.lookup(N('N'));
    return n instanceof PDFNumber ? (n.asNumber() === 1 ? true : n.asNumber() === 3 ? false : null) : null;
  }
  return null;
}

/** Deflate uncompressed streams, re-deflate Flate ones; keep only real wins. */
function recompress(ctx: PDFContext, ref: PDFRef, s: PDFRawStream, raw: boolean, data: Uint8Array | null) {
  const type = (s.dict.get(N('Type')) as PDFName | undefined)?.decodeText?.();
  if (!data || data.length < 256 || data.length > BEST_MAX || type === 'Metadata' || type === 'XRef' || type === 'ObjStm') return;
  const packed = zlibBest(data);
  if (packed.length >= s.contents.length * 0.99) return;
  const dict = s.dict.clone(ctx);
  if (raw) dict.set(N('Filter'), N('FlateDecode'));
  ctx.assign(ref, PDFRawStream.of(dict, packed));
}

function isSigned(ctx: PDFContext): boolean {
  for (const [, o] of ctx.enumerateIndirectObjects()) {
    const d = o instanceof PDFDict ? o : o instanceof PDFStream ? o.dict : null;
    if (!d) continue;
    // /Type is optional in signature dictionaries; /ByteRange + /Contents is the tell.
    if (d.has(N('ByteRange')) && d.has(N('Contents'))) return true;
    const t = (d.get(N('Type')) as PDFName | undefined)?.decodeText?.();
    if (t === 'Sig' || t === 'DocTimeStamp') return true;
  }
  const acro = (ctx.lookup(ctx.trailerInfo.Root) as PDFDict | undefined)?.lookup(N('AcroForm'));
  const flags = acro instanceof PDFDict ? acro.lookup(N('SigFlags')) : undefined;
  return flags instanceof PDFNumber && (flags.asNumber() & 1) === 1;
}

/** Remove author / producer / XMP, but never a sensitivity label. */
function stripMetadata(doc: PDFDocument) {
  const ctx = doc.context;
  const xmp = ctx.lookup(doc.catalog.get(N('Metadata')));
  // Keep the XMP packet when it holds a label or cannot be inspected safely.
  const keep = xmp !== undefined && (!(xmp instanceof PDFRawStream) || mayHoldLabel(xmp));
  if (!keep) doc.catalog.delete(N('Metadata'));
  const info = ctx.lookup(ctx.trailerInfo.Info);
  if (info instanceof PDFDict) for (const k of info.keys()) if (k.decodeText() !== 'Title' && !LABEL.test(k.decodeText())) info.delete(k);
}

/**
 * True unless the whole XMP packet was read and holds no label. Too large,
 * compressed with an unknown filter, or unreadable: assume it may.
 */
function mayHoldLabel(xmp: PDFRawStream): boolean {
  const data = xmp.getContents();
  if (data.length > 64 << 20 || xmp.dict.has(N('Filter'))) return true;
  const text = new TextDecoder('latin1').decode(data);
  // Labels in UTF-16 packets show up once the zero bytes are removed.
  return LABEL.test(text) || LABEL.test(text.replace(/\0/g, ''));
}

/** Point every reference to identical streams (a logo on each page…) at one copy. */
function mergeDuplicates(ctx: PDFContext) {
  const seen = new Map<string, [PDFRef, Uint8Array][]>();
  const alias = new Map<string, PDFRef>();
  for (const [ref, o] of ctx.enumerateIndirectObjects()) {
    if (!(o instanceof PDFRawStream) || o.contents.length < 512) continue;
    const key = `${o.contents.length}|${o.dict.toString()}`;
    const group = seen.get(key) ?? [];
    const twin = group.find(([, c]) => c.every((b, i) => b === o.contents[i]));
    if (twin) alias.set(ref.tag, twin[0]);
    else group.push([ref, o.contents]), seen.set(key, group);
  }
  if (!alias.size) return;
  const swap = (v: PDFObject) => (v instanceof PDFRef ? alias.get(v.tag) : undefined);
  for (const [, o] of ctx.enumerateIndirectObjects()) {
    const containers = [o instanceof PDFStream ? o.dict : o];
    while (containers.length) {
      const c = containers.pop();
      if (c instanceof PDFDict) for (const [k, v] of c.entries()) swap(v) ? c.set(k, swap(v)!) : containers.push(v);
      else if (c instanceof PDFArray) for (let i = 0; i < c.size(); i++) swap(c.get(i)) ? c.set(i, swap(c.get(i))!) : containers.push(c.get(i));
    }
  }
}

/** Mark and sweep from the trailer: unreachable objects are dead weight. */
function dropUnused(ctx: PDFContext) {
  const live = new Set<string>();
  const todo: (PDFObject | undefined)[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt, ctx.trailerInfo.ID];
  while (todo.length) {
    const o = todo.pop();
    if (o instanceof PDFRef) {
      if (!live.has(o.tag)) live.add(o.tag), todo.push(ctx.lookup(o));
    } else if (o instanceof PDFDict) todo.push(...o.entries().map(([, v]) => v));
    else if (o instanceof PDFArray) todo.push(...o.asArray());
    else if (o instanceof PDFStream) todo.push(o.dict);
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!live.has(ref.tag)) ctx.delete(ref);
}
