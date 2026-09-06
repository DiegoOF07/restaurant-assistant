import type { Transport } from "./transport.js";
import type { JsonRpcId, JsonRpcResponseMessage } from "./types.js";
import type { McpEventListener } from "./logging.js";
import { McpError, RequestTimeoutError, TransportClosedError } from "./errors.js";

interface PendingRequest {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Ajustes del transporte JSON-RPC, comunes a cualquier protocolo montado encima. */
export interface JsonRpcClientOptions {
  /** Milisegundos a esperar una respuesta antes de rechazar */
  requestTimeoutMs?: number;
  onEvent?: McpEventListener;
}

/**
 * JsonRpcClient no sabe nada de MCP solo envía requests/notifications y
 * correlaciona respuestas por id. McpClient construye el vocabulario MCP encima de esta capa
 */
export class JsonRpcClient {
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly requestTimeoutMs: number;
  private readonly onEvent?: McpEventListener;
  private closed = false;

  constructor(
    private readonly transport: Transport,
    options: JsonRpcClientOptions = {},
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.onEvent = options.onEvent;

    transport.onMessage((raw) => this.handleIncoming(raw));
    transport.onClose((reason) => this.handleClose(reason));
  }

  /** Envía una solicitud y devuelve una Promise que se resuelve con result. */
  request<T>(method: string, params?: unknown): Promise<T> {
    if (this.closed) {
      return Promise.reject(new TransportClosedError(`no se puede enviar "${method}": transporte cerrado`));
    }

    const id = this.nextId++;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RequestTimeoutError(method, id, this.requestTimeoutMs));
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        method,
        resolve: resolve as (result: unknown) => void,
        reject,
        timer,
      });

      this.onEvent?.({ direction: "to-server", kind: "request", method, id, timestamp: Date.now() });
      this.transport.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  /** Envía una notificación sin id, no espera respuesta */
  notify(method: string, params?: unknown): void {
    if (this.closed) {
      throw new TransportClosedError(`no se puede notificar "${method}": transporte cerrado`);
    }
    this.onEvent?.({ direction: "to-server", kind: "notification", method, timestamp: Date.now() });
    this.transport.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  async close(): Promise<void> {
    await this.transport.close();
    this.handleClose(undefined);
  }

  private handleIncoming(raw: string): void {
    let msg: JsonRpcResponseMessage;
    try {
      msg = JSON.parse(raw) as JsonRpcResponseMessage;
    } catch {
      this.onEvent?.({ direction: "from-server", kind: "parse-error", timestamp: Date.now() });
      return;
    }

    if (msg.id === null || msg.id === undefined) {
      this.onEvent?.({ direction: "from-server", kind: "unmatched-response", timestamp: Date.now() });
      return;
    }

    const pending = this.pending.get(msg.id);
    if (!pending) {
      this.onEvent?.({
        direction: "from-server",
        kind: "unmatched-response",
        id: msg.id,
        timestamp: Date.now(),
      });
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(msg.id);

    this.onEvent?.({
      direction: "from-server",
      kind: "response",
      method: pending.method,
      id: msg.id,
      ok: msg.error === undefined,
      timestamp: Date.now(),
    });

    if (msg.error) {
      pending.reject(new McpError(msg.error.code, msg.error.message, msg.error.data));
    } else {
      pending.resolve(msg.result);
    }
  }

  private handleClose(reason?: Error): void {
    if (this.closed) return;
    this.closed = true;

    const error = reason ?? new TransportClosedError("transporte cerrado");
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}