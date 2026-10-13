# restaurante

Servicio restaurante sobre la base común (`core`). Paso 5 de la pieza 5: pedidos (`pedido`, `PD-`) e ítems (`doc_item`, `DOC_ITEM-`), sus rutas y el **front** con pantalla de Cocina (React + Vite, `client/`). Faltan mesas, croquis, carta, método de pago y seguimiento de delivery (ver `arquitectura.md`, 5.18).

No abre conexiones: el gateway le pasa el núcleo.

```js
// Mi-Servidor / src/services.js (o donde se monten los servicios)
import { createRouter } from "restaurante";
gateway.use("/restaurante", createRouter({ core }));
```

`package.json` del gateway: `npm install github:Hector3008/restaurante`.

## Pedidos e ítems

Dos tipos de documento separados. Necesita `core` con prefijos de hasta 12 caracteres (`DOC_ITEM`):

- **`doc_item`** (`DOC_ITEM-0000001`): **un ítem** (cantidad, notas, subtotal). Estados `en_cocina → lista → entregado`, y `anulado` (con motivo). Se mueve ítem por ítem.
- **`pedido`** (`PD-0000001`): agrupa los ítems de una persona o mesa. Se abre al pedir el primer ítem y sigue `abierto` hasta que se paga todo (`pagado`) o se anula (`anulado`, con motivo). Guarda canal, mesa, referencia, entrega y notas, y los códigos de sus ítems (`codigosItems`).

| Acción | Ruta | Permiso/estación |
|---|---|---|
| Abrir pedido con sus primeros ítems | `POST /pedidos` | ninguna (la ruta exige `documento:editar`) |
| Pedir más ítems | `POST /pedidos/:code/items` | ídem |
| Editar datos | `PUT /pedidos/:code` | ídem |
| Cobrar | `POST /pedidos/:code/cobrar` | `estacion:administracion` |
| Anular pedido (anula también sus ítems) | `POST /pedidos/:code/anular` `{ motivo }` | `estacion:administracion` |
| Marcar ítem listo | `POST /items/:code/lista` | `estacion:cocina` |
| Entregar ítem | `POST /items/:code/entregar` | ninguna |
| Anular ítem | `POST /items/:code/anular` `{ motivo }` | `estacion:creacion`; si ya no está en cocina, además `estacion:administracion` |

Lecturas: `GET /pedidos`, `GET /pedidos/:code`, `GET /items` (ítems con su pedido; `?estado=`), `GET /items/:code`. Las que escriben exigen `x-requested-with`.

Cobrar exige que no queden ítems en cocina ni listos y que haya al menos uno entregado; guarda el total. Totales en céntimos, sin contar anulados; `null` si algún ítem no tiene precio. Crear/agregar no es transaccional: si algo falla a medias, los ítems ya creados quedan vinculados.

**Precio propio** (`precio` en una línea del catálogo): cambia el precio solo en ese ítem. Exige `estacion:administracion`; el snapshot guarda `precioCatalogo` y `precioModificado: true`. En una línea libre el precio va dentro de `libre` y no pide permiso. Hasta 2 decimales, mínimo 0.

## Front de Pedidos y Cocina

`client/` (React + Vite, como `cuenta`) con `client/dist` **commiteado**. `createRouter` lo sirve en la raíz del montaje, junto a la API: `<base>/restaurante/`. El cliente pide la API en relativo (`../restaurante/pedidos`, `../auth/yo`, `../catalogo/`), así que **debe montarse en `<base>/restaurante/`** (sin la barra final redirige). Mismo origen que el gateway: la cookie `sid` funciona sin CORS.

Sin enrutador: lista de pedidos · nueva · detalle · pedir más · cocina (`#cocina`). La lista muestra los ítems de cada pedido con entrega rápida; Cocina muestra **una tarjeta por ítem** con botón «Listo» (sondeo cada 10 s). Si no hay sesión, hay que cambiar la contraseña temporal o falta elegir empresa, manda a `cuenta` (`../cuenta/`). Ítems del catálogo o libres, en los tres canales; el servidor copia nombre y precio y calcula los importes. Cada botón se muestra según permisos y estación (`client/src/pedidos.js`, `accionesItem`/`accionesPedido`): ocultarlo **no es seguridad**.

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

