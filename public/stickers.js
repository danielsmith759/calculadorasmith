// Calculadora de stickers para el equipo: cuántos caben por pliego (vinilo) o por metro (DTF UV)
// y el valor por unidad, con los mismos precios y reglas del cotizador.
(function () {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => '$' + Math.round(n).toLocaleString('es-CO');
  const cm = (n) => (Math.round(n * 10) / 10).toLocaleString('es-CO');
  const SIZES = [2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30];
  let config, products, prod;

  // Medidas y precio de referencia de cada producto.
  function area() {
    if (prod.kind === 'dtf') {
      return { W: config.anchoRolloCm, L: 100, where: `1 metro (${config.anchoRolloCm} × 100 cm)`, unitLabel: 'metro' };
    }
    const a = config.vinilo.areaColor;
    return { W: a.anchoCm, L: a.largoMaxCm, where: `un pliego de ${a.anchoCm} × ${a.largoMaxCm} cm`, unitLabel: 'pliego' };
  }
  // Valor del pliego (vinilo, tarifa de corte pequeño si aplica) o de 1 metro (DTF).
  function basePrice(maxSide) {
    if (prod.kind === 'dtf') return Pricing.quote(config, prod.id, 100).price;
    const v = prod.v;
    return Pricing.isSmall(config, maxSide, maxSide) && v.precioPequeno ? v.precioPequeno : v.precio;
  }
  // Pieza con su margen de corte y la separación que aplica.
  function piece(w, h) {
    const gap = Number($('cgap').value) / 10;
    if (prod.kind === 'dtf') return { a: w, b: h, g: gap, gap };
    if ($('cshape').value === 'recto') return { a: w, b: h, g: 0, gap };
    const off = Number($('coff').value) / 10;
    return { a: w + 2 * off, b: h + 2 * off, g: gap, gap, off };
  }
  // Largo útil: se descuenta la franja con el nombre del cliente al final del montaje.
  const usable = (L, gap) => L - gap - config.etiquetaCm;

  function count(w, h) {
    const A = area(), p = piece(w, h);
    const max = prod.kind === 'dtf' ? config.maxPiezas : config.vinilo.maxPiezas;
    return Pricing.fitLayout(A.W, usable(A.L, p.gap), p.a, p.b, p.g).slice(0, max);
  }

  function renderProducts() {
    $('calcProducts').innerHTML = '';
    for (const p of products) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'product' + (p === prod ? ' sel' : '');
      b.innerHTML = `<b>${p.name}</b><br><span>${p.kind === 'dtf' ? 'Por metro, 58 cm de ancho' : 'Por pliego de 95 × 95 cm'}</span>`;
      b.addEventListener('click', () => setProduct(p));
      $('calcProducts').appendChild(b);
    }
  }

  function setProduct(p) {
    const kindChanged = !prod || prod.kind !== p.kind;
    prod = p;
    if (kindChanged) {
      const src = p.kind === 'dtf' ? config : config.vinilo;
      $('cgap').min = src.separacionCm * 10; $('cgap').max = src.separacionMaxCm * 10; $('cgap').value = src.separacionCm * 10;
    }
    $('cutOpts').classList.toggle('hidden', p.kind === 'dtf');
    renderProducts();
    update();
  }

  function valid() {
    const w = Number($('cw').value), h = Number($('ch').value);
    const gap = Number($('cgap').value), off = Number($('coff').value);
    const src = prod.kind === 'dtf' ? config : config.vinilo;
    if (!(w >= 0.5 && h >= 0.5)) return 'Escribe ancho y alto de al menos 0,5 cm.';
    if (!(gap >= src.separacionCm * 10 && gap <= src.separacionMaxCm * 10)) return `La separación debe estar entre ${src.separacionCm * 10} y ${src.separacionMaxCm * 10} mm.`;
    const v = config.vinilo;
    if (prod.kind !== 'dtf' && !(off >= v.margenCorteMinCm * 10 && off <= v.margenCorteMaxCm * 10)) return `El margen de corte debe estar entre ${v.margenCorteMinCm * 10} y ${v.margenCorteMaxCm * 10} mm.`;
    return '';
  }

  let quoteText = '';
  function update() {
    const err = valid();
    $('cwarn').textContent = err;
    if (err) return;
    const w = Number($('cw').value), h = Number($('ch').value);
    const A = area(), p = piece(w, h);
    const rects = count(w, h);
    const n = rects.length;
    $('cwhere').textContent = `Caben en ${A.where}`;
    if (!n) {
      $('ccount').textContent = 'No cabe';
      $('cunit').textContent = 'El sticker es más grande que el área de impresión.';
      $('cqtyRes').classList.add('hidden');
      quoteText = '';
      draw([], A, p);
      renderTable(w / h);
      return;
    }
    const price = basePrice(Math.max(w, h));
    const unit = price / n;
    const small = prod.kind !== 'dtf' && Pricing.isSmall(config, w, h);
    $('ccount').textContent = `${n.toLocaleString('es-CO')} stickers`;
    $('cunit').textContent = `${fmt(unit)} c/u · ${A.unitLabel} ${fmt(price)}${small ? ' (tarifa de corte pequeño, menos de 3 cm)' : ''}`;
    quoteText = `${prod.name} · stickers de ${cm(w)} × ${cm(h)} cm\nCaben ${n} en ${A.where}\nValor por unidad: ${fmt(unit)} (${A.unitLabel} ${fmt(price)})`;

    const qty = Math.min(1e5, Math.floor(Number($('cqty').value)));
    if (qty >= 1) {
      let line;
      if (prod.kind === 'dtf') {
        // Largo mínimo de montaje para la cantidad pedida.
        let lo = 0, hi = 100000;
        for (let i = 0; i < 50; i++) {
          const m = (lo + hi) / 2;
          if (Pricing.fitCount(A.W, m, p.a, p.b, p.g) >= qty) hi = m; else lo = m;
        }
        const len = Math.max(config.largoMinimoCm, Math.ceil((hi + p.gap + config.etiquetaCm) * 10) / 10);
        const q = Pricing.quote(config, prod.id, len);
        line = `${qty.toLocaleString('es-CO')} stickers: montaje de ${A.W} × ${cm(len)} cm · ${fmt(q.price)} · ${fmt(q.price / qty)} c/u` +
          (len > 100 ? '. Pasa de 1 metro: se cotiza por metros.' : '');
      } else {
        const sheets = Math.ceil(qty / n);
        const total = sheets * price;
        const spare = sheets * n - qty;
        line = `${qty.toLocaleString('es-CO')} stickers: ${sheets} pliego${sheets > 1 ? 's' : ''} · ${fmt(total)} · ${fmt(total / qty)} c/u` +
          (spare ? `. Sobra espacio para ${spare} más sin pagar más.` : '');
      }
      $('cqtyRes').textContent = line;
      $('cqtyRes').classList.remove('hidden');
      quoteText += `\n${line}`;
    } else $('cqtyRes').classList.add('hidden');
    quoteText += '\nIVA no incluido.';
    draw(rects, A, p);
    renderTable(w / h);
  }

  // Vista del pliego o del metro con los stickers acomodados.
  function draw(rects, A, p) {
    const c = $('cprev');
    const cssW = Math.max(260, $('cbox').clientWidth - 16);
    const s = Math.min(30, (cssW * Math.min(2, window.devicePixelRatio || 1)) / A.W, 3000 / Math.max(A.W, A.L));
    c.width = Math.round(A.W * s); c.height = Math.round(A.L * s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    const off = p.off || 0;
    for (const r of rects) {
      ctx.fillStyle = '#FFD700';
      ctx.fillRect((r.x + off) * s, (r.y + off) * s, (r.w - 2 * off) * s, (r.h - 2 * off) * s);
      if (prod.kind !== 'dtf') {
        ctx.strokeStyle = '#e0007a'; ctx.lineWidth = Math.max(1, s / 10);
        ctx.strokeRect(r.x * s, r.y * s, r.w * s, r.h * s);
      }
    }
    // Franja con el nombre del cliente.
    const ly = Math.max(0, ...rects.map((r) => r.y + r.h)) + p.gap;
    ctx.fillStyle = '#ccc';
    ctx.fillRect(0, ly * s, c.width, config.etiquetaCm * s);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.strokeRect(0, 0, c.width, c.height);
    $('cnote').textContent = `${A.W} × ${A.L} cm. Amarillo: stickers${prod.kind !== 'dtf' ? '; rosado: línea de corte' : ''}; gris: franja con el nombre del cliente.`;
  }

  function renderTable(ratio) {
    const rows = SIZES.map((S) => {
      const w = ratio >= 1 ? S : S * ratio, h = ratio >= 1 ? S / ratio : S;
      return { w, h, n: count(w, h).length };
    }).filter((r) => r.n > 0 && Math.min(r.w, r.h) >= 0.5);
    const A = area();
    $('ctable').innerHTML = `<thead><tr><th>Medida</th><th>Caben por ${A.unitLabel}</th><th>Valor c/u</th></tr></thead><tbody>${rows.map((r, i) =>
      `<tr data-i="${i}"><td>${cm(r.w)} × ${cm(r.h)} cm</td><td>${r.n.toLocaleString('es-CO')}</td><td>${fmt(basePrice(Math.max(r.w, r.h)) / r.n)}</td></tr>`).join('')}</tbody>`;
    $('ctable').querySelectorAll('tr[data-i]').forEach((tr) => tr.addEventListener('click', () => {
      const r = rows[Number(tr.dataset.i)];
      $('cw').value = Math.round(r.w * 10) / 10; $('ch').value = Math.round(r.h * 10) / 10;
      update();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
  }

  for (const id of ['cw', 'ch', 'cgap', 'coff', 'cqty', 'cshape']) $(id).addEventListener('input', update);
  $('ccopy').addEventListener('click', async () => {
    if (!quoteText) return;
    try { await navigator.clipboard.writeText(quoteText); $('ccopied').textContent = 'Copiado. Pégalo en WhatsApp.'; }
    catch { $('ccopied').textContent = quoteText; }
  });
  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(update, 200); });

  const boot = (c) => {
    config = c;
    products = [
      ...c.estilos.map((e) => ({ kind: 'dtf', id: e.id, name: e.nombre })),
      ...c.vinilo.variantes.map((v) => ({ kind: 'vinilo', id: v.id, name: v.nombre, v }))
    ];
    $('coff').min = c.vinilo.margenCorteMinCm * 10; $('coff').max = c.vinilo.margenCorteMaxCm * 10; $('coff').value = c.vinilo.margenCorteCm * 10;
    setProduct(products.find((p) => p.kind === 'vinilo') || products[0]);
  };
  if (window.CALC_CONFIG) boot(window.CALC_CONFIG);
  else fetch('/api/config').then((r) => r.json()).then(boot);
})();
