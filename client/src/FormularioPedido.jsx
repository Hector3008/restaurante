import { useState } from "react";
import { api, mensajeDeError } from "./api.js";
import { CANALES, cuerpoPedido, cuerpoItems, formularioVacio, validarFormulario } from "./pedidos.js";
import EditorItems from "./EditorItems.jsx";
import SelectorCliente from "./SelectorCliente.jsx";

// Abrir un pedido (el pedido nace al pedir el primer ítem) o, con `cuenta`, pedir más en un pedido abierto.
export default function FormularioPedido({ pedido, puedeVerCatalogo, puedeCambiarPrecio, puedeVerClientes = false, puedeCrearClientes = false, puedeCuentas = false, alGuardar, alCancelar }) {
  const agregando = Boolean(pedido);
  const [f, setF] = useState(() => formularioVacio());
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [claveSinAnotar, setClaveSinAnotar] = useState(false);
  const campo = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function enviar(e) {
    e.preventDefault();
    if (enviando) return;
    const problema = agregando
      ? f.items.length
        ? null
        : "Agrega al menos un ítem."
      : validarFormulario(f);
    if (problema) return setError(problema);
    setError("");
    setEnviando(true);
    try {
      const r = agregando ? await api.pedidos.agregar(pedido.code, cuerpoItems(f.items)) : await api.pedidos.crear(cuerpoPedido(f));
      alGuardar(r);
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="rs-form" onSubmit={enviar}>
      <h1>{agregando ? `Pedir más en ${pedido.code}` : "Nuevo pedido"}</h1>
      {!agregando && <p className="rs-vacio">El pedido se abre con el primer ítem y sigue abierto hasta que se pague todo.</p>}

      {!agregando && (
        <div className="rs-filtros" role="tablist" aria-label="Canal">
          {Object.entries(CANALES).map(([id, titulo]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={f.canal === id}
              className={f.canal === id ? "rs-chip rs-chip--activo" : "rs-chip"}
              onClick={() => setF((x) => ({ ...x, canal: id }))}
            >
              {titulo}
            </button>
          ))}
        </div>
      )}

      {!agregando && f.canal === "salon" && (
        <label className="campo">
          <span>Mesa</span>
          <input value={f.mesa} onChange={campo("mesa")} maxLength={20} />
        </label>
      )}
      {!agregando && f.canal === "llevar" && (
        <label className="campo">
          <span>A nombre de</span>
          <input value={f.referencia} onChange={campo("referencia")} maxLength={60} />
        </label>
      )}
      {!agregando && f.canal === "delivery" && (
        <>
          <label className="campo">
            <span>Dirección de entrega</span>
            <input value={f.direccion} onChange={campo("direccion")} maxLength={200} />
          </label>
          <label className="campo">
            <span>Teléfono de contacto</span>
            <input value={f.telefono} onChange={campo("telefono")} inputMode="tel" maxLength={30} />
          </label>
          <label className="campo">
            <span>Referencia (opcional)</span>
            <input value={f.referenciaEntrega} onChange={campo("referenciaEntrega")} maxLength={200} />
          </label>
        </>
      )}

      {!agregando && puedeVerClientes && (
        <SelectorCliente
          valor={f.cliente}
          alCambiar={(cliente) => setF((x) => ({ ...x, cliente }))}
          puedeCrear={puedeCrearClientes}
          puedeCuenta={puedeCuentas}
          alPendiente={setClaveSinAnotar}
        />
      )}

      <EditorItems
        items={f.items}
        alCambiar={(items) => setF((x) => ({ ...x, items }))}
        puedeVerCatalogo={puedeVerCatalogo}
        puedeCambiarPrecio={puedeCambiarPrecio}
        moneda={pedido?.moneda ?? null}
      />

      {!agregando && (
        <label className="campo">
          <span>Notas del pedido (opcional)</span>
          <input value={f.notas} onChange={campo("notas")} maxLength={500} />
        </label>
      )}

      {error && <p className="aviso-error" role="alert">{error}</p>}
      <div className="rs-acciones">
        <button type="submit" className="rs-btn rs-btn--primario" disabled={enviando || claveSinAnotar} title={claveSinAnotar ? "Anota primero la contraseña temporal del cliente" : undefined}>
          {enviando ? "Enviando…" : agregando ? "Enviar a cocina" : "Abrir pedido y enviar a cocina"}
        </button>
        <button type="button" className="rs-btn" onClick={alCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
