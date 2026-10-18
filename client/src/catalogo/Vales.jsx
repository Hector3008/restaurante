import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { agruparVales, ESTADO_VALE, faltanPuntos, formatoCodigoVale, textoVence } from "./logica.js";

// Canjear puntos por beneficios y ver los vales. El vale tiene un código que el cliente le dice (o le muestra) al
// mesero, que lo aplica a su cuenta. `saldo` es el de la sesión; `alCanjear` recarga la cuenta para actualizarlo.
export default function Vales({ slug, saldo, alCanjear }) {
  const [datos, setDatos] = useState(null); // { beneficios, vales }
  const [error, setError] = useState("");
  const [enCurso, setEnCurso] = useState(null); // beneficioId o código del vale que se está enviando
  const [verOtros, setVerOtros] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.vales(slug));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, [slug]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function ejecutar(clave, fn) {
    if (enCurso) return;
    setEnCurso(clave);
    setError("");
    try {
      await fn();
      await Promise.all([cargar(), alCanjear()]);
    } catch (e) {
      setError(e.message);
    } finally {
      setEnCurso(null);
    }
  }

  if (!datos) return error ? <p className="aviso-error" role="alert">{error}</p> : null;
  const { activos, otros } = agruparVales(datos.vales);
  if (!datos.beneficios.length && !datos.vales.length) return null;

  return (
    <div className="cat-vales">
      {activos.length > 0 && (
        <>
          <h2 className="cat-vales__titulo">Tus vales</h2>
          <ul className="cat-vales__lista">
            {activos.map((v) => (
              <li key={v.id} className="cat-vale">
                <div>
                  <strong>{v.beneficio.nombre}</strong>
                  <small>{v.origen === "reto" ? "Premio de un reto · " : ""}{v.beneficio.texto} · {textoVence(v.venceTs)}</small>
                </div>
                <span className="cat-vale__codigo" aria-label={`Código ${v.codigo.split("").join(" ")}`}>{formatoCodigoVale(v.codigo)}</span>
                {v.origen !== "reto" && (
                  <button type="button" className="rs-btn" disabled={enCurso !== null} onClick={() => ejecutar(v.codigo, () => api.cancelarVale(slug, v.codigo))}>
                    {enCurso === v.codigo ? "Cancelando…" : "Cancelar y recuperar puntos"}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <small className="rs-vacio">Dile el código al mesero cuando pidas tu cuenta.</small>
        </>
      )}

      {datos.beneficios.length > 0 && (
        <>
          <h2 className="cat-vales__titulo">Canjea tus puntos</h2>
          <ul className="cat-vales__lista">
            {datos.beneficios.map((b) => {
              const faltan = faltanPuntos(b, saldo);
              return (
                <li key={b.id} className="cat-vale">
                  <div>
                    <strong>{b.nombre}</strong>
                    <small>{b.descripcion || b.texto} · {b.puntos} puntos · vale por {b.vigenciaDias} días</small>
                  </div>
                  <button type="button" className="rs-btn rs-btn--primario" disabled={faltan > 0 || enCurso !== null} onClick={() => ejecutar(b.id, () => api.canjearVale(slug, b.id))}>
                    {enCurso === b.id ? "Canjeando…" : faltan > 0 ? `Te faltan ${faltan}` : "Canjear"}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {otros.length > 0 && (
        <>
          <button type="button" className="rs-btn" onClick={() => setVerOtros((v) => !v)} aria-expanded={verOtros}>
            {verOtros ? "Ocultar vales anteriores" : "Ver vales anteriores"}
          </button>
          {verOtros && (
            <ul className="cat-vales__lista">
              {otros.map((v) => (
                <li key={v.id} className="cat-vale cat-vale--pasado">
                  <div><strong>{v.beneficio.nombre}</strong><small>{formatoCodigoVale(v.codigo)}</small></div>
                  <span>{ESTADO_VALE[v.estado] ?? v.estado}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {error && <p className="aviso-error" role="alert">{error}</p>}
    </div>
  );
}
