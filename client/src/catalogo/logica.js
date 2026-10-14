// Lógica pura de la vista pública de la carta (sin React ni navegador): se prueba con node --test.

/** El slug de la empresa: último tramo de `/restaurante/catalogo/<slug>`; en desarrollo, `?empresa=<slug>`. */
export function slugDesdeUbicacion(pathname, search = "") {
  const m = /\/catalogo\/([^/]+)\/?$/.exec(pathname ?? "");
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return null;
    }
  }
  const q = new URLSearchParams(search).get("empresa");
  return q ? q : null;
}

/** Con moneda conocida, formato de moneda; null = sin precio ("Consultar"). */
export function formatoPrecio(valor, moneda) {
  if (valor === null || valor === undefined) return "Consultar";
  const n = Number(valor);
  if (!Number.isFinite(n)) return "Consultar";
  if (!moneda) return n.toFixed(2);
  try {
    return new Intl.NumberFormat("es-PE", { style: "currency", currency: moneda }).format(n);
  } catch {
    return `${n.toFixed(2)} ${moneda}`;
  }
}

const sinTildes = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Filtra la carta por texto (nombre o código, sin distinguir mayúsculas ni tildes) y por categoría. */
export function filtrarCarta(categorias, { texto = "", categoria = null } = {}) {
  const t = sinTildes(texto.trim());
  const salida = [];
  for (const c of categorias ?? []) {
    if (categoria && c.nombre !== categoria) continue;
    const items = t ? c.items.filter((i) => sinTildes(i.nombre).includes(t) || sinTildes(i.codigo).includes(t)) : c.items;
    if (items.length) salida.push({ ...c, items });
  }
  return salida;
}

export const totalItems = (categorias) => (categorias ?? []).reduce((n, c) => n + c.items.length, 0);

/** "+45" / "−20" con su signo; los puntos son enteros. */
export function formatoPuntos(p) {
  const n = Math.trunc(Number(p) || 0);
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
}

export function formatoFecha(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", year: "numeric" }).format(d);
}

/** Ruta por hash (como el front de personal): `#/plato/<codigo>` abre el detalle; cualquier otra cosa, la carta. */
export function rutaDesdeHash(hash) {
  const m = /^#\/plato\/([^/]+)$/.exec(hash ?? "");
  if (!m) return { vista: "carta" };
  try {
    return { vista: "plato", codigo: decodeURIComponent(m[1]) };
  } catch {
    return { vista: "carta" };
  }
}

export const hashPlato = (codigo) => `#/plato/${encodeURIComponent(codigo)}`;

/** Estrellas llenas (0 a 5) para una nota; redondea al entero más cercano. */
export function estrellasLlenas(nota) {
  const n = Math.round(Number(nota));
  return Number.isFinite(n) ? Math.min(5, Math.max(0, n)) : 0;
}

/** "4,7" con coma decimal. */
export const formatoNota = (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(1).replace(".", ",") : "—");
