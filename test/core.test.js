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
