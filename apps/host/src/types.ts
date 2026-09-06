import type { ToolSpec } from "@restaurant/llm-provider";
import type { ConfirmationHandler } from "@restaurant/conversation";

/** Configuración de un servidor MCP a lanzar por stdio al arrancar el host. */
export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
}

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

export type { ConfirmationHandler, ToolSpec };