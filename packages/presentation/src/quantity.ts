const ROUND = (n: number) => Math.round(n * 1000) / 1000

// Lleva la cantidad a la unidad más legible: 1200 g -> 1.2 kg, 0.2 kg -> 200 g, 3 unit -> 3 unidades
export function formatQuantity(n: number, unit: string): string {
  if (unit === 'unit') return `${ROUND(n)} ${n === 1 ? 'unidad' : 'unidades'}`
  if (unit === 'kg') return formatQuantity(n * 1000, 'g')
  if (unit === 'l') return formatQuantity(n * 1000, 'ml')
  if (unit === 'g') return n >= 1000 ? `${ROUND(n / 1000)} kg` : `${ROUND(n)} g`
  if (unit === 'ml') return n >= 1000 ? `${ROUND(n / 1000)} l` : `${ROUND(n)} ml`
  return `${ROUND(n)} ${unit}`
}
