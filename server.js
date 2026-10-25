const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const Pricing = require('./public/pricing.js');

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
function checkLayout(meta, fileCount) {
  const W = config.anchoRolloCm, G = meta.gapCm, EPS = 0.01;
  if (!Number.isFinite(G) || G < config.separacionCm - 1e-9 || G > config.separacionMaxCm + 1e-9) fail('Separación entre diseños inválida.');
  if (!config.estilos.some((e) => e.id === meta.style)) fail('Estilo inválido.');
  if (!Array.isArray(meta.designs) || meta.designs.length !== fileCount || !fileCount) fail('Imágenes inválidas.');
  for (const d of meta.designs) {
    if (!d || !Number.isFinite(d.wCm) || !Number.isFinite(d.hCm) || Math.min(d.wCm, d.hCm) < 0.5 ||
      Math.min(d.wCm, d.hCm) > W || Math.max(d.wCm, d.hCm) > config.largoMaximoCm) fail('Medida de diseño inválida.');
  }
  if (!Array.isArray(meta.layout) || !meta.layout.length) fail('Montaje inválido.');
  if (meta.layout.length > MAX_INSTANCES) fail(`Máximo ${MAX_INSTANCES} piezas por pedido.`);
  const boxes = meta.layout.map((it) => {
    if (!it || !Number.isInteger(it.d) || it.d < 0 || it.d >= meta.designs.length || typeof it.rot !== 'boolean' ||
      !Number.isFinite(it.x) || !Number.isFinite(it.y)) fail('Montaje inválido.');
    const d = meta.designs[it.d];
    const w = it.rot ? d.hCm : d.wCm, h = it.rot ? d.wCm : d.hCm;
    if (it.x < -EPS || it.y < -EPS || it.x + w > W + EPS) fail('Hay diseños fuera del ancho del rollo.');
    return { x: it.x, y: it.y, w, h, d: it.d, rot: it.rot };
  });
  // Las piezas deben respetar la separación para poder cortarlas.
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.x < b.x + b.w + G - EPS && b.x < a.x + a.w + G - EPS && a.y < b.y + b.h + G - EPS && b.y < a.y + a.h + G - EPS) {
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
      const files = (req.files && req.files.images) || [];
      const label = req.files && req.files.label && req.files.label[0];
      if (!label) fail('Falta la etiqueta del cliente.');
      const { boxes, lengthCm: layoutLength } = checkLayout(meta, files.length);
      const labelY = layoutLength + meta.gapCm; // franja con el nombre del cliente al final
      const rawLength = labelY + config.etiquetaCm;
      if (rawLength > config.largoMaximoCm + 0.01) fail(`El montaje supera ${config.largoMaximoCm} cm. Para más metros contáctanos.`);
      const lengthCm = Math.max(config.largoMinimoCm, rawLength); // montaje mínimo 58 x 15 cm

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
      const outPath = path.join(FILES_DIR, `${id}.png`);
      waiting++;
      let dpi;
      try { dpi = await exclusive(() => composeMontage(meta, files, boxes, lengthCm, label, labelY, outPath)); }
      finally { waiting--; }

      const { price, detalle } = Pricing.quote(config, meta.style, lengthCm);
      const usedCm2 = boxes.reduce((s, b) => s + b.w * b.h, 0);
      const orders = loadOrders();
      orders.unshift({
        id, name, phone, note,
        style: meta.style,
        gapCm: meta.gapCm,
        lengthCm: Number(lengthCm.toFixed(2)),
        pieces: boxes.length,
        items: pieces,
        emptyPct: Math.round((1 - usedCm2 / (config.anchoRolloCm * Math.max(layoutLength, config.largoMinimoCm))) * 100),
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

app.get('/api/admin/orders/:id/download', requireAdmin, (req, res) => {
  const order = loadOrders().find((o) => o.id === req.params.id);
  if (!order) return res.status(404).end();
  const file = path.join(FILES_DIR, `${order.id}.png`);
  const safe = order.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_');
  const filename = `${order.id.slice(0, 8)}_${safe}_${order.style}_58x${order.lengthCm}cm.png`;
  res.download(file, filename);
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
