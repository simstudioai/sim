/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  COLUMN_TYPE_REGISTRY,
  validateColumnTypeLimits,
  wouldExceedColumnTypeLimit,
} from '@/lib/table/column-types'
import type { ColumnDefinition } from '@/lib/table/types'

const definition = COLUMN_TYPE_REGISTRY.string
const originalMaxPerTable = definition.maxPerTable

function restoreOptionalProperty(key: 'maxPerTable', value: unknown) {
  if (value === undefined) {
    Reflect.deleteProperty(definition, key)
    return
  }
  Object.assign(definition, { [key]: value })
}

afterEach(() => {
  restoreOptionalProperty('maxPerTable', originalMaxPerTable)
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
})
