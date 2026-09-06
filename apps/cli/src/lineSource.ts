import type { Interface as ReadlineInterface } from "node:readline";

/**
 * Fuente única de líneas de entrada
 * Toda lectura de stdin en el CLI pasa por esta misma instancia.
 */
export class LineSource {
  private readonly iterator: AsyncIterator<string>;

  constructor(rl: ReadlineInterface) {
    this.iterator = rl[Symbol.asyncIterator]();
  }

  /** Devuelve la siguiente línea, o undefined si la entrada se cerró */
  async next(): Promise<string | undefined> {
    const { value, done } = await this.iterator.next();
    return done ? undefined : value;
  }
}