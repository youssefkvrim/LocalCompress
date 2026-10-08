# LocalCompress — Architecture

> **Principle:** the file stays on the workstation. Always.
> The server delivers the application (HTML / JS / WASM / fonts). It never receives, stores, or processes a user file.

## 1. Overview

```
        SAFRAN INTRANET                                   USER WORKSTATION (Chromium)
 ┌──────────────────────────┐   GET only, app files   ┌──────────────────────────────────────────────────────────┐
 │ Static web server        │ ──────────────────────▶ │ Page (UI thread)                                         │
 │ nginx / IIS              │                         │  • CSP + Trusted Types + egress guard installed first    │
 │ • site/ (build output)   │                         │  • drag & drop / file picker → File handle (no copy)     │
 │ • security headers       │   ✗ no POST/PUT          │  • Privacy & Security panel                              │
 │ • GET/HEAD only, body=0  │   ✗ no request bodies    │           │ postMessage(File)                            │
 └──────────────────────────┘                         │           ▼                                              │
                                                      │ job.worker (one per file, terminated after)             │
                                                      │  Detect → Analyze → Strategy → Encode → Validate → Compare│
                                                      │  ├─ image   jSquash (MozJPEG, OxiPNG, libwebp, libavif)   │
                                                      │  ├─ video   Mediabunny → WebCodecs (HW encoders)          │
                                                      │  ├─ pdf     pdf-lib + MozJPEG + DEFLATE                   │
                                                      │  ├─ office  streaming ZIP rewrite + image engine          │
                                                      │  └─ zip     streaming ZIP/ZIP64 rewrite (fflate, native)  │
                                                      │  hash.worker (parallel SHA-256 of the original)          │
                                                      │           │ sync access handle                           │
                                                      │           ▼                                              │
                                                      │ OPFS scratch  (browser-private, on local disk, purged)   │
                                                      │           │ File System Access API / download            │
                                                      │           ▼                                              │
                                                      │ Output file chosen by the user (local disk)              │
                                                      │                                                          │
                                                      │ Service worker: offline cache + egress firewall          │
                                                      └──────────────────────────────────────────────────────────┘
```

There is **no** code path in which file bytes are passed to `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource`, WebRTC or a form. Those primitives are either blocked by policy or wrapped so that they refuse anything other than a body-less, same-origin `GET` of an application asset (see §4).

## 2. Repository layout

| Path | Role |
|---|---|
| `apps/web/` | Vite application: UI, styles, service-worker template, build plugin |
| `packages/core/` | Shared types, presets → parameters, detection by magic bytes, OPFS scratch, hashing |
| `packages/image/` | Header probing (pixel-bomb guard), decode/resize, MozJPEG/OxiPNG/WebP/AVIF encode, validation |
| `packages/video/` | Mediabunny/WebCodecs planning, conversion, stream validation |
| `packages/pdf/` | pdf-lib object rewriting: image recompression, lossless stream recompression, GC, metadata |
| `packages/office/` | OOXML repack: media optimisation, metadata scrub, relationship verification |
| `packages/archive/` | ZIP/ZIP64 reader & writer, bomb limits, per-entry best-of rewrite, CRC verification, sampling estimator |
| `packages/security/` | CSP source of truth, egress guard, Trusted Types policy, resource monitor, capability probes |
| `workers/` | `job.worker.ts` (pipeline orchestrator), `hash.worker.ts` |
| `tests/` | `integrity/` (ZIP round-trips, independent verifiers), `security/` (policy tests) |
| `scripts/` | dist audit, SBOM, packaging, fixture generation |
| `deploy/` | generated into the release package (nginx / IIS) |
| `docs/` | this documentation |
| `sbom/` | generated CycloneDX SBOM, license inventory, WASM hashes |
| `wasm/` | reserved for in-house WASM builds (see MAINTENANCE.md) |

## 3. Processing pipeline

Every engine follows the same contract (`EngineContext` → `EngineOutput`):

1. **Detect** — magic bytes, never the extension (`sniff`), refined for ZIP → OOXML by reading the central directory. A mismatched extension is shown to the user.
2. **Analyze** — header-only inspection where possible (image dimensions, ZIP central directory, video packet statistics).
3. **Strategy** — preset → concrete parameters (`packages/core/src/params.ts`), a human-readable plan and, where predictable, a size **estimate** (video: bitrate × duration; ZIP: sampled recompression; images: centre-crop encode).
4. **Encode (candidate)** — output is written to OPFS scratch, never kept whole in RAM for large files.
5. **Validate** — the output is re-opened *from scratch* with an independent code path (decode the image, reopen the MP4 and decode frames, reparse the PDF, reread the ZIP and verify every CRC-32, resolve every OOXML relationship). **A single failed check discards the output.**
6. **Compare** — results that save < 1 % (ZIP: < 2 % projected) are reported as *not worth it* and no file is offered.

The original file is opened read-only through the `File` object; it is **never modified**. The user chooses where the result is saved.

### Large files

| Concern | Mechanism |
|---|---|
| Input never copied | `File` / `Blob.slice()` read in ranges; Mediabunny `BlobSource` reads lazily |
| Output never in RAM | OPFS `FileSystemSyncAccessHandle` positional writes (ZIP, Office, video) |
| Large ZIP entries | streaming inflate/deflate; staging spills to OPFS above 64 MB |
| UI responsiveness | all processing in dedicated workers; main thread only receives progress events |
| Memory release | the job worker is terminated after every file (WASM heaps freed) |
| Checksums | streaming SHA-256 (hash-wasm) in a separate worker, in parallel |

Known bounded-memory exceptions: PDF (pdf-lib parses the whole document; capped at 1.5 GB) and individual images (decoded to RGBA; capped at 120 MP).

## 4. Security architecture (defence in depth)

| Layer | Control | Where |
|---|---|---|
| 1. Server | Static files only; `GET`/`HEAD` only; request body size 0 | `deploy/nginx.conf`, `deploy/web.config` |
| 2. CSP | `default-src 'none'`; `connect-src 'self'`; no remote origin anywhere; `form-action 'none'`; `frame-ancestors 'none'`; `'wasm-unsafe-eval'` but never `'unsafe-eval'`/`'unsafe-inline'` | `packages/security/src/csp.ts` (single source) |
| 3. Trusted Types | `require-trusted-types-for 'script'`; default policy rejects all HTML/script creation; script URLs same-origin http(s) only — no `blob:`/`data:` workers (`worker-src 'self'`). UI is built without `innerHTML`. | `trusted-types.ts`, `apps/web/src/ui/dom.ts` |
| 4. Egress guard | In page **and every worker**: `fetch`/XHR only for same-origin `GET` of asset paths, no body, no query string; `WebSocket`, `EventSource`, `WebTransport`, `RTCPeerConnection`, `sendBeacon` disabled; primitives frozen | `guard.ts` |
| 5. Service worker | Answers every non-GET, cross-origin, query-string or non-manifest request with a local 403 — it never reaches the network. Assets are integrity-checked (SHA-256 manifest) before caching. | `apps/web/sw-template.js` |
| 6. Isolation | COOP/COEP/CORP same-origin; Permissions-Policy denies devices | headers |
| 7. Supply chain | 18 pinned runtime packages; `ignore-scripts`; dist audit fails the build on any unreviewed host | `.npmrc`, `scripts/audit-dist.mjs`, `sbom/` |
| 8. Input safety | magic-byte detection; pixel-bomb limit; ZIP bomb limits (declared-size, ratio, total, entry count); unsafe paths refused (Office) / never extracted (ZIP); encrypted & signed documents left untouched | engines |
| 9. Data hygiene | OPFS scratch is per tab (Web Lock); orphaned sessions purged at start, own session on exit; settings (validated) are the only thing persisted | `opfs.ts`, `store.ts` |
| 10. Page purity | No third-party engine code on the main thread (where navigation could exfiltrate); enforced by the build audit | `scripts/audit-dist.mjs` |

The guard and service worker are *redundant* with the CSP on purpose: a misconfigured server that forgets the headers still does not let a dependency upload data, and a CSP bypass still meets the guard.

## 5. Offline

On first load the service worker downloads every file listed in `asset-manifest.json`, verifies its SHA-256, and caches it. Subsequent loads are served cache-first; with the network disconnected the application starts and processes files normally (verified: server stopped, page reloaded, PNG optimised and validated). Updates are picked up when the internal server is reachable and serves a new `sw.js` (see MAINTENANCE.md).

## 6. Browser support

Target: managed Chromium (Edge / Chrome ≥ 120) on Windows. Required: WebAssembly, Web Workers, OPFS sync access handles, OffscreenCanvas, Trusted Types. WebCodecs is required for video. The UI reports each capability in the Security panel.
