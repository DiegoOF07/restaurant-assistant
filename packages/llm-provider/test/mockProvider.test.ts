import { describe, it, expect } from "vitest";
import { MockProvider } from "../src/mockProvider.js";
import type { ConversationMessage } from "../src/types.js";

describe("MockProvider", () => {
  it("devuelve las respuestas en el orden en que se programaron", async () => {
    const provider = new MockProvider();
    provider.enqueueText("primera respuesta");
    provider.enqueueText("segunda respuesta");

    const first = await provider.complete({ messages: [], tools: [] });
    const second = await provider.complete({ messages: [], tools: [] });

    expect(first.message.content).toBe("primera respuesta");
    expect(second.message.content).toBe("segunda respuesta");
  });

  it("lanza un error claro si se llama complete() sin respuestas programadas", async () => {
    const provider = new MockProvider();
    await expect(provider.complete({ messages: [], tools: [] })).rejects.toThrow(/no hay más respuestas/);
  });

  it("registra cada CompletionRequest recibido para poder inspeccionarlo", async () => {
    const provider = new MockProvider();
    provider.enqueueText("ok");

    await provider.complete({ messages: [{ role: "user", content: "hola" }], tools: [] });

    expect(provider.callCount).toBe(1);
    expect(provider.lastCall?.messages).toEqual([{ role: "user", content: "hola" }]);
  });

  it("enqueueToolCall produce stopReason=tool_use con los toolCalls dados", async () => {
    const provider = new MockProvider();
    provider.enqueueToolCall([{ id: "call-1", name: "get_dish_availability", arguments: { dishId: "special-burger", servings: 2 } }]);

    const result = await provider.complete({ messages: [], tools: [] });

    expect(result.stopReason).toBe("tool_use");
    expect(result.message.toolCalls).toHaveLength(1);
    expect(result.message.toolCalls?.[0]?.name).toBe("get_dish_availability");
  });

  it("simula un ciclo completo de dos turnos: tool call -> resultado -> respuesta final", async () => {

    const provider = new MockProvider();
    provider.enqueueToolCall([
      { id: "call-1", name: "get_dish_availability", arguments: { dishId: "special-burger", servings: 2 } },
    ]);
    provider.enqueueText("Solo tenemos queso para 1 porción, no para 2.");

    const messages: ConversationMessage[] = [{ role: "user", content: "¿Alcanza para 2 hamburguesas especiales?" }];
    const turn1 = await provider.complete({ messages, tools: [] });

    expect(turn1.stopReason).toBe("tool_use");
    const toolCall = turn1.message.toolCalls?.[0];
    expect(toolCall?.name).toBe("get_dish_availability");

    messages.push(turn1.message);
    messages.push({
      role: "tool",
      toolCallId: toolCall!.id,
      toolName: "get_dish_availability",
      content: JSON.stringify({ available: false, maximumServings: 1 }),
    });

    const turn2 = await provider.complete({ messages, tools: [] });

    expect(turn2.stopReason).toBe("end_turn");
    expect(turn2.message.content).toMatch(/1 porción/);

    expect(provider.getCall(1)?.messages).toHaveLength(3);
    expect(provider.getCall(1)?.messages[2]).toMatchObject({ role: "tool", toolCallId: "call-1" });
  });
});