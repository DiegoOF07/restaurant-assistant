import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseEnvFile, loadDotEnv } from "../src/dotenv.js";

describe("parseEnvFile", () => {
  it("parsea pares KEY=VALUE simples", () => {
    const result = parseEnvFile("MCP_SERVER_BIN=./bin/server\nHOST_MAX_ITERATIONS=8");
    expect(result).toEqual({ MCP_SERVER_BIN: "./bin/server", HOST_MAX_ITERATIONS: "8" });
  });

  it("ignora líneas en blanco y comentarios", () => {
    const result = parseEnvFile("# comentario\n\nMCP_SERVER_BIN=./bin/server\n# otro comentario\n");
    expect(result).toEqual({ MCP_SERVER_BIN: "./bin/server" });
  });

  it("quita comillas simples o dobles alrededor del valor", () => {
    const result = parseEnvFile(`A="hola mundo"\nB='otro valor'\nC=sin_comillas`);
    expect(result).toEqual({ A: "hola mundo", B: "otro valor", C: "sin_comillas" });
  });

  it("ignora líneas sin signo igual", () => {
    const result = parseEnvFile("esto no es una asignación\nMCP_SERVER_BIN=./bin/server");
    expect(result).toEqual({ MCP_SERVER_BIN: "./bin/server" });
  });

  it("permite valores vacíos", () => {
    const result = parseEnvFile("MCP_SERVER_ARGS=");
    expect(result).toEqual({ MCP_SERVER_ARGS: "" });
  });
});

describe("loadDotEnv", () => {
  const tmpFiles: string[] = [];

  afterEach(() => {
    for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
  });

  function writeTempEnvFile(content: string): string {
    const filePath = path.join(os.tmpdir(), `cli-dotenv-test-${Date.now()}-${Math.random().toString(36).slice(2)}.env`);
    fs.writeFileSync(filePath, content, "utf8");
    tmpFiles.push(filePath);
    return filePath;
  }

  it("carga variables del archivo hacia el entorno dado", () => {
    const filePath = writeTempEnvFile("MCP_SERVER_BIN=./bin/server\n");
    const env: NodeJS.ProcessEnv = {};
    loadDotEnv(filePath, env);
    expect(env.MCP_SERVER_BIN).toBe("./bin/server");
  });

  it("NO sobrescribe una variable que ya existe en el entorno real", () => {
    const filePath = writeTempEnvFile("MCP_SERVER_BIN=./desde-archivo\n");
    const env: NodeJS.ProcessEnv = { MCP_SERVER_BIN: "./desde-shell" };
    loadDotEnv(filePath, env);
    expect(env.MCP_SERVER_BIN).toBe("./desde-shell");
  });

  it("no falla si el archivo no existe (es opcional)", () => {
    const env: NodeJS.ProcessEnv = {};
    expect(() => loadDotEnv("/ruta/que/no/existe/.env", env)).not.toThrow();
    expect(env.MCP_SERVER_BIN).toBeUndefined();
  });
});