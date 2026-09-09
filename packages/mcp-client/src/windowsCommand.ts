import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Cómo lanzar un comando en Windows sin que el usuario tenga que saber que existen los
 * lanzadores `.cmd`.
 *
 * En Windows, `npx`, `uvx` o `tsx` no son ejecutables: son scripts `.cmd` que CreateProcess
 * NO resuelve (sólo añade `.exe`), así que `spawn("npx")` falla con ENOENT. Y desde
 * Node 18.20 / 20.12, lanzar un `.cmd` sin `shell: true` falla con EINVAL — la mitigación de
 * CVE-2024-27980. El resultado es que la misma entrada de mcp.servers.json que funciona en
 * Linux y macOS se rompe en Windows con dos errores distintos y ninguno explica la causa.
 *
 * Esto lo resuelve una sola vez, en el transporte: se busca el comando en el PATH probando
 * las extensiones de PATHEXT y, si lo que se encontró es un script de shell, se lanza a
 * través de cmd.exe con los argumentos ya entrecomillados.
 */

export interface WindowsSpawnPlan {
  /** Con useShell, la línea completa ya entrecomillada; si no, sólo el ejecutable. */
  command: string;
  args: string[];
  /** true cuando hay que pasar por cmd.exe (el comando resultó ser un .cmd o .bat). */
  useShell: boolean;
}

/** Extensiones que cmd.exe interpreta en vez de ejecutar directamente. */
const SHELL_SCRIPT_EXTENSIONS = new Set([".cmd", ".bat"]);

/**
 * Decide con qué comando y argumentos hay que llamar a spawn().
 *
 * Fuera de Windows no hay nada que traducir: se devuelve tal cual.
 */
export function planSpawn(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): WindowsSpawnPlan {
  if (platform !== "win32") return { command, args, useShell: false };

  const resolved = resolveWindowsExecutable(command, env) ?? command;
  if (!SHELL_SCRIPT_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    return { command: resolved, args, useShell: false };
  }

  // Con shell: true, Node arma `cmd.exe /d /s /c "..."` concatenando command y args sin
  // entrecomillar nada: las rutas con espacios (C:\Program Files\...) llegarían partidas.
  // Por eso se entrecomilla aquí y se entrega la línea ya armada en `command`: pasar `args`
  // aparte con shell: true está deprecado desde Node 24 (DEP0190) justo por ese motivo.
  return {
    command: [resolved, ...args].map(quoteForCmd).join(" "),
    args: [],
    useShell: true,
  };
}

/**
 * Busca un comando en el PATH aplicando PATHEXT, como haría la propia consola.
 *
 * Devuelve undefined cuando no lo encuentra: no es tarea de esta función explicar el fallo,
 * el error de spawn() es más informativo que uno inventado aquí.
 */
export function resolveWindowsExecutable(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  // Una ruta (absoluta o relativa) ya dice exactamente qué archivo lanzar.
  if (command.includes("/") || command.includes("\\")) {
    return path.extname(command) === "" ? probeExtensions(command, env) : command;
  }

  const directories = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  for (const directory of directories) {
    const candidate = probeExtensions(path.join(directory, command), env);
    if (candidate) return candidate;
  }
  return undefined;
}

/** Prueba `base` tal cual y luego con cada extensión de PATHEXT. */
function probeExtensions(base: string, env: NodeJS.ProcessEnv): string | undefined {
  const extensions = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  if (path.extname(base) !== "" && isFile(base)) return base;

  for (const extension of extensions) {
    const candidate = base + extension.toLowerCase();
    if (isFile(candidate)) return candidate;
  }
  return isFile(base) ? base : undefined;
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Entrecomilla un token para cmd.exe.
 *
 * Los valores vienen del archivo de configuración del propio usuario, no de la red ni del
 * modelo, así que basta con que rutas y argumentos con espacios lleguen enteros.
 */
function quoteForCmd(value: string): string {
  if (value === "") return '""';
  if (!/[\s&|<>^()"]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
