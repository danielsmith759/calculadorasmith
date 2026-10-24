const $ = (id) => document.getElementById(id);
const AI_MODULE = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm';
const ALPHA_MIN = 10;      // alfa mínimo para considerar un píxel como parte del diseño
const WORK_MAX = 3000;     // lado máximo (px) para editar en el navegador
const EXPORT_MAX = 9000;   // lado máximo (px) del archivo enviado

let config;
let original;   // canvas con la imagen original (reducida si es muy grande)
let working;    // canvas con el fondo ya removido (o igual al original)
let design;     // canvas recortado al contenido visible
let ratio = 1;  // alto / ancho del diseño recortado

fetch('/api/config').then((r) => r.json()).then((c) => { config = c; });

const fmt = (n) => '$' + Math.round(n).toLocaleString('es-CO');
const say = (text, cls = '') => { $('status').textContent = text; $('status').className = 'msg ' + cls; };

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

// Recorta al rectángulo que contiene píxeles visibles: solo se cobra el área real del diseño.
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

function refresh() {
  const t = trim(working);
  if (!t) { say('La imagen quedó vacía, restaura el original.', 'err'); return; }
  const firstTime = !design;
  design = t;
  ratio = design.height / design.width;
  $('preview').width = design.width; $('preview').height = design.height;
  $('preview').getContext('2d').drawImage(design, 0, 0);
  if (firstTime || !$('w').value) { $('w').value = 10; }
  $('h').value = (parseFloat($('w').value) * ratio).toFixed(1);
  updatePrice();
}

function updatePrice() {
  if (!config || !design) return;
  const w = parseFloat($('w').value), h = parseFloat($('h').value);
  const qty = Math.max(1, parseInt($('qty').value, 10) || 1);
  $('sizeWarn').textContent = '';
  if (!(w > 0 && h > 0)) { $('price').textContent = fmt(0); $('areaInfo').textContent = ''; return; }
  const area = (w * h) / 10000 * qty;
  const price = Math.max(config.precioMinimo, Math.round(area * config.precioM2 / 100) * 100);
  $('areaInfo').textContent = `Área utilizada: ${(w * h).toFixed(1)} cm² × ${qty} = ${area.toFixed(4)} m² · ${fmt(config.precioM2)}/m²`;
  $('price').textContent = fmt(price);
  if (Math.min(w, h) > config.anchoRolloCm)
    $('sizeWarn').textContent = `Excede el ancho del rollo (${config.anchoRolloCm} cm). Reduce la medida.`;
}

$('w').addEventListener('input', () => {
  const w = parseFloat($('w').value);
  if (w > 0) $('h').value = (w * ratio).toFixed(1);
  updatePrice();
});
$('h').addEventListener('input', () => {
  const h = parseFloat($('h').value);
  if (h > 0) $('w').value = (h / ratio).toFixed(1);
  updatePrice();
});
$('qty').addEventListener('input', updatePrice);
$('tol').addEventListener('input', () => { $('tolVal').textContent = $('tol').value; });

$('file').addEventListener('change', () => {
  const f = $('file').files[0];
  if (!f) return;
  const img = new Image();
  img.onload = () => {
    original = canvasFromImage(img);
    working = cloneCanvas(original);
    design = null;
    $('editor').classList.remove('hidden');
    $('result').textContent = '';
    say('');
    refresh();
    URL.revokeObjectURL(img.src);
  };
  img.onerror = () => say('No se pudo leer la imagen.', 'err');
  img.src = URL.createObjectURL(f);
});

$('btnReset').addEventListener('click', () => {
  working = cloneCanvas(original);
  say('');
  refresh();
});

// Quita el color de fondo conectado a los bordes (sirve sin conexión y con fondos planos).
$('btnColor').addEventListener('click', () => {
  const { width, height } = working;
  const ctx = working.getContext('2d');
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  const px = (x, y) => (y * width + x) * 4;
  const corners = [px(0, 0), px(width - 1, 0), px(0, height - 1), px(width - 1, height - 1)];
  const bg = [0, 1, 2].map((k) => corners.reduce((s, i) => s + d[i + k], 0) / 4);
  const tol = parseInt($('tol').value, 10);
  const near = (i) => d[i + 3] > 0 && Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]) <= tol;

  const seen = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    const p = y * width + x;
    if (!seen[p] && near(p * 4)) { seen[p] = 1; stack.push(p); }
  };
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
  refresh();
});

// IA en el navegador: la imagen no sale del equipo hasta que se envía el pedido.
$('btnAI').addEventListener('click', async () => {
  $('btnAI').disabled = true;
  say('Cargando modelo de IA (la primera vez tarda)…');
  try {
    const { removeBackground } = await import(AI_MODULE);
    const blob = await new Promise((r) => original.toBlob(r, 'image/png'));
    const out = await removeBackground(blob, {
      progress: (key, cur, total) => { if (total) say(`Procesando ${key}: ${Math.round((cur / total) * 100)}%`); }
    });
    const bmp = await createImageBitmap(out);
    working = document.createElement('canvas');
    working.width = bmp.width; working.height = bmp.height;
    working.getContext('2d').drawImage(bmp, 0, 0);
    say('Fondo removido con IA.', 'ok');
    refresh();
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
  const w = parseFloat($('w').value), h = parseFloat($('h').value);
  const qty = parseInt($('qty').value, 10);
  if (!design) return;
  if (!$('name').value.trim() || !$('phone').value.trim()) { out.className = 'msg err'; out.textContent = 'Escribe tu nombre y teléfono.'; return; }
  if (!(w > 0 && h > 0) || !(qty >= 1)) { out.className = 'msg err'; out.textContent = 'Revisa medida y cantidad.'; return; }
  if (Math.min(w, h) > config.anchoRolloCm) { out.className = 'msg err'; out.textContent = 'La medida excede el ancho del rollo.'; return; }

  $('send').disabled = true;
  out.textContent = 'Enviando…';
  try {
    // Exporta a la resolución de impresión (dpi) para el tamaño pedido.
    const scale = Math.min(1, EXPORT_MAX / Math.max(w, h) / (config.dpi / 2.54));
    const pw = Math.round((w / 2.54) * config.dpi * scale);
    const ph = Math.round((h / 2.54) * config.dpi * scale);
    const c = document.createElement('canvas');
    c.width = pw; c.height = ph;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(design, 0, 0, pw, ph);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));

    const fd = new FormData();
    fd.append('image', blob, 'diseno.png');
    fd.append('widthCm', w); fd.append('heightCm', h); fd.append('qty', qty);
    fd.append('name', $('name').value); fd.append('phone', $('phone').value); fd.append('note', $('note').value);
    const res = await fetch('/api/orders', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al enviar');
    out.className = 'msg ok';
    out.textContent = `¡Pedido recibido! Referencia ${data.ref} · Total ${fmt(data.price)}. Te contactaremos pronto.`;
  } catch (e) {
    out.className = 'msg err';
    out.textContent = e.message;
  } finally {
    $('send').disabled = false;
  }
});
