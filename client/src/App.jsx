import { useCallback, useEffect, useState } from "react";
import { api, ErrorApi, mensajeDeError, urlCarta, urlCuenta } from "./api.js";
import { permite, puedeCambiarPrecio, puedeMarcarListos } from "./pedidos.js";
import Cocina from "./Cocina.jsx";
import ListaPedidos from "./ListaPedidos.jsx";
import FormularioPedido from "./FormularioPedido.jsx";
import DetallePedido from "./DetallePedido.jsx";

// Sin enrutador (como `cuenta`): la vista sale del estado.
//   sin sesión / sin empresa / contraseña temporal → se manda a `cuenta` (ahí se resuelve)
//   si no → pedidos (lista) · nueva · detalle de un pedido · pedir más en un pedido · cocina
export default function App() {
  const [yo, setYo] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [problema, setProblema] = useState(null); // { texto, irACuenta }
  // `#cocina` abre la pantalla de cocina (es el enlace de Inicio en `cuenta`)
  const [vista, setVista] = useState({ tipo: location.hash === "#cocina" ? "cocina" : "lista" });
  const [version, setVersion] = useState(0); // fuerza recargar la lista al volver

  const cargarYo = useCallback(async () => {
    try {
      const d = await api.yo();
      if (d.debeCambiarPassword)
        setProblema({ texto: "Debes cambiar tu contraseña temporal antes de usar el restaurante.", irACuenta: true });
      else if (!d.empresaActivaId)
        setProblema({ texto: "Elige una empresa para continuar.", irACuenta: true });
      else {
        setYo(d);
        setProblema(null);
      }
    } catch (e) {
      if (e instanceof ErrorApi && e.status === 401) setProblema({ texto: "Inicia sesión para continuar.", irACuenta: true });
      else if (e instanceof ErrorApi && e.codigo === "CAMBIO_PASSWORD_REQUERIDO")
        setProblema({ texto: "Debes cambiar tu contraseña temporal antes de usar el restaurante.", irACuenta: true });
      else setProblema({ texto: mensajeDeError(e), irACuenta: false });
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargarYo(); }, [cargarYo]);

  const aLista = () => { setVista({ tipo: "lista" }); setVersion((v) => v + 1); history.replaceState(null, "", location.pathname + location.search); };
  const aCocina = () => { setVista({ tipo: "cocina" }); history.replaceState(null, "", "#cocina"); };

  if (cargando) return <main className="rs-centrado"><p className="cargando">Cargando…</p></main>;
  if (problema)
    return (
      <main className="rs-centrado">
        <section className="rs-aviso-pantalla">
          <p>{problema.texto}</p>
          {problema.irACuenta ? (
            <a className="rs-btn rs-btn--primario" href={urlCuenta}>Ir a mi cuenta</a>
          ) : (
            <button type="button" className="rs-btn rs-btn--primario" onClick={() => { setCargando(true); cargarYo(); }}>Reintentar</button>
          )}
        </section>
      </main>
    );

  const permisos = yo.permisos;
  if (!permite(permisos, "documento:leer"))
    return (
      <main className="rs-centrado">
        <section className="rs-aviso-pantalla">
          <p>Tu rol no tiene acceso a los pedidos y ítems.</p>
          <a className="rs-btn" href={urlCuenta}>Volver a mi cuenta</a>
        </section>
      </main>
    );

  return (
    <main className="rs">
      <nav className="rs-barra" aria-label="Navegación">
        <a className="enlace-volver" href={urlCuenta}>← Inicio</a>
        <span className="rs-barra__der">
          {yo.empresa?.slug && (
            <a className="enlace-volver" href={urlCarta(yo.empresa.slug)} target="_blank" rel="noopener">Ver carta pública ↗</a>
          )}
          {yo.empresa?.nombre && <span className="rs-empresa">{yo.empresa.nombre}</span>}
        </span>
      </nav>

      {vista.tipo === "lista" && (
        <ListaPedidos
          key={version}
          permisos={permisos}
          alCocina={aCocina}
          alAbrir={(code) => setVista({ tipo: "detalle", code })}
          alCrear={() => setVista({ tipo: "nuevo" })}
        />
      )}
      {vista.tipo === "cocina" && <Cocina puedeMarcar={puedeMarcarListos(permisos)} alVolver={aLista} />}
      {vista.tipo === "nuevo" && (
        <FormularioPedido
          puedeVerCatalogo={permite(permisos, "catalogo:leer")}
          puedeCambiarPrecio={puedeCambiarPrecio(permisos)}
          alGuardar={(c) => setVista({ tipo: "detalle", code: c.code })}
          alCancelar={aLista}
        />
      )}
      {vista.tipo === "detalle" && (
        <DetallePedido
          key={vista.code}
          code={vista.code}
          permisos={permisos}
          alVolver={aLista}
          alPedirMas={(pedido) => setVista({ tipo: "mas", pedido })}
        />
      )}
      {vista.tipo === "mas" && (
        <FormularioPedido
          pedido={vista.pedido}
          puedeVerCatalogo={permite(permisos, "catalogo:leer")}
          puedeCambiarPrecio={puedeCambiarPrecio(permisos)}
          alGuardar={() => setVista({ tipo: "detalle", code: vista.pedido.code })}
          alCancelar={() => setVista({ tipo: "detalle", code: vista.pedido.code })}
        />
      )}
    </main>
  );
}
