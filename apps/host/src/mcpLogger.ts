import type { McpLogEvent } from "@restaurant/mcp-client";
import type { ConversationEvent } from "@restaurant/conversation";
import type { LogEntry } from "./types.js";

/** Nombres de campo que nunca deben aparecer en texto plano en un log,
 * sin importar en qué nivel de anidamiento aparezcan */
const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|password|token|secret)/i;

/** Reemplaza recursivamente cualquier valor cuya clave luzca como un secreto con "[REDACTED]" */
export function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitize(v);
    }
    return result;
  }
  return value;
}

/**
 * McpLogger junta los eventos de protocolo (mcp-client, por servidor) y
 * los eventos del ciclo de conversación (packages/conversation) en un
 * único log correlacionado por sessionId
 */
export class McpLogger {
  private readonly entries: LogEntry[] = [];
  private sequence = 0;

  recordConversationEvent(sessionId: string, event: ConversationEvent): void {
    const base = { sequence: this.sequence++, sessionId, source: "conversation" as const, timestamp: event.timestamp };

    switch (event.kind) {
      case "tool_call_result":
        this.entries.push({ ...base, kind: event.kind, toolName: event.toolCall.name, ok: !event.isError });
        break;
      case "tool_call_protocol_error":
        this.entries.push({
          ...base,
          kind: event.kind,
          toolName: event.toolCall.name,
          ok: false,
          detail: event.message,
        });
        break;
      case "tool_call_requested":
      case "tool_call_confirmation_required":
      case "tool_call_confirmed":
      case "tool_call_rejected":
        this.entries.push({ ...base, kind: event.kind, toolName: event.toolCall.name });
        break;
      case "iteration_limit_reached":
        this.entries.push({ ...base, kind: event.kind, detail: { iterations: event.iterations } });
        break;
    }
  }

  recordMcpEvent(sessionId: string, serverName: string, event: McpLogEvent): void {
    this.entries.push({
      sequence: this.sequence++,
      sessionId,
      source: "mcp",
      timestamp: event.timestamp,
      direction: event.direction,
      kind: event.kind,
      method: event.method,
      ok: event.ok,
      detail: sanitize({ server: serverName, id: event.id }),
    });
  }

  /** Entradas de una sesión, en el orden en que ocurrieron */
  getEntries(sessionId: string): readonly LogEntry[] {
    return this.entries.filter((e) => e.sessionId === sessionId);
  }

  /** Todas las entradas de todas las sesiones, útil para el reporte final */
  getAllEntries(): readonly LogEntry[] {
    return this.entries;
  }
}