import { formatQuantity } from './quantity.js'
import { humanizeToolName } from './tools.js'
import type { ConfirmationText, Names } from './types.js'

// Claves técnicas que nunca se le muestran al personal en una confirmación
const HIDDEN = new Set(['idempotencyKey'])

// El texto sale de los argumentos reales: lo que se confirma es exactamente lo que se ejecuta
export function describeConfirmation(toolName: string, args: Record<string, unknown>, names?: Names): ConfirmationText {
  const quantity = Number(args.quantity)
  const unit = typeof args.unit === 'string' ? args.unit : ''
  const op = args.operation
  // Solo las tres operaciones que el servidor acepta tienen texto propio; el resto va al genérico
  if (toolName === 'adjust_inventory' && (op === 'add' || op === 'subtract' || op === 'set') && Number.isFinite(quantity) && unit) {
    const id = String(args.ingredientId ?? '')
    const item = names?.get(id) ?? id
    const qty = formatQuantity(...asServerRounds(quantity, unit))
    const reason = typeof args.reason === 'string' && args.reason.trim() ? [`Motivo: ${args.reason.trim().replace(/\.?$/, '.')}`] : []
    if (op === 'add') return { question: `¿Agregar ${qty} de ${item}?`, details: reason, confirmLabel: 'Agregar' }
    if (op === 'set') return { question: `¿Fijar ${item} en ${qty}?`, details: reason, confirmLabel: 'Fijar' }
    return { question: `¿Descontar ${qty} de ${item}?`, details: reason, confirmLabel: 'Descontar' }
  }
  const details = Object.entries(args)
    .filter(([k, v]) => !HIDDEN.has(k) && ['string', 'number', 'boolean'].includes(typeof v))
    .map(([k, v]) => `${k}: ${String(v)}`)
  return { question: `¿Ejecutar ${humanizeToolName(toolName)}?`, details, confirmLabel: 'Ejecutar' }
}

// El servidor guarda enteros en la unidad base (g, ml, unidades): se muestra lo que realmente aplicará
function asServerRounds(quantity: number, unit: string): [number, string] {
  if (unit === 'kg') return [Math.round(quantity * 1000), 'g']
  if (unit === 'l') return [Math.round(quantity * 1000), 'ml']
  if (unit === 'g' || unit === 'ml' || unit === 'unit') return [Math.round(quantity), unit]
  return [quantity, unit]
}
