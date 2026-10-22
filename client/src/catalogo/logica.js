// Lógica pura de la vista pública de la carta (sin React ni navegador): se prueba con node --test.

/** El slug de la empresa: último tramo de `/tobt/catalogo/<slug>`; en desarrollo, `?empresa=<slug>`. */
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

/** Texto de un movimiento de puntos para la lista (el servicio manda `detalle` solo en algunos). */
export function textoMovimiento(m) {
  if (m?.detalle) return m.detalle;
  return { acumulo: "Puntos ganados", canje: "Canje de puntos", ajuste: "Ajuste", vencimiento: "Puntos vencidos" }[m?.tipo] ?? "Movimiento";
}

/** Valida el formulario de registro antes de enviarlo (el servidor valida de verdad). Devuelve un texto o null. */
export function validarRegistro({ nombre, usuario, password, repetir }) {
  if (!String(nombre ?? "").trim()) return "Escribe tu nombre.";
  if (!String(usuario ?? "").trim()) return "Escribe tu correo o tu teléfono.";
  if (String(password ?? "").length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (password !== repetir) return "Las contraseñas no coinciden.";
  return null;
}

/** Separa lo que escribió el cliente en correo o teléfono (lo que lleva @ es correo). */
export function cuerpoRegistro({ nombre, usuario, password, quierePuntos }) {
  const u = String(usuario).trim();
  return {
    nombre: String(nombre).trim(),
    ...(u.includes("@") ? { correo: u } : { telefono: u }),
    password,
    quierePuntos: quierePuntos === true,
  };
}

// ---------- beneficios y vales (5.30) ----------

/** Cuántos puntos le faltan al cliente para un beneficio (0 si ya le alcanza). */
export const faltanPuntos = (beneficio, saldo) => Math.max(0, (Number(beneficio?.puntos) || 0) - (Number(saldo) || 0));

/** «K7M2QX» → «K7M 2QX»: se lee y se dicta mejor en dos grupos. */
export const formatoCodigoVale = (codigo) => (String(codigo ?? "").length === 6 ? `${codigo.slice(0, 3)} ${codigo.slice(3)}` : String(codigo ?? ""));

/** Los vales que se pueden usar (activos, primero el que vence antes) y el resto (usados, cancelados, vencidos). */
export function agruparVales(vales) {
  const lista = Array.isArray(vales) ? vales : [];
  return {
    activos: lista.filter((v) => v.estado === "activo").sort((a, b) => new Date(a.venceTs) - new Date(b.venceTs)),
    otros: lista.filter((v) => v.estado !== "activo"),
  };
}

/** «Vence hoy», «Vence mañana», «Vence en 5 días». Los días se cuentan desde la fecha de hoy, no por horas. */
export function textoVence(venceTs, ahora = new Date()) {
  const f = new Date(venceTs);
  if (Number.isNaN(f.getTime())) return "";
  const dia = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const dias = Math.round((dia(f) - dia(ahora)) / 86_400_000);
  if (dias <= 0) return "Vence hoy";
  if (dias === 1) return "Vence mañana";
  return `Vence en ${dias} días`;
}

export const ESTADO_VALE = { usado: "Usado", cancelado: "Cancelado", vencido: "Vencido" };

// ---------- retos de colección (5.31) ----------

/** «2 de 5 cafés»: lo probado sobre el total del reto. */
export const textoAvance = (r) => `${r?.logrados ?? 0} de ${r?.total ?? 0}`;

/** Lo que falta por probar, para decirlo en una línea: «Te faltan: Moka y Cortado». */
export function textoFaltan(faltan) {
  const nombres = (Array.isArray(faltan) ? faltan : []).map((i) => i.nombre ?? i.codigo).filter(Boolean);
  if (!nombres.length) return "";
  if (nombres.length === 1) return `Te falta: ${nombres[0]}`;
  if (nombres.length <= 4) return `Te faltan: ${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}`;
  return `Te faltan ${nombres.length}: ${nombres.slice(0, 3).join(", ")}…`;
}

/** Porcentaje (0 a 100) de avance de un reto. */
export const porcentajeReto = (r) => (r?.total > 0 ? Math.round(((r.logrados ?? 0) / r.total) * 100) : 0);
