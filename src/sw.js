/* LocalCompress service worker: offline cache and egress firewall.
 *
 * The build replaces the constants below: FILES lists every file of the
 * build with its SHA-256 (also published as asset-manifest.json).
 *
 *  - Only GET/HEAD of a listed file on this origin is served; every other
 *    request is answered here with 403 and reported, it never leaves.
 *  - Files are verified against their hash before being cached, and again
 *    every time they are served from the cache: Cache Storage is writable
 *    by any code of this origin, so a cached copy is never trusted as is.
 *  - A new version installs in the background and waits. The page offers it
 *    when it is newer and activates it on request; otherwise it takes over
 *    once every tab of the old version is closed.
 *  - Only this application's caches (localcompress-*) are ever deleted.
 */
'use strict';

const BUILD = 'dev';
const VERSION = '0.0.0';
const FILES = [];

const PREFIX = 'localcompress-';
const CACHE = `${PREFIX}${BUILD}`;
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
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const type = event.data?.type;
  if (type === 'version') event.ports[0]?.postMessage(VERSION);
  else if (type === 'activate') self.skipWaiting();
  else if (type === 'claim') event.waitUntil(self.clients.claim());
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
 * From the cache, if the copy still matches its build hash; on a miss or a
 * mismatch (eviction, first load, tampering), fetch the file and serve it
 * only if it matches. Anything else fails closed.
 */
async function serve(url) {
  const expected = HASH.get(url.pathname);
  if (!expected) return new Response('Not part of LocalCompress', { status: 404 });
  const cache = await caches.open(CACHE);
  const hit = await cache.match(url);
  if (hit) {
    if ((await hex(await hit.clone().arrayBuffer())) === expected) return hit;
    report({ url: url.href, method: 'GET' }, 'cached copy altered, discarded');
    await cache.delete(url);
  }
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
