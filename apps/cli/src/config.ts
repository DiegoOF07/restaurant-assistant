import * as fs from "node:fs";
import * as path from "node:path";
export interface CliConfig {
  mcpServerBin: string;
  mcpServerArgs: string[];
  maxIterations: number;
  /** Si falta, el CLI cae al proveedor de demostración en vez de fallar. */
  anthropicApiKey?: string;
  anthropicModel?: string;
  /** Rol e identidad bajo los que el servidor MCP debe operar (sección 13.1 del plan). */
  userRole: string;
  userId: string;
}

export class ConfigError extends Error {}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  baseDir: string = process.cwd(),
): CliConfig {
  const rawBin = env.MCP_SERVER_BIN;
  if (!rawBin) {
    throw new ConfigError(
      "Falta la variable de entorno MCP_SERVER_BIN (ruta al binario compilado de restaurant-mcp-server).\n\n" +
        "Puedes definirla de dos formas:\n" +
        "  1. Crear un archivo .env en apps/cli/ (ver .env.example) con:\n" +
        "       MCP_SERVER_BIN=../restaurant-mcp-server/bin/restaurant-mcp-server\n" +
        "  2. O exportarla en tu shell antes de correr el CLI.",
    );
  }

  const mcpServerBin = path.resolve(baseDir, rawBin);
  assertServerBinaryIsUsable(mcpServerBin, rawBin, baseDir);

  const mcpServerArgs = env.MCP_SERVER_ARGS ? env.MCP_SERVER_ARGS.split(" ").filter(Boolean) : [];

  const maxIterationsRaw = env.HOST_MAX_ITERATIONS;
  const maxIterations = maxIterationsRaw ? Number.parseInt(maxIterationsRaw, 10) : 8;
  if (Number.isNaN(maxIterations) || maxIterations <= 0) {
    throw new ConfigError(`HOST_MAX_ITERATIONS debe ser un entero positivo, se recibió: ${maxIterationsRaw}`);
  }

  // El rol se valida en el SERVIDOR; acá sólo se transporta. Si no se define, el servidor
  // aplica por su cuenta el rol menos privilegiado.
  const userRole = env.MCP_USER_ROLE?.trim() || "waiter";
  const userId = env.MCP_USER_ID?.trim() || "unspecified";

  const config: CliConfig = { mcpServerBin, mcpServerArgs, maxIterations, userRole, userId };

  // El LLM real es opcional: sin API key el CLI sigue siendo demostrable con el proveedor
  // heurístico, que es justo lo que permite probar el resto del sistema sin costo ni conexión.
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) config.anthropicApiKey = apiKey;
  const model = env.ANTHROPIC_MODEL?.trim();
  if (model) config.anthropicModel = model;

  return config;
}


function assertServerBinaryIsUsable(resolvedPath: string, originalValue: string, baseDir: string): void {
  if (!fs.existsSync(resolvedPath)) {
    const buildHint =
      process.platform === "win32"
        ? "go build -o bin\\restaurant-mcp-server.exe .\\cmd\\stdio"
        : "go build -o bin/restaurant-mcp-server ./cmd/stdio";

    throw new ConfigError(
      `No se encontró el binario del servidor MCP en:\n` +
        `  ${resolvedPath}\n\n` +
        `(MCP_SERVER_BIN="${originalValue}", resuelto respecto a la carpeta del CLI: ${baseDir})\n\n` +
        `Verifica lo siguiente:\n` +
        `  1. Que ya compilaste el servidor Go para TU sistema operativo actual (detectado: ${process.platform}):\n` +
        `       ${buildHint}\n` +
        `  2. Que la ruta en MCP_SERVER_BIN (o en tu .env) apunta exactamente a ese archivo.\n` +
        `  3. Si usas WSL: compila y corre el CLI desde el MISMO entorno. Un binario compilado dentro de\n` +
        `     WSL (Linux) no puede ejecutarse desde PowerShell/node.exe de Windows, y viceversa — son dos\n` +
        `     sistemas operativos distintos aunque compartan el mismo disco.\n` +
        `  4. En Windows el binario debe terminar en ".exe" (Go lo agrega automáticamente al compilar ahí);\n` +
        `     en Linux/macOS/WSL, sin extensión.`,
    );
  }

  if (process.platform !== "win32") {
    try {
      fs.accessSync(resolvedPath, fs.constants.X_OK);
    } catch {
      throw new ConfigError(
        `El archivo existe pero no tiene permisos de ejecución:\n  ${resolvedPath}\n` +
          `Corrígelo con: chmod +x "${resolvedPath}"`,
      );
    }
  }
}