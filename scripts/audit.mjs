#!/usr/bin/env node
/**
 * Supply-chain gate, run after every build. Fails when:
 *  - any file of the bundle names a host that is not a reviewed identifier
 *    (XML namespaces, licence or documentation links that are never fetched);
 *  - index.html lacks the CSP or contains inline script / style;
 *  - the page's own code (main thread) contains engine code: there, a
 *    navigation could carry data out and no policy can stop it;
 *  - asset-manifest.json does not match the files.
 *
 *   node scripts/audit.mjs [dist]
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const dist = process.argv[2] ?? 'dist';

/** Hosts that appear only as strings. Each was reviewed; none is contacted. */
const REVIEWED = new Set([
  'www.w3.org', // SVG / XHTML namespaces
  'ns.adobe.com', // XMP namespace (pdf-lib)
  'purl.org', // Dublin Core namespace
  'github.com', // licence / attribution comments
  'mozilla.org', // error-message links (Mediabunny)
  'www.webmproject.org', // codec identifiers (Mediabunny)
  'aomediacodec.github.io', // AV1 spec link in a Mediabunny error message
  'www.npmjs.com', // hash-wasm licence banner
  'localhost', // Emscripten fallback when import.meta.url is undefined
]);
/** Engine signatures that must never reach the page's own code. */
const ENGINE = ['wasm_call_ctors', 'Emscripten', 'instantiateWasm', 'createSHA256'];

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const problems = [];
const hosts = new Map();

for (const f of walk(dist).filter((f) => /\.(js|css|html|json|webmanifest|svg)$/.test(f))) {
  for (const [, host] of readFileSync(f, 'utf8').matchAll(/\b(?:https?|wss?):\/\/([a-z0-9.-]+)/gi)) {
    const h = host.toLowerCase();
    hosts.set(h, (hosts.get(h) ?? new Set()).add(relative(dist, f)));
    if (!REVIEWED.has(h)) problems.push(`unreviewed host ${h} in ${relative(dist, f)}`);
  }
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
if (!html.includes('http-equiv="Content-Security-Policy"')) problems.push('index.html has no CSP');
if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html) || /\sstyle="/.test(html)) problems.push('index.html has inline script or style');

const entry = /<script type="module"[^>]*src="\.?\/?([^"]+)"/.exec(html)?.[1];
const queue = entry ? [entry] : [];
if (!entry) problems.push('no entry script in index.html');
for (const seen = new Set(); queue.length; ) {
  const f = queue.pop();
  if (seen.has(f)) continue;
  seen.add(f);
  const code = readFileSync(join(dist, f), 'utf8');
  for (const [, dep] of code.matchAll(/(?:import|from)\s*["'`]\.\/([^"'`]+\.js)["'`]/g)) queue.push(join(f, '..', dep));
  for (const sig of ENGINE) if (code.includes(sig)) problems.push(`engine code (${sig}) in page chunk ${f}`);
}

const manifest = JSON.parse(readFileSync(join(dist, 'asset-manifest.json'), 'utf8'));
for (const { path, sha256 } of manifest.files) {
  if (createHash('sha256').update(readFileSync(join(dist, path))).digest('hex') !== sha256) problems.push(`manifest mismatch: ${path}`);
}

for (const [h, files] of [...hosts].sort()) console.log(`  ${REVIEWED.has(h) ? 'ok' : '!!'}  ${h.padEnd(26)} ${[...files].slice(0, 2).join(', ')}`);
if (problems.length) {
  console.error(`\n✗ audit failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ audit: ${manifest.files.length} files, no external host, CSP present, page code first-party.`);
