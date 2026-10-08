/**
 * Origin Private File System scratch space.
 *
 * Outputs are staged here (on the local disk, inside the browser profile)
 * so multi-GB results never have to sit in RAM. Everything lives under one
 * directory that is purged at startup, after save, on cancel and on exit.
 */

export const SCRATCH_DIR = 'localcompress-scratch';
const LOCK_PREFIX = 'localcompress-session-';

/**
 * Each tab owns one session directory, held alive by a Web Lock. Tabs never
 * touch each other's staged files; a session whose lock is gone (tab closed
 * or crashed) is garbage and is removed by the next tab that starts.
 */
let session = '';
export function setScratchSession(id: string) {
  session = id;
}
export function scratchSession() {
  return session;
}

/** Page only: claim a session for the lifetime of this tab. */
export function claimScratchSession(): string {
  session = crypto.randomUUID();
  navigator.locks?.request(LOCK_PREFIX + session, () => new Promise<void>(() => {}));
  return session;
}

async function scratchBase(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(SCRATCH_DIR, { create: true });
}

export async function scratchRoot(): Promise<FileSystemDirectoryHandle> {
  if (!session) throw new Error('Scratch session not set');
  return (await scratchBase()).getDirectoryHandle(session, { create: true });
}

export async function jobDir(jobId: string): Promise<FileSystemDirectoryHandle> {
  return (await scratchRoot()).getDirectoryHandle(jobId, { create: true });
}

/** Remove the directories of sessions whose tab no longer exists. */
export async function purgeStaleSessions(): Promise<void> {
  try {
    const held = new Set(((await navigator.locks?.query())?.held ?? []).map((l) => l.name));
    const base = await scratchBase();
    const names: string[] = [];
    for await (const [name] of (base as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) names.push(name);
    for (const name of names) if (name !== session && !held.has(LOCK_PREFIX + name)) await base.removeEntry(name, { recursive: true }).catch(() => {});
  } catch {
    /* OPFS or Web Locks unavailable */
  }
}

export async function getScratchFile(path: string[]): Promise<File> {
  let dir = await scratchRoot();
  for (const seg of path.slice(0, -1)) dir = await dir.getDirectoryHandle(seg);
  const fh = await dir.getFileHandle(path[path.length - 1]);
  return fh.getFile();
}

export async function removeJob(jobId: string): Promise<void> {
  try {
    await (await scratchRoot()).removeEntry(jobId, { recursive: true });
  } catch {
    /* already gone */
  }
}

/** Remove every file staged by this tab (on exit and from the security panel). */
export async function purgeScratch(): Promise<void> {
  try {
    await (await scratchBase()).removeEntry(session, { recursive: true });
  } catch {
    /* nothing staged */
  }
}

export async function scratchUsage(): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  async function walk(dir: FileSystemDirectoryHandle) {
    for await (const [, handle] of dir.entries() as AsyncIterable<[string, FileSystemHandle]>) {
      if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle);
      else {
        files++;
        bytes += (await (handle as FileSystemFileHandle).getFile()).size;
      }
    }
  }
  try {
    await walk(await scratchRoot());
  } catch {
    /* OPFS unavailable */
  }
  return { files, bytes };
}

/**
 * Sequential/positional writer over an OPFS sync access handle.
 * Only available inside dedicated workers — which is where all
 * processing happens.
 */
export class ScratchWriter {
  position = 0;
  private constructor(
    private handle: FileSystemSyncAccessHandle,
    readonly path: string[],
    private dir: FileSystemDirectoryHandle,
    readonly name: string,
  ) {}

  static async create(jobId: string, name: string): Promise<ScratchWriter> {
    const dir = await jobDir(jobId);
    const fh = await dir.getFileHandle(name, { create: true });
    const handle = await fh.createSyncAccessHandle();
    handle.truncate(0);
    return new ScratchWriter(handle, [jobId, name], dir, name);
  }

  write(data: Uint8Array): void {
    let written = 0;
    while (written < data.length) {
      written += this.handle.write(data.subarray(written), { at: this.position + written });
    }
    this.position += data.length;
  }

  writeAt(data: Uint8Array, at: number): void {
    let written = 0;
    while (written < data.length) written += this.handle.write(data.subarray(written), { at: at + written });
    this.position = Math.max(this.position, at + data.length);
  }

  /** Read back a range (used for in-place validation without loading the file). */
  read(at: number, length: number): Uint8Array {
    const out = new Uint8Array(length);
    let read = 0;
    while (read < length) {
      const n = this.handle.read(out.subarray(read), { at: at + read });
      if (n === 0) break;
      read += n;
    }
    return out.subarray(0, read);
  }

  size(): number {
    return this.handle.getSize();
  }

  /** A WritableStream suitable for Mediabunny's StreamTarget. */
  writable(): WritableStream<{ type: 'write'; data: Uint8Array; position: number }> {
    return new WritableStream({
      write: (chunk) => this.writeAt(chunk.data, chunk.position),
    });
  }

  close(): void {
    try {
      this.handle.flush();
    } finally {
      this.handle.close();
    }
  }

  async file(): Promise<File> {
    return (await this.dir.getFileHandle(this.name)).getFile();
  }

  async remove(): Promise<void> {
    try {
      this.handle.close();
    } catch {
      /* closed */
    }
    await this.dir.removeEntry(this.name).catch(() => {});
  }
}
