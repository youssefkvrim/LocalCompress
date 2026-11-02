/**
 * Conversion from one format to another, on the workstation.
 *
 * Pictures (JPEG, PNG, WebP, AVIF, GIF first frame, BMP: whatever this
 * browser decodes) → JPEG (MozJPEG q90), PNG (OxiPNG), WebP (browser
 * encoder) or a one-page PDF. A JPEG goes into a PDF as it is, byte for
 * byte, when nothing has to be turned or converted.
 *
 * PDF → one picture per page (pdfimages.ts).
 *
 * Videos and sounds → MP4 (H.264 + AAC), WebM (VP9 + Opus), M4A (AAC) or
 * WAV, through Mediabunny and WebCodecs. Streams already in the target
 * codec are copied, not re-encoded (MOV → MP4 is a re-wrap).
 *
 * Each result is reopened before it is offered, as for compression.
 */
import {
  ALL_FORMATS,
  BlobSource,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  VideoSampleSink,
  WavOutputFormat,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type AudioCodec,
  type VideoCodec,
} from 'mediabunny';
import { PDFDocument } from 'pdf-lib';
import { encodeJpeg, optimizePng } from './image';
import { exifOrientation } from './jpeg';
import { imageSize, sniff } from '../lib/detect';
import { Writer, saveBytes } from '../lib/scratch';
import { Skip, type Engine, type ImageTarget, type Job, type MediaTarget } from '../lib/types';

/** Above this, decoding could exhaust memory ("pixel bomb"). */
const MAX_PIXELS = 120_000_000;
/** OxiPNG is slow on large pictures; above this the browser's PNG is kept. */
const OXIPNG_MAX_PIXELS = 8_000_000;
const JPEG_QUALITY = 90;
/** A PDF page cannot exceed 200 inches (14 400 pt). */
const MAX_PAGE = 14_400;

export const convertEngine: Engine = async (job) => {
  const head = new Uint8Array(await job.file.slice(0, 4096).arrayBuffer());
  const { kind, format } = sniff(head);
  if (kind === 'image') return convertImage(job, format);
  if (kind === 'video' || kind === 'audio') return convertMedia(job, format);
  if (kind === 'pdf') {
    if (job.imageTarget === 'pdf') throw new Skip('same-format');
    return (await import('./pdfimages')).pdfToImages(job, job.imageTarget);
  }
  throw new Skip('unsupported');
};

// ── Pictures ──────────────────────────────────────────────────────────────

const SAME: Record<ImageTarget, string> = { jpg: 'jpeg', png: 'png', webp: 'webp', pdf: 'pdf' };

async function convertImage(job: Job, format: string) {
  const target = job.imageTarget;
  // An SVG arrives as a PNG drawn by the page (ui/svg.ts), still named .svg: PNG is a real conversion then.
  if (SAME[target] === format && !/\.svg$/i.test(job.file.name)) throw new Skip('same-format');
  const bytes = new Uint8Array(await job.file.arrayBuffer());
  if (format === 'jpeg' || format === 'png') {
    const size = imageSize(bytes, format);
    if (!size) throw new Skip('unreadable');
    if (size.width * size.height > MAX_PIXELS) throw new Skip('too-large');
  }

  // A JPEG that needs no turning goes into the PDF untouched.
  if (target === 'pdf' && format === 'jpeg') {
    const h = jpegHeader(bytes);
    if (h && h.orientation === 1 && (h.components === 1 || h.components === 3)) return savePdf(job, await jpegPdf(bytes), true);
  }

  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(new Blob([bytes as BlobPart]), { imageOrientation: 'from-image' });
  } catch {
    throw new Skip('no-codec');
  }
  const { width, height } = bmp;
  if (width * height > MAX_PIXELS) throw (bmp.close(), new Skip('too-large'));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  // JPEG has no transparency: transparent areas become white, as in every viewer.
  if (target === 'jpg') (ctx.fillStyle = '#ffffff'), ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  job.progress(0.3);

  let out: Uint8Array;
  let engine: string;
  if (target === 'jpg') {
    out = await encodeJpeg(ctx.getImageData(0, 0, width, height), JPEG_QUALITY, false);
    engine = `MozJPEG q${JPEG_QUALITY}`;
  } else if (target === 'png') {
    out = await png(canvas, width * height, job.stripMetadata);
    engine = width * height <= OXIPNG_MAX_PIXELS ? 'OxiPNG + libdeflate' : 'PNG';
  } else if (target === 'webp') {
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: JPEG_QUALITY / 100 });
    if (blob.type !== 'image/webp') throw new Skip('no-codec'); // this browser cannot write WebP
    out = new Uint8Array(await blob.arrayBuffer());
    engine = `WebP q${JPEG_QUALITY}`;
  } else {
    const image = ctx.getImageData(0, 0, width, height);
    const opaque = isOpaque(image.data);
    const data = opaque ? await encodeJpeg(image, JPEG_QUALITY, false) : await png(canvas, width * height, true);
    return savePdf(job, await imagePdf(data, opaque ? 'jpg' : 'png'), false);
  }
  job.progress(0.9);
  job.step('verify');
  job.check('Output decodes', await decodes(out, width, height));
  return { ...(await saveBytes(job.id, `out.${target}`, out)), ext: target, engine, lossless: target === 'png' };
}

async function png(canvas: OffscreenCanvas, pixels: number, strip: boolean) {
  const raw = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  return pixels <= OXIPNG_MAX_PIXELS ? optimizePng(raw, strip) : raw;
}

function isOpaque(px: Uint8ClampedArray) {
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) return false;
  return true;
}

/** Points for a picture at 96 dpi, scaled down to fit the largest PDF page. */
function pageSize(width: number, height: number) {
  const scale = Math.min(0.75, MAX_PAGE / Math.max(width, height));
  return [width * scale, height * scale] as const;
}

async function jpegPdf(jpeg: Uint8Array) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const img = await doc.embedJpg(jpeg);
  const [w, h] = pageSize(img.width, img.height);
  doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
  return doc;
}

async function imagePdf(data: Uint8Array, as: 'jpg' | 'png') {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const img = as === 'jpg' ? await doc.embedJpg(data) : await doc.embedPng(data);
  const [w, h] = pageSize(img.width, img.height);
  doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
  return doc;
}

async function savePdf(job: Job, doc: PDFDocument, lossless: boolean) {
  const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });
  job.step('verify');
  try {
    const again = await PDFDocument.load(bytes, { updateMetadata: false });
    job.check('Reopens and parses', true);
    job.check('One page', again.getPageCount() === 1);
  } catch {
    job.check('Reopens and parses', false);
  }
  return { ...(await saveBytes(job.id, 'out.pdf', bytes)), ext: 'pdf', engine: lossless ? 'pdf-lib, JPEG copied as is' : 'pdf-lib', lossless };
}

/** EXIF orientation and component count of a baseline / progressive 8-bit JPEG; null for anything else. */
function jpegHeader(b: Uint8Array): { orientation: number; components: number } | null {
  let orientation = 1;
  for (let p = 2; p + 4 <= b.length; ) {
    if (b[p] !== 0xff) return null;
    const m = b[p + 1];
    if (m === 0xff) {
      p++;
      continue;
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) {
      p += 2;
      continue;
    }
    const len = (b[p + 2] << 8) | b[p + 3];
    if (m === 0xe1) {
      const o = exifOrientation(b.subarray(p + 4, p + 2 + len));
      if (o !== 1) orientation = o;
    }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      // Only baseline, extended and progressive Huffman 8-bit: what every PDF reader decodes.
      if (m > 0xc2 || b[p + 4] !== 8) return null;
      return { orientation, components: b[p + 9] };
    }
    p += 2 + len;
  }
  return null;
}

async function decodes(bytes: Uint8Array, width: number, height: number): Promise<boolean> {
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
    const ok = bmp.width === width && bmp.height === height;
    bmp.close();
    return ok;
  } catch {
    return false;
  }
}

// ── Videos and sounds ─────────────────────────────────────────────────────

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

async function convertMedia(job: Job, format: string) {
  const target = job.mediaTarget;
  if (target === format) throw new Skip('same-format'); // wav → wav, m4a → m4a
  const input = new Input({ source: new BlobSource(job.file), formats: ALL_FORMATS });
  try {
    const video = target === 'm4a' || target === 'wav' ? null : await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (!video && !audio) throw new Skip('unsupported');
    if (video && !(await video.canDecode())) throw new Skip('no-codec');
    if (audio && !(await audio.canDecode())) throw new Skip('no-codec');
    const duration = await input.computeDuration();

    let videoCodec: VideoCodec | null = null;
    let size: { width: number; height: number } | null = null;
    if (video) {
      const w = await video.getDisplayWidth();
      const h = await video.getDisplayHeight();
      if (w * h > 7680 * 4320) throw new Skip('too-large');
      size = { width: even(w), height: even(h) };
      videoCodec = await getFirstEncodableVideoCodec(target === 'webm' ? ['vp9', 'vp8', 'av1'] : ['avc'], size);
      if (!videoCodec) throw new Skip('no-codec');
    }
    let audioCodec: AudioCodec | null = null;
    if (audio) {
      const wanted: AudioCodec[] = target === 'wav' ? ['pcm-s16'] : target === 'webm' ? ['opus', 'vorbis'] : ['aac', 'opus'];
      audioCodec = target === 'wav' ? 'pcm-s16' : await getFirstEncodableAudioCodec(wanted, { bitrate: QUALITY_HIGH });
      if (!audioCodec && !video) throw new Skip('no-codec');
    }

    const out = await Writer.create(job.id, `out.${target}`);
    const container = target === 'webm' ? new WebMOutputFormat() : target === 'wav' ? new WavOutputFormat() : new Mp4OutputFormat({ fastStart: false });
    const conversion = await Conversion.init({
      input,
      output: new Output({ format: container, target: new StreamTarget(out.writable() as WritableStream<never>, { chunked: true }) }),
      tracks: 'primary',
      video: videoCodec && size ? { codec: videoCodec, bitrate: QUALITY_HIGH, ...size, fit: 'fill', hardwareAcceleration: 'prefer-hardware', alpha: 'discard' } : { discard: true },
      audio: audioCodec ? { codec: audioCodec, bitrate: QUALITY_HIGH } : { discard: true },
      tags: job.stripMetadata ? () => ({}) : undefined,
      showWarnings: false,
    });
    if (!conversion.isValid) throw new Skip('unsupported');
    conversion.onProgress = (f) => job.progress(f * 0.95);
    await conversion.execute();
    const file = await out.close();
    job.step('verify');

    await validate(job, file, duration, !!videoCodec, !!audioCodec);
    const label = [videoCodec, audioCodec].filter(Boolean).join(' + ');
    return { file, path: out.path, ext: target, engine: `${label} (WebCodecs)`, lossless: false };
  } finally {
    input.dispose();
  }
}

async function validate(job: Job, file: File, duration: number, withVideo: boolean, withAudio: boolean) {
  const out = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const d = await out.computeDuration();
    job.check('Duration verified', Math.abs(d - duration) <= Math.max(0.5, duration * 0.01));
    job.check('Audio stream', !!(await out.getPrimaryAudioTrack()) === withAudio);
    const video = await out.getPrimaryVideoTrack();
    job.check('Video stream', !!video === withVideo);
    if (!video) return;
    const sink = new VideoSampleSink(video);
    const t0 = await video.getFirstTimestamp();
    let decoded = 0;
    for (const t of [t0, t0 + d / 2, Math.max(t0, t0 + d - 0.5)]) {
      const s = await sink.getSample(t);
      if (s) decoded++, s.close();
    }
    job.check('Frames decode (start / middle / end)', decoded === 3);
  } finally {
    out.dispose();
  }
}
