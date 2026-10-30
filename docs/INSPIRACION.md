# Referencias e inspiración

Proyectos y productos parecidos al cotizador, con lo que se puede tomar de cada uno. Revisado en octubre de 2026.

## Repositorios de código abierto

| Proyecto | Qué hace | Qué nos sirve | Ojo |
|---|---|---|---|
| [SVGnest](https://github.com/Jack000/SVGnest) / [Deepnest](https://github.com/deepnest-next/deepnest) | Acomodo de piezas por su **forma real**, no por su caja: polígonos de no ajuste (NFP) más un algoritmo genético; SVGnest corre en el navegador | Juntar más stickers redondos o irregulares en el pliego. Hoy se acomodan por su rectángulo (MaxRects con giro de 90°). | Es pesado: debe correr en un *Web Worker* y con tiempo límite. deepnest-next es el fork activo. |
| [Clipper2](https://angusj.com/clipper2/Docs/Overview.htm) ([clipper2-ts](https://github.com/countertype/clipper2-ts), clipper2-wasm) | Recorte y **desplazamiento (offset) exacto de polígonos**, con uniones redondeadas | Margen de corte vectorial exacto, y unir o restar contornos (piezas que se tocan, sangrado de rectángulos) | Licencia BSL-1.0, permisiva |
| [Potrace en JS](https://github.com/casperlamboo/potrace) ([potrace-js](https://www.npmjs.com/package/potrace-js)) | Convierte un mapa de bits en **curvas Bézier suaves** | Línea de corte con curvas en vez de muchos tramos rectos: menos nodos y corte más suave en la plotter (lo pidió el operador) | Opción alternativa: ajustar Bézier (método de Schneider) sobre el contorno actual |
| [@imgly/background-removal](https://img.ly/blog/announcing-imgly-background-removal/) | Quita el fondo con **IA** en el navegador (modelo ONNX con WASM) | Fotos y fondos complejos (cuaderno, fotos de personas), donde el quitado por color falla | **Licencia AGPL-3.0**: obligaría a publicar el código de la web. Además el modelo pesa decenas de MB, malo para celulares con 3G. Si se usa, que sea un botón opcional «Quitar fondo con IA». |
| [Sticker-Factory](https://github.com/Dev-2A/Sticker-Factory/releases) | Arma pliegos A4 de stickers en PDF a partir de imágenes, con cuadrícula, márgenes, modo de relleno y etiquetas | Confirma el enfoque de llenar el pliego y poner etiquetas | Solo hace cuadrícula; no genera contorno de corte |
| [Fabric.js](https://github.com/fabricjs/fabric.js) | Lienzo editable (mover, rotar, textos) | Solo si algún día se quiere un editor libre de diseño, con textos y varias capas | No trae exportación lista para imprenta; no hace falta por ahora |

## Proyectos en GitHub parecidos a este

Casi todos son proyectos pequeños: 0–1 estrellas y pocos commits. Sirven como referencia de ideas, no como base para copiar.

| Repositorio | Qué hace | Lo más útil para nosotros | Licencia |
|---|---|---|---|
| [Novagenlabs/cutline-studio](https://github.com/Novagenlabs/cutline-studio) | Genera líneas de corte como lo haría un operador en Illustrator. Exporta PDF con spot, SVG y DXF. | Mismo enfoque que el nuestro (distancia euclidiana, contorno, RDP, PDF con `/Separation` de 0,25 pt y sobreimpresión). Añade **radio mínimo de esquina de 1 mm** (cierre morfológico), **borrado de islas menores de 1 mm²** y ajuste de curvas. Descartó potrace e imgly por sus licencias GPL y AGPL. | No visible |
| [Principle-hl/StickerMaker](https://github.com/Principle-hl/StickerMaker) | Convierte un logo en sticker listo para imprimir, con contorno en mm, sangrado y perfiles para RasterLink y Onyx. | **Comprobación de corte**: piezas de menos de 3 mm, cuellos de menos de 2 mm y radio mínimo. **«Unir huecos»**: una sola línea envuelve elementos cercanos. **Curvas de Schneider** con tolerancia de 0,05 mm (unas 10 veces menos nodos). Trabajo en *Web Workers*. | MIT |
| [azdrugdoc-prog/stickonfig](https://github.com/azdrugdoc-prog/stickonfig) | Configurador de stickers para imprentas: quitar fondo, contorno, prueba y PDF CutContour. | Perímetro **Ajustado / Normal / Amplio**, más fácil que pedir milímetros. Pincel **Borrar / Restaurar**. Confirmación por baja resolución. Offsets con Clipper2. | MIT |
| [Madhava1104/stickerpro](https://github.com/Madhava1104/stickerpro) | Simulador de pliego, optimizador de acomodo y estimador de costos. | **Metros de corte y tiempo de cuchilla** según el perímetro de cada forma, para cobrar el corte. Capas `KissCut` y `CutContour` separadas. **Teselado hexagonal** para círculos y guillotina en 3 zonas. Costo con margen. | MIT |
| [anirudhatalmale6-alt/gang-sheet-builder-demo](https://github.com/anirudhatalmale6-alt/gang-sheet-builder-demo) | Demostración de constructor DTF con precio en vivo por largo. | Preflight: superposición, **margen de seguridad** y DPI en rojo por debajo de 150. «Ajustar el rollo al arte». | No visible |
| [brunothals/dtf-gang-sheet](https://github.com/brunothals/dtf-gang-sheet) | DTF UV en el navegador (portugués), con MaxRects. | **«Agrupar por arte»**: copias del mismo diseño juntas, con separación para tijera. Recorte por alfa con sensibilidad ajustable. | No visible |
| [orhunakkan/tif-creator](https://github.com/orhunakkan/tif-creator) | TIFF de DTF con canal **Spot_White** (255 − opacidad). | Varias pruebas de MaxRects, quedándose con el rollo más corto (igual que hacemos). Las piezas movidas a mano quedan fijas. Rollo de 22″, casi nuestros 58 cm. | MIT |

Otros: [stickerum/contourer](https://github.com/stickerum/contourer), [fracalo/svg-contour](https://github.com/fracalo/svg-contour), [soimy/maxrects-packer](https://github.com/soimy/maxrects-packer).

### Qué ya tenemos frente a ellos
- **Ya está:**
  - contorno por distancia exacta con marching squares;
  - PDF con spot CutContour, sobreimpresión y capa de marcas;
  - SVG en mm;
  - MaxRects con varios órdenes;
  - quitar restos sueltos;
  - avisos de DPI y de fondo;
  - precio en vivo;
  - montaje protegido.
- **Nos falta, en orden de valor:**
  1. **Comprobación de corte** antes de enviar: partes de menos de 3 mm y cuellos de menos de 2 mm, que la cuchilla no puede cortar bien.
  2. **Radio mínimo de esquina** (≈1 mm) en la línea de corte, para que la cuchilla de semicorte gire limpio.
  3. **Curvas Bézier** (ajuste de Schneider) en vez de tramos rectos.
  4. **Metros de corte** medidos por pedido, para el panel y para un posible recargo por complejidad.
  5. **«Agrupar por arte»** en DTF, para recortar con tijera más rápido.
  6. **Teselado hexagonal** para stickers redondos en el pliego (más piezas por pliego).

## Productos comerciales (ideas de experiencia de uso)

- **Constructores de gang sheet DTF** ([Drip Apps](https://thedripapps.freshdesk.com/support/solutions/articles/157000311211-builder-settings-standalone-), [Supacolor](https://supacolor.com/blogs/supablog/how-to-use-the-background-removal-tool-in-supacolors-gang-sheet-builder), [t-shirt.ca](https://t-shirt.ca/dtf-knowledge-hub/gang-sheet-builder-software-guide/), [PrintXpand](https://www.printxpand.com/dtf-gangsheet-builder/), [Gangify](https://apps.shopify.com/gangify-1)):
  - aviso de fondo al subir **(ya está)**;
  - calidad por imagen con colores, a 300 ppp a la medida real **(ya está)**;
  - el armado automático se ajusta solo para que todo quepa **(ya está: botón «Usar X cm»)**;
  - **limpiador de semitransparencias o halftone** en los bordes (imágenes de IA o agrandadas). Hoy solo se borran los píxeles casi transparentes al exportar. Pendiente: un botón «Limpiar bordes».
  - **ampliador (upscaler)** para imágenes de baja resolución. Pendiente; es pesado.
- **Tiendas de stickers** (Sticker Mule, StickerApp, StickerGiant):
  - precio por unidad junto al total **(ya está)**;
  - prueba digital que el cliente aprueba antes de imprimir;
  - plazo y garantía de reimpresión visibles. Pendiente: depende de los datos comerciales.
- **Printu** ([Colombia](https://www.enter.co/?p=396596)): envío nacional y **plantillas descargables** para preparar archivos. Idea: plantilla PNG/PDF con la zona segura y las medidas de los stickers.

## Prioridades sugeridas

1. **Línea de corte con curvas Bézier** (Potrace o ajuste propio). Mejora directa en la plotter.
2. **Sangrado de rectángulos** con Clipper2: cada pieza se dibuja 1–2 mm más grande, recortada a su celda, para que el corte compartido no deje filo blanco.
3. **Botón «Limpiar bordes»** para semitransparencias.
4. **Acomodo por forma real** en un *Web Worker* (SVGnest) como modo opcional «Aprovechar mejor el pliego».
5. **Quitar fondo con IA** opcional, solo si se acepta la AGPL o se usa un servicio aparte.
