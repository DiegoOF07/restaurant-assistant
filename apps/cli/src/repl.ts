import type { Interface as ReadlineInterface } from "node:readline";
import type { ConversationEvent, HostService } from "@restaurant/host";
import { MaxIterationsExceededError } from "@restaurant/conversation";
import {
  formatAssistantReply,
  formatError,
  formatHelp,
  formatLogEntry,
  formatToolCallLine,
  formatToolList,
  formatToolResultLine,
  formatWelcomeBanner,
  type BannerInfo,
} from "./formatting.js";
import type { LineSource } from "./lineSource.js";
import { safePrompt } from "./promptUtils.js";
import { bold, cyan, dim, gray, green, rule, Spinner, symbols } from "./theme.js";

const SESSION_ID = "cli-session";

const PROMPT = `${green(symbols.user)} ${bold("tú")} ${dim("›")} `;

/** Datos de sesión que el REPL sólo muestra; no los interpreta. */
export interface ReplOptions {
  /** Todo lo que el encabezado necesita mostrar sobre la sesión. */
  banner: Omit<BannerInfo, "tools">;
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

  console.log(formatWelcomeBanner({ ...options.banner, tools, serverForTool }));

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

    if (input === "/exit") break;

    if (input.startsWith("/")) {
      handleCommand(input, host, tools, serverForTool, options);
      rl.setPrompt(PROMPT);
      safePrompt(rl);
      continue;
    }

    await runTurn(host, input, serverForTool);

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
): Promise<void> {
  const spinner = new Spinner("pensando...").start();

  const onEvent = (event: ConversationEvent) => {
    switch (event.kind) {
      case "tool_call_requested":
        spinner.stop();
        console.log(formatToolCallLine(event.toolCall.name, event.toolCall.arguments, serverForTool(event.toolCall.name)));
        spinner.update(`ejecutando ${event.toolCall.name}...`);
        spinner.start();
        break;

      case "tool_call_confirmation_required":
        spinner.stop();
        break;

      case "tool_call_confirmed":
        spinner.update(`ejecutando ${event.toolCall.name}...`);
        spinner.start();
        break;

      case "tool_call_result":
        spinner.stop();
        console.log(formatToolResultLine(event.toolCall.name, event.isError));
        spinner.update("pensando...");
        spinner.start();
        break;

      case "tool_call_protocol_error":
        spinner.stop();
        console.log(formatError(`${event.toolCall.name}: ${event.message}`));
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
): void {
  switch (input) {
    case "/help":
      console.log(`\n${bold("Comandos disponibles")}\n${formatHelp()}\n`);
      return;

    case "/tools":
      console.log(`\n${bold(`Herramientas disponibles (${tools.length})`)}\n${formatToolList(tools, serverForTool)}\n`);
      return;

    case "/servers": {
      const { serverNames, serverSource } = options.banner;
      console.log(`\n${bold(`Servidores MCP conectados (${serverNames.length})`)}`);
      for (const name of serverNames) {
        const owned = tools.filter((t) => serverForTool(t.name) === name).map((t) => t.name);
        console.log(`  ${cyan(symbols.bullet)} ${bold(name)} ${dim(`— ${owned.length} herramienta(s)`)}`);
        if (owned.length > 0) console.log(`    ${gray(owned.join(", "))}`);
      }
      console.log(`${dim(`Configuración: ${serverSource}`)}\n`);
      return;
    }

    case "/log": {
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

    case "/clear":
      console.clear();
      return;

    default:
      console.log(
        `\n${dim(`Comando desconocido: ${input}. Escribe /help para ver los disponibles.`)}\n`,
      );
  }
}

export { SESSION_ID };
