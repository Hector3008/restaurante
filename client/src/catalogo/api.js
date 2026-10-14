// Cliente HTTP de la vista pública de la carta. Sin sesión: no envía cookies ni x-requested-with.
// La página se sirve con <base href> en la raíz del montaje (`<base>/restaurante/`), así que "../" lleva a `<base>/`
// sin conocer el BASE_PATH (igual que el front de personal).
const BASE = new URL("../", document.baseURI).pathname;

export class ErrorCarta extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

async function pedir(ruta) {
  let r;
  try {
    r = await fetch(BASE + ruta, { headers: { Accept: "application/json" }, credentials: "omit" });
  } catch {
    throw new ErrorCarta(0, "No se pudo conectar. Revisa tu conexión e intenta de nuevo.");
  }
  const datos = await r.json().catch(() => null);
  if (!r.ok) {
    if (r.status === 404) throw new ErrorCarta(404, datos?.error === "plato no encontrado" ? "No encontramos este plato." : "No encontramos esta carta. Revisa el enlace.");
    if (r.status === 429) throw new ErrorCarta(429, "Demasiadas consultas. Espera un momento y recarga.");
    throw new ErrorCarta(r.status, datos?.error || "No se pudo cargar. Intenta de nuevo en un momento.");
  }
  return datos;
}

const enc = encodeURIComponent;

export const api = {
  carta: (slug) => pedir(`restaurante/publico/${enc(slug)}/carta`),
  plato: (slug, codigo) => pedir(`restaurante/publico/${enc(slug)}/plato/${enc(codigo)}`),
  cliente: (slug) => pedir(`restaurante/publico/${enc(slug)}/cliente`),
};
