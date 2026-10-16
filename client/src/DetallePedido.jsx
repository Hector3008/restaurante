import { useCallback, useEffect, useState } from "react";
import { api, mensajeDeError } from "./api.js";
import SelectorCliente from "./SelectorCliente.jsx";
import {
  CANALES,
  ESTADOS_PEDIDO,
  ESTADOS_ITEM,
  MOTIVOS_ANULACION,
  accionesPedido,
  accionesItem,
  gruposPorCliente,
  resumenItems,
  cuerpoDatos,
  formularioDesdePedido,
  validarFormulario,
  cuerpoPrecio,
  destinoDe,
  formatoDinero,
  permite,
  textoPuntos,
} from "./pedidos.js";

function Fila({ etiqueta, children }) {
  return (
    <>
      <dt>{etiqueta}</dt>
      <dd>{children}</dd>
    </>
  );
}

// Un pedido con todos sus ítems. Cada ítem se mueve solo (listo en cocina, entregado por el mesero);
// el pedido se cobra de una vez cuando todo está entregado. Las acciones llevan la versión que se ve: si
// otra persona cambió algo, el servidor responde 409 y se recarga con lo último.
export default function DetallePedido({ code, permisos, alVolver, alPedirMas }) {
  const [c, setC] = useState(null);
  const [error, setError] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [anulando, setAnulando] = useState(null); // { tipo: "pedido" } | { tipo: "ítem", ítem }
  const [editandoPrecio, setEditandoPrecio] = useState(null); // { code, texto }
  const [motivo, setMotivo] = useState("");
  const [detalleMotivo, setDetalleMotivo] = useState("");
  const [editando, setEditando] = useState(null); // formulario de los datos del pedido (mesa, a nombre de, entrega, notas)
  const [avisoPuntos, setAvisoPuntos] = useState(""); // lo que ganó el cliente al cobrar (sobrevive a la recarga)
  const [claveSinAnotar, setClaveSinAnotar] = useState(false);
  const [clienteItem, setClienteItem] = useState(null); // código del ítem al que se le está eligiendo cliente

  // `conservarError`: tras un conflicto se recarga pero el aviso tiene que seguir a la vista.
  const cargar = useCallback(async (conservarError = false) => {
    try {
      setC(await api.pedidos.obtener(code));
      if (!conservarError) setError("");
    } catch (e) {
      setError(e.status === 404 ? "No se encontró este pedido." : mensajeDeError(e));
    }
  }, [code]);

  useEffect(() => {
    setC(null);
    cargar();
  }, [cargar]);

  async function ejecutar(fn) {
    if (trabajando) return;
    setTrabajando(true);
    setError("");
    try {
      await fn();
      setAnulando(null);
      setEditando(null);
      setClienteItem(null);
      setEditandoPrecio(null);
      setMotivo("");
      setDetalleMotivo("");
      await cargar();
    } catch (e) {
      setError(mensajeDeError(e));
      if (["CONFLICTO_VERSION", "TRANSICION_INVALIDA", "ESTADO_INVALIDO"].includes(e.codigo)) await cargar(true);
    } finally {
      setTrabajando(false);
    }
  }

  if (!c)
    return (
      <section>
        <button type="button" className="enlace-volver" onClick={alVolver}>← Pedidos</button>
        {error ? <p className="aviso-error" role="alert">{error}</p> : <p className="cargando">Cargando…</p>}
      </section>
    );

  const doc = c.doc ?? {};
  const acc = accionesPedido(c, permisos);
  const res = resumenItems(c.items);
  const grupos = acc.dividir ? gruposPorCliente(c) : [];
  const cobrarItems = (codigos) =>
    ejecutar(async () => {
      const r = await api.pedidos.cobrarItems(c.code, { items: codigos });
      setAvisoPuntos(textoPuntos(r.puntos) ?? "");
    });
  const moneda = c.moneda;
  const cuerpoMotivo = { codigo: motivo, ...(detalleMotivo.trim() ? { detalle: detalleMotivo.trim() } : {}) };

  return (
    <section aria-labelledby="t-pedido">
      <button type="button" className="enlace-volver" onClick={alVolver}>← Pedidos</button>
      <header className="rs-cabecera">
        <h1 id="t-pedido">
          {destinoDe(c) || c.code} <span className={`rs-estado rs-estado--${c.estado}`}>{ESTADOS_PEDIDO[c.estado] ?? c.estado}</span>
        </h1>
      </header>

      {error && <p className="aviso-error" role="alert">{error}</p>}

      <dl className="rs-datos">
        <Fila etiqueta="Pedido">{c.code}</Fila>
        <Fila etiqueta="Canal">{CANALES[doc.canal] ?? doc.canal}</Fila>
        {doc.entrega && (
          <>
            <Fila etiqueta="Dirección">{doc.entrega.direccion}</Fila>
            <Fila etiqueta="Teléfono">{doc.entrega.telefono}</Fila>
            {doc.entrega.referencia && <Fila etiqueta="Referencia">{doc.entrega.referencia}</Fila>}
          </>
        )}
        {c.estado !== "abierto" && c.snapshot?.cliente?.nombre && <Fila etiqueta="Cliente">{c.snapshot.cliente.nombre}</Fila>}
        {doc.notas && <Fila etiqueta="Notas">{doc.notas}</Fila>}
      </dl>

      {avisoPuntos && <p className="rs-puntos" role="status">{avisoPuntos}</p>}

      {c.estado === "abierto" && permite(permisos, "documento:editar") && permite(permisos, "cliente:leer") && (
        <SelectorCliente
          valor={c.cliente ? { id: c.cliente.id, nombre: c.cliente.nombre, telefono: c.snapshot?.cliente?.telefono ?? null } : null}
          alCambiar={(cl) => ejecutar(() => api.pedidos.asociarCliente(c.code, { clienteId: cl?.id ?? null, esperaVersion: c.version }))}
          puedeCrear={permite(permisos, "cliente:crear")}
          puedeCuenta={permite(permisos, "cliente:cuenta")}
          deshabilitado={trabajando}
          alPendiente={setClaveSinAnotar}
        />
      )}

      <h2 className="rs-subtitulo">Ítems</h2>
      <ul className="rs-lineas">
        {c.items.map((i) => {
          const { pasos, anular, precio, cliente: puedeCliente, cobrar: puedeCobrarItem } = accionesItem(i.estado, permisos);
          const nuevoPrecio = editandoPrecio?.code === i.code ? cuerpoPrecio(editandoPrecio.texto) : null;
          const enPedidoAbierto = c.estado === "abierto";
          return (
            <li key={i.code} className={i.estado === "anulado" ? "rs-linea rs-linea--anulado" : "rs-linea"}>
              <div className="rs-linea__cab">
                <span>
                  <strong>{i.cantidad} × {i.nombre}</strong>
                  {i.origen === "libre" ? <small> · libre</small> : i.codigo ? <small> · {i.codigo}</small> : null}
                  {" "}
                  <span className={`rs-estado rs-estado--${i.estado}`}>{ESTADOS_ITEM[i.estado] ?? i.estado}</span>
                </span>
                <span className="rs-num">{formatoDinero(i.subtotal, moneda)}</span>
              </div>
              {i.precioModificado && (
                <small>Precio cambiado: {formatoDinero(i.precio, moneda)} (catálogo: {formatoDinero(i.precioCatalogo, moneda)})</small>
              )}
              {i.notas && <small>{i.notas}</small>}
              {(i.cliente || (c.cliente && i.estado !== "anulado")) && (
                <small>
                  {i.cliente ? `Cliente: ${i.cliente.nombre}` : `Cuenta de ${c.cliente.nombre}`}
                </small>
              )}
              {enPedidoAbierto && puedeCliente && clienteItem === i.code && permite(permisos, "cliente:leer") && (
                <div>
                  <SelectorCliente
                    valor={i.cliente ? { id: i.cliente.id, nombre: i.cliente.nombre } : null}
                    alCambiar={(cl) => ejecutar(() => api.items.asociarCliente(i.code, { clienteId: cl?.id ?? null, esperaVersion: i.version }))}
                    puedeCrear={permite(permisos, "cliente:crear")}
                    puedeCuenta={permite(permisos, "cliente:cuenta")}
                    deshabilitado={trabajando}
                    alPendiente={setClaveSinAnotar}
                  />
                  <button type="button" className="rs-btn" onClick={() => setClienteItem(null)}>Cerrar</button>
                </div>
              )}
              {enPedidoAbierto && precio && editandoPrecio?.code === i.code && (
                <form
                  className="rs-precio"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    if (nuevoPrecio.ok) ejecutar(() => api.items.paso(i.code, "precio", { precio: nuevoPrecio.precio, esperaVersion: i.version }));
                  }}
                >
                  <label>
                    <span>Precio</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoFocus
                      value={editandoPrecio.texto}
                      aria-invalid={editandoPrecio.texto !== "" && !nuevoPrecio.ok}
                      onChange={(ev) => setEditandoPrecio({ code: i.code, texto: ev.target.value })}
                    />
                  </label>
                  <button type="submit" className="rs-btn rs-btn--primario" disabled={trabajando || !nuevoPrecio.ok}>Guardar</button>
                  <button type="button" className="rs-btn" onClick={() => setEditandoPrecio(null)}>Cancelar</button>
                  {editandoPrecio.texto !== "" && !nuevoPrecio.ok && <small className="rs-precio__aviso" role="alert">{nuevoPrecio.error}</small>}
                </form>
              )}
              {enPedidoAbierto && (pasos.some((p) => p.id === "entregar") || anular || puedeCobrarItem || (puedeCliente && clienteItem !== i.code) || (precio && editandoPrecio?.code !== i.code)) && (
                <div className="rs-acciones">
                  {puedeCobrarItem && (
                    <button type="button" className="rs-btn rs-btn--primario" disabled={trabajando || claveSinAnotar} onClick={() => cobrarItems([i.code])}>
                      Cobrar {formatoDinero(i.subtotal, moneda)}
                    </button>
                  )}
                  {puedeCliente && clienteItem !== i.code && permite(permisos, "cliente:leer") && (
                    <button type="button" className="rs-btn" disabled={trabajando} onClick={() => setClienteItem(i.code)}>
                      {i.cliente ? "Cambiar cliente" : "Asignar cliente"}
                    </button>
                  )}
                  {pasos.filter((p) => p.id === "entregar").map((p) => (
                    <button key={p.id} type="button" className="rs-btn rs-btn--primario" disabled={trabajando} onClick={() => ejecutar(() => api.items.paso(i.code, p.id, { esperaVersion: i.version }))}>
                      {p.etiqueta}
                    </button>
                  ))}
                  {precio && editandoPrecio?.code !== i.code && (
                    <button type="button" className="rs-btn" disabled={trabajando} onClick={() => setEditandoPrecio({ code: i.code, texto: i.precio ?? "" })}>
                      {i.precio === null ? "Poner precio" : "Cambiar precio"}
                    </button>
                  )}
                  {anular && (
                    <button type="button" className="rs-btn rs-btn--peligro" disabled={trabajando} onClick={() => setAnulando({ tipo: "item", item: i })}>
                      Anular
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="rs-total">
        Total: <strong>{formatoDinero(c.total, moneda)}</strong>
        {c.total === null && <small> · hay ítems sin precio</small>}
        {c.estado === "abierto" && res.pagados > 0 && (
          <small> · cobrado {formatoDinero(res.cobrado, moneda)} · falta {formatoDinero(res.porCobrar, moneda)}</small>
        )}
      </p>

      {grupos.length > 0 && (grupos.length > 1 || res.pagados > 0) && (
        <>
          <h2 className="rs-subtitulo">Dividir la cuenta</h2>
          <ul className="rs-lineas">
            {grupos.map((g) => (
              <li key={g.clave} className="rs-linea">
                <div className="rs-linea__cab">
                  <span>
                    <strong>{g.cliente ? g.cliente.nombre : "Sin cliente"}</strong>
                    <small> · {g.items.length} ítem{g.items.length === 1 ? "" : "s"}{g.enCurso ? ` (${g.enCurso} sin entregar)` : ""}</small>
                  </span>
                  <span className="rs-num">{g.sinPrecio ? "—" : formatoDinero(g.subtotal, moneda)}</span>
                </div>
                {g.entregados.length > 0 && (
                  <div className="rs-acciones">
                    <button type="button" className="rs-btn rs-btn--primario" disabled={trabajando || claveSinAnotar} onClick={() => cobrarItems(g.entregados)}>
                      Cobrar {g.cliente ? `a ${g.cliente.nombre}` : "estos ítems"}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="rs-acciones">
        {acc.agregar && (
          <button type="button" className="rs-btn" disabled={trabajando} onClick={() => alPedirMas(c)}>Pedir más</button>
        )}
        {acc.editarDatos && !editando && (
          <button type="button" className="rs-btn" disabled={trabajando} onClick={() => setEditando(formularioDesdePedido(c))}>
            {doc.canal === "salon" ? "Cambiar mesa y notas" : doc.canal === "llevar" ? "Cambiar nombre y notas" : "Editar datos de entrega"}
          </button>
        )}
        {acc.cobrar && (
          <button
            type="button"
            className="rs-btn rs-btn--primario"
            disabled={trabajando || !acc.puedeCobrarAhora || claveSinAnotar}
            title={acc.motivoNoCobrar ?? (claveSinAnotar ? "Anota primero la contraseña temporal del cliente" : undefined)}
            onClick={() =>
              ejecutar(async () => {
                const r = await api.pedidos.cobrar(c.code, { esperaVersion: c.version });
                setAvisoPuntos(textoPuntos(r.puntos) ?? "");
              })
            }
          >
            {res.pagados > 0 ? "Cobrar lo que falta" : "Cobrar todo"} {formatoDinero(res.porCobrar, moneda)}
          </button>
        )}
        {acc.anular && !anulando && (
          <button type="button" className="rs-btn rs-btn--peligro" disabled={trabajando} onClick={() => setAnulando({ tipo: "pedido" })}>Anular pedido</button>
        )}
      </div>
      {acc.cobrar && acc.motivoNoCobrar && <small className="rs-vacio">{acc.motivoNoCobrar}</small>}

      {editando && acc.editarDatos && (
        <form
          className="rs-form"
          onSubmit={(e) => {
            e.preventDefault();
            // validarFormulario también pide ítems: aquí no se editan, se le pasa uno de relleno
            const problema = validarFormulario({ ...editando, items: [1] });
            if (problema) return setError(problema);
            ejecutar(() => api.pedidos.editar(c.code, cuerpoDatos(editando, c.version)));
          }}
        >
          <h2 className="rs-subtitulo">Editar datos del pedido</h2>
          {editando.canal === "salon" && (
            <label className="campo"><span>Mesa</span><input autoFocus value={editando.mesa} maxLength={20} onChange={(e) => setEditando({ ...editando, mesa: e.target.value })} /></label>
          )}
          {editando.canal === "llevar" && (
            <label className="campo"><span>A nombre de</span><input autoFocus value={editando.referencia} maxLength={60} onChange={(e) => setEditando({ ...editando, referencia: e.target.value })} /></label>
          )}
          {editando.canal === "delivery" && (
            <>
              <label className="campo"><span>Dirección de entrega</span><input autoFocus value={editando.direccion} maxLength={200} onChange={(e) => setEditando({ ...editando, direccion: e.target.value })} /></label>
              <label className="campo"><span>Teléfono de contacto</span><input value={editando.telefono} inputMode="tel" maxLength={30} onChange={(e) => setEditando({ ...editando, telefono: e.target.value })} /></label>
              <label className="campo"><span>Referencia (opcional)</span><input value={editando.referenciaEntrega} maxLength={200} onChange={(e) => setEditando({ ...editando, referenciaEntrega: e.target.value })} /></label>
            </>
          )}
          <label className="campo"><span>Notas del pedido (opcional)</span><input value={editando.notas} maxLength={500} onChange={(e) => setEditando({ ...editando, notas: e.target.value })} /></label>
          <div className="rs-acciones">
            <button type="submit" className="rs-btn rs-btn--primario" disabled={trabajando}>Guardar cambios</button>
            <button type="button" className="rs-btn" onClick={() => setEditando(null)}>Cancelar</button>
          </div>
        </form>
      )}

      {anulando && (
        <form
          className="rs-form rs-anular"
          onSubmit={(e) => {
            e.preventDefault();
            ejecutar(() =>
              anulando.tipo === "pedido"
                ? api.pedidos.anular(c.code, { esperaVersion: c.version, motivo: cuerpoMotivo })
                : api.items.paso(anulando.item.code, "anular", { esperaVersion: anulando.item.version, motivo: cuerpoMotivo }),
            );
          }}
        >
          <h2 className="rs-subtitulo">
            {anulando.tipo === "pedido" ? "Anular todo el pedido" : `Anular ${anulando.item.cantidad} × ${anulando.item.nombre}`}
          </h2>
          {anulando.tipo === "pedido" && <p className="rs-vacio">También se anulan todos sus ítems.</p>}
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
            <button type="button" className="rs-btn" onClick={() => setAnulando(null)}>No anular</button>
          </div>
        </form>
      )}

      <h2 className="rs-subtitulo">Historial del pedido</h2>
      <ol className="rs-historial">
        {(c.historial ?? []).map((h, i) => (
          <li key={i}>
            <span>
              {h.de ? `${ESTADOS_PEDIDO[h.de] ?? h.de} → ` : "Abierto con el primer ítem · "}
              <strong>{ESTADOS_PEDIDO[h.a] ?? h.a}</strong>
              {h.motivo?.codigo ? ` · ${MOTIVOS_ANULACION.find(([k]) => k === h.motivo.codigo)?.[1] ?? h.motivo.codigo}` : ""}
              {h.motivo?.detalle ? ` (${h.motivo.detalle})` : ""}
            </span>
            {h.ts && <small>{new Date(h.ts).toLocaleString("es", { dateStyle: "short", timeStyle: "short" })}</small>}
          </li>
        ))}
      </ol>
    </section>
  );
}
