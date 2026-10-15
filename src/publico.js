import { ErrorPedido } from "./errores.js";
import { ErrorCatalogo } from "core";
import { resenasDe } from "./resenas-demo.js";

// Vista pública de la carta (sin sesión). La empresa se identifica por su `slug` (arquitectura 5.13: los pedidos
// por QR serán una ruta pública con la empresa por slug). Solo se expone lo que un cliente puede ver:
// nombre de la empresa, moneda y, de cada ítem ACTIVO del catálogo, código, nombre, categoría y precio; el detalle
// de un plato suma su descripción y foto. Nunca el resto de `atributos` (son internos del servicio), ni ítems
// desactivados, ni nada de pedidos o clientes reales.

const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
const SIN_CATEGORIA = "Otros";
const TOPE_ITEMS = 1000; // la carta se lee por páginas de 200 (máximo de core.catalogo.listar)

const noEncontrada = () => new ErrorPedido("NO_ENCONTRADO", "carta no encontrada");
const platoNoEncontrado = () => new ErrorPedido("NO_ENCONTRADO", "plato no encontrado");

// La descripción y la foto de un plato viven en los atributos del ítem: DESCRIPCION (texto) e IMAGEN (URL).
// Solo esos dos campos salen al público, nunca el resto de `atributos`.
export const CAMPOS_PLATO = { DESCRIPCION: "texto", IMAGEN: "texto" };

/** Solo URLs https absolutas y sin credenciales: lo demás (javascript:, data:, http:, relativas) se descarta. */
export function urlImagenSegura(valor) {
  if (typeof valor !== "string" || valor.length > 500) return null;
  try {
    const u = new URL(valor.trim());
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}

const textoONulo = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Agrupa por categoría conservando el orden alfabético del catálogo; lo sin categoría va al final. */
export function agruparPorCategoria(items) {
  const grupos = new Map();
  for (const i of items) {
    const nombre = i.categoria?.trim() ? i.categoria.trim() : SIN_CATEGORIA;
    if (!grupos.has(nombre)) grupos.set(nombre, []);
    grupos.get(nombre).push({ codigo: i.codigo, nombre: i.nombre, precio: i.precio ?? null });
  }
  const lista = [...grupos].map(([nombre, its]) => ({ nombre, items: its }));
  lista.sort((a, b) => {
    if (a.nombre === SIN_CATEGORIA) return b.nombre === SIN_CATEGORIA ? 0 : 1;
    if (b.nombre === SIN_CATEGORIA) return -1;
    return a.nombre.localeCompare(b.nombre, "es");
  });
  return lista;
}

export function crearPublico(core) {
  /**
   * Empresa pública por slug: debe existir, estar activa y tener el servicio `restaurante` activo.
   * Todos los casos de rechazo dan el mismo 404: no se revela qué empresas existen.
   */
  async function empresaPorSlug(slug) {
    if (typeof slug !== "string" || !SLUG.test(slug)) throw noEncontrada();
    // Empresa es un modelo global (sin tenancy): se consulta sin empresa activa.
    const e = await core.modelos.Empresa.findOne({ slug }).lean();
    if (!e || e.activa === false) throw noEncontrada();
    const sirve = (e.servicios ?? []).some((s) => s.codigo === "restaurante" && s.activa !== false);
    if (!sirve) throw noEncontrada();
    return e;
  }

  async function carta({ slug }) {
    const e = await empresaPorSlug(slug);
    const empresaId = e._id;
    const items = [];
    for (let saltar = 0; saltar < TOPE_ITEMS; saltar += 200) {
      const pagina = await core.catalogo.listar({ empresaId, limite: 200, saltar });
      items.push(...pagina);
      if (pagina.length < 200) break;
    }
    return {
      empresa: { nombre: e.nombre, slug: e.slug, moneda: e.moneda ?? "PEN" },
      categorias: agruparPorCategoria(items),
    };
  }

  /** Un plato (ítem activo) con descripción y foto opcionales, y sus reseñas (de ejemplo, solo texto). */
  async function plato({ slug, codigo }) {
    const e = await empresaPorSlug(slug);
    let i;
    try {
      i = await core.catalogo.obtener({ empresaId: e._id, codigo });
    } catch (err) {
      if (err instanceof ErrorCatalogo) throw platoNoEncontrado();
      throw err;
    }
    if (i.activo === false) throw platoNoEncontrado();
    const a = i.atributos ?? {};
    return {
      empresa: { nombre: e.nombre, slug: e.slug, moneda: e.moneda ?? "PEN" },
      plato: {
        codigo: i.codigo,
        nombre: i.nombre,
        categoria: i.categoria ?? null,
        precio: i.precio ?? null,
        descripcion: textoONulo(a.DESCRIPCION),
        imagen: urlImagenSegura(a.IMAGEN),
      },
      resenas: resenasDe(),
    };
  }

  /** La empresa de una petición pública, en la forma que piden los manejadores de cuentas del núcleo. */
  async function empresaDe(req) {
    const e = await empresaPorSlug(req.params?.empresa);
    return { id: e._id, slug: e.slug };
  }

  return { carta, plato, empresaPorSlug, empresaDe };
}
