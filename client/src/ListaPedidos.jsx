import { useCallback, useEffect, useRef, useState } from "react";
import { api, mensajeDeError } from "./api.js";
import { CANALES, ESTADOS, FILTROS, destinoDe, formatoDinero } from "./pedidos.js";

const REFRESCO_MS = 20000;

export default function ListaPedidos({ puedeCrear, alAbrir, alCrear }) {
  const [filtro, setFiltro] = useState("activos");
  const [pedidos, setPedidos] = useState(null);
  const [error, setError] = useState("");
  const [actualizando, setActualizando] = useState(false);
  const filtroRef = useRef(filtro);
  filtroRef.current = filtro;

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setActualizando(true);
    const f = FILTROS.find((x) => x.id === filtroRef.current);
    try {
      const lista = await api.listar(f.estado);
      if (filtroRef.current === f.id) {
        setPedidos([...lista].sort((a, b) => String(b.code).localeCompare(String(a.code))));
        setError("");
      }
    } catch (e) {
      if (!silencioso || !pedidos) setError(mensajeDeError(e));
    } finally {
      setActualizando(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPedidos(null);
    cargar();
  }, [filtro, cargar]);

  // Consulta periódica sencilla (sin Socket.IO): solo mientras la pestaña está visible.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") cargar(true);
    }, REFRESCO_MS);
    return () => clearInterval(id);
  }, [cargar]);

  return (
    <section aria-labelledby="t-pedidos">
      <header className="rs-cabecera">
        <h1 id="t-pedidos">Pedidos</h1>
        <div className="rs-acciones">
          <button type="button" className="rs-btn" onClick={() => cargar()} disabled={actualizando}>
            {actualizando ? "Actualizando…" : "Actualizar"}
          </button>
          {puedeCrear && (
            <button type="button" className="rs-btn rs-btn--primario" onClick={alCrear}>
              Nuevo pedido
            </button>
          )}
        </div>
      </header>

      <div className="rs-filtros" role="tablist" aria-label="Estado">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filtro === f.id}
            className={filtro === f.id ? "rs-chip rs-chip--activo" : "rs-chip"}
            onClick={() => setFiltro(f.id)}
          >
            {f.titulo}
          </button>
        ))}
      </div>

      {error && <p className="aviso-error" role="alert">{error}</p>}

      {pedidos === null && !error ? (
        <p className="cargando">Cargando…</p>
      ) : pedidos?.length === 0 ? (
        <p className="rs-vacio">No hay pedidos en este estado.</p>
      ) : (
        <ul className="rs-lista">
          {(pedidos ?? []).map((p) => (
            <li key={p.code}>
              <button type="button" className="rs-tarjeta" onClick={() => alAbrir(p.code)}>
                <span className="rs-tarjeta__fila">
                  <strong>{p.code}</strong>
                  <span className={`rs-estado rs-estado--${p.estado}`}>{ESTADOS[p.estado] ?? p.estado}</span>
                </span>
                <span className="rs-tarjeta__fila">
                  <span>{destinoDe(p)}</span>
                  <span className="rs-num">{formatoDinero(p.total, p.moneda)}</span>
                </span>
                <small>
                  {CANALES[p.canal] ?? p.canal}
                  {p.creadoTs ? ` · ${new Date(p.creadoTs).toLocaleString("es", { dateStyle: "short", timeStyle: "short" })}` : ""}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
