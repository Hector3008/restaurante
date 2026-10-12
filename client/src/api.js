// Cliente HTTP del front del restaurante. Mismo patrón que cuenta/client/src/api.js: el front se sirve en
// `<base>/restaurante/` y la API vive en `<base>/`; con "../" relativo al documento se obtiene `<base>/`
// sin conocer el BASE_PATH del gateway (mismo origen: la cookie `sid` funciona sin CORS).
//
// Todo lo que este front supone de las respuestas está aquí y en pedidos.js.
const BASE = new URL("../", document.baseURI).pathname;

/** Dónde iniciar sesión, elegir empresa o cambiar la contraseña (el front de `cuenta`). */
export const urlCuenta = BASE + "cuenta/";

export class ErrorApi extends Error {
  constructor(status, codigo, mensaje, datos) {
    super(mensaje || "Error inesperado");
    this.status = status;
    this.codigo = codigo;
    this.datos = datos;
  }
}

// El servicio responde { error: "texto", codigo, ...detalle }; /auth puede responder otras formas.
function extraerError(datos) {
  const e = datos?.error;
  return {
    codigo: datos?.codigo ?? (typeof e === "object" ? e?.codigo : null) ?? null,
    mensaje: datos?.mensaje ?? (typeof e === "string" ? e : e?.mensaje) ?? null,
  };
}

async function pedir(metodo, ruta, cuerpo) {
  const cabeceras = { Accept: "application/json" };
  const opciones = { method: metodo, credentials: "same-origin", headers: cabeceras };
  // El backend exige esta cabecera en POST, PUT y DELETE (protección CSRF, 5.13).
  if (metodo !== "GET") cabeceras["x-requested-with"] = "restaurante";
  if (cuerpo !== undefined) {
    cabeceras["Content-Type"] = "application/json";
    opciones.body = JSON.stringify(cuerpo);
  }
  let r;
  try {
    r = await fetch(BASE + ruta, opciones);
  } catch {
    throw new ErrorApi(0, "SIN_CONEXION", "No se pudo conectar con el servidor.");
  }
  const datos = await r.json().catch(() => null);
  if (!r.ok) {
    const { codigo, mensaje } = extraerError(datos);
    throw new ErrorApi(r.status, codigo, mensaje, datos);
  }
  return datos;
}

/** Lo mínimo de /auth/yo que usa este front: permisos y si hay empresa activa. */
export function normalizarYo(d) {
  const yo = d?.yo ?? d ?? {};
  const empresas = yo.empresas ?? yo.membresias ?? [];
  const activa = empresas.find((e) => (e.empresaId ?? e.id ?? e._id) === (yo.empresaActivaId ?? yo.empresaId));
  return {
    usuario: yo.usuario ?? null,
    empresaActivaId: yo.empresaActivaId ?? yo.empresaId ?? null,
    empresa: activa ? { nombre: activa.nombre ?? activa.empresa?.nombre ?? "", rol: activa.rol?.nombre ?? activa.rol ?? null } : null,
    permisos: Array.isArray(yo.permisos) ? yo.permisos : [],
    debeCambiarPassword: Boolean(yo.debeCambiarPassword ?? yo.usuario?.debeCambiarPassword),
  };
}

const lista = (d) => (Array.isArray(d) ? d : d?.pedidos ?? []);

export const api = {
  yo: async () => normalizarYo(await pedir("GET", "auth/yo")),
  listar: async (estado) =>
    lista(await pedir("GET", `restaurante/pedidos${estado ? `?estado=${encodeURIComponent(estado)}&limite=200` : "?limite=200"}`)),
  obtener: (code) => pedir("GET", `restaurante/pedidos/${encodeURIComponent(code)}`),
  crear: (cuerpo) => pedir("POST", "restaurante/pedidos", cuerpo),
  editar: (code, cuerpo) => pedir("PUT", `restaurante/pedidos/${encodeURIComponent(code)}`, cuerpo),
  // ruta: enviar | lista | entregar | cobrar | anular
  paso: (code, ruta, cuerpo = {}) => pedir("POST", `restaurante/pedidos/${encodeURIComponent(code)}/${ruta}`, cuerpo),
  // Búsqueda en el catálogo (catalogo:leer): por comienzo del código o parte del nombre.
  buscarCatalogo: async (q) => {
    const d = await pedir("GET", `catalogo/?q=${encodeURIComponent(q)}&limite=20`);
    return Array.isArray(d) ? d : Object.values(d ?? {}).find(Array.isArray) ?? [];
  },
};

/** Texto para mostrar. Los mensajes del servicio y del núcleo ya vienen en español: se usan tal cual. */
export function mensajeDeError(e) {
  if (!(e instanceof ErrorApi)) return "Ocurrió un error inesperado.";
  if (e.status === 0) return e.message;
  if (e.status === 401) return "Tu sesión caducó. Vuelve a entrar.";
  if (e.codigo === "CONFLICTO_VERSION") return "Otra persona cambió este pedido mientras lo editabas. Vuelve al pedido, mira lo último y repite el cambio.";
  if (e.status === 429) return "Demasiados intentos. Espera unos minutos.";
  if (e.status >= 500) return "El servidor tuvo un problema. Intenta de nuevo en un momento.";
  return e.message || "No se pudo completar la acción.";
}
