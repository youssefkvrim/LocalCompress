/**
 * Application state and the job queue. Jobs run one at a time — bounded
 * memory for multi-GB files — each in a fresh worker.
 *
 * Only the settings are persisted (in this browser). Never file names,
 * contents or results.
 */
import { getSession, openFile, removeJob } from '../lib/scratch';
import { BlobSink, ZipWriter, newEntry } from '../lib/zip';
import { sanitize, type FromWorker, type NetEntry, type Reason, type Result, type Settings } from '../lib/types';

export interface Item {
  id: string;
  file: File;
  state: 'waiting' | 'working' | 'done' | 'failed';
  progress: number;
  result?: Result;
  reason?: Reason;
  worker?: Worker;
}

const KEY = 'localcompress.settings';
const listeners = new Set<() => void>();

export const store = {
  settings: load(),
  items: [] as Item[],
  network: [] as NetEntry[],
  offline: false,

  on(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  emit() {
    listeners.forEach((fn) => fn());
  },
  set(patch: Partial<Settings>) {
    store.settings = sanitize({ ...store.settings, ...patch });
    try {
      localStorage.setItem(KEY, JSON.stringify(store.settings));
    } catch {
      /* private mode: keep in memory */
    }
    store.emit();
  },
  net(entry: NetEntry) {
    store.network.push(entry);
    store.emit();
  },
  add(files: Iterable<File>) {
    for (const file of files) store.items.push({ id: crypto.randomUUID(), file, state: 'waiting', progress: 0 });
    store.emit();
    next();
  },
  async remove(item: Item) {
    item.worker?.terminate();
    store.items = store.items.filter((i) => i !== item);
    await removeJob(item.id);
    store.emit();
    next();
  },
};

function load(): Settings {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return sanitize(null);
  }
}

/** Start the next waiting item if nothing is running. */
function next() {
  if (store.items.some((i) => i.state === 'working')) return;
  const item = store.items.find((i) => i.state === 'waiting');
  if (!item) return;
  const worker = new Worker(new URL('../worker/job.ts', import.meta.url), { type: 'module' });
  item.worker = worker;
  item.state = 'working';
  const finish = (state: Item['state']) => {
    worker.terminate();
    item.worker = undefined;
    item.state = state;
    store.emit();
    next();
  };
  worker.onmessage = ({ data: m }: MessageEvent<FromWorker>) => {
    if (m.type === 'progress') (item.progress = m.value), store.emit();
    else if (m.type === 'net') store.net(m.entry);
    else if (m.type === 'result') (item.result = m.result), finish('done');
    else (item.reason = m.reason), finish('failed');
  };
  worker.onerror = (e) => {
    e.preventDefault();
    item.reason = 'corrupt';
    finish('failed');
  };
  worker.postMessage({ id: item.id, session: getSession(), file: item.file, settings: store.settings });
  store.emit();
}

/** Write the result where the user chooses. Bytes go from local disk to local disk. */
export async function save(item: Item) {
  await saveAs(await openFile(item.result!.path), item.result!.outputName);
}

/** Every result in one ZIP, named LocalCompress-HH-mm-ss.zip. Files are stored, not recompressed. */
export async function saveAll() {
  const done = store.items.filter((i) => i.result?.optimized);
  const sink = new BlobSink();
  const zip = new ZipWriter(sink);
  const used = new Set<string>();
  for (const item of done) {
    const r = item.result!;
    let name = r.outputName;
    for (let n = 2; used.has(name); n++) name = r.outputName.replace(/(\.[^.]*)?$/, ` (${n})$1`);
    used.add(name);
    await zip.putFile(newEntry(name), await openFile(r.path), r.crc32!);
  }
  zip.finish(new Uint8Array(0));
  const time = new Date().toTimeString().slice(0, 8).replaceAll(':', '-');
  await saveAs(new Blob(sink.parts, { type: 'application/zip' }), `LocalCompress-${time}.zip`);
}

async function saveAs(file: Blob, name: string) {
  const pick = (window as { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (pick) {
    try {
      const handle = await pick({ suggestedName: name });
      await file.stream().pipeTo(await handle.createWritable());
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
