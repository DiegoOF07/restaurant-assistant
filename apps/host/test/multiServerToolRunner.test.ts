import { describe, it, expect } from "vitest";
import type { ToolExecutionResult, ToolRunner } from "@restaurant/conversation";
import type { ToolSpec } from "@restaurant/llm-provider";
import { MultiServerToolRunner, DuplicateToolNameError } from "../src/multiServerToolRunner.js";

class StubToolRunner implements ToolRunner {
  public readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  constructor(private readonly tools: ToolSpec[]) {}

  async listTools(): Promise<ToolSpec[]> {
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    this.calls.push({ name, args });
    return { content: [{ type: "text", text: `handled by stub: ${name}` }] };
  }
}

const tool = (name: string): ToolSpec => ({ name, description: "test", inputSchema: { type: "object" } });

describe("MultiServerToolRunner", () => {
  it("combina las herramientas de varios servidores en una sola lista", async () => {
    const restaurantServer = new StubToolRunner([tool("search_dishes"), tool("adjust_inventory")]);
    const filesystemServer = new StubToolRunner([tool("read_file"), tool("write_file")]);

    const multi = new MultiServerToolRunner([
      { name: "restaurant", toolRunner: restaurantServer },
      { name: "filesystem", toolRunner: filesystemServer },
    ]);

    const tools = await multi.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["adjust_inventory", "read_file", "search_dishes", "write_file"]);
  });

  it("enruta callTool al servidor correcto según qué herramienta declaró", async () => {
    const restaurantServer = new StubToolRunner([tool("search_dishes")]);
    const filesystemServer = new StubToolRunner([tool("read_file")]);
    const multi = new MultiServerToolRunner([
      { name: "restaurant", toolRunner: restaurantServer },
      { name: "filesystem", toolRunner: filesystemServer },
    ]);

    await multi.callTool("read_file", { path: "README.md" });

    expect(filesystemServer.calls).toEqual([{ name: "read_file", args: { path: "README.md" } }]);
    expect(restaurantServer.calls).toHaveLength(0);
  });

  it("lanza DuplicateToolNameError si dos servidores declaran el mismo nombre de herramienta", async () => {
    const serverA = new StubToolRunner([tool("search_dishes")]);
    const serverB = new StubToolRunner([tool("search_dishes")]); // colisión intencional

    const multi = new MultiServerToolRunner([
      { name: "server-a", toolRunner: serverA },
      { name: "server-b", toolRunner: serverB },
    ]);

    await expect(multi.listTools()).rejects.toBeInstanceOf(DuplicateToolNameError);
  });

  it("callTool de una herramienta inexistente lanza un error claro", async () => {
    const multi = new MultiServerToolRunner([{ name: "restaurant", toolRunner: new StubToolRunner([tool("ping")]) }]);
    await expect(multi.callTool("does_not_exist", {})).rejects.toThrow(/herramienta desconocida/);
  });

  it("serverFor() reporta a qué servidor pertenece una herramienta", async () => {
    const multi = new MultiServerToolRunner([
      { name: "restaurant", toolRunner: new StubToolRunner([tool("search_dishes")]) },
    ]);
    await multi.listTools();
    expect(multi.serverFor("search_dishes")).toBe("restaurant");
    expect(multi.serverFor("does_not_exist")).toBeUndefined();
  });
});