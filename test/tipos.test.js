import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { createCore } from "core";
import { TIPO_ITEM, TIPO_PEDIDO } from "../src/index.js";

// El registro de tipos vive en memoria: no hace falta base de datos
describe("tipos de documento de tobt", () => {
  const core = createCore({ connection: mongoose.createConnection() });
  const tipo = (n) => core.documentos.tipos().find((x) => x.tipo === n);

  it("el motor acepta las reglas de los dos tipos y es idempotente", () => {
    for (const t of [TIPO_ITEM, TIPO_PEDIDO, TIPO_ITEM, TIPO_PEDIDO]) core.documentos.registrarTipo(t);
    const p = tipo("doc_item");
    assert.equal(p.prefijo, "DOC_ITEM");
    assert.equal(p.estadoInicial, "en_cocina");
    assert.deepEqual(p.estados.sort(), ["anulado", "en_cocina", "entregado", "lista", "pagado"]);
    assert.deepEqual(p.finales.sort(), ["anulado", "pagado"]); // pagado: cobro del ítem (cuenta dividida)
    assert.deepEqual(p.editables.sort(), ["en_cocina", "entregado", "lista"]); // solo para corregir el precio (el servicio no admite otra edición)
    const c = tipo("pedido");
    assert.equal(c.prefijo, "PD");
    assert.equal(c.estadoInicial, "abierto");
    assert.deepEqual(c.estados.sort(), ["abierto", "anulado", "pagado"]);
    assert.deepEqual(c.finales.sort(), ["anulado", "pagado"]);
    assert.deepEqual(c.editables, ["abierto"]);
  });

  it("un ítem se anula desde cualquier estado y el pedido solo se paga o se anula abierto, siempre con motivo", () => {
    for (const e of ["en_cocina", "lista", "entregado"]) assert.ok(TIPO_ITEM.transiciones[e].includes("anulado"), e);
    assert.ok(TIPO_ITEM.motivos.anulado.length > 0);
    assert.deepEqual(TIPO_PEDIDO.transiciones.abierto.sort(), ["anulado", "pagado"]);
    assert.ok(TIPO_PEDIDO.motivos.anulado.length > 0);
  });

  it("estaciones: cocina marca lista, administración paga y anula el pedido, y entregar no pide estación", () => {
    assert.equal(TIPO_ITEM.permisos.lista, "estacion:cocina");
    assert.equal(TIPO_ITEM.permisos.entregado, undefined);
    assert.equal(TIPO_ITEM.permisos.pagado, "estacion:administracion");
    assert.equal(TIPO_PEDIDO.permisos.pagado, "estacion:administracion");
    assert.equal(TIPO_PEDIDO.permisos.anulado, "estacion:administracion");
  });
});
