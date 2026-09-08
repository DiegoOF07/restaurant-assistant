import { randomUUID } from "node:crypto";
import { HostService, type McpServerConfig } from "@restaurant/host";
import type { LLMProvider } from "@restaurant/llm-provider";
import type { EventBus } from "./eventBus.js";
import type { SessionState, ServerSummary } from "./types.js";

const SESSION_ID = "web-session";

/**
 * Cuánto se espera la respuesta a una confirmación antes de denegarla.
 * Una pestaña cerrada dejaría el turno bloqueado para siempre; ante la duda, no se toca
 * el inventario.
 */
const CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000;

export interface AssistantSessionOptions {
  servers: McpServerConfig[];
  createProvider: () => LLMProvider;
  systemPrompt: string;
  toolsRequiringConfirmation: string[];
  maxIterations: number;
  userId: string;
  initialRole: string;
  availableRoles: string[];
  serverSource: string;
  model?: string;
  bus: EventBus;
}

/** Una confirmación pendiente de que el usuario responda en el navegador. */
interface PendingConfirmation {
  resolve(approved: boolean): void;
  timer: NodeJS.Timeout;
}

/**
 * Mantiene viva la conversación del navegador: los servidores MCP conectados, el turno en
 * curso y las confirmaciones pendientes.
 *
 * Es el equivalente del REPL del CLI, pero con la entrada llegando por HTTP en vez de por
 * teclado. La lógica de conversación no se duplica: ambos usan el mismo HostService.
 */
export class AssistantSession {
  private host?: HostService;
  private role: string;
  private busy = false;
  private readonly pending = new Map<string, PendingConfirmation>();

  constructor(private readonly options: AssistantSessionOptions) {
    this.role = options.initialRole;
  }

  async start(): Promise<void> {
    this.host = await this.createHost(this.role);
    this.options.bus.publish({ kind: "state", state: await this.state() });
  }

  async close(): Promise<void> {
    this.rejectAllPending();
    await this.host?.close();
    this.host = undefined;
  }

  /** Estado actual, para pintar el encabezado y los paneles. */
  async state(): Promise<SessionState> {
    const host = this.requireHost();
    const tools = await host.listAvailableTools();

    const servers: ServerSummary[] = this.options.servers.map((server) => ({
      name: server.name,
      target: server.url ?? server.command ?? "(sin destino)",
      toolNames: tools.filter((t) => host.serverForTool(t.name) === server.name).map((t) => t.name),
    }));

    return {
      userRole: this.role,
      userId: this.options.userId,
      ...(this.options.model ? { model: this.options.model } : {}),
      serverSource: this.options.serverSource,
      servers,
      tools,
      availableRoles: this.options.availableRoles,
    };
  }

  /** Procesa un mensaje del usuario y publica la actividad conforme ocurre. */
  async handleMessage(text: string): Promise<void> {
    const host = this.requireHost();
    if (this.busy) {
      this.options.bus.publish({ kind: "error", message: "Ya hay un mensaje en curso; espera a que termine." });
      return;
    }

    this.busy = true;
    this.options.bus.publish({ kind: "busy", busy: true });

    try {
      const result = await host.sendMessage(SESSION_ID, text, (event) => {
        const serverName =
          "toolCall" in event ? host.serverForTool(event.toolCall.name) : undefined;
        this.options.bus.publish({ kind: "conversation", event, ...(serverName ? { serverName } : {}) });
      });

      this.options.bus.publish({ kind: "assistant", text: result.reply, iterations: result.iterations });
    } catch (err) {
      this.options.bus.publish({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      this.busy = false;
      this.options.bus.publish({ kind: "busy", busy: false });
      this.options.bus.publish({ kind: "log", entries: [...host.getLog(SESSION_ID)] });
    }
  }

  /** Resuelve una confirmación que el navegador acaba de responder. */
  resolveConfirmation(requestId: string, approved: boolean): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;

    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve(approved);
    this.options.bus.publish({ kind: "confirmation_resolved", requestId, approved });
    return true;
  }

  /**
   * Cambia el rol relanzando los servidores MCP.
   *
   * Con stdio el rol viaja en el entorno al arrancar el subproceso, así que no se puede
   * cambiar en caliente: hay que cerrar y volver a lanzar. Es justamente lo que hace visible
   * que el permiso lo decide el servidor y no la interfaz.
   */
  async setRole(role: string): Promise<void> {
    if (this.busy) {
      this.options.bus.publish({ kind: "error", message: "No se puede cambiar de rol con un mensaje en curso." });
      return;
    }
    if (role === this.role) return;

    this.rejectAllPending();
    await this.host?.close();

    this.role = role;
    this.host = await this.createHost(role);

    // El historial de la conversación se pierde al relanzar: mantenerlo en pantalla haría
    // creer que el asistente recuerda algo que ya no está en su contexto.
    this.options.bus.clearHistory();
    this.options.bus.publish({ kind: "state", state: await this.state() });
  }

  private async createHost(role: string): Promise<HostService> {
    const servers = this.options.servers.map((server) =>
      server.url
        ? server
        : { ...server, env: { ...server.env, MCP_USER_ROLE: role, MCP_USER_ID: this.options.userId } },
    );

    return HostService.create({
      provider: this.options.createProvider(),
      servers,
      systemPrompt: this.options.systemPrompt,
      toolsRequiringConfirmation: this.options.toolsRequiringConfirmation,
      requestConfirmation: (toolCall) => this.askBrowser(toolCall.name, toolCall.arguments),
      maxIterations: this.options.maxIterations,
    });
  }

  /** Publica la petición de confirmación y espera la respuesta del navegador. */
  private askBrowser(toolName: string, args: Record<string, unknown>): Promise<boolean> {
    // Sin nadie mirando no hay a quién preguntarle, y aprobar por defecto sería justo lo
    // contrario de lo que protege esta capa.
    if (this.options.bus.subscriberCount === 0) return Promise.resolve(false);

    const requestId = randomUUID();

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.options.bus.publish({ kind: "confirmation_resolved", requestId, approved: false });
        resolve(false);
      }, CONFIRMATION_TIMEOUT_MS);

      this.pending.set(requestId, { resolve, timer });
      this.options.bus.publish({ kind: "confirmation_required", requestId, toolName, args });
    });
  }

  private rejectAllPending(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve(false);
    }
    this.pending.clear();
  }

  private requireHost(): HostService {
    if (!this.host) throw new Error("la sesión no está iniciada; llama a start() primero");
    return this.host;
  }
}
