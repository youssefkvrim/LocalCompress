/**
 * Lossless JPEG optimisation, the equivalent of
 * `jpegtran -optimize -progressive -copy none`, in TypeScript.
 *
 * The entropy-coded data is decoded to quantised DCT coefficients and
 * re-encoded with Huffman tables computed for this very image (ITU T.81
 * Annex K.2), both as an optimised baseline and as a spectral-selection
 * progressive stream; the smaller wins. Coefficients, quantisation tables
 * and sampling are untouched, so every decoder produces identical pixels.
 *
 * Unsupported (returns null, file left as-is): arithmetic coding, lossless /
 * hierarchical JPEG, 12-bit precision, DNL markers, corrupt streams.
 */

interface Component {
  id: number;
  h: number;
  v: number;
  tq: number;
  /** Blocks covering the image (non-interleaved scan extents). */
  bw: number;
  bh: number;
  /** Blocks padded to whole MCUs (storage stride). */
  pw: number;
  ph: number;
  /** Coefficients in zig-zag order, 64 per block. */
  coef: Int16Array;
  pred: number;
}

interface Frame {
  progressive: boolean;
  width: number;
  height: number;
  hmax: number;
  vmax: number;
  mcusX: number;
  mcusY: number;
  components: Component[];
}

interface HuffDecode {
  maxcode: Int32Array;
  valptr: Int32Array;
  mincode: Int32Array;
  values: Uint8Array;
}

export interface JpegLosslessOptions {
  /** Drop EXIF/XMP/IPTC/comments (orientation is kept). ICC and Adobe markers are always kept. */
  stripMetadata: boolean;
}

export interface JpegLosslessResult {
  bytes: Uint8Array;
  mode: 'baseline' | 'progressive';
}

class Bail extends Error {}
const bail = (m: string): never => {
  throw new Bail(m);
};

// ─── Parsing ─────────────────────────────────────────────────────────────

interface Segment {
  marker: number;
  data: Uint8Array; // payload without marker and length
}

function buildDecodeTable(counts: Uint8Array, values: Uint8Array): HuffDecode {
  const maxcode = new Int32Array(18).fill(-1);
  const valptr = new Int32Array(17);
  const mincode = new Int32Array(17);
  let code = 0;
  let k = 0;
  for (let l = 1; l <= 16; l++) {
    valptr[l] = k;
    mincode[l] = code;
    code += counts[l - 1];
    k += counts[l - 1];
    maxcode[l] = counts[l - 1] ? code - 1 : -1;
    code <<= 1;
  }
  maxcode[17] = 0x7fffffff;
  return { maxcode, valptr, mincode, values };
}

class BitReader {
  bitBuf = 0;
  bitCnt = 0;
  d: Uint8Array;
  pos: number;
  constructor(d: Uint8Array, pos: number) {
    this.d = d;
    this.pos = pos;
  }
  readBit(): number {
    if (this.bitCnt === 0) {
      if (this.pos >= this.d.length) bail('truncated scan');
      let b = this.d[this.pos++];
      if (b === 0xff) {
        const n = this.d[this.pos];
        if (n === 0) this.pos++;
        else bail('unexpected marker in scan');
      }
      this.bitBuf = b;
      this.bitCnt = 8;
    }
    this.bitCnt--;
    return (this.bitBuf >> this.bitCnt) & 1;
  }
  receive(n: number): number {
    let v = 0;
    while (n--) v = (v << 1) | this.readBit();
    return v;
  }
  extend(n: number): number {
    if (n === 0) return 0;
    if (n === 1) return this.readBit() ? 1 : -1;
    const v = this.receive(n);
    return v >= 1 << (n - 1) ? v : v - (1 << n) + 1;
  }
  decode(t: HuffDecode): number {
    let code = this.readBit();
    let l = 1;
    while (code > t.maxcode[l]) {
      code = (code << 1) | this.readBit();
      if (++l > 16) bail('bad huffman code');
    }
    return t.values[t.valptr[l] + code - t.mincode[l]];
  }
  /** Skip to the next RSTn marker at a byte boundary. */
  restart() {
    this.bitCnt = 0;
    while (this.pos + 1 < this.d.length && !(this.d[this.pos] === 0xff && this.d[this.pos + 1] >= 0xd0 && this.d[this.pos + 1] <= 0xd7)) {
      if (this.d[this.pos] === 0xff && this.d[this.pos + 1] !== 0 && this.d[this.pos + 1] !== 0xff) bail('missing restart marker');
      this.pos++;
    }
    this.pos += 2;
  }
  /** Position after the scan: the next marker. */
  end(): number {
    let p = this.pos;
    while (p + 1 < this.d.length && !(this.d[p] === 0xff && this.d[p + 1] !== 0 && !(this.d[p + 1] >= 0xd0 && this.d[p + 1] <= 0xd7))) p++;
    return p;
  }
}

interface Decoded {
  frame: Frame;
  /** Segments to carry over (APPn, COM, DQT) in original order. */
  keep: Segment[];
  dqt: Segment[];
}

function decodeJpeg(d: Uint8Array): Decoded {
  if (d[0] !== 0xff || d[1] !== 0xd8) bail('not a JPEG');
  const dc: HuffDecode[] = [];
  const ac: HuffDecode[] = [];
  const keep: Segment[] = [];
  const dqt: Segment[] = [];
  let frame: Frame | null = null;
  let restartInterval = 0;
  let p = 2;
  let sawEoi = false;

  while (p < d.length && !sawEoi) {
    if (d[p] !== 0xff) bail('marker expected');
    const marker = d[p + 1];
    p += 2;
    if (marker === 0xff) {
      p--; // fill byte
      continue;
    }
    if (marker === 0xd9) {
      sawEoi = true;
      break;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const len = (d[p] << 8) | d[p + 1];
    if (len < 2 || p + len > d.length) bail('bad segment length');
    const seg = d.subarray(p + 2, p + len);
    p += len;

    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) keep.push({ marker, data: seg });
    else if (marker === 0xdb) dqt.push({ marker, data: seg });
    else if (marker === 0xc4) {
      let q = 0;
      while (q < seg.length) {
        const tc = seg[q] >> 4;
        const th = seg[q] & 15;
        const counts = seg.subarray(q + 1, q + 17);
        const n = counts.reduce((a, b) => a + b, 0);
        const values = seg.subarray(q + 17, q + 17 + n);
        (tc === 0 ? dc : ac)[th] = buildDecodeTable(counts, values);
        q += 17 + n;
      }
    } else if (marker === 0xdd) restartInterval = (seg[0] << 8) | seg[1];
    else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (frame) bail('multiple frames');
      if (seg[0] !== 8) bail('only 8-bit precision');
      const height = (seg[1] << 8) | seg[2];
      const width = (seg[3] << 8) | seg[4];
      const nf = seg[5];
      if (!width || !height) bail('DNL not supported');
      // Coefficients take 6 bytes per pixel or more: refuse pixel bombs (as images.ts does).
      if (width * height > 120_000_000 || nf > 4) bail('image too large');
      const comps: Component[] = [];
      for (let i = 0; i < nf; i++) {
        const o = 6 + i * 3;
        comps.push({ id: seg[o], h: seg[o + 1] >> 4, v: seg[o + 1] & 15, tq: seg[o + 2], bw: 0, bh: 0, pw: 0, ph: 0, coef: new Int16Array(0), pred: 0 });
      }
      const hmax = Math.max(...comps.map((c) => c.h));
      const vmax = Math.max(...comps.map((c) => c.v));
      const mcusX = Math.ceil(width / (8 * hmax));
      const mcusY = Math.ceil(height / (8 * vmax));
      for (const c of comps) {
        if (c.h < 1 || c.h > 4 || c.v < 1 || c.v > 4) bail('bad sampling');
        c.bw = Math.ceil(Math.ceil((width * c.h) / hmax) / 8);
        c.bh = Math.ceil(Math.ceil((height * c.v) / vmax) / 8);
        c.pw = mcusX * c.h;
        c.ph = mcusY * c.v;
        c.coef = new Int16Array(c.pw * c.ph * 64);
      }
      frame = { progressive: marker === 0xc2, width, height, hmax, vmax, mcusX, mcusY, components: comps };
    } else if (marker >= 0xc3 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      bail('unsupported JPEG process (arithmetic / lossless / hierarchical)');
    } else if (marker === 0xdc) bail('DNL not supported');
    else if (marker === 0xda) {
      const fr: Frame = frame ?? bail('scan before frame');
      const ns = seg[0];
      const scomps: { c: Component; dc: HuffDecode; ac: HuffDecode }[] = [];
      for (let i = 0; i < ns; i++) {
        const c = fr.components.find((x) => x.id === seg[1 + i * 2]) ?? bail('unknown component');
        scomps.push({ c, dc: dc[seg[2 + i * 2] >> 4], ac: ac[seg[2 + i * 2] & 15] });
      }
      const ss = seg[1 + ns * 2];
      const se = seg[2 + ns * 2];
      const ah = seg[3 + ns * 2] >> 4;
      const al = seg[3 + ns * 2] & 15;
      p = decodeScan(d, p, fr, scomps, restartInterval, ss, se, ah, al);
    }
    // other markers (DAC, EXP…) are ignored
  }
  return { frame: frame ?? bail('no frame'), keep, dqt };
}

function decodeScan(
  d: Uint8Array,
  start: number,
  frame: Frame,
  scomps: { c: Component; dc: HuffDecode; ac: HuffDecode }[],
  restartInterval: number,
  ss: number,
  se: number,
  ah: number,
  al: number,
): number {
  const r = new BitReader(d, start);
  let eobrun = 0;
  let acState = 0;
  let acNext = 0;
  const progressive = frame.progressive;

  const decodeBlock = (sc: (typeof scomps)[number], off: number) => {
    const c = sc.c;
    const coef = c.coef;
    if (!progressive) {
      const t = r.decode(sc.dc ?? bail('missing DC table'));
      c.pred += t === 0 ? 0 : r.extend(t);
      coef[off] = c.pred;
      for (let k = 1; k < 64; ) {
        const rs = r.decode(sc.ac ?? bail('missing AC table'));
        const s = rs & 15;
        const run = rs >> 4;
        if (s === 0) {
          if (run < 15) break;
          k += 16;
          continue;
        }
        k += run;
        if (k > 63) bail('coefficient overflow');
        coef[off + k] = r.extend(s);
        k++;
      }
      return;
    }
    if (ss === 0) {
      if (ah === 0) {
        const t = r.decode(sc.dc ?? bail('missing DC table'));
        c.pred += t === 0 ? 0 : r.extend(t) * (1 << al);
        coef[off] = c.pred;
      } else if (r.readBit()) coef[off] |= 1 << al;
      return;
    }
    if (ah === 0) {
      if (eobrun > 0) {
        eobrun--;
        return;
      }
      for (let k = ss; k <= se; ) {
        const rs = r.decode(sc.ac ?? bail('missing AC table'));
        const s = rs & 15;
        const run = rs >> 4;
        if (s === 0) {
          if (run < 15) {
            eobrun = r.receive(run) + (1 << run) - 1;
            break;
          }
          k += 16;
          continue;
        }
        k += run;
        if (k > 63) bail('coefficient overflow');
        coef[off + k] = r.extend(s) * (1 << al);
        k++;
      }
      return;
    }
    // AC successive approximation (refinement).
    let k = ss;
    let run = 0;
    while (k <= se) {
      const z = off + k;
      const sign = coef[z] < 0 ? -1 : 1;
      switch (acState) {
        case 0: {
          const rs = r.decode(sc.ac ?? bail('missing AC table'));
          const s = rs & 15;
          run = rs >> 4;
          if (s === 0) {
            if (run < 15) {
              eobrun = r.receive(run) + (1 << run);
              acState = 4;
            } else {
              run = 16;
              acState = 1;
            }
          } else {
            if (s !== 1) bail('invalid refinement');
            acNext = r.extend(1);
            acState = run ? 2 : 3;
          }
          continue;
        }
        case 1:
        case 2:
          if (coef[z]) coef[z] += sign * (r.readBit() << al);
          else if (--run === 0) acState = acState === 2 ? 3 : 0;
          break;
        case 3:
          if (coef[z]) coef[z] += sign * (r.readBit() << al);
          else {
            coef[z] = acNext << al;
            acState = 0;
          }
          break;
        case 4:
          if (coef[z]) coef[z] += sign * (r.readBit() << al);
          break;
      }
      k++;
    }
    if (acState === 4 && --eobrun === 0) acState = 0;
  };

  const single = scomps.length === 1;
  const total = single ? scomps[0].c.bw * scomps[0].c.bh : frame.mcusX * frame.mcusY;
  for (const sc of scomps) sc.c.pred = 0;
  for (let n = 0; n < total; n++) {
    if (restartInterval && n > 0 && n % restartInterval === 0) {
      r.restart();
      for (const sc of scomps) sc.c.pred = 0;
      eobrun = 0;
      acState = 0;
    }
    if (single) {
      const c = scomps[0].c;
      const row = Math.floor(n / c.bw);
      const col = n % c.bw;
      decodeBlock(scomps[0], (row * c.pw + col) * 64);
    } else {
      const my = Math.floor(n / frame.mcusX);
      const mx = n % frame.mcusX;
      for (const sc of scomps) {
        const c = sc.c;
        for (let v = 0; v < c.v; v++)
          for (let h = 0; h < c.h; h++) decodeBlock(sc, ((my * c.v + v) * c.pw + mx * c.h + h) * 64);
      }
    }
  }
  return r.end();
}

// ─── Encoding ────────────────────────────────────────────────────────────

class BitWriter {
  out: Uint8Array;
  n = 0;
  acc = 0;
  cnt = 0;
  constructor(cap: number) {
    this.out = new Uint8Array(Math.max(1024, cap));
  }
  private byte(b: number) {
    if (this.n + 2 > this.out.length) {
      const g = new Uint8Array(this.out.length * 2);
      g.set(this.out);
      this.out = g;
    }
    this.out[this.n++] = b;
    if (b === 0xff) this.out[this.n++] = 0;
  }
  bits(v: number, len: number) {
    // len ≤ 16; acc kept below 2^24
    this.acc = (this.acc << len) | (v & ((1 << len) - 1));
    this.cnt += len;
    while (this.cnt >= 8) {
      this.cnt -= 8;
      this.byte((this.acc >> this.cnt) & 0xff);
    }
    this.acc &= (1 << this.cnt) - 1;
  }
  flush() {
    if (this.cnt > 0) this.bits(0x7f, 8 - this.cnt); // pad with 1-bits
  }
  bytes() {
    return this.out.subarray(0, this.n);
  }
}

const nbits = (v: number) => {
  let a = v < 0 ? -v : v;
  let n = 0;
  while (a) (n++, (a >>= 1));
  return n;
};

/** Code emitters for a scan: pass 1 counts symbols, pass 2 writes them. */
interface Sink {
  sym(table: number, s: number): void;
  raw(v: number, len: number): void;
}

/** Optimal length-limited Huffman table (T.81 Annex K.2 / K.3). */
function optimalTable(freqIn: Uint32Array): { counts: Uint8Array; values: Uint8Array; code: Uint16Array; size: Uint8Array } {
  const freq = new Float64Array(257);
  for (let i = 0; i < 256; i++) freq[i] = freqIn[i];
  freq[256] = 1; // reserved: guarantees no all-ones code
  const codesize = new Int32Array(257);
  const others = new Int32Array(257).fill(-1);
  for (;;) {
    let c1 = -1;
    let v = Infinity;
    for (let i = 0; i <= 256; i++) if (freq[i] && freq[i] <= v) (v = freq[i]), (c1 = i);
    let c2 = -1;
    v = Infinity;
    for (let i = 0; i <= 256; i++) if (freq[i] && freq[i] <= v && i !== c1) (v = freq[i]), (c2 = i);
    if (c2 < 0) break;
    freq[c1] += freq[c2];
    freq[c2] = 0;
    codesize[c1]++;
    while (others[c1] >= 0) codesize[(c1 = others[c1])]++;
    others[c1] = c2;
    codesize[c2]++;
    while (others[c2] >= 0) codesize[(c2 = others[c2])]++;
  }
  const bits = new Int32Array(33);
  for (let i = 0; i <= 256; i++) if (codesize[i]) bits[codesize[i]]++;
  for (let i = 32; i > 16; i--) {
    while (bits[i] > 0) {
      let j = i - 2;
      while (bits[j] === 0) j--;
      bits[i] -= 2;
      bits[i - 1]++;
      bits[j + 1] += 2;
      bits[j]--;
    }
  }
  let i = 16;
  while (bits[i] === 0) i--;
  bits[i]--; // remove reserved symbol
  const values: number[] = [];
  for (let l = 1; l <= 32; l++) for (let s = 0; s < 256; s++) if (codesize[s] === l) values.push(s);
  const counts = new Uint8Array(16);
  for (let l = 1; l <= 16; l++) counts[l - 1] = bits[l];
  // Canonical codes (Annex C).
  const code = new Uint16Array(256);
  const size = new Uint8Array(256);
  let c = 0;
  let k = 0;
  for (let l = 1; l <= 16; l++) {
    for (let n = 0; n < counts[l - 1]; n++) {
      code[values[k]] = c++;
      size[values[k]] = l;
      k++;
    }
    c <<= 1;
  }
  return { counts, values: Uint8Array.from(values.slice(0, counts.reduce((a, b) => a + b, 0))), code, size };
}

interface ScanSpec {
  comps: Component[];
  ss: number;
  se: number;
  ah: number;
  al: number;
  /** Table index per component for DC and AC. */
  table: number[];
}

function* blocksOf(frame: Frame, comps: Component[]): Generator<[number, number]> {
  if (comps.length === 1) {
    const c = comps[0];
    for (let row = 0; row < c.bh; row++) for (let col = 0; col < c.bw; col++) yield [0, (row * c.pw + col) * 64];
    return;
  }
  for (let my = 0; my < frame.mcusY; my++)
    for (let mx = 0; mx < frame.mcusX; mx++)
      for (let i = 0; i < comps.length; i++) {
        const c = comps[i];
        for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) yield [i, ((my * c.v + v) * c.pw + mx * c.h + h) * 64];
      }
}

/** Largest correction-bit backlog before an EOB run is forced out (libjpeg MAX_CORR_BITS - 63). */
const MAX_PENDING_BITS = 1000 - 63;

/**
 * Emit one scan through `sink` (DC tables 0..1, AC tables 2..3).
 * Ports libjpeg's sequential, DC first/refine, AC first and AC refine encoders.
 */
function runScan(frame: Frame, spec: ScanSpec, sink: Sink) {
  const { ss, se, ah, al } = spec;
  const preds = spec.comps.map(() => 0);
  let eobrun = 0;
  let eobTable = 0;
  let pending: number[] = []; // correction bits owed by the blocks of the current EOB run
  const flushEob = () => {
    if (!eobrun) return;
    const n = nbits(eobrun) - 1;
    sink.sym(eobTable, n << 4);
    if (n) sink.raw(eobrun, n);
    eobrun = 0;
    for (const b of pending) sink.raw(b, 1);
    pending = [];
  };
  const emitValue = (t: number, run: number, v: number) => {
    const n = nbits(v);
    sink.sym(t, (run << 4) | n);
    sink.raw(v < 0 ? v - 1 : v, n);
  };
  const absValues = new Int32Array(64);

  for (const [ci, off] of blocksOf(frame, spec.comps)) {
    const coef = spec.comps[ci].coef;
    const t = spec.table[ci];
    const acT = 2 + t;

    if (ss === 0) {
      if (ah === 0) {
        const v = coef[off] >> al; // arithmetic shift, as libjpeg
        const diff = v - preds[ci];
        preds[ci] = v;
        const n = nbits(diff);
        sink.sym(t, n);
        if (n) sink.raw(diff < 0 ? diff - 1 : diff, n);
      } else sink.raw((coef[off] >> al) & 1, 1);
      if (se === 0) continue;
      // Sequential (baseline) block.
      let run = 0;
      for (let k = 1; k <= 63; k++) {
        const v = coef[off + k];
        if (v === 0) {
          run++;
          continue;
        }
        while (run > 15) sink.sym(acT, 0xf0), (run -= 16);
        emitValue(acT, run, v);
        run = 0;
      }
      if (run > 0) sink.sym(acT, 0);
      continue;
    }

    eobTable = acT;
    if (ah === 0) {
      // AC first scan.
      let run = 0;
      for (let k = ss; k <= se; k++) {
        const c = coef[off + k];
        const m = (c < 0 ? -c : c) >> al;
        if (m === 0) {
          run++;
          continue;
        }
        flushEob();
        while (run > 15) sink.sym(acT, 0xf0), (run -= 16);
        emitValue(acT, run, c < 0 ? -m : m);
        run = 0;
      }
      if (run > 0 && ++eobrun === 0x7fff) flushEob();
      continue;
    }

    // AC refinement scan.
    let eob = 0;
    for (let k = ss; k <= se; k++) {
      const c = coef[off + k];
      const m = (c < 0 ? -c : c) >> al;
      absValues[k] = m;
      if (m === 1) eob = k;
    }
    let run = 0;
    let br: number[] = [];
    for (let k = ss; k <= se; k++) {
      const m = absValues[k];
      if (m === 0) {
        run++;
        continue;
      }
      while (run > 15 && k <= eob) {
        flushEob();
        sink.sym(acT, 0xf0);
        run -= 16;
        for (const b of br) sink.raw(b, 1);
        br = [];
      }
      if (m > 1) {
        br.push(m & 1);
        continue;
      }
      flushEob();
      sink.sym(acT, (run << 4) | 1);
      sink.raw(coef[off + k] < 0 ? 0 : 1, 1);
      for (const b of br) sink.raw(b, 1);
      br = [];
      run = 0;
    }
    if (run > 0 || br.length > 0) {
      eobrun++;
      pending.push(...br);
      if (eobrun === 0x7fff || pending.length > MAX_PENDING_BITS) flushEob();
    }
  }
  flushEob();
}

function segment(marker: number, payload: Uint8Array | number[]): Uint8Array {
  const len = payload.length + 2;
  const b = new Uint8Array(len + 2);
  b[0] = 0xff;
  b[1] = marker;
  b[2] = len >> 8;
  b[3] = len & 0xff;
  b.set(payload, 4);
  return b;
}

function encodeScan(frame: Frame, spec: ScanSpec): Uint8Array[] {
  // Pass 1: statistics.
  const freq = [0, 1, 2, 3].map(() => new Uint32Array(256));
  runScan(frame, spec, { sym: (t, s) => freq[t][s]++, raw: () => {} });
  const used = [0, 1, 2, 3].filter((t) => freq[t].some((x) => x));
  const tables = new Map(used.map((t) => [t, optimalTable(freq[t])]));
  const dht: number[] = [];
  for (const t of used) {
    const tb = tables.get(t)!;
    dht.push(((t >= 2 ? 1 : 0) << 4) | (t & 1), ...tb.counts, ...tb.values);
  }
  // Pass 2: entropy-coded data.
  const w = new BitWriter(frame.width * frame.height);
  runScan(frame, spec, {
    sym: (t, s) => {
      const tb = tables.get(t)!;
      if (!tb.size[s]) bail('symbol without code');
      w.bits(tb.code[s], tb.size[s]);
    },
    raw: (v, n) => w.bits(v, n),
  });
  w.flush();
  const sos: number[] = [spec.comps.length];
  spec.comps.forEach((c, i) => sos.push(c.id, (spec.table[i] << 4) | spec.table[i]));
  sos.push(spec.ss, spec.se, (spec.ah << 4) | spec.al);
  return [segment(0xc4, dht), segment(0xda, sos), w.bytes().slice()];
}

const tableFor = (frame: Frame, c: Component) => (c === frame.components[0] ? 0 : 1);

function encode(frame: Frame, head: Uint8Array[], progressive: boolean): Uint8Array {
  const comps = frame.components;
  const sof: number[] = [8, frame.height >> 8, frame.height & 0xff, frame.width >> 8, frame.width & 0xff, comps.length];
  for (const c of comps) sof.push(c.id, (c.h << 4) | c.v, c.tq);
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8]), ...head, segment(progressive ? 0xc2 : 0xc0, sof)];
  const blocksPerMcu = comps.reduce((n, c) => n + c.h * c.v, 0);
  const canInterleave = comps.length > 1 && comps.length <= 4 && blocksPerMcu <= 10;
  const groups = comps.length === 1 || canInterleave ? [comps] : comps.map((c) => [c]);
  const scan = (cs: Component[], ss: number, se: number, ah: number, al: number) =>
    parts.push(...encodeScan(frame, { comps: cs, ss, se, ah, al, table: cs.map((c) => tableFor(frame, c)) }));
  const dc = (ah: number, al: number) => groups.forEach((g) => scan(g, 0, 0, ah, al));
  if (!progressive) {
    for (const g of groups) scan(g, 0, 63, 0, 0);
  } else if (comps.length === 3) {
    // libjpeg's jpeg_simple_progression() script for YCbCr, what `jpegtran -progressive` writes.
    const [y, cb, cr] = comps;
    dc(0, 1);
    scan([y], 1, 5, 0, 2);
    scan([cr], 1, 63, 0, 1);
    scan([cb], 1, 63, 0, 1);
    scan([y], 6, 63, 0, 2);
    scan([y], 1, 63, 2, 1);
    dc(1, 0);
    scan([cr], 1, 63, 1, 0);
    scan([cb], 1, 63, 1, 0);
    scan([y], 1, 63, 1, 0);
  } else {
    dc(0, 1);
    for (const c of comps) scan([c], 1, 5, 0, 2);
    for (const c of comps) scan([c], 6, 63, 0, 2);
    for (const c of comps) scan([c], 1, 63, 2, 1);
    dc(1, 0);
    for (const c of comps) scan([c], 1, 63, 1, 0);
  }
  parts.push(new Uint8Array([0xff, 0xd9]));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, o), (o += p.length);
  return out;
}

// ─── Metadata ────────────────────────────────────────────────────────────

const startsWithAscii = (d: Uint8Array, s: string) => s.split('').every((ch, i) => d[i] === ch.charCodeAt(0));

/** EXIF orientation (1-8) from an APP1 payload, or 1. */
function exifOrientation(app1: Uint8Array): number {
  if (!startsWithAscii(app1, 'Exif\0\0')) return 1;
  const t = app1.subarray(6);
  const le = t[0] === 0x49;
  const u16 = (o: number) => (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const u32 = (o: number) => (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16)) + t[o + 3] * 2 ** 24 : t[o] * 2 ** 24 + ((t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]));
  try {
    const ifd = u32(4);
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (u16(e) === 0x0112) return u16(e + 8);
    }
  } catch {
    /* malformed EXIF */
  }
  return 1;
}

/** Minimal EXIF carrying only the orientation tag. */
function exifWithOrientation(o: number): Uint8Array {
  return Uint8Array.from([
    ...'Exif\0\0'.split('').map((c) => c.charCodeAt(0)),
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF, IFD at 8
    0x00, 0x01, // 1 entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, o, 0x00, 0x00, // Orientation SHORT
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ]);
}

function headerSegments(keep: Segment[], dqt: Segment[], strip: boolean): Uint8Array[] {
  const out: Uint8Array[] = [];
  let orientation = 1;
  for (const s of keep) {
    const isExif = s.marker === 0xe1 && startsWithAscii(s.data, 'Exif\0\0');
    if (isExif) orientation = exifOrientation(s.data);
    const essential =
      (s.marker === 0xe0 && startsWithAscii(s.data, 'JFIF\0')) ||
      (s.marker === 0xe2 && startsWithAscii(s.data, 'ICC_PROFILE\0')) ||
      (s.marker === 0xee && startsWithAscii(s.data, 'Adobe'));
    if (!strip || essential) out.push(segment(s.marker, s.data));
  }
  if (strip && orientation !== 1 && orientation >= 2 && orientation <= 8) out.splice(out.length ? 1 : 0, 0, segment(0xe1, exifWithOrientation(orientation)));
  for (const q of dqt) out.push(segment(0xdb, q.data));
  return out;
}

// ─── Public API ──────────────────────────────────────────────────────────

/** Quantised coefficients of the visible blocks of every component, for equality checks. */
export function jpegCoefficients(bytes: Uint8Array): Int16Array[] | null {
  try {
    return decodeJpeg(bytes).frame.components.map((c) => {
      const out = new Int16Array(c.bw * c.bh * 64);
      for (let row = 0; row < c.bh; row++) out.set(c.coef.subarray(row * c.pw * 64, (row * c.pw + c.bw) * 64), row * c.bw * 64);
      return out;
    });
  } catch {
    return null;
  }
}

export function optimizeJpegLossless(bytes: Uint8Array, opts: JpegLosslessOptions): JpegLosslessResult | null {
  let dec: Decoded;
  try {
    dec = decodeJpeg(bytes);
  } catch (e) {
    if (e instanceof Bail) return null;
    throw e;
  }
  const head = headerSegments(dec.keep, dec.dqt, opts.stripMetadata);
  const baseline = encode(dec.frame, head, false);
  const progressive = encode(dec.frame, head, true);
  return progressive.length < baseline.length ? { bytes: progressive, mode: 'progressive' } : { bytes: baseline, mode: 'baseline' };
}

/** Proof of losslessness: identical quantised coefficients in every block. */
export function sameCoefficients(a: Uint8Array, b: Uint8Array): boolean {
  const x = jpegCoefficients(a);
  const y = jpegCoefficients(b);
  if (!x || !y || x.length !== y.length) return false;
  return x.every((c, i) => c.length === y[i].length && c.every((v, j) => v === y[i][j]));
}
