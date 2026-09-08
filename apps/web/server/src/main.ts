import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConfigError,
  loadConfig,
  loadDotEnv,
  resolveServers,
  SYSTEM_PROMPT,
  HeuristicDemoProvider,
} from "@restaurant/cli";
import { AnthropicProvider, type LLMProvider } from "@restaurant/llm-provider";
import { AssistantSession } from "./assistantSession.js";
import { EventBus } from "./eventBus.js";
import { createWebServer } from "./httpServer.js";

/**
 * Arranque de la interfaz web.
 *
 * Lee EXACTAMENTE la misma configuración que el CLI —el mismo `.env` y el mismo
 * `mcp.servers.json`— para que no haya dos fuentes de verdad que puedan divergir.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Raíz del paquete @restaurant/cli, de donde salen .env y mcp.servers.json.
 *
 * Se resuelve por el propio paquete y no contando "../.." desde este archivo: la
 * profundidad cambia entre ejecutar el fuente y el compilado, y una ruta mal contada falla
 * con un "no hay servidores configurados" que no apunta a la causa real.
 */
const cliRoot = path.dirname(createRequire(import.meta.url).resolve("@restaurant/cli/package.json"));

/** Frontend compilado por Vite, junto al backend compilado. */
const staticDir = path.resolve(here, "../dist-client");

const ROLES = ["waiter", "cook", "admin"];

async function main(): Promise<void> {
  loadDotEnv(path.join(cliRoot, ".env"));

  const port = Number.parseInt(process.env.WEB_PORT ?? "5173", 10);
  if (Number.isNaN(port) || port <= 0) {
    console.error(`WEB_PORT debe ser un puerto válido, se recibió: ${process.env.WEB_PORT}`);
    process.exitCode = 1;
    return;
  }

  let config;
  let resolved;
  try {
    config = loadConfig(process.env);
    resolved = resolveServers({
      baseDir: cliRoot,
      env: process.env,
      ...(config.configPath ? { configPath: config.configPath } : {}),
      defaultEnv: { MCP_USER_ROLE: config.userRole, MCP_USER_ID: config.userId },
    });
  } catch (err) {
    console.error(err instanceof ConfigError ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  const createProvider = (): LLMProvider =>
    config.anthropicApiKey
      ? new AnthropicProvider({
          apiKey: config.anthropicApiKey,
          ...(config.anthropicModel ? { model: config.anthropicModel } : {}),
        })
      : new HeuristicDemoProvider();

  if (!config.anthropicApiKey) {
    console.warn("[AVISO] Sin ANTHROPIC_API_KEY: se usa el proveedor de demostración.");
  }

  const bus = new EventBus();
  const session = new AssistantSession({
    servers: resolved.servers,
    createProvider,
    systemPrompt: SYSTEM_PROMPT,
    toolsRequiringConfirmation: ["adjust_inventory"],
    maxIterations: config.maxIterations,
    userId: config.userId,
    initialRole: config.userRole,
    availableRoles: ROLES,
    serverSource: resolved.source === "file" ? path.basename(resolved.path ?? "") : "MCP_SERVER_BIN",
    // Sólo se informa el modelo si de verdad hay un LLM detrás: con el proveedor de
    // demostración, mostrar un nombre de modelo haría creer que las respuestas vienen de él.
    ...(config.anthropicApiKey ? { model: config.anthropicModel ?? "por defecto" } : {}),
    bus,
  });

  try {
    await session.start();
  } catch (err) {
    console.error(`No se pudo conectar con los servidores MCP:\n${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  const server = createWebServer({ session, bus, staticDir });

  // Sin esto, un puerto ocupado tumba el proceso con un volcado de Node que no dice qué
  // hacer. Es el error más habitual al relanzar la interfaz.
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `El puerto ${port} ya está en uso. Cierra la otra instancia, o usa otro puerto:\n` +
          `  WEB_PORT=5200 pnpm --filter @restaurant/web start`,
      );
    } else {
      console.error(`No se pudo abrir el servidor web: ${err.message}`);
    }
    void session.close().finally(() => process.exit(1));
  });

  // Sólo se escucha en loopback: esta interfaz no tiene autenticación propia y expone la
  // API key indirectamente, así que no debe quedar alcanzable desde la red.
  server.listen(port, "127.0.0.1", () => {
    console.log(`Interfaz web en http://127.0.0.1:${port}`);
    console.log(`  rol inicial: ${config.userRole}  ·  servidores: ${resolved.servers.map((s) => s.name).join(", ")}`);
  });

  const shutdown = async () => {
    console.log("\nCerrando...");
    server.close();
    await session.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fallo fatal:", err);
  process.exitCode = 1;
});
