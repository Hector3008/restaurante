import { ErrorDocumento, ErrorCatalogo, ErrorCliente, ErrorAuth } from "core";
import { ErrorPedido } from "./errores.js";

const STATUS_DOCUMENTO = {
  DOCUMENTO_NO_ENCONTRADO: 404,
  CONFLICTO_VERSION: 409,
  PERMISO_INSUFICIENTE: 403,
};

function responder(res, e, next) {
  if (e instanceof ErrorPedido || e instanceof ErrorCatalogo || e instanceof ErrorCliente || e instanceof ErrorAuth)
    return res.status(e.status).json({ error: e.message, codigo: e.codigo, ...(e.detalle ?? {}) });
  if (e instanceof ErrorDocumento)
    return res
      .status(STATUS_DOCUMENTO[e.codigo] ?? 400)
      .json({ error: e.message, codigo: e.codigo, ...(e.detalle ? { detalle: e.detalle } : {}) });
  return next(e);
}

/**
 * Rutas de pedidos. Cada una sale con sus middlewares en orden
 * (autenticar → requierePermiso → estación del contexto de eventos → handler), así no se puede
 * olvidar ninguno. La estación la fija la ruta, nunca el cliente (arquitectura 5.4).
 *
 *   GET  /pedidos (?estado=a,b &limite= &saltar=)        documento:leer
 *   GET  /pedidos/:code (?version=)                       documento:leer
 *   POST /pedidos                                         documento:crear
 *   PUT  /pedidos/:code                                   documento:editar
 *   POST /pedidos/:code/enviar | lista | entregar | cobrar | anular     documento:editar
 *        (el motor pide además la estación de cada paso; anular lleva { motivo: { codigo, detalle? } })
 */
export function montarRutasPedidos(router, core, pedidos) {
  const { autenticar, requierePermiso, eventos, auth } = core;

  const envolver = (escribe, fn) => async (req, res, next) => {
    try {
      if (escribe) auth.exigirCsrf(req);
      await fn(req, res);
    } catch (e) {
      responder(res, e, next);
    }
  };
  const base = (req) => ({
    empresaId: req.auth.empresaId,
    actor: { usuarioId: req.auth.usuarioId, permisos: req.rol?.permisos ?? [] },
  });
  const con = (permiso, estacion) => [autenticar(), requierePermiso(permiso), eventos.middleware({ estacion })];

  const leer = con("documento:leer", "creacion");
  const crear = con("documento:crear", "creacion");
  const editar = (estacion) => con("documento:editar", estacion);

  router.get(
    "/pedidos",
    ...leer,
    envolver(false, async (req, res) => {
      const q = req.query ?? {};
      const estado = q.estado ? String(q.estado).split(",").filter(Boolean) : undefined;
      res.status(200).json({ pedidos: await pedidos.listar({ ...base(req), estado, limite: q.limite, saltar: q.saltar }) });
    }),
  );
  router.get(
    "/pedidos/:code",
    ...leer,
    envolver(false, async (req, res) => {
      const v = req.query?.version;
      const version = v === undefined ? undefined : Number.parseInt(v, 10);
      if (version !== undefined && !Number.isInteger(version))
        throw new ErrorPedido("DATOS_INVALIDOS", "version debe ser un entero");
      res.status(200).json(await pedidos.obtener({ ...base(req), code: req.params.code, version }));
    }),
  );
  router.post(
    "/pedidos",
    ...crear,
    envolver(true, async (req, res) => res.status(201).json(await pedidos.crear({ ...base(req), ...(req.body ?? {}) }))),
  );
  router.put(
    "/pedidos/:code",
    ...editar("creacion"),
    envolver(true, async (req, res) => {
      const { esperaVersion, ...cuerpo } = req.body ?? {};
      res.status(200).json(await pedidos.editar({ ...base(req), code: req.params.code, esperaVersion, ...cuerpo }));
    }),
  );

  const paso = (ruta, metodo, estacion) =>
    router.post(
      `/pedidos/:code/${ruta}`,
      ...editar(estacion),
      envolver(true, async (req, res) => {
        const { esperaVersion, motivo } = req.body ?? {};
        res.status(200).json(await pedidos[metodo]({ ...base(req), code: req.params.code, esperaVersion, motivo }));
      }),
    );
  paso("enviar", "enviarACocina", "creacion");
  paso("lista", "marcarLista", "cocina");
  paso("entregar", "entregar", "creacion");
  paso("cobrar", "cobrar", "administracion");
  paso("anular", "anular", "administracion");

  return router;
}
