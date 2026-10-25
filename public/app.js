const $ = (id) => document.getElementById(id);
const AI_MODULE = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm';
const ALPHA_MIN = 10;      // alfa mínimo para considerar un píxel como parte del diseño
const WORK_MAX = 3000;     // lado máximo (px) para editar en el navegador
const MAX_DESIGNS = 30;    // imágenes distintas por pedido (memoria del navegador)
const MAX_QTY = 200;       // copias por imagen
const DPI_WARN = 150;      // por debajo de esto la impresión puede verse pixelada
const DPI_BAD = 72;
const BIG = 100000;        // alto "infinito" del rollo al empaquetar (cm)

let config;
let designs = [];   // { file, working, design, offX, offY, thumb, ratio, w, h, qty, cleaned }
let sel = -1;
let style = 'premium';
let montage = null; // { boxes, lengthCm, over, labelY, invalid }
let busy = false;
let sent = false;
let aiModule = null;
let aiAccepted = false;
let gapCm = null;   // separación entre diseños elegida por el cliente (mínimo config.separacionCm)

const fmt = (n) => '$' + Math.round(n).toLocaleString('es-CO');
const say = (text, cls = '') => { $('status').textContent = text; $('status').className = 'msg ' + cls; };
const cur = () => designs[sel];
const pieceCount = () => designs.reduce((s, d) => s + d.qty, 0);
const dpiOf = (d) => Math.round(d.design.width / (d.w / 2.54));

async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
    const scale = Math.min(1, WORK_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
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
  return { canvas: c, offX: minX, offY: minY };
}

// ---------- Empaquetado (MaxRects, con rotación 90°) ----------
// Acomoda las piezas en el ancho del rollo buscando el menor largo total.
function pack(items, widthCm, gap, sortFn) {
  const BW = widthCm + gap;
  let free = [{ x: 0, y: 0, w: BW, h: BIG }];
  const out = [];
  const order = [...items].sort(sortFn);
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

// Prueba varios órdenes de acomodo y se queda con el montaje más corto.
const SORTS = [
  (a, b) => b.w * b.h - a.w * a.h,
  (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h),
  (a, b) => b.h - a.h,
  (a, b) => b.w - a.w
];
function packBest(items, widthCm, gap) {
  let best = null, bestLen = Infinity;
  for (const s of SORTS) {
    const boxes = pack(items, widthCm, gap, s);
    if (!boxes) continue;
    const len = Math.max(...boxes.map((b) => b.y + b.h));
    if (len < bestLen - 1e-9) { best = boxes; bestLen = len; }
  }
  return best;
}

// Largo mostrado al cliente: igual al que usa la tabla de precios (se redondea hacia arriba al cm).
const shownLength = (L) => (L < 100 ? `${Math.min(99, Math.ceil(L - 1e-9))}` : L.toFixed(1));

// ---------- Montaje y precio ----------
function invalidQuote(reason) {
  montage = null;
  $('stats').textContent = '';
  $('price').textContent = '—';
  $('price').classList.add('off');
  $('detail').textContent = '';
  $('waste').textContent = '';
  $('limit').textContent = reason;
  const c = $('montage'); c.width = 1; c.height = 1;
}

function relayout() {
  renderChips();
  const ready = designs.filter((d) => d.design);
  $('quote').classList.toggle('hidden', !ready.length);
  if (!ready.length) { montage = null; renderStyles(); updateSend(); return; }

  const total = pieceCount();
  const tooWide = designs.find((d) => Math.min(d.w, d.h) > config.anchoRolloCm);
  if (tooWide) invalidQuote(`Una imagen mide más de ${config.anchoRolloCm} cm por ambos lados. Reduce su medida.`);
  else if (total > config.maxPiezas) invalidQuote(`Máximo ${config.maxPiezas} piezas por pedido (tienes ${total}). Reduce las cantidades.`);
  else {
    const items = [];
    designs.forEach((d, i) => { for (let k = 0; k < d.qty; k++) items.push({ d: i, w: d.w, h: d.h }); });
    const boxes = packBest(items, config.anchoRolloCm, gapCm);
    if (!boxes) invalidQuote('No se pudo acomodar el montaje. Revisa las medidas.');
    else {
      // Al final del montaje va una franja con el nombre del cliente.
      const layoutLength = Math.max(...boxes.map((b) => b.y + b.h));
      const labelY = layoutLength + gapCm;
      const rawLength = labelY + config.etiquetaCm;
      const lengthCm = Math.max(config.largoMinimoCm, rawLength); // montaje mínimo 58 x 15 cm
      const over = rawLength > config.largoMaximoCm + 1e-9;
      montage = { boxes, lengthCm, over, labelY };

      const used = boxes.reduce((s, b) => s + b.w * b.h, 0);
      const empty = Math.round((1 - used / (config.anchoRolloCm * lengthCm)) * 100);
      const q = Pricing.quote(config, style, lengthCm);
      $('stats').textContent = `${boxes.length} pieza(s) · montaje de ${config.anchoRolloCm} × ${shownLength(lengthCm)} cm` +
        (rawLength < config.largoMinimoCm ? ` (montaje mínimo ${config.anchoRolloCm} × ${config.largoMinimoCm} cm)` : '');
      $('price').textContent = fmt(q.price);
      $('price').classList.toggle('off', over);
      $('detail').textContent = over ? '' : q.detalle;
      $('limit').textContent = over
        ? `El montaje mide ${rawLength.toFixed(1)} cm y el máximo es ${config.largoMaximoCm} cm (1 metro). Reduce medidas o cantidades; para más metros contáctanos y se manejan por metros aparte.`
        : '';
      $('waste').textContent = empty > 5 && !over
        ? `Espacio libre en tu montaje: ${empty}%. Ese espacio se cobra porque consume film; puedes aprovecharlo agregando más imágenes sin pagar más.`
        : '';
      drawMontage();
    }
  }
  renderStyles();
  updateSend();
}

// Texto de la franja de identificación (se usa en la vista previa y en el archivo enviado).
function drawLabel(ctx, w, h) {
  const name = $('name').value.trim().toUpperCase() || 'NOMBRE DEL CLIENTE';
  const text = `${name}  ·  ${new Date().toLocaleDateString('es-CO')}`;
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'middle';
  let size = h * 0.6;
  ctx.font = `bold ${size}px Arial, sans-serif`;
  const maxW = w - h; // margen izquierdo y derecho
  const tw = ctx.measureText(text).width;
  if (tw > maxW) { size *= maxW / tw; ctx.font = `bold ${size}px Arial, sans-serif`; }
  ctx.fillText(text, h * 0.3, h / 2);
}

function drawMontage() {
  const s = 8; // px por cm
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
  ctx.save();
  ctx.translate(0, montage.labelY * s);
  drawLabel(ctx, c.width, config.etiquetaCm * s);
  ctx.restore();
}

function renderStyles() {
  const L = montage && !montage.over ? montage.lengthCm : null;
  $('styles').innerHTML = '';
  for (const e of config.estilos) {
    const card = document.createElement('label');
    card.className = 'style-card' + (e.id === style ? ' sel' : '');
    const price = L == null
      ? `desde ${fmt(Pricing.quote(config, e.id, config.largoMinimoCm).price)}`
      : fmt(Pricing.quote(config, e.id, L).price);
    card.innerHTML = `<input type="radio" name="style" value="${e.id}" ${e.id === style ? 'checked' : ''}>
      <b>${e.nombre}</b><h3>${e.resumen}</h3><ul>${e.puntos.map((p) => `<li>${p}</li>`).join('')}</ul><div class="p">${price}</div>`;
    card.querySelector('input').addEventListener('change', () => { style = e.id; relayout(); });
    $('styles').appendChild(card);
  }
}

function renderTerms() {
  $('terms').innerHTML = '<ol>' + config.aclaraciones.map(() => '<li></li>').join('') + '</ol>' +
    '<label><input type="checkbox" id="accept"> <b>He leído y acepto las ' + config.aclaraciones.length + ' aclaraciones.</b></label>';
  $('terms').querySelectorAll('li').forEach((li, i) => { li.textContent = config.aclaraciones[i]; });
  $('accept').addEventListener('change', updateSend);
}

function updateSend() {
  let hint = '';
  if (sent) hint = '';
  else if (!montage) hint = designs.length ? 'Corrige el montaje para poder enviar.' : 'Sube al menos una imagen.';
  else if (montage.over) hint = 'El montaje supera 1 metro.';
  else if (!$('accept').checked) hint = 'Marca la casilla de aceptación de las aclaraciones.';
  else if (!$('name').value.trim() || !$('phone').value.trim()) hint = 'Escribe tu nombre y teléfono.';
  $('send').disabled = !!hint || busy || sent;
  $('sendHint').textContent = hint;
}

// ---------- Lista de imágenes y editor ----------
function makeThumb(d) {
  const t = document.createElement('canvas');
  const k = Math.min(1, 64 / Math.max(d.design.width, d.design.height));
  t.width = Math.max(1, Math.round(d.design.width * k)); t.height = Math.max(1, Math.round(d.design.height * k));
  t.getContext('2d').drawImage(d.design, 0, 0, t.width, t.height);
  d.thumb = t;
}

function renderChips() {
  $('chips').innerHTML = '';
  designs.forEach((d, i) => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (i === sel ? ' sel' : '');
    chip.title = `${d.w.toFixed(1)} × ${d.h.toFixed(1)} cm · ${d.qty} u.`;
    chip.appendChild(d.thumb);
    if (dpiOf(d) < DPI_WARN) {
      const w = document.createElement('span');
      w.className = 'badge'; w.textContent = '!'; w.title = 'Resolución baja';
      chip.appendChild(w);
    }
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'x'; x.textContent = '×'; x.setAttribute('aria-label', 'Quitar imagen');
    x.addEventListener('click', (ev) => { ev.stopPropagation(); if (!busy) removeDesign(i); });
    chip.appendChild(x);
    chip.addEventListener('click', () => { if (!busy) select(i); });
    $('chips').appendChild(chip);
  });
  $('fileHint').textContent = designs.length ? `${designs.length} imagen(es). Toca una para editarla.` : '';
}

function removeDesign(i) {
  designs.splice(i, 1);
  if (!designs.length) { sel = -1; $('editor').classList.add('hidden'); }
  else select(Math.min(sel, designs.length - 1));
  relayout();
}

function select(i) {
  sel = i;
  const d = cur();
  $('editor').classList.remove('hidden');
  say('');
  $('sizeWarn').textContent = '';
  $('w').value = d.w.toFixed(1); $('h').value = d.h.toFixed(1); $('qty').value = d.qty;
  drawPreview();
  updateInfo();
  renderChips();
}

function drawPreview() {
  const d = cur();
  $('preview').width = d.design.width; $('preview').height = d.design.height;
  $('preview').getContext('2d').drawImage(d.design, 0, 0);
}

// Avisos de la imagen seleccionada: resolución y fondo sin quitar.
function updateInfo() {
  const d = cur();
  const dpi = dpiOf(d);
  $('dpiInfo').className = 'msg ' + (dpi < DPI_BAD ? 'err' : dpi < DPI_WARN ? 'warn' : 'ok');
  $('dpiInfo').textContent = dpi < DPI_WARN
    ? `Resolución baja (${dpi} ppp) para esta medida: puede verse pixelada. Usa una imagen más grande o reduce la medida.`
    : `Resolución buena (${Math.min(dpi, 999)} ppp).`;
  const c = d.design.getContext('2d');
  const corners = [[0, 0], [d.design.width - 1, 0], [0, d.design.height - 1], [d.design.width - 1, d.design.height - 1]];
  const opaque = corners.every(([x, y]) => c.getImageData(x, y, 1, 1).data[3] > 200);
  $('bgWarn').textContent = opaque && !d.cleaned
    ? 'Tu imagen parece tener fondo. Si no lo quitas, el fondo también se imprimirá (incluido el blanco).'
    : '';
}

// Recalcula el recorte de la imagen actual conservando el ancho elegido.
function refreshDesign(d = cur()) {
  const t = trim(d.working);
  if (!t) return false;
  d.design = t.canvas; d.offX = t.offX; d.offY = t.offY;
  d.ratio = t.canvas.height / t.canvas.width;
  d.h = d.w * d.ratio;
  makeThumb(d);
  if (d === cur()) {
    $('h').value = d.h.toFixed(1);
    drawPreview();
    updateInfo();
  }
  relayout();
  return true;
}

function setBusy(on) {
  busy = on;
  for (const id of ['btnAI', 'btnColor', 'btnReset', 'file']) $(id).disabled = on;
  updateSend();
}

$('w').addEventListener('input', () => {
  const w = parseFloat($('w').value);
  if (!(w >= 0.5)) { $('sizeWarn').textContent = 'Escribe un ancho de al menos 0,5 cm.'; return; }
  cur().w = w; cur().h = w * cur().ratio; $('h').value = cur().h.toFixed(1);
  $('sizeWarn').textContent = '';
  updateInfo(); relayout();
});
$('h').addEventListener('input', () => {
  const h = parseFloat($('h').value);
  if (!(h >= 0.5)) { $('sizeWarn').textContent = 'Escribe un alto de al menos 0,5 cm.'; return; }
  cur().h = h; cur().w = h / cur().ratio; $('w').value = cur().w.toFixed(1);
  $('sizeWarn').textContent = '';
  updateInfo(); relayout();
});
$('qty').addEventListener('input', () => {
  const q = parseInt($('qty').value, 10);
  if (!(q >= 1)) { $('sizeWarn').textContent = 'La cantidad mínima es 1.'; return; }
  cur().qty = Math.min(MAX_QTY, q);
  $('sizeWarn').textContent = q > MAX_QTY ? `Máximo ${MAX_QTY} copias por imagen.` : '';
  relayout();
});
// Al salir del campo se muestra el valor real usado.
for (const id of ['w', 'h', 'qty']) {
  $(id).addEventListener('change', () => {
    if (!cur()) return;
    $('w').value = cur().w.toFixed(1); $('h').value = cur().h.toFixed(1); $('qty').value = cur().qty;
    $('sizeWarn').textContent = '';
  });
}
// Separación entre diseños en mm: nunca menos del mínimo técnico.
$('gap').addEventListener('input', () => {
  const mm = parseFloat($('gap').value);
  const min = config.separacionCm * 10, max = config.separacionMaxCm * 10;
  if (!(mm >= min && mm <= max)) { $('gapWarn').textContent = `La separación debe estar entre ${min} y ${max} mm.`; return; }
  $('gapWarn').textContent = '';
  gapCm = mm / 10;
  relayout();
});
$('gap').addEventListener('change', () => { $('gap').value = gapCm * 10; $('gapWarn').textContent = ''; });
$('tol').addEventListener('input', () => { $('tolVal').textContent = $('tol').value; });

$('file').addEventListener('change', async () => {
  const files = [...$('file').files];
  $('file').value = '';
  setBusy(true);
  try {
    for (const f of files) {
      if (designs.length >= MAX_DESIGNS) { alert(`Máximo ${MAX_DESIGNS} imágenes distintas por pedido.`); break; }
      let working;
      try { working = await loadImage(f); } catch { alert(`No se pudo leer "${f.name}". Usa PNG, JPG o WEBP.`); continue; }
      const d = { file: f, working, design: null, ratio: 1, w: 10, h: 10, qty: 1, cleaned: false };
      const t = trim(working);
      if (!t) { alert(`"${f.name}" está vacía (totalmente transparente).`); continue; }
      // Medida inicial: el lado más largo en 10 cm.
      const ratio = t.canvas.height / t.canvas.width;
      d.w = ratio > 1 ? 10 / ratio : 10;
      designs.push(d);
      sel = designs.length - 1;
      refreshDesign(d);
    }
  } finally {
    setBusy(false);
  }
  if (sel >= 0) select(sel);
});

$('btnReset').addEventListener('click', async () => {
  const d = cur();
  setBusy(true);
  try {
    d.working = await loadImage(d.file);
    d.cleaned = false;
    d.pick = d.lastBg = null;
    $('pickSwatch').classList.add('hidden');
    say('');
    refreshDesign(d);
  } finally { setBusy(false); }
});

// Clic en la vista previa: elige el color de fondo a quitar.
$('preview').addEventListener('click', (ev) => {
  const d = cur();
  const r = $('preview').getBoundingClientRect();
  const x = Math.floor(((ev.clientX - r.left) / r.width) * d.design.width);
  const y = Math.floor(((ev.clientY - r.top) / r.height) * d.design.height);
  const p = d.design.getContext('2d').getImageData(x, y, 1, 1).data;
  if (p[3] < 128) { say('Ese punto ya es transparente. Toca el color de fondo que quieres quitar.'); return; }
  d.pick = [p[0], p[1], p[2]];
  $('pickSwatch').style.background = `rgb(${p[0]},${p[1]},${p[2]})`;
  $('pickSwatch').classList.remove('hidden');
  say('Color elegido. Ahora pulsa "Quitar color de fondo".', 'ok');
});

// Quita el color de fondo: desde los bordes (o en toda la imagen), con borde suave y sin halo.
$('btnColor').addEventListener('click', () => {
  const d = cur();
  const work = d.working;
  const { width, height } = work;
  const ctx = work.getContext('2d');
  const img = ctx.getImageData(0, 0, width, height);
  const px = img.data;
  let bg = d.pick || d.lastBg; // el último color quitado sirve para repetir con "toda la imagen"
  if (!bg) {
    // Promedio de las esquinas que no son transparentes.
    const corners = [0, width - 1, (height - 1) * width, height * width - 1].filter((p) => px[p * 4 + 3] > 200);
    if (!corners.length) { say('No se detectó fondo en las esquinas. Toca el color del fondo en la imagen para elegirlo.', 'err'); return; }
    bg = [0, 1, 2].map((k) => corners.reduce((s, p) => s + px[p * 4 + k], 0) / corners.length);
  }
  const tol = parseInt($('tol').value, 10);
  const ramp = tol * 0.6 + 10; // franja de transición suave alrededor del diseño
  const dist = (p) => Math.hypot(px[p * 4] - bg[0], px[p * 4 + 1] - bg[1], px[p * 4 + 2] - bg[2]);
  const isBg = (p) => px[p * 4 + 3] > 0 && dist(p) <= tol;
  const removed = new Uint8Array(width * height);
  let count = 0;

  if ($('everywhere').checked) {
    for (let p = 0; p < width * height; p++) if (isBg(p)) { removed[p] = 1; count++; }
  } else {
    const stack = [];
    const push = (x, y) => { const p = y * width + x; if (!removed[p] && isBg(p)) { removed[p] = 1; count++; stack.push(p); } };
    for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
    for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
    while (stack.length) {
      const p = stack.pop();
      const x = p % width, y = (p - x) / width;
      if (x > 0) push(x - 1, y);
      if (x < width - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y < height - 1) push(x, y + 1);
    }
  }
  for (let p = 0; p < width * height; p++) if (removed[p]) px[p * 4 + 3] = 0;
  // Borde: los píxeles vecinos al fondo quitado se vuelven semitransparentes y se les retira el color del fondo (evita halo blanco).
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (removed[p] || px[p * 4 + 3] === 0) continue;
      const near = (x > 0 && removed[p - 1]) || (x < width - 1 && removed[p + 1]) || (y > 0 && removed[p - width]) || (y < height - 1 && removed[p + width]);
      if (!near) continue;
      const a = Math.min(1, Math.max(0, (dist(p) - tol) / ramp));
      if (a >= 1) continue;
      const i = p * 4;
      if (a < 0.15) { px[i + 3] = 0; continue; }
      for (let k = 0; k < 3; k++) px[i + k] = Math.max(0, Math.min(255, (px[i + k] - (1 - a) * bg[k]) / a));
      px[i + 3] = Math.round(px[i + 3] * a);
    }
  }
  if (!count) { say('No se encontró fondo de ese color. Sube la tolerancia o toca el fondo para elegir el color.', 'err'); return; }
  ctx.putImageData(img, 0, 0);
  d.cleaned = true;
  d.lastBg = bg;
  if (!refreshDesign(d)) {
    say('Se borró toda la imagen. Pulsa "Restaurar original" y baja la tolerancia.', 'err');
    return;
  }
  say(`Fondo quitado (${Math.round((count / (width * height)) * 100)}% de la imagen). Si quedan restos, sube la tolerancia y repite.`, 'ok');
});

// IA en el navegador: la imagen no sale del equipo hasta que se envía el pedido.
$('btnAI').addEventListener('click', async () => {
  const d = cur();
  if (!aiAccepted) {
    if (!confirm('La IA descarga unos 100 MB la primera vez (mejor con wifi) y puede tardar 20–60 segundos por imagen. ¿Continuar?')) return;
    aiAccepted = true;
  }
  setBusy(true);
  say('Cargando la IA…');
  try {
    if (!aiModule) aiModule = await import(AI_MODULE);
    const blob = await new Promise((r) => d.working.toBlob(r, 'image/png'));
    const out = await aiModule.removeBackground(blob, {
      model: 'isnet_fp16',
      output: { format: 'image/png' },
      progress: (key, c, total) => {
        if (total && key.startsWith('fetch')) say(`Descargando la IA: ${Math.round((c / total) * 100)}%`);
        else say('Quitando el fondo… (puede tardar)');
      }
    });
    // Se usa solo la máscara de la IA (firme en los extremos) sobre los colores y transparencia actuales.
    const bmp = await createImageBitmap(out);
    const m = document.createElement('canvas');
    m.width = d.working.width; m.height = d.working.height;
    m.getContext('2d').drawImage(bmp, 0, 0, m.width, m.height);
    const mask = m.getContext('2d').getImageData(0, 0, m.width, m.height).data;
    const ctx = d.working.getContext('2d');
    const img = ctx.getImageData(0, 0, m.width, m.height);
    for (let i = 3; i < mask.length; i += 4) {
      const a = mask[i] >= 200 ? 255 : mask[i] <= 30 ? 0 : mask[i];
      img.data[i] = Math.round((img.data[i] * a) / 255);
    }
    ctx.putImageData(img, 0, 0);
    d.cleaned = true;
    if (!refreshDesign(d)) say('La IA no encontró un objeto principal. Pulsa "Restaurar original" y prueba "Quitar color de fondo".', 'err');
    else if (cur() === d) say('Fondo quitado con IA. Revisa los bordes; para logos planos suele ir mejor "Quitar color de fondo".', 'ok');
  } catch (e) {
    console.error(e);
    aiModule = null;
    say('No se pudo usar la IA (revisa tu conexión). Prueba "Quitar color de fondo".', 'err');
  } finally {
    setBusy(false);
  }
});

// Exporta cada diseño a su resolución real (el servidor lo lleva a la medida de impresión).
function exportDesign(d) {
  const needed = Math.round((Math.max(d.w, d.h) / 2.54) * config.dpi);
  const scale = Math.min(1, needed / Math.max(d.design.width, d.design.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(d.design.width * scale));
  c.height = Math.max(1, Math.round(d.design.height * scale));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(d.design, 0, 0, c.width, c.height);
  // Píxeles casi transparentes fuera: evitan "polvo" de tinta blanca.
  const img = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] <= ALPHA_MIN) img.data[i] = 0;
  ctx.putImageData(img, 0, 0);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

$('send').addEventListener('click', async () => {
  const out = $('result');
  out.className = 'msg';
  if (!montage || montage.over || sent) return;
  setBusy(true);
  $('send').disabled = true;
  out.textContent = 'Preparando y enviando tus archivos… no cierres la página.';
  try {
    const fd = new FormData();
    for (let i = 0; i < designs.length; i++) {
      const blob = await exportDesign(designs[i]);
      if (!blob) throw new Error('Tu navegador no pudo preparar una imagen. Intenta reducir su medida o usar otra imagen.');
      fd.append('images', blob, `diseno${i}.png`);
    }
    const lc = document.createElement('canvas');
    lc.width = Math.round((config.anchoRolloCm / 2.54) * config.dpi);
    lc.height = Math.round((config.etiquetaCm / 2.54) * config.dpi);
    drawLabel(lc.getContext('2d'), lc.width, lc.height);
    fd.append('label', await new Promise((r) => lc.toBlob(r, 'image/png')), 'etiqueta.png');
    fd.append('meta', JSON.stringify({
      style,
      gapCm,
      designs: designs.map((d) => ({ wCm: d.w, hCm: d.h })),
      layout: montage.boxes.map((b) => ({ d: b.d, x: b.x, y: b.y, rot: b.rot })),
      name: $('name').value, phone: $('phone').value, note: $('note').value,
      accepted: true
    }));
    let res;
    try { res = await fetch('/api/orders', { method: 'POST', body: fd }); }
    catch { throw new Error('No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.'); }
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.error || `El servidor no pudo recibir el pedido (código ${res.status}). Intenta de nuevo en un momento.`);
    sent = true;
    $('send').classList.add('hidden');
    $('again').classList.remove('hidden');
    out.className = 'msg ok big';
    out.textContent = `¡Pedido recibido! Referencia ${data.ref} · Total estimado ${fmt(data.price)} + IVA. Te contactaremos pronto por WhatsApp.`;
    out.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    out.className = 'msg err';
    out.textContent = e.message;
  } finally {
    setBusy(false);
  }
});

$('again').addEventListener('click', () => location.reload());
for (const id of ['name', 'phone']) $(id).addEventListener('input', () => { if (montage) drawMontage(); updateSend(); });
window.addEventListener('beforeunload', (e) => { if (designs.length && !sent) { e.preventDefault(); e.returnValue = ''; } });

fetch('/api/config').then((r) => r.json()).then((c) => {
  config = c;
  gapCm = c.separacionCm;
  $('gap').min = c.separacionCm * 10; $('gap').max = c.separacionMaxCm * 10; $('gap').value = c.separacionCm * 10;
  renderTerms(); renderStyles(); updateSend(); });
