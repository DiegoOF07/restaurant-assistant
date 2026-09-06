import { describe, it, expect } from "vitest";
import { loadConfig, ConfigError } from "../src/config.js";

describe("loadConfig", () => {
  it("aplica los valores por defecto con un entorno vacío", () => {
    const config = loadConfig({});
    expect(config.maxIterations).toBe(8);
    // El rol menos privilegiado por defecto: el servidor deniega adjust_inventory.
    expect(config.userRole).toBe("waiter");
    expect(config.userId).toBe("unspecified");
    expect(config.anthropicApiKey).toBeUndefined();
  });

  it("lanza ConfigError si HOST_MAX_ITERATIONS no es un entero positivo", () => {
    expect(() => loadConfig({ HOST_MAX_ITERATIONS: "no-es-un-numero" })).toThrow(ConfigError);
    expect(() => loadConfig({ HOST_MAX_ITERATIONS: "-3" })).toThrow(ConfigError);
    expect(() => loadConfig({ HOST_MAX_ITERATIONS: "0" })).toThrow(ConfigError);
  });

  it("respeta HOST_MAX_ITERATIONS cuando es válido", () => {
    expect(loadConfig({ HOST_MAX_ITERATIONS: "3" }).maxIterations).toBe(3);
  });

  it("transporta el rol y el usuario, recortando espacios", () => {
    const config = loadConfig({ MCP_USER_ROLE: "  cook  ", MCP_USER_ID: " diego " });
    expect(config.userRole).toBe("cook");
    expect(config.userId).toBe("diego");
  });

  it("no valida el rol: eso le toca al servidor", () => {
    // El CLI es código cliente; si validara acá, un cliente modificado se saltaría el control.
    expect(loadConfig({ MCP_USER_ROLE: "gerente-supremo" }).userRole).toBe("gerente-supremo");
  });

  it("toma la API key y el modelo del entorno cuando están presentes", () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: " sk-ant-xyz ", ANTHROPIC_MODEL: " claude-haiku-4-5 " });
    expect(config.anthropicApiKey).toBe("sk-ant-xyz");
    expect(config.anthropicModel).toBe("claude-haiku-4-5");
  });

  it("ignora una API key vacía en vez de intentar usarla", () => {
    expect(loadConfig({ ANTHROPIC_API_KEY: "   " }).anthropicApiKey).toBeUndefined();
  });
});
