/**
 * Runs first in the page and in every worker, before any other code.
 *
 * 1. Egress guard: network primitives only allow a body-less, same-origin
 *    GET of an application file. Everything else throws and is reported.
 *    WebSocket, EventSource, WebTransport, WebRTC and beacons are disabled.
 * 2. Trusted Types: no HTML or script can be built from strings; scripts and
 *    workers only load from this origin.
 * 3. Resource timing: every request this realm makes is reported, so the
 *    privacy panel can list them.
 *
 * Defence in depth under the CSP and the service worker. It cannot stop a
 * malicious browser extension or a compromised workstation.
 */
import type { NetEntry } from '../lib/types';

const ASSET = /\.(js|wasm|css|woff2?|svg|png|ico|webmanifest|json|html)$/i;

/** strict = production. The dev server needs query strings and module paths. */
export function allowed(url: URL, method: string, origin: string, strict = true): string | null {
  if (url.protocol === 'blob:' || url.protocol === 'data:') return method === 'GET' ? null : `${method} on ${url.protocol}`;
  if (url.origin !== origin) return 'cross-origin';
  if (method !== 'GET' && method !== 'HEAD') return `${method} not permitted`;
  if (!strict) return null;
  if (url.search) return 'query strings not permitted';
  if (!url.pathname.endsWith('/') && !ASSET.test(url.pathname)) return 'not an application file';
  return null;
}

export function lockDown(scope: NetEntry['scope'], report: (e: NetEntry) => void, strict: boolean) {
  const g = globalThis as typeof globalThis & Record<string, unknown>;
  const origin = location.origin;
  const block = (url: string, method: string, why: string) => {
    report({ scope, url, method, blocked: true, why });
    return new Error(`LocalCompress blocked ${method} ${url}: ${why}`);
  };
  const freeze = (o: object, key: string, value: unknown) => Object.defineProperty(o, key, { value, writable: false, configurable: false });

  const fetch = g.fetch.bind(g);
  freeze(g, 'fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input), location.href);
    const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
    const why = init?.body != null ? 'request body not permitted' : allowed(url, method, origin, strict);
    if (why) return Promise.reject(block(url.href, method, why));
    return fetch(input, { ...init, credentials: 'same-origin', referrerPolicy: 'no-referrer' });
  });

  if (typeof XMLHttpRequest !== 'undefined') {
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      const u = new URL(String(url), location.href);
      const why = allowed(u, method.toUpperCase(), origin, strict);
      if (why) throw block(u.href, method, why);
      return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      if (body != null) throw block('xhr', 'POST', 'request body not permitted');
      return send.call(this, body);
    };
    Object.freeze(XMLHttpRequest.prototype);
  }

  for (const name of ['WebSocket', 'EventSource', 'WebTransport', 'RTCPeerConnection', 'webkitRTCPeerConnection']) {
    if (name in g)
      freeze(g, name, function () {
        throw block(name, '-', 'disabled');
      });
  }
  if (typeof Navigator !== 'undefined')
    freeze(Navigator.prototype, 'sendBeacon', (url: string) => {
      block(String(url), 'POST', 'beacon disabled');
      return false;
    });

  const tt = (g as { trustedTypes?: { createPolicy(n: string, r: object): unknown } }).trustedTypes;
  try {
    tt?.createPolicy('default', {
      createHTML: () => {
        throw new TypeError('HTML injection is disabled');
      },
      createScript: () => {
        throw new TypeError('Dynamic script is disabled');
      },
      // Same-origin files only: a blob: or data: worker would escape this guard.
      createScriptURL: (s: string) => {
        const u = new URL(s, location.href);
        if (u.origin !== origin || !u.protocol.startsWith('http')) throw new TypeError(`Blocked script URL: ${u.href}`);
        return s;
      },
    });
  } catch {
    /* policy already installed in this realm */
  }

  new PerformanceObserver((list) => {
    for (const r of list.getEntries()) report({ scope, url: r.name, method: 'GET', blocked: false });
  }).observe({ type: 'resource', buffered: true });
}
