/// <reference lib="webworker" />
/**
 * PDF workshop worker: one per operation, terminated afterwards. The guard
 * runs first, the operations (pdf-lib, pdf.js) are loaded once it is in place.
 */
import { lockDown } from '../security/guard';
import type { DeskReason, DeskReply, DeskRequest } from '../engines/pdftools';

const post = (m: DeskReply) => (self as DedicatedWorkerGlobalScope).postMessage(m);
lockDown('worker', (entry) => post({ type: 'net', entry }), import.meta.env.PROD);

const tools = import('../engines/pdftools');
self.onmessage = async ({ data }: MessageEvent<DeskRequest>) => {
  try {
    post(await (await tools).run(data, post));
  } catch (e) {
    const err = e as Error & { reason?: DeskReason };
    post({ type: 'error', reason: err.reason ?? 'corrupt', message: err.message });
  }
};
