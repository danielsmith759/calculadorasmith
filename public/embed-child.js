// Modo "incrustado": cuando la página va dentro de la web del negocio (?embed=1) se oculta el logo,
// los enlaces internos conservan el modo y se avisa a la página de afuera el alto real para que no haya barra doble.
(function () {
  var q = new URLSearchParams(location.search);
  if (q.get('embed') !== '1') return;
  document.documentElement.classList.add('embed');
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('a[data-int]').forEach(function (a) { a.href += (a.href.indexOf('?') < 0 ? '?' : '&') + 'embed=1'; });
    if (window.parent === window || !window.ResizeObserver) return;
    var last = 0;
    var send = function () {
      // Alto del contenido (no del iframe), para que también se encoja al cerrar secciones.
      var h = Math.ceil(document.body.getBoundingClientRect().height + parseFloat(getComputedStyle(document.body).marginTop) + parseFloat(getComputedStyle(document.body).marginBottom));
      if (h !== last) { last = h; window.parent.postMessage({ type: 'smith-alto', alto: h }, (location.ancestorOrigins && location.ancestorOrigins[0]) || '*'); }
    };
    new ResizeObserver(send).observe(document.body);
    send();
  });
})();
