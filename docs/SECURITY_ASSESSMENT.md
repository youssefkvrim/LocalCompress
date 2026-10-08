# Security assessment — developer self-assessment (preliminary)

> Status: **preliminary, written by the development team.** It records what has been built and checked so far. It is *not* the independent assessment required by the Definition of Done; it is the input to it.

## Summary

| Area | Status |
|---|---|
| Zero-upload architecture | Implemented in 5 independent layers (server verbs, CSP, egress guard, service-worker firewall, no code path). Developer pre-checks pass. **Independent capture pending.** |
| Offline operation | Implemented and verified (server stopped, app reloads and processes). |
| Supply chain | 18 pinned runtime packages, lockfile integrity, no install scripts, SBOM, WASM hashes, build-time audit of external hosts. **Reproducible-build comparison pending.** |
| XSS | No HTML string construction; Trusted Types enforced; CSP without inline script/style. |
| Input handling | Magic-byte detection, bomb limits, refusal of encrypted/signed/unsafe inputs, validation of every output. **Fuzzing pending.** |
| Residue | OPFS scratch purged on start/remove/exit; residual risk after crash documented. |
| Extensions | Out of application control — requires workstation policy. |

## Findings & recommendations

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| F1 | Medium | Malicious extensions can read page data (T6). | Enforce an extension allow-list on C3 workstations; block extensions on the LocalCompress origin (`ExtensionSettings` → `runtime_blocked_hosts`). |
| F2 | Medium | Staged outputs may persist in the browser profile after a crash until next start (T9). | Require disk encryption; keep the purge-on-start; consider writing directly to the user-chosen destination for large outputs. |
| F3 | Low | The egress guard accepts any `/assets/*.js` GET; data could be encoded in a path if the service worker is absent (first visit). The SW rejects non-manifest paths. | Optional: have the server reject unknown paths with 404 *without logging the path*; monitor 404 rates. |
| F4 | Low | `connect-src 'self'` is required to load WASM/workers; a server compromise could add an upload endpoint, but the guard and SW still block bodies. | Keep server verb restriction (`GET`/`HEAD` only, body 0). |
| F5 | Info | MPL-2.0 dependency (Mediabunny). | Legal review; unmodified use only. |
| F6 | Info | HEVC encoding depends on OS licences. | Legal review before enabling by default. |
| F7 | Medium | Metadata removal is not exhaustive (PDF annotation authors, OOXML comment authors, custom XML parts). | Document; extend scrubbers; offer an explicit "sanitise" mode if required. |
| F8 | Low | pdf-lib output is validated structurally, not visually. | Add pdf.js render-diff validation. |

## Test evidence

- `npm test` — 20 tests: ZIP round-trips, ZIP64, transforms, bomb rejection, detection, egress policy, CSP invariants; real fixture archives verified with Info-ZIP `unzip -t` and Python `zipfile`.
- `npm run build` — dist audit (no unreviewed hosts, CSP present, manifest consistent).
- Browser checks: see ZERO_UPLOAD_VERIFICATION.md §7.
