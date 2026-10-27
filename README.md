# calculadorasmith

Cotizador y recepción de archivos para **DTF UV** (Smith Impresores).

## Cómo funciona
1. El cliente elige el estilo (Premium o Relief 2.5D) y sube una o varias imágenes; les quita el fondo de color (sin servicios externos ni costo) y define medida y cantidad de cada una.
2. El sistema acomoda todas las piezas solas (con rotación de 90° si ahorra largo) en el ancho útil de 58 cm y mide el **largo total del montaje**.
3. Montaje siempre de 58 cm de ancho, **mínimo 58 × 15 cm** (sin importar el tamaño de las imágenes) y **máximo 1 m** por pedido en línea; más metros se manejan aparte. Precio: precio fijo por rango de largo (un montaje de exactamente 1 m se cobra a precio por metro). El espacio vacío del montaje se cobra igual y se le avisa al cliente. IVA no incluido.
4. El cliente debe marcar las 6 aclaraciones para poder enviar. El servidor valida el montaje, **recalcula el precio** y arma un único PNG transparente de 58 cm × largo (300 DPI; se reduce solo si el montaje es muy largo para no agotar memoria).
5. Solo el equipo entra a `/admin.html` (con clave) para ver pedidos y descargar el montaje listo para imprimir. Los archivos no son públicos.
6. Cada montaje lleva al final una franja de 0,8 cm con el nombre del cliente y la fecha (`etiquetaCm` en `config.json`), para identificar el trabajo al imprimir. Como el servidor puede ser temporal, descarga el PNG y guárdalo en tu unidad; la carpeta `data/` se puede vaciar.

## Vinilo con corte
- El cliente elige **Vinilo con corte** y el tipo: ecosolvente con semicorte (Epson SureColor · Onyx, $50.000) o UV (Mimaki UJV100-160 · RasterLink, $45.000) con blanco o brillo ($68.000) o blanco + brillo ($92.000). **Se cobra el pliego completo** (95 × 95 cm a color/brillo, 145 × 55 cm con base blanca), se llene o no. Por ahora solo **semicorte** (el corte total está desactivado).
- Área de impresión: **95 × 95 cm** a color o con brillo; **145 × 55 cm** (ancho × largo) con base blanca (`areaColor` / `areaBlanco`).
- Separación mínima **4 mm** entre cortes; los diseños **rectangulares** (llenan su recuadro) llevan corte recto justo en el borde (sin margen) y van **unidos**; las líneas compartidas se unen en una sola para que la plotter pase una vez.
- **Forma del sticker** (en cada diseño): silueta, círculo, cuadro redondeado o rectángulo, con color de fondo y espacio alrededor del logo. La forma se dibuja en la imagen, así el corte, el blanco y el empaquetado la siguen solos; el rectángulo va unido con corte recto compartido.
- **Piezas pequeñas** (lado mayor < 3 cm, `piezaPequenaCm`): si el montaje tiene alguna, todo el pliego pasa a `precioPequeno` (ecosolvente $80.000, UV $90.000, UV + blanco o brillo $98.000, UV + blanco + brillo $122.000). El corte no tiene otro cobro adicional.
- La **guía de corte** se calcula sola desde la silueta de cada diseño (`public/contour.js`) con el margen elegido (1–5 mm). El cliente la ve en rosado punteado.
- El taller descarga:
  - **PDF de producción** (página = ancho útil + `margenCm` a cada lado con 4 **marcas de registro** negras en las esquinas, en su propia capa `Marcas` (`vinilo.marcas`)): imagen, capa `White` (un poco reducida, `blancoReduccionMm`), capa `Gloss` y línea `CutContour`, como colores directos con sobreimpresión. Nombres configurables en `vinilo.spots` (verificar los que espera RasterLink/Onyx).
  - **SVG de corte** con las mismas líneas y posiciones, para importar en SignMaster (SkyCut). Trae las marcas de registro en el grupo `Marcas` (mismo lugar que en el PDF) para alinear la plotter.

## Uso
```
npm install
# Windows (cmd):  set ADMIN_USERS=usuario1:clave1,usuario2:clave2&& npm start
# Mac/Linux:      ADMIN_USERS="usuario1:clave1,usuario2:clave2" npm start
```
- Usuarios del panel `/admin.html`: variable `ADMIN_USERS` (recomendado) o, solo en local, un `usuarios.json` creado con `node scripts/usuario.js <usuario> <clave>`. Ese archivo **no se sube** al repositorio.
- `config.json`: tablas de precios (`rangos`, `tramos`), estilos, aclaraciones, `anchoRolloCm`, `separacionCm` (mínimo, 5 mm) y `separacionMaxCm`, `etiquetaCm`, `maxPiezas`, `dpi`. `public/pricing.js` calcula el precio en el navegador y en el servidor.
- Datos en `data/` (pedidos y PNGs); cambia la ruta con `DATA_DIR`.
- Límites: 30 imágenes y 300 piezas por pedido, 25 MB por imagen. El montaje se compone de a uno (cola) y con tope de 60 Mpx (`MAX_MONTAGE_PIXELS`): 1 m sale a ~260 ppp, montajes cortos a 300 ppp. Pico medido: ~400 MB con 3 pedidos de 1 m simultáneos.
- Quitar fondo: por color (clic para elegir el color, tolerancia, opción "en toda la imagen", bordes suaves sin halo). No usa IA ni servicios externos, así que es gratis y sin licencias de terceros. Funciona mejor con logos y diseños de fondo liso; para fotos, el cliente debe enviar la imagen ya sin fondo (PNG transparente).

## Publicar para pruebas (Render, plan gratis)
1. En https://render.com crea una cuenta e inicia sesión con GitHub.
2. **New → Blueprint** (o **Web Service**), elige este repositorio y la rama `claude/dtf-uv-web-app-epmk4j`. Render lee `render.yaml`.
3. Cuando Render pida `ADMIN_USERS`, escribe `usuario1:clave1,usuario2:clave2` (claves nuevas y largas).
4. Espera el despliegue y abre la URL `https://....onrender.com`. El panel está en `/admin.html`.
- En el plan gratis el servicio se "duerme" tras unos minutos sin uso (la primera visita tarda ~1 min) y los pedidos se pierden al reiniciar: descarga cada PNG apenas llegue.
- Para clientes reales, usa un plan con disco persistente (variable `DATA_DIR` apuntando al disco).
