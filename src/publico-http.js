import { ErrorPedido } from "./errores.js";

/**
 * Rutas públicas del restaurante (SIN sesión): la carta de una empresa y el cliente que la mira.
 *
 *   GET /catalogo/:empresa              la página (HTML) de la carta; `:empresa` es el slug
 *   GET /publico/:empresa/carta         { empresa: { nombre, slug, moneda }, categorias: [{ nombre, items }] }
 *   GET /publico/:empresa/plato/:codigo  { empresa, plato: { codigo, nombre, categoria, precio, descripcion, imagen }, resenas }
 *   GET /publico/:empresa/cliente       { demo, nombre, puntos, movimientos }   (cliente fijo por ahora)
 *
 * Solo lectura (GET), así que no necesitan `x-requested-with`. Como no hay sesión que limite el abuso, llevan
 * un límite de frecuencia por IP, en memoria (como los de auth: se reinicia con el servidor y no se comparte
 * entre instancias; ver sección 6).
 */

const VENTANA_MS = 60_000;
const MAX_POR_VENTANA = 60;

export function limitadorPorIp({ ventanaMs = VENTANA_MS, max = MAX_POR_VENTANA, ahora = Date.now } = {}) {
  const cuentas = new Map(); // ip -> { desde, n }
  return (req, res, next) => {
    const t = ahora();
    if (cuentas.size > 5000) for (const [ip, c] of cuentas) if (t - c.desde >= ventanaMs) cuentas.delete(ip);
    const ip = req.ip ?? "desconocida";
    let c = cuentas.get(ip);
    if (!c || t - c.desde >= ventanaMs) {
      c = { desde: t, n: 0 };
      cuentas.set(ip, c);
    }
    c.n += 1;
    if (c.n > max) {
      res.setHeader("Retry-After", String(Math.ceil((c.desde + ventanaMs - t) / 1000)));
      return res.status(429).json({ error: "Demasiadas consultas. Espera un momento.", codigo: "DEMASIADAS_CONSULTAS" });
    }
    next();
  };
}

const escaparAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * La página vive en `<base>/restaurante/catalogo/<slug>`, una ruta más profunda que la del front de personal
 * (`<base>/restaurante/`). Los archivos compilados se piden en relativo, así que se fija `<base href>` a la
 * raíz del montaje: así el HTML sirve con cualquier BASE_PATH y api.js calcula bien la ruta de la API.
 */
export function paginaCatalogo(html, baseUrl) {
  const base = `${baseUrl.replace(/\/+$/, "")}/`;
  return html.replace("<head>", `<head>\n    <base href="${escaparAttr(base)}" />`);
}

export function montarRutasPublicas(router, publico, htmlCatalogo, limitador = limitadorPorIp()) {
  const envolver = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof ErrorPedido) return res.status(e.status).json({ error: e.message, codigo: e.codigo });
      next(e);
    }
  };

  router.get("/catalogo/:empresa", limitador, (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(paginaCatalogo(htmlCatalogo, req.baseUrl));
  });

  router.get(
    "/publico/:empresa/carta",
    limitador,
    envolver(async (req, res) => {
      res.setHeader("Cache-Control", "public, max-age=30");
      res.status(200).json(await publico.carta({ slug: req.params.empresa }));
    }),
  );

  router.get(
    "/publico/:empresa/plato/:codigo",
    limitador,
    envolver(async (req, res) => {
      res.setHeader("Cache-Control", "public, max-age=30");
      res.status(200).json(await publico.plato({ slug: req.params.empresa, codigo: req.params.codigo }));
    }),
  );

  router.get(
    "/publico/:empresa/cliente",
    limitador,
    envolver(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json(await publico.cliente({ slug: req.params.empresa }));
    }),
  );
}
