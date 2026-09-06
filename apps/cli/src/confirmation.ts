import type { Interface as ReadlineInterface } from "node:readline";
import type { ConfirmationHandler } from "@restaurant/conversation";
import type { LineSource } from "./lineSource.js";
import { safePrompt } from "./promptUtils.js";
import { bold, box, dim, gray, green, red, symbols, yellow } from "./theme.js";

/**
 * Implementa ConfirmationHandler preguntándole al usuario por terminal.
 */
export function createLineSourceConfirmationHandler(
  rl: ReadlineInterface,
  lines: LineSource,
): ConfirmationHandler {
  return async (toolCall) => {
    const args = Object.entries(toolCall.arguments).map(
      ([key, value]) => `  ${gray(key.padEnd(16))} ${bold(formatValue(value))}`,
    );

    console.log(
      `\n${box(
        [
          `${bold("Se requiere tu confirmación")} ${dim("— esta operación modifica datos")}`,
          "",
          `  ${gray("herramienta".padEnd(16))} ${bold(toolCall.name)}`,
          ...args,
        ],
        { title: `${symbols.warn} Operación sensible`, color: yellow },
      )}\n`,
    );

    rl.setPrompt(`${yellow("¿Confirmas?")} ${dim("[s/N]")} `);
    safePrompt(rl);

    const answer = (await lines.next()) ?? "";
    // Sólo un "sí" explícito aprueba: cualquier otra cosa (incluido Enter en blanco o EOF)
    // cancela. Ante la duda, no se toca el inventario.
    const approved = /^s(í|i)?$/i.test(answer.trim());

    console.log(
      approved
        ? `${green(`${symbols.ok} Operación confirmada.`)}\n`
        : `${red(`${symbols.fail} Operación cancelada.`)}\n`,
    );
    return approved;
  };
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
