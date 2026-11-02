import { describe, expect, it } from 'vitest';
import { box, guidedFilter, normalise, refineMask, upsample } from '../src/lib/matte';

describe('mask maths', () => {
  it('box mean keeps a flat image flat and averages at the borders', () => {
    const w = 7, h = 5;
    const out = new Float32Array(w * h);
    box(new Float32Array(w * h).fill(0.25), w, h, 2, out, new Float32Array(w * h));
    for (const v of out) expect(v).toBeCloseTo(0.25, 6);
    const ramp = Float32Array.from({ length: w }, (_, i) => i);
    const row = new Float32Array(w);
    box(ramp, w, 1, 1, row, new Float32Array(w));
    expect([...row]).toEqual([0.5, 1, 2, 3, 4, 5, 5.5]);
  });

  it('upsample keeps corners and interpolates in between', () => {
    const out = upsample(Float32Array.from([0, 1, 0, 1]), 2, 2, 4, 1);
    expect(out[0]).toBeCloseTo(0);
    expect(out[3]).toBeCloseTo(1);
    expect(out[1]).toBeGreaterThan(0);
    expect(out[1]).toBeLessThan(out[2]);
  });

  it('guided filter snaps a blurred mask to the sharp edge of the picture', () => {
    const w = 64, h = 8, edge = 32;
    const I = new Float32Array(w * h);
    const p = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        I[y * w + x] = x < edge ? 0.1 : 0.9; // sharp edge in the picture
        p[y * w + x] = Math.min(1, Math.max(0, (x - edge + 8) / 16)); // soft edge in the mask
      }
    const soft = p.slice();
    const q = guidedFilter(I, p, w, h, 4, 1e-4);
    const y = 4;
    // Near the edge, the refined mask is closer to the true step (0 left, 1 right) than the coarse one.
    for (const x of [edge - 4, edge - 3, edge - 2]) expect(q[y * w + x]).toBeLessThan(soft[y * w + x]);
    for (const x of [edge + 1, edge + 2, edge + 3]) expect(q[y * w + x]).toBeGreaterThan(soft[y * w + x]);
    // Far from it, nothing changes.
    expect(q[y * w + 2]).toBeCloseTo(0, 3);
    expect(q[y * w + w - 3]).toBeCloseTo(1, 3);
  });

  it('normalise stretches to 0-1 and measures coverage; refineMask stays in 0-1', () => {
    const { mask, coverage } = normalise(Float32Array.from([2, 4, 4, 6]), 4);
    expect([...mask]).toEqual([0, 0.5, 0.5, 1]);
    expect(coverage).toBeCloseTo(0.5);
    const alpha = refineMask(new Float32Array(16).fill(1), 4, new Float32Array(100).fill(0.5), 10, 10);
    for (const v of alpha) expect(v).toBe(1);
  });
});
