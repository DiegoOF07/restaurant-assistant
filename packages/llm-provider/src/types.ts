/**
 * Vocabulario propio para hablar con un proveedor LLM desacoplado del formato de API de cualquier proveedor concreto 
 */

/** Una herramienta disponible, en el formato que cualquier proveedor puede traducir a su propio esquema de "tools" */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Una invocación de herramienta que el LLM decidió hacer. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface UserMessage {
  role: "user";
  content: string;
}

/** Respuesta del asistente: texto, cero o más tool calls, o ambos a la vez */
export interface AssistantMessage {
  role: "assistant";
  content: string;
  toolCalls?: ToolCall[];
}

/** Resultado de ejecutar una herramienta, que se manda de vuelta al LLM en el siguiente turno */
export interface ToolResultMessage {
  role: "tool";
  toolCallId: string;
  toolName: string;
  content: string;
  isError?: boolean;
}

export type ConversationMessage = UserMessage | AssistantMessage | ToolResultMessage;

/** Por qué el proveedor terminó su turno */
export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "error";

export interface CompletionRequest {
  systemPrompt?: string;
  messages: ConversationMessage[];
  tools: ToolSpec[];
  maxTokens?: number;
}

export interface CompletionResult {
  message: AssistantMessage;
  stopReason: StopReason;
}

/** Contrato único que el resto del sistema conoce */
export interface LLMProvider {
  complete(request: CompletionRequest): Promise<CompletionResult>;
}