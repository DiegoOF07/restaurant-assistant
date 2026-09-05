import type {
  AssistantMessage,
  CompletionRequest,
  CompletionResult,
  LLMProvider,
  StopReason,
  ToolCall,
} from "./types.js";

/**
 * Implementación de pruebas. No decide nada por sí mismo. Esto hace posible probar el ciclo completo
 * de tool-calling de forma determinista
 */
export class MockProvider implements LLMProvider {
  private readonly queue: CompletionResult[] = [];
  private readonly calls: CompletionRequest[] = [];

  constructor(initial: CompletionResult[] = []) {
    this.queue.push(...initial);
  }

  /** Programa una respuesta cruda para la próxima llamada a complete(). */
  enqueue(result: CompletionResult): this {
    this.queue.push(result);
    return this;
  }

  /** Programa una respuesta de texto simple, sin tool calls. */
  enqueueText(content: string, stopReason: StopReason = "end_turn"): this {
    return this.enqueue({ message: { role: "assistant", content }, stopReason });
  }

  /** Programa una respuesta donde el "LLM" decide invocar una o más herramientas. */
  enqueueToolCall(toolCalls: ToolCall[], content = ""): this {
    return this.enqueue({
      message: { role: "assistant", content, toolCalls },
      stopReason: "tool_use",
    });
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(request);
    const next = this.queue.shift();
    if (!next) {
      throw new Error(
        `MockProvider: no hay más respuestas programadas (llamada #${this.calls.length}). ` +
          `Usa enqueue()/enqueueText()/enqueueToolCall() antes de invocar complete().`,
      );
    }
    return next;
  }

  /** Cuántas veces se llamó complete() hasta ahora. */
  get callCount(): number {
    return this.calls.length;
  }

  /** El CompletionRequest de una llamada específica (0-indexado), para aserciones. */
  getCall(index: number): CompletionRequest | undefined {
    return this.calls[index];
  }

  /** El CompletionRequest más reciente, o undefined si aún no se llamó. */
  get lastCall(): CompletionRequest | undefined {
    return this.calls[this.calls.length - 1];
  }
}

/** Construye un AssistantMessage de solo texto, útil al armar fixtures de prueba. */
export function textMessage(content: string): AssistantMessage {
  return { role: "assistant", content };
}