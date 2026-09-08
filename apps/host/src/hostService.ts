import { ConversationLoop, Session } from "@restaurant/conversation";
import type { ConfirmationHandler, ConversationEvent, ToolRunner, TurnResult } from "@restaurant/conversation";
import type { LLMProvider, ToolSpec } from "@restaurant/llm-provider";
import { McpClient, type McpLogEvent } from "@restaurant/mcp-client";

import { McpLogger } from "./mcpLogger.js";
import { MultiServerToolRunner } from "./multiServerToolRunner.js";
import { SessionManager } from "./sessionManager.js";
import { McpServerStartupError } from "./startupError.js";
import type { LogEntry, McpServerConfig } from "./types.js";

/** Construcción directa, con un ToolRunner ya armado. Para pruebas; en producción se usa create(). */
export interface HostServiceOptions {
  provider: LLMProvider;
  toolRunner: ToolRunner;
  toolsRequiringConfirmation?: Iterable<string>;
  requestConfirmation?: ConfirmationHandler;
  maxIterations?: number;
  systemPrompt?: string;
}

/** Cuántas líneas de stderr se conservan por servidor. */
const MAX_DIAGNOSTIC_LINES = 20;

/** Rastrea qué sessionId está "en vuelo" en este momento, para poder atribuirle los eventos de mcp-client */
class SessionContext {
  current = "unknown";
}

/** Configuración para construir un HostService real, con servidores MCP de verdad lanzados por stdio */
export interface HostServiceConfig {
  provider: LLMProvider;
  servers: McpServerConfig[];
  toolsRequiringConfirmation?: Iterable<string>;
  requestConfirmation?: ConfirmationHandler;
  maxIterations?: number;
  systemPrompt?: string;
}

/** HostService es la API común que consumen tanto apps/cli como apps/web */
export class HostService {
  private readonly loop: ConversationLoop;
  private readonly sessions = new SessionManager();
  private readonly logger: McpLogger;
  private readonly sessionContext: SessionContext;
  private readonly mcpClients: McpClient[];
  private readonly toolRunner: ToolRunner;

  constructor(
    options: HostServiceOptions,
    internals?: { logger?: McpLogger; sessionContext?: SessionContext; mcpClients?: McpClient[] },
  ) {
    this.logger = internals?.logger ?? new McpLogger();
    this.sessionContext = internals?.sessionContext ?? new SessionContext();
    this.mcpClients = internals?.mcpClients ?? [];
    this.toolRunner = options.toolRunner;

    this.loop = new ConversationLoop({
      provider: options.provider,
      toolRunner: options.toolRunner,
      toolsRequiringConfirmation: options.toolsRequiringConfirmation,
      requestConfirmation: options.requestConfirmation,
      maxIterations: options.maxIterations,
      systemPrompt: options.systemPrompt,
    });
  }

  /**
   * Construye un HostService real y lanza cada servidor configurado como
   * subproceso stdio, completa su handshake MCP, y los combina en un
   * único MultiServerToolRunner
   */
  static async create(config: HostServiceConfig): Promise<HostService> {
    const logger = new McpLogger();
    const sessionContext = new SessionContext();
    const mcpClients: McpClient[] = [];
    const namedServers: Array<{ name: string; toolRunner: ToolRunner }> = [];

    for (const serverConfig of config.servers) {
      // Se guardan las últimas líneas de stderr para poder explicar un arranque fallido.
      const diagnostics: string[] = [];
      const clientOptions = {
        onEvent: (event: McpLogEvent) => logger.recordMcpEvent(sessionContext.current, serverConfig.name, event),
        onDiagnostic: (line: string) => {
          diagnostics.push(line);
          if (diagnostics.length > MAX_DIAGNOSTIC_LINES) diagnostics.shift();
        },
      };

      // Único punto del host donde importa si el servidor es local o remoto. De acá en
      // adelante ambos son un ToolRunner más.
      const client = serverConfig.url
        ? McpClient.overHttp(
            { url: serverConfig.url, ...(serverConfig.headers ? { headers: serverConfig.headers } : {}) },
            clientOptions,
          )
        : McpClient.overStdio(
            { command: serverConfig.command!, args: serverConfig.args, env: serverConfig.env },
            clientOptions,
          );

      mcpClients.push(client);

      try {
        await client.initialize();
      } catch (err) {
        // Sin esto, los subprocesos ya lanzados siguen vivos y mantienen abierto el bucle de
        // eventos: el CLI se queda colgado en vez de terminar con el error.
        await Promise.allSettled(mcpClients.map((c) => c.close()));
        throw new McpServerStartupError(serverConfig.name, err instanceof Error ? err : new Error(String(err)), diagnostics);
      }

      namedServers.push({ name: serverConfig.name, toolRunner: client });
    }

    const toolRunner = new MultiServerToolRunner(namedServers);

    return new HostService(
      {
        provider: config.provider,
        toolRunner,
        toolsRequiringConfirmation: config.toolsRequiringConfirmation,
        requestConfirmation: config.requestConfirmation,
        maxIterations: config.maxIterations,
        systemPrompt: config.systemPrompt,
      },
      { logger, sessionContext, mcpClients },
    );
  }

  /**
   * Procesa un mensaje de usuario dentro de una sesión.
   *
   * `onEvent` recibe los eventos del ciclo de tool-calling conforme ocurren, para que una
   * interfaz pueda mostrar actividad en vivo. Es opcional a propósito: el registro interno
   * ocurre igual, así que quien no lo necesite no cambia nada.
   */
  async sendMessage(
    sessionId: string,
    userInput: string,
    onEvent?: (event: ConversationEvent) => void,
  ): Promise<TurnResult> {
    const session: Session = this.sessions.get(sessionId);
    this.sessionContext.current = sessionId;
    try {
      return await this.loop.runTurn(session, userInput, {
        onEvent: (event) => {
          this.logger.recordConversationEvent(sessionId, event);
          onEvent?.(event);
        },
      });
    } finally {
      this.sessionContext.current = "unknown";
    }
  }

  /** Log unificado (protocolo MCP + ciclo de conversación) de una sesión,
   * en el orden en que ocurrieron los eventos */
  getLog(sessionId: string): readonly LogEntry[] {
    return this.logger.getEntries(sessionId);
  }

  async listAvailableTools(): Promise<ToolSpec[]> {
    return this.loop.discoverTools();
  }

  /**
   * Nombre del servidor MCP que expone una herramienta, si se puede determinar.
   * Permite a la interfaz decir "get_dish_availability (restaurant-local)" cuando hay
   * varios servidores conectados, que es justo cuando deja de ser obvio.
   */
  serverForTool(toolName: string): string | undefined {
    return this.toolRunner instanceof MultiServerToolRunner ? this.toolRunner.serverFor(toolName) : undefined;
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** Cierra todos los servidores MCP lanzados por create(). No hace nada
   * si el HostService se construyó con el constructor directo */
  async close(): Promise<void> {
    await Promise.all(this.mcpClients.map((client) => client.close()));
  }
}