import type { LogEntry } from "@restaurant/host";
import type { ToolSpec } from "@restaurant/llm-provider";
import { blue, bold, box, cyan, dim, gray, green, magenta, red, symbols, yellow } from "./theme.js";

/** Datos de la sesión que se muestran en el encabezado. */
export interface BannerInfo {
  tools: ToolSpec[];
  userRole: string;
  userId: string;
  /** Modelo en uso, o undefined si se está usando el proveedor de demostración. */
  model?: string;
  /** De dónde salió la lista de servidores, para que se vea qué archivo hay que editar. */
  serverSource: string;
  serverNames: string[];
  /** Servidor que expone cada herramienta; sólo se muestra si hay más de uno. */
  serverForTool?: (toolName: string) => string | undefined;
}

/** Encabezado de arranque: identidad, modelo, servidores y catálogo de herramientas. */
export function formatWelcomeBanner(info: BannerInfo): string {
  const header = box(
    [
      bold("Asistente MCP de Restaurante"),
      dim("Host + cliente MCP sobre JSON-RPC 2.0, sin SDK"),
    ],
    { color: cyan },
  );

  const multipleServers = info.serverNames.length > 1;
  const lines: string[] = [
    "",
    `${gray("sesión")}    ${bold(info.userId)} ${dim("·")} rol ${roleBadge(info.userRole)}`,
    `${gray("modelo")}    ${info.model ? bold(info.model) : yellow("demostración (sin API key)")}`,
    `${gray("servidor")}  ${info.serverNames.map((n) => bold(n)).join(dim(", "))} ${dim(`(${info.serverSource})`)}`,
    "",
    bold(`Herramientas disponibles (${info.tools.length})`),
  ];

  if (info.tools.length === 0) {
    lines.push(dim("  (ninguna)"));
  } else {
    for (const tool of info.tools) {
      const origin = multipleServers ? info.serverForTool?.(tool.name) : undefined;
      lines.push(`  ${cyan(symbols.bullet)} ${bold(tool.name)}${origin ? dim(` · ${origin}`) : ""}`);
      lines.push(`    ${dim(truncate(describe(tool), 200))}`);
    }
  }

  lines.push(
    "",
    `${bold("Comandos")}  ${command("/tools")} ${command("/servers")} ${command("/log")} ${command("/clear")} ${command("/help")} ${command("/exit")}`,
    dim("Escribe tu mensaje y presiona Enter."),
    "",
  );

  return `${header}\n${lines.join("\n")}`;
}

/** Tabla de comandos, con los nombres alineados. */
export function formatHelp(): string {
  const rows: Array<[string, string]> = [
    ["/tools", "lista las herramientas MCP descubiertas y qué servidor las expone"],
    ["/servers", "muestra los servidores MCP conectados y de dónde salió su configuración"],
    ["/log", "muestra el registro del protocolo MCP y del ciclo de conversación"],
    ["/clear", "limpia la pantalla sin perder el historial de la conversación"],
    ["/help", "muestra esta ayuda"],
    ["/exit", "cierra la sesión (también funciona Ctrl+D)"],
  ];
  const width = Math.max(...rows.map(([name]) => name.length));
  return rows.map(([name, description]) => `  ${command(name.padEnd(width))}  ${dim(description)}`).join("\n");
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

/** Actividad en vivo: el asistente decidió llamar a una herramienta. */
export function formatToolCallLine(toolName: string, args: Record<string, unknown>, server?: string): string {
  const rendered = renderArgs(args);
  return `${blue(symbols.tool)} ${bold(toolName)}${server ? dim(` · ${server}`) : ""}${rendered ? dim(`(${rendered})`) : ""}`;
}

/** Cierre de una llamada. Un error de negocio se marca, pero no interrumpe la conversación. */
export function formatToolResultLine(toolName: string, isError: boolean): string {
  return isError
    ? `${red(symbols.fail)} ${bold(toolName)} ${red("devolvió un error")}`
    : `${green(symbols.ok)} ${bold(toolName)} ${dim("listo")}`;
}

/** Argumentos en una línea, recortados: el detalle completo queda en /log. */
function renderArgs(args: Record<string, unknown>): string {
  const parts = Object.entries(args).map(([key, value]) => `${key}=${truncate(stringify(value), 40)}`);
  return truncate(parts.join(", "), 100);
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
}

/** Error destacado en rojo, separado del texto del asistente por líneas en blanco. */
export function formatError(message: string): string {
  return `\n${red(`${symbols.fail} ${bold("Error")}`)} ${message}\n`;
}

/** Aviso que no impide continuar, por ejemplo arrancar sin API key. */
export function formatWarning(message: string): string {
  return `${yellow(`${symbols.warn} ${message}`)}`;
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
      return magenta(bold(role));
    case "cook":
      return yellow(bold(role));
    case "waiter":
      return green(bold(role));
    default:
      return red(`${bold(role)} (desconocido, el servidor usará waiter)`);
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

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
