import { useCallback, useEffect, useState } from "react";
import { api, ErrorApi, mensajeDeError, urlCuenta } from "./api.js";
import { permite, puedeCambiarPrecio } from "./pedidos.js";
import ListaPedidos from "./ListaPedidos.jsx";
import FormularioPedido from "./FormularioPedido.jsx";
import DetallePedido from "./DetallePedido.jsx";

// Sin enrutador (como `cuenta`): la vista sale del estado.
//   sin sesión / sin empresa / contraseña temporal → se manda a `cuenta` (ahí se resuelve)
//   si no → lista · nuevo · detalle · editar
export default function App() {
  const [yo, setYo] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [problema, setProblema] = useState(null); // { texto, irACuenta }
  const [vista, setVista] = useState({ tipo: "lista" });
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

  const aLista = () => { setVista({ tipo: "lista" }); setVersion((v) => v + 1); };

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
          <p>Tu rol no tiene acceso a los pedidos.</p>
          <a className="rs-btn" href={urlCuenta}>Volver a mi cuenta</a>
        </section>
      </main>
    );

  return (
    <main className="rs">
      <nav className="rs-barra" aria-label="Navegación">
        <a className="enlace-volver" href={urlCuenta}>← Inicio</a>
        {yo.empresa?.nombre && <span className="rs-empresa">{yo.empresa.nombre}</span>}
      </nav>

      {vista.tipo === "lista" && (
        <ListaPedidos
          key={version}
          puedeCrear={permite(permisos, "documento:crear")}
          alAbrir={(code) => setVista({ tipo: "detalle", code })}
          alCrear={() => setVista({ tipo: "nuevo" })}
        />
      )}
      {vista.tipo === "nuevo" && (
        <FormularioPedido
          puedeVerCatalogo={permite(permisos, "catalogo:leer")}
          puedeCambiarPrecio={puedeCambiarPrecio(permisos)}
          alGuardar={(p) => setVista({ tipo: "detalle", code: p.code })}
          alCancelar={aLista}
        />
      )}
      {vista.tipo === "detalle" && (
        <DetallePedido
          key={vista.code}
          code={vista.code}
          permisos={permisos}
          alVolver={aLista}
          alEditar={(d) => setVista({ tipo: "editar", detalle: d })}
          alCambiar={() => {}}
        />
      )}
      {vista.tipo === "editar" && (
        <FormularioPedido
          detalle={vista.detalle}
          puedeVerCatalogo={permite(permisos, "catalogo:leer")}
          puedeCambiarPrecio={puedeCambiarPrecio(permisos)}
          alGuardar={(p) => setVista({ tipo: "detalle", code: p.code })}
          alCancelar={() => setVista({ tipo: "detalle", code: vista.detalle.code })}
        />
      )}
    </main>
  );
}
