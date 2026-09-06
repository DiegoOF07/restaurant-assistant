import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadConfig, ConfigError } from "../src/config.js";

const tmpFiles: string[] = [];
afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

function createFakeExecutable(): string {
  const filePath = path.join(os.tmpdir(), `fake-mcp-server-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(filePath, "#!/bin/sh\necho fake\n", { mode: 0o755 });
  tmpFiles.push(filePath);
  return filePath;
}

describe("loadConfig", () => {
  it("lanza ConfigError si falta MCP_SERVER_BIN, mencionando .env como alternativa", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    try {
      loadConfig({});
    } catch (err) {
      expect((err as Error).message).toMatch(/MCP_SERVER_BIN/);
      expect((err as Error).message).toMatch(/\.env/);
    }
  });

  it("lanza ConfigError con la ruta absoluta resuelta si el binario no existe", () => {
    try {
      loadConfig({ MCP_SERVER_BIN: "./no/existe/en/ningun/lado" });
      expect.fail("debería haber lanzado ConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const message = (err as Error).message;
      expect(message).toMatch(/no\/existe\/en\/ningun\/lado/);
      expect(message).toContain(process.cwd()); // menciona respecto a qué directorio se resolvió
    }
  });

  it("el mensaje de error para binario ausente da instrucciones específicas del sistema operativo actual", () => {
    try {
      loadConfig({ MCP_SERVER_BIN: "./no/existe" });
      expect.fail("debería haber lanzado ConfigError");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/go build/);
      expect(message).toMatch(new RegExp(process.platform));
    }
  });

  it("acepta un binario existente y devuelve su ruta absoluta resuelta", () => {
    // Este test solo aplica en plataformas POSIX (usa chmod +x); en
    // Windows el bit de ejecución no existe y config.ts lo omite.
    if (process.platform === "win32") return;

    const fakeBin = createFakeExecutable();
    const config = loadConfig({ MCP_SERVER_BIN: fakeBin });

    expect(config.mcpServerBin).toBe(path.resolve(fakeBin));
    expect(config.maxIterations).toBe(8); // default
    expect(config.mcpServerArgs).toEqual([]);
  });

  it("lanza ConfigError si el archivo existe pero no es ejecutable (POSIX)", () => {
    if (process.platform === "win32") return;

    const filePath = path.join(os.tmpdir(), `not-executable-${Date.now()}.txt`);
    fs.writeFileSync(filePath, "no soy ejecutable", { mode: 0o644 });
    tmpFiles.push(filePath);

    expect(() => loadConfig({ MCP_SERVER_BIN: filePath })).toThrow(/permisos de ejecución/);
  });

  it("parsea MCP_SERVER_ARGS separados por espacio", () => {
    if (process.platform === "win32") return;
    const fakeBin = createFakeExecutable();
    const config = loadConfig({ MCP_SERVER_BIN: fakeBin, MCP_SERVER_ARGS: "--mode stdio --verbose" });
    expect(config.mcpServerArgs).toEqual(["--mode", "stdio", "--verbose"]);
  });

  it("lanza ConfigError si HOST_MAX_ITERATIONS no es un entero positivo", () => {
    if (process.platform === "win32") return;
    const fakeBin = createFakeExecutable();
    expect(() => loadConfig({ MCP_SERVER_BIN: fakeBin, HOST_MAX_ITERATIONS: "no-es-un-numero" })).toThrow(ConfigError);
    expect(() => loadConfig({ MCP_SERVER_BIN: fakeBin, HOST_MAX_ITERATIONS: "-3" })).toThrow(ConfigError);
  });

  it("respeta HOST_MAX_ITERATIONS cuando es válido", () => {
    if (process.platform === "win32") return;
    const fakeBin = createFakeExecutable();
    const config = loadConfig({ MCP_SERVER_BIN: fakeBin, HOST_MAX_ITERATIONS: "3" });
    expect(config.maxIterations).toBe(3);
  });
});