/**
 * Downloads the background-removal model (and ONNX Runtime's WebAssembly)
 * in the background once the application is ready, so the first picture does
 * not wait for it. In production the service worker checks the files against
 * their build hash and keeps them for offline use; here they are only read
 * and dropped. Low priority, one at a time, never twice.
 */
import { modelUrl, ortWasmUrl } from '../lib/model';

export type ModelState = 'idle' | 'loading' | 'ready' | 'failed';

export async function preloadModel(report: (state: ModelState, progress: number) => void) {
  const urls = [ortWasmUrl, modelUrl].map((u) => new URL(u, location.href).href);
  try {
    // Already kept by the service worker (every visit but the first): nothing to do.
    if (import.meta.env.PROD && (await Promise.all(urls.map((u) => caches.match(u)))).every(Boolean)) return report('ready', 1);
    report('loading', 0);
    for (const [i, url] of urls.entries()) {
      const res = await fetch(url, { priority: 'low' } as RequestInit);
      if (!res.ok || !res.body) throw new Error(`${url}: ${res.status}`);
      const total = Number(res.headers.get('content-length')) || 0;
      let got = 0;
      let shown = 0;
      for (const reader = res.body.getReader(); ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        // The model is by far the largest file: it carries the progress, in steps of 1 %.
        const p = i === urls.length - 1 && total ? Math.min(0.99, got / total) : 0;
        if (p - shown >= 0.01) report('loading', (shown = p));
      }
    }
    report('ready', 1);
  } catch (e) {
    console.warn('LocalKit: background-removal model not preloaded; it will load on first use.', e);
    report('failed', 0);
  }
}
