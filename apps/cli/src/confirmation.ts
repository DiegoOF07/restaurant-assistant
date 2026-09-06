import type { Interface as ReadlineInterface } from "node:readline";
import type { ConfirmationHandler } from "@restaurant/conversation";
import type { LineSource } from "./lineSource.js";
import { safePrompt } from "./promptUtils.js";

/** Implementa ConfirmationHandler preguntándole al usuario por terminal */
export function createLineSourceConfirmationHandler(rl: ReadlineInterface, lines: LineSource): ConfirmationHandler {
  return async (toolCall) => {
    console.log("\n [WARNING] Confirmación requerida antes de ejecutar una operación sensible:");
    console.log(`   Herramienta: ${toolCall.name}`);
    console.log(`   Argumentos:  ${JSON.stringify(toolCall.arguments)}`);
    rl.setPrompt("   ¿Confirmas esta operación? [s/N] ");
    safePrompt(rl);

    const answer = (await lines.next()) ?? "";
    const approved = /^s(í|i)?$/i.test(answer.trim());
    console.log(approved ? "[CONFIRMADO] Operación confirmada.\n" : "[CANCELADO] Operación cancelada.\n");
    return approved;
  };
}