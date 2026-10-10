// Reglas del documento "pedido" del restaurante. Se registran en el motor al montar el servicio
// (core.documentos.registrarTipo); viajan con este código, los documentos viven en MongoDB.
//
//   abierta → en_cocina → lista → entregada → pagada
//   anulada: salida final desde cualquier estado antes de pagada, con motivo obligatorio.
//
// Decisiones (ver arquitectura 5.18): las salidas "pagada" y "anulada" piden la estación de
// administración; "entregada" no pide estación del motor (la entrega la hace el mesero en el salón o
// el repartidor en delivery y el motor admite un solo permiso por estado); la ruta exige documento:editar.
export const MOTIVOS_ANULACION = [
  "error_pedido",
  "cliente_se_fue",
  "sin_stock",
  "cortesia",
  "otro",
];

export const TIPO_PEDIDO = Object.freeze({
  tipo: "pedido",
  prefijo: "PD",
  estadoInicial: "abierta",
  transiciones: {
    abierta: ["en_cocina", "anulada"],
    en_cocina: ["lista", "anulada"],
    lista: ["entregada", "anulada"],
    entregada: ["pagada", "anulada"],
  },
  permisos: {
    en_cocina: "estacion:creacion",
    lista: "estacion:cocina",
    pagada: "estacion:administracion",
    anulada: "estacion:administracion",
  },
  motivos: { anulada: MOTIVOS_ANULACION },
  // Se puede cambiar el contenido mientras no esté lista (la cocina ve la versión nueva)
  editables: ["abierta", "en_cocina"],
});
