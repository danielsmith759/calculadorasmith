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
  // Vinilo: precio por m² del montaje (ancho usado x largo) según la variante.
  // smallShare: fracción del área de piezas que corresponde a piezas pequeñas (tarifa especial).
  function quoteVinyl(cfg, variantId, usedWidthCm, lengthCm, smallShare = 0) {
    const v = cfg.vinilo;
    const variant = v.variantes.find((x) => x.id === variantId);
    const real = (usedWidthCm * lengthCm) / 10000;
    const area = Math.max(v.areaMinimaM2, real);
    const small = variant.precioPequenoM2 || variant.precioM2;
    const perM2 = Math.round(variant.precioM2 * (1 - smallShare) + small * smallShare) + (v.cortePorM2 || 0);
    const minNote = real < v.areaMinimaM2 ? ` (mínimo ${String(v.areaMinimaM2).replace('.', ',')} m²)` : '';
    const smallNote = smallShare > 0 && small !== variant.precioM2
      ? ` · ${Math.round(smallShare * 100)}% en piezas pequeñas a ${small.toLocaleString('es-CO')}/m²` : '';
    return {
      price: Math.round((area * perM2) / 100) * 100,
      area,
      detalle: `${area.toFixed(3).replace('.', ',')} m²${minNote} × ${perM2.toLocaleString('es-CO')}/m²${smallNote}`
    };
  }
  const api = { quote, quoteVinyl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pricing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
