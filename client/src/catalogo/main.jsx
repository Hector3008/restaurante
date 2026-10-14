import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Catalogo from "./Catalogo.jsx";
import "../estilos.css";
import "./catalogo.css";

createRoot(document.getElementById("raiz")).render(
  <StrictMode>
    <Catalogo />
  </StrictMode>
);
