// Verificación manual de HostService.create() contra el binario Go real.
// Usa MockProvider porque AnthropicProvider aún no existe (semana 3,
// siguiente paso) — esto demuestra que TODO lo demás (mcp-client,
// conversation, multi-server aggregation, logging unificado, confirmación)
// ya funciona junto en un solo flujo real, sin ningún fixture de por medio.
//
// Requisitos previos:
//   1. cd restaurant-mcp-server && go build -o bin/restaurant-mcp-server ./cmd/stdio
//   2. pnpm -r run build   (desde la raíz del monorepo)
//
// Uso:
//   node examples/manual-smoke-test.mjs /ruta/a/restaurant-mcp-server/bin/restaurant-mcp-server

import { MockProvider } from "../../../packages/llm-provider/dist/index.js";
import { HostService } from "../dist/hostService.js";

const binaryPath = process.argv[2] ?? process.env.MCP_SERVER_BIN;
if (!binaryPath) {
  console.error("Uso: node examples/manual-smoke-test.mjs /ruta/al/binario/restaurant-mcp-server");
  process.exit(1);
}

const provider = new MockProvider();
// Turno 1: el "LLM" decide consultar disponibilidad.
provider.enqueueToolCall([
  { id: "call-1", name: "get_dish_availability", arguments: { dishId: "special-burger", servings: 2 } },
]);
provider.enqueueText("Con lo que tenemos ahora, solo alcanza para 1 hamburguesa especial, no para 2.");
// Turno para el segundo mensaje del usuario: una operación sensible.
provider.enqueueToolCall([
  {
    id: "call-2",
    name: "adjust_inventory",
    arguments: {
      ingredientId: "cheese",
      operation: "add",
      quantity: 1,
      unit: "kg",
      reason: "manual smoke test restock",
      idempotencyKey: `host-smoke-${Date.now()}`,
    },
  },
]);
provider.enqueueText("Listo, repuse el queso.");

const host = await HostService.create({
  provider,
  servers: [{ name: "restaurant-local", command: binaryPath }],
  toolsRequiringConfirmation: ["adjust_inventory"],
  requestConfirmation: async (toolCall) => {
    console.log(`[confirmación] aprobando automáticamente: ${toolCall.name}`);
    return true; // en apps/cli esto será una pregunta real por terminal
  },
});

console.log("== Herramientas descubiertas ==");
console.log((await host.listAvailableTools()).map((t) => t.name));

console.log("\n== Turno 1 ==");
const turn1 = await host.sendMessage("demo-session", "¿Alcanza el queso para 2 hamburguesas especiales?");
console.log("Respuesta:", turn1.reply);

console.log("\n== Turno 2 (operación sensible) ==");
const turn2 = await host.sendMessage("demo-session", "Repón un kilo de queso, por favor");
console.log("Respuesta:", turn2.reply);

console.log("\n== Log unificado de la sesión ==");
for (const entry of host.getLog("demo-session")) {
  console.log(`[${entry.source}] ${entry.kind}${entry.toolName ? ` (${entry.toolName})` : ""}`);
}

await host.close();
console.log("\nOK: HostService orquestó LLM + MCP real + confirmación + log de punta a punta.");
