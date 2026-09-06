import type { ToolSpec } from "@restaurant/llm-provider";
import type { ConfirmationHandler, ConversationEvent } from "@restaurant/conversation";

/** Configuración de un servidor MCP a lanzar por stdio al arrancar el host. */
export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  /**
   * Variables de entorno extra para el subproceso. Con stdio es el canal natural para
   * pasarle al servidor la identidad (rol/usuario) bajo la que debe operar.
   */
  env?: Record<string, string>;
}

/**
 * Una línea del log unificado. `sequence` conserva el orden real entre eventos del
 * protocolo MCP y del ciclo de conversación, que llegan por caminos distintos.
 */
export interface LogEntry {
  sequence: number;
  sessionId: string;
  source: "mcp" | "conversation";
  timestamp: number;
  direction?: "to-server" | "from-server";
  kind: string;
  method?: string;
  toolName?: string;
  ok?: boolean;
  detail?: unknown;
}

export type { ConfirmationHandler, ConversationEvent, ToolSpec };