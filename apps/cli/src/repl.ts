import type { Interface as ReadlineInterface } from "node:readline";
import type { HostService } from "@restaurant/host";
import { MaxIterationsExceededError } from "@restaurant/conversation";
import { formatLogEntry, formatWelcomeBanner } from "./formatting.js";
import type { LineSource } from "./lineSource.js";

const SESSION_ID = "cli-session";

/** Corre el ciclo interactivo hasta que el usuario escriba /exit o cierre la entrada */
export async function runRepl(rl: ReadlineInterface, lines: LineSource, host: HostService): Promise<void> {
  const tools = await host.listAvailableTools();
  console.log(formatWelcomeBanner(tools));
  rl.setPrompt("tú> ");
  rl.prompt();

  while (true) {
    const line = await lines.next();
    if (line === undefined) break; // EOF / Ctrl+D

    const input = line.trim();
    if (input.length === 0) {
      rl.prompt();
      continue;
    }

    if (input === "/exit") {
      break;
    }

    if (input === "/tools") {
      for (const tool of tools) console.log(`  - ${tool.name}: ${tool.description}`);
      rl.prompt();
      continue;
    }

    if (input === "/log") {
      const entries = host.getLog(SESSION_ID);
      if (entries.length === 0) {
        console.log("(sin eventos registrados todavía)");
      } else {
        for (const entry of entries) console.log(formatLogEntry(entry));
      }
      rl.prompt();
      continue;
    }

    try {
      const result = await host.sendMessage(SESSION_ID, input);
      console.log(`\n${result.reply}\n`);
    } catch (err) {
      if (err instanceof MaxIterationsExceededError) {
        console.log("\n  No pude completar tu solicitud en un número razonable de pasos. Intenta reformularla.\n");
      } else {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`\n  Ocurrió un error inesperado: ${message}\n`);
      }
    }
    rl.setPrompt("tú> ");
    rl.prompt();
  }
}

export { SESSION_ID };