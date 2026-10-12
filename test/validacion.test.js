import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validarCreacion,
  validarLineas,
  validarEdicion,
  validarCoherencia,
  validarCode,
  calcularTotales,
} from "../src/validacion.js";

const cod = (c) => (e) => e?.codigo === c;
const linea = { codigo: "CAFE-1", cantidad: 2 };

describe("validación de pedidos", () => {
  it("salón: exige mesa y normaliza el cuerpo", () => {
    const p = validarCreacion({ canal: "salon", mesa: " 4 ", lineas: [linea, { codigo: "TE-1" }] });
    assert.equal(p.mesa, "4");
    assert.equal(p.lineas[1].cantidad, 1);
    assert.equal(p.lineas[1].notas, null);
    assert.throws(() => validarCreacion({ canal: "salon", lineas: [linea] }), cod("DATOS_INVALIDOS"));
  });

  it("llevar exige referencia y no admite mesa ni entrega", () => {
    assert.ok(validarCreacion({ canal: "llevar", referencia: "Ana", lineas: [linea] }));
    assert.throws(() => validarCreacion({ canal: "llevar", lineas: [linea] }), cod("DATOS_INVALIDOS"));
    assert.throws(() => validarCreacion({ canal: "llevar", referencia: "A", mesa: "1", lineas: [linea] }), cod("DATOS_INVALIDOS"));
  });

  it("delivery exige dirección y teléfono válido", () => {
    const entrega = { direccion: "Jr. Lima 123", telefono: "+51 987 654 321" };
    assert.ok(validarCreacion({ canal: "delivery", entrega, lineas: [linea] }));
    assert.throws(() => validarCreacion({ canal: "delivery", lineas: [linea] }), cod("DATOS_INVALIDOS"));
    assert.throws(() => validarCreacion({ canal: "delivery", entrega: { direccion: "x" }, lineas: [linea] }), cod("DATOS_INVALIDOS"));
    assert.throws(() => validarCreacion({ canal: "delivery", entrega: { ...entrega, telefono: "abc" }, lineas: [linea] }), cod("DATOS_INVALIDOS"));
  });

  it("rechaza canal desconocido, campos sobrantes y líneas mal formadas", () => {
    const base = { canal: "salon", mesa: "1" };
    assert.throws(() => validarCreacion({ ...base, canal: "mostrador", lineas: [linea] }), cod("DATOS_INVALIDOS"));
    assert.throws(() => validarCreacion({ ...base, total: 1, lineas: [linea] }), cod("DATOS_INVALIDOS"));
    for (const l of [
      {},
      { codigo: "A", libre: { nombre: "x" } },
      { codigo: "A", cantidad: 0 },
      { codigo: "A", cantidad: 1.5 },
      { codigo: "A", cantidad: 100 },
      { codigo: "A", precio: -1 },
      { codigo: "A", notas: "x".repeat(201) },
      "A",
    ])
      assert.throws(() => validarCreacion({ ...base, lineas: [l] }), cod("DATOS_INVALIDOS"));
    assert.throws(() => validarCreacion({ ...base, lineas: [] }), cod("DATOS_INVALIDOS"));
    assert.throws(() => validarCreacion({ ...base, lineas: Array(101).fill(linea) }), cod("DATOS_INVALIDOS"));
  });

  it("acepta una línea libre sin validarla (la valida el catálogo)", () => {
    const p = validarCreacion({ canal: "salon", mesa: "1", lineas: [{ libre: { nombre: "Postre del día" } }] });
    assert.deepEqual(p.lineas[0].item, { libre: { nombre: "Postre del día" } });
  });

  it("edición: undefined no toca, null quita, vacía falla, el canal no se cambia", () => {
    assert.deepEqual(validarEdicion({ notas: null }), { notas: null });
    assert.deepEqual(validarEdicion({ mesa: "7" }), { mesa: "7" });
    assert.throws(() => validarEdicion({}), cod("DATOS_INVALIDOS"));
    assert.throws(() => validarEdicion({ canal: "llevar" }), cod("DATOS_INVALIDOS"));
  });

  it("coherencia tras fusionar según el canal", () => {
    assert.throws(() => validarCoherencia({ canal: "salon", mesa: null }), cod("DATOS_INVALIDOS"));
    assert.throws(() => validarCoherencia({ canal: "llevar", referencia: "A", mesa: "1" }), cod("DATOS_INVALIDOS"));
    assert.throws(() => validarCoherencia({ canal: "delivery", entrega: null }), cod("DATOS_INVALIDOS"));
    assert.doesNotThrow(() => validarCoherencia({ canal: "salon", mesa: "2", entrega: null }));
  });

  it("el código del pedido tiene forma PD-0000000", () => {
    assert.equal(validarCode("PD-0000012"), "PD-0000012");
    for (const c of ["DP-0000012", "PD-12", "", null, { $ne: 1 }])
      assert.throws(() => validarCode(c), cod("NO_ENCONTRADO"));
  });

  it("totales en centavos sin errores de coma flotante; sin precio, total null", () => {
    const r = calcularTotales([{ precio: 0.1 }, { precio: 0.2 }, { precio: 19.99 }], [3, 1, 3]);
    assert.deepEqual(r.subtotales, [0.3, 0.2, 59.97]);
    assert.equal(r.total, 60.47);
    const s = calcularTotales([{ precio: 5 }, { precio: null }], [1, 2]);
    assert.deepEqual(s.subtotales, [5, null]);
    assert.equal(s.total, null);
  });

  it("precio propio: solo en líneas del catálogo, número >= 0 con 2 decimales", () => {
    const ok = validarLineas([{ codigo: "A", precio: 0 }, { codigo: "B", precio: 12.5 }, { codigo: "C" }]);
    assert.deepEqual(ok.map((l) => l.precio), [0, 12.5, undefined]);
    for (const precio of [-1, 1.234, "5", null, NaN, Infinity])
      assert.throws(() => validarLineas([{ codigo: "A", precio }]), (e) => e.codigo === "DATOS_INVALIDOS", String(precio));
    assert.throws(() => validarLineas([{ libre: { nombre: "x" }, precio: 3 }]), (e) => e.codigo === "DATOS_INVALIDOS");
  });
});
