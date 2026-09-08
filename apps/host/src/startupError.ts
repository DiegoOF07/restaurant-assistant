/**
 * Fallo al conectar un servidor MCP al arrancar.
 *
 * Lleva las últimas líneas de stderr del servidor porque ahí suele estar la causa real
 * ("falta la variable API_KEY", "no such file"), mientras que el error de protocolo sólo
 * dice que la conexión no prosperó.
 */
export class McpServerStartupError extends Error {
  constructor(
    readonly serverName: string,
    readonly cause: Error,
    readonly diagnostics: readonly string[],
  ) {
    const detail = diagnostics.length > 0 ? `\n  El servidor escribió:\n${diagnostics.map((l) => `    ${l}`).join("\n")}` : "";
    super(`el servidor MCP "${serverName}" no pudo iniciarse: ${cause.message}${detail}`);
    this.name = "McpServerStartupError";
  }
}
