import { ErrorFidelizacion } from "core";

/**
 * Vales del cliente en la carta pública (arquitectura 5.30). Van con la sesión del cliente (`cs_<slug>`): el cliente
 * es siempre el de la sesión, nunca uno que mande el cuerpo. Los lee, emite y cancela `core.fidelizacion`.
 *
 *   GET  /publico/:empresa/cuenta/vales                     { beneficios: [...activos], vales: [...míos] }
 *   POST /publico/:empresa/cuenta/vales { beneficioId }     201 { ticket, saldo }   canjea puntos por un vale
 *   POST /publico/:empresa/cuenta/vales/:codigo/cancelar    { ticket, saldo }       devuelve los puntos
 */
export function crearManejadoresVales(core, empresaDe) {
  const f = core.fidelizacion;
  const sesion = core.cuentasCliente.autenticarCliente({ empresaDe });

  const envolver = (fn) => async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      await fn(req, res);
    } catch (e) {
      if (e instanceof ErrorFidelizacion)
        return res.status(e.status).json({ error: e.message, codigo: e.codigo, ...(e.detalle?.saldo !== undefined ? { saldo: e.detalle.saldo } : {}) });
      next(e);
    }
  };
  const quien = (req) => ({ empresaId: req.cliente.empresaId, clienteId: req.cliente.clienteId });

  return {
    sesion,
    listar: envolver(async (req, res) => {
      const q = quien(req);
      const [beneficios, vales] = await Promise.all([f.beneficios.activos({ empresaId: q.empresaId }), f.tickets.de(q)]);
      res.status(200).json({ beneficios, vales });
    }),
    emitir: envolver(async (req, res) =>
      res.status(201).json(await f.tickets.emitirMio({ ...quien(req), beneficioId: req.body?.beneficioId })),
    ),
    cancelar: envolver(async (req, res) =>
      res.status(200).json(await f.tickets.cancelarMio({ ...quien(req), codigo: req.params.codigo })),
    ),
  };
}
