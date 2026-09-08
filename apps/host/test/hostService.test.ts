import { describe, it, expect, afterEach, vi } from "vitest";
import { MockProvider } from "@restaurant/llm-provider";
import type { ToolExecutionResult, ToolRunner } from "@restaurant/conversation";
import type { ToolSpec } from "@restaurant/llm-provider";

import { McpClient } from "@restaurant/mcp-client";

import { HostService } from "../src/hostService.js";

class FakeToolRunner implements ToolRunner {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  constructor(
    private readonly tools: ToolSpec[],
    private readonly handlers: Record<string, (args: Record<string, unknown>) => ToolExecutionResult>,
  ) {}
  async listTools(): Promise<ToolSpec[]> {
    return this.tools;
  }
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    this.calls.push({ name, args });
    const handler = this.handlers[name];
    if (!handler) throw new Error(`unknown tool: ${name}`);
    return handler(args);
  }
}

const AVAILABILITY_TOOL: ToolSpec = { name: "get_dish_availability", description: "test", inputSchema: { type: "object" } };

const openHosts: HostService[] = [];
afterEach(async () => {
  await Promise.all(openHosts.splice(0).map((h) => h.close().catch(() => {})));
});

describe("HostService", () => {
  it("orquesta un turno completo con tool-calling de punta a punta", async () => {
    const provider = new MockProvider();
    provider.enqueueToolCall([
      { id: "call-1", name: "get_dish_availability", arguments: { dishId: "special-burger", servings: 2 } },
    ]);
    provider.enqueueText("Solo alcanza para 1 porción.");

    const toolRunner = new FakeToolRunner([AVAILABILITY_TOOL], {
      get_dish_availability: () => ({
        content: [{ type: "text", text: "1 serving" }],
        structuredContent: { maximumServings: 1 },
      }),
    });

    const host = new HostService({ provider, toolRunner });
    openHosts.push(host);

    const result = await host.sendMessage("session-1", "¿alcanza para 2 hamburguesas?");

    expect(result.reply).toBe("Solo alcanza para 1 porción.");
    expect(toolRunner.calls).toHaveLength(1);
  });

  it("mantiene el historial y el log aislados entre sesiones distintas", async () => {
    const provider = new MockProvider();
    provider.enqueueText("respuesta 1");
    provider.enqueueText("respuesta 2");

    const toolRunner = new FakeToolRunner([], {});
    const host = new HostService({ provider, toolRunner });
    openHosts.push(host);

    await host.sendMessage("session-a", "hola desde A");
    await host.sendMessage("session-b", "hola desde B");

    expect(host.hasSession("session-a")).toBe(true);
    expect(host.hasSession("session-b")).toBe(true);
    expect(host.hasSession("session-c")).toBe(false); // no se crea hasta que se use
  });

  it("registra en el log de la sesión correcta los eventos del ciclo de conversación", async () => {
    const provider = new MockProvider();
    provider.enqueueToolCall([{ id: "call-1", name: "get_dish_availability", arguments: {} }]);
    provider.enqueueText("listo");

    const toolRunner = new FakeToolRunner([AVAILABILITY_TOOL], {
      get_dish_availability: () => ({ content: [{ type: "text", text: "ok" }] }),
    });
    const host = new HostService({ provider, toolRunner });
    openHosts.push(host);

    await host.sendMessage("session-1", "hola");

    const log = host.getLog("session-1");
    expect(log.map((e) => e.kind)).toEqual(["tool_call_requested", "tool_call_result"]);
    expect(host.getLog("session-other")).toHaveLength(0);
  });

  it("listAvailableTools() expone las herramientas del toolRunner configurado", async () => {
    const provider = new MockProvider();
    const toolRunner = new FakeToolRunner([AVAILABILITY_TOOL], {});
    const host = new HostService({ provider, toolRunner });
    openHosts.push(host);

    const tools = await host.listAvailableTools();
    expect(tools.map((t) => t.name)).toEqual(["get_dish_availability"]);
  });

  it("respeta la confirmación requerida para herramientas sensibles", async () => {
    const provider = new MockProvider();
    provider.enqueueToolCall([{ id: "call-1", name: "adjust_inventory", arguments: {} }]);
    provider.enqueueText("no se ajustó nada");

    const toolRunner = new FakeToolRunner(
      [{ name: "adjust_inventory", description: "test", inputSchema: { type: "object" } }],
      { adjust_inventory: () => ({ content: [{ type: "text", text: "should not run" }] }) },
    );

    const host = new HostService({
      provider,
      toolRunner,
      toolsRequiringConfirmation: ["adjust_inventory"],
      // sin requestConfirmation -> default seguro: se niega
    });
    openHosts.push(host);

    await host.sendMessage("session-1", "descuenta el queso");

    expect(toolRunner.calls).toHaveLength(0);
  });
});
describe("HostService.create: fallo al arrancar", () => {
  afterEach(() => vi.restoreAllMocks());

  it("cierra los servidores ya conectados cuando uno falla", async () => {
    // Sin este cierre, los subprocesos ya lanzados mantienen vivo el bucle de eventos y el
    // CLI se cuelga en vez de terminar con el error.
    const cerrados: string[] = [];

    vi.spyOn(McpClient, "overStdio").mockImplementation(((options: { command: string }) => ({
      initialize: async () => {
        if (options.command === "malo") throw new Error("terminó inesperadamente");
        return {};
      },
      close: async () => {
        cerrados.push(options.command);
      },
      listTools: async () => [],
      callTool: async () => ({ content: [] }),
    })) as never);

    await expect(
      HostService.create({
        provider: new MockProvider([]),
        servers: [
          { name: "bueno", command: "bueno" },
          { name: "malo", command: "malo" },
        ],
      }),
    ).rejects.toThrow(/"malo" no pudo iniciarse/);

    expect(cerrados).toContain("bueno");
  });

  it("adjunta el stderr del servidor al error", async () => {
    vi.spyOn(McpClient, "overStdio").mockImplementation(((_o: unknown, clientOptions: any) => {
      clientOptions.onDiagnostic("falta la variable API_KEY");
      return {
        initialize: async () => {
          throw new Error("terminó inesperadamente");
        },
        close: async () => {},
        listTools: async () => [],
        callTool: async () => ({ content: [] }),
      };
    }) as never);

    await expect(
      HostService.create({
        provider: new MockProvider([]),
        servers: [{ name: "ruidoso", command: "x" }],
      }),
    ).rejects.toThrow(/falta la variable API_KEY/);
  });
});
