import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planSpawn, resolveWindowsExecutable } from "../src/windowsCommand.js";

/**
 * Los casos se montan sobre archivos reales en un directorio temporal, con un PATH y un
 * PATHEXT falsos: la lógica que se prueba es "buscar como lo haría la consola", y hacerlo
 * contra un doble de fs sólo probaría el doble.
 */
describe("resolveWindowsExecutable", () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-win-cmd-"));
    fs.writeFileSync(path.join(dir, "npx.cmd"), "");
    fs.writeFileSync(path.join(dir, "uvx.exe"), "");
    env = { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("encuentra un lanzador .cmd que se escribió sin extensión", () => {
    expect(resolveWindowsExecutable("npx", env)).toBe(path.join(dir, "npx.cmd"));
  });

  it("encuentra un .exe del PATH", () => {
    expect(resolveWindowsExecutable("uvx", env)).toBe(path.join(dir, "uvx.exe"));
  });

  it("devuelve undefined si el comando no está en el PATH", () => {
    expect(resolveWindowsExecutable("no-existe", env)).toBeUndefined();
  });

  it("no busca en el PATH cuando ya se dio una ruta", () => {
    const ruta = path.join(dir, "uvx.exe");
    expect(resolveWindowsExecutable(ruta, env)).toBe(ruta);
  });
});

describe("planSpawn", () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-win-plan-"));
    fs.writeFileSync(path.join(dir, "npx.cmd"), "");
    fs.writeFileSync(path.join(dir, "uvx.exe"), "");
    env = { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fuera de Windows no toca nada", () => {
    const plan = planSpawn("npx", ["-y", "server"], "linux", env);
    expect(plan).toEqual({ command: "npx", args: ["-y", "server"], useShell: false });
  });

  it("un .cmd se lanza por cmd.exe como una sola línea, con lo que lleva espacios entrecomillado", () => {
    const plan = planSpawn("npx", ["-y", "@scope/server", "C:\\Mis Archivos\\repo"], "win32", env);

    expect(plan.useShell).toBe(true);
    expect(plan.args).toEqual([]);
    // El entrecomillado sólo aparece donde hace falta, de ahí el replace del ejecutable: el
    // directorio temporal puede o no tener espacios según la máquina.
    const [ejecutable, ...resto] = plan.command.split(" -y ");
    expect(ejecutable!.replace(/"/g, "")).toBe(path.join(dir, "npx.cmd"));
    expect(resto.join(" -y ")).toBe('@scope/server "C:\\Mis Archivos\\repo"');
  });

  it("un .exe se lanza directo, sin shell", () => {
    const plan = planSpawn("uvx", ["mcp-server-git"], "win32", env);

    expect(plan.useShell).toBe(false);
    expect(plan.command).toBe(path.join(dir, "uvx.exe"));
    expect(plan.args).toEqual(["mcp-server-git"]);
  });

  it("un comando que no aparece en el PATH se deja igual para que falle spawn()", () => {
    const plan = planSpawn("no-existe", [], "win32", env);
    expect(plan).toEqual({ command: "no-existe", args: [], useShell: false });
  });
});
