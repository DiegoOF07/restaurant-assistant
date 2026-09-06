import Anthropic from "@anthropic-ai/sdk";
import type {
  AssistantMessage,
  CompletionRequest,
  CompletionResult,
  ConversationMessage,
  LLMProvider,
  StopReason,
  ToolCall,
  ToolSpec,
} from "./types.js";

/**
 * Adaptador real contra la API de Anthropic (sección 5.3 del plan).
 *
 * Todo el conocimiento del formato de Anthropic vive aquí: el resto del sistema
 * (conversation, host, cli) sigue hablando únicamente el vocabulario de types.ts.
 */

/**
 * Modelo por defecto: el más barato de la familia actual ($1/$5 por millón de tokens).
 * Suficiente para este caso de uso, donde el modelo decide qué herramienta llamar pero no hace
 * ningún cálculo — el dominio del servidor Go es quien calcula. Se sobreescribe con ANTHROPIC_MODEL.
 */
const DEFAULT_MODEL = "claude-haiku-4-5";

/** Suficiente para respuestas de chat sin arriesgar timeouts de HTTP en peticiones no-streaming. */
const DEFAULT_MAX_TOKENS = 16000;

/** Fallback ante rechazos por políticas de seguridad: reintenta en otro modelo dentro de la misma llamada. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Superficie mínima del SDK que este provider consume. Existe para poder inyectar un doble
 * en las pruebas sin hacer peticiones de red ni necesitar una API key real.
 */
export interface BetaMessageCreator {
  (
    params: Anthropic.Beta.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Beta.BetaMessage>;
}

export interface AnthropicProviderOptions {
  /** Si se omite, el SDK resuelve la credencial del entorno (ANTHROPIC_API_KEY, etc.). */
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  /** Profundidad de razonamiento y gasto de tokens. Por defecto la API usa "high". */
  effort?: Effort;
  /**
   * Reintento automático en otro modelo si el principal rechaza la petición por políticas de
   * seguridad. Desactivado por defecto: sólo lo aceptan los modelos más nuevos y caros; en
   * cualquier otro la API responde 400 "does not support the `fallbacks` parameter".
   */
  enableRefusalFallback?: boolean;
  /** Punto de inyección para pruebas: reemplaza la llamada real al SDK. */
  createMessage?: BetaMessageCreator;
}

export class AnthropicProvider implements LLMProvider {
  private readonly createMessage: BetaMessageCreator;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly effort?: Effort;
  private readonly enableRefusalFallback: boolean;

  /**
   * Bloques de contenido crudos de cada respuesta, indexados por el AssistantMessage que
   * devolvimos. Ver la nota "Por qué un WeakMap" más abajo.
   */
  private readonly rawBlocks = new WeakMap<AssistantMessage, Anthropic.Beta.BetaContentBlock[]>();

  constructor(options: AnthropicProviderOptions = {}) {
    this.model = options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.effort = options.effort;
    this.enableRefusalFallback = options.enableRefusalFallback ?? false;

    if (options.createMessage) {
      this.createMessage = options.createMessage;
    } else {
      const client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
      this.createMessage = (params) => client.beta.messages.create(params);
    }
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: request.maxTokens ?? this.maxTokens,
      messages: this.toAnthropicMessages(request.messages),
      tools: toAnthropicTools(request.tools),
    };

    if (request.systemPrompt) params.system = request.systemPrompt;
    if (this.effort) params.output_config = { effort: this.effort };
    if (this.enableRefusalFallback) {
      params.betas = [FALLBACK_BETA];
      params.fallbacks = "default";
    }

    const response = await this.createMessage(params);
    const result = fromAnthropicResponse(response);

    // Guardamos los bloques crudos para poder reenviarlos intactos en el siguiente turno.
    this.rawBlocks.set(result.message, response.content);
    return result;
  }

  /**
   * Por qué un WeakMap: en Claude Opus 5 el razonamiento está activo por defecto, y los bloques
   * `thinking` deben reenviarse sin modificar en los turnos siguientes de una misma secuencia de
   * tool-calling. Nuestro AssistantMessage sólo guarda texto y tool calls, así que reconstruirlo
   * perdería esos bloques.
   *
   * ConversationLoop guarda en la sesión exactamente el mismo objeto que devolvimos
   * (`session.appendMessage(result.message)`), así que podemos indexar por identidad de objeto y
   * recuperar los bloques originales — sin cambiar una sola línea de `conversation` ni de `host`,
   * y sin filtrar tipos de Anthropic fuera de este archivo. Al ser un WeakMap, las entradas se
   * liberan solas cuando la sesión descarta mensajes viejos por truncado.
   */
  private toAnthropicMessages(messages: ConversationMessage[]): Anthropic.Beta.BetaMessageParam[] {
    const result: Anthropic.Beta.BetaMessageParam[] = [];

    for (const message of messages) {
      if (message.role === "user") {
        result.push({ role: "user", content: message.content });
        continue;
      }

      if (message.role === "assistant") {
        const raw = this.rawBlocks.get(message);
        result.push({ role: "assistant", content: raw ?? assistantToBlocks(message) });
        continue;
      }

      // Los resultados de herramienta viajan como bloques `tool_result` dentro de un mensaje de
      // usuario. Cuando el modelo pidió varias herramientas en paralelo, TODOS sus resultados deben
      // ir en UN SOLO mensaje: repartirlos en mensajes separados le enseña al modelo a dejar de
      // pedir llamadas paralelas.
      const block: Anthropic.Beta.BetaToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content,
      };
      if (message.isError) block.is_error = true;

      const previous = result[result.length - 1];
      if (previous && previous.role === "user" && Array.isArray(previous.content)) {
        previous.content.push(block);
      } else {
        result.push({ role: "user", content: [block] });
      }
    }

    return result;
  }
}

/** Traduce las herramientas MCP ya normalizadas al formato de "tools" de Anthropic. */
export function toAnthropicTools(tools: ToolSpec[]): Anthropic.Beta.BetaTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
  }));
}

/** Reconstruye los bloques de un AssistantMessage que no produjimos nosotros (fixtures, historial cargado). */
function assistantToBlocks(message: AssistantMessage): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];

  if (message.content.length > 0) {
    blocks.push({ type: "text", text: message.content });
  }

  for (const call of message.toolCalls ?? []) {
    blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
  }

  // Un mensaje de asistente no puede ir vacío; si no hubo texto ni tool calls, mandamos un texto mínimo.
  if (blocks.length === 0) blocks.push({ type: "text", text: "(sin contenido)" });
  return blocks;
}

/** Aplana la respuesta de Anthropic al AssistantMessage propio del proyecto. */
export function fromAnthropicResponse(response: Anthropic.Beta.BetaMessage): CompletionResult {
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const block of response.content) {
    if (block.type === "text") {
      textParts.push(block.text);
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        // El modelo puede escapar el JSON de formas distintas; el SDK ya lo entrega parseado,
        // así que nunca hacemos coincidencia de strings sobre el input serializado.
        arguments: (block.input ?? {}) as Record<string, unknown>,
      });
    }
    // Los bloques `thinking` no se exponen fuera de este archivo: se conservan en rawBlocks.
  }

  const message: AssistantMessage = { role: "assistant", content: textParts.join("\n").trim() };
  if (toolCalls.length > 0) message.toolCalls = toolCalls;

  if (response.stop_reason === "refusal") {
    const explanation = response.stop_details?.explanation;
    message.content =
      message.content ||
      `El modelo rechazó la solicitud por políticas de seguridad${explanation ? `: ${explanation}` : "."}`;
  }

  return { message, stopReason: mapStopReason(response.stop_reason) };
}

/** Traduce el stop_reason de Anthropic al vocabulario reducido del proyecto. */
export function mapStopReason(stopReason: Anthropic.Beta.BetaStopReason | null): StopReason {
  switch (stopReason) {
    case "tool_use":
      return "tool_use";
    case "max_tokens":
    case "model_context_window_exceeded":
      return "max_tokens";
    case "refusal":
      return "error";
    // "end_turn", "stop_sequence", "pause_turn" y null significan que el turno terminó con texto.
    default:
      return "end_turn";
  }
}
