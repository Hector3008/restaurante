import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { createCore } from "core";
import { TIPO_PEDIDO } from "../src/index.js";

// El registro de tipos vive en memoria: no hace falta base de datos
describe("tipo de documento pedido", () => {
  const core = createCore({ connection: mongoose.createConnection() });

  it("el motor acepta las reglas y es idempotente", () => {
    core.documentos.registrarTipo(TIPO_PEDIDO);
    core.documentos.registrarTipo(TIPO_PEDIDO);
    const t = core.documentos.tipos().find((x) => x.tipo === "pedido");
    assert.equal(t.prefijo, "PD");
    assert.equal(t.estadoInicial, "abierta");
    assert.deepEqual(t.estados.sort(), ["abierta", "anulada", "en_cocina", "entregada", "lista", "pagada"]);
    assert.deepEqual(t.finales.sort(), ["anulada", "pagada"]);
    assert.deepEqual(t.editables, ["abierta", "en_cocina"]);
  });

  it("anular pide motivo y de cada estado previo a pagada se puede anular", () => {
    for (const e of ["abierta", "en_cocina", "lista", "entregada"])
      assert.ok(TIPO_PEDIDO.transiciones[e].includes("anulada"), e);
    assert.ok(TIPO_PEDIDO.motivos.anulada.length > 0);
  });
});
