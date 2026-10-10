import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { ErrorDocumento, ErrorCatalogo } from "core";
import { crearServicioPedidos, ErrorPedido } from "../src/index.js";
import { montarRutasPedidos } from "../src/http.js";

// Núcleo falso en memoria: prueba la lógica del servicio y las rutas sin base de datos.
// Las reglas reales de estados y permisos del motor se prueban en pedidos.test.js (MongoDB real).
function nucleoFalso() {
  const docs = new Map();
  const llamadas = [];
  let n = 0;
  const catalogoItems = {
    "CAFE-1": { nombre: "Café", precio: 6.5, categoria: "bebidas" },
    "TORTA-1": { nombre: "Torta", precio: 9.9, categoria: "postres" },
    "SINPRECIO": { nombre: "Especial", precio: null, categoria: null },
  };
  return {
    llamadas,
    docs,
    catalogo: {
      moneda: async () => "PEN",
      async instantanea({ items }) {
        return items.map((it) => {
          if (typeof it === "object") return { origen: "libre", itemId: null, codigo: null, nombre: it.libre.nombre, precio: it.libre.precio ?? null, categoria: null, atributos: {} };
          const i = catalogoItems[it.toUpperCase()];
          if (!i) throw new ErrorCatalogo("ITEM_NO_DISPONIBLE", `no disponible: ${it}`, { noEncontrados: [it], inactivos: [] });
          return { origen: "catalogo", itemId: "id-" + it, codigo: it.toUpperCase(), ...i, atributos: {} };
        });
      },
    },
    clientes: { instantanea: async ({ clienteId, campos }) => ({ clienteId, nombre: "Ana", telefono: "+51987654321", campos }) },
    documentos: {
      async crear({ tipo, snapshot, doc, usuarioId }) {
        const d = { tipo, code: `PD-${String(++n).padStart(7, "0")}`, estado: "abierta", version: 1, snapshot, payload: { doc }, creadoPor: usuarioId, historial: [] };
        docs.set(d.code, d);
        return structuredClone(d);
      },
      async obtener({ code }) { const d = docs.get(code); return d ? structuredClone(d) : null; },
      async listar({ tipo, estado }) {
        return [...docs.values()].filter((d) => d.tipo === tipo && (!estado || estado.includes(d.estado))).map((d) => structuredClone(d));
      },
      async nuevaVersion(p) {
        llamadas.push(["nuevaVersion", p]);
        const d = docs.get(p.code);
        if (p.esperaVersion !== d.version) throw new ErrorDocumento("CONFLICTO_VERSION", "otro cambió el documento");
        d.payload = { doc: p.doc }; if (p.snapshot) d.snapshot = p.snapshot; d.version++;
        return structuredClone(d);
      },
      async transicionar(p) {
        llamadas.push(["transicionar", p]);
        const d = docs.get(p.code); d.estado = p.a; return structuredClone(d);
      },
    },
  };
}

const ADMIN = { usuarioId: "u1", permisos: ["*"] };
const MESERO = { usuarioId: "u2", permisos: ["documento:crear", "documento:leer", "documento:editar"] };
const SOLO_LEER = { usuarioId: "u3", permisos: ["documento:leer"] };
const E = "e1";
const cod = (c) => (e) => e?.codigo === c;

describe("servicio de pedidos (núcleo falso)", () => {
  let core, svc;
  const nuevo = () => {
    core = nucleoFalso();
    svc = crearServicioPedidos(core);
  };
  const base = { canal: "salon", mesa: "4" };

  it("crea el pedido con snapshot unido por posición, importes y moneda", async () => {
    nuevo();
    const p = await svc.crear({
      empresaId: E, actor: MESERO, ...base, clienteId: "c1",
      lineas: [{ codigo: "cafe-1", cantidad: 2, notas: "sin azúcar" }, { codigo: "TORTA-1" }, { libre: { nombre: "Postre del día", precio: 5 } }],
    });
    assert.equal(p.code, "PD-0000001");
    assert.equal(p.estado, "abierta");
    assert.equal(p.doc.moneda, "PEN");
    assert.equal(p.doc.total, 27.9); // 13 + 9.9 + 5
    assert.deepEqual(p.doc.lineas.map((l) => l.subtotal), [13, 9.9, 5]);
    assert.equal(p.doc.lineas[0].notas, "sin azúcar");
    assert.deepEqual(p.snapshot.lineas.map((l) => l.origen), ["catalogo", "catalogo", "libre"]);
    assert.equal(p.snapshot.lineas[0].codigo, "CAFE-1"); // el del catálogo, no el escrito
    assert.deepEqual(p.snapshot.cliente.campos, ["nombre", "telefono"]); // minimización: sin correo ni redes
  });

  it("una línea sin precio deja el total en null", async () => {
    nuevo();
    const p = await svc.crear({ empresaId: E, actor: ADMIN, ...base, lineas: [{ codigo: "CAFE-1" }, { codigo: "SINPRECIO" }] });
    assert.equal(p.doc.total, null);
  });

  it("un ítem no disponible frena todo y no crea nada", async () => {
    nuevo();
    await assert.rejects(svc.crear({ empresaId: E, actor: ADMIN, ...base, lineas: [{ codigo: "NOEXISTE" }] }), cod("ITEM_NO_DISPONIBLE"));
    assert.equal(core.docs.size, 0);
  });

  it("cada operación comprueba el permiso del actor", async () => {
    nuevo();
    await assert.rejects(svc.crear({ empresaId: E, actor: SOLO_LEER, ...base, lineas: [{ codigo: "CAFE-1" }] }), cod("PERMISO_INSUFICIENTE"));
    const p = await svc.crear({ empresaId: E, actor: MESERO, ...base, lineas: [{ codigo: "CAFE-1" }] });
    await assert.rejects(svc.obtener({ empresaId: E, actor: { permisos: [] }, code: p.code }), cod("PERMISO_INSUFICIENTE"));
    await assert.rejects(svc.editar({ empresaId: E, actor: SOLO_LEER, code: p.code, notas: "x" }), cod("PERMISO_INSUFICIENTE"));
    await assert.rejects(svc.enviarACocina({ empresaId: E, actor: SOLO_LEER, code: p.code }), cod("PERMISO_INSUFICIENTE"));
  });

  it("solo ve pedidos: un documento de otro tipo no se obtiene ni se mueve", async () => {
    nuevo();
    core.docs.set("PD-0000099", { tipo: "proforma", code: "PD-0000099", estado: "borrador", version: 1, payload: { doc: {} }, snapshot: {} });
    await assert.rejects(svc.obtener({ empresaId: E, actor: ADMIN, code: "PD-0000099" }), cod("NO_ENCONTRADO"));
    await assert.rejects(svc.cobrar({ empresaId: E, actor: ADMIN, code: "PD-0000099" }), cod("NO_ENCONTRADO"));
    await assert.rejects(svc.obtener({ empresaId: E, actor: ADMIN, code: "PD-0000100" }), cod("NO_ENCONTRADO"));
    assert.deepEqual(await svc.listar({ empresaId: E, actor: ADMIN }), []);
  });

  it("editar: reemplaza líneas con importes nuevos, conserva el cliente y usa la versión actual", async () => {
    nuevo();
    const p = await svc.crear({ empresaId: E, actor: MESERO, ...base, clienteId: "c1", lineas: [{ codigo: "CAFE-1" }] });
    const e = await svc.editar({ empresaId: E, actor: MESERO, code: p.code, lineas: [{ codigo: "TORTA-1", cantidad: 2 }], notas: "para compartir" });
    assert.equal(e.version, 2);
    assert.equal(e.doc.total, 19.8);
    assert.equal(e.doc.notas, "para compartir");
    assert.equal(e.snapshot.cliente.clienteId, "c1");
    assert.equal(core.llamadas.at(-1)[1].esperaVersion, 1);
    await assert.rejects(svc.editar({ empresaId: E, actor: MESERO, code: p.code, esperaVersion: 1, notas: "otra" }), cod("CONFLICTO_VERSION"));
  });

  it("editar: no deja un pedido de salón sin mesa", async () => {
    nuevo();
    const p = await svc.crear({ empresaId: E, actor: MESERO, ...base, lineas: [{ codigo: "CAFE-1" }] });
    await assert.rejects(svc.editar({ empresaId: E, actor: MESERO, code: p.code, mesa: null }), cod("DATOS_INVALIDOS"));
  });

  it("los pasos mandan al motor el estado, el usuario, los permisos y el motivo", async () => {
    nuevo();
    const p = await svc.crear({ empresaId: E, actor: MESERO, ...base, lineas: [{ codigo: "CAFE-1" }] });
    const motivo = { codigo: "cortesia" };
    for (const [metodo, a] of [["enviarACocina", "en_cocina"], ["marcarLista", "lista"], ["entregar", "entregada"], ["cobrar", "pagada"], ["anular", "anulada"]]) {
      await svc[metodo]({ empresaId: E, actor: MESERO, code: p.code, motivo, esperaVersion: 1 });
      const [, args] = core.llamadas.at(-1);
      assert.equal(args.a, a);
      assert.equal(args.usuarioId, "u2");
      assert.deepEqual(args.permisos, MESERO.permisos);
      assert.deepEqual(args.motivo, motivo);
    }
  });
});

describe("rutas de pedidos (núcleo falso)", () => {
  let server, url, core, svc;
  const sesion = { auth: { usuarioId: "u1", empresaId: "e1" }, rol: { permisos: ["*"] } };

  before(async () => {
    core = nucleoFalso();
    svc = crearServicioPedidos(core);
    const router = express.Router();
    router.use(express.json());
    const ctx = {
      autenticar: () => (req, res, next) => {
        if (req.headers["x-sin-sesion"]) return res.status(401).json({ error: "no autenticado" });
        Object.assign(req, structuredClone(sesion));
        next();
      },
      requierePermiso: () => (req, res, next) => next(),
      eventos: { middleware: ({ estacion }) => (req, res, next) => { req.estacionDeRuta = estacion; next(); } },
      auth: { exigirCsrf(req) { if (!req.headers["x-requested-with"]) throw new ErrorPedido("PERMISO_INSUFICIENTE", "falta x-requested-with"); } },
    };
    montarRutasPedidos(router, ctx, svc);
    const app = express();
    app.use("/restaurante", router);
    await new Promise((r) => (server = app.listen(0, r)));
    url = `http://127.0.0.1:${server.address().port}/restaurante`;
  });
  after(() => server.close());

  const pedir = (metodo, ruta, cuerpo, cab = {}) =>
    fetch(url + ruta, {
      method: metodo,
      headers: { "content-type": "application/json", "x-requested-with": "fetch", ...cab },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });

  it("crear 201, obtener 200, listar con filtro de estado", async () => {
    let r = await pedir("POST", "/pedidos", { canal: "llevar", referencia: "Ana", lineas: [{ codigo: "CAFE-1" }] });
    assert.equal(r.status, 201);
    const p = await r.json();
    r = await pedir("GET", `/pedidos/${p.code}`);
    assert.equal(r.status, 200);
    r = await pedir("GET", "/pedidos?estado=abierta,pagada");
    assert.equal((await r.json()).pedidos.length, 1);
    r = await pedir("GET", "/pedidos?estado=pagada");
    assert.equal((await r.json()).pedidos.length, 0);
  });

  it("errores con su HTTP: 400 datos, 404 inexistente, 409 ítem no disponible, 409 conflicto, 403 motor", async () => {
    let r = await pedir("POST", "/pedidos", { canal: "salon", lineas: [{ codigo: "CAFE-1" }] });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).codigo, "DATOS_INVALIDOS");
    r = await pedir("GET", "/pedidos/PD-0009999");
    assert.equal(r.status, 404);
    r = await pedir("POST", "/pedidos", { canal: "salon", mesa: "1", lineas: [{ codigo: "NOEXISTE" }] });
    assert.equal(r.status, 409);
    const p = await (await pedir("POST", "/pedidos", { canal: "salon", mesa: "1", lineas: [{ codigo: "CAFE-1" }] })).json();
    r = await pedir("PUT", `/pedidos/${p.code}`, { esperaVersion: 7, notas: "x" });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).codigo, "CONFLICTO_VERSION");
    core.documentos.transicionar = async () => { throw new ErrorDocumento("PERMISO_INSUFICIENTE", "falta estacion:cocina"); };
    r = await pedir("POST", `/pedidos/${p.code}/lista`, {});
    assert.equal(r.status, 403);
  });

  it("401 sin sesión y 403 sin x-requested-with en rutas que escriben", async () => {
    let r = await pedir("GET", "/pedidos", undefined, { "x-sin-sesion": "1" });
    assert.equal(r.status, 401);
    r = await fetch(url + "/pedidos", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 403);
  });
});
