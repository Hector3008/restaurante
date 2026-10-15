// Cliente HTTP del front del restaurante. Mismo patrón que cuenta/client/src/api.js: el front se sirve en
// `<base>/restaurante/` y la API vive en `<base>/`; con "../" relativo al documento se obtiene `<base>/`
// sin conocer el BASE_PATH del gateway (mismo origen: la cookie `sid` funciona sin CORS).
//
// Todo lo que este front supone de las respuestas está aquí y en pedidos.js.
const BASE = new URL("../", document.baseURI).pathname;

/** Dónde iniciar sesión, elegir empresa o cambiar la contraseña (el front de `cuenta`). */
export const urlCuenta = BASE + "cuenta/";

/** La carta pública de una empresa (la ve el cliente, sin sesión): `<base>/restaurante/catalogo/<slug>`. */
export const urlCarta = (slug) => BASE + "restaurante/catalogo/" + encodeURIComponent(slug);

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
    empresa: activa
      ? { nombre: activa.nombre ?? activa.empresa?.nombre ?? "", rol: activa.rol?.nombre ?? activa.rol ?? null, slug: activa.slug ?? activa.empresa?.slug ?? null }
      : null,
    permisos: Array.isArray(yo.permisos) ? yo.permisos : [],
    debeCambiarPassword: Boolean(yo.debeCambiarPassword ?? yo.usuario?.debeCambiarPassword),
  };
}

const lista = (d, clave) => (Array.isArray(d) ? d : d?.[clave] ?? []);
const enc = encodeURIComponent;
const consulta = (estado, limite) => {
  const q = [estado ? `estado=${enc(estado)}` : "", limite ? `limite=${limite}` : ""].filter(Boolean).join("&");
  return q ? `?${q}` : "";
};

export const api = {
  yo: async () => normalizarYo(await pedir("GET", "auth/yo")),

  // Pedidos: lo que se cobra (todos los ítems de una mesa o persona)
  pedidos: {
    listar: async (estado) => lista(await pedir("GET", `restaurante/pedidos${consulta(estado, 200)}`), "pedidos"),
    obtener: (code) => pedir("GET", `restaurante/pedidos/${enc(code)}`),
    crear: (cuerpo) => pedir("POST", "restaurante/pedidos", cuerpo),
    agregar: (code, cuerpo) => pedir("POST", `restaurante/pedidos/${enc(code)}/items`, cuerpo),
    editar: (code, cuerpo) => pedir("PUT", `restaurante/pedidos/${enc(code)}`, cuerpo),
    // clienteId: id del cliente o null para quitarlo (solo con el pedido abierto)
    asociarCliente: (code, cuerpo) => pedir("PUT", `restaurante/pedidos/${enc(code)}/cliente`, cuerpo),
    cobrar: (code, cuerpo = {}) => pedir("POST", `restaurante/pedidos/${enc(code)}/cobrar`, cuerpo),
    anular: (code, cuerpo) => pedir("POST", `restaurante/pedidos/${enc(code)}/anular`, cuerpo),
  },

  // Ítems: un ítem que se mueve por las estaciones (cocina trabaja con estos)
  items: {
    listar: async (estado) => lista(await pedir("GET", `restaurante/items${consulta(estado, 200)}`), "items"),
    // ruta: lista | entregar | anular
    paso: (code, ruta, cuerpo = {}) => pedir("POST", `restaurante/items/${enc(code)}/${ruta}`, cuerpo),
  },

  // Clientes (cliente:leer / cliente:crear / cliente:cuenta): buscar por nombre, teléfono, correo o @usuario.
  buscarClientes: async (q) => lista(await pedir("GET", `clientes/?q=${enc(q)}&limite=10`), "clientes"),
  crearCliente: (cuerpo) => pedir("POST", "clientes", cuerpo),
  // Cuenta del cliente: devuelve la contraseña temporal UNA vez (no se guarda ni se vuelve a mostrar).
  crearCuenta: (clienteId) => pedir("POST", `clientes/${enc(clienteId)}/cuenta`, { generarPassword: true }),

  // Búsqueda en el catálogo (catalogo:leer): por comienzo del código o parte del nombre.
  buscarCatalogo: async (q) => {
    const d = await pedir("GET", `catalogo/?q=${enc(q)}&limite=20`);
    return Array.isArray(d) ? d : Object.values(d ?? {}).find(Array.isArray) ?? [];
  },
};

/** Texto para mostrar. Los mensajes del servicio y del núcleo ya vienen en español: se usan tal cual. */
export function mensajeDeError(e) {
  if (!(e instanceof ErrorApi)) return "Ocurrió un error inesperado.";
  if (e.status === 0) return e.message;
  if (e.status === 401) return "Tu sesión caducó. Vuelve a entrar.";
  if (e.codigo === "CONFLICTO_VERSION") return "Otra persona cambió esto mientras lo mirabas. Se recargó con lo último: revísalo y repite el cambio.";
  if (e.status === 429) return "Demasiados intentos. Espera unos minutos.";
  if (e.status >= 500) return "El servidor tuvo un problema. Intenta de nuevo en un momento.";
  return e.message || "No se pudo completar la acción.";
}
