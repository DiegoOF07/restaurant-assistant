import type { ConversationMessage } from "@restaurant/llm-provider";

/**
 * Session mantiene el historial de una conversación
 * No hay estado compartido entre instancias 
 */
export class Session {
  private readonly messages: ConversationMessage[] = [];

  constructor(readonly id: string) {}

  /** Copia de solo lectura del historial actual. */
  getHistory(): readonly ConversationMessage[] {
    return this.messages;
  }

  /** Usado por ConversationLoop para ir agregando mensajes del usuario,
   * del asistente y de resultados de herramienta a medida que ocurren */
  appendMessage(message: ConversationMessage): void {
    this.messages.push(message);
  }

  /** Estrategia de truncado simple */
  truncateToMaxMessages(maxMessages: number): void {
    while (this.messages.length > maxMessages) {
      const nextUserIndex = this.messages.findIndex(
        (m, idx) => idx > 0 && m.role === "user",
      );
      if (nextUserIndex === -1) {
        break;
      }
      this.messages.splice(0, nextUserIndex);
    }
  }

  get length(): number {
    return this.messages.length;
  }
}