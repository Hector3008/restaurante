// Lógica pura del front de pedidos (sin React ni navegador): se prueba con `node --test`.
//
// IMPORTANTE: ocultar o mostrar un botón aquí NO es seguridad. El servicio comprueba el permiso de
// cada operación y el motor de documentos exige la estación de cada paso (arquitectura 5.18).

/** Misma regla que `permite` del núcleo (core/src/permisos.js) y que `cuenta/client/src/destinos.js`. */
export function permite(permisos, requerido) {
  if (!Array.isArray(permisos) || typeof requerido !== "string") return false;
  const [recurso] = requerido.split(":");
  return permisos.some((p) => p === "*" || p === requerido || p === `${recurso}:*`);
}

export const ESTADOS = {
  abierta: "Abierto",
  en_cocina: "En cocina",
  lista: "Lista",
  entregada: "Entregado",
  pagada: "Pagado",
  anulada: "Anulado",
};
export const CANALES = { salon: "Salón", llevar: "Para llevar", delivery: "Delivery" };
export const ESTADOS_ACTIVOS = ["abierta", "en_cocina", "lista", "entregada"];
// Mismos que TIPO_PEDIDO.editables y MOTIVOS_ANULACION del servicio (src/tipo-pedido.js)
export const EDITABLES = ["abierta", "en_cocina"];
export const MOTIVOS_ANULACION = [
  ["error_pedido", "Error en el pedido"],
  ["cliente_se_fue", "El cliente se fue"],
  ["sin_stock", "Sin stock"],
  ["cortesia", "Cortesía"],
  ["otro", "Otro"],
];
export const MAX_CANTIDAD = 99;

/** Filtros de la lista: `estado` es el parámetro `?estado=a,b` de GET /pedidos. */
export const FILTROS = [
  { id: "activos", titulo: "Activos", estado: ESTADOS_ACTIVOS.join(",") },
  { id: "abierta", titulo: "Abiertos", estado: "abierta" },
  { id: "en_cocina", titulo: "En cocina", estado: "en_cocina" },
  { id: "lista", titulo: "Listos", estado: "lista" },
  { id: "entregada", titulo: "Entregados", estado: "entregada" },
  { id: "pagada", titulo: "Pagados", estado: "pagada" },
  { id: "anulada", titulo: "Anulados", estado: "anulada" },
];

// ---------- dinero ----------

/** Con moneda conocida, formato de moneda; sin ella, el número con 2 decimales. null = sin precio. */
export function formatoDinero(valor, moneda) {
  if (valor === null || valor === undefined) return "—";
  const n = Number(valor);
  if (!Number.isFinite(n)) return "—";
  if (!moneda) return n.toFixed(2);
  try {
    return new Intl.NumberFormat("es", { style: "currency", currency: moneda }).format(n);
  } catch {
    return `${n.toFixed(2)} ${moneda}`;
  }
}

/** El núcleo rechaza más de 2 decimales (5.16): se valida antes de enviar. Vacío = sin precio. */
export function parsearPrecio(texto) {
  const t = String(texto ?? "").trim().replace(",", ".");
  if (t === "") return { ok: true, valor: null };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { ok: false };
  return { ok: true, valor: Number(t) };
}

/** Total que se muestra mientras se arma el pedido (el que vale es el que calcula el servidor).
 *  Con enteros en centavos y `null` si alguna línea no tiene precio: nunca se inventa un precio. */
export function totalEstimado(lineas) {
  let centavos = 0;
  for (const l of lineas) {
    if (l.precio === null || l.precio === undefined) return null;
    centavos += Math.round(Number(l.precio) * 100) * l.cantidad;
  }
  return centavos / 100;
}

// ---------- líneas del formulario ----------

let contador = 0;
const clave = () => `l${++contador}`;

/** Línea del catálogo: { clave, codigo, nombre, precio, cantidad, notas }. Si ya está, suma 1. */
export function agregarDelCatalogo(lineas, item) {
  const i = lineas.findIndex((l) => l.codigo && l.codigo.toLowerCase() === String(item.codigo).toLowerCase());
  if (i >= 0)
    return lineas.map((l, j) => (j === i ? { ...l, cantidad: Math.min(l.cantidad + 1, MAX_CANTIDAD) } : l));
  return [
    ...lineas,
    { clave: clave(), codigo: item.codigo, nombre: item.nombre, precio: item.precio ?? null, cantidad: 1, notas: "" },
  ];
}

/** Línea libre (no está en el catálogo): { clave, libre: true, nombre, precio, cantidad, notas }. */
export function agregarLibre(lineas, { nombre, precio }) {
  return [...lineas, { clave: clave(), libre: true, nombre: nombre.trim(), precio: precio ?? null, cantidad: 1, notas: "" }];
}

export function cambiarCantidad(lineas, k, delta) {
  return lineas.map((l) =>
    l.clave === k ? { ...l, cantidad: Math.min(Math.max(l.cantidad + delta, 1), MAX_CANTIDAD) } : l,
  );
}

/** Una línea del formulario → la que acepta POST/PUT /restaurante/pedidos. */
export function lineaAEnvio(l) {
  const base = { cantidad: l.cantidad, ...(l.notas?.trim() ? { notas: l.notas.trim() } : {}) };
  if (!l.libre) return { codigo: l.codigo, ...base };
  const libre = { nombre: l.nombre };
  if (l.precio !== null && l.precio !== undefined) libre.precio = l.precio;
  if (l.codigoLibre) libre.codigo = l.codigoLibre;
  return { libre, ...base };
}

/** Reconstruye las líneas del formulario desde un pedido (doc.lineas y snapshot.lineas van por posición). */
export function lineasDesdeDetalle(detalle) {
  const docL = detalle?.doc?.lineas ?? [];
  const snap = detalle?.snapshot?.lineas ?? [];
  return docL.map((d, i) => {
    const s = snap[i] ?? {};
    const comun = {
      clave: clave(),
      nombre: s.nombre ?? "",
      precio: s.precio ?? null,
      cantidad: d.cantidad ?? 1,
      notas: d.notas ?? "",
    };
    return s.origen === "libre"
      ? { ...comun, libre: true, codigoLibre: s.codigo ?? null }
      : { ...comun, codigo: s.codigo };
  });
}

// ---------- formulario ----------

export const formularioVacio = (canal = "salon") => ({
  canal,
  mesa: "",
  referencia: "",
  direccion: "",
  telefono: "",
  referenciaEntrega: "",
  notas: "",
  lineas: [],
});

export function formularioDesdeDetalle(detalle) {
  const d = detalle?.doc ?? {};
  return {
    canal: d.canal ?? "salon",
    mesa: d.mesa ?? "",
    referencia: d.referencia ?? "",
    direccion: d.entrega?.direccion ?? "",
    telefono: d.entrega?.telefono ?? "",
    referenciaEntrega: d.entrega?.referencia ?? "",
    notas: d.notas ?? "",
    lineas: lineasDesdeDetalle(detalle),
  };
}

/** Ayuda antes de enviar; el servidor es quien valida de verdad. Devuelve un texto o null. */
export function validarFormulario(f) {
  if (f.canal === "salon" && !f.mesa.trim()) return "Indica la mesa.";
  if (f.canal === "llevar" && !f.referencia.trim()) return "Indica a nombre de quién es el pedido.";
  if (f.canal === "delivery") {
    if (!f.direccion.trim()) return "Indica la dirección de entrega.";
    if (!f.telefono.trim()) return "Indica el teléfono de contacto.";
    if (!/^\+?[0-9 ()-]{6,30}$/.test(f.telefono.trim()))
      return "El teléfono solo admite dígitos, espacios, guiones y un + inicial.";
  }
  if (!f.lineas.length) return "Agrega al menos un ítem.";
  return null;
}

const nulo = (t) => (t.trim() ? t.trim() : null);

/** Datos del canal, sin los campos de los otros canales (el servicio los rechaza). */
function datosDelCanal(f) {
  if (f.canal === "salon") return { mesa: f.mesa.trim() };
  if (f.canal === "llevar") return { referencia: f.referencia.trim() };
  return {
    entrega: {
      direccion: f.direccion.trim(),
      telefono: f.telefono.trim(),
      referencia: nulo(f.referenciaEntrega),
    },
  };
}

/** Cuerpo de POST /restaurante/pedidos. */
export function cuerpoCreacion(f) {
  return { canal: f.canal, ...datosDelCanal(f), notas: nulo(f.notas), lineas: f.lineas.map(lineaAEnvio) };
}

/** Cuerpo de PUT /restaurante/pedidos/:code (el canal no cambia). `lineas` reemplaza todas. */
export function cuerpoEdicion(f, esperaVersion) {
  return { esperaVersion, ...datosDelCanal(f), notas: nulo(f.notas), lineas: f.lineas.map(lineaAEnvio) };
}

// ---------- qué se ofrece en un pedido ----------

/**
 * Acciones que se muestran para un pedido según su estado y los permisos de la persona.
 * Refleja lo que exige el servidor: documento:editar en la ruta y la estación de cada paso en el motor
 * (enviar → creacion, lista → cocina, cobrar y anular → administracion; entregar no pide estación).
 */
export function accionesDe(estado, permisos) {
  const editar = permite(permisos, "documento:editar");
  const admin = editar && permite(permisos, "estacion:administracion");
  const pasos = [];
  if (estado === "abierta" && editar && permite(permisos, "estacion:creacion"))
    pasos.push({ id: "enviar", etiqueta: "Enviar a cocina" });
  if (estado === "en_cocina" && editar && permite(permisos, "estacion:cocina"))
    pasos.push({ id: "lista", etiqueta: "Marcar lista" });
  if (estado === "lista" && editar) pasos.push({ id: "entregar", etiqueta: "Marcar entregado" });
  if (estado === "entregada" && admin) pasos.push({ id: "cobrar", etiqueta: "Cobrar" });
  return {
    pasos,
    editar: editar && EDITABLES.includes(estado),
    anular: admin && ["abierta", "en_cocina", "lista", "entregada"].includes(estado),
  };
}

/** Una línea de texto para la tarjeta de la lista: dónde va el pedido. */
export function destinoDe(p) {
  if (p.canal === "salon") return p.mesa ? `Mesa ${p.mesa}` : "Salón";
  if (p.canal === "llevar") return p.referencia ? `Para llevar · ${p.referencia}` : "Para llevar";
  if (p.canal === "delivery") return p.referencia ? `Delivery · ${p.referencia}` : "Delivery";
  return "";
}
