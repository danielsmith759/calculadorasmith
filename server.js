const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Pricing = require('./public/pricing.js');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
fs.mkdirSync(FILES_DIR, { recursive: true });

let adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) {
  adminPassword = crypto.randomBytes(6).toString('hex');
  console.log(`ADMIN_PASSWORD no definido. Clave temporal de administrador: ${adminPassword}`);
}
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_MS = 12 * 60 * 60 * 1000;

const loadOrders = () => {
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); } catch { return []; }
};
const saveOrders = (orders) => {
  const tmp = ORDERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(orders, null, 2));
  fs.renameSync(tmp, ORDERS_FILE);
};

const sign = (value) => crypto.createHmac('sha256', SECRET).update(value).digest('hex');
const safeEqual = (a, b) => {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};
const issueToken = () => {
  const exp = String(Date.now() + SESSION_MS);
  return `${exp}.${sign(exp)}`;
};
const validToken = (token) => {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  return !!sig && safeEqual(sig, sign(exp)) && Number(exp) > Date.now();
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
const limit = (max, windowMs) => (req, res, next) => {
  const key = req.path + req.ip;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) return res.status(429).json({ error: 'Demasiados intentos, espera un momento.' });
  recent.push(now);
  hits.set(key, recent);
  next();
};

const MAX_DESIGNS = 60;
const MAX_INSTANCES = 300;
const MAX_MONTAGE_PIXELS = 120e6; // tope de memoria al componer el montaje
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: MAX_DESIGNS } });
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => res.json(config));

class Invalid extends Error {}
const fail = (msg) => { throw new Invalid(msg); };

// Valida el montaje enviado por el cliente y devuelve el largo real (el precio sale de aquí, no del cliente).
function checkLayout(meta, fileCount) {
  const W = config.anchoRolloCm, EPS = 0.01;
  if (!config.estilos.some((e) => e.id === meta.style)) fail('Estilo inválido.');
  if (!Array.isArray(meta.designs) || meta.designs.length !== fileCount || !fileCount) fail('Imágenes inválidas.');
  for (const d of meta.designs) {
    if (!(d.wCm > 0 && d.hCm > 0) || Math.min(d.wCm, d.hCm) > W || Math.max(d.wCm, d.hCm) > 1000) fail('Medida de diseño inválida.');
  }
  if (!Array.isArray(meta.layout) || !meta.layout.length || meta.layout.length > MAX_INSTANCES) fail('Montaje inválido.');
  const boxes = meta.layout.map((it) => {
    const d = meta.designs[it.d];
    if (!d || !Number.isFinite(it.x) || !Number.isFinite(it.y)) fail('Montaje inválido.');
    const w = it.rot ? d.hCm : d.wCm, h = it.rot ? d.wCm : d.hCm;
    if (it.x < -EPS || it.y < -EPS || it.x + w > W + EPS) fail('Hay diseños fuera del ancho del rollo.');
    return { x: it.x, y: it.y, w, h, d: it.d, rot: !!it.rot };
  });
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS) fail('Hay diseños superpuestos.');
  }
  if (!meta.designs.every((_, i) => boxes.some((b) => b.d === i))) fail('Falta un diseño en el montaje.');
  return { boxes, lengthCm: Math.max(...boxes.map((b) => b.y + b.h)) };
}

// Compone todos los diseños en un solo PNG de ancho de rollo x largo, con DPI de impresión.
async function composeMontage(meta, files, boxes, lengthCm) {
  const W = config.anchoRolloCm;
  const dpi = Math.min(config.dpi, Math.floor(Math.sqrt(MAX_MONTAGE_PIXELS / ((W / 2.54) * (lengthCm / 2.54)))));
  const px = (cm) => Math.round((cm / 2.54) * dpi);
  const cache = new Map();
  const piece = async (b) => {
    const key = `${b.d}:${b.rot}`;
    if (!cache.has(key)) {
      const d = meta.designs[b.d];
      let img = sharp(files[b.d].buffer).ensureAlpha().resize(px(d.wCm), px(d.hCm), { fit: 'fill' });
      if (b.rot) img = img.rotate(90);
      cache.set(key, await img.png().toBuffer());
    }
    return cache.get(key);
  };
  const composites = [];
  for (const b of boxes) composites.push({ input: await piece(b), left: px(b.x), top: px(b.y) });
  const png = await sharp({ create: { width: px(W), height: px(lengthCm), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites)
    .withMetadata({ density: dpi })
    .png()
    .toBuffer();
  return { png, dpi };
}

app.post('/api/orders', limit(20, 60 * 60 * 1000), upload.array('images', MAX_DESIGNS), async (req, res) => {
  try {
    let meta;
    try { meta = JSON.parse(req.body.meta); } catch { fail('Datos inválidos.'); }
    const name = String(meta.name || '').trim().slice(0, 100);
    const phone = String(meta.phone || '').trim().slice(0, 40);
    const note = String(meta.note || '').trim().slice(0, 500);
    if (!name || !phone) fail('Nombre y teléfono son obligatorios.');
    if (meta.accepted !== true) fail('Debes aceptar las aclaraciones.');
    const files = req.files || [];
    const { boxes, lengthCm: rawLength } = checkLayout(meta, files.length);
    if (rawLength > config.largoMaximoCm + config.separacionCm + 0.01) fail(`El montaje supera ${config.largoMaximoCm} cm. Para más metros contáctanos.`);
    const lengthCm = Math.max(config.largoMinimoCm, rawLength); // montaje mínimo 58 x 15 cm

    const { png, dpi } = await composeMontage(meta, files, boxes, lengthCm);
    const { price, detalle } = Pricing.quote(config, meta.style, lengthCm);
    const usedCm2 = boxes.reduce((s, b) => s + b.w * b.h, 0);

    const id = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(FILES_DIR, `${id}.png`), png);
    const orders = loadOrders();
    orders.unshift({
      id, name, phone, note,
      style: meta.style,
      lengthCm: Number(lengthCm.toFixed(2)),
      pieces: boxes.length,
      emptyPct: Math.round((1 - usedCm2 / (config.anchoRolloCm * lengthCm)) * 100),
      price, detalle, dpi,
      acceptedAt: new Date().toISOString(),
      status: 'pendiente', createdAt: new Date().toISOString()
    });
    saveOrders(orders);
    res.json({ ok: true, ref: id.slice(0, 8).toUpperCase(), price });
  } catch (e) {
    if (e instanceof Invalid) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(400).json({ error: 'No se pudo procesar el pedido.' });
  }
});

app.post('/api/admin/login', limit(10, 15 * 60 * 1000), (req, res) => {
  const pass = String((req.body && req.body.password) || '');
  if (!safeEqual(sign(pass), sign(adminPassword))) return res.status(401).json({ error: 'Clave incorrecta' });
  res.setHeader('Set-Cookie', `admin=${issueToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
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
  const safe = order.name.replace(/[^\w-]+/g, '_');
  const filename = `${order.id.slice(0, 8)}_${safe}_${order.style}_58x${order.lengthCm}cm.png`;
  res.download(file, filename);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Servidor en http://localhost:${port}`));
