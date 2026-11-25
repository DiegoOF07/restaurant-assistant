export type Command =
  | { kind: "exit" | "help" | "tools" | "servers" | "log" | "clear" | "details" }
  | { kind: "unknown"; suggestion?: string };

// Comandos en español; los nombres en inglés quedan como alias
const COMMANDS: Record<string, Exclude<Command["kind"], "unknown">> = {
  "/salir": "exit",
  "/exit": "exit",
  "/ayuda": "help",
  "/help": "help",
  "/herramientas": "tools",
  "/tools": "tools",
  "/servidores": "servers",
  "/servers": "servers",
  "/registro": "log",
  "/log": "log",
  "/limpiar": "clear",
  "/clear": "clear",
  "/detalles": "details",
};

export const SPANISH_COMMANDS = ["/ayuda", "/herramientas", "/servidores", "/registro", "/detalles", "/limpiar", "/salir"];

export function parseCommand(input: string): Command {
  const name = input.trim().split(/\s+/)[0]!.toLowerCase();
  const kind = COMMANDS[name];
  if (kind) return { kind };
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of SPANISH_COMMANDS) {
    const d = distance(name, candidate);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best ? { kind: "unknown", suggestion: best } : { kind: "unknown" };
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length]!;
}
