// PDF de producción para vinilo: imágenes, capas de blanco/brillo y línea de corte como colores directos (spot).
const zlib = require('zlib');

const PT = 72 / 2.54; // puntos por cm

// Texto para la fuente estándar Helvetica (WinAnsi ~ Latin-1 para tildes y ñ).
const pdfText = (s) => '(' + [...s].map((ch) => {
  const c = ch.charCodeAt(0);
  if (ch === '(' || ch === ')' || ch === '\\') return '\\' + ch;
  if (c < 32 || c > 255) return '?';
  return c > 126 ? '\\' + c.toString(8).padStart(3, '0') : ch;
}).join('') + ')';

const num = (n) => (Math.round(n * 1000) / 1000).toString();

// Matriz que lleva el cuadrado unitario de la imagen a su caja en la página (rot = 90° horario).
function placement(x, y, w, h, rot, pageH) {
  if (!rot) return [w * PT, 0, 0, h * PT, x * PT, (pageH - y - h) * PT];
  const yb = pageH - y - w; // la caja rotada mide h de ancho y w de alto
  return [0, -w * PT, h * PT, 0, x * PT, (yb + w) * PT];
}

// Punto del diseño (cm, origen arriba-izquierda) a la página.
function mapPoint(px, py, x, y, w, h, rot) {
  return rot ? [x + (h - py), y + px] : [x + px, y + py];
}

/**
 * opts: {
 *   pageW, pageH (cm),
 *   images: [{ width, height, rgba (Buffer), white (Uint8 mask|null), gloss (Uint8 mask|null) }],
 *   pieces: [{ img, x, y, w, h, rot }]  (cm, caja de la imagen sin margen de corte),
 *   cuts: [[[x,y], ...]]  (cm, en coordenadas de página),
 *   label: { text, x, y, size } | null (cm / pt),
 *   spots: { corte, blanco, brillo }
 * }
 */
function buildPdf(opts) {
  const objs = []; // cada elemento: Buffer del objeto (sin "n 0 obj")
  const ref = (i) => `${i} 0 R`;
  const add = (body) => { objs.push(body); return objs.length; };
  const stream = (dict, data) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`), data, Buffer.from('\nendstream')]);

  const sep = (name, cmyk) => `[/Separation /${name} /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [${cmyk.join(' ')}] /N 1 >>]`;
  const xobjs = [];
  const masks = { white: [], gloss: [] };

  const stencil = (mask, w, h) => {
    const rowBytes = Math.ceil(w / 8);
    const bits = Buffer.alloc(rowBytes * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    return add(stream(`/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ImageMask true /Decode [1 0] /BitsPerComponent 1 /Filter /FlateDecode`, zlib.deflateSync(bits)));
  };

  opts.images.forEach((im, i) => {
    const n = im.width * im.height;
    const rgb = Buffer.alloc(n * 3), a = Buffer.alloc(n);
    for (let p = 0; p < n; p++) {
      rgb[p * 3] = im.rgba[p * 4]; rgb[p * 3 + 1] = im.rgba[p * 4 + 1]; rgb[p * 3 + 2] = im.rgba[p * 4 + 2];
      a[p] = im.rgba[p * 4 + 3];
    }
    const smask = add(stream(`/Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, zlib.deflateSync(a)));
    xobjs[i] = add(stream(`/Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask ${ref(smask)} /Filter /FlateDecode`, zlib.deflateSync(rgb)));
    if (im.white) masks.white[i] = stencil(im.white, im.width, im.height);
    if (im.gloss) masks.gloss[i] = stencil(im.gloss, im.width, im.height);
  });

  const H = opts.pageH;
  const c = [];
  const draw = (name, list, color) => {
    for (const p of opts.pieces) {
      if (!list[p.img]) continue;
      c.push(`q /${color} cs 1 scn /OP gs ${placement(p.x, p.y, p.w, p.h, p.rot, H).map(num).join(' ')} cm /${name}${p.img} Do Q`);
    }
  };
  draw('W', masks.white, 'CSw'); // blanco debajo
  for (const p of opts.pieces) c.push(`q ${placement(p.x, p.y, p.w, p.h, p.rot, H).map(num).join(' ')} cm /I${p.img} Do Q`);
  draw('G', masks.gloss, 'CSg'); // brillo encima
  if (opts.label) {
    c.push(`BT /F1 ${num(opts.label.size)} Tf 0 0 0 1 k ${num(opts.label.x * PT)} ${num((H - opts.label.y) * PT)} Td ${pdfText(opts.label.text)} Tj ET`);
  }
  if (opts.cuts.length) {
    c.push('q /CSc CS 1 SCN /OP gs 0.25 w 1 j');
    for (const poly of opts.cuts) {
      c.push(poly.map(([x, y], i) => `${num(x * PT)} ${num((H - y) * PT)} ${i ? 'l' : 'm'}`).join(' ') + (poly.open ? ' S' : ' h S'));
    }
    c.push('Q');
  }
  const content = add(stream('/Filter /FlateDecode', zlib.deflateSync(Buffer.from(c.join('\n'), 'latin1'))));
  const font = add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));

  const xo = [];
  opts.images.forEach((_, i) => {
    xo.push(`/I${i} ${ref(xobjs[i])}`);
    if (masks.white[i]) xo.push(`/W${i} ${ref(masks.white[i])}`);
    if (masks.gloss[i]) xo.push(`/G${i} ${ref(masks.gloss[i])}`);
  });
  const resources = `<< /XObject << ${xo.join(' ')} >> /Font << /F1 ${ref(font)} >>` +
    ` /ColorSpace << /CSc ${sep(opts.spots.corte, [0, 1, 0, 0])} /CSw ${sep(opts.spots.blanco, [0.25, 0, 0, 0])} /CSg ${sep(opts.spots.brillo, [0, 0, 0.35, 0])} >>` +
    ' /ExtGState << /OP << /Type /ExtGState /OP true /op true /OPM 1 >> >> >>';
  const pagesIdx = objs.length + 2;
  const page = add(Buffer.from(`<< /Type /Page /Parent ${ref(pagesIdx)} /MediaBox [0 0 ${num(opts.pageW * PT)} ${num(H * PT)}] /Resources ${resources} /Contents ${ref(content)} >>`));
  add(Buffer.from(`<< /Type /Pages /Kids [${ref(page)}] /Count 1 >>`));
  const catalog = add(Buffer.from(`<< /Type /Catalog /Pages ${ref(pagesIdx)} >>`));

  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let pos = parts[0].length;
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pos);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]);
    parts.push(b); pos += b.length;
  });
  const xref = ['xref', `0 ${objs.length + 1}`, '0000000000 65535 f ', ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `),
    'trailer', `<< /Size ${objs.length + 1} /Root ${ref(catalog)} >>`, 'startxref', String(pos), '%%EOF'].join('\n');
  parts.push(Buffer.from(xref + '\n'));
  return Buffer.concat(parts);
}

// Archivo SVG solo con las líneas de corte (en mm), mismo tamaño y posición que el PDF.
function buildCutSvg(pageW, pageH, cuts) {
  const mm = (v) => num(v * 10);
  const paths = cuts.map((p) => `<path d="M${p.map(([x, y]) => `${mm(x)} ${mm(y)}`).join(' L')}${p.open ? '' : ' Z'}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${mm(pageW)}mm" height="${mm(pageH)}mm" viewBox="0 0 ${mm(pageW)} ${mm(pageH)}">
<g id="CutContour" fill="none" stroke="#ff00ff" stroke-width="0.25">
${paths}
</g>
</svg>
`;
}

module.exports = { buildPdf, buildCutSvg, mapPoint, PT };
