import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// El frontend vive en client/ y se compila a dist-client/, que es lo que sirve el backend
// en producción. En desarrollo, Vite sirve el frontend y redirige /api al backend, para
// tener recarga en caliente sin duplicar configuración.
export default defineConfig({
  root: "client",
  build: { outDir: "../dist-client", emptyOutDir: true },
  server: {
    port: 5174,
    proxy: {
      "/api": { target: "http://127.0.0.1:5173", changeOrigin: true },
    },
  },
});
