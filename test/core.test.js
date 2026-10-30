// Pruebas del cálculo compartido (precios, acomodo y cortes). Uso: npm test
const test = require('node:test');
const assert = require('node:assert');
const Pricing = require('../public/pricing.js');
const Contour = require('../public/contour.js');
const config = require('../config.json');

test('DTF UV: tabla por rangos bajo 1 m', () => {
  assert.strictEqual(Pricing.quote(config, 'premium', 10).price, 25000); // montaje mínimo 15 cm
  assert.strictEqual(Pricing.quote(config, 'premium', 15).price, 25000);
  assert.strictEqual(Pricing.quote(config, 'premium', 20.01).price, config.rangos.find((r) => r.desde <= 21 && 21 <= r.hasta).premium);
  assert.strictEqual(Pricing.quote(config, 'relief', 99.5).price, 123000); // 99,x cm sigue en el último rango
});

test('DTF UV: por metro desde 1 m, con descuentos por tramo', () => {
  assert.strictEqual(Pricing.quote(config, 'premium', 100).price, 85000);
  assert.strictEqual(Pricing.quote(config, 'relief', 100).price, 125000);
  assert.strictEqual(Pricing.quote(config, 'premium', 500).price, 403800); // 5 m x 80.750, redondeado a 100
});

test('Vinilo: pliego completo y tarifa de corte pequeño', () => {
  const sheet = { anchoCm: 95, largoMaxCm: 95 };
  for (const v of config.vinilo.variantes) {
    assert.strictEqual(Pricing.quoteVinyl(config, v.id, sheet, false).price, v.precio);
    assert.strictEqual(Pricing.quoteVinyl(config, v.id, sheet, true).price, v.precioPequeno);
    assert.ok(v.precioPequeno > v.precio);
  }
  assert.deepStrictEqual(config.vinilo.variantes.map((v) => v.id), ['eco', 'uv']);
});

test('Acomodo: nada se sale, nada se superpone y se respeta la separación', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 150; i++) {
    const W = 58 + Math.floor(rnd() * 40), L = 20 + Math.floor(rnd() * 80);
    const a = 1 + rnd() * 12, b = 1 + rnd() * 12, g = [0, 0.4, 0.5, 1][Math.floor(rnd() * 4)];
    const r = Pricing.fitLayout(W, L, a, b, g);
    for (const p of r) {
      assert.ok(p.x >= -1e-6 && p.y >= -1e-6 && p.x + p.w <= W + 1e-6 && p.y + p.h <= L + 1e-6, 'dentro del área');
      assert.ok(Math.abs(p.w - a) < 1e-9 && Math.abs(p.h - b) < 1e-9 || Math.abs(p.w - b) < 1e-9 && Math.abs(p.h - a) < 1e-9, 'tamaño');
    }
    for (let x = 0; x < r.length; x++) for (let y = x + 1; y < r.length; y++) {
      const p = r[x], q = r[y];
      const apart = p.x + p.w + g <= q.x + 1e-6 || q.x + q.w + g <= p.x + 1e-6 || p.y + p.h + g <= q.y + 1e-6 || q.y + q.h + g <= p.y + 1e-6;
      assert.ok(apart, `separación ${g} entre piezas (caso ${i})`);
    }
  }
});

test('Acomodo: nunca da menos que la cuadrícula simple', () => {
  const simple = (W, L, a, b, g) => Math.floor((W + g) / (a + g)) * Math.floor((L + g) / (b + g));
  for (const [W, L, a, b, g] of [[95, 94, 5.4, 5.4, 0.4], [58, 98, 7, 3, 0.5], [95, 94, 4, 4, 0], [95, 94, 2.9, 7.3, 0.4]]) {
    assert.ok(Pricing.fitCount(W, L, a, b, g) >= Math.max(simple(W, L, a, b, g), simple(W, L, b, a, g)));
  }
  assert.strictEqual(Pricing.fitCount(10, 10, 20, 20, 0), 0); // no cabe
});

test('Contorno: cuadro lleno es rectángulo y los bordes compartidos se unen', () => {
  const n = 40, full = new Uint8Array(n * n).fill(255);
  assert.ok(Contour.coverage(full, n, n) >= config.vinilo.rectanguloCobertura);
  const circle = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (Math.hypot(x - n / 2, y - n / 2) < n / 2 - 1) circle[y * n + x] = 255;
  assert.ok(Contour.coverage(circle, n, n) < config.vinilo.rectanguloCobertura);
  const lines = Contour.gridLines([[0, 0, 5, 5], [5, 0, 10, 5], [0, 5, 5, 10], [5, 5, 10, 10]]);
  assert.strictEqual(lines.length, 6); // 3 horizontales + 3 verticales, sin duplicados
  const polys = Contour.cutContours(circle, n, n, 10, 0.2);
  assert.strictEqual(polys.length, 1);
});

test('Configuración: reglas de negocio vigentes', () => {
  assert.strictEqual(config.anchoRolloCm, 58);
  assert.strictEqual(config.largoMinimoCm, 15);
  assert.strictEqual(config.largoMaximoCm, 100);
  assert.strictEqual(config.separacionCm, 0.5);
  assert.strictEqual(config.vinilo.separacionCm, 0.4);
  assert.deepStrictEqual(config.estilos.map((e) => e.id), ['premium', 'relief']);
  assert.strictEqual(config.vinilo.areaColor.anchoCm, 95);
});

test('Pieza pequeña: 3 cm exactos (con error de coma flotante) no es pequeña', () => {
  assert.strictEqual(Pricing.isSmall(config, 2.9999999999999996, 1), false);
  assert.strictEqual(Pricing.isSmall(config, 3, 3), false);
  assert.strictEqual(Pricing.isSmall(config, 2.9, 1), true);
  assert.strictEqual(Pricing.quoteVinyl(config, 'eco', { anchoCm: 95, largoMaxCm: 95 }, false).price, 50000);
});

test('Redondeo a 100 por metros sin errores de coma flotante', () => {
  assert.strictEqual(Pricing.quote(config, 'premium', 113).price, 96100);
  assert.strictEqual(Pricing.quote(config, 'premium', 139).price, 118200);
  assert.strictEqual(Pricing.quote(config, 'premium', 500).price, 403800);
});

test('Entradas inválidas no cuelgan ni lanzan errores confusos', () => {
  assert.deepStrictEqual(Pricing.fitLayout(95, 95, 0, 0, 0), []);
  assert.deepStrictEqual(Pricing.fitLayout(95, NaN, 5, 5, 0.4), []);
  assert.throws(() => Pricing.quote(config, 'premium', NaN));
  assert.throws(() => Pricing.quoteVinyl(config, 'nada', { anchoCm: 1, largoMaxCm: 1 }));
});

test('Corte: curvas cerradas, radio mínimo de esquina y revisión de partes finas', () => {
  // Dos círculos unidos por una tira de 1 mm: con margen de 0,5 mm la unión queda más angosta que 2 mm.
  const ppc = 40, W = 4 * ppc, H = 2 * ppc, a = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c1 = Math.hypot(x - 0.8 * ppc, y - H / 2) < 0.7 * ppc, c2 = Math.hypot(x - 3.2 * ppc, y - H / 2) < 0.7 * ppc;
    const bar = Math.abs(y - H / 2) < 0.05 * ppc && x > 0.8 * ppc && x < 3.2 * ppc;
    a[y * W + x] = c1 || c2 || bar ? 255 : 0;
  }
  const thin = Contour.cutContours(a, W, H, ppc, 0.05, { radiusCm: 0.1, check: { minWidthCm: 0.2, minSizeCm: 0.4 } });
  assert.strictEqual(thin.length, 1);
  assert.strictEqual(thin.check.thin, true);
  const ok = Contour.cutContours(a, W, H, ppc, 0.15, { radiusCm: 0.1, check: { minWidthCm: 0.2, minSizeCm: 0.4 } });
  assert.strictEqual(ok.check.thin, false);
  // Curvas: un tramo por punto, que termina en el siguiente punto y cierra en el primero.
  const p = ok[0];
  assert.ok(p.smooth);
  const bz = Contour.bezier(p);
  assert.strictEqual(bz.length, p.length);
  assert.deepStrictEqual(bz[bz.length - 1].slice(4), p[0]);
});
