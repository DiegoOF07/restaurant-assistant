import type { ServerEvent } from "./types.js";

/** Un navegador suscrito al flujo de eventos. */
export interface Subscriber {
  send(event: ServerEvent): void;
}

/**
 * Eventos que describen el estado actual en vez de algo que ocurrió.
 *
 * Se guarda sólo el ÚLTIMO de cada tipo y se manda a quien se conecte. No van al historial:
 * repetir cada `busy` pasado dejaría la interfaz con un spinner colgado.
 */
const SNAPSHOT_KINDS = new Set<ServerEvent["kind"]>(["state", "busy"]);

/**
 * Reparte eventos a los navegadores conectados.
 *
 * Guarda lo ocurrido para que una pestaña que se conecta tarde, o que se recargó, reciba la
 * conversación en vez de una pantalla vacía.
 */
export class EventBus {
  private readonly subscribers = new Set<Subscriber>();
  private readonly recent: ServerEvent[] = [];
  private readonly snapshots = new Map<ServerEvent["kind"], ServerEvent>();

  constructor(private readonly historyLimit = 200) {}

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);

    // El estado va PRIMERO: sin él la interfaz no sabe ni qué rol ni qué servidores hay, y
    // se queda en "Conectando…". Se publica una sola vez al arrancar, así que si no se
    // guardara aquí, ningún navegador lo vería nunca.
    for (const event of this.snapshots.values()) subscriber.send(event);
    for (const event of this.recent) subscriber.send(event);

    return () => this.subscribers.delete(subscriber);
  }

  publish(event: ServerEvent): void {
    if (SNAPSHOT_KINDS.has(event.kind)) {
      this.snapshots.set(event.kind, event);
    } else {
      this.recent.push(event);
      if (this.recent.length > this.historyLimit) this.recent.shift();
    }

    for (const subscriber of this.subscribers) {
      try {
        subscriber.send(event);
      } catch {
        // Una pestaña que ya se cerró no debe interrumpir el reparto a las demás.
        this.subscribers.delete(subscriber);
      }
    }
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /**
   * Descarta la conversación pasada, conservando el estado actual.
   * Se usa al reiniciar la sesión por un cambio de rol: el historial ya no aplica, pero el
   * estado sí.
   */
  clearHistory(): void {
    this.recent.length = 0;
  }
}
