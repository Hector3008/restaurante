// De un ítem pagado: a quién se le acumulan los puntos, cuánto, y qué plato era (arquitectura 5.27 y 5.31).
// `d` es el documento `doc_item` que devuelve core.documentos.obtener.
export function extraerConsumo(d) {
  const item = d.snapshot?.item;
  return {
    clienteId: d.snapshot?.cliente?.clienteId ?? null,
    monto: d.payload?.doc?.subtotal ?? null,
    detalle: d.payload?.doc?.pedidoCode ? `Pedido ${d.payload.doc.pedidoCode} pagado` : "Pedido pagado",
    // El plato del catálogo que se pagó: con esto el núcleo sabe qué cafés probó el cliente (retos, 5.31).
    // Las líneas libres no cuentan: no son un plato de la carta.
    itemCodigo: item?.origen === "catalogo" ? item.codigo ?? null : null,
  };
}
