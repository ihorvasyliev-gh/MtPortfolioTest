const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Escape, then turn *word* into <em>word</em> and newlines into <br>. */
const rich = s => esc(s).replace(/\*([^*\n]+)\*/g, '<em>$1</em>').replace(/\n/g, '<br>');

const pad = n => String(n + 1).padStart(2, '0');

export function renderPage(c, { origin = '', imgBase = '' } = {}) {
  const src = key => (key.startsWith('/') ? key : `${imgBase || '/img'}/${key}`);
  const abs = key => (/^https?:/.test(src(key)) ? src(key) : origin + src(key));

  const { site, hero, about } = c;
  const title = `${site.name} — ${site.role}${site.location ? ', ' + site.location : ''}`;
  const insta = site.instagram ? `https://www.instagram.com/${site.instagram}` : '';
  const mail = esc(site.email);

  const used = new Set(c.photos.filter(p => !p.hidden).map(p => p.cat));
  const cats = c.categories.filter(k => used.has(k.id));
  const catLabel = Object.fromEntries(c.categories.map(k => [k.id, k.label]));

  let lastGroup = null;
  const tiles = c.photos
    .filter(p => !p.hidden)
    .map(p => {
      let divider = '';
      if (p.group !== lastGroup && p.group) divider = `<p class="g-divider">${esc(p.group)}</p>\n    `;
      lastGroup = p.group;
      return (
        divider +
        `<button class="tile" data-cat="${esc(p.cat)}" data-label="${esc(catLabel[p.cat] || '')}" data-full="${esc(src(p.full))}" data-alt="${esc(p.alt)}" style="--ar:${p.w}/${p.h}">` +
        `<img src="${esc(src(p.thumb))}" width="${p.w}" height="${p.h}" alt="${esc(p.alt)}" loading="lazy" decoding="async"></button>`
      );
    })
    .join('\n    ');

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: site.name,
    jobTitle: site.role,
    email: 'mailto:' + site.email,
    ...(site.location ? { address: { '@type': 'PostalAddress', addressLocality: site.location } } : {}),
    ...(insta ? { sameAs: [insta] } : {}),
  }).replace(/</g, '\\u003c');

  const nav = [
    ['about', 'About'],
    c.services.length && ['work', 'Work'],
    c.stats.length && ['stats', 'Measurements'],
    tiles && ['portfolio', 'Portfolio'],
  ]
    .filter(Boolean)
    .map(([id, label]) => `<a href="#${id}">${label}</a>`)
    .join('\n    ');

  const [first, ...rest] = site.name.split(' ');
  const initials = [first, rest[rest.length - 1] || first].map(w => esc(w[0] || '')).join('<span>.</span>');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(site.description)}">
<meta name="theme-color" content="#0a0a0b">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(site.description)}">
<meta property="og:image" content="${esc(abs(hero.image.full))}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Jost:wght@300;400;500&display=swap" rel="stylesheet">
<link rel="preload" as="image" href="${esc(src(hero.image.full))}" fetchpriority="high">
<script>document.documentElement.classList.add('js')</script>
<link rel="stylesheet" href="/style.css">
<script type="application/ld+json">${jsonLd}</script>
</head>
<body>

<header class="nav" id="nav">
  <a class="logo" href="#top" aria-label="${esc(site.name)} — home">${initials}</a>
  <nav class="nav-links" aria-label="Primary">
    ${nav}
    <a href="#contact" class="nav-cta">Book me</a>
  </nav>
  <button class="burger" id="burger" aria-label="Open menu" aria-expanded="false"><i></i><i></i></button>
</header>

<main id="top">

<section class="hero">
  <div class="hero-media">
    <img src="${esc(src(hero.image.full))}" alt="${esc(hero.image.alt)}" fetchpriority="high">
  </div>
  <div class="hero-copy">
    <p class="eyebrow reveal">${esc(site.role)}${site.location ? ' &nbsp;·&nbsp; ' + esc(site.location) : ''}</p>
    <h1 class="reveal d1">${esc(first)}${rest.length ? '<br><em>' + esc(rest.join(' ')) + '</em>' : ''}</h1>
    <p class="lede reveal d2">${esc(hero.lede)}</p>
    <div class="actions reveal d3">
      ${tiles ? '<a class="btn btn-solid" href="#portfolio">View portfolio</a>' : ''}
      <a class="btn btn-ghost" href="#contact">Get in touch</a>
    </div>
  </div>
  <a class="scroll-cue" href="#about" aria-label="Scroll down"><span></span></a>
</section>

<section class="about section" id="about">
  <div class="about-img reveal">
    <img src="${esc(src(about.image.full))}" alt="${esc(about.image.alt)}" loading="lazy" decoding="async">
  </div>
  <div class="about-copy">
    <p class="kicker reveal">01 — Profile</p>
    <h2 class="reveal d1">${rich(about.heading)}</h2>
    ${about.paragraphs.map(p => `<p class="reveal d2">${esc(p)}</p>`).join('\n    ')}
    ${
      about.facts.length
        ? `<dl class="facts reveal d3">\n      ${about.facts.map(f => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join('\n      ')}\n    </dl>`
        : ''
    }
  </div>
</section>
${
  c.services.length
    ? `
<section class="work section" id="work">
  <div class="section-head">
    <p class="kicker reveal">02 — Modelling</p>
    <h2 class="reveal d1">Available <em>for</em></h2>
  </div>
  <ul class="work-list">
    ${c.services.map((s, i) => `<li class="reveal"><span class="n">${pad(i)}</span><span class="t">${esc(s.title)}</span><span class="d">${esc(s.text)}</span></li>`).join('\n    ')}
  </ul>
</section>
`
    : ''
}${
  c.stats.length || c.traits.length
    ? `
<section class="stats section" id="stats">
  <div class="section-head">
    <p class="kicker reveal">03 — Comp card</p>
    <h2 class="reveal d1">Measurements</h2>
  </div>
  ${
    c.stats.length
      ? `<div class="stat-grid">
    ${c.stats.map((s, i) => `<div class="stat reveal${i ? ' d' + Math.min(i, 3) : ''}"><b>${esc(s.value)}${s.unit ? `<small>${esc(s.unit)}</small>` : ''}</b><span>${esc(s.label)}</span></div>`).join('\n    ')}
  </div>`
      : ''
  }
  ${
    c.traits.length
      ? `<dl class="traits reveal">
    ${c.traits.map(t => `<div><dt>${esc(t.label)}</dt><dd>${esc(t.value)}</dd></div>`).join('\n    ')}
  </dl>`
      : ''
  }
</section>
`
    : ''
}${
  tiles
    ? `
<section class="portfolio section" id="portfolio">
  <div class="section-head">
    <p class="kicker reveal">04 — Portfolio</p>
    <h2 class="reveal d1">Selected <em>work</em></h2>
  </div>

  <div class="filters reveal" role="tablist" aria-label="Filter portfolio">
    <button class="chip is-active" data-filter="all" role="tab" aria-selected="true">All</button>
    ${cats.map(k => `<button class="chip" data-filter="${esc(k.id)}" role="tab" aria-selected="false">${esc(k.label)}</button>`).join('\n    ')}
  </div>

  <div class="gallery" id="gallery">
    ${tiles}
  </div>
</section>
`
    : ''
}
<section class="contact section" id="contact">
  <p class="kicker reveal">05 — Contact</p>
  <h2 class="reveal d1">${rich(c.contact.heading)}</h2>
  <p class="reveal d2 contact-note">${esc(c.contact.note)}</p>
  <a class="mail reveal d2" href="mailto:${mail}">${mail}</a>
  <div class="actions reveal d3">
    <a class="btn btn-solid" href="mailto:${mail}?subject=Booking%20enquiry">Email me</a>
    ${insta ? `<a class="btn btn-ghost" href="${esc(insta)}" target="_blank" rel="noopener">Instagram @${esc(site.instagram)}</a>` : ''}
  </div>
</section>

</main>

<footer class="footer">
  <span>© <span id="year">${new Date().getFullYear()}</span> ${esc(site.name)}</span>
  <span>${esc(site.role)}${site.location ? ' · ' + esc(site.location) : ''}</span>
</footer>

<div class="lightbox" id="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer" hidden>
  <button class="lb-close" id="lbClose" aria-label="Close">&times;</button>
  <button class="lb-nav lb-prev" id="lbPrev" aria-label="Previous photo">&#8592;</button>
  <figure>
    <img id="lbImg" alt="">
    <figcaption id="lbCap"></figcaption>
  </figure>
  <button class="lb-nav lb-next" id="lbNext" aria-label="Next photo">&#8594;</button>
</div>

<script src="/script.js"></script>
</body>
</html>`;
}
