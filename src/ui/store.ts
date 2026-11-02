/**
 * Application state and the job queue. Files are processed several at a
 * time (one fresh worker each) while their estimated memory fits a budget;
 * a file larger than the budget runs alone.
 *
 * Only the settings are persisted (in this browser). Never file names,
 * contents or results.
 */
import { getSession, openFile, removeJob } from '../lib/scratch';
import { crc32 } from '../lib/crc32';
import { BlobSink, ZipWriter, newEntry } from '../lib/zip';
import { memoryBudget, memoryCost } from '../lib/cost';
import { categoryOf } from '../lib/detect';
import { sanitize, type FromWorker, type ImageTarget, type MediaTarget, type NetEntry, type Reason, type Result, type Settings, type Step } from '../lib/types';
import { isSvg, rasterizeSvg } from './svg';
import type { ModelState } from './preload';

/** What a file can be converted to, by family. */
export type Group = 'image' | 'pdf' | 'video' | 'audio';
const TARGETS: Record<Group, (ImageTarget | MediaTarget)[]> = {
  image: ['jpg', 'png', 'webp', 'pdf'],
  pdf: ['jpg', 'png', 'webp'],
  video: ['mp4', 'webm', 'm4a', 'wav'],
  audio: ['m4a', 'wav', 'webm'],
};
const SAME_EXT: Record<string, string> = { jpg: 'jpg', jpeg: 'jpg', jfif: 'jpg', png: 'png', webp: 'webp', mp4: 'mp4', webm: 'webm', m4a: 'm4a', wav: 'wav' };
export const groupOf = (name: string): Group | null => {
  const c = categoryOf(name);
  return c === 'image' || c === 'pdf' || c === 'video' || c === 'audio' ? c : null;
};
/** The formats offered for one file: its family's, without the one it already is. */
export const targetsFor = (name: string) => {
  const group = groupOf(name);
  const own = SAME_EXT[name.split('.').pop()?.toLowerCase() ?? ''];
  return group ? TARGETS[group].filter((t) => t !== own) : [];
};

export interface Item {
  id: string;
  file: File;
  /** What the worker receives when it is not the file itself: the PNG drawn from an SVG. */
  input?: File;
  /** The settings at the time the file was added: switching tabs does not change what happens to it. */
  settings: Settings;
  state: 'waiting' | 'working' | 'done' | 'failed';
  /** Conversion: the file waits until the user has chosen a format and clicked Convert. */
  held?: boolean;
  /** The format chosen for this file (conversion). */
  target?: ImageTarget | MediaTarget;
  progress: number;
  step: Step;
  /** When the current step started (performance.now()), for a fluid progress bar. */
  stepAt: number;
  /** Estimated peak memory in bytes; unknown until the header is read. */
  cost?: number;
  result?: Result;
  reason?: Reason;
  /** Technical detail of a failure, for the tooltip and the console. */
  message?: string;
  worker?: Worker;
  /** Typed by the user to open this file; handed to its worker, then forgotten. */
  password?: string;
  /** The result as touched up by the user (background removal), in memory; replaces the worker's result. */
  edited?: { blob: Blob; crc: number };
}

/** v2: cleaning became opt-in. The application was called LocalCompress: its settings are carried over once. */
const KEY = 'localkit.settings.v2';
try {
  const legacy = localStorage.getItem('localcompress.settings.v2');
  if (legacy !== null && localStorage.getItem(KEY) === null) localStorage.setItem(KEY, legacy);
  for (const k of ['localcompress.settings', 'localcompress.settings.v2']) localStorage.removeItem(k);
} catch {
  /* storage unavailable */
}

/**
 * Production must run cross-origin isolated: the proof that the security
 * headers (CSP, COOP, COEP) arrived. Without them nothing is processed.
 */
export const headersOk = () => !import.meta.env.PROD || crossOriginIsolated;

/**
 * The service worker is the last barrier between the page and the network.
 * In production nothing is processed until it controls the page:
 * 'pending' while it installs (first visit), 'slow' when that takes long,
 * 'on' once it is in control, 'failed' if it cannot start (fail closed).
 */
export type Guard = 'pending' | 'slow' | 'on' | 'failed';

/** 'available': a newer version is installed and waits; 'stale': another tab switched to it. */
export type Update = 'none' | 'available' | 'stale';

/** Files may be processed now. */
const ready = () => headersOk() && store.guard === 'on' && store.update !== 'stale';

const listeners = new Set<() => void>();

export const store = {
  settings: load(),
  items: [] as Item[],
  network: [] as NetEntry[],
  /** The picture shown in the background-removal workspace. */
  selected: null as string | null,
  /** Touch-ups not yet applied, by item: run before the item is saved. */
  commits: new Map<string, () => Promise<void>>(),
  guard: (import.meta.env.PROD ? 'pending' : 'on') as Guard,
  update: 'none' as Update,
  /** Switch to the waiting version; set by start.ts when one is offered. */
  applyUpdate: () => {},

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
  setGuard(state: Guard) {
    if (store.guard === 'on' || store.guard === state || (store.guard === 'failed' && state !== 'on')) return;
    store.guard = state;
    store.emit();
    next();
  },
  setUpdate(state: Update, apply?: () => void) {
    store.update = state;
    if (apply) store.applyUpdate = apply;
    store.emit();
  },
  net(entry: NetEntry) {
    store.network.push(entry);
    store.emit();
  },
  add(files: Iterable<File>) {
    // Files dropped while the guard installs wait in the list; they start once it is on.
    if (!headersOk() || store.guard === 'failed' || store.update === 'stale') return;
    let first = true;
    for (const file of files) {
      const settings = { ...store.settings };
      const task = settings.task;
      // Conversion waits for the user's choice of format, unless there is nothing to choose.
      const held = task === 'convert' && targetsFor(file.name).length > 0;
      const item: Item = { id: crypto.randomUUID(), file, settings, state: 'waiting', held, progress: 0, step: task, stepAt: 0 };
      store.items.push(item);
      if (task === 'removebg' && first) store.selected = item.id;
      first = false;
      prepare(item)
        .then(() => memoryCost(item.input ?? file, task))
        .catch(() => Infinity)
        .then((cost) => ((item.cost = cost), next()));
    }
    store.emit();
  },
  async remove(item: Item) {
    item.worker?.terminate();
    store.items = store.items.filter((i) => i !== item);
    store.commits.delete(item.id);
    if (store.selected === item.id) store.selected = store.items.filter((i) => i.settings.task === 'removebg').at(-1)?.id ?? null;
    await removeJob(item.id);
    store.emit();
    next();
  },
  select(item: Item) {
    store.selected = item.id;
    store.emit();
  },
  /** Conversion: choosing the format (for one file, or every waiting file of a family) starts it. */
  choose(items: Item[], target: ImageTarget | MediaTarget) {
    for (const item of items) {
      if (!item.held || !targetsFor(item.file.name).includes(target)) continue;
      item.target = target;
      item.held = false;
      const group = groupOf(item.file.name);
      if (group === 'image' || group === 'pdf') item.settings.imageTarget = target as ImageTarget;
      else item.settings.mediaTarget = target as MediaTarget;
    }
    store.emit();
    next();
  },
  /** The background-removal model, downloaded in the background (ui/preload.ts). */
  model: { state: 'idle' as ModelState, progress: 0 },
  setModel(state: ModelState, progress: number) {
    store.model = { state, progress };
    store.emit();
  },
  /** Run a file again with the password the user typed for it. */
  unlock(item: Item, password: string) {
    if (item.state === 'working' || !password) return;
    Object.assign(item, { state: 'waiting', progress: 0, step: item.settings.task, result: undefined, reason: undefined, password });
    store.emit();
    next();
  },
  /** Keep the user's touched-up result (or go back to the automatic one with `undefined`). */
  async setEdited(item: Item, blob: Blob | undefined) {
    let crc = 0;
    if (blob) for (let at = 0; at < blob.size; at += 8 << 20) crc = crc32(new Uint8Array(await blob.slice(at, at + (8 << 20)).arrayBuffer()), crc);
    item.edited = blob ? { blob, crc } : undefined;
    store.emit();
  },
};

function load(): Settings {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return sanitize(null);
  }
}

/** SVG for conversion or background removal: the worker gets a PNG of it (ui/svg.ts). */
async function prepare(item: Item) {
  if (item.settings.task === 'compress' || !isSvg(item.file)) return;
  try {
    item.input = await rasterizeSvg(item.file);
  } catch (e) {
    Object.assign(item, { state: 'failed', held: false, reason: 'unreadable', message: (e as Error).message });
    store.emit();
  }
}

/** The picture itself, as the browser can draw it (the PNG of an SVG). */
export const pictureOf = (item: Item): File => item.input ?? item.file;

/** At most this many files at once, and never more estimated memory than the budget. */
const PARALLEL = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
const BUDGET = memoryBudget();

export const pending = () => store.items.some((i) => (i.state === 'waiting' && !i.held) || i.state === 'working');

/** Start waiting files in order, as long as they fit (a file over the budget runs alone). */
function next() {
  if (!ready()) return;
  for (;;) {
    const working = store.items.filter((i) => i.state === 'working');
    const item = store.items.find((i) => i.state === 'waiting' && !i.held);
    if (!item || item.cost === undefined || working.length >= PARALLEL) return;
    const used = working.reduce((n, i) => n + (i.cost ?? 0), 0);
    if (working.length && used + item.cost > BUDGET) return;
    start(item);
  }
}

function start(item: Item) {
  const worker = new Worker(new URL('../worker/job.ts', import.meta.url), { type: 'module' });
  item.worker = worker;
  item.state = 'working';
  item.stepAt = performance.now();
  const finish = (state: Item['state']) => {
    worker.terminate();
    item.worker = undefined;
    item.state = state;
    store.emit();
    next();
  };
  worker.onmessage = ({ data: m }: MessageEvent<FromWorker>) => {
    if (m.type === 'progress') (item.progress = m.value), store.emit();
    else if (m.type === 'step') (item.step = m.step), (item.stepAt = performance.now()), (item.progress = 0), store.emit();
    else if (m.type === 'net') store.net(m.entry);
    else if (m.type === 'result') (item.result = m.result), finish('done');
    else {
      item.reason = m.reason;
      item.message = m.message;
      console.warn(`LocalKit: ${item.file.name}: ${m.reason}`, m.message);
      finish('failed');
    }
  };
  worker.onerror = (e) => {
    e.preventDefault();
    item.reason = 'corrupt';
    item.message = e.message;
    console.warn(`LocalKit: ${item.file.name}: worker error`, e.message);
    finish('failed');
  };
  worker.postMessage({ id: item.id, session: getSession(), file: item.input ?? item.file, settings: item.settings, password: item.password });
  item.password = undefined;
  store.emit();
}

/** Write the result where the user chooses. Bytes go from local disk to local disk. */
export async function save(item: Item) {
  await store.commits.get(item.id)?.();
  await saveAs(await fileOf(item), ensureOutputName(item));
}

/** The result as it will be saved: touched up, on disk, or the original when nothing could be gained. */
export const fileOf = async (item: Item): Promise<Blob> => item.edited?.blob ?? (item.result!.optimized ? openFile(item.result!.path) : item.file);
/** The result as the worker wrote it, before any touch-up. */
export const automaticFile = (item: Item): Promise<File> => openFile(item.result!.path);

/** Everything that can be saved: every finished file, compressed or as is. */
export const savable = () => store.items.filter((i) => i.state === 'done' && i.result);

/** Every result in one ZIP, named LocalKit-HH-mm-ss.zip. Files are stored, not recompressed. */
export async function saveAll() {
  if (pending()) return;
  const done = savable();
  for (const item of done) await store.commits.get(item.id)?.();
  const sink = new BlobSink();
  const zip = new ZipWriter(sink);
  const used = new Set<string>();
  for (const item of done) {
    const r = item.result!;
    const baseName = ensureOutputName(item);
    let name = baseName;
    for (let n = 2; used.has(name); n++) name = baseName.replace(/(\.[^.]*)?$/, ` (${n})$1`);
    used.add(name);
    await zip.putFile(newEntry(name), await fileOf(item), item.edited?.crc ?? r.crc32!);
  }
  zip.finish(new Uint8Array(0));
  const time = new Date().toTimeString().slice(0, 8).replaceAll(':', '-');
  await saveAs(new Blob(sink.parts, { type: 'application/zip' }), `LocalKit-${time}.zip`);
}

async function saveAs(file: Blob, name: string) {
  const pick = (window as { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  let handle: FileSystemFileHandle | null = null;
  if (pick) {
    try {
      handle = await pick({ suggestedName: name });
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return; // the user closed the dialog
    }
  }
  if (handle) {
    let writable: FileSystemWritableFileStream | undefined;
    try {
      writable = await handle.createWritable();
      await writable.write(file);
      await writable.close();
      return;
    } catch {
      // The chosen file could not be written (often a security check when it is closed).
      // Remove what was left there (an empty file, a .crswap), so no broken file remains,
      // then hand the file to the browser's downloads instead.
      await writable?.abort().catch(() => {});
      await (handle as FileSystemFileHandle & { remove?(): Promise<void> }).remove?.().catch(() => {});
    }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

function ensureOutputName(item: Item): string {
  const result = item.result!;
  const clean = result.outputName.trim().replace(/[.\s]+$/, '');
  if (/\.[^.]+$/.test(clean)) return clean;
  const ext = extFromPath(result.path.at(-1)) ?? extFromPath(result.outputName) ?? extFromName(item.file.name);
  return ext ? `${clean || 'file'}.${ext}` : clean || 'file';
}

function extFromPath(path: string | undefined): string | null {
  if (!path) return null;
  const m = /\.([a-z0-9]{1,8})$/i.exec(path);
  return m ? m[1].toLowerCase() : null;
}

function extFromName(name: string): string | null {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name);
  return m ? m[1].toLowerCase() : null;
}
