/**
 * One worker per file, terminated afterwards (which frees every buffer and
 * WASM heap that held file data).
 *
 *   detect → engine → keep only if smaller and every check passed → checksums
 */
import { sniff, office } from '../lib/detect';
import { crc32 } from '../lib/crc32';
import { readZip } from '../lib/zip';
import { openFile, removeJob, setSession } from '../lib/scratch';
import { Skip, sanitize, type Check, type Engine, type FromWorker, type Job, type Result, type ToWorker } from '../lib/types';

type Post = (m: FromWorker) => void;

/** A result must save at least 1 % to be offered. */
const MIN_SAVING = 0.01;

export async function run(data: ToWorker, post: Post) {
  setSession(data.session);
  const { file, id } = data;
  const settings = sanitize(data.settings);
  const checks: Check[] = [];
  // A file left as it is can still be saved (or zipped) as the original.
  const skipped = async (reason: Result['reason']): Promise<Result> => ({
    optimized: false,
    reason,
    lossless: true,
    inputSize: file.size,
    outputSize: file.size,
    outputName: file.name,
    path: [],
    engine: '',
    checks,
    crc32: await crcOf(file),
  });

  // The original's SHA-256 is computed in parallel by a second worker.
  const hashIn = sha256(file);

  try {
    const engine = await pick(file);
    const job: Job = {
      id,
      file,
      mode: settings.mode,
      stripMetadata: settings.stripMetadata,
      allowMacros: settings.allowMacros,
      progress: (value) => post({ type: 'progress', value }),
      step: (step) => post({ type: 'step', step }),
      check: (label, ok) => void checks.push({ label, ok }),
    };
    job.step('compress');
    const out = await engine(job);
    job.step('finish');

    if (checks.some((c) => !c.ok)) {
      await removeJob(id);
      post({ type: 'error', reason: 'validation', message: checks.filter((c) => !c.ok).map((c) => c.label).join(', ') });
      return;
    }
    if (out.file.size > file.size * (1 - MIN_SAVING)) {
      await removeJob(id);
      post({ type: 'result', result: await skipped('already-optimal') });
      return;
    }
    const name = file.name.replace(/\.[^.]*$/, '') || 'file';
    post({
      type: 'result',
      result: {
        optimized: true,
        lossless: out.lossless,
        inputSize: file.size,
        outputSize: out.file.size,
        outputName: `${name}.compressed.${out.ext}`,
        path: out.path,
        engine: out.engine,
        checks,
        sha256In: await hashIn,
        sha256Out: await sha256(await openFile(out.path)),
        crc32: await crcOf(out.file),
      },
    });
  } catch (e) {
    await removeJob(id);
    const err = e as Error;
    if (e instanceof Skip) post({ type: 'result', result: await skipped(e.reason) });
    else post({ type: 'error', reason: err.name === 'QuotaExceededError' ? 'quota' : 'corrupt', message: err.message });
  }
}

async function pick(file: File): Promise<Engine> {
  const { kind } = sniff(new Uint8Array(await file.slice(0, 4096).arrayBuffer()));
  if (kind === 'image') return (await import('../engines/image')).imageEngine;
  if (kind === 'video') return (await import('../engines/video')).videoEngine;
  if (kind === 'pdf') return (await import('../engines/pdf')).pdfEngine;
  if (kind === 'zip') {
    const names = (await readZip(file)).entries.map((e) => e.name);
    if (office(names)) return (await import('../engines/office')).officeEngine;
    return (await import('../engines/zip')).zipEngine;
  }
  throw new Skip('unsupported');
}

async function crcOf(file: Blob) {
  let crc = 0;
  for (let at = 0; at < file.size; at += 8 << 20) crc = crc32(new Uint8Array(await file.slice(at, at + (8 << 20)).arrayBuffer()), crc);
  return crc;
}

function sha256(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const w = new Worker(new URL('./hash.ts', import.meta.url), { type: 'module' });
    w.onmessage = (m: MessageEvent<string>) => (resolve(m.data), w.terminate());
    w.onerror = () => (resolve(undefined), w.terminate());
    w.postMessage(file);
  });
}
