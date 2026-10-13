// Cookieless visit stats in D1 (binding DB). No IPs or cookies are stored: a visitor is a
// SHA-256 of day + IP + user agent + a server secret, so it changes every day and can't be
// reversed or linked across days.

const TZ = 'Europe/Dublin';
const RETENTION_DAYS = 400;
const TYPES = new Set(['view', 'photo', 'compcard', 'contact']);
const ITEM_RE = /^[\w.-]{1,40}$/;
const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|curl|wget|python|java\/|go-http|okhttp|https?:\/\//i;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (ts INTEGER NOT NULL, day TEXT NOT NULL, type TEXT NOT NULL, item TEXT, visitor TEXT,
    country TEXT, city TEXT, ref TEXT, device TEXT, browser TEXT)`,
  'CREATE INDEX IF NOT EXISTS events_day ON events (day, type)',
];

// Created on first use, so a fresh database needs no migration step.
let ready = null;
const ensureSchema = db => (ready ||= db.batch(SCHEMA.map(s => db.prepare(s))).catch(e => { ready = null; throw e; }));

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayOf = ms => dayFmt.format(ms);

export const isBot = ua => !ua || BOT_RE.test(ua);

export function device(ua) {
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobi)/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'mobile';
  return 'desktop';
}

export function browser(ua) {
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/FBAN|FBAV/i.test(ua)) return 'Facebook';
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser/.test(ua)) return 'Samsung';
  if (/Firefox|FxiOS/.test(ua)) return 'Firefox';
  if (/Chrome|CriOS|Chromium/.test(ua)) return 'Chrome';
  if (/Safari/.test(ua)) return 'Safari';
  return 'Other';
}

/** Where the visit came from: utm_source, then the in-app browser, then the referrer's host. */
export function source({ ref, utm }, ua, ownHost) {
  if (typeof utm === 'string' && ITEM_RE.test(utm)) return utm.toLowerCase();
  if (/Instagram/i.test(ua)) return 'instagram.com';
  if (/FBAN|FBAV/i.test(ua)) return 'facebook.com';
  if (typeof ref !== 'string' || !ref) return null;
  try {
    const host = new URL(ref).hostname.replace(/^www\.|^m\.|^l\./, '');
    return host && host !== ownHost.replace(/^www\./, '') ? host.slice(0, 80) : null;
  } catch {
    return null;
  }
}

async function visitorId(day, ip, ua, secret) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${day}|${ip}|${ua}|${secret}`));
  return [...new Uint8Array(buf, 0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Builds the row for one beacon, or null when it shouldn't be counted. */
export async function eventFrom(body, request, env, now = Date.now()) {
  if (!body || !TYPES.has(body.t)) return null;
  const ua = request.headers.get('user-agent') || '';
  if (isBot(ua)) return null;
  const item = body.t === 'view' ? null : typeof body.item === 'string' && ITEM_RE.test(body.item) ? body.item : null;
  if (body.t !== 'view' && !item && body.t !== 'compcard') return null;
  const day = dayOf(now);
  const ip = request.headers.get('cf-connecting-ip') || '';
  const cf = request.cf || {};
  return {
    ts: now,
    day,
    type: body.t,
    item,
    visitor: await visitorId(day, ip, ua, env.ADMIN_PASSWORD || 'mt'),
    country: typeof cf.country === 'string' ? cf.country.slice(0, 2) : null,
    city: typeof cf.city === 'string' ? cf.city.slice(0, 60) : null,
    ref: body.t === 'view' ? source(body, ua, new URL(request.url).hostname) : null,
    device: device(ua),
    browser: browser(ua),
  };
}

export async function record(env, ev) {
  await ensureSchema(env.DB);
  const stmts = [
    env.DB.prepare('INSERT INTO events (ts, day, type, item, visitor, country, city, ref, device, browser) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(ev.ts, ev.day, ev.type, ev.item, ev.visitor, ev.country, ev.city, ev.ref, ev.device, ev.browser),
  ];
  if (Math.random() < 0.01) stmts.push(env.DB.prepare('DELETE FROM events WHERE ts < ?').bind(ev.ts - RETENTION_DAYS * 864e5));
  await env.DB.batch(stmts);
}

const PERIODS = [7, 30, 90, 365];

export async function summary(env, daysParam, now = Date.now()) {
  const days = PERIODS.includes(Number(daysParam)) ? Number(daysParam) : 30;
  const since = dayOf(now - (days - 1) * 864e5);
  await ensureSchema(env.DB);
  const q = (sql, ...args) => env.DB.prepare(sql).bind(since, ...args);
  // A "visitor" is unique per day, so period totals sum the daily uniques.
  const top = col => q(`SELECT ${col} AS k, COUNT(DISTINCT visitor || day) AS n FROM events WHERE day >= ? AND type = 'view' GROUP BY k ORDER BY n DESC LIMIT 10`);
  const [daily, refs, countries, cities, devices, browsers, photos, actions, recent] = await env.DB.batch([
    q(`SELECT day, SUM(type = 'view') AS views, COUNT(DISTINCT CASE WHEN type = 'view' THEN visitor END) AS visitors FROM events WHERE day >= ? GROUP BY day ORDER BY day`),
    top('ref'),
    top('country'),
    q(`SELECT city AS k, country AS c, COUNT(DISTINCT visitor || day) AS n FROM events WHERE day >= ? AND type = 'view' AND city IS NOT NULL GROUP BY city, country ORDER BY n DESC LIMIT 10`),
    top('device'),
    top('browser'),
    q(`SELECT item AS k, COUNT(*) AS n FROM events WHERE day >= ? AND type = 'photo' GROUP BY item ORDER BY n DESC LIMIT 12`),
    q(`SELECT type, item AS k, COUNT(*) AS n FROM events WHERE day >= ? AND type IN ('compcard', 'contact') GROUP BY type, item`),
    q(`SELECT ts, country, city, ref, device, browser FROM events WHERE day >= ? AND type = 'view' ORDER BY ts DESC LIMIT 25`),
  ]);
  const rows = r => r.results || [];
  return {
    enabled: true,
    days,
    since,
    today: dayOf(now),
    daily: rows(daily),
    refs: rows(refs),
    countries: rows(countries),
    cities: rows(cities),
    devices: rows(devices),
    browsers: rows(browsers),
    photos: rows(photos),
    actions: rows(actions),
    recent: rows(recent),
  };
}
