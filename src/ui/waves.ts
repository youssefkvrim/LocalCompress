/**
 * Animated background: a field of small shapes (triangles, circles, squares)
 * in slowly morphing bands, that ripples where the pointer passes and pops in
 * from the centre on load.
 *
 * Port of ShapeWaves (React Bits, itself inspired by Vercel Labs) to plain
 * WebGPU, without React or a WebGPU helper library: one full-screen pass,
 * the ripples simulated on the CPU in a small grid. Without WebGPU, or with
 * "reduce motion", the page simply keeps its plain background.
 *
 * Decorative only: no file data ever reaches it. It stops while files are
 * being processed, so the graphics card is free for background removal.
 */

export interface WavesOptions {
  cellSize: number;
  dotSize: number;
  color: string;
  hoverColor: string;
  backgroundColor: string;
  speed: number;
  scale: number;
  contrast: number;
  brightness: number;
  fade: number;
  splashRadius: number;
  splashStrength: number;
  introDuration: number;
}

const MAX_DPR = 2;
const NOISE_CELLS = 32;
const TIME_RATE = 0.1;
const SIMULATION_STEP = 1 / 60;
const WAVE_SPEED = 0.42;
const WAVE_FRICTION = 0.94;
const WAVE_DECAY = 0.972;
const SETTLED_THRESHOLD = 0.01;
const INTRO_BAND = 0.2;
const INTRO_WARP = 0.3;
const INTRO_JITTER = 0.16;
const INTRO_END = 1 + INTRO_WARP + INTRO_JITTER + INTRO_BAND;
/** GPUBufferUsage flags (the WebGPU spec values; TypeScript's DOM library does not declare the object). */
const COPY_DST = 0x08;
const UNIFORM = 0x40;
const STORAGE = 0x80;

const SHADER = /* wgsl */ `
struct Params {
  resolution: vec4f,
  placement: vec4f, // grid origin x, y, rows, intro progress
  grid: vec4f,      // cell px, dot size, -, cols
  field: vec4f,     // noise scale, brightness, contrast, time
  motion: vec4f,    // -, -, -, fade
  color: vec4f,
  hover: vec4f,
  background: vec4f,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> charges: array<f32>;

struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f }

@vertex fn vs_main(@builtin(vertex_index) index: u32) -> VertexOut {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let p = corners[index];
  var out: VertexOut;
  out.position = vec4f(p, 0.0, 1.0);
  out.uv = vec2f((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
  return out;
}

const SEED = vec2f(12.9898, 78.233);

fn mod289v3(x: vec3f) -> vec3f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn mod289v4(x: vec4f) -> vec4f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn permute(x: vec4f) -> vec4f { return mod289v4(((x * 34.0) + 10.0) * x); }
fn taylorInvSqrt(r: vec4f) -> vec4f { return 1.79284291400159 - 0.85373472095314 * r; }
fn fadeCurve(t: vec3f) -> vec3f { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

fn cnoise(P: vec3f) -> f32 {
  var Pi0 = floor(P);
  var Pi1 = Pi0 + vec3f(1.0);
  Pi0 = mod289v3(Pi0);
  Pi1 = mod289v3(Pi1);
  let Pf0 = fract(P);
  let Pf1 = Pf0 - vec3f(1.0);
  let ix = vec4f(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  let iy = vec4f(Pi0.yy, Pi1.yy);
  let iz0 = Pi0.zzzz;
  let iz1 = Pi1.zzzz;
  let ixy = permute(permute(ix) + iy);
  let ixy0 = permute(ixy + iz0);
  let ixy1 = permute(ixy + iz1);
  var gx0 = ixy0 * (1.0 / 7.0);
  var gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
  gx0 = fract(gx0);
  let gz0 = vec4f(0.5) - abs(gx0) - abs(gy0);
  let sz0 = step(gz0, vec4f(0.0));
  gx0 -= sz0 * (step(vec4f(0.0), gx0) - 0.5);
  gy0 -= sz0 * (step(vec4f(0.0), gy0) - 0.5);
  var gx1 = ixy1 * (1.0 / 7.0);
  var gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
  gx1 = fract(gx1);
  let gz1 = vec4f(0.5) - abs(gx1) - abs(gy1);
  let sz1 = step(gz1, vec4f(0.0));
  gx1 -= sz1 * (step(vec4f(0.0), gx1) - 0.5);
  gy1 -= sz1 * (step(vec4f(0.0), gy1) - 0.5);
  var g000 = vec3f(gx0.x, gy0.x, gz0.x);
  var g100 = vec3f(gx0.y, gy0.y, gz0.y);
  var g010 = vec3f(gx0.z, gy0.z, gz0.z);
  var g110 = vec3f(gx0.w, gy0.w, gz0.w);
  var g001 = vec3f(gx1.x, gy1.x, gz1.x);
  var g101 = vec3f(gx1.y, gy1.y, gz1.y);
  var g011 = vec3f(gx1.z, gy1.z, gz1.z);
  var g111 = vec3f(gx1.w, gy1.w, gz1.w);
  let norm0 = taylorInvSqrt(vec4f(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
  g000 *= norm0.x;
  g010 *= norm0.y;
  g100 *= norm0.z;
  g110 *= norm0.w;
  let norm1 = taylorInvSqrt(vec4f(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
  g001 *= norm1.x;
  g011 *= norm1.y;
  g101 *= norm1.z;
  g111 *= norm1.w;
  let n000 = dot(g000, Pf0);
  let n100 = dot(g100, vec3f(Pf1.x, Pf0.yz));
  let n010 = dot(g010, vec3f(Pf0.x, Pf1.y, Pf0.z));
  let n110 = dot(g110, vec3f(Pf1.xy, Pf0.z));
  let n001 = dot(g001, vec3f(Pf0.xy, Pf1.z));
  let n101 = dot(g101, vec3f(Pf1.x, Pf0.y, Pf1.z));
  let n011 = dot(g011, vec3f(Pf0.x, Pf1.yz));
  let n111 = dot(g111, Pf1);
  let f = fadeCurve(Pf0);
  let nz = mix(vec4f(n000, n100, n010, n110), vec4f(n001, n101, n011, n111), f.z);
  let ny = mix(nz.xy, nz.zw, f.y);
  return 2.2 * mix(ny.x, ny.y, f.x);
}

fn fbm(p: vec3f) -> f32 {
  var total = 0.0;
  var amplitude = 1.0;
  var weight = 0.0;
  var frequency = 1.0;
  for (var i = 0; i < 2; i++) {
    total += amplitude * cnoise(p * frequency);
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return total / weight;
}

fn sdIsoscelesTriangle(point: vec2f, q: vec2f) -> f32 {
  let p = vec2f(abs(point.x), point.y);
  let a = p - q * clamp(dot(p, q) / dot(q, q), 0.0, 1.0);
  let b = p - q * vec2f(clamp(p.x / q.x, 0.0, 1.0), 1.0);
  let s = -sign(q.y);
  let d = min(vec2f(dot(a, a), s * (p.x * q.y - p.y * q.x)), vec2f(dot(b, b), s * (p.y - q.y)));
  return -sqrt(d.x) * sign(d.y);
}

fn shapeDistance(p: vec2f, shape: i32, c: f32) -> f32 {
  if (shape == 0) { return max(abs(p.x), abs(p.y)) - c; }
  if (shape == 1) { return length(p) - c; }
  return sdIsoscelesTriangle(vec2f(p.x, p.y + c), vec2f(c, 2.0 * c));
}

fn hash21(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let resolution = params.resolution.xy;
  let cellPx = params.grid.x;
  let dotSize = params.grid.y;
  let cols = i32(params.grid.w + 0.5);
  let background = params.background.rgb;
  let pixel = uv * resolution;
  let origin = params.placement.xy;
  let rows = i32(params.placement.z + 0.5);
  let cell = floor((pixel - origin) / cellPx);
  if (cell.y < 0.0 || i32(cell.y) >= rows || cell.x < 0.0 || i32(cell.x) >= cols) { return vec4f(background, 1.0); }
  let center = origin + (cell + 0.5) * cellPx;
  let local = (pixel - center) / (cellPx * 0.5);
  let cellUv = center / resolution;

  var level = 1.0;
  let fade = params.motion.w;
  if (fade > 0.0) {
    let q = abs(uv * 2.0 - 1.0);
    let radius = pow(pow(q.x, 2.5) + pow(q.y, 2.5), 1.0 / 2.5) / pow(2.0, 1.0 / 2.5);
    level = 1.0 - smoothstep(max(0.0, 1.0 - fade * 2.2), 1.0, radius);
  }
  let noise = fbm(vec3f(center / params.field.x + SEED, params.field.w));
  let tone = clamp((noise * 0.5 + 0.5 - params.field.y) * params.field.z + 0.5, 0.0, 1.0);
  let band = i32(min(tone, 0.999999) * 3.0);

  var charge = 0.0;
  let index = i32(cell.y) * cols + i32(cell.x);
  if (index >= 0 && index < i32(arrayLength(&charges))) { charge = charges[index]; }
  let stepped = (band + i32(clamp(charge, 0.0, 0.999) * 3.0)) % 3;
  let shape = 2 - stepped; // dark bands triangles, mid circles, bright squares
  var size = dotSize;

  let introProgress = params.placement.w;
  var front = 0.0;
  if (introProgress < ${INTRO_END.toFixed(2)}) {
    let radial = length((center - resolution * 0.5) / (resolution * 0.5)) * 0.70710678;
    let warp = cnoise(vec3f(cellUv * vec2f(3.2, 2.4) + SEED, 4.7)) * ${INTRO_WARP.toFixed(2)};
    let jitter = hash21(cell) * ${INTRO_JITTER.toFixed(2)};
    let spread = radial + warp + jitter + ${INTRO_WARP.toFixed(2)};
    let width = ${INTRO_BAND.toFixed(2)} * (0.6 + 0.8 * hash21(cell + vec2f(17.0, 9.0)));
    let t = clamp((introProgress - spread) / width, 0.0, 1.0);
    if (t <= 0.0) { return vec4f(background, 1.0); }
    let back = t - 1.0;
    size = max(size * (1.0 + 2.70158 * back * back * back + 1.70158 * back * back), 0.02);
    front = 1.0 - smoothstep(0.0, 1.0, abs(introProgress - spread) / width);
  }
  let aa = 2.0 / cellPx;
  let coverage = smoothstep(aa, -aa, shapeDistance(local, shape, size));
  let tint = mix(params.color.rgb, params.hover.rgb, max(smoothstep(0.15, 0.85, charge), front * 0.35));
  return vec4f(mix(background, tint, coverage * level), 1.0);
}
`;

const rgb = (hex: string) => [0, 2, 4].map((o) => parseInt(hex.replace('#', '').slice(o, o + 2), 16) / 255);

/** Mounts the field into `host` (which must be positioned). Returns a function that stops and removes it. */
export function mountWaves(host: HTMLElement, o: WavesOptions, isPaused: () => boolean): { wake(): void; destroy(): void } {
  const none = { wake() {}, destroy() {} };
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  if (!gpu) return none;

  const canvas = document.createElement('canvas');
  canvas.className = 'waves-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.append(canvas);
  host.style.backgroundColor = o.backgroundColor;

  let disposed = false;
  let device: GPUDevice | undefined;
  let frameId = 0;
  let wake = () => {};
  const cleanups: (() => void)[] = [];

  const stop = () => {
    disposed = true;
    if (frameId) cancelAnimationFrame(frameId);
    cleanups.forEach((c) => c());
    device?.destroy();
    canvas.remove();
  };

  void (async () => {
    try {
      const adapter = await gpu.requestAdapter({ powerPreference: 'low-power' });
      if (!adapter || disposed) return stop();
      device = await adapter.requestDevice();
      if (disposed) return stop();
      void device.lost.then(() => !disposed && stop());
      const context = canvas.getContext('webgpu') as GPUCanvasContext;
      const format = gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: 'opaque' });

      const module = device.createShaderModule({ code: SHADER });
      const pipeline = await device.createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs_main' },
        fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
      if (disposed) return;
      const uniform = new Float32Array(32);
      const uniformBuffer = device.createBuffer({ size: uniform.byteLength, usage: UNIFORM | COPY_DST });
      let chargeBuffer = device.createBuffer({ size: 4, usage: STORAGE | COPY_DST });
      const bind = () => device!.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniformBuffer } }, { binding: 1, resource: { buffer: chargeBuffer } }] });
      let bindGroup = bind();

      let dpr = 1;
      let width = 1;
      let height = 1;
      let cols = 1;
      let rows = 1;
      let cellPx = o.cellSize;
      let originY = 0;
      let charges = new Float32Array(1);
      let heights = new Float32Array(1);
      let previous = new Float32Array(1);
      let chargesActive = false;
      let backlog = 0;
      let time = 0;
      let last = 0;
      let visible = true;
      let introStart = performance.now();
      let introProgress = reduceMotion.matches ? INTRO_END : 0;
      let bounds: DOMRect | null = null;
      const pointer = { x: 0, y: 0, at: 0, inside: false };

      const set = (offset: number, values: number[]) => uniform.set(values, offset * 4);
      set(5, [...rgb(o.color), 1]);
      set(6, [...rgb(o.hoverColor), 0]);
      set(7, [...rgb(o.backgroundColor), 1]);

      const resize = () => {
        bounds = null;
        dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        width = canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
        height = canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
        const nextCols = Math.max(1, Math.round(width / (o.cellSize * dpr)));
        cellPx = width / nextCols;
        const nextRows = Math.max(1, Math.floor(height / cellPx));
        originY = (height - nextRows * cellPx) / 2;
        if (nextCols !== cols || nextRows !== rows) {
          cols = nextCols;
          rows = nextRows;
          charges = new Float32Array(cols * rows);
          heights = new Float32Array(cols * rows);
          previous = new Float32Array(cols * rows);
          chargesActive = false;
          chargeBuffer.destroy();
          chargeBuffer = device!.createBuffer({ size: charges.byteLength, usage: STORAGE | COPY_DST });
          device!.queue.writeBuffer(chargeBuffer, 0, charges);
          bindGroup = bind();
        }
        wake();
      };

      const splash = (x: number, y: number, strength: number) => {
        const sigma = Math.max(0.5, ((o.splashRadius * dpr) / cellPx) * 0.5);
        const reach = Math.ceil(sigma * 2.5);
        const cc = (x * dpr) / cellPx - 0.5;
        const cr = (y * dpr - originY) / cellPx - 0.5;
        for (let r = Math.max(0, Math.floor(cr - reach)); r <= Math.min(rows - 1, Math.ceil(cr + reach)); r++)
          for (let c = Math.max(0, Math.floor(cc - reach)); c <= Math.min(cols - 1, Math.ceil(cc + reach)); c++) {
            const i = r * cols + c;
            heights[i] = Math.min(1.2, heights[i] + strength * Math.exp(-((c - cc) ** 2 + (r - cr) ** 2) / (2 * sigma * sigma)));
          }
        chargesActive = true;
      };

      const step = () => {
        let peak = 0;
        for (let r = 0; r < rows; r++) {
          const up = (r === 0 ? r : r - 1) * cols;
          const down = (r === rows - 1 ? r : r + 1) * cols;
          const base = r * cols;
          for (let c = 0; c < cols; c++) {
            const i = base + c;
            const hgt = heights[i];
            const lap = heights[base + (c === 0 ? c : c - 1)] + heights[base + (c === cols - 1 ? c : c + 1)] + heights[up + c] + heights[down + c] - 4 * hgt;
            const next = (hgt + (hgt - previous[i]) * WAVE_FRICTION + WAVE_SPEED * lap) * WAVE_DECAY;
            previous[i] = next;
            const charge = Math.min(1, Math.max(0, next));
            charges[i] = charge;
            if (charge > peak) peak = charge;
          }
        }
        [heights, previous] = [previous, heights];
        return peak;
      };

      const animating = () => visible && !document.hidden && !reduceMotion.matches && !isPaused() && o.speed > 0;

      const render = (now: number) => {
        frameId = 0;
        if (disposed) return;
        const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
        last = now;
        const moving = animating();
        if (moving) time += dt * TIME_RATE * o.speed;
        let rippling = false;
        if (chargesActive && visible && !document.hidden) {
          backlog = Math.min(backlog + dt, SIMULATION_STEP * 4);
          let peak = 1;
          while (backlog >= SIMULATION_STEP) (backlog -= SIMULATION_STEP), (peak = step());
          if (peak < SETTLED_THRESHOLD) heights.fill(0), previous.fill(0), charges.fill(0), (chargesActive = false);
          device!.queue.writeBuffer(chargeBuffer, 0, charges);
          rippling = chargesActive;
        }
        const intro = introProgress < INTRO_END;
        if (intro) introProgress = Math.min(INTRO_END, ((now - introStart) / 1000 / o.introDuration) * INTRO_END);
        set(0, [width, height, 1 / width, 1 / height]);
        set(1, [0, originY, rows, introProgress]);
        set(2, [cellPx, o.dotSize, 0, cols]);
        set(3, [NOISE_CELLS * cellPx * o.scale, 0.5 - (o.brightness - 0.5) * 0.4, 2.8 * o.contrast, time]);
        set(4, [0, 0, 0, o.fade]);
        device!.queue.writeBuffer(uniformBuffer, 0, uniform);
        const encoder = device!.createCommandEncoder();
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 1, g: 1, b: 1, a: 1 } }] });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
        device!.queue.submit([encoder.finish()]);
        canvas.classList.add('ready');
        if (moving || rippling || intro) frameId = requestAnimationFrame(render);
        else last = 0;
      };
      wake = () => {
        if (!disposed && !frameId) frameId = requestAnimationFrame(render);
      };

      const onPointer = (e: PointerEvent) => {
        bounds ??= host.getBoundingClientRect();
        const x = e.clientX - bounds.left;
        const y = e.clientY - bounds.top;
        const inside = x >= 0 && y >= 0 && x <= bounds.width && y <= bounds.height;
        const now = performance.now();
        if (inside) {
          const elapsed = pointer.inside ? Math.max(8, now - pointer.at) : 16;
          const speed = pointer.inside ? (Math.hypot(x - pointer.x, y - pointer.y) / elapsed) * 1000 : 0;
          splash(x, y, Math.min(1, 0.22 + speed * 0.0006) * o.splashStrength);
          wake();
        }
        Object.assign(pointer, { x, y, at: now, inside });
      };
      const invalidate = () => (bounds = null);
      const onVisibility = () => wake();
      const ro = new ResizeObserver(resize);
      ro.observe(host);
      const io = new IntersectionObserver((entries) => ((visible = entries.some((en) => en.isIntersecting)), wake()));
      io.observe(host);
      addEventListener('pointermove', onPointer, { passive: true });
      addEventListener('scroll', invalidate, { capture: true, passive: true });
      document.addEventListener('visibilitychange', onVisibility);
      reduceMotion.addEventListener('change', onVisibility);
      cleanups.push(
        () => ro.disconnect(),
        () => io.disconnect(),
        () => removeEventListener('pointermove', onPointer),
        () => removeEventListener('scroll', invalidate, { capture: true }),
        () => document.removeEventListener('visibilitychange', onVisibility),
        () => reduceMotion.removeEventListener('change', onVisibility),
      );
      introStart = performance.now();
      resize();
    } catch {
      stop(); // no WebGPU here: the plain background stays
    }
  })();

  return { wake: () => wake(), destroy: stop };
}
