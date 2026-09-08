import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createWebServer } from "../src/httpServer.js";
import { EventBus } from "../src/eventBus.js";
import type { AssistantSession } from "../src/assistantSession.js";

let server: Server;
let base: string;
let bus: EventBus;
let staticDir: string;
const acciones: string[] = [];

/** Doble de la sesión: sólo registra qué se le pidió. */
const sessionDoble = {
  state: async () => ({ userRole: "cook", userId: "d", serverSource: "x", servers: [], tools: [], availableRoles: [] }),
  handleMessage: async (text: string) => {
    acciones.push(`mensaje:${text}`);
  },
  resolveConfirmation: (id: string, approved: boolean) => {
    acciones.push(`confirma:${id}:${approved}`);
    return id === "valido";
  },
  setRole: async (role: string) => {
    acciones.push(`rol:${role}`);
  },
} as unknown as AssistantSession;

beforeEach(async () => {
  acciones.length = 0;
  bus = new EventBus();
  staticDir = fs.mkdtempSync(path.join(os.tmpdir(), "web-"));
  fs.writeFileSync(path.join(staticDir, "index.html"), "<html>ok</html>");

  server = createWebServer({ session: sessionDoble, bus, staticDir });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(staticDir, { recursive: true, force: true });
});

const post = (body: unknown) =>
  fetch(`${base}/api/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("órdenes del navegador", () => {
  it("acepta un mensaje y responde sin esperar al turno", async () => {
    // El turno puede tardar; su resultado viaja por SSE, no por esta respuesta.
    const res = await post({ kind: "message", text: "hola" });

    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 20));
    expect(acciones).toContain("mensaje:hola");
  });

  it("recorta el mensaje y rechaza los vacíos", async () => {
    expect((await post({ kind: "message", text: "   " })).status).toBe(400);

    await post({ kind: "message", text: "  hola  " });
    await new Promise((r) => setTimeout(r, 20));
    expect(acciones).toContain("mensaje:hola");
  });

  it("responde 409 si la confirmación ya no está pendiente", async () => {
    expect((await post({ kind: "confirm", requestId: "valido", approved: true })).status).toBe(200);
    expect((await post({ kind: "confirm", requestId: "viejo", approved: true })).status).toBe(409);
  });

  it("trata cualquier cosa que no sea true como una negativa", async () => {
    await post({ kind: "confirm", requestId: "valido", approved: "sí" });
    expect(acciones).toContain("confirma:valido:false");
  });

  it("acepta el cambio de rol", async () => {
    expect((await post({ kind: "set_role", role: "admin" })).status).toBe(202);
    await new Promise((r) => setTimeout(r, 20));
    expect(acciones).toContain("rol:admin");
  });

  it("rechaza un cuerpo que no es JSON y una orden desconocida", async () => {
    const malo = await fetch(`${base}/api/command`, { method: "POST", body: "no soy json" });
    expect(malo.status).toBe(400);

    expect((await post({ kind: "inventada" })).status).toBe(400);
  });
});

describe("flujo de eventos", () => {
  it("entrega los eventos publicados como SSE", async () => {
    const res = await fetch(`${base}/api/events`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    await new Promise((r) => setTimeout(r, 30));
    bus.publish({ kind: "assistant", text: "hola", iterations: 1 });

    const decoder = new TextDecoder();
    let recibido = "";
    while (!recibido.includes("assistant")) {
      const { value, done } = await reader.read();
      if (done) break;
      recibido += decoder.decode(value, { stream: true });
    }

    expect(recibido).toContain('"kind":"assistant"');
    await reader.cancel();
  });
});

describe("archivos estáticos", () => {
  it("sirve index.html en la raíz", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ok");
  });

  it("cae a index.html para rutas del cliente", async () => {
    expect((await fetch(`${base}/cualquier/ruta`)).status).toBe(200);
  });

  // Sin la comprobación de contención, una ruta con .. serviría archivos de fuera de la
  // carpeta: el .env del proyecto, por ejemplo.
  it("no deja escapar de la carpeta con rutas relativas", async () => {
    const secreto = path.join(path.dirname(staticDir), "secreto.txt");
    fs.writeFileSync(secreto, "no me sirvas");

    try {
      const res = await fetch(`${base}/${encodeURIComponent("..")}/secreto.txt`);
      expect(await res.text()).not.toContain("no me sirvas");
    } finally {
      fs.rmSync(secreto, { force: true });
    }
  });
});

describe("origen", () => {
  it("rechaza un origen que no sea local", async () => {
    const res = await fetch(`${base}/api/state`, { headers: { Origin: "https://sitio-malicioso.com" } });
    expect(res.status).toBe(403);
  });

  it("acepta localhost", async () => {
    const res = await fetch(`${base}/api/state`, { headers: { Origin: "http://localhost:5174" } });
    expect(res.status).toBe(200);
  });
});
