/* LocalCompress service worker: offline cache and egress firewall.
 *
 * The build replaces the two constants below: FILES lists every file of
 * the build with its SHA-256 (also published as asset-manifest.json).
 *
 *  - Only GET/HEAD of a listed file on this origin is served; every other
 *    request is answered here with 403 and reported, it never leaves.
 *  - Files are verified against their hash before being cached or served,
 *    then served from the cache, so the app works with the network off.
 */
'use strict';

const BUILD = 'dev';
const FILES = [];

const CACHE = `localcompress-${BUILD}`;
const scope = new URL(self.registration.scope);
const HASH = new Map(FILES.map((f) => [new URL(f.path, scope).pathname, f.sha256]));
const INDEX = new URL('index.html', scope);

const hex = async (buf) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf)), (b) => b.toString(16).padStart(2, '0')).join('');

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const f of FILES) {
        const url = new URL(f.path, scope);
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok || (await hex(await res.clone().arrayBuffer())) !== f.sha256) throw new Error(`Bad file: ${f.path}`);
        await cache.put(url, res);
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

async function report(request, why) {
  const entry = { scope: 'sw', url: request.url, method: request.method, blocked: true, why };
  for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage({ type: 'net', entry });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const navigation = req.mode === 'navigate' && url.origin === location.origin;
  const why =
    url.origin !== location.origin ? 'cross-origin'
    : req.method !== 'GET' && req.method !== 'HEAD' ? `${req.method} not permitted`
    : navigation ? null
    : url.search ? 'query strings not permitted'
    : HASH.has(url.pathname) ? null
    : 'not an application file';
  if (why) {
    report(req, why);
    return event.respondWith(new Response('Blocked by LocalCompress', { status: 403 }));
  }
  event.respondWith(serve(navigation ? INDEX : url));
});

/**
 * From the cache; on a miss (eviction, first load), fetch the file and serve
 * it only if it matches its build hash. Anything else fails closed.
 */
async function serve(url) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(url);
  if (hit) return hit;
  const expected = HASH.get(url.pathname);
  if (!expected) return new Response('Not part of LocalCompress', { status: 404 });
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok && (await hex(await res.clone().arrayBuffer())) === expected) {
      await cache.put(url, res.clone());
      return res;
    }
  } catch {
    /* offline and not cached */
  }
  report({ url: url.href, method: 'GET' }, 'integrity check failed');
  return new Response('Integrity check failed', { status: 502 });
}
