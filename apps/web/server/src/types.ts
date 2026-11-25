import type { ConversationEvent, LogEntry } from "@restaurant/host";
import type { ToolSpec } from "@restaurant/llm-provider";
import type { ConfirmationText, Summary } from "@restaurant/presentation";

export type { ConfirmationText, Summary, Tone } from "@restaurant/presentation";

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
  /** Roles entre los que se puede cambiar, con el nombre que ve el personal. */
  roles: { id: string; label: string }[];
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
  /** `summary` acompaña a los resultados y errores de herramientas, ya en lenguaje de cocina. */
  | { kind: "conversation"; event: ConversationEvent; serverName?: string; summary?: Summary }
  | { kind: "log"; entries: LogEntry[] }
  | { kind: "error"; message: string }
  /** El backend está esperando que el usuario apruebe una operación sensible. */
  | { kind: "confirmation_required"; requestId: string; toolName: string; args: Record<string, unknown>; text: ConfirmationText }
  | { kind: "confirmation_resolved"; requestId: string; approved: boolean }
  | { kind: "busy"; busy: boolean };

/** Peticiones que el navegador manda al backend. */
export type ClientCommand =
  | { kind: "message"; text: string }
  | { kind: "confirm"; requestId: string; approved: boolean }
  | { kind: "set_role"; role: string };
