import { getScratchFile, removeJob, scratchSession, type WorkerEvent } from '@localcompress/core';
import { store, type Job } from './store';

/**
 * Sequential job runner. One job at a time keeps peak memory bounded on
 * multi-GB inputs; each job gets a fresh worker that is terminated after.
 */
const active = new Map<string, Worker>();
let running = false;

export function enqueue(files: Iterable<File>) {
  for (const f of files) store.newJob(f);
  void pump();
}

async function pump() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const job = store.jobs.find((j) => j.state === 'queued');
      if (!job) break;
      await run(job);
    }
  } finally {
    running = false;
  }
}

function run(job: Job): Promise<void> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('../../../../workers/job.worker.ts', import.meta.url), { type: 'module', name: 'localcompress-job' });
    active.set(job.id, worker);
    job.state = 'running';
    job.startedAt = performance.now();
    store.emit();

    const finish = () => {
      worker.terminate();
      active.delete(job.id);
      job.endedAt = performance.now();
      store.emit();
      resolve();
    };

    worker.onmessage = (ev: MessageEvent<WorkerEvent>) => {
      const e = ev.data;
      switch (e.type) {
        case 'ready':
          store.capabilities ??= e.capabilities;
          worker.postMessage({ type: 'start', jobId: job.id, session: scratchSession(), file: job.file, settings: job.settings });
          break;
        case 'detected':
          job.detection = e.detection;
          break;
        case 'stage':
          job.stage = e.stage;
          job.progress = 0;
          job.progressLabel = '';
          break;
        case 'progress':
          job.progress = e.value;
          job.progressLabel = e.label ?? '';
          break;
        case 'plan':
          job.plan = e.plan;
          break;
        case 'log':
          job.logs.push(e.message);
          break;
        case 'network':
          store.addNetwork(e.entries);
          return;
        case 'done':
          job.result = e.result;
          job.state = 'done';
          finish();
          return;
        case 'error':
          job.error = e.message;
          job.errorReason = e.reason;
          if (e.detection) job.detection = e.detection;
          job.state = 'error';
          finish();
          return;
      }
      store.emit();
    };
    worker.onerror = (ev) => {
      ev.preventDefault();
      job.error = ev.message || 'The processing engine stopped unexpectedly (out of memory?)';
      job.state = 'error';
      void removeJob(job.id);
      finish();
    };
    (job as Job & { cancel?: () => void }).cancel = () => {
      job.state = 'cancelled';
      void removeJob(job.id);
      finish();
    };
  });
}

export function cancel(job: Job) {
  (job as Job & { cancel?: () => void }).cancel?.();
}

export async function discard(job: Job) {
  if (job.state === 'running') cancel(job);
  await removeJob(job.id);
  store.removeJob(job.id);
}

/**
 * Save the staged output to a location the user picks. The bytes go from
 * OPFS straight to the chosen file on this disk; no network is involved.
 */
export async function save(job: Job) {
  const r = job.result;
  if (!r?.outputPath || !r.outputName) return;
  const file = await getScratchFile(r.outputPath);
  const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName: r.outputName, startIn: 'downloads' });
      const writable = await handle.createWritable();
      await file.stream().pipeTo(writable);
      return true;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return false;
      // fall through to download
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = r.outputName;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
