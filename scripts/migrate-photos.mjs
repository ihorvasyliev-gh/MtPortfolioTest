#!/usr/bin/env node
// One-off: copy the photos bundled in public/assets/ into R2 and write content.json that points at them.
//
//   node scripts/migrate-photos.mjs --remote     # real bucket (needs CLOUDFLARE_API_TOKEN or `wrangler login`)
//   node scripts/migrate-photos.mjs --local      # local emulated bucket used by `npm run dev`
//
// Safe to re-run: if content.json already exists in the bucket it does nothing (pass --force to overwrite).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUCKET = 'mtportfolio-photos';
const mode = process.argv.includes('--local') ? '--local' : process.argv.includes('--remote') ? '--remote' : null;
const force = process.argv.includes('--force');
if (!mode) {
  console.error('Pass --remote or --local');
  process.exit(2);
}

const wrangler = (...args) =>
  execFileSync('npx', ['wrangler', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const put = (key, file, type) =>
  wrangler('r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file, '--content-type', type, mode);

// 1. Don't clobber content Maria may already have published.
const tmp = mkdtempSync(join(tmpdir(), 'mt-migrate-'));
const probe = join(tmp, 'existing.json');
let exists = false;
try {
  wrangler('r2', 'object', 'get', `${BUCKET}/content.json`, '--file', probe, mode);
  exists = true;
} catch {
  /* not found: expected on first run */
}
if (exists && !force) {
  const rev = JSON.parse(readFileSync(probe, 'utf8')).rev;
  console.log(`content.json already exists in the bucket (rev ${rev}); nothing to do. Use --force to overwrite.`);
  process.exit(0);
}

// 2. Upload every bundled image once; key = hash of its original path, so re-runs are idempotent.
const content = JSON.parse(readFileSync(join(root, 'src/default-content.json'), 'utf8'));
const uploaded = new Map();
const migrate = (path, variant) => {
  if (!path.startsWith('/assets/')) return path;
  const id = createHash('sha1').update(path).digest('hex').slice(0, 12);
  const key = `photos/${id}-${variant}.jpg`;
  if (!uploaded.has(key)) {
    process.stdout.write(`  ${path} -> ${key}\n`);
    put(key, join(root, 'public', path), 'image/jpeg');
    uploaded.set(key, true);
  }
  return key;
};

console.log(`Uploading to R2 bucket "${BUCKET}" (${mode.slice(2)})…`);
for (const p of content.photos) {
  p.full = migrate(p.full, 'full');
  p.thumb = migrate(p.thumb, 'thumb');
}
content.hero.image.full = migrate(content.hero.image.full, 'full');
content.about.image.full = migrate(content.about.image.full, 'full');
content.rev = 1;

// 3. Write content.json last, so the site never points at files that aren't there yet.
const out = join(tmp, 'content.json');
writeFileSync(out, JSON.stringify(content));
put('content.json', out, 'application/json');
console.log(`Done: ${uploaded.size} files uploaded, content.json written.`);
