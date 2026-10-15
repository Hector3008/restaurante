import { useEffect, useState } from "react";
import { api, mensajeDeError } from "./api.js";
import { cuerpoClienteNuevo, sinProgramaPuntos } from "./pedidos.js";

// Elegir al cliente de un pedido: se busca por nombre, teléfono, correo o @usuario, o se crea uno nuevo (y, si se
// quiere, su cuenta). Solo habla con /clientes: el pedido guarda el id y una copia del nombre y el teléfono.
// `valor` es el cliente elegido ({ id, nombre, telefono, correo, consentimientos }) o null; `alCambiar(c|null)`.
export default function SelectorCliente({ valor, alCambiar, puedeCrear = false, puedeCuenta = false, deshabilitado = false, alPendiente }) {
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");
  const [nuevo, setNuevo] = useState(null); // { nombre, telefono, correo, cuenta } mientras se crea
  const [guardando, setGuardando] = useState(false);
  const [temporal, setTemporal] = useState(null); // { nombre, usuario, password } — se muestra una sola vez

  // Mientras la contraseña temporal está a la vista, quien usa el selector puede bloquear seguir (se perdería).
  useEffect(() => {
    alPendiente?.(Boolean(temporal));
    return () => alPendiente?.(false);
  }, [temporal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const texto = q.trim();
    if (!texto) {
      setResultados([]);
      setError("");
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
        if (vigente) setError(e.status === 403 ? "No tienes permiso para ver clientes." : mensajeDeError(e));
      } finally {
        if (vigente) setBuscando(false);
      }
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [q]);

  function elegir(c) {
    alCambiar(c);
    setQ("");
    setResultados([]);
    setError("");
    setNuevo(null);
  }

  async function crear(e) {
    e.preventDefault();
    if (guardando) return;
    const v = cuerpoClienteNuevo(nuevo);
    if (!v.ok) return setError(v.error);
    setError("");
    setGuardando(true);
    try {
      const c = await api.crearCliente(v.cuerpo);
      let creado = c;
      if (nuevo.cuenta && puedeCuenta) {
        try {
          const r = await api.crearCuenta(c.id);
          setTemporal({ nombre: c.nombre, usuario: c.correo || c.telefono, password: r.passwordTemporal });
          creado = { ...c, tieneCuenta: true };
        } catch (err) {
          // El cliente quedó creado; solo falló la cuenta. Se elige igual y se dice qué pasó.
          setError(`El cliente se creó, pero no su cuenta: ${mensajeDeError(err)}`);
        }
      }
      alCambiar(creado);
      setQ("");
      setResultados([]);
      setNuevo(null);
    } catch (err) {
      // CLIENTE_DUPLICADO: ya existe con ese teléfono o correo; se ofrece buscarlo en vez de duplicarlo.
      setError(err.codigo === "CLIENTE_DUPLICADO" ? "Ya hay un cliente con ese teléfono o correo. Búscalo arriba." : mensajeDeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="rs-cliente">
      <span className="rs-cliente__titulo">Cliente (opcional)</span>

      {temporal && (
        <div className="rs-temporal" role="status">
          <p>
            Cuenta creada para <strong>{temporal.nombre}</strong>. Entra con <strong>{temporal.usuario}</strong> y esta contraseña
            temporal (pedirá cambiarla al entrar). <strong>Solo se muestra ahora</strong>:
          </p>
          <code>{temporal.password}</code>
          <button type="button" className="rs-btn" onClick={() => setTemporal(null)}>Ya la anoté</button>
        </div>
      )}

      {valor ? (
        <div className="rs-cliente__elegido">
          <span>
            <strong>{valor.nombre}</strong>
            {(valor.telefono || valor.correo) && <small> · {valor.telefono || valor.correo}</small>}
            {sinProgramaPuntos(valor) && <small className="rs-vacio"> · sin programa de puntos</small>}
          </span>
          {!deshabilitado && (
            <button type="button" className="rs-btn" onClick={() => alCambiar(null)}>Quitar</button>
          )}
        </div>
      ) : (
        !deshabilitado && (
          <>
            <div className="rs-buscador">
              <input
                type="search"
                placeholder="Buscar por nombre, teléfono o correo"
                aria-label="Buscar cliente"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
              />
              {buscando && <small className="cargando">Buscando…</small>}
              {!buscando && q.trim() && !error && resultados.length === 0 && <small className="rs-vacio">Sin resultados.</small>}
              {resultados.length > 0 && (
                <ul className="rs-resultados">
                  {resultados.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => elegir(c)}>
                        <span>
                          <strong>{c.nombre}</strong> <small>{c.telefono || c.correo || ""}</small>
                        </span>
                        <small>{c.tieneCuenta ? "con cuenta" : ""}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {puedeCrear && !nuevo && (
              <button type="button" className="rs-btn" onClick={() => { setNuevo({ nombre: q.trim(), telefono: "", correo: "", cuenta: false }); setError(""); }}>
                Cliente nuevo
              </button>
            )}
          </>
        )
      )}

      {nuevo && !valor && (
        // No es un <form>: el selector va dentro del formulario del pedido y un formulario anidado enviaría el pedido.
        <div
          className="rs-form rs-cliente__nuevo"
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target.tagName === "INPUT") {
              e.preventDefault();
              crear(e);
            }
          }}
        >
          <label className="campo">
            <span>Nombre</span>
            <input value={nuevo.nombre} maxLength={100} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
          </label>
          <label className="campo">
            <span>Teléfono</span>
            <input value={nuevo.telefono} inputMode="tel" maxLength={30} onChange={(e) => setNuevo({ ...nuevo, telefono: e.target.value })} />
          </label>
          <label className="campo">
            <span>Correo</span>
            <input value={nuevo.correo} type="email" maxLength={200} onChange={(e) => setNuevo({ ...nuevo, correo: e.target.value })} />
          </label>
          {puedeCuenta && (
            <label className="rs-check">
              <input type="checkbox" checked={nuevo.cuenta} onChange={(e) => setNuevo({ ...nuevo, cuenta: e.target.checked })} />
              <span>Crear su cuenta (contraseña temporal para dársela al cliente)</span>
            </label>
          )}
          <div className="rs-acciones">
            <button type="button" className="rs-btn rs-btn--primario" disabled={guardando} onClick={crear}>{guardando ? "Guardando…" : "Guardar cliente"}</button>
            <button type="button" className="rs-btn" onClick={() => { setNuevo(null); setError(""); }}>Cancelar</button>
          </div>
        </div>
      )}

      {error && <p className="aviso-error" role="alert">{error}</p>}
    </div>
  );
}
