(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];

  // Nav: scrolled state + mobile menu
  const nav = $('#nav'), burger = $('#burger'), links = $('.nav-links');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 40);
  onScroll();
  addEventListener('scroll', onScroll, { passive: true });
  const setMenu = open => {
    links.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', open);
    document.body.style.overflow = open ? 'hidden' : '';
  };
  burger.addEventListener('click', () => setMenu(!links.classList.contains('open')));
  $$('a', links).forEach(a => a.addEventListener('click', () => setMenu(false)));

  // Reveal on scroll
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: .12, rootMargin: '0px 0px -40px 0px' });
  $$('.reveal').forEach(el => io.observe(el));

  // Gallery: filter + staggered columns
  const gallery = $('#gallery');
  const tiles = $$('.tile', gallery);
  const chips = $$('.chip');

  const layout = () => {
    const cols = getComputedStyle(gallery).gridTemplateColumns.split(' ').length;
    let i = 0;
    tiles.forEach(t => {
      if (t.classList.contains('hide')) return;
      t.classList.toggle('offset', cols > 2 && i % cols % 2 === 1);
      i++;
    });
  };

  const applyFilter = f => {
    chips.forEach(c => {
      const on = c.dataset.filter === f;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-selected', on);
    });
    tiles.forEach(t => t.classList.add('fading'));
    setTimeout(() => {
      tiles.forEach(t => t.classList.toggle('hide', f !== 'all' && t.dataset.cat !== f));
      layout();
      requestAnimationFrame(() => tiles.forEach(t => t.classList.remove('fading')));
    }, 280);
  };
  chips.forEach(c => c.addEventListener('click', () => applyFilter(c.dataset.filter)));
  addEventListener('resize', layout);
  layout();

  // Lightbox
  const lb = $('#lightbox'), lbImg = $('#lbImg'), lbCap = $('#lbCap');
  let current = 0, shown = [];
  const visible = () => tiles.filter(t => !t.classList.contains('hide'));

  const show = i => {
    current = (i + shown.length) % shown.length;
    const t = shown[current];
    lbImg.classList.add('swap');
    const img = new Image();
    img.onload = () => {
      lbImg.src = img.src;
      lbImg.alt = t.dataset.alt;
      lbCap.textContent = `${t.dataset.cat.charAt(0).toUpperCase() + t.dataset.cat.slice(1)} — ${current + 1} / ${shown.length}`;
      lbImg.classList.remove('swap');
    };
    img.src = t.dataset.full;
    // preload neighbours
    [1, -1].forEach(d => { new Image().src = shown[(current + d + shown.length) % shown.length].dataset.full; });
  };

  let lastFocus = null;
  const open = t => {
    shown = visible();
    lastFocus = document.activeElement;
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => lb.classList.add('open'));
    show(shown.indexOf(t));
    $('#lbClose').focus();
  };
  const close = () => {
    lb.classList.remove('open');
    setTimeout(() => { lb.hidden = true; }, 300);
    document.body.style.overflow = '';
    lastFocus && lastFocus.focus();
  };

  tiles.forEach(t => t.addEventListener('click', () => open(t)));
  $('#lbClose').addEventListener('click', close);
  $('#lbPrev').addEventListener('click', () => show(current - 1));
  $('#lbNext').addEventListener('click', () => show(current + 1));
  lb.addEventListener('click', e => { if (e.target === lb || e.target.tagName === 'FIGURE') close(); });
  addEventListener('keydown', e => {
    if (lb.hidden) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') show(current - 1);
    if (e.key === 'ArrowRight') show(current + 1);
  });

  // Swipe
  let sx = 0;
  lb.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 50) show(current + (dx < 0 ? 1 : -1));
  });

  $('#year').textContent = new Date().getFullYear();
})();
