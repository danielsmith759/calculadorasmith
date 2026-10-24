# calculadorasmith

Cotizador y recepción de archivos para **DTF UV** (Smith Impresores).

## Cómo funciona
1. El cliente sube su imagen, le quita el fondo (IA en el navegador o por color) y el sistema recorta al área real del diseño.
2. Ajusta ancho o alto en cm (la proporción se mantiene) y la cantidad. El precio se calcula por m² usados.
3. Envía el pedido: el servidor guarda un PNG con fondo transparente a 300 DPI al tamaño exacto.
4. Solo el equipo entra a `/admin.html` (con clave) para ver pedidos y descargar el PNG listo para imprimir. Los archivos no son públicos.

## Uso
```
npm install
ADMIN_PASSWORD=tu_clave SESSION_SECRET=algo_largo npm start   # http://localhost:3000
```
- `config.json`: `precioM2`, `precioMinimo`, `anchoRolloCm`, `dpi` (**el precio por m² es un valor de ejemplo, ajústalo**).
- Datos en `data/` (pedidos y PNGs); cambia la ruta con `DATA_DIR`. Haz copia de seguridad de esa carpeta.
- Sin `ADMIN_PASSWORD` se genera una clave temporal que se imprime en consola.
- La IA de quitar fondo (`@imgly/background-removal`) se descarga desde un CDN en el navegador del cliente.

`public/calculadora2.html` es la calculadora original por metros.
