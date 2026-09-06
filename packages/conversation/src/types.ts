import type { ConversationMessage, ToolCall, ToolSpec } from "@restaurant/llm-provider";

/** Forma mínima que necesita el ciclo de tool-calling para ejecutar herramientas */
export interface ToolRunner {
  listTools(): Promise<ToolSpec[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>;
}

/**
 * Resultado de ejecutar una herramienta. `isError` marca un fallo de NEGOCIO (permiso
 * denegado, inventario insuficiente), que se le devuelve al modelo para que lo explique;
 * un fallo de PROTOCOLO se lanza como excepción y no llega acá.
 */
export interface ToolExecutionResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

/** Se le pregunta al humano si aprueba una operación sensible */
export type ConfirmationHandler = (toolCall: ToolCall) => Promise<boolean>;

/**
 * Eventos técnicos del ciclo de tool-calling, separados de la respuesta
 * visible que recibe el usuario
 */
export type ConversationEvent =
  | { kind: "tool_call_requested"; toolCall: ToolCall; timestamp: number }
  | { kind: "tool_call_confirmation_required"; toolCall: ToolCall; timestamp: number }
  | { kind: "tool_call_confirmed"; toolCall: ToolCall; timestamp: number }
  | { kind: "tool_call_rejected"; toolCall: ToolCall; timestamp: number }
  | { kind: "tool_call_result"; toolCall: ToolCall; isError: boolean; timestamp: number }
  | { kind: "tool_call_protocol_error"; toolCall: ToolCall; message: string; timestamp: number }
  | { kind: "iteration_limit_reached"; iterations: number; timestamp: number };

/** Respuesta final de un turno. `iterations` dice cuántas vueltas de tool-calling costó. */
export interface TurnResult {
  reply: string;
  iterations: number;
}

/** Se lanza cuando un turno agota el máximo de iteraciones sin llegar a una respuesta final */
export class MaxIterationsExceededError extends Error {
  constructor(readonly maxIterations: number) {
    super(`se alcanzó el máximo de ${maxIterations} iteraciones sin obtener una respuesta final`);
    this.name = "MaxIterationsExceededError";
  }
}

export type { ConversationMessage };