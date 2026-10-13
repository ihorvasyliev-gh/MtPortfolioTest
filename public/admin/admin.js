(() => {
  'use strict';

  // ---------- tiny helpers ----------
  const $ = (s, c = document) => c.querySelector(s);
  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    el.append(...kids.flat().filter(x => x != null && x !== false));
    return el;
  };
  const imgUrl = key => (key.startsWith('/') ? key : '/img/' + key);
  const isR2 = key => !key.startsWith('/');
  const rid = () => [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, '0')).join('');

  let content = null;
  let dirty = false;
  let tab = 'photos';
  let busy = false;
  const toDelete = new Set(); // R2 keys to remove after a successful publish
  const fresh = new Set(); // ids to highlight after upload

  // ---------- api ----------
  const api = async (path, opts = {}) => {
    const res = await fetch(path, {
      credentials: 'same-origin',
      ...opts,
      headers: { 'x-requested-with': 'admin', ...(opts.json ? { 'content-type': 'application/json' } : {}), ...opts.headers },
      body: opts.json ? JSON.stringify(opts.json) : opts.body,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/api/login') showLogin();
    if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
    return data;
  };

  // ---------- ui chrome ----------
  const toastEl = $('#toast');
  let toastTimer;
  const toast = (msg, err = false) => {
    toastEl.textContent = msg;
    toastEl.classList.toggle('err', err);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), err ? 5000 : 2600);
  };

  const setDirty = v => {
    dirty = v;
    $('#publish').disabled = !v || busy;
    const s = $('#status');
    s.textContent = v ? '● Unpublished changes' : '✓ Everything is published';
    s.className = 'status ' + (v ? 'dirty' : 'ok');
  };
  const touch = () => setDirty(true);
  addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  const unboot = () => {
    const b = $('#boot');
    if (!b) return;
    b.classList.add('gone');
    setTimeout(() => b.remove(), 600);
  };

  const showLogin = () => {
    unboot();
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#password').focus();
  };

  // ---------- form building blocks ----------
  const input = (obj, key, { type = 'text', rows, ...attrs } = {}) => {
    const el = rows
      ? h('textarea', { rows, ...attrs }, obj[key] ?? '')
      : h('input', { type, value: obj[key] ?? '', ...attrs });
    el.addEventListener('input', () => { obj[key] = el.value; touch(); });
    return el;
  };
  const field = (label, obj, key, { hint, ...opts } = {}) =>
    h('label', { class: 'field' }, h('span', {}, label), input(obj, key, opts), hint && h('small', {}, hint));

  const move = (arr, i, d) => {
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    touch();
    render();
  };

  /** Editable list of objects. `fields` = [{key,label,rows?,placeholder?}] */
  const repeater = (arr, fields, blank, addLabel, max = 20) =>
    h('div', {},
      arr.map((item, i) =>
        h('div', { class: 'item' },
          h('div', { class: fields.length > 2 ? 'stack' : 'row2' },
            fields.map(f => field(f.label, item, f.key, { rows: f.rows, placeholder: f.placeholder, maxlength: f.max }))),
          h('div', { class: 'item-tools' },
            h('button', { title: 'Move up', disabled: i === 0, onclick: () => move(arr, i, -1) }, '↑'),
            h('button', { title: 'Move down', disabled: i === arr.length - 1, onclick: () => move(arr, i, 1) }, '↓'),
            h('button', { class: 'del', title: 'Delete', onclick: () => { arr.splice(i, 1); touch(); render(); } }, '✕')))),
      arr.length < max && h('button', { class: 'btn', onclick: () => { arr.push(blank()); touch(); render(); } }, '+ ' + addLabel));

  // ---------- image processing (client side, so phone photos upload fast) ----------
  async function decode(file) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
      } finally { URL.revokeObjectURL(url); }
    }
  }

  async function encode(src, longEdge, quality) {
    const sw = src.width, sh = src.height;
    const scale = Math.min(1, longEdge / Math.max(sw, sh));
    const w = Math.round(sw * scale), hgt = Math.round(sh * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = hgt;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, hgt);
    let blob = await new Promise(r => canvas.toBlob(r, 'image/webp', quality));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    return { blob, w, h: hgt };
  }

  async function uploadOne(file) {
    const src = await decode(file);
    const id = rid();
    const [full, thumb] = await Promise.all([encode(src, 2200, 0.86), encode(src, 900, 0.8)]);
    src.close?.();
    const put = (v, blob) => api(`/api/admin/upload?id=${id}&v=${v}`, { method: 'POST', body: blob, headers: { 'content-type': blob.type } });
    const f = await put('full', full.blob);
    let t;
    try {
      t = await put('thumb', thumb.blob);
    } catch (e) {
      api('/api/admin/object?key=' + encodeURIComponent(f.key), { method: 'DELETE' }).catch(() => {});
      throw e;
    }
    const last = content.photos[content.photos.length - 1];
    content.photos.push({
      id, cat: '', group: last?.group || '', alt: `${content.site.name} — portfolio photo`,
      full: f.key, thumb: t.key, w: thumb.w, h: thumb.h,
    });
    fresh.add(id);
    return id;
  }

  async function uploadFiles(files) {
    files = [...files].filter(f => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
    if (!files.length) return toast('Choose image files', true);
    const bar = $('.progress > i');
    const label = $('#uploadLabel');
    let ok = 0, failed = [];
    busy = true; $('#publish').disabled = true;
    for (const [i, file] of files.entries()) {
      if (label) label.textContent = `Uploading ${i + 1} of ${files.length}…`;
      if (bar) bar.style.width = (i / files.length) * 100 + '%';
      try { await uploadOne(file); ok++; }
      catch (e) { failed.push(file.name + (e.status ? ` (${e.message})` : '')); }
    }
    busy = false;
    if (ok) touch(); else setDirty(dirty);
    render();
    if (ok) {
      toast(`Uploaded: ${ok}. Press “Publish” to show them on the site.`);
      requestAnimationFrame(() => document.querySelector('.ph.fresh')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
    if (failed.length) toast('Upload failed: ' + failed.join(', '), true);
  }

  // ---------- dialogs ----------
  const dlg = $('#dialog');
  const openDialog = (node, wide = false) => { dlg.classList.toggle('wide', wide); dlg.replaceChildren(node); if (!dlg.open) dlg.showModal(); };
  const closeDialog = () => dlg.open && dlg.close();
  dlg.addEventListener('click', e => { if (e.target === dlg) closeDialog(); });

  const usedAsSpecial = p => [content.hero.image.full, content.about.image.full].includes(p.full);

  function editPhoto(p) {
    const groups = [...new Set(content.photos.map(x => x.group).filter(Boolean))];
    const dl = h('datalist', { id: 'groups' }, groups.map(g => h('option', { value: g })));
    const cat = h('select', { onchange: e => { p.cat = e.target.value; touch(); } },
      h('option', { value: '' }, 'No category'),
      content.categories.map(c => h('option', { value: c.id, selected: c.id === p.cat }, c.label)));
    openDialog(h('div', { class: 'dlg' },
      h('img', { class: 'dlg-img', src: imgUrl(p.thumb), alt: '' }),
      field('Photo description (for search and screen readers)', p, 'alt', { rows: 2 }),
      h('label', { class: 'field' }, h('span', {}, 'Category'), cat),
      h('label', { class: 'field' },
        h('span', {}, 'Section caption on the site'),
        input(p, 'group', { list: 'groups', placeholder: 'e.g. Portfolio shoot' }),
        h('small', {}, 'Photos with the same caption are grouped under one heading. Without a category a photo only shows under All.'), dl),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: !!p.hidden, onchange: e => { p.hidden = e.target.checked || undefined; touch(); render(); } }),
        'Hide from gallery'),
      h('div', { class: 'dlg-actions' },
        h('button', { class: 'btn small', onclick: () => { content.hero.image = { full: p.full, alt: p.alt }; touch(); closeDialog(); render(); toast('Main photo updated'); } }, 'Make main photo'),
        h('button', { class: 'btn small', onclick: () => { content.about.image = { full: p.full, alt: p.alt }; touch(); closeDialog(); render(); toast('About photo updated'); } }, 'About photo')),
      h('div', { class: 'dlg-actions' },
        h('button', { class: 'btn danger small', onclick: () => removePhoto(p) }, 'Delete'),
        h('button', { class: 'btn primary grow', onclick: () => { closeDialog(); render(); } }, 'Done'))));
  }

  function removePhoto(p) {
    if (usedAsSpecial(p)) return toast('This photo is used as the main or About photo. Replace it there first.', true);
    if (!confirm('Delete this photo? It disappears from the site after you publish.')) return;
    content.photos.splice(content.photos.indexOf(p), 1);
    if (content.compcard) content.compcard.photos = content.compcard.photos.map(id => (id === p.id ? '' : id));
    if (isR2(p.full)) toDelete.add(p.full);
    if (isR2(p.thumb)) toDelete.add(p.thumb);
    touch(); closeDialog(); render();
  }

  function pickPhoto(title, onPick, currentKey) {
    openDialog(h('div', { class: 'dlg' },
      h('h3', {}, title),
      h('div', { class: 'picker' },
        content.photos.map(p =>
          h('button', { class: p.full === currentKey ? 'cur' : '', title: p.alt, onclick: () => { onPick(p); closeDialog(); touch(); render(); } },
            h('img', { src: imgUrl(p.thumb), alt: p.alt, loading: 'lazy' })))),
      content.photos.length === 0 && h('p', { class: 'lead' }, 'Upload photos in the Photos tab first.'),
      h('button', { class: 'btn', onclick: closeDialog }, 'Cancel')));
  }

  const imagePicker = (label, target) =>
    h('div', { class: 'pick' },
      h('img', { src: imgUrl(target.image.full), alt: '' }),
      h('div', {},
        h('strong', {}, label),
        h('button', { class: 'btn small', onclick: () => pickPhoto(label, p => { target.image = { full: p.full, alt: p.alt }; }, target.image.full) }, 'Choose another photo')));

  // ---------- comp card ----------
  // Same rule as the server: an empty slot is filled with the hero photo, then visible photos in order.
  function ccSlots() {
    const byId = new Map(content.photos.map(p => [p.id, p]));
    const wanted = content.compcard?.photos || [];
    const slots = [0, 1, 2, 3, 4].map(k => (byId.has(wanted[k]) ? wanted[k] : ''));
    const pool = [content.photos.find(p => p.full === content.hero.image.full && !p.hidden), ...content.photos.filter(p => !p.hidden)]
      .filter(Boolean)
      .map(p => p.id);
    const taken = new Set(slots.filter(Boolean));
    return slots
      .map(id => {
        if (id) return { id, auto: false };
        const next = pool.find(x => !taken.has(x));
        if (next) taken.add(next);
        return { id: next || '', auto: true };
      })
      .filter(x => x.id);
  }

  function setCcSlot(k, id) {
    const ids = [0, 1, 2, 3, 4].map(i => content.compcard?.photos?.[i] || '');
    const was = ids.indexOf(id);
    if (was >= 0) ids[was] = ids[k];
    ids[k] = id;
    content.compcard = { photos: ids };
  }

  const ccData = () => {
    const s = content.site;
    const byId = new Map(content.photos.map(p => [p.id, p]));
    return {
      name: s.name, role: s.role, location: s.location, email: s.email, instagram: s.instagram,
      url: location.origin, stats: content.stats, traits: content.traits,
      photos: ccSlots().map(x => byId.get(x.id)).map(p => ({ src: imgUrl(p.full), w: p.w, h: p.h })),
    };
  };

  async function ccDownload() {
    try {
      const { buildCompCard, saveBlob } = await import('/compcard.js');
      saveBlob(await buildCompCard(ccData()), `${content.site.name.replace(/[^\w]+/g, '-')}-comp-card.pdf`);
    } catch (e) {
      toast('Could not build the PDF: ' + e.message, true);
    }
  }

  async function ccPreview() {
    openDialog(h('div', { class: 'dlg' }, h('h3', {}, 'Comp card'), h('div', { class: 'spinner' }), h('p', { class: 'lead' }, 'Building pages…')), true);
    try {
      const { renderPages } = await import('/compcard.js');
      const pages = await renderPages(ccData());
      pages.forEach(p => (p.canvas.className = 'cc-page'));
      openDialog(h('div', { class: 'dlg' },
        h('h3', {}, 'Comp card preview'),
        h('div', { class: 'cc-preview' }, pages.map(p => p.canvas)),
        dirty && h('p', { class: 'lead' }, 'This includes unpublished changes. The comp card on the site updates after you press “Publish”.'),
        h('div', { class: 'dlg-actions' },
          h('button', { class: 'btn', onclick: closeDialog }, 'Close'),
          h('button', { class: 'btn primary grow', onclick: ccDownload }, 'Download PDF'))), true);
    } catch (e) {
      closeDialog();
      toast('Could not build the comp card: ' + e.message, true);
    }
  }

  function compCardCard() {
    const byId = new Map(content.photos.map(p => [p.id, p]));
    const slots = ccSlots();
    return h('div', { class: 'card' },
      h('h3', {}, 'Comp card (PDF)'),
      h('p', { class: 'lead' }, 'A card for agencies and castings: a cover plus 4 photos on the back, with the measurements and contacts from here. Visitors download it with the “Download comp card” button on the site. Click a photo to replace it.'),
      slots.length
        ? h('div', { class: 'cc-slots' }, [0, 1, 2, 3, 4].map(k => {
            const x = slots[k];
            const p = x && byId.get(x.id);
            return h('button', {
              class: 'cc-slot' + (k === 0 ? ' cover' : ''),
              title: 'Choose another photo',
              onclick: () => pickPhoto(k ? `Back photo ${k}` : 'Comp card cover', ph => setCcSlot(k, ph.id), p?.full),
            },
            p && h('img', { src: imgUrl(p.thumb), alt: '' }),
            h('span', {}, k ? `Back · ${k}` : 'Cover', x?.auto && h('i', {}, 'auto')));
          }))
        : h('p', { class: 'lead' }, 'Upload photos in the Photos tab first.'),
      slots.length > 0 && h('div', { class: 'dlg-actions' },
        h('button', { class: 'btn', onclick: ccPreview }, 'Preview'),
        h('button', { class: 'btn', onclick: ccDownload }, 'Download PDF')));
  }

  // ---------- visit stats ----------
  let statsDays = 30, stats = null, statsErr = '', statsLoading = false;
  const loadStats = async () => {
    if (statsLoading) return;
    statsLoading = true; statsErr = '';
    try { stats = await api('/api/admin/stats?days=' + statsDays); stats.at = new Date(); } catch (e) { statsErr = e.message; }
    statsLoading = false;
    if (tab === 'visits') render();
  };
  // Live while the Visits tab is on screen: every 30 s and whenever the window comes back into view.
  const refreshStats = () => { if (tab === 'visits' && !document.hidden && !$('#dialog').open) loadStats(); };
  setInterval(refreshStats, 30000);
  document.addEventListener('visibilitychange', refreshStats);
  const num = n => Number(n || 0).toLocaleString('en-IE');
  const regionName = (() => { try { const d = new Intl.DisplayNames(['en'], { type: 'region' }); return c => { try { return d.of(c); } catch { return c; } }; } catch { return c => c; } })();
  const flag = c => (/^[A-Z]{2}$/.test(c || '') ? String.fromCodePoint(...[...c].map(x => 0x1f1a5 + x.charCodeAt(0))) : '');
  const country = c => (c && c !== 'XX' && c !== 'T1' ? `${flag(c)} ${regionName(c)}` : 'Unknown');
  const DEVICE = { mobile: 'Phone', tablet: 'Tablet', desktop: 'Desktop' };
  const ACTION = { email: 'Clicked email', instagram: 'Opened Instagram', phone: 'Clicked phone' };
  const dayLabel = (day, long) => new Date(day + 'T12:00:00').toLocaleDateString('en-IE', long ? { weekday: 'short', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short' });

  const fillDays = s => {
    const by = Object.fromEntries(s.daily.map(r => [r.day, r]));
    const out = [];
    for (let t = new Date(s.since + 'T12:00:00'); ; t.setDate(t.getDate() + 1)) {
      const day = t.toLocaleDateString('en-CA');
      out.push({ day, visitors: by[day]?.visitors || 0, views: by[day]?.views || 0 });
      if (day >= s.today || out.length > 400) break;
    }
    return out;
  };

  const SVG = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs = {}) => { const el = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };

  // Single-series bar chart of daily visitors; every bar has a hover/focus tooltip.
  const dayChart = rows => {
    const W = innerWidth < 640 ? 360 : 720, H = innerWidth < 640 ? 170 : 200, top = 12, bottom = 26, left = 30;
    const max = Math.max(1, ...rows.map(r => r.visitors));
    const step = Math.max(1, Math.ceil(max / 4)), yMax = step * Math.ceil(max / step);
    const bw = (W - left) / rows.length, gap = Math.min(2, bw * 0.25);
    const y = v => top + (H - top - bottom) * (1 - v / yMax);
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Visitors per day' });
    for (let v = 0; v <= yMax; v += step) {
      svg.append(sv('line', { x1: left, x2: W, y1: y(v), y2: y(v), class: v ? 'grid' : 'base' }));
      const t = sv('text', { x: left - 8, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }); t.textContent = v; svg.append(t);
    }
    const tip = h('div', { class: 'tip', hidden: true });
    const every = Math.ceil(rows.length / (W < 500 ? 4 : 7));
    rows.forEach((r, i) => {
      const x = left + i * bw;
      if (r.visitors) {
        const bh = H - bottom - y(r.visitors), rad = Math.min(4, (bw - gap) / 2, bh);
        const w = bw - gap, x0 = x + gap / 2, y0 = y(r.visitors), yb = H - bottom;
        svg.append(sv('path', { class: 'bar', d: `M${x0},${yb}V${y0 + rad}Q${x0},${y0} ${x0 + rad},${y0}H${x0 + w - rad}Q${x0 + w},${y0} ${x0 + w},${y0 + rad}V${yb}Z` }));
      }
      if (i % every === 0 || i === rows.length - 1 && rows.length <= 7) {
        const t = sv('text', { x: x + bw / 2, y: H - 8, class: 'axis', 'text-anchor': 'middle' }); t.textContent = dayLabel(r.day); svg.append(t);
      }
      const hit = sv('rect', { x, y: top, width: bw, height: H - top - bottom, class: 'hit', tabindex: '0' });
      const show = () => {
        tip.replaceChildren(h('b', {}, dayLabel(r.day, true)), h('span', {}, `Visitors: ${num(r.visitors)}`), h('span', {}, `Page views: ${num(r.views)}`));
        tip.hidden = false;
        tip.style.left = `${Math.min(88, Math.max(12, ((x + bw / 2) / W) * 100))}%`;
        hit.classList.add('on');
      };
      const hide = () => { tip.hidden = true; hit.classList.remove('on'); };
      hit.addEventListener('pointerenter', show); hit.addEventListener('focus', show);
      hit.addEventListener('pointerleave', hide); hit.addEventListener('blur', hide);
      svg.append(hit);
    });
    const table = h('details', { class: 'days-table' }, h('summary', {}, 'Table by day'),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Day'), h('th', {}, 'Visitors'), h('th', {}, 'Page views'))),
        h('tbody', {}, [...rows].reverse().map(r => h('tr', {}, h('td', {}, dayLabel(r.day, true)), h('td', {}, num(r.visitors)), h('td', {}, num(r.views)))))));
    return h('div', {}, h('div', { class: 'chart-wrap' }, svg, tip), table);
  };

  const topList = (title, rows, label) => {
    const max = Math.max(1, ...rows.map(r => r.n));
    return h('div', { class: 'card' }, h('h3', {}, title),
      rows.length
        ? h('ul', { class: 'toplist' }, rows.map(r => h('li', {},
            h('span', { class: 'tl-label' }, label(r)), h('span', { class: 'tl-n' }, num(r.n)),
            h('span', { class: 'tl-bar' }, h('i', { style: `width:${Math.max(2, (r.n / max) * 100)}%` })))))
        : h('p', { class: 'lead' }, 'No data yet.'));
  };

  const visitsBody = () => {
    if (statsErr) return h('div', { class: 'card' }, h('p', { class: 'error' }, 'Could not load: ' + statsErr), h('button', { class: 'btn', onclick: loadStats }, 'Retry'));
    if (stats && !stats.enabled) return h('div', { class: 'card' }, h('p', { class: 'lead' }, 'Stats are not connected: the site has no D1 database (DB binding).'));
    if (!stats || stats.days !== statsDays) { loadStats(); return h('p', { class: 'lead' }, 'Loading…'); }
    const s = stats;
    const rows = fillDays(s);
    const visitors = rows.reduce((a, r) => a + r.visitors, 0), views = rows.reduce((a, r) => a + r.views, 0);
    const act = (type, k) => s.actions.filter(a => a.type === type && (k == null || a.k === k)).reduce((a, r) => a + r.n, 0);
    const photoViews = s.photos.reduce((a, r) => a + r.n, 0);
    const byId = Object.fromEntries(content.photos.map(p => [p.id, p]));
    const tile = (label, value, hint) => h('div', { class: 'kpi' }, h('span', {}, label), h('strong', {}, num(value)), hint && h('small', {}, hint));
    const time = ts => new Date(ts).toLocaleString('en-IE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return h('div', {},
      h('div', { class: 'kpis' },
        tile('Visitors', visitors, 'unique per day'),
        tile('Page views', views),
        tile('Photo views', photoViews),
        tile('Comp card', act('compcard'), 'downloads'),
        tile('Contact clicks', act('contact'), 'email, Instagram')),
      h('div', { class: 'card' }, h('h3', {}, 'Visitors per day'), visitors ? dayChart(rows) : h('p', { class: 'lead' }, 'No visits in this period yet. Your own visits (while signed in to admin) are not counted.')),
      h('div', { class: 'cols' },
        topList('Sources', s.refs, r => r.k || 'Direct / unknown'),
        topList('Countries', s.countries, r => country(r.k)),
        topList('Cities', s.cities, r => `${flag(r.c)} ${r.k}`),
        topList('Devices', s.devices, r => DEVICE[r.k] || r.k),
        topList('Browsers', s.browsers, r => r.k)),
      h('div', { class: 'card' }, h('h3', {}, 'Most viewed photos'),
        s.photos.length
          ? h('div', { class: 'grid top-photos' }, s.photos.map(r => {
              const p = byId[r.k];
              return h('div', { class: 'tp' }, p ? h('img', { src: imgUrl(p.thumb), alt: p.alt, loading: 'lazy' }) : h('div', { class: 'tp-gone' }, 'deleted'), h('span', {}, `${num(r.n)} views`));
            }))
          : h('p', { class: 'lead' }, 'No one has opened a photo yet.')),
      h('div', { class: 'card' }, h('h3', {}, 'Actions'),
        h('ul', { class: 'toplist' }, [['Downloaded comp card', act('compcard')], ...Object.entries(ACTION).map(([k, l]) => [l, act('contact', k)])].map(([l, n]) =>
          h('li', {}, h('span', { class: 'tl-label' }, l), h('span', { class: 'tl-n' }, num(n)))))),
      h('div', { class: 'card' }, h('h3', {}, 'Recent visits'),
        s.recent.length
          ? h('ul', { class: 'recent' }, s.recent.map(r => h('li', {},
              h('time', {}, time(r.ts)),
              h('span', {}, [country(r.country), r.city].filter(Boolean).join(', ')),
              h('span', { class: 'muted' }, [r.ref || 'direct', DEVICE[r.device] || r.device, r.browser].join(' · ')))))
          : h('p', { class: 'lead' }, 'No visits yet.')),
      h('p', { class: 'lead small' }, 'No cookies and no IP addresses: a visitor is only recognised within one day, so “visitors” for a period is the sum of the daily counts. Bots and your own visits while signed in to admin are not counted. Data is kept for 400 days.'));
  };

  // ---------- tabs ----------
  const tabs = {
    photos() {
      const c = content;
      let dragIdx = null;
      const inCompCard = new Set(ccSlots().map(x => x.id));
      const grid = h('div', { class: 'grid' }, c.photos.map((p, i) => {
        const cat = c.categories.find(x => x.id === p.cat);
        const card = h('div', { class: `ph${p.hidden ? ' ph-hidden' : ''}${fresh.has(p.id) ? ' fresh' : ''}`, draggable: 'true' },
          h('button', { class: 'ph-img', onclick: () => editPhoto(p), 'aria-label': 'Edit photo' },
            h('img', { src: imgUrl(p.thumb), alt: p.alt, loading: 'lazy' }),
            h('span', { class: 'ph-tags' },
              cat ? h('span', { class: 'tag' }, cat.label) : h('span', { class: 'tag warn' }, 'no category'),
              p.hidden && h('span', { class: 'tag' }, 'hidden'),
              p.full === c.hero.image.full && h('span', { class: 'tag gold' }, 'main'),
              inCompCard.has(p.id) && h('span', { class: 'tag' }, 'comp card'))),
          h('div', { class: 'ph-bar' },
            h('button', { title: 'Earlier', disabled: i === 0, onclick: () => move(c.photos, i, -1) }, '←'),
            h('button', { title: 'Edit', onclick: () => editPhoto(p) }, '✎'),
            h('button', { title: 'Later', disabled: i === c.photos.length - 1, onclick: () => move(c.photos, i, 1) }, '→')));
        card.addEventListener('dragstart', e => { dragIdx = i; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'photo'); });
        card.addEventListener('dragend', () => { dragIdx = null; card.classList.remove('dragging'); });
        card.addEventListener('dragover', e => { if (dragIdx !== null) { e.preventDefault(); card.classList.add('drop-target'); } });
        card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
        card.addEventListener('drop', e => {
          if (dragIdx === null) return;
          e.preventDefault();
          const [m] = c.photos.splice(dragIdx, 1);
          c.photos.splice(i, 0, m);
          touch(); render();
        });
        return card;
      }));

      const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: e => { uploadFiles(e.target.files); e.target.value = ''; } });
      const drop = h('div', { class: 'drop' },
        h('button', { class: 'btn primary', onclick: () => fileInput.click() }, '+ Add photos'),
        h('span', { id: 'uploadLabel' }, 'You can pick several at once: from the gallery on a phone, or drag them here on a computer'),
        h('div', { class: 'progress' }, h('i')), fileInput);
      drop.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); drop.classList.add('over'); } });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); uploadFiles(e.dataTransfer.files); });

      const cats = h('div', { class: 'card' },
        h('h3', {}, 'Categories (gallery filters)'),
        c.categories.map((k, i) =>
          h('div', { class: 'cat' }, input(k, 'label', { maxlength: 40 }),
            h('button', { title: 'Delete category', onclick: () => {
              if (c.photos.some(p => p.cat === k.id)) return toast('This category still has photos. Move them first', true);
              c.categories.splice(i, 1); touch(); render();
            } }, '✕'))),
        h('button', { class: 'btn', onclick: () => {
          const label = prompt('New category name');
          if (!label?.trim()) return;
          const id = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cat-' + rid().slice(0, 4);
          c.categories.push({ id: c.categories.some(x => x.id === id) ? id + '-' + rid().slice(0, 3) : id, label: label.trim() });
          touch(); render();
        } }, '+ New category'));

      return [
        h('h2', {}, 'Photos'),
        h('p', { class: 'lead' }, 'Click a photo to edit its description or category, or to delete it. Arrows change the order; on a computer you can also drag photos.'),
        drop,
        c.photos.length ? grid : h('p', { class: 'lead' }, 'No photos yet.'),
        h('div', { style: 'height:24px' }),
        cats,
      ];
    },

    profile() {
      const { hero, about } = content;
      return [
        h('h2', {}, 'Profile'),
        h('p', { class: 'lead' }, 'The opening screen and the About section.'),
        h('div', { class: 'card' },
          h('h3', {}, 'Opening screen'),
          h('div', { class: 'stack' },
            imagePicker('Main photo', hero),
            field('Line under the name', hero, 'lede', { rows: 3 }))),
        h('div', { class: 'card' },
          h('h3', {}, 'About'),
          h('div', { class: 'stack' },
            imagePicker('About photo', about),
            field('Heading', about, 'heading', { hint: 'A word in *asterisks* becomes gold italic: A classic *look.*' }),
            h('div', {}, h('p', { class: 'lead' }, 'Paragraphs'),
              h('div', {}, about.paragraphs.map((_, i) =>
                h('div', { class: 'item' },
                  input(about.paragraphs, i, { rows: 4 }),
                  h('div', { class: 'item-tools' },
                    h('button', { disabled: i === 0, onclick: () => move(about.paragraphs, i, -1) }, '↑'),
                    h('button', { disabled: i === about.paragraphs.length - 1, onclick: () => move(about.paragraphs, i, 1) }, '↓'),
                    h('button', { class: 'del', onclick: () => { about.paragraphs.splice(i, 1); touch(); render(); } }, '✕'))))),
              about.paragraphs.length < 6 && h('button', { class: 'btn', onclick: () => { about.paragraphs.push(''); touch(); render(); } }, '+ Paragraph')))),
        h('div', { class: 'card' },
          h('h3', {}, 'Quick facts (languages, skills…)'),
          repeater(about.facts, [{ key: 'label', label: 'Name', max: 60 }, { key: 'value', label: 'Value', max: 200 }], () => ({ label: '', value: '' }), 'Add row', 8)),
      ];
    },

    services() {
      return [
        h('h2', {}, 'Services'),
        h('p', { class: 'lead' }, 'The “Available for” section: the kinds of shoots you offer.'),
        repeater(content.services, [{ key: 'title', label: 'Name', max: 60 }, { key: 'text', label: 'Description', max: 200 }], () => ({ title: '', text: '' }), 'Add service'),
      ];
    },

    stats() {
      return [
        h('h2', {}, 'Measurements'),
        h('p', { class: 'lead' }, 'The “Measurements” section on the site and the comp card data.'),
        h('div', { class: 'card' },
          h('h3', {}, 'Key figures'),
          repeater(content.stats, [{ key: 'value', label: 'Value', placeholder: '168', max: 40 }, { key: 'unit', label: 'Unit (optional)', placeholder: 'cm', max: 10 }, { key: 'label', label: 'Label', placeholder: 'Height', max: 60 }], () => ({ value: '', unit: '', label: '' }), 'Add figure', 8)),
        h('div', { class: 'card' },
          h('h3', {}, 'Appearance'),
          repeater(content.traits, [{ key: 'label', label: 'Name', placeholder: 'Eyes', max: 60 }, { key: 'value', label: 'Value', max: 200 }], () => ({ label: '', value: '' }), 'Add', 9)),
        compCardCard(),
      ];
    },

    visits() {
      return [
        h('h2', {}, 'Visits'),
        h('div', { class: 'periods', role: 'group', 'aria-label': 'Period' },
          [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, 'Year']].map(([d, l]) =>
            h('button', { class: 'chip', 'aria-pressed': String(d === statsDays), onclick: () => { statsDays = d; render(); } }, l)),
          h('button', { class: 'chip', title: 'Refresh', onclick: loadStats }, '↻'),
          stats?.at && h('span', { class: 'updated' }, 'Updated ' + stats.at.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))),
        visitsBody(),
      ];
    },

    settings() {
      const { site, contact } = content;
      return [
        h('h2', {}, 'Contact and site details'),
        h('div', { class: 'card' },
          h('h3', {}, '“Contact” section'),
          h('div', { class: 'stack' },
            field('Heading', contact, 'heading', { rows: 2, hint: 'A new line is a line break. *Asterisks* make gold italic.' }),
            field('Text under the heading', contact, 'note', { rows: 3 }))),
        h('div', { class: 'card' },
          h('h3', {}, 'Contacts'),
          h('div', { class: 'stack' },
            field('Email', site, 'email', { type: 'email', inputmode: 'email' }),
            field('Instagram (without @)', site, 'instagram', { placeholder: 'rebel_in_cork', autocapitalize: 'none' }))),
        h('div', { class: 'card' },
          h('h3', {}, 'Site'),
          h('div', { class: 'stack' },
            field('Name', site, 'name'),
            h('div', { class: 'row2' }, field('Profession', site, 'role'), field('City', site, 'location')),
            field('Description for Google and social media', site, 'description', { rows: 3, hint: 'Shown in search results and link previews.' }))),
        h('button', { class: 'btn', onclick: async () => {
          if (dirty && !confirm('You have unpublished changes. Sign out without saving?')) return;
          await api('/api/logout', { method: 'POST' }).catch(() => {});
          dirty = false; location.reload();
        } }, 'Sign out'),
      ];
    },
  };

  function render(enter = false) {
    for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', b.dataset.tab === tab);
    const el = $('#content');
    el.replaceChildren(...tabs[tab]());
    if (enter) {
      el.classList.remove('enter');
      void el.offsetWidth;
      el.classList.add('enter');
    }
  }

  // ---------- publish ----------
  async function publish() {
    if (busy) return;
    busy = true; $('#publish').disabled = true; $('#publish').textContent = 'Publishing…';
    try {
      const saved = await api('/api/admin/content', { method: 'PUT', json: content });
      content = saved;
      const referenced = new Set(saved.photos.flatMap(p => [p.full, p.thumb]).concat(saved.hero.image.full, saved.about.image.full));
      await Promise.all([...toDelete].filter(k => !referenced.has(k)).map(k =>
        api('/api/admin/object?key=' + encodeURIComponent(k), { method: 'DELETE' }).catch(() => {})));
      toDelete.clear(); fresh.clear();
      busy = false; setDirty(false); render();
      toast('Published! The site is updated.');
    } catch (e) {
      busy = false; setDirty(true);
      toast(e.status === 409 ? 'The site was changed in another tab. Reload the page.' : 'Could not publish: ' + e.message, true);
    } finally {
      $('#publish').textContent = 'Publish';
    }
  }

  // ---------- boot ----------
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (b) { tab = b.dataset.tab; if (tab === 'visits' && stats) loadStats(); render(true); scrollTo(0, 0); }
  });
  $('#publish').addEventListener('click', publish);

  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#loginError'); err.hidden = true;
    try {
      await api('/api/login', { method: 'POST', json: { password: $('#password').value } });
      $('#password').value = '';
      await start();
    } catch (ex) {
      err.textContent = ex.status === 401 ? 'Wrong password' : ex.message;
      err.hidden = false;
    }
  });

  async function start() {
    try {
      content = await api('/api/admin/content');
    } catch { return showLogin(); }
    unboot();
    $('#login').hidden = true;
    $('#app').hidden = false;
    setDirty(false);
    render(true);
  }

  start();
})();
