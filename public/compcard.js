// Comp card PDF, drawn right in the browser: two A5 pages — a cover photo with the name, and a back
// with four photos, measurements and contacts. No libraries: each page is painted on a canvas,
// saved as JPEG and wrapped in a minimal PDF (with clickable email / Instagram / website links).
// Used by the public site ("Download comp card") and by the admin preview.

const W = 1240, H = 1759; // canvas px, A5 at ~213 dpi
const PT_W = 419.53, PT_H = 595.28; // A5 in PDF points
const M = 64; // page margin, px

const C = { dark: '#0a0a0b', cream: '#f1ece4', gold: '#c9a97a', paper: '#f4efe7', ink: '#161514', muted: '#857e73', goldInk: '#9c7a48' };
const SERIF = '"Cormorant Garamond", Georgia, serif';
const SANS = '"Jost", "Helvetica Neue", Arial, sans-serif';

const loadImage = src =>
  new Promise((resolve, reject) => {
    const img = new Image();
    if (new URL(src, location.href).origin !== location.origin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load ' + src));
    img.src = src;
  });

/** Fill the box with the image (like object-fit: cover). fy: where to crop vertically, 0 = keep the top. */
function cover(ctx, img, x, y, w, h, fy = 0.2) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / s, sh = h / s;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) * fy, sw, sh, x, y, w, h);
}

/** Draw text with optional letter-spacing (in em). Returns the drawn box for link hit-areas. */
function text(ctx, s, x, y, { size, family = SANS, weight = 400, style = 'normal', color = C.ink, track = 0, align = 'left' }) {
  ctx.font = `${style} ${weight} ${size}px ${family}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const gap = track * size;
  const chars = [...s];
  const widths = gap ? chars.map(c => ctx.measureText(c).width) : [];
  const w = gap ? widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1) : ctx.measureText(s).width;
  const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  if (!gap) ctx.fillText(s, x0, y);
  else chars.reduce((cx, c, i) => (ctx.fillText(c, cx, y), cx + widths[i] + gap), x0);
  return { x: x0, y: y - size, w, h: size * 1.3 };
}

/** Largest size ≤ max at which `s` fits into maxW. */
function fitSize(ctx, s, maxW, max, opts) {
  let size = max;
  while (size > 10) {
    ctx.font = `${opts.style || 'normal'} ${opts.weight || 400} ${size}px ${opts.family || SANS}`;
    const w = ctx.measureText(s).width + (opts.track || 0) * size * ([...s].length - 1);
    if (w <= maxW) break;
    size -= 1;
  }
  return size;
}

const canvas = () => {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
};

function drawFront(d, img) {
  const cv = canvas(), ctx = cv.getContext('2d');
  ctx.fillStyle = C.dark;
  ctx.fillRect(0, 0, W, H);
  if (img) cover(ctx, img, 0, 0, W, H, 0.15);

  let g = ctx.createLinearGradient(0, H * 0.42, 0, H);
  g.addColorStop(0, 'rgba(10,10,11,0)');
  g.addColorStop(1, 'rgba(10,10,11,.88)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  g = ctx.createLinearGradient(0, 0, 0, 260);
  g.addColorStop(0, 'rgba(10,10,11,.5)');
  g.addColorStop(1, 'rgba(10,10,11,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, 260);

  const [first, ...rest] = d.name.split(' ');
  const last = rest.join(' ');
  const initials = [first[0] || '', (rest[rest.length - 1] || first)[0] || ''];
  const a = text(ctx, initials[0], M, 118, { size: 54, family: SERIF, weight: 300, color: C.cream });
  const b = text(ctx, '.', a.x + a.w + 2, 118, { size: 54, family: SERIF, weight: 300, color: C.gold });
  text(ctx, initials[1], b.x + b.w + 2, 118, { size: 54, family: SERIF, weight: 300, color: C.cream });
  text(ctx, 'COMP CARD', W - M, 104, { size: 19, track: 0.34, color: C.cream, align: 'right' });

  const indent = last ? 0.42 : 0;
  const size = Math.min(
    fitSize(ctx, first, W - 2 * M, 200, { family: SERIF, weight: 300 }),
    last ? fitSize(ctx, last, W - 2 * M - 200 * indent, 200, { family: SERIF, weight: 300, style: 'italic' }) : 200,
  );
  const base = H - 210;
  if (last) {
    text(ctx, first, M - 4, base - size * 0.88, { size, family: SERIF, weight: 300, color: C.cream });
    text(ctx, last, M + size * indent, base, { size, family: SERIF, weight: 300, style: 'italic', color: C.gold });
  } else text(ctx, first, M - 4, base, { size, family: SERIF, weight: 300, color: C.cream });

  const line = [d.role, d.location].filter(Boolean).join('  ·  ').toUpperCase();
  ctx.fillStyle = C.gold;
  ctx.fillRect(M, H - 118, 56, 2);
  text(ctx, line, M + 84, H - 110, { size: fitSize(ctx, line, W - 2 * M - 84, 21, { track: 0.3 }), track: 0.3, color: C.cream });
  return { canvas: cv, links: [] };
}

function drawBack(d, imgs) {
  const cv = canvas(), ctx = cv.getContext('2d');
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);

  const items = [
    ...d.stats.map(s => ({ label: s.label, value: [s.value, s.unit].filter(Boolean).join(' ') })),
    ...d.traits.map(t => ({ label: t.label, value: t.value })),
  ].slice(0, 12);
  const perRow = 4, rows = Math.ceil(items.length / perRow);
  const stripH = 118 + rows * 92 + 74;
  const gridH = H - 2 * M - stripH;
  const G = 14, gw = W - 2 * M;

  // photo grid: 1 → full, 2 → side by side, 3 → one tall + two stacked, 4 → 2×2
  const cells = [];
  const half = (gw - G) / 2, halfH = (gridH - G) / 2;
  if (imgs.length === 1) cells.push([M, M, gw, gridH]);
  else if (imgs.length === 2) cells.push([M, M, half, gridH], [M + half + G, M, half, gridH]);
  else if (imgs.length === 3) cells.push([M, M, half, gridH], [M + half + G, M, half, halfH], [M + half + G, M + halfH + G, half, halfH]);
  else if (imgs.length >= 4)
    for (let i = 0; i < 4; i++) cells.push([M + (i % 2) * (half + G), M + Math.floor(i / 2) * (halfH + G), half, halfH]);
  cells.forEach(([x, y, w, h], i) => cover(ctx, imgs[i], x, y, w, h, 0.18));

  // name + role
  let y = M + gridH + 92;
  const [first, ...rest] = d.name.split(' ');
  const nameSize = 66;
  const f = text(ctx, first + ' ', M - 2, y, { size: nameSize, family: SERIF, weight: 300, color: C.ink });
  if (rest.length) text(ctx, rest.join(' '), f.x + f.w, y, { size: nameSize, family: SERIF, weight: 300, style: 'italic', color: C.goldInk });
  const role = [d.role, d.location].filter(Boolean).join('  ·  ').toUpperCase();
  text(ctx, role, W - M, y - 8, { size: fitSize(ctx, role, gw * 0.45, 16, { track: 0.28 }), track: 0.28, color: C.muted, align: 'right' });
  y += 30;
  ctx.fillStyle = 'rgba(22,21,20,.22)';
  ctx.fillRect(M, y, gw, 1.5);

  // measurements
  const colW = gw / perRow;
  items.forEach((it, i) => {
    const x = M + (i % perRow) * colW;
    const top = y + 48 + Math.floor(i / perRow) * 92;
    text(ctx, it.label.toUpperCase(), x, top, { size: fitSize(ctx, it.label.toUpperCase(), colW - 24, 14, { track: 0.24 }), track: 0.24, color: C.muted });
    const vs = fitSize(ctx, it.value, colW - 24, 34, { family: SERIF, weight: 400 });
    text(ctx, it.value, x, top + 40, { size: vs, family: SERIF, weight: 400, color: C.ink });
  });

  // contacts (clickable in the PDF)
  const links = [];
  const by = H - M;
  ctx.fillStyle = C.goldInk;
  ctx.fillRect(M, by - 44, gw, 1.5);
  const bits = [
    d.email && { s: d.email, url: 'mailto:' + d.email },
    d.instagram && { s: '@' + d.instagram, url: 'https://www.instagram.com/' + d.instagram },
    d.url && { s: d.url.replace(/^https?:\/\//, ''), url: d.url },
  ].filter(Boolean);
  let x = M;
  const step = gw / Math.max(bits.length, 1);
  bits.forEach((b, i) => {
    const align = bits.length > 1 && i === bits.length - 1 ? 'right' : i > 0 ? 'center' : 'left';
    const ax = align === 'right' ? M + gw : align === 'center' ? M + step * i + step / 2 : x;
    const size = fitSize(ctx, b.s, step - 20, 19, { track: 0.06 });
    const box = text(ctx, b.s, ax, by, { size, track: 0.06, color: C.ink, align });
    links.push({ ...box, url: b.url });
  });
  return { canvas: cv, links };
}

async function fontsReady() {
  if (!document.fonts) return;
  await Promise.all(
    [`300 100px ${SERIF}`, `italic 300 100px ${SERIF}`, `400 40px ${SERIF}`, `400 20px ${SANS}`].map(f => document.fonts.load(f).catch(() => {})),
  );
}

/** Render both pages. data: { name, role, location, email, instagram, url, stats, traits, photos:[{src}] } */
export async function renderPages(data) {
  await fontsReady();
  const imgs = await Promise.all(data.photos.slice(0, 5).map(p => loadImage(p.src)));
  return [drawFront(data, imgs[0]), drawBack(data, imgs.slice(1))];
}

// ---------- minimal PDF writer ----------

const pdfString = s => '<FEFF' + [...String(s)].map(ch => {
  const u = ch.codePointAt(0);
  if (u < 0x10000) return u.toString(16).padStart(4, '0');
  const v = u - 0x10000;
  return ((v >> 10) + 0xd800).toString(16) + ((v & 0x3ff) + 0xdc00).toString(16);
}).join('').toUpperCase() + '>';
const pdfUri = s => '(' + encodeURI(s).replace(/[()\\]/g, c => '\\' + c) + ')';
const n2 = v => +v.toFixed(2);

function makePdf(pages, title) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let len = 0;
  const push = x => {
    const b = typeof x === 'string' ? enc.encode(x) : x;
    chunks.push(b);
    len += b.length;
  };
  const obj = (n, ...parts) => {
    offsets[n] = len;
    push(`${n} 0 obj\n`);
    parts.forEach(push);
    push('\nendobj\n');
  };

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const kids = pages.map((_, i) => `${4 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  obj(3, `<< /Title ${pdfString(title)} /Creator ${pdfString('Portfolio site')} >>`);
  const sx = PT_W / W, sy = PT_H / H;
  pages.forEach((p, i) => {
    const [pg, im, ct] = [4 + i * 3, 5 + i * 3, 6 + i * 3];
    const annots = p.links.length
      ? ` /Annots [${p.links
          .map(l => `<< /Type /Annot /Subtype /Link /Border [0 0 0] /Rect [${n2(l.x * sx)} ${n2(PT_H - (l.y + l.h) * sy)} ${n2((l.x + l.w) * sx)} ${n2(PT_H - l.y * sy)}] /A << /S /URI /URI ${pdfUri(l.url)} >> >>`)
          .join(' ')}]`
      : '';
    obj(pg, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PT_W} ${PT_H}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R${annots} >>`);
    obj(im, `<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, p.jpeg, '\nendstream');
    const draw = `q ${PT_W} 0 0 ${PT_H} 0 0 cm /Im0 Do Q`;
    obj(ct, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  });
  const count = 4 + pages.length * 3;
  const xref = len;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

const toJpeg = cv =>
  new Promise((resolve, reject) =>
    cv.toBlob(b => (b ? b.arrayBuffer().then(a => resolve(new Uint8Array(a)), reject) : reject(new Error('canvas export failed'))), 'image/jpeg', 0.9),
  );

/** Build the PDF. Returns a Blob. */
export async function buildCompCard(data) {
  const pages = await renderPages(data);
  for (const p of pages) p.jpeg = await toJpeg(p.canvas);
  return makePdf(pages, `${data.name} — Comp card`);
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename, rel: 'noopener' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
