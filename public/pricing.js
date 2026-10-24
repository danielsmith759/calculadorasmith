// Cálculo de precio compartido por el navegador y el servidor (una sola fuente de verdad).
(function (root) {
  function quote(cfg, style, lengthCm) {
    const L = Math.max(cfg.largoMinimoCm, lengthCm);
    if (L < 100) {
      // Sub-metro: precio fijo por rango (se redondea el largo hacia arriba al cm).
      const cm = Math.ceil(L - 1e-9);
      const r = cfg.rangos.find((x) => cm <= x.hasta) || cfg.rangos[cfg.rangos.length - 1];
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
  const api = { quote };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pricing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
