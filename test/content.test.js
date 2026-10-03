import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, sanitize } from '../src/content.js';
import { renderPage } from '../src/render.js';

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
