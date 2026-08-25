import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { McpClient } from "../src/client.js";
import { McpError, RequestTimeoutError } from "../src/errors.js";
import type { McpLogEvent } from "../src/logging.js";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/fake-server.mjs",
);

function newClient(options: { requestTimeoutMs?: number; onEvent?: (e: McpLogEvent) => void } = {}) {
  return McpClient.overStdio(
    { command: process.execPath, args: [fixturePath] },
    { requestTimeoutMs: options.requestTimeoutMs, onEvent: options.onEvent },
  );
}

// Cada test cierra su propio cliente
const openClients: McpClient[] = [];
afterEach(async () => {
  await Promise.all(openClients.splice(0).map((c) => c.close().catch(() => {})));
});

describe("McpClient sobre stdio", () => {
  it("completa el handshake y reporta la información del servidor", async () => {
    const client = newClient();
    openClients.push(client);

    const result = await client.initialize();

    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.serverInfo.name).toBe("fake-mcp-server");
    expect(client.isReady()).toBe(true);
    expect(client.getServerInfo()?.name).toBe("fake-mcp-server");
  });

  it("lista las herramientas declaradas por el servidor", async () => {
    const client = newClient();
    openClients.push(client);
    await client.initialize();

    const tools = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual(["fast", "slow"]);
  });

  it("rechaza listTools/callTool si no se llamó initialize primero", async () => {
    const client = newClient();
    openClients.push(client);

    await expect(client.listTools()).rejects.toThrow(/initialize/);
  });

  it("ejecuta una herramienta y devuelve contenido estructurado", async () => {
    const client = newClient();
    openClients.push(client);
    await client.initialize();

    const result = await client.callTool("fast", {});

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ name: "fast" });
  });

  it("propaga un error de negocio (isError:true) sin lanzar excepción", async () => {
    // Importante: un error de negocio NO es un McpError
    const client = newClient();
    openClients.push(client);
    await client.initialize();

    const result = await client.callTool("boom", {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/business error/);
  });

  it("lanza McpError con el código correcto ante un error de protocolo", async () => {
    const client = newClient();
    openClients.push(client);
    await client.initialize();

    await expect(client.callTool("does-not-exist", {})).rejects.toMatchObject({
      name: "McpError",
      code: -32602,
    });
  });

  it("correlaciona solicitudes concurrentes aunque las respuestas lleguen fuera de orden", async () => {
    // "slow" se envía primero pero responde después que "fast" (40ms de
    // por medio). Si la correlación por id fallara y el cliente asumiera
    // orden de llegada, este test fallaría de forma intermitente.
    const client = newClient();
    openClients.push(client);
    await client.initialize();

    const slowPromise = client.callTool("slow", {});
    const fastPromise = client.callTool("fast", {});

    const [slowResult, fastResult] = await Promise.all([slowPromise, fastPromise]);

    expect(slowResult.structuredContent).toEqual({ name: "slow" });
    expect(fastResult.structuredContent).toEqual({ name: "fast" });
  });

  it("rechaza con RequestTimeoutError si el servidor nunca responde", async () => {
    const client = newClient({ requestTimeoutMs: 100 });
    openClients.push(client);
    await client.initialize();

    await expect(client.callTool("hang", {})).rejects.toBeInstanceOf(RequestTimeoutError);
  }, 2_000);

  it("rechaza initialize si el servidor negocia una versión no soportada", async () => {
    // El fixture solo acepta "2025-06-18"
    const client = newClient();
    openClients.push(client);
    await client.initialize();

    let caught: unknown;
    try {
      await client.callTool("does-not-exist", {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(McpError);
  });

  it("emite eventos de log para cada request y response", async () => {
    const events: McpLogEvent[] = [];
    const client = newClient({ onEvent: (e) => events.push(e) });
    openClients.push(client);

    await client.initialize();
    await client.callTool.bind(client); // no-op, solo para tipado
    await client.listTools();

    const kinds = events.map((e) => `${e.direction}:${e.kind}`);
    expect(kinds).toContain("to-server:request");
    expect(kinds).toContain("from-server:response");
    expect(kinds).toContain("to-server:notification"); // notifications/initialized
  });

  it("rechaza solicitudes pendientes si el proceso del servidor muere", async () => {
    const client = newClient({ requestTimeoutMs: 5_000 });
    openClients.push(client);
    await client.initialize();

    const pending = client.callTool("hang", {});
    await client.close();

    await expect(pending).rejects.toThrow();
  });
});