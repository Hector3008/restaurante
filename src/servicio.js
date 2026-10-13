import { conEmpresa, permite } from "core";
import { ErrorPedido } from "./errores.js";
import {
  validarCode,
  validarCreacion,
  validarEdicion,
  validarItems,
  validarCoherencia,
  calcularTotales,
} from "./validacion.js";

export const TIPO_ITEM = "doc_item";
export const TIPO_PEDIDO = "pedido";
const ESTADOS_ITEM_ACTIVOS = ["en_cocina", "lista", "entregado"];

/**
 * Servicio del restaurante: dos cosas separadas (ver tipos.js).
 *
 *   `items`  cada ítem que se pide es un documento propio que se mueve por las estaciones (cocina ve estos).
 *   `pedidos`  agrupa los ítems de una mesa o persona, desde el primero hasta que se paga todo.
 *
 * Recibe el núcleo ya creado (no abre conexiones). Cada operación recibe `empresaId` y
 * `actor = { usuarioId, permisos }` y comprueba su permiso, como en empleados, clientes y catálogo:
 * protege aunque una ruta se monte sin requierePermiso. Los permisos de estación de cada cambio de
 * estado los verifica el motor de documentos.
 *
 * El vínculo va en los dos sentidos: el ítem guarda `pedidoCode` y el pedido guarda la lista de
 * `codigosItems` (códigos). El total de un pedido abierto se calcula siempre desde sus ítems; al pagarlo
 * queda guardado.
 */
export function crearServicio(core) {
  const { documentos, catalogo, clientes } = core;

  const exigir = (actor, permiso) => {
    if (!actor || !permite(actor.permisos ?? [], permiso))
      throw new ErrorPedido("PERMISO_INSUFICIENTE", `permiso insuficiente (${permiso})`);
  };

  // Solo los documentos del tipo `doc_item`: el motor guarda también los de otros servicios
  async function cargar(code, tipo, prefijo, version) {
    validarCode(code, prefijo);
    const d = await documentos.obtener({ code, version });
    if (!d || d.tipo !== tipo)
      throw new ErrorPedido("NO_ENCONTRADO", prefijo === "PD" ? "pedido no encontrado" : "ítem no encontrado");
    return d;
  }
  const cargarPedido = (code, version) => cargar(code, TIPO_PEDIDO, "PD", version);
  const cargarItem = (code) => cargar(code, TIPO_ITEM, "DOC_ITEM");

  // ---------- forma de lo que se devuelve ----------

  const resumenItem = (d) => {
    const x = d.payload?.doc ?? {};
    const s = d.snapshot?.item ?? {};
    return {
      code: d.code,
      estado: d.estado,
      version: d.version,
      pedidoCode: x.pedidoCode ?? null,
      nombre: s.nombre ?? "",
      codigo: s.codigo ?? null,
      origen: s.origen ?? null,
      cantidad: x.cantidad,
      notas: x.notas ?? null,
      precio: s.precio ?? null,
      precioCatalogo: s.precioModificado ? s.precioCatalogo ?? null : s.precio ?? null,
      precioModificado: Boolean(s.precioModificado),
      subtotal: x.subtotal ?? null,
      moneda: x.moneda ?? null,
      creadoTs: d.createdAt ?? null,
    };
  };
  const completoItem = (d) => ({ ...resumenItem(d), historial: d.historial ?? [], creadoPor: d.creadoPor ?? null });

  // Total de lo que se cobra: los ítems no anulados. Un ítem sin precio deja el total en null (nunca se inventa un precio).
  function totalDe(items) {
    let centavos = 0;
    for (const i of items) {
      if (i.estado === "anulado") continue;
      if (i.subtotal === null || i.subtotal === undefined) return null;
      centavos += Math.round(i.subtotal * 100);
    }
    return centavos / 100;
  }

  const resumenPedido = (d, items) => {
    const x = d.payload?.doc ?? {};
    return {
      code: d.code,
      estado: d.estado,
      version: d.version,
      canal: x.canal ?? null,
      mesa: x.mesa ?? null,
      referencia: x.referencia ?? null,
      moneda: x.moneda ?? null,
      total: d.estado === "pagado" ? x.total ?? null : items ? totalDe(items) : x.total ?? null,
      items: items ?? null,
      creadoTs: d.createdAt ?? null,
    };
  };

  async function completoPedido(d) {
    const codes = d.payload?.doc?.codigosItems ?? [];
    const docs = await Promise.all(codes.map((c) => documentos.obtener({ code: c })));
    const items = docs.filter(Boolean).map(resumenItem);
    return {
      ...resumenPedido(d, items),
      doc: d.payload?.doc ?? {},
      snapshot: d.snapshot ?? {},
      historial: d.historial ?? [],
      creadoPor: d.creadoPor ?? null,
      versionPor: d.versionPor ?? null,
      versionTs: d.versionTs ?? null,
    };
  }

  // ---------- ítems: preparar y crear los ítems de un pedido ----------

  // Une los ítems ítems con su copia del catálogo por posición (5.16) y calcula los importes. Un `precio`
  // propio en un ítem del catálogo sustituye el de la copia (guarda el original en `precioCatalogo`) y
  // exige la estación de administración. No escribe nada: se llama antes de crear el pedido, así un ítem
  // que no existe frena todo.
  async function prepararItems({ empresaId, actor, items }) {
    if (items.some((i) => i.precio !== undefined)) exigir(actor, "estacion:administracion");
    const copias = (await catalogo.instantanea({ empresaId, items: items.map((i) => i.item) })).map((c, i) =>
      items[i].precio === undefined
        ? c
        : { ...c, precioCatalogo: c.precio ?? null, precio: items[i].precio, precioModificado: true },
    );
    const { subtotales } = calcularTotales(copias, items.map((i) => i.cantidad));
    return items.map((it, i) => ({ copia: copias[i], cantidad: it.cantidad, notas: it.notas, subtotal: subtotales[i] }));
  }

  // Crea los ítems en orden. Los que alcanzaron a crearse quedan vinculados al pedido aunque uno falle.
  async function crearItems({ actor, pedidoCode, moneda, preparados }) {
    const codigos = [];
    try {
      for (const p of preparados) {
        const d = await documentos.crear({
          tipo: TIPO_ITEM,
          usuarioId: actor.usuarioId,
          snapshot: { item: p.copia },
          doc: { pedidoCode, cantidad: p.cantidad, notas: p.notas, subtotal: p.subtotal, moneda },
        });
        codigos.push(d.code);
      }
    } finally {
      if (codigos.length) await vincular({ actor, pedidoCode, codigos });
    }
    return codigos;
  }

  // Agrega los códigos a la lista del pedido. Otro ítem puede estar agregándose a la vez: se reintenta.
  async function vincular({ actor, pedidoCode, codigos }) {
    for (let intento = 0; ; intento++) {
      const c = await cargarPedido(pedidoCode);
      try {
        await documentos.nuevaVersion({
          code: pedidoCode,
          doc: { ...c.payload.doc, codigosItems: [...(c.payload.doc.codigosItems ?? []), ...codigos] },
          usuarioId: actor.usuarioId,
          esperaVersion: c.version,
        });
        return;
      } catch (e) {
        if (e?.codigo !== "CONFLICTO_VERSION" || intento >= 4) throw e;
      }
    }
  }

  // ---------- pedidos ----------

  // Abre el pedido con su primer ítem: el pedido nace al pedir el primer ítem.
  async function crearPedido({ empresaId, actor, ...cuerpo }) {
    exigir(actor, "documento:crear");
    const p = validarCreacion(cuerpo);
    return await conEmpresa(empresaId, async () => {
      const preparados = await prepararItems({ empresaId, actor, items: p.items });
      const cliente = p.clienteId
        ? await clientes.instantanea({ empresaId, clienteId: p.clienteId, campos: ["nombre", "telefono"] })
        : null;
      const moneda = await catalogo.moneda({ empresaId });
      const pedido = await documentos.crear({
        tipo: TIPO_PEDIDO,
        usuarioId: actor.usuarioId,
        snapshot: { cliente },
        doc: { canal: p.canal, mesa: p.mesa, referencia: p.referencia, entrega: p.entrega, notas: p.notas, moneda, codigosItems: [] },
      });
      await crearItems({ actor, pedidoCode: pedido.code, moneda, preparados });
      return await completoPedido(await cargarPedido(pedido.code));
    });
  }

  async function agregarItems({ empresaId, actor, code, ...cuerpo }) {
    exigir(actor, "documento:crear");
    const items = validarItems(cuerpo);
    return await conEmpresa(empresaId, async () => {
      const pedido = await cargarPedido(code);
      if (pedido.estado !== "abierto") throw new ErrorPedido("ESTADO_INVALIDO", "el pedido ya no está abierto");
      const preparados = await prepararItems({ empresaId, actor, items });
      await crearItems({ actor, pedidoCode: code, moneda: pedido.payload.doc.moneda ?? null, preparados });
      return await completoPedido(await cargarPedido(code));
    });
  }

  async function obtenerPedido({ empresaId, actor, code, version }) {
    exigir(actor, "documento:leer");
    return await conEmpresa(empresaId, async () => completoPedido(await cargarPedido(code, version)));
  }

  const limitar = (limite, def) => Math.min(Math.max(Number.parseInt(limite, 10) || def, 1), 200);

  // Los pedidos abiertos traen sus ítems (una sola consulta de los ítems en curso); los cerrados, solo
  // su total guardado. Límite conocido: se leen hasta 200 ítems en curso en total.
  async function listarPedidos({ empresaId, actor, estado, limite = 50, saltar = 0 }) {
    exigir(actor, "documento:leer");
    const n = limitar(limite, 50);
    const s = Math.max(Number.parseInt(saltar, 10) || 0, 0);
    return await conEmpresa(empresaId, async () => {
      const pedidos = await documentos.listar({ tipo: TIPO_PEDIDO, estado, limite: n, saltar: s });
      const hayAbiertas = pedidos.some((c) => c.estado === "abierto");
      const enCurso = hayAbiertas
        ? await documentos.listar({ tipo: TIPO_ITEM, estado: ESTADOS_ITEM_ACTIVOS, limite: 200 })
        : [];
      const porPedido = new Map();
      for (const d of enCurso) {
        const it = resumenItem(d);
        porPedido.set(it.pedidoCode, [...(porPedido.get(it.pedidoCode) ?? []), it]);
      }
      return pedidos.map((c) =>
        resumenPedido(c, c.estado === "abierto" ? (porPedido.get(c.code) ?? []).sort((a, b) => a.code.localeCompare(b.code)) : null),
      );
    });
  }

  // Cambia los datos del pedido (mesa, a nombre de, entrega, notas) sin tocar sus ítems.
  async function editarPedido({ empresaId, actor, code, esperaVersion, ...cuerpo }) {
    exigir(actor, "documento:editar");
    const cambio = validarEdicion(cuerpo);
    return await conEmpresa(empresaId, async () => {
      const actual = await cargarPedido(code);
      const doc = { ...actual.payload.doc };
      for (const k of ["mesa", "referencia", "entrega", "notas"]) if (cambio[k] !== undefined) doc[k] = cambio[k];
      validarCoherencia(doc);
      const nuevo = await documentos.nuevaVersion({
        code,
        doc,
        usuarioId: actor.usuarioId,
        esperaVersion: esperaVersion ?? actual.version,
      });
      return await completoPedido(nuevo);
    });
  }

  // Cobrar: todo el pedido de una vez, cuando todos los ítems ya se entregaron (o se anuló).
  async function cobrar({ empresaId, actor, code, esperaVersion }) {
    exigir(actor, "documento:editar");
    return await conEmpresa(empresaId, async () => {
      const pedido = await cargarPedido(code);
      const completa = await completoPedido(pedido);
      const sinEntregar = completa.items.filter((i) => i.estado === "en_cocina" || i.estado === "lista");
      if (sinEntregar.length)
        throw new ErrorPedido("ESTADO_INVALIDO", `hay ${sinEntregar.length} item(s) sin entregar`, {
          pendientes: sinEntregar.map((i) => i.code),
        });
      if (!completa.items.some((i) => i.estado === "entregado"))
        throw new ErrorPedido("ESTADO_INVALIDO", "el pedido no tiene nada entregado que cobrar");
      const d = await documentos.transicionar({
        code,
        a: "pagado",
        usuarioId: actor.usuarioId,
        permisos: actor.permisos,
        doc: { ...pedido.payload.doc, total: totalDe(completa.items) },
        esperaVersion,
      });
      return await completoPedido(d);
    });
  }

  // Anular el pedido anula también lo que siga en pie (con el mismo motivo). Si algún ítem no pudo
  // anularse, la respuesta lo dice en `sinAnular`.
  async function anularPedido({ empresaId, actor, code, motivo, esperaVersion }) {
    exigir(actor, "documento:editar");
    return await conEmpresa(empresaId, async () => {
      const pedido = await cargarPedido(code);
      const d = await documentos.transicionar({
        code,
        a: "anulado",
        usuarioId: actor.usuarioId,
        permisos: actor.permisos,
        motivo,
        esperaVersion,
      });
      const sinAnular = [];
      for (const c of pedido.payload.doc.codigosItems ?? []) {
        const it = await documentos.obtener({ code: c });
        if (!it || it.estado === "anulado") continue;
        try {
          await documentos.transicionar({ code: c, a: "anulado", motivo, sistema: true });
        } catch {
          sinAnular.push(c);
        }
      }
      const completa = await completoPedido(d);
      return sinAnular.length ? { ...completa, sinAnular } : completa;
    });
  }

  // ---------- ítems (ítems) ----------

  // Los ítems con el pedido a la que pertenecen (cocina muestra mesa o nombre junto a cada ítem).
  async function listarItems({ empresaId, actor, estado, limite = 100, saltar = 0 }) {
    exigir(actor, "documento:leer");
    const n = limitar(limite, 100);
    const s = Math.max(Number.parseInt(saltar, 10) || 0, 0);
    return await conEmpresa(empresaId, async () => {
      const lista = await documentos.listar({ tipo: TIPO_ITEM, estado, limite: n, saltar: s });
      const abiertos = await documentos.listar({ tipo: TIPO_PEDIDO, estado: "abierto", limite: 200 });
      const porCode = new Map(abiertos.map((c) => [c.code, c]));
      return lista.map((d) => {
        const it = resumenItem(d);
        const c = porCode.get(it.pedidoCode);
        return {
          ...it,
          pedido: c ? { code: c.code, canal: c.payload?.doc?.canal ?? null, mesa: c.payload?.doc?.mesa ?? null, referencia: c.payload?.doc?.referencia ?? null } : null,
        };
      });
    });
  }

  async function obtenerItem({ empresaId, actor, code }) {
    exigir(actor, "documento:leer");
    return await conEmpresa(empresaId, async () => completoItem(await cargarItem(code)));
  }

  // Un ítem solo se mueve mientras su pedido está abierto.
  async function mover({ empresaId, actor, code, a, motivo, esperaVersion }) {
    exigir(actor, "documento:editar");
    return await conEmpresa(empresaId, async () => {
      const item = await cargarItem(code);
      const pedido = await cargarPedido(item.payload.doc.pedidoCode);
      if (pedido.estado !== "abierto") throw new ErrorPedido("ESTADO_INVALIDO", "el pedido de este ítem ya no está abierto");
      // Anular antes de que salga de cocina lo puede hacer quien toma ítems; después, administración
      if (a === "anulado" && item.estado !== "en_cocina") exigir(actor, "estacion:administracion");
      const d = await documentos.transicionar({
        code,
        a,
        usuarioId: actor.usuarioId,
        permisos: actor.permisos,
        motivo,
        esperaVersion,
      });
      return completoItem(d);
    });
  }

  return {
    pedidos: {
      crear: crearPedido,
      agregarItems,
      obtener: obtenerPedido,
      listar: listarPedidos,
      editar: editarPedido,
      cobrar,
      anular: anularPedido,
    },
    items: {
      listar: listarItems,
      obtener: obtenerItem,
      marcarLista: (p) => mover({ ...p, a: "lista" }),
      entregar: (p) => mover({ ...p, a: "entregado" }),
      anular: (p) => mover({ ...p, a: "anulado" }),
    },
  };
}
