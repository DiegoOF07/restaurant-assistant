import { describe, it, expect } from "vitest";
import type { ToolSpec } from "@restaurant/llm-provider";
import { HeuristicDemoProvider } from "../src/demoProvider.js";

const TOOLS: ToolSpec[] = [
  { name: "get_dish_availability", description: "t", inputSchema: {} },
  { name: "get_recipe_details", description: "t", inputSchema: {} },
  { name: "search_dishes", description: "t", inputSchema: {} },
  { name: "adjust_inventory", description: "t", inputSchema: {} },
];

describe("HeuristicDemoProvider", () => {
  it("pide get_dish_availability cuando el mensaje menciona disponibilidad", async () => {
    const provider = new HeuristicDemoProvider();
    const result = await provider.complete({ messages: [{ role: "user", content: "¿Alcanza para 2 hamburguesas especiales?" }], tools: TOOLS });
    expect(result.stopReason).toBe("tool_use");
    const toolCall = result.message.toolCalls?.[0];
    expect(toolCall?.name).toBe("get_dish_availability");
    expect(toolCall?.arguments).toMatchObject({ dishId: "special-burger", servings: 2 });
  });

  it("resuelve chocolate-cake cuando el texto menciona pastel o chocolate", async () => {
    const provider = new HeuristicDemoProvider();
    const result = await provider.complete({ messages: [{ role: "user", content: "¿Cuál es la receta del pastel de chocolate?" }], tools: TOOLS });
    expect(result.message.toolCalls?.[0]).toMatchObject({ name: "get_recipe_details", arguments: { dishId: "chocolate-cake" } });
  });

  it("detecta una operación de resta cuando el texto habla de daño/pérdida", async () => {
    const provider = new HeuristicDemoProvider();
    const result = await provider.complete({ messages: [{ role: "user", content: "se dañaron 2 kg de queso" }], tools: TOOLS });
    expect(result.message.toolCalls?.[0]).toMatchObject({ name: "adjust_inventory", arguments: { ingredientId: "cheese", operation: "subtract", quantity: 2, unit: "kg" } });
  });

  it("detecta una operación de suma cuando el texto habla de reponer", async () => {
    const provider = new HeuristicDemoProvider();
    const result = await provider.complete({ messages: [{ role: "user", content: "repon 5 kg de harina" }], tools: TOOLS });
    expect(result.message.toolCalls?.[0]).toMatchObject({ name: "adjust_inventory", arguments: { ingredientId: "flour", operation: "add", quantity: 5, unit: "kg" } });
  });

  it("cada llamada a adjust_inventory genera una idempotencyKey distinta", async () => {
    const provider = new HeuristicDemoProvider();
    const r1 = await provider.complete({ messages: [{ role: "user", content: "repon 1 kg de queso" }], tools: TOOLS });
    const r2 = await provider.complete({ messages: [{ role: "user", content: "repon 1 kg de queso" }], tools: TOOLS });
    expect(r1.message.toolCalls?.[0]?.arguments.idempotencyKey).not.toBe(r2.message.toolCalls?.[0]?.arguments.idempotencyKey);
  });

  it("no pide ninguna herramienta si el servidor no la expone", async () => {
    const provider = new HeuristicDemoProvider();
    const result = await provider.complete({ messages: [{ role: "user", content: "¿alcanza la hamburguesa?" }], tools: [] });
    expect(result.stopReason).toBe("end_turn");
    expect(result.message.toolCalls).toBeUndefined();
  });

  it("responde con un resumen de texto tras recibir un resultado de herramienta", async () => {
    const provider = new HeuristicDemoProvider();
    const result = await provider.complete({
      messages: [
        { role: "user", content: "¿alcanza la hamburguesa?" },
        { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "get_dish_availability", arguments: {} }] },
        { role: "tool", toolCallId: "c1", toolName: "get_dish_availability", content: JSON.stringify({ available: false, maximumServings: 1 }) },
      ],
      tools: TOOLS,
    });
    expect(result.stopReason).toBe("end_turn");
    expect(result.message.content).toMatch(/get_dish_availability/);
    expect(result.message.content).toMatch(/maximumServings/);
  });

  it("responde un mensaje genérico si el texto no coincide con ninguna intención conocida", async () => {
    const provider = new HeuristicDemoProvider();
    const result = await provider.complete({ messages: [{ role: "user", content: "hola, ¿cómo estás?" }], tools: TOOLS });
    expect(result.stopReason).toBe("end_turn");
    expect(result.message.content).toMatch(/demostración/);
  });
});