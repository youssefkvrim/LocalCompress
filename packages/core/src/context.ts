import type { Check, Detection, Plan, Reason, ResultStatus, Settings, Stage } from './types';
import type { Params } from './params';

/** Handed by the worker orchestrator to every format engine. */
export interface EngineContext {
  jobId: string;
  file: File;
  settings: Settings;
  params: Params;
  detection: Detection;
  stage(stage: Stage): void;
  /** 0–1 within the current stage. */
  progress(value: number, label?: string): void;
  log(message: string): void;
  plan(plan: Plan): void;
  /** Record an integrity check. A failed check makes the job fail. */
  check(label: string, ok: boolean, detail?: string): Check;
}

export interface EngineOutput {
  status: ResultStatus;
  reason?: Reason;
  lossless?: boolean;
  /** OPFS path of the staged output when status === 'optimized'. */
  outputPath?: string[];
  outputSize?: number;
  outputName?: string;
  mime?: string;
  engine: string;
  summary: string;
  details: string[];
  preview?: { kind: 'image'; width: number; height: number };
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Input that must not be processed (security policy, signature, encryption…). */
export class RefusedError extends Error {
  readonly reason: Reason;
  constructor(message: string, reason: Reason = 'unsupported') {
    super(message);
    this.name = 'RefusedError';
    this.reason = reason;
  }
}

/** Minimum saving for a result to be offered instead of "not worth it". */
export const MIN_SAVING = 0.01;
