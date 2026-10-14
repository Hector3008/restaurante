import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { crearServicio } from "./servicio.js";
import { montarRutas } from "./http.js";
import { crearPublico, CAMPOS_PLATO } from "./publico.js";
import { montarRutasPublicas } from "./publico-http.js";
import { TIPO_ITEM, TIPO_PEDIDO } from "./tipos.js";

export { TIPO_ITEM, TIPO_PEDIDO, MOTIVOS_ANULACION } from "./tipos.js";
export { ErrorPedido } from "./errores.js";
export { crearServicio } from "./servicio.js";

const DIST_POR_DEFECTO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "client", "dist");

/**
 * Punto de entrada del servicio. El gateway lo monta así (misma forma que microservicio-prueba-):
 *
 *   import { createRouter } from "restaurante";
 *   gateway.use("/restaurante", createRouter({ core }));
 *
 * Registra los tipos de documento `doc_item` y `pedido` al montarse (idempotente). No abre conexiones: usa el núcleo
 * del gateway. `db` se acepta por compatibilidad con los demás servicios y hoy no se usa.
 *
 * Además de la API (/pedidos y /items), sirve el front compilado (client/dist, commiteado) en la raíz del montaje:
 * `<base>/restaurante/`. El front pide la API en relativo (`../restaurante/pedidos`), así que debe
 * montarse en `<base>/restaurante/`, igual que `cuenta`.
 *
 * Y la vista pública de la carta, sin sesión: `<base>/restaurante/catalogo/<slug-de-la-empresa>` (publico-http.js).
 */
export function createRouter({ core, dist = DIST_POR_DEFECTO } = {}) {
  if (!core?.documentos || !core?.catalogo || !core?.clientes)
    throw new Error("createRouter: se requiere { core } (el núcleo creado por el gateway)");
  for (const archivo of ["index.html", "catalogo.html"])
    if (!fs.existsSync(path.join(dist, archivo)))
      throw new Error(
        `restaurante: no existe ${path.join(dist, archivo)}. Ejecuta "npm run build" y commitea client/dist.`,
      );

  core.documentos.registrarTipo(TIPO_ITEM);
  core.documentos.registrarTipo(TIPO_PEDIDO);
  // Campos del plato que el catálogo valida por tipo (descripción y foto de la carta pública).
  core.catalogo.registrarEsquema?.({ campos: CAMPOS_PLATO });
  const servicio = crearServicio(core);

  const router = express.Router();
  router.use(express.json());
  montarRutas(router, core, servicio);
  // Vista pública de la carta (sin sesión): /catalogo/:empresa y /publico/:empresa/...
  montarRutasPublicas(router, crearPublico(core), fs.readFileSync(path.join(dist, "catalogo.html"), "utf8"));
  router.use(
    express.static(dist, {
      index: "index.html",
      setHeaders(res, archivo) {
        // El HTML no se cachea; los archivos con hash en el nombre sí.
        if (archivo.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
        else res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );
  router.servicio = servicio; // para pruebas y para otros módulos del servicio
  return router;
}
