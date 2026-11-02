/** The few shapes shared by the page, the worker and the engines. */

export type Mode = 'lossless' | 'balanced' | 'compact';

/** What is done to the files: compress them, convert them, or cut out the subject of a picture. */
export type Task = 'compress' | 'convert' | 'removebg';
export const TASKS: Task[] = ['compress', 'convert', 'removebg'];

/** Conversion targets: one for pictures, one for videos and sounds. */
export type ImageTarget = 'jpg' | 'png' | 'webp' | 'pdf';
export type MediaTarget = 'mp4' | 'webm' | 'm4a' | 'wav';
export const IMAGE_TARGETS: ImageTarget[] = ['jpg', 'png', 'webp', 'pdf'];
export const MEDIA_TARGETS: MediaTarget[] = ['mp4', 'webm', 'm4a', 'wav'];

export interface Settings {
  task: Task;
  mode: Mode;
  stripMetadata: boolean;
  allowMacros: boolean;
  imageTarget: ImageTarget;
  mediaTarget: MediaTarget;
}

/**
 * Metadata cleaning is off by default: in images and videos, a classification
 * label can live in the same metadata as the GPS position or the author.
 */
export const DEFAULTS: Settings = { task: 'compress', mode: 'lossless', stripMetadata: false, allowMacros: false, imageTarget: 'jpg', mediaTarget: 'mp4' };

const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

/** Settings arrive from localStorage and postMessage: never trust their shape. */
export function sanitize(x: unknown): Settings {
  const s = (x && typeof x === 'object' ? x : {}) as Partial<Settings>;
  return {
    task: oneOf(s.task, TASKS, DEFAULTS.task),
    mode: s.mode === 'balanced' || s.mode === 'compact' ? s.mode : 'lossless',
    stripMetadata: typeof s.stripMetadata === 'boolean' ? s.stripMetadata : DEFAULTS.stripMetadata,
    allowMacros: s.allowMacros === true,
    imageTarget: oneOf(s.imageTarget, IMAGE_TARGETS, DEFAULTS.imageTarget),
    mediaTarget: oneOf(s.mediaTarget, MEDIA_TARGETS, DEFAULTS.mediaTarget),
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
  | 'corrupt'
  | 'same-format'
  | 'no-subject'
  /** A password is needed to open the file; the user is asked for it. */
  | 'password'
  | 'password-wrong';

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

/** What the user is told the worker is doing. */
export type Step = 'compress' | 'convert' | 'removebg' | 'verify' | 'finish';

/** What an engine receives. */
export interface Job {
  id: string;
  file: File;
  mode: Mode;
  stripMetadata: boolean;
  allowMacros: boolean;
  imageTarget: ImageTarget;
  mediaTarget: MediaTarget;
  /** Typed by the user for this file only; never stored. */
  password?: string;
  progress(fraction: number): void;
  /** Announce that the engine moves on to checking its candidate. */
  step(step: Step): void;
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
  /** Macros, ActiveX, embedded objects or external links, copied as they are. */
  active?: boolean;
}

export type Engine = (job: Job) => Promise<Output>;

export interface Result {
  task: Task;
  /** A result was produced (compressed, converted or cut out); false: the original is offered as is. */
  optimized: boolean;
  reason?: Reason;
  lossless: boolean;
  inputSize: number;
  outputSize: number;
  outputName: string;
  path: string[];
  engine: string;
  active?: boolean;
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

export type ToWorker = { id: string; session: string; file: File; settings: Settings; password?: string };

export type FromWorker =
  | { type: 'progress'; value: number }
  | { type: 'step'; step: Step }
  | { type: 'net'; entry: NetEntry }
  | { type: 'result'; result: Result }
  | { type: 'error'; reason: Reason; message: string };
