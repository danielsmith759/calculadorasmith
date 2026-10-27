const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const Pricing = require('./public/pricing.js');
const Contour = require('./public/contour.js');
const { buildPdf, buildCutSvg, mapPoint, PT } = require('./lib/pdf.js');

const scrypt = promisify(crypto.scrypt);
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
fs.mkdirSync(FILES_DIR, { recursive: true });
fs.rmSync(TMP_DIR, { recursive: true, force: true }); // subidas a medias de una ejecución anterior
fs.mkdirSync(TMP_DIR, { recursive: true });

// Poca memoria en el plan gratis: sin caché de sharp y un hilo por operación.
sharp.cache(false);
sharp.concurrency(Number(process.env.SHARP_CONCURRENCY) || 1);

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_MS = 12 * 60 * 60 * 1000;

const safeEqual = (a, b) => {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

// Usuarios de administración: variable ADMIN_USERS="usuario:clave,usuario2:clave2" (recomendado en el hosting)
// o, en local, usuarios.json creado con scripts/usuario.js (no se sube al repositorio).
const users = Object.create(null);
if (process.env.ADMIN_USERS) {
  for (const pair of process.env.ADMIN_USERS.split(',')) {
    const i = pair.indexOf(':');
    const user = pair.slice(0, i).trim().toLowerCase(), pass = pair.slice(i + 1);
    if (i > 0 && pass) {
      const salt = crypto.randomBytes(16).toString('hex');
      users[user] = { salt, hash: crypto.scryptSync(pass, salt, 32).toString('hex') };
    }
  }
} else {
  try { Object.assign(users, JSON.parse(fs.readFileSync(path.join(__dirname, 'usuarios.json'), 'utf8'))); } catch {}
}
if (!Object.keys(users).length) console.warn('Sin usuarios de administración: define ADMIN_USERS o crea usuarios.json con scripts/usuario.js');

const checkLogin = async (user, pass) => {
  const u = Object.hasOwn(users, user) ? users[user] : null;
  const hash = (await scrypt(pass, u ? u.salt : 'x', 32)).toString('hex'); // mismo tiempo si el usuario no existe
  return !!u && safeEqual(hash, u.hash);
};

const loadOrders = () => {
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); } catch { return []; }
};
const saveOrders = (orders) => {
  const tmp = ORDERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(orders, null, 2));
  fs.renameSync(tmp, ORDERS_FILE);
};

const sign = (value) => crypto.createHmac('sha256', SECRET).update(value).digest('hex');
const issueToken = (user) => {
  const body = `${user}.${Date.now() + SESSION_MS}`;
  return `${body}.${sign(body)}`;
};
const validToken = (token) => {
  if (!token) return false;
  const [user, exp, sig] = token.split('.');
  return !!sig && safeEqual(sig, sign(`${user}.${exp}`)) && Number(exp) > Date.now() && Object.hasOwn(users, user);
};
const getCookie = (req, name) => {
  const m = (req.headers.cookie || '').split(';').map((c) => c.trim().split('='));
  const hit = m.find(([k]) => k === name);
  return hit ? hit[1] : null;
};
const requireAdmin = (req, res, next) =>
  validToken(getCookie(req, 'admin')) ? next() : res.status(401).json({ error: 'No autorizado' });

// Límite simple por IP para evitar spam de pedidos/intentos de clave.
const hits = new Map();
const limit = (name, max, windowMs) => (req, res, next) => {
  const key = `${name}:${req.ip}`;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) return res.status(429).json({ error: 'Demasiados intentos, espera un momento.' });
  recent.push(now);
  hits.set(key, recent);
  next();
};
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (!v.some((t) => now - t < 60 * 60 * 1000)) hits.delete(k);
}, 10 * 60 * 1000).unref();

// Una sola composición a la vez (cada una puede usar ~300 MB); el resto espera en cola.
let queue = Promise.resolve();
let waiting = 0;
const MAX_WAITING = 3;
const exclusive = (fn) => {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
};

const MAX_DESIGNS = 30;
const MAX_INSTANCES = config.maxPiezas;
// Tope de píxeles del montaje: 60 Mpx deja ~260 ppp en 1 m (las imágenes llegan a máx. 3000 px, no se pierde detalle).
const MAX_MONTAGE_PIXELS = Number(process.env.MAX_MONTAGE_PIXELS) || 60e6;
const MAX_INPUT_PIXELS = 50e6;         // por imagen subida
const RAW_PIECE_MAX = 20 * 1024 * 1024; // piezas más grandes se pasan comprimidas para ahorrar memoria
const MAX_REQUEST_BYTES = 150 * 1024 * 1024;
const upload = multer({
  storage: multer.diskStorage({ destination: TMP_DIR }),
  limits: { fileSize: 25 * 1024 * 1024, files: MAX_DESIGNS + 1, fields: 5, fieldSize: 1024 * 1024 }
});

const app = express();
app.set('trust proxy', 1);
app.set('case sensitive routing', true);
app.set('strict routing', true);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (req, res) => res.send('ok'));
app.get('/api/config', (req, res) => res.json(config));

class Invalid extends Error {}
const fail = (msg) => { throw new Invalid(msg); };

// Valida el montaje enviado por el cliente y devuelve el largo real (el precio sale de aquí, no del cliente).
// Parámetros del montaje según el producto (DTF UV o vinilo con corte).
function productParams(meta) {
  if (meta.product === 'vinilo') {
    const v = config.vinilo;
    const off = meta.offsetCm;
    if (!Number.isFinite(off) || off < v.margenCorteMinCm - 1e-9 || off > v.margenCorteMaxCm + 1e-9) fail('Margen de corte inválido.');
    const variant = v.variantes.find((x) => x.id === meta.variant);
    if (!variant) fail('Tipo de vinilo inválido.');
    if (variant.capas.includes('elegir') && !['blanco', 'brillo'].includes(meta.capa)) fail('Elige blanco o brillo.');
    if (meta.cutType !== 'medio') fail('Por ahora solo se hace semicorte.');
    const capas = variant.capas.includes('elegir') ? [meta.capa] : variant.capas;
    // Con base blanca el montaje es 145 x 55 cm; a color o con brillo, 95 x 95 cm.
    const area = capas.includes('blanco') ? v.areaBlanco : v.areaColor;
    return { W: area.anchoCm, gapMin: v.separacionCm, gapMax: v.separacionMaxCm, off, minLen: v.largoMinimoCm, maxLen: area.largoMaxCm, variant, capas };
  }
  if (!config.estilos.some((e) => e.id === meta.style)) fail('Estilo inválido.');
  return { W: config.anchoRolloCm, gapMin: config.separacionCm, gapMax: config.separacionMaxCm, off: 0, minLen: config.largoMinimoCm, maxLen: config.largoMaximoCm };
}

// Las cajas incluyen el margen de corte (off) alrededor de cada diseño; los rectangulares van sin margen.
function checkLayout(meta, fileCount, P, rects = []) {
  const offOf = (i) => (rects[i] ? 0 : P.off);
  const W = P.W, G = meta.gapCm, EPS = 0.01;
  if (!Number.isFinite(G) || G < P.gapMin - 1e-9 || G > P.gapMax + 1e-9) fail('Separación entre diseños inválida.');
  if (!Array.isArray(meta.designs) || meta.designs.length !== fileCount || !fileCount) fail('Imágenes inválidas.');
  for (const [i, d] of meta.designs.entries()) {
    if (!d || !Number.isFinite(d.wCm) || !Number.isFinite(d.hCm) || Math.min(d.wCm, d.hCm) < 0.5) fail('Medida de diseño inválida.');
    const a = d.wCm + 2 * offOf(i), b = d.hCm + 2 * offOf(i);
    if (!((a <= W + EPS && b <= P.maxLen + EPS) || (b <= W + EPS && a <= P.maxLen + EPS))) fail('Un diseño no cabe en el área de impresión.');
  }
  if (!Array.isArray(meta.layout) || !meta.layout.length) fail('Montaje inválido.');
  if (meta.layout.length > MAX_INSTANCES) fail(`Máximo ${MAX_INSTANCES} piezas por pedido.`);
  const boxes = meta.layout.map((it) => {
    if (!it || !Number.isInteger(it.d) || it.d < 0 || it.d >= meta.designs.length || typeof it.rot !== 'boolean' ||
      !Number.isFinite(it.x) || !Number.isFinite(it.y)) fail('Montaje inválido.');
    const d = meta.designs[it.d];
    const w = (it.rot ? d.hCm : d.wCm) + 2 * offOf(it.d), h = (it.rot ? d.wCm : d.hCm) + 2 * offOf(it.d);
    if (it.x < -EPS || it.y < -EPS || it.x + w > W + EPS) fail('Hay diseños fuera del ancho del rollo.');
    return { x: it.x, y: it.y, w, h, d: it.d, rot: it.rot };
  });
  // Las piezas deben respetar la separación para poder cortarlas (las de corte recto pueden ir unidas).
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const g = rects[a.d] && rects[b.d] ? 0 : G;
    if (a.x < b.x + b.w + g - EPS && b.x < a.x + a.w + g - EPS && a.y < b.y + b.h + g - EPS && b.y < a.y + a.h + g - EPS) {
      fail('Hay diseños superpuestos o sin separación.');
    }
  }
  if (!meta.designs.every((_, i) => boxes.some((b) => b.d === i))) fail('Falta un diseño en el montaje.');
  return { boxes, lengthCm: Math.max(...boxes.map((b) => b.y + b.h)) };
}

const input = (file) => sharp(file.path, { limitInputPixels: MAX_INPUT_PIXELS });

// Compone todos los diseños en un solo PNG de ancho de rollo x largo, con DPI de impresión, directo a disco.
async function composeMontage(meta, files, boxes, lengthCm, label, labelY, outPath) {
  const W = config.anchoRolloCm;
  const dpi = Math.min(config.dpi, Math.floor(Math.sqrt(MAX_MONTAGE_PIXELS / ((W / 2.54) * (lengthCm / 2.54)))));
  const px = (cm) => Math.max(1, Math.round((cm / 2.54) * dpi));
  const cache = new Map();
  const piece = async (b) => {
    const key = `${b.d}:${b.rot}`;
    if (!cache.has(key)) {
      const d = meta.designs[b.d];
      let img = input(files[b.d]).ensureAlpha().resize(px(d.wCm), px(d.hCm), { fit: 'fill' });
      if (b.rot) img = img.rotate(90);
      const bytes = px(d.wCm) * px(d.hCm) * 4;
      cache.set(key, bytes <= RAW_PIECE_MAX
        ? await img.raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => ({ input: data, raw: { width: info.width, height: info.height, channels: 4 } }))
        : { input: await img.png({ compressionLevel: 1 }).toBuffer() });
    }
    return cache.get(key);
  };
  const composites = [];
  for (const b of boxes) composites.push({ ...(await piece(b)), left: px(b.x), top: px(b.y) });
  composites.push({
    input: await input(label).ensureAlpha().resize(px(W), px(config.etiquetaCm), { fit: 'fill' }).png().toBuffer(),
    left: 0, top: px(labelY)
  });
  await sharp({ create: { width: px(W), height: px(lengthCm), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites)
    .withMetadata({ density: dpi })
    .png()
    .toFile(outPath);
  return dpi;
}

// Vinilo: PDF de producción (imagen + blanco/brillo + CutContour) y SVG de corte para SignMaster.
// Transparencia de cada diseño a resolución de contorno, y si es rectangular (corte recto).
async function prepVinyl(meta, files) {
  const v = config.vinilo;
  const prep = [];
  for (let i = 0; i < files.length; i++) {
    const d = meta.designs[i];
    if (!d || !(d.wCm >= 0.5) || !(d.hCm >= 0.5) || !(Math.max(d.wCm, d.hCm) <= 1000)) fail('Medida de diseño inválida.');
    const ppc = Contour.contourPxPerCm(d.wCm, d.hCm);
    const cw = Math.max(2, Math.round(d.wCm * ppc)), ch = Math.max(2, Math.round(d.hCm * ppc));
    const alpha = await input(files[i]).ensureAlpha().resize(cw, ch, { fit: 'fill' }).extractChannel(3).raw().toBuffer();
    const claimed = Array.isArray(meta.rects) && meta.rects[i] === true;
    prep.push({ alpha, cw, ch, rect: claimed && Contour.coverage(alpha, cw, ch) >= v.rectanguloCobertura - 0.02 });
  }
  return prep;
}

async function buildVinyl(meta, files, boxes, P, labelY, lengthCm, name, outBase, prep) {
  const v = config.vinilo;
  const M = v.margenCm; // espacio libre alrededor para las marcas de registro de la plotter
  const capas = P.capas;
  const images = [], contours = [];
  for (let i = 0; i < files.length; i++) {
    const d = meta.designs[i];
    let img = input(files[i]).ensureAlpha();
    const m = await input(files[i]).metadata();
    if (m.width * m.height > 16e6) img = img.resize({ width: Math.round(m.width * Math.sqrt(16e6 / (m.width * m.height))) });
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const n = info.width * info.height;
    const solid = new Uint8Array(n);
    for (let p = 0; p < n; p++) solid[p] = data[p * 4 + 3] >= 128 ? 1 : 0;
    let white = null;
    if (capas.includes('blanco')) {
      // Blanco un poco más pequeño que el diseño para que no se asome por los bordes.
      const chokePx = (v.blancoReduccionMm / 10) * (info.width / d.wCm);
      white = solid;
      if (chokePx >= 0.5) {
        const bg = new Uint8Array(n);
        for (let p = 0; p < n; p++) bg[p] = solid[p] ? 0 : 1;
        const dist = Contour.distanceSq(bg, info.width, info.height);
        white = new Uint8Array(n);
        for (let p = 0; p < n; p++) white[p] = solid[p] && dist[p] > chokePx * chokePx ? 1 : 0;
      }
    }
    images.push({ width: info.width, height: info.height, rgba: data, white, gloss: capas.includes('brillo') ? solid : null });
    const { alpha, cw, ch, rect } = prep[i];
    contours.push(rect ? null : Contour.cutContours(alpha, cw, ch, cw / d.wCm, P.off));
  }
  const pieces = [], cuts = [], rectBoxes = [];
  for (const b of boxes) {
    const d = meta.designs[b.d];
    const off = prep[b.d].rect ? 0 : P.off;
    const x = M + b.x + off, y = M + b.y + off;
    pieces.push({ img: b.d, x, y, w: d.wCm, h: d.hCm, rot: b.rot });
    // Rectangulares: corte recto justo en el borde, compartido con la pieza vecina.
    if (prep[b.d].rect) rectBoxes.push([x, y, x + b.w, y + b.h]);
    else for (const poly of contours[b.d]) cuts.push(poly.map(([px, py]) => mapPoint(px, py, x, y, d.wCm, d.hCm, b.rot)));
  }
  for (const line of Contour.gridLines(rectBoxes)) { line.open = true; cuts.push(line); }
  const pageW = P.W + 2 * M, pageH = lengthCm + 2 * M;
  // Marcas de registro en las 4 esquinas, dentro del margen (la plotter las lee para alinear el corte).
  const { ladoCm: s, bordeCm: e } = v.marcas;
  const marks = [[e, e], [pageW - e - s, e], [e, pageH - e - s], [pageW - e - s, pageH - e - s]].map(([x, y]) => [x, y, s]);
  const text = `${name.toUpperCase()}  ·  ${new Date().toLocaleDateString('es-CO')}  ·  ${P.variant.nombre}`;
  const pdf = buildPdf({
    pageW, pageH, images, pieces, cuts, marks,
    label: { text, x: M, y: M + labelY + config.etiquetaCm * 0.75, size: config.etiquetaCm * PT * 0.6 },
    spots: v.spots
  });
  fs.writeFileSync(outBase + '.pdf', pdf);
  fs.writeFileSync(outBase + '.svg', buildCutSvg(pageW, pageH, cuts, marks));
}

const tooBig = (req, res, next) =>
  Number(req.headers['content-length']) > MAX_REQUEST_BYTES
    ? res.status(413).json({ error: 'El pedido es demasiado pesado. Usa imágenes más livianas o menos imágenes.' })
    : next();

app.post('/api/orders', limit('orders', 20, 60 * 60 * 1000), tooBig,
  upload.fields([{ name: 'images', maxCount: MAX_DESIGNS }, { name: 'label', maxCount: 1 }]), async (req, res) => {
    const uploaded = Object.values(req.files || {}).flat();
    try {
      let meta;
      try { meta = JSON.parse(req.body.meta); } catch { fail('Datos inválidos.'); }
      if (!meta || typeof meta !== 'object') fail('Datos inválidos.');
      const name = String(meta.name || '').trim().slice(0, 100);
      const phone = String(meta.phone || '').trim().slice(0, 40);
      const note = String(meta.note || '').trim().slice(0, 500);
      if (!name || !phone) fail('Nombre y teléfono son obligatorios.');
      if (meta.accepted !== true) fail('Debes aceptar las aclaraciones.');
      const vinyl = meta.product === 'vinilo';
      const P = productParams(meta);
      const files = (req.files && req.files.images) || [];
      const label = req.files && req.files.label && req.files.label[0];
      if (!label && !vinyl) fail('Falta la etiqueta del cliente.');
      if (vinyl && files.length !== (meta.designs || []).length) fail('Imágenes inválidas.');
      const prep = vinyl ? await prepVinyl(meta, files) : [];
      const { boxes, lengthCm: layoutLength } = checkLayout(meta, files.length, P, prep.map((x) => x.rect));
      const labelY = layoutLength + meta.gapCm; // franja con el nombre del cliente al final
      const rawLength = labelY + config.etiquetaCm;
      if (rawLength > P.maxLen + 0.01) fail(`El montaje supera ${P.maxLen} cm. Para más metros contáctanos.`);
      const lengthCm = Math.max(P.minLen, rawLength); // montaje mínimo
      const usedWidth = Math.max(...boxes.map((b) => b.x + b.w));

      // Resolución efectiva de cada diseño a su medida (para avisar al taller).
      const pieces = [];
      for (let i = 0; i < files.length; i++) {
        let meta2;
        try { meta2 = await input(files[i]).metadata(); } catch { fail('Una de las imágenes no es válida.'); }
        if (!meta2.width || meta2.width * meta2.height > MAX_INPUT_PIXELS) fail('Una de las imágenes es demasiado grande.');
        const d = meta.designs[i];
        pieces.push({
          wCm: Number(d.wCm.toFixed(2)), hCm: Number(d.hCm.toFixed(2)),
          qty: boxes.filter((b) => b.d === i).length,
          dpi: Math.round(meta2.width / (d.wCm / 2.54))
        });
      }

      if (waiting >= MAX_WAITING) return res.status(503).json({ error: 'Estamos procesando otros pedidos. Intenta de nuevo en un minuto.' });
      const id = crypto.randomBytes(16).toString('hex');
      waiting++;
      let dpi = null;
      try {
        await exclusive(async () => {
          if (vinyl) await buildVinyl(meta, files, boxes, P, labelY, lengthCm, name, path.join(FILES_DIR, id), prep);
          else dpi = await composeMontage(meta, files, boxes, lengthCm, label, labelY, path.join(FILES_DIR, `${id}.png`));
        });
      } finally { waiting--; }

      // Piezas pequeñas: todo el pliego pasa a la tarifa de corte pequeño.
      const hasSmall = vinyl && boxes.some((b) => Math.max(meta.designs[b.d].wCm, meta.designs[b.d].hCm) < config.vinilo.piezaPequenaCm);
      const { price, detalle } = vinyl
        ? Pricing.quoteVinyl(config, meta.variant, { anchoCm: P.W, largoMaxCm: P.maxLen }, hasSmall)
        : Pricing.quote(config, meta.style, lengthCm);
      const usedCm2 = boxes.reduce((s, b) => s + b.w * b.h, 0);
      const orders = loadOrders();
      orders.unshift({
        id, name, phone, note,
        product: vinyl ? 'vinilo' : 'dtf',
        style: vinyl ? P.variant.nombre : meta.style,
        files: vinyl ? ['pdf', 'svg'] : ['png'],
        ...(vinyl ? {
          capas: P.capas,
          cutType: meta.cutType, offsetCm: meta.offsetCm, widthCm: Number(usedWidth.toFixed(2))
        } : {}),
        gapCm: meta.gapCm,
        lengthCm: Number(lengthCm.toFixed(2)),
        pieces: boxes.length,
        items: pieces,
        emptyPct: Math.round((1 - usedCm2 / (P.W * (vinyl ? P.maxLen : Math.max(layoutLength, P.minLen)))) * 100),
        price, detalle, dpi,
        acceptedAt: new Date().toISOString(),
        status: 'pendiente', createdAt: new Date().toISOString()
      });
      saveOrders(orders);
      res.json({ ok: true, ref: id.slice(0, 8).toUpperCase(), price });
    } catch (e) {
      if (e instanceof Invalid) return res.status(400).json({ error: e.message });
      console.error(e);
      res.status(400).json({ error: 'No se pudo procesar el pedido. Revisa tus imágenes e intenta de nuevo.' });
    } finally {
      for (const f of uploaded) fs.rm(f.path, { force: true }, () => {});
    }
  });

app.post('/api/admin/login', limit('login', 10, 15 * 60 * 1000), async (req, res) => {
  const user = String((req.body && req.body.user) || '').trim().toLowerCase();
  const pass = String((req.body && req.body.password) || '').slice(0, 200);
  if (!/^[a-z0-9]{3,30}$/.test(user) || !(await checkLogin(user, pass))) return res.status(401).json({ error: 'Usuario o clave incorrectos' });
  res.setHeader('Set-Cookie', `admin=${issueToken(user)}; HttpOnly; SameSite=Strict; Path=/;${req.secure ? ' Secure;' : ''} Max-Age=${SESSION_MS / 1000}`);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => res.json(loadOrders()));

app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const orders = loadOrders();
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'No existe' });
  if (['pendiente', 'impreso'].includes(req.body.status)) order.status = req.body.status;
  saveOrders(orders);
  res.json(order);
});

const MIME = { png: 'image/png', pdf: 'application/pdf', svg: 'image/svg+xml' };
app.get('/api/admin/orders/:id/download/:kind', requireAdmin, (req, res) => {
  const order = loadOrders().find((o) => o.id === req.params.id);
  const kind = req.params.kind;
  if (!order || !(order.files || ['png']).includes(kind)) return res.status(404).end();
  const file = path.join(FILES_DIR, `${order.id}.${kind}`);
  const safe = order.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '_');
  const tipo = order.product === 'vinilo' ? `vinilo_${order.widthCm}x${order.lengthCm}cm${kind === 'svg' ? '_corte' : ''}` : `${order.style}_58x${order.lengthCm}cm`;
  res.download(file, `${order.id.slice(0, 8)}_${safe}_${tipo}.${kind}`, { headers: { 'Content-Type': MIME[kind] } });
});

// Errores en JSON legible, sin detalles internos.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Una imagen pesa más de 25 MB. Usa una imagen más liviana.'
      : err.code === 'LIMIT_FILE_COUNT' ? `Máximo ${MAX_DESIGNS} imágenes por pedido.`
        : 'No se pudieron recibir las imágenes.';
    return res.status(400).json({ error: msg });
  }
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'Datos inválidos.' });
  console.error(err);
  res.status(500).json({ error: 'Error interno.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Servidor en http://localhost:${port}`));
