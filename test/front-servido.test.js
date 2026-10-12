// createRouter sirve el front compilado (client/dist) junto a la API, con un núcleo falso.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRouter } from "../src/index.js";

const middleware = () => (req, res, next) => next();
function nucleoFalso() {
  return {
    documentos: { registrarTipo() {} },
    catalogo: {},
    clientes: {},
    autenticar: () => (req, res, next) => res.status(401).json({ error: "no autenticado" }),
    requierePermiso: middleware,
    eventos: { middleware },
    auth: { exigirCsrf() {} },
  };
}

describe("front del restaurante servido por createRouter", () => {
  let server, url;
  before(async () => {
    const app = express();
    app.use("/restaurante", createRouter({ core: nucleoFalso() }));
    await new Promise((r) => (server = app.listen(0, r)));
    url = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  it("la raíz entrega el HTML sin caché", async () => {
    const r = await fetch(`${url}/restaurante/`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /html/);
    assert.match(r.headers.get("cache-control"), /no-cache/);
    assert.match(await r.text(), /id="raiz"/);
  });

  it("los archivos con hash se cachean para siempre", async () => {
    const html = await (await fetch(`${url}/restaurante/`)).text();
    const asset = /assets\/[^"']+\.js/.exec(html)?.[0];
    assert.ok(asset, "index.html referencia un .js compilado en relativo");
    const r = await fetch(`${url}/restaurante/${asset}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("cache-control"), /immutable/);
  });

  it("sin la barra final redirige: el front pide todo en relativo y necesita /restaurante/", async () => {
    const r = await fetch(`${url}/restaurante`, { redirect: "manual" });
    assert.ok([301, 302, 308].includes(r.status), `status ${r.status}`);
    assert.match(r.headers.get("location"), /\/restaurante\/$/);
  });

  it("la API sigue siendo la API: /pedidos pasa por la autenticación, no por los archivos estáticos", async () => {
    const r = await fetch(`${url}/restaurante/pedidos`);
    assert.equal(r.status, 401);
  });
});

describe("createRouter sin front compilado", () => {
  it("falla al arrancar con un mensaje que dice qué hacer", () => {
    const vacio = fs.mkdtempSync(path.join(os.tmpdir(), "rest-dist-"));
    assert.throws(() => createRouter({ core: nucleoFalso(), dist: vacio }), /npm run build/);
    fs.rmSync(vacio, { recursive: true });
  });
});
