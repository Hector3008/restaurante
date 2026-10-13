// Reglas de los dos documentos del restaurante. Se registran en el motor al montar el servicio
// (core.documentos.registrarTipo); viajan con este código, los documentos viven en MongoDB.
//
// Dos cosas distintas (arquitectura 5.18):
//
//   ITEM (tipo `doc_item`): un solo ítem que se mueve por las estaciones. Es lo que ve cocina.
//     en_cocina → lista → entregado         anulado: salida final antes o después de entregar, con motivo
//
//   PEDIDO (tipo `pedido`): todo lo que pidió una mesa o una persona, desde el primer ítem hasta que se
//   paga todo el pedido. Es lo que se cobra.
//     abierto → pagado                      anulado: salida final desde abierto, con motivo
//
// Decisiones: el ítem nace ya en cocina (se crea al pedir el ítem); `entregado` no pide estación del
// motor (la entrega la hace el mesero o el repartidor y el motor admite un solo permiso por estado; la
// ruta exige documento:editar); anular un ítem pide estacion:creacion en el motor y el servicio exige
// además estacion:administracion cuando el ítem ya salió de cocina; pagar y anular un pedido piden la
// estación de administración.
export const MOTIVOS_ANULACION = [
  "error_pedido",
  "cliente_se_fue",
  "sin_stock",
  "cortesia",
  "otro",
];

export const TIPO_ITEM = Object.freeze({
  tipo: "doc_item",
  prefijo: "DOC_ITEM",
  estadoInicial: "en_cocina",
  transiciones: {
    en_cocina: ["lista", "anulado"],
    lista: ["entregado", "anulado"],
    entregado: ["anulado"],
  },
  permisos: {
    lista: "estacion:cocina",
    anulado: "estacion:creacion",
  },
  motivos: { anulado: MOTIVOS_ANULACION },
  // Un ítem no se edita: si se equivocó, se anula y se pide otro (así cocina nunca prepara algo que cambió)
  editables: [],
});

export const TIPO_PEDIDO = Object.freeze({
  tipo: "pedido",
  prefijo: "PD",
  estadoInicial: "abierto",
  transiciones: {
    abierto: ["pagado", "anulado"],
  },
  permisos: {
    pagado: "estacion:administracion",
    anulado: "estacion:administracion",
  },
  motivos: { anulado: MOTIVOS_ANULACION },
  editables: ["abierto"],
});
