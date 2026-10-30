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
