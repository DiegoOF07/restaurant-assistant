import { describe, it, expect } from "vitest";
import { EventBus } from "../src/eventBus.js";
import type { ServerEvent } from "../src/types.js";

function collector() {
  const received: ServerEvent[] = [];
  return { received, subscriber: { send: (event: ServerEvent) => received.push(event) } };
}

describe("EventBus", () => {
  it("entrega los eventos a todos los suscriptores", () => {
    const bus = new EventBus();
    const a = collector();
    const b = collector();
    bus.subscribe(a.subscriber);
    bus.subscribe(b.subscriber);

    bus.publish({ kind: "assistant", text: "hola", iterations: 1 });

    expect(a.received).toHaveLength(1);
    expect(b.received).toHaveLength(1);
  });

  it("repite el historial a quien se conecta tarde", () => {
    const bus = new EventBus();
    bus.publish({ kind: "assistant", text: "primero", iterations: 1 });
    bus.publish({ kind: "assistant", text: "segundo", iterations: 1 });

    // Una pestaña recién abierta debe ver la conversación, no una pantalla en blanco.
    const tarde = collector();
    bus.subscribe(tarde.subscriber);

    expect(tarde.received.map((e) => (e.kind === "assistant" ? e.text : ""))).toEqual(["primero", "segundo"]);
  });

  // Este es el fallo que dejaba la interfaz en "Conectando…": el estado se publica una sola
  // vez al arrancar, antes de que exista ningún navegador. Si no se guarda, nadie lo ve.
  it("entrega el estado actual a quien se conecta después de publicarlo", () => {
    const bus = new EventBus();
    const estado = { kind: "state", state: { userRole: "cook" } } as never;
    bus.publish(estado);

    const tarde = collector();
    bus.subscribe(tarde.subscriber);

    expect(tarde.received).toEqual([estado]);
  });

  it("guarda sólo el último estado, no todos los que hubo", () => {
    const bus = new EventBus();
    bus.publish({ kind: "state", state: { userRole: "cook" } } as never);
    bus.publish({ kind: "state", state: { userRole: "waiter" } } as never);

    const tarde = collector();
    bus.subscribe(tarde.subscriber);

    expect(tarde.received).toHaveLength(1);
    expect(tarde.received[0]).toMatchObject({ state: { userRole: "waiter" } });
  });

  it("manda el estado ANTES que la conversación", () => {
    // Al revés, la interfaz pintaría mensajes sin saber de qué sesión son.
    const bus = new EventBus();
    bus.publish({ kind: "assistant", text: "hola", iterations: 1 });
    bus.publish({ kind: "state", state: { userRole: "cook" } } as never);

    const tarde = collector();
    bus.subscribe(tarde.subscriber);

    expect(tarde.received.map((e) => e.kind)).toEqual(["state", "assistant"]);
  });

  it("no acumula los busy pasados, que dejarían un spinner colgado", () => {
    const bus = new EventBus();
    bus.publish({ kind: "busy", busy: true });
    bus.publish({ kind: "busy", busy: false });
    bus.publish({ kind: "assistant", text: "hola", iterations: 1 });

    const tarde = collector();
    bus.subscribe(tarde.subscriber);

    const busies = tarde.received.filter((e) => e.kind === "busy");
    expect(busies).toHaveLength(1);
    expect(busies[0]).toMatchObject({ busy: false });
  });

  it("recorta el historial al límite configurado", () => {
    const bus = new EventBus(3);
    for (let i = 0; i < 10; i++) bus.publish({ kind: "assistant", text: `${i}`, iterations: 1 });

    const tarde = collector();
    bus.subscribe(tarde.subscriber);

    expect(tarde.received).toHaveLength(3);
    expect(tarde.received.map((e) => (e.kind === "assistant" ? e.text : ""))).toEqual(["7", "8", "9"]);
  });

  it("deja de repartir a un suscriptor cancelado", () => {
    const bus = new EventBus();
    const uno = collector();
    const cancelar = bus.subscribe(uno.subscriber);

    cancelar();
    bus.publish({ kind: "assistant", text: "hola", iterations: 1 });

    expect(uno.received).toHaveLength(0);
    expect(bus.subscriberCount).toBe(0);
  });

  it("descarta al suscriptor que falla, sin cortar el reparto a los demás", () => {
    const bus = new EventBus();
    const sano = collector();

    // Una pestaña que ya se cerró lanza al escribirle; no debe impedir el reparto.
    bus.subscribe({
      send() {
        throw new Error("conexión cerrada");
      },
    });
    bus.subscribe(sano.subscriber);

    bus.publish({ kind: "assistant", text: "hola", iterations: 1 });

    expect(sano.received).toHaveLength(1);
    expect(bus.subscriberCount).toBe(1);
  });

  it("clearHistory borra la conversación pero conserva el estado", () => {
    // Tras cambiar de rol el historial ya no aplica, pero el estado sí: sin él la interfaz
    // volvería a quedarse en blanco.
    const bus = new EventBus();
    bus.publish({ kind: "state", state: { userRole: "cook" } } as never);
    bus.publish({ kind: "assistant", text: "viejo", iterations: 1 });
    bus.clearHistory();

    const tarde = collector();
    bus.subscribe(tarde.subscriber);

    expect(tarde.received.map((e) => e.kind)).toEqual(["state"]);
  });
});
