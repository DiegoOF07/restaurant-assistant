import type { JsonRpcId } from "./types.js";

/**
 * Un evento por cada interacción con el servidor MCP.
 * Este cliente solo emite los datos crudos.
 */
export interface McpLogEvent {
  direction: "to-server" | "from-server";
  kind: "request" | "notification" | "response" | "parse-error" | "unmatched-response";
  method?: string;
  id?: JsonRpcId;
  /** Presente solo en eventos "response": true si la respuesta no trajo error */
  ok?: boolean;
  timestamp: number;
}

export type McpEventListener = (event: McpLogEvent) => void;