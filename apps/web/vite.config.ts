import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { cspString, securityHeaders } from '../../packages/security/src/csp';

const repo = resolve(__dirname, '../..');
const pkg = (name: string) => JSON.parse(readFileSync(resolve(repo, 'node_modules', name, 'package.json'), 'utf8')).version as string;
const rootPkg = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8'));

function buildId(): string {
  if (process.env.LC_BUILD_ID) return process.env.LC_BUILD_ID;
  try {
    return execSync('git rev-parse --short HEAD', { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    // Deterministic fallback: hash of the lockfile.
    return createHash('sha256').update(readFileSync(resolve(repo, 'package-lock.json'))).digest('hex').slice(0, 10);
  }
}

const ENGINES = {
  'JPEG · lossless': 'in-house optimal Huffman + progressive (jpegtran-equivalent)',
  'Images · MozJPEG': `@jsquash/jpeg ${pkg('@jsquash/jpeg')}`,
  'Images · OxiPNG': `@jsquash/oxipng ${pkg('@jsquash/oxipng')}`,
  'Images · WebP': `@jsquash/webp ${pkg('@jsquash/webp')}`,
  'Images · AVIF': `@jsquash/avif ${pkg('@jsquash/avif')}`,
  'Video · WebCodecs': `mediabunny ${pkg('mediabunny')}`,
  'PDF': `pdf-lib ${pkg('pdf-lib')}`,
  'DEFLATE': `libdeflate ${pkg('libdeflate')} (level 12)`,
  'ZIP / Office': `fflate ${pkg('fflate')} + native streams`,
  'Checksums': `hash-wasm ${pkg('hash-wasm')}`,
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/**
 * - Injects the CSP <meta> (production only — Vite's dev server needs inline styles).
 * - After the bundle is written, hashes every file, publishes
 *   asset-manifest.json and generates the service worker from its template.
 */
function securityPlugin(id: string): Plugin {
  let outDir = '';
  return {
    name: 'localcompress-security',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    transformIndexHtml(html) {
      return html.replace('<!--LC:CSP-->', `<meta http-equiv="Content-Security-Policy" content="${cspString(false)}" />`);
    },
    closeBundle() {
      const files = walk(outDir)
        .map((abs) => relative(outDir, abs).split(sep).join('/'))
        .filter((p) => p !== 'sw.js' && p !== 'asset-manifest.json')
        .sort();
      const manifest = files.map((p) => ({
        path: p,
        bytes: statSync(join(outDir, p)).size,
        sha256: createHash('sha256').update(readFileSync(join(outDir, p))).digest('hex'),
      }));
      writeFileSync(join(outDir, 'asset-manifest.json'), JSON.stringify({ version: rootPkg.version, build: id, files: manifest }, null, 2));
      const tpl = readFileSync(resolve(__dirname, 'sw-template.js'), 'utf8');
      const sw = tpl
        .replace("const VERSION = '__LC_VERSION__';", `const VERSION = ${JSON.stringify(id)};`)
        .replace('const MANIFEST = __LC_MANIFEST__;', `const MANIFEST = ${JSON.stringify(manifest.map(({ path, sha256 }) => ({ path, sha256 })))};`);
      if (sw.includes('= __LC_') || sw.includes("'__LC_")) throw new Error('Service worker template placeholders were not replaced');
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}

const id = buildId();

export default defineConfig({
  root: __dirname,
  base: './',
  publicDir: 'public',
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
    __BUILD_ID__: JSON.stringify(id),
    __ENGINES__: JSON.stringify(ENGINES),
  },
  plugins: [securityPlugin(id)],
  worker: { format: 'es' },
  optimizeDeps: {
    // Their WASM is located relative to the module; pre-bundling would break that.
    exclude: ['@jsquash/jpeg', '@jsquash/oxipng', '@jsquash/webp', '@jsquash/avif'],
    // Pre-bundle up front so the dev server never reloads mid-job.
    include: ['mediabunny', 'pdf-lib', 'fflate', 'hash-wasm', 'libdeflate'],
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [repo] },
    // Cross-origin isolation in dev too, so WASM threads behave like production.
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
  },
  preview: {
    port: 4173,
    strictPort: true,
    headers: securityHeaders(),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: { polyfill: false },
    sourcemap: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4096,
    reportCompressedSize: false,
  },
});
