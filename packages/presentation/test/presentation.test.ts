import { describe, expect, it } from 'vitest'
import {
  describeConfirmation,
  formatQuantity,
  humanizeToolName,
  namesFromResult,
  summarizeProtocolError,
  summarizeToolResult,
} from '../src/index.js'

// Resultados reales del servidor Go (después de la tarea 1)
const ok = (structuredContent: unknown, text = '') => ({ content: [{ type: 'text', text }], structuredContent })
const names = new Map([
  ['cheese', 'Queso cheddar'],
  ['lettuce', 'Lechuga'],
  ['special-burger', 'Hamburguesa Especial'],
])

describe('formatQuantity', () => {
  it('usa unidades legibles', () => {
    expect(formatQuantity(1200, 'g')).toBe('1.2 kg')
    expect(formatQuantity(80, 'g')).toBe('80 g')
    expect(formatQuantity(1, 'unit')).toBe('1 unidad')
    expect(formatQuantity(3, 'unit')).toBe('3 unidades')
    expect(formatQuantity(2000, 'ml')).toBe('2 l')
    expect(formatQuantity(0.2, 'kg')).toBe('200 g')
    expect(formatQuantity(1.5, 'l')).toBe('1.5 l')
  })
})

describe('humanizeToolName', () => {
  it('nombra las herramientas del restaurante y deja pasar las demás', () => {
    expect(humanizeToolName('get_dish_availability')).toBe('Disponibilidad de un platillo')
    expect(humanizeToolName('adjust_inventory')).toBe('Ajuste de inventario')
    expect(humanizeToolName('git_status')).toBe('git_status')
  })
})

describe('summarizeToolResult', () => {
  it('disponibilidad con faltantes', () => {
    const s = summarizeToolResult(
      'get_dish_availability',
      ok({ available: false, requestedServings: 2, maximumServings: 0, missingIngredients: [{ ingredientId: 'cheese', name: 'Queso cheddar', required: 160, available: 40, unit: 'g' }] }),
    )
    expect(s.tone).toBe('error')
    expect(s.title).toBe('No alcanza para 2 porciones')
    expect(s.lines[0]).toContain('Queso cheddar')
    expect(s.lines[0]).toContain('40 g')
    expect(s.lines[0]).toContain('160 g')
  })

  it('disponibilidad suficiente', () => {
    const s = summarizeToolResult('get_dish_availability', ok({ available: true, requestedServings: 2, maximumServings: 5, missingIngredients: [] }))
    expect(s).toMatchObject({ tone: 'ok', title: 'Alcanza para 2 porciones' })
    expect(s.lines).toContain('Se pueden preparar hasta 5.')
  })

  it('receta con alérgenos', () => {
    const s = summarizeToolResult('get_recipe_details', ok({
      dishId: 'special-burger', dishName: 'Hamburguesa Especial',
      ingredients: [
        { ingredientId: 'cheese', name: 'Queso cheddar', quantityPerServing: 80, unit: 'g', allergenCategory: 'lácteos' },
        { ingredientId: 'bun', name: 'Pan de hamburguesa', quantityPerServing: 1, unit: 'unit' },
      ],
    }))
    expect(s.title).toBe('Hamburguesa Especial')
    expect(s.lines[0]).toBe('Queso cheddar: 80 g · alérgeno: lácteos')
    expect(s.lines[1]).toBe('Pan de hamburguesa: 1 unidad')
  })

  it('búsquedas', () => {
    const d = summarizeToolResult('search_dishes', ok({ dishes: [{ id: 'a', name: 'A', description: '', active: true }, { id: 'b', name: 'B', description: '', active: false }] }))
    expect(d.title).toBe('2 platillos')
    expect(d.items).toHaveLength(2)
    const i = summarizeToolResult('search_ingredients', ok({ ingredients: [{ id: 'cheese', name: 'Queso cheddar', baseUnit: 'g', availableQuantity: 40 }] }))
    expect(i.title).toBe('1 ingrediente')
    expect(i.items?.[0]).toEqual({ label: 'Queso cheddar', value: '40 g' })
  })

  it('ajuste de inventario', () => {
    const s = summarizeToolResult('adjust_inventory', ok({ movementId: 'm', ingredientId: 'lettuce', name: 'Lechuga', operation: 'subtract', previousQuantity: 500, resultingQuantity: 300, unit: 'g', idempotent: false }))
    expect(s).toMatchObject({ tone: 'ok', title: 'Inventario actualizado' })
    expect(s.lines).toEqual(['Lechuga: 500 g → 300 g'])
  })

  it('error de negocio usa el texto del servidor', () => {
    const s = summarizeToolResult('adjust_inventory', { content: [{ type: 'text', text: 'Tu rol (Mesero) no puede ajustar el inventario.' }], isError: true })
    expect(s).toMatchObject({ tone: 'error', title: 'Tu rol (Mesero) no puede ajustar el inventario.' })
  })

  it('servidor desconocido con solo texto', () => {
    const s = summarizeToolResult('git_status', { content: [{ type: 'text', text: 'On branch main' }] })
    expect(s.tone).toBe('info')
    expect(JSON.stringify(s)).toContain('On branch main')
    expect(s.title).not.toContain('{')
  })

  it('servidor desconocido con objeto y sin texto', () => {
    const s = summarizeToolResult('finanzas', { content: [], structuredContent: { saldo: 1200, moneda: 'GTQ', detalle: { a: 1 } } })
    expect(s.items).toContainEqual({ label: 'saldo', value: '1200' })
    expect(JSON.stringify([s.title, ...s.lines])).not.toContain('{')
    expect(s.items?.every((x) => !x.value.includes('{'))).toBe(true)
  })

  it('error de protocolo no muestra el mensaje técnico', () => {
    const s = summarizeProtocolError('adjust_inventory', 'idempotencyKey es obligatorio')
    expect(s).toEqual({ tone: 'error', title: 'No se pudo completar la operación', lines: [] })
  })
})

describe('describeConfirmation', () => {
  it('descontar en lenguaje de cocina', () => {
    const c = describeConfirmation('adjust_inventory', { ingredientId: 'lettuce', operation: 'subtract', quantity: 0.2, unit: 'kg', reason: 'se dañó', idempotencyKey: 'x' }, names)
    expect(c).toEqual({ question: '¿Descontar 200 g de Lechuga?', details: ['Motivo: se dañó.'], confirmLabel: 'Descontar' })
  })

  it('agregar y fijar', () => {
    expect(describeConfirmation('adjust_inventory', { ingredientId: 'cheese', operation: 'add', quantity: 500, unit: 'g' }, names))
      .toMatchObject({ question: '¿Agregar 500 g de Queso cheddar?', confirmLabel: 'Agregar' })
    expect(describeConfirmation('adjust_inventory', { ingredientId: 'cheese', operation: 'set', quantity: 1, unit: 'kg' }, names))
      .toMatchObject({ question: '¿Fijar Queso cheddar en 1 kg?', confirmLabel: 'Fijar' })
  })

  it('ingrediente fuera del mapa usa el valor tal cual', () => {
    const c = describeConfirmation('adjust_inventory', { ingredientId: 'saffron', operation: 'subtract', quantity: 2, unit: 'g' })
    expect(c.question).toBe('¿Descontar 2 g de saffron?')
    expect(JSON.stringify(c)).not.toContain('undefined')
  })

  it('herramienta sensible desconocida', () => {
    const c = describeConfirmation('delete_file', { path: '/tmp/x', idempotencyKey: 'k' })
    expect(c.question).toBe('¿Ejecutar delete_file?')
    expect(c.details).toEqual(['path: /tmp/x'])
    expect(c.confirmLabel).toBe('Ejecutar')
  })
})

describe('namesFromResult', () => {
  it('extrae nombres de búsquedas, recetas, disponibilidad y ajustes', () => {
    expect(namesFromResult('search_ingredients', { ingredients: [{ id: 'cheese', name: 'Queso cheddar' }] })).toEqual([['cheese', 'Queso cheddar']])
    expect(namesFromResult('search_dishes', { dishes: [{ id: 'special-burger', name: 'Hamburguesa Especial' }] })).toEqual([['special-burger', 'Hamburguesa Especial']])
    expect(namesFromResult('get_recipe_details', { dishId: 'd', dishName: 'D', ingredients: [{ ingredientId: 'i', name: 'I' }] })).toEqual([['d', 'D'], ['i', 'I']])
    expect(namesFromResult('get_dish_availability', { missingIngredients: [{ ingredientId: 'cheese', name: 'Queso cheddar' }] })).toEqual([['cheese', 'Queso cheddar']])
    expect(namesFromResult('adjust_inventory', { ingredientId: 'lettuce', name: 'Lechuga' })).toEqual([['lettuce', 'Lechuga']])
    expect(namesFromResult('otra', 'basura')).toEqual([])
  })
})

describe('correcciones de la revisión', () => {
  it('un servidor que manda JSON como texto se muestra como pares, no como JSON', () => {
    const s = summarizeToolResult('finanzas', { content: [{ type: 'text', text: '{"saldo":120,"moneda":"GTQ"}' }] })
    expect(s.items).toContainEqual({ label: 'saldo', value: '120' })
    expect(JSON.stringify([s.title, ...s.lines])).not.toContain('{')
  })

  it('un error con JSON como texto tampoco muestra JSON', () => {
    const s = summarizeToolResult('finanzas', { content: [{ type: 'text', text: '{"error":"sin saldo"}' }], isError: true })
    expect(s.tone).toBe('error')
    expect(s.title).not.toContain('{')
  })

  it('una operación desconocida no se presenta como descontar', () => {
    const c = describeConfirmation('adjust_inventory', { ingredientId: 'cheese', operation: 'remove', quantity: 1, unit: 'g' }, names)
    expect(c.confirmLabel).toBe('Ejecutar')
    expect(c.question).not.toContain('Descontar')
  })

  it('la cantidad se redondea como lo hará el servidor', () => {
    expect(describeConfirmation('adjust_inventory', { ingredientId: 'bun', operation: 'add', quantity: 1.5, unit: 'unit' }).question).toBe('¿Agregar 2 unidades de bun?')
    expect(describeConfirmation('adjust_inventory', { ingredientId: 'cheese', operation: 'add', quantity: 0.0004, unit: 'kg' }, names).question).toBe('¿Agregar 0 g de Queso cheddar?')
  })

  it('sin cantidad válida no muestra NaN', () => {
    const c = describeConfirmation('adjust_inventory', { ingredientId: 'cheese', operation: 'subtract' }, names)
    expect(JSON.stringify(c)).not.toMatch(/NaN|undefined/)
    expect(c.confirmLabel).toBe('Ejecutar')
  })
})
