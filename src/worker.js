import { defaults, sanitize, R2_KEY_RE } from './content.js';
import { renderPage } from './render.js';

const CONTENT_KEY = 'content.json';
const COOKIE = 'mt_session';
const SESSION_DAYS = 30;
const MAX_UPLOAD = 6 * 1024 * 1024;
const enc = new TextEncoder();

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

// ---------- auth ----------

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

// Compare via digests so length differences don't leak, and always walk the full string.
async function safeEqual(a, b) {
  const [x, y] = await Promise.all([a, b].map(async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

async function makeToken(env) {
  const exp = String(Date.now() + SESSION_DAYS * 864e5);
  return `${exp}.${await hmac(env.ADMIN_PASSWORD, exp)}`;
}

async function isAuthed(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return safeEqual(sig, await hmac(env.ADMIN_PASSWORD, exp));
}

const cookie = (value, maxAge) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

// ---------- content ----------

async function loadContent(env) {
  const obj = await env.BUCKET.get(CONTENT_KEY);
  if (!obj) return defaults();
  try {
    return sanitize(await obj.json());
  } catch {
    return defaults();
  }
}

// ---------- routes ----------

async function handleApi(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  // CSRF: browsers always send Origin on cross-site writes; reject if it isn't us.
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).host !== url.host) return json({ error: 'bad origin' }, 403);
    if (request.headers.get('x-requested-with') !== 'admin') return json({ error: 'bad request' }, 403);
  }

  if (pathname === '/api/login' && method === 'POST') {
    if (!env.ADMIN_PASSWORD) return json({ error: 'ADMIN_PASSWORD is not configured' }, 503);
    const body = await request.json().catch(() => ({}));
    const ok = typeof body.password === 'string' && (await safeEqual(body.password, env.ADMIN_PASSWORD));
    if (!ok) {
      await new Promise(r => setTimeout(r, 800)); // slow down guessing
      return json({ error: 'wrong password' }, 401);
    }
    return json({ ok: true }, 200, { 'set-cookie': cookie(await makeToken(env), SESSION_DAYS * 86400) });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
  }

  if (!(await isAuthed(request, env))) return json({ error: 'unauthorized' }, 401);

  if (pathname === '/api/admin/content' && method === 'GET') {
    return json(await loadContent(env));
  }

  if (pathname === '/api/admin/content' && method === 'PUT') {
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'invalid JSON' }, 400);
    const current = await loadContent(env);
    if (body.rev !== current.rev) return json({ error: 'content changed elsewhere, reload the page', rev: current.rev }, 409);
    const next = sanitize(body);
    next.rev = current.rev + 1;
    await env.BUCKET.put(CONTENT_KEY, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' } });
    return json(next);
  }

  if (pathname === '/api/admin/upload' && method === 'POST') {
    const id = url.searchParams.get('id') || '';
    const variant = url.searchParams.get('v');
    if (!/^[a-f0-9]{12}$/.test(id) || !['full', 'thumb'].includes(variant)) return json({ error: 'bad params' }, 400);
    if (Number(request.headers.get('content-length')) > MAX_UPLOAD) return json({ error: 'file too large' }, 413);
    const data = await request.arrayBuffer();
    if (data.byteLength > MAX_UPLOAD || data.byteLength < 100) return json({ error: 'file too large' }, 413);
    const b = new Uint8Array(data, 0, 12);
    const isJpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    const isWebp = String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP';
    if (!isJpeg && !isWebp) return json({ error: 'only JPEG or WebP accepted' }, 415);
    const key = `photos/${id}-${variant}.${isWebp ? 'webp' : 'jpg'}`;
    await env.BUCKET.put(key, data, { httpMetadata: { contentType: isWebp ? 'image/webp' : 'image/jpeg' } });
    return json({ key });
  }

  if (pathname === '/api/admin/object' && method === 'DELETE') {
    const key = url.searchParams.get('key') || '';
    if (!R2_KEY_RE.test(key)) return json({ error: 'bad key' }, 400);
    await env.BUCKET.delete(key);
    return json({ ok: true });
  }

  return json({ error: 'not found' }, 404);
}

async function serveImage(request, env, url) {
  const key = decodeURIComponent(url.pathname.slice('/img/'.length));
  if (!R2_KEY_RE.test(key)) return new Response('Not found', { status: 404 });

  const cache = caches.default;
  const cacheKey = new Request(url.origin + url.pathname);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const obj = await env.BUCKET.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  const res = new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'image/jpeg',
      // Keys contain a random id and are never overwritten, so they can be cached forever.
      'cache-control': 'public, max-age=31536000, immutable',
      etag: obj.httpEtag,
    },
  });
  if (request.method === 'GET') await cache.put(cacheKey, res.clone());
  return res;
}

async function servePage(request, env, url) {
  const content = await loadContent(env);
  const html = renderPage(content, { origin: url.origin, imgBase: env.IMG_BASE || '' });
  const etag = `"${hex(await crypto.subtle.digest('SHA-1', enc.encode(html))).slice(0, 20)}"`;
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate', etag };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(html, { headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, url);
      if (url.pathname.startsWith('/img/')) return await serveImage(request, env, url);
      if (url.pathname === '/' || url.pathname === '/index.html') return await servePage(request, env, url);
    } catch (err) {
      console.error(err);
      return json({ error: 'server error' }, 500);
    }
    return env.ASSETS.fetch(request);
  },
};
