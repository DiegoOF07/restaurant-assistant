import { describe, it, expect, vi, afterEach } from "vitest";
import { HostService } from "@restaurant/host";
import type { ConfirmationHandler } from "@restaurant/conversation";
import { AssistantSession } from "../src/assistantSession.js";
import { EventBus } from "../src/eventBus.js";
import type { ServerEvent } from "../src/types.js";

/**
 * El HostService real lanza subprocesos, así que se sustituye por un doble que sí permite
 * disparar la confirmación y observar qué se publica.
 */
function fakeHost() {
  let confirm: ConfirmationHandler | undefined;
  const closed: number[] = [];
  let instances = 0;

  const spy = vi.spyOn(HostService, "create").mockImplementation((async (config: any) => {
    const id = instances++;
    confirm = config.requestConfirmation;
    return {
      listAvailableTools: async () => [{ name: "adjust_inventory", description: "d", inputSchema: {} }],
      serverForTool: () => config.servers[0]?.name,
      getLog: () => [],
      sendMessage: async () => ({ reply: "listo", iterations: 1 }),
      close: async () => {
        closed.push(id);
      },
      envOf: config.servers[0]?.env,
    };
  }) as never);

  return {
    spy,
    closed,
    /** Dispara la confirmación como haría el ciclo de tool-calling. */
    askConfirmation: () => confirm!({ id: "t1", name: "adjust_inventory", arguments: { qty: 10 } }),
    lastEnv: () => (spy.mock.results.at(-1)?.value as Promise<any>) ,
  };
}

function newSession(bus: EventBus, initialRole = "cook") {
  return new AssistantSession({
    servers: [{ name: "local", command: "/bin/echo" }],
    createProvider: () => ({ complete: async () => ({ message: { role: "assistant", content: "" }, stopReason: "end_turn" }) }) as never,
    systemPrompt: "prompt",
    toolsRequiringConfirmation: ["adjust_inventory"],
    maxIterations: 8,
    userId: "diego",
    initialRole,
    availableRoles: ["waiter", "cook", "admin"],
    serverSource: "prueba.json",
    bus,
  });
}

afterEach(() => vi.restoreAllMocks());

describe("AssistantSession: confirmaciones", () => {
  it("publica la petición y espera la respuesta del navegador", async () => {
    const bus = new EventBus();
    const eventos: ServerEvent[] = [];
    bus.subscribe({ send: (e) => eventos.push(e) });

    const host = fakeHost();
    const session = newSession(bus);
    await session.start();

    const pending = host.askConfirmation();

    const solicitud = eventos.find((e) => e.kind === "confirmation_required");
    expect(solicitud).toBeDefined();
    if (solicitud?.kind !== "confirmation_required") throw new Error("tipo inesperado");
    expect(solicitud.toolName).toBe("adjust_inventory");
    expect(solicitud.args).toEqual({ qty: 10 });

    expect(session.resolveConfirmation(solicitud.requestId, true)).toBe(true);
    await expect(pending).resolves.toBe(true);
  });

  it("deniega si no hay ningún navegador conectado", async () => {
    // Aprobar sin nadie mirando sería lo contrario de lo que protege esta capa.
    const bus = new EventBus();
    const host = fakeHost();
    const session = newSession(bus);
    await session.start();

    await expect(host.askConfirmation()).resolves.toBe(false);
  });

  it("ignora una confirmación con un identificador que ya no está pendiente", async () => {
    const bus = new EventBus();
    bus.subscribe({ send: () => {} });
    fakeHost();

    const session = newSession(bus);
    await session.start();

    expect(session.resolveConfirmation("inventado", true)).toBe(false);
  });

  it("deniega las confirmaciones pendientes al cerrar la sesión", async () => {
    const bus = new EventBus();
    bus.subscribe({ send: () => {} });

    const host = fakeHost();
    const session = newSession(bus);
    await session.start();

    const pending = host.askConfirmation();
    await session.close();

    await expect(pending).resolves.toBe(false);
  });
});

describe("AssistantSession: cambio de rol", () => {
  it("relanza los servidores con el rol nuevo", async () => {
    const bus = new EventBus();
    const eventos: ServerEvent[] = [];
    bus.subscribe({ send: (e) => eventos.push(e) });

    const host = fakeHost();
    const session = newSession(bus, "cook");
    await session.start();

    await session.setRole("waiter");

    // El host anterior debe cerrarse: con stdio el rol viaja al arrancar el subproceso,
    // así que cambiarlo obliga a relanzar.
    expect(host.closed).toEqual([0]);
    expect(host.spy).toHaveBeenCalledTimes(2);

    const env = host.spy.mock.calls[1]![0].servers[0].env;
    expect(env.MCP_USER_ROLE).toBe("waiter");

    const estado = eventos.filter((e) => e.kind === "state").at(-1);
    expect(estado?.kind === "state" && estado.state.userRole).toBe("waiter");
  });

  it("no hace nada si el rol pedido es el que ya está activo", async () => {
    const bus = new EventBus();
    const host = fakeHost();
    const session = newSession(bus, "cook");
    await session.start();

    await session.setRole("cook");

    expect(host.spy).toHaveBeenCalledTimes(1);
  });

  it("no inyecta el rol a un servidor remoto, porque lo decide su token", async () => {
    const bus = new EventBus();
    const host = fakeHost();

    const session = new AssistantSession({
      servers: [{ name: "remoto", url: "https://x.com/mcp", headers: { Authorization: "Bearer t" } }],
      createProvider: () => ({ complete: async () => ({ message: { role: "assistant", content: "" }, stopReason: "end_turn" }) }) as never,
      systemPrompt: "p",
      toolsRequiringConfirmation: [],
      maxIterations: 8,
      userId: "diego",
      initialRole: "cook",
      availableRoles: ["waiter", "cook"],
      serverSource: "x.json",
      bus,
    });
    await session.start();

    expect(host.spy.mock.calls[0]![0].servers[0].env).toBeUndefined();
  });
});

describe("AssistantSession: estado", () => {
  it("reporta los servidores con las herramientas que aporta cada uno", async () => {
    const bus = new EventBus();
    fakeHost();

    const session = newSession(bus);
    await session.start();

    const state = await session.state();
    expect(state.userRole).toBe("cook");
    expect(state.userId).toBe("diego");
    expect(state.servers).toHaveLength(1);
    expect(state.servers[0]!.toolNames).toEqual(["adjust_inventory"]);
    expect(state.availableRoles).toEqual(["waiter", "cook", "admin"]);
  });
});
