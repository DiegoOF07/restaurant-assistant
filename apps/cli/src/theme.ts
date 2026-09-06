/**
 * Capa de presentación del CLI
 */

const ESC = "\u001b[";
const FORCE = process.env.FORCE_COLOR;

/** Se respeta la convención NO_COLOR y FORCE_COLOR para lo contrario.*/
export const colorEnabled: boolean =
  FORCE !== undefined && FORCE !== "0"
    ? true
    : process.env.NO_COLOR !== undefined
      ? false
      : Boolean(process.stdout.isTTY) && process.env.TERM !== "dumb";

/** Los símbolos fuera de ASCII se degradan en terminales que no declaran UTF-8. */
const unicodeEnabled: boolean = /UTF-?8/i.test(
  process.env.LC_ALL ?? process.env.LC_CTYPE ?? process.env.LANG ?? "",
);

function wrap(open: number, close: number) {
  return (text: string): string => (colorEnabled ? `${ESC}${open}m${text}${ESC}${close}m` : text);
}

/** Funciones de color. Cada una devuelve el texto tal cual si el color está apagado. */
export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const blue = wrap(34, 39);
export const magenta = wrap(35, 39);
export const cyan = wrap(36, 39);
export const gray = wrap(90, 39);

/** Símbolos de la interfaz, con equivalente ASCII para terminales sin UTF-8. */
export const symbols = unicodeEnabled
  ? { ok: "✓", fail: "✗", warn: "▲", arrow: "›", bullet: "•", tool: "⚙", robot: "◆", user: "▸" }
  : { ok: "OK", fail: "X", warn: "!", arrow: ">", bullet: "-", tool: "*", robot: "#", user: ">" };

const bx = unicodeEnabled
  ? { h: "─", v: "│", tl: "╭", tr: "╮", bl: "╰", br: "╯" }
  : { h: "-", v: "|", tl: "+", tr: "+", bl: "+", br: "+" };

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

/** Ancho visible de un texto, ignorando los códigos de escape que no ocupan columnas */
export function visibleWidth(text: string): number {
  return text.replace(ANSI_PATTERN, "").length;
}

/** Ancho útil de la terminal, acotado para que las cajas sigan siendo legibles */
export function terminalWidth(): number {
  const columns = process.stdout.columns ?? 80;
  return Math.max(40, Math.min(columns, 100));
}

/** Ajustes del recuadro. Sin `width` se usa el ancho de la terminal acotado */
export interface BoxOptions {
  title?: string;
  color?: (text: string) => string;
  width?: number;
}

/** Dibuja un recuadro alrededor de las líneas dadas, respetando el color ya aplicado. */
export function box(lines: string[], options: BoxOptions = {}): string {
  const paint = options.color ?? ((t: string) => t);
  const width = options.width ?? terminalWidth();
  const inner = width - 4; // dos caracteres de marco y un espacio a cada lado

  const wrapped = lines.flatMap((line) => wrapLine(line, inner));

  const titleText = options.title ? ` ${options.title} ` : "";
  const topFill = Math.max(0, width - 2 - titleText.length);
  const top =
    paint(bx.tl) + (titleText ? paint(bold(titleText)) : "") + paint(bx.h.repeat(topFill)) + paint(bx.tr);
  const bottom = paint(bx.bl + bx.h.repeat(width - 2) + bx.br);

  const body = wrapped.map((line) => {
    const padding = " ".repeat(Math.max(0, inner - visibleWidth(line)));
    return `${paint(bx.v)} ${line}${padding} ${paint(bx.v)}`;
  });

  return [top, ...body, bottom].join("\n");
}


export function wrapLine(line: string, width: number): string[] {
  if (visibleWidth(line) <= width) return [line];

  const words = line.split(" ");
  const out: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (visibleWidth(candidate) <= width) {
      current = candidate;
      continue;
    }
    if (current !== "") out.push(current);

    // Una palabra sola más larga que el ancho se corta a la fuerza
    let rest = word;
    while (visibleWidth(rest) > width) {
      out.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    current = rest;
  }
  if (current !== "") out.push(current);
  return out;
}

/** Línea horizontal del ancho de la terminal, para separar bloques largos */
export function rule(): string {
  return gray(bx.h.repeat(terminalWidth()));
}

/**
 * Indicador de actividad mientras se espera al modelo o a una herramienta
 */
export class Spinner {
  private static readonly FRAMES = unicodeEnabled
    ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    : ["|", "/", "-", "\\"];

  private timer?: NodeJS.Timeout;
  private frame = 0;
  private label: string;
  private readonly active: boolean;

  constructor(label: string) {
    this.label = label;
    this.active = Boolean(process.stdout.isTTY) && colorEnabled;
  }

  start(): this {
    if (!this.active || this.timer) return this;
    this.timer = setInterval(() => this.render(), 90);
    this.timer.unref?.();
    this.render();
    return this;
  }

  /** Cambia el texto sin reiniciar la animación */
  update(label: string): void {
    this.label = label;
    if (this.active) this.render();
  }

  /** Detiene la animación y limpia la línea */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.active) process.stdout.write(`\r${ESC}2K`);
  }

  private render(): void {
    const frame = Spinner.FRAMES[this.frame % Spinner.FRAMES.length] ?? "";
    this.frame++;
    process.stdout.write(`\r${ESC}2K${cyan(frame)} ${dim(this.label)}`);
  }
}
