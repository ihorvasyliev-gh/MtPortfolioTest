import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, sanitize } from '../src/content.js';
import { renderPage, renderNotFound, renderSitemap } from '../src/render.js';

test('defaults survive sanitize unchanged', () => {
  const d = defaults();
  assert.deepEqual(sanitize(d), d);
});

test('sanitize drops photos with unsafe or foreign sources', () => {
  const d = defaults();
  d.photos.push(
    { id: 'evil1', cat: 'studio', full: 'javascript:alert(1)', thumb: '/assets/x.jpg' },
    { id: 'evil2', cat: 'studio', full: 'https://evil.example/x.jpg', thumb: '/assets/x.jpg' },
    { id: 'evil3', cat: 'studio', full: 'photos/../../secret.jpg', thumb: 'photos/aaaaaaaaaaaa-thumb.webp' },
    { id: 'good', cat: 'nope', full: 'photos/aaaaaaaaaaaa-full.webp', thumb: 'photos/aaaaaaaaaaaa-thumb.webp' },
  );
  const out = sanitize(d);
  assert.deepEqual(out.photos.slice(22).map(p => p.id), ['good']);
  assert.equal(out.photos.at(-1).cat, '', 'unknown category is cleared');
});

test('sanitize rejects bad email / instagram and falls back', () => {
  const d = defaults();
  d.site.email = 'not an email"><script>';
  d.site.instagram = 'a b<c';
  const out = sanitize(d);
  assert.equal(out.site.email, defaults().site.email);
  assert.equal(out.site.instagram, '');
});

test('sanitize tolerates garbage', () => {
  for (const x of [null, 1, 'x', [], { photos: 'no', services: {} }]) {
    assert.doesNotThrow(() => sanitize(x));
  }
});

test('render escapes user text everywhere', () => {
  const d = defaults();
  const bad = '<img src=x onerror=alert(1)>';
  d.site.name = bad; d.hero.lede = bad; d.about.heading = bad + ' *ok*';
  d.services[0].title = bad; d.contact.note = bad; d.photos[0].alt = bad;
  const html = renderPage(sanitize(d));
  assert.ok(!html.includes('<img src=x'), 'no raw injected tag');
  assert.ok(html.includes('&lt;img src=x'));
  assert.ok(html.includes('<em>ok</em>'), '*word* becomes <em>');
});

test('render serves R2 photos via /img or IMG_BASE', () => {
  const d = defaults();
  d.photos.push({ id: 'n1', cat: 'studio', group: '', alt: 'a', full: 'photos/bbbbbbbbbbbb-full.webp', thumb: 'photos/bbbbbbbbbbbb-thumb.webp', w: 600, h: 900 });
  assert.ok(renderPage(d).includes('src="/img/photos/bbbbbbbbbbbb-thumb.webp"'));
  assert.ok(renderPage(d, { imgBase: 'https://cdn.example.com' }).includes('src="https://cdn.example.com/photos/bbbbbbbbbbbb-thumb.webp"'));
});

test('render works with no photos and hides empty sections', () => {
  const d = defaults();
  Object.assign(d, { photos: [], services: [], stats: [], traits: [] });
  const html = renderPage(d);
  assert.ok(!html.includes('id="portfolio"') && !html.includes('id="work"') && !html.includes('id="stats"'));
});

test('comp card slots: keep valid picks in place, auto-fill the rest from the hero and visible photos', () => {
  const d = defaults();
  d.compcard = { photos: ['studio-02', 'nope', 'studio-02', 'portrait-03'] };
  d.photos.find(p => p.id === 'portrait-01').hidden = true;
  const out = sanitize(d).compcard.photos;
  assert.equal(out.length, 5);
  assert.equal(out[0], 'studio-02', 'explicit cover stays first');
  assert.equal(out[3], 'portrait-03', 'explicit slot keeps its position');
  assert.equal(new Set(out).size, 5, 'no duplicates');
  assert.ok(out.includes('editorial-01'), 'hero photo is used for an empty slot');
  assert.ok(!out.includes('portrait-01'), 'hidden photos are not auto-picked');
  assert.deepEqual(sanitize({ ...d, photos: [] }).compcard.photos, []);
});

test('render: split headings keep *em* and escaping; comp card data is embedded safely', () => {
  const d = defaults();
  d.about.heading = 'A <b>bold</b> *look.*';
  d.site.name = 'Mariia </script><script>alert(1)</script>';
  const html = renderPage(sanitize(d), { origin: 'https://example.com' });
  assert.ok(html.includes('<em>look.</em>'));
  assert.ok(html.includes('&lt;b&gt;bold&lt;/b&gt;'));
  const data = html.match(/<script type="application\/json" id="compcard-data">([^]*?)<\/script>/);
  assert.ok(data, 'comp card JSON present');
  assert.ok(!data[1].includes('<'), 'no raw < inside the JSON block');
  const cc = JSON.parse(data[1]);
  assert.equal(cc.photos.length, 5);
  assert.equal(cc.url, 'https://example.com');
  assert.ok(html.includes('data-compcard'), 'download buttons rendered');
});

test('render: no comp card button without photos', () => {
  const d = defaults();
  d.photos = [];
  assert.ok(!renderPage(sanitize(d)).includes('data-compcard'));
});

test('404 page and sitemap escape their input', () => {
  const d = defaults();
  d.site.name = '<x>';
  const nf = renderNotFound(sanitize(d), { origin: 'https://example.com' });
  assert.ok(nf.includes('&lt;x&gt;') && !nf.includes('<x>'));
  assert.ok(nf.includes('noindex'));
  assert.ok(renderSitemap('https://a.b/?x=<y>').includes('https://a.b/?x=&lt;y&gt;/'));
});
