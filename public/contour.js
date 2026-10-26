// Guía de corte automática (navegador y servidor): a partir de la transparencia de un diseño
// genera el contorno exterior con un margen (offset) alrededor, en cm.
(function (root) {
  // Distancia euclidiana exacta al cuadrado (Felzenszwalb) sobre una fila/columna.
  function edt1d(f, n, d, v, z) {
    let k = 0;
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s;
      while (true) {
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        if (s > z[k]) break;
        k--;
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  }

  // Distancia al cuadrado de cada píxel al píxel "activo" (mask=1) más cercano.
  function distanceSq(mask, w, h) {
    const INF = 1e20;
    const out = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = mask[i] ? 0 : INF;
    const n = Math.max(w, h);
    const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = out[y * w + x];
      edt1d(f, h, d, v, z);
      for (let y = 0; y < h; y++) out[y * w + x] = d[y];
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) f[x] = out[y * w + x];
      edt1d(f, w, d, v, z);
      for (let x = 0; x < w; x++) out[y * w + x] = d[x];
    }
    return out;
  }

  // Bordes entre píxeles llenos y vacíos encadenados en lazos (el relleno queda a la derecha).
  function traceLoops(m, w, h) {
    const W1 = w + 1;
    const out = new Map(); // vértice -> lista de bordes salientes [destino, dx, dy]
    const add = (x0, y0, x1, y1) => {
      const k = y0 * W1 + x0;
      if (!out.has(k)) out.set(k, []);
      out.get(k).push([y1 * W1 + x1, x1 - x0, y1 - y0]);
    };
    const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? m[y * w + x] : 0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!m[y * w + x]) continue;
        if (!at(x, y - 1)) add(x, y, x + 1, y);
        if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
        if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
        if (!at(x - 1, y)) add(x, y + 1, x, y);
      }
    }
    const loops = [];
    for (const [start, list] of out) {
      while (list.length) {
        const pts = [];
        let k = start;
        let [next, dx, dy] = list.pop();
        pts.push([k % W1, Math.floor(k / W1)]);
        while (next !== start) {
          k = next;
          pts.push([k % W1, Math.floor(k / W1)]);
          const cand = out.get(k);
          // En esquinas diagonales se gira a la derecha para no unir piezas que solo se tocan en un punto.
          let idx = 0;
          if (cand.length > 1) idx = cand.findIndex((c) => dx * c[2] - dy * c[1] > 0);
          if (idx < 0) idx = 0;
          [next, dx, dy] = cand.splice(idx, 1)[0];
        }
        loops.push(pts);
      }
    }
    return loops;
  }

  const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; };

  // Simplificación Ramer-Douglas-Peucker de un lazo cerrado.
  function simplify(pts, eps) {
    const rdp = (s, e, keep) => {
      let max = 0, idx = -1;
      const [x1, y1] = pts[s], [x2, y2] = pts[e];
      const L = Math.hypot(x2 - x1, y2 - y1) || 1;
      for (let i = s + 1; i < e; i++) {
        const dd = Math.abs((y2 - y1) * pts[i][0] - (x2 - x1) * pts[i][1] + x2 * y1 - y2 * x1) / L;
        if (dd > max) { max = dd; idx = i; }
      }
      if (max > eps) { keep[idx] = 1; rdp(s, idx, keep); rdp(idx, e, keep); }
    };
    const n = pts.length;
    if (n < 4) return pts;
    const mid = Math.floor(n / 2);
    const keep = new Uint8Array(n + 1);
    keep[0] = keep[mid] = 1;
    const ring = pts.concat([pts[0]]);
    const savePts = pts; pts = ring;
    rdp(0, mid, keep); rdp(mid, n, keep);
    pts = savePts;
    return pts.filter((_, i) => keep[i]);
  }

  // Suavizado Chaikin (las esquinas en escalera quedan curvas).
  function smooth(p, iter) {
    for (let t = 0; t < iter; t++) {
      const out = [];
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
      }
      p = out;
    }
    return p;
  }

  const inside = (pt, poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };

  // alpha: Uint8 (w*h) del diseño a pxPerCm píxeles por cm. Devuelve polígonos en cm,
  // con origen en la esquina superior izquierda del diseño (pueden salir a negativo por el margen).
  function cutContours(alpha, w, h, pxPerCm, offsetCm, threshold = 128) {
    const r = offsetCm * pxPerCm;
    const pad = Math.ceil(r) + 2;
    const W = w + 2 * pad, H = h + 2 * pad;
    const mask = new Uint8Array(W * H);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha[y * w + x] >= threshold) mask[(y + pad) * W + x + pad] = 1;
    const dist = distanceSq(mask, W, H);
    const grown = new Uint8Array(W * H);
    const r2 = r * r;
    for (let i = 0; i < W * H; i++) grown[i] = dist[i] <= r2 ? 1 : 0;
    let loops = traceLoops(grown, W, H).filter((l) => area(l) > 0); // solo contornos exteriores
    loops = loops.filter((l, i) => !loops.some((o, j) => j !== i && area(o) > area(l) && inside(l[0], o)));
    return loops
      .filter((l) => area(l) > 4)
      .map((l) => simplify(smooth(l, 2), 0.35).map(([x, y]) => [(x - pad) / pxPerCm, (y - pad) / pxPerCm]));
  }

  // Resolución recomendada para calcular el contorno de un diseño de wCm x hCm.
  const contourPxPerCm = (wCm, hCm) => Math.min(40, 900 / Math.max(wCm, hCm));

  // Un diseño es "rectangular" si su parte visible llena casi todo su recuadro: lleva corte recto
  // y puede ir unido a otros rectangulares compartiendo la línea de corte.
  function coverage(alpha, w, h, threshold = 128) {
    let n = 0;
    for (let i = 0; i < w * h; i++) if (alpha[i] >= threshold) n++;
    return n / (w * h);
  }
  const rectContour = (wCm, hCm, off) => [[[-off, -off], [wCm + off, -off], [wCm + off, hCm + off], [-off, hCm + off]]];

  const api = { cutContours, contourPxPerCm, distanceSq, coverage, rectContour };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Contour = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
