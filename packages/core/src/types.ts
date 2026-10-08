/**
 * Shared contracts between the UI thread and the processing worker.
 *
 * Nothing in these types is ever serialised to a network: they travel only
 * over `postMessage` between the page and its own dedicated worker.
 */

export type Kind = 'image' | 'video' | 'pdf' | 'zip' | 'office' | 'unsupported';

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif';
export type OfficeFlavor = 'pptx' | 'xlsx' | 'docx' | 'pptm' | 'xlsm' | 'docm';

export interface Detection {
  kind: Kind;
  /** Short, human label ("JPEG image", "PowerPoint presentation", ...). */
  label: string;
  /** Machine format id, e.g. "jpeg", "mp4", "pdf", "zip", "pptx". */
  format: string;
  /** True when the extension disagrees with the bytes. Bytes always win. */
  extensionMismatch: boolean;
  macroEnabled?: boolean;
}

export type Preset = 'lossless' | 'balanced' | 'compression' | 'quality' | 'custom';
export type VideoCodecChoice = 'avc' | 'hevc' | 'av1';
export type ImageTarget = 'keep' | 'webp' | 'avif';

export interface Settings {
  preset: Preset;
  custom: {
    /** 1–100 perceptual quality for lossy encoders. */
    quality: number;
    /** Longest edge in pixels for images; 0 = keep. */
    maxDimension: number;
    /** Max video height (e.g. 1080); 0 = keep. */
    videoHeight: number;
  };
  videoCodec: VideoCodecChoice;
  imageTarget: ImageTarget;
  stripMetadata: boolean;
  checksums: boolean;
  allowMacros: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  preset: 'lossless',
  custom: { quality: 75, maxDimension: 3840, videoHeight: 1080 },
  videoCodec: 'avc',
  imageTarget: 'keep',
  stripMetadata: true,
  checksums: true,
  allowMacros: false,
};

export type Stage = 'detect' | 'checksum' | 'analyze' | 'strategy' | 'candidate' | 'validate' | 'compare' | 'finalize';

export const STAGES: { id: Stage; label: string }[] = [
  { id: 'detect', label: 'Detect' },
  { id: 'analyze', label: 'Analyze' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'candidate', label: 'Encode' },
  { id: 'validate', label: 'Validate' },
  { id: 'compare', label: 'Compare' },
];

export interface Check {
  label: string;
  ok: boolean;
  detail?: string;
}

export type ResultStatus = 'optimized' | 'not-worth-it' | 'unsupported' | 'refused';

/** Machine-readable reason, translated by the UI. */
export type Reason =
  | 'already-optimal'
  | 'archive-compressed'
  | 'video-lossless'
  | 'video-efficient'
  | 'animated'
  | 'too-large'
  | 'unreadable'
  | 'encrypted'
  | 'signed'
  | 'macro'
  | 'unsafe-paths'
  | 'no-encoder'
  | 'no-decoder'
  | 'unsupported'
  | 'validation'
  | 'quota'
  | 'corrupt';

export interface JobResult {
  status: ResultStatus;
  reason?: Reason;
  /** True when the output is bit-exact / pixel-exact (lossless). */
  lossless?: boolean;
  inputSize: number;
  outputSize: number;
  /** Suggested name for the saved file (never sent anywhere). */
  outputName?: string;
  /** OPFS path segments of the staged output, relative to the scratch root. */
  outputPath?: string[];
  mime?: string;
  engine: string;
  quality: string;
  summary: string;
  details: string[];
  checks: Check[];
  sha256In?: string;
  sha256Out?: string;
  timings: Partial<Record<Stage, number>>;
  /** Pixel dimensions, for the before/after viewer of images. */
  preview?: { kind: 'image'; width: number; height: number };
}

export interface Plan {
  engine: string;
  summary: string;
  /** Estimated output size in bytes, when it can be predicted. */
  estimate?: number;
}

/** UI → worker */
export type WorkerRequest = { type: 'start'; jobId: string; session: string; file: File; settings: Settings };

/** worker → UI */
export type WorkerEvent =
  | { type: 'ready'; capabilities: Capabilities }
  | { type: 'detected'; detection: Detection }
  | { type: 'stage'; stage: Stage }
  | { type: 'progress'; value: number; label?: string }
  | { type: 'plan'; plan: Plan }
  | { type: 'log'; message: string }
  | { type: 'network'; entries: NetworkEntry[] }
  | { type: 'done'; result: JobResult }
  | { type: 'error'; message: string; reason?: Reason; detection?: Detection };

export interface Capabilities {
  wasm: boolean;
  wasmSimd: boolean;
  wasmThreads: boolean;
  crossOriginIsolated: boolean;
  webCodecs: boolean;
  opfs: boolean;
  fileSystemAccess: boolean;
  offscreenCanvas: boolean;
  hardwareConcurrency: number;
}

export interface NetworkEntry {
  /** Where the request was observed. */
  scope: 'page' | 'worker' | 'service-worker';
  url: string;
  method?: string;
  initiator?: string;
  /** Bytes received for the response (resource timing). */
  transferSize?: number;
  verdict: 'allowed' | 'blocked';
  reason?: string;
  time: number;
}

const PRESETS: Preset[] = ['lossless', 'balanced', 'compression', 'quality', 'custom'];
const CODECS: VideoCodecChoice[] = ['avc', 'hevc', 'av1'];
const TARGETS: ImageTarget[] = ['keep', 'webp', 'avif'];
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

/** Settings come from localStorage and postMessage: never trust their shape. */
export function sanitizeSettings(input: unknown): Settings {
  const s = (input && typeof input === 'object' ? input : {}) as Partial<Settings>;
  const c = (s.custom && typeof s.custom === 'object' ? s.custom : {}) as Partial<Settings['custom']>;
  const d = DEFAULT_SETTINGS;
  return {
    preset: PRESETS.includes(s.preset as Preset) ? (s.preset as Preset) : d.preset,
    custom: {
      quality: num(c.quality, 1, 100, d.custom.quality),
      maxDimension: num(c.maxDimension, 0, 16384, d.custom.maxDimension),
      videoHeight: num(c.videoHeight, 0, 4320, d.custom.videoHeight),
    },
    videoCodec: CODECS.includes(s.videoCodec as VideoCodecChoice) ? (s.videoCodec as VideoCodecChoice) : d.videoCodec,
    imageTarget: TARGETS.includes(s.imageTarget as ImageTarget) ? (s.imageTarget as ImageTarget) : d.imageTarget,
    stripMetadata: typeof s.stripMetadata === 'boolean' ? s.stripMetadata : d.stripMetadata,
    checksums: typeof s.checksums === 'boolean' ? s.checksums : d.checksums,
    allowMacros: typeof s.allowMacros === 'boolean' ? s.allowMacros : d.allowMacros,
  };
}
