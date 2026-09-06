import { describe, it, expect } from "vitest";
import type { ConversationEvent } from "@restaurant/conversation";
import type { McpLogEvent } from "@restaurant/mcp-client";
import { McpLogger, sanitize } from "../src/mcpLogger.js";

describe("sanitize", () => {
  it("redacta claves que lucen como secretos, sin importar el anidamiento", () => {
    const input = {
      dishId: "special-burger",
      clientInfo: { apiKey: "sk-super-secreto", name: "host" },
      headers: { Authorization: "Bearer abc123" },
      nested: [{ password: "hunter2" }, { ok: true }],
    };

    const result = sanitize(input) as Record<string, unknown>;

    expect(result.dishId).toBe("special-burger");
    expect((result.clientInfo as Record<string, unknown>).apiKey).toBe("[REDACTED]");
    expect((result.clientInfo as Record<string, unknown>).name).toBe("host");
    expect((result.headers as Record<string, unknown>).Authorization).toBe("[REDACTED]");
    expect(((result.nested as unknown[])[0] as Record<string, unknown>).password).toBe("[REDACTED]");
  });

  it("no toca valores primitivos ni arreglos sin objetos", () => {
    expect(sanitize("hola")).toBe("hola");
    expect(sanitize(42)).toBe(42);
    expect(sanitize([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe("McpLogger", () => {
  it("separa las entradas de cada sesión sin mezclarlas", () => {
    const logger = new McpLogger();
    const event: ConversationEvent = {
      kind: "tool_call_requested",
      toolCall: { id: "c1", name: "search_dishes", arguments: {} },
      timestamp: Date.now(),
    };

    logger.recordConversationEvent("session-a", event);
    logger.recordConversationEvent("session-b", event);

    expect(logger.getEntries("session-a")).toHaveLength(1);
    expect(logger.getEntries("session-b")).toHaveLength(1);
    expect(logger.getEntries("session-a")[0]?.sessionId).toBe("session-a");
  });

  it("preserva el orden de llegada dentro de una misma sesión (por sequence)", () => {
    const logger = new McpLogger();
    const toolCall = { id: "c1", name: "search_dishes", arguments: {} };

    logger.recordConversationEvent("s1", { kind: "tool_call_requested", toolCall, timestamp: 1 });
    logger.recordConversationEvent("s1", { kind: "tool_call_result", toolCall, isError: false, timestamp: 2 });

    const entries = logger.getEntries("s1");
    expect(entries.map((e) => e.kind)).toEqual(["tool_call_requested", "tool_call_result"]);
    expect(entries[0]!.sequence).toBeLessThan(entries[1]!.sequence);
  });

  it("registra eventos de mcp-client con el nombre del servidor y sanea los datos", () => {
    const logger = new McpLogger();
    const mcpEvent: McpLogEvent = {
      direction: "to-server",
      kind: "request",
      method: "tools/call",
      id: 5,
      timestamp: Date.now(),
    };

    logger.recordMcpEvent("s1", "restaurant-local", mcpEvent);

    const entries = logger.getEntries("s1");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ source: "mcp", direction: "to-server", method: "tools/call" });
    expect((entries[0]!.detail as Record<string, unknown>).server).toBe("restaurant-local");
  });

  it("combina eventos de conversation y de mcp en un mismo log de sesión", () => {
    const logger = new McpLogger();
    logger.recordConversationEvent("s1", {
      kind: "tool_call_requested",
      toolCall: { id: "c1", name: "search_dishes", arguments: {} },
      timestamp: 1,
    });
    logger.recordMcpEvent("s1", "restaurant-local", {
      direction: "to-server",
      kind: "request",
      method: "tools/call",
      id: 1,
      timestamp: 2,
    });

    const entries = logger.getEntries("s1");
    expect(entries.map((e) => e.source)).toEqual(["conversation", "mcp"]);
  });

  it("registra un error de protocolo con ok:false y el detalle del mensaje", () => {
    const logger = new McpLogger();
    logger.recordConversationEvent("s1", {
      kind: "tool_call_protocol_error",
      toolCall: { id: "c1", name: "does_not_exist", arguments: {} },
      message: "unknown tool: does_not_exist",
      timestamp: 1,
    });

    const entry = logger.getEntries("s1")[0]!;
    expect(entry.ok).toBe(false);
    expect(entry.detail).toBe("unknown tool: does_not_exist");
  });
});