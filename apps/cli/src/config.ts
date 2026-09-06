/** Configuración del CLI. La lista de servidores MCP NO está acá: vive en serversConfig.ts. */
export interface CliConfig {
  maxIterations: number;
  /** Si falta, el CLI cae al proveedor de demostración en vez de fallar. */
  anthropicApiKey?: string;
  anthropicModel?: string;
  /** Rol e identidad bajo los que los servidores MCP deben operar (sección 13.1 del plan). */
  userRole: string;
  userId: string;
  /** Ruta explícita al archivo de servidores MCP, si se pidió una. */
  configPath?: string;
}

/**
 * Error de configuración atribuible al usuario. Se distingue de un fallo inesperado
 * porque su mensaje se imprime tal cual, sin traza de pila: ya explica qué corregir.
 */
export class ConfigError extends Error {}

/**
 * Lee la configuración del propio CLI. La lista de servidores MCP NO se resuelve acá:
 * vive en su propio archivo y la resuelve resolveServers() (ver serversConfig.ts).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): CliConfig {
  const maxIterationsRaw = env.HOST_MAX_ITERATIONS;
  const maxIterations = maxIterationsRaw ? Number.parseInt(maxIterationsRaw, 10) : 8;
  if (Number.isNaN(maxIterations) || maxIterations <= 0) {
    throw new ConfigError(`HOST_MAX_ITERATIONS debe ser un entero positivo, se recibió: ${maxIterationsRaw}`);
  }

  // El rol se valida en el SERVIDOR; acá sólo se transporta. Si no se define, el servidor
  // aplica por su cuenta el rol menos privilegiado.
  const userRole = env.MCP_USER_ROLE?.trim() || "waiter";
  const userId = env.MCP_USER_ID?.trim() || "unspecified";

  const config: CliConfig = { maxIterations, userRole, userId };

  const configPath = env.MCP_CONFIG_FILE?.trim();
  if (configPath) config.configPath = configPath;

  // El LLM real es opcional: sin API key el CLI sigue siendo demostrable con el proveedor
  // heurístico, que es justo lo que permite probar el resto del sistema sin costo ni conexión.
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) config.anthropicApiKey = apiKey;
  const model = env.ANTHROPIC_MODEL?.trim();
  if (model) config.anthropicModel = model;

  return config;
}
