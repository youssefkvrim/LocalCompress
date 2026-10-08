// The guard is installed before anything else runs.
import { lockDown } from './security/guard';
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

lockDown('page', store.net, import.meta.env.PROD);

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
