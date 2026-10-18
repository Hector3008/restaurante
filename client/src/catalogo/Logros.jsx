import { formatoFecha } from "./logica.js";

// Nivel e insignias del cliente (5.30). `logros` viene en `puntos.logros` de GET .../cliente. Todo se calcula en el
// núcleo desde el libro de puntos; aquí solo se muestra. Sin niveles configurados no se muestra la barra.
export default function Logros({ logros }) {
  if (!logros) return null;
  const { nivel, insignias = [], acumulado = 0 } = logros;
  const obtenidas = insignias.filter((i) => i.obtenida);
  const faltan = insignias.filter((i) => !i.obtenida);
  return (
    <div className="cat-logros">
      {nivel && (
        <div className="cat-nivel">
          <p className="cat-nivel__titulo">
            {nivel.actual ? <>Nivel <strong>{nivel.actual.nombre}</strong></> : <>Aún sin nivel</>}
            <small> · {acumulado} puntos acumulados</small>
          </p>
          {nivel.siguiente ? (
            <>
              <div className="cat-barra" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(nivel.progreso * 100)} aria-label={`Avance hacia ${nivel.siguiente.nombre}`}>
                <span style={{ width: `${Math.round(nivel.progreso * 100)}%` }} />
              </div>
              <small>Te faltan {nivel.faltan} puntos para {nivel.siguiente.nombre}.</small>
            </>
          ) : (
            <small>Llegaste al nivel más alto.</small>
          )}
        </div>
      )}
      {insignias.length > 0 && (
        <>
          <h2 className="cat-vales__titulo">Tus insignias</h2>
          <ul className="cat-insignias">
            {obtenidas.map((i) => (
              <li key={i.id} className="cat-insignia cat-insignia--obtenida">
                <strong>{i.nombre}</strong>
                <small>{i.descripcion}{i.obtenidaTs ? ` · ${formatoFecha(i.obtenidaTs)}` : ""}</small>
              </li>
            ))}
            {faltan.map((i) => (
              <li key={i.id} className="cat-insignia">
                <strong>{i.nombre}</strong>
                <small>{i.descripcion} · {i.actual} de {i.meta}</small>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
