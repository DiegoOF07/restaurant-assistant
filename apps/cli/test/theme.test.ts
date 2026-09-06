import { describe, it, expect } from "vitest";
import { box, visibleWidth, wrapLine } from "../src/theme.js";

// En las pruebas la salida no es una terminal, así que el color está apagado y lo que se
// mide es la geometría pura de las cajas.

describe("visibleWidth", () => {
  it("no cuenta los códigos de escape ANSI", () => {
    expect(visibleWidth("hola")).toBe(4);
    expect(visibleWidth("\u001b[1mhola\u001b[22m")).toBe(4);
  });
});

describe("wrapLine", () => {
  it("deja intacta una línea que ya cabe", () => {
    expect(wrapLine("corta", 20)).toEqual(["corta"]);
  });

  it("parte por espacios sin exceder el ancho", () => {
    const parts = wrapLine("uno dos tres cuatro cinco", 11);
    expect(parts.every((p) => p.length <= 11)).toBe(true);
    expect(parts.join(" ")).toBe("uno dos tres cuatro cinco");
  });

  it("corta a la fuerza una palabra más larga que el ancho, en vez de desbordar", () => {
    const parts = wrapLine("supercalifragilisticoespialidoso", 10);
    expect(parts.every((p) => p.length <= 10)).toBe(true);
    expect(parts.join("")).toBe("supercalifragilisticoespialidoso");
  });
});

describe("box", () => {
  it("produce todas las líneas del mismo ancho", () => {
    const rendered = box(["corta", "una línea bastante más larga que la anterior"], { width: 40 });
    const widths = new Set(rendered.split("\n").map(visibleWidth));
    expect(widths).toEqual(new Set([40]));
  });

  it("incluye el título en el borde superior", () => {
    expect(box(["contenido"], { title: "Aviso", width: 40 })).toContain("Aviso");
  });

  it("no desborda cuando el contenido es más ancho que la caja", () => {
    const rendered = box(["x".repeat(200)], { width: 30 });
    for (const line of rendered.split("\n")) {
      expect(visibleWidth(line)).toBe(30);
    }
  });
});
