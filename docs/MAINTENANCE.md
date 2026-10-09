# Maintenance, update and recovery

## 1. Dependency policy

- Every runtime dependency is pinned to an exact version (`.npmrc save-exact`) and locked by integrity hash (`package-lock.json`).
- `ignore-scripts=true`: no package can execute code at install time.
- Installs come from the **internal npm mirror** only (set `registry=` in `.npmrc` on build hosts).
- A new runtime dependency requires a security review: purpose, license, size, network behaviour, maintainers, and an update to the dist-audit allowlist only if a *string* URL must be accepted (never a fetched one).

Current runtime set (18 packages): see `sbom/LICENSES.md`.

## 2. Routine update (monthly, or on CVE)

```bash
npm outdated
npm audit --omit=dev
# update one package at a time:
npm i -E <pkg>@<version> -w <workspace>
npm run typecheck && npm test
npm run build                 # dist audit must pass
npm run fixtures            # then a manual check of each format in the browser
npm run package
```

Review checklist for each update: changelog; diff of the published package (`npm diff`); new network-capable code (`fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, `new Worker`); changed WASM hashes (`sbom/wasm-binaries.json`); license change.

## 3. Rebuilding WASM from source

The jSquash packages ship prebuilt WASM from the Squoosh codec sources (Emscripten / wasm-bindgen). To remove trust in prebuilt binaries:

1. Check out `jamsinclair/jSquash` at the tag matching the pinned version, and the referenced codec submodules (mozjpeg, libwebp, libavif, oxipng).
2. Build with the pinned Emscripten / Rust toolchain in an isolated container (Dockerfiles live in each `codec/` directory upstream).
3. Compare SHA-256 against `sbom/wasm-binaries.json`. If they differ (toolchain non-determinism), place the in-house builds under `wasm/image-codecs/` and alias them in `vite.config.ts`.

Mediabunny and pdf-lib are JavaScript; libdeflate and hash-wasm embed small WASM modules built from their own sources (hash-wasm embeds small WASM blobs built from its own repository's C sources).

## 4. Releasing an update to users

1. **Bump `version` in `package.json`** (e.g. 0.3.0 → 0.3.1), then build and publish the new `site/` (atomic directory swap recommended).
2. Browsers fetch `sw.js` (no-cache) on the next visit, and open tabs check every hour. The new version installs **in the background**, every asset hash verified, and then **waits**: it never takes over a tab on its own, so a file being processed is never interrupted.
3. If the waiting version is **newer** than the one in the tab, a banner offers *Mettre à jour / Update* (disabled while files are being processed). Clicking it switches over and reloads the tab. Other open tabs reload by themselves if they are empty, otherwise they show *Reload this page* and accept no new file until then.
4. Without a click, the new version takes over once every LocalCompress tab has been closed.
5. Old caches (`localcompress-*` only) are deleted when the new version takes over.
6. A user who never reconnects keeps the last good version, offline operation is never broken by an update.

A build with the **same or a lower version** (a rebuild, a rollback) shows no banner: it applies silently once every tab is closed. Forgetting to bump the version therefore only delays an update, it never breaks one.

There is no automatic update over the Internet and no update check to any external host.

## 5. Rollback

Republish the previous release directory (kept for at least two versions). Because the SW cache name is the build id, browsers treat the rollback as a new version: it installs on the next visit and takes over once every tab is closed (a lower version shows no banner).

**Urgent rollback** (a defective release users must leave now): rebuild the previous good code with a **higher** version number (e.g. 0.3.0 code released as 0.3.2). The banner then offers it in every open tab.

## 6. Disaster recovery

| Scenario | Impact | Recovery |
|---|---|---|
| Intranet server down | **None for users who already loaded the app** (service worker). New users cannot load it. | Restore static files from the release archive to any web server with the documented headers. RTO = time to copy a directory. |
| Server compromised | Risk of a malicious build being served (T7) | Take offline; redeploy a verified release (`SHA256SUMS`); notify users to reload; investigate logs. Consider pinning: publish the expected `asset-manifest.json` hash on a separate channel. |
| Build host / repository lost | No user impact | Rebuild from source control + internal mirror; verify output against archived `SHA256SUMS`. |
| Corrupted or altered browser cache on a workstation | None online: every cached file is re-checked against its hash each time it is served; a bad copy is discarded and fetched again. Offline, the app fails closed (that file is not served). | Reload online. If it persists, clear site data for the origin (Edge: `edge://settings/siteData`). |
| A defect producing bad outputs | Outputs are validated before being offered; originals are never modified | Roll back; affected users re-run on the original files. |

No user data needs backing up: the server holds none.

## 7. Periodic revalidation (quarterly)

- Re-run the zero-upload verification (docs/ZERO_UPLOAD_VERIFICATION.md) on the current workstation image and browser version.
- Re-generate the SBOM and compare with the previous one.
- Re-run benchmarks on the reference workstation (benchmarks/README.md).
