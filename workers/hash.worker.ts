/// <reference lib="webworker" />
/**
 * Hashes the original file in parallel with processing, so a multi-GB
 * checksum does not add to the wall-clock time. Spawned by job.worker.
 */
import { installEgressGuard, installTrustedTypes } from '@localcompress/security';
import { sha256Blob } from '@localcompress/core/hash';

installTrustedTypes();
installEgressGuard('worker', () => {}, import.meta.env.PROD);

self.onmessage = async (ev: MessageEvent<File>) => {
  const post = (m: unknown) => (self as DedicatedWorkerGlobalScope).postMessage(m);
  try {
    post({ digest: await sha256Blob(ev.data) });
  } catch (e) {
    post({ error: (e as Error).message });
  }
};
