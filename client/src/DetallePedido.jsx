import { useCallback, useEffect, useState } from "react";
import { api, mensajeDeError } from "./api.js";
import { CANALES, ESTADOS, MOTIVOS_ANULACION, accionesDe, formatoDinero } from "./pedidos.js";

function Fila({ etiqueta, children }) {
  return (
    <>
      <dt>{etiqueta}</dt>
      <dd>{children}</dd>
    </>
  );
}

export default function DetallePedido({ code, permisos, alVolver, alEditar, alCambiar }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [detalleMotivo, setDetalleMotivo] = useState("");

  // `conservarError`: tras un conflicto se recarga el pedido pero el aviso tiene que seguir a la vista.
  const cargar = useCallback(async (conservarError = false) => {
    try {
      setD(await api.obtener(code));
      if (!conservarError) setError("");
    } catch (e) {
      setError(e.status === 404 ? "No se encontró este pedido." : mensajeDeError(e));
    }
  }, [code]);

  useEffect(() => {
    setD(null);
    cargar();
  }, [cargar]);

  // Un paso del pedido. Lleva `esperaVersion`: si alguien lo cambió antes, el servidor responde 409
  // y se recarga con lo último en vez de pisar su cambio.
  async function paso(ruta, cuerpo = {}) {
    if (trabajando || !d) return;
    setTrabajando(true);
    setError("");
    try {
      setD(await api.paso(code, ruta, { esperaVersion: d.version, ...cuerpo }));
      setAnulando(false);
      setMotivo("");
      setDetalleMotivo("");
      alCambiar?.();
    } catch (e) {
      setError(mensajeDeError(e));
      if (e.codigo === "CONFLICTO_VERSION" || e.codigo === "TRANSICION_INVALIDA") await cargar(true);
    } finally {
      setTrabajando(false);
    }
  }

  if (!d)
    return (
      <section>
        <button type="button" className="enlace-volver" onClick={alVolver}>← Pedidos</button>
        {error ? <p className="aviso-error" role="alert">{error}</p> : <p className="cargando">Cargando…</p>}
      </section>
    );

  const doc = d.doc ?? {};
  const snap = d.snapshot?.lineas ?? [];
  const acciones = accionesDe(d.estado, permisos);
  const moneda = doc.moneda ?? d.moneda;

  return (
    <section aria-labelledby="t-detalle">
      <button type="button" className="enlace-volver" onClick={alVolver}>← Pedidos</button>
      <header className="rs-cabecera">
        <h1 id="t-detalle">
          {d.code} <span className={`rs-estado rs-estado--${d.estado}`}>{ESTADOS[d.estado] ?? d.estado}</span>
        </h1>
      </header>

      {error && <p className="aviso-error" role="alert">{error}</p>}

      <dl className="rs-datos">
        <Fila etiqueta="Canal">{CANALES[doc.canal] ?? doc.canal}</Fila>
        {doc.mesa && <Fila etiqueta="Mesa">{doc.mesa}</Fila>}
        {doc.referencia && <Fila etiqueta="A nombre de">{doc.referencia}</Fila>}
        {doc.entrega && (
          <>
            <Fila etiqueta="Dirección">{doc.entrega.direccion}</Fila>
            <Fila etiqueta="Teléfono">{doc.entrega.telefono}</Fila>
            {doc.entrega.referencia && <Fila etiqueta="Referencia">{doc.entrega.referencia}</Fila>}
          </>
        )}
        {d.snapshot?.cliente?.nombre && <Fila etiqueta="Cliente">{d.snapshot.cliente.nombre}</Fila>}
        {doc.notas && <Fila etiqueta="Notas">{doc.notas}</Fila>}
      </dl>

      <h2 className="rs-subtitulo">Ítems</h2>
      <ul className="rs-lineas">
        {(doc.lineas ?? []).map((l, i) => (
          <li key={i} className="rs-linea">
            <div className="rs-linea__cab">
              <span>
                <strong>{l.cantidad} × {snap[i]?.nombre ?? "—"}</strong>
                {snap[i]?.origen === "libre" ? <small> · libre</small> : snap[i]?.codigo ? <small> · {snap[i].codigo}</small> : null}
              </span>
              <span className="rs-num">{formatoDinero(l.subtotal, moneda)}</span>
            </div>
            {l.notas && <small>{l.notas}</small>}
          </li>
        ))}
      </ul>
      <p className="rs-total">
        Total: <strong>{formatoDinero(doc.total, moneda)}</strong>
        {doc.total === null && <small> · hay ítems sin precio</small>}
      </p>

      <div className="rs-acciones">
        {acciones.pasos.map((p) => (
          <button key={p.id} type="button" className="rs-btn rs-btn--primario" disabled={trabajando} onClick={() => paso(p.id)}>
            {p.etiqueta}
          </button>
        ))}
        {acciones.editar && (
          <button type="button" className="rs-btn" disabled={trabajando} onClick={() => alEditar(d)}>Editar</button>
        )}
        {acciones.anular && !anulando && (
          <button type="button" className="rs-btn rs-btn--peligro" disabled={trabajando} onClick={() => setAnulando(true)}>Anular</button>
        )}
      </div>

      {anulando && (
        <form
          className="rs-form rs-anular"
          onSubmit={(e) => {
            e.preventDefault();
            paso("anular", { motivo: { codigo: motivo, ...(detalleMotivo.trim() ? { detalle: detalleMotivo.trim() } : {}) } });
          }}
        >
          <h2 className="rs-subtitulo">Anular pedido</h2>
          <label className="campo">
            <span>Motivo</span>
            <select required value={motivo} onChange={(e) => setMotivo(e.target.value)}>
              <option value="" disabled>Elige un motivo</option>
              {MOTIVOS_ANULACION.map(([id, titulo]) => (<option key={id} value={id}>{titulo}</option>))}
            </select>
          </label>
          <label className="campo">
            <span>Detalle (opcional)</span>
            <input value={detalleMotivo} onChange={(e) => setDetalleMotivo(e.target.value)} maxLength={200} />
          </label>
          <div className="rs-acciones">
            <button type="submit" className="rs-btn rs-btn--peligro" disabled={trabajando || !motivo}>Confirmar anulación</button>
            <button type="button" className="rs-btn" onClick={() => setAnulando(false)}>No anular</button>
          </div>
        </form>
      )}

      <h2 className="rs-subtitulo">Historial</h2>
      <ol className="rs-historial">
        {(d.historial ?? []).map((h, i) => (
          <li key={i}>
            <span>
              {h.de ? `${ESTADOS[h.de] ?? h.de} → ` : "Creado como "}
              <strong>{ESTADOS[h.a] ?? h.a}</strong>
              {h.motivo?.codigo ? ` · ${MOTIVOS_ANULACION.find(([c]) => c === h.motivo.codigo)?.[1] ?? h.motivo.codigo}` : ""}
              {h.motivo?.detalle ? ` (${h.motivo.detalle})` : ""}
            </span>
            {h.ts && <small>{new Date(h.ts).toLocaleString("es", { dateStyle: "short", timeStyle: "short" })}</small>}
          </li>
        ))}
      </ol>
    </section>
  );
}
