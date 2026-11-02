/**
 * Background removal, on the workstation.
 *
 * 1. Segmentation: IS-Net "general use" (Apache-2.0, ONNX) through ONNX
 *    Runtime Web, on the graphics card (WebGPU) when the browser offers it,
 *    otherwise on the processor (WebAssembly, one thread: no nested worker
 *    escapes the egress guard). The network sees a 1024 × 1024 copy.
 *    (BiRefNet was tried: it needs 17 storage buffers per shader, more than
 *    workstation GPUs allow, and more than 4 GB of WebAssembly memory.)
 * 2. Edges: the coarse mask is refined against the picture itself with a
 *    guided filter at up to 2560 px, so the outline follows the real edges
 *    (hair, fingers) instead of a blurred, blocky 1024 px mask.
 * 3. Result: PNG, same dimensions, original pixels where the subject is.
 *
 * The model ships with the application and is served by the service worker
 * like every other file; it is fetched the first time only, then works
 * offline. The user can touch the result up afterwards (ui/editor.ts).
 */
import * as ort from 'onnxruntime-web/webgpu';
import { MODEL_NAME, modelUrl, ortWasmUrl } from '../lib/model';
import { imageSize, sniff } from '../lib/detect';
import { isnetInput, luma, normalise, refineMask } from '../lib/matte';
import { saveBytes } from '../lib/scratch';
import { Skip, type Engine, type Job } from '../lib/types';

/** The network's input side. */
const SIZE = 1024;
const MAX_PIXELS = 64_000_000;
/** Edges are refined at this size at most (memory: about 28 bytes per pixel). */
const REFINE_EDGE = 2560;

// Everything comes from this origin: no CDN, no worker pool, no proxy worker.
// The glue code is inside the bundle build; only the WASM binary is fetched.
ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.logLevel = 'error';

export const removeBgEngine: Engine = async (job) => {
  const head = new Uint8Array(await job.file.slice(0, 256 * 1024).arrayBuffer());
  const { kind, format } = sniff(head);
  if (kind !== 'image') throw new Skip('unsupported');
  if (format === 'jpeg' || format === 'png') {
    const size = imageSize(head, format);
    if (size && size.width * size.height > MAX_PIXELS) throw new Skip('too-large');
    if (size?.animated) throw new Skip('animated');
  }

  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(job.file, { imageOrientation: 'from-image', premultiplyAlpha: 'none' });
  } catch {
    throw new Skip('no-codec');
  }
  try {
    const { width, height } = bmp;
    if (width * height > MAX_PIXELS) throw new Skip('too-large');

    const coarse = await segmentWithFallback(job, bmp);
    job.progress(0.6);

    if (coarse.coverage < 0.005 || coarse.coverage > 0.995) throw new Skip('no-subject');
    const alpha = refine(bmp, coarse.mask);
    job.progress(0.8);
    const png = await compose(bmp, alpha);
    job.progress(0.95);

    job.step('verify');
    await verify(job, png, width, height);
    return { ...(await saveBytes(job.id, 'out.png', png)), ext: 'png', engine: `${MODEL_NAME} (${coarse.device}) + guided edges`, lossless: false };
  } finally {
    bmp.close();
  }
};

/**
 * On the graphics card (10 to 50 times faster) when there is one, otherwise
 * on the processor. A card that accepts the model but fails while running it
 * (unsupported operator, lost device) also falls back to the processor.
 */
async function segmentWithFallback(job: Job, bmp: ImageBitmap) {
  const bytes = await loadModel(job);
  job.progress(0.35);
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (gpu && (await gpu.requestAdapter().catch(() => null))) {
    let session: ort.InferenceSession | undefined;
    try {
      session = await ort.InferenceSession.create(forWebGpu(bytes), { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' });
      return { ...(await segment(session, bmp)), device: 'GPU' };
    } catch (e) {
      console.warn('LocalKit: graphics card unavailable for background removal, using the processor.', e);
    } finally {
      await session?.release().catch(() => {});
    }
  }
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  try {
    return { ...(await segment(session, bmp)), device: 'CPU' };
  } finally {
    await session.release();
  }
}

/**
 * ONNX Runtime's WebGPU backend refuses MaxPool with ceil_mode = 1. At the
 * fixed 1024² input every pooled size is even, so ceil and floor give the same
 * shapes: the attribute is set to 0 in a copy of the model (one byte each,
 * same length, structure untouched). Verified bit-identical on the CPU; a
 * model without such nodes is left as it is.
 */
function forWebGpu(model: Uint8Array): Uint8Array {
  // Protobuf: AttributeProto.name (field 1, length 9) "ceil_mode", then i (field 3, varint) = 1.
  const key = [0x0a, 0x09, ...new TextEncoder().encode('ceil_mode'), 0x18, 0x01];
  const out = model.slice();
  outer: for (let i = 0; i + key.length <= out.length; i++) {
    for (let j = 0; j < key.length; j++) if (out[i + j] !== key[j]) continue outer;
    out[i + key.length - 1] = 0;
  }
  return out;
}

/** The model is a file of the application, verified by the service worker against the build hash. */
async function loadModel(job: Job) {
  const res = await fetch(modelUrl);
  if (!res.ok || !res.body) throw new Error(`model unavailable (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const parts: Uint8Array[] = [];
  let got = 0;
  for (const reader = res.body.getReader(); ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (total) job.progress(Math.min(1, got / total) * 0.3);
  }
  const bytes = new Uint8Array(got);
  let o = 0;
  for (const p of parts) bytes.set(p, o), (o += p.length);
  return bytes;
}

/** Run the network on a 1024² copy of the picture. */
async function segment(session: ort.InferenceSession, bmp: ImageBitmap) {
  const c = new OffscreenCanvas(SIZE, SIZE).getContext('2d', { willReadFrequently: true })!;
  c.imageSmoothingQuality = 'high';
  c.drawImage(bmp, 0, 0, SIZE, SIZE);
  const n = SIZE * SIZE;
  const input = isnetInput(c.getImageData(0, 0, SIZE, SIZE).data, n);
  const result = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
  const pred = (await result[session.outputNames[0]].getData()) as Float32Array;
  const out = normalise(pred, n);
  for (const t of Object.values(result)) t.dispose();
  return out;
}

/** The coarse mask, at up to REFINE_EDGE px, snapped to the picture's own edges (lib/matte.ts). */
function refine(bmp: ImageBitmap, coarse: Float32Array) {
  const scale = Math.min(1, REFINE_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
  c.imageSmoothingQuality = 'high';
  c.drawImage(bmp, 0, 0, w, h);
  const guide = luma(c.getImageData(0, 0, w, h).data, w * h);
  return { data: refineMask(coarse, SIZE, guide, w, h), width: w, height: h };
}

/** The original pixels at full size, with the refined mask as transparency. */
async function compose(bmp: ImageBitmap, alpha: { data: Float32Array; width: number; height: number }) {
  const { width, height } = bmp;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  if (alpha.width === width && alpha.height === height) {
    const img = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < alpha.data.length; i++) img.data[i * 4 + 3] = Math.round(img.data[i * 4 + 3] * alpha.data[i]);
    ctx.putImageData(img, 0, 0);
  } else {
    const m = new ImageData(alpha.width, alpha.height);
    for (let i = 0; i < alpha.data.length; i++) m.data[i * 4 + 3] = Math.round(alpha.data[i] * 255);
    const mc = new OffscreenCanvas(alpha.width, alpha.height);
    mc.getContext('2d')!.putImageData(m, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(mc, 0, 0, width, height);
  }
  // The browser's encoder: OxiPNG would take tens of seconds on a photo for a few percent.
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

async function verify(job: Job, png: Uint8Array, width: number, height: number) {
  try {
    const bmp = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }), { premultiplyAlpha: 'none' });
    job.check('Output decodes', true);
    job.check('Dimensions preserved', bmp.width === width && bmp.height === height);
    const rows = Math.min(height, 64);
    const c = new OffscreenCanvas(width, rows).getContext('2d', { willReadFrequently: true })!;
    let transparent = false;
    for (let top = 0; top < height && !transparent; top += Math.max(rows, Math.floor(height / 16))) {
      c.clearRect(0, 0, width, rows);
      c.drawImage(bmp, 0, top, width, rows, 0, 0, width, rows);
      const d = c.getImageData(0, 0, width, rows).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 255) (transparent = true), (i = d.length);
    }
    bmp.close();
    job.check('Background transparent', transparent);
  } catch {
    job.check('Output decodes', false);
  }
}
