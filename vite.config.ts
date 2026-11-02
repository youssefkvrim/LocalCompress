import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { HEADERS, cspString } from './src/security/csp';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
/** Fetched by the service worker on first use instead of at install (background removal, pdf.js CMaps). */
const LAZY = /\.(onnx|bcmap)$|\/ort-wasm[^/]*\.wasm$/i;

/**
 * The background-removal model is not in git (178 MB). It must be downloaded
 * into models/ (see README) and match this hash, or the build stops.
 * Source: https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx (Apache-2.0)
 */
const MODEL = { path: 'models/isnet-general-use.onnx', sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a' };

/**
 * Production only:
 *  - put the CSP in index.html;
 *  - after the build, hash every file into asset-manifest.json and write
 *    the service worker with that list and the version (package.json).
 */
const security: Plugin = {
  name: 'localkit-security',
  apply: 'build',
  buildStart() {
    let actual = 'missing';
    try {
      actual = sha256(readFileSync(MODEL.path));
    } catch {
      /* reported below */
    }
    if (actual !== MODEL.sha256) throw new Error(`${MODEL.path}: ${actual === 'missing' ? 'missing' : `SHA-256 ${actual}`}, expected ${MODEL.sha256} (see README)`);
  },
  transformIndexHtml: (html) => html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${cspString(false)}" />`),
  closeBundle() {
    const files = walk('dist')
      .map((f) => relative('dist', f).split(sep).join('/'))
      .filter((f) => f !== 'sw.js' && f !== 'asset-manifest.json')
      .sort()
      .map((path) => ({ path, sha256: sha256(readFileSync(join('dist', path))), ...(LAZY.test(path) ? { lazy: true } : {}) }));
    const build = sha256(Buffer.from(JSON.stringify(files))).slice(0, 12);
    writeFileSync('dist/asset-manifest.json', JSON.stringify({ version, build, files }, null, 2));
    const sw = readFileSync('src/sw.js', 'utf8').replace("const BUILD = 'dev';", `const BUILD = '${build}';`).replace("const VERSION = '0.0.0';", `const VERSION = '${version}';`).replace('const FILES = [];', `const FILES = ${JSON.stringify(files)};`);
    if (sw.includes("'dev'") || sw.includes("'0.0.0'") || sw.includes('FILES = []')) throw new Error('service worker template not filled');
    writeFileSync('dist/sw.js', sw);
  },
};

export default defineConfig({
  base: './',
  define: { __VERSION__: JSON.stringify(version) },
  plugins: [security],
  worker: { format: 'es' },
  optimizeDeps: {
    // jSquash and ONNX Runtime locate their WASM relative to the module; pre-bundling breaks that.
    exclude: ['@jsquash/jpeg', '@jsquash/oxipng', 'onnxruntime-web'],
    include: ['mediabunny', 'pdf-lib', 'hash-wasm', 'libdeflate'],
  },
  server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  preview: { headers: HEADERS },
  build: { target: 'es2022', modulePreload: { polyfill: false }, assetsInlineLimit: 0, chunkSizeWarningLimit: 4096 },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60_000 },
});
