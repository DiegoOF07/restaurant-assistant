import type { ConversationEvent, LogEntry } from "@restaurant/host";
import type { ToolSpec } from "@restaurant/llm-provider";

/**
 * Contrato entre el backend y el navegador.
 *
 * Vive en un solo archivo a propósito: el frontend importa estos mismos tipos, así que un
 * cambio en el backend que rompa la interfaz falla al compilar y no en tiempo de ejecución.
 */

/** Estado de la sesión que la interfaz muestra en el encabezado. */
export interface SessionState {
  userRole: string;
  userId: string;
  model?: string;
  serverSource: string;
  servers: ServerSummary[];
  tools: ToolSpec[];
  /** Roles entre los que se puede cambiar. */
  availableRoles: string[];
}

export interface ServerSummary {
  name: string;
  /** Cómo se alcanza: el comando local o la URL remota. */
  target: string;
  toolNames: string[];
}

/** Eventos que el backend empuja al navegador por SSE. */
export type ServerEvent =
  | { kind: "state"; state: SessionState }
  | { kind: "assistant"; text: string; iterations: number }
  | { kind: "conversation"; event: ConversationEvent; serverName?: string }
  | { kind: "log"; entries: LogEntry[] }
  | { kind: "error"; message: string }
  /** El backend está esperando que el usuario apruebe una operación sensible. */
  | { kind: "confirmation_required"; requestId: string; toolName: string; args: Record<string, unknown> }
  | { kind: "confirmation_resolved"; requestId: string; approved: boolean }
  | { kind: "busy"; busy: boolean };

/** Peticiones que el navegador manda al backend. */
export type ClientCommand =
  | { kind: "message"; text: string }
  | { kind: "confirm"; requestId: string; approved: boolean }
  | { kind: "set_role"; role: string };
