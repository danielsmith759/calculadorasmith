const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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

const calcPrice = (widthCm, heightCm, qty) => {
  const areaM2 = (widthCm * heightCm) / 10000 * qty;
  const price = Math.max(config.precioMinimo, Math.round(areaM2 * config.precioM2 / 100) * 100);
  return { areaM2, price };
};

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

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => res.json(config));

app.post('/api/orders', limit(20, 60 * 60 * 1000), upload.single('image'), async (req, res) => {
  try {
    const widthCm = parseFloat(req.body.widthCm);
    const heightCm = parseFloat(req.body.heightCm);
    const qty = parseInt(req.body.qty, 10);
    const name = String(req.body.name || '').trim().slice(0, 100);
    const phone = String(req.body.phone || '').trim().slice(0, 40);
    const note = String(req.body.note || '').trim().slice(0, 500);

    if (!req.file) return res.status(400).json({ error: 'Falta la imagen.' });
    if (!name || !phone) return res.status(400).json({ error: 'Nombre y teléfono son obligatorios.' });
    if (!(widthCm > 0 && heightCm > 0 && qty >= 1 && qty <= 1000))
      return res.status(400).json({ error: 'Medidas o cantidad inválidas.' });
    if (Math.min(widthCm, heightCm) > config.anchoRolloCm)
      return res.status(400).json({ error: `El diseño excede el ancho del rollo (${config.anchoRolloCm} cm).` });

    // sharp valida que sea una imagen real y la normaliza a PNG con DPI de impresión.
    const png = await sharp(req.file.buffer)
      .ensureAlpha()
      .png()
      .withMetadata({ density: config.dpi })
      .toBuffer();

    const id = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(FILES_DIR, `${id}.png`), png);

    const { areaM2, price } = calcPrice(widthCm, heightCm, qty);
    const order = {
      id, name, phone, note, widthCm, heightCm, qty,
      areaM2: Number(areaM2.toFixed(4)), price,
      status: 'pendiente', createdAt: new Date().toISOString()
    };
    const orders = loadOrders();
    orders.unshift(order);
    saveOrders(orders);
    res.json({ ok: true, ref: id.slice(0, 8).toUpperCase(), price });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: 'No se pudo procesar la imagen.' });
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
  const filename = `${order.id.slice(0, 8)}_${safe}_${order.widthCm}x${order.heightCm}cm_x${order.qty}.png`;
  res.download(file, filename);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Servidor en http://localhost:${port}`));
