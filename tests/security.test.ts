import { describe, expect, it } from 'vitest';
import { CSP, HEADERS } from '../src/security/csp';
import { allowed } from '../src/security/guard';
import { DEFAULTS, sanitize } from '../src/lib/types';

const origin = 'https://localcompress.intranet.example';
const u = (p: string) => new URL(p, origin);

describe('egress policy', () => {
  it('allows only same-origin GET of application files', () => {
    expect(allowed(u('/assets/app-1234.js'), 'GET', origin)).toBeNull();
    expect(allowed(u('/assets/mozjpeg_enc.wasm'), 'GET', origin)).toBeNull();
    expect(allowed(u('/'), 'GET', origin)).toBeNull();
  });
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('blocks %s, even to its own server', (m) => {
    expect(allowed(u('/assets/app.js'), m, origin)).toBe(`${m} not permitted`);
  });
  it('blocks other origins, query strings and non-application paths', () => {
    expect(allowed(new URL('https://evil.example/x.js'), 'GET', origin)).toBe('cross-origin');
    expect(allowed(u('/assets/app.js?d=c2VjcmV0'), 'GET', origin)).toBe('query strings not permitted');
    expect(allowed(u('/report.pdf'), 'GET', origin)).toBe('not an application file');
  });
});

describe('content security policy', () => {
  it('names no remote origin', () => {
    for (const [k, v] of Object.entries(CSP)) for (const s of v) expect(s, k).toMatch(/^('self'|'none'|'wasm-unsafe-eval'|'script'|blob:|data:|default)$/);
  });
  it('allows connections and workers from this origin only', () => {
    expect(CSP['connect-src']).toEqual(["'self'"]);
    expect(CSP['worker-src']).toEqual(["'self'"]);
    expect(CSP['script-src']).not.toContain("'unsafe-eval'");
    expect(HEADERS['Cross-Origin-Embedder-Policy']).toBe('require-corp');
  });
});

describe('settings', () => {
  it('fall back to safe defaults', () => {
    expect(sanitize(null)).toEqual(DEFAULTS);
    expect(sanitize({ mode: '__proto__', allowMacros: 'yes' })).toEqual(DEFAULTS);
    expect(DEFAULTS).toEqual({ mode: 'lossless', stripMetadata: true, allowMacros: false });
  });
});
