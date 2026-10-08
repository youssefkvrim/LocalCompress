/// <reference lib="webworker" />
/** Streaming SHA-256 of a file, 8 MB at a time (WebCrypto cannot stream). */
import { lockDown } from '../security/guard';

// The guard first; hash-wasm is only loaded once it is in place.
lockDown('worker', () => {}, import.meta.env.PROD);
const hashWasm = import('hash-wasm');

self.onmessage = async ({ data: file }: MessageEvent<File>) => {
  const h = await (await hashWasm).createSHA256();
  for (let at = 0; at < file.size; at += 8 << 20) h.update(new Uint8Array(await file.slice(at, at + (8 << 20)).arrayBuffer()));
  (self as DedicatedWorkerGlobalScope).postMessage(h.digest('hex'));
};
