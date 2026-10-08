import type { NetworkEntry } from '@localcompress/core';

/**
 * Egress guard — defence in depth beneath the CSP.
 *
 * Runs first in the page and in every worker. It replaces every network
 * primitive with a wrapper that only lets through same-origin GET/HEAD
 * requests for the application's own static files. Anything else
 * (POST, PUT, cross-origin, WebSocket, beacon, WebRTC…) throws and is
 * reported to the Security panel.
 *
 * This guards against a compromised or careless dependency. It cannot
 * defend against a malicious browser extension or a hostile workstation;
 * see docs/THREAT_MODEL.md.
 */

type Report = (e: NetworkEntry) => void;

const ASSET = /\.(js|mjs|wasm|css|woff2?|svg|png|ico|webmanifest|json|html)$/i;

export function isAllowedRequest(url: URL, method: string, origin: string, strict = true): { ok: boolean; reason?: string } {
  if (url.protocol === 'blob:' || url.protocol === 'data:') {
    return method === 'GET' ? { ok: true } : { ok: false, reason: `${method} on ${url.protocol}` };
  }
  if (url.origin !== origin) return { ok: false, reason: 'cross-origin' };
  if (method !== 'GET' && method !== 'HEAD') return { ok: false, reason: `${method} not permitted` };
  if (!strict) return { ok: true }; // dev server: module URLs carry queries
  if (url.search) return { ok: false, reason: 'query strings not permitted' };
  if (url.pathname !== '/' && !url.pathname.endsWith('/') && !ASSET.test(url.pathname)) return { ok: false, reason: 'not an application asset' };
  return { ok: true };
}

class EgressBlocked extends Error {
  constructor(what: string, reason: string) {
    super(`LocalCompress blocked ${what}: ${reason}`);
    this.name = 'EgressBlocked';
  }
}

export function installEgressGuard(scope: NetworkEntry['scope'], report: Report, strict = true): void {
  const g = globalThis as Record<string, unknown> & typeof globalThis;
  if (g.__lcGuard) return;
  Object.defineProperty(g, '__lcGuard', { value: true });
  const origin = location.origin;
  const blocked = (url: string, method: string, reason: string) => report({ scope, url, method, verdict: 'blocked', reason, time: performance.now() });

  const nativeFetch = g.fetch.bind(g);
  const guardedFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input), location.href);
    const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
    const verdict = isAllowedRequest(url, method, origin, strict);
    if (!verdict.ok || init?.body != null) {
      const reason = verdict.reason ?? 'request body not permitted';
      blocked(url.href, method, reason);
      return Promise.reject(new EgressBlocked(`${method} ${url.href}`, reason));
    }
    return nativeFetch(input, { ...init, credentials: 'same-origin', referrerPolicy: 'no-referrer' });
  };
  lock(g, 'fetch', guardedFetch);

  if (typeof XMLHttpRequest !== 'undefined') {
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { __lc?: [string, string] }, method: string, url: string | URL, ...rest: unknown[]) {
      const u = new URL(String(url), location.href);
      const m = method.toUpperCase();
      const v = isAllowedRequest(u, m, origin, strict);
      if (!v.ok) {
        blocked(u.href, m, v.reason!);
        throw new EgressBlocked(`XHR ${m} ${u.href}`, v.reason!);
      }
      this.__lc = [m, u.href];
      return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest & { __lc?: [string, string] }, body?: Document | XMLHttpRequestBodyInit | null) {
      if (body != null) {
        blocked(this.__lc?.[1] ?? '?', this.__lc?.[0] ?? '?', 'request body not permitted');
        throw new EgressBlocked('XHR body', 'request body not permitted');
      }
      return send.call(this, body);
    };
    Object.freeze(XMLHttpRequest.prototype);
  }

  const deny = (name: string) => {
    if (!(name in g)) return;
    const Stub = function () {
      blocked(name, '—', `${name} disabled`);
      throw new EgressBlocked(name, 'disabled by policy');
    };
    lock(g, name, Stub);
  };
  ['WebSocket', 'EventSource', 'WebTransport', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel'].forEach(deny);

  if (typeof Navigator !== 'undefined' && 'sendBeacon' in Navigator.prototype) {
    Object.defineProperty(Navigator.prototype, 'sendBeacon', {
      value: (url: string) => {
        blocked(String(url), 'POST', 'beacon disabled');
        return false;
      },
      configurable: false,
      writable: false,
    });
  }
}

function lock(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, configurable: false, writable: false, enumerable: false });
}
