# Architecture

> The file stays on the workstation. The server only delivers the application.

## The whole system on one page

```
intranet server ──GET only──▶ page (src/main.ts, src/ui/)
   static files                 │ postMessage(File)
                                ▼
                         worker (src/worker/job.ts)   one per file, terminated after
                           detect → engine → checks → keep if ≥ 1 % smaller → SHA-256
                                │ OPFS (local disk, private to the browser, per tab)
                                ▼
                         "Save" → file chosen by the user on the local disk

service worker (src/sw.js): offline cache + blocks every request that is not
a GET of one of the application's own files.
```

## Source layout

```
src/
  main.ts            page entry: lock down, claim scratch space, register the service worker
  sw.js              service-worker template (the build fills in the file list and hashes)
  lib/               plumbing, no policy
    types.ts         settings, job, result, messages, the only shared shapes
    detect.ts        file type from the first bytes
    zip.ts           ZIP / ZIP64 read and write, zip-bomb budget
    deflate.ts       libdeflate (compress) and browser streams (decompress)
    crc32.ts         CRC-32
    scratch.ts       OPFS scratch space and positional writer
  engines/           one file per format; each is `job → output` or throws Skip(reason)
    image.ts         JPEG / PNG (lossless always, MozJPEG on request)
    jpeg.ts          lossless JPEG re-coder (optimal Huffman + progressive)
    pdf.ts           pdf-lib object rewriting
    office.ts        PPTX / XLSX / DOCX (uses zip.ts and image.ts)
    zip.ts           lossless archive rewrite + verification
    video.ts         H.264 through WebCodecs
  security/
    csp.ts           the Content-Security-Policy and headers (single source)
    guard.ts         egress guard + Trusted Types + request observer
  worker/
    job.ts           the pipeline around an engine
    hash.ts          SHA-256 of the original, in parallel
  ui/                store.ts (state + queue), app.ts, row.ts, panel.ts, i18n.ts, dom.ts, style.css
scripts/             audit.mjs (supply-chain gate), sbom.mjs, package.mjs, fixtures.mjs
tests/               zip, images, security
```

## The engine contract

```ts
type Engine = (job: Job) => Promise<Output>;   // or throw new Skip(reason)
```

An engine reads `job.file`, writes its candidate to scratch, and records integrity checks with `job.check(label, ok)`. The worker, not the engine, decides the rest: any failed check discards the output; an output that does not save at least 1 % is dropped as *already optimal*. Adding a format means adding one file to `engines/` and one line to `pick()` in `worker/job.ts`.

## Modes

| | Lossless (default) | Balanced | Compact |
|---|---|---|---|
| JPEG | optimal Huffman + progressive | MozJPEG q78, ≤ 3840 px | MozJPEG q62, ≤ 2560 px |
| PNG | OxiPNG + libdeflate | same | same |
| PDF | lossless JPEG, re-deflate, merge, prune | + JPEG q78, ≤ 2400 px | + JPEG q62, ≤ 1600 px |
| Office images | as JPEG / PNG | ≤ 2400 px | ≤ 1600 px |
| ZIP | libdeflate 12 | same | same |
| Video | declined (not possible) | H.264, 0.06 bpp, ≤ 1080p | H.264, 0.035 bpp, ≤ 720p |

A lossy result is kept only when it is at least 10 % smaller than the lossless one.

## Security layers

| Layer | What it does | Where |
|---|---|---|
| Server | GET / HEAD only, request body 0 | `scripts/package.mjs` → nginx / IIS |
| CSP | no remote origin; connect, scripts and workers from this origin only; no eval | `security/csp.ts` |
| Trusted Types | no HTML or script from strings; no `blob:` workers | `security/guard.ts` |
| Egress guard | in page and every worker: only body-less same-origin GET of app files; WebSocket, WebRTC, beacons off | `security/guard.ts` |
| Service worker | everything else is answered locally with 403 | `sw.js` |
| Page purity | no engine code on the main thread (a navigation could carry data out), enforced by the build | `scripts/audit.mjs` |
| Scratch hygiene | per-tab, Web-Lock-guarded; orphans purged at start | `lib/scratch.ts` |

## Large files

Inputs are read in slices from the `File`; outputs are written to OPFS with positional writes; ZIP entries above 128 MB are streamed (data descriptor) instead of buffered. Limits: PDF 1.5 GB (pdf-lib loads it whole), images 120 MP, ZIP expansion `min(64 GB, max(2 GB, 200 × archive))`. The browser's storage quota bounds the size of a staged output.
