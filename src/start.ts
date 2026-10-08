/** The application, loaded by main.ts once the egress guard is in place. */
import type { NetEntry } from './lib/types';
import { claimSession, purgeOrphans, purgeSession } from './lib/scratch';
import { store } from './ui/store';
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

  // The service worker caches the app for offline use and blocks every other request.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', ({ data }) => data?.type === 'net' && store.net(data.entry));
    navigator.serviceWorker
      .register('./sw.js', { updateViaCache: 'none' })
      .then(() => navigator.serviceWorker.ready)
      .then(() => ((store.offline = true), store.emit()))
      .catch(() => {});
  }

  mountApp(document.getElementById('app')!);
}
