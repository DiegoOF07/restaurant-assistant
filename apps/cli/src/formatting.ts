import type { LogEntry } from "@restaurant/host";
import type { ToolSpec } from "@restaurant/llm-provider";

export function formatWelcomeBanner(tools: ToolSpec[]): string {
  const toolNames = tools.map((t) => `  - ${t.name}: ${t.description}`).join("\n");
  return [
    "== Asistente MCP de Restaurante (CLI) ==",
    "",
    "Herramientas disponibles:",
    toolNames || "  (ninguna)",
    "",
    "Comandos: /tools  /log  /exit",
    "Escribe tu mensaje y presiona Enter.",
    "",
  ].join("\n");
}

export function formatLogEntry(entry: LogEntry): string {
  const okMark = entry.ok === undefined ? "" : entry.ok ? " [OK]" : " [FALLÓ]";
  const tool = entry.toolName ? ` (${entry.toolName})` : "";
  const method = entry.method ? ` [${entry.method}]` : "";
  const time = new Date(entry.timestamp).toISOString().split("T")[1]?.replace("Z", "");
  return `[${time}] [${entry.source}] ${entry.kind}${tool}${method}${okMark}`;
}