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
  const api = { quote, quoteVinyl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pricing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
