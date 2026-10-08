import { describe, expect, it } from 'vitest';
import { CSP_DIRECTIVES, HEADER_ONLY, cspString, isAllowedRequest, securityHeaders } from '@localcompress/security';

const origin = 'https://localcompress.intranet.example';
const u = (p: string) => new URL(p, origin + '/');

describe('egress policy', () => {
  it('allows only same-origin GET/HEAD of application assets', () => {
    expect(isAllowedRequest(u('/assets/app-1234.js'), 'GET', origin).ok).toBe(true);
    expect(isAllowedRequest(u('/assets/mozjpeg_enc.wasm'), 'GET', origin).ok).toBe(true);
    expect(isAllowedRequest(u('/'), 'GET', origin).ok).toBe(true);
    expect(isAllowedRequest(u('/index.html'), 'HEAD', origin).ok).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('blocks %s even to the own server', (m) => {
    expect(isAllowedRequest(u('/assets/app.js'), m, origin)).toEqual({ ok: false, reason: `${m} not permitted` });
  });

  it('blocks cross-origin, query strings and non-asset paths', () => {
    expect(isAllowedRequest(new URL('https://evil.example/x.js'), 'GET', origin).reason).toBe('cross-origin');
    expect(isAllowedRequest(new URL('http://localcompress.intranet.example/x.js'), 'GET', origin).reason).toBe('cross-origin');
    expect(isAllowedRequest(u('/assets/app.js?d=c2VjcmV0'), 'GET', origin).reason).toBe('query strings not permitted');
    expect(isAllowedRequest(u('/api/upload'), 'GET', origin).reason).toBe('not an application asset');
    expect(isAllowedRequest(u('/report.pdf'), 'GET', origin).reason).toBe('not an application asset');
  });

  it('allows local blob: reads but not writes', () => {
    expect(isAllowedRequest(new URL(`blob:${origin}/1234`), 'GET', origin).ok).toBe(true);
    expect(isAllowedRequest(new URL(`blob:${origin}/1234`), 'POST', origin).ok).toBe(false);
  });
});

describe('content security policy', () => {
  const all = { ...CSP_DIRECTIVES, ...HEADER_ONLY };
  it('names no remote origin in any directive', () => {
    for (const [k, v] of Object.entries(all)) {
      for (const src of v) expect(src, `${k} ${src}`).toMatch(/^('self'|'none'|'wasm-unsafe-eval'|'script'|blob:|data:|default)$/);
    }
  });
  it('restricts connections to self and forbids inline / eval script', () => {
    expect(CSP_DIRECTIVES['connect-src']).toEqual(["'self'"]);
    expect(CSP_DIRECTIVES['default-src']).toEqual(["'none'"]);
    expect(CSP_DIRECTIVES['script-src']).not.toContain("'unsafe-inline'");
    expect(CSP_DIRECTIVES['script-src']).not.toContain("'unsafe-eval'");
    expect(CSP_DIRECTIVES['form-action']).toEqual(["'none'"]);
  });
  it('enforces Trusted Types and isolation headers', () => {
    expect(cspString(true)).toContain("require-trusted-types-for 'script'");
    expect(cspString(true)).toContain("frame-ancestors 'none'");
    const h = securityHeaders();
    expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(h['Cross-Origin-Embedder-Policy']).toBe('require-corp');
    expect(h['Referrer-Policy']).toBe('no-referrer');
  });
});
