#!/usr/bin/env node
/**
 * Produce the internal deployment package:
 *
 *   release/localcompress-<version>-<build>/
 *     site/                 static files to publish (from dist/)
 *     deploy/nginx.conf     server block with all security headers
 *     deploy/web.config     IIS configuration with the same headers
 *     sbom/                 CycloneDX SBOM + license inventory
 *     SHA256SUMS            checksums of every file in the package
 *
 * Headers are generated from src/security/csp.ts, the same
 * source the application and the preview server use, so they cannot drift.
 * Requires Node ≥ 22.18 (native TypeScript type stripping).
 */
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { HEADERS } from '../src/security/csp.ts';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
const manifest = JSON.parse(readFileSync(join(dist, 'asset-manifest.json'), 'utf8'));
const name = `localcompress-${manifest.version}-${manifest.build}`;
const out = join(root, 'release', name);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'deploy'), { recursive: true });

cpSync(dist, join(out, 'site'), { recursive: true });
execFileSync(process.execPath, [join(root, 'scripts/sbom.mjs'), join(out, 'sbom')], { stdio: 'inherit' });

const headers = HEADERS;

// ── nginx (unprivileged container: port 8080, TLS terminated by the platform) ──
// In nginx, an add_header inside a location replaces the inherited ones, and
// limit_except is only valid inside a location: so every location carries
// the method restriction and the full set of headers.
const location = (match, ...extra) =>
  [
    `    location ${match} {`,
    '        limit_except GET { deny all; }   # GET implies HEAD; no other method reaches the files',
    ...extra.map((l) => `        ${l}`),
    ...Object.entries(headers).map(([k, v]) => `        add_header ${k} "${v}" always;`),
    '    }',
  ].join('\n');
writeFileSync(
  join(out, 'deploy/nginx.conf'),
  `# LocalCompress ${manifest.version} (build ${manifest.build}): static site, no server-side processing.
# For the nginx-unprivileged image: copy to /etc/nginx/conf.d/default.conf.
# The server only delivers application files. It never receives user files:
# only GET/HEAD are allowed and request bodies are refused.
server {
    listen 8080;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;
    server_tokens off;
    client_max_body_size 1k;   # note: 0 would mean "unlimited" in nginx

${location('= /sw.js', 'add_header Cache-Control "no-cache" always;')}

${location('~ \\.wasm$', 'types { } default_type application/wasm;', 'add_header Cache-Control "public, max-age=31536000, immutable" always;')}

${location('~ \\.webmanifest$', 'types { } default_type application/manifest+json;')}

${location('/assets/', 'add_header Cache-Control "public, max-age=31536000, immutable" always;')}

${location('/', 'try_files $uri $uri/ =404;')}
}
`,
);

// ── Container image (OpenShift / Kubernetes, runs without root) ───────────
writeFileSync(
  join(out, 'deploy/Dockerfile'),
  `# Build from the release folder: docker build -f deploy/Dockerfile .
# BASE_IMAGE: point it at your internal registry proxy in CI if the build
# machines have no Internet access.
ARG BASE_IMAGE=nginxinc/nginx-unprivileged:stable-alpine
FROM \${BASE_IMAGE}
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/html/
EXPOSE 8080
`,
);

// ── IIS ─────────────────────────────────────────────────────────────────
const xmlEsc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
writeFileSync(
  join(out, 'deploy/web.config'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!-- LocalCompress ${manifest.version} (build ${manifest.build}), copy next to index.html. -->
<configuration>
  <system.webServer>
    <staticContent>
      <remove fileExtension=".wasm" />
      <mimeMap fileExtension=".wasm" mimeType="application/wasm" />
      <remove fileExtension=".webmanifest" />
      <mimeMap fileExtension=".webmanifest" mimeType="application/manifest+json" />
      <remove fileExtension=".woff2" />
      <mimeMap fileExtension=".woff2" mimeType="font/woff2" />
    </staticContent>
    <httpProtocol>
      <customHeaders>
        <remove name="X-Powered-By" />
${Object.entries(headers)
  .map(([k, v]) => `        <add name="${k}" value="${xmlEsc(v)}" />`)
  .join('\n')}
      </customHeaders>
    </httpProtocol>
    <security>
      <requestFiltering>
        <verbs allowUnlisted="false">
          <add verb="GET" allowed="true" />
          <add verb="HEAD" allowed="true" />
        </verbs>
        <requestLimits maxAllowedContentLength="0" />
      </requestFiltering>
    </security>
  </system.webServer>
  <location path="sw.js">
    <system.webServer>
      <staticContent><clientCache cacheControlMode="DisableCache" /></staticContent>
    </system.webServer>
  </location>
</configuration>
`,
);

// ── Checksums ───────────────────────────────────────────────────────────
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const sums = walk(out)
  .map((f) => `${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${relative(out, f).split(sep).join('/')}`)
  .sort((a, b) => a.slice(66).localeCompare(b.slice(66)));
writeFileSync(join(out, 'SHA256SUMS'), sums.join('\n') + '\n');

console.log(`\n✓ Deployment package: ${relative(root, out)} (${sums.length} files)`);
