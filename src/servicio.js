import { conEmpresa, permite, ErrorDocumento, emisorDe } from "core";
import { ErrorPedido } from "./errores.js";
import {
  validarCode,
  validarCreacion,
  validarEdicion,
  validarItems,
  validarCambioPrecio,
  validarCoherencia,
  calcularTotales,
} from "./validacion.js";
import { armarCuenta, armarRecibo, reciboDto, validarPago } from "./recibo.js";

export const TIPO_ITEM = "doc_item";
export const TIPO_PEDIDO = "pedido";
export const TIPO_RECIBO = "recibo";
const ESTADOS_ITEM_ACTIVOS = ["en_cocina", "lista", "entregado", "pagado"];

/**
 * Servicio de tobt: dos cosas separadas (ver tipos.js).
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
      throw new ErrorPedido("NO_ENCONTRADO", prefijo === "PD" ? "pedido no encontrado" : prefijo === "RC" ? "recibo no encontrado" : "ítem no encontrado");
    return d;
  }
  const cargarPedido = (code, version) => cargar(code, TIPO_PEDIDO, "PD", version);
  const cargarItem = (code) => cargar(code, TIPO_ITEM, "DOC_ITEM");
  const cargarRecibo = (code) => cargar(code, TIPO_RECIBO, "RC");

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
      // Vale aplicado a este ítem (5.30): el subtotal ya viene con el descuento; aquí queda lo que había antes.
      descuento: x.descuento ?? null,
      moneda: x.moneda ?? null,
      // A quién se le cobra este ítem (cuenta dividida). null: al cliente del pedido, si lo tiene.
      cliente: d.snapshot?.cliente?.clienteId
        ? { id: String(d.snapshot.cliente.clienteId), nombre: d.snapshot.cliente.nombre ?? "" }
        : null,
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

  // Suma de lo que falta por cobrar (todo lo que no está anulado ni pagado) y de lo ya cobrado.
  const porCobrarDe = (items) => totalDe(items.filter((i) => i.estado !== "pagado"));
  const cobradoDe = (items) => totalDe(items.filter((i) => i.estado === "pagado"));

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
      cliente: d.snapshot?.cliente?.clienteId
        ? { id: String(d.snapshot.cliente.clienteId), nombre: d.snapshot.cliente.nombre ?? "" }
        : null,
      total: d.estado === "pagado" ? x.total ?? null : items ? totalDe(items) : x.total ?? null,
      // Solo con el pedido abierto: lo ya cobrado a algunos ítems y lo que falta (null si algún ítem no tiene precio)
      cobrado: d.estado === "abierto" && items ? cobradoDe(items) : null,
      porCobrar: d.estado === "abierto" && items ? porCobrarDe(items) : null,
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
      recibos: d.payload?.doc?.codigosRecibos ?? [],
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

  // Asocia (o quita, con clienteId null) el cliente de un pedido ABIERTO. Guarda la instantánea (nombre, teléfono)
  // en el pedido: es lo que verá el cobro y lo que usa la fidelización al pagar.
  async function asociarCliente({ empresaId, actor, code, clienteId, esperaVersion }) {
    exigir(actor, "documento:editar");
    if (clienteId !== null && typeof clienteId !== "string")
      throw new ErrorPedido("DATOS_INVALIDOS", "clienteId debe ser un id o null");
    return await conEmpresa(empresaId, async () => {
      const actual = await cargarPedido(code);
      if (actual.estado !== "abierto") throw new ErrorPedido("ESTADO_INVALIDO", "el pedido ya no está abierto");
      const cliente = clienteId
        ? await clientes.instantanea({ empresaId, clienteId, campos: ["nombre", "telefono"] })
        : null;
      const nuevo = await documentos.nuevaVersion({
        code,
        snapshot: { ...(actual.snapshot ?? {}), cliente },
        usuarioId: actor.usuarioId,
        esperaVersion: esperaVersion ?? actual.version,
      });
      return await completoPedido(nuevo);
    });
  }

  // ---------- cobrar (todo el pedido, o ítem por ítem) ----------
  //
  // Cada ítem se paga con su propia transición `entregado → pagado` (cuenta dividida, 5.27). El cliente que gana
  // los puntos es el del ítem; si no tiene, el del pedido (se copia al ítem al pagar, queda guardado). El pedido se
  // cierra (`pagado`) cuando ya no queda nada por cobrar ni por entregar: lo hace quien paga el último ítem, o
  // el sistema si lo último que pasó fue anular un ítem pendiente.

  const clienteIdValido = (clienteId) => {
    if (clienteId !== undefined && clienteId !== null && typeof clienteId !== "string")
      throw new ErrorPedido("DATOS_INVALIDOS", "clienteId debe ser un id o null");
  };

  // Paga los ítems indicados (ya validados como `entregado` de este pedido). Devuelve los puntos por cliente.
  async function pagarItems({ empresaId, actor, pedido, codigos }) {
    const pagados = [];
    for (const codigo of codigos) {
      const it = await cargarItem(codigo);
      const cliente = it.snapshot?.cliente ?? pedido.snapshot?.cliente ?? null;
      await documentos.transicionar({
        code: codigo,
        a: "pagado",
        usuarioId: actor.usuarioId,
        permisos: actor.permisos,
        snapshot: { ...(it.snapshot ?? {}), cliente },
      });
      pagados.push(codigo);
    }
    return await puntosDeItems({ empresaId, codigos: pagados });
  }

  // ---------- recibos (5.32) ----------
  // Cada cobro deja un recibo de pago (documento `recibo`, número RC-…). Se crea DESPUÉS de cobrar y, si falla, el cobro
  // no se revierte: la respuesta trae `reciboError` y se avisa. El pedido guarda la lista de sus recibos (`codigosRecibos`).

  // Lo que se va a cobrar por estos ítems, en centavos; null si alguno no tiene precio.
  const ventaCentavos = (items) => {
    const t = totalDe(items);
    return t === null ? null : Math.round(t * 100);
  };

  // El encabezado de los recibos (5.34): nombre, datos y logo de la empresa en este momento; null si no se puede leer.
  async function empresaDe(empresaId) {
    try {
      const e = (await core.modelos?.Empresa?.findById(empresaId).lean()) ?? null;
      return e ? emisorDe(e) : null;
    } catch {
      return null;
    }
  }

  async function vincularRecibo({ actor, pedidoCode, reciboCode }) {
    for (let intento = 0; ; intento++) {
      const c = await cargarPedido(pedidoCode);
      try {
        await documentos.nuevaVersion({
          code: pedidoCode,
          doc: { ...c.payload.doc, codigosRecibos: [...(c.payload.doc.codigosRecibos ?? []), reciboCode] },
          usuarioId: actor.usuarioId,
          esperaVersion: c.version,
        });
        return;
      } catch (e) {
        if (e?.codigo !== "CONFLICTO_VERSION" || intento >= 4) throw e;
      }
    }
  }

  // Emite el recibo de los ítems recién cobrados. Devuelve { recibo } o { reciboError: true }; null si no se cobró nada.
  async function emitirRecibo({ empresaId, actor, pedidoCode, codigos, pago }) {
    if (!codigos.length) return null;
    try {
      const pedido = await completoPedido(await cargarPedido(pedidoCode));
      const items = pedido.items.filter((i) => codigos.includes(i.code));
      const doc = armarRecibo({ pedido, items, pago, empresa: await empresaDe(empresaId), moneda: pedido.moneda });
      const creado = await documentos.crear({ tipo: TIPO_RECIBO, usuarioId: actor.usuarioId, snapshot: {}, doc });
      await vincularRecibo({ actor, pedidoCode, reciboCode: creado.code });
      return { recibo: reciboDto(creado) };
    } catch (e) {
      console.error(`tobt: no se pudo emitir el recibo del pedido ${pedidoCode}`, e);
      return { reciboError: true };
    }
  }

  async function recibosDe(pedido) {
    const codigos = pedido.doc?.codigosRecibos ?? pedido.payload?.doc?.codigosRecibos ?? [];
    const docs = await Promise.all(codigos.map((c) => documentos.obtener({ code: c })));
    return docs.filter((d) => d && d.tipo === TIPO_RECIBO).map(reciboDto);
  }

  /** Un recibo de pago por su número. */
  async function obtenerRecibo({ empresaId, actor, code }) {
    exigir(actor, "documento:leer");
    return await conEmpresa(empresaId, async () => reciboDto(await cargarRecibo(code)));
  }

  /** Los recibos de pago de un pedido, en el orden en que se emitieron. */
  async function recibosDelPedido({ empresaId, actor, code }) {
    exigir(actor, "documento:leer");
    return await conEmpresa(empresaId, async () => await recibosDe(await completoPedido(await cargarPedido(code))));
  }

  /** La cuenta del pedido (recibo de consumo): lo consumido, lo cobrado y lo que falta. No se guarda. */
  async function cuentaDelPedido({ empresaId, actor, code }) {
    exigir(actor, "documento:leer");
    return await conEmpresa(empresaId, async () => {
      const pedido = await completoPedido(await cargarPedido(code));
      return armarCuenta({ pedido, recibos: await recibosDe(pedido), empresa: await empresaDe(empresaId) });
    });
  }

  // Cierra el pedido si no queda nada por entregar ni por cobrar y algo se cobró. `sistema`: lo cierra el servicio
  // (quien anuló un ítem puede no tener la estación de administración). Devuelve el pedido actual.
  async function cerrarSiCompleto({ actor, code, sistema = false, esperaVersion }) {
    const pedido = await cargarPedido(code);
    if (pedido.estado !== "abierto") return pedido;
    const completa = await completoPedido(pedido);
    const vivos = completa.items.filter((i) => i.estado !== "anulado");
    if (!vivos.length || vivos.some((i) => i.estado !== "pagado")) return pedido;
    return await documentos.transicionar({
      code,
      a: "pagado",
      usuarioId: actor.usuarioId,
      permisos: actor.permisos,
      sistema,
      doc: { ...pedido.payload.doc, total: totalDe(completa.items) },
      esperaVersion,
    });
  }

  // Cobrar TODO lo que falta de un pedido, cuando ya está entregado (o anulado). Cierra el pedido.
  // `clienteId` (opcional) asocia al cliente del pedido antes de cobrar (para los ítems que no tienen el suyo).
  // Si la fidelización falla, el pago NO se revierte: queda en `puntos.error`.
  async function cobrar({ empresaId, actor, code, esperaVersion, clienteId, pago }) {
    exigir(actor, "documento:editar");
    clienteIdValido(clienteId);
    return await conEmpresa(empresaId, async () => {
      let pedido = await cargarPedido(code);
      if (esperaVersion !== undefined && esperaVersion !== pedido.version)
        throw new ErrorDocumento("CONFLICTO_VERSION", `El documento ${code} cambió mientras se trabajaba en él; vuelve a cargarlo`, { esperada: esperaVersion, real: pedido.version });
      if (pedido.estado !== "abierto")
        throw new ErrorDocumento("TRANSICION_INVALIDA", `No se puede pasar de '${pedido.estado}' a 'pagado' (pedido)`);
      const completa = await completoPedido(pedido);
      const sinEntregar = completa.items.filter((i) => i.estado === "en_cocina" || i.estado === "lista");
      if (sinEntregar.length)
        throw new ErrorPedido("ESTADO_INVALIDO", `hay ${sinEntregar.length} item(s) sin entregar`, {
          pendientes: sinEntregar.map((i) => i.code),
        });
      const porPagar = completa.items.filter((i) => i.estado === "entregado").map((i) => i.code);
      if (!porPagar.length && !completa.items.some((i) => i.estado === "pagado"))
        throw new ErrorPedido("ESTADO_INVALIDO", "el pedido no tiene nada entregado que cobrar");
      const pagoOk = validarPago(pago, ventaCentavos(completa.items.filter((i) => porPagar.includes(i.code))));
      if (clienteId !== undefined) {
        const cliente = clienteId
          ? await clientes.instantanea({ empresaId, clienteId, campos: ["nombre", "telefono"] })
          : null;
        pedido = await documentos.nuevaVersion({
          code,
          snapshot: { ...(pedido.snapshot ?? {}), cliente },
          usuarioId: actor.usuarioId,
          esperaVersion: pedido.version,
        });
      }
      const puntos = await pagarItems({ empresaId, actor, pedido, codigos: porPagar });
      const recibo = await emitirRecibo({ empresaId, actor, pedidoCode: code, codigos: porPagar, pago: pagoOk });
      await cerrarSiCompleto({ actor, code });
      const respuesta = await completoPedido(await cargarPedido(code));
      return { ...respuesta, ...(puntos ? { puntos } : {}), ...(recibo ?? {}) };
    });
  }

  // Cobrar solo algunos ítems (la parte de un comensal). Cada ítem debe estar entregado y ser de este pedido.
  // Si con esto no queda nada por cobrar, el pedido se cierra solo.
  async function cobrarItems({ empresaId, actor, code, items: codigos, pago }) {
    exigir(actor, "documento:editar");
    if (!Array.isArray(codigos) || !codigos.length || codigos.length > 100 || new Set(codigos).size !== codigos.length)
      throw new ErrorPedido("DATOS_INVALIDOS", "items: una lista de 1 a 100 códigos de ítem, sin repetir");
    if (codigos.some((c) => typeof c !== "string" || !/^DOC_ITEM-\d{7,}$/.test(c)))
      throw new ErrorPedido("DATOS_INVALIDOS", "items: códigos de ítem inválidos");
    return await conEmpresa(empresaId, async () => {
      const pedido = await cargarPedido(code);
      if (pedido.estado !== "abierto") throw new ErrorPedido("ESTADO_INVALIDO", "el pedido ya no está abierto");
      const completa = await completoPedido(pedido);
      for (const c of codigos) {
        const it = completa.items.find((i) => i.code === c);
        if (!it) throw new ErrorPedido("DATOS_INVALIDOS", `el ítem ${c} no es de este pedido`);
        if (it.estado !== "entregado") throw new ErrorPedido("ESTADO_INVALIDO", `el ítem ${c} no está entregado (${it.estado})`, { items: [c] });
      }
      const pagoOk = validarPago(pago, ventaCentavos(completa.items.filter((i) => codigos.includes(i.code))));
      const puntos = await pagarItems({ empresaId, actor, pedido, codigos });
      const recibo = await emitirRecibo({ empresaId, actor, pedidoCode: code, codigos, pago: pagoOk });
      await cerrarSiCompleto({ actor, code });
      const respuesta = await completoPedido(await cargarPedido(code));
      return { ...respuesta, ...(puntos ? { puntos } : {}), ...(recibo ?? {}) };
    });
  }

  // Los puntos de los ítems recién pagados, por cliente. null si ninguno tiene cliente o no hay fidelización.
  // Un fallo de la fidelización no deshace el pago: se avisa en `error`.
  async function puntosDeItems({ empresaId, codigos }) {
    if (!core.fidelizacion) return null;
    const porCliente = new Map();
    let hayError = false;
    for (const codigo of codigos) {
      const it = await documentos.obtener({ code: codigo });
      const cl = it?.snapshot?.cliente;
      if (!cl?.clienteId) continue;
      const id = String(cl.clienteId);
      const fila = porCliente.get(id) ?? { id, nombre: cl.nombre ?? "", acumulados: 0, saldo: null, motivo: undefined };
      try {
        const r = await core.fidelizacion.acumularPorDocumento({ empresaId, code: codigo });
        fila.acumulados += r.acumulados ?? 0;
        if (r.saldo != null) fila.saldo = r.saldo;
        if (!r.acumulados && r.motivo && !fila.motivo) fila.motivo = r.motivo;
      } catch {
        hayError = true;
        fila.error = true;
      }
      porCliente.set(id, fila);
    }
    if (!porCliente.size) return null;
    const clientes = [...porCliente.values()].map(({ motivo, error, ...f }) => ({ ...f, ...(error ? { error: true } : {}), ...(motivo && !f.acumulados ? { motivo } : {}) }));
    const total = clientes.reduce((n, c) => n + c.acumulados, 0);
    if (hayError && !total) return { acumulados: 0, error: true, clientes };
    const uno = clientes.length === 1 ? clientes[0] : null;
    return {
      acumulados: total,
      saldo: uno ? uno.saldo : null,
      ...(uno?.motivo ? { motivo: uno.motivo } : {}),
      ...(hayError ? { error: true } : {}),
      clientes,
    };
  }

  // Anular el pedido anula también lo que siga en pie (con el mismo motivo). Si algún ítem no pudo
  // anularse, la respuesta lo dice en `sinAnular`.
  async function anularPedido({ empresaId, actor, code, motivo, esperaVersion }) {
    exigir(actor, "documento:editar");
    return await conEmpresa(empresaId, async () => {
      const pedido = await cargarPedido(code);
      // Lo ya cobrado no se deshace: se anulan los ítems que faltan y el pedido se cierra solo.
      for (const c of pedido.payload.doc.codigosItems ?? []) {
        const it = await documentos.obtener({ code: c });
        if (it?.estado === "pagado")
          throw new ErrorPedido("ESTADO_INVALIDO", "ya se cobraron ítems de este pedido: anula los que faltan en lugar de todo el pedido", { items: [c] });
      }
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
      // Si lo último que faltaba por entregar o cobrar se anuló, y ya se cobró algo, el pedido se cierra solo.
      if (a === "anulado") await cerrarSiCompleto({ actor, code: item.payload.doc.pedidoCode, sistema: true });
      return completoItem(d);
    });
  }

  // A quién se le cobra un ítem (cuenta dividida): el cliente del ítem, o null para volver al del pedido.
  // Solo con el pedido abierto y el ítem sin pagar ni anular. Guarda la copia (nombre, teléfono) en el ítem.
  async function asociarClienteItem({ empresaId, actor, code, clienteId, esperaVersion }) {
    exigir(actor, "documento:editar");
    clienteIdValido(clienteId ?? null);
    return await conEmpresa(empresaId, async () => {
      const item = await cargarItem(code);
      const pedido = await cargarPedido(item.payload.doc.pedidoCode);
      if (pedido.estado !== "abierto") throw new ErrorPedido("ESTADO_INVALIDO", "el pedido de este ítem ya no está abierto");
      if (item.estado === "pagado" || item.estado === "anulado")
        throw new ErrorPedido("ESTADO_INVALIDO", `un ítem ${item.estado === "pagado" ? "pagado" : "anulado"} no cambia de cliente`);
      const cliente = clienteId
        ? await clientes.instantanea({ empresaId, clienteId, campos: ["nombre", "telefono"] })
        : null;
      const d = await documentos.nuevaVersion({
        code,
        snapshot: { ...(item.snapshot ?? {}), cliente },
        usuarioId: actor.usuarioId,
        esperaVersion: esperaVersion ?? item.version,
      });
      return completoItem(d);
    });
  }

  // Corrige el precio de un ítem sin anularlo (el que se cargó sin precio, o con uno equivocado). Solo el precio:
  // lo que cocina prepara no cambia. Pide estacion:administracion, igual que poner un precio propio al pedirlo.
  // Vale mientras el pedido esté abierto y el ítem no esté anulado; el total del pedido se recalcula solo.
  async function cambiarPrecio({ empresaId, actor, code, esperaVersion, ...cuerpo }) {
    exigir(actor, "documento:editar");
    exigir(actor, "estacion:administracion");
    const precio = validarCambioPrecio(cuerpo);
    return await conEmpresa(empresaId, async () => {
      const item = await cargarItem(code);
      const pedido = await cargarPedido(item.payload.doc.pedidoCode);
      if (pedido.estado !== "abierto") throw new ErrorPedido("ESTADO_INVALIDO", "el pedido de este ítem ya no está abierto");
      if (item.estado === "anulado" || item.estado === "pagado")
        throw new ErrorPedido("ESTADO_INVALIDO", `un ítem ${item.estado === "pagado" ? "pagado" : "anulado"} no cambia de precio`);
      if (item.payload?.doc?.descuento)
        throw new ErrorPedido("ESTADO_INVALIDO", "el ítem tiene un vale aplicado: su precio ya no se cambia (anula el ítem y pídelo de nuevo)");
      const s = item.snapshot?.item ?? {};
      const nuevo = { ...s, precio };
      if (s.origen !== "libre") {
        const original = s.precioModificado ? s.precioCatalogo ?? null : s.precio ?? null;
        nuevo.precioCatalogo = original;
        nuevo.precioModificado = precio !== original;
      }
      const { subtotales } = calcularTotales([nuevo], [item.payload.doc.cantidad]);
      const d = await documentos.nuevaVersion({
        code,
        doc: { ...item.payload.doc, subtotal: subtotales[0] },
        snapshot: { ...item.snapshot, item: nuevo },
        usuarioId: actor.usuarioId,
        esperaVersion: esperaVersion ?? item.version,
      });
      return completoItem(d);
    });
  }

  // ---------- vales de fidelización (5.30) ----------

  // El núcleo trae la fidelización en el gateway real; sin ella (pruebas, otro montaje) no hay vales.
  const vales = () => {
    if (!core.fidelizacion?.tickets) throw new ErrorPedido("ESTADO_INVALIDO", "los vales de fidelización no están disponibles");
    return core.fidelizacion.tickets;
  };

  // Mira un vale por su código, sin gastarlo: qué beneficio es, de quién y si sirve todavía.
  async function consultarVale({ empresaId, actor, codigo }) {
    exigir(actor, "fidelizacion:canjear");
    return await conEmpresa(empresaId, async () => await vales().consultar({ empresaId, actor, codigo }));
  }

  /**
   * Aplica un vale a UN ítem del pedido: baja el subtotal de ese ítem (guarda lo anterior en `descuento`) y gasta el
   * vale. Va por ítem, no por pedido, para que la cuenta dividida siga cuadrando: cada comensal paga su ítem ya
   * rebajado. El vale se consume con una actualización atómica ANTES de tocar el ítem; si el ítem no se pudo
   * actualizar, el vale se libera. Reglas: pedido abierto, ítem sin pagar ni anular y sin otro vale, vale activo,
   * y si el ítem (o el pedido) tiene cliente, el vale tiene que ser de ese cliente.
   * Límite conocido: un vale aplicado no se puede quitar; se anula el ítem (y el vale queda gastado).
   */
  async function aplicarVale({ empresaId, actor, code, codigo, esperaVersion }) {
    exigir(actor, "documento:editar");
    exigir(actor, "fidelizacion:canjear");
    if (typeof codigo !== "string" || !codigo.trim() || codigo.length > 20)
      throw new ErrorPedido("DATOS_INVALIDOS", "codigo: el código del vale");
    return await conEmpresa(empresaId, async () => {
      const item = await cargarItem(code);
      const pedido = await cargarPedido(item.payload.doc.pedidoCode);
      if (pedido.estado !== "abierto") throw new ErrorPedido("ESTADO_INVALIDO", "el pedido de este ítem ya no está abierto");
      if (!["en_cocina", "lista", "entregado"].includes(item.estado))
        throw new ErrorPedido("ESTADO_INVALIDO", `un ítem ${item.estado === "pagado" ? "pagado" : "anulado"} no admite un vale`);
      if (item.payload.doc.descuento) throw new ErrorPedido("ESTADO_INVALIDO", "este ítem ya tiene un vale aplicado");

      const vale = await vales().consultar({ empresaId, actor, codigo });
      if (vale.estado !== "activo") {
        const motivo = { usado: "el vale ya fue usado", cancelado: "el vale fue cancelado", vencido: "el vale está vencido" }[vale.estado];
        throw new ErrorPedido("ESTADO_INVALIDO", motivo ?? "el vale no se puede usar");
      }
      const dueno = item.snapshot?.cliente?.clienteId ?? pedido.snapshot?.cliente?.clienteId ?? null;
      if (dueno && String(dueno) !== vale.cliente.id)
        throw new ErrorPedido("ESTADO_INVALIDO", "el vale es de otro cliente que el de este pedido");

      const s = item.snapshot?.item ?? {};
      const subtotal = item.payload.doc.subtotal;
      const monto = vales().calcularDescuento(vale.beneficioCompleto, {
        subtotal,
        precio: s.precio ?? null,
        cantidad: item.payload.doc.cantidad,
        codigo: s.codigo ?? null,
      });
      const nuevoSubtotal = Math.round(subtotal * 100 - monto * 100) / 100;

      await vales().consumir({ empresaId, actor, codigo, uso: { pedidoCode: pedido.code, itemCode: code, descuento: monto } });
      try {
        const d = await documentos.nuevaVersion({
          code,
          doc: {
            ...item.payload.doc,
            subtotal: nuevoSubtotal,
            descuento: { vale: vale.codigo, beneficio: vale.beneficio.nombre, monto, subtotalAntes: subtotal },
          },
          usuarioId: actor.usuarioId,
          esperaVersion: esperaVersion ?? item.version,
        });
        return completoItem(d);
      } catch (e) {
        await vales().liberar({ empresaId, actor, codigo, itemCode: code }).catch(() => {});
        throw e;
      }
    });
  }

  return {
    pedidos: {
      crear: crearPedido,
      agregarItems,
      obtener: obtenerPedido,
      listar: listarPedidos,
      editar: editarPedido,
      asociarCliente,
      cobrar,
      cobrarItems,
      anular: anularPedido,
      cuenta: cuentaDelPedido,
      recibos: recibosDelPedido,
    },
    recibos: { obtener: obtenerRecibo },
    items: {
      listar: listarItems,
      obtener: obtenerItem,
      marcarLista: (p) => mover({ ...p, a: "lista" }),
      entregar: (p) => mover({ ...p, a: "entregado" }),
      anular: (p) => mover({ ...p, a: "anulado" }),
      cambiarPrecio,
      asociarCliente: asociarClienteItem,
      aplicarVale,
    },
    vales: { consultar: consultarVale },
  };
}
