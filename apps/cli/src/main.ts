import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { HostService } from "@restaurant/host";
import { AnthropicProvider, type LLMProvider } from "@restaurant/llm-provider";
import { loadDotEnv } from "./dotenv.js";
import { loadConfig, ConfigError } from "./config.js";
import { HeuristicDemoProvider } from "./demoProvider.js";
import { createLineSourceConfirmationHandler } from "./confirmation.js";
import { LineSource } from "./lineSource.js";
import { runRepl } from "./repl.js";
import { SYSTEM_PROMPT } from "./systemPrompt.js";

/** Raíz del paquete @restaurant/cli (dist/ o src/ -> ..) */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  // El .env y MCP_SERVER_BIN se resuelven respecto al paquete del CLI, no al cwd,
  // para que `node dist/main.js` funcione desde cualquier directorio.
  loadDotEnv(path.join(packageRoot, ".env"));

  let config;
  try {
    config = loadConfig(process.env, packageRoot);
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

  // Cambiar de proveedor LLM es exactamente esto: elegir otra implementación de LLMProvider.
  // Nada más del sistema cambia (sección 5.3 del plan).
  let provider: LLMProvider;
  if (config.anthropicApiKey) {
    provider = new AnthropicProvider({
      apiKey: config.anthropicApiKey,
      ...(config.anthropicModel ? { model: config.anthropicModel } : {}),
    });
    console.log(`[INFO]  Usando la API de Anthropic (modelo: ${config.anthropicModel ?? "por defecto"}).\n`);
  } else {
    provider = new HeuristicDemoProvider();
    console.log(
      "[INFO]  Sin ANTHROPIC_API_KEY: usando el proveedor de demostración basado en palabras clave.\n" +
        "        Define ANTHROPIC_API_KEY en apps/cli/.env para conectar un LLM real.\n",
    );
  }

  console.log(`[INFO]  Sesión iniciada como rol "${config.userRole}" (usuario: ${config.userId}).\n`);

  let host: HostService;
  try {
    host = await HostService.create({
      provider,
      servers: [
        {
          name: "restaurant-local",
          command: config.mcpServerBin,
          args: config.mcpServerArgs,
          env: { MCP_USER_ROLE: config.userRole, MCP_USER_ID: config.userId },
        },
      ],
      systemPrompt: SYSTEM_PROMPT,
      toolsRequiringConfirmation: ["adjust_inventory"],
      requestConfirmation: createLineSourceConfirmationHandler(rl, lines),
      maxIterations: config.maxIterations,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `\nNo se pudo iniciar el servidor MCP configurado en MCP_SERVER_BIN (${config.mcpServerBin}).\n` +
        `Detalle: ${message}\n`,
    );
    rl.close();
    process.exitCode = 1;
    return;
  }

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