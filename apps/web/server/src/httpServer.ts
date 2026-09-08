import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import type { AssistantSession } from "./assistantSession.js";
import type { EventBus } from "./eventBus.js";
import type { ClientCommand } from "./types.js";

/**
 * Backend de la interfaz web.
 *
 * Se usa `node:http` a secas, sin framework: el flujo hacia el navegador va por SSE y las
 * órdenes vuelven por POST. Es el mismo patrón que el transporte HTTP del servidor MCP, y
 * evita sumar dependencias a un proyecto que casi no tiene.
 *
 * Por qué SSE y no WebSocket: el tráfico es asimétrico —muchos eventos hacia el navegador,
 * pocas órdenes de vuelta— y SSE reconecta solo, viene en el navegador y no necesita
 * ninguna librería del lado de Node.
 */

const MAX_BODY_BYTES = 1 << 20; // 1 MiB: los mensajes de chat no se acercan ni de lejos

export interface WebServerOptions {
  session: AssistantSession;
  bus: EventBus;
  /** Carpeta con el frontend ya compilado. Sin ella sólo se sirve la API. */
  staticDir?: string;
}

export function createWebServer(options: WebServerOptions): http.Server {
  return http.createServer((req, res) => {
    // El backend habla sólo con el navegador de esta máquina; se rechaza cualquier origen
    // cruzado en vez de abrir CORS.
    const origin = req.headers.origin;
    if (origin && !isLocalOrigin(origin)) {
      send(res, 403, { error: "origen no permitido" });
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/api/events" && req.method === "GET") {
      handleEvents(req, res, options.bus);
      return;
    }

    if (url.pathname === "/api/command" && req.method === "POST") {
      void handleCommand(req, res, options.session);
      return;
    }

    if (url.pathname === "/api/state" && req.method === "GET") {
      void options.session
        .state()
        .then((state) => send(res, 200, state))
        .catch((err: unknown) => send(res, 500, { error: String(err) }));
      return;
    }

    if (options.staticDir && req.method === "GET") {
      serveStatic(res, options.staticDir, url.pathname);
      return;
    }

    send(res, 404, { error: "no encontrado" });
  });
}

/** Abre el flujo SSE y lo mantiene vivo hasta que el navegador se va. */
function handleEvents(req: http.IncomingMessage, res: http.ServerResponse, bus: EventBus): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Sin esto un proxy intermedio puede acumular el flujo y no entregar nada.
    "X-Accel-Buffering": "no",
  });
  res.write("\n");

  const unsubscribe = bus.subscribe({
    send(event) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    },
  });

  // Un comentario periódico evita que un proxy o el sistema operativo corten una conexión
  // que lleva rato en silencio.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 20_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

async function handleCommand(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  session: AssistantSession,
): Promise<void> {
  let command: ClientCommand;
  try {
    command = JSON.parse(await readBody(req)) as ClientCommand;
  } catch (err) {
    send(res, 400, { error: `cuerpo inválido: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  switch (command.kind) {
    case "message": {
      if (typeof command.text !== "string" || command.text.trim() === "") {
        send(res, 400, { error: "el mensaje viene vacío" });
        return;
      }
      // Se responde de inmediato: el turno puede tardar y su resultado viaja por SSE.
      send(res, 202, { accepted: true });
      void session.handleMessage(command.text.trim());
      return;
    }

    case "confirm": {
      const resolved = session.resolveConfirmation(command.requestId, command.approved === true);
      send(res, resolved ? 200 : 409, resolved ? { ok: true } : { error: "esa confirmación ya no está pendiente" });
      return;
    }

    case "set_role": {
      send(res, 202, { accepted: true });
      void session.setRole(command.role);
      return;
    }

    default:
      send(res, 400, { error: "orden desconocida" });
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("cuerpo demasiado grande"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** Sirve el frontend compilado, con index.html como respaldo para las rutas del cliente. */
function serveStatic(res: http.ServerResponse, staticDir: string, pathname: string): void {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(staticDir, relative);

  // Sin esta comprobación, una ruta como /../../.env serviría archivos fuera de la carpeta.
  if (resolved !== staticDir && !resolved.startsWith(staticDir + path.sep)) {
    send(res, 403, { error: "ruta no permitida" });
    return;
  }

  const file = fs.existsSync(resolved) && fs.statSync(resolved).isFile()
    ? resolved
    : path.join(staticDir, "index.html");

  if (!fs.existsSync(file)) {
    send(res, 404, { error: "frontend no compilado; corre `pnpm build` en apps/web" });
    return;
  }

  res.writeHead(200, { "Content-Type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

function send(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}
