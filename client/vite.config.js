import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./": los archivos se piden en relativo, así funciona montado en cualquier BASE_PATH.
// En desarrollo, el proxy manda la API al gateway (por defecto http://localhost:3000).
const gateway = process.env.GATEWAY_URL || "http://localhost:3000";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    proxy: {
      "/auth": gateway,
      "/catalogo": gateway,
      "/clientes": gateway,
      "/restaurante/pedidos": gateway,
    },
  },
});
