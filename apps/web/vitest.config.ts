import { defineConfig } from "vitest/config";

// Las pruebas son del backend: corren en Node y no necesitan el DOM.
export default defineConfig({
  test: { environment: "node", include: ["server/test/**/*.test.ts"] },
});
