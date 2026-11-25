import { describe, it, expect, vi, afterEach } from "vitest";
import { HostService, type ConversationEvent } from "@restaurant/host";
import type { ConfirmationHandler } from "@restaurant/conversation";
import { AssistantSession } from "../src/assistantSession.js";
import { EventBus } from "../src/eventBus.js";
import type { ServerEvent } from "../src/types.js";

const LETTUCE_ARGS = { ingredientId: "lettuce", operation: "subtract", quantity: 200, unit: "g", reason: "Se dañó", idempotencyKey: "k" };

// Doble del host: emite una llamada a herramienta y nombra la lechuga
function fakeHost() {
  let confirm: ConfirmationHandler | undefined;
  vi.spyOn(HostService, "create").mockImplementation((async (config: any) => {
    confirm = config.requestConfirmation;
    return {
      listAvailableTools: async () => [{ name: "adjust_inventory", description: "d", inputSchema: {} }],
      serverForTool: () => "local",
      getLog: () => [{ sequence: 1, sessionId: "s", source: "conversation", kind: "tool_call_result", timestamp: 1 }],
      names: () => new Map([["lettuce", "Lechuga"]]),
      sendMessage: async (_s: string, _t: string, onEvent: (e: ConversationEvent) => void) => {
        const toolCall = { id: "c1", name: "adjust_inventory", arguments: LETTUCE_ARGS };
        onEvent({ kind: "tool_call_requested", toolCall, timestamp: 1 });
        onEvent({
          kind: "tool_call_result",
          toolCall,
          isError: false,
          result: { content: [], structuredContent: { ingredientId: "lettuce", name: "Lechuga", previousQuantity: 500, resultingQuantity: 300, unit: "g" } },
          timestamp: 2,
        });
        onEvent({ kind: "tool_call_protocol_error", toolCall, message: "idempotencyKey es obligatorio", timestamp: 3 });
        return { reply: "listo", iterations: 1 };
      },
      close: async () => {},
    };
  }) as never);
  return { ask: () => confirm!({ id: "t1", name: "adjust_inventory", arguments: LETTUCE_ARGS }) };
}

function newSession(bus: EventBus) {
  return new AssistantSession({
    servers: [{ name: "local", command: "/bin/echo" }],
    createProvider: () => ({}) as never,
    systemPrompt: "p",
    toolsRequiringConfirmation: ["adjust_inventory"],
    maxIterations: 8,
    userId: "diego",
    initialRole: "cook",
    availableRoles: ["waiter", "cook", "admin"],
    serverSource: "prueba.json",
    bus,
  });
}

afterEach(() => vi.restoreAllMocks());

async function started() {
  const bus = new EventBus();
  const events: ServerEvent[] = [];
  bus.subscribe({ send: (e) => events.push(e) });
  const host = fakeHost();
  const session = newSession(bus);
  await session.start();
  return { events, host, session };
}

describe("AssistantSession: presentación", () => {
  it("el resultado de una herramienta trae su resumen", async () => {
    const { events, session } = await started();
    await session.handleMessage("se dañaron 200 g de lechuga");
    const result = events.find((e) => e.kind === "conversation" && e.event.kind === "tool_call_result");
    expect(result && "summary" in result ? result.summary?.title : undefined).toBe("Inventario actualizado");
  });

  it("un error de protocolo trae un resumen sin el mensaje técnico", async () => {
    const { events, session } = await started();
    await session.handleMessage("x");
    const err = events.find((e) => e.kind === "conversation" && e.event.kind === "tool_call_protocol_error");
    expect(err && "summary" in err ? err.summary?.title : undefined).toBe("No se pudo completar la operación");
  });

  it("el registro se publica en vivo, antes de la respuesta", async () => {
    const { events, session } = await started();
    await session.handleMessage("x");
    const kinds = events.map((e) => e.kind);
    expect(kinds.indexOf("log")).toBeGreaterThan(-1);
    expect(kinds.indexOf("log")).toBeLessThan(kinds.indexOf("assistant"));
  });

  it("la confirmación trae el texto en lenguaje de cocina", async () => {
    const { events, host } = await started();
    host.ask();
    const req = events.find((e) => e.kind === "confirmation_required");
    expect(req && req.kind === "confirmation_required" ? req.text : undefined).toEqual({
      question: "¿Descontar 200 g de Lechuga?",
      details: ["Motivo: Se dañó."],
      confirmLabel: "Descontar",
    });
  });

  it("cambiar de rol con una confirmación pendiente la cierra", async () => {
    const { events, host, session } = await started();
    const pending = host.ask();
    await session.setRole("waiter");
    await expect(pending).resolves.toBe(false);
    expect(events.some((e) => e.kind === "confirmation_resolved" && e.approved === false)).toBe(true);
  });

  it("el estado trae los roles con su nombre legible", async () => {
    const { session } = await started();
    const state = await session.state();
    expect(state.roles).toEqual([
      { id: "waiter", label: "Mesero" },
      { id: "cook", label: "Cocina" },
      { id: "admin", label: "Administración" },
    ]);
  });
});
