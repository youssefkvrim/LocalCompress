/**
 * Local scratch space in the browser's private file system (OPFS).
 *
 * Outputs are written here, on the local disk, so multi-GB results never
 * sit in memory. Each tab owns one session directory, kept alive by a Web
 * Lock; directories whose lock is gone belong to closed or crashed tabs and
 * are removed by the next tab that starts.
 */

const ROOT = 'localcompress-scratch';
const LOCK = 'localcompress-session-';

let session = '';
export const getSession = () => session;
export const setSession = (s: string) => void (session = s);

/** Page only: claim a session for the lifetime of this tab. */
export function claimSession() {
  session = crypto.randomUUID();
  navigator.locks?.request(LOCK + session, () => new Promise<void>(() => {}));
}

async function base() {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT, { create: true });
}

async function dir(...path: string[]) {
  let d = await (await base()).getDirectoryHandle(session, { create: true });
  for (const p of path) d = await d.getDirectoryHandle(p, { create: true });
  return d;
}

export async function openFile(path: string[]): Promise<File> {
  const d = await dir(...path.slice(0, -1));
  return (await d.getFileHandle(path[path.length - 1])).getFile();
}

export async function removeJob(id: string) {
  await (await dir()).removeEntry(id, { recursive: true }).catch(() => {});
}

export async function purgeSession() {
  await (await base()).removeEntry(session, { recursive: true }).catch(() => {});
}

export async function purgeOrphans() {
  try {
    const held = new Set(((await navigator.locks?.query())?.held ?? []).map((l) => l.name));
    const b = await base();
    for await (const name of (b as unknown as { keys(): AsyncIterable<string> }).keys()) {
      if (name !== session && !held.has(LOCK + name)) await b.removeEntry(name, { recursive: true }).catch(() => {});
    }
  } catch {
    /* no OPFS or no Web Locks */
  }
}

/** Bytes staged by this tab. */
export async function usage(): Promise<number> {
  let total = 0;
  const walk = async (d: FileSystemDirectoryHandle) => {
    for await (const h of (d as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
      if (h.kind === 'directory') await walk(h as FileSystemDirectoryHandle);
      else total += (await (h as FileSystemFileHandle).getFile()).size;
    }
  };
  await walk(await dir()).catch(() => {});
  return total;
}

/** Positional writer over a sync access handle (dedicated workers only). */
export class Writer {
  position = 0;
  readonly path: string[];
  private handle: FileSystemSyncAccessHandle;
  private file: FileSystemFileHandle;

  private constructor(path: string[], file: FileSystemFileHandle, handle: FileSystemSyncAccessHandle) {
    this.path = path;
    this.file = file;
    this.handle = handle;
  }

  static async create(job: string, name: string) {
    const file = await (await dir(job)).getFileHandle(name, { create: true });
    const handle = await file.createSyncAccessHandle();
    handle.truncate(0);
    return new Writer([job, name], file, handle);
  }

  write(data: Uint8Array) {
    this.writeAt(data, this.position);
  }

  writeAt(data: Uint8Array, at: number) {
    for (let done = 0; done < data.length; ) done += this.handle.write(data.subarray(done), { at: at + done });
    this.position = Math.max(this.position, at + data.length);
  }

  /** For Mediabunny's StreamTarget. */
  writable() {
    return new WritableStream<{ data: Uint8Array; position: number }>({ write: (c) => this.writeAt(c.data, c.position) });
  }

  async close(): Promise<File> {
    this.handle.flush();
    this.handle.close();
    return this.file.getFile();
  }
}

export async function saveBytes(job: string, name: string, bytes: Uint8Array) {
  const w = await Writer.create(job, name);
  w.write(bytes);
  return { file: await w.close(), path: w.path };
}
