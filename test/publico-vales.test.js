// Vales del cliente en la carta pública: manejadores contra un núcleo falso, montados con las rutas reales.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { ErrorFidelizacion } from "core";
import { montarRutasPublicas } from "../src/publico-http.js";
import { crearManejadoresVales } from "../src/publico-vales.js";

describe("vales del cliente (rutas públicas)", () => {
  let server, url;
  const llamadas = [];
  const core = {
    cuentasCliente: {
      // Sesión falsa: la cabecera x-cliente dice quién es; sin ella, 401 como el núcleo.
      autenticarCliente: ({ empresaDe }) => async (req, res, next) => {
        const e = await empresaDe(req);
        if (!req.headers["x-cliente"]) return res.status(401).json({ error: "no autenticado", codigo: "SIN_SESION" });
        req.cliente = { clienteId: req.headers["x-cliente"], empresaId: e.id, sesionId: "s1" };
        next();
      },
    },
    fidelizacion: {
      beneficios: { activos: async ({ empresaId }) => (llamadas.push(["activos", empresaId]), [{ id: "b1", nombre: "Café gratis", puntos: 100 }]) },
      tickets: {
        de: async (q) => (llamadas.push(["de", q.empresaId, q.clienteId]), [{ codigo: "K7M2QX", estado: "activo" }]),
        emitirMio: async (q) => {
          llamadas.push(["emitirMio", q.empresaId, q.clienteId, q.beneficioId]);
          if (q.beneficioId === "caro") throw new ErrorFidelizacion("SALDO_INSUFICIENTE", "saldo insuficiente (10 puntos)", { saldo: 10 });
          return { ticket: { codigo: "K7M2QX" }, saldo: 50 };
        },
        cancelarMio: async (q) => (llamadas.push(["cancelarMio", q.clienteId, q.codigo]), { ticket: { codigo: q.codigo, estado: "cancelado" }, saldo: 150 }),
      },
    },
  };

  before(async () => {
    const router = express.Router();
    router.use(express.json());
    const publico = { empresaDe: async (req) => ({ id: "e1", slug: req.params.empresa }) };
    montarRutasPublicas(router, publico, "<html><head></head></html>", (req, res, next) => next(), null, crearManejadoresVales(core, publico.empresaDe));
    const app = express();
    app.use("/tobt", router);
    await new Promise((r) => (server = app.listen(0, r)));
    url = `http://127.0.0.1:${server.address().port}/tobt/publico/cafe/cuenta/vales`;
  });
  after(() => server.close());

  const pedir = (metodo, ruta = "", cuerpo, cab = {}) =>
    fetch(url + ruta, {
      method: metodo,
      headers: { "content-type": "application/json", "x-cliente": "c1", ...cab },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });

  it("lista los beneficios activos y los vales del cliente de la sesión", async () => {
    llamadas.length = 0;
    const r = await pedir("GET");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const j = await r.json();
    assert.equal(j.beneficios[0].nombre, "Café gratis");
    assert.equal(j.vales[0].codigo, "K7M2QX");
    assert.deepEqual(llamadas, [["activos", "e1"], ["de", "e1", "c1"]]);
  });

  it("canjea para el cliente de la sesión, aunque el cuerpo diga otro", async () => {
    llamadas.length = 0;
    const r = await pedir("POST", "", { beneficioId: "b1", clienteId: "otro", empresaId: "e9" });
    assert.equal(r.status, 201);
    assert.deepEqual(await r.json(), { ticket: { codigo: "K7M2QX" }, saldo: 50 });
    assert.deepEqual(llamadas, [["emitirMio", "e1", "c1", "b1"]]);
  });

  it("el error del núcleo sale con su HTTP y el saldo", async () => {
    const r = await pedir("POST", "", { beneficioId: "caro" });
    assert.equal(r.status, 409);
    assert.deepEqual(await r.json(), { error: "saldo insuficiente (10 puntos)", codigo: "SALDO_INSUFICIENTE", saldo: 10 });
  });

  it("cancela un vale del cliente de la sesión", async () => {
    llamadas.length = 0;
    const r = await pedir("POST", "/K7M2QX/cancelar", {});
    assert.equal(r.status, 200);
    assert.equal((await r.json()).saldo, 150);
    assert.deepEqual(llamadas, [["cancelarMio", "c1", "K7M2QX"]]);
  });

  it("sin sesión de cliente: 401 y no toca nada", async () => {
    llamadas.length = 0;
    for (const [m, ruta] of [["GET", ""], ["POST", ""], ["POST", "/K7M2QX/cancelar"]])
      assert.equal((await pedir(m, ruta, m === "POST" ? {} : undefined, { "x-cliente": "" })).status, 401);
    assert.deepEqual(llamadas, []);
  });
});
