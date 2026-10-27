// Una línea para poner el cotizador o la calculadora en cualquier web (WordPress, Wix, Shopify, HTML):
//   <script src="https://TU-APP/embed.js"></script>                                    (cotizador, incrustado)
//   <script src="https://TU-APP/embed.js" data-herramienta="stickers"></script>        (calculadora de stickers)
//   <script src="https://TU-APP/embed.js" data-producto="vinilo"></script>             (abre en vinilo)
//   <script src="https://TU-APP/embed.js" data-modo="boton" data-texto="Cotiza aquí"></script>   (botón flotante)
// El servidor debe tener EMBED_ORIGINS con el dominio de tu web.
(function () {
  var me = document.currentScript;
  if (!me) return;
  var base = new URL(me.src).origin;
  var tool = me.getAttribute('data-herramienta') === 'stickers' ? 'stickers' : 'cotizador';
  var product = me.getAttribute('data-producto');
  var url = base + (tool === 'stickers' ? '/stickers.html' : '/') + '?embed=1' +
    (product === 'vinilo' || product === 'dtf' ? '&producto=' + product : '');
  var frame = function (style) {
    var f = document.createElement('iframe');
    f.src = url; f.title = tool === 'stickers' ? 'Calculadora de stickers' : 'Cotizador DTF UV y vinilo'; f.loading = 'lazy';
    f.setAttribute('style', 'border:0;width:100%;' + style);
    return f;
  };

  if (me.getAttribute('data-modo') === 'boton') {
    var color = me.getAttribute('data-color') || '#FFD700';
    var btn = document.createElement('button');
    btn.type = 'button'; btn.textContent = me.getAttribute('data-texto') || 'Cotiza aquí';
    btn.setAttribute('style', 'position:fixed;right:16px;bottom:16px;z-index:99998;padding:14px 20px;border:0;border-radius:30px;background:' + color +
      ';color:#000;font:bold 16px Arial,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer');
    var layer = null;
    btn.addEventListener('click', function () {
      if (layer) return;
      layer = document.createElement('div');
      layer.setAttribute('style', 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;flex-direction:column');
      var close = document.createElement('button');
      close.type = 'button'; close.textContent = 'Cerrar ✕';
      close.setAttribute('style', 'align-self:flex-end;margin:10px;padding:10px 16px;border:0;border-radius:6px;background:#fff;font:bold 15px Arial,sans-serif;cursor:pointer');
      var shut = function () { layer.remove(); layer = null; document.body.style.overflow = ''; };
      close.addEventListener('click', shut);
      layer.addEventListener('click', function (e) { if (e.target === layer) shut(); });
      var f = frame('flex:1;max-width:980px;align-self:center;background:#1E1E1E;border-radius:10px 10px 0 0');
      layer.appendChild(close); layer.appendChild(f);
      document.body.appendChild(layer);
      document.body.style.overflow = 'hidden';
    });
    document.body.appendChild(btn);
    return;
  }

  var f = frame('min-height:640px;');
  me.parentNode.insertBefore(f, me.nextSibling);
  window.addEventListener('message', function (e) {
    if (e.origin !== base || e.source !== f.contentWindow || !e.data || e.data.type !== 'smith-alto') return;
    var h = Number(e.data.alto);
    if (h > 300 && h < 20000) f.style.height = h + 'px';
  });
})();
