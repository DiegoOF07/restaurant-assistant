#!/usr/bin/env node
// Servidor MCP mínimo, solo para probar StdioTransport/JsonRpcClient/McpClient
// sin depender del binario Go real.

import { createInterface } from "node:readline";

const PROTOCOL_VERSION = "2025-06-18";

const rl = createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function respondResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

rl.on("line", (line) => {
  if (line.trim().length === 0) return;

  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    process.stderr.write(`[fake-server] invalid JSON: ${line}\n`);
    return;
  }

  const { id, method, params } = msg;

  switch (method) {
    case "initialize": {
      if (params?.protocolVersion !== PROTOCOL_VERSION) {
        respondError(id, -32602, "unsupported protocol version");
        return;
      }
      respondResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "fake-mcp-server", version: "0.0.1-test" },
      });
      return;
    }

    case "notifications/initialized":
      // Notificación: no responde nada.
      return;

    case "ping":
      respondResult(id, {});
      return;

    case "tools/list":
      respondResult(id, {
        tools: [
          {
            name: "fast",
            description: "responds immediately",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
          },
          {
            name: "slow",
            description: "responds after a short delay",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
          },
        ],
      });
      return;

    case "tools/call": {
      const toolName = params?.name;

      if (toolName === "hang") {
        return; // nunca responde, a propósito
      }

      if (toolName === "fast") {
        respondResult(id, { content: [{ type: "text", text: "fast done" }], structuredContent: { name: "fast" } });
        return;
      }

      if (toolName === "slow") {
        setTimeout(() => {
          respondResult(id, { content: [{ type: "text", text: "slow done" }], structuredContent: { name: "slow" } });
        }, 40);
        return;
      }

      if (toolName === "boom") {
        respondResult(id, {
          content: [{ type: "text", text: "business error: something went wrong" }],
          isError: true,
        });
        return;
      }

      respondError(id, -32602, `unknown tool: ${toolName}`);
      return;
    }

    default:
      respondError(id, -32601, `Method not found: ${method}`);
  }
});

process.stderr.write("[fake-server] ready\n");
