(() => {
  'use strict';
  window.MT = true; // tells the inline boot script that animations are handled

  const d = document;
  const root = d.documentElement;
  const $ = (s, c = d) => c.querySelector(s);
  const $$ = (s, c = d) => [...c.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const IO_EASE = 'cubic-bezier(.77,0,.18,1)';
  const OUT_EASE = 'cubic-bezier(.16,1,.3,1)';
  const raf = requestAnimationFrame;
  let lbOpen = false;
  if (reduce) root.classList.add('no-anim');

  // ---------- smooth scroll ----------
  const lenis = !reduce && window.Lenis ? new window.Lenis({ autoRaf: true, anchors: true, lerp: 0.09 }) : null;
  const lock = on => {
    if (lenis) on ? lenis.stop() : lenis.start();
    d.body.style.overflow = on ? 'hidden' : '';
  };

  // ---------- intro → hero ----------
  const intro = $('#intro');
  const ready = () => root.classList.add('is-ready');
  if (!intro || reduce || getComputedStyle(intro).display === 'none') {
    intro?.remove();
    raf(() => raf(ready));
  } else {
    lock(true);
    const bar = $('#introBar'), count = $('#introCount');
    const heroImg = $('.hero-img img');
    const t0 = performance.now();
    const MIN = 1400, MAX = 3500;
    let loaded = false, shown = 0;
    Promise.all([
      heroImg && !heroImg.complete ? new Promise(r => { heroImg.onload = heroImg.onerror = r; }) : 0,
      d.fonts?.ready,
    ]).then(() => { loaded = true; });
    const step = now => {
      const t = now - t0;
      const target = loaded ? Math.min(1, t / MIN) : Math.min(0.9, t / (MIN * 1.6));
      shown += (target - shown) * 0.12;
      if (target === 1 && shown > 0.995) shown = 1;
      bar.style.transform = `scaleX(${shown})`;
      count.textContent = String(Math.round(shown * 100)).padStart(3, '0');
      if ((shown === 1 && loaded) || t > MAX) {
        count.textContent = '100';
        bar.style.transform = 'scaleX(1)';
        setTimeout(() => {
          root.classList.add('intro-done');
          try { sessionStorage.setItem('mt-intro', '1'); } catch {}
          setTimeout(() => { ready(); lock(false); }, 550);
          setTimeout(() => intro.remove(), 1500);
        }, 220);
      } else raf(step);
    };
    raf(step);
  }

  // ---------- nav: solid / hide on scroll down / progress / active section ----------
  const nav = $('#nav'), progress = $('#progress'), burger = $('#burger'), menu = $('#menu');
  let menuOpen = false, lastY = scrollY;
  const updateNav = y => {
    nav.classList.toggle('scrolled', y > 40);
    if (!menuOpen && !lbOpen) {
      if (y > lastY + 4 && y > 320) nav.classList.add('hide');
      else if (y < lastY - 4 || y < 320) nav.classList.remove('hide');
    }
    lastY = y;
    const max = root.scrollHeight - innerHeight;
    progress.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
  };

  const setMenu = open => {
    menuOpen = open;
    menu.classList.toggle('open', open);
    root.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', open);
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (open) nav.classList.remove('hide');
    lock(open);
  };
  burger.addEventListener('click', () => setMenu(!menuOpen));
  $$('a', menu).forEach(a => a.addEventListener('click', () => menuOpen && setMenu(false)));
  addEventListener('keydown', e => { if (e.key === 'Escape' && menuOpen) { setMenu(false); burger.focus(); } });
  matchMedia('(min-width: 821px)').addEventListener('change', e => e.matches && menuOpen && setMenu(false));

  const navLinks = $$('[data-nav]');
  const sectionIO = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) navLinks.forEach(a => a.classList.toggle('active', a.dataset.nav === e.target.id));
  }, { rootMargin: '-45% 0px -50% 0px' });
  $$('main > section').forEach(s => sectionIO.observe(s));

  // ---------- scroll-linked: parallax + image drift ----------
  const speeds = $$('[data-speed]').map(el => ({ el, k: +el.dataset.speed, top: 0, h: 0, cur: 0 }));
  const drifts = $$('[data-pz]').map(el => ({ el, box: el.parentElement, top: 0, h: 0 }));
  let vh = innerHeight;
  const measure = () => {
    vh = innerHeight;
    const y = scrollY;
    for (const p of speeds) { const r = p.el.getBoundingClientRect(); p.top = r.top + y - p.cur; p.h = r.height; }
    for (const p of drifts) { const r = p.box.getBoundingClientRect(); p.top = r.top + y; p.h = r.height; }
  };
  const parallax = y => {
    if (reduce) return;
    const k = innerWidth < 821 ? 0.5 : 1;
    for (const p of speeds) {
      if (p.top + p.h < y - 200 || p.top > y + vh + 200) continue;
      p.cur = (y + vh / 2 - (p.top + p.h / 2)) * p.k * k;
      p.el.style.transform = `translate3d(0,${p.cur.toFixed(1)}px,0)`;
    }
    for (const p of drifts) {
      const t = (y + vh - p.top) / (vh + p.h);
      if (t < 0 || t > 1) continue;
      p.el.style.transform = `translate3d(0,${((0.5 - t) * 0.16 * p.h).toFixed(1)}px,0)`;
    }
  };

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    raf(() => { ticking = false; const y = scrollY; updateNav(y); parallax(y); });
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', () => { measure(); onScroll(); });
  measure();
  onScroll();

  // ---------- reveals ----------
  const countUp = el => {
    const b = $('[data-count]', el);
    if (!b || reduce) return;
    const final = b.textContent;
    const parts = final.split(/(\d+(?:\.\d+)?)/);
    if (parts.length < 2) return;
    b.setAttribute('aria-label', final);
    const t0 = performance.now(), dur = 1800;
    const step = now => {
      const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 4);
      b.textContent = parts.map((p, i) => (i % 2 ? (parseFloat(p) * e).toFixed((p.split('.')[1] || '').length) : p)).join('');
      if (t < 1) raf(step);
      else b.textContent = final;
    };
    raf(step);
  };

  const revealIO = new IntersectionObserver(entries => {
    let k = 0;
    entries
      .filter(e => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left)
      .forEach(e => {
        revealIO.unobserve(e.target);
        const el = proxied.get(e.target) || e.target;
        el.style.setProperty('--d', Math.min(k++, 6) * 0.09 + 's');
        el.classList.add('in');
        if (el.classList.contains('stat')) setTimeout(() => countUp(el), 150);
        setTimeout(() => el.style.removeProperty('--d'), 2600);
      });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  // A clipped-away element never "intersects", so masks are watched through their parent.
  const proxied = new Map();
  $$('.mask').forEach(el => proxied.set(el.parentElement, el));
  $$('.reveal, .split, .footer-name').concat([...proxied.keys()]).forEach(el => revealIO.observe(el));

  // ---------- gallery: masonry in reading order + animated filtering ----------
  const gallery = $('#gallery');
  const tiles = gallery ? $$('.tile', gallery) : [];
  if (gallery) {
    const items = [...gallery.children];
    const chips = $$('.chip');
    let filter = 'all';

    const layout = () => {
      const W = gallery.clientWidth;
      if (!W) return;
      gallery.classList.add('masonry');
      const cols = W >= 1000 ? 4 : W >= 640 ? 3 : 2;
      const gap = parseFloat(getComputedStyle(gallery).columnGap) || 12;
      const colW = (W - gap * (cols - 1)) / cols;
      const heights = Array(cols).fill(0);
      for (const el of items) {
        if (el.classList.contains('hide')) continue;
        if (el.classList.contains('g-divider')) {
          const top = Math.max(...heights);
          const mt = heights.some(Boolean) ? parseFloat(getComputedStyle(el).marginTop) || 0 : 0;
          el.style.cssText = `--x:0px;--y:${top + mt}px;width:${W}px;margin:0`;
          heights.fill(top + mt + el.offsetHeight + gap);
          continue;
        }
        const img = $('img', el);
        const ar = Math.min(2, Math.max(0.5, img.getAttribute('width') / img.getAttribute('height') || 0.667));
        const c = heights.indexOf(Math.min(...heights));
        const h = colW / ar;
        el.style.setProperty('--x', c * (colW + gap) + 'px');
        el.style.setProperty('--y', heights[c] + 'px');
        el.style.width = colW + 'px';
        el.style.height = h + 'px';
        if (!el.classList.contains('in')) el.style.setProperty('--d', c * 0.08 + 's');
        heights[c] += h + gap;
      }
      gallery.style.height = Math.max(0, Math.max(...heights) - gap) + 'px';
    };

    const still = fn => {
      gallery.classList.add('still');
      fn();
      gallery.offsetHeight; // commit positions before transitions come back
      raf(() => gallery.classList.remove('still'));
    };

    const applyFilter = f => {
      if (f === filter) return;
      filter = f;
      chips.forEach(c => {
        const on = c.dataset.filter === f;
        c.classList.toggle('is-active', on);
        c.setAttribute('aria-pressed', on);
      });
      const wanted = el => (el.classList.contains('g-divider') ? f === 'all' : f === 'all' || el.dataset.cat === f);
      const leaving = items.filter(el => !el.classList.contains('hide') && !wanted(el));
      const entering = items.filter(el => el.classList.contains('hide') && wanted(el));
      leaving.forEach(el => el.classList.add('out'));
      setTimeout(() => {
        leaving.forEach(el => el.classList.add('hide'));
        entering.forEach(el => { el.classList.remove('hide'); el.classList.add('out', 'in'); el.style.transition = 'none'; });
        layout();
        gallery.offsetHeight;
        entering.forEach((el, k) => { el.style.transition = ''; el.style.transitionDelay = Math.min(k, 10) * 0.05 + 's'; });
        raf(() => entering.forEach(el => el.classList.remove('out')));
        leaving.forEach(el => el.classList.remove('out'));
        setTimeout(() => { entering.forEach(el => (el.style.transitionDelay = '')); measure(); }, 1400);
      }, reduce || !leaving.length ? 0 : 420);
    };
    chips.forEach(c => c.addEventListener('click', () => applyFilter(c.dataset.filter)));

    let lastW = 0;
    new ResizeObserver(() => {
      if (gallery.clientWidth === lastW) return;
      lastW = gallery.clientWidth;
      still(layout);
      measure();
    }).observe(gallery);
    still(layout);

    const tileIO = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); tileIO.unobserve(e.target); }
    }, { threshold: 0.08, rootMargin: '0px 0px -4% 0px' });
    tiles.forEach(t => tileIO.observe(t));
  }

  // ---------- lightbox: the photo flies out of its tile ----------
  const lb = $('#lightbox'), lbImg = $('#lbImg'), lbBg = $('.lb-bg', lb);
  const lbIdx = $('#lbIdx'), lbTotal = $('#lbTotal'), lbCap = $('#lbCap');
  let list = [], cur = 0, rect = null, busy = false, lastFocus = null;

  const arOf = tile => { const i = $('img', tile); return i.getAttribute('width') / i.getAttribute('height') || 0.667; };
  const fit = ar => {
    const vw = innerWidth, vhh = innerHeight, small = vw < 821;
    const top = small ? 74 : 92, bottom = small ? 96 : 56, side = small ? 12 : Math.max(110, vw * 0.09);
    const mw = vw - side * 2, mh = vhh - top - bottom;
    let w = mw, h = w / ar;
    if (h > mh) { h = mh; w = h * ar; }
    return { x: (vw - w) / 2, y: top + (mh - h) / 2, w, h };
  };
  const T = (r, dx = 0, dy = 0, s = 1) => `translate(${r.x + dx}px,${r.y + dy}px) scale(${s})`;
  const fromTile = (tile, r) => {
    const b = $('.tile-in', tile).getBoundingClientRect();
    return `translate(${b.left}px,${b.top}px) scale(${b.width / r.w},${b.height / r.h})`;
  };
  const place = r => {
    rect = r;
    lbImg.style.width = r.w + 'px';
    lbImg.style.height = r.h + 'px';
    lbImg.style.transform = T(r);
  };
  const lift = tile => tiles.forEach(t => (t.style.opacity = t === tile ? '0' : ''));
  const decoded = src => { const i = new Image(); i.src = src; return i.decode().then(() => i, () => i); };

  const loadFull = tile => {
    decoded(tile.dataset.full).then(() => { if (lbOpen && list[cur] === tile) lbImg.src = tile.dataset.full; });
    [1, -1].forEach(k => { const n = list[(cur + k + list.length) % list.length]; if (n) new Image().src = n.dataset.full; });
  };
  const updateUI = () => {
    const t = list[cur];
    lbIdx.textContent = String(cur + 1).padStart(2, '0');
    lbTotal.textContent = String(list.length).padStart(2, '0');
    lbCap.textContent = t.dataset.label || '';
    lbImg.alt = t.dataset.alt || '';
  };

  const openLb = tile => {
    if (lbOpen) return;
    list = tiles.filter(t => !t.classList.contains('hide'));
    cur = list.indexOf(tile);
    lastFocus = d.activeElement;
    lbOpen = true;
    lb.hidden = false;
    lock(true);
    const thumb = $('img', tile);
    lbImg.src = thumb.currentSrc || thumb.src;
    place(fit(arOf(tile)));
    updateUI();
    lift(tile);
    if (!reduce) lbImg.animate([{ transform: fromTile(tile, rect) }, { transform: T(rect) }], { duration: 950, easing: IO_EASE });
    raf(() => lb.classList.add('open'));
    loadFull(tile);
    lb.focus({ preventScroll: true });
  };

  const closeLb = () => {
    if (!lbOpen || busy) return;
    lbOpen = false;
    const tile = list[cur];
    const b = tile.getBoundingClientRect();
    const onScreen = b.bottom > 0 && b.top < innerHeight;
    lb.classList.remove('open');
    lbBg.style.opacity = '';
    const anim = reduce
      ? null
      : onScreen
        ? lbImg.animate([{ transform: lbImg.style.transform }, { transform: fromTile(tile, rect) }], { duration: 850, easing: IO_EASE, fill: 'forwards' })
        : lbImg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
    const done = () => {
      lb.hidden = true;
      anim?.cancel();
      lbImg.removeAttribute('src');
      lift(null);
    };
    anim ? (anim.onfinish = done) : done();
    lock(false);
    lastFocus?.focus({ preventScroll: true });
  };

  const go = (dir, fromDx = 0) => {
    if (busy || list.length < 2) return;
    busy = true;
    const next = (cur + dir + list.length) % list.length;
    const tile = list[next];
    const thumb = $('img', tile);
    const ready = decoded(thumb.currentSrc || thumb.src);
    const out = reduce ? null : lbImg.animate(
      [{ transform: T(rect, fromDx), opacity: 1 }, { transform: T(rect, -dir * 90, 0, 0.96), opacity: 0 }],
      { duration: 380, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' },
    );
    Promise.all([ready, out?.finished]).then(() => {
      cur = next;
      lbImg.src = thumb.currentSrc || thumb.src;
      place(fit(arOf(tile)));
      out?.cancel();
      updateUI();
      lift(tile);
      loadFull(tile);
      const inn = reduce ? null : lbImg.animate(
        [{ transform: T(rect, dir * 90, 0, 0.96), opacity: 0 }, { transform: T(rect), opacity: 1 }],
        { duration: 700, easing: OUT_EASE },
      );
      (inn ? inn.finished : Promise.resolve()).then(() => { busy = false; });
    });
  };

  if (lb) {
    tiles.forEach(t => t.addEventListener('click', () => openLb(t)));
    $('#lbClose').addEventListener('click', closeLb);
    $('#lbPrev').addEventListener('click', () => go(-1));
    $('#lbNext').addEventListener('click', () => go(1));
    lbBg.addEventListener('click', closeLb);
    addEventListener('keydown', e => {
      if (!lbOpen) return;
      if (e.key === 'Escape') closeLb();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'Tab') {
        const f = $$('button', lb);
        const i = f.indexOf(d.activeElement);
        if (i < 0) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); return; }
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });
    addEventListener('resize', () => { if (lbOpen && !busy) place(fit(arOf(list[cur]))); });

    // drag / swipe: sideways = next/previous, down = close
    let drag = null;
    lbImg.addEventListener('pointerdown', e => {
      if (busy || e.button > 0) return;
      drag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, axis: null };
      try { lbImg.setPointerCapture(e.pointerId); } catch {}
      lbImg.classList.add('dragging');
    });
    lbImg.addEventListener('pointermove', e => {
      if (!drag) return;
      drag.dx = e.clientX - drag.x;
      drag.dy = e.clientY - drag.y;
      if (!drag.axis && Math.hypot(drag.dx, drag.dy) > 8) drag.axis = Math.abs(drag.dx) > Math.abs(drag.dy) ? 'x' : 'y';
      if (drag.axis === 'x') lbImg.style.transform = T(rect, drag.dx);
      if (drag.axis === 'y') {
        const dy = Math.max(0, drag.dy);
        lbImg.style.transform = T(rect, 0, dy, 1 - Math.min(dy / innerHeight, 0.25));
        lbBg.style.opacity = String(1 - Math.min(dy / 500, 0.7));
      }
    });
    const endDrag = () => {
      if (!drag) return;
      const { dx, dy, axis } = drag;
      drag = null;
      lbImg.classList.remove('dragging');
      if (axis === 'x' && Math.abs(dx) > 70) return go(dx < 0 ? 1 : -1, dx);
      if (axis === 'y' && dy > 110) return closeLb();
      if (axis) {
        lbBg.style.opacity = '';
        const from = lbImg.style.transform;
        lbImg.style.transform = T(rect);
        if (!reduce) lbImg.animate([{ transform: from }, { transform: T(rect) }], { duration: 500, easing: OUT_EASE });
      }
    };
    lbImg.addEventListener('pointerup', endDrag);
    lbImg.addEventListener('pointercancel', endDrag);
  }

  // ---------- magnetic buttons, hover light (mouse only) ----------
  if (fine && !reduce) {
    $$('[data-magnetic]').forEach(el => {
      const k = el.classList.contains('logo') ? 0.35 : 0.22;
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        el.style.transition = 'transform .35s cubic-bezier(.16,1,.3,1)';
        el.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * k}px,${(e.clientY - r.top - r.height / 2) * k}px)`;
      });
      el.addEventListener('pointerleave', () => {
        el.style.transition = 'transform .9s cubic-bezier(.16,1,.3,1)';
        el.style.transform = '';
      });
    });

    const hero = $('.hero');
    if (hero) {
      let tx = 0, ty = 0, cx = 0, cy = 0, run = false;
      const tilt = () => {
        cx += (tx - cx) * 0.06;
        cy += (ty - cy) * 0.06;
        hero.style.setProperty('--mx', cx.toFixed(4));
        hero.style.setProperty('--my', cy.toFixed(4));
        run = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.001;
        if (run) raf(tilt);
      };
      hero.addEventListener('pointermove', e => {
        tx = e.clientX / innerWidth - 0.5;
        ty = e.clientY / innerHeight - 0.5;
        if (!run) { run = true; raf(tilt); }
      });
      hero.addEventListener('pointerleave', () => { tx = ty = 0; if (!run) { run = true; raf(tilt); } });
    }

    const contact = $('.contact');
    contact?.addEventListener('pointermove', e => {
      const r = contact.getBoundingClientRect();
      contact.style.setProperty('--gx', e.clientX - r.left + 'px');
      contact.style.setProperty('--gy', e.clientY - r.top + 'px');
    });
  }

  // ---------- footer name fills the width ----------
  const footName = $('.footer-name');
  const fitName = () => {
    if (!footName) return;
    const span = footName.firstElementChild;
    footName.style.fontSize = '';
    const w = span.getBoundingClientRect().width;
    if (w) footName.style.fontSize = (parseFloat(getComputedStyle(footName).fontSize) * footName.clientWidth) / w + 'px';
  };

  // ---------- comp card PDF ----------
  const ccData = $('#compcard-data');
  if (ccData) {
    let pdf = null;
    $$('[data-compcard]').forEach(btn => {
      btn.hidden = false;
      btn.addEventListener('click', async () => {
        if (btn.getAttribute('aria-busy') === 'true') return;
        const small = $('small', btn);
        btn.setAttribute('aria-busy', 'true');
        small.textContent = '…';
        try {
          const data = JSON.parse(ccData.textContent);
          const { buildCompCard, saveBlob } = await import('/compcard.js');
          pdf ||= await buildCompCard(data);
          saveBlob(pdf, `${data.name.replace(/[^\w]+/g, '-')}-comp-card.pdf`);
          small.textContent = 'PDF';
        } catch (err) {
          console.error(err);
          small.textContent = 'Error, retry';
        } finally {
          btn.removeAttribute('aria-busy');
        }
      });
    });
  }

  // ---------- once fonts are in, sizes are final ----------
  const settle = () => { fitName(); measure(); onScroll(); };
  (d.fonts?.ready || Promise.resolve()).then(settle);
  addEventListener('load', settle);
  let rz;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(fitName, 120); });
})();
