import { ErrorPedido } from "./errores.js";

export const CANALES = ["salon", "llevar", "delivery"];
export const MAX_LINEAS = 100;
export const MAX_CANTIDAD = 99;

const malo = (m) => new ErrorPedido("DATOS_INVALIDOS", m);
const esObjeto = (x) => !!x && typeof x === "object" && !Array.isArray(x);

function soloClaves(o, permitidas, donde) {
  const extra = Object.keys(o).filter((k) => !permitidas.includes(k));
  if (extra.length) throw malo(`${donde}: campos no admitidos (${extra.join(", ")})`);
}

// Texto opcional: undefined → undefined, null o "" → null, si no, texto recortado de hasta `max`
function textoOpcional(v, max, nombre) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") throw malo(`${nombre} debe ser texto`);
  const t = v.trim();
  if (!t) return null;
  if (t.length > max) throw malo(`${nombre}: máximo ${max} caracteres`);
  return t;
}

export function validarCode(code) {
  if (typeof code !== "string" || !/^PD-\d{7,}$/.test(code))
    throw new ErrorPedido("NO_ENCONTRADO", "pedido no encontrado");
  return code;
}

// Una línea de entrada: { codigo, cantidad?, notas? } o { libre: {...}, cantidad?, notas? }.
// Devuelve { item, cantidad, notas }: `item` va a core.catalogo.instantanea y el resto al documento.
export function validarLinea(l, i) {
  const donde = `lineas[${i}]`;
  if (!esObjeto(l)) throw malo(`${donde}: debe ser un objeto`);
  soloClaves(l, ["codigo", "libre", "precio", "cantidad", "notas"], donde);
  if ((l.codigo === undefined) === (l.libre === undefined))
    throw malo(`${donde}: lleva 'codigo' (del catálogo) o 'libre', no las dos cosas ni ninguna`);
  let item;
  if (l.codigo !== undefined) {
    if (typeof l.codigo !== "string" || !l.codigo.trim()) throw malo(`${donde}.codigo debe ser texto`);
    item = l.codigo.trim();
  } else {
    if (!esObjeto(l.libre)) throw malo(`${donde}.libre debe ser un objeto`);
    item = { libre: l.libre };
  }
  // Precio propio de una línea del catálogo (cambia el del catálogo solo en este pedido). Las líneas
  // libres llevan su precio dentro de `libre`.
  let precio;
  if (l.precio !== undefined) {
    if (l.codigo === undefined) throw malo(`${donde}.precio solo va en una línea del catálogo (en una libre, dentro de 'libre')`);
    precio = validarPrecio(l.precio, `${donde}.precio`);
  }
  const cantidad = l.cantidad === undefined ? 1 : l.cantidad;
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD)
    throw malo(`${donde}.cantidad: un entero de 1 a ${MAX_CANTIDAD}`);
  const notas = textoOpcional(l.notas, 200, `${donde}.notas`) ?? null;
  return { item, cantidad, notas, precio };
}

// Un número >= 0 con 2 decimales como máximo (como los del catálogo, 5.16)
function validarPrecio(v, nombre) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e9 || Math.round(v * 100) / 100 !== v)
    throw malo(`${nombre}: un número de 0 en adelante con 2 decimales como máximo`);
  return v;
}

export function validarLineas(lineas) {
  if (!Array.isArray(lineas) || !lineas.length || lineas.length > MAX_LINEAS)
    throw malo(`lineas: una lista de 1 a ${MAX_LINEAS} elementos`);
  return lineas.map(validarLinea);
}

export function validarEntrega(e) {
  if (!esObjeto(e)) throw malo("entrega debe ser un objeto { direccion, telefono, referencia? }");
  soloClaves(e, ["direccion", "telefono", "referencia"], "entrega");
  const direccion = textoOpcional(e.direccion, 200, "entrega.direccion");
  const telefono = textoOpcional(e.telefono, 30, "entrega.telefono");
  if (!direccion) throw malo("entrega.direccion es obligatoria en un pedido de delivery");
  if (!telefono) throw malo("entrega.telefono es obligatorio en un pedido de delivery");
  if (!/^\+?[0-9 ()-]{6,30}$/.test(telefono)) throw malo("entrega.telefono: solo dígitos, espacios, guiones y un + inicial");
  return { direccion, telefono, referencia: textoOpcional(e.referencia, 200, "entrega.referencia") ?? null };
}

// Alta: el canal decide qué se exige (salón: mesa; llevar: a nombre de quién; delivery: entrega)
export function validarCreacion(b) {
  if (!esObjeto(b)) throw malo("el cuerpo debe ser un objeto");
  soloClaves(b, ["canal", "mesa", "referencia", "entrega", "clienteId", "notas", "lineas"], "pedido");
  if (!CANALES.includes(b.canal)) throw malo(`canal: uno de ${CANALES.join(", ")}`);
  const mesa = textoOpcional(b.mesa, 20, "mesa") ?? null;
  const referencia = textoOpcional(b.referencia, 60, "referencia") ?? null;
  let entrega = null;
  if (b.canal === "salon") {
    if (!mesa) throw malo("mesa es obligatoria en un pedido de salón");
    if (b.entrega != null) throw malo("entrega solo va en un pedido de delivery");
  } else {
    if (mesa) throw malo("mesa solo va en un pedido de salón");
    if (b.canal === "llevar") {
      if (!referencia) throw malo("referencia (a nombre de quién) es obligatoria en un pedido para llevar");
      if (b.entrega != null) throw malo("entrega solo va en un pedido de delivery");
    } else entrega = validarEntrega(b.entrega);
  }
  if (b.clienteId != null && (typeof b.clienteId !== "string" || !b.clienteId))
    throw malo("clienteId debe ser texto");
  return {
    canal: b.canal,
    mesa,
    referencia,
    entrega,
    clienteId: b.clienteId ?? null,
    notas: textoOpcional(b.notas, 500, "notas") ?? null,
    lineas: validarLineas(b.lineas),
  };
}

// Edición: undefined no toca el campo; el canal no cambia (cambiaría las reglas del pedido)
export function validarEdicion(b) {
  if (!esObjeto(b)) throw malo("el cuerpo debe ser un objeto");
  soloClaves(b, ["mesa", "referencia", "entrega", "notas", "lineas"], "edición");
  const cambio = {};
  if (b.mesa !== undefined) cambio.mesa = textoOpcional(b.mesa, 20, "mesa");
  if (b.referencia !== undefined) cambio.referencia = textoOpcional(b.referencia, 60, "referencia");
  if (b.entrega !== undefined) cambio.entrega = b.entrega === null ? null : validarEntrega(b.entrega);
  if (b.notas !== undefined) cambio.notas = textoOpcional(b.notas, 500, "notas");
  if (b.lineas !== undefined) cambio.lineas = validarLineas(b.lineas);
  if (!Object.keys(cambio).length) throw malo("no hay nada que cambiar");
  return cambio;
}

// Subtotales y total con enteros en centavos (los precios del catálogo tienen 2 decimales como máximo).
// Una línea sin precio deja su subtotal y el total en null: nunca se inventa un precio.
export function calcularTotales(snapshotLineas, cantidades) {
  let centavos = 0;
  let completo = true;
  const subtotales = snapshotLineas.map((s, i) => {
    if (s.precio == null) {
      completo = false;
      return null;
    }
    const c = Math.round(s.precio * 100) * cantidades[i];
    centavos += c;
    return c / 100;
  });
  return { subtotales, total: completo ? centavos / 100 : null };
}

// Tras fusionar una edición, el pedido tiene que seguir cumpliendo las reglas de su canal
export function validarCoherencia(d) {
  if (d.canal === "salon") {
    if (!d.mesa) throw malo("mesa es obligatoria en un pedido de salón");
    if (d.entrega) throw malo("entrega solo va en un pedido de delivery");
  } else {
    if (d.mesa) throw malo("mesa solo va en un pedido de salón");
    if (d.canal === "llevar") {
      if (!d.referencia) throw malo("referencia (a nombre de quién) es obligatoria en un pedido para llevar");
      if (d.entrega) throw malo("entrega solo va en un pedido de delivery");
    } else if (!d.entrega) throw malo("entrega es obligatoria en un pedido de delivery");
  }
}
