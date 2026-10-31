// Arma un HTML autónomo del cotizador para verlo sin servidor (los pedidos no se envían).
const fs = require('fs'), path = require('path');
// Uso: node scripts/demo-cotizador.js [carpeta del proyecto] [archivo de salida]
const root = process.argv[2] || path.join(__dirname, '..');
const out = process.argv[3] || path.join(root, 'entregas/cotizador-demo.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
const r = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const config = JSON.parse(r('config.json'));
config.vinilo.variantes = config.vinilo.variantes.map(({ maquina, ...v }) => v);
delete config.contacto; delete config.vinilo.spots;
const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'public/logo.png')).toString('base64');
const shim = `<script>
(function(){
  const CONFIG = ${JSON.stringify(config)};
  const real = window.fetch;
  const json = (o) => Promise.resolve(new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  window.fetch = function (url, opts) {
    if (String(url).endsWith('/api/config')) return json(CONFIG);
    if (String(url).endsWith('/api/orders')) {
      const price = Number((document.getElementById('price').textContent || '').replace(/[^0-9]/g, '')) || 0;
      return json({ ok: true, ref: 'DEMO (no se envió)', price });
    }
    return real.apply(this, arguments);
  };
  window.fetch.isDemo = true; // el cotizador envía con fetch en la demostración
})();
</script>`;
const banner = '<div style="background:#fff3cd;color:#664d03;padding:10px 16px;text-align:center;font:600 14px system-ui">Versión de demostración: funciona todo menos el envío; los pedidos no llegan al taller.</div>';
let html = r('public/index.html')
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${r('public/style.css')}\n</style>`)
  .replace(/(src|href)="logo\.png"/g, `$1="${logo}"`)
  .replace('<script src="pricing.js"></script>', () => shim + `\n<script>\n${r('public/pricing.js')}\n</script>`)
  .replace('<script src="contour.js"></script>', () => `<script>\n${r('public/contour.js')}\n</script>`)
  .replace('<script type="module" src="app.js"></script>', () => `<script type="module">\n${r('public/app.js')}\n</script>`)
  .replace(/<body([^>]*)>/, `<body$1>\n${banner}`);
html = html.replace(/url\((['"]?)logo\.png\1\)/g, `url(${logo})`).replace('href="stickers.html" data-int', 'href="https://claude.ai/artifact/81SPX4k5AR6gU2yMAhfVVk" target="_blank" rel="noopener"');
fs.writeFileSync(out, html);
console.log('ok', (html.length / 1024).toFixed(0) + ' KB');

// Versión para la página de vista previa: sin envoltura html/head/body, sin logo ni marca.
if (process.argv[4]) {
  let a = html
    .replace(/<!DOCTYPE html>\s*<html[^>]*>\s*<head>[\s\S]*?<title>[^<]*<\/title>/i, '<title>Cotizador DTF UV y Vinilo</title>')
    .replace(/<meta (name|property)="(description|og:[a-z]+|theme-color)"[^>]*>\s*|<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\s*|<script src="embed-child.js"><\/script>\s*/g, '')
    .replace(/<\/head>\s*<body[^>]*>/i, '')
    .replace(/<\/body>\s*<\/html>\s*$/i, '')
    .replace(/<img[^>]*class="logo"[^>]*>/, '');
  fs.writeFileSync(process.argv[4], a);
  console.log('preview', (a.length / 1024).toFixed(0) + ' KB', /<head>|<body/i.test(a) ? 'WRAPPERS LEFT' : 'clean', /Smith/i.test(a) ? 'BRAND LEFT' : 'no brand');
}
