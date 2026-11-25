import type { LogEntry } from "@restaurant/host";
import type { ToolSpec } from "@restaurant/llm-provider";
import { humanizeToolName, type Summary, type Tone } from "@restaurant/presentation";
import { blue, bold, cyan, dim, gray, green, magenta, red, symbols, terminalWidth, visibleWidth, yellow } from "./theme.js";

/** Datos de la sesión que se muestran al arrancar. */
export interface StartupInfo {
  userRole: string;
  userId: string;
  /** Modelo en uso, o undefined si se está usando el proveedor de demostración. */
  model?: string;
  serverNames: string[];
  width?: number;
}

const ROLE_LABELS: Record<string, string> = { cook: "Cocina", waiter: "Mesero", admin: "Administración" };

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** Arranque corto: quién eres, con qué modelo, qué servidores y cómo pedir ayuda. */
export function formatStartup(info: StartupInfo): string {
  const width = Math.min(info.width ?? terminalWidth(), 72);
  return [
    red("─".repeat(Math.min(width, 40))),
    `${bold("La Comanda")} ${dim("· asistente de cocina")}`,
    `${gray("rol")}        ${roleBadge(info.userRole)} ${dim("·")} ${gray("usuario")} ${info.userId}`,
    `${gray("modelo")}     ${info.model ? bold(info.model) : yellow("demostración (sin API key)")}`,
    `${gray("servidores")} ${info.serverNames.map((n) => bold(n)).join(dim(", "))}`,
    dim(`Escribe ${command("/ayuda")} para ver los comandos.`),
  ].join("\n");
}

const TONE_STYLE: Record<Tone, [string, (t: string) => string]> = {
  ok: [symbols.ok, green],
  warn: [symbols.warn, yellow],
  error: [symbols.fail, red],
  info: [symbols.bullet, cyan],
};

/** Un resultado ya traducido a lenguaje de cocina: título con su tono, líneas y una tabla corta. */
export function renderSummary(summary: Summary): string {
  const [icon, paint] = TONE_STYLE[summary.tone];
  const out = [`${paint(`${icon} ${bold(summary.title)}`)}`];
  for (const line of summary.lines) out.push(`  ${line}`);
  if (summary.items?.length) {
    const labelWidth = Math.max(...summary.items.map((i) => visibleWidth(i.label)));
    for (const item of summary.items) {
      const value = item.tone ? TONE_STYLE[item.tone][1](item.value) : dim(item.value);
      out.push(`  ${item.label.padEnd(labelWidth)}  ${value}`);
    }
  }
  return out.join("\n");
}

/** Línea mientras corre una herramienta, con su nombre legible. */
export function formatToolRunning(toolName: string): string {
  return `${blue(symbols.tool)} ${dim(`${humanizeToolName(toolName)}…`)}`;
}

/** Tabla de comandos, con los nombres alineados. */
export function formatHelp(): string {
  const rows: Array<[string, string]> = [
    ["/ayuda", "muestra esta ayuda"],
    ["/herramientas", "herramientas MCP y qué servidor las expone"],
    ["/servidores", "servidores conectados, desactivados y avisos de configuración"],
    ["/registro", "registro del protocolo MCP y del ciclo de conversación"],
    ["/detalles", "la última llamada en crudo: herramienta, argumentos y resultado"],
    ["/limpiar", "limpia la pantalla sin perder la conversación"],
    ["/salir", "cierra la sesión (también Ctrl+D)"],
  ];
  const width = Math.max(...rows.map(([name]) => name.length));
  return [
    ...rows.map(([name, description]) => `  ${command(name.padEnd(width))}  ${dim(description)}`),
    dim("  Los nombres en inglés (/help, /tools, /exit…) también funcionan."),
  ].join("\n");
}

/** Lista de herramientas para /tools. */
export function formatToolList(tools: ToolSpec[], serverForTool?: (name: string) => string | undefined): string {
  if (tools.length === 0) return dim("  (ninguna herramienta disponible)");

  return tools
    .map((tool) => {
      const origin = serverForTool?.(tool.name);
      const required = requiredParams(tool);
      return [
        `  ${cyan(symbols.bullet)} ${bold(tool.name)}${origin ? dim(` · ${origin}`) : ""}`,
        `    ${dim(describe(tool))}`,
        required.length > 0 ? `    ${gray(`parámetros: ${required.join(", ")}`)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

/** La descripción es opcional en MCP: sin esto, un servidor que la omita rompe la interfaz. */
function describe(tool: ToolSpec): string {
  return tool.description?.trim() || "(sin descripción)";
}

function requiredParams(tool: ToolSpec): string[] {
  const schema = tool.inputSchema as { required?: unknown } | undefined;
  const required = schema?.required;
  return Array.isArray(required) ? required.filter((r): r is string => typeof r === "string") : [];
}

/** Cabecera de la respuesta del asistente, para separarla visualmente de lo que escribió el usuario. */
export function formatAssistantReply(reply: string): string {
  return `\n${magenta(symbols.robot)} ${bold("asistente")}\n${indent(reply, "  ")}\n`;
}

/** Error destacado en rojo, separado del texto del asistente por líneas en blanco. */
export function formatError(message: string): string {
  return `\n${red(`${symbols.fail} ${bold("Error")}`)} ${message}\n`;
}

/** Nota informativa de una línea. */
export function formatInfo(message: string): string {
  return `${cyan(symbols.arrow)} ${message}`;
}

/** Una línea de /log: hora, estado, origen y detalle, en columnas fijas para poder escanearla. */
export function formatLogEntry(entry: LogEntry): string {
  const time = new Date(entry.timestamp).toISOString().split("T")[1]?.replace("Z", "") ?? "";
  const status = entry.ok === undefined ? "  " : entry.ok ? green(symbols.ok) : red(symbols.fail);
  const source = entry.source === "mcp" ? blue(entry.source.padEnd(12)) : magenta(entry.source.padEnd(12));
  const detail = [entry.toolName, entry.method].filter(Boolean).join(" ");

  return `${gray(time)} ${status} ${source} ${entry.kind}${detail ? dim(` ${detail}`) : ""}`;
}

function roleBadge(role: string): string {
  switch (role) {
    case "admin":
      return magenta(bold(roleLabel(role)));
    case "cook":
      return yellow(bold(roleLabel(role)));
    case "waiter":
      return green(bold(roleLabel(role)));
    default:
      return red(`${bold(role)} (desconocido, el servidor lo tratará como Mesero)`);
  }
}

function command(name: string): string {
  return cyan(name);
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

