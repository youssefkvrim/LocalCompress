/** The application, loaded by main.ts once the egress guard is in place. */
import type { NetEntry } from './lib/types';
import { claimSession, purgeOrphans, purgeSession } from './lib/scratch';
import { store } from './ui/store';
import { newer } from './lib/version';
import { mountApp } from './ui/app';
import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-ext-400.css';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-ext-500.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-ext-600.css';
import './ui/style.css';

/** `early`: requests the guard saw before the application was loaded. */
export function start(early: NetEntry[]) {
  early.forEach(store.net);

  // This tab's private scratch space; leftovers of closed or crashed tabs go.
  claimSession();
  void purgeOrphans();
  addEventListener('pagehide', (e) => (e as PageTransitionEvent).persisted || void purgeSession());

  // Already protected (every visit but the first): no loading state at all.
  if (import.meta.env.PROD && navigator.serviceWorker?.controller) store.guard = 'on';
  mountApp(document.getElementById('app')!);
  if (import.meta.env.PROD) void protect();
}

declare const __VERSION__: string;

/**
 * The service worker caches the app for offline use and blocks every other
 * request. Processing waits until it controls this page; if it cannot be
 * installed, processing stays disabled.
 */
async function protect() {
  const sw = navigator.serviceWorker;
  if (!sw) return store.setGuard('failed');
  sw.addEventListener('message', ({ data }) => data?.type === 'net' && store.net(data.entry));

  let controlled = !!sw.controller;
  let reloading = false;
  sw.addEventListener('controllerchange', () => {
    if (!controlled) return void ((controlled = true), store.setGuard('on'));
    // A new version took over. This tab asked for it, or has nothing on screen: reload now.
    // Otherwise keep its files and results; new ones would need files of the old version.
    if (reloading || !store.items.length) return void ((reloading = true), location.reload());
    store.setUpdate('stale', () => location.reload());
  });
  const slow = setTimeout(() => store.setGuard('slow'), 8000);

  let reg: ServiceWorkerRegistration;
  try {
    reg = await sw.register('./sw.js', { updateViaCache: 'none' });
  } catch {
    return store.setGuard('failed');
  }
  // First install: a file that fails its integrity check makes the worker redundant.
  const failed = (w: ServiceWorker | null) => w?.addEventListener('statechange', () => w.state === 'redundant' && !sw.controller && store.setGuard('failed'));
  failed(reg.installing);

  const offer = async (w: ServiceWorker) => {
    // Only an upgrade is offered. A rollback or a rebuild of the same version waits until every tab is closed.
    if (sw.controller && newer(await versionOf(w), __VERSION__))
      store.setUpdate('available', () => ((reloading = true), w.postMessage({ type: 'activate' })));
  };
  if (reg.waiting) void offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    failed(w);
    w?.addEventListener('statechange', () => w.state === 'installed' && void offer(w));
  });
  // Long-lived tabs look for a new version every hour.
  setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000);

  const active = (await sw.ready).active;
  clearTimeout(slow);
  // Installed but not in control (first visit, or a hard reload that bypassed it): ask it to take over.
  if (!sw.controller) active?.postMessage({ type: 'claim' });
}

/** The version a waiting service worker carries ('0' if it does not answer). */
function versionOf(w: ServiceWorker): Promise<string> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve('0'), 3000);
    channel.port1.onmessage = ({ data }) => (clearTimeout(timer), resolve(String(data)));
    w.postMessage({ type: 'version' }, [channel.port2]);
  });
}
