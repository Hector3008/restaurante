import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aplicarPaleta, coloresSeguros, esloganDe, logoSeguro, temaDe } from "../client/src/catalogo/marca.js";
import { marcaPublica } from "core";

// Raíz falsa con la parte de `style` que usa aplicarPaleta
const raiz = () => {
  const props = new Map();
  return { props, style: { colorScheme: "", setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) } };
};
const marca = marcaPublica({ marca: { logo: "https://e.com/l.png", eslogan: " Desde 1999 ", colorPrincipal: "#8b1e3f" } });

describe("marca en la carta (front)", () => {
  it("acepta la paleta que calcula el núcleo y la aplica y la quita", () => {
    const r = raiz();
    const quitar = aplicarPaleta(marca, r);
    assert.equal(r.props.get("--color-principal"), "#8b1e3f");
    assert.equal(r.props.size, 10);
    assert.equal(r.style.colorScheme, "light");
    quitar();
    assert.equal(r.props.size, 0);
    assert.equal(r.style.colorScheme, "");
  });
  it("tema oscuro → color-scheme dark", () => {
    const r = raiz();
    aplicarPaleta(marcaPublica({ marca: { colorFondo: "#101418" } }), r);
    assert.equal(r.style.colorScheme, "dark");
    assert.equal(temaDe(marcaPublica({ marca: { colorFondo: "#101418" } })), "oscuro");
  });
  it("sin colores no toca nada: sigue la apariencia por defecto y el modo del dispositivo", () => {
    for (const m of [null, undefined, {}, { colores: null }, marcaPublica({ marca: { eslogan: "Hola" } })]) {
      const r = raiz();
      aplicarPaleta(m, r)();
      assert.equal(r.props.size, 0);
      assert.equal(temaDe(m), null);
    }
    assert.doesNotThrow(() => aplicarPaleta(marca, null)());
  });
  it("lo que no es un #rrggbb o una variable conocida no se aplica", () => {
    const malo = {
      colores: {
        "--color-principal": "#8b1e3f",
        "--color-fondo": "#f4f1ea",
        "--color-texto": "#1d211f",
        "--color-borde": "red; background: url(http://x)",
        "--color-secundario": "expression(alert(1))",
        "--evil": "#000000",
        "--color-error": 5,
      },
    };
    assert.deepEqual(coloresSeguros(malo), { "--color-principal": "#8b1e3f", "--color-fondo": "#f4f1ea", "--color-texto": "#1d211f" });
  });
  it("una paleta sin principal, fondo o texto no se aplica a medias", () => {
    assert.equal(coloresSeguros({ colores: { "--color-principal": "#8b1e3f" } }), null);
    assert.equal(coloresSeguros({ colores: { "--color-fondo": "#ffffff", "--color-texto": "#000000" } }), null);
  });
  it("logo: solo https; eslogan: texto recortado", () => {
    assert.equal(logoSeguro(marca), "https://e.com/l.png");
    for (const logo of ["http://e.com/l.png", "javascript:alert(1)", "/l.png", "https://u:p@e.com/l.png", 5, null]) assert.equal(logoSeguro({ logo }), null);
    assert.equal(esloganDe(marca), "Desde 1999");
    assert.equal(esloganDe({ eslogan: "   " }), null);
    assert.equal(esloganDe(null), null);
  });
});
