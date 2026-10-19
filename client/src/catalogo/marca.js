// Marca de la empresa en la carta (5.33). Lógica pura, sin React ni navegador: se prueba con node --test.
// El núcleo ya calcula la paleta; aquí solo se comprueba que lo recibido sea seguro antes de pintarlo
// (la carta es pública y estas cadenas acaban en estilos y en <img>).

const VARIABLES = [
  "--color-principal",
  "--color-principal-texto",
  "--color-secundario",
  "--color-fondo",
  "--color-superficie",
  "--color-texto",
  "--color-texto-suave",
  "--color-borde",
  "--color-error",
  "--color-error-fondo",
];
const HEX = /^#[0-9a-f]{6}$/i;

/** Las variables de color que se pueden aplicar: solo las conocidas y solo con valores #rrggbb. */
export function coloresSeguros(marca) {
  const c = marca?.colores;
  if (!c || typeof c !== "object") return null;
  const limpios = {};
  for (const v of VARIABLES) if (typeof c[v] === "string" && HEX.test(c[v])) limpios[v] = c[v].toLowerCase();
  // sin el fondo y el texto no hay paleta coherente: mejor la de por defecto que una a medias
  return limpios["--color-fondo"] && limpios["--color-texto"] && limpios["--color-principal"] ? limpios : null;
}

/** "claro" | "oscuro" | null (null = sigue el modo del dispositivo). */
export function temaDe(marca) {
  return coloresSeguros(marca) ? (marca.tema === "oscuro" ? "oscuro" : "claro") : null;
}

/** Solo https absoluto: lo demás no se pinta como logo. */
export function logoSeguro(marca) {
  const v = marca?.logo;
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

export function esloganDe(marca) {
  const v = marca?.eslogan;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Pinta la paleta en `raiz` (el <html>) y devuelve una función que la quita.
 * Las propiedades en línea ganan a las de la hoja de estilos, incluido el modo oscuro del dispositivo.
 */
export function aplicarPaleta(marca, raiz) {
  const colores = coloresSeguros(marca);
  if (!colores || !raiz?.style) return () => {};
  for (const [k, v] of Object.entries(colores)) raiz.style.setProperty(k, v);
  raiz.style.colorScheme = temaDe(marca) === "oscuro" ? "dark" : "light";
  return () => {
    for (const k of Object.keys(colores)) raiz.style.removeProperty(k);
    raiz.style.colorScheme = "";
  };
}
