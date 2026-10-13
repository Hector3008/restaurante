// Lógica pura del front (client/src/pedidos.js y api.js): sin React, sin navegador y sin base de datos.
// Las pruebas de "coincide con el servicio" fijan que el front y src/ no se separen sin que falle algo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TIPO_ITEM, TIPO_PEDIDO, MOTIVOS_ANULACION as MOTIVOS_SERVICIO } from "../src/index.js";
import { validarCreacion, validarEdicion, validarItems, validarLinea } from "../src/validacion.js";
import {
  permite, ESTADOS_PEDIDO, ESTADOS_ITEM, MOTIVOS_ANULACION, FILTROS, destinoDe, formatoDinero, parsearPrecio,
  totalEstimado, agregarDelCatalogo, agregarLibre, cambiarCantidad, fijarPrecio, puedeCambiarPrecio, itemAEnvio,
  formularioVacio, formularioDesdePedido, validarFormulario, cuerpoPedido, cuerpoItems, cuerpoDatos,
  accionesItem, accionesPedido, resumenItems, itemsDeCocina, haceCuanto, puedeMarcarListos,
} from "../client/src/pedidos.js";

// api.js calcula la ruta base con document.baseURI al importarse: se simula antes de cargarlo.
globalThis.document ??= { baseURI: "http://localhost/restaurante/" };
const { ErrorApi, mensajeDeError, normalizarYo, urlCuenta } = await import("../client/src/api.js");

// Roles de la plantilla `restaurante` del núcleo (core/src/modelos/plantillas.js)
const MESERO = ["estacion:creacion", "estacion:carta", "documento:crear", "documento:leer", "documento:editar", "catalogo:leer", "cliente:leer", "cliente:crear"];
const COCINA = ["estacion:cocina", "documento:leer", "documento:editar"];
const CAJERO = [...MESERO, "estacion:administracion"];
const pasos = (estado, permisos) => accionesItem(estado, permisos).pasos.map((p) => p.id);

test("permite: misma regla que el núcleo", () => {
  assert.equal(permite(["*"], "documento:crear"), true);
  assert.equal(permite(["documento:*"], "documento:crear"), true);
  assert.equal(permite(["documento:leer"], "documento:crear"), false);
  assert.equal(permite([], "documento:leer"), false);
  assert.equal(permite(undefined, "documento:leer"), false);
});

// ---------- coincidencia con el servicio ----------
test("el front conoce los mismos motivos de anulación que el servicio", () => {
  assert.deepEqual(MOTIVOS_ANULACION.map(([c]) => c), MOTIVOS_SERVICIO);
});

test("el front tiene nombre para todos los estados de ítem y de pedido, y un filtro por cada estado de pedido", () => {
  const estadosDe = (t) => new Set([t.estadoInicial, ...Object.keys(t.transiciones), ...Object.values(t.transiciones).flat()]);
  for (const e of estadosDe(TIPO_ITEM)) assert.ok(ESTADOS_ITEM[e], `falta el nombre del estado de ítem ${e}`);
  for (const e of estadosDe(TIPO_PEDIDO)) {
    assert.ok(ESTADOS_PEDIDO[e], `falta el nombre del estado de pedido ${e}`);
    assert.ok(FILTROS.some((f) => f.estado === e), `ningún filtro muestra ${e}`);
  }
});

test("los cuerpos que arma el front los acepta el validador del servicio, en los tres canales", () => {
  const items = agregarLibre(agregarDelCatalogo([], { codigo: "CAFE-1", nombre: "Café", precio: 6.5 }), { nombre: "Torta del día", precio: 9 });
  const base = { ...formularioVacio(), items, notas: "  sin azúcar " };
  const salon = { ...base, canal: "salon", mesa: " 4 " };
  const llevar = { ...base, canal: "llevar", referencia: "Ana" };
  const delivery = { ...base, canal: "delivery", direccion: "Av. Lima 123", telefono: "+51 987 654 321", referenciaEntrega: "" };
  for (const f of [salon, llevar, delivery]) {
    assert.equal(validarFormulario(f), null, f.canal);
    const v = validarCreacion(cuerpoPedido(f));
    assert.equal(v.canal, f.canal);
    assert.equal(v.notas, "sin azúcar");
    assert.equal(v.items.length, 2);
    const { esperaVersion, ...datos } = cuerpoDatos(f, 3); // la ruta quita esperaVersion antes de validar
    assert.equal(esperaVersion, 3);
    assert.ok(validarEdicion(datos));
    assert.equal(validarItems(cuerpoItems(items)).length, 2);
  }
  assert.equal(validarCreacion(cuerpoPedido(salon)).mesa, "4");
  assert.equal(validarCreacion(cuerpoPedido(delivery)).entrega.referencia, null);
  assert.ok(!("mesa" in cuerpoPedido(llevar)) && !("entrega" in cuerpoPedido(llevar)), "cada canal rechaza los campos de otros");
});

test("los ítems que arma el front los acepta validarLinea (catálogo y libre)", () => {
  const cat = itemAEnvio({ codigo: "CAFE-1", nombre: "Café", precio: 6.5, cantidad: 2, notas: " sin hielo " });
  assert.deepEqual(cat, { codigo: "CAFE-1", cantidad: 2, notas: "sin hielo" });
  const libre = itemAEnvio({ libre: true, nombre: "Torta", precio: null, cantidad: 1, notas: "" });
  assert.deepEqual(libre, { libre: { nombre: "Torta" }, cantidad: 1 });
  assert.deepEqual(itemAEnvio({ libre: true, nombre: "Torta", precio: 9, cantidad: 1, notas: "", codigoLibre: "PROV-1" }).libre, { nombre: "Torta", precio: 9, codigo: "PROV-1" });
  assert.equal(validarLinea(cat, 0).item, "CAFE-1");
  assert.deepEqual(validarLinea(libre, 0).item, { libre: { nombre: "Torta" } });
});

// ---------- formulario ----------
test("validarFormulario pide lo que exige cada canal y al menos un ítem", () => {
  const uno = agregarLibre([], { nombre: "X", precio: null });
  assert.match(validarFormulario({ ...formularioVacio("salon"), items: uno }), /mesa/i);
  assert.match(validarFormulario({ ...formularioVacio("llevar"), items: uno }), /nombre/i);
  assert.match(validarFormulario({ ...formularioVacio("delivery"), items: uno }), /dirección/i);
  assert.match(validarFormulario({ ...formularioVacio("delivery"), direccion: "x", items: uno }), /teléfono/i);
  assert.match(validarFormulario({ ...formularioVacio("delivery"), direccion: "x", telefono: "abc", items: uno }), /teléfono/i);
  assert.match(validarFormulario({ ...formularioVacio("salon"), mesa: "1" }), /[ií]tem/i);
  assert.equal(validarFormulario({ ...formularioVacio("salon"), mesa: "1", items: uno }), null);
});

test("cantidades: tope de 1 a 99 y el mismo código no se duplica (sin distinguir mayúsculas)", () => {
  let l = agregarDelCatalogo([], { codigo: "ZM-1", nombre: "A", precio: 1 });
  l = agregarDelCatalogo(l, { codigo: "zm-1", nombre: "A", precio: 1 });
  assert.equal(l.length, 1);
  assert.equal(l[0].cantidad, 2);
  assert.equal(cambiarCantidad(l, l[0].clave, -5)[0].cantidad, 1);
  assert.equal(cambiarCantidad(l, l[0].clave, 500)[0].cantidad, 99);
});

test("formularioDesdePedido recompone los datos de un pedido para editarlos", () => {
  const pedido = { doc: { canal: "delivery", entrega: { direccion: "Av. 1", telefono: "999 111 222", referencia: null }, notas: null } };
  const f = formularioDesdePedido(pedido);
  assert.deepEqual([f.canal, f.direccion, f.items], ["delivery", "Av. 1", []]);
  assert.ok(validarEdicion((({ esperaVersion, ...r }) => r)(cuerpoDatos(f, 1))).entrega);
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
  assert.match(formatoDinero(12.5, "PEN"), /S\/\s?12[.,]50/);
});

test("precio propio: fijarPrecio, qué se envía y cuándo se puede cambiar", () => {
  let ls = agregarDelCatalogo([], { codigo: "CAFE-1", nombre: "Café", precio: 6.5 });
  const k = ls[0].clave;
  assert.deepEqual(itemAEnvio(ls[0]), { codigo: "CAFE-1", cantidad: 1 }); // sin cambio no se envía precio
  ls = fijarPrecio(ls, k, "5,5");
  assert.deepEqual(itemAEnvio(ls[0]), { codigo: "CAFE-1", precio: 5.5, cantidad: 1 });
  assert.equal(validarLinea(itemAEnvio(ls[0]), 0).precio, 5.5);
  assert.equal(fijarPrecio(ls, k, "5.555"), ls, "un texto inválido no cambia nada");
  assert.equal(fijarPrecio(ls, k, "6.50")[0].modificado, false, "igual al catálogo = sin cambio");
  const vuelta = fijarPrecio(ls, k, "");
  assert.deepEqual([vuelta[0].precio, vuelta[0].modificado], [6.5, false]);
  assert.equal(totalEstimado(fijarPrecio(ls, k, "0")), 0, "gratis es un precio válido");
  let libre = agregarLibre([], { nombre: "Torta", precio: null });
  libre = fijarPrecio(libre, libre[0].clave, "9");
  assert.deepEqual(itemAEnvio(libre[0]), { libre: { nombre: "Torta", precio: 9 }, cantidad: 1 });
  assert.equal(puedeCambiarPrecio(["estacion:administracion"]), true);
  assert.equal(puedeCambiarPrecio(["documento:editar", "documento:crear"]), false);
});

// ---------- qué ofrece cada rol ----------
test("accionesItem: el mesero entrega lo listo, y anula solo lo que sigue en cocina", () => {
  assert.deepEqual(pasos("en_cocina", MESERO), []);
  assert.deepEqual(pasos("lista", MESERO), ["entregar"]);
  assert.equal(accionesItem("en_cocina", MESERO).anular, true);
  assert.equal(accionesItem("lista", MESERO).anular, false);
  assert.equal(accionesItem("entregado", MESERO).anular, false);
});

test("accionesItem: cocina solo marca listo; administración anula también lo que ya salió; nada en estados finales", () => {
  assert.deepEqual(pasos("en_cocina", COCINA), ["lista"]);
  assert.deepEqual(pasos("lista", COCINA), ["entregar"]);
  assert.equal(accionesItem("en_cocina", COCINA).anular, false);
  for (const e of ["en_cocina", "lista", "entregado"]) assert.equal(accionesItem(e, CAJERO).anular, true, e);
  assert.deepEqual(pasos("anulado", ["*"]), []);
  assert.equal(accionesItem("anulado", ["*"]).anular, false);
  assert.deepEqual(pasos("en_cocina", ["documento:leer"]), []);
});

test("accionesItem nunca ofrece un paso cuya estación pide el motor y el rol no tiene", () => {
  for (const [estado, paso] of [["en_cocina", "lista"]]) {
    const requerido = TIPO_ITEM.permisos[{ lista: "lista" }[paso]];
    assert.ok(requerido, "el servicio declara una estación para este paso");
    for (const permisos of [MESERO, COCINA, CAJERO, ["*"]])
      assert.equal(pasos(estado, permisos).includes(paso), permite(permisos, requerido) && permite(permisos, "documento:editar"));
  }
});

test("accionesPedido: cobrar y anular son de administración; cobrar solo con todo entregado", () => {
  const item = (estado, subtotal = 5) => ({ estado, subtotal });
  const pedido = (items, estado = "abierto") => ({ estado, items });
  assert.equal(accionesPedido(pedido([]), MESERO).cobrar, false);
  assert.equal(accionesPedido(pedido([]), MESERO).agregar, true);
  const enCurso = accionesPedido(pedido([item("entregado"), item("en_cocina")]), CAJERO);
  assert.deepEqual([enCurso.cobrar, enCurso.puedeCobrarAhora, enCurso.anular], [true, false, true]);
  assert.match(enCurso.motivoNoCobrar, /1 item/);
  const listo = accionesPedido(pedido([item("entregado"), item("anulado")]), CAJERO);
  assert.deepEqual([listo.puedeCobrarAhora, listo.motivoNoCobrar], [true, null]);
  assert.match(accionesPedido(pedido([item("anulado")]), CAJERO).motivoNoCobrar, /nada entregado/);
  const pagado = accionesPedido(pedido([item("entregado")], "pagado"), CAJERO);
  assert.deepEqual([pagado.agregar, pagado.cobrar, pagado.anular, pagado.editarDatos], [false, false, false, false]);
});

test("resumenItems pedido por estado y no suma lo anulado ni inventa precios", () => {
  const r = resumenItems([{ estado: "en_cocina", subtotal: 13 }, { estado: "lista", subtotal: 5 }, { estado: "entregado", subtotal: 0.1 }, { estado: "anulado", subtotal: 99 }]);
  assert.deepEqual([r.enCocina, r.listos, r.entregados, r.anulados, r.activos, r.total], [1, 1, 1, 1, 3, 18.1]);
  assert.equal(resumenItems([{ estado: "en_cocina", subtotal: null }]).total, null);
  assert.equal(resumenItems(undefined).total, 0);
});

test("destinoDe describe dónde val pedido", () => {
  assert.equal(destinoDe({ canal: "salon", mesa: "4" }), "Mesa 4");
  assert.equal(destinoDe({ canal: "llevar", referencia: "Ana" }), "Para llevar · Ana");
  assert.equal(destinoDe({ canal: "delivery" }), "Delivery");
  assert.equal(destinoDe(null), "");
});

// ---------- cocina ----------
test("cocina: una tarjeta por ítem, los más antiguos primero, solo los que están en cocina", () => {
  const pedido2 = { code: "PD-0000002", canal: "salon", mesa: "2" };
  const pedido1 = { code: "PD-0000001", canal: "llevar", referencia: "Ana" };
  const items = [
    { code: "DOC_ITEM-0000003", estado: "en_cocina", version: 1, nombre: "Sándwich", cantidad: 1, notas: "sin cebolla", creadoTs: "2026-10-11T21:50:00Z", pedido: pedido2 },
    { code: "DOC_ITEM-0000002", estado: "en_cocina", version: 1, nombre: "Café", cantidad: 1, creadoTs: "2026-10-11T21:50:00Z", pedido: pedido2 },
    { code: "DOC_ITEM-0000001", estado: "en_cocina", version: 4, nombre: "Torta", cantidad: 2, creadoTs: "2026-10-11T21:40:00Z", pedido: pedido1 },
    { code: "DOC_ITEM-0000004", estado: "lista", nombre: "Té", pedido: pedido2 },
  ];
  const lista = itemsDeCocina(items);
  assert.deepEqual(lista.map((p) => [p.code, p.destino]), [["DOC_ITEM-0000001", "Para llevar · Ana"], ["DOC_ITEM-0000002", "Mesa 2"], ["DOC_ITEM-0000003", "Mesa 2"]]);
  assert.deepEqual(itemsDeCocina(null), []);
  assert.equal(puedeMarcarListos(COCINA), true);
  assert.equal(puedeMarcarListos(MESERO), false);
  assert.equal(puedeMarcarListos(["estacion:cocina"]), false);
});

test("haceCuanto", () => {
  const t = Date.parse("2026-10-11T22:00:00Z");
  assert.equal(haceCuanto("2026-10-11T21:59:50Z", t), "ahora");
  assert.equal(haceCuanto("2026-10-11T21:55:00Z", t), "hace 5 min");
  assert.equal(haceCuanto("2026-10-11T20:30:00Z", t), "hace 1 h 30 min");
  assert.equal(haceCuanto(null, t), "");
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
