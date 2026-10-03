import DEFAULTS from './default-content.json' with { type: 'json' };

// Photos are either bundled with the site ("/assets/...") or live in R2 ("photos/<id>-full.webp").
const SRC_RE = /^(\/assets\/[\w./-]+|photos\/[a-f0-9]{12}-(full|thumb)\.(webp|jpg))$/;
const ID_RE = /^[\w-]{1,40}$/;

const str = (v, max = 200) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '');
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const pairs = (v, max, a, b) =>
  arr(v, max)
    .map(x => ({ [a]: str(x?.[a], 60), [b]: str(x?.[b], 200) }))
    .filter(x => x[a] || x[b]);

const image = (v, fallback) => ({
  full: SRC_RE.test(v?.full) ? v.full : fallback.full,
  alt: str(v?.alt, 200),
});

export function defaults() {
  return structuredClone(DEFAULTS);
}

/** Coerce arbitrary input into a valid content object. Never throws. */
export function sanitize(input, base = DEFAULTS) {
  const i = input && typeof input === 'object' ? input : {};
  const site = i.site || {};
  const email = str(site.email, 120);
  const ig = str(site.instagram, 60).replace(/^@/, '');

  const categories = [];
  const seen = new Set();
  for (const c of arr(i.categories, 30)) {
    const id = str(c?.id, 40);
    const label = str(c?.label, 40);
    if (!ID_RE.test(id) || !label || seen.has(id)) continue;
    seen.add(id);
    categories.push({ id, label });
  }

  const photoIds = new Set();
  const photos = [];
  for (const p of arr(i.photos, 500)) {
    if (!ID_RE.test(p?.id) || photoIds.has(p.id) || !SRC_RE.test(p.full) || !SRC_RE.test(p.thumb)) continue;
    photoIds.add(p.id);
    const w = Math.round(Number(p.w)), h = Math.round(Number(p.h));
    photos.push({
      id: p.id,
      cat: seen.has(p.cat) ? p.cat : '',
      group: str(p.group, 60),
      alt: str(p.alt, 200),
      full: p.full,
      thumb: p.thumb,
      w: w > 0 && w < 10000 ? w : 600,
      h: h > 0 && h < 10000 ? h : 900,
      ...(p.hidden ? { hidden: true } : {}),
    });
  }

  return {
    rev: Number.isInteger(i.rev) && i.rev >= 0 ? i.rev : 0,
    site: {
      name: str(site.name, 80) || base.site.name,
      role: str(site.role, 80),
      location: str(site.location, 80),
      email: /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email) ? email : base.site.email,
      instagram: /^[A-Za-z0-9._]{0,30}$/.test(ig) ? ig : '',
      description: str(site.description, 300),
    },
    hero: {
      lede: str(i.hero?.lede, 300),
      image: image(i.hero?.image, base.hero.image),
    },
    about: {
      heading: str(i.about?.heading, 80),
      paragraphs: arr(i.about?.paragraphs, 6).map(p => str(p, 1200)).filter(Boolean),
      facts: pairs(i.about?.facts, 8, 'label', 'value'),
      image: image(i.about?.image, base.about.image),
    },
    services: pairs(i.services, 20, 'title', 'text'),
    stats: arr(i.stats, 8)
      .map(s => ({ value: str(s?.value, 40), unit: str(s?.unit, 10), label: str(s?.label, 60) }))
      .filter(s => s.value || s.label),
    traits: pairs(i.traits, 9, 'label', 'value'),
    categories,
    contact: {
      heading: str(i.contact?.heading, 120),
      note: str(i.contact?.note, 300),
    },
    photos,
  };
}

/** Admin-only upload keys are `photos/<12 hex>-(full|thumb).(webp|jpg)`. */
export const R2_KEY_RE = /^photos\/[a-f0-9]{12}-(full|thumb)\.(webp|jpg)$/;
