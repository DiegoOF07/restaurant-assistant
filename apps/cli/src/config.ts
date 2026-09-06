import * as fs from "node:fs";
import * as path from "node:path";
export interface CliConfig {
  mcpServerBin: string;
  mcpServerArgs: string[];
  maxIterations: number;
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CliConfig {
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

  const mcpServerBin = path.resolve(process.cwd(), rawBin);
  assertServerBinaryIsUsable(mcpServerBin, rawBin);

  const mcpServerArgs = env.MCP_SERVER_ARGS ? env.MCP_SERVER_ARGS.split(" ").filter(Boolean) : [];

  const maxIterationsRaw = env.HOST_MAX_ITERATIONS;
  const maxIterations = maxIterationsRaw ? Number.parseInt(maxIterationsRaw, 10) : 8;
  if (Number.isNaN(maxIterations) || maxIterations <= 0) {
    throw new ConfigError(`HOST_MAX_ITERATIONS debe ser un entero positivo, se recibió: ${maxIterationsRaw}`);
  }

  return { mcpServerBin, mcpServerArgs, maxIterations };
}


function assertServerBinaryIsUsable(resolvedPath: string, originalValue: string): void {
  if (!fs.existsSync(resolvedPath)) {
    const buildHint =
      process.platform === "win32"
        ? "go build -o bin\\restaurant-mcp-server.exe .\\cmd\\stdio"
        : "go build -o bin/restaurant-mcp-server ./cmd/stdio";

    throw new ConfigError(
      `No se encontró el binario del servidor MCP en:\n` +
        `  ${resolvedPath}\n\n` +
        `(MCP_SERVER_BIN="${originalValue}", resuelto respecto al directorio actual: ${process.cwd()})\n\n` +
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