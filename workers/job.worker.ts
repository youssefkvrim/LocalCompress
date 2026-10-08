/// <reference lib="webworker" />
/**
 * One dedicated worker per file. It is terminated as soon as the job ends,
 * which releases every WASM heap and buffer that held file data.
 *
 * The worker has no network access beyond fetching the app's own static
 * assets (enforced by CSP, the egress guard below, and the service worker).
 */
import { installEgressGuard, installTrustedTypes, observeResources, detectCapabilities } from '@localcompress/security';
import {
  RefusedError,
  SNIFF_BYTES,
  ValidationError,
  refineZip,
  resolveParams,
  sniff,
  getScratchFile,
  removeJob,
  setScratchSession,
  sanitizeSettings,
  type Check,
  type EngineContext,
  type EngineOutput,
  type JobResult,
  type Stage,
  type WorkerEvent,
  type WorkerRequest,
} from '@localcompress/core';
import { sha256Blob } from '@localcompress/core/hash';

const post = (e: WorkerEvent) => (self as DedicatedWorkerGlobalScope).postMessage(e);

installTrustedTypes();
installEgressGuard('worker', (entry) => post({ type: 'network', entries: [entry] }), import.meta.env.PROD);
observeResources('worker', (entries) => post({ type: 'network', entries }));
post({ type: 'ready', capabilities: detectCapabilities() });

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  if (ev.data.type !== 'start') return;
  const { jobId, file, session } = ev.data;
  setScratchSession(session);
  const settings = sanitizeSettings(ev.data.settings);
  const params = resolveParams(settings);
  const checks: Check[] = [];
  const timings: Partial<Record<Stage, number>> = {};
  let current: Stage = 'detect';
  let stageStart = performance.now();
  const stage = (s: Stage) => {
    timings[current] = (timings[current] ?? 0) + performance.now() - stageStart;
    current = s;
    stageStart = performance.now();
    post({ type: 'stage', stage: s });
  };

  // ── Detect ────────────────────────────────────────────────────────────
  post({ type: 'stage', stage: 'detect' });
  let detection = sniff(new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()), file.name);
  try {
    if (detection.kind === 'zip') {
      const { readZip } = await import('@localcompress/archive');
      const archive = await readZip(file);
      detection = refineZip(detection, archive.entries.map((e) => e.name), file.name);
    }
  } catch (e) {
    post({ type: 'error', message: (e as Error).message, detection });
    return;
  }
  post({ type: 'detected', detection });

  // The original's checksum runs in a parallel worker while the engine works.
  const inputHash: Promise<string | undefined> = settings.checksums
    ? new Promise((resolve) => {
        const w = new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module', name: 'localcompress-hash' });
        w.onmessage = (m: MessageEvent<{ digest?: string }>) => (resolve(m.data.digest), w.terminate());
        w.onerror = () => (resolve(undefined), w.terminate());
        w.postMessage(file);
      })
    : Promise.resolve(undefined);

  const ctx: EngineContext = {
    jobId,
    file,
    settings,
    params,
    detection,
    stage,
    progress: (value, label) => post({ type: 'progress', value, label }),
    log: (message) => post({ type: 'log', message }),
    plan: (plan) => post({ type: 'plan', plan }),
    check: (label, ok, detail) => {
      const c = { label, ok, detail };
      checks.push(c);
      return c;
    },
  };

  const base = { inputSize: file.size, quality: params.label, checks, timings, sha256In: undefined as string | undefined };
  try {
    let out: EngineOutput;
    switch (detection.kind) {
      case 'image':
        out = await (await import('@localcompress/image')).compressImage(ctx);
        break;
      case 'video':
        out = await (await import('@localcompress/video')).compressVideo(ctx);
        break;
      case 'pdf':
        out = await (await import('@localcompress/pdf')).compressPdf(ctx);
        break;
      case 'office':
        out = await (await import('@localcompress/office')).compressOffice(ctx);
        break;
      case 'zip':
        out = await (await import('@localcompress/archive')).compressZip(ctx);
        break;
      default:
        out = { status: 'unsupported', reason: 'unsupported', engine: '—', summary: `${detection.label} is not supported yet.`, details: [] };
    }

    // A single failed integrity check voids the result: it is never offered.
    const failed = checks.filter((c) => !c.ok);
    if (failed.length) {
      await removeJob(jobId);
      throw new ValidationError(`Output failed validation — ${failed.map((c) => (c.detail ? `${c.label}: ${c.detail}` : c.label)).join('; ')}. It was discarded; the original is untouched.`);
    }

    let sha256Out: string | undefined;
    if (out.status === 'optimized' && out.outputPath && settings.checksums) {
      stage('finalize');
      sha256Out = await sha256Blob(await getScratchFile(out.outputPath), (f) => post({ type: 'progress', value: f, label: 'SHA-256 of result' }));
    }
    if (settings.checksums) {
      stage('checksum');
      ctx.progress(0, 'SHA-256 of original');
      base.sha256In = await inputHash;
    }
    stage('finalize');
    const result: JobResult = { ...base, ...out, outputSize: out.outputSize ?? 0, sha256Out };
    post({ type: 'done', result });
  } catch (e) {
    await removeJob(jobId);
    if (e instanceof RefusedError || (e as Error).name === 'ImageRefused') {
      stage('finalize');
      const reason = (e as RefusedError).reason ?? 'unsupported';
      post({ type: 'done', result: { ...base, status: 'refused', reason, outputSize: 0, engine: '—', summary: (e as Error).message, details: [] } });
      return;
    }
    const err = e as Error;
    const message =
      err.name === 'QuotaExceededError'
        ? 'Not enough local scratch space to stage the result. Free disk space on this workstation (the browser grants a share of free space) and retry.'
        : err.message || String(e);
    const reason = err.name === 'QuotaExceededError' ? 'quota' : err.name === 'ValidationError' ? 'validation' : err.name === 'ZipError' ? 'corrupt' : undefined;
    post({ type: 'error', message, reason, detection });
  }
};
