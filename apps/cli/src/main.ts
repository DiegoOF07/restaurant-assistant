import * as readline from "node:readline";
import { HostService } from "@restaurant/host";
import { loadConfig, ConfigError } from "./config.js";
import { HeuristicDemoProvider } from "./demoProvider.js";
import { createLineSourceConfirmationHandler } from "./confirmation.js";
import { LineSource } from "./lineSource.js";
import { runRepl } from "./repl.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = new LineSource(rl);

  const provider = new HeuristicDemoProvider();
  console.log(
    "[INFO] Usando un proveedor de demostración basado en palabras clave (todavía no hay un LLM real conectado).\n",
  );

  const host = await HostService.create({
    provider,
    servers: [{ name: "restaurant-local", command: config.mcpServerBin, args: config.mcpServerArgs }],
    toolsRequiringConfirmation: ["adjust_inventory"],
    requestConfirmation: createLineSourceConfirmationHandler(rl, lines),
    maxIterations: config.maxIterations,
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nCerrando...");
    rl.close();
    await host.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);

  await runRepl(rl, lines, host);
  await shutdown();
}

main().catch((err) => {
  console.error("Fallo fatal:", err);
  process.exitCode = 1;
});