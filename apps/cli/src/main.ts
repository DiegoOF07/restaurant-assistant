import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { HostService } from "@restaurant/host";
import { AnthropicProvider, type LLMProvider } from "@restaurant/llm-provider";
import { loadDotEnv } from "./dotenv.js";
import { loadConfig, ConfigError } from "./config.js";
import { HeuristicDemoProvider } from "./demoProvider.js";
import { createLineSourceConfirmationHandler } from "./confirmation.js";
import { formatError, formatInfo, formatWarning } from "./formatting.js";
import { LineSource } from "./lineSource.js";
import { runRepl } from "./repl.js";
import { resolveServers, DEFAULT_CONFIG_FILENAME } from "./serversConfig.js";
import { SYSTEM_PROMPT } from "./systemPrompt.js";
import { bold, dim, Spinner } from "./theme.js";

/** Raíz del paquete @restaurant/cli (dist/ o src/ -> ..) */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Sólo se acepta --config; el resto de la configuración vive en .env o en el archivo de servidores. */
function parseArgs(argv: string[]): { configPath?: string } {
  const index = argv.findIndex((arg) => arg === "--config" || arg.startsWith("--config="));
  if (index === -1) return {};

  const arg = argv[index]!;
  const value = arg.startsWith("--config=") ? arg.slice("--config=".length) : argv[index + 1];
  if (!value) throw new ConfigError("--config necesita una ruta: --config ./mi-configuracion.json");
  return { configPath: value };
}

async function main(): Promise<void> {
  // El .env y las rutas relativas se resuelven respecto al paquete del CLI, no al cwd,
  // para que `node dist/main.js` funcione desde cualquier directorio.
  loadDotEnv(path.join(packageRoot, ".env"));

  let config;
  let resolved;
  try {
    const args = parseArgs(process.argv.slice(2));
    config = loadConfig(process.env);
    resolved = resolveServers({
      baseDir: packageRoot,
      env: process.env,
      ...(args.configPath ?? config.configPath ? { configPath: args.configPath ?? config.configPath } : {}),
      // La identidad se inyecta en TODO servidor: es el host quien declara en nombre de
      // quién actúa, no cada entrada del archivo.
      defaultEnv: { MCP_USER_ROLE: config.userRole, MCP_USER_ID: config.userId },
    });
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(formatError(err.message));
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
  } else {
    provider = new HeuristicDemoProvider();
    console.log(
      formatWarning(
        "Sin ANTHROPIC_API_KEY: se usa el proveedor de demostración basado en palabras clave.",
      ) + dim("\n  Define ANTHROPIC_API_KEY en apps/cli/.env para conectar un LLM real.\n"),
    );
  }

  if (resolved.disabled.length > 0) {
    console.log(dim(`  Servidores desactivados en la configuración: ${resolved.disabled.join(", ")}`));
  }

  const spinner = new Spinner(
    `conectando con ${resolved.servers.length} servidor(es) MCP...`,
  ).start();

  let host: HostService;
  try {
    host = await HostService.create({
      provider,
      servers: resolved.servers,
      systemPrompt: SYSTEM_PROMPT,
      toolsRequiringConfirmation: ["adjust_inventory"],
      requestConfirmation: createLineSourceConfirmationHandler(rl, lines),
      maxIterations: config.maxIterations,
    });
    spinner.stop();
  } catch (err) {
    spinner.stop();
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      formatError(
        `No se pudo iniciar alguno de los servidores MCP configurados.\n\n` +
          `  Servidores: ${resolved.servers.map((s) => `${s.name} -> ${s.command}`).join("\n              ")}\n` +
          `  Configuración: ${describeSource(resolved)}\n\n` +
          `  Detalle: ${message}`,
      ),
    );
    rl.close();
    process.exitCode = 1;
    return;
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${formatInfo("Cerrando sesión...")}`);
    rl.close();
    await host.close();
    // Se respeta el código que ya se haya fijado: salir con 0 tras un fallo haría que un
    // script que encadene comandos creyera que todo salió bien.
    process.exit(process.exitCode ? Number(process.exitCode) : 0);
  };
  process.on("SIGINT", shutdown);

  try {
    await runRepl(rl, lines, host, {
      banner: {
        userRole: config.userRole,
        userId: config.userId,
        ...(config.anthropicModel
          ? { model: config.anthropicModel }
          : config.anthropicApiKey
            ? { model: "por defecto" }
            : {}),
        serverSource: describeSource(resolved),
        serverNames: resolved.servers.map((server) => server.name),
      },
    });
  } catch (err) {
    console.error(formatError(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
  } finally {
    await shutdown();
  }
}

/** Texto corto que dice exactamente qué archivo (o variable) hay que editar. */
function describeSource(resolved: { source: string; path?: string }): string {
  return resolved.source === "file"
    ? path.relative(process.cwd(), resolved.path ?? DEFAULT_CONFIG_FILENAME)
    : "variable de entorno MCP_SERVER_BIN";
}

main().catch((err) => {
  console.error(formatError(`Fallo fatal: ${bold(err instanceof Error ? err.message : String(err))}`));
  process.exitCode = 1;
});
