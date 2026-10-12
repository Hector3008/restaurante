import { useEffect, useMemo, useState } from "react";
import { api, mensajeDeError } from "./api.js";
import {
  CANALES,
  MAX_CANTIDAD,
  agregarDelCatalogo,
  agregarLibre,
  cambiarCantidad,
  cuerpoCreacion,
  cuerpoEdicion,
  fijarPrecio,
  formatoDinero,
  formularioDesdeDetalle,
  formularioVacio,
  parsearPrecio,
  totalEstimado,
  validarFormulario,
} from "./pedidos.js";

// Alta y edición de un pedido. El servidor es quien copia nombre y precio del catálogo y calcula los
// importes: aquí solo se envían códigos, cantidades y notas (el total que se ve es una estimación).

function BuscadorCatalogo({ alElegir }) {
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const texto = q.trim();
    if (!texto) {
      setResultados([]);
      setError("");
      return;
    }
    let vigente = true;
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.buscarCatalogo(texto);
        if (vigente) {
          setResultados(r);
          setError("");
        }
      } catch (e) {
        if (vigente) setError(e.status === 403 ? "No tienes permiso para ver el catálogo." : mensajeDeError(e));
      } finally {
        if (vigente) setBuscando(false);
      }
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="rs-buscador">
      <input
        type="search"
        placeholder="Buscar en el catálogo por código o nombre"
        aria-label="Buscar en el catálogo"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
      />
      {error && <p className="aviso-error" role="alert">{error}</p>}
      {buscando && <small className="cargando">Buscando…</small>}
      {!buscando && q.trim() && !error && resultados.length === 0 && <small className="rs-vacio">Sin resultados.</small>}
      {resultados.length > 0 && (
        <ul className="rs-resultados">
          {resultados.map((it) => (
            <li key={it.itemId ?? it.id ?? it._id ?? it.codigo}>
              <button type="button" onClick={() => alElegir(it)}>
                <span>
                  <strong>{it.nombre}</strong> <small>{it.codigo}</small>
                </span>
                <span className="rs-num">{formatoDinero(it.precio ?? null, null)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Precio unitario de una línea. Guarda lo que se escribe como texto para no estorbar al teclear
// ("5." o "5,") y solo cambia el pedido cuando el texto es un precio válido.
function PrecioLinea({ linea, editable, moneda, alCambiar }) {
  const [texto, setTexto] = useState(linea.precio === null ? "" : String(linea.precio));
  const valido = parsearPrecio(texto).ok;
  if (!editable)
    return (
      <span className="rs-num">
        {linea.precio === null ? "sin precio" : formatoDinero(linea.precio * linea.cantidad, moneda)}
        {linea.modificado && <small> · precio cambiado</small>}
      </span>
    );
  return (
    <span className="rs-precio">
      <label>
        <small>Precio</small>
        <input
          inputMode="decimal"
          aria-label={`Precio de ${linea.nombre}`}
          aria-invalid={!valido}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            alCambiar(e.target.value);
          }}
          onBlur={() => setTexto(linea.precio === null ? "" : String(linea.precio))}
        />
      </label>
      <span className="rs-num">{linea.precio === null ? "sin precio" : formatoDinero(linea.precio * linea.cantidad, moneda)}</span>
      {linea.modificado && (
        <small className="rs-precio__aviso">
          Catálogo: {formatoDinero(linea.precioCatalogo, moneda)}
        </small>
      )}
      {!valido && <small className="rs-precio__aviso" role="alert">Hasta 2 decimales.</small>}
    </span>
  );
}

function LineaLibre({ alAgregar }) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [precio, setPrecio] = useState("");
  const [error, setError] = useState("");

  function agregar() {
    const p = parsearPrecio(precio);
    if (!nombre.trim()) return setError("Escribe el nombre.");
    if (!p.ok) return setError("El precio admite hasta 2 decimales.");
    alAgregar({ nombre, precio: p.valor });
    setNombre("");
    setPrecio("");
    setError("");
    setAbierto(false);
  }

  if (!abierto)
    return (
      <button type="button" className="rs-btn" onClick={() => setAbierto(true)}>
        + Ítem que no está en el catálogo
      </button>
    );
  return (
    // No es un <form>: va dentro del formulario del pedido y un form anidado enviaría también el pedido.
    <div className="rs-libre" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregar(); } }}>
      <label className="campo">
        <span>Nombre</span>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={200} autoFocus />
      </label>
      <label className="campo">
        <span>Precio (opcional)</span>
        <input value={precio} onChange={(e) => setPrecio(e.target.value)} inputMode="decimal" />
      </label>
      {error && <p className="aviso-error" role="alert">{error}</p>}
      <div className="rs-acciones">
        <button type="button" className="rs-btn rs-btn--primario" onClick={agregar}>Agregar</button>
        <button type="button" className="rs-btn" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
    </div>
  );
}

export default function FormularioPedido({ detalle, puedeVerCatalogo, puedeCambiarPrecio, alGuardar, alCancelar }) {
  const editando = Boolean(detalle);
  const [f, setF] = useState(() => (detalle ? formularioDesdeDetalle(detalle) : formularioVacio()));
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const moneda = detalle?.doc?.moneda ?? null;
  const total = useMemo(() => totalEstimado(f.lineas), [f.lineas]);

  const campo = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const lineas = (fn) => setF((x) => ({ ...x, lineas: fn(x.lineas) }));

  async function enviar(e) {
    e.preventDefault();
    if (enviando) return;
    const problema = validarFormulario(f);
    if (problema) return setError(problema);
    setError("");
    setEnviando(true);
    try {
      const r = editando
        ? await api.editar(detalle.code, cuerpoEdicion(f, detalle.version))
        : await api.crear(cuerpoCreacion(f));
      alGuardar(r);
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="rs-form" onSubmit={enviar}>
      <h1>{editando ? `Editar ${detalle.code}` : "Nuevo pedido"}</h1>

      {!editando && (
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
      {editando && <p className="rs-vacio">Canal: {CANALES[f.canal]} (no se puede cambiar).</p>}

      {f.canal === "salon" && (
        <label className="campo">
          <span>Mesa</span>
          <input value={f.mesa} onChange={campo("mesa")} maxLength={20} />
        </label>
      )}
      {f.canal === "llevar" && (
        <label className="campo">
          <span>A nombre de</span>
          <input value={f.referencia} onChange={campo("referencia")} maxLength={60} />
        </label>
      )}
      {f.canal === "delivery" && (
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

      <section aria-labelledby="t-items">
        <h2 id="t-items" className="rs-subtitulo">Ítems</h2>
        {puedeVerCatalogo ? (
          <BuscadorCatalogo alElegir={(it) => lineas((l) => agregarDelCatalogo(l, it))} />
        ) : (
          <p className="rs-vacio">Tu rol no puede ver el catálogo: solo puedes agregar ítems libres.</p>
        )}
        <LineaLibre alAgregar={(x) => lineas((l) => agregarLibre(l, x))} />

        {f.lineas.length === 0 ? (
          <p className="rs-vacio">Todavía no hay ítems.</p>
        ) : (
          <ul className="rs-lineas">
            {f.lineas.map((l) => (
              <li key={l.clave} className="rs-linea">
                <div className="rs-linea__cab">
                  <span>
                    <strong>{l.nombre}</strong>
                    {l.libre ? <small> · libre</small> : <small> · {l.codigo}</small>}
                  </span>
                  <PrecioLinea
                    linea={l}
                    moneda={moneda}
                    editable={l.libre || puedeCambiarPrecio}
                    alCambiar={(t) => lineas((x) => fijarPrecio(x, l.clave, t))}
                  />
                </div>
                <div className="rs-linea__pie">
                  <span className="rs-cantidad">
                    <button type="button" className="rs-btn" onClick={() => lineas((x) => cambiarCantidad(x, l.clave, -1))} disabled={l.cantidad <= 1} aria-label="Menos">−</button>
                    <output aria-label="Cantidad">{l.cantidad}</output>
                    <button type="button" className="rs-btn" onClick={() => lineas((x) => cambiarCantidad(x, l.clave, 1))} disabled={l.cantidad >= MAX_CANTIDAD} aria-label="Más">+</button>
                  </span>
                  <input
                    className="rs-notas"
                    placeholder="Nota (sin cebolla, bien cocido…)"
                    aria-label={`Nota de ${l.nombre}`}
                    maxLength={200}
                    value={l.notas}
                    onChange={(e) => lineas((x) => x.map((y) => (y.clave === l.clave ? { ...y, notas: e.target.value } : y)))}
                  />
                  <button type="button" className="rs-btn rs-btn--peligro" onClick={() => lineas((x) => x.filter((y) => y.clave !== l.clave))}>
                    Quitar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="rs-total">
          Total estimado: <strong>{formatoDinero(total, moneda)}</strong>
          <small> · el total definitivo lo calcula el servidor con los precios del catálogo</small>
        </p>
      </section>

      <label className="campo">
        <span>Notas del pedido (opcional)</span>
        <input value={f.notas} onChange={campo("notas")} maxLength={500} />
      </label>

      {error && <p className="aviso-error" role="alert">{error}</p>}
      <div className="rs-acciones">
        <button type="submit" className="rs-btn rs-btn--primario" disabled={enviando}>
          {enviando ? "Guardando…" : editando ? "Guardar cambios" : "Crear pedido"}
        </button>
        <button type="button" className="rs-btn" onClick={alCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
