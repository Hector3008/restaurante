// Requiere una MongoDB real: MONGODB_URI=mongodb://localhost:27017 node --test
// (FerretDB no sirve: las pruebas de concurrencia necesitan actualizaciones atómicas de verdad)
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { createCore, conEmpresa } from "core";
import { crearServicio, TIPO_ITEM, TIPO_PEDIDO } from "../src/index.js";

const uri = process.env.MONGODB_URI;
const opts = { skip: uri ? false : "define MONGODB_URI para correr esta prueba" };
const COLECCIONES = ["empresas", "roles", "documentos", "documento_versiones", "contadores", "catalogo_items", "clientes", "eventos"];
const cod = (c) => (e) => e?.codigo === c;

describe("pedidos y ítems contra MongoDB real", opts, () => {
  let conn, core, svc, empresaA, empresaB;
  const u = new mongoose.Types.ObjectId();
  const ADMIN = { usuarioId: u, permisos: ["*"] };
  // Permisos de las plantillas de rol de tobt (core/src/modelos/plantillas.js)
  const MESERO = { usuarioId: u, permisos: ["estacion:creacion", "estacion:carta", "documento:crear", "documento:leer", "documento:editar", "catalogo:leer", "cliente:leer", "cliente:crear"] };
  const COCINA = { usuarioId: u, permisos: ["estacion:cocina", "documento:leer", "documento:editar"] };
  const abrir = (empresaId = empresaA, extra = {}) =>
    svc.pedidos.crear({ empresaId, actor: MESERO, canal: "salon", mesa: "4", items: [{ codigo: "CAFE-1", cantidad: 2 }, { libre: { nombre: "Torta", precio: 5 } }], ...extra });
  const m = (actor, code, extra = {}, empresaId = empresaA) => ({ empresaId, actor, code, ...extra });

  before(async () => {
    conn = await mongoose.createConnection(uri, { dbName: "tobt-test" }).asPromise();
    for (const c of COLECCIONES) await conn.db.dropCollection(c).catch(() => {});
    core = createCore({ connection: conn });
    core.documentos.registrarTipo(TIPO_ITEM);
    core.documentos.registrarTipo(TIPO_PEDIDO);
    svc = crearServicio(core);
    await Promise.all([core.documentos.listo(), core.eventos.listo(), core.clientes.listo(), core.catalogo.listo()]);
    empresaA = (await core.empresas.crearEmpresa({ nombre: "Café A", slug: "cafe-a", servicios: ["tobt"] }))._id;
    empresaB = (await core.empresas.crearEmpresa({ nombre: "Café B", slug: "cafe-b", servicios: ["tobt"] }))._id;
    for (const e of [empresaA, empresaB])
      await core.catalogo.crear({ empresaId: e, actor: ADMIN, codigo: "CAFE-1", nombre: "Café", precio: 6.5 });
  });

  after(async () => {
    await core.eventos.vaciar();
    for (const c of COLECCIONES) await conn.db.dropCollection(c).catch(() => {});
    await conn.close();
  });

  it("ciclo completo con sus estaciones: cada ítem en_cocina → lista → entregado y el pedido se paga al final", async () => {
    const c = await abrir();
    assert.equal(c.code, "PD-0000001");
    assert.deepEqual(c.items.map((i) => i.code), ["DOC_ITEM-0000001", "DOC_ITEM-0000002"]);
    assert.equal(c.total, 18);
    for (const i of c.items) {
      assert.equal((await svc.items.marcarLista(m(COCINA, i.code))).estado, "lista");
      assert.equal((await svc.items.entregar(m(MESERO, i.code))).estado, "entregado");
    }
    const fin = await svc.pedidos.cobrar(m(ADMIN, c.code));
    assert.equal(fin.estado, "pagado");
    assert.equal(fin.doc.total, 18);
    assert.deepEqual(fin.historial.map((h) => h.a), ["abierto", "pagado"]);
    const p = await svc.items.obtener(m(MESERO, "DOC_ITEM-0000001"));
    assert.deepEqual(p.historial.map((h) => h.a), ["en_cocina", "lista", "entregado"]);
  });

  it("el motor exige la estación de cada paso", async () => {
    const c = await abrir();
    const [a] = c.items;
    await assert.rejects(svc.items.marcarLista(m(MESERO, a.code)), cod("PERMISO_INSUFICIENTE"));
    await svc.items.marcarLista(m(COCINA, a.code));
    await svc.items.entregar(m(MESERO, a.code));
    await assert.rejects(svc.pedidos.cobrar(m(MESERO, c.code)), cod("PERMISO_INSUFICIENTE"));
    await assert.rejects(svc.pedidos.cobrar(m(ADMIN, c.code)), cod("ESTADO_INVALIDO")); // el otro ítem sigue en cocina
  });

  it("anular pide motivo válido; un ítem anulado no suma y el pedido anulado anula todo", async () => {
    const c = await abrir();
    const anular = (code, motivo, actor = MESERO) => svc.items.anular(m(actor, code, { motivo }));
    await assert.rejects(anular(c.items[0].code, undefined), cod("MOTIVO_REQUERIDO"));
    await assert.rejects(anular(c.items[0].code, { codigo: "porque_si" }), cod("MOTIVO_INVALIDO"));
    assert.equal((await anular(c.items[0].code, { codigo: "error_pedido" })).estado, "anulado");
    assert.equal((await svc.pedidos.obtener(m(MESERO, c.code))).total, 5);
    const a = await svc.pedidos.anular(m(ADMIN, c.code, { motivo: { codigo: "cliente_se_fue" } }));
    assert.equal(a.estado, "anulado");
    assert.deepEqual(a.items.map((i) => i.estado), ["anulado", "anulado"]);
    await assert.rejects(svc.pedidos.agregarItems({ empresaId: empresaA, actor: MESERO, code: c.code, items: [{ codigo: "CAFE-1" }] }), cod("ESTADO_INVALIDO"));
  });

  it("agregar ítems al pedido abierto, varios a la vez sin pisarse", async () => {
    const c = await abrir();
    await Promise.all([1, 2, 3].map(() => svc.pedidos.agregarItems({ empresaId: empresaA, actor: MESERO, code: c.code, items: [{ codigo: "CAFE-1" }] })));
    const d = await svc.pedidos.obtener(m(MESERO, c.code));
    assert.equal(d.items.length, 5);
    assert.equal(new Set(d.items.map((i) => i.code)).size, 5);
  });

  it("el precio queda como se vendió: cambiar el catálogo no cambial pedido ya abierto", async () => {
    const c = await abrir();
    const item = await core.catalogo.obtener({ empresaId: empresaA, codigo: "CAFE-1" });
    await core.catalogo.actualizar({ empresaId: empresaA, actor: ADMIN, itemId: item.id, precio: 9 });
    assert.equal((await svc.pedidos.obtener(m(MESERO, c.code))).total, 18);
    assert.equal((await abrir()).total, 23); // 2 × 9 + 5
  });

  it("precio propio: lo pone administración y queda el original", async () => {
    await assert.rejects(abrir(empresaA, { items: [{ codigo: "CAFE-1", precio: 1 }] }), cod("PERMISO_INSUFICIENTE"));
    const c = await svc.pedidos.crear({ empresaId: empresaA, actor: ADMIN, canal: "llevar", referencia: "Ana", items: [{ codigo: "CAFE-1", precio: 1 }] });
    assert.deepEqual([c.items[0].precio, c.items[0].precioModificado, c.total], [1, true, 1]);
    assert.ok(c.items[0].precioCatalogo > 1);
  });

  it("cada empresa ve solo lo suyo y lleva su numeración", async () => {
    const b = await abrir(empresaB);
    assert.equal(b.code, "PD-0000001");
    assert.equal(b.items[0].code, "DOC_ITEM-0000001");
    await assert.rejects(svc.pedidos.obtener(m(ADMIN, "PD-0000099", {}, empresaB)), cod("NO_ENCONTRADO"));
    assert.equal((await svc.pedidos.listar({ empresaId: empresaB, actor: ADMIN })).length, 1);
    assert.equal((await svc.items.listar({ empresaId: empresaB, actor: ADMIN })).length, 2);
  });

  it("listar pedidos y ítems filtra por estado", async () => {
    const abiertos = await svc.pedidos.listar({ empresaId: empresaA, actor: ADMIN, estado: ["abierto"] });
    assert.ok(abiertos.length >= 1 && abiertos.every((x) => x.estado === "abierto" && Array.isArray(x.items)));
    const enCocina = await svc.items.listar({ empresaId: empresaA, actor: ADMIN, estado: ["en_cocina"] });
    assert.ok(enCocina.length >= 1 && enCocina.every((x) => x.estado === "en_cocina" && x.pedido));
  });

  it("un ítem no se edita: el motor no lo permite", async () => {
    const c = await abrir();
    await assert.rejects(
      conEmpresa(empresaA, async () => await core.documentos.nuevaVersion({ code: c.items[0].code, doc: { x: 1 }, usuarioId: u })),
      cod("ESTADO_NO_EDITABLE"),
    );
  });

  it("emite eventos del motor con el tipo de documento de cada uno", async () => {
    await core.eventos.vaciar();
    const evs = await conEmpresa(empresaA, async () => await core.eventos.listar({ tipo: "documento.estado" }));
    assert.ok(evs.length > 0);
    assert.ok(evs.every((e) => ["doc_item", "pedido"].includes(e.tipoDocumento)));
  });
});
