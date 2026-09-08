import * as fs from "node:fs";
import * as path from "node:path";
import type { McpServerConfig } from "@restaurant/host";
import { ConfigError } from "./config.js";

/**
 * Descubrimiento de servidores MCP a partir de un archivo declarativo.
 * Agregar un servidor debe ser editar JSON, no recompilar el CLI.
 */

/** Nombre por defecto del archivo, buscado en la raíz del paquete del CLI. */
export const DEFAULT_CONFIG_FILENAME = "mcp.servers.json";

/**
 * Una entrada del archivo de configuración, tal como se escribe en el JSON.
 *
 * Lleva `command` (servidor local, lanzado por stdio) o `url` (servidor remoto por HTTP),
 * nunca ambos: son dos maneras excluyentes de alcanzar un servidor.
 */
export interface ServerFileEntry {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  description?: string;
}

/** Servidores listos para lanzar, más de dónde salieron (para poder decírselo al usuario). */
export interface ResolvedServers {
  servers: McpServerConfig[];
  source: "file" | "env";
  path?: string;
  disabled: string[];
}

/** Entradas de la resolución. Ver resolveServers() para el orden de precedencia. */
export interface ResolveServersOptions {
  /** Raíz del paquete del CLI: base para rutas relativas y para buscar el archivo. */
  baseDir: string;
  env: NodeJS.ProcessEnv;
  /** Ruta explícita al archivo. Si se da y no existe, es un error, no un fallback silencioso. */
  configPath?: string;
  /** Variables inyectadas en todo servidor (la identidad). El archivo puede sobrescribirlas. */
  defaultEnv?: Record<string, string>;
}

/**
 * Resuelve la lista de servidores a lanzar
 */
export function resolveServers(options: ResolveServersOptions): ResolvedServers {
  const { baseDir, env, defaultEnv = {} } = options;

  const explicitPath = options.configPath ?? env.MCP_CONFIG_FILE?.trim();
  if (explicitPath) {
    const resolved = path.resolve(baseDir, explicitPath);
    if (!fs.existsSync(resolved)) {
      throw new ConfigError(
        `No se encontró el archivo de configuración de servidores MCP:\n  ${resolved}\n\n` +
          `Se pidió explícitamente (--config o MCP_CONFIG_FILE), así que no se busca otra fuente.\n` +
          `Copia ${DEFAULT_CONFIG_FILENAME}.example y ajústalo, o quita la variable para usar el archivo por defecto.`,
      );
    }
    return fromFile(resolved, defaultEnv);
  }

  const defaultPath = path.join(baseDir, DEFAULT_CONFIG_FILENAME);
  if (fs.existsSync(defaultPath)) {
    return fromFile(defaultPath, defaultEnv);
  }

  return fromEnv(baseDir, env, defaultEnv);
}

function fromFile(filePath: string, defaultEnv: Record<string, string>): ResolvedServers {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    throw new ConfigError(`No se pudo leer ${filePath}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`${filePath} no es JSON válido:\n  ${(err as Error).message}`);
  }

  const entries = extractEntries(parsed, filePath);
  const configDir = path.dirname(filePath);

  const servers: McpServerConfig[] = [];
  const disabled: string[] = [];
  const seen = new Set<string>();

  entries.forEach((entry, index) => {
    const where = `${filePath} -> servers[${index}]`;
    validateEntry(entry, where);

    if (seen.has(entry.name)) {
      throw new ConfigError(
        `${where}: ya hay otro servidor llamado "${entry.name}". Los nombres deben ser únicos ` +
          `porque identifican de qué servidor vino cada herramienta en el log.`,
      );
    }
    seen.add(entry.name);

    if (entry.enabled === false) {
      disabled.push(entry.name);
      return;
    }

    if (entry.url) {
      // A un servidor remoto NO se le inyecta la identidad: por HTTP el servidor no puede
      // confiar en algo que el cliente elige, así que deriva el rol del token. Mandar
      // MCP_USER_ROLE acá daría la falsa impresión de que sirve para algo.
      servers.push({
        name: entry.name,
        url: expand(entry.url, where),
        ...(entry.headers ? { headers: expandRecord(entry.headers, where) } : {}),
      });
      return;
    }

    const command = resolveCommand(expand(entry.command!, where), configDir);
    assertCommandIsUsable(command, entry.command!, entry.name, configDir);

    servers.push({
      name: entry.name,
      command,
      args: (entry.args ?? []).map((arg) => expand(arg, where)),
      env: { ...defaultEnv, ...expandRecord(entry.env ?? {}, where) },
    });
  });

  if (servers.length === 0) {
    throw new ConfigError(
      `${filePath} no habilita ningún servidor MCP.\n` +
        (disabled.length > 0
          ? `Están todos con "enabled": false (${disabled.join(", ")}). Habilita al menos uno.`
          : `Agrega al menos una entrada en "servers".`),
    );
  }

  return { servers, source: "file", path: filePath, disabled };
}

function extractEntries(parsed: unknown, filePath: string): ServerFileEntry[] {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(`${filePath}: el contenido debe ser un objeto JSON con una clave "servers".`);
  }

  const servers = (parsed as { servers?: unknown }).servers;
  if (servers === undefined) {
    throw new ConfigError(
      `${filePath}: falta la clave "servers".\n\nEjemplo mínimo:\n` +
        `{\n  "servers": [\n    { "name": "restaurant-local", "command": "./bin/restaurant-mcp-server" }\n  ]\n}`,
    );
  }

  if (Array.isArray(servers)) {
    return servers as ServerFileEntry[];
  }

  // Forma alternativa por nombre, la que usan varios clientes MCP conocidos.
  if (typeof servers === "object" && servers !== null) {
    return Object.entries(servers as Record<string, Omit<ServerFileEntry, "name">>).map(([name, entry]) => ({
      name,
      ...entry,
    }));
  }

  throw new ConfigError(`${filePath}: "servers" debe ser un arreglo o un objeto de servidores por nombre.`);
}

function validateEntry(entry: ServerFileEntry, where: string): void {
  if (typeof entry !== "object" || entry === null) {
    throw new ConfigError(`${where}: cada servidor debe ser un objeto.`);
  }
  if (typeof entry.name !== "string" || entry.name.trim() === "") {
    throw new ConfigError(`${where}: falta "name" (texto no vacío).`);
  }
  const hasCommand = typeof entry.command === "string" && entry.command.trim() !== "";
  const hasUrl = typeof entry.url === "string" && entry.url.trim() !== "";

  if (hasCommand && hasUrl) {
    throw new ConfigError(
      `${where} ("${entry.name}"): tiene "command" y "url" a la vez. Son excluyentes: ` +
        `"command" lanza un servidor local por stdio, "url" contacta uno remoto por HTTP.`,
    );
  }
  if (!hasCommand && !hasUrl) {
    throw new ConfigError(
      `${where} ("${entry.name}"): falta "command" (ruta al binario o comando del PATH) ` +
        `o "url" (endpoint MCP de un servidor remoto).`,
    );
  }
  if (hasUrl) {
    assertUsableUrl(entry.url!, entry.name, where);
    if (entry.args !== undefined || entry.env !== undefined) {
      throw new ConfigError(
        `${where} ("${entry.name}"): "args" y "env" sólo aplican a servidores locales. ` +
          `Para uno remoto, usa "headers".`,
      );
    }
  }
  if (hasCommand && entry.headers !== undefined) {
    throw new ConfigError(
      `${where} ("${entry.name}"): "headers" sólo aplica a servidores remotos ("url").`,
    );
  }
  if (entry.args !== undefined) {
    if (!Array.isArray(entry.args) || entry.args.some((a) => typeof a !== "string")) {
      throw new ConfigError(`${where} ("${entry.name}"): "args" debe ser un arreglo de textos.`);
    }
  }
  if (entry.env !== undefined) {
    const invalid =
      typeof entry.env !== "object" ||
      entry.env === null ||
      Object.values(entry.env).some((v) => typeof v !== "string");
    if (invalid) {
      throw new ConfigError(`${where} ("${entry.name}"): "env" debe ser un objeto de texto a texto.`);
    }
  }
  if (entry.headers !== undefined) {
    const invalid =
      typeof entry.headers !== "object" ||
      entry.headers === null ||
      Object.values(entry.headers).some((v) => typeof v !== "string");
    if (invalid) {
      throw new ConfigError(`${where} ("${entry.name}"): "headers" debe ser un objeto de texto a texto.`);
    }
  }
  if (entry.enabled !== undefined && typeof entry.enabled !== "boolean") {
    throw new ConfigError(`${where} ("${entry.name}"): "enabled" debe ser true o false.`);
  }
}

function resolveCommand(command: string, configDir: string): string {
  const looksLikePath = command.includes("/") || command.includes("\\");
  return looksLikePath ? path.resolve(configDir, command) : command;
}

function expand(value: string, where: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const replacement = process.env[name];
    if (replacement === undefined) {
      throw new ConfigError(
        `${where}: se referencia \${${name}} pero esa variable de entorno no está definida.\n` +
          `Defínela en tu shell o en apps/cli/.env antes de arrancar.`,
      );
    }
    return replacement;
  });
}

function expandRecord(record: Record<string, string>, where: string): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, expand(value, where)]));
}

function fromEnv(
  baseDir: string,
  env: NodeJS.ProcessEnv,
  defaultEnv: Record<string, string>,
): ResolvedServers {
  const rawBin = env.MCP_SERVER_BIN;
  if (!rawBin) {
    throw new ConfigError(
      `No hay ningún servidor MCP configurado.\n\n` +
        `Se buscó, en este orden:\n` +
        `  1. El archivo indicado por --config o MCP_CONFIG_FILE (no se indicó ninguno).\n` +
        `  2. ${path.join(baseDir, DEFAULT_CONFIG_FILENAME)} (no existe).\n` +
        `  3. La variable de entorno MCP_SERVER_BIN (no está definida).\n\n` +
        `Lo más simple es copiar la plantilla:\n` +
        `  cp apps/cli/${DEFAULT_CONFIG_FILENAME}.example apps/cli/${DEFAULT_CONFIG_FILENAME}\n` +
        `y ajustar la ruta del binario del servidor.`,
    );
  }

  const command = path.resolve(baseDir, rawBin);
  assertCommandIsUsable(command, rawBin, "restaurant-local", baseDir);
  const args = env.MCP_SERVER_ARGS ? env.MCP_SERVER_ARGS.split(" ").filter(Boolean) : [];

  return {
    servers: [{ name: "restaurant-local", command, args, env: { ...defaultEnv } }],
    source: "env",
    disabled: [],
  };
}

/** Comprueba que un comando con forma de ruta exista y sea ejecutable ANTES de intentar lanzarlo */
export function assertCommandIsUsable(
  resolvedPath: string,
  originalValue: string,
  serverName: string,
  baseDir: string,
): void {
  if (!originalValue.includes("/") && !originalValue.includes("\\")) return;

  if (!fs.existsSync(resolvedPath)) {
    const buildHint =
      process.platform === "win32"
        ? "go build -o bin\\restaurant-mcp-server.exe .\\cmd\\stdio"
        : "go build -o bin/restaurant-mcp-server ./cmd/stdio";

    throw new ConfigError(
      `El servidor MCP "${serverName}" apunta a un archivo que no existe:\n` +
        `  ${resolvedPath}\n\n` +
        `(command="${originalValue}", resuelto respecto a: ${baseDir})\n\n` +
        `Verifica lo siguiente:\n` +
        `  1. Que ya compilaste el servidor para TU sistema operativo actual (detectado: ${process.platform}):\n` +
        `       ${buildHint}\n` +
        `  2. Que la ruta en "command" apunta exactamente a ese archivo.\n` +
        `  3. Si usas WSL: compila y corre el CLI desde el MISMO entorno. Un binario compilado dentro\n` +
        `     de WSL (Linux) no puede ejecutarse desde PowerShell/node.exe de Windows, y viceversa —\n` +
        `     son dos sistemas operativos distintos aunque compartan el mismo disco.\n` +
        `  4. En Windows el binario debe terminar en ".exe"; en Linux/macOS/WSL, sin extensión.`,
    );
  }

  if (process.platform !== "win32") {
    try {
      fs.accessSync(resolvedPath, fs.constants.X_OK);
    } catch {
      throw new ConfigError(
        `El servidor MCP "${serverName}" apunta a un archivo que existe pero no es ejecutable:\n` +
          `  ${resolvedPath}\n` +
          `Corrígelo con: chmod +x "${resolvedPath}"`,
      );
    }
  }
}

/**
 * Valida la URL de un servidor remoto antes de intentar hablarle.
 *
 * Se avisa (sin bloquear) cuando se usa http:// contra un host que no es local: el token de
 * autenticación viajaría en claro y cualquiera en la misma red podría leerlo. No se prohíbe
 * porque en una demo de clase entre dos laptops es una elección legítima.
 */
function assertUsableUrl(rawUrl: string, serverName: string, where: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ConfigError(
      `${where} ("${serverName}"): "url" no es válida: ${rawUrl}\n` +
        `Debe ser una URL completa, por ejemplo https://mi-servidor.com/mcp`,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigError(
      `${where} ("${serverName}"): "url" usa el esquema ${parsed.protocol}, y sólo se admiten http y https.`,
    );
  }

  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  if (parsed.protocol === "http:" && !isLocal) {
    console.warn(
      `[AVISO] El servidor "${serverName}" usa http:// contra un host remoto (${parsed.hostname}). ` +
        `Las credenciales viajarán sin cifrar. Usa https:// cuando sea posible.`,
    );
  }
}
