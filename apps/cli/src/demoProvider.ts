import type { CompletionRequest, CompletionResult, ToolCall, ToolSpec } from "@restaurant/llm-provider";

/**
 * PROVEEDOR DE DEMOSTRACIÓN, NO UN LLM REAL.
 *
 * Vive en apps/cli (no en @restaurant/llm-provider) porque no es un
 * proveedor reutilizable: es una herramienta de desarrollo específica de
 * esta aplicación. 
 */
export class HeuristicDemoProvider {
  private nextId = 1;

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const last = request.messages[request.messages.length - 1];

    // Segunda vuelta del ciclo: ya se ejecutó una herramienta, se resume
    // el resultado en texto plano y se termina el turno.
    if (last?.role === "tool") {
      const toolMessages = collectTrailingToolMessages(request.messages);
      const summary = toolMessages
        .map((m) => `${m.toolName}${m.isError ? " (error)" : ""}: ${m.content}`)
        .join("\n");
      return {
        message: { role: "assistant", content: `Resultado:\n${summary}` },
        stopReason: "end_turn",
      };
    }

    const userText = last?.role === "user" ? last.content.toLowerCase() : "";
    const hasTool = (name: string) => request.tools.some((t: ToolSpec) => t.name === name);

    if (/disponib|alcanza|alcanzan/.test(userText) && hasTool("get_dish_availability")) {
      return this.toolUse("get_dish_availability", {
        dishId: resolveDishId(userText),
        servings: extractNumber(userText, 1),
      });
    }

    if (/receta|ingredientes|al[eé]rgen/.test(userText) && hasTool("get_recipe_details")) {
      return this.toolUse("get_recipe_details", { dishId: resolveDishId(userText) });
    }

    if (/busca|buscar|platillo|men[uú]/.test(userText) && hasTool("search_dishes")) {
      return this.toolUse("search_dishes", { name: extractSearchTerm(userText) });
    }

    if (/da[ñn]|perd|tira|descuenta|resta|quita|repon|agregar|añad|suma|restock/.test(userText) && hasTool("adjust_inventory")) {
      return this.toolUse("adjust_inventory", {
        ingredientId: resolveIngredientId(userText),
        operation: /da[ñn]|perd|tira|descuenta|resta|quita/.test(userText) ? "subtract" : "add",
        quantity: extractNumber(userText, 1),
        unit: extractUnit(userText, "kg"),
        reason: "reported via CLI demo provider",
        idempotencyKey: `cli-demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
    }

    return {
      message: {
        role: "assistant",
        content:
          "Soy un proveedor de demostración (todavía no hay un LLM real conectado). " +
          "Prueba preguntando por disponibilidad, la receta de un platillo, o pide reponer/descontar un ingrediente.",
      },
      stopReason: "end_turn",
    };
  }

  private toolUse(name: string, args: Record<string, unknown>): CompletionResult {
    const toolCall: ToolCall = { id: `demo-${this.nextId++}`, name, arguments: args };
    return { message: { role: "assistant", content: "", toolCalls: [toolCall] }, stopReason: "tool_use" };
  }
}

function collectTrailingToolMessages(
  messages: CompletionRequest["messages"],
): Array<{ toolName: string; content: string; isError?: boolean }> {
  const trailing: Array<{ toolName: string; content: string; isError?: boolean }> = [];
  for (let i = messages.length - 1; i >= 0 && messages[i]!.role === "tool"; i--) {
    const m = messages[i]!;
    if (m.role === "tool") trailing.unshift({ toolName: m.toolName, content: m.content, isError: m.isError });
  }
  return trailing;
}

function resolveDishId(text: string): string {
  if (/pastel|cake|chocolate/.test(text)) return "chocolate-cake";
  return "special-burger";
}

function resolveIngredientId(text: string): string {
  const map: Record<string, string> = {
    queso: "cheese",
    lechuga: "lettuce",
    harina: "flour",
    chocolate: "chocolate",
    leche: "milk",
    nuez: "walnuts",
    nueces: "walnuts",
    pan: "bun",
    carne: "patty",
  };
  for (const [keyword, ingredientId] of Object.entries(map)) {
    if (text.includes(keyword)) return ingredientId;
  }
  return "cheese";
}

function extractSearchTerm(text: string): string {
  const match = text.match(/(?:busca|buscar)\s+(\w+)/);
  return match?.[1] ?? "";
}

function extractNumber(text: string, fallback: number): number {
  const match = text.match(/\d+(\.\d+)?/);
  return match ? Number.parseFloat(match[0]) : fallback;
}

function extractUnit(text: string, fallback: string): string {
  const match = text.match(/\b(kg|g|ml|l)\b/i);
  return match ? match[0].toLowerCase() : fallback;
}