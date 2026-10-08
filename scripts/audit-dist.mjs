#!/usr/bin/env node
/**
 * Supply-chain gate run after every build.
 *
 * Scans every file of the production bundle for absolute URLs and fails if
 * any host is not on the reviewed allowlist. Allowlisted hosts are XML /
 * SVG namespaces and specification identifiers that appear as *strings*
 * (never fetched). Also checks that the CSP is present and that
 * asset-manifest.json matches the files on disk.
 *
 * Usage: node scripts/audit-dist.mjs apps/web/dist
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const dist = process.argv[2] ?? 'apps/web/dist';

/** Hosts that may appear as identifiers. Reviewed: none of them is contacted at runtime. */
const IDENTIFIER_HOSTS = new Set([
  'www.w3.org', // SVG / XHTML namespaces
  'ns.adobe.com', // XMP namespace (pdf-lib)
  'purl.org', // Dublin Core namespace
  'schemas.openxmlformats.org', // OOXML namespaces
  'schemas.microsoft.com',
  'www.apache.org', // license headers
  'github.com', // license / attribution comments in third-party code
  'mediabunny.dev', // error-message documentation links in Mediabunny (string only)
  'developer.mozilla.org', // error-message links (string only)
  'pdf-lib.js.org', // error-message documentation links (string only)
  'opensource.org',
  'mozilla.org',
  'www.mozilla.org',
  'aomedia.org', // codec identifiers
  'www.webmproject.org',
  'emscripten.org', // emscripten runtime messages
  'bugs.chromium.org',
  'bugzilla.mozilla.org',
  'crbug.com',
  'iptc.org',
  'ns.useplus.org',
  'www.color.org',
  'www.npmjs.com', // hash-wasm license banner comment
  'aomediacodec.github.io', // AV1 spec link inside a Mediabunny error message
]);

/** Always fatal, whatever the context. */
const FORBIDDEN = /(googleapis|gstatic|google-analytics|googletagmanager|doubleclick|sentry|bugsnag|datadog|newrelic|segment\.io|mixpanel|amplitude|hotjar|unpkg|jsdelivr|cdnjs|esm\.sh|skypack|cloudflare|fastly|akamai|vercel|netlify|amazonaws|azureedge|firebase)/i;

const files = (function walk(d) {
  return readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
})(dist);

const problems = [];
const seen = new Map();
for (const f of files) {
  if (!/\.(js|mjs|css|html|json|webmanifest|svg)$/.test(f)) continue;
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/\b(?:https?|wss?):\/\/([a-z0-9.-]+)/gi)) {
    const host = m[1].toLowerCase();
    const rel = relative(dist, f);
    if (!seen.has(host)) seen.set(host, new Set());
    seen.get(host).add(rel);
    if (FORBIDDEN.test(host)) problems.push(`FORBIDDEN host ${host} in ${rel}`);
    else if (!IDENTIFIER_HOSTS.has(host) && host !== 'localhost') problems.push(`Unreviewed host ${host} in ${rel}`);
  }
  if (/\bnavigator\.sendBeacon\(/.test(text) && !rel(f).includes('main')) {
    problems.push(`sendBeacon call in ${relative(dist, f)}`);
  }
}
function rel(f) {
  return relative(dist, f);
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
if (!/http-equiv="Content-Security-Policy"/.test(html)) problems.push('index.html has no CSP meta tag');
if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html)) problems.push('index.html contains an inline <script>');
if (/\sstyle="/.test(html)) problems.push('index.html contains an inline style attribute');

// The page (main thread) must run first-party code only: there, a navigation
// (location = …) could carry data out and no policy can block it. Engines and
// third-party libraries are confined to workers. Follow the entry's static imports.
const entry = /<script type="module"[^>]*src="\.?\/?([^"]+)"/.exec(html)?.[1];
if (!entry) problems.push('cannot find the entry script in index.html');
else {
  const seenChunks = new Set();
  const queue = [entry];
  while (queue.length) {
    const f = queue.pop();
    if (seenChunks.has(f)) continue;
    seenChunks.add(f);
    const code = readFileSync(join(dist, f), 'utf8');
    for (const m of code.matchAll(/(?:import|from)\s*["'`]\.\/([^"'`]+\.js)["'`]/g)) queue.push(join(f, '..', m[1]));
    // Signatures of compiled engines (Emscripten glue, hash-wasm). Engine *names* shown in the UI are plain strings and fine.
    for (const marker of ['wasm_call_ctors', 'Emscripten', 'createSHA256', 'instantiateWasm'])
      if (code.includes(marker)) problems.push(`third-party engine code (${marker}) in page chunk ${f}`);
  }
}

const manifest = JSON.parse(readFileSync(join(dist, 'asset-manifest.json'), 'utf8'));
for (const m of manifest.files) {
  const h = createHash('sha256').update(readFileSync(join(dist, m.path))).digest('hex');
  if (h !== m.sha256) problems.push(`asset-manifest mismatch: ${m.path}`);
}

console.log(`\nLocalCompress dist audit — ${files.length} files, ${manifest.files.length} in manifest`);
for (const [host, where] of [...seen].sort()) {
  console.log(`  ${IDENTIFIER_HOSTS.has(host) ? 'id  ' : '!!  '} ${host.padEnd(30)} ${[...where].slice(0, 3).join(', ')}`);
}
if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('\n✓ No external origins referenced except reviewed identifiers. CSP present. Manifest consistent.\n');
