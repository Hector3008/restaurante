import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";

// base "./": los archivos se piden en relativo, así funciona montado en cualquier BASE_PATH.
// En desarrollo, el proxy manda la API al gateway (por defecto http://localhost:3000).
// La carta pública en desarrollo: http://localhost:5173/catalogo.html?empresa=<slug>
const gateway = process.env.GATEWAY_URL || "http://localhost:3000";

export default defineConfig({
  base: "./",
  plugins: [react()],
  // Dos páginas: el front del personal (index.html) y la carta pública (catalogo.html, sin sesión).
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        catalogo: fileURLToPath(new URL("./catalogo.html", import.meta.url)),
      },
    },
  },
  server: {
    proxy: {
      "/auth": gateway,
      "/catalogo": gateway,
      "/clientes": gateway,
      "/restaurante/pedidos": gateway,
      "/restaurante/publico": gateway,
    },
  },
});
