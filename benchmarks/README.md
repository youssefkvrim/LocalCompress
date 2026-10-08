# Benchmarks

Targets are to be set from measurements on the **reference Safran workstation** (Windows, managed Edge/Chrome), with representative documents. The numbers below are a first baseline on a development machine; they are not targets.

## Method

1. `node scripts/make-fixtures.mjs [--large]` → synthetic fixtures in `tests/fixtures/` (never commit real documents).
2. Serve the production build (`npm run build && npm run preview`, or the deployed site).
3. For each file: drop it, wait for *Validated*, open *Details* → **Pipeline timing** gives per-stage durations; the Privacy panel gives network activity.
4. Measure externally: Task Manager / `perfmon` (CPU %, GPU video-encode engine %, browser process private bytes, peak working set), and UI responsiveness (DevTools Performance → long tasks on the main thread).
5. Record: browser version, CPU, GPU, RAM, disk, power plan.

Metrics to record per file: input size, output size, ratio, total time, time per stage, peak RAM (browser processes), CPU %, GPU %, main-thread long tasks (> 50 ms), WASM init time (first job vs second job), startup time (cold / SW-cached).

## Baseline — 2026-10-08 (macOS dev machine, Apple Silicon, Chromium-based embedded browser, Balanced preset)

| File | Input | Output | Reduction | Total | Notable stages |
|---|---|---|---|---|---|
| JPEG 4000×3000 (q≈98) | 9.9 MB | 841 KB | −91.5 % | 1.5–9 s | encode 1.2 s / 7.8 s in two runs (see note) |
| PNG 1920×1080 screenshot | 215 KB | 200 KB | −7.3 % | < 1 s | lossless |
| PNG 1600×1200 photographic | 3.9 MB | 3.4 MB | −12.3 % | 5.2 s | encode 5.0 s, lossless |
| PDF 4 pages, 2 large images | 14.9 MB | 405 KB | −97.3 % | 5.8 s | encode 5.6 s |
| PPTX with 2 photos | 13.7 MB | 3.7 MB | −73.3 % | ~10 s | encode 9.8 s (OxiPNG) |
| XLSM with macro + photo | 9.9 MB | 284 KB | −97.1 % | ~4 s | VBA verbatim |
| MP4 1080p30 20 s @ 133 Mbit/s | 335 MB | 9.7 MB | −97.1 % | ~10 s | encode 3.3 s (hardware H.264) |
| ZIP, stored logs + JPEG | 18.0 MB | 11.7 MB | −35.0 % | 1.5 s | analyse 0.4 s, encode 0.8 s |
| ZIP, already deflated | 11.7 MB | — | 0.0 % projected | < 1 s | *not worth recompressing* |
| **ZIP, stored, 1.1 GB** | 1.11 GB | 498 MB | −55.2 % | **38.6 s** | encode 30.5 s, CRC verify 3.4 s, page heap 8 MB |

Timings with "~" were read from the UI without per-stage capture. The test browser was an embedded, often hidden pane; one JPEG run was 6× slower than another, so **treat single numbers as indicative only** and re-measure on the reference workstation.

Observations:
- Main-thread heap stays ~8 MB regardless of input size; work happens in workers and OPFS.
- SHA-256 of the input was the largest single cost on the 1.1 GB file when sequential (19 s); it now runs in a parallel worker (57.7 s → 38.6 s).
- OxiPNG dominates Office/PNG timings on large noisy PNGs.
- The size of a staged output is bounded by the browser's OPFS quota (2.6 GB in the test browser).
