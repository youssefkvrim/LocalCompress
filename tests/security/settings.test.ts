import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, resolveParams, sanitizeSettings } from '@localcompress/core';

describe('settings from storage are untrusted', () => {
  it('falls back to safe defaults on garbage', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ preset: '__proto__', videoCodec: 'x', allowMacros: 'yes', custom: { quality: 1e9 } })).toMatchObject({
      preset: 'lossless',
      videoCodec: 'avc',
      allowMacros: false,
      custom: { quality: 100 },
    });
  });
  it('defaults to lossless, macros off, metadata stripped', () => {
    expect(DEFAULT_SETTINGS.preset).toBe('lossless');
    expect(DEFAULT_SETTINGS.allowMacros).toBe(false);
    expect(resolveParams(DEFAULT_SETTINGS).lossless).toBe(true);
  });
});
