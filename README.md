# calculadorasmith

Cotizador y recepción de archivos para **DTF UV** (Smith Impresores).

## Cómo funciona
1. El cliente elige el estilo (Normal, Premium o Relief 2.5D) y sube una o varias imágenes; les quita el fondo (IA en el navegador o por color) y define medida y cantidad de cada una.
2. El sistema acomoda todas las piezas solas (con rotación de 90° si ahorra largo) en el ancho útil de 58 cm y mide el **largo total del montaje**.
3. Montaje siempre de 58 cm de ancho, **mínimo 58 × 15 cm** (sin importar el tamaño de las imágenes) y **máximo 1 m** por pedido en línea; más metros se manejan aparte. Precio: precio fijo por rango de largo (un montaje de exactamente 1 m se cobra a precio por metro). El espacio vacío del montaje se cobra igual y se le avisa al cliente. IVA no incluido.
4. El cliente debe marcar las 6 aclaraciones para poder enviar. El servidor valida el montaje, **recalcula el precio** y arma un único PNG transparente de 58 cm × largo (300 DPI; se reduce solo si el montaje es muy largo para no agotar memoria).
5. Solo el equipo entra a `/admin.html` (con clave) para ver pedidos y descargar el montaje listo para imprimir. Los archivos no son públicos.

## Uso
```
npm install
ADMIN_PASSWORD=tu_clave SESSION_SECRET=algo_largo npm start   # http://localhost:3000
```
- `config.json`: tablas de precios (`rangos`, `tramos`), estilos, aclaraciones, `anchoRolloCm`, `separacionCm` (espacio entre piezas), `dpi`. `public/pricing.js` calcula el precio tanto en el navegador como en el servidor.
- Datos en `data/` (pedidos y PNGs); cambia la ruta con `DATA_DIR`. Haz copia de seguridad de esa carpeta.
- Sin `ADMIN_PASSWORD` se genera una clave temporal que se imprime en consola.
- La IA de quitar fondo (`@imgly/background-removal`) se descarga desde un CDN en el navegador del cliente.

`public/calculadora2.html` es la calculadora original por metros.
