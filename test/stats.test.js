import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { eventFrom, source, device, browser, isBot, summary } from '../src/stats.js';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const INSTA = IPHONE + ' Instagram 350.0.0';

// Minimal D1 stand-in: remembers every statement that ran.
const fakeDb = () => {
  const ran = [];
  return {
    ran,
    prepare: sql => ({ sql, args: [], bind(...args) { return { sql, args }; } }),
    batch: async stmts => { ran.push(...stmts); return stmts.map(() => ({ results: [] })); },
  };
};

const req = (ua, headers = {}) => new Request('https://mariia-troian.pages.dev/api/t', { method: 'POST', headers: { 'user-agent': ua, 'cf-connecting-ip': '203.0.113.7', ...headers } });

test('user agent helpers', () => {
  assert.equal(device(IPHONE), 'mobile');
  assert.equal(device(CHROME), 'desktop');
  assert.equal(browser(CHROME), 'Chrome');
  assert.equal(browser(IPHONE), 'Safari');
  assert.equal(browser(INSTA), 'Instagram');
  assert.ok(isBot('Googlebot/2.1 (+http://www.google.com/bot.html)'));
  assert.ok(isBot(''));
  assert.ok(!isBot(CHROME));
});

test('source: utm, in-app browser, referrer host, own site ignored', () => {
  const own = 'mariia-troian.pages.dev';
  assert.equal(source({ utm: 'Agency', ref: 'https://google.com/' }, CHROME, own), 'agency');
  assert.equal(source({ ref: '' }, INSTA, own), 'instagram.com');
  assert.equal(source({ ref: 'https://www.google.ie/search?q=x' }, CHROME, own), 'google.ie');
  assert.equal(source({ ref: 'https://mariia-troian.pages.dev/#work' }, CHROME, own), null);
  assert.equal(source({ ref: 'not a url' }, CHROME, own), null);
});

test('eventFrom: anonymous daily visitor id, no IP stored, bots and junk dropped', async () => {
  const env = { ADMIN_PASSWORD: 'secret' };
  const now = Date.UTC(2026, 9, 13, 12);
  const ev = await eventFrom({ t: 'view', ref: 'https://www.instagram.com/' }, req(CHROME), env, now);
  assert.equal(ev.day, '2026-10-13');
  assert.match(ev.visitor, /^[a-f0-9]{16}$/);
  assert.ok(!JSON.stringify(ev).includes('203.0.113.7'));
  assert.equal(ev.ref, 'instagram.com');
  const sameDay = await eventFrom({ t: 'view' }, req(CHROME), env, now + 3600e3);
  const nextDay = await eventFrom({ t: 'view' }, req(CHROME), env, now + 86400e3);
  assert.equal(sameDay.visitor, ev.visitor);
  assert.notEqual(nextDay.visitor, ev.visitor);

  assert.equal(await eventFrom({ t: 'view' }, req('Googlebot/2.1'), env), null);
  assert.equal(await eventFrom({ t: 'hack' }, req(CHROME), env), null);
  assert.equal(await eventFrom({ t: 'photo', item: '<script>' }, req(CHROME), env), null);
  assert.equal((await eventFrom({ t: 'photo', item: 'portrait-01' }, req(CHROME), env)).item, 'portrait-01');
  assert.equal((await eventFrom({ t: 'compcard' }, req(CHROME), env)).type, 'compcard');
});

test('beacon endpoint records in the background and always answers 204', async () => {
  const DB = fakeDb();
  const waits = [];
  const ctx = { waitUntil: p => waits.push(p) };
  const env = { DB, ADMIN_PASSWORD: 'secret' };
  const post = (body, ua = CHROME, headers = {}) =>
    worker.fetch(new Request('https://mariia-troian.pages.dev/api/t', { method: 'POST', body, headers: { 'user-agent': ua, ...headers } }), env, ctx);

  assert.equal((await post(JSON.stringify({ t: 'view' }))).status, 204);
  await Promise.all(waits);
  assert.ok(DB.ran.some(s => s.sql.startsWith('INSERT INTO events')));

  const before = DB.ran.length;
  assert.equal((await post(JSON.stringify({ t: 'view' }), 'curl/8.0')).status, 204);
  assert.equal((await post('{not json')).status, 204);
  assert.equal((await post(JSON.stringify({ t: 'view' }), CHROME, { origin: 'https://evil.example' })).status, 204);
  await Promise.all(waits);
  assert.equal(DB.ran.length, before, 'bots, junk and foreign origins are not recorded');
});

test('stats endpoint needs the admin session', async () => {
  const res = await worker.fetch(new Request('https://mariia-troian.pages.dev/api/admin/stats'), { DB: fakeDb(), ADMIN_PASSWORD: 'secret' }, {});
  assert.equal(res.status, 401);
});

test('summary clamps the period and returns every section', async () => {
  const s = await summary({ DB: fakeDb() }, '9999', Date.UTC(2026, 9, 13, 12));
  assert.equal(s.days, 30);
  assert.equal(s.since, '2026-09-14');
  for (const k of ['daily', 'refs', 'countries', 'cities', 'devices', 'browsers', 'photos', 'actions', 'recent']) assert.deepEqual(s[k], []);
});
