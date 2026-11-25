import type { Interface as ReadlineInterface } from "node:readline";
import type { ConversationEvent, HostService } from "@restaurant/host";
import { MaxIterationsExceededError } from "@restaurant/conversation";
import { summarizeProtocolError, summarizeToolResult } from "@restaurant/presentation";
import { parseCommand } from "./commands.js";
import {
  formatAssistantReply,
  formatError,
  formatHelp,
  formatLogEntry,
  formatStartup,
  formatToolList,
  formatToolRunning,
  renderSummary,
  type StartupInfo,
} from "./formatting.js";
import type { LineSource } from "./lineSource.js";
import { safePrompt } from "./promptUtils.js";
import { bold, cyan, dim, gray, green, rule, Spinner, symbols } from "./theme.js";

const SESSION_ID = "cli-session";

const PROMPT = `${green(symbols.user)} ${bold("tú")} ${dim("›")} `;

/** Datos de sesión que el REPL sólo muestra; no los interpreta. */
export interface ReplOptions {
  startup: StartupInfo;
  /** De dónde salió la lista de servidores, para /servidores. */
  serverSource: string;
  /** Servidores con "enabled": false en la configuración. */
  disabled: string[];
}

/** La última llamada a una herramienta, en crudo, para /detalles. */
interface LastCall {
  toolName: string;
  server?: string;
  args: Record<string, unknown>;
  outcome: unknown;
}

/** Corre el ciclo interactivo hasta que el usuario escriba /exit o cierre la entrada (Ctrl+D / EOF) */
export async function runRepl(
  rl: ReadlineInterface,
  lines: LineSource,
  host: HostService,
  options: ReplOptions,
): Promise<void> {
  const tools = await host.listAvailableTools();
  const serverForTool = (name: string) => host.serverForTool(name);
  const last: { call?: LastCall } = {};

  console.log(`${formatStartup(options.startup)}\n`);

  rl.setPrompt(PROMPT);
  safePrompt(rl);

  while (true) {
    const line = await lines.next();
    if (line === undefined) break; // EOF / Ctrl+D

    const input = line.trim();
    if (input.length === 0) {
      safePrompt(rl);
      continue;
    }

    if (input.startsWith("/")) {
      if (parseCommand(input).kind === "exit") break;
      handleCommand(input, host, tools, serverForTool, options, last.call);
      rl.setPrompt(PROMPT);
      safePrompt(rl);
      continue;
    }

    await runTurn(host, input, serverForTool, last);

    rl.setPrompt(PROMPT);
    safePrompt(rl);
  }
}

/**
 * Envía el mensaje y va mostrando la actividad conforme ocurre
 */
async function runTurn(
  host: HostService,
  input: string,
  serverForTool: (name: string) => string | undefined,
  last: { call?: LastCall },
): Promise<void> {
  const spinner = new Spinner("pensando...").start();

  const onEvent = (event: ConversationEvent) => {
    switch (event.kind) {
      case "tool_call_requested":
        spinner.stop();
        console.log(formatToolRunning(event.toolCall.name));
        last.call = { toolName: event.toolCall.name, server: serverForTool(event.toolCall.name), args: event.toolCall.arguments, outcome: undefined };
        spinner.update("trabajando...");
        spinner.start();
        break;
      case "tool_call_confirmation_required":
        spinner.stop();
        break;
      case "tool_call_confirmed":
        spinner.update("trabajando...");
        spinner.start();
        break;
      case "tool_call_rejected":
        if (last.call) last.call.outcome = "cancelada por el usuario";
        break;
      case "tool_call_result":
        spinner.stop();
        console.log(`${renderSummary(summarizeToolResult(event.toolCall.name, event.result, host.names()))}\n`);
        if (last.call) last.call.outcome = event.result;
        spinner.update("pensando...");
        spinner.start();
        break;
      case "tool_call_protocol_error":
        spinner.stop();
        console.log(`${renderSummary(summarizeProtocolError(event.toolCall.name, event.message))}\n`);
        if (last.call) last.call.outcome = { protocolError: event.message };
        spinner.start();
        break;
      default:
        break;
    }
  };

  try {
    const result = await host.sendMessage(SESSION_ID, input, onEvent);
    spinner.stop();
    console.log(formatAssistantReply(result.reply));
  } catch (err) {
    spinner.stop();
    if (err instanceof MaxIterationsExceededError) {
      console.log(
        formatError("No pude completar tu solicitud en un número razonable de pasos. Intenta reformularla."),
      );
    } else {
      console.log(formatError(err instanceof Error ? err.message : String(err)));
    }
  }
}

function handleCommand(
  input: string,
  host: HostService,
  tools: Awaited<ReturnType<HostService["listAvailableTools"]>>,
  serverForTool: (name: string) => string | undefined,
  options: ReplOptions,
  lastCall: LastCall | undefined,
): void {
  const command = parseCommand(input);
  switch (command.kind) {
    case "help":
      console.log(`\n${bold("Comandos")}\n${formatHelp()}\n`);
      return;
    case "tools":
      console.log(`\n${bold(`Herramientas disponibles (${tools.length})`)}\n${formatToolList(tools, serverForTool)}\n`);
      return;
    case "servers": {
      const names = options.startup.serverNames;
      console.log(`\n${bold(`Servidores MCP conectados (${names.length})`)}`);
      for (const name of names) {
        const owned = tools.filter((t) => serverForTool(t.name) === name).map((t) => t.name);
        console.log(`  ${cyan(symbols.bullet)} ${bold(name)} ${dim(`— ${owned.length} herramienta(s)`)}`);
        if (owned.length > 0) console.log(`    ${gray(owned.join(", "))}`);
      }
      if (options.disabled.length > 0) console.log(dim(`  Desactivados en la configuración: ${options.disabled.join(", ")}`));
      console.log(`${dim(`Configuración: ${options.serverSource}`)}\n`);
      return;
    }
    case "log": {
      const entries = host.getLog(SESSION_ID);
      if (entries.length === 0) {
        console.log(`\n${dim("(sin eventos registrados todavía)")}\n`);
        return;
      }
      console.log(`\n${bold(`Registro de la sesión (${entries.length} eventos)`)}`);
      console.log(rule());
      for (const entry of entries) console.log(formatLogEntry(entry));
      console.log(`${rule()}\n`);
      return;
    }
    case "details":
      if (!lastCall) {
        console.log(`\n${dim("Todavía no se ha llamado ninguna herramienta.")}\n`);
        return;
      }
      console.log(`\n${bold("Última llamada")}`);
      console.log(`  ${gray("herramienta")} ${lastCall.toolName}${lastCall.server ? dim(` · ${lastCall.server}`) : ""}`);
      console.log(`  ${gray("argumentos")}\n${indentJson(lastCall.args)}`);
      console.log(`  ${gray("resultado")}\n${indentJson(lastCall.outcome ?? "(sin resultado todavía)")}\n`);
      return;
    case "clear":
      console.clear();
      return;
    case "unknown":
      console.log(
        `\n${dim(`Comando desconocido: ${input}.${command.suggestion ? ` ¿Quisiste decir ${command.suggestion}?` : ""} Escribe /ayuda para ver los disponibles.`)}\n`,
      );
      return;
    default:
      return;
  }
}

function indentJson(value: unknown): string {
  return (JSON.stringify(value, null, 2) ?? String(value))
    .split("\n")
    .map((line) => `    ${dim(line)}`)
    .join("\n");
}

export { SESSION_ID };
