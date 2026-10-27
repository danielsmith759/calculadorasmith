// Cálculo de precio compartido por el navegador y el servidor (una sola fuente de verdad).
(function (root) {
  function quote(cfg, style, lengthCm) {
    const L = Math.max(cfg.largoMinimoCm, lengthCm);
    if (L < 100) {
      // Sub-metro: precio fijo por rango (el largo se redondea hacia arriba al cm; 99,x cm sigue en el último rango).
      const last = cfg.rangos[cfg.rangos.length - 1];
      const cm = Math.min(last.hasta, Math.ceil(L - 1e-9));
      const r = cfg.rangos.find((x) => cm <= x.hasta);
      return { price: r[style], detalle: `Rango ${r.desde}–${r.hasta} cm (precio fijo)` };
    }
    const m = L / 100;
    const t = [...cfg.tramos].reverse().find((x) => m >= x.desde);
    const pct = t.dcto ? ` con ${Math.round(t.dcto * 100)}% dcto` : '';
    return {
      price: Math.round((m * t[style]) / 100) * 100,
      detalle: `${m.toFixed(2)} m × ${t[style].toLocaleString('es-CO')}/m${pct}`
    };
  }
  // Vinilo: se cobra el pliego completo de la variante, se llene o no.
  // hasSmall: si el montaje tiene piezas pequeñas, todo el pliego va a la tarifa de corte pequeño.
  function quoteVinyl(cfg, variantId, area, hasSmall = false) {
    const variant = cfg.vinilo.variantes.find((x) => x.id === variantId);
    const small = hasSmall && variant.precioPequeno && variant.precioPequeno !== variant.precio;
    return {
      price: small ? variant.precioPequeno : variant.precio,
      detalle: `Pliego completo ${area.anchoCm} × ${area.largoMaxCm} cm` + (small ? ' · tarifa de corte pequeño (piezas menores de 3 cm)' : '')
    };
  }
  // Acomodo de piezas iguales de a x b cm (ya con margen de corte) en W x L con separación g.
  // Prueba las dos orientaciones y combinaciones de columnas (o filas) en una orientación + el resto girado.
  // Devuelve las posiciones [{ x, y, w, h }] en cm.
  function fitLayout(W, L, a, b, g) {
    const n = (len, size) => Math.max(0, Math.floor((len + g + 1e-9) / (size + g)));
    let best = null;
    for (const t of [false, true]) { // t: se divide por filas en vez de columnas
      const WW = t ? L : W, LL = t ? W : L;
      for (const [p, q] of [[a, b], [b, a]]) {
        const cols = n(WW, p);
        for (let k = 0; k <= cols; k++) {
          const rest = WW - k * (p + g);
          const count = k * n(LL, q) + n(rest, q) * n(LL, p);
          if (!best || count > best.count) best = { count, t, p, q, k, WW, LL, rest };
        }
      }
    }
    const { t, p, q, k, LL, rest } = best;
    const out = [];
    const push = (x, y, w, h) => out.push(t ? { x: y, y: x, w: h, h: w } : { x, y, w, h });
    for (let c = 0; c < k; c++) for (let r = 0; r < n(LL, q); r++) push(c * (p + g), r * (q + g), p, q);
    const x0 = k * (p + g);
    for (let c = 0; c < n(rest, q); c++) for (let r = 0; r < n(LL, p); r++) push(x0 + c * (q + g), r * (p + g), q, p);
    return out;
  }
  const fitCount = (W, L, a, b, g) => fitLayout(W, L, a, b, g).length;

  const api = { quote, quoteVinyl, fitLayout, fitCount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pricing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
