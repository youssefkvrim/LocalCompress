# LocalCompress — Threat Model

> See also [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for the code audit, misuse scenarios and fixes.

Scope: LocalCompress 0.1 (browser application + static intranet server) processing C1–C3 documents on managed Windows workstations with a Chromium-based browser.

**Asset to protect:** the content and metadata of user files (and derived data: names, sizes linked to identity, checksums of C3 files).
**Security objective:** no user file content or metadata leaves the workstation; no unintended copy persists on it.

Method: STRIDE-style per threat, with the control in place, residual risk, and how it is tested. "Residual" is what remains *after* the controls — it is stated honestly, not minimised.

## Trust boundaries

```
[ Intranet web server ] ──(1) app delivery──▶ [ Browser: page ] ──postMessage──▶ [ job worker ] ──▶ [ OPFS scratch ] ──▶ [ user-chosen file ]
                                                     ▲                                  ▲
                                         (2) browser extensions            (3) third-party code (npm, WASM)
```

1. The server is trusted to deliver the reviewed build, *not* trusted with data (it never gets any).
2. Extensions and the OS are outside the application's control.
3. Third-party code runs with the page's privileges — it is contained by policy, not trusted.

## Threats and controls

| # | Threat | Control(s) | Residual risk | Verification |
|---|---|---|---|---|
| T1 | **Accidental upload** (developer error, future feature) | No code path sends data; egress guard blocks any request with a body or non-GET; SW answers non-GET with local 403; server rejects non-GET and bodies > 0; tests in `tests/security/` | Low. Requires defeating three independent layers. | Unit tests; DevTools / proxy capture (ZERO_UPLOAD_VERIFICATION.md §2–3) |
| T2 | **Malicious or compromised dependency** exfiltrating data | CSP `connect-src 'self'`, no remote origins; guard wraps & freezes network primitives *before* dependencies load, in page and workers; WebSocket/WebRTC/beacon disabled; SW firewall; only 18 runtime packages, pinned with integrity hashes; dist audit fails build on unknown hosts | Medium-low. A dependency could encode data into a *GET path* of an asset name the guard accepts (e.g. `/assets/<data>.js`): the SW rejects any path not in the build manifest, and the server logs would reveal it. Covert channels via timing remain theoretically possible. | Code review of updates; dist audit; SW manifest; capture tests with planted canary data (§5) |
| T3 | **Compromised WASM module** | WASM runs inside the same CSP/guard sandbox; it has no network API of its own; binaries hashed in `sbom/wasm-binaries.json` and in the SW manifest | Medium for *correctness* (bad output) — mitigated by validation stage; Low for exfiltration (same as T2) | Re-hash on update; rebuild from source (MAINTENANCE.md) |
| T4 | **Supply-chain compromise of the build** | Lockfile integrity, `ignore-scripts=true` (no install scripts), internal npm mirror, reproducible build inputs, `asset-manifest.json` + `SHA256SUMS` in release | Medium until builds are reproduced independently in CI | Two independent builds compare `SHA256SUMS` |
| T5 | **XSS** (e.g. crafted file name rendered in UI) | No HTML string building anywhere (DOM API + `textContent`); Trusted Types enforced with a policy that rejects HTML; CSP without `unsafe-inline` | Low | Attempted injection is rejected (verified in-browser: "HTML injection is disabled") |
| T6 | **Malicious browser extension** | Managed browser policy should restrict extensions on C3 workstations; documented requirement | **High — out of the application's control.** An extension with access to the origin can read page data. | Workstation policy audit |
| T7 | **Service-worker compromise / stale SW** | SW is generated from a template at build; it only serves files listed in its manifest after SHA-256 verification; `sw.js` served `no-cache`; scope limited to the app | Low-medium: a server compromise could push a malicious SW (same as serving malicious JS) | Release `SHA256SUMS`; server integrity monitoring |
| T8 | **Unexpected external request** (fonts, CDN, telemetry, update check) | Everything bundled; fonts self-hosted; no telemetry/analytics/crash reporter; dist audit; CSP | Low | Packet capture / DNS monitoring with network disconnected |
| T9 | **Temporary-file leakage** | Results staged only in OPFS (browser-private, origin-scoped) and purged on start, on removal, on `pagehide`; panel shows usage and a "Purge now" | Medium: a crash or power loss leaves staged files in the browser profile until next start; OPFS is not encrypted beyond the OS/disk encryption | Inspect `%LOCALAPPDATA%\…\File System\` after crash; require BitLocker |
| T10 | **Browser cache leakage** | User files never go through HTTP so they are never in the HTTP cache; Cache Storage only holds app assets | Low | Inspect Cache Storage / HTTP cache after processing |
| T11 | **Memory persistence** | One worker per file, terminated after use (WASM heaps released); blob URLs revoked | Low-medium: freed memory is not zeroed; may reach the OS pagefile/hibernation file | OS hardening (pagefile/hiberfil policies) |
| T12 | **Malicious input files** (parser exploits) | Parsing happens in WASM / JS inside workers (memory-safe JS, WASM sandbox); native decoders only via the browser (image decode, WebCodecs) which are sandboxed renderer processes | Medium: browser decoder 0-days exist; keep browser patched | Fuzz corpus (§tests/security, TODO), malformed fixtures |
| T13 | **Decompression bombs** | ZIP: declared-size check while streaming, ratio limit (1000:1 above 64 MB), 64 GB total budget, 500 k entries, 256 MB central directory; images: 120 MP limit checked from header before decode; PDF: 1.5 GB limit | Low | `tests/integrity/zip.test.ts` bomb test |
| T14 | **Malformed PDFs** | pdf-lib parse in worker; failures → refused, original untouched; encrypted and signed PDFs refused; output re-parsed | Medium for quality (rare rendering differences) | Validation stage; visual QA corpus |
| T15 | **Malicious Office documents** | Macros never executed (we never interpret VBA); macro formats disabled by default; VBA, ActiveX, embeddings, signatures, customUI copied byte-for-byte; unsafe part paths → refused; signed packages → lossless only | Low | Fixture `macro.xlsm` verifies VBA untouched |
| T16 | **Malicious archives** (zip-slip, path traversal) | Archives are **never extracted** to the file system — entries are streamed and rewritten byte-name-for-byte-name; unsafe paths reported | Low | Unit tests |
| T17 | **Resource exhaustion / DoS** | Sequential queue; per-job worker; limits above; cancel button; quota errors mapped to clear message | Low (local DoS only affects the user's own tab) | Benchmarks |
| T18 | **Metadata leakage in outputs** | Metadata removal on by default (EXIF/GPS via re-encode; PDF Info/XMP; OOXML author fields; MP4 tags incl. location) | Medium: not all metadata classes are covered (e.g. PDF annotations' authors, OOXML comments authors, custom XML) | Inspect outputs with exiftool/qpdf |
| T19 | **Misleading security claims** | UI states only what it can observe ("requests observed by this page"); panel points to independent verification | — | Review of UI copy |
| T20 | **Server-side logging of file data** | Server never receives files; access logs contain only static asset URLs | Low | Review server logs during capture tests |

## Assumptions

- Workstations are managed: OS patched, disk encrypted (BitLocker), extensions restricted by policy, browser auto-updated through internal channels.
- The intranet server is administered under Safran's standard hardening and change management.
- Users are authorised to hold the documents they process.

## Out of scope

Compromised workstation / OS, malicious administrators, physical attacks, screen capture, side-channels across browser processes.

## Open items before C3 approval

1. Independent zero-upload verification by the security team (ZERO_UPLOAD_VERIFICATION.md).
2. Browser extension policy confirmed on target workstations (T6).
3. Fuzzing of the ZIP reader and PDF path with a malformed-input corpus (T12/T14).
4. Reproducible build verified on a second build machine (T4).
5. Decision on macro-enabled formats (T15).
