// Requiere una MongoDB real: MONGODB_URI=mongodb://localhost:27017 node --test
// (FerretDB no sirve: las pruebas de concurrencia necesitan actualizaciones atómicas de verdad)
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { createCore, conEmpresa } from "core";
import { crearServicioPedidos, TIPO_PEDIDO } from "../src/index.js";

const uri = process.env.MONGODB_URI;
const opts = { skip: uri ? false : "define MONGODB_URI para correr esta prueba" };
const COLECCIONES = ["empresas", "roles", "documentos", "documento_versiones", "contadores", "catalogo_items", "clientes", "eventos"];
const cod = (c) => (e) => e?.codigo === c;

describe("pedidos contra MongoDB real", opts, () => {
  let conn, core, svc, empresaA, empresaB;
  const u = new mongoose.Types.ObjectId();
  const ADMIN = { usuarioId: u, permisos: ["*"] };
  // Permisos de las plantillas de rol del restaurante (core/src/modelos/plantillas.js)
  const MESERO = { usuarioId: u, permisos: ["estacion:creacion", "estacion:carta", "documento:crear", "documento:leer", "documento:editar", "catalogo:leer", "cliente:leer", "cliente:crear"] };
  const COCINA = { usuarioId: u, permisos: ["estacion:cocina", "documento:leer", "documento:editar"] };
  const nuevoPedido = (empresaId = empresaA, extra = {}) =>
    svc.crear({ empresaId, actor: MESERO, canal: "salon", mesa: "4", lineas: [{ codigo: "CAFE-1", cantidad: 2 }], ...extra });

  before(async () => {
    conn = await mongoose.createConnection(uri, { dbName: "restaurante-test" }).asPromise();
    for (const c of COLECCIONES) await conn.db.dropCollection(c).catch(() => {});
    core = createCore({ connection: conn });
    core.documentos.registrarTipo(TIPO_PEDIDO);
    svc = crearServicioPedidos(core);
    await Promise.all([core.documentos.listo(), core.eventos.listo(), core.clientes.listo(), core.catalogo.listo()]);
    empresaA = (await core.empresas.crearEmpresa({ nombre: "Café A", slug: "cafe-a", servicios: ["restaurante"] }))._id;
    empresaB = (await core.empresas.crearEmpresa({ nombre: "Café B", slug: "cafe-b", servicios: ["restaurante"] }))._id;
    for (const e of [empresaA, empresaB])
      await core.catalogo.crear({ empresaId: e, actor: ADMIN, codigo: "CAFE-1", nombre: "Café", precio: 6.5 });
  });

  after(async () => {
    await core.eventos.vaciar();
    for (const c of COLECCIONES) await conn.db.dropCollection(c).catch(() => {});
    await conn.close();
  });

  it("ciclo completo con sus estaciones: abierta → en_cocina → lista → entregada → pagada", async () => {
    const p = await nuevoPedido();
    assert.equal(p.code, "PD-0000001");
    assert.equal(p.doc.total, 13);
    const paso = (metodo, actor) => svc[metodo]({ empresaId: empresaA, actor, code: p.code });
    assert.equal((await paso("enviarACocina", MESERO)).estado, "en_cocina");
    assert.equal((await paso("marcarLista", COCINA)).estado, "lista");
    assert.equal((await paso("entregar", MESERO)).estado, "entregada");
    const fin = await paso("cobrar", ADMIN);
    assert.equal(fin.estado, "pagada");
    assert.deepEqual(fin.historial.map((h) => h.a), ["abierta", "en_cocina", "lista", "entregada", "pagada"]);
  });

  it("el motor exige la estación de cada paso", async () => {
    const p = await nuevoPedido();
    const mover = (metodo, actor) => svc[metodo]({ empresaId: empresaA, actor, code: p.code });
    await assert.rejects(mover("enviarACocina", COCINA), cod("PERMISO_INSUFICIENTE"));
    await mover("enviarACocina", MESERO);
    await assert.rejects(mover("marcarLista", MESERO), cod("PERMISO_INSUFICIENTE"));
    await mover("marcarLista", COCINA);
    await mover("entregar", MESERO);
    await assert.rejects(mover("cobrar", MESERO), cod("PERMISO_INSUFICIENTE"));
  });

  it("anular pide motivo válido y deja el pedido en estado final", async () => {
    const p = await nuevoPedido();
    const anular = (motivo) => svc.anular({ empresaId: empresaA, actor: ADMIN, code: p.code, motivo });
    await assert.rejects(anular(undefined), cod("MOTIVO_REQUERIDO"));
    await assert.rejects(anular({ codigo: "porque_si" }), cod("MOTIVO_INVALIDO"));
    const a = await anular({ codigo: "cliente_se_fue", detalle: "se fue sin esperar" });
    assert.equal(a.estado, "anulada");
    await assert.rejects(svc.editar({ empresaId: empresaA, actor: MESERO, code: p.code, notas: "x" }), cod("ESTADO_NO_EDITABLE"));
  });

  it("se edita en abierta y en en_cocina (versión nueva), no en lista", async () => {
    const p = await nuevoPedido();
    const e1 = await svc.editar({ empresaId: empresaA, actor: MESERO, code: p.code, lineas: [{ codigo: "CAFE-1", cantidad: 3 }] });
    assert.equal(e1.version, 2);
    assert.equal(e1.doc.total, 19.5);
    await svc.enviarACocina({ empresaId: empresaA, actor: MESERO, code: p.code });
    const e2 = await svc.editar({ empresaId: empresaA, actor: MESERO, code: p.code, notas: "sin hielo" });
    assert.equal(e2.version, 3);
    await svc.marcarLista({ empresaId: empresaA, actor: COCINA, code: p.code });
    await assert.rejects(svc.editar({ empresaId: empresaA, actor: MESERO, code: p.code, notas: "tarde" }), cod("ESTADO_NO_EDITABLE"));
    const v1 = await svc.obtener({ empresaId: empresaA, actor: MESERO, code: p.code, version: 1 });
    assert.equal(v1.doc.total, 13); // la versión 1 se conserva
  });

  it("el precio queda como se vendió: cambiar el catálogo no cambia el pedido", async () => {
    const p = await nuevoPedido();
    const item = await core.catalogo.obtener({ empresaId: empresaA, codigo: "CAFE-1" });
    await core.catalogo.actualizar({ empresaId: empresaA, actor: ADMIN, itemId: item.id, precio: 9 });
    const o = await svc.obtener({ empresaId: empresaA, actor: MESERO, code: p.code });
    assert.equal(o.doc.total, 13);
    const nuevo = await nuevoPedido();
    assert.equal(nuevo.doc.total, 18);
  });

  it("dos 'enviar a cocina' simultáneos: solo uno gana", async () => {
    const p = await nuevoPedido();
    const r = await Promise.allSettled([
      svc.enviarACocina({ empresaId: empresaA, actor: MESERO, code: p.code }),
      svc.enviarACocina({ empresaId: empresaA, actor: MESERO, code: p.code }),
    ]);
    assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  });

  it("cada empresa ve solo sus pedidos y lleva su numeración", async () => {
    const b = await nuevoPedido(empresaB);
    assert.equal(b.code, "PD-0000001");
    await assert.rejects(svc.obtener({ empresaId: empresaB, actor: ADMIN, code: "PD-0000002" }), cod("NO_ENCONTRADO"));
    const lista = await svc.listar({ empresaId: empresaB, actor: ADMIN });
    assert.equal(lista.length, 1);
  });

  it("listar filtra por estado", async () => {
    const abiertas = await svc.listar({ empresaId: empresaA, actor: ADMIN, estado: ["abierta"] });
    assert.ok(abiertas.length >= 1 && abiertas.every((x) => x.estado === "abierta"));
  });

  it("emite eventos del motor con el tipo de documento pedido", async () => {
    await core.eventos.vaciar();
    const evs = await conEmpresa(empresaA, async () => await core.eventos.listar({ tipo: "documento.estado" }));
    assert.ok(evs.length > 0 && evs.every((e) => e.tipoDocumento === "pedido"));
  });
});
