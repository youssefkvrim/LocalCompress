# Technical investigation

> Historical PoC comparison. Since v0.3 the shipped set is deliberately smaller: WebP/AVIF output, HEVC/AV1, the custom preset, the ZIP size estimator and PDF Flate→JPEG conversion were removed for simplicity; fflate is used by tests only. — engine & platform comparison (PoC)

Goal (brief §23): show that a representative multi-GB file can be processed entirely locally, with zero network transmission and acceptable workstation performance, and choose engines accordingly.

Legend: ✅ adopted · 🟡 adopted with limits · ⏸ deferred · ❌ rejected

## Platform

| Technology | Verdict | Findings |
|---|---|---|
| **Web Workers** | ✅ | One dedicated worker per file + one for hashing. Main thread heap stayed at 8 MB while a 1.1 GB archive was processed; UI fully responsive. Terminating the worker is the simplest reliable way to free WASM heaps. |
| **WebAssembly** | ✅ | All codecs are WASM. Requires CSP `'wasm-unsafe-eval'` (compilation only — JS `eval` stays forbidden). |
| **WASM SIMD** | ✅ | Used automatically by libwebp (`webp_enc_simd`). Detected and shown in the Security panel. |
| **WASM threads** | 🟡 | Require cross-origin isolation (COOP + COEP headers). With them, OxiPNG (rayon) and libavif use a thread pool — verified working under the production CSP. Without the headers, codecs fall back to single-thread automatically. |
| **OPFS** | ✅ | `FileSystemSyncAccessHandle` in workers gives positional, synchronous writes: used to stage outputs and spill large ZIP entries. **Limit: browser storage quota** (a share of free disk; 2.6 GB in the test environment) bounds the size of a staged *output*. Inputs are read directly from the user's file and do not count. |
| **File System Access API** | ✅ | `showSaveFilePicker` + `createWritable` streams the staged output to a user-chosen location without loading it into memory. Fallback: `blob:` download. Next step (to remove the quota limit for multi-GB outputs): pick the destination *before* processing and write to it directly from the worker. |
| **Service Worker / PWA** | ✅ | Offline cache with SHA-256 verified manifest + egress firewall. Verified: server stopped → app reloads and processes files. |
| **Compression Streams** | ✅ | Native `deflate-raw` (de)compression for large ZIP entries: much faster than JS, no level control. |

## Lossless — state of the art (default mode)

| Technique | Status | Result on test set |
|---|---|---|
| **JPEG entropy re-coding** (optimal Huffman, Annex K.2; progressive with successive approximation, libjpeg script) | ✅ in-house TypeScript (`src/engines/jpeg.ts`) | −2 % to −17 %; **byte-for-byte the same savings as `jpegtran -optimize -progressive`**; pixel-identical in libjpeg-turbo |
| JPEG XL lossless transcoding (−20 %, reversible) | ⏸ | Output is `.jxl`, not readable by Office/PDF/most Windows apps → not a drop-in replacement |
| **OxiPNG** + **libdeflate 12** IDAT re-compression (the `oxipng -Z` idea, faster than Zopfli) | ✅ | −8 % to −12 % on PNGs, pixel-identical |
| **libdeflate level 12** for every DEFLATE stream (ZIP entries, OOXML parts, PDF Flate, PNG) | ✅ | ~20 % smaller than zlib/fflate level 9 on text; even "already compressed" ZIPs gain ~3 % |
| Zopfli | ❌ | ~1 % better than libdeflate 12 but 10–50× slower |
| Brotli / Zstandard / LZMA inside ZIP | ❌ | Not readable by Windows Explorer / Office |
| PDF duplicate-stream merging, object streams, unreferenced-object removal | ✅ | |
| Font subsetting (PDF) | ⏸ | Needs Ghostscript (AGPL) or a dedicated engine |
| Video lossless | n/a | A video cannot be made smaller without re-encoding; the app says so |

## Images

| Engine | Verdict | Findings |
|---|---|---|
| **Squoosh codecs via jSquash** | ✅ | Squoosh itself is an app, not a library; jSquash repackages the same WASM codecs as ES modules (Apache-2.0). |
| MozJPEG (`@jsquash/jpeg`) | ✅ | 4000×3000 high-quality JPEG 9.9 MB → 841 KB at Balanced (q78, ≤ 3840 px); encode 1.2–7.8 s across runs on the dev machine. |
| OxiPNG (`@jsquash/oxipng`) | ✅ | Lossless; −7 % on a synthetic screenshot, −12 % to −23 % on photographic PNGs. Slow on large noisy images (≈ 15–20 s for 4 MP); multithreaded when isolated. |
| WebP (`@jsquash/webp`) | ✅ | Opt-in output format (SIMD build). |
| AVIF (`@jsquash/avif`) | 🟡 | Opt-in; ~3.5 MB WASM, slow encoder. Lazy-loaded only when chosen. |
| Canvas `convertToBlob` | ❌ (encode) / ✅ (decode/resize) | Browser JPEG encoder is markedly worse than MozJPEG; used only for resizing. Decoding via `createImageBitmap` (EXIF orientation applied, metadata dropped). |

## Video

| Engine | Verdict | Findings |
|---|---|---|
| **WebCodecs** | ✅ | Hardware encoders when available (`prefer-hardware`). 20 s 1080p30 H.264 at 133 Mbit/s (335 MB) → 9.7 MB at 3.7 Mbit/s: encode 3.3 s (~180 fps). |
| **Mediabunny** (MPL-2.0) | ✅ | Demux (MP4/MOV/MKV/WebM…), conversion pipeline, MP4 mux with positional `StreamTarget` → OPFS, lazy `BlobSource` input: constant memory regardless of file size. MPL-2.0 is file-level copyleft: unmodified use in a bundle is permitted. |
| H.264 | ✅ default | Universally playable on Windows. |
| H.265 / HEVC | 🟡 | Encoder availability depends on OS codec licensing (HEVC Video Extensions on Windows). Offered when `canEncodeVideo('hevc')` is true; licensing to be validated by legal. |
| AV1 | 🟡 | Best ratio; hardware encode only on recent GPUs; software fallback is slow. Opt-in. |
| **FFmpeg/WASM** | ⏸ | ~30 MB core, software-only (no hardware access), 2 GB WASM memory ceiling, GPL/LGPL build considerations. Kept as a fallback for codecs WebCodecs cannot decode (e.g. ProRes, some AVI). |

## PDF

| Engine | Verdict | Findings |
|---|---|---|
| **pdf-lib** (MIT) | 🟡 | Object-level rewriting works well: DCT image recompression + downsampling, Flate→JPEG for photographic images, lossless stream re-deflate, object streams, unreferenced-object removal, `PieceInfo`/thumbnail removal. 14.9 MB test PDF → 405 KB in 5.8 s, re-parsed and page count verified. Limit: whole document in memory (cap 1.5 GB); no font subsetting; no rendering-based validation. |
| **Ghostscript (WASM)** | ⏸ | Best-in-class PDF optimisation (font subsetting, full re-distillation) but **AGPL-3.0** (or commercial licence from Artifex) and ~15 MB WASM. Recommended path if Safran obtains a commercial licence: run as an optional engine in a worker under the same sandbox. |
| pdf.js | ⏸ | Would allow render-based visual validation (compare page rasters before/after). Planned for the validation stage. |

## Archives

| Engine | Verdict | Findings |
|---|---|---|
| **fflate** (MIT) | ✅ | Streaming DEFLATE level 9 (better ratio than native) for recompressing already-deflated entries; ~20–50 MB/s. |
| **Own ZIP/ZIP64 reader/writer** | ✅ | Needed to preserve *exactly* names (raw bytes), attributes, timestamps, extra fields, comments and order, copy encrypted entries verbatim, and stream multi-GB entries with OPFS spill. ~500 lines, unit-tested, outputs verified with Info-ZIP `unzip -t` and Python `zipfile`. |
| zip.js | ❌ | Capable but larger and re-encodes headers; less control over byte-exact preservation. |
| 7z / WASM | ⏸ | Better ratios (LZMA2) but output is no longer a ZIP that Windows opens natively; useful later as an explicit "convert to .7z" option. |

**Recompressing ZIPs** rarely helps when entries are already deflated (measured: 0.0 % projected on a typical archive → reported *not worth recompressing*). It helps a lot on *stored* archives (−35 % to −55 % on logs/CSV). The analyser samples entries first so the user gets an honest answer without waiting for a full pass.

## PoC result — multi-GB

| Input | Result | Time | Memory |
|---|---|---|---|
| 1.1 GB stored ZIP (2 × 530 MB log entries) | 498 MB (−55 %), CRC-verified, lossless | 38.6 s end-to-end incl. SHA-256 of input and output | Page heap 8 MB; worker streams in ≤ 64 MB pieces |
| 335 MB 1080p H.264 | 9.7 MB, 6/6 stream checks | ≈ 10 s | Constant (lazy reads, OPFS writes) |

A 2.2 GB run could not be completed **in the test harness** because its browser had a 2.6 GB OPFS quota and the harness had to copy the input into OPFS first (a real dropped file does not consume quota). On target workstations the quota is typically ~60 % of free disk. Recommendation recorded above (direct-to-destination writing).

Network during all runs: only same-origin `GET`s of application assets (Privacy panel), 0 uploads, 0 external hosts. **Independent packet capture by the security team is still required** (ZERO_UPLOAD_VERIFICATION.md).
