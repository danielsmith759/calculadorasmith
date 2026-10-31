# Smith Impresores — cotizador DTF UV y stickers de vinilo

Web en español (Colombia). El cliente sube imágenes, quita el fondo por color, ve el montaje y el precio y envía el pedido. El equipo descarga los archivos de producción en `/admin.html`. Despliegue en Render (`render.yaml`).

## Mapa rápido
- `server.js`: API (`/api/orders`, `/api/admin/*`). Valida el montaje, **recalcula el precio**, genera PNG (DTF) y PDF + SVG de corte (vinilo). Cola de un pedido a la vez (`MAX_WAITING`).
- `lib/pdf.js`: PDF propio (spot `CutContour` con curvas, capa «Marcas», sobreimpresión) y SVG en mm.
- `public/pricing.js`: precios compartidos por navegador y servidor (`quote`, `quoteVinyl`, `isSmall`, `fitLayout`).
- `public/contour.js`: contorno de corte (distancia exacta, marching squares, radio mínimo de esquina, revisión del corte, `bezier`).
- `public/app.js` + `index.html`: cotizador. `public/stickers.*`: calculadora. `public/admin.html`: panel. `embed*.js`: incrustar en otras webs.
- `config.json`: precios, medidas, reglas, contacto y condiciones comerciales (los campos vacíos no se muestran).
- `docs/INSPIRACION.md`: referencias de GitHub y de la web, con lo que ya está hecho y lo pendiente.

## Reglas del negocio (no cambiar sin pedirlo)
- **DTF UV:** rollo de 58 cm, 15–100 cm de largo, precio por rangos y tramos (`config.rangos`/`tramos`), franja de 0,8 cm con el nombre.
- **Vinilo (semicorte):**
  - pliego de 95×95 cm cobrado completo: Vinilo $50.000 y Vinilo UV $60.000;
  - si alguna pieza mide menos de 3 cm medida por su parte sólida, todo el pliego pasa a la tarifa pequeña ($80.000 / $90.000).
- **Montajes:** son del taller. Nunca deben poder descargarse desde la página: marca de agua, lienzo y no imagen, sin clic derecho, no se imprimen.
- **Quitar fondo:** solo por color, sin IA ni servicios externos, por decisión del dueño. Admite hasta 3 colores; el borde se trata con «color a alfa».
- No mostrar máquinas al cliente. IVA no incluido; se muestra el total con IVA (`ivaPct`).

## Comandos
- `npm start`: servidor local (`ADMIN_USERS=usuario:clave`).
- `npm test`: pruebas de precios, acomodo y corte. Rápido, sin navegador.
- `npm run e2e`: navegador real (vinilo, DTF, calculadora, panel), con salida de pocas líneas. `npm run e2e -- --todos` agrega Android, iPhone con límites de Safari y celular lento.
- `npm run demo`: arma las vistas previas en `entregas/` (ignorada por git). Se publican en los artifacts privados:
  - cotizador: https://claude.ai/artifact/U2UXEEwMs62vZgCuKMPKH3
  - calculadora: https://claude.ai/artifact/81SPX4k5AR6gU2yMAhfVVk

## Pendientes (los decide el dueño)
- Llenar en `config.json` los datos comerciales: plazo, pago, envío, factura, dirección y horario. Es lo que más frena las ventas.
- Precios de impresión láser, tesis y álbumes, para la portada con catálogo.
- Si se cobra el corte complejo: ya se miden los metros de corte por pedido (`corteM`).
- Sangrado en piezas rectangulares unidas. Agrupar por arte en DTF. Acomodo hexagonal para stickers redondos.

## Forma de trabajar (para gastar menos tokens)
- **Agentes:** máximo 2 por tarea y solo si el usuario los pide. Usar un modelo económico (Sonnet o Haiku) para clientes simulados o revisiones. Pedir informes de menos de 300 palabras. Nada de olas de 10.
- **Verificar con datos**, no con capturas: `npm test`, `npm run e2e` y comprobaciones puntuales con `page.evaluate`. Solo 1 captura final si hace falta mostrar algo, nunca de página completa.
- **Leer solo lo necesario:** `grep -n` y rangos con `sed -n`, no archivos completos. Este archivo ya da el contexto.
- **Una sesión por tema**, por ejemplo portada, precios o corte. Las conversaciones largas encarecen cada mensaje.
- **Al terminar un cambio:** `npm test` → `npm run e2e` → commit y push → `npm run demo` y republicar los artifacts solo si cambió la interfaz.
