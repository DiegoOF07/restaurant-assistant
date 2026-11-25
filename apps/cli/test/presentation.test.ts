import { describe, it, expect, vi } from "vitest";
import { parseCommand } from "../src/commands.js";
import { formatStartup, renderSummary } from "../src/formatting.js";
import { symbols, visibleWidth } from "../src/theme.js";

describe("renderSummary", () => {
  it("muestra el título con el símbolo del tono y las líneas", () => {
    const out = renderSummary({ tone: "error", title: "No alcanza para 2 porciones", lines: ["Falta Queso cheddar: hay 40 g, se necesitan 160 g."] });
    expect(out).toContain(`${symbols.fail} No alcanza para 2 porciones`);
    expect(out).toContain("Falta Queso cheddar");
    expect(out).not.toContain("{");
  });

  it("alinea los items", () => {
    const out = renderSummary({ tone: "info", title: "2 ingredientes", lines: [], items: [{ label: "Lechuga", value: "500 g" }, { label: "Queso cheddar", value: "40 g" }] });
    const rows = out.split("\n").filter((l) => l.includes(" g"));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.indexOf("500 g")).toBe(rows[1]!.indexOf("40 g"));
  });
});

describe("parseCommand", () => {
  it("acepta español e inglés", () => {
    expect(parseCommand("/salir")).toEqual({ kind: "exit" });
    expect(parseCommand("/exit")).toEqual({ kind: "exit" });
    expect(parseCommand("/ayuda")).toEqual({ kind: "help" });
    expect(parseCommand("/herramientas")).toEqual({ kind: "tools" });
    expect(parseCommand("/servidores")).toEqual({ kind: "servers" });
    expect(parseCommand("/registro")).toEqual({ kind: "log" });
    expect(parseCommand("/limpiar")).toEqual({ kind: "clear" });
    expect(parseCommand("/detalles")).toEqual({ kind: "details" });
  });

  it("sugiere el comando más parecido", () => {
    expect(parseCommand("/detalle")).toEqual({ kind: "unknown", suggestion: "/detalles" });
    expect(parseCommand("/salr")).toEqual({ kind: "unknown", suggestion: "/salir" });
    expect(parseCommand("/xyzxyz")).toEqual({ kind: "unknown" });
  });
});

describe("formatStartup", () => {
  it("cabe en 6 líneas y no lista herramientas", () => {
    const out = formatStartup({ userRole: "cook", userId: "diego", serverNames: ["restaurant-local"], width: 100 });
    const lines = out.split("\n").filter((l) => l.trim());
    expect(lines.length).toBeLessThanOrEqual(6);
    expect(out).toContain("Cocina");
    expect(out).toContain("demostración");
    expect(out).toContain("restaurant-local");
    expect(out).toContain("/ayuda");
    expect(out).not.toContain("adjust_inventory");
  });

  it("no pasa de 72 columnas", () => {
    const out = formatStartup({ userRole: "cook", userId: "diego", model: "claude-haiku-4-5", serverNames: ["a"], width: 200 });
    expect(Math.max(...out.split("\n").map(visibleWidth))).toBeLessThanOrEqual(72);
  });
});
