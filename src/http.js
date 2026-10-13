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
 * Rutas del restaurante. Cada una sale con sus middlewares en orden
 * (autenticar → requierePermiso → estación del contexto de eventos → handler), así no se puede
 * olvidar ninguno. La estación la fija la ruta, nunca el cliente (arquitectura 5.4).
 *
 * Pedidos (lo que se cobra: todos los ítems de una mesa o persona)
 *   GET  /pedidos (?estado=a,b &limite= &saltar=)        documento:leer
 *   GET  /pedidos/:code (?version=)                       documento:leer
 *   POST /pedidos        { canal, mesa|referencia|entrega, items: [...] }   documento:crear
 *   POST /pedidos/:code/items   { items: [...] }          documento:crear   (más ítems en el mismo pedido)
 *   PUT  /pedidos/:code  { esperaVersion?, mesa, referencia, entrega, notas }   documento:editar
 *   POST /pedidos/:code/cobrar                            documento:editar + estación administración (el motor)
 *   POST /pedidos/:code/anular  { motivo: { codigo, detalle? } }   igual
 *
 * Ítems (un ítem que se mueve por las estaciones; cocina trabaja con estos)
 *   GET  /items (?estado=a,b &limite= &saltar=)        documento:leer
 *   GET  /items/:code                                   documento:leer
 *   POST /items/:code/lista                             documento:editar + estación cocina (el motor)
 *   POST /items/:code/entregar                          documento:editar
 *   POST /items/:code/precio  { precio }                documento:editar + estación administración (solo el precio)
 *   POST /items/:code/anular  { motivo }                documento:editar (+ administración si ya salió de cocina)
 */
export function montarRutas(router, core, servicio) {
  const { autenticar, requierePermiso, eventos, auth } = core;
  const { pedidos, items } = servicio;

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

  const estados = (q) => (q.estado ? String(q.estado).split(",").filter(Boolean) : undefined);
  const versionDe = (q) => {
    const v = q?.version;
    if (v === undefined) return undefined;
    const n = Number.parseInt(v, 10);
    if (!Number.isInteger(n)) throw new ErrorPedido("DATOS_INVALIDOS", "version debe ser un entero");
    return n;
  };

  // ---------- pedidos ----------
  router.get(
    "/pedidos",
    ...leer,
    envolver(false, async (req, res) => {
      const q = req.query ?? {};
      res.status(200).json({ pedidos: await pedidos.listar({ ...base(req), estado: estados(q), limite: q.limite, saltar: q.saltar }) });
    }),
  );
  router.get(
    "/pedidos/:code",
    ...leer,
    envolver(false, async (req, res) =>
      res.status(200).json(await pedidos.obtener({ ...base(req), code: req.params.code, version: versionDe(req.query) })),
    ),
  );
  router.post(
    "/pedidos",
    ...crear,
    envolver(true, async (req, res) => res.status(201).json(await pedidos.crear({ ...base(req), ...(req.body ?? {}) }))),
  );
  router.post(
    "/pedidos/:code/items",
    ...crear,
    envolver(true, async (req, res) =>
      res.status(201).json(await pedidos.agregarItems({ ...base(req), code: req.params.code, ...(req.body ?? {}) })),
    ),
  );
  router.put(
    "/pedidos/:code",
    ...editar("creacion"),
    envolver(true, async (req, res) => {
      const { esperaVersion, ...cuerpo } = req.body ?? {};
      res.status(200).json(await pedidos.editar({ ...base(req), code: req.params.code, esperaVersion, ...cuerpo }));
    }),
  );
  const pasoPedido = (ruta, metodo) =>
    router.post(
      `/pedidos/:code/${ruta}`,
      ...editar("administracion"),
      envolver(true, async (req, res) => {
        const { esperaVersion, motivo } = req.body ?? {};
        res.status(200).json(await pedidos[metodo]({ ...base(req), code: req.params.code, esperaVersion, motivo }));
      }),
    );
  pasoPedido("cobrar", "cobrar");
  pasoPedido("anular", "anular");

  // ---------- ítems (ítems) ----------
  router.get(
    "/items",
    ...leer,
    envolver(false, async (req, res) => {
      const q = req.query ?? {};
      res.status(200).json({ items: await items.listar({ ...base(req), estado: estados(q), limite: q.limite, saltar: q.saltar }) });
    }),
  );
  router.get(
    "/items/:code",
    ...leer,
    envolver(false, async (req, res) => res.status(200).json(await items.obtener({ ...base(req), code: req.params.code }))),
  );
  const pasoItem = (ruta, metodo, estacion) =>
    router.post(
      `/items/:code/${ruta}`,
      ...editar(estacion),
      envolver(true, async (req, res) => {
        const { esperaVersion, motivo } = req.body ?? {};
        res.status(200).json(await items[metodo]({ ...base(req), code: req.params.code, esperaVersion, motivo }));
      }),
    );
  pasoItem("lista", "marcarLista", "cocina");
  pasoItem("entregar", "entregar", "creacion");
  pasoItem("anular", "anular", "creacion");
  router.post(
    "/items/:code/precio",
    ...editar("administracion"),
    envolver(true, async (req, res) => {
      const { esperaVersion, ...cuerpo } = req.body ?? {};
      res.status(200).json(await items.cambiarPrecio({ ...base(req), code: req.params.code, esperaVersion, ...cuerpo }));
    }),
  );

  return router;
}
