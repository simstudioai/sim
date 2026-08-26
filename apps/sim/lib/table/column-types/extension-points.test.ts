/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  COLUMN_TYPE_REGISTRY,
  validateColumnTypeLimits,
  valueForTypeConversion,
  wouldExceedColumnTypeLimit,
} from '@/lib/table/column-types'
import { coerceValue } from '@/lib/table/import'
import type { ColumnDefinition } from '@/lib/table/types'

const definition = COLUMN_TYPE_REGISTRY.string
const originalMaxPerTable = definition.maxPerTable
const originalCoerceImport = definition.coerceImport
const originalValueForConversion = definition.valueForConversion

function restoreOptionalProperty(
  key: 'maxPerTable' | 'coerceImport' | 'valueForConversion',
  value: unknown
) {
  if (value === undefined) {
    Reflect.deleteProperty(definition, key)
    return
  }
  Object.assign(definition, { [key]: value })
}

afterEach(() => {
  restoreOptionalProperty('maxPerTable', originalMaxPerTable)
  restoreOptionalProperty('coerceImport', originalCoerceImport)
  restoreOptionalProperty('valueForConversion', originalValueForConversion)
})

describe('column type extension points', () => {
  it('enforces registry-declared per-table limits', () => {
    Object.assign(definition, { maxPerTable: 1 })
    const columns: ColumnDefinition[] = [
      { name: 'first', type: 'string' },
      { name: 'second', type: 'string' },
    ]

    expect(wouldExceedColumnTypeLimit(columns.slice(0, 1), 'string', 1)).toBe(true)
    expect(validateColumnTypeLimits(columns)).toEqual([
      `A table can have at most 1 ${definition.label} column`,
    ])
  })

  it('lets the source type normalize a value before conversion', () => {
    Object.assign(definition, {
      valueForConversion: (_value: unknown, target: ColumnDefinition) =>
        target.type === 'number' ? 42 : 'unchanged',
    })

    expect(
      valueForTypeConversion(
        'stored-value',
        { name: 'source', type: 'string' },
        { name: 'target', type: 'number' }
      )
    ).toBe(42)
    expect(
      valueForTypeConversion(
        'stored-value',
        { name: 'source', type: 'number' },
        { name: 'target', type: 'string' }
      )
    ).toBe('stored-value')
  })

  it('lets a type own CSV import coercion', () => {
    Object.assign(definition, {
      coerceImport: (value: unknown) => `imported:${String(value)}`,
    })

    expect(coerceValue('raw', 'string')).toBe('imported:raw')
  })
})
