import type { Preset, Settings } from './types';

/**
 * Concrete encoder parameters derived from the user-facing preset.
 * Keeping this in one table makes the quality/size trade-off auditable.
 */
export interface Params {
  preset: Preset;
  /** Bit-exact / pixel-exact only: nothing visible may change. */
  lossless: boolean;
  label: string;
  /** Lossy quality, 0–100. */
  imageQuality: number;
  /** Longest image edge; 0 = never resize. */
  maxDimension: number;
  /** Longest edge for images embedded in documents (PDF / Office). */
  documentMaxDimension: number;
  /** OxiPNG optimisation level (0–6). */
  pngLevel: number;
  /** Lossy transforms allowed (e.g. converting lossless PDF images to JPEG). */
  lossyConversion: boolean;
  /** Bits per pixel per frame for H.264; other codecs are scaled from it. */
  videoBpp: number;
  /** Max output video height; 0 = keep. */
  videoMaxHeight: number;
  audioBitrate: number;
}

const TABLE: Record<Exclude<Preset, 'custom'>, Params> = {
  lossless: {
    preset: 'lossless',
    lossless: true,
    label: 'Lossless',
    imageQuality: 100,
    maxDimension: 0,
    documentMaxDimension: 0,
    pngLevel: 3,
    lossyConversion: false,
    videoBpp: 0,
    videoMaxHeight: 0,
    audioBitrate: 0,
  },
  quality: {
    preset: 'quality',
    lossless: false,
    label: 'Maximum quality',
    imageQuality: 90,
    maxDimension: 0,
    documentMaxDimension: 0,
    pngLevel: 3,
    lossyConversion: false,
    videoBpp: 0.1,
    videoMaxHeight: 0,
    audioBitrate: 192_000,
  },
  balanced: {
    preset: 'balanced',
    lossless: false,
    label: 'Balanced',
    imageQuality: 78,
    maxDimension: 3840,
    documentMaxDimension: 2400,
    pngLevel: 2,
    lossyConversion: true,
    videoBpp: 0.06,
    videoMaxHeight: 1080,
    audioBitrate: 128_000,
  },
  compression: {
    preset: 'compression',
    lossless: false,
    label: 'Maximum compression',
    imageQuality: 62,
    maxDimension: 2560,
    documentMaxDimension: 1600,
    pngLevel: 4,
    lossyConversion: true,
    videoBpp: 0.035,
    videoMaxHeight: 720,
    audioBitrate: 96_000,
  },
};

export function resolveParams(settings: Settings): Params {
  if (settings.preset !== 'custom') return TABLE[settings.preset] ?? TABLE.lossless;
  const q = clamp(settings.custom.quality, 1, 100);
  return {
    preset: 'custom',
    lossless: false,
    label: `Custom · Q${q}`,
    imageQuality: q,
    maxDimension: settings.custom.maxDimension,
    documentMaxDimension: settings.custom.maxDimension ? Math.min(settings.custom.maxDimension, 3000) : 0,
    pngLevel: q > 85 ? 3 : 2,
    lossyConversion: q < 90,
    // Map quality 1–100 onto 0.02–0.12 bpp.
    videoBpp: 0.02 + (q / 100) * 0.1,
    videoMaxHeight: settings.custom.videoHeight,
    audioBitrate: q > 80 ? 160_000 : q > 50 ? 128_000 : 96_000,
  };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
