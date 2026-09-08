import type { Transport } from "./transport.js";

/**
 * Transporte "Streamable HTTP" del lado del cliente (MCP 2025-06-18).
 *
 * La forma de este transporte es distinta a la de stdio: en stdio hay un flujo continuo del
 * que van cayendo mensajes, mientras que acá cada POST trae su propia respuesta. Aun así
 * expone la MISMA interfaz Transport, así que `JsonRpcClient` y `McpClient` funcionan sin
 * cambiar una línea — que es exactamente lo que justifica que Transport exista.
 */

/** Cabecera con la que el servidor identifica la sesión. */
const SESSION_HEADER = "Mcp-Session-Id";
/** Cabecera con la que el cliente confirma la versión negociada en cada petición. */
const VERSION_HEADER = "MCP-Protocol-Version";

export interface HttpTransportOptions {
  /** URL completa del endpoint MCP, por ejemplo https://mi-servidor.com/mcp */
  url: string;
  /** Cabeceras extra. El sitio natural del Authorization: Bearer <token>. */
  headers?: Record<string, string>;
  /** Milisegundos antes de abandonar una petición. Corta un servidor que no responde. */
  requestTimeoutMs?: number;
  /** Punto de inyección para pruebas: reemplaza fetch. */
  fetchImpl?: typeof fetch;
}

export class HttpTransport implements Transport {
  private readonly url: string;
  private readonly baseHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof fetch;

  private messageHandler: (rawMessage: string) => void = () => {};
  private diagnosticHandler: (line: string) => void = () => {};
  private closeHandler: (reason?: Error) => void = () => {};

  private sessionId?: string;
  private protocolVersion?: string;
  private closed = false;
  /** Peticiones en vuelo, para poder esperarlas al cerrar. */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(options: HttpTransportOptions) {
    this.url = options.url;
    this.baseHeaders = options.headers ?? {};
    this.timeoutMs = options.requestTimeoutMs ?? 30_000;
    this.doFetch = options.fetchImpl ?? globalThis.fetch;

    if (typeof this.doFetch !== "function") {
      throw new Error(
        "HttpTransport necesita fetch, disponible en Node 18 o superior. " +
          "Actualiza Node o pasa fetchImpl.",
      );
    }
  }

  /** Identificador de sesión que asignó el servidor, si el handshake ya ocurrió. */
  getSessionId(): string | undefined {
    return this.sessionId;
  }

  send(rawMessage: string): void {
    if (this.closed) {
      throw new Error("no se puede enviar: el transporte HTTP ya está cerrado");
    }

    // send() es síncrono por contrato, así que la petición se lanza sin esperarla y su
    // resultado se entrega por el mismo camino que usaría stdio: el messageHandler.
    const promise = this.post(rawMessage).finally(() => this.inFlight.delete(promise));
    this.inFlight.add(promise);
  }

  private async post(rawMessage: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.doFetch(this.url, {
        method: "POST",
        headers: this.buildHeaders(),
        body: rawMessage,
        signal: controller.signal,
      });

      // El servidor asigna la sesión al responder initialize; a partir de ahí viaja en cada
      // petición. Se lee de CUALQUIER respuesta porque un servidor puede rotarla.
      const session = response.headers.get(SESSION_HEADER);
      if (session) this.sessionId = session;

      if (response.status === 202) {
        return; // notificación aceptada, sin cuerpo que entregar
      }

      if (response.status === 404 && this.sessionId) {
        // La especificación define 404 como "tu sesión ya no existe". Se descarta la sesión
        // local para que un initialize posterior pueda empezar de cero.
        this.sessionId = undefined;
        this.deliverError(rawMessage, "la sesión expiró en el servidor; hay que volver a inicializar");
        return;
      }

      const text = (await response.text()).trim();

      if (!response.ok) {
        this.deliverError(rawMessage, describeHttpError(response.status, text));
        return;
      }

      if (text.length === 0) return;

      this.rememberProtocolVersion(text);
      this.messageHandler(text);
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      this.deliverError(
        rawMessage,
        aborted
          ? `el servidor no respondió en ${this.timeoutMs} ms`
          : `no se pudo contactar al servidor: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      // Se anuncian ambos tipos porque un servidor puede elegir responder con un flujo SSE.
      Accept: "application/json, text/event-stream",
      ...this.baseHeaders,
    };
    if (this.sessionId) headers[SESSION_HEADER] = this.sessionId;
    if (this.protocolVersion) headers[VERSION_HEADER] = this.protocolVersion;
    return headers;
  }

  /** Guarda la versión acordada para enviarla en las peticiones siguientes. */
  private rememberProtocolVersion(responseText: string): void {
    if (this.protocolVersion) return;
    try {
      const parsed = JSON.parse(responseText) as { result?: { protocolVersion?: unknown } };
      const version = parsed.result?.protocolVersion;
      if (typeof version === "string") this.protocolVersion = version;
    } catch {
      // Si no se puede leer, simplemente no se manda la cabecera: es opcional.
    }
  }

  /**
   * Convierte un fallo de transporte en una respuesta JSON-RPC de error dirigida al id que
   * se acaba de enviar.
   *
   * Sin esto, un servidor caído dejaría la promesa correspondiente esperando hasta agotar su
   * timeout, y el usuario vería "tiempo de espera agotado" en vez de "no hay conexión".
   * Como el id sale del propio mensaje saliente, el error llega a quien lo estaba esperando.
   */
  private deliverError(outgoingMessage: string, message: string): void {
    this.diagnosticHandler(message);

    let id: unknown;
    try {
      id = (JSON.parse(outgoingMessage) as { id?: unknown }).id;
    } catch {
      return;
    }
    // Una notificación no tiene id ni nadie esperándola: no hay a quién avisarle.
    if (id === undefined || id === null) return;

    this.messageHandler(
      JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }),
    );
  }

  onMessage(handler: (rawMessage: string) => void): void {
    this.messageHandler = handler;
  }

  onDiagnostic(handler: (line: string) => void): void {
    this.diagnosticHandler = handler;
  }

  onClose(handler: (reason?: Error) => void): void {
    this.closeHandler = handler;
  }

  /**
   * Cierra la sesión. El DELETE es cortesía —le dice al servidor que puede liberar el
   * estado ya, en vez de esperar a que caduque— así que un fallo acá no es un problema.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    await Promise.allSettled([...this.inFlight]);

    if (this.sessionId) {
      try {
        await this.doFetch(this.url, { method: "DELETE", headers: this.buildHeaders() });
      } catch {
        // El servidor caducará la sesión por su cuenta.
      }
    }

    this.closeHandler(undefined);
  }
}

/** Traduce un código HTTP a algo que explique qué hacer. */
function describeHttpError(status: number, body: string): string {
  const detail = body.length > 0 ? `: ${body.slice(0, 300)}` : "";
  switch (status) {
    case 401:
      return `el servidor rechazó las credenciales (401)${detail}. Revisa el token en "headers".`;
    case 403:
      return `el servidor denegó el acceso (403)${detail}. Puede ser el Origin o la identidad de la sesión.`;
    case 405:
      return `el servidor no admite ese método HTTP (405)${detail}. Verifica que la URL sea el endpoint MCP.`;
    case 415:
      return `el servidor rechazó el tipo de contenido (415)${detail}.`;
    default:
      return `el servidor respondió ${status}${detail}`;
  }
}
