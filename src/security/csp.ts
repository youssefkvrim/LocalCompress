/**
 * The Content-Security-Policy and response headers — one definition used by
 * the page (<meta>), the preview server, and the nginx / IIS configs.
 *
 * No remote origin appears anywhere. 'wasm-unsafe-eval' allows compiling
 * WebAssembly, not JavaScript eval. Workers may only come from this origin.
 */
export const CSP: Record<string, string[]> = {
  'default-src': ["'none'"],
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  'worker-src': ["'self'"],
  'connect-src': ["'self'"],
  'img-src': ["'self'", 'blob:', 'data:'],
  'style-src': ["'self'"],
  'font-src': ["'self'"],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'frame-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'require-trusted-types-for': ["'script'"],
  'trusted-types': ['default'],
};

/** Browsers ignore this one in a <meta> tag; it is sent as a header. */
const HEADER_ONLY = { 'frame-ancestors': ["'none'"] };

export const cspString = (header: boolean) =>
  Object.entries(header ? { ...CSP, ...HEADER_ONLY } : CSP)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');

export const HEADERS: Record<string, string> = {
  'Content-Security-Policy': cspString(true),
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=()',
  'X-Frame-Options': 'DENY',
};
