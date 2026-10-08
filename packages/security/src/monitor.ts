import type { Capabilities, NetworkEntry } from '@localcompress/core';

/**
 * Report every resource the current realm fetched, via the standard
 * Resource Timing API. This is what the app itself can observe; the
 * authoritative proof remains an external packet capture.
 */
export function observeResources(scope: NetworkEntry['scope'], emit: (entries: NetworkEntry[]) => void): () => void {
  if (typeof PerformanceObserver === 'undefined') return () => {};
  const toEntry = (r: PerformanceResourceTiming): NetworkEntry => ({
    scope,
    url: r.name,
    initiator: r.initiatorType,
    transferSize: r.transferSize,
    verdict: 'allowed',
    time: r.startTime,
  });
  const obs = new PerformanceObserver((list) => {
    emit((list.getEntries() as PerformanceResourceTiming[]).map(toEntry));
  });
  try {
    obs.observe({ type: 'resource', buffered: true });
  } catch {
    return () => {};
  }
  return () => obs.disconnect();
}

const SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const THREADS = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 3, 1, 1, 10, 11, 1, 9, 0, 65, 0, 254, 16, 2, 0, 26, 11]);

export function detectCapabilities(): Capabilities {
  const wasm = typeof WebAssembly === 'object';
  const g = globalThis as unknown as Record<string, unknown>;
  return {
    wasm,
    wasmSimd: wasm && WebAssembly.validate(SIMD),
    wasmThreads: wasm && typeof SharedArrayBuffer !== 'undefined' && !!g.crossOriginIsolated && WebAssembly.validate(THREADS),
    crossOriginIsolated: !!g.crossOriginIsolated,
    webCodecs: typeof g.VideoEncoder === 'function' && typeof g.VideoDecoder === 'function',
    opfs: typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory,
    fileSystemAccess: typeof g.showSaveFilePicker === 'function',
    offscreenCanvas: typeof g.OffscreenCanvas === 'function',
    hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 1,
  };
}
