import type { Interface as ReadlineInterface } from "node:readline";
import type { ConfirmationHandler } from "@restaurant/conversation";
import { describeConfirmation, type Names } from "@restaurant/presentation";
import type { LineSource } from "./lineSource.js";
import { safePrompt } from "./promptUtils.js";
import { bold, box, dim, green, red, symbols, yellow } from "./theme.js";

/**
 * Implementa ConfirmationHandler preguntándole al usuario por terminal.
 */
export function createLineSourceConfirmationHandler(
  rl: ReadlineInterface,
  lines: LineSource,
  names: () => Names = () => new Map(),
): ConfirmationHandler {
  return async (toolCall) => {
    // El texto sale de los argumentos reales: lo que se confirma es lo que se ejecuta
    const text = describeConfirmation(toolCall.name, toolCall.arguments, names());
    console.log(
      `\n${box([bold(text.question), ...text.details.map((d) => dim(d))], {
        title: `${symbols.warn} Confirmar`,
        color: red,
        width: 56,
      })}`,
    );
    console.log(dim("  /detalles después de responder muestra los argumentos técnicos.\n"));
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
