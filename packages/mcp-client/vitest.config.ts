import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Los tests spawean subprocesos reales (fake-server.mjs); un timeout
    // generoso evita falsos negativos en máquinas/CI runners lentos.
    testTimeout: 10_000,
  },
});