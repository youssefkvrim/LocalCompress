import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, type PDFContext, type PDFObject } from 'pdf-lib';
import { unzlibSync } from 'fflate';
import {
  MIN_SAVING,
  RefusedError,
  ScratchWriter,
  formatBytes,
  outputNameFor,
  type EngineContext,
  type EngineOutput,
} from '@localcompress/core';
import { BEST_MAX, zlibBest } from '@localcompress/core/deflate';
import { MAX_PIXELS, optimizeJpegLossless, sameCoefficients, targetSize, validateImage } from '@localcompress/image';

const N = (s: string) => PDFName.of(s);
const MAX_PDF_BYTES = 1.5 * 1024 ** 3;
const MAX_STREAM = BEST_MAX;
/** Microsoft Purview / AIP sensitivity labels and classification markings must survive metadata removal. */
const LABEL_KEY = /^(MSIP_Label|Classification|Sensitivity|Confidentiality)/i;
const LABEL_XMP = /MSIP_Label|sensitivity|classification/i;

interface Stats {
  images: number;
  jpegRecompressed: number;
  flateToJpeg: number;
  downscaled: number;
  streamsRecompressed: number;
  removedObjects: number;
  removedPieceInfo: number;
  removedThumbs: number;
  jpegLossless: number;
  deduplicated: number;
  imageBytesBefore: number;
  imageBytesAfter: number;
}

function filters(dict: PDFDict): string[] {
  const f = dict.get(N('Filter'));
  if (f instanceof PDFName) return [f.decodeText()];
  if (f instanceof PDFArray) return f.asArray().map((x) => (x instanceof PDFName ? x.decodeText() : '?'));
  return [];
}

const num = (ctx: PDFContext, dict: PDFDict, key: string): number | undefined => {
  const v = ctx.lookup(dict.get(N(key)));
  return v instanceof PDFNumber ? v.asNumber() : undefined;
};

/** Component count for colour spaces we can safely round-trip, else null. */
function components(ctx: PDFContext, dict: PDFDict): { n: 1 | 3; gray: boolean } | null {
  const cs = ctx.lookup(dict.get(N('ColorSpace')));
  if (cs instanceof PDFName) {
    const name = cs.decodeText();
    if (name === 'DeviceRGB') return { n: 3, gray: false };
    if (name === 'DeviceGray') return { n: 1, gray: true };
    return null;
  }
  if (cs instanceof PDFArray && cs.size() === 2) {
    const kind = ctx.lookup(cs.get(0));
    const icc = ctx.lookup(cs.get(1));
    if (kind instanceof PDFName && kind.decodeText() === 'ICCBased' && icc instanceof PDFStream) {
      const n = num(ctx, icc.dict, 'N');
      if (n === 3) return { n: 3, gray: false };
      if (n === 1) return { n: 1, gray: true };
    }
  }
  return null;
}

/** Undo PNG predictors (Predictor ≥ 10) in place-ish. */
function unpredict(data: Uint8Array, columns: number, colors: number): Uint8Array | null {
  const bpp = colors;
  const row = columns * colors;
  const rows = Math.floor(data.length / (row + 1));
  const out = new Uint8Array(rows * row);
  for (let y = 0; y < rows; y++) {
    const type = data[y * (row + 1)];
    const src = y * (row + 1) + 1;
    const dst = y * row;
    for (let x = 0; x < row; x++) {
      const raw = data[src + x];
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = y > 0 ? out[dst - row + x] : 0;
      const c = x >= bpp && y > 0 ? out[dst - row + x - bpp] : 0;
      let v: number;
      switch (type) {
        case 0: v = raw; break;
        case 1: v = raw + a; break;
        case 2: v = raw + b; break;
        case 3: v = raw + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: return null;
      }
      out[dst + x] = v & 0xff;
    }
  }
  return out;
}

/** Diagrams, screenshots and text scans have few colours — keep those lossless. */
function looksPhotographic(px: Uint8Array, n: number): boolean {
  const seen = new Set<number>();
  const count = px.length / n;
  const step = Math.max(1, Math.floor(count / 20_000));
  for (let i = 0; i < count; i += step) {
    const o = i * n;
    seen.add(n === 3 ? (px[o] << 16) | (px[o + 1] << 8) | px[o + 2] : px[o]);
    if (seen.size > (n === 3 ? 2048 : 96)) return true;
  }
  return false;
}

function toImageData(px: Uint8Array, w: number, h: number, n: number): ImageData {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += n) {
    rgba[i * 4] = px[j];
    rgba[i * 4 + 1] = n === 3 ? px[j + 1] : px[j];
    rgba[i * 4 + 2] = n === 3 ? px[j + 2] : px[j];
    rgba[i * 4 + 3] = 255;
  }
  return new ImageData(rgba, w, h);
}

async function jpegFromImageData(img: ImageData, quality: number, gray: boolean): Promise<Uint8Array> {
  const { default: encode } = await import('@jsquash/jpeg/encode.js');
  // MozJpegColorSpace: 1 = GRAYSCALE, 3 = YCbCr
  return new Uint8Array(await encode(img, { quality, progressive: true, optimize_coding: true, color_space: gray ? 1 : 3, chroma_quality: quality }));
}

async function scaleImageData(source: ImageBitmap | ImageData, w: number, h: number): Promise<ImageData> {
  const bmp = source instanceof ImageData ? await createImageBitmap(source) : source;
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h);
  if (source instanceof ImageData) bmp.close();
  return g.getImageData(0, 0, w, h);
}

/** Mark-and-sweep from the trailer: anything unreachable is dead weight. */
function collectGarbage(context: PDFContext): number {
  const live = new Set<string>();
  const stack: (PDFObject | undefined)[] = [context.trailerInfo.Root, context.trailerInfo.Info, context.trailerInfo.Encrypt, context.trailerInfo.ID];
  while (stack.length) {
    const o = stack.pop();
    if (!o) continue;
    if (o instanceof PDFRef) {
      if (live.has(o.tag)) continue;
      live.add(o.tag);
      stack.push(context.lookup(o));
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) stack.push(v);
    } else if (o instanceof PDFArray) {
      for (const v of o.asArray()) stack.push(v);
    } else if (o instanceof PDFStream) {
      stack.push(o.dict);
    }
  }
  let removed = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!live.has(ref.tag)) context.delete(ref), removed++;
  }
  return removed;
}

function isSigned(context: PDFContext): boolean {
  for (const [, o] of context.enumerateIndirectObjects()) {
    const d = o instanceof PDFDict ? o : o instanceof PDFStream ? o.dict : null;
    if (!d) continue;
    // /Type is optional in signature dictionaries: /ByteRange + /Contents is the tell.
    if (d.has(N('ByteRange')) && d.has(N('Contents'))) return true;
    const type = d.get(N('Type'));
    if (type instanceof PDFName && (type.decodeText() === 'Sig' || type.decodeText() === 'DocTimeStamp')) return true;
  }
  const acro = context.lookup(context.trailerInfo.Root) instanceof PDFDict ? (context.lookup(context.trailerInfo.Root) as PDFDict).lookup(N('AcroForm')) : undefined;
  if (acro instanceof PDFDict) {
    const flags = acro.lookup(N('SigFlags'));
    if (flags instanceof PDFNumber && (flags.asNumber() & 1) === 1) return true;
  }
  return false;
}

export async function compressPdf(ctx: EngineContext): Promise<EngineOutput> {
  const { file, params, settings } = ctx;
  if (file.size > MAX_PDF_BYTES) throw new RefusedError(`PDFs above ${formatBytes(MAX_PDF_BYTES)} are not yet supported by the in-browser PDF engine`, 'too-large');

  ctx.stage('analyze');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  } catch (e) {
    throw new RefusedError(`PDF could not be parsed safely: ${(e as Error).message}`, 'corrupt');
  }
  if (doc.isEncrypted) throw new RefusedError('Password-protected / encrypted PDF — not modified', 'encrypted');
  const context = doc.context;
  if (isSigned(context)) throw new RefusedError('Digitally signed PDF — optimising would invalidate the signature', 'signed');
  const pageCount = doc.getPageCount();
  const objects = context.enumerateIndirectObjects();

  // Images used as masks must stay lossless.
  const maskRefs = new Set<string>();
  for (const [, o] of objects) {
    const d = o instanceof PDFStream ? o.dict : o instanceof PDFDict ? o : null;
    for (const k of ['SMask', 'Mask']) {
      const r = d?.get(N(k));
      if (r instanceof PDFRef) maskRefs.add(r.tag);
    }
  }
  const imageRefs = objects.filter(([, o]) => o instanceof PDFRawStream && (o.dict.get(N('Subtype')) as PDFName | undefined)?.decodeText?.() === 'Image');
  ctx.log(`${pageCount} pages · ${objects.length} objects · ${imageRefs.length} images`);

  ctx.stage('strategy');
  const maxDim = params.documentMaxDimension;
  ctx.plan({
    engine: 'pdf-lib + MozJPEG + DEFLATE',
    summary: [`Images ${maxDim ? `≤ ${maxDim}px, ` : ''}Q${params.imageQuality}`, 'object streams', settings.stripMetadata ? 'metadata stripped' : null, 'unused objects removed']
      .filter(Boolean)
      .join(' · '),
  });

  ctx.stage('candidate');
  const s: Stats = { images: imageRefs.length, jpegRecompressed: 0, flateToJpeg: 0, downscaled: 0, streamsRecompressed: 0, removedObjects: 0, removedPieceInfo: 0, removedThumbs: 0, jpegLossless: 0, deduplicated: 0, imageBytesBefore: 0, imageBytesAfter: 0 };
  let i = 0;
  for (const [ref, obj] of imageRefs as [PDFRef, PDFRawStream][]) {
    ctx.progress(i++ / Math.max(1, imageRefs.length), `Image ${i} / ${imageRefs.length}`);
    if (maskRefs.has(ref.tag)) continue;
    try {
      await optimiseImage(ctx, context, ref, obj, maxDim, s);
    } catch (e) {
      ctx.log(`Image ${ref.tag} left unchanged: ${(e as Error).message}`);
    }
  }

  // Page-level dead weight: editor private data and embedded thumbnails.
  // Editor data (e.g. Illustrator re-editability) is content: never dropped in lossless mode.
  if (!params.lossless && params.preset !== 'quality') {
    for (const page of doc.getPages()) {
      if (page.node.has(N('PieceInfo'))) page.node.delete(N('PieceInfo')), s.removedPieceInfo++;
      if (page.node.has(N('Thumb'))) page.node.delete(N('Thumb')), s.removedThumbs++;
    }
  }
  let labelsKept = 0;
  if (settings.stripMetadata) {
    const xmp = context.lookup(doc.catalog.get(N('Metadata')));
    const xmpHasLabel = xmp instanceof PDFRawStream && LABEL_XMP.test(new TextDecoder().decode(xmp.getContents().subarray(0, 4 * 1024 * 1024)));
    if (xmpHasLabel) labelsKept++;
    else doc.catalog.delete(N('Metadata'));
    doc.catalog.delete(N('PieceInfo'));
    const info = context.lookup(context.trailerInfo.Info);
    if (info instanceof PDFDict)
      for (const k of info.keys()) {
        const name = k.decodeText();
        if (name === 'Title') continue;
        if (LABEL_KEY.test(name)) {
          labelsKept++;
          continue;
        }
        info.delete(k);
      }
  }

  // Lossless: deflate uncompressed streams, re-deflate Flate streams at level 9.
  for (const [ref, o] of context.enumerateIndirectObjects()) {
    if (!(o instanceof PDFRawStream) || o.contents.length > MAX_STREAM || o.contents.length < 256) continue;
    const type = (o.dict.get(N('Type')) as PDFName | undefined)?.decodeText?.();
    if (type === 'Metadata' || type === 'XRef' || type === 'ObjStm') continue;
    const f = filters(o.dict);
    try {
      if (f.length === 0) {
        const z = zlibBest(o.contents);
        if (z.length < o.contents.length * 0.95) {
          const d = o.dict.clone(context);
          d.set(N('Filter'), N('FlateDecode'));
          context.assign(ref, PDFRawStream.of(d, z));
          s.streamsRecompressed++;
        }
      } else if (f.length === 1 && f[0] === 'FlateDecode') {
        const raw = unzlibSync(o.contents);
        if (raw.length > MAX_STREAM) continue;
        const z = zlibBest(raw);
        if (z.length < o.contents.length * 0.99) {
          context.assign(ref, PDFRawStream.of(o.dict.clone(context), z));
          s.streamsRecompressed++;
        }
      }
    } catch {
      /* malformed stream: leave untouched */
    }
  }

  s.deduplicated = deduplicateStreams(context);
  s.removedObjects = collectGarbage(context);
  ctx.progress(0.95, 'Writing object streams');
  const out = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });

  ctx.stage('validate');
  const head = new TextDecoder().decode(out.subarray(0, 8));
  const tail = new TextDecoder().decode(out.subarray(Math.max(0, out.length - 1024)));
  ctx.check('PDF header / trailer', head.startsWith('%PDF-') && tail.includes('%%EOF'), head.trim());
  try {
    const re = await PDFDocument.load(out, { updateMetadata: false });
    ctx.check('Reopens and parses', true, 'pdf-lib structural parse');
    ctx.check('Page count preserved', re.getPageCount() === pageCount, `${re.getPageCount()} / ${pageCount}`);
    const ok = re.getPages().every((p) => p.node.Resources() !== undefined || p.node.Contents() === undefined);
    ctx.check('Page resources resolve', ok);
  } catch (e) {
    ctx.check('Reopens and parses', false, (e as Error).message);
  }

  ctx.stage('compare');
  const details = [
    `${pageCount} pages · ${s.images} images`,
    `${s.jpegRecompressed + s.flateToJpeg} images re-encoded (${s.downscaled} downscaled) · ${formatBytes(s.imageBytesBefore)} → ${formatBytes(s.imageBytesAfter)}`,
    `${s.streamsRecompressed} streams recompressed losslessly`,
    `${s.removedObjects} unreferenced objects removed`,
  ];
  if (s.flateToJpeg) details.push(`${s.flateToJpeg} photographic lossless images converted to JPEG`);
  if (s.removedPieceInfo || s.removedThumbs) details.push(`Removed editor private data on ${s.removedPieceInfo} pages, ${s.removedThumbs} thumbnails`);
  if (settings.stripMetadata) details.push('Document metadata (author, producer, XMP) removed — title kept');
  if (s.jpegLossless) details.push(`${s.jpegLossless} JPEG images optimised losslessly (identical coefficients)`);
  if (s.deduplicated) details.push(`${s.deduplicated} duplicate streams merged`);
  if (labelsKept) details.push('Sensitivity / classification labels preserved');
  details.push('Fonts are kept as embedded (no subsetting)');

  if (out.length > file.size * (1 - MIN_SAVING)) {
    return { status: 'not-worth-it', reason: 'already-optimal', engine: 'pdf-lib', summary: `Already compact — best candidate ${formatBytes(out.length)}.`, details, outputSize: out.length };
  }
  const w = await ScratchWriter.create(ctx.jobId, 'output.pdf');
  w.write(out);
  w.close();
  return {
    status: 'optimized',
    outputPath: w.path,
    outputSize: out.length,
    outputName: outputNameFor(file.name, 'pdf'),
    mime: 'application/pdf',
    engine: 'pdf-lib · MozJPEG · DEFLATE',
    lossless: params.lossless,
    summary: params.lossless ? 'Lossless' : `${s.jpegRecompressed + s.flateToJpeg + s.jpegLossless} images optimised`,
    details,
  };
}

async function optimiseImage(ctx: EngineContext, context: PDFContext, ref: PDFRef, obj: PDFRawStream, maxDim: number, s: Stats) {
  const { params } = ctx;
  const d = obj.dict;
  const f = filters(d);

  // Lossless JPEG candidate: coefficients untouched, valid for any colour space and for masks.
  let lossless: Uint8Array | null = null;
  if (f.length === 1 && f[0] === 'DCTDecode') {
    const r = optimizeJpegLossless(obj.contents, { stripMetadata: true });
    if (r && r.bytes.length < obj.contents.length && sameCoefficients(obj.contents, r.bytes)) lossless = r.bytes;
  }
  const applyLossless = () => {
    if (!lossless) return;
    context.assign(ref, PDFRawStream.of(d.clone(context), lossless));
    s.imageBytesBefore += obj.contents.length;
    s.imageBytesAfter += lossless.length;
    s.jpegLossless++;
  };
  if (params.lossless) return applyLossless();
  const done = await optimiseImageLossy(ctx, context, ref, obj, maxDim, s, lossless);
  if (!done) applyLossless();
}

/** Returns true when a lossy replacement was applied. */
async function optimiseImageLossy(ctx: EngineContext, context: PDFContext, ref: PDFRef, obj: PDFRawStream, maxDim: number, s: Stats, lossless: Uint8Array | null): Promise<boolean> {
  const { params } = ctx;
  const d = obj.dict;
  const f = filters(d);
  const w = num(context, d, 'Width') ?? 0;
  const h = num(context, d, 'Height') ?? 0;
  if (!w || !h || w * h > MAX_PIXELS) return false;
  if (obj.contents.length < 16 * 1024) return false;
  if (d.get(N('ImageMask'))?.toString() === 'true' || d.has(N('Decode')) || d.get(N('Mask')) instanceof PDFArray) return false;
  const cs = components(context, d);
  if (!cs) return false;

  const target = targetSize(w, h, maxDim);
  const resize = target.width !== w || target.height !== h;
  let img: ImageData;
  let kind: 'jpeg' | 'flate';

  if (f.length === 1 && f[0] === 'DCTDecode') {
    kind = 'jpeg';
    const bmp = await createImageBitmap(new Blob([obj.contents as BlobPart], { type: 'image/jpeg' }), { colorSpaceConversion: 'none', imageOrientation: 'none' });
    if (bmp.width !== w || bmp.height !== h) return (bmp.close(), false);
    img = await scaleImageData(bmp, target.width, target.height);
    bmp.close();
  } else if (f.length === 1 && f[0] === 'FlateDecode' && params.lossyConversion) {
    kind = 'flate';
    if ((num(context, d, 'BitsPerComponent') ?? 8) !== 8) return false;
    let px: Uint8Array = unzlibSync(obj.contents);
    const parms = context.lookup(d.get(N('DecodeParms')));
    if (parms instanceof PDFDict) {
      const predictor = num(context, parms, 'Predictor') ?? 1;
      if (predictor >= 10) {
        // Predictor parameters must describe exactly this image, or the pixels would be misread.
        const columns = num(context, parms, 'Columns') ?? 1;
        const colors = num(context, parms, 'Colors') ?? 1;
        const bpc = num(context, parms, 'BitsPerComponent') ?? 8;
        if (columns !== w || colors !== cs.n || bpc !== 8) return false;
        const un = unpredict(px, columns, colors);
        if (!un) return false;
        px = un;
      } else if (predictor !== 1) return false;
    }
    if (px.length !== w * h * cs.n) return false;
    if (!looksPhotographic(px, cs.n)) return false;
    const full = toImageData(px, w, h, cs.n);
    img = resize ? await scaleImageData(full, target.width, target.height) : full;
  } else {
    return false;
  }

  const jpeg = await jpegFromImageData(img, params.imageQuality, cs.gray);
  // Keep only clear wins; tiny gains are not worth a generation of loss.
  const reference = lossless?.length ?? obj.contents.length;
  if (jpeg.length > reference * 0.9) return false;
  const v = await validateImage(jpeg, 'jpeg', target.width, target.height);
  if (!v.decodes || !v.dimensionsOk) return false;

  const nd = d.clone(context);
  nd.set(N('Width'), PDFNumber.of(target.width));
  nd.set(N('Height'), PDFNumber.of(target.height));
  nd.set(N('BitsPerComponent'), PDFNumber.of(8));
  nd.set(N('Filter'), N('DCTDecode'));
  nd.delete(N('DecodeParms'));
  context.assign(ref, PDFRawStream.of(nd, jpeg));
  s.imageBytesBefore += obj.contents.length;
  s.imageBytesAfter += jpeg.length;
  if (resize) s.downscaled++;
  if (kind === 'jpeg') s.jpegRecompressed++;
  else s.flateToJpeg++;
  return true;
}

/**
 * Merge byte-identical streams (same dictionary, same data) — e.g. a logo
 * embedded once per page — and repoint every reference to one copy.
 */
function deduplicateStreams(context: PDFContext): number {
  const groups = new Map<string, [PDFRef, PDFRawStream][]>();
  for (const [ref, o] of context.enumerateIndirectObjects()) {
    if (!(o instanceof PDFRawStream) || o.contents.length < 512) continue;
    const type = (o.dict.get(N('Type')) as PDFName | undefined)?.decodeText?.();
    if (type === 'XRef' || type === 'ObjStm') continue;
    const key = `${o.contents.length}|${o.dict.toString()}`;
    const g = groups.get(key);
    if (g) g.push([ref, o]);
    else groups.set(key, [[ref, o]]);
  }
  const alias = new Map<string, PDFRef>();
  for (const g of groups.values()) {
    for (let i = 1; i < g.length; i++) {
      const [ref, o] = g[i];
      const canon = g.find(([r, c], j) => j < i && !alias.has(r.tag) && equalBytes(c.contents, o.contents));
      if (canon) alias.set(ref.tag, canon[0]);
    }
  }
  if (!alias.size) return 0;
  const fix = (v: PDFObject | undefined): PDFObject | undefined => (v instanceof PDFRef && alias.has(v.tag) ? alias.get(v.tag) : v);
  const visit = (o: PDFObject | undefined) => {
    if (o instanceof PDFDict) {
      for (const [k, v] of o.entries()) {
        const n = fix(v);
        if (n !== v) o.set(k, n!);
        else visit(v);
      }
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) {
        const v = o.get(i);
        const n = fix(v);
        if (n !== v) o.set(i, n!);
        else visit(v);
      }
    } else if (o instanceof PDFStream) visit(o.dict);
  };
  for (const [, o] of context.enumerateIndirectObjects()) visit(o);
  return alias.size;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
