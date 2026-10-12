# restaurante

Servicio restaurante sobre la base común (`core`). Paso 5 de la pieza 5: documento `pedido`, sus rutas y el **front de Pedidos** (React + Vite, `client/`). Faltan la pantalla de cocina, mesas, croquis, carta, método de pago y seguimiento de delivery (ver `arquitectura.md`, 5.18).

No abre conexiones: el gateway le pasa el núcleo.

```js
// Mi-Servidor / src/services.js (o donde se monten los servicios)
import { createRouter } from "restaurante";
gateway.use("/restaurante", createRouter({ core }));
```

`package.json` del gateway: `npm install github:Hector3008/restaurante`.

## Pedido

Un solo documento (`tipo: "pedido"`, código `PD-0000001`) con estados `abierta → en_cocina → lista → entregada → pagada`, y `anulada` (con motivo) como salida desde cualquier estado antes de pagada.

| Paso | Ruta | Estación que pide el motor |
|---|---|---|
| Enviar a cocina | `POST /pedidos/:code/enviar` | `estacion:creacion` |
| Marcar lista | `POST /pedidos/:code/lista` | `estacion:cocina` |
| Entregar | `POST /pedidos/:code/entregar` | ninguna (la ruta exige `documento:editar`) |
| Cobrar | `POST /pedidos/:code/cobrar` | `estacion:administracion` |
| Anular | `POST /pedidos/:code/anular` `{ motivo: { codigo, detalle? } }` | `estacion:administracion` |

Además: `GET /pedidos`, `GET /pedidos/:code` (`?version=`), `POST /pedidos`, `PUT /pedidos/:code`. Todas las que escriben exigen `x-requested-with`.

Canales: `salon` (exige `mesa`), `llevar` (exige `referencia`), `delivery` (exige `entrega: { direccion, telefono }`). Las líneas son `{ codigo, precio?, cantidad?, notas? }` o `{ libre: {...}, cantidad?, notas? }`; el servidor copia nombre y precio del catálogo al `snapshot` y calcula los importes (el cliente no los manda).

**Precio propio** (`precio` en una línea del catálogo): cambia el precio solo en ese pedido. Exige `estacion:administracion`; el snapshot guarda `precioCatalogo` (el original) y `precioModificado: true`. Al editar, repetir el mismo precio que el pedido ya tenía no pide el permiso; omitir `precio` devuelve la línea al precio del catálogo. En una línea libre el precio va dentro de `libre` y no pide permiso. Hasta 2 decimales, mínimo 0.

## Front de Pedidos

`client/` (React + Vite, como `cuenta`) con `client/dist` **commiteado**. `createRouter` lo sirve en la raíz del montaje, junto a la API: `<base>/restaurante/`. El cliente pide la API en relativo (`../restaurante/pedidos`, `../auth/yo`, `../catalogo/`), así que **debe montarse en `<base>/restaurante/`** (sin la barra final redirige). Mismo origen que el gateway: la cookie `sid` funciona sin CORS.

Sin enrutador: lista · nuevo · detalle · editar. Si no hay sesión, hay que cambiar la contraseña temporal o falta elegir empresa, manda a `cuenta` (`../cuenta/`). Ítems del catálogo (búsqueda por código o nombre) o libres, en los tres canales; el servidor copia nombre y precio y calcula los importes (el front solo muestra una estimación). Cada botón se muestra según los permisos y la estación del paso (`client/src/pedidos.js`, `accionesDe`): ocultarlo **no es seguridad**, el servicio y el motor siguen comprobando.

```
npm run build   # instala y compila client/ → client/dist (commitearlo)
npm run dev     # Vite en :5173 con proxy al gateway (GATEWAY_URL para cambiarlo)
```

`createRouter` falla al arrancar, con un mensaje claro, si no existe `client/dist/index.html`.

## Pruebas

```
npm test                                   # 49 pruebas sin base de datos (servicio, front y servido estático)
MONGODB_URI=mongodb://localhost:27017 npm test   # suma las de MongoDB real (pedidos.test.js)
```

El humo contra el gateway (`humo-restaurante.mjs`) va en la carpeta `test/` del gateway, no aquí.
# restaurante

