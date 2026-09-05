import { describe, it, expect } from "vitest";
import { MockProvider } from "@restaurant/llm-provider";
import type { ToolSpec } from "@restaurant/llm-provider";

import { Session } from "../src/session.js";
import { ConversationLoop } from "../src/loop.js";
import { MaxIterationsExceededError } from "../src/types.js";
import type { ConversationEvent, ToolExecutionResult, ToolRunner } from "../src/types.js";

/** ToolRunner falso en memoria: nunca toca subprocesos ni el servidor Go. */
class FakeToolRunner implements ToolRunner {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  constructor(
    private readonly tools: ToolSpec[],
    private readonly handlers: Record<
      string,
      (args: Record<string, unknown>) => ToolExecutionResult | Promise<ToolExecutionResult>
    >,
  ) {}

  async listTools(): Promise<ToolSpec[]> {
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    this.calls.push({ name, args });
    const handler = this.handlers[name];
    if (!handler) {
      // Simula lo que haría mcp-client si el servidor devuelve
      // -32602 "unknown tool": un error de PROTOCOLO, no de negocio.
      throw new Error(`unknown tool: ${name}`);
    }
    return handler(args);
  }
}

const AVAILABILITY_TOOL: ToolSpec = {
  name: "get_dish_availability",
  description: "test",
  inputSchema: { type: "object" },
};

const ADJUST_TOOL: ToolSpec = {
  name: "adjust_inventory",
  description: "test",
  inputSchema: { type: "object" },
};

describe("ConversationLoop", () => {
  it("responde directo cuando el LLM no pide ninguna herramienta", async () => {
    const provider = new MockProvider();
    provider.enqueueText("Hola, ¿en qué te ayudo?");
    const toolRunner = new FakeToolRunner([], {});
    const loop = new ConversationLoop({ provider, toolRunner });
    const session = new Session("s1");

    const result = await loop.runTurn(session, "hola");

    expect(result.reply).toBe("Hola, ¿en qué te ayudo?");
    expect(result.iterations).toBe(1);
    expect(session.getHistory()).toHaveLength(2); // user + assistant
  });

  it("ejecuta una herramienta y devuelve la respuesta final del segundo turno", async () => {
    const provider = new MockProvider();
    provider.enqueueToolCall([
      { id: "call-1", name: "get_dish_availability", arguments: { dishId: "special-burger", servings: 2 } },
    ]);
    provider.enqueueText("Solo alcanza para 1 porción.");

    const toolRunner = new FakeToolRunner([AVAILABILITY_TOOL], {
      get_dish_availability: () => ({
        content: [{ type: "text", text: "1 serving max" }],
        structuredContent: { available: false, maximumServings: 1 },
      }),
    });
    const loop = new ConversationLoop({ provider, toolRunner });
    const session = new Session("s1");

    const result = await loop.runTurn(session, "¿alcanza para 2?");

    expect(result.reply).toBe("Solo alcanza para 1 porción.");
    expect(result.iterations).toBe(2);
    expect(toolRunner.calls).toEqual([
      { name: "get_dish_availability", args: { dishId: "special-burger", servings: 2 } },
    ]);

    // El historial debe llevar el mensaje de resultado con el structuredContent serializado.
    const toolMessage = session.getHistory().find((m) => m.role === "tool");
    expect(toolMessage).toMatchObject({ toolCallId: "call-1", isError: undefined });
    expect(JSON.parse((toolMessage as { content: string }).content)).toEqual({
      available: false,
      maximumServings: 1,
    });
  });

  it("ejecuta varias tool calls pedidas en el mismo turno antes de continuar", async () => {
    const provider = new MockProvider();
    provider.enqueueToolCall([
      { id: "call-1", name: "get_dish_availability", arguments: { dishId: "a", servings: 1 } },
      { id: "call-2", name: "get_dish_availability", arguments: { dishId: "b", servings: 1 } },
    ]);
    provider.enqueueText("Ambos disponibles.");

    const toolRunner = new FakeToolRunner([AVAILABILITY_TOOL], {
      get_dish_availability: (args) => ({
        content: [{ type: "text", text: "ok" }],
        structuredContent: { dishId: args.dishId, available: true },
      }),
    });
    const loop = new ConversationLoop({ provider, toolRunner });
    const session = new Session("s1");

    await loop.runTurn(session, "¿alcanzan ambos?");

    expect(toolRunner.calls).toHaveLength(2);
    const toolMessages = session.getHistory().filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(2);
  });

  it("no ejecuta una herramienta sensible si no se confirma (default: negar)", async () => {
    const provider = new MockProvider();
    provider.enqueueToolCall([
      { id: "call-1", name: "adjust_inventory", arguments: { ingredientId: "cheese", operation: "subtract" } },
    ]);
    provider.enqueueText("No se realizó el ajuste.");

    const toolRunner = new FakeToolRunner([ADJUST_TOOL], {
      adjust_inventory: () => ({ content: [{ type: "text", text: "should not run" }] }),
    });

    // No se pasa requestConfirmation: el default debe negar la operación.
    const loop = new ConversationLoop({
      provider,
      toolRunner,
      toolsRequiringConfirmation: ["adjust_inventory"],
    });
    const session = new Session("s1");

    await loop.runTurn(session, "descuenta el queso dañado");

    expect(toolRunner.calls).toHaveLength(0); // nunca se llamó la herramienta real
    const toolMessage = session.getHistory().find((m) => m.role === "tool");
    expect(toolMessage).toMatchObject({ isError: true });
    expect((toolMessage as { content: string }).content).toMatch(/did not confirm/);
  });

  it("ejecuta una herramienta sensible cuando el handler de confirmación aprueba", async () => {
    const provider = new MockProvider();
    provider.enqueueToolCall([
      { id: "call-1", name: "adjust_inventory", arguments: { ingredientId: "cheese", operation: "subtract" } },
    ]);
    provider.enqueueText("Ajuste realizado.");

    const toolRunner = new FakeToolRunner([ADJUST_TOOL], {
      adjust_inventory: () => ({
        content: [{ type: "text", text: "done" }],
        structuredContent: { resultingQuantity: 3040 },
      }),
    });

    const loop = new ConversationLoop({
      provider,
      toolRunner,
      toolsRequiringConfirmation: ["adjust_inventory"],
      requestConfirmation: async () => true,
    });
    const session = new Session("s1");

    await loop.runTurn(session, "descuenta el queso dañado, ya confirmé");

    expect(toolRunner.calls).toHaveLength(1);
  });

  it("convierte un error de protocolo del ToolRunner en un tool result con isError, sin lanzar", async () => {
    const provider = new MockProvider();
    provider.enqueueToolCall([{ id: "call-1", name: "does_not_exist", arguments: {} }]);
    provider.enqueueText("No encontré esa herramienta, ¿podrías reformular?");

    const toolRunner = new FakeToolRunner([], {}); // sin handlers -> lanza "unknown tool"
    const loop = new ConversationLoop({ provider, toolRunner });
    const session = new Session("s1");

    const result = await loop.runTurn(session, "haz algo que no existe");

    expect(result.reply).toMatch(/reformular/);
    const toolMessage = session.getHistory().find((m) => m.role === "tool");
    expect(toolMessage).toMatchObject({ isError: true });
    expect((toolMessage as { content: string }).content).toMatch(/unknown tool/);
  });

  it("lanza MaxIterationsExceededError si el LLM nunca deja de pedir herramientas", async () => {
    const provider = new MockProvider();
    provider.enqueueToolCall([{ id: "call-1", name: "get_dish_availability", arguments: {} }]);
    provider.enqueueToolCall([{ id: "call-2", name: "get_dish_availability", arguments: {} }]);
    // Con maxIterations=2, el loop no debería consumir una tercera respuesta.

    const toolRunner = new FakeToolRunner([AVAILABILITY_TOOL], {
      get_dish_availability: () => ({ content: [{ type: "text", text: "ok" }] }),
    });
    const events: ConversationEvent[] = [];
    const loop = new ConversationLoop({ provider, toolRunner, maxIterations: 2, onEvent: (e) => events.push(e) });
    const session = new Session("s1");

    await expect(loop.runTurn(session, "sigue pidiendo cosas")).rejects.toBeInstanceOf(MaxIterationsExceededError);
    expect(events.some((e) => e.kind === "iteration_limit_reached")).toBe(true);
  });

  it("mantiene el historial completamente aislado entre sesiones distintas", async () => {
    const provider = new MockProvider();
    provider.enqueueText("respuesta para sesión 1");
    provider.enqueueText("respuesta para sesión 2");

    const toolRunner = new FakeToolRunner([], {});
    const loop = new ConversationLoop({ provider, toolRunner });

    const session1 = new Session("s1");
    const session2 = new Session("s2");

    await loop.runTurn(session1, "mensaje de sesión 1");
    await loop.runTurn(session2, "mensaje de sesión 2");

    expect(session1.getHistory()).toHaveLength(2);
    expect(session2.getHistory()).toHaveLength(2);
    expect(session1.getHistory()[0]).toMatchObject({ content: "mensaje de sesión 1" });
    expect(session2.getHistory()[0]).toMatchObject({ content: "mensaje de sesión 2" });
  });

  it("emite eventos técnicos separados de la respuesta visible", async () => {
    const provider = new MockProvider();
    provider.enqueueToolCall([{ id: "call-1", name: "get_dish_availability", arguments: {} }]);
    provider.enqueueText("listo");

    const toolRunner = new FakeToolRunner([AVAILABILITY_TOOL], {
      get_dish_availability: () => ({ content: [{ type: "text", text: "ok" }] }),
    });
    const events: ConversationEvent[] = [];
    const loop = new ConversationLoop({ provider, toolRunner, onEvent: (e) => events.push(e) });
    const session = new Session("s1");

    const result = await loop.runTurn(session, "hola");

    expect(result.reply).toBe("listo"); // la respuesta visible no lleva eventos técnicos mezclados
    expect(events.map((e) => e.kind)).toEqual(["tool_call_requested", "tool_call_result"]);
  });
});