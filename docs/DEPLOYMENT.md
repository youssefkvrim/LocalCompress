# Deployment (internal)

LocalCompress is a **static site**. Hosting it requires no application server, no database, no runtime, and no storage for user data.

## 1. Build the package (on the build host)

```bash
npm ci                       # from the internal npm mirror, lockfile enforced, no install scripts
npm run typecheck && npm test
npm run package              # build → dist audit → SBOM → release/localcompress-<ver>-<build>/
```

The build **fails** if the bundle references any unreviewed external host, if the CSP is missing, or if `asset-manifest.json` does not match the files.

Package contents:

```
release/localcompress-<version>-<build>/
  site/                  publish this directory
    index.html  sw.js  asset-manifest.json  manifest.webmanifest  logo.svg  assets/…
  deploy/nginx.conf      server block for the nginx-unprivileged image (port 8080)
  deploy/Dockerfile      container image: nginx-unprivileged + site/ + nginx.conf
  deploy/web.config      IIS configuration (copy into site/)
  sbom/                  CycloneDX SBOM, LICENSES.md, wasm-binaries.json
  SHA256SUMS             checksum of every file in the package
```

Verify before publishing: `sha256sum -c SHA256SUMS` (Linux) or `Get-FileHash` (PowerShell) against the file.

## 2. Server requirements

| Requirement | Why |
|---|---|
| HTTPS with internal PKI | Service workers, OPFS and File System Access require a secure context |
| The response headers from `deploy/*` on **every** response (incl. `.js` and `.wasm`) | CSP & Trusted Types in workers come from the worker script's own response headers; COOP/COEP enable WASM threads |
| `application/wasm` MIME type | Streaming WASM compilation |
| `GET`/`HEAD` only, request body size 0 | The server must be *unable* to accept an upload, even by mistake |
| `sw.js` served with `Cache-Control: no-cache` | Updates are picked up promptly |
| `/assets/*` may be cached immutably | File names are content-hashed |
| Same origin for everything; no CDN, no reverse proxy injecting scripts | CSP is `'self'` only |
| Access logs: URL, status, size only | Never needed for anything else |

### IIS (Windows Server)

1. Create a site (or application) pointing to `site/`, HTTPS binding with the internal certificate.
2. Copy `deploy/web.config` into `site/`.
3. Ensure *Request Filtering* is installed (the config restricts verbs and sets `maxAllowedContentLength=0`).
4. Browse to the site: the Privacy & Security panel must show *Service worker: Active* and the capability list must show *WASM threads ✓* (proves COOP/COEP are effective).

### nginx / container platform (OpenShift, Kubernetes)

`deploy/Dockerfile` builds an image that runs without root on port 8080, from the release folder:

```bash
docker build -f deploy/Dockerfile -t localcompress .
```

If the build machines have no Internet access, pass `--build-arg BASE_IMAGE=<your internal registry proxy>/nginxinc/nginx-unprivileged:stable-alpine`. HTTPS is terminated by the platform (route / ingress). The config is `deploy/nginx.conf` (copied to `/etc/nginx/conf.d/default.conf`): every location repeats the security headers and the GET-only restriction, because nginx does not inherit `add_header` into a location that sets its own, and only accepts `limit_except` inside a location.

On a classic nginx host, include the same server block and change `listen` and `root`.

## 3. Sub-path hosting

The build uses relative URLs (`base: './'`) and the service-worker scope is its own directory, so the app can live at `https://tools.intranet/localcompress/`.

## 4. Workstation requirements

- Microsoft Edge or Google Chrome ≥ 120, managed.
- Recommended policies on C3 workstations: extension allow-list (no extensions on the LocalCompress origin), `DefaultFileSystemWriteGuardSetting` allowing the File System Access save dialog for the LocalCompress origin, browser auto-update from the internal channel.
- Disk encryption (BitLocker), OPFS scratch lives in the browser profile while a job is staged.
- Sufficient free disk: the browser grants OPFS a share of free space; the largest output that can be staged is bounded by it.

## 5. Air-gapped environments

Copy the release package by the approved transfer procedure, verify `SHA256SUMS`, publish `site/`. Nothing in the application attempts to reach any other host; first load needs only the internal server.

## 6. No authentication needed

The compression engine has no server-side component to protect. If portal SSO is required for the *delivery* of the app, put it in front of the static site; it does not affect the processing path.
