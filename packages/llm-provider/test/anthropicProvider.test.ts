import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  AnthropicProvider,
  fromAnthropicResponse,
  mapStopReason,
  toAnthropicTools,
} from "../src/anthropicProvider.js";
import type { CompletionRequest, ToolSpec } from "../src/types.js";

/** Construye una respuesta mínima del SDK con los campos que el adaptador realmente lee. */
function response(
  content: Anthropic.Beta.BetaContentBlock[],
  stopReason: Anthropic.Beta.BetaStopReason | null = "end_turn",
  extra: Partial<Anthropic.Beta.BetaMessage> = {},
): Anthropic.Beta.BetaMessage {
  return { content, stop_reason: stopReason, ...extra } as Anthropic.Beta.BetaMessage;
}

function textBlock(text: string): Anthropic.Beta.BetaContentBlock {
  return { type: "text", text, citations: null } as Anthropic.Beta.BetaContentBlock;
}

function toolUseBlock(id: string, name: string, input: Record<string, unknown>) {
  return { type: "tool_use", id, name, input } as Anthropic.Beta.BetaContentBlock;
}

function thinkingBlock(thinking: string) {
  return { type: "thinking", thinking, signature: "sig" } as Anthropic.Beta.BetaContentBlock;
}

const TOOLS: ToolSpec[] = [
  {
    name: "get_dish_availability",
    description: "Calculate how many servings can be prepared.",
    inputSchema: {
      type: "object",
      properties: { dishId: { type: "string" } },
      required: ["dishId"],
      additionalProperties: false,
    },
  },
];

function baseRequest(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return { messages: [], tools: TOOLS, ...overrides };
}

/** Captura los params enviados al SDK y devuelve respuestas programadas, sin tocar la red. */
function recorder(responses: Anthropic.Beta.BetaMessage[]) {
  const calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const queue = [...responses];
  const createMessage = async (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => {
    calls.push(params);
    const next = queue.shift();
    if (!next) throw new Error("recorder: no hay más respuestas programadas");
    return next;
  };
  return { calls, createMessage };
}

describe("toAnthropicTools", () => {
  it("traduce ToolSpec al formato de tools de Anthropic", () => {
    const [tool] = toAnthropicTools(TOOLS);
    expect(tool.name).toBe("get_dish_availability");
    expect(tool.description).toBe("Calculate how many servings can be prepared.");
    expect(tool.input_schema).toEqual(TOOLS[0].inputSchema);
  });
});

describe("mapStopReason", () => {
  it("mapea tool_use y max_tokens directamente", () => {
    expect(mapStopReason("tool_use")).toBe("tool_use");
    expect(mapStopReason("max_tokens")).toBe("max_tokens");
  });

  it("trata el desbordamiento de contexto como max_tokens", () => {
    expect(mapStopReason("model_context_window_exceeded")).toBe("max_tokens");
  });

  it("trata un rechazo por políticas como error", () => {
    expect(mapStopReason("refusal")).toBe("error");
  });

  it("trata end_turn, stop_sequence, pause_turn y null como fin de turno", () => {
    expect(mapStopReason("end_turn")).toBe("end_turn");
    expect(mapStopReason("stop_sequence")).toBe("end_turn");
    expect(mapStopReason("pause_turn")).toBe("end_turn");
    expect(mapStopReason(null)).toBe("end_turn");
  });
});

describe("fromAnthropicResponse", () => {
  it("aplana varios bloques de texto en un solo content", () => {
    const result = fromAnthropicResponse(response([textBlock("Hola"), textBlock("mundo")]));
    expect(result.message.content).toBe("Hola\nmundo");
    expect(result.message.toolCalls).toBeUndefined();
    expect(result.stopReason).toBe("end_turn");
  });

  it("extrae tool calls conservando el input ya parseado", () => {
    const result = fromAnthropicResponse(
      response(
        [textBlock("Déjame revisar."), toolUseBlock("tu_1", "get_dish_availability", { dishId: "x" })],
        "tool_use",
      ),
    );
    expect(result.stopReason).toBe("tool_use");
    expect(result.message.toolCalls).toEqual([
      { id: "tu_1", name: "get_dish_availability", arguments: { dishId: "x" } },
    ]);
  });

  it("no expone bloques de thinking en el AssistantMessage", () => {
    const result = fromAnthropicResponse(response([thinkingBlock("razonando..."), textBlock("Listo")]));
    expect(result.message.content).toBe("Listo");
  });

  it("da un texto explicativo cuando el modelo rechaza y no devolvió texto", () => {
    const refusal = response([], "refusal", {
      stop_details: { type: "refusal", category: "cyber", explanation: "no permitido" },
    } as Partial<Anthropic.Beta.BetaMessage>);
    const result = fromAnthropicResponse(refusal);
    expect(result.stopReason).toBe("error");
    expect(result.message.content).toContain("no permitido");
  });
});

describe("AnthropicProvider.complete", () => {
  it("envía system prompt, modelo, effort y herramientas", async () => {
    const { calls, createMessage } = recorder([response([textBlock("ok")])]);
    const provider = new AnthropicProvider({ createMessage, model: "claude-opus-5", effort: "high" });

    await provider.complete(
      baseRequest({ systemPrompt: "Eres el asistente de un restaurante.", messages: [{ role: "user", content: "hola" }] }),
    );

    expect(calls[0].model).toBe("claude-opus-5");
    expect(calls[0].system).toBe("Eres el asistente de un restaurante.");
    expect(calls[0].output_config).toEqual({ effort: "high" });
    expect(calls[0].tools).toHaveLength(1);
  });

  it("usa por defecto el modelo más barato y no manda parámetros beta", async () => {
    // Los modelos baratos y los antiguos rechazan `fallbacks` con un 400, así que la petición
    // por defecto debe ser la mínima que cualquier modelo acepta.
    const { calls, createMessage } = recorder([response([textBlock("ok")])]);
    const provider = new AnthropicProvider({ createMessage });

    await provider.complete(baseRequest({ messages: [{ role: "user", content: "hola" }] }));

    expect(calls[0].model).toBe("claude-haiku-4-5");
    expect(calls[0].fallbacks).toBeUndefined();
    expect(calls[0].betas).toBeUndefined();
    expect(calls[0].output_config).toBeUndefined();
  });

  it("manda el fallback por rechazo sólo si se activa explícitamente", async () => {
    const { calls, createMessage } = recorder([response([textBlock("ok")])]);
    const provider = new AnthropicProvider({ createMessage, enableRefusalFallback: true });

    await provider.complete(baseRequest({ messages: [{ role: "user", content: "hola" }] }));

    expect(calls[0].fallbacks).toBe("default");
    expect(calls[0].betas).toContain("server-side-fallback-2026-07-01");
  });

  it("agrupa resultados de herramientas consecutivos en un solo mensaje de usuario", async () => {
    const { calls, createMessage } = recorder([response([textBlock("listo")])]);
    const provider = new AnthropicProvider({ createMessage });

    await provider.complete(
      baseRequest({
        messages: [
          { role: "user", content: "¿hay hamburguesa y pastel?" },
          {
            role: "assistant",
            content: "",
            toolCalls: [
              { id: "tu_1", name: "get_dish_availability", arguments: { dishId: "burger" } },
              { id: "tu_2", name: "get_dish_availability", arguments: { dishId: "cake" } },
            ],
          },
          { role: "tool", toolCallId: "tu_1", toolName: "get_dish_availability", content: "{}" },
          { role: "tool", toolCallId: "tu_2", toolName: "get_dish_availability", content: "{}" },
        ],
      }),
    );

    const sent = calls[0].messages;
    expect(sent).toHaveLength(3); // user, assistant, y UN solo user con ambos tool_result
    expect(sent[2].role).toBe("user");
    expect(sent[2].content).toHaveLength(2);
  });

  it("marca is_error en los resultados de herramienta que fallaron", async () => {
    const { calls, createMessage } = recorder([response([textBlock("ok")])]);
    const provider = new AnthropicProvider({ createMessage });

    await provider.complete(
      baseRequest({
        messages: [
          { role: "user", content: "descuenta queso" },
          { role: "assistant", content: "", toolCalls: [{ id: "tu_1", name: "adjust_inventory", arguments: {} }] },
          {
            role: "tool",
            toolCallId: "tu_1",
            toolName: "adjust_inventory",
            content: "inventario insuficiente",
            isError: true,
          },
        ],
      }),
    );

    const toolResults = calls[0].messages[2].content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(toolResults[0].is_error).toBe(true);
  });

  it("reenvía los bloques de thinking intactos en el siguiente turno", async () => {
    const first = response(
      [thinkingBlock("razonando..."), toolUseBlock("tu_1", "get_dish_availability", { dishId: "burger" })],
      "tool_use",
    );
    const { calls, createMessage } = recorder([first, response([textBlock("Hay 3 porciones.")])]);
    const provider = new AnthropicProvider({ createMessage });

    // Turno 1: el modelo piensa y pide una herramienta.
    const history: CompletionRequest["messages"] = [{ role: "user", content: "¿hay hamburguesa?" }];
    const turn1 = await provider.complete(baseRequest({ messages: history }));
    history.push(turn1.message);
    history.push({ role: "tool", toolCallId: "tu_1", toolName: "get_dish_availability", content: "{}" });

    // Turno 2: el historial reenviado debe conservar el bloque de thinking original.
    await provider.complete(baseRequest({ messages: history }));

    const assistantTurn = calls[1].messages[1];
    expect(assistantTurn.role).toBe("assistant");
    expect(assistantTurn.content).toBe(first.content);
    expect((assistantTurn.content as Anthropic.Beta.BetaContentBlock[])[0].type).toBe("thinking");
  });

  it("reconstruye bloques para un AssistantMessage que no produjo el provider", async () => {
    const { calls, createMessage } = recorder([response([textBlock("ok")])]);
    const provider = new AnthropicProvider({ createMessage });

    await provider.complete(
      baseRequest({
        messages: [
          { role: "user", content: "hola" },
          { role: "assistant", content: "¿En qué te ayudo?" }, // historial cargado, no nuestro
          { role: "user", content: "gracias" },
        ],
      }),
    );

    expect(calls[0].messages[1].content).toEqual([{ type: "text", text: "¿En qué te ayudo?" }]);
  });
});
