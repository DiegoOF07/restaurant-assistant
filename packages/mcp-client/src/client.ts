import { JsonRpcClient, type JsonRpcClientOptions } from "./jsonrpcClient.js";
import { StdioTransport, type StdioTransportOptions } from "./stdioTransport.js";
import type { Transport } from "./transport.js";
import {
  MCP_PROTOCOL_VERSION,
  type CallToolResult,
  type InitializeResult,
  type ListToolsResult,
  type McpServerInfo,
  type ToolDefinition,
} from "./types.js";

export interface McpClientOptions extends JsonRpcClientOptions {
  clientInfo?: McpServerInfo;
}

export class McpClient {
  private readonly rpc: JsonRpcClient;
  private serverInfo?: McpServerInfo;
  private ready = false;

  private constructor(
    private readonly transport: Transport,
    options: McpClientOptions = {},
  ) {
    this.rpc = new JsonRpcClient(transport, options);
    this.clientInfo = options.clientInfo ?? { name: "restaurant-assistant-host", version: "0.1.0" };
  }

  private readonly clientInfo: McpServerInfo;

  /** Construye un cliente sobre el transporte stdio, lanzando el servidor como subproceso. */
  static overStdio(stdioOptions: StdioTransportOptions, clientOptions: McpClientOptions = {}): McpClient {
    return new McpClient(new StdioTransport(stdioOptions), clientOptions);
  }

  /** Construye un cliente sobre un Transport ya existente (útil para pruebas u otros transportes). */
  static withTransport(transport: Transport, clientOptions: McpClientOptions = {}): McpClient {
    return new McpClient(transport, clientOptions);
  }

  /**
   * Ejecuta el handshake completo: initialize -> valida versión ->
   * notifications/initialized. Debe llamarse antes de listTools/callTool
   */
  async initialize(): Promise<InitializeResult> {
    const result = await this.rpc.request<InitializeResult>("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: this.clientInfo,
    });

    if (result.protocolVersion !== MCP_PROTOCOL_VERSION) {
      throw new Error(
        `el servidor negoció una versión de protocolo no soportada: ${result.protocolVersion} (se esperaba ${MCP_PROTOCOL_VERSION})`,
      );
    }

    this.rpc.notify("notifications/initialized");
    this.serverInfo = result.serverInfo;
    this.ready = true;
    return result;
  }

  async listTools(): Promise<ToolDefinition[]> {
    this.assertReady("listTools");
    const result = await this.rpc.request<ListToolsResult>("tools/list");
    return result.tools;
  }

  /**
   * Ejecuta una herramienta. El resultado de una herramienta es DATO NO CONFIABLE hasta 
   * que se valide/sanitice incluso si isError es false 
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
    this.assertReady("callTool");
    return this.rpc.request<CallToolResult>("tools/call", { name, arguments: args });
  }

  async ping(): Promise<void> {
    await this.rpc.request("ping");
  }

  getServerInfo(): McpServerInfo | undefined {
    return this.serverInfo;
  }

  isReady(): boolean {
    return this.ready;
  }

  async close(): Promise<void> {
    await this.rpc.close();
  }

  private assertReady(operation: string): void {
    if (!this.ready) {
      throw new Error(`McpClient.${operation}(): debe llamarse a initialize() antes de usar herramientas`);
    }
  }
}