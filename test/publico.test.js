// Vista pública de la carta (sin sesión): servicio contra un núcleo falso, rutas HTTP y lógica pura del front.
import { describe, it, before, after, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createRouter } from "../src/index.js";
import { ErrorCatalogo } from "core";
import { agruparPorCategoria, crearPublico, urlImagenSegura } from "../src/publico.js";
import { resenasDe } from "../src/resenas-demo.js";
import { limitadorPorIp, paginaCatalogo } from "../src/publico-http.js";
import { CLIENTE_DEMO, clienteActual } from "../src/cliente-demo.js";
import { slugDesdeUbicacion, formatoPrecio, filtrarCarta, totalItems, formatoPuntos, rutaDesdeHash, hashPlato, estrellasLlenas, formatoNota } from "../client/src/catalogo/logica.js";

const middleware = () => (req, res, next) => next();

const EMPRESAS = {
  "cafe-central": { _id: "e1", nombre: "Café Central", slug: "cafe-central", moneda: "PEN", activa: true, servicios: [{ codigo: "restaurante", activa: true }] },
  "sin-servicio": { _id: "e2", nombre: "Otra", slug: "sin-servicio", activa: true, servicios: [{ codigo: "siscore", activa: true }] },
  "servicio-off": { _id: "e3", nombre: "Off", slug: "servicio-off", activa: true, servicios: [{ codigo: "restaurante", activa: false }] },
  "empresa-baja": { _id: "e4", nombre: "Baja", slug: "empresa-baja", activa: false, servicios: [{ codigo: "restaurante", activa: true }] },
};
const CATALOGO = [
  { id: "1", codigo: "CAF-1", nombre: "Café americano", categoria: "Bebidas", precio: 6.5, atributos: { INTERNO: "x", DESCRIPCION: "  Espresso doble alargado.  ", IMAGEN: "https://img.example.com/cafe.jpg" } },
  { id: "2", codigo: "TOR-1", nombre: "Torta de chocolate", categoria: "Postres", precio: 12, atributos: {} },
  { id: "3", codigo: "AGU-1", nombre: "Agua", categoria: "Bebidas", precio: null, atributos: {} },
  { id: "4", codigo: "ESP-1", nombre: "Especial del día", categoria: null, precio: 20, atributos: { IMAGEN: "javascript:alert(1)", DESCRIPCION: "   " } },
  { id: "5", codigo: "OFF-1", nombre: "Plato retirado", categoria: "Bebidas", precio: 1, atributos: {}, activo: false },
];

function nucleoFalso() {
  const llamadas = [];
  return {
    llamadas,
    documentos: { registrarTipo() {} },
    clientes: {},
    catalogo: {
      async listar(args) {
        llamadas.push(args);
        assert.equal(args.empresaId, "e1", "solo se lee el catálogo de la empresa del slug");
        return CATALOGO.filter((i) => i.activo !== false).slice(args.saltar ?? 0, (args.saltar ?? 0) + args.limite);
      },
      async obtener({ empresaId, codigo }) {
        assert.equal(empresaId, "e1");
        if (typeof codigo !== "string" || !/^[A-Za-z0-9-]{1,40}$/.test(codigo)) throw new ErrorCatalogo("DATOS_INVALIDOS", "código inválido");
        const i = CATALOGO.find((x) => x.codigo.toLowerCase() === codigo.toLowerCase());
        if (!i) throw new ErrorCatalogo("NO_ENCONTRADO", "ítem no encontrado");
        return { activo: true, ...i };
      },
    },
    modelos: { Empresa: { findOne: ({ slug }) => ({ lean: async () => EMPRESAS[slug] ?? null }) } },
    autenticar: () => (req, res, next) => res.status(401).json({ error: "no autenticado" }),
    requierePermiso: middleware,
    eventos: { middleware },
    auth: { exigirCsrf() {} },
  };
}

describe("servicio público: carta", () => {
  const publico = crearPublico(nucleoFalso());

  it("agrupa por categoría, lo sin categoría va al final y no expone atributos", async () => {
    const c = await publico.carta({ slug: "cafe-central" });
    assert.deepEqual(c.empresa, { nombre: "Café Central", slug: "cafe-central", moneda: "PEN" });
    assert.deepEqual(c.categorias.map((x) => x.nombre), ["Bebidas", "Postres", "Otros"]);
    assert.deepEqual(c.categorias[0].items, [
      { codigo: "CAF-1", nombre: "Café americano", precio: 6.5 },
      { codigo: "AGU-1", nombre: "Agua", precio: null },
    ]);
    assert.ok(!JSON.stringify(c).includes("INTERNO"));
  });

  it("rechaza con el mismo 404 slug inexistente, mal formado, sin el servicio, servicio apagado o empresa dada de baja", async () => {
    for (const slug of ["no-existe", "../x", "Cafe-Central", "", "sin-servicio", "servicio-off", "empresa-baja", undefined]) {
      await assert.rejects(publico.carta({ slug }), (e) => e.status === 404 && e.codigo === "NO_ENCONTRADO", `slug ${slug}`);
    }
  });

  it("agruparPorCategoria no cambia el orden dentro de cada categoría", () => {
    const g = agruparPorCategoria([{ codigo: "B", nombre: "B", categoria: " X " }, { codigo: "A", nombre: "A", categoria: "X" }]);
    assert.deepEqual(g, [{ nombre: "X", items: [{ codigo: "B", nombre: "B", precio: null }, { codigo: "A", nombre: "A", precio: null }] }]);
  });
});

describe("servicio público: detalle del plato", () => {
  const publico = crearPublico(nucleoFalso());

  it("trae descripción y foto, y solo esos dos campos de los atributos", async () => {
    const d = await publico.plato({ slug: "cafe-central", codigo: "CAF-1" });
    assert.deepEqual(d.plato, { codigo: "CAF-1", nombre: "Café americano", categoria: "Bebidas", precio: 6.5, descripcion: "Espresso doble alargado.", imagen: "https://img.example.com/cafe.jpg" });
    assert.deepEqual(d.empresa, { nombre: "Café Central", slug: "cafe-central", moneda: "PEN" });
    assert.ok(!JSON.stringify(d).includes("INTERNO"));
  });

  it("foto y descripción son opcionales: sin ellas o con valores inservibles salen null", async () => {
    const sin = await publico.plato({ slug: "cafe-central", codigo: "AGU-1" });
    assert.equal(sin.plato.imagen, null);
    assert.equal(sin.plato.descripcion, null);
    const malo = await publico.plato({ slug: "cafe-central", codigo: "ESP-1" });
    assert.equal(malo.plato.imagen, null, "javascript: no sale");
    assert.equal(malo.plato.descripcion, null, "solo espacios = sin descripción");
  });

  it("urlImagenSegura: solo https absolutas, sin credenciales ni exceso de largo", () => {
    assert.equal(urlImagenSegura("https://a.com/x.png"), "https://a.com/x.png");
    for (const v of ["http://a.com/x.png", "javascript:alert(1)", "data:image/png;base64,AAA", "//a.com/x.png", "/x.png", "https://u:p@a.com/x.png", "", null, 5, `https://a.com/${"x".repeat(500)}`])
      assert.equal(urlImagenSegura(v), null, String(v).slice(0, 30));
  });

  it("las reseñas son de ejemplo, solo texto y estrellas, y el promedio cuadra", async () => {
    const { resenas } = await publico.plato({ slug: "cafe-central", codigo: "CAF-1" });
    assert.equal(resenas.demo, true);
    assert.equal(resenas.total, resenas.resenas.length);
    assert.equal(resenas.promedio, Math.round((resenas.resenas.reduce((n, r) => n + r.estrellas, 0) / resenas.total) * 10) / 10);
    for (const r of resenas.resenas) assert.deepEqual(Object.keys(r).sort(), ["autor", "estrellas", "texto", "ts"], "sin imágenes ni videos");
    resenas.resenas[0].texto = "cambiado";
    assert.notEqual(resenasDe().resenas[0].texto, "cambiado");
  });

  it("404 con el mismo mensaje: plato inexistente, desactivado, código inválido o empresa inválida", async () => {
    for (const codigo of ["NO-HAY", "OFF-1", "../etc", "a b"])
      await assert.rejects(publico.plato({ slug: "cafe-central", codigo }), (e) => e.status === 404 && e.codigo === "NO_ENCONTRADO" && /plato/.test(e.message), codigo);
    await assert.rejects(publico.plato({ slug: "no-existe", codigo: "CAF-1" }), (e) => e.status === 404);
  });
});

describe("cliente fijo", () => {
  it("es siempre el mismo, marcado como demostración, y devuelve copias", async () => {
    const publico = crearPublico(nucleoFalso());
    const a = await publico.cliente({ slug: "cafe-central" });
    assert.equal(a.demo, true);
    assert.equal(a.nombre, CLIENTE_DEMO.nombre);
    assert.equal(a.puntos, 120);
    assert.equal(a.puntos, a.movimientos.reduce((n, m) => n + m.puntos, 0) + 0, "los movimientos suman los puntos");
    a.movimientos[0].puntos = 999;
    assert.equal(clienteActual().movimientos[0].puntos, 45);
  });
  it("también exige una empresa válida", async () => {
    await assert.rejects(crearPublico(nucleoFalso()).cliente({ slug: "no-existe" }), (e) => e.status === 404);
  });
});

describe("rutas públicas por HTTP", () => {
  let server, url, nucleo;
  before(async () => {
    nucleo = nucleoFalso();
    const app = express();
    app.use("/base/restaurante", createRouter({ core: nucleo }));
    await new Promise((r) => (server = app.listen(0, r)));
    url = `http://127.0.0.1:${server.address().port}/base/restaurante`;
  });
  after(() => server.close());

  it("la página responde sin sesión, sin caché, con <base> en la raíz del montaje", async () => {
    const r = await fetch(`${url}/catalogo/cafe-central`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /html/);
    assert.match(r.headers.get("cache-control"), /no-cache/);
    const html = await r.text();
    assert.match(html, /<base href="\/base\/restaurante\/" \/>/);
    assert.match(html, /id="raiz"/);
    assert.match(html, /assets\/catalogo-[^"]+\.js/);
    assert.ok(html.indexOf("<base") < html.indexOf("<script"), "<base> va antes de cualquier recurso");
  });

  it("la carta responde sin sesión", async () => {
    const r = await fetch(`${url}/publico/cafe-central/carta`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("cache-control"), /max-age=30/);
    const d = await r.json();
    assert.equal(d.empresa.nombre, "Café Central");
    assert.equal(d.categorias.length, 3);
  });

  it("el detalle del plato responde sin sesión; un plato desconocido da 404 y no 500", async () => {
    const r = await fetch(`${url}/publico/cafe-central/plato/CAF-1`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).plato.nombre, "Café americano");
    const no = await fetch(`${url}/publico/cafe-central/plato/NO-HAY`);
    assert.equal(no.status, 404);
    assert.equal((await no.json()).error, "plato no encontrado");
  });

  it("el cliente responde sin sesión y nunca se cachea", async () => {
    const r = await fetch(`${url}/publico/cafe-central/cliente`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal((await r.json()).demo, true);
  });

  it("empresa desconocida: 404 con mensaje, no un error 500", async () => {
    const r = await fetch(`${url}/publico/no-existe/carta`);
    assert.equal(r.status, 404);
    assert.equal((await r.json()).codigo, "NO_ENCONTRADO");
  });

  it("la API de personal sigue exigiendo sesión", async () => {
    assert.equal((await fetch(`${url}/pedidos`)).status, 401);
  });
});

describe("límite de frecuencia", () => {
  it("responde 429 con Retry-After al pasar el máximo y se renueva con la ventana", () => {
    let t = 0;
    const lim = limitadorPorIp({ ventanaMs: 1000, max: 2, ahora: () => t });
    const llamar = () => {
      const r = { code: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json() { return this; } };
      let paso = false;
      lim({ ip: "1.1.1.1" }, r, () => (paso = true));
      return { paso, r };
    };
    assert.equal(llamar().paso, true);
    assert.equal(llamar().paso, true);
    const bloqueada = llamar();
    assert.equal(bloqueada.paso, false);
    assert.equal(bloqueada.r.code, 429);
    assert.ok(Number(bloqueada.r.headers["Retry-After"]) >= 1);
    t = 1500;
    assert.equal(llamar().paso, true);
  });
});

test("paginaCatalogo escapa la base y no duplica la barra final", () => {
  assert.match(paginaCatalogo("<head></head>", "/a/b/"), /<base href="\/a\/b\/" \/>/);
  assert.match(paginaCatalogo("<head></head>", '/x"y'), /href="\/x&quot;y\/"/);
});

describe("lógica del front de la carta", () => {
  it("slugDesdeUbicacion: ruta normal, con barra final, codificada y por query en desarrollo", () => {
    assert.equal(slugDesdeUbicacion("/restaurante/catalogo/cafe-central"), "cafe-central");
    assert.equal(slugDesdeUbicacion("/base/restaurante/catalogo/cafe-central/"), "cafe-central");
    assert.equal(slugDesdeUbicacion("/restaurante/catalogo/caf%C3%A9"), "café");
    assert.equal(slugDesdeUbicacion("/catalogo.html", "?empresa=mi-local"), "mi-local");
    assert.equal(slugDesdeUbicacion("/catalogo.html", ""), null);
    assert.equal(slugDesdeUbicacion("/restaurante/catalogo/%E0%A4%A"), null);
  });
  it("formatoPrecio: moneda, sin precio y moneda inválida", () => {
    assert.equal(formatoPrecio(null, "PEN"), "Consultar");
    assert.match(formatoPrecio(6.5, "PEN"), /6[.,]50/);
    assert.equal(formatoPrecio(6.5), "6.50");
    assert.equal(formatoPrecio(6.5, "XX"), "6.50 XX");
  });
  it("filtrarCarta: por texto sin tildes ni mayúsculas, por código y por categoría", () => {
    const cats = [{ nombre: "Bebidas", items: [{ codigo: "CAF-1", nombre: "Café americano", precio: 1 }, { codigo: "AGU-1", nombre: "Agua", precio: 1 }] }, { nombre: "Postres", items: [{ codigo: "TOR-1", nombre: "Torta", precio: 1 }] }];
    assert.equal(totalItems(filtrarCarta(cats)), 3);
    assert.deepEqual(filtrarCarta(cats, { texto: "CAFE" }).map((c) => c.items[0].codigo), ["CAF-1"]);
    assert.deepEqual(filtrarCarta(cats, { texto: "tor-1" }).map((c) => c.nombre), ["Postres"]);
    assert.deepEqual(filtrarCarta(cats, { categoria: "Postres" }).map((c) => c.nombre), ["Postres"]);
    assert.deepEqual(filtrarCarta(cats, { texto: "zzz" }), []);
  });
  it("rutaDesdeHash y hashPlato: ida y vuelta, y lo desconocido cae en la carta", () => {
    assert.deepEqual(rutaDesdeHash("#/plato/CAF-1"), { vista: "plato", codigo: "CAF-1" });
    assert.deepEqual(rutaDesdeHash(hashPlato("A/B 1")), { vista: "plato", codigo: "A/B 1" });
    for (const h of ["", "#", "#/otra", "#/plato/", "#/plato/a/b", "#/plato/%E0%A4%A", undefined])
      assert.deepEqual(rutaDesdeHash(h), { vista: "carta" }, String(h));
  });
  it("estrellasLlenas y formatoNota", () => {
    assert.equal(estrellasLlenas(4.7), 5);
    assert.equal(estrellasLlenas(4.4), 4);
    assert.equal(estrellasLlenas(9), 5);
    assert.equal(estrellasLlenas(-1), 0);
    assert.equal(estrellasLlenas("x"), 0);
    assert.equal(formatoNota(4.67), "4,7");
    assert.equal(formatoNota(undefined), "—");
  });
  it("formatoPuntos", () => {
    assert.equal(formatoPuntos(45), "+45");
    assert.equal(formatoPuntos(-20), "−20");
    assert.equal(formatoPuntos(0), "0");
  });
});
