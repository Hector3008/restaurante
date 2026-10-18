import { test } from "node:test";
import assert from "node:assert/strict";
import { extraerConsumo } from "../src/fuente-puntos.js";

const doc = (item, extra = {}) => ({
  snapshot: { item, cliente: { clienteId: "c1", nombre: "Ana" } },
  payload: { doc: { subtotal: 12.5, pedidoCode: "PD-3", ...extra } },
});

test("un plato del catálogo pagado acumula con su código de ítem", () => {
  assert.deepEqual(extraerConsumo(doc({ origen: "catalogo", codigo: "LATTE" })), {
    clienteId: "c1",
    monto: 12.5,
    detalle: "Pedido PD-3 pagado",
    itemCodigo: "LATTE",
  });
});

test("una línea libre no cuenta como plato de la carta", () => {
  assert.equal(extraerConsumo(doc({ origen: "libre", codigo: "X" })).itemCodigo, null);
  assert.equal(extraerConsumo(doc(undefined)).itemCodigo, null);
});

test("sin cliente ni subtotal devuelve nulos, sin romper", () => {
  const r = extraerConsumo({ snapshot: { item: { origen: "catalogo", codigo: "MOKA" } }, payload: {} });
  assert.equal(r.clienteId, null);
  assert.equal(r.monto, null);
  assert.equal(r.detalle, "Pedido pagado");
  assert.equal(r.itemCodigo, "MOKA");
});
