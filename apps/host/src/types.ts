import type { ToolSpec } from "@restaurant/llm-provider";
import type { ConfirmationHandler, ConversationEvent } from "@restaurant/conversation";

/**
 * Configuración de un servidor MCP que el host debe conectar al arrancar.
 *
 * Hay dos formas de llegar a un servidor y son excluyentes: `command` lo lanza como
 * subproceso local por stdio, y `url` lo contacta por HTTP donde ya esté corriendo. El resto
 * del host no distingue entre ambas: `HostService.create` elige el transporte y a partir de
 * ahí todo es idéntico.
 */
export interface McpServerConfig {
  name: string;

  /** Servidor local: ejecutable a lanzar. Excluyente con `url`. */
  command?: string;
  args?: string[];
  /**
   * Variables de entorno extra para el subproceso. Con stdio es el canal natural para
   * pasarle al servidor la identidad (rol/usuario) bajo la que debe operar.
   */
  env?: Record<string, string>;

  /** Servidor remoto: endpoint MCP completo. Excluyente con `command`. */
  url?: string;
  /**
   * Cabeceras para el servidor remoto; el sitio del `Authorization: Bearer <token>`.
   *
   * Por HTTP la identidad NO viaja en `env`: el servidor remoto no puede confiar en algo que
   * el cliente elige, así que deriva el rol del token. Ver la sección de seguridad del README.
   */
  headers?: Record<string, string>;
}

/**
 * Una línea del log unificado. `sequence` conserva el orden real entre eventos del
 * protocolo MCP y del ciclo de conversación, que llegan por caminos distintos.
 */
export interface LogEntry {
  sequence: number;
  sessionId: string;
  source: "mcp" | "conversation";
  timestamp: number;
  direction?: "to-server" | "from-server";
  kind: string;
  method?: string;
  toolName?: string;
  ok?: boolean;
  detail?: unknown;
}

export type { ConfirmationHandler, ConversationEvent, ToolSpec };