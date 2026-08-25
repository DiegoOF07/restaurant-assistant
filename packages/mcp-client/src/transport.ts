/** Transport es lo que JsonRpcClient necesita para hablar con un servidor MCP */
export interface Transport {
  /** Envía un mensaje JSON-RPC ya serializado sin salto de línea final */
  send(rawMessage: string): void;

  /** Se invoca por cada línea recibida del servidor un mensaje JSON-RPC */
  onMessage(handler: (rawMessage: string) => void): void;

  /** Se invoca con líneas de diagnóstico del servidor */
  onDiagnostic(handler: (line: string) => void): void;

  /** Se invoca cuando el transporte se cierra, con la causa si se conoce */
  onClose(handler: (reason?: Error) => void): void;

  /** Cierra el transporte de forma controlada */
  close(): Promise<void>;
}