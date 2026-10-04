#!/usr/bin/env node
// Builds ./dist for Cloudflare Pages: static files from public/ plus the server (src/) bundled into one file, dist/_worker.js (advanced mode).
import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
cpSync(join(root, 'public'), dist, { recursive: true });
await build({
  entryPoints: [join(root, 'src/worker.js')],
  outfile: join(dist, '_worker.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: false,
});

// Only these paths run the server; everything else is served as a static file straight from the CDN.
writeFileSync(
  join(dist, '_routes.json'),
  JSON.stringify({ version: 1, include: ['/', '/index.html', '/api/*', '/img/*'], exclude: [] }, null, 2),
);
console.log('dist/ ready');
