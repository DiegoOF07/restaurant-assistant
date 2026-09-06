import { JsonRpcClient, type JsonRpcClientOptions } from "./jsonrpcClient.js";
import { StdioTransport, type StdioTransportOptions } from "./stdioTransport.js";
import type { Transport } from "./transport.js";
import {
  MCP_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
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
  private negotiatedVersion?: string;
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

    // El servidor puede responder con una versión distinta a la pedida: así se negocia.
    // Si no la hablamos, la especificación dice que el cliente debe cortar la conexión —
    // continuar con una versión desconocida es peor que fallar de inmediato.
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(result.protocolVersion)) {
      await this.close();
      throw new Error(
        `el servidor ofreció la versión de protocolo ${result.protocolVersion}, que este cliente no soporta ` +
          `(soportadas: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")})`,
      );
    }

    this.rpc.notify("notifications/initialized");
    this.serverInfo = result.serverInfo;
    this.negotiatedVersion = result.protocolVersion;
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

  /** Versión de protocolo acordada en initialize, o undefined si aún no ocurrió. */
  getNegotiatedVersion(): string | undefined {
    return this.negotiatedVersion;
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