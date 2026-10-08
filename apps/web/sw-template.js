/* LocalCompress service worker — offline cache + egress firewall.
 *
 * Generated at build time: __LC_MANIFEST__ is replaced with the list of
 * every file in the build together with its SHA-256 (also published as
 * asset-manifest.json for auditors), __LC_VERSION__ with the build id.
 *
 * Rules:
 *  1. Only GET/HEAD requests to this origin for files in the manifest are
 *     served. Everything else is answered locally with 403 and reported
 *     to the page — it never reaches the network.
 *  2. Files are served cache-first, so the app runs with the network off.
 *  3. Cached assets are integrity-checked against the manifest on install.
 */
'use strict';

const VERSION = '__LC_VERSION__';
const MANIFEST = __LC_MANIFEST__;
const CACHE = `localcompress-${VERSION}`;
const scopeUrl = new URL(self.registration.scope);
const ALLOWED = new Set(['', 'index.html', ...MANIFEST.map((m) => m.path)].map((p) => new URL(p, scopeUrl).pathname));
const BY_PATH = new Map(MANIFEST.map((m) => [new URL(m.path, scopeUrl).pathname, m.sha256]));

async function sha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const m of MANIFEST) {
        const url = new URL(m.path, scopeUrl);
        const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
        if (!res.ok) throw new Error(`Failed to cache ${m.path}`);
        const body = await res.clone().arrayBuffer();
        if ((await sha256(body)) !== m.sha256) throw new Error(`Integrity mismatch for ${m.path}`);
        await cache.put(url, res);
      }
      // The navigation entry point is the HTML file itself.
      const index = await cache.match(new URL('index.html', scopeUrl));
      if (index) await cache.put(scopeUrl, index.clone());
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('localcompress-') && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
      broadcast({ type: 'lc-cache', cache: CACHE });
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'lc-hello') broadcast({ type: 'lc-cache', cache: CACHE });
});

async function broadcast(msg) {
  for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage(msg);
}

function report(request, verdict, reason) {
  broadcast({
    type: 'lc-net',
    entry: { scope: 'service-worker', url: request.url, method: request.method, verdict, reason, time: performance.now() },
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  const deny = (reason) => {
    report(req, 'blocked', reason);
    event.respondWith(new Response('Blocked by LocalCompress egress policy', { status: 403, headers: { 'Content-Type': 'text/plain' } }));
  };

  if (url.origin !== location.origin) return deny('cross-origin');
  if (req.method !== 'GET' && req.method !== 'HEAD') return deny(`${req.method} not permitted`);
  if (url.search) return deny('query strings not permitted');
  if (!ALLOWED.has(url.pathname)) return deny('not an application asset');

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const key = req.mode === 'navigate' ? new URL('index.html', scopeUrl) : url;
      const hit = await cache.match(key);
      if (hit) return hit;
      // Not yet cached (first load race): fetch from the intranet server, verify, keep.
      const res = await fetch(key, { credentials: 'same-origin' });
      const expected = BY_PATH.get(new URL(key).pathname);
      if (res.ok && expected) {
        const body = await res.clone().arrayBuffer();
        if ((await sha256(body)) === expected) await cache.put(key, res.clone());
        else {
          report(req, 'blocked', 'integrity mismatch');
          return new Response('Integrity mismatch', { status: 502 });
        }
      }
      return res;
    })(),
  );
});
