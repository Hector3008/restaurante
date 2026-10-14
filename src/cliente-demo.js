// Cliente FIJO (hardcodeado) para la vista pública de la carta. Es provisional: la identidad del cliente final
// (cuenta, QR de mesa, reconocimiento por teléfono) sigue sin diseñarse (arquitectura, sección 6) y los puntos
// de fidelización (5.11) todavía no existen en el núcleo. Cuando existan, este módulo es lo único que se
// reemplaza: `publico.js` solo le pide `clienteActual({ empresa })`.
//
// No sale de ninguna base de datos y es el mismo para todas las empresas. La respuesta lleva `demo: true`
// y el front lo avisa en pantalla, para que nadie tome estos puntos por reales.

export const CLIENTE_DEMO = Object.freeze({
  nombre: "Cliente de prueba",
  puntos: 120,
  movimientos: Object.freeze([
    Object.freeze({ tipo: "acumulo", puntos: 45, ts: "2026-10-09T13:20:00.000Z", detalle: "Pedido pagado" }),
    Object.freeze({ tipo: "acumulo", puntos: 30, ts: "2026-10-02T19:05:00.000Z", detalle: "Pedido pagado" }),
    Object.freeze({ tipo: "canje", puntos: -20, ts: "2026-09-27T12:40:00.000Z", detalle: "Canje de beneficio" }),
    Object.freeze({ tipo: "acumulo", puntos: 65, ts: "2026-09-20T18:10:00.000Z", detalle: "Pedido pagado" }),
  ]),
});

/** El cliente que "está mirando" la carta. Hoy siempre el mismo. */
export function clienteActual() {
  return {
    demo: true,
    nombre: CLIENTE_DEMO.nombre,
    puntos: CLIENTE_DEMO.puntos,
    movimientos: CLIENTE_DEMO.movimientos.map((m) => ({ ...m })),
  };
}
