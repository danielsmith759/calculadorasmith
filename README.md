# calculadorasmith

Cotizador y recepción de archivos para **DTF UV** (Smith Impresores).

## Cómo funciona
1. El cliente elige el estilo (Premium o Relief 2.5D) y sube una o varias imágenes; les quita el fondo de color (sin servicios externos ni costo) y define medida y cantidad de cada una.
2. El sistema acomoda todas las piezas solas (con rotación de 90° si ahorra largo) en el ancho útil de 58 cm y mide el **largo total del montaje**.
3. Montaje siempre de 58 cm de ancho, **mínimo 58 × 15 cm** (sin importar el tamaño de las imágenes) y **máximo 1 m** por pedido en línea; más metros se manejan aparte. Precio: precio fijo por rango de largo (un montaje de exactamente 1 m se cobra a precio por metro). El espacio vacío del montaje se cobra igual y se le avisa al cliente. IVA no incluido.
4. El cliente debe aceptar las aclaraciones (una casilla) para poder enviar. El servidor valida el montaje, **recalcula el precio** y arma un único PNG transparente de 58 cm × largo (300 DPI; se reduce solo si el montaje es muy largo para no agotar memoria).
5. Solo el equipo entra a `/admin.html` (con clave) para ver pedidos y descargar el montaje listo para imprimir. Los archivos no son públicos.
6. Cada montaje lleva al final una franja de 0,8 cm con el nombre del cliente y la fecha (`etiquetaCm` en `config.json`), para identificar el trabajo al imprimir. Como el servidor puede ser temporal, descarga el PNG y guárdalo en tu unidad; la carpeta `data/` se puede vaciar.

## Vinilo con corte
- El cliente elige **Vinilo con corte** y el tipo: **Vinilo** (ecosolvente, Epson SureColor · Onyx, $50.000) o **Vinilo UV** a color (Mimaki UJV100-160 · RasterLink, $60.000), ambos en pliego de 95 × 95 cm. No se ofrecen blanco ni brillo; el código sigue soportando esas capas (`capas: ["blanco"]`, `["brillo"]`, área `areaBlanco`) si se agrega una variante. **Se cobra el pliego completo**, se llene o no. Por ahora solo **semicorte**. Las máquinas (`maquina`) son internas: no se envían al navegador.
- Área de impresión: **95 × 95 cm** (`areaColor`).
- Separación mínima **4 mm** entre cortes; los diseños **rectangulares** (llenan su recuadro) llevan corte recto justo en el borde (sin margen) y van **unidos**; las líneas compartidas se unen en una sola para que la plotter pase una vez.
- **Vista del montaje**: grande y nítida, con botón "Ver en grande" (pantalla completa con acercar). En vinilo se dibuja el pliego completo con el espacio libre marcado y una barra de uso.
- **¿Cuántos caben?**: para la imagen seleccionada, tabla de medidas con la cantidad que cabe en el pliego (o en 1 m de DTF) y el valor por unidad; al tocar una medida, o con "Llenar el espacio libre", se calcula la cantidad exacta que cabe junto con las demás imágenes (búsqueda binaria con el acomodo real). Vinilo admite hasta `vinilo.maxPiezas` piezas.
- **Calculadora de stickers** (`/stickers.html`, enlazada desde el panel): pública (la usa el equipo y se puede dar a clientes). Sin subir imágenes: producto, medida, corte, separación y cantidad → cuántos caben por pliego o por metro, valor por unidad, pliegos o largo de montaje para una cantidad, vista del acomodo, tabla de medidas y texto para copiar a WhatsApp. Usa `Pricing.fitLayout` (compartido con el cotizador).
- **Forma del sticker** (en cada diseño): silueta, círculo, cuadro redondeado o rectángulo, con color de fondo y espacio alrededor del logo. La forma se dibuja en la imagen, así el corte, el blanco y el empaquetado la siguen solos; el rectángulo va unido con corte recto compartido.
- **Piezas pequeñas** (lado mayor < 3 cm, `piezaPequenaCm`): si el montaje tiene alguna, todo el pliego pasa a `precioPequeno` (Vinilo $80.000, Vinilo UV $90.000). El corte no tiene otro cobro adicional.
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

## Línea de corte (vinilo)

- El contorno sigue el borde del diseño a la distancia exacta del borde blanco, con precisión subpíxel. Se exporta como **curvas** en el PDF (spot `CutContour`) y en el SVG, con menos nodos y un corte más fluido.
- `vinilo.corte.radioMinimoCm` (0,1): radio mínimo de las esquinas interiores, para que la cuchilla gire limpio. Además une huecos de menos de 2 mm entre partes.
- Revisión del corte: el cliente ve un aviso y el panel marca la pieza si hay partes de menos de `anchoMinimoCm` (2 mm) o recortes de menos de `tamanoMinimoCm` (4 mm, borde incluido), como puntos sueltos. El panel muestra también los **metros de corte** de cada pedido.

## Datos comerciales y de contacto (config.json)

Se muestran solo los campos que llenes; vacíos no aparecen.

- `contacto`: `negocio`, `horario`, `correo`, `direccion` (pie de página) y `whatsapp` (o la variable `WHATSAPP` en Render).
- `comercial`: `plazo` (tiempo de producción), `pago` (formas de pago), `factura`, `envio` y `respuesta` (p. ej. "en menos de 2 horas hábiles"). Aparecen como "Condiciones del pedido" antes de los datos del cliente y en la confirmación.
- `ivaPct`: porcentaje de IVA para mostrar el total con IVA (19). El precio cobrado sigue siendo sin IVA.

El cliente puede pedir factura a nombre de una empresa (razón social, NIT, correo); el panel lo muestra en el pedido. Tras enviar puede guardar o imprimir la cotización en PDF.

## Ponerlo en tu web y que los clientes lleguen fácil

Reemplaza `TU-APP` por la dirección donde publiques la app (por ejemplo `https://cotizador.tudominio.com`).

| Qué quieres | Cómo |
|---|---|
| **Botón o enlace** en tu web, redes, WhatsApp, Google Business | `https://TU-APP/` (cotizador), `https://TU-APP/?producto=vinilo` (abre en vinilo), `https://TU-APP/stickers.html` (calculadora de stickers) |
| **Incrustar** el cotizador en una página de tu web | Pega una línea donde lo quieras: `<script src="https://TU-APP/embed.js"></script>` |
| Incrustar **abierto en vinilo** | `<script src="https://TU-APP/embed.js" data-producto="vinilo"></script>` |
| Incrustar la **calculadora de stickers** | `<script src="https://TU-APP/embed.js" data-herramienta="stickers"></script>` |
| **Botón flotante** "Cotiza aquí" en todas las páginas | `<script src="https://TU-APP/embed.js" data-modo="boton" data-texto="Cotiza aquí"></script>` (opcional `data-color="#FFD700"`) |
| **Instalar en el celular** como una app | Desde el navegador: menú → "Añadir a pantalla de inicio" (ya trae ícono y nombre) |

Para que funcione la incrustación hay que autorizar el dominio de tu web en el servidor (variable de entorno):

- `EMBED_ORIGINS` = `https://tuweb.com,https://www.tuweb.com` (acepta `https://*.tuweb.com`). Sin esto el navegador bloquea el iframe. El panel `/admin.html` y la API nunca se pueden incrustar.
- `WHATSAPP` = número con indicativo de país, sin signos, por ejemplo `573001234567`. Al terminar el pedido aparece el botón "Escribirnos por WhatsApp con mi referencia" (el mensaje se edita en `contacto.mensaje` de `config.json`).

Notas: en WordPress usa el bloque "HTML personalizado" (o un plugin de código en el encabezado para el botón flotante); en Wix "Insertar código → HTML"; en Shopify, una sección con HTML personalizado. El modo incrustado oculta el logo, ajusta solo el alto de la página (crece y se encoge) y amplía el montaje en el mismo lugar, sin dejarlo descargar. En el modo botón, cerrar la ventana no borra el trabajo del cliente.

### Pruebas

`npm test` revisa precios, acomodo de piezas (sin salirse ni superponerse) y cortes. Conviene correrlo antes de subir cambios a precios o reglas.
