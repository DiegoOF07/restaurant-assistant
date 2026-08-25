/**
 * McpError envuelve un error JSON-RPC de PROTOCOLO devuelto por el
 * servidor. Se distingue de un error de NEGOCIO.
 */
export class McpError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.data = data;
  }
}

/** Se lanza cuando el transporte se cierra con solicitudes aún pendientes */
export class TransportClosedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportClosedError";
  }
}

/** Se lanza cuando una solicitud no recibe respuesta dentro del timeout */
export class RequestTimeoutError extends Error {
  constructor(method: string, id: string | number, timeoutMs: number) {
    super(`timeout waiting for response to "${method}" (id=${id}) after ${timeoutMs}ms`);
    this.name = "RequestTimeoutError";
  }
}