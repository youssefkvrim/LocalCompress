import { DEFAULT_SETTINGS, sanitizeSettings, type Capabilities, type Detection, type JobResult, type NetworkEntry, type Plan, type Reason, type Settings, type Stage } from '@localcompress/core';

export type JobState = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface Job {
  id: string;
  index: number;
  file: File;
  state: JobState;
  stage: Stage;
  progress: number;
  progressLabel: string;
  detection?: Detection;
  plan?: Plan;
  result?: JobResult;
  error?: string;
  errorReason?: Reason;
  logs: string[];
  startedAt?: number;
  endedAt?: number;
  /** Settings snapshot used for this job. */
  settings: Settings;
}

type Listener = () => void;

/**
 * Tiny observable store. Settings are the only thing persisted (in this
 * browser's localStorage) — never file names, contents or results.
 */
class Store {
  settings: Settings = loadSettings();
  jobs: Job[] = [];
  network: NetworkEntry[] = [];
  capabilities?: Capabilities;
  swState: 'unsupported' | 'dev' | 'installing' | 'active' | 'error' = 'dev';
  swCache = '';
  private listeners = new Set<Listener>();
  private netListeners = new Set<Listener>();
  private seq = 0;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  onNetwork(fn: Listener) {
    this.netListeners.add(fn);
    return () => this.netListeners.delete(fn);
  }
  emit() {
    for (const l of this.listeners) l();
  }

  setSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch, custom: { ...this.settings.custom, ...(patch.custom ?? {}) } };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.settings));
    } catch {
      /* storage unavailable — settings stay in memory */
    }
    this.emit();
  }

  addNetwork(entries: NetworkEntry[]) {
    for (const e of entries) {
      // De-duplicate resource-timing replays (buffered: true).
      if (e.verdict === 'allowed' && this.network.some((n) => n.url === e.url && n.scope === e.scope && Math.abs(n.time - e.time) < 1)) continue;
      this.network.push(e);
    }
    for (const l of this.netListeners) l();
  }

  newJob(file: File): Job {
    const id = crypto.randomUUID();
    const job: Job = { id, index: ++this.seq, file, state: 'queued', stage: 'detect', progress: 0, progressLabel: '', logs: [], settings: structuredClone(this.settings) };
    this.jobs.push(job);
    this.emit();
    return job;
  }

  removeJob(id: string) {
    this.jobs = this.jobs.filter((j) => j.id !== id);
    this.emit();
  }
}

const KEY = 'localcompress.settings.v1';
function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitizeSettings(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return structuredClone(DEFAULT_SETTINGS);
}

export const store = new Store();
