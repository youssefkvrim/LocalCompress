/** The few shapes shared by the page, the worker and the engines. */

export type Mode = 'lossless' | 'balanced' | 'compact';

export interface Settings {
  mode: Mode;
  stripMetadata: boolean;
  allowMacros: boolean;
}

export const DEFAULTS: Settings = { mode: 'lossless', stripMetadata: true, allowMacros: false };

/** Settings arrive from localStorage and postMessage: never trust their shape. */
export function sanitize(x: unknown): Settings {
  const s = (x && typeof x === 'object' ? x : {}) as Partial<Settings>;
  return {
    mode: s.mode === 'balanced' || s.mode === 'compact' ? s.mode : 'lossless',
    stripMetadata: typeof s.stripMetadata === 'boolean' ? s.stripMetadata : DEFAULTS.stripMetadata,
    allowMacros: s.allowMacros === true,
  };
}

/** Why a file was left as it is. The UI translates these. */
export type Reason =
  | 'already-optimal'
  | 'video-lossless'
  | 'animated'
  | 'too-large'
  | 'unreadable'
  | 'encrypted'
  | 'signed'
  | 'macro'
  | 'unsafe-paths'
  | 'no-codec'
  | 'unsupported'
  | 'validation'
  | 'quota'
  | 'corrupt';

/** Thrown by an engine to leave the file untouched, with a reason. */
export class Skip extends Error {
  reason: Reason;
  constructor(reason: Reason, message: string = reason) {
    super(message);
    this.name = 'Skip';
    this.reason = reason;
  }
}

export interface Check {
  label: string;
  ok: boolean;
}

/** What an engine receives. */
export interface Job {
  id: string;
  file: File;
  mode: Mode;
  stripMetadata: boolean;
  allowMacros: boolean;
  progress(fraction: number): void;
  /** Record an integrity check. One failed check discards the output. */
  check(label: string, ok: boolean): void;
}

/** What an engine returns: a candidate staged on the local disk. */
export interface Output {
  file: File;
  path: string[];
  ext: string;
  engine: string;
  lossless: boolean;
}

export type Engine = (job: Job) => Promise<Output>;

export interface Result {
  optimized: boolean;
  reason?: Reason;
  lossless: boolean;
  inputSize: number;
  outputSize: number;
  outputName: string;
  path: string[];
  engine: string;
  checks: Check[];
  sha256In?: string;
  sha256Out?: string;
  /** CRC-32 of the output, so results can be zipped without being read again. */
  crc32?: number;
}

export interface NetEntry {
  scope: 'page' | 'worker' | 'sw';
  url: string;
  method: string;
  blocked: boolean;
  why?: string;
}

export type ToWorker = { id: string; session: string; file: File; settings: Settings };

export type FromWorker =
  | { type: 'progress'; value: number }
  | { type: 'net'; entry: NetEntry }
  | { type: 'result'; result: Result }
  | { type: 'error'; reason: Reason; message: string };
