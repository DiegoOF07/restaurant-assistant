import type { LLMProvider, ToolCall, ToolSpec } from "@restaurant/llm-provider";
import type { Session } from "./session.js";
import {
  MaxIterationsExceededError,
  type ConfirmationHandler,
  type ConversationEvent,
  type ToolRunner,
  type TurnResult,
} from "./types.js";

export interface ConversationLoopOptions {
  provider: LLMProvider;
  toolRunner: ToolRunner;
  systemPrompt?: string;
  toolsRequiringConfirmation?: Iterable<string>;
  requestConfirmation?: ConfirmationHandler;
  maxIterations?: number;
  onEvent?: (event: ConversationEvent) => void;
}

export class ConversationLoop {
  private toolSpecsCache?: ToolSpec[];
  private readonly toolsRequiringConfirmation: Set<string>;
  private readonly confirm: ConfirmationHandler;
  private readonly maxIterations: number;
  private readonly emit: (event: ConversationEvent) => void;

  constructor(private readonly options: ConversationLoopOptions) {
    this.toolsRequiringConfirmation = new Set(options.toolsRequiringConfirmation ?? []);
    this.confirm = options.requestConfirmation ?? (async () => false);
    this.maxIterations = options.maxIterations ?? 8;
    this.emit = options.onEvent ?? (() => {});
  }

  /** Descubre las herramientas una sola vez y cachea el resultado */
  async discoverTools(): Promise<ToolSpec[]> {
    if (!this.toolSpecsCache) {
      this.toolSpecsCache = await this.options.toolRunner.listTools();
    }
    return this.toolSpecsCache;
  }

  /** Procesa un mensaje del usuario hasta obtener una respuesta final de texto */
  async runTurn(
    session: Session,
    userInput: string,
    callOptions?: { onEvent?: (event: ConversationEvent) => void },
  ): Promise<TurnResult> {
    const emit = (event: ConversationEvent) => {
      this.emit(event);
      callOptions?.onEvent?.(event);
    };

    session.appendMessage({ role: "user", content: userInput });
    const tools = await this.discoverTools();

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const result = await this.options.provider.complete({
        systemPrompt: this.options.systemPrompt,
        messages: [...session.getHistory()],
        tools,
      });

      session.appendMessage(result.message);

      const toolCalls = result.message.toolCalls;
      if (result.stopReason !== "tool_use" || !toolCalls || toolCalls.length === 0) {
        return { reply: result.message.content, iterations: iteration + 1 };
      }

      for (const toolCall of toolCalls) {
        await this.executeToolCall(session, toolCall, emit);
      }
    }

    emit({ kind: "iteration_limit_reached", iterations: this.maxIterations, timestamp: Date.now() });
    throw new MaxIterationsExceededError(this.maxIterations);
  }

  private async executeToolCall(
    session: Session,
    toolCall: ToolCall,
    emit: (event: ConversationEvent) => void,
  ): Promise<void> {
    emit({ kind: "tool_call_requested", toolCall, timestamp: Date.now() });

    if (this.toolsRequiringConfirmation.has(toolCall.name)) {
      emit({ kind: "tool_call_confirmation_required", toolCall, timestamp: Date.now() });
      const approved = await this.confirm(toolCall);
      emit({
        kind: approved ? "tool_call_confirmed" : "tool_call_rejected",
        toolCall,
        timestamp: Date.now(),
      });

      if (!approved) {
        session.appendMessage({
          role: "tool",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: "The user did not confirm this operation; it was not executed.",
          isError: true,
        });
        return;
      }
    }

    try {
      const execResult = await this.options.toolRunner.callTool(toolCall.name, toolCall.arguments);
      emit({ kind: "tool_call_result", toolCall, isError: !!execResult.isError, timestamp: Date.now() });

      session.appendMessage({
        role: "tool",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: JSON.stringify(execResult.structuredContent ?? execResult.content),
        isError: execResult.isError,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ kind: "tool_call_protocol_error", toolCall, message, timestamp: Date.now() });
      session.appendMessage({
        role: "tool",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: `Tool call failed: ${message}`,
        isError: true,
      });
    }
  }
}