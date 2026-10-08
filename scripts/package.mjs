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

// ── nginx ───────────────────────────────────────────────────────────────
const ngHeaders = Object.entries(headers)
  .map(([k, v]) => `    add_header ${k} "${v}" always;`)
  .join('\n');
writeFileSync(
  join(out, 'deploy/nginx.conf'),
  `# LocalCompress ${manifest.version} (build ${manifest.build}), static site, no server-side processing.
# The server only delivers application files. It never receives user files:
# all non-GET methods are rejected and request bodies are limited to zero.
server {
    listen 443 ssl;
    server_name localcompress.intranet.example;   # adapt
    # ssl_certificate / ssl_certificate_key: internal PKI

    root /srv/localcompress/site;
    index index.html;
    client_max_body_size 0k;
    access_log /var/log/nginx/localcompress.access.log;   # URLs only, never bodies

    limit_except GET HEAD { deny all; }

    types {
        application/wasm wasm;
        application/manifest+json webmanifest;
    }

${ngHeaders}

    location = /sw.js {
        add_header Cache-Control "no-cache" always;
${ngHeaders.replace(/^/gm, '    ')}
    }
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
${ngHeaders.replace(/^/gm, '    ')}
    }
    location / {
        try_files $uri $uri/ =404;
    }
}
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
