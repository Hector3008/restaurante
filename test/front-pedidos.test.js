// Lógica pura del front (client/src/pedidos.js y api.js): sin React, sin navegador y sin base de datos.
// Las pruebas de "coincide con el servicio" fijan que el front y src/ no se separen sin que falle algo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TIPO_PEDIDO, MOTIVOS_ANULACION as MOTIVOS_SERVICIO } from "../src/index.js";
import { validarCreacion, validarEdicion, validarLinea } from "../src/validacion.js";
import {
  permite, ESTADOS, EDITABLES, MOTIVOS_ANULACION, FILTROS, accionesDe, destinoDe,
  formatoDinero, parsearPrecio, totalEstimado, agregarDelCatalogo, agregarLibre, cambiarCantidad,
  lineaAEnvio, fijarPrecio, puedeCambiarPrecio, lineasDesdeDetalle, formularioVacio, formularioDesdeDetalle, validarFormulario,
  cuerpoCreacion, cuerpoEdicion,
} from "../client/src/pedidos.js";

// api.js calcula la ruta base con document.baseURI al importarse: se simula antes de cargarlo.
globalThis.document ??= { baseURI: "http://localhost/restaurante/" };
const { ErrorApi, mensajeDeError, normalizarYo, urlCuenta } = await import("../client/src/api.js");

// Roles de la plantilla `restaurante` del núcleo (core/src/modelos/plantillas.js)
const MESERO = ["estacion:creacion", "estacion:carta", "documento:crear", "documento:leer", "documento:editar", "catalogo:leer", "cliente:leer", "cliente:crear"];
const COCINA = ["estacion:cocina", "documento:leer", "documento:editar"];
const SOLO_EDITAR = ["documento:leer", "documento:editar"];
const pasos = (estado, permisos) => accionesDe(estado, permisos).pasos.map((p) => p.id);

test("permite: misma regla que el núcleo", () => {
  assert.equal(permite(["*"], "documento:crear"), true);
  assert.equal(permite(["documento:*"], "documento:crear"), true);
  assert.equal(permite(["documento:leer"], "documento:crear"), false);
  assert.equal(permite([], "documento:leer"), false);
  assert.equal(permite(undefined, "documento:leer"), false);
});

// ---------- coincidencia con el servicio ----------
test("el front conoce los mismos motivos de anulación y estados editables que el servicio", () => {
  assert.deepEqual(MOTIVOS_ANULACION.map(([c]) => c), MOTIVOS_SERVICIO);
  assert.deepEqual(EDITABLES, TIPO_PEDIDO.editables);
});

test("el front tiene nombre para todos los estados del documento y un filtro por cada uno", () => {
  const estados = new Set([TIPO_PEDIDO.estadoInicial, ...Object.keys(TIPO_PEDIDO.transiciones), ...Object.values(TIPO_PEDIDO.transiciones).flat()]);
  for (const e of estados) assert.ok(ESTADOS[e], `falta el nombre de ${e}`);
  for (const e of estados) assert.ok(FILTROS.some((f) => f.estado.split(",").includes(e)), `ningún filtro muestra ${e}`);
});

test("los cuerpos que arma el front los acepta el validador del servicio, en los tres canales", () => {
  const lineas = agregarLibre(agregarDelCatalogo([], { codigo: "CAFE-1", nombre: "Café", precio: 6.5 }), { nombre: "Torta del día", precio: 9 });
  const base = { ...formularioVacio(), lineas, notas: "  sin azúcar " };
  const salon = { ...base, canal: "salon", mesa: " 4 " };
  const llevar = { ...base, canal: "llevar", referencia: "Ana" };
  const delivery = { ...base, canal: "delivery", direccion: "Av. Lima 123", telefono: "+51 987 654 321", referenciaEntrega: "" };
  for (const f of [salon, llevar, delivery]) {
    assert.equal(validarFormulario(f), null, f.canal);
    const v = validarCreacion(cuerpoCreacion(f));
    assert.equal(v.canal, f.canal);
    assert.equal(v.notas, "sin azúcar");
    assert.equal(v.lineas.length, 2);
    const { esperaVersion, ...edicion } = cuerpoEdicion(f, 3); // la ruta quita esperaVersion antes de validar
    assert.equal(esperaVersion, 3);
    assert.ok(validarEdicion(edicion).lineas);
  }
  assert.equal(validarCreacion(cuerpoCreacion(salon)).mesa, "4");
  assert.equal(validarCreacion(cuerpoCreacion(delivery)).entrega.referencia, null);
  assert.ok(!("mesa" in cuerpoCreacion(llevar)) && !("entrega" in cuerpoCreacion(llevar)), "cada canal rechaza los campos de otros");
});

test("las líneas que arma el front las acepta validarLinea (catálogo y libre)", () => {
  const cat = lineaAEnvio({ codigo: "CAFE-1", nombre: "Café", precio: 6.5, cantidad: 2, notas: " sin hielo " });
  assert.deepEqual(cat, { codigo: "CAFE-1", cantidad: 2, notas: "sin hielo" });
  const libre = lineaAEnvio({ libre: true, nombre: "Torta", precio: null, cantidad: 1, notas: "" });
  assert.deepEqual(libre, { libre: { nombre: "Torta" }, cantidad: 1 });
  assert.deepEqual(lineaAEnvio({ libre: true, nombre: "Torta", precio: 9, cantidad: 1, notas: "", codigoLibre: "PROV-1" }).libre, { nombre: "Torta", precio: 9, codigo: "PROV-1" });
  assert.equal(validarLinea(cat, 0).item, "CAFE-1");
  assert.deepEqual(validarLinea(libre, 0).item, { libre: { nombre: "Torta" } });
});

// ---------- formulario ----------
test("validarFormulario pide lo que exige cada canal y al menos un ítem", () => {
  const una = agregarLibre([], { nombre: "X", precio: null });
  assert.match(validarFormulario({ ...formularioVacio("salon"), lineas: una }), /mesa/i);
  assert.match(validarFormulario({ ...formularioVacio("llevar"), lineas: una }), /nombre/i);
  assert.match(validarFormulario({ ...formularioVacio("delivery"), lineas: una }), /dirección/i);
  assert.match(validarFormulario({ ...formularioVacio("delivery"), direccion: "x", lineas: una }), /teléfono/i);
  assert.match(validarFormulario({ ...formularioVacio("delivery"), direccion: "x", telefono: "abc", lineas: una }), /teléfono/i);
  assert.match(validarFormulario({ ...formularioVacio("salon"), mesa: "1" }), /ítem/i);
  assert.equal(validarFormulario({ ...formularioVacio("salon"), mesa: "1", lineas: una }), null);
});

test("cantidades: tope de 1 a 99 y el mismo código no se duplica (sin distinguir mayúsculas)", () => {
  let l = agregarDelCatalogo([], { codigo: "ZM-1", nombre: "A", precio: 1 });
  l = agregarDelCatalogo(l, { codigo: "zm-1", nombre: "A", precio: 1 });
  assert.equal(l.length, 1);
  assert.equal(l[0].cantidad, 2);
  assert.equal(cambiarCantidad(l, l[0].clave, -5)[0].cantidad, 1);
  assert.equal(cambiarCantidad(l, l[0].clave, 500)[0].cantidad, 99);
});

test("editar un pedido recompone las líneas y el formulario desde el detalle", () => {
  const detalle = {
    doc: { canal: "delivery", entrega: { direccion: "Av. 1", telefono: "999 111 222", referencia: null }, notas: null,
      lineas: [{ cantidad: 2, notas: "sin hielo", subtotal: 13 }, { cantidad: 1, notas: null, subtotal: null }] },
    snapshot: { lineas: [{ origen: "catalogo", codigo: "CAFE-1", nombre: "Café", precio: 6.5 }, { origen: "libre", codigo: null, nombre: "Torta", precio: null }] },
  };
  const ls = lineasDesdeDetalle(detalle);
  assert.deepEqual(ls.map(lineaAEnvio), [{ codigo: "CAFE-1", cantidad: 2, notas: "sin hielo" }, { libre: { nombre: "Torta" }, cantidad: 1 }]);
  const f = formularioDesdeDetalle(detalle);
  assert.equal(f.canal, "delivery");
  assert.equal(f.direccion, "Av. 1");
  assert.equal(validarFormulario(f), null);
  assert.ok(validarEdicion((({ esperaVersion, ...r }) => r)(cuerpoEdicion(f, 1))).entrega);
});

// ---------- dinero ----------
test("totalEstimado usa centavos y no inventa precios", () => {
  assert.equal(totalEstimado([{ precio: 0.1, cantidad: 3 }]), 0.3);
  assert.equal(totalEstimado([{ precio: 6.5, cantidad: 2 }, { precio: 9, cantidad: 1 }]), 22);
  assert.equal(totalEstimado([{ precio: 6.5, cantidad: 2 }, { precio: null, cantidad: 1 }]), null);
  assert.equal(totalEstimado([]), 0);
});

test("parsearPrecio y formatoDinero", () => {
  assert.deepEqual(parsearPrecio(""), { ok: true, valor: null });
  assert.deepEqual(parsearPrecio("12,5"), { ok: true, valor: 12.5 });
  for (const malo of ["1.234", "-3", "abc"]) assert.equal(parsearPrecio(malo).ok, false, malo);
  assert.equal(formatoDinero(null, "PEN"), "—");
  assert.equal(formatoDinero(12.5, null), "12.50");
  assert.match(formatoDinero(12.5, "PEN"), /12[.,]50/);
});

// ---------- qué ofrece cada rol ----------
test("accionesDe: el mesero envía, entrega y edita, pero no marca lista, cobra ni anula", () => {
  assert.deepEqual(pasos("abierta", MESERO), ["enviar"]);
  assert.deepEqual(pasos("en_cocina", MESERO), []);
  assert.deepEqual(pasos("lista", MESERO), ["entregar"]);
  assert.deepEqual(pasos("entregada", MESERO), []);
  assert.equal(accionesDe("abierta", MESERO).editar, true);
  assert.equal(accionesDe("lista", MESERO).editar, false);
  for (const e of ["abierta", "en_cocina", "lista", "entregada"]) assert.equal(accionesDe(e, MESERO).anular, false, e);
});

test("accionesDe: cocina solo marca lista; el admin hace todo y nada en estados finales", () => {
  assert.deepEqual(pasos("en_cocina", COCINA), ["lista"]);
  assert.deepEqual(pasos("abierta", COCINA), []);
  assert.deepEqual(pasos("abierta", ["*"]), ["enviar"]);
  assert.deepEqual(pasos("en_cocina", ["*"]), ["lista"]);
  assert.deepEqual(pasos("entregada", ["*"]), ["cobrar"]);
  assert.equal(accionesDe("entregada", ["*"]).anular, true);
  for (const e of ["pagada", "anulada"]) {
    const a = accionesDe(e, ["*"]);
    assert.deepEqual([a.pasos.length, a.editar, a.anular], [0, false, false], e);
  }
});

test("accionesDe nunca ofrece un paso cuya estación pide el motor y el rol no tiene", () => {
  const destino = { enviar: "en_cocina", lista: "lista", entregar: "entregada", cobrar: "pagada" };
  for (const estado of ["abierta", "en_cocina", "lista", "entregada"])
    for (const id of pasos(estado, ["*"])) {
      const requerida = TIPO_PEDIDO.permisos[destino[id]];
      if (requerida) assert.ok(!pasos(estado, SOLO_EDITAR).includes(id), `${id} sin ${requerida}`);
    }
  assert.deepEqual(pasos("lista", SOLO_EDITAR), ["entregar"]); // entregar no pide estación (5.18)
  assert.deepEqual(accionesDe("abierta", ["documento:leer"]), { pasos: [], editar: false, anular: false });
});

test("destinoDe describe dónde va el pedido", () => {
  assert.equal(destinoDe({ canal: "salon", mesa: "4" }), "Mesa 4");
  assert.equal(destinoDe({ canal: "llevar", referencia: "Ana" }), "Para llevar · Ana");
  assert.equal(destinoDe({ canal: "delivery" }), "Delivery");
});

// ---------- api.js ----------
test("normalizarYo toma permisos y empresa activa de /auth/yo", () => {
  const yo = normalizarYo({ usuario: { id: "u1" }, empresaActivaId: "e1", empresas: [{ id: "e1", nombre: "Café", rol: "mesero" }], permisos: MESERO });
  assert.equal(yo.empresaActivaId, "e1");
  assert.deepEqual(yo.empresa, { nombre: "Café", rol: "mesero" });
  assert.equal(yo.permisos.length, MESERO.length);
  assert.deepEqual(normalizarYo(null).permisos, []);
  assert.equal(normalizarYo({ debeCambiarPassword: true }).debeCambiarPassword, true);
});

test("mensajeDeError: usa el texto del servicio y trata aparte sesión, conflicto y red", () => {
  assert.equal(mensajeDeError(new ErrorApi(409, "ITEM_NO_DISPONIBLE", "hay ítems no disponibles")), "hay ítems no disponibles");
  assert.match(mensajeDeError(new ErrorApi(401, null, "x")), /sesión caducó/);
  assert.match(mensajeDeError(new ErrorApi(409, "CONFLICTO_VERSION", "x")), /Otra persona/);
  assert.match(mensajeDeError(new ErrorApi(500, null, "boom")), /problema/);
  assert.equal(mensajeDeError(new ErrorApi(0, "SIN_CONEXION", "sin red")), "sin red");
  assert.match(mensajeDeError(new Error("x")), /inesperado/);
  assert.equal(urlCuenta, "/cuenta/");
});

test("precio propio: fijarPrecio, qué se envía y cuándo se puede cambiar", () => {
  let ls = agregarDelCatalogo([], { codigo: "CAFE-1", nombre: "Café", precio: 6.5 });
  const k = ls[0].clave;
  assert.deepEqual(lineaAEnvio(ls[0]), { codigo: "CAFE-1", cantidad: 1 }); // sin cambio no se envía precio
  ls = fijarPrecio(ls, k, "5,5");
  assert.equal(ls[0].precio, 5.5);
  assert.deepEqual(lineaAEnvio(ls[0]), { codigo: "CAFE-1", precio: 5.5, cantidad: 1 });
  assert.equal(fijarPrecio(ls, k, "5.555"), ls, "un texto inválido no cambia nada");
  assert.equal(fijarPrecio(ls, k, "6.50")[0].modificado, false, "igual al catálogo = sin cambio");
  const vuelta = fijarPrecio(ls, k, "");
  assert.deepEqual([vuelta[0].precio, vuelta[0].modificado], [6.5, false]);
  assert.equal(totalEstimado(fijarPrecio(ls, k, "0")), 0, "gratis es un precio válido");
  // un ítem sin precio en el catálogo: escribir uno lo marca como cambiado
  const sin = fijarPrecio(agregarDelCatalogo([], { codigo: "X", nombre: "X" }), "l-no", "1");
  assert.equal(sin[0].precio, null);
  // una línea libre se edita sin marca (su precio es el que ella misma declara)
  let libre = agregarLibre([], { nombre: "Torta", precio: null });
  libre = fijarPrecio(libre, libre[0].clave, "9");
  assert.deepEqual(lineaAEnvio(libre[0]), { libre: { nombre: "Torta", precio: 9 }, cantidad: 1 });
  assert.equal(puedeCambiarPrecio(["estacion:administracion"]), true);
  assert.equal(puedeCambiarPrecio(["documento:editar", "documento:crear"]), false);
});

test("editar un pedido con precio cambiado lo conserva y lo reenvía", () => {
  const detalle = {
    doc: { canal: "salon", mesa: "1", lineas: [{ cantidad: 1, notas: null, subtotal: 5 }] },
    snapshot: { lineas: [{ origen: "catalogo", codigo: "CAFE-1", nombre: "Café", precio: 5, precioCatalogo: 6.5, precioModificado: true }] },
  };
  const [l] = lineasDesdeDetalle(detalle);
  assert.deepEqual(lineaAEnvio(l), { codigo: "CAFE-1", precio: 5, cantidad: 1 });
  assert.equal(fijarPrecio([l], l.clave, "")[0].precio, 6.5);
});
