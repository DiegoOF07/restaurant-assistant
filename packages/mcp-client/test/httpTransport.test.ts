import { describe, it, expect } from "vitest";
import { HttpTransport } from "../src/httpTransport.js";
import { McpClient } from "../src/client.js";

/** Servidor HTTP falso: registra las peticiones y responde lo que se le programe. */
function fakeServer(
  responder: (request: { body: unknown; headers: Record<string, string>; method: string }) => {
    status?: number;
    body?: string;
    headers?: Record<string, string>;
  },
) {
  const requests: Array<{ body: any; headers: Record<string, string>; method: string }> = [];

  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    requests.push({ body, headers, method });

    const reply = responder({ body, headers, method });
    return new Response(reply.body ?? "", {
      status: reply.status ?? 200,
      headers: reply.headers ?? {},
    });
  }) as unknown as typeof fetch;

  return { requests, fetchImpl };
}

const INIT_RESULT = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  result: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    serverInfo: { name: "remoto", version: "1" },
  },
});

describe("HttpTransport", () => {
  it("envía POST con el Content-Type y el Accept que espera la especificación", async () => {
    const { requests, fetchImpl } = fakeServer(() => ({ body: INIT_RESULT }));
    const transport = new HttpTransport({ url: "https://ejemplo.com/mcp", fetchImpl });

    transport.send('{"jsonrpc":"2.0","id":1,"method":"ping"}');
    await vi_flush();

    expect(requests[0]!.method).toBe("POST");
    expect(requests[0]!.headers["Content-Type"]).toBe("application/json");
    expect(requests[0]!.headers["Accept"]).toContain("application/json");
    expect(requests[0]!.headers["Accept"]).toContain("text/event-stream");
  });

  it("incluye las cabeceras propias, que es donde va el token", async () => {
    const { requests, fetchImpl } = fakeServer(() => ({ body: INIT_RESULT }));
    const transport = new HttpTransport({
      url: "https://ejemplo.com/mcp",
      headers: { Authorization: "Bearer secreto" },
      fetchImpl,
    });

    transport.send('{"jsonrpc":"2.0","id":1,"method":"ping"}');
    await vi_flush();

    expect(requests[0]!.headers["Authorization"]).toBe("Bearer secreto");
  });

  it("captura Mcp-Session-Id y lo reenvía en las peticiones siguientes", async () => {
    const { requests, fetchImpl } = fakeServer(() => ({
      body: INIT_RESULT,
      headers: { "Mcp-Session-Id": "sesion-abc" },
    }));
    const transport = new HttpTransport({ url: "https://ejemplo.com/mcp", fetchImpl });

    transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize"}');
    await vi_flush();
    expect(transport.getSessionId()).toBe("sesion-abc");

    transport.send('{"jsonrpc":"2.0","id":2,"method":"tools/list"}');
    await vi_flush();

    // La primera petición no puede llevarla; la segunda sí.
    expect(requests[0]!.headers["Mcp-Session-Id"]).toBeUndefined();
    expect(requests[1]!.headers["Mcp-Session-Id"]).toBe("sesion-abc");
  });

  it("manda MCP-Protocol-Version con la versión negociada", async () => {
    const { requests, fetchImpl } = fakeServer(() => ({ body: INIT_RESULT }));
    const transport = new HttpTransport({ url: "https://ejemplo.com/mcp", fetchImpl });

    transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize"}');
    await vi_flush();
    transport.send('{"jsonrpc":"2.0","id":2,"method":"tools/list"}');
    await vi_flush();

    expect(requests[1]!.headers["MCP-Protocol-Version"]).toBe("2025-06-18");
  });

  it("entrega la respuesta al handler, igual que haría stdio", async () => {
    const { fetchImpl } = fakeServer(() => ({ body: INIT_RESULT }));
    const transport = new HttpTransport({ url: "https://ejemplo.com/mcp", fetchImpl });

    const received: string[] = [];
    transport.onMessage((raw) => received.push(raw));

    transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize"}');
    await vi_flush();

    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0]!).result.protocolVersion).toBe("2025-06-18");
  });

  it("no entrega nada ante un 202: una notificación no lleva respuesta", async () => {
    const { fetchImpl } = fakeServer(() => ({ status: 202 }));
    const transport = new HttpTransport({ url: "https://ejemplo.com/mcp", fetchImpl });

    const received: string[] = [];
    transport.onMessage((raw) => received.push(raw));

    transport.send('{"jsonrpc":"2.0","method":"notifications/initialized"}');
    await vi_flush();

    expect(received).toHaveLength(0);
  });

  // Sin esto, un servidor caído dejaría la promesa esperando hasta el timeout y el usuario
  // vería "tiempo agotado" en vez del motivo real.
  it("convierte un fallo de red en un error JSON-RPC dirigido al id que se envió", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const transport = new HttpTransport({ url: "https://ejemplo.com/mcp", fetchImpl });

    const received: string[] = [];
    transport.onMessage((raw) => received.push(raw));

    transport.send('{"jsonrpc":"2.0","id":42,"method":"ping"}');
    await vi_flush();

    expect(received).toHaveLength(1);
    const parsed = JSON.parse(received[0]!);
    expect(parsed.id).toBe(42); // llega a quien lo estaba esperando
    expect(parsed.error.message).toContain("ECONNREFUSED");
  });

  it("explica un 401 en vez de devolver el código a secas", async () => {
    const { fetchImpl } = fakeServer(() => ({ status: 401, body: "token inválido" }));
    const transport = new HttpTransport({ url: "https://ejemplo.com/mcp", fetchImpl });

    const received: string[] = [];
    transport.onMessage((raw) => received.push(raw));

    transport.send('{"jsonrpc":"2.0","id":1,"method":"ping"}');
    await vi_flush();

    const parsed = JSON.parse(received[0]!);
    expect(parsed.error.message).toContain("401");
    expect(parsed.error.message).toContain("token");
  });

  it("olvida la sesión ante un 404, para poder volver a inicializar", async () => {
    let first = true;
    const { fetchImpl } = fakeServer(() => {
      if (first) {
        first = false;
        return { body: INIT_RESULT, headers: { "Mcp-Session-Id": "vieja" } };
      }
      return { status: 404, body: "sesión desconocida" };
    });
    const transport = new HttpTransport({ url: "https://ejemplo.com/mcp", fetchImpl });

    transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize"}');
    await vi_flush();
    expect(transport.getSessionId()).toBe("vieja");

    transport.send('{"jsonrpc":"2.0","id":2,"method":"tools/list"}');
    await vi_flush();
    expect(transport.getSessionId()).toBeUndefined();
  });

  it("manda DELETE al cerrar, para liberar la sesión en el servidor", async () => {
    const { requests, fetchImpl } = fakeServer(() => ({
      body: INIT_RESULT,
      headers: { "Mcp-Session-Id": "sesion-abc" },
    }));
    const transport = new HttpTransport({ url: "https://ejemplo.com/mcp", fetchImpl });

    transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize"}');
    await vi_flush();
    await transport.close();

    const last = requests[requests.length - 1]!;
    expect(last.method).toBe("DELETE");
    expect(last.headers["Mcp-Session-Id"]).toBe("sesion-abc");
  });

  it("rechaza enviar después de cerrar", async () => {
    const { fetchImpl } = fakeServer(() => ({ body: INIT_RESULT }));
    const transport = new HttpTransport({ url: "https://ejemplo.com/mcp", fetchImpl });

    await transport.close();
    expect(() => transport.send('{"jsonrpc":"2.0","id":1,"method":"ping"}')).toThrow(/cerrado/);
  });
});

// El objetivo de tener una interfaz Transport es este: McpClient no debería notar la
// diferencia entre hablar por stdio y hablar por HTTP.
describe("McpClient sobre HTTP", () => {
  it("completa el handshake y lista herramientas sin cambios en McpClient", async () => {
    const { requests, fetchImpl } = fakeServer(({ body }) => {
      if (body?.method === "initialize") {
        return { body: JSON.stringify({ ...JSON.parse(INIT_RESULT), id: body.id }), headers: { "Mcp-Session-Id": "s1" } };
      }
      if (body?.method === "tools/list") {
        return {
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { tools: [{ name: "remota", description: "d", inputSchema: {} }] },
          }),
        };
      }
      return { status: 202 };
    });

    const client = McpClient.overHttp({ url: "https://ejemplo.com/mcp", fetchImpl });

    const result = await client.initialize();
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(client.isReady()).toBe(true);

    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["remota"]);

    // El handshake completo: initialize, la notificación, y tools/list.
    expect(requests.map((r) => r.body?.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
    ]);
  });

  it("corta la conexión si el servidor remoto ofrece una versión que no hablamos", async () => {
    const { fetchImpl } = fakeServer(({ body }) => ({
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { protocolVersion: "1999-01-01", capabilities: {}, serverInfo: { name: "x", version: "1" } },
      }),
    }));

    const client = McpClient.overHttp({ url: "https://ejemplo.com/mcp", fetchImpl });
    await expect(client.initialize()).rejects.toThrow(/1999-01-01/);
  });
});

/** Deja correr las promesas pendientes: send() lanza la petición sin esperarla. */
async function vi_flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
