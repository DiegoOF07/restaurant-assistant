import type { ClientCommand, ServerEvent } from "../../server/src/types.js";

export type { ClientCommand, ServerEvent };
export type { SessionState, ServerSummary } from "../../server/src/types.js";

/**
 * Cliente del backend. Los tipos se importan del propio backend, así que un cambio en el
 * contrato rompe la compilación en vez de aparecer como un campo undefined en pantalla.
 */

/** Abre el flujo de eventos. Devuelve una función para cerrarlo. */
export function subscribeToEvents(onEvent: (event: ServerEvent) => void, onError: () => void): () => void {
  const source = new EventSource("/api/events");

  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as ServerEvent);
    } catch {
      // Un evento ilegible no debe tumbar el flujo entero.
    }
  };

  // EventSource reintenta solo; onError sólo sirve para reflejar el estado en la interfaz.
  source.onerror = onError;

  return () => source.close();
}

export async function sendCommand(command: ClientCommand): Promise<void> {
  const response = await fetch("/api/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `el backend respondió ${response.status}`);
  }
}
