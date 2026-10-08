// Security primitives are installed before any other application code runs.
import { installEgressGuard, installTrustedTypes, observeResources, detectCapabilities } from '@localcompress/security';
import { claimScratchSession, purgeScratch, purgeStaleSessions, type NetworkEntry } from '@localcompress/core';
import { store } from './ui/store';
import { mountApp } from './ui/app';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource/instrument-serif/400-italic.css';
import './styles/main.css';

installTrustedTypes();
installEgressGuard('page', (e) => store.addNetwork([e]), import.meta.env.PROD);
observeResources('page', (entries) => store.addNetwork(entries));
store.capabilities = detectCapabilities();

// This tab's private scratch space; leftovers of closed or crashed tabs are removed.
claimScratchSession();
void purgeStaleSessions();
// A page kept in the back/forward cache may come back; if it never does, its lock lapses and it is purged later.
window.addEventListener('pagehide', (e) => void (e.persisted || purgeScratch()));

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    store.swState = 'unsupported';
    return;
  }
  if (!import.meta.env.PROD) {
    store.swState = 'dev';
    return;
  }
  navigator.serviceWorker.addEventListener('message', (ev: MessageEvent<{ type: string; entry?: NetworkEntry; cache?: string }>) => {
    if (ev.data?.type === 'lc-net' && ev.data.entry) store.addNetwork([ev.data.entry]);
    if (ev.data?.type === 'lc-cache' && ev.data.cache) {
      store.swCache = ev.data.cache;
      store.swState = 'active';
      store.emit();
    }
  });
  try {
    store.swState = 'installing';
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './', type: 'classic', updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
    store.swState = 'active';
    (reg.active ?? navigator.serviceWorker.controller)?.postMessage({ type: 'lc-hello' });
  } catch {
    store.swState = 'error';
  }
  store.emit();
}

mountApp(document.getElementById('app')!);
void registerServiceWorker();
