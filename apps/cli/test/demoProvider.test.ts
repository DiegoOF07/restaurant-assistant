import { describe, it, expect } from "vitest";
import type { ConversationMessage, ToolCall, ToolSpec } from "@restaurant/llm-provider";
import { HeuristicDemoProvider } from "../src/demoProvider.js";

const TOOLS: ToolSpec[] = ["get_dish_availability", "get_recipe_details", "search_dishes", "search_ingredients", "adjust_inventory"].map(
  (name) => ({ name, description: "t", inputSchema: {} }),
);

const DISHES = [
  { id: "special-burger", name: "Hamburguesa Especial", description: "", active: true },
  { id: "chocolate-cake", name: "Pastel de Chocolate", description: "", active: true },
];
const INGREDIENTS = [
  { id: "cheese", name: "Queso cheddar", baseUnit: "g", availableQuantity: 40 },
  { id: "lettuce", name: "Lechuga", baseUnit: "g", availableQuantity: 500 },
  { id: "bun", name: "Pan de hamburguesa", baseUnit: "unit", availableQuantity: 10 },
  { id: "walnuts", name: "Nueces", baseUnit: "g", availableQuantity: 200 },
];

// Imita al servidor: búsquedas por coincidencia parcial y resultados simples para el resto
function fakeServer(call: ToolCall): { content: string; isError?: boolean } {
  const q = String(call.arguments.name ?? "").toLowerCase();
  switch (call.name) {
    case "search_dishes":
      return { content: JSON.stringify({ dishes: DISHES.filter((d) => d.name.toLowerCase().includes(q)) }) };
    case "search_ingredients":
      return { content: JSON.stringify({ ingredients: INGREDIENTS.filter((i) => i.name.toLowerCase().includes(q)) }) };
    case "adjust_inventory":
      return { content: JSON.stringify({ ingredientId: call.arguments.ingredientId, previousQuantity: 500, resultingQuantity: 300, unit: "g" }) };
    default:
      return { content: JSON.stringify({ ok: true }) };
  }
}

/** Corre un turno completo como lo haría el ciclo de tool-calling. */
async function turn(text: string, server = fakeServer) {
  const provider = new HeuristicDemoProvider();
  const messages: ConversationMessage[] = [{ role: "user", content: text }];
  const calls: ToolCall[] = [];
  for (let i = 0; i < 6; i++) {
    const result = await provider.complete({ messages, tools: TOOLS });
    if (result.stopReason !== "tool_use") return { calls, reply: result.message.content };
    const call = result.message.toolCalls![0]!;
    calls.push(call);
    messages.push(result.message);
    const out = server(call);
    messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, content: out.content, isError: out.isError });
  }
  throw new Error("el turno no terminó");
}

describe("HeuristicDemoProvider", () => {
  it("disponibilidad: busca el platillo en singular y luego consulta", async () => {
    const { calls, reply } = await turn("¿Cuántas hamburguesas especiales puedo preparar?");
    expect(calls[0]).toMatchObject({ name: "search_dishes", arguments: { name: "hamburguesa especial" } });
    expect(calls[1]).toMatchObject({ name: "get_dish_availability", arguments: { dishId: "special-burger", servings: 1 } });
    expect(reply).toBe("Listo, aquí está la disponibilidad.");
  });

  it("disponibilidad con porciones", async () => {
    const { calls } = await turn("¿Alcanza para 3 porciones de pastel de chocolate?");
    expect(calls[1]).toMatchObject({ name: "get_dish_availability", arguments: { dishId: "chocolate-cake", servings: 3 } });
  });

  it("receta y alérgenos", async () => {
    const { calls, reply } = await turn("¿Qué alérgenos tiene el pastel de chocolate?");
    expect(calls.map((c) => c.name)).toEqual(["search_dishes", "get_recipe_details"]);
    expect(calls[1]?.arguments).toEqual({ dishId: "chocolate-cake" });
    expect(reply).toBe("Esta es la receta.");
  });

  it("un ingrediente que no existe no se ajusta", async () => {
    const { calls, reply } = await turn("Se dañaron 2 tomates");
    expect(calls.map((c) => c.name)).toEqual(["search_ingredients", "search_ingredients"]);
    expect(calls[0]?.arguments).toEqual({ name: "tomate" });
    expect(reply).toBe("No encontré «tomate» en el inventario.");
  });

  it("se dañaron 200 g de lechuga", async () => {
    const { calls, reply } = await turn("Se dañaron 200 g de lechuga");
    expect(calls[0]).toMatchObject({ name: "search_ingredients", arguments: { name: "lechuga" } });
    expect(calls[1]).toMatchObject({
      name: "adjust_inventory",
      arguments: { ingredientId: "lettuce", operation: "subtract", quantity: 200, unit: "g", reason: "Se dañó" },
    });
    expect(String(calls[1]?.arguments.idempotencyKey)).toMatch(/^demo-/);
    expect(reply).toBe("Hecho: inventario actualizado.");
  });

  it("medio kilo de queso llegó", async () => {
    const { calls } = await turn("medio kilo de queso llegó");
    expect(calls[1]).toMatchObject({
      name: "adjust_inventory",
      arguments: { ingredientId: "cheese", operation: "add", quantity: 0.5, unit: "kg", reason: "Llegó pedido" },
    });
  });

  it("sin unidad usa la unidad base del ingrediente", async () => {
    const { calls } = await turn("se perdieron 2 panes");
    expect(calls[1]).toMatchObject({ name: "adjust_inventory", arguments: { ingredientId: "bun", quantity: 2, unit: "unit", reason: "Se perdió" } });
  });

  it("plurales irregulares: nueces", async () => {
    const { calls } = await turn("se dañaron 50 g de nueces");
    expect(calls.at(-1)).toMatchObject({ name: "adjust_inventory", arguments: { ingredientId: "walnuts", quantity: 50, unit: "g" } });
  });

  it("varias coincidencias: pregunta cuál", async () => {
    const { calls, reply } = await turn("se dañaron 10 g de a", (call) =>
      call.name === "search_ingredients"
        ? { content: JSON.stringify({ ingredients: INGREDIENTS.slice(0, 2) }) }
        : fakeServer(call),
    );
    expect(calls.map((c) => c.name)).toEqual(["search_ingredients"]);
    expect(reply).toBe("Encontré varias opciones: Queso cheddar, Lechuga. ¿Cuál?");
  });

  it("el menú", async () => {
    const { calls, reply } = await turn("¿Qué platillos hay en el menú?");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: "search_dishes", arguments: { name: "" } });
    expect(reply).toBe("Este es el menú.");
  });

  it("un error del servidor se explica", async () => {
    const { reply } = await turn("Se dañaron 200 g de lechuga", (call) =>
      call.name === "adjust_inventory"
        ? { content: JSON.stringify([{ type: "text", text: "Tu rol (Mesero) no puede ajustar el inventario." }]), isError: true }
        : fakeServer(call),
    );
    expect(reply).toBe("No se pudo: Tu rol (Mesero) no puede ajustar el inventario.");
  });

  it("un saludo recibe la ayuda", async () => {
    const { calls, reply } = await turn("hola");
    expect(calls).toHaveLength(0);
    expect(reply).toContain("demostración");
  });

  it("cada ajuste lleva una idempotencyKey distinta", async () => {
    const a = await turn("Se dañaron 200 g de lechuga");
    const b = await turn("Se dañaron 200 g de lechuga");
    expect(a.calls[1]?.arguments.idempotencyKey).not.toBe(b.calls[1]?.arguments.idempotencyKey);
  });

  it("«quedan» no se confunde con «dañaron»", async () => {
    const { calls } = await turn("¿Cuántas hamburguesas especiales quedan?");
    expect(calls[0]).toMatchObject({ name: "search_dishes", arguments: { name: "hamburguesa especial" } });
    expect(calls[1]?.name).toBe("get_dish_availability");
  });

  it("«restaurante» no se confunde con «resta»", async () => {
    const { calls, reply } = await turn("¿Qué platillos tiene el restaurante?");
    expect(calls).toEqual([expect.objectContaining({ name: "search_dishes", arguments: { name: "" } })]);
    expect(reply).toBe("Este es el menú.");
  });

  it("palabras de más: prueba con frases más cortas antes de rendirse", async () => {
    const { calls } = await turn("¿Cuántas hamburguesas especiales puedo preparar para 4 personas esta noche?");
    expect(calls.at(-1)).toMatchObject({ name: "get_dish_availability", arguments: { dishId: "special-burger", servings: 4 } });
  });
});
