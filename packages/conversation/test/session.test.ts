import { describe, it, expect } from "vitest";
import { Session } from "../src/session.js";

describe("Session", () => {
  it("acumula mensajes en el orden en que se agregan", () => {
    const session = new Session("s1");
    session.appendMessage({ role: "user", content: "hola" });
    session.appendMessage({ role: "assistant", content: "hola, ¿en qué ayudo?" });

    expect(session.getHistory()).toHaveLength(2);
    expect(session.length).toBe(2);
  });

  it("truncateToMaxMessages no corta si ya se está dentro del límite", () => {
    const session = new Session("s1");
    session.appendMessage({ role: "user", content: "hola" });
    session.appendMessage({ role: "assistant", content: "hola" });

    session.truncateToMaxMessages(10);

    expect(session.length).toBe(2);
  });

  it("truncateToMaxMessages elimina turnos completos más antiguos, nunca a la mitad", () => {
    const session = new Session("s1");
    // Turno 1: 2 mensajes
    session.appendMessage({ role: "user", content: "turno 1" });
    session.appendMessage({ role: "assistant", content: "respuesta 1" });
    // Turno 2: 4 mensajes (incluye un intercambio de tool-calling)
    session.appendMessage({ role: "user", content: "turno 2" });
    session.appendMessage({ role: "assistant", content: "", toolCalls: [{ id: "c1", name: "x", arguments: {} }] });
    session.appendMessage({ role: "tool", toolCallId: "c1", toolName: "x", content: "resultado" });
    session.appendMessage({ role: "assistant", content: "respuesta 2" });
    // Turno 3: 2 mensajes
    session.appendMessage({ role: "user", content: "turno 3" });
    session.appendMessage({ role: "assistant", content: "respuesta 3" });

    expect(session.length).toBe(8);

    session.truncateToMaxMessages(6);

    // Debe haber eliminado el turno 1 completo (2 mensajes), dejando 6.
    // No debe haber quedado un mensaje "tool" huérfano al inicio.
    expect(session.length).toBe(6);
    expect(session.getHistory()[0]).toMatchObject({ role: "user", content: "turno 2" });
  });

  it("no elimina el último turno aunque siga excediendo el límite", () => {
    const session = new Session("s1");
    session.appendMessage({ role: "user", content: "único turno" });
    session.appendMessage({ role: "assistant", content: "", toolCalls: [{ id: "c1", name: "x", arguments: {} }] });
    session.appendMessage({ role: "tool", toolCallId: "c1", toolName: "x", content: "resultado" });
    session.appendMessage({ role: "assistant", content: "respuesta" });

    session.truncateToMaxMessages(1); // imposible de cumplir sin romper el único turno

    // Se detiene sin dejar el historial vacío ni inválido.
    expect(session.length).toBe(4);
  });
});