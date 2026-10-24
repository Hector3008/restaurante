import { useState } from "react";
import { ESTADO_REFERIDO, enlaceInvitacion, textoPremioReferidos } from "./logica.js";

// «Invita a un amigo» (5.47): el código del cliente, el enlace para compartir y a quiénes ha traído.
// `referidos` viene en `estado.referidos` de GET .../cliente (el núcleo lo calcula). Sin programa, no se muestra.
export default function Invitar({ referidos, programaPuntos, moneda }) {
  const [aviso, setAviso] = useState("");
  if (!referidos?.habilitada || !referidos.codigo) return null;
  const premio = textoPremioReferidos(referidos, moneda);

  async function copiar() {
    const enlace = enlaceInvitacion(window.location.href, referidos.codigo);
    try {
      await navigator.clipboard.writeText(enlace);
      setAviso("Enlace copiado. Pégalo en un mensaje a tu amigo.");
    } catch {
      setAviso(enlace); // sin permiso de portapapeles se muestra para copiarlo a mano
    }
  }

  return (
    <div className="cat-invitar">
      <h2 className="cat-vales__titulo">Invita a un amigo</h2>
      {premio && <p>{premio}</p>}
      <p className="cat-invitar__codigo">
        <small>Tu código</small>
        <strong aria-label={`Tu código de invitación: ${referidos.codigo.split("").join(" ")}`}>{referidos.codigo}</strong>
      </p>
      <div className="rs-acciones">
        <button type="button" className="rs-btn rs-btn--primario" onClick={copiar}>Copiar enlace de invitación</button>
      </div>
      {aviso && <small role="status" className="cat-invitar__aviso">{aviso}</small>}
      {!programaPuntos && <small className="rs-vacio">Para recibir tu premio tienes que participar en el programa de puntos.</small>}
      <small className="rs-vacio">
        Tu amigo debe ser cliente nuevo: usa tu código al crear su cuenta.
        {" "}Llevas {referidos.premiados} {referidos.premiados === 1 ? "amigo premiado" : "amigos premiados"}
        {referidos.cupoRestante <= 0 ? "; ya alcanzaste el máximo de premios." : `; puedes ganar por ${referidos.cupoRestante} más.`}
      </small>
      {referidos.referidos?.length > 0 && (
        <ul className="cat-movimientos">
          {referidos.referidos.map((r, i) => (
            <li key={`${r.nombre}-${i}`} className="rs-tarjeta__fila">
              <span>{r.nombre}</span>
              <span className="rs-vacio">{ESTADO_REFERIDO[r.estado] ?? r.estado}{r.estado === "premiado" && r.puntos > 0 ? ` · +${r.puntos}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
