const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const pad = n => String(n + 1).padStart(2, '0');

/**
 * Like the admin's mini-markup (*word* → gold italic, newline → line break), but every word is
 * wrapped in its own mask so headings can rise in word by word.
 */
const splitWords = s => {
  let i = 0;
  return String(s ?? '')
    .split('\n')
    .map(line => {
      const out = [];
      line.replace(/\*([^*\n]+)\*|[^*]+|\*/g, (m, em) => {
        for (const w of (em ?? m).split(/(\s+)/)) {
          if (!w) continue;
          if (/^\s+$/.test(w)) out.push(' ');
          else out.push(`<span class="w"><span style="--i:${i++}">${em != null ? `<em>${esc(w)}</em>` : esc(w)}</span></span>`);
        }
        return '';
      });
      return out.join('');
    })
    .join('<br>');
};

/** One span per letter (for the hero name). Screen readers get the plain name separately. */
const letters = (word, from) =>
  [...word].map((ch, k) => (ch === ' ' ? ' ' : `<span class="ch" style="--i:${from + k}">${esc(ch)}</span>`)).join('');

/** Label that rolls up to a gold copy of itself on hover. */
const roll = label => `<span class="roll"><span data-t="${esc(label)}">${esc(label)}</span></span>`;

const json = v => JSON.stringify(v).replace(/</g, '\\u003c');

const FONT_PRELOADS = ['cormorant-latin', 'jost-latin']
  .map(f => `<link rel="preload" href="/fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`)
  .join('\n');

// Runs before anything paints. If script.js never runs (blocked, offline), show the page without animations.
const BOOT = `(function(d){d.classList.add('js');try{if(sessionStorage.getItem('mt-intro'))d.classList.add('intro-seen')}catch(e){}addEventListener('load',function(){if(!window.MT)d.classList.add('no-anim','is-ready')})})(document.documentElement)`;

function head({ title, description, origin, image, extra = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#0a0a0b">
<meta name="color-scheme" content="dark">
${origin ? `<link rel="canonical" href="${esc(origin)}/">\n<meta property="og:url" content="${esc(origin)}/">` : ''}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${FONT_PRELOADS}
${extra}
<script>${BOOT}</script>
<link rel="stylesheet" href="/style.css">
`;
}

export function renderPage(c, { origin = '', imgBase = '' } = {}) {
  const src = key => (key.startsWith('/') ? key : `${imgBase || '/img'}/${key}`);
  const abs = key => (/^https?:/.test(src(key)) ? src(key) : origin + src(key));
  const byFull = Object.fromEntries(c.photos.map(p => [p.full, p]));
  const byId = Object.fromEntries(c.photos.map(p => [p.id, p]));

  // Thumbs are 900px on the long edge, full photos ~2000–2200px: enough for a two-step srcset.
  const srcset = full => {
    const p = byFull[full];
    if (!p) return '';
    const big = Math.round(p.w * (2000 / 900));
    return ` srcset="${esc(src(p.thumb))} ${p.w}w, ${esc(src(full))} ${big}w"`;
  };

  const { site, hero, about } = c;
  const title = `${site.name} — ${site.role}${site.location ? ', ' + site.location : ''}`;
  const insta = site.instagram ? `https://www.instagram.com/${site.instagram}` : '';
  const mail = esc(site.email);
  const where = `${esc(site.role)}${site.location ? ' <i>·</i> ' + esc(site.location) : ''}`;

  const visible = c.photos.filter(p => !p.hidden);
  const used = new Set(visible.map(p => p.cat));
  const cats = c.categories.filter(k => used.has(k.id));
  const catLabel = Object.fromEntries(c.categories.map(k => [k.id, k.label]));

  let lastGroup = null;
  const tiles = visible
    .map((p, i) => {
      let divider = '';
      if (p.group !== lastGroup && p.group) divider = `<p class="g-divider"><span>${esc(p.group)}</span></p>\n    `;
      lastGroup = p.group;
      const label = catLabel[p.cat] || '';
      return (
        divider +
        `<button class="tile" data-cat="${esc(p.cat)}" data-label="${esc(label)}" data-full="${esc(src(p.full))}" data-alt="${esc(p.alt)}" style="--ar:${p.w}/${p.h}" aria-label="Open photo: ${esc(p.alt)}">` +
        `<span class="tile-in"><img src="${esc(src(p.thumb))}" width="${p.w}" height="${p.h}" alt="${esc(p.alt)}" loading="lazy" decoding="async"></span>` +
        `<span class="tile-cap" aria-hidden="true"><span>${esc(label)}</span><span>${pad(i)}</span></span></button>`
      );
    })
    .join('\n    ');

  const jsonLd = json({
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: site.name,
    jobTitle: site.role,
    email: 'mailto:' + site.email,
    ...(origin ? { url: origin + '/' } : {}),
    image: abs(hero.image.full),
    ...(site.location ? { address: { '@type': 'PostalAddress', addressLocality: site.location } } : {}),
    ...(insta ? { sameAs: [insta] } : {}),
  });

  // Everything the browser needs to draw the comp card PDF (see /compcard.js).
  const ccPhotos = c.compcard.photos.map(id => byId[id]).filter(Boolean);
  const compcard = ccPhotos.length
    ? json({
        name: site.name,
        role: site.role,
        location: site.location,
        email: site.email,
        instagram: site.instagram,
        url: origin,
        stats: c.stats,
        traits: c.traits,
        photos: ccPhotos.map(p => ({ src: src(p.full), w: p.w, h: p.h })),
      })
    : '';
  const ccButton = cls =>
    compcard ? `<button class="btn ${cls}" type="button" data-compcard data-magnetic hidden>${roll('Download comp card')}<small>PDF</small></button>` : '';

  // Section numbers follow what is actually on the page.
  let n = 0;
  const num = () => String(++n).padStart(2, '0');
  const sections = [['about', 'About']];
  if (c.services.length) sections.push(['work', 'Work']);
  if (c.stats.length || c.traits.length) sections.push(['stats', 'Measurements']);
  if (tiles) sections.push(['portfolio', 'Portfolio']);
  const navLinks = sections
    .map(([id, label], i) => `<a href="#${id}" data-nav="${id}"><span class="n">${pad(i)}</span><span class="t">${roll(label)}</span></a>`)
    .join('\n    ');

  const [first, ...rest] = site.name.split(' ');
  const last = rest.join(' ');
  const initials = [first, rest[rest.length - 1] || first].map(w => esc(w[0] || '')).join('<span>.</span>');

  return `${head({
    title,
    description: site.description,
    origin,
    image: abs(hero.image.full),
    extra: `<link rel="preload" as="image" href="${esc(src(hero.image.full))}"${srcset(hero.image.full).replace(' srcset', ' imagesrcset')} imagesizes="(max-width: 820px) 72vw, 520px" fetchpriority="high">
<script src="/vendor/lenis-1.3.26.min.js" defer></script>
<script src="/script.js" defer></script>
<script type="application/ld+json">${jsonLd}</script>`,
  })}</head>
<body>

<div class="intro" id="intro" aria-hidden="true">
  <p class="intro-mark"><span class="hl"><span>${letters(first[0] || '', 0)}<span class="ch dot" style="--i:1">.</span>${letters((rest[rest.length - 1] || first)[0] || '', 2)}</span></span></p>
  <div class="intro-bar"><i id="introBar"></i></div>
  <p class="intro-foot"><span>${esc(site.role)}</span><span id="introCount">000</span></p>
</div>

<a class="skip" href="#main">Skip to content</a>

<header class="nav" id="nav">
  <a class="logo" href="#top" aria-label="${esc(site.name)} — home" data-magnetic>${initials}</a>
  <nav class="nav-links" id="menu" aria-label="Primary">
    ${navLinks}
    <a href="#contact" class="nav-cta" data-nav="contact" data-magnetic><span class="t">${roll('Book me')}</span></a>
    <div class="nav-meta">
      <a href="mailto:${mail}">${mail}</a>
      ${insta ? `<a href="${esc(insta)}" target="_blank" rel="noopener">Instagram</a>` : ''}
    </div>
  </nav>
  <button class="burger" id="burger" aria-label="Open menu" aria-controls="menu" aria-expanded="false"><i></i><i></i></button>
  <span class="nav-progress" aria-hidden="true"><i id="progress"></i></span>
</header>

<main id="main">

<section class="hero" id="top">
  <div class="hero-media" data-speed="-0.06">
    <span class="hero-frame" aria-hidden="true"></span>
    <div class="hero-img">
      <img src="${esc(src(hero.image.full))}"${srcset(hero.image.full)} sizes="(max-width: 820px) 72vw, 520px" alt="${esc(hero.image.alt)}" fetchpriority="high">
    </div>
  </div>
  <div class="hero-copy" data-speed="0.08">
    <p class="eyebrow"><span class="rule"></span>${where}</p>
    <h1 class="hero-title"><span class="sr-only">${esc(site.name)}</span><span class="hl" aria-hidden="true"><span>${letters(first, 0)}</span></span>${
      last ? `<span class="hl hl-em" aria-hidden="true"><span><em>${letters(last, first.length)}</em></span></span>` : ''
    }</h1>
    <p class="lede">${esc(hero.lede)}</p>
    <div class="actions">
      ${tiles ? `<a class="btn btn-solid" href="#portfolio" data-magnetic>${roll('View portfolio')}</a>` : ''}
      <a class="btn btn-ghost" href="#contact" data-magnetic>${roll('Get in touch')}</a>
    </div>
  </div>
  <a class="scroll-cue" href="#about" aria-label="Scroll down"><span class="sc-label">Scroll</span><span class="sc-line"><i></i></span></a>
</section>

<section class="about section" id="about">
  <div class="about-media">
    <div class="about-img mask">
      <div class="pz" data-pz><img src="${esc(src(about.image.full))}"${srcset(about.image.full)} sizes="(max-width: 820px) 90vw, 42vw" alt="${esc(about.image.alt)}" loading="lazy" decoding="async"></div>
    </div>
    <span class="about-frame" aria-hidden="true" data-speed="0.05"></span>
  </div>
  <div class="about-copy">
    <p class="kicker reveal"><b>${num()}</b>Profile</p>
    <h2 class="split">${splitWords(about.heading)}</h2>
    ${about.paragraphs.map(p => `<p class="reveal">${esc(p)}</p>`).join('\n    ')}
    ${
      about.facts.length
        ? `<dl class="facts">\n      ${about.facts.map(f => `<div class="reveal"><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join('\n      ')}\n    </dl>`
        : ''
    }
  </div>
</section>
${
  c.services.length
    ? `
<section class="work section" id="work">
  <div class="section-head">
    <p class="kicker reveal"><b>${num()}</b>Modelling</p>
    <h2 class="split">${splitWords('Available *for*')}</h2>
  </div>
  <ul class="work-list">
    ${c.services.map((s, i) => `<li class="reveal"><span class="n">${pad(i)}</span><span class="t">${esc(s.title)}</span><span class="d">${esc(s.text)}</span><span class="arrow" aria-hidden="true"></span></li>`).join('\n    ')}
  </ul>
</section>
`
    : ''
}${
  c.stats.length || c.traits.length
    ? `
<section class="stats section" id="stats">
  <div class="section-head">
    <p class="kicker reveal"><b>${num()}</b>Comp card</p>
    <h2 class="split">${splitWords('Measurements')}</h2>
  </div>
  ${
    c.stats.length
      ? `<div class="stat-grid">
    ${c.stats.map(s => `<div class="stat reveal"><p class="stat-v"><b data-count>${esc(s.value)}</b>${s.unit ? `<small>${esc(s.unit)}</small>` : ''}</p><span>${esc(s.label)}</span></div>`).join('\n    ')}
  </div>`
      : ''
  }
  ${
    c.traits.length
      ? `<dl class="traits">
    ${c.traits.map(t => `<div class="reveal"><dt>${esc(t.label)}</dt><dd>${esc(t.value)}</dd></div>`).join('\n    ')}
  </dl>`
      : ''
  }
  ${compcard ? `<div class="cc-row reveal">${ccButton('btn-ghost')}</div>` : ''}
</section>
`
    : ''
}${
  tiles
    ? `
<section class="portfolio section" id="portfolio">
  <div class="section-head">
    <p class="kicker reveal"><b>${num()}</b>Portfolio</p>
    <h2 class="split">${splitWords('Selected *work*')}</h2>
  </div>

  <div class="filters reveal" role="group" aria-label="Filter portfolio">
    <button class="chip is-active" data-filter="all" aria-pressed="true">All<sup>${visible.length}</sup></button>
    ${cats.map(k => `<button class="chip" data-filter="${esc(k.id)}" aria-pressed="false">${esc(k.label)}<sup>${visible.filter(p => p.cat === k.id).length}</sup></button>`).join('\n    ')}
  </div>

  <div class="gallery" id="gallery">
    ${tiles}
  </div>
</section>
`
    : ''
}
<section class="contact section" id="contact">
  <p class="kicker reveal"><b>${num()}</b>Contact</p>
  <h2 class="split">${splitWords(c.contact.heading)}</h2>
  <p class="reveal contact-note">${esc(c.contact.note)}</p>
  <a class="mail reveal" href="mailto:${mail}"><span>${mail}</span></a>
  <div class="actions reveal">
    <a class="btn btn-solid" href="mailto:${mail}?subject=Booking%20enquiry" data-magnetic>${roll('Email me')}</a>
    ${insta ? `<a class="btn btn-ghost" href="${esc(insta)}" target="_blank" rel="noopener" data-magnetic>${roll('Instagram @' + site.instagram)}</a>` : ''}
    ${ccButton('btn-ghost')}
  </div>
</section>

</main>

<footer class="footer">
  <div class="footer-top">
    <a href="mailto:${mail}">Email</a>
    ${insta ? `<a href="${esc(insta)}" target="_blank" rel="noopener">Instagram</a>` : ''}
    <a href="#top" class="to-top">Back to top <span aria-hidden="true">↑</span></a>
  </div>
  <p class="footer-name" aria-hidden="true"><span>${esc(first)}${last ? ` <em>${esc(last)}</em>` : ''}</span></p>
  <div class="footer-bottom">
    <span>© ${new Date().getFullYear()} ${esc(site.name)}</span>
    <span>${where}</span>
  </div>
</footer>

<div class="lightbox" id="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer" tabindex="-1" hidden>
  <div class="lb-bg"></div>
  <img class="lb-img" id="lbImg" alt="" draggable="false">
  <div class="lb-top">
    <p class="lb-count"><b id="lbIdx">01</b><span id="lbTotal"></span></p>
    <p class="lb-cap" id="lbCap"></p>
    <button class="lb-close" id="lbClose" aria-label="Close"><span>Close</span><i></i></button>
  </div>
  <button class="lb-nav lb-prev" id="lbPrev" aria-label="Previous photo"><i></i></button>
  <button class="lb-nav lb-next" id="lbNext" aria-label="Next photo"><i></i></button>
</div>
${compcard ? `\n<script type="application/json" id="compcard-data">${compcard}</script>` : ''}
</body>
</html>`;
}

export function renderNotFound(c, { origin = '' } = {}) {
  const { site } = c;
  return `${head({ title: `Page not found — ${site.name}`, description: site.description, origin: '' })}<meta name="robots" content="noindex">
</head>
<body class="nf">
<main class="nf-main">
  <p class="kicker">Error 404</p>
  <h1><span>Lost</span> <em>in the frame.</em></h1>
  <p class="nf-note">This page doesn't exist — but the portfolio does.</p>
  <a class="btn btn-solid" href="${esc(origin)}/">${roll('Back to ' + site.name)}</a>
</main>
</body>
</html>`;
}

export function renderSitemap(origin) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${esc(origin)}/</loc></url>
</urlset>
`;
}
