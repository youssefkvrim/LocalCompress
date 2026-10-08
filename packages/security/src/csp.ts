/**
 * Single source of truth for the Content-Security-Policy.
 * Used by the build (meta tag), the preview server, and the deployment
 * configs in /deploy (kept in sync by scripts/audit-dist.mjs).
 *
 * - No remote origin is allowed anywhere: every directive is 'self' or narrower.
 * - connect-src 'self' is needed only to load the app's own WASM/assets;
 *   the egress guard and service worker additionally block any non-GET or
 *   non-asset request to the origin, so nothing can be POSTed back.
 * - 'wasm-unsafe-eval' permits WebAssembly compilation only — not JS eval.
 */
export const CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'none'"],
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  'worker-src': ["'self'"],
  'connect-src': ["'self'"],
  'img-src': ["'self'", 'blob:', 'data:'],
  'media-src': ["'self'", 'blob:'],
  'style-src': ["'self'"],
  'font-src': ["'self'"],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'frame-src': ["'none'"],
  'child-src': ["'self'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'require-trusted-types-for': ["'script'"],
  'trusted-types': ['default'],
};

/** Directives that browsers ignore in a <meta> tag but honour as headers. */
export const HEADER_ONLY: Record<string, string[]> = {
  'frame-ancestors': ["'none'"],
};

export function cspString(asHeader: boolean): string {
  const all = asHeader ? { ...CSP_DIRECTIVES, ...HEADER_ONLY } : CSP_DIRECTIVES;
  return Object.entries(all)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}

/** Security headers for the static server (nginx / IIS / preview). */
export function securityHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy': cspString(true),
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), interest-cohort=()',
    'X-Frame-Options': 'DENY',
  };
}
