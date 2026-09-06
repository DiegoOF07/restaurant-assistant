import type { ToolExecutionResult, ToolRunner } from "@restaurant/conversation";
import type { ToolSpec } from "@restaurant/llm-provider";

/**
 * Se lanza al descubrir que dos servidores MCP distintos declaran una herramienta con el mismo
 * nombre. Se falla explícitamente en vez de dejar que uno "gane" en silencio
 */
export class DuplicateToolNameError extends Error {
  constructor(
    readonly toolName: string,
    readonly firstServer: string,
    readonly secondServer: string,
  ) {
    super(
      `la herramienta "${toolName}" está declarada tanto por "${firstServer}" como por "${secondServer}"; ` +
        "renombra una de las dos en la configuración antes de continuar",
    );
    this.name = "DuplicateToolNameError";
  }
}

interface NamedServer {
  name: string;
  toolRunner: ToolRunner;
}

/** MultiServerToolRunner implementa ToolRunner combinando varios servidores MCP */
export class MultiServerToolRunner implements ToolRunner {
  private toolSpecsCache?: ToolSpec[];
  private readonly serverNameByTool = new Map<string, string>();
  private readonly runnerByServerName = new Map<string, ToolRunner>();

  constructor(private readonly servers: NamedServer[]) {
    for (const server of servers) {
      this.runnerByServerName.set(server.name, server.toolRunner);
    }
  }

  async listTools(): Promise<ToolSpec[]> {
    if (this.toolSpecsCache) return this.toolSpecsCache;

    const combined: ToolSpec[] = [];
    for (const { name: serverName, toolRunner } of this.servers) {
      const tools = await toolRunner.listTools();
      for (const tool of tools) {
        const existingServer = this.serverNameByTool.get(tool.name);
        if (existingServer) {
          throw new DuplicateToolNameError(tool.name, existingServer, serverName);
        }
        this.serverNameByTool.set(tool.name, serverName);
        combined.push(tool);
      }
    }

    this.toolSpecsCache = combined;
    return combined;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    await this.listTools();

    const serverName = this.serverNameByTool.get(name);
    if (!serverName) {
      throw new Error(`herramienta desconocida: ${name}`);
    }
    const runner = this.runnerByServerName.get(serverName)!;
    return runner.callTool(name, args);
  }

  serverFor(toolName: string): string | undefined {
    return this.serverNameByTool.get(toolName);
  }
}