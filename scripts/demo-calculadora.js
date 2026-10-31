// Arma la calculadora de stickers en una sola página (sin servidor) para publicarla como vista previa.
const fs = require('fs'), path = require('path');
// Uso: node scripts/demo-calculadora.js [carpeta del proyecto] [archivo de salida]
const root = process.argv[2] || path.join(__dirname, '..');
const out = process.argv[3] || path.join(root, 'entregas/calculadora-stickers.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
const r = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const config = JSON.parse(r('config.json'));
config.vinilo.variantes = config.vinilo.variantes.map(({ maquina, ...v }) => v);
delete config.contacto; delete config.vinilo.spots;
let html = r('public/stickers.html')
  .replace(/<!DOCTYPE html>\s*<html[^>]*>\s*<head>[\s\S]*?<title>[^<]*<\/title>/i, () => '<title>Calculadora de stickers</title>')
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${r('public/style.css')}\n</style>`)
  .replace(/<meta (name|property)="(description|og:[a-z:]+|theme-color|twitter:[a-z]+)"[^>]*>\s*|<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\s*|<script src="embed-child.js"><\/script>\s*/g, '')
  .replace(/<\/body>\s*<\/html>\s*$/i, '')
  .replace(/<img[^>]*class="logo"[^>]*>/, '')
  .replace('href="index.html" id="toQuote" data-int', 'href="https://claude.ai/artifact/U2UXEEwMs62vZgCuKMPKH3" target="_blank" rel="noopener"')
  .replace('<script src="pricing.js"></script>', () => `<script>window.CALC_CONFIG = ${JSON.stringify(config)};</script>\n<script>\n${r('public/pricing.js')}\n</script>`)
  .replace('<script src="stickers.js"></script>', () => `<script>\n${r('public/stickers.js')
    .replace(/'Smith Impresores'/g, "'la imprenta'")
    .replace(/\s*if \(\$\('toQuote'\)\)[^\n]*/, '')}\n</script>`);
fs.writeFileSync(out, html);
console.log((html.length / 1024).toFixed(0) + ' KB', /Smith|Epson|Mimaki|maquina/.test(html) ? 'BRAND LEFT' : 'clean');
