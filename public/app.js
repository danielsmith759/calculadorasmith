const $ = (id) => document.getElementById(id);
const AI_MODULE = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm';
const ALPHA_MIN = 10;      // alfa mínimo para considerar un píxel como parte del diseño
const WORK_MAX = 3000;     // lado máximo (px) para editar en el navegador
const EXPORT_MAX = 9000;   // lado máximo (px) de cada archivo enviado
const BIG = 100000;        // alto "infinito" del rollo al empaquetar (cm)

let config;
let designs = [];   // { original, working, design, ratio, w, h, qty }
let sel = -1;
let style = 'normal';
let montage = null; // { boxes, lengthCm }

const fmt = (n) => '$' + Math.round(n).toLocaleString('es-CO');
const say = (text, cls = '') => { $('status').textContent = text; $('status').className = 'msg ' + cls; };
const cur = () => designs[sel];

const cloneCanvas = (src) => {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
};

function canvasFromImage(img) {
  const scale = Math.min(1, WORK_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// Recorta al rectángulo con píxeles visibles: no se cobra el borde transparente.
function trim(src) {
  const { width, height } = src;
  const data = src.getContext('2d').getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > ALPHA_MIN) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const c = document.createElement('canvas');
  c.width = maxX - minX + 1; c.height = maxY - minY + 1;
  c.getContext('2d').drawImage(src, minX, minY, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

// ---------- Empaquetado (MaxRects, con rotación 90°) ----------
// Acomoda las piezas en el ancho del rollo buscando el menor largo total.
function pack(items, widthCm, gap) {
  const BW = widthCm + gap;
  let free = [{ x: 0, y: 0, w: BW, h: BIG }];
  const out = [];
  const order = items.map((it, i) => ({ ...it, i })).sort((a, b) => b.w * b.h - a.w * a.h);
  for (const it of order) {
    let best = null;
    for (const f of free) {
      for (const rot of [false, true]) {
        const w = (rot ? it.h : it.w) + gap, h = (rot ? it.w : it.h) + gap;
        if (w > f.w + 1e-9 || h > f.h + 1e-9) continue;
        const score = [f.y + h, f.x];
        if (!best || score[0] < best.score[0] - 1e-9 || (Math.abs(score[0] - best.score[0]) < 1e-9 && score[1] < best.score[1])) {
          best = { x: f.x, y: f.y, w, h, rot, score };
        }
      }
    }
    if (!best) return null;
    const next = [];
    for (const f of free) {
      if (best.x >= f.x + f.w || best.x + best.w <= f.x || best.y >= f.y + f.h || best.y + best.h <= f.y) { next.push(f); continue; }
      if (best.x > f.x) next.push({ x: f.x, y: f.y, w: best.x - f.x, h: f.h });
      if (best.x + best.w < f.x + f.w) next.push({ x: best.x + best.w, y: f.y, w: f.x + f.w - best.x - best.w, h: f.h });
      if (best.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: best.y - f.y });
      if (best.y + best.h < f.y + f.h) next.push({ x: f.x, y: best.y + best.h, w: f.w, h: f.y + f.h - best.y - best.h });
    }
    free = next.filter((a, i) => !next.some((b, j) => j !== i && a.x >= b.x - 1e-9 && a.y >= b.y - 1e-9 &&
      a.x + a.w <= b.x + b.w + 1e-9 && a.y + a.h <= b.y + b.h + 1e-9 && (i > j || a.w * a.h < b.w * b.h)));
    out.push({ d: it.d, x: best.x, y: best.y, rot: best.rot, w: best.rot ? it.h : it.w, h: best.rot ? it.w : it.h });
  }
  return out;
}

// ---------- Montaje y precio ----------
function relayout() {
  const ready = designs.filter((d) => d.design && d.w > 0 && d.h > 0);
  $('quote').classList.toggle('hidden', !ready.length);
  renderStyles();
  if (!ready.length) { montage = null; return; }

  const items = [];
  designs.forEach((d, i) => { if (d.design && d.w > 0) for (let k = 0; k < d.qty; k++) items.push({ d: i, w: d.w, h: d.h }); });
  const boxes = pack(items, config.anchoRolloCm, config.separacionCm);
  if (!boxes) { montage = null; return; }
  const rawLength = Math.max(...boxes.map((b) => b.y + b.h));
  const lengthCm = Math.max(config.largoMinimoCm, rawLength); // montaje mínimo 58 x 15 cm
  const over = rawLength > config.largoMaximoCm + config.separacionCm + 0.01; // la separación entre piezas no cuenta
  montage = { boxes, lengthCm, over };

  const used = boxes.reduce((s, b) => s + b.w * b.h, 0);
  const film = config.anchoRolloCm * lengthCm;
  const empty = Math.round((1 - used / film) * 100);
  const q = Pricing.quote(config, style, lengthCm);
  $('stats').textContent = `${boxes.length} pieza(s) · montaje de ${config.anchoRolloCm} × ${lengthCm.toFixed(1)} cm` +
    (rawLength < config.largoMinimoCm ? ` (montaje mínimo ${config.anchoRolloCm} × ${config.largoMinimoCm} cm)` : '');
  $('price').textContent = fmt(q.price);
  $('detail').textContent = q.detalle;
  $('limit').textContent = over
    ? `El montaje supera ${config.largoMaximoCm} cm (1 metro). Reduce medidas o cantidades; para más metros contáctanos y se manejan por metros aparte.`
    : '';
  $('waste').textContent = empty > 5
    ? `El ${empty}% del montaje es espacio vacío y se cobra igual porque consume film. Agrega más imágenes o ajusta medidas para aprovecharlo.`
    : '';
  drawMontage();
  renderChips();
  updateSend();
}

function drawMontage() {
  const s = 6; // px por cm
  const c = $('montage');
  c.width = Math.round(config.anchoRolloCm * s);
  c.height = Math.max(1, Math.round(montage.lengthCm * s));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#eee';
  for (let y = 0; y < c.height; y += 12) for (let x = (y / 12) % 2 ? 0 : 12; x < c.width; x += 24) ctx.fillRect(x, y, 12, 12);
  for (const b of montage.boxes) {
    const d = designs[b.d].design;
    ctx.save();
    if (b.rot) {
      ctx.translate((b.x + b.w) * s, b.y * s); ctx.rotate(Math.PI / 2);
      ctx.drawImage(d, 0, 0, b.h * s, b.w * s);
    } else {
      ctx.drawImage(d, b.x * s, b.y * s, b.w * s, b.h * s);
    }
    ctx.restore();
  }
}

function renderStyles() {
  const L = montage ? montage.lengthCm : null;
  $('styles').innerHTML = '';
  for (const e of config.estilos) {
    const card = document.createElement('label');
    card.className = 'style-card' + (e.id === style ? ' sel' : '');
    const price = L == null ? '' : fmt(Pricing.quote(config, e.id, L).price);
    card.innerHTML = `<input type="radio" name="style" value="${e.id}" ${e.id === style ? 'checked' : ''}>
      <b>${e.nombre}</b><h3>${e.resumen}</h3><ul>${e.puntos.map((p) => `<li>${p}</li>`).join('')}</ul><div class="p">${price}</div>`;
    card.querySelector('input').addEventListener('change', () => { style = e.id; relayout(); });
    $('styles').appendChild(card);
  }
}

function renderTerms() {
  $('terms').innerHTML = config.aclaraciones.map((t, i) => `<label><input type="checkbox" class="term" id="t${i}"> <span></span></label>`).join('');
  config.aclaraciones.forEach((t, i) => { $('t' + i).nextElementSibling.textContent = t; });
  document.querySelectorAll('.term').forEach((c) => c.addEventListener('change', updateSend));
}

function updateSend() {
  const ok = montage && !montage.over && [...document.querySelectorAll('.term')].every((c) => c.checked);
  $('send').disabled = !ok;
}

// ---------- Lista de imágenes y editor ----------
function renderChips() {
  $('chips').innerHTML = '';
  designs.forEach((d, i) => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (i === sel ? ' sel' : '');
    const t = document.createElement('canvas');
    const src = d.design || d.working;
    const k = Math.min(1, 64 / Math.max(src.width, src.height));
    t.width = Math.max(1, Math.round(src.width * k)); t.height = Math.max(1, Math.round(src.height * k));
    t.getContext('2d').drawImage(src, 0, 0, t.width, t.height);
    chip.appendChild(t);
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'x'; x.textContent = '×'; x.setAttribute('aria-label', 'Quitar imagen');
    x.addEventListener('click', (ev) => { ev.stopPropagation(); removeDesign(i); });
    chip.appendChild(x);
    chip.addEventListener('click', () => select(i));
    $('chips').appendChild(chip);
  });
}

function removeDesign(i) {
  designs.splice(i, 1);
  sel = designs.length ? Math.min(sel, designs.length - 1) : -1;
  if (sel === -1) $('editor').classList.add('hidden'); else select(sel);
  relayout();
}

function select(i) {
  sel = i;
  const d = cur();
  $('editor').classList.remove('hidden');
  say('');
  $('w').value = d.w; $('h').value = d.h.toFixed(1); $('qty').value = d.qty;
  drawPreview();
  renderChips();
}

function drawPreview() {
  const d = cur();
  $('preview').width = d.design.width; $('preview').height = d.design.height;
  $('preview').getContext('2d').drawImage(d.design, 0, 0);
}

// Recalcula el recorte de la imagen actual conservando el ancho elegido.
function refreshDesign() {
  const d = cur();
  const t = trim(d.working);
  if (!t) { say('La imagen quedó vacía, restaura el original.', 'err'); return; }
  d.design = t;
  d.ratio = t.height / t.width;
  d.h = d.w * d.ratio;
  $('h').value = d.h.toFixed(1);
  drawPreview();
  relayout();
}

function checkSize() {
  const d = cur();
  const bad = Math.min(d.w, d.h) > config.anchoRolloCm;
  $('sizeWarn').textContent = bad ? `Excede el ancho útil del rollo (${config.anchoRolloCm} cm). Reduce la medida.` : '';
  return !bad;
}

$('w').addEventListener('input', () => {
  const w = parseFloat($('w').value);
  if (!(w > 0)) return;
  cur().w = w; cur().h = w * cur().ratio; $('h').value = cur().h.toFixed(1);
  if (checkSize()) relayout();
});
$('h').addEventListener('input', () => {
  const h = parseFloat($('h').value);
  if (!(h > 0)) return;
  cur().h = h; cur().w = h / cur().ratio; $('w').value = cur().w.toFixed(1);
  if (checkSize()) relayout();
});
$('qty').addEventListener('input', () => {
  cur().qty = Math.min(200, Math.max(1, parseInt($('qty').value, 10) || 1));
  relayout();
});
$('tol').addEventListener('input', () => { $('tolVal').textContent = $('tol').value; });

$('file').addEventListener('change', async () => {
  const files = [...$('file').files];
  $('file').value = '';
  for (const f of files) {
    const img = new Image();
    const url = URL.createObjectURL(f);
    try {
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
    } catch { alert(`No se pudo leer "${f.name}".`); continue; }
    URL.revokeObjectURL(url);
    const original = canvasFromImage(img);
    designs.push({ original, working: cloneCanvas(original), design: null, ratio: 1, w: 10, h: 10, qty: 1 });
    sel = designs.length - 1;
    refreshDesign();
  }
  if (designs.length) select(sel);
});

$('btnReset').addEventListener('click', () => {
  cur().working = cloneCanvas(cur().original);
  say('');
  refreshDesign();
});

// Quita el color de fondo conectado a los bordes (sirve sin conexión y con fondos planos).
$('btnColor').addEventListener('click', () => {
  const work = cur().working;
  const { width, height } = work;
  const ctx = work.getContext('2d');
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  const px = (x, y) => (y * width + x) * 4;
  const corners = [px(0, 0), px(width - 1, 0), px(0, height - 1), px(width - 1, height - 1)];
  const bg = [0, 1, 2].map((k) => corners.reduce((s, i) => s + d[i + k], 0) / 4);
  const tol = parseInt($('tol').value, 10);
  const near = (i) => d[i + 3] > 0 && Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]) <= tol;
  const seen = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => { const p = y * width + x; if (!seen[p] && near(p * 4)) { seen[p] = 1; stack.push(p); } };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  while (stack.length) {
    const p = stack.pop();
    d[p * 4 + 3] = 0;
    const x = p % width, y = (p - x) / width;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }
  ctx.putImageData(img, 0, 0);
  say('Fondo de color removido.', 'ok');
  refreshDesign();
});

// IA en el navegador: la imagen no sale del equipo hasta que se envía el pedido.
$('btnAI').addEventListener('click', async () => {
  $('btnAI').disabled = true;
  const d = cur();
  say('Cargando modelo de IA (la primera vez tarda)…');
  try {
    const { removeBackground } = await import(AI_MODULE);
    const blob = await new Promise((r) => d.original.toBlob(r, 'image/png'));
    const out = await removeBackground(blob, {
      progress: (key, c, total) => { if (total) say(`Procesando ${key}: ${Math.round((c / total) * 100)}%`); }
    });
    const bmp = await createImageBitmap(out);
    d.working = document.createElement('canvas');
    d.working.width = bmp.width; d.working.height = bmp.height;
    d.working.getContext('2d').drawImage(bmp, 0, 0);
    if (cur() === d) { say('Fondo removido con IA.', 'ok'); refreshDesign(); }
  } catch (e) {
    console.error(e);
    say('No se pudo usar la IA. Prueba "Quitar color de fondo".', 'err');
  } finally {
    $('btnAI').disabled = false;
  }
});

$('send').addEventListener('click', async () => {
  const out = $('result');
  out.className = 'msg';
  if (!montage) return;
  if (!$('name').value.trim() || !$('phone').value.trim()) { out.className = 'msg err'; out.textContent = 'Escribe tu nombre y teléfono.'; return; }
  if (designs.some((d) => Math.min(d.w, d.h) > config.anchoRolloCm)) { out.className = 'msg err'; out.textContent = 'Una imagen excede el ancho del rollo.'; return; }

  $('send').disabled = true;
  out.textContent = 'Enviando…';
  try {
    const fd = new FormData();
    for (let i = 0; i < designs.length; i++) {
      const d = designs[i];
      // Cada diseño se exporta a resolución de impresión para su medida.
      const scale = Math.min(1, EXPORT_MAX / Math.max(d.w, d.h) / (config.dpi / 2.54));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round((d.w / 2.54) * config.dpi * scale));
      c.height = Math.max(1, Math.round((d.h / 2.54) * config.dpi * scale));
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(d.design, 0, 0, c.width, c.height);
      fd.append('images', await new Promise((r) => c.toBlob(r, 'image/png')), `diseno${i}.png`);
    }
    fd.append('meta', JSON.stringify({
      style,
      designs: designs.map((d) => ({ wCm: d.w, hCm: d.h })),
      layout: montage.boxes.map((b) => ({ d: b.d, x: b.x, y: b.y, rot: b.rot })),
      name: $('name').value, phone: $('phone').value, note: $('note').value,
      accepted: true
    }));
    const res = await fetch('/api/orders', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al enviar');
    out.className = 'msg ok';
    out.textContent = `¡Pedido recibido! Referencia ${data.ref} · Total estimado ${fmt(data.price)} + IVA. Te contactaremos pronto.`;
  } catch (e) {
    out.className = 'msg err';
    out.textContent = e.message;
  } finally {
    updateSend();
  }
});

fetch('/api/config').then((r) => r.json()).then((c) => { config = c; renderTerms(); renderStyles(); });
