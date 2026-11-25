import type { CompletionRequest, CompletionResult, ConversationMessage, ToolCall, ToolSpec } from "@restaurant/llm-provider";

/**
 * PROVEEDOR DE DEMOSTRACIÓN, NO UN LLM REAL.
 *
 * Vive en apps/cli (no en @restaurant/llm-provider) porque no es un proveedor reutilizable:
 * es una herramienta de desarrollo de esta aplicación. Igual que un modelo, primero busca el
 * platillo o el ingrediente con las herramientas del servidor y después actúa sobre el id
 * encontrado; si no encuentra nada lo dice, en vez de operar sobre otra cosa.
 */

type Intent = "availability" | "recipe" | "menu" | "adjust";

const HELP =
  "Soy el modo de demostración (no hay un LLM conectado). Prueba con «¿Cuántas hamburguesas especiales puedo preparar?», " +
  "«¿Qué alérgenos tiene el pastel de chocolate?» o «Se dañaron 200 g de lechuga».";

// Los verbos se buscan al inicio de una palabra: «quedan» no es «dañaron» ni «restaurante» es «resta»
const START = "(?:^|[^a-záéíóúüñ])";
const END = "(?![a-záéíóúüñ])";
const SUBTRACT = new RegExp(`${START}(da[ñn]|perd|descuent|rest(?:a|ar|ó|aron|en)${END}|quit|tir(?:a|ar|ó|aron)${END}|venc)`);
const ADD = new RegExp(`${START}(rep[oó]n|lleg|agreg|sum(?:a|ar|ó|aron)${END}|añad)`);

// Palabras que no forman parte del nombre de un platillo o ingrediente
const STOPWORDS = new Set(
  (
    "qué que cuántas cuántos cuantas cuantos cuánto cuanto puedo podemos preparar hacer hay para alcanza alcanzan " +
    "porción porciones porcion receta recetas ingrediente ingredientes lleva llevan tiene tienen alérgeno alérgenos alergeno alergenos " +
    "el la los las del un una unos unas se me nos mi hoy y con sin por favor en " +
    "dañaron dañó daño dañado dañados perdieron perdió perdio descuenta descontar resta restar quita quitar tira tiraron tiró " +
    "venció vencieron repón repon reponer llegaron llegó llego llegó agrega agregar suma sumar añade añadir " +
    "g gr gramo gramos kg kilo kilos ml l litro litros medio media unidad unidades menú menu platillo platillos " +
    "disponible disponibles disponibilidad queda quedan quedaron cuánta cuanta cuántos tenemos persona personas " +
    "esta este noche ahora mesa mesas"
  ).split(" "),
);

export class HeuristicDemoProvider {
  private nextId = 1;

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const userIndex = lastIndex(request.messages, (m) => m.role === "user");
    const userText = userIndex >= 0 ? String((request.messages[userIndex] as { content: string }).content) : "";
    const text = userText.toLowerCase();
    const has = (name: string) => request.tools.some((t: ToolSpec) => t.name === name);
    const toolMessages = request.messages
      .slice(userIndex + 1)
      .filter((m): m is Extract<ConversationMessage, { role: "tool" }> => m.role === "tool");
    const intent = detectIntent(text);
    if (!intent) return this.reply(HELP);

    const last = toolMessages.at(-1);
    if (!last) return this.start(intent, text, has);
    if (last.isError) return this.reply(`No se pudo: ${errorText(last.content)}`);

    // Resultado de la acción final
    if (!last.toolName.startsWith("search_") || intent === "menu") return this.reply(FINAL[intent]);

    // Resultado de una búsqueda: elegir el id o explicar por qué no
    const noun = extractNoun(text);
    const searches = toolMessages.filter((m) => m.toolName === last.toolName).length;
    const items = parseItems(last.content, last.toolName === "search_dishes" ? "dishes" : "ingredients");
    const place = last.toolName === "search_dishes" ? "el menú" : "el inventario";

    if (items.length === 0) {
      // Siguiente intento: la palabra tal como se escribió (nueces) y luego frases más cortas
      const next = searchCandidates(text)[searches];
      if (next !== undefined) return this.toolUse(last.toolName, { name: next });
      return this.reply(`No encontré «${noun}» en ${place}.`);
    }
    const exact = items.filter((i) => i.name.toLowerCase() === noun || i.name.toLowerCase() === pluralNoun(text));
    const chosen = items.length === 1 ? items[0] : exact.length === 1 ? exact[0] : undefined;
    if (!chosen) return this.reply(`Encontré varias opciones: ${items.map((i) => i.name).join(", ")}. ¿Cuál?`);

    switch (intent) {
      case "availability":
        return this.toolUse("get_dish_availability", { dishId: chosen.id, servings: extractServings(text) });
      case "recipe":
        return this.toolUse("get_recipe_details", { dishId: chosen.id });
      case "adjust": {
        const { quantity, unit } = extractQuantity(text, chosen.baseUnit ?? "g");
        return this.toolUse("adjust_inventory", {
          ingredientId: chosen.id,
          operation: SUBTRACT.test(text) ? "subtract" : "add",
          quantity,
          unit,
          reason: extractReason(text),
          idempotencyKey: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        });
      }
    }
  }

  private start(intent: Intent, text: string, has: (name: string) => boolean): CompletionResult {
    if (intent === "menu") return has("search_dishes") ? this.toolUse("search_dishes", { name: "" }) : this.reply(HELP);
    const tool = intent === "adjust" ? "search_ingredients" : "search_dishes";
    if (!has(tool)) return this.reply(HELP);
    return this.toolUse(tool, { name: extractNoun(text) });
  }

  private reply(content: string): CompletionResult {
    return { message: { role: "assistant", content }, stopReason: "end_turn" };
  }

  private toolUse(name: string, args: Record<string, unknown>): CompletionResult {
    const toolCall: ToolCall = { id: `demo-${this.nextId++}`, name, arguments: args };
    return { message: { role: "assistant", content: "", toolCalls: [toolCall] }, stopReason: "tool_use" };
  }
}

const FINAL: Record<Intent, string> = {
  availability: "Listo, aquí está la disponibilidad.",
  recipe: "Esta es la receta.",
  menu: "Este es el menú.",
  adjust: "Hecho: inventario actualizado.",
};

function detectIntent(text: string): Intent | undefined {
  if (SUBTRACT.test(text) || ADD.test(text)) return "adjust";
  if (/men[uú]|qu[eé] platillos/.test(text)) return "menu";
  if (/lleva|ingrediente|receta|al[eé]rgen/.test(text)) return "recipe";
  if (/cu[aá]nt|puedo (preparar|hacer)|alcanza|hay para|disponib|qued/.test(text)) return "availability";
  return undefined;
}

function words(text: string): string[] {
  return text
    .replace(/[¿?¡!.,;:«»"()]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^\d+([.,]\d+)?$/.test(w));
}

// Las palabras del nombre tal como se escribieron, sin bordes como "de"
function nounWords(text: string): string[] {
  const kept = words(text).filter((w) => !STOPWORDS.has(w));
  while (kept[0] === "de") kept.shift();
  while (kept.at(-1) === "de") kept.pop();
  return kept;
}

function pluralNoun(text: string): string {
  return nounWords(text).join(" ");
}

function extractNoun(text: string): string {
  return nounWords(text).map(singular).join(" ");
}

// Qué buscar, en orden: el nombre en singular, tal como se escribió, y luego tramos más cortos
function searchCandidates(text: string): string[] {
  const words = nounWords(text).map(singular);
  const out = [words.join(" "), pluralNoun(text)];
  for (let size = words.length - 1; size >= 1; size--) {
    for (let start = 0; start + size <= words.length; start++) {
      const run = words.slice(start, start + size);
      if (run[0] !== "de" && run.at(-1) !== "de") out.push(run.join(" "));
    }
  }
  return [...new Set(out.filter(Boolean))];
}

// Singular aproximado en español: especiales -> especial, panes -> pan, nueces -> nuez, tomates -> tomate
function singular(word: string): string {
  if (word.length <= 3 || word === "de") return word;
  if (word.endsWith("ces")) return `${word.slice(0, -3)}z`;
  if (/[lrndj]es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function extractServings(text: string): number {
  const m = text.match(/(\d+)\s*(porci|plat|hamburg|pastel|unidad)/) ?? text.match(/para\s+(\d+)/);
  return m ? Number(m[1]) : 1;
}

function extractQuantity(text: string, baseUnit: string): { quantity: number; unit: string } {
  const half = text.match(/medi[oa]\s+(kilo|kg|litro|l)\b/);
  if (half) return { quantity: 0.5, unit: /kilo|kg/.test(half[1]!) ? "kg" : "l" };
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilos?|gr|gramos?|g|ml|litros?|l)?\b/);
  if (!m) return { quantity: 1, unit: baseUnit };
  const quantity = Number(m[1]!.replace(",", "."));
  const raw = m[2] ?? "";
  const unit = /^k/.test(raw) ? "kg" : /^(g|gr|gramo)/.test(raw) ? "g" : raw === "ml" ? "ml" : /^l/.test(raw) ? "l" : baseUnit;
  return { quantity, unit };
}

function extractReason(text: string): string {
  if (/da[ñn]/.test(text)) return "Se dañó";
  if (/perd/.test(text)) return "Se perdió";
  if (/venc/.test(text)) return "Se venció";
  if (/llega|lleg[oó]/.test(text)) return "Llegó pedido";
  return "Ajuste manual";
}

interface Item {
  id: string;
  name: string;
  baseUnit?: string;
}

function parseItems(content: string, key: "dishes" | "ingredients"): Item[] {
  try {
    const data = JSON.parse(content) as Record<string, unknown>;
    const list = Array.isArray(data[key]) ? (data[key] as Item[]) : [];
    return list.filter((i) => typeof i.id === "string" && typeof i.name === "string");
  } catch {
    return [];
  }
}

// El contenido de un error llega como JSON de los bloques de texto del servidor
function errorText(content: string): string {
  try {
    const data = JSON.parse(content) as unknown;
    if (Array.isArray(data)) return data.map((b) => (b as { text?: string }).text ?? "").join(" ").trim();
  } catch {
    // texto plano
  }
  return content;
}

function lastIndex<T>(list: readonly T[], pred: (x: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (pred(list[i]!)) return i;
  return -1;
}
