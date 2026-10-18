import { formatoCodigoVale, porcentajeReto, textoAvance, textoFaltan, textoVence } from "./logica.js";

// Retos de colección (5.31): «prueba todo lo de una categoría y gana esto». `retos` viene en `puntos.retos` de
// GET .../cliente. El vale del premio lo emite el sistema solo al pagar el último ítem que faltaba; aquí solo se muestra el avance.
export default function Retos({ retos }) {
  if (!Array.isArray(retos) || !retos.length) return null;
  return (
    <div className="cat-retos">
      <h2 className="cat-vales__titulo">Retos</h2>
      <ul className="cat-retos__lista">
        {retos.map((r) => (
          <li key={r.id} className={`cat-reto${r.completo ? " cat-reto--completo" : ""}`}>
            <div className="cat-reto__cabecera">
              <strong>{r.nombre}</strong>
              <small>{r.completo ? "¡Completado!" : textoAvance(r)}</small>
            </div>
            <small>{r.descripcion || `Prueba todo en ${r.categoria}`} · Premio: {r.texto}</small>
            {!r.completo && (
              <>
                <div className="cat-barra" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={porcentajeReto(r)} aria-label={`Avance de ${r.nombre}`}>
                  <span style={{ width: `${porcentajeReto(r)}%` }} />
                </div>
                <small>{textoFaltan(r.faltan)}</small>
              </>
            )}
            {r.vale && r.vale.estado === "activo" && (
              <small>Tu vale: <strong className="cat-reto__codigo">{formatoCodigoVale(r.vale.codigo)}</strong> · {textoVence(r.vale.venceTs)}</small>
            )}
            {r.vale && r.vale.estado !== "activo" && <small>Vale {r.vale.estado === "usado" ? "usado" : r.vale.estado === "vencido" ? "vencido" : r.vale.estado}.</small>}
          </li>
        ))}
      </ul>
    </div>
  );
}
