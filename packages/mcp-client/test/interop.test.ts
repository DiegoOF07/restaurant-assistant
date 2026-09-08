import { describe, it, expect } from "vitest";
import { McpClient } from "../src/client.js";
import type { Transport } from "../src/transport.js";

/**
 * Casos que la especificación de MCP permite y que un servidor ajeno sí produce.
 * Cada uno rompía el cliente antes de existir esta prueba.
 */

/** Transport falso que responde según el método pedido. */
function scriptedTransport(reply: (method: string, params: any, id: unknown) => unknown) {
  const sent: Array<{ method: string; params: any }> = [];
  let onMessage: (raw: string) => void = () => {};
  let onDiagnostic: (line: string) => void = () => {};

  const transport: Transport = {
    send(raw) {
      const msg = JSON.parse(raw);
      if (msg.id === undefined) return; // notificación
      sent.push({ method: msg.method, params: msg.params });
      const result = reply(msg.method, msg.params, msg.id);
      queueMicrotask(() => onMessage(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })));
    },
    onMessage(h) {
      onMessage = h;
    },
    onDiagnostic(h) {
      onDiagnostic = h;
    },
    onClose() {},
    async close() {},
  };

  return { transport, sent, emitDiagnostic: (line: string) => onDiagnostic(line) };
}

const INIT = { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "x", version: "1" } };

describe("interoperabilidad con servidores ajenos", () => {
  it("acepta herramientas sin description, que la especificación no exige", async () => {
    const { transport } = scriptedTransport((method) =>
      method === "initialize" ? INIT : { tools: [{ name: "sin_desc", inputSchema: { type: "object" } }] },
    );

    const client = McpClient.withTransport(transport);
    await client.initialize();
    const tools = await client.listTools();

    expect(tools[0]!.name).toBe("sin_desc");
    expect(tools[0]!.description).toBeUndefined();
  });

  it("recorre las páginas de tools/list en vez de quedarse con la primera", async () => {
    const { transport, sent } = scriptedTransport((method, params) => {
      if (method === "initialize") return INIT;
      if (params?.cursor === "p2") return { tools: [{ name: "b", description: "d", inputSchema: {} }] };
      return { tools: [{ name: "a", description: "d", inputSchema: {} }], nextCursor: "p2" };
    });

    const client = McpClient.withTransport(transport);
    await client.initialize();

    expect((await client.listTools()).map((t) => t.name)).toEqual(["a", "b"]);
    expect(sent.filter((s) => s.method === "tools/list")).toHaveLength(2);
  });

  it("corta si el servidor repite el cursor, para no ciclar indefinidamente", async () => {
    const { transport } = scriptedTransport((method) =>
      method === "initialize" ? INIT : { tools: [{ name: "a", inputSchema: {} }], nextCursor: "siempre-igual" },
    );

    const client = McpClient.withTransport(transport);
    await client.initialize();

    await expect(client.listTools()).rejects.toThrow(/repitió el cursor/);
  });

  it("acepta un servidor que habla la versión anterior del protocolo", async () => {
    const { transport } = scriptedTransport(() => ({ ...INIT, protocolVersion: "2025-03-26" }));

    const client = McpClient.withTransport(transport);
    const result = await client.initialize();

    expect(result.protocolVersion).toBe("2025-03-26");
    expect(client.getNegotiatedVersion()).toBe("2025-03-26");
  });

  it("sigue rechazando una versión que no sabe hablar", async () => {
    const { transport } = scriptedTransport(() => ({ ...INIT, protocolVersion: "1999-01-01" }));

    const client = McpClient.withTransport(transport);
    await expect(client.initialize()).rejects.toThrow(/1999-01-01/);
  });

  it("entrega el stderr del servidor a quien lo pida", async () => {
    const recibidas: string[] = [];
    const { transport, emitDiagnostic } = scriptedTransport(() => INIT);

    McpClient.withTransport(transport, { onDiagnostic: (line) => recibidas.push(line) });
    emitDiagnostic("falta la variable API_KEY");

    expect(recibidas).toEqual(["falta la variable API_KEY"]);
  });

  it("da al handshake más tiempo que a una llamada normal", async () => {
    const { transport } = scriptedTransport(() => INIT);
    const client = McpClient.withTransport(transport, { requestTimeoutMs: 15_000 });

    // El valor por defecto debe superar al de una llamada: `npx` puede tardar en descargar
    // el servidor la primera vez.
    await client.initialize();
    expect(client.isReady()).toBe(true);
  });
});
