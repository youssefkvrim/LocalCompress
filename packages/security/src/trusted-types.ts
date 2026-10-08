/**
 * Trusted Types: the UI never builds HTML from strings, so the default
 * policy rejects all HTML/script creation outright. Script URLs (workers,
 * WASM glue) are only accepted from this origin or same-origin blob: URLs.
 */
interface TTFactory {
  createPolicy(name: string, rules: Record<string, (s: string) => string>): unknown;
}

export function installTrustedTypes(): void {
  const tt = (globalThis as { trustedTypes?: TTFactory }).trustedTypes;
  if (!tt) return;
  const sameOrigin = (s: string) => {
    const u = new URL(s, location.href);
    // Same-origin application files only: a blob:/data: worker could run code that escapes the egress guard.
    const ok = u.origin === location.origin && (u.protocol === 'https:' || u.protocol === 'http:');
    if (!ok) throw new TypeError(`Blocked script URL: ${u.href}`);
    return s;
  };
  try {
    tt.createPolicy('default', {
      createHTML: () => {
        throw new TypeError('HTML injection is disabled');
      },
      createScript: () => {
        throw new TypeError('Dynamic script is disabled');
      },
      createScriptURL: sameOrigin,
    });
  } catch {
    /* already installed in this realm */
  }
}
