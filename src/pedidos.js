import { conEmpresa, permite } from "core";
import { ErrorPedido } from "./errores.js";
import {
  validarCode,
  validarCreacion,
  validarEdicion,
  validarCoherencia,
  calcularTotales,
} from "./validacion.js";

const TIPO = "pedido";

// Servicio de pedidos. Recibe el núcleo ya creado (no abre conexiones). Cada operación recibe
// `empresaId` y `actor = { usuarioId, permisos }` y comprueba su permiso, como en empleados, clientes y
// catálogo: protege aunque una ruta se monte sin requierePermiso. Los permisos de estación para cambiar
// de estado los verifica el motor de documentos.
export function crearServicioPedidos(core) {
  const { documentos, catalogo, clientes } = core;

  const exigir = (actor, permiso) => {
    if (!actor || !permite(actor.permisos ?? [], permiso))
      throw new ErrorPedido("PERMISO_INSUFICIENTE", `permiso insuficiente (${permiso})`);
  };

  // Solo los documentos de tipo pedido: el motor guarda también los de otros servicios
  async function cargar(code, version) {
    validarCode(code);
    const d = await documentos.obtener({ code, version });
    if (!d || d.tipo !== TIPO) throw new ErrorPedido("NO_ENCONTRADO", "pedido no encontrado");
    return d;
  }

  // Une las líneas del cliente con su copia del catálogo por posición (5.16) y calcula los importes.
  // Una línea del catálogo con `precio` propio sustituye el precio de la copia y guarda el del catálogo
  // en `precioCatalogo` (el original queda a la vista). Poner un precio propio exige la estación de
  // administración, salvo repetir uno que el pedido ya tenía (`preciosVigentes`: código → precio), para
  // que quien edita un pedido con un precio ya cambiado no necesite el permiso solo por guardarlo.
  async function armarLineas({ empresaId, actor, lineas, preciosVigentes = new Map() }) {
    const conPrecio = lineas.filter((l) => l.precio !== undefined);
    if (conPrecio.some((l) => preciosVigentes.get(String(l.item).toUpperCase()) !== l.precio))
      exigir(actor, "estacion:administracion");
    const copias = (await catalogo.instantanea({ empresaId, items: lineas.map((l) => l.item) })).map((c, i) =>
      lineas[i].precio === undefined
        ? c
        : { ...c, precioCatalogo: c.precio ?? null, precio: lineas[i].precio, precioModificado: true },
    );
    const { subtotales, total } = calcularTotales(copias, lineas.map((l) => l.cantidad));
    return {
      snapshotLineas: copias,
      docLineas: lineas.map((l, i) => ({ cantidad: l.cantidad, notas: l.notas, subtotal: subtotales[i] })),
      total,
    };
  }

  const resumen = (d) => ({
    code: d.code,
    estado: d.estado,
    version: d.version,
    canal: d.payload?.doc?.canal ?? null,
    mesa: d.payload?.doc?.mesa ?? null,
    referencia: d.payload?.doc?.referencia ?? null,
    total: d.payload?.doc?.total ?? null,
    moneda: d.payload?.doc?.moneda ?? null,
    creadoTs: d.createdAt ?? null,
  });

  const completo = (d) => ({
    ...resumen(d),
    doc: d.payload?.doc ?? {},
    snapshot: d.snapshot ?? {},
    historial: d.historial ?? [],
    creadoPor: d.creadoPor ?? null,
    versionPor: d.versionPor ?? null,
    versionTs: d.versionTs ?? null,
  });

  async function crear({ empresaId, actor, ...cuerpo }) {
    exigir(actor, "documento:crear");
    const p = validarCreacion(cuerpo);
    return await conEmpresa(empresaId, async () => {
      const { snapshotLineas, docLineas, total } = await armarLineas({ empresaId, actor, lineas: p.lineas });
      const cliente = p.clienteId
        ? await clientes.instantanea({ empresaId, clienteId: p.clienteId, campos: ["nombre", "telefono"] })
        : null;
      const moneda = await catalogo.moneda({ empresaId });
      const d = await documentos.crear({
        tipo: TIPO,
        usuarioId: actor.usuarioId,
        snapshot: { lineas: snapshotLineas, cliente },
        doc: {
          canal: p.canal,
          mesa: p.mesa,
          referencia: p.referencia,
          entrega: p.entrega,
          notas: p.notas,
          lineas: docLineas,
          moneda,
          total,
        },
      });
      return completo(d);
    });
  }

  async function obtener({ empresaId, actor, code, version }) {
    exigir(actor, "documento:leer");
    return await conEmpresa(empresaId, async () => completo(await cargar(code, version)));
  }

  async function listar({ empresaId, actor, estado, limite = 50, saltar = 0 }) {
    exigir(actor, "documento:leer");
    const n = Math.min(Math.max(Number.parseInt(limite, 10) || 50, 1), 200);
    const s = Math.max(Number.parseInt(saltar, 10) || 0, 0);
    return await conEmpresa(empresaId, async () => {
      const lista = await documentos.listar({ tipo: TIPO, estado, limite: n, saltar: s });
      return lista.map(resumen);
    });
  }

  // Cambia el contenido sin cambiar de estado (versión nueva). `lineas` reemplaza todas las líneas.
  async function editar({ empresaId, actor, code, esperaVersion, ...cuerpo }) {
    exigir(actor, "documento:editar");
    const cambio = validarEdicion(cuerpo);
    return await conEmpresa(empresaId, async () => {
      const actual = await cargar(code);
      const doc = { ...actual.payload.doc };
      for (const k of ["mesa", "referencia", "entrega", "notas"])
        if (cambio[k] !== undefined) doc[k] = cambio[k];
      validarCoherencia(doc);
      let snapshot;
      if (cambio.lineas) {
        const { snapshotLineas, docLineas, total } = await armarLineas({
          empresaId,
          actor,
          lineas: cambio.lineas,
          preciosVigentes: new Map(
            (actual.snapshot?.lineas ?? []).filter((x) => x.precioModificado).map((x) => [x.codigo, x.precio]),
          ),
        });
        doc.lineas = docLineas;
        doc.total = total;
        snapshot = { ...actual.snapshot, lineas: snapshotLineas };
      }
      const nuevo = await documentos.nuevaVersion({
        code,
        doc,
        snapshot,
        usuarioId: actor.usuarioId,
        esperaVersion: esperaVersion ?? actual.version,
      });
      return completo(nuevo);
    });
  }

  async function mover({ empresaId, actor, code, a, motivo, esperaVersion }) {
    exigir(actor, "documento:editar");
    return await conEmpresa(empresaId, async () => {
      await cargar(code);
      const d = await documentos.transicionar({
        code,
        a,
        usuarioId: actor.usuarioId,
        permisos: actor.permisos,
        motivo,
        esperaVersion,
      });
      return completo(d);
    });
  }

  return {
    crear,
    obtener,
    listar,
    editar,
    enviarACocina: (p) => mover({ ...p, a: "en_cocina" }),
    marcarLista: (p) => mover({ ...p, a: "lista" }),
    entregar: (p) => mover({ ...p, a: "entregada" }),
    cobrar: (p) => mover({ ...p, a: "pagada" }),
    anular: (p) => mover({ ...p, a: "anulada" }),
  };
}
