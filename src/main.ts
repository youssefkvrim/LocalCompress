/**
 * Entry point. ES modules run their imports before their own code, so this
 * file imports nothing but the guard: lockDown() runs before any other
 * module of the application is even loaded.
 */
import { lockDown } from './security/guard';
import type { NetEntry } from './lib/types';

const early: NetEntry[] = [];
let report: (e: NetEntry) => void = (e) => void early.push(e);
lockDown('page', (e) => report(e), import.meta.env.PROD);

const { start } = await import('./start');
const { store } = await import('./ui/store');
report = store.net;
start(early);
