import express from "express";
import { crearServicioPedidos } from "./pedidos.js";
import { montarRutasPedidos } from "./http.js";
import { TIPO_PEDIDO } from "./tipo-pedido.js";

export { TIPO_PEDIDO, MOTIVOS_ANULACION } from "./tipo-pedido.js";
export { ErrorPedido } from "./errores.js";
export { crearServicioPedidos } from "./pedidos.js";

/**
 * Punto de entrada del servicio. El gateway lo monta así (misma forma que microservicio-prueba-):
 *
 *   import { createRouter } from "restaurante";
 *   gateway.use("/restaurante", createRouter({ core }));
 *
 * Registra el tipo de documento `pedido` al montarse (idempotente). No abre conexiones: usa el núcleo
 * del gateway. `db` se acepta por compatibilidad con los demás servicios y hoy no se usa.
 */
export function createRouter({ core } = {}) {
  if (!core?.documentos || !core?.catalogo || !core?.clientes)
    throw new Error("createRouter: se requiere { core } (el núcleo creado por el gateway)");

  core.documentos.registrarTipo(TIPO_PEDIDO);
  const pedidos = crearServicioPedidos(core);

  const router = express.Router();
  router.use(express.json());
  montarRutasPedidos(router, core, pedidos);
  router.pedidos = pedidos; // para pruebas y para otros módulos del servicio
  return router;
}
