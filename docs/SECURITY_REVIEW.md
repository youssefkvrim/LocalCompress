# Security review — code audit, misuse and weaknesses

Scope: the whole repository at this commit (UI, workers, engines, service worker, build, deployment configs).
Method: manual code review of every package, adversarial tests in a production build (strict headers), unit tests.
Status legend: **Fixed** (in this commit) · **Mitigated** (reduced, residual risk documented) · **Open** (requires a decision or work outside the code).

## 1. Summary

| # | Severity | Finding | Status |
|---|---|---|---|
| S1 | **High** | Metadata stripping removed **sensitivity labels** (Purview/AIP `MSIP_Label_*`, classification XMP) from PDFs → a C3 document could come out unlabelled and slip past DLP | **Fixed** |
| S2 | **High** | Scratch storage shared by all tabs: opening or closing one tab **deleted another tab's results**; startup purge raced with a new job | **Fixed** |
| S3 | **Medium** | PDF: lossless images with PNG predictors trusted `/Colors` and `/Columns` from the file; a mismatch would re-encode **garbage pixels** that still pass decode checks | **Fixed** — the Flate→JPEG conversion was later removed entirely (v0.3) |
| S4 | **Medium** | PDF signature detection required `/Type /Sig`, which is optional → some **signed PDFs would be modified** and their signature broken | **Fixed** |
| S5 | **Medium** | Egress guard could be bypassed by spawning a worker from a `blob:` URL (fresh globals, no guard) | **Fixed** |
| S6 | **Medium** | Emscripten glue of a compression engine was bundled into the **page** (main thread), where navigation-based exfiltration cannot be blocked | **Fixed** |
| S7 | Medium | Lossless mode would have deleted PDF `PieceInfo` (Illustrator re-editing data) — content loss presented as lossless | **Fixed** |
| S8 | Medium | ZIP bomb budget fixed at 64 GB regardless of input → a small archive could burn CPU/disk for a long time | **Fixed** |
| S9 | Low | Settings read from `localStorage` / `postMessage` were not validated (unknown preset crashed the engine) | **Fixed** |
| S10 | Low | `.rels` parts read fully into memory during OOXML verification | **Fixed** (16 MB cap) |
| S11 | Low | No DNS-prefetch control | **Fixed** |
| S12 | Low | Missing security headers (misconfigured server) went unnoticed | **Fixed** (UI warning when not cross-origin isolated in production) |
| S13 | **High** | **Malicious browser extensions** can read everything the page sees | **Open** — workstation policy |
| S14 | Medium | **Top-level navigation** (`location = 'https://x/?data'`) cannot be blocked by CSP | **Mitigated** — no third-party code on the main thread (S6), enforced by the build audit |
| S15 | Medium | Data could be smuggled into the *path* of a same-origin `GET` (`/assets/<data>.js`) if the service worker is not yet installed | **Mitigated** — SW rejects non-manifest paths; server should 404 unknown paths without logging them |
| S16 | Medium | Staged outputs survive a browser crash until the next start (OPFS, inside the profile) | **Mitigated** — purge of orphaned sessions at start; disk encryption required |
| S17 | Medium | **Phishing look-alike**: an external copy of LocalCompress that *does* upload; users trust the "processed locally" message | **Open** — publish the official URL; browser policy; train users |
| S18 | Low | Browser decoders (images, WebCodecs) parse untrusted files | **Mitigated** — sandboxed renderer; keep the browser patched |
| S19 | Low | Metadata removal is not exhaustive (PDF annotation authors, OOXML comment authors, custom XML) | **Open** — documented; extend if a "sanitise" requirement exists |
| S20 | Info | Freed memory is not zeroed; may reach pagefile / hibernation file | **Open** — OS policy |

## 2. Details of fixed findings

**S1 — Sensitivity labels.** Microsoft Purview labels live in PDF `/Info` keys (`MSIP_Label_<guid>_*`) and XMP; OOXML labels live in `docProps/custom.xml` and `docMetadata/LabelInfo.xml`. The PDF engine now keeps any `/Info` key matching `MSIP_Label|Classification|Sensitivity|Confidentiality`, and keeps the XMP packet when it mentions a label. The OOXML engine never touched `custom.xml` / `LabelInfo.xml` (verified). *Why it matters:* a "compression" tool that silently declassifies documents is a DLP bypass.

**S2 — Cross-tab scratch.** Each tab now owns `OPFS/localcompress-scratch/<session>/`, kept alive by a Web Lock. At start a tab removes only sessions whose lock is not held (closed or crashed tabs). On `pagehide` a tab removes only its own session (and not when entering the back/forward cache).

**S3 — Predictor parameters.** Images are only decoded when `/Columns == /Width`, `/Colors == components`, `BitsPerComponent == 8` and the decoded length is exactly `w × h × n`; otherwise the stream is left untouched.

**S4 — Signatures.** A PDF is treated as signed if any dictionary has `/ByteRange` + `/Contents`, or `/Type /Sig|/DocTimeStamp`, or `AcroForm /SigFlags` bit 1. Signed PDFs are refused (the original stays as is).

**S5 — Blob workers.** `worker-src` / `child-src` are now `'self'` only, and the Trusted Types policy accepts script URLs from this origin over http(s) only. Verified in production: OxiPNG's and libavif's thread pools still work (they load same-origin files). Mediabunny's alpha-channel helpers (blob workers) are never used: alpha is discarded explicitly.

**S6 — Page purity.** Heavy modules moved to sub-paths (`@localcompress/core/deflate`, `/hash`); the build audit now fails if the page's entry chunk (or its static imports) contains engine code (`wasm_call_ctors`, `Emscripten`, `instantiateWasm`, hash-wasm). Verified to trigger.

**S8 — Bomb budget.** Total decompressed bytes per archive = `min(64 GB, max(2 GB, 200 × archive size))`, plus the existing declared-size, ratio (> 1000:1 above 64 MB) and entry-count limits.

## 3. Ways the tool could be misused

| Scenario | Assessment |
|---|---|
| Removing author/metadata to hide a document's origin | Possible by design (privacy). Labels are now kept (S1). If needed, add a policy switch to *forbid* metadata removal on classified documents. |
| Converting images to other formats to evade image-fingerprinting DLP | Not possible since v0.3: formats are never changed. |
| Shrinking files to exfiltrate them through size-limited channels (mail, USB quotas) | Real but generic to any compressor (Windows ZIP does the same). Not a LocalCompress-specific risk. |
| Using LocalCompress as a "trusted" brand on an external copy (S17) | The biggest social-engineering risk. Mitigation: single official intranet URL, browser `URLAllowlist`/certificate, communication. |
| Lossy modes on legal/engineering documents (loss of fine detail in scans/drawings) | Default is now **Sans perte**; lossy modes are explicit. Lossy outputs carry no "sans perte" badge. |
| Processing macro documents to "launder" them | Macros are never executed nor altered; macro formats are off by default. |
| Overwriting the original via the save dialog | User action; default name differs (`.compressed.`). |

## 4. Verification evidence (this commit)

- `npm test` — 33 tests: ZIP integrity (incl. independent `unzip -t` and Python `zipfile`), ZIP64, bombs, **lossless JPEG proven pixel-identical with libjpeg-turbo `djpeg` and coefficient-identical, with savings equal to `jpegtran -optimize -progressive`**, PNG IDAT re-compression proven pixel-identical with ImageMagick, egress policy, CSP invariants, settings sanitisation.
- Production build in the browser: POST / cross-origin fetch / WebSocket / WebRTC / beacon / HTML injection blocked; app works with the server stopped; lossless and lossy pipelines verified under the strict headers.
- Build audit: no unreviewed external host; CSP present; manifest consistent; page chunk first-party only.

## 5. Recommended before C3 approval

1. Workstation policy: extension allow-list (S13), `URLAllowlist` for the official origin (S17), BitLocker (S16), pagefile/hibernation policy (S20).
2. Server: GET/HEAD only, body 0, 404 unknown paths without logging the path (S15).
3. Independent zero-upload verification (docs/ZERO_UPLOAD_VERIFICATION.md).
4. Fuzz the JPEG decoder, ZIP reader and PDF path with a malformed corpus.
