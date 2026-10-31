const $ = (id) => document.getElementById(id);
const ALPHA_MIN = 10;      // alfa mínimo para considerar un píxel como parte del diseño
// iPhone/iPad (Safari): poca memoria para lienzos y un máximo de ~16,7 millones de píxeles por lienzo.
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const CANVAS_MAX_PX = 16e6;  // área máxima segura de un lienzo en todos los navegadores
const WORK_MAX = IOS ? 2200 : 3000; // lado máximo (px) para editar en el navegador
const MAX_DESIGNS = 30;    // imágenes distintas por pedido (memoria del navegador)
const DPI_WARN = 150;      // por debajo de esto la impresión puede verse pixelada
const DPI_BAD = 72;
const BIG = 100000;        // alto "infinito" del rollo al empaquetar (cm)

let config;
let designs = [];   // { file, working, logo, design, offX, offY, thumb, ratio, w, h, qty, cleaned, shape, shapeColor, shapePad }
let sel = -1;
let style = 'premium';
let montage = null; // { boxes, lengthCm, over, labelY, invalid }
let busy = false;
let sent = false;
let gapCm = null;   // separación entre diseños elegida por el cliente (mínimo según el producto)
let product = 'dtf'; // 'dtf' o 'vinilo'
let variant = 'eco'; // tipo de vinilo
let capa = 'blanco'; // para "UV + blanco o brillo"
const cutType = 'medio'; // por ahora solo semicorte
let offsetCm = null; // margen de la línea de corte alrededor del diseño (vinilo)

function hasWhite() {
  const v = config.vinilo.variantes.find((x) => x.id === variant);
  return v.capas.includes('blanco') || (v.capas.includes('elegir') && capa === 'blanco');
}

// Diseño rectangular (llena su recuadro): corte recto y puede ir unido a otros rectangulares.
function isRect(d) {
  if (d.shape === 'circulo' || d.shape === 'redondeado') return false; // su corte sigue la curva
  if (d.rectSrc === d.design) return d.rect;
  const c = document.createElement('canvas');
  const k = Math.min(1, 200 / Math.max(d.design.width, d.design.height));
  c.width = Math.max(1, Math.round(d.design.width * k)); c.height = Math.max(1, Math.round(d.design.height * k));
  const ctx = c.getContext('2d');
  ctx.drawImage(d.design, 0, 0, c.width, c.height);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const alpha = new Uint8Array(c.width * c.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3];
  d.rect = Contour.coverage(alpha, c.width, c.height) >= config.vinilo.rectanguloCobertura;
  d.rectSrc = d.design;
  return d.rect;
}

// Medidas y límites del producto elegido.
function P() {
  if (product === 'vinilo') {
    const v = config.vinilo;
    // Con base blanca el montaje es 145 x 55 cm; a color o con brillo, 95 x 95 cm.
    const area = hasWhite() ? v.areaBlanco : v.areaColor;
    return { W: area.anchoCm, gapMin: v.separacionCm, gapMax: v.separacionMaxCm, off: offsetCm, minLen: v.largoMinimoCm, maxLen: area.largoMaxCm, maxPieces: v.maxPiezas, terms: v.aclaraciones };
  }
  return { W: config.anchoRolloCm, gapMin: config.separacionCm, gapMax: config.separacionMaxCm, off: 0, minLen: config.largoMinimoCm, maxLen: config.largoMaximoCm, maxPieces: config.maxPiezas, terms: config.aclaraciones };
}

const fmt = (n) => '$' + Math.round(n).toLocaleString('es-CO');
// Números escritos con coma o punto (2,5 o 2.5).
const num = (v) => parseFloat(String(v).trim().replace(',', '.'));
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

// Forma del sticker: pone el logo (ya recortado) dentro de un círculo, cuadro redondeado o rectángulo
// del color elegido. La figura queda como parte de la imagen, así el corte, el blanco y el precio la siguen solos.
const SHAPE_MAX = IOS ? 2800 : 3900; // lado máximo (px) de la imagen con forma (área < CANVAS_MAX_PX)
function applyShape(src, shape, color, padPct) {
  if (!shape || shape === 'silueta') return src;
  const { width: w, height: h } = src;
  const pad = padPct / 100;
  let W, H, r;
  if (shape === 'circulo') {
    // Círculo mínimo centrado que contiene todos los píxeles visibles del logo.
    const px = src.getContext('2d').getImageData(0, 0, w, h).data;
    const cx = w / 2, cy = h / 2;
    let max2 = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (px[(y * w + x) * 4 + 3] <= ALPHA_MIN) continue;
        const dx = Math.max(Math.abs(x - cx), Math.abs(x + 1 - cx)), dy = Math.max(Math.abs(y - cy), Math.abs(y + 1 - cy));
        if (dx * dx + dy * dy > max2) max2 = dx * dx + dy * dy;
      }
    }
    W = H = 2 * Math.sqrt(max2) * (1 + pad);
  } else {
    const p = pad * Math.max(w, h);
    W = w + 2 * p; H = h + 2 * p;
  }
  const k = Math.min(1, SHAPE_MAX / Math.max(W, H));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath();
  if (shape === 'circulo') ctx.arc(c.width / 2, c.height / 2, c.width / 2, 0, Math.PI * 2);
  else {
    r = shape === 'redondeado' ? 0.15 * Math.min(c.width, c.height) : 0;
    ctx.moveTo(r, 0);
    ctx.arcTo(c.width, 0, c.width, c.height, r); ctx.arcTo(c.width, c.height, 0, c.height, r);
    ctx.arcTo(0, c.height, 0, 0, r); ctx.arcTo(0, 0, c.width, 0, r);
    ctx.closePath();
  }
  ctx.fill();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, (c.width - w * k) / 2, (c.height - h * k) / 2, w * k, h * k);
  return c;
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

// Acomoda todas las piezas (qtys: cantidad por diseño). Devuelve las cajas o null si no se pudo.
function packDesigns(qtys, p = P()) {
  const items = [];
  // En vinilo cada pieza ocupa el diseño más el margen de corte a cada lado.
  // Los rectangulares van sin margen: se cortan justo en el borde, unidos entre sí.
  designs.forEach((d, i) => {
    const o = product === 'vinilo' && isRect(d) ? 0 : p.off;
    for (let k = 0; k < qtys[i]; k++) items.push({ d: i, w: d.w + 2 * o, h: d.h + 2 * o });
  });
  if (product !== 'vinilo') return packBest(items, p.W, gapCm);
  // Los diseños rectangulares van unidos (corte recto compartido); el resto, con separación.
  const rect = items.filter((it) => isRect(designs[it.d])), other = items.filter((it) => !isRect(designs[it.d]));
  const br = rect.length ? packBest(rect, p.W, 0) : [];
  const bo = other.length ? packBest(other, p.W, gapCm) : [];
  if (!br || !bo) return null;
  const y0 = br.length ? Math.max(...br.map((b) => b.y + b.h)) + gapCm : 0;
  return br.concat(bo.map((b) => ({ ...b, y: b.y + y0 })));
}
// Largo total del montaje: piezas + separación + franja con el nombre.
const rawLengthOf = (boxes) => Math.max(...boxes.map((b) => b.y + b.h)) + gapCm + config.etiquetaCm;

// Máxima cantidad del diseño i que cabe junto con los demás (búsqueda binaria con el acomodo real).
// maxLen opcional: largo tope (en DTF, el largo actual del montaje para no subir el precio).
function maxFit(i, maxLen) {
  const p = P();
  const lim = maxLen || p.maxLen;
  const d = designs[i];
  const qtys = designs.map((x) => x.qty);
  const others = qtys.reduce((s, q, k) => s + (k === i ? 0 : q), 0);
  const ok = (q) => { qtys[i] = q; const b = packDesigns(qtys, p); return !!b && rawLengthOf(b) <= lim + 1e-9; };
  if (!ok(1)) return 0;
  const o = product === 'vinilo' && isRect(d) ? 0 : p.off;
  let lo = 1, hi = Math.min(p.maxPieces - others, Math.floor((p.W * lim) / ((d.w + 2 * o) * (d.h + 2 * o))) + 1);
  if (others + 1 > p.maxPieces) return 0;
  if (hi <= lo) return lo;
  if (ok(hi)) return hi;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ok(m)) lo = m; else hi = m; }
  return lo;
}

// Estimado rápido: cuántas piezas de w x h caben en una franja de ancho W y largo L.
function gridCount(d, w, h, L, p = P()) {
  const rect = product === 'vinilo' && isRect(d);
  const o = rect ? 0 : p.off, g = rect ? 0 : gapCm;
  return Math.min(p.maxPieces, Pricing.fitCount(p.W, L, w + 2 * o, h + 2 * o, g));
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
  $('unit').textContent = '';
  $('iva').textContent = '';
  $('perDesign').innerHTML = '';
  $('waste').textContent = '';
  $('limit').textContent = reason;
  renderFree(null);
  updateBar();
  const c = $('montage'); c.width = 1; c.height = 1;
}

function relayout() {
  renderChips();
  const ready = designs.filter((d) => d.design);
  $('quote').classList.toggle('hidden', !ready.length);
  if (!ready.length) { montage = null; renderStyles(); updateSend(); return; }

  const total = pieceCount();
  const p = P();
  const fits = (d) => {
    const o = product === 'vinilo' && isRect(d) ? 0 : p.off;
    const a = d.w + 2 * o, b = d.h + 2 * o;
    return (a <= p.W && b <= p.maxLen) || (b <= p.W && a <= p.maxLen);
  };
  const tooWide = designs.find((d) => !fits(d));
  if (tooWide) invalidQuote(`Una imagen no cabe en el área de impresión (${p.W} × ${p.maxLen} cm). Reduce su medida.`);
  else if (total > p.maxPieces) invalidQuote(`Máximo ${p.maxPieces} piezas por pedido (tienes ${total}). Reduce las cantidades.`);
  else {
    const boxes = packDesigns(designs.map((d) => d.qty), p);
    if (!boxes) invalidQuote('No se pudo acomodar el montaje. Revisa las medidas.');
    else {
      // Al final del montaje va una franja con el nombre del cliente.
      const layoutLength = Math.max(...boxes.map((b) => b.y + b.h));
      const labelY = layoutLength + gapCm;
      const rawLength = labelY + config.etiquetaCm;
      const lengthCm = Math.max(p.minLen, rawLength); // montaje mínimo
      const over = rawLength > p.maxLen + 1e-9;
      const usedWidth = Math.max(...boxes.map((b) => b.x + b.w));
      montage = { boxes, lengthCm, over, labelY, usedWidth };

      const used = boxes.reduce((s, b) => s + b.w * b.h, 0);
      let q, empty;
      if (product === 'vinilo') {
        q = Pricing.quoteVinyl(config, variant, { anchoCm: p.W, largoMaxCm: p.maxLen }, hasSmallPieces(boxes));
        empty = Math.max(0, Math.round((1 - used / (p.W * p.maxLen)) * 100));
        $('stats').textContent = over ? `${boxes.length} piezas: no caben en un pliego de ${p.W} × ${p.maxLen} cm` : `${boxes.length} ${boxes.length === 1 ? 'pieza' : 'piezas'} en el pliego de ${p.W} × ${p.maxLen} cm`;
      } else {
        q = Pricing.quote(config, style, lengthCm);
        empty = Math.round((1 - used / (p.W * lengthCm)) * 100);
        $('stats').textContent = `${boxes.length} pieza(s) · montaje de ${p.W} × ${shownLength(lengthCm)} cm` +
          (rawLength < p.minLen ? ` (montaje mínimo ${p.W} × ${p.minLen} cm)` : '');
      }
      $('price').textContent = fmt(q.price);
      $('price').classList.toggle('off', over);
      $('detail').textContent = over ? '' : q.detalle;
      $('limit').textContent = over
        ? (product === 'vinilo'
          ? `No cabe en un pliego: necesitas ${rawLength.toFixed(1)} cm de largo y el pliego mide ${p.maxLen} cm. Reduce la medida o la cantidad, o escríbenos para pedir varios pliegos.`
          : `El montaje mide ${rawLength.toFixed(0)} cm y el máximo en línea es ${p.maxLen} cm. Reduce medidas o cantidades, o escríbenos para cotizar por metros.`)
        : '';
      if (over) { suggestShrink(); addWaLink($('limit'), 'Cotizar un pedido grande por WhatsApp', 'Hola, quiero cotizar un pedido grande de stickers.'); }
      $('iva').textContent = over || !config.ivaPct ? '' : `+ IVA ${config.ivaPct}%: ${fmt(q.price * config.ivaPct / 100)} · Total con IVA ${fmt(q.price * (1 + config.ivaPct / 100))}`;
      $('unit').textContent = over ? '' : boxes.length === 1 ? 'Escribe cuántas necesitas para ver el valor por unidad.' : `${fmt(q.price / boxes.length)} c/u con tus ${boxes.length} piezas` +
        (product === 'vinilo' && empty > 30 ? ' · llena el pliego y baja el valor por unidad sin pagar más' : '');
      $('waste').textContent = empty > 5 && !over && product !== 'vinilo'
        ? `Espacio libre en tu montaje: ${empty}%. Ese espacio se cobra porque consume material; puedes aprovecharlo agregando más imágenes sin pagar más.`
        : '';
      if (product === 'vinilo' && !over && hasSmallPieces(boxes)) smallHint();
      // Cantidad y medida de cada imagen (para clientes con varios logos).
      $('perDesign').innerHTML = '';
      if (designs.length > 1) designs.forEach((d, i) => {
        const li = document.createElement('li');
        const mine = boxes.filter((b) => b.d === i);
        const share = mine.reduce((a, b) => a + b.w * b.h, 0) / used; // parte del precio según el área que ocupa
        li.textContent = `Imagen ${i + 1}: ${mine.length} u. de ${d.w.toFixed(1)} × ${d.h.toFixed(1)} cm · ≈ ${fmt(q.price * share)} (${fmt((q.price * share) / mine.length)} c/u)`;
        $('perDesign').appendChild(li);
      });
      renderFree(over ? null : { used: 100 - empty, freeLen: p.maxLen - rawLength });
      renderFit();
      drawMontage();
      updateBar();
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

// Contorno de corte de un diseño (se recalcula si cambia la imagen, la medida o el margen).
function cutFor(d) {
  const key = `${offsetCm}|${d.w.toFixed(2)}|${d.h.toFixed(2)}`;
  if (d.cut && d.cut.key === key && d.cut.src === d.design) return d.cut.polys;
  const ppc = Contour.contourPxPerCm(d.w, d.h);
  const cw = Math.max(2, Math.round(d.w * ppc)), ch = Math.max(2, Math.round(d.h * ppc));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d');
  ctx.drawImage(d.design, 0, 0, cw, ch);
  const px = ctx.getImageData(0, 0, cw, ch).data;
  const alpha = new Uint8Array(cw * ch);
  for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3];
  const corte = config.vinilo.corte || {};
  const polys = Contour.cutContours(alpha, cw, ch, cw / d.w, offsetCm,
    { radiusCm: corte.radioMinimoCm || 0, check: { minWidthCm: corte.anchoMinimoCm, minSizeCm: corte.tamanoMinimoCm } });
  d.cut = { key, src: d.design, polys };
  return polys;
}

// Barra de uso del pliego (vinilo): cuánto se usó y cuánto queda libre.
function renderFree(info) {
  const box = $('freeInfo');
  if (product !== 'vinilo' || !info) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  $('freeBar').style.width = `${Math.min(100, info.used)}%`;
  const d = cur();
  let more = '';
  if (d && info.freeLen > 0.5) {
    const n = gridCount(d, d.w, d.h, info.freeLen);
    if (n > 0) more = ` En la franja libre de abajo caben aprox. ${n} más de la imagen seleccionada (${d.w.toFixed(1)} × ${d.h.toFixed(1)} cm).`;
  }
  $('freeText').textContent = `Usas ${info.used}% del pliego y te queda ${100 - info.used}% libre. Se cobra el pliego completo: aprovéchalo.${more}`;
}

// Condiciones comerciales y datos del negocio (solo lo que esté lleno en config.json).
function renderInfo() {
  const c = config.comercial || {}, k = config.contacto || {};
  const rows = [['Tiempo de producción', c.plazo], ['Formas de pago', c.pago], ['Factura', c.factura], ['Envío y entrega', c.envio]].filter(([, v]) => v);
  if (rows.length) {
    const box = $('comercial');
    box.innerHTML = '<p><b>Condiciones del pedido</b></p><ul></ul>';
    for (const [t, v] of rows) { const li = document.createElement('li'); li.innerHTML = '<b></b> '; li.firstChild.textContent = t + ':'; li.append(v); box.querySelector('ul').appendChild(li); }
    box.classList.remove('hidden');
  }
  const parts = [k.negocio, k.whatsapp && `WhatsApp +${k.whatsapp}`, k.correo, k.direccion, k.horario].filter(Boolean);
  $('footer').innerHTML = '';
  for (const t of parts.filter((x) => !String(x).startsWith('WhatsApp'))) { const sp = document.createElement('span'); sp.textContent = t; $('footer').appendChild(sp); }
  if (k.whatsapp) {
    // WhatsApp como enlace, en el pie y arriba (para dudas u otros productos).
    const a = document.createElement('a');
    a.href = `https://wa.me/${k.whatsapp}?text=${encodeURIComponent('Hola, tengo una pregunta sobre un pedido.')}`;
    a.target = '_blank'; a.rel = 'noopener'; a.textContent = `WhatsApp +${k.whatsapp}`;
    $('footer').append(a);
    const top = document.createElement('p');
    top.className = 'muted';
    top.innerHTML = '¿Dudas o buscas otro producto (impresión, tesis, álbumes…)? ';
    const b = a.cloneNode(true); b.textContent = 'Escríbenos por WhatsApp';
    top.appendChild(b);
    document.querySelector('header').appendChild(top);
  }
}

// Envío con progreso de subida (XMLHttpRequest); la demostración sin servidor usa fetch.
function postOrder(fd, onProgress) {
  if (window.fetch.isDemo) return fetch('/api/orders', { method: 'POST', body: fd });
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/orders');
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
    x.onload = () => resolve({ ok: x.status >= 200 && x.status < 300, status: x.status, json: async () => JSON.parse(x.responseText) });
    x.onerror = x.ontimeout = () => reject(new Error('red'));
    x.send(fd);
  });
}
const frame = () => new Promise((r) => setTimeout(r, 30)); // deja que la pantalla muestre el aviso antes de un trabajo pesado

// Si no cabe, busca la medida (todas las imágenes reducidas en la misma proporción) con la que sí caben
// las cantidades pedidas, y ofrece aplicarla con un botón.
function suggestShrink() {
  const p = P(), orig = designs.map((d) => [d.w, d.h]);
  const fits = (f) => {
    designs.forEach((d, i) => { d.w = orig[i][0] * f; d.h = orig[i][1] * f; });
    const b = packDesigns(designs.map((d) => d.qty), p);
    return !!b && rawLengthOf(b) <= p.maxLen + 1e-9;
  };
  let lo = 0.05, hi = 1;
  if (fits(lo)) { for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; } }
  else lo = 0;
  designs.forEach((d, i) => { d.w = orig[i][0]; d.h = orig[i][1]; });
  const f = Math.floor(lo * 100) / 100;
  if (f < 0.1) return;
  const d0 = designs[0];
  const label = designs.length === 1 ? `Usar ${(Math.floor(Math.max(d0.w, d0.h) * f * 10) / 10).toLocaleString('es-CO')} cm (caben las ${d0.qty})` : `Reducir todas al ${Math.round(f * 100)} % (caben todas)`;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'sec'; btn.style.cssText = 'width:auto;display:block;margin-top:8px';
  btn.textContent = label;
  btn.addEventListener('click', () => {
    if (busy) return;
    // Se baja un poco más si el redondeo a 0,1 cm no alcanza.
    designs.forEach((d) => { const big = Math.max(d.w, d.h), nb = Math.floor(big * f * 10) / 10; d.w = d.w * nb / big; d.h = d.h * nb / big; });
    if (cur()) select(sel);
    relayout();
  });
  $('limit').appendChild(btn);
}

// Enlace de WhatsApp del negocio (si está configurado).
function addWaLink(el, label, text) {
  const wa = config.contacto && config.contacto.whatsapp;
  if (!wa) return;
  const a = document.createElement('a');
  a.href = `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;
  a.target = '_blank'; a.rel = 'noopener'; a.className = 'wa'; a.textContent = label;
  el.appendChild(a);
}

// Piezas de menos de 3 cm: todo el pliego va a la tarifa de corte pequeño. Se ofrece agrandarlas a 3 cm.
function smallHint() {
  const v = config.vinilo.variantes.find((x) => x.id === variant);
  const min = config.vinilo.piezaPequenaCm;
  if (!v.precioPequeno || v.precioPequeno === v.precio) return;
  $('waste').innerHTML = `Tienes stickers de menos de ${min} cm, así que el pliego cuesta ${fmt(v.precioPequeno)} (tarifa de corte pequeño). ` +
    `Si los haces de ${min} cm o más pagas ${fmt(v.precio)}. <button type="button" class="sec" id="btnMin" style="width:auto;display:block;margin-top:8px">Pasar a ${min} cm</button>`;
  $('btnMin').addEventListener('click', () => {
    if (busy) return;
    for (const d of designs) {
      const realBig = Math.max(...realSize(d));
      if (Pricing.isSmall(config, ...realSize(d))) { d.w = d.w * min / realBig; d.h = d.h * min / realBig; }
    }
    if (cur()) select(sel);
    relayout();
  });
}

function drawMontage() {
  const p = P();
  const sheet = product === 'vinilo'; // en vinilo se muestra el pliego completo
  const L = sheet ? p.maxLen : montage.lengthCm;
  const cssW = Math.max(280, $('montageBox').clientWidth - 16);
  // Resolución según la pantalla (nítido también en celular) con un tope de tamaño.
  const s = Math.min(40, (cssW * Math.min(2, window.devicePixelRatio || 1)) / p.W, 5000 / Math.max(p.W, L), Math.sqrt((IOS ? 9e6 : CANVAS_MAX_PX) / (p.W * L)));
  const k = s / 8; // grosor de líneas relativo a la escala
  const c = $('montage');
  c.width = Math.round(p.W * s);
  c.height = Math.max(1, Math.round(L * s));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#eee';
  const q = Math.max(12, Math.round(1.5 * s));
  for (let y = 0; y < c.height; y += q) for (let x = (y / q) % 2 ? 0 : q; x < c.width; x += 2 * q) ctx.fillRect(x, y, q, q);
  if (sheet) {
    // Espacio libre del pliego: franja de abajo y el lado derecho de lo usado.
    const usedL = montage.labelY + config.etiquetaCm;
    ctx.save();
    ctx.fillStyle = 'rgba(26,26,26,.05)';
    ctx.fillRect(0, usedL * s, c.width, c.height - usedL * s);
    ctx.fillRect(montage.usedWidth * s, 0, c.width - montage.usedWidth * s, montage.labelY * s);
    ctx.strokeStyle = 'rgba(26,26,26,.10)'; ctx.lineWidth = 1 * k;
    ctx.beginPath();
    for (let t = -c.height; t < c.width; t += 3 * s) {
      ctx.moveTo(t, usedL * s); ctx.lineTo(t + (c.height - usedL * s), c.height);
    }
    ctx.stroke();
    const freeH = L - usedL;
    if (freeH > 6) {
      ctx.fillStyle = 'rgba(26,26,26,.55)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.min(3.2, freeH / 4) * s}px system-ui, sans-serif`;
      ctx.fillText(`Espacio libre ${p.W} × ${freeH.toFixed(1)} cm`, c.width / 2, (usedL + freeH / 2) * s);
    }
    ctx.restore();
  }
  for (const b of montage.boxes) {
    const dz = designs[b.d];
    // Caja del diseño dentro de la pieza (sin el margen de corte).
    const o = product === 'vinilo' && isRect(dz) ? 0 : p.off;
    const x = b.x + o, y = b.y + o, w = b.w - 2 * o, h = b.h - 2 * o;
    ctx.save();
    if (b.rot) {
      ctx.translate((x + w) * s, y * s); ctx.rotate(Math.PI / 2);
      ctx.drawImage(dz.design, 0, 0, h * s, w * s);
    } else {
      ctx.drawImage(dz.design, x * s, y * s, w * s, h * s);
    }
    ctx.restore();
    if (product === 'vinilo') {
      // Línea de corte: mismo cálculo que usa el taller.
      ctx.save();
      ctx.strokeStyle = '#e0007a'; ctx.lineWidth = 1.2 * k; ctx.setLineDash([4 * k, 3 * k]);
      for (const poly of (isRect(dz) ? Contour.rectContour(dz.w, dz.h, 0) : cutFor(dz))) {
        ctx.beginPath();
        const at = ([px, py]) => (b.rot ? [(x + (dz.h - py)) * s, (y + px) * s] : [(x + px) * s, (y + py) * s]);
        ctx.moveTo(...at(poly[0]));
        if (poly.smooth) for (const q of Contour.bezier(poly)) ctx.bezierCurveTo(...at([q[0], q[1]]), ...at([q[2], q[3]]), ...at([q[4], q[5]]));
        else poly.slice(1).forEach((pt) => ctx.lineTo(...at(pt)));
        ctx.closePath(); ctx.stroke();
      }
      ctx.restore();
    }
  }
  ctx.save();
  ctx.translate(0, montage.labelY * s);
  drawLabel(ctx, c.width, config.etiquetaCm * s);
  ctx.restore();
  if (sheet) {
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2 * k; ctx.setLineDash([]);
    ctx.strokeRect(0, 0, c.width, c.height);
  }
  watermark(ctx, c.width, c.height, s);
}

// Marca de agua de la vista previa: el montaje es del taller y la vista no sirve como archivo de impresión.
function watermark(ctx, W, H, s) {
  const text = `${(config.contacto && config.contacto.negocio) || 'Smith Impresores'} · VISTA PREVIA`;
  const size = Math.max(14, 2.2 * s);
  ctx.save();
  ctx.font = `700 ${size}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(26,26,26,.13)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width + size * 3, th = size * 5;
  ctx.translate(W / 2, H / 2); ctx.rotate(-Math.PI / 6);
  const R = Math.hypot(W, H) / 2 + tw;
  for (let y = -R, row = 0; y < R; y += th, row++) {
    for (let x = -R + (row % 2) * tw / 2; x < R; x += tw) ctx.fillText(text, x, y);
  }
  ctx.restore();
}

// Vista ampliada del montaje (pantalla completa; tocar alterna ajustar / tamaño real).
function openZoom() {
  if (!montage) return;
  if (document.documentElement.classList.contains('embed')) {
    // Dentro de otra página la pantalla completa quedaría tapada: se amplía en el mismo lugar (nunca como imagen descargable).
    const big = $('montageBox').classList.toggle('big');
    $('btnZoom').textContent = big ? 'Ver más pequeño' : 'Ver en grande';
    return;
  }
  // Copia en un lienzo (no en una imagen) para que no se pueda guardar con clic derecho o pulsación larga.
  const z = $('zoomImg'), m = $('montage');
  z.width = m.width; z.height = m.height;
  z.getContext('2d').drawImage(m, 0, 0);
  $('zoomImg').classList.remove('real');
  $('zoom').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeZoom() {
  if ($('zoom').classList.contains('hidden')) return;
  $('zoom').classList.add('hidden');
  $('btnZoom').focus();
  $('zoomImg').width = 1; $('zoomImg').height = 1; // libera memoria
  document.body.style.overflow = '';
}
$('btnZoom').addEventListener('click', openZoom);
$('montage').addEventListener('click', openZoom);
$('zoomClose').addEventListener('click', closeZoom);
$('zoomImg').addEventListener('click', () => $('zoomImg').classList.toggle('real'));
for (const id of ['montage', 'zoomImg']) {
  $(id).addEventListener('contextmenu', (e) => e.preventDefault());
  $(id).addEventListener('dragstart', (e) => e.preventDefault());
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeZoom();
  // Con la vista ampliada abierta el foco se queda en ella.
  if (e.key === 'Tab' && !$('zoom').classList.contains('hidden')) { e.preventDefault(); $('zoomClose').focus(); }
});
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (montage) drawMontage(); }, 200); });

// Piezas con el lado mayor por debajo del límite de corte pequeño.
const hasSmallPieces = (boxes) => boxes.some((b) => Pricing.isSmall(config, ...realSize(designs[b.d])));

// Celular: barra fija abajo con el precio y un acceso a los datos de envío.
function updateBar() {
  const show = !!montage && !montage.over && !sent && !barHidden;
  $('stickyBar').classList.toggle('hidden', !show);
  const one = montage && montage.boxes.length === 1;
  if (show) $('barPrice').textContent = one ? `${$('price').textContent} · pon la cantidad` : `${$('price').textContent} · ${$('unit').textContent.split(' · ')[0]}`;
}
let barHidden = false;

function renderStyles() {
  const keepFocus = $('styles').contains(document.activeElement);
  setTimeout(() => { if (keepFocus) { const r = $('styles').querySelector('input:checked'); if (r) r.focus(); } });
  const L = montage && !montage.over ? montage.lengthCm : null;
  $('styles').innerHTML = '';
  $('vinylOpts').classList.toggle('hidden', product !== 'vinilo');
  $('styleNote').textContent = product === 'vinilo'
    ? `Precio por pliego completo de ${config.vinilo.areaColor.anchoCm} × ${config.vinilo.areaColor.largoMaxCm} cm: pagas el pliego aunque no lo llenes, así que aprovéchalo. IVA no incluido.`
    : `Precios sobre ${config.anchoRolloCm} cm de ancho, IVA no incluido. Los valores mostrados corresponden a tu montaje actual.`;
  if (product === 'vinilo') {
    for (const v of config.vinilo.variantes) {
      const card = document.createElement('label');
      card.className = 'style-card' + (v.id === variant ? ' sel' : '');
      const price = `${fmt(L != null && montage.boxes && hasSmallPieces(montage.boxes) && v.precioPequeno ? v.precioPequeno : v.precio)} / pliego`;
      card.innerHTML = `<input type="radio" name="variant" ${v.id === variant ? 'checked' : ''}>
        <h3>${v.nombre}</h3><ul>${v.puntos.map((t) => `<li>${t}</li>`).join('')}</ul><div class="p">${price}</div>`;
      if (v.capas.includes('elegir') && v.id === variant) {
        const pick = document.createElement('div');
        pick.className = 'row';
        pick.innerHTML = ['blanco', 'brillo'].map((k) =>
          `<label class="check"><input type="radio" name="capa" value="${k}" ${capa === k ? 'checked' : ''}> ${k === 'blanco' ? 'Blanco' : 'Brillo'}</label>`).join('');
        pick.querySelectorAll('input').forEach((r) => r.addEventListener('change', () => { capa = r.value; setProduct('vinilo'); }));
        card.appendChild(pick);
      }
      card.querySelector('input').addEventListener('change', () => { variant = v.id; setProduct('vinilo'); });
      $('styles').appendChild(card);
    }
    return;
  }
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
  const terms = P().terms;
  $('terms').innerHTML = `<details><summary>Leer las ${terms.length} aclaraciones (medidas, colores, tarifas y entrega del archivo)</summary><ol>` + terms.map(() => '<li></li>').join('') + '</ol></details>' +
    '<label><input type="checkbox" id="accept"> <b>He leído y acepto las ' + terms.length + ' aclaraciones.</b></label>';
  $('terms').querySelectorAll('li').forEach((li, i) => { li.textContent = terms[i]; });
  $('accept').addEventListener('change', updateSend);
}

function updateSend() {
  let hint = '';
  if (sent) hint = '';
  else if (!montage) hint = designs.length ? 'Corrige el montaje para poder enviar.' : 'Sube al menos una imagen.';
  else if (montage.over) hint = `El montaje supera el largo máximo (${P().maxLen} cm). Quita piezas o hazlas más pequeñas.`;
  else if (!$('accept').checked) hint = 'Marca la casilla de aceptación de las aclaraciones.';
  else if (!$('name').value.trim() || !$('phone').value.trim()) hint = 'Escribe tu nombre y tu WhatsApp.';
  else if ($('phone').value.replace(/\D/g, '').length < 7) hint = 'Revisa tu número de WhatsApp (ej. 300 123 4567).';
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

const focusChip = (i) => { const c = $('chips').children[i]; if (c) c.focus(); };
function renderChips() {
  const hadFocus = $('chips').contains(document.activeElement) ? sel : -1;
  $('chips').innerHTML = '';
  const low = designs.some((d) => d.design && dpiOf(d) < DPI_WARN);
  designs.forEach((d, i) => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (i === sel ? ' sel' : '');
    chip.title = `${d.w.toFixed(1)} × ${d.h.toFixed(1)} cm · ${d.qty} u.`;
    chip.tabIndex = 0; chip.setAttribute('role', 'button');
    chip.setAttribute('aria-pressed', String(i === sel));
    chip.setAttribute('aria-label', `Imagen ${i + 1}: ${d.w.toFixed(1)} × ${d.h.toFixed(1)} cm, ${d.qty} unidades${dpiOf(d) < DPI_WARN ? ', calidad baja' : ''}. Editar`);
    chip.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === chip) { e.preventDefault(); if (!busy) { select(i); focusChip(i); } } });
    chip.appendChild(d.thumb);
    const num = document.createElement('span');
    num.className = 'num'; num.textContent = i + 1; num.setAttribute('aria-hidden', 'true');
    chip.appendChild(num);
    if (dpiOf(d) < DPI_WARN) {
      const w = document.createElement('span');
      w.className = 'badge'; w.textContent = '!'; w.title = 'Resolución baja';
      chip.appendChild(w);
    }
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'x'; x.textContent = '×'; x.setAttribute('aria-label', `Quitar imagen ${i + 1}`);
    x.addEventListener('click', (ev) => { ev.stopPropagation(); if (!busy && confirm('¿Quitar esta imagen del pedido?')) removeDesign(i); });
    chip.appendChild(x);
    chip.addEventListener('click', () => { if (!busy) select(i); });
    $('chips').appendChild(chip);
  });
  if (hadFocus >= 0) focusChip(hadFocus);
  $('fileHint').textContent = designs.length ? `${designs.length} imagen(es). Toca una para editarla.${low ? ' El «!» indica calidad baja para la medida elegida.' : ''}` : '';
}

function removeDesign(i) {
  // Safari no libera la memoria de un lienzo hasta que se le pone tamaño 0.
  const gone = designs[i];
  for (const k of ['working', 'logo', 'design', 'thumb']) if (gone[k] && gone[k] !== gone.design) { gone[k].width = 0; gone[k].height = 0; }
  if (gone.design) { gone.design.width = 0; gone.design.height = 0; }
  if (gone.undo) { gone.undo.canvas.width = 0; gone.undo = null; }
  designs.splice(i, 1);
  if (!designs.length) { sel = -1; $('editor').classList.add('hidden'); }
  else {
    if (i < sel) sel--;
    select(Math.min(sel, designs.length - 1));
  }
  relayout();
  fixOverflow();
}

// Si el montaje queda desbordado (el acomodo cambia al quitar una imagen), se reajustan
// las cantidades que se llenaron automáticamente con «Llenar el espacio libre».
function fixOverflow() {
  if (!montage || !montage.over) return;
  for (let i = designs.length - 1; i >= 0 && montage && montage.over; i--) {
    const d = designs[i];
    if (!d.filled) continue;
    d.qty = 1;
    d.qty = Math.max(1, maxFit(i));
    relayout();
  }
  if (montage && !montage.over) say('Ajustamos las cantidades que se habían llenado automáticamente para que todo quepa.', 'warn');
}

function select(i) {
  sel = i;
  const d = cur();
  showPicks(d);
  $('btnUndo').disabled = !(d && d.undo);
  $('editor').classList.remove('hidden');
  say('');
  $('sizeWarn').textContent = '';
  $('w').value = d.w.toFixed(1); $('h').value = d.h.toFixed(1); $('qty').value = d.qty;
  $('shape').value = d.shape; $('shapeColor').value = d.shapeColor; $('shapePad').value = d.shapePad;
  $('shapePadVal').textContent = d.shapePad;
  $('shapeOpts').classList.toggle('hidden', d.shape === 'silueta');
  renderFit();
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
function updateCutWarn(d) {
  let msg = '';
  if (product === 'vinilo' && d && d.design && !isRect(d)) {
    const ck = cutFor(d).check || {};
    const c = config.vinilo.corte || {};
    if (ck.thin) msg = `La línea de corte tiene partes de menos de ${(c.anchoMinimoCm || 0.2) * 10} mm de ancho (uniones o puntas muy finas) que la cuchilla puede romper. Aumenta el borde blanco o la medida, o elige la forma círculo o cuadro.`;
    else if (ck.tiny) msg = `Hay ${ck.tiny} recorte${ck.tiny === 1 ? '' : 's'} de menos de ${(c.tamanoMinimoCm || 0.3) * 10} mm que la cuchilla no corta bien. Usa «Borrar restos sueltos» o aumenta la medida.`;
  }
  $('cutWarn').textContent = msg;
}
function updateInfo() {
  const d = cur();
  updateCutWarn(d);
  const dpi = dpiOf(d);
  $('dpiInfo').className = 'msg ' + (dpi < DPI_BAD ? 'err' : dpi < DPI_WARN ? 'warn' : 'ok');
  $('dpiInfo').textContent = dpi < DPI_WARN
    ? `Tu imagen es pequeña para ${d.w.toFixed(1)} cm y puede verse borrosa. Si tienes el archivo original más grande, súbelo, o reduce la medida. (${dpi} ppp)`
    : `Calidad de imagen buena para esta medida (${Math.min(dpi, 999)} ppp).`;
  const src = d.logo || d.design; // el fondo se revisa en el logo, no en la forma
  const c = src.getContext('2d');
  const corners = [[0, 0], [src.width - 1, 0], [0, src.height - 1], [src.width - 1, src.height - 1]];
  const opaque = corners.every(([x, y]) => c.getImageData(x, y, 1, 1).data[3] > 200);
  // Con forma de círculo o cuadro el fondo queda dentro de la forma: no hace falta quitarlo.
  $('bgWarn').textContent = opaque && !d.cleaned && d.shape === 'silueta'
    ? 'Tu imagen parece tener fondo. Si no lo quitas, el fondo también se imprimirá (incluido el blanco).'
    : '';
}

// Fracción del ancho y alto que ocupa la parte sólida (alfa ≥ 128), la misma que sigue la línea de corte.
// Así una pieza pequeña con bordes casi transparentes se mide igual que en el taller.
function solidFrac(c) {
  const { width: W, height: H } = c;
  const px = c.getContext('2d').getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] >= 128) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  // Un píxel de tolerancia por lado: el borde suavizado no debe volver «pequeña» una pieza de 3 cm.
  return x1 < 0 ? [1, 1] : [Math.min(1, (x1 - x0 + 3) / W), Math.min(1, (y1 - y0 + 3) / H)];
}
// Medida real que corta la plotter (para la tarifa de piezas pequeñas).
const realSize = (d, w = d.w, h = d.h) => [w * ((d.solid && d.solid[0]) || 1), h * ((d.solid && d.solid[1]) || 1)];

// Recalcula el recorte de la imagen actual conservando el ancho elegido.
function refreshDesign(d = cur()) {
  const t = trim(d.working);
  if (!t) return false;
  d.logo = t.canvas; d.offX = t.offX; d.offY = t.offY;
  d.design = applyShape(t.canvas, d.shape, d.shapeColor, d.shapePad);
  d.ratio = d.design.height / d.design.width;
  d.h = d.w * d.ratio;
  d.solid = solidFrac(d.design);
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
  for (const id of ['btnColor', 'btnReset', 'btnSpecks', 'file', 'w', 'h', 'qty', 'shape', 'shapeColor', 'shapePad', 'gap', 'offset', 'btnFill']) if ($(id)) $(id).disabled = on;
  updateSend();
}

$('w').addEventListener('input', () => {
  const w = num($('w').value);
  if (!(w >= 0.5)) { $('sizeWarn').textContent = 'Escribe un ancho de al menos 0,5 cm.'; return; }
  cur().w = w; cur().h = w * cur().ratio; $('h').value = cur().h.toFixed(1);
  $('sizeWarn').textContent = '';
  updateInfo(); relayout();
});
$('h').addEventListener('input', () => {
  const h = num($('h').value);
  if (!(h >= 0.5)) { $('sizeWarn').textContent = 'Escribe un alto de al menos 0,5 cm.'; return; }
  cur().h = h; cur().w = h / cur().ratio; $('w').value = cur().w.toFixed(1);
  $('sizeWarn').textContent = '';
  updateInfo(); relayout();
});
$('qty').addEventListener('input', () => {
  const q = parseInt($('qty').value, 10);
  if (!(q >= 1)) { $('sizeWarn').textContent = 'La cantidad mínima es 1.'; return; }
  const max = P().maxPieces;
  cur().qty = Math.min(max, q);
  cur().filled = false;
  $('sizeWarn').textContent = q > max ? `Máximo ${max} piezas por pedido.` : '';
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
// ¿Cuántos caben? Tabla de medidas para la imagen seleccionada y llenado automático del espacio libre.
const FIT_SIZES = [2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30];
function renderFit() {
  const d = cur();
  const box = $('fit');
  if (!d || !d.design || !config) { box.innerHTML = ''; return; }
  const p = P();
  const L = p.maxLen - gapCm - config.etiquetaCm; // descuenta la franja del nombre
  const v = config.vinilo.variantes.find((x) => x.id === variant);
  const sheetPrice = (big) => product === 'vinilo'
    ? (Pricing.isSmall(config, big, big) && v.precioPequeno ? v.precioPequeno : v.precio)
    : Pricing.quote(config, style, p.maxLen).price;
  const rows = FIT_SIZES.map((S) => {
    const w = Math.round((d.ratio > 1 ? S / d.ratio : S) * 100) / 100, h = Math.round(w * d.ratio * 100) / 100;
    return { S, w, h, n: gridCount(d, w, h, L, p) };
  }).filter((r) => r.n > 0 && Math.min(r.w, r.h) >= 0.5);
  const where = product === 'vinilo' ? `un pliego de ${p.W} × ${p.maxLen} cm` : `1 metro (${p.W} × ${p.maxLen} cm)`;
  const small = (r) => product === 'vinilo' && Pricing.isSmall(config, ...realSize(d, r.w, r.h)) && v.precioPequeno && v.precioPequeno !== v.precio;
  box.innerHTML = `<details class="adv"${box.dataset.open ? ' open' : ''}><summary>¿Cuántos caben de esta imagen? Ver tabla de medidas</summary><p class="muted">En ${where} solo con esta imagen. Toca una medida para usarla.</p>
    <div class="fitWrap"><table class="fit"><thead><tr><th>Medida</th><th>Caben</th><th>c/u si lo llenas</th></tr></thead><tbody>${rows.map((r) =>
      `<tr data-s="${r.S}" class="${Math.abs(Math.max(d.w, d.h) - r.S) < 0.05 ? 'sel' : ''}"><td>${r.w.toFixed(1)} × ${r.h.toFixed(1)} cm${small(r) ? '<span class="tag">corte pequeño</span>' : ''}</td>` +
      `<td>${r.n >= p.maxPieces ? `${r.n} (máx.)` : r.n}</td><td>${fmt(sheetPrice(Math.max(...realSize(d, r.w, r.h))) / r.n)}</td></tr>`).join('')}</tbody></table></div>
    <p class="muted">El valor c/u es llenando ${product === 'vinilo' ? 'el pliego' : 'el metro'} con esa medida. Tu precio real por unidad aparece junto al total del montaje. IVA no incluido.</p></details>`;
  box.querySelector('details').addEventListener('toggle', (e) => { box.dataset.open = e.target.open ? '1' : ''; });
  box.querySelectorAll('tr[data-s]').forEach((tr) => {
    tr.tabIndex = 0; tr.setAttribute('role', 'button');
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tr.click(); } });
  });
  box.querySelectorAll('tr[data-s]').forEach((tr) => tr.addEventListener('click', () => {
    if (busy) return;
    const r = rows.find((x) => x.S === Number(tr.dataset.s));
    const before = { w: d.w, h: d.h, qty: d.qty };
    d.w = r.w; d.h = r.h;
    const n = maxFit(sel);
    if (!n) { Object.assign(d, before); relayout(); say('Esa medida no cabe junto con tus otras imágenes.', 'err'); return; }
    d.qty = Math.min(before.qty, n); // se conserva la cantidad que pediste
    select(sel); relayout();
    say(d.qty < before.qty
      ? `A esa medida caben máximo ${n}: ajustamos tu cantidad de ${before.qty} a ${n}.`
      : `Medida cambiada. Te caben hasta ${n} por el mismo precio: usa «Llenar el espacio libre» si quieres aprovecharlo.`, d.qty < before.qty ? 'warn' : 'ok');
  }));
}
// Pone la mayor cantidad de la imagen seleccionada que cabe junto con las demás.
function fillFree() {
  const d = cur();
  const before = montage && !montage.over ? montage.lengthCm : 0;
  const oldPrice = montage && !montage.over && $('price').textContent;
  d.qty = 1;
  // En DTF se llena solo el largo que ya pagas; en vinilo, el pliego completo (precio fijo).
  let n = product === 'vinilo' ? maxFit(sel) : maxFit(sel, Math.max(before, P().minLen));
  if (!n) n = maxFit(sel) ? 1 : 0;
  if (!n) { relayout(); select(sel); say('Esta imagen no cabe junto con las demás en el área de impresión. Reduce su medida o la de las otras.', 'err'); return; }
  d.qty = n;
  d.filled = true;
  select(sel);
  relayout();
  const changed = oldPrice && montage && $('price').textContent !== oldPrice;
  say(changed
    ? `Caben ${n} de ${d.w.toFixed(1)} × ${d.h.toFixed(1)} cm. Ojo: el montaje creció y el precio pasó de ${oldPrice} a ${$('price').textContent}.`
    : `Listo: caben ${n} de ${d.w.toFixed(1)} × ${d.h.toFixed(1)} cm sin cambiar el precio.`, changed ? 'warn' : 'ok');
}
$('btnFill').addEventListener('click', () => { if (!busy && cur()) fillFree(); });

// Separación entre diseños en mm: nunca menos del mínimo técnico.
$('gap').addEventListener('input', () => {
  const mm = parseFloat($('gap').value);
  const min = P().gapMin * 10, max = P().gapMax * 10;
  if (!(mm >= min && mm <= max)) { $('gapWarn').textContent = `La separación debe estar entre ${min} y ${max} mm.`; return; }
  $('gapWarn').textContent = '';
  gapCm = mm / 10;
  relayout();
});
$('gap').addEventListener('change', () => { $('gap').value = Math.round(gapCm * 100) / 10; $('gapWarn').textContent = ''; });
$('offset').addEventListener('input', () => {
  const mm = num($('offset').value);
  const v = config.vinilo;
  if (!(mm >= v.margenCorteMinCm * 10 && mm <= v.margenCorteMaxCm * 10)) {
    $('offsetWarn').textContent = `El margen de corte debe estar entre ${v.margenCorteMinCm * 10} y ${v.margenCorteMaxCm * 10} mm.`;
    return;
  }
  $('offsetWarn').textContent = '';
  offsetCm = mm / 10;
  relayout();
  updateCutWarn(cur());
});

// Cambio de producto: ajusta separación, límites, precios y aclaraciones.
function setProduct(p) {
  const changed = product !== p || gapCm == null;
  product = p;
  for (const b of document.querySelectorAll('[data-product]')) { b.classList.toggle('sel', b.dataset.product === p); b.setAttribute('aria-pressed', String(b.dataset.product === p)); }
  const q = P();
  if (changed) {
    gapCm = q.gapMin;
    $('gap').min = q.gapMin * 10; $('gap').max = q.gapMax * 10; $('gap').value = q.gapMin * 10;
  }
  $('gapNote').textContent = p === 'vinilo'
    ? `Separación mínima ${q.gapMin * 10} mm entre las líneas de corte (los diseños rectangulares van unidos con corte recto). El espacio entre diseños también hace parte del costo.`
    : `Separación mínima ${q.gapMin * 10} mm entre diseños. Si vas a recortar con tijera, te recomendamos aumentarla para un corte más cómodo. El espacio entre diseños también se imprime y hace parte del costo.`;
  $('montageNote').textContent = p === 'vinilo'
    ? `Área de impresión ${q.W} × ${q.maxLen} cm${hasWhite() ? ' (con base blanca)' : ''}. Las imágenes se acomodan solas y la línea punteada rosada es el corte.`
    : `El montaje siempre es de ${config.anchoRolloCm} cm de ancho, mínimo ${config.largoMinimoCm} cm de largo y máximo ${config.largoMaximoCm / 100} metro. Las imágenes se acomodan solas.`;
  if (changed) renderTerms();
  relayout();
}
for (const b of document.querySelectorAll('[data-product]')) b.addEventListener('click', () => { if (!busy && !sent) setProduct(b.dataset.product); });
$('tol').addEventListener('input', () => { $('tolVal').textContent = $('tol').value; });

$('file').addEventListener('change', async () => {
  const files = [...$('file').files];
  $('file').value = '';
  setBusy(true);
  const problems = [];
  $('fileErr').textContent = '';
  try {
    for (const [n, f] of files.entries()) {
      if (designs.length >= MAX_DESIGNS) { problems.push(`Máximo ${MAX_DESIGNS} imágenes distintas por pedido.`); break; }
      $('fileHint').textContent = `Procesando imagen ${n + 1} de ${files.length}…`;
      await frame();
      let working;
      try { working = await loadImage(f); } catch {
        problems.push(/\.pdf$/i.test(f.name) || f.type === 'application/pdf'
          ? `"${f.name}" es un PDF. Aquí se cotizan stickers y calcomanías con imágenes PNG, JPG o WEBP. Para imprimir documentos, tesis o álbumes escríbenos por WhatsApp.`
          : `No se pudo abrir "${f.name}". Usa una imagen PNG, JPG o WEBP.`);
        continue;
      }
      const d = { file: f, working, design: null, ratio: 1, w: 10, h: 10, qty: 1, cleaned: false, shape: 'silueta', shapeColor: '#ffffff', shapePad: 10 };
      const t = trim(working);
      if (!t) { problems.push(`"${f.name}" no tiene nada visible (es totalmente transparente). Sube otra imagen.`); continue; }
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
  if (problems.length) {
    $('fileErr').textContent = problems.join(' ');
    if (problems.some((t) => t.includes('PDF'))) addWaLink($('fileErr'), 'Cotizar documentos por WhatsApp', 'Hola, quiero cotizar la impresión de un documento.');
  }
  if (sel >= 0) select(sel);
});

// Forma del sticker (el ancho elegido pasa a ser el de la forma completa).
$('shape').addEventListener('change', () => {
  const d = cur();
  d.shape = $('shape').value;
  $('shapeOpts').classList.toggle('hidden', d.shape === 'silueta');
  refreshDesign(d);
});
$('shapeColor').addEventListener('input', () => { cur().shapeColor = $('shapeColor').value; refreshDesign(); });
$('shapePad').addEventListener('input', () => {
  $('shapePadVal').textContent = $('shapePad').value;
  cur().shapePad = Number($('shapePad').value);
  refreshDesign();
});

$('btnReset').addEventListener('click', async () => {
  const d = cur();
  setBusy(true);
  try {
    d.working = await loadImage(d.file);
    d.cleaned = false;
    d.picks = d.lastBg = null;
    showPicks(null);
    say('');
    refreshDesign(d);
  } finally { setBusy(false); }
});

// Clic en la vista previa: elige el color de fondo a quitar.
// Muestras de los colores de fondo elegidos.
function showPicks(d) {
  const box = $('pickSwatch');
  box.innerHTML = '';
  for (const c of (d && d.picks) || []) {
    const sw = document.createElement('span');
    sw.className = 'swatch'; sw.style.background = `rgb(${c[0]},${c[1]},${c[2]})`;
    box.appendChild(sw);
  }
  box.classList.toggle('hidden', !(d && d.picks && d.picks.length));
}
$('preview').addEventListener('click', (ev) => {
  const d = cur();
  const r = $('preview').getBoundingClientRect();
  const x = Math.floor(((ev.clientX - r.left) / r.width) * d.design.width);
  const y = Math.floor(((ev.clientY - r.top) / r.height) * d.design.height);
  const p = d.design.getContext('2d').getImageData(x, y, 1, 1).data;
  if (p[3] < 128) { say('Ese punto ya es transparente. Toca el color de fondo que quieres quitar.'); return; }
  // Hasta 3 colores de fondo (papel, rayas, sombra…): cada toque agrega uno.
  const c = [p[0], p[1], p[2]];
  d.picks = (d.picks || []).filter((q) => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) > 12);
  d.picks.push(c);
  if (d.picks.length > 3) d.picks.shift();
  showPicks(d);
  say(d.picks.length === 1
    ? 'Color elegido. Pulsa «Quitar color de fondo», o toca otro color del fondo para agregarlo (hasta 3).'
    : `${d.picks.length} colores elegidos. Pulsa «Quitar color de fondo».`, 'ok');
});

// Quita el color de fondo: desde los bordes (o en toda la imagen), con borde suave y sin halo.
$('btnColor').addEventListener('click', async () => {
  const d = cur();
  if (!d || busy) return;
  say('Quitando el fondo…'); await frame();
  const work = d.working;
  const { width, height } = work;
  const ctx = work.getContext('2d');
  const img = ctx.getImageData(0, 0, width, height);
  const px = img.data;
  // Colores de fondo: los elegidos tocando la imagen (hasta 3); si no hay, el último quitado o el de las esquinas.
  let bgs = (d.picks && d.picks.length) ? d.picks : d.lastBg;
  if (!bgs) {
    const corners = [0, width - 1, (height - 1) * width, height * width - 1].filter((p) => px[p * 4 + 3] > 200);
    if (!corners.length) { say('No se detectó fondo en las esquinas. Toca el color del fondo en la imagen para elegirlo.', 'err'); return; }
    bgs = [[0, 1, 2].map((k) => corners.reduce((s, p) => s + px[p * 4 + k], 0) / corners.length)];
  }
  const tol = parseInt($('tol').value, 10);
  const ramp = tol * 0.6 + 10; // franja de transición suave alrededor del diseño
  // Distancia al color de fondo más cercano y cuál es.
  let nearBg = bgs[0];
  const dist = (p) => {
    let best = Infinity;
    for (const b of bgs) {
      const e = Math.hypot(px[p * 4] - b[0], px[p * 4 + 1] - b[1], px[p * 4 + 2] - b[2]);
      if (e < best) { best = e; nearBg = b; }
    }
    return best;
  };
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
  // Borde (franja de 2 píxeles junto al fondo quitado): cada píxel se separa de su mezcla con el fondo
  // («color a alfa», como en GIMP). Queda la transparencia justa y sin halo del color de fondo.
  const band = new Uint8Array(width * height);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass ? band.slice() : removed;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (removed[p] || band[p]) continue;
      if ((x > 0 && src[p - 1]) || (x < width - 1 && src[p + 1]) || (y > 0 && src[p - width]) || (y < height - 1 && src[p + width])) band[p] = 1;
    }
  }
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    if (!band[p] || px[i + 3] === 0 || dist(p) > tol + ramp) continue; // solo píxeles que sí son mezcla con el fondo
    const b = nearBg;
    let a = 0;
    for (let k = 0; k < 3; k++) {
      const c = px[i + k], bk = b[k];
      a = Math.max(a, c > bk ? (c - bk) / (255 - bk || 1) : c < bk ? (bk - c) / (bk || 1) : 0);
    }
    if (a < 0.1) { px[i + 3] = 0; continue; }
    if (a >= 1) continue;
    for (let k = 0; k < 3; k++) px[i + k] = Math.max(0, Math.min(255, Math.round(b[k] + (px[i + k] - b[k]) / a)));
    px[i + 3] = Math.round(px[i + 3] * a);
  }
  if (!count && d.cleaned) { say('El fondo ya está quitado. Si quedan puntos o rayas sueltas, usa «Borrar restos sueltos».', 'ok'); return; }
  if (!count) { say('No se encontró fondo de ese color. Sube la «Sensibilidad» en Ajustes avanzados o toca el fondo para elegir el color.', 'err'); return; }
  saveUndo(d);
  ctx.putImageData(img, 0, 0);
  d.cleaned = true;
  d.lastBg = bgs;
  if (!refreshDesign(d)) {
    say('Se borró toda la imagen. Pulsa «Restaurar original» y baja la «Sensibilidad» en Ajustes avanzados.', 'err');
    return;
  }
  const pct = (count / (width * height)) * 100;
  say(`Fondo quitado (${pct < 1 ? 'menos del 1' : Math.round(pct)}% de la imagen). Si quedan puntos o rayas sueltas, usa «Borrar restos sueltos».`, 'ok');
});

// Un nivel de deshacer (copia de la imagen de trabajo antes del último cambio).
function saveUndo(d) {
  const c = document.createElement('canvas');
  c.width = d.working.width; c.height = d.working.height;
  c.getContext('2d').drawImage(d.working, 0, 0);
  d.undo = { canvas: c, cleaned: d.cleaned };
  $('btnUndo').disabled = false;
}
$('btnUndo').addEventListener('click', () => {
  const d = cur();
  if (!d || !d.undo || busy) return;
  const ctx = d.working.getContext('2d');
  ctx.clearRect(0, 0, d.working.width, d.working.height);
  ctx.drawImage(d.undo.canvas, 0, 0);
  d.cleaned = d.undo.cleaned; d.undo = null;
  $('btnUndo').disabled = true;
  refreshDesign(d);
  say('Se deshizo el último cambio.', 'ok');
});

// Borra manchas, rayas y puntos sueltos: se conservan solo las partes grandes del diseño
// (también evita líneas de corte innecesarias alrededor de cada resto).
$('btnSpecks').addEventListener('click', () => {
  const d = cur();
  if (!d || busy) return;
  const { width: W, height: H } = d.working;
  const ctx = d.working.getContext('2d');
  const img = ctx.getImageData(0, 0, W, H), px = img.data;
  const label = new Int32Array(W * H).fill(-1), sizes = [];
  const stack = [];
  for (let p0 = 0; p0 < W * H; p0++) {
    if (label[p0] >= 0 || px[p0 * 4 + 3] < 64) continue;
    const id = sizes.length; let n = 0;
    label[p0] = id; stack.push(p0);
    while (stack.length) {
      const p = stack.pop(); n++;
      const x = p % W, y = (p - x) / W;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
        if (q >= 0 && label[q] < 0 && px[q * 4 + 3] >= 64) { label[q] = id; stack.push(q); }
      }
    }
    sizes.push(n);
  }
  if (sizes.length < 2) { say('No hay restos sueltos: tu diseño ya es una sola pieza.', 'ok'); return; }
  const biggest = Math.max(...sizes);
  const keep = sizes.map((n) => n >= biggest * 0.02); // restos de menos del 2% de la parte principal
  const removed = keep.filter((k) => !k).length;
  if (!removed) { say('No se encontraron restos pequeños para borrar.', 'ok'); return; }
  saveUndo(d);
  for (let p = 0; p < W * H; p++) if (px[p * 4 + 3] && (label[p] < 0 || !keep[label[p]])) px[p * 4 + 3] = 0;
  ctx.putImageData(img, 0, 0);
  d.cleaned = true;
  refreshDesign(d);
  say(`Se borraron ${removed} resto${removed === 1 ? '' : 's'} suelto${removed === 1 ? '' : 's'}. Si se borró algo que querías, pulsa «Deshacer».`, 'ok');
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

let lowOk = false; // el cliente ya vio el aviso de resolución
$('send').addEventListener('click', async () => {
  const out = $('result');
  out.className = 'msg';
  if (!montage || montage.over || sent) return;
  const low = designs.filter((d) => dpiOf(d) < DPI_WARN).length;
  if (low && !lowOk) {
    lowOk = true;
    out.className = 'msg warn';
    out.textContent = `${low === 1 ? 'Una imagen es pequeña' : `${low} imágenes son pequeñas`} para la medida elegida y puede${low === 1 ? '' : 'n'} verse borrosa${low === 1 ? '' : 's'}. ` +
      'Si tienes el archivo original más grande, súbelo. Si quieres enviarlo así, pulsa «Enviar pedido» otra vez.';
    return;
  }
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
    if (product === 'dtf') {
      const lc = document.createElement('canvas');
      lc.width = Math.round((config.anchoRolloCm / 2.54) * config.dpi);
      lc.height = Math.round((config.etiquetaCm / 2.54) * config.dpi);
      drawLabel(lc.getContext('2d'), lc.width, lc.height);
      fd.append('label', await new Promise((r) => lc.toBlob(r, 'image/png')), 'etiqueta.png');
    }
    fd.append('meta', JSON.stringify({
      product, style, variant, capa, cutType, offsetCm,
      gapCm,
      designs: designs.map((d) => ({ wCm: d.w, hCm: d.h })),
      rects: product === 'vinilo' ? designs.map(isRect) : [],
      layout: montage.boxes.map((b) => ({ d: b.d, x: b.x, y: b.y, rot: b.rot })),
      name: $('name').value, phone: $('phone').value, note: $('note').value,
      billing: { empresa: $('bEmpresa').value, nit: $('bNit').value, correo: $('bCorreo').value },
      accepted: true
    }));
    let res;
    // Si el taller está ocupado (503) se reintenta solo, sin que el cliente pierda su pedido.
    for (let intento = 1; ; intento++) {
      try {
        res = await postOrder(fd, (sentB, total) => {
          const mb = (n) => (n / 1048576).toLocaleString('es-CO', { maximumFractionDigits: 1 });
          out.textContent = sentB < total
            ? `Subiendo tus archivos: ${mb(sentB)} de ${mb(total)} MB (${Math.floor((sentB / total) * 100)} %)… no cierres la página.`
            : 'Archivos recibidos. Preparando tu montaje en el taller…';
        });
      } catch { throw new Error('Se perdió la conexión mientras se enviaba. Revisa tu internet y pulsa «Enviar pedido» de nuevo: tus imágenes siguen aquí.'); }
      if (res.status !== 503 || intento >= 8) break;
      const wait = Math.min(30, 5 * intento);
      out.textContent = `Hay varios pedidos en fila. Reintentamos en ${wait} s (intento ${intento + 1} de 8)… no cierres la página.`;
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.error || `El servidor no pudo recibir el pedido (código ${res.status}). Intenta de nuevo en un momento.`);
    sent = true;
    $('send').classList.add('hidden');
    $('again').classList.remove('hidden');
    out.className = 'msg ok big';
    const prodName = product === 'vinilo'
      ? `${config.vinilo.variantes.find((x) => x.id === variant).nombre} (1 pliego de ${P().W} × ${P().maxLen} cm)`
        : `${config.estilos.find((x) => x.id === style).nombre} (${P().W} × ${shownLength(montage.lengthCm)} cm)`;
    out.innerHTML = '';
    out.append(`¡Pedido recibido! Referencia ${data.ref}.`, document.createElement('br'),
      `${montage.boxes.length} ${montage.boxes.length === 1 ? 'pieza' : 'piezas'} · ${prodName}`, document.createElement('br'),
      `Total estimado ${fmt(data.price)} + IVA` + (config.ivaPct ? ` (con IVA ${fmt(data.price * (1 + config.ivaPct / 100))})` : '') + '. ',
      `Revisamos tu archivo y te escribimos por WhatsApp${config.comercial && config.comercial.respuesta ? ' ' + config.comercial.respuesta : ''} para confirmar y coordinar el pago.`);
    $('print').classList.remove('hidden');
    // Resumen que sale al guardar o imprimir la cotización (sin el montaje, que es del taller).
    const ps = $('printSummary');
    ps.innerHTML = '';
    const line = (k, v) => { const r = document.createElement('p'); r.innerHTML = '<b></b> '; r.firstChild.textContent = k; r.append(v); ps.appendChild(r); };
    const h = document.createElement('h2'); h.textContent = `Cotización ${data.ref}`; ps.appendChild(h);
    line('Fecha:', new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }));
    line('Cliente:', `${$('name').value}${$('bEmpresa').value ? ' · ' + $('bEmpresa').value : ''}${$('bNit').value ? ' · NIT ' + $('bNit').value : ''} · WhatsApp ${$('phone').value}`);
    line('Producto:', prodName);
    designs.forEach((d, i) => line(`Imagen ${i + 1}:`, `${montage.boxes.filter((b) => b.d === i).length} u. de ${d.w.toFixed(1)} × ${d.h.toFixed(1)} cm · forma ${({ silueta: 'silueta', circulo: 'círculo', redondeado: 'cuadro redondeado', rectangulo: 'rectángulo' })[d.shape] || d.shape}`));
    line('Total:', `${fmt(data.price)} + IVA` + (config.ivaPct ? ` · IVA ${config.ivaPct}%: ${fmt(data.price * config.ivaPct / 100)} · Total con IVA ${fmt(data.price * (1 + config.ivaPct / 100))}` : ''));
    line('Valor por unidad:', `${fmt(data.price / montage.boxes.length)} (${montage.boxes.length} piezas)`);
    line('Nota:', 'Cotización sujeta a revisión del archivo final. Te escribiremos por WhatsApp para confirmar.');
    const wa = config.contacto && config.contacto.whatsapp;
    if (wa) {
      const a = document.createElement('a');
      a.href = `https://wa.me/${wa}?text=${encodeURIComponent(config.contacto.mensaje.replace('{ref}', data.ref))}`;
      a.target = '_blank'; a.rel = 'noopener'; a.className = 'wa';
      a.textContent = 'Escribirnos por WhatsApp con mi referencia';
      out.appendChild(a);
    }
    out.tabIndex = -1; out.focus({ preventScroll: true });
    out.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    out.className = 'msg err';
    out.textContent = e.message;
  } finally {
    setBusy(false);
  }
});

$('again').addEventListener('click', () => location.reload());
// Datos del cliente recordados en este navegador (solo comodidad; nada se envía hasta pedir).
const KEEP = ['name', 'phone', 'bEmpresa', 'bNit', 'bCorreo'];
try {
  const saved = JSON.parse(localStorage.getItem('smith-datos') || '{}');
  for (const id of KEEP) if (saved[id] && !$(id).value) $(id).value = saved[id];
} catch {}
for (const id of KEEP) $(id).addEventListener('change', () => {
  try { localStorage.setItem('smith-datos', JSON.stringify(Object.fromEntries(KEEP.map((k) => [k, $(k).value])))); } catch {}
});
$('barGo').addEventListener('click', () => $('name').scrollIntoView({ behavior: 'smooth', block: 'center' }));
// La barra se oculta cuando el cliente ya está en la parte de enviar.
new IntersectionObserver(([e]) => { barHidden = e.isIntersecting; if (config) updateBar(); }).observe($('send'));
$('print').addEventListener('click', () => window.print());
for (const id of ['name', 'phone']) $(id).addEventListener('input', () => { if (montage) drawMontage(); updateSend(); });
window.addEventListener('beforeunload', (e) => { if (designs.length && !sent) { e.preventDefault(); e.returnValue = ''; } });

fetch('/api/config').then((r) => { if (!r.ok) throw new Error(); return r.json(); }).then((c) => {
  config = c;
  offsetCm = c.vinilo.margenCorteCm;
  $('offset').min = c.vinilo.margenCorteMinCm * 10; $('offset').max = c.vinilo.margenCorteMaxCm * 10; $('offset').value = c.vinilo.margenCorteCm * 10;
  renderInfo();
  // ?producto=vinilo abre directo el cotizador de vinilo (enlaces para la web, redes y WhatsApp).
  setProduct((new URLSearchParams(location.search).get('producto') || '').toLowerCase() === 'dtf' ? 'dtf' : 'vinilo');
  updateSend();
}).catch(() => {
  const m = document.createElement('p');
  m.className = 'msg err'; m.setAttribute('role', 'alert');
  m.textContent = 'No se pudo cargar la información de precios. Recarga la página o escríbenos por WhatsApp.';
  document.querySelector('.contenedor').prepend(m);
});
