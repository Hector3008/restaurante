// Recibos y cuenta en el front (5.32). Lógica pura: se valida lo mismo que el servidor para avisar antes de enviar;
// el servidor valida de verdad. Los recibos no son fiscales.

/** Formas de pago. El valor vacío es «sin indicar»: el cobro sigue como antes y el recibo no dice cómo se pagó. */
export const METODOS_PAGO = [
  ["efectivo", "Efectivo"],
  ["tarjeta", "Tarjeta"],
  ["yape", "Yape"],
  ["plin", "Plin"],
  ["transferencia", "Transferencia"],
  ["otro", "Otro"],
];

export const PAGO_INICIAL = Object.freeze({ metodo: "", propina: "", recibido: "" });

const aNumero = (t) => (String(t ?? "").trim() === "" ? null : Number(String(t).trim().replace(",", ".")));
const dosDecimales = (n) => Math.abs(Math.round(n * 100) / 100 - n) < 1e-9;

/** Lo que falla en el formulario de pago, o null si está bien. */
export function validarPagoForm(f) {
  const propina = aNumero(f.propina);
  const recibido = aNumero(f.recibido);
  if (!f.metodo) {
    if (propina !== null || recibido !== null) return "Elige la forma de pago para anotar la propina o el efectivo recibido.";
    return null;
  }
  if (!METODOS_PAGO.some(([id]) => id === f.metodo)) return "Elige una forma de pago de la lista.";
  if (propina !== null && (!Number.isFinite(propina) || propina < 0 || !dosDecimales(propina))) return "La propina debe ser un número de 0 o más, con 2 decimales como máximo.";
  if (recibido !== null) {
    if (f.metodo !== "efectivo") return "El efectivo recibido solo se anota en un pago en efectivo.";
    if (!Number.isFinite(recibido) || recibido <= 0 || !dosDecimales(recibido)) return "El efectivo recibido debe ser un número mayor que 0, con 2 decimales como máximo.";
  }
  return null;
}

/** El `pago` que se envía al cobrar, o undefined si no se indicó la forma de pago. Asume que el formulario ya es válido. */
export function cuerpoPago(f) {
  if (!f?.metodo) return undefined;
  const propina = aNumero(f.propina);
  const recibido = f.metodo === "efectivo" ? aNumero(f.recibido) : null;
  return { metodo: f.metodo, ...(propina ? { propina } : {}), ...(recibido ? { recibido } : {}) };
}

/** «21 oct 2026, 20:15» en hora local. Vacío si no hay fecha válida. */
export function formatoFechaHora(ts) {
  const d = new Date(ts);
  if (!ts || Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

/** El título del documento: cada clase deja claro qué es y que no es fiscal. */
export const tituloRecibo = (r) => (r?.tipo === "pago" ? "Recibo de pago" : "Cuenta");
export const notaRecibo = (r) =>
  r?.tipo === "pago" ? "Documento no fiscal: no es una factura ni una boleta." : "Cuenta de consumo: no es un comprobante de pago.";

/** Lo que dice la línea del vale en un renglón: «Vale K7M2QX: −6,50». */
export const textoDescuentoLinea = (l, formato) => (l?.descuento ? `Vale ${l.descuento.vale}: −${formato(l.descuento.monto)}` : "");

/** Aviso tras cobrar: el recibo emitido o el problema. null si no se cobró nada nuevo. */
export function avisoRecibo(respuesta) {
  if (respuesta?.recibo?.code) return { code: respuesta.recibo.code };
  if (respuesta?.reciboError) return { error: true };
  return null;
}
