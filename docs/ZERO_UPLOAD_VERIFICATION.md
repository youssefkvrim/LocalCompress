# Zero-upload verification — procedure and initial results

**Claim under test:** *A file processed by LocalCompress never leaves the workstation.*

This document has two parts: the **procedure** the security team should run independently (the reference result), and the **developer pre-checks** already performed, recorded so that discrepancies are visible. The developer pre-checks are *not* a substitute for independent verification.

## 1. Test setup

- Target: the release package (`release/localcompress-<version>-<build>/site`) deployed on a test intranet host with `deploy/nginx.conf` or `deploy/web.config`.
- Workstation: managed Windows image, Edge/Chrome (target version), extensions disabled.
- **Canary files**: create test documents containing unique random markers (e.g. 32-byte random strings, also base64/hex/URL-encoded variants) in text, metadata, and image pixels. The capture is searched for every encoding of the markers.
- Tools: browser DevTools, an intercepting proxy (Burp / mitmproxy / Fiddler), Wireshark/pcap on the workstation, DNS server logs, host firewall logs, server access logs.

## 2. Browser-level

| # | Step | Expected |
|---|---|---|
| 2.1 | DevTools → Network, *Preserve log*, disable cache off. Load app. | Only `GET` of files listed in `asset-manifest.json` |
| 2.2 | Process each canary format (JPEG, PNG, MP4, PDF, ZIP, PPTX, XLSX) | No new requests except worker/WASM asset `GET`s (from service worker cache: size "(ServiceWorker)") |
| 2.3 | Filter by method ≠ GET | Empty |
| 2.4 | Search all request URLs/headers for canary encodings | No match |
| 2.5 | Compare with the in-app Privacy & Security panel | Same list; *uploads* = 0; *external hosts* = 0 |
| 2.6 | DevTools → Application: Cache Storage, IndexedDB, Local Storage, OPFS | Cache holds app assets only; Local Storage holds settings only; OPFS empty after *Remove* / reload |

## 3. Network-level

| # | Step | Expected |
|---|---|---|
| 3.1 | Proxy all workstation traffic; process canary files | No request bodies from the workstation to any host during processing |
| 3.2 | Packet capture on the workstation NIC | No TCP payload containing canary encodings; no connections other than to the app host (initial load) |
| 3.3 | DNS monitoring | No lookups other than the app host |
| 3.4 | Server access log | Only `GET`/`HEAD` of static asset paths; no `POST`; request sizes ≈ header size |
| 3.5 | Firewall: block the app host after first load; reload; process files | App loads from service worker; processing succeeds; firewall logs show only blocked asset revalidation attempts (if any) |

## 4. Offline

| # | Step | Expected |
|---|---|---|
| 4.1 | First load online, then disable all network adapters | — |
| 4.2 | Close and reopen the browser, open the app URL | App loads |
| 4.3 | Process each format | Succeeds; outputs validated |

## 5. Adversarial

| # | Step | Expected |
|---|---|---|
| 5.1 | In DevTools console (page and worker contexts): `fetch('/x',{method:'POST',body:'canary'})` | Rejected: *POST not permitted*; no request in capture |
| 5.2 | `fetch('https://example.com')`, `new WebSocket(…)`, `navigator.sendBeacon(…)`, `new RTCPeerConnection()` | All rejected / return false |
| 5.3 | `fetch('/assets/'+canary+'.js')` | SW answers 403 locally (*not an application asset*); **no request in capture** |
| 5.4 | Serve the site **without** security headers (misconfiguration) | Guard + SW still block 5.1–5.3 |
| 5.5 | Inject a modified dependency that attempts exfiltration (security-team-built variant) | Blocked and visible in panel as *blocked attempts* |
| 5.6 | Drop a ZIP bomb, a 30 000 × 30 000 PNG, a truncated PDF, a ZIP with `../` paths | Refused with a clear message; no crash; nothing written outside OPFS |

## 6. Storage & residue

| # | Step | Expected |
|---|---|---|
| 6.1 | Process a canary file, do not save, close the tab | OPFS scratch purged (`pagehide`); on next start purged anyway |
| 6.2 | Kill the browser process mid-job; inspect profile directory `…\User Data\Default\File System\` | Staged partial output may exist until next app start → purged on start (documented residual risk T9) |
| 6.3 | Search the profile directory and `%TEMP%` for canary strings after normal use | Only in the file the user saved |

## 7. Developer pre-checks (2026-10-08, macOS dev machine, Chromium-based embedded browser, `vite preview` with production headers)

| Check | Result |
|---|---|
| CSP meta + headers present; `crossOriginIsolated === true` | ✔ |
| `fetch('/upload', {method:'POST', body})` from page | ✔ blocked — *POST not permitted* |
| `fetch('https://example.com/x')` | ✔ blocked — *cross-origin* |
| `navigator.sendBeacon`, `new WebSocket`, `new RTCPeerConnection` | ✔ blocked / returns false |
| `innerHTML` injection | ✔ rejected by Trusted Types |
| Processing under production CSP (WASM, workers, OxiPNG thread pool) | ✔ works |
| Server stopped, page reloaded, PNG processed and validated | ✔ app served by SW; 16 requests, all same-origin asset `GET`s from cache; 0 uploads; 0 external hosts |
| Dist audit (`scripts/audit-dist.mjs`) | ✔ no external host except reviewed identifier strings (namespaces, license/comment URLs) |
| Unit tests `tests/security/egress.test.ts` | ✔ |

**Not yet done:** proxy capture, pcap, DNS/firewall logging, Windows target workstation, canary search — these belong to the independent verification above.
