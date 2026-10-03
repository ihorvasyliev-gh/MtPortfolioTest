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
    s.textContent = v ? '● Не опубликовано' : '✓ Всё опубликовано';
    s.className = 'status ' + (v ? 'dirty' : 'ok');
  };
  const touch = () => setDirty(true);
  addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  const showLogin = () => {
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
            h('button', { title: 'Выше', disabled: i === 0, onclick: () => move(arr, i, -1) }, '↑'),
            h('button', { title: 'Ниже', disabled: i === arr.length - 1, onclick: () => move(arr, i, 1) }, '↓'),
            h('button', { class: 'del', title: 'Удалить', onclick: () => { arr.splice(i, 1); touch(); render(); } }, '✕')))),
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
    if (!files.length) return toast('Выберите изображения', true);
    const bar = $('.progress > i');
    const label = $('#uploadLabel');
    let ok = 0, failed = [];
    busy = true; $('#publish').disabled = true;
    for (const [i, file] of files.entries()) {
      if (label) label.textContent = `Загружаю ${i + 1} из ${files.length}…`;
      if (bar) bar.style.width = (i / files.length) * 100 + '%';
      try { await uploadOne(file); ok++; }
      catch (e) { failed.push(file.name + (e.status ? ` (${e.message})` : '')); }
    }
    busy = false;
    if (ok) touch(); else setDirty(dirty);
    render();
    if (ok) {
      toast(`Загружено: ${ok}. Нажмите «Опубликовать», чтобы фото появились на сайте.`);
      requestAnimationFrame(() => document.querySelector('.ph.fresh')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
    if (failed.length) toast('Не удалось загрузить: ' + failed.join(', '), true);
  }

  // ---------- dialogs ----------
  const dlg = $('#dialog');
  const openDialog = node => { dlg.replaceChildren(node); if (!dlg.open) dlg.showModal(); };
  const closeDialog = () => dlg.open && dlg.close();
  dlg.addEventListener('click', e => { if (e.target === dlg) closeDialog(); });

  const usedAsSpecial = p => [content.hero.image.full, content.about.image.full].includes(p.full);

  function editPhoto(p) {
    const groups = [...new Set(content.photos.map(x => x.group).filter(Boolean))];
    const dl = h('datalist', { id: 'groups' }, groups.map(g => h('option', { value: g })));
    const cat = h('select', { onchange: e => { p.cat = e.target.value; touch(); } },
      h('option', { value: '' }, 'Без категории'),
      content.categories.map(c => h('option', { value: c.id, selected: c.id === p.cat }, c.label)));
    openDialog(h('div', { class: 'dlg' },
      h('img', { class: 'dlg-img', src: imgUrl(p.thumb), alt: '' }),
      field('Описание фото (для поиска и скринридеров)', p, 'alt', { rows: 2 }),
      h('label', { class: 'field' }, h('span', {}, 'Категория'), cat),
      h('label', { class: 'field' },
        h('span', {}, 'Подпись раздела на сайте'),
        input(p, 'group', { list: 'groups', placeholder: 'например: Portfolio shoot' }),
        h('small', {}, 'Фото с одинаковой подписью идут подряд под общим заголовком. Без категории фото видно только во вкладке All.'), dl),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: !!p.hidden, onchange: e => { p.hidden = e.target.checked || undefined; touch(); render(); } }),
        'Скрыть из галереи'),
      h('div', { class: 'dlg-actions' },
        h('button', { class: 'btn small', onclick: () => { content.hero.image = { full: p.full, alt: p.alt }; touch(); closeDialog(); render(); toast('Главное фото обновлено'); } }, 'Сделать главным'),
        h('button', { class: 'btn small', onclick: () => { content.about.image = { full: p.full, alt: p.alt }; touch(); closeDialog(); render(); toast('Фото в «Обо мне» обновлено'); } }, 'Фото «Обо мне»')),
      h('div', { class: 'dlg-actions' },
        h('button', { class: 'btn danger small', onclick: () => removePhoto(p) }, 'Удалить'),
        h('button', { class: 'btn primary grow', onclick: () => { closeDialog(); render(); } }, 'Готово'))));
  }

  function removePhoto(p) {
    if (usedAsSpecial(p)) return toast('Это фото используется как главное или в «Обо мне». Сначала замените его.', true);
    if (!confirm('Удалить это фото? После публикации оно пропадёт с сайта.')) return;
    content.photos.splice(content.photos.indexOf(p), 1);
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
      content.photos.length === 0 && h('p', { class: 'lead' }, 'Сначала загрузите фото во вкладке «Фото».'),
      h('button', { class: 'btn', onclick: closeDialog }, 'Отмена')));
  }

  const imagePicker = (label, target) =>
    h('div', { class: 'pick' },
      h('img', { src: imgUrl(target.image.full), alt: '' }),
      h('div', {},
        h('strong', {}, label),
        h('button', { class: 'btn small', onclick: () => pickPhoto(label, p => { target.image = { full: p.full, alt: p.alt }; }, target.image.full) }, 'Выбрать другое фото')));

  // ---------- tabs ----------
  const tabs = {
    photos() {
      const c = content;
      let dragIdx = null;
      const grid = h('div', { class: 'grid' }, c.photos.map((p, i) => {
        const cat = c.categories.find(x => x.id === p.cat);
        const card = h('div', { class: `ph${p.hidden ? ' ph-hidden' : ''}${fresh.has(p.id) ? ' fresh' : ''}`, draggable: 'true' },
          h('button', { class: 'ph-img', onclick: () => editPhoto(p), 'aria-label': 'Редактировать фото' },
            h('img', { src: imgUrl(p.thumb), alt: p.alt, loading: 'lazy' }),
            h('span', { class: 'ph-tags' },
              cat ? h('span', { class: 'tag' }, cat.label) : h('span', { class: 'tag warn' }, 'без категории'),
              p.hidden && h('span', { class: 'tag' }, 'скрыто'))),
          h('div', { class: 'ph-bar' },
            h('button', { title: 'Раньше', disabled: i === 0, onclick: () => move(c.photos, i, -1) }, '←'),
            h('button', { title: 'Изменить', onclick: () => editPhoto(p) }, '✎'),
            h('button', { title: 'Позже', disabled: i === c.photos.length - 1, onclick: () => move(c.photos, i, 1) }, '→')));
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
        h('button', { class: 'btn primary', onclick: () => fileInput.click() }, '+ Добавить фото'),
        h('span', { id: 'uploadLabel' }, 'Можно выбрать сразу несколько — на телефоне из галереи, на компьютере перетащить сюда'),
        h('div', { class: 'progress' }, h('i')), fileInput);
      drop.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); drop.classList.add('over'); } });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); uploadFiles(e.dataTransfer.files); });

      const cats = h('div', { class: 'card' },
        h('h3', {}, 'Категории (фильтры в галерее)'),
        c.categories.map((k, i) =>
          h('div', { class: 'cat' }, input(k, 'label', { maxlength: 40 }),
            h('button', { title: 'Удалить категорию', onclick: () => {
              if (c.photos.some(p => p.cat === k.id)) return toast('В этой категории есть фото — сначала переместите их', true);
              c.categories.splice(i, 1); touch(); render();
            } }, '✕'))),
        h('button', { class: 'btn', onclick: () => {
          const label = prompt('Название новой категории');
          if (!label?.trim()) return;
          const id = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cat-' + rid().slice(0, 4);
          c.categories.push({ id: c.categories.some(x => x.id === id) ? id + '-' + rid().slice(0, 3) : id, label: label.trim() });
          touch(); render();
        } }, '+ Новая категория'));

      return [
        h('h2', {}, 'Фото'),
        h('p', { class: 'lead' }, 'Нажмите на фото, чтобы изменить описание, категорию или удалить. Стрелки меняют порядок; на компьютере фото можно перетаскивать.'),
        drop,
        c.photos.length ? grid : h('p', { class: 'lead' }, 'Пока нет фото.'),
        h('div', { style: 'height:24px' }),
        cats,
      ];
    },

    profile() {
      const { hero, about } = content;
      return [
        h('h2', {}, 'Профиль'),
        h('p', { class: 'lead' }, 'Главный экран и блок «Обо мне».'),
        h('div', { class: 'card' },
          h('h3', {}, 'Главный экран'),
          h('div', { class: 'stack' },
            imagePicker('Главное фото', hero),
            field('Подпись под именем', hero, 'lede', { rows: 3 }))),
        h('div', { class: 'card' },
          h('h3', {}, 'Обо мне'),
          h('div', { class: 'stack' },
            imagePicker('Фото «Обо мне»', about),
            field('Заголовок', about, 'heading', { hint: 'Слово в *звёздочках* станет золотым курсивом: A classic *look.*' }),
            h('div', {}, h('p', { class: 'lead' }, 'Абзацы текста'),
              h('div', {}, about.paragraphs.map((_, i) =>
                h('div', { class: 'item' },
                  input(about.paragraphs, i, { rows: 4 }),
                  h('div', { class: 'item-tools' },
                    h('button', { disabled: i === 0, onclick: () => move(about.paragraphs, i, -1) }, '↑'),
                    h('button', { disabled: i === about.paragraphs.length - 1, onclick: () => move(about.paragraphs, i, 1) }, '↓'),
                    h('button', { class: 'del', onclick: () => { about.paragraphs.splice(i, 1); touch(); render(); } }, '✕'))))),
              about.paragraphs.length < 6 && h('button', { class: 'btn', onclick: () => { about.paragraphs.push(''); touch(); render(); } }, '+ Абзац')))),
        h('div', { class: 'card' },
          h('h3', {}, 'Коротко обо мне (языки, навыки…)'),
          repeater(about.facts, [{ key: 'label', label: 'Название', max: 60 }, { key: 'value', label: 'Значение', max: 200 }], () => ({ label: '', value: '' }), 'Добавить строку', 8)),
      ];
    },

    services() {
      return [
        h('h2', {}, 'Услуги'),
        h('p', { class: 'lead' }, 'Раздел «Available for» — виды съёмок, которые вы предлагаете.'),
        repeater(content.services, [{ key: 'title', label: 'Название', max: 60 }, { key: 'text', label: 'Описание', max: 200 }], () => ({ title: '', text: '' }), 'Добавить услугу'),
      ];
    },

    stats() {
      return [
        h('h2', {}, 'Параметры'),
        h('p', { class: 'lead' }, 'Раздел «Measurements» — comp card.'),
        h('div', { class: 'card' },
          h('h3', {}, 'Крупные показатели'),
          repeater(content.stats, [{ key: 'value', label: 'Значение', placeholder: '168', max: 40 }, { key: 'unit', label: 'Единица (необязательно)', placeholder: 'cm', max: 10 }, { key: 'label', label: 'Подпись', placeholder: 'Height', max: 60 }], () => ({ value: '', unit: '', label: '' }), 'Добавить показатель', 8)),
        h('div', { class: 'card' },
          h('h3', {}, 'Внешность'),
          repeater(content.traits, [{ key: 'label', label: 'Название', placeholder: 'Eyes', max: 60 }, { key: 'value', label: 'Значение', max: 200 }], () => ({ label: '', value: '' }), 'Добавить', 9)),
      ];
    },

    settings() {
      const { site, contact } = content;
      return [
        h('h2', {}, 'Контакты и данные сайта'),
        h('div', { class: 'card' },
          h('h3', {}, 'Блок «Contact»'),
          h('div', { class: 'stack' },
            field('Заголовок', contact, 'heading', { rows: 2, hint: 'Новая строка — перенос. *Звёздочки* — золотой курсив.' }),
            field('Текст под заголовком', contact, 'note', { rows: 3 }))),
        h('div', { class: 'card' },
          h('h3', {}, 'Контакты'),
          h('div', { class: 'stack' },
            field('Email', site, 'email', { type: 'email', inputmode: 'email' }),
            field('Instagram (без @)', site, 'instagram', { placeholder: 'rebel_in_cork', autocapitalize: 'none' }))),
        h('div', { class: 'card' },
          h('h3', {}, 'Сайт'),
          h('div', { class: 'stack' },
            field('Имя', site, 'name'),
            h('div', { class: 'row2' }, field('Профессия', site, 'role'), field('Город', site, 'location')),
            field('Описание для Google и соцсетей', site, 'description', { rows: 3, hint: 'Показывается в результатах поиска и в превью ссылки.' }))),
        h('button', { class: 'btn', onclick: async () => {
          if (dirty && !confirm('Есть неопубликованные изменения. Выйти без сохранения?')) return;
          await api('/api/logout', { method: 'POST' }).catch(() => {});
          dirty = false; location.reload();
        } }, 'Выйти'),
      ];
    },
  };

  function render() {
    for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', b.dataset.tab === tab);
    $('#content').replaceChildren(...tabs[tab]());
  }

  // ---------- publish ----------
  async function publish() {
    if (busy) return;
    busy = true; $('#publish').disabled = true; $('#publish').textContent = 'Публикую…';
    try {
      const saved = await api('/api/admin/content', { method: 'PUT', json: content });
      content = saved;
      const referenced = new Set(saved.photos.flatMap(p => [p.full, p.thumb]).concat(saved.hero.image.full, saved.about.image.full));
      await Promise.all([...toDelete].filter(k => !referenced.has(k)).map(k =>
        api('/api/admin/object?key=' + encodeURIComponent(k), { method: 'DELETE' }).catch(() => {})));
      toDelete.clear(); fresh.clear();
      busy = false; setDirty(false); render();
      toast('Опубликовано! Сайт обновлён.');
    } catch (e) {
      busy = false; setDirty(true);
      toast(e.status === 409 ? 'Сайт был изменён в другой вкладке. Обновите страницу.' : 'Не удалось опубликовать: ' + e.message, true);
    } finally {
      $('#publish').textContent = 'Опубликовать';
    }
  }

  // ---------- boot ----------
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (b) { tab = b.dataset.tab; render(); scrollTo(0, 0); }
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
      err.textContent = ex.status === 401 ? 'Неверный пароль' : ex.message;
      err.hidden = false;
    }
  });

  async function start() {
    try {
      content = await api('/api/admin/content');
    } catch { return showLogin(); }
    $('#login').hidden = true;
    $('#app').hidden = false;
    setDirty(false);
    render();
  }

  start();
})();
