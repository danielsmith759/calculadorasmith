// Prueba de punta a punta en navegador real (Chromium): vinilo, DTF, calculadora y panel, con salida corta.
// Uso: npm run e2e            (perfil de escritorio)
//      npm run e2e -- --todos (también Android, iPhone con límites de Safari y celular lento)
// Requiere Playwright instalado (global o en el proyecto). No guarda nada fuera de una carpeta temporal.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');
let pw;
try { pw = require('playwright'); } catch {
  try { pw = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')); }
  catch { console.error('Falta Playwright: npm i -g playwright'); process.exit(2); }
}
const { chromium, devices } = pw;

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'smith-e2e-'));
const PORT = 4700 + Math.floor(Math.random() * 200);
const URL = `http://localhost:${PORT}`;
const SAFARI = `(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (...a) {
  if (this.width * this.height > 16777216) { window.__big = (window.__big || 0) + 1; return null; } return g.apply(this, a); }; })();`;
const PERFILES = [
  { name: 'Escritorio', ctx: { viewport: { width: 1366, height: 768 } } },
  ...(process.argv.includes('--todos') ? [
    { name: 'Android', ctx: devices['Pixel 7'] },
    { name: 'iPhone (límites Safari)', ctx: devices['iPhone 13'], safari: true },
    { name: 'Celular lento', ctx: devices['Galaxy S5'], slow: true }
  ] : [])
];

async function imagenes() {
  const svg = (body, w = 600, h = 600) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
  const f = (n) => path.join(TMP, n);
  await sharp(svg('<rect width="600" height="600" fill="#fff"/><circle cx="300" cy="300" r="220" fill="#d01010"/>')).png().toFile(f('logo.png'));
  await sharp(svg('<polygon points="300,30 370,230 580,230 410,350 470,560 300,440 130,560 190,350 20,230 230,230" fill="#f90"/>')).png().toFile(f('estrella.png'));
  await sharp(svg('<rect width="800" height="400" fill="#2b6"/>', 800, 400)).png().toFile(f('rect.png'));
  return { logo: f('logo.png'), estrella: f('estrella.png'), rect: f('rect.png') };
}

async function enviar(pg) {
  await pg.check('#accept'); await pg.fill('#name', 'Prueba E2E'); await pg.fill('#phone', '3001234567');
  await pg.click('#send'); await pg.waitForTimeout(300);
  if (/pequeña/.test(await pg.textContent('#result'))) await pg.click('#send'); // aviso de resolución: segundo clic
  await pg.waitForFunction(() => /Pedido recibido|No se pudo|Se perdió/.test(document.getElementById('result').textContent), null, { timeout: 90000 });
  const t = await pg.textContent('#result');
  if (!/Pedido recibido/.test(t)) throw new Error(t.slice(0, 120));
}

(async () => {
  const img = await imagenes();
  const srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT, DATA_DIR: path.join(TMP, 'data'), ADMIN_USERS: 'equipo:clave12345', WHATSAPP: '573001234567' } });
  await new Promise((r) => setTimeout(r, 1500));
  const b = await chromium.launch();
  let fallas = 0;
  for (const pf of PERFILES) {
    const ctx = await b.newContext({ ...pf.ctx, acceptDownloads: true });
    if (pf.safari) await ctx.addInitScript(SAFARI);
    const pg = await ctx.newPage();
    if (pf.slow) await (await ctx.newCDPSession(pg)).send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    pg.on('dialog', (d) => d.accept());
    const res = [];
    const paso = async (nombre, fn) => {
      try { await fn(); res.push(`${nombre} ✓`); } catch (e) { fallas++; res.push(`${nombre} ✗ (${e.message.split('\n')[0].slice(0, 90)})`); }
    };
    await paso('vinilo', async () => {
      await pg.goto(`${URL}/?producto=vinilo`);
      await pg.setInputFiles('#file', [img.logo, img.estrella, img.rect]);
      await pg.waitForFunction(() => document.querySelectorAll('.chip').length === 3, null, { timeout: 30000 });
      await pg.locator('.chip').first().click(); await pg.click('#btnColor'); await pg.waitForTimeout(600);
      await pg.selectOption('#shape', 'circulo'); await pg.waitForTimeout(300);
      await pg.fill('#w', '4,5'); await pg.dispatchEvent('#w', 'input');
      await pg.fill('#qty', '40'); await pg.dispatchEvent('#qty', 'input'); await pg.waitForTimeout(300);
      await pg.click('#btnFill'); await pg.waitForTimeout(500);
      if (await pg.isVisible('#limit button')) { await pg.click('#limit button'); await pg.waitForTimeout(500); }
      const prot = await pg.evaluate(() => !document.getElementById('montage').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
      if (!prot) throw new Error('el montaje permite clic derecho');
      await enviar(pg);
    });
    await paso('DTF', async () => {
      await pg.goto(`${URL}/?producto=dtf`);
      await pg.setInputFiles('#file', [img.logo, img.estrella]); await pg.waitForSelector('#montage');
      await pg.waitForTimeout(800); await enviar(pg);
    });
    await paso('calculadora', async () => {
      await pg.goto(`${URL}/stickers.html`);
      await pg.fill('#cw', '2,5'); await pg.dispatchEvent('#cw', 'input'); await pg.fill('#ch', '2,5'); await pg.dispatchEvent('#ch', 'input');
      await pg.fill('#cqty', '500'); await pg.dispatchEvent('#cqty', 'input'); await pg.waitForTimeout(300);
      const t = await pg.textContent('#ccount');
      if (!/c\/u/.test(t)) throw new Error('sin precio por unidad: ' + t);
    });
    if (pf === PERFILES[0]) await paso('panel', async () => {
      await pg.goto(`${URL}/admin.html`);
      await pg.fill('#user', 'equipo'); await pg.fill('#pass', 'clave12345'); await pg.press('#pass', 'Enter');
      await pg.waitForSelector('#rows select');
      const n = await pg.locator('#rows a[href*="download"]').count();
      if (n < 3) throw new Error(`solo ${n} archivos para descargar`);
      const [dl] = await Promise.all([pg.waitForEvent('download'), pg.locator('#rows a[href*="download"]').first().click()]);
      if (!(await dl.path())) throw new Error('descarga vacía');
    });
    const ancho = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (ancho) { fallas++; res.push('desborde horizontal ✗'); }
    if (errs.length) { fallas++; res.push(`errores JS ✗ (${errs[0].slice(0, 80)})`); }
    console.log(`${pf.name}: ${res.join(' · ')}`);
    await ctx.close();
  }
  await b.close(); srv.kill();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fallas ? `${fallas} falla(s)` : 'Todo bien');
  process.exit(fallas ? 1 : 0);
})();
