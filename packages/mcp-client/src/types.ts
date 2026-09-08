/** Tipos JSON-RPC 2.0 y MCP usados por el cliente. Son los equivalentes de internal/jsonrpc e internal/mcp del servidor */
export type JsonRpcId = string | number;

/** Objeto "error" de una respuesta JSON-RPC. `data` es opcional y nunca trae detalles internos. */
export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

/** Respuesta JSON-RPC cruda tal como llega por la línea de stdout */
export interface JsonRpcResponseMessage {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  result?: unknown;
  error?: JsonRpcErrorObject;
}

//MCP: ciclo de vida

export const MCP_PROTOCOL_VERSION = "2025-06-18";

/**
 * Todas las versiones que este cliente sabe hablar, de la preferida a la menos.
 * El servidor puede responder a `initialize` con una versión distinta a la que pedimos;
 * si está en esta lista, se continúa con ella.
 */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [MCP_PROTOCOL_VERSION, "2025-03-26"];

/** Identificación de un extremo de la conexión; la usan tanto el servidor como el cliente. */
export interface McpServerInfo {
  name: string;
  version: string;
}

/** Parámetros del handshake. `protocolVersion` es la versión PREFERIDA, no una exigencia. */
export interface InitializeParams {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  clientInfo: McpServerInfo;
}

/** Respuesta al handshake. `protocolVersion` es la que el servidor eligió, y puede no ser la pedida. */
export interface InitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: McpServerInfo;
}

//  MCP: herramientas

export interface ToolDefinition {
  name: string;
  /** Opcional en la especificación: hay servidores que no la mandan. */
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

/** Respuesta de tools/list. Con nextCursor hay más páginas por pedir. */
export interface ListToolsResult {
  tools: ToolDefinition[];
  nextCursor?: string;
}

/** Bloque de contenido legible de un resultado. Sólo se manejan bloques de texto. */
export interface ContentBlock {
  type: string;
  text: string;
}

/** Forma de la respuesta de tools/call */
export interface CallToolResult {
  content: ContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
}