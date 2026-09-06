import type { Interface as ReadlineInterface } from "node:readline";

/** Muestra el prompt de forma segura */
export function safePrompt(rl: ReadlineInterface): void {
  if (!process.stdin.isTTY) return;

  try {
    rl.prompt();
  } catch (err) {
    const isAlreadyClosed = err instanceof Error && (err as NodeJS.ErrnoException).code === "ERR_USE_AFTER_CLOSE";
    if (!isAlreadyClosed) throw err;
  }
}