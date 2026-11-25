import { formatQuantity } from './quantity.js'
import type { Names, Summary, ToolResultLike } from './types.js'

const TOOL_NAMES: Record<string, string> = {
  search_dishes: 'Buscar platillos',
  search_ingredients: 'Buscar ingredientes',
  get_dish_availability: 'Disponibilidad de un platillo',
  get_recipe_details: 'Receta y alérgenos',
  adjust_inventory: 'Ajuste de inventario',
}

export function humanizeToolName(name: string): string {
  return TOOL_NAMES[name] ?? name
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' ? v : 0)
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : [])
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const textOf = (r: ToolResultLike) => (r.content ?? []).map((c) => c.text).join('\n').trim()
const nameOf = (o: Obj, idKey: string, names?: Names) => str(o.name) || names?.get(str(o[idKey])) || str(o[idKey])

export function summarizeToolResult(toolName: string, result: ToolResultLike, names?: Names): Summary {
  if (result.isError) {
    const text = textOf(result)
    const parsed = parseJson(text)
    if (parsed !== undefined) return { ...pairsSummary(toolName, parsed), tone: 'error', title: 'La operación no se pudo completar' }
    return { tone: 'error', title: text || 'La operación no se pudo completar', lines: [] }
  }
  const data = result.structuredContent

  if (isObj(data)) {
    switch (toolName) {
      case 'get_dish_availability': {
        const requested = num(data.requestedServings)
        const portions = plural(requested, 'porción', 'porciones')
        const missing = arr(data.missingIngredients).map(
          (m) => `Falta ${nameOf(m, 'ingredientId', names)}: hay ${formatQuantity(num(m.available), str(m.unit))}, se necesitan ${formatQuantity(num(m.required), str(m.unit))}.`,
        )
        if (data.available) {
          return { tone: 'ok', title: `Alcanza para ${portions}`, lines: [`Se pueden preparar hasta ${num(data.maximumServings)}.`] }
        }
        return { tone: 'error', title: `No alcanza para ${portions}`, lines: missing.length ? missing : ['No hay receta registrada o el platillo no está activo.'] }
      }
      case 'get_recipe_details':
        return {
          tone: 'info',
          title: str(data.dishName) || 'Receta',
          lines: arr(data.ingredients).map((i) => {
            const base = `${nameOf(i, 'ingredientId', names)}: ${formatQuantity(num(i.quantityPerServing), str(i.unit))}`
            return i.allergenCategory ? `${base} · alérgeno: ${str(i.allergenCategory)}` : base
          }),
        }
      case 'search_dishes': {
        const dishes = arr(data.dishes)
        return {
          tone: 'info',
          title: plural(dishes.length, 'platillo', 'platillos'),
          lines: dishes.length ? [] : ['No hay coincidencias en el menú.'],
          items: dishes.map((d) => ({ label: str(d.name), value: d.active ? 'en el menú' : 'fuera del menú', tone: d.active ? 'ok' : 'warn' })),
        }
      }
      case 'search_ingredients': {
        const ings = arr(data.ingredients)
        return {
          tone: 'info',
          title: plural(ings.length, 'ingrediente', 'ingredientes'),
          lines: ings.length ? [] : ['No hay coincidencias en el inventario.'],
          items: ings.map((i) => ({ label: str(i.name), value: formatQuantity(num(i.availableQuantity), str(i.baseUnit)) })),
        }
      }
      case 'adjust_inventory': {
        const unit = str(data.unit)
        const line = `${nameOf(data, 'ingredientId', names)}: ${formatQuantity(num(data.previousQuantity), unit)} → ${formatQuantity(num(data.resultingQuantity), unit)}`
        return {
          tone: 'ok',
          title: 'Inventario actualizado',
          lines: data.idempotent ? [line, 'Este ajuste ya se había registrado; no se volvió a aplicar.'] : [line],
        }
      }
    }
  }
  return genericSummary(toolName, result, data)
}

// Para servidores que no son del restaurante: texto si lo hay, si no pares clave/valor simples
function genericSummary(toolName: string, result: ToolResultLike, data: unknown): Summary {
  const text = textOf(result)
  // Muchos servidores mandan JSON dentro del texto: se presenta como pares, nunca como JSON
  const parsed = parseJson(text)
  if (parsed !== undefined) return pairsSummary(toolName, parsed)
  if (text) {
    const [first, ...rest] = text.split('\n')
    return { tone: 'info', title: first!, lines: rest.filter(Boolean) }
  }
  return pairsSummary(toolName, data)
}

function pairsSummary(toolName: string, data: unknown): Summary {
  const items = isObj(data)
    ? Object.entries(data)
        .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
        .map(([k, v]) => ({ label: k, value: String(v) }))
    : []
  return { tone: 'info', title: humanizeToolName(toolName), lines: items.length ? [] : ['Sin datos para mostrar.'], items }
}

function parseJson(text: string): unknown {
  const t = text.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return undefined
  try {
    return JSON.parse(t) as unknown
  } catch {
    return undefined
  }
}

export function summarizeProtocolError(_toolName: string, _message: string): Summary {
  return { tone: 'error', title: 'No se pudo completar la operación', lines: [] }
}

// Pares id -> nombre que traen los resultados, para nombrar cosas en confirmaciones posteriores
export function namesFromResult(toolName: string, structured: unknown): [string, string][] {
  if (!isObj(structured)) return []
  const pairs: [string, string][] = []
  const add = (id: unknown, name: unknown) => {
    if (typeof id === 'string' && typeof name === 'string' && id && name) pairs.push([id, name])
  }
  switch (toolName) {
    case 'search_dishes':
      arr(structured.dishes).forEach((d) => add(d.id, d.name))
      break
    case 'search_ingredients':
      arr(structured.ingredients).forEach((i) => add(i.id, i.name))
      break
    case 'get_recipe_details':
      add(structured.dishId, structured.dishName)
      arr(structured.ingredients).forEach((i) => add(i.ingredientId, i.name))
      break
    case 'get_dish_availability':
      arr(structured.missingIngredients).forEach((m) => add(m.ingredientId, m.name))
      break
    case 'adjust_inventory':
      add(structured.ingredientId, structured.name)
      break
  }
  return pairs
}
