import { useEffect, useState } from "react";
import { api, mensajeDeError } from "./api.js";
import { esCodigoReferido, normalizarCodigoReferido } from "./pedidos.js";

// «¿Lo refirió alguien?» (5.47): al crear un cliente nuevo, se busca a quien lo trajo (nombre, teléfono o correo) o se
// escribe su código. `valor` es null, { tipo: "cliente", id, nombre } o { tipo: "codigo", codigo }.
export default function SelectorReferente({ valor, alCambiar }) {
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 2 || esCodigoReferido(texto)) {
      setResultados([]);
      setBuscando(false);
      return;
    }
    let vigente = true;
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.buscarClientes(texto);
        if (vigente) {
          setResultados(r);
          setError("");
        }
      } catch (e) {
        if (vigente) setError(mensajeDeError(e));
      } finally {
        if (vigente) setBuscando(false);
      }
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [q]);

  if (valor)
    return (
      <div className="rs-cliente__elegido">
        <span>Lo refirió: <strong>{valor.tipo === "codigo" ? `código ${valor.codigo}` : valor.nombre}</strong></span>
        <button type="button" className="rs-btn" onClick={() => alCambiar(null)}>Quitar</button>
      </div>
    );

  return (
    <div className="rs-buscador">
      <label className="campo">
        <span>¿Lo refirió alguien? (opcional)</span>
        <input
          type="search"
          placeholder="Nombre, teléfono o código de quien lo trajo"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
        />
      </label>
      {buscando && <small className="cargando">Buscando…</small>}
      {esCodigoReferido(q) && (
        <button type="button" className="rs-btn" onClick={() => { alCambiar({ tipo: "codigo", codigo: normalizarCodigoReferido(q) }); setQ(""); }}>
          Usar el código {normalizarCodigoReferido(q)}
        </button>
      )}
      {resultados.length > 0 && (
        <ul className="rs-resultados">
          {resultados.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => { alCambiar({ tipo: "cliente", id: c.id, nombre: c.nombre }); setQ(""); setResultados([]); }}>
                <span><strong>{c.nombre}</strong> <small>{c.telefono || c.correo || ""}</small></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="aviso-error" role="alert">{error}</p>}
    </div>
  );
}
