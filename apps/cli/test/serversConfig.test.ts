import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ConfigError } from "../src/config.js";
import { resolveServers, DEFAULT_CONFIG_FILENAME } from "../src/serversConfig.js";

let baseDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-cli-"));
});

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

/** Crea un archivo ejecutable de mentira para que pase la verificación del binario. */
function fakeBinary(name = "servidor"): string {
  const filePath = path.join(baseDir, name);
  fs.writeFileSync(filePath, "#!/bin/sh\necho fake\n", { mode: 0o755 });
  return filePath;
}

function writeConfig(content: unknown, filename = DEFAULT_CONFIG_FILENAME): string {
  const filePath = path.join(baseDir, filename);
  fs.writeFileSync(filePath, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  return filePath;
}

describe("resolveServers desde el archivo", () => {
  it("lee la lista y resuelve las rutas respecto al archivo, no al directorio de trabajo", () => {
    fakeBinary();
    writeConfig({ servers: [{ name: "restaurant-local", command: "./servidor" }] });

    const resolved = resolveServers({ baseDir, env: {} });

    expect(resolved.source).toBe("file");
    expect(resolved.servers).toHaveLength(1);
    expect(resolved.servers[0]!.command).toBe(path.join(baseDir, "servidor"));
  });

  it("deja intactos los comandos sin ruta para que los busque el PATH", () => {
    writeConfig({ servers: [{ name: "fs", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] }] });

    const resolved = resolveServers({ baseDir, env: {} });

    expect(resolved.servers[0]!.command).toBe("npx");
    expect(resolved.servers[0]!.args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]);
  });

  it("acepta también la forma de objeto por nombre que usan otros clientes MCP", () => {
    writeConfig({ servers: { git: { command: "uvx", args: ["mcp-server-git"] } } });

    const resolved = resolveServers({ baseDir, env: {} });

    expect(resolved.servers).toHaveLength(1);
    expect(resolved.servers[0]!.name).toBe("git");
  });

  it("omite los servidores con enabled:false pero los reporta", () => {
    writeConfig({
      servers: [
        { name: "activo", command: "npx" },
        { name: "apagado", command: "npx", enabled: false },
      ],
    });

    const resolved = resolveServers({ baseDir, env: {} });

    expect(resolved.servers.map((s) => s.name)).toEqual(["activo"]);
    expect(resolved.disabled).toEqual(["apagado"]);
  });

  it("inyecta la identidad en todo servidor, dejando que el archivo la sobrescriba", () => {
    writeConfig({
      servers: [
        { name: "a", command: "npx" },
        { name: "b", command: "npx", env: { MCP_USER_ROLE: "waiter", OTRA: "1" } },
      ],
    });

    const resolved = resolveServers({
      baseDir,
      env: {},
      defaultEnv: { MCP_USER_ROLE: "admin", MCP_USER_ID: "diego" },
    });

    expect(resolved.servers[0]!.env).toEqual({ MCP_USER_ROLE: "admin", MCP_USER_ID: "diego" });
    expect(resolved.servers[1]!.env).toEqual({ MCP_USER_ROLE: "waiter", MCP_USER_ID: "diego", OTRA: "1" });
  });

  it("sustituye ${VAR} por el valor del entorno para no escribir secretos en el archivo", () => {
    process.env.TOKEN_DE_PRUEBA = "secreto-123";
    try {
      writeConfig({ servers: [{ name: "a", command: "npx", env: { API_TOKEN: "${TOKEN_DE_PRUEBA}" } }] });
      const resolved = resolveServers({ baseDir, env: {} });
      expect(resolved.servers[0]!.env!.API_TOKEN).toBe("secreto-123");
    } finally {
      delete process.env.TOKEN_DE_PRUEBA;
    }
  });

  it("falla si se referencia una variable que no existe, en vez de pasar el texto crudo", () => {
    writeConfig({ servers: [{ name: "a", command: "npx", env: { API_TOKEN: "${NO_DEFINIDA_JAMAS}" } }] });
    expect(() => resolveServers({ baseDir, env: {} })).toThrow(/NO_DEFINIDA_JAMAS/);
  });
});

describe("resolveServers: validación", () => {
  it("rechaza JSON malformado mencionando el archivo", () => {
    writeConfig("{ esto no es json }");
    expect(() => resolveServers({ baseDir, env: {} })).toThrow(ConfigError);
    expect(() => resolveServers({ baseDir, env: {} })).toThrow(/no es JSON válido/);
  });

  it("rechaza un archivo sin la clave servers y muestra un ejemplo", () => {
    writeConfig({ otraCosa: [] });
    expect(() => resolveServers({ baseDir, env: {} })).toThrow(/falta la clave "servers"/);
  });

  it("rechaza una entrada sin command", () => {
    writeConfig({ servers: [{ name: "a" }] });
    expect(() => resolveServers({ baseDir, env: {} })).toThrow(/falta "command"/);
  });

  it("rechaza una entrada sin name", () => {
    writeConfig({ servers: [{ command: "npx" }] });
    expect(() => resolveServers({ baseDir, env: {} })).toThrow(/falta "name"/);
  });

  it("rechaza args que no sean un arreglo de textos", () => {
    writeConfig({ servers: [{ name: "a", command: "npx", args: "no-soy-arreglo" }] });
    expect(() => resolveServers({ baseDir, env: {} })).toThrow(/"args" debe ser un arreglo/);
  });

  it("rechaza nombres duplicados porque identifican al servidor en el log", () => {
    writeConfig({
      servers: [
        { name: "repetido", command: "npx" },
        { name: "repetido", command: "uvx" },
      ],
    });
    expect(() => resolveServers({ baseDir, env: {} })).toThrow(/ya hay otro servidor llamado/);
  });

  it("rechaza un archivo donde todos los servidores están apagados", () => {
    writeConfig({ servers: [{ name: "a", command: "npx", enabled: false }] });
    expect(() => resolveServers({ baseDir, env: {} })).toThrow(/no habilita ningún servidor/);
  });

  it("detecta un binario inexistente antes de intentar lanzarlo", () => {
    writeConfig({ servers: [{ name: "roto", command: "./no-existe" }] });
    try {
      resolveServers({ baseDir, env: {} });
      expect.fail("debería haber lanzado ConfigError");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("roto"); // dice CUÁL servidor falló
      expect(message).toContain(baseDir); // y respecto a qué directorio se resolvió
      expect(message).toMatch(/go build/);
      expect(message).toMatch(new RegExp(process.platform));
    }
  });

  it("detecta un archivo existente sin permiso de ejecución (POSIX)", () => {
    if (process.platform === "win32") return;

    const filePath = path.join(baseDir, "sin-permisos");
    fs.writeFileSync(filePath, "no soy ejecutable", { mode: 0o644 });
    writeConfig({ servers: [{ name: "a", command: "./sin-permisos" }] });

    expect(() => resolveServers({ baseDir, env: {} })).toThrow(/chmod \+x/);
  });
});

describe("resolveServers: precedencia de fuentes", () => {
  it("una ruta explícita que no existe es un error, no un fallback silencioso", () => {
    // Si cayera al archivo por defecto o a MCP_SERVER_BIN, el usuario creería que su
    // --config se aplicó cuando en realidad se ignoró.
    expect(() =>
      resolveServers({ baseDir, env: {}, configPath: "./no-existe.json" }),
    ).toThrow(/no se busca otra fuente/);
  });

  it("MCP_CONFIG_FILE tiene prioridad sobre el archivo por defecto", () => {
    writeConfig({ servers: [{ name: "por-defecto", command: "npx" }] });
    writeConfig({ servers: [{ name: "elegido", command: "npx" }] }, "otro.json");

    const resolved = resolveServers({ baseDir, env: { MCP_CONFIG_FILE: "otro.json" } });
    expect(resolved.servers[0]!.name).toBe("elegido");
  });

  it("cae a MCP_SERVER_BIN cuando no hay archivo, para no romper lo que ya funcionaba", () => {
    const bin = fakeBinary();

    const resolved = resolveServers({ baseDir, env: { MCP_SERVER_BIN: bin, MCP_SERVER_ARGS: "--a --b" } });

    expect(resolved.source).toBe("env");
    expect(resolved.servers).toHaveLength(1);
    expect(resolved.servers[0]!.name).toBe("restaurant-local");
    expect(resolved.servers[0]!.args).toEqual(["--a", "--b"]);
  });

  it("el archivo por defecto gana sobre MCP_SERVER_BIN", () => {
    fakeBinary();
    writeConfig({ servers: [{ name: "desde-archivo", command: "npx" }] });

    const resolved = resolveServers({ baseDir, env: { MCP_SERVER_BIN: "./servidor" } });
    expect(resolved.source).toBe("file");
    expect(resolved.servers[0]!.name).toBe("desde-archivo");
  });

  it("sin ninguna fuente, el error explica las tres que se buscaron", () => {
    try {
      resolveServers({ baseDir, env: {} });
      expect.fail("debería haber lanzado ConfigError");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/MCP_CONFIG_FILE/);
      expect(message).toContain(DEFAULT_CONFIG_FILENAME);
      expect(message).toMatch(/MCP_SERVER_BIN/);
    }
  });
});

describe("resolveServers: servidores remotos", () => {
  it("acepta una entrada con url y no le inyecta la identidad", () => {
    writeConfig({
      servers: [{ name: "remoto", url: "https://mi-servidor.com/mcp", headers: { Authorization: "Bearer x" } }],
    });

    const resolved = resolveServers({
      baseDir,
      env: {},
      defaultEnv: { MCP_USER_ROLE: "admin", MCP_USER_ID: "diego" },
    });

    expect(resolved.servers[0]!.url).toBe("https://mi-servidor.com/mcp");
    expect(resolved.servers[0]!.headers).toEqual({ Authorization: "Bearer x" });
    // Por HTTP el rol lo decide el token en el servidor, no el cliente. Mandar env acá
    // daría la falsa impresión de que sirve para algo.
    expect(resolved.servers[0]!.env).toBeUndefined();
    expect(resolved.servers[0]!.command).toBeUndefined();
  });

  it("sustituye ${VAR} también en las cabeceras, para no escribir el token en el archivo", () => {
    process.env.TOKEN_REMOTO = "abc123";
    try {
      writeConfig({
        servers: [{ name: "remoto", url: "https://x.com/mcp", headers: { Authorization: "Bearer ${TOKEN_REMOTO}" } }],
      });
      const resolved = resolveServers({ baseDir, env: {} });
      expect(resolved.servers[0]!.headers!.Authorization).toBe("Bearer abc123");
    } finally {
      delete process.env.TOKEN_REMOTO;
    }
  });

  it("rechaza una entrada con command y url a la vez", () => {
    writeConfig({ servers: [{ name: "confuso", command: "npx", url: "https://x.com/mcp" }] });
    expect(() => resolveServers({ baseDir, env: {} })).toThrow(/excluyentes/);
  });

  it("rechaza una entrada sin command ni url", () => {
    writeConfig({ servers: [{ name: "vacio" }] });
    expect(() => resolveServers({ baseDir, env: {} })).toThrow(/falta "command".*o "url"/s);
  });

  it("rechaza una url malformada antes de intentar hablarle", () => {
    writeConfig({ servers: [{ name: "roto", url: "no-es-una-url" }] });
    expect(() => resolveServers({ baseDir, env: {} })).toThrow(/no es válida/);
  });

  it("rechaza esquemas que no sean http o https", () => {
    writeConfig({ servers: [{ name: "raro", url: "ftp://x.com/mcp" }] });
    expect(() => resolveServers({ baseDir, env: {} })).toThrow(/sólo se admiten http y https/);
  });

  it("rechaza args o env en un servidor remoto, porque no aplican", () => {
    writeConfig({ servers: [{ name: "remoto", url: "https://x.com/mcp", args: ["--algo"] }] });
    expect(() => resolveServers({ baseDir, env: {} })).toThrow(/sólo aplican a servidores locales/);
  });

  it("rechaza headers en un servidor local, porque no aplican", () => {
    writeConfig({ servers: [{ name: "local", command: "npx", headers: { A: "b" } }] });
    expect(() => resolveServers({ baseDir, env: {} })).toThrow(/sólo aplica a servidores remotos/);
  });

  it("permite mezclar un servidor local y uno remoto", () => {
    fakeBinary();
    writeConfig({
      servers: [
        { name: "local", command: "./servidor" },
        { name: "remoto", url: "https://x.com/mcp" },
      ],
    });

    const resolved = resolveServers({ baseDir, env: {} });
    expect(resolved.servers).toHaveLength(2);
    expect(resolved.servers[0]!.command).toBeDefined();
    expect(resolved.servers[1]!.url).toBeDefined();
  });
});
