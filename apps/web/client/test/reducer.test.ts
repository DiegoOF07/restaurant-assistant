import { describe, expect, it } from "vitest";
import { initialState, reducer, type State } from "../src/useAssistant.js";
import type { ServerEvent } from "../src/api.js";

const toolCall = { id: "c1", name: "adjust_inventory", arguments: { ingredientId: "lettuce" } };
const ev = (state: State, event: ServerEvent) => reducer(state, { type: "server_event", event });
const requested = ev(initialState, {
  kind: "conversation",
  serverName: "local",
  event: { kind: "tool_call_requested", toolCall, timestamp: 1 },
});
const lastTool = (s: State) => s.entries.filter((e) => e.kind === "tool").at(-1);

describe("reducer", () => {
  it("guarda el resumen y el resultado en la última herramienta", () => {
    const summary = { tone: "ok" as const, title: "Inventario actualizado", lines: ["Lechuga: 500 g → 300 g"] };
    const result = { content: [], structuredContent: { name: "Lechuga" } };
    const s = ev(requested, {
      kind: "conversation",
      summary,
      event: { kind: "tool_call_result", toolCall, isError: false, result, timestamp: 2 },
    });
    expect(lastTool(s)).toMatchObject({ kind: "tool", status: "ok", summary, result, server: "local" });
  });

  it("un error de protocolo marca la herramienta y guarda el detalle técnico sin agregar otro mensaje", () => {
    const summary = { tone: "error" as const, title: "No se pudo completar la operación", lines: [] };
    const s = ev(requested, {
      kind: "conversation",
      summary,
      event: { kind: "tool_call_protocol_error", toolCall, message: "idempotencyKey es obligatorio", timestamp: 2 },
    });
    expect(lastTool(s)).toMatchObject({ status: "error", summary, technicalError: "idempotencyKey es obligatorio" });
    expect(s.entries.filter((e) => e.kind === "error")).toHaveLength(0);
  });

  it("guarda y limpia la confirmación con su texto", () => {
    const text = { question: "¿Descontar 200 g de Lechuga?", details: ["Motivo: Se dañó."], confirmLabel: "Descontar" };
    const s = ev(requested, { kind: "confirmation_required", requestId: "r1", toolName: "adjust_inventory", args: {}, text });
    expect(s.confirmation).toMatchObject({ requestId: "r1", text });
    expect(ev(s, { kind: "confirmation_resolved", requestId: "r1", approved: false }).confirmation).toBeUndefined();
  });

  it("el registro se reemplaza y el estado reinicia la conversación", () => {
    const withLog = ev(requested, { kind: "log", entries: [{ sequence: 1, sessionId: "s", source: "mcp", kind: "request", timestamp: 1 }] as never });
    expect(withLog.log).toHaveLength(1);
    const reset = ev(withLog, {
      kind: "state",
      state: { userRole: "cook", userId: "d", serverSource: "x", servers: [], tools: [], roles: [] },
    });
    expect(reset.entries).toEqual([]);
    expect(reset.log).toEqual([]);
  });
});
