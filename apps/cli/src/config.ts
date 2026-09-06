/**
 * Configuración del CLI, leída de variables de entorno
 */
export interface CliConfig {
  mcpServerBin: string;
  mcpServerArgs: string[];
  maxIterations: number;
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CliConfig {
  const mcpServerBin = env.MCP_SERVER_BIN;
  if (!mcpServerBin) {
    throw new ConfigError(
      "Falta la variable de entorno MCP_SERVER_BIN (ruta al binario compilado de restaurant-mcp-server).\n" +
        "Ejemplo: MCP_SERVER_BIN=/ruta/a/restaurant-mcp-server/bin/restaurant-mcp-server pnpm --filter @restaurant/cli run start",
    );
  }

  const mcpServerArgs = env.MCP_SERVER_ARGS ? env.MCP_SERVER_ARGS.split(" ").filter(Boolean) : [];

  const maxIterationsRaw = env.HOST_MAX_ITERATIONS;
  const maxIterations = maxIterationsRaw ? Number.parseInt(maxIterationsRaw, 10) : 8;
  if (Number.isNaN(maxIterations) || maxIterations <= 0) {
    throw new ConfigError(`HOST_MAX_ITERATIONS debe ser un entero positivo, se recibió: ${maxIterationsRaw}`);
  }

  return { mcpServerBin, mcpServerArgs, maxIterations };
}