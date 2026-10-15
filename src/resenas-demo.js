// Reseñas de EJEMPLO para la tarjeta de detalle del plato. Provisional: todavía no
// hay identidad del cliente final ni dónde guardar reseñas. Solo texto y estrellas: sin imágenes ni videos
// (decisión de producto). Las mismas para todos los platos; la respuesta lleva `demo: true` y la página lo avisa.
// Cuando existan reseñas reales, solo se reemplaza `resenasDe()`.

const BASE = Object.freeze([
  Object.freeze({ autor: "Camila R.", estrellas: 5, texto: "Muy bien preparado y llegó caliente. Repito siempre.", ts: "2026-10-10T14:00:00.000Z" }),
  Object.freeze({ autor: "Diego M.", estrellas: 4, texto: "Muy rico, aunque en hora punta tardó un poco.", ts: "2026-10-06T19:30:00.000Z" }),
  Object.freeze({ autor: "Lucía P.", estrellas: 5, texto: "La porción es generosa y el precio justo.", ts: "2026-09-29T13:15:00.000Z" }),
]);

export function resenasDe() {
  const resenas = BASE.map((r) => ({ ...r }));
  const suma = resenas.reduce((n, r) => n + r.estrellas, 0);
  return { demo: true, total: resenas.length, promedio: Math.round((suma / resenas.length) * 10) / 10, resenas };
}
