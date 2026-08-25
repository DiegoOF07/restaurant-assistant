import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { Transport } from "./transport.js";

export interface StdioTransportOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/** StdioTransport implementa el lado del cliente del transporte */
export class StdioTransport implements Transport {
  private readonly child: ChildProcessWithoutNullStreams;
  private messageHandler: (rawMessage: string) => void = () => {};
  private diagnosticHandler: (line: string) => void = () => {};
  private closeHandler: (reason?: Error) => void = () => {};
  private closed = false;

  constructor(options: StdioTransportOptions) {
    this.child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    createInterface({ input: this.child.stdout }).on("line", (line) => {
      if (line.trim().length === 0) return; // líneas en blanco se ignoran
      this.messageHandler(line);
    });

    createInterface({ input: this.child.stderr }).on("line", (line) => {
      this.diagnosticHandler(line);
    });

    this.child.on("exit", (code, signal) => {
      if (this.closed) return; // cierre esperado, ya se notificó en close()
      this.closed = true;
      this.closeHandler(
        new Error(`servidor MCP terminó inesperadamente (code=${code}, signal=${signal})`),
      );
    });

    this.child.on("error", (err) => {
      this.closed = true;
      this.closeHandler(err);
    });
  }

  send(rawMessage: string): void {
    if (this.closed) {
      throw new Error("no se puede enviar: el transporte stdio ya está cerrado");
    }
    this.child.stdin.write(rawMessage + "\n");
  }

  onMessage(handler: (rawMessage: string) => void): void {
    this.messageHandler = handler;
  }

  onDiagnostic(handler: (line: string) => void): void {
    this.diagnosticHandler = handler;
  }

  onClose(handler: (reason?: Error) => void): void {
    this.closeHandler = handler;
  }

  async close(): Promise<void> {
    if (this.closed || this.child.exitCode !== null) {
      this.closed = true;
      return;
    }
    this.closed = true;

    return new Promise<void>((resolve) => {
      // Cierre controlado primero
      const forceKillTimer = setTimeout(() => this.child.kill("SIGKILL"), 3000);
      this.child.once("exit", () => {
        clearTimeout(forceKillTimer);
        resolve();
      });
      this.child.stdin.end();
      this.child.kill("SIGTERM");
    });
  }
}