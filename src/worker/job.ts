/// <reference lib="webworker" />
/**
 * Worker entry point. It imports only the guard, so lockDown() runs before
 * any engine or library is loaded; the pipeline is loaded afterwards. The
 * message handler is registered immediately so no message is ever missed.
 */
import { lockDown } from '../security/guard';
import type { FromWorker, ToWorker } from '../lib/types';

const post = (m: FromWorker) => (self as DedicatedWorkerGlobalScope).postMessage(m);
lockDown('worker', (entry) => post({ type: 'net', entry }), import.meta.env.PROD);

const pipeline = import('./pipeline');
self.onmessage = async ({ data }: MessageEvent<ToWorker>) => (await pipeline).run(data, post);
