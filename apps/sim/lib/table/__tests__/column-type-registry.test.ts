/**
 * @vitest-environment node
 *
 * Guards for the column-type registry itself, rather than for any one type.
 *
 * The registry replaced ~40 hand-maintained `switch` arms whose failure mode
 * was silence — a missing arm compared numbers as text or blocked every
 * conversion, with nothing to notice. These assert the properties that used to
 * be spread across those arms, so a new type either satisfies them or fails
 * here.
 */
import { describe, expect, it } from 'vitest'
import {
  ALL_COLUMN_TYPES,
  COLUMN_TYPE_REGISTRY,
  COLUMN_TYPES,
  columnTypeById,
  isColumnType,
} from '@/lib/table/column-types'
import type { ColumnDefinition } from '@/lib/table/types'
import { validateColumnDefinition } from '@/lib/table/validation'

describe('registry shape', () => {
  it('keys every entry by its own id', () => {
    for (const [key, definition] of Object.entries(COLUMN_TYPE_REGISTRY)) {
      expect(definition.id).toBe(key)
    }
  })

  it('derives COLUMN_TYPES from the registry, with no drift', () => {
    expect([...COLUMN_TYPES].sort()).toEqual(Object.keys(COLUMN_TYPE_REGISTRY).sort())
    expect(ALL_COLUMN_TYPES).toHaveLength(COLUMN_TYPES.length)
  })

  it('falls back to string for an unknown type instead of throwing', () => {
    // A malformed or future schema must render as text, not crash mid-render.
    expect(columnTypeById('percent').id).toBe('string')
    expect(columnTypeById(undefined).id).toBe('string')
    expect(isColumnType('percent')).toBe(false)
    expect(isColumnType('currency')).toBe(true)
  })

  it('only casts to numeric/timestamptz for types whose storage is actually that', () => {
    // A wrong cast makes every filter and sort on the column fail in SQL.
    for (const definition of ALL_COLUMN_TYPES) {
      if (definition.jsonbCast === null) continue
      expect(['numeric', 'timestamptz']).toContain(definition.jsonbCast)
    }
    expect(COLUMN_TYPE_REGISTRY.currency.jsonbCast).toBe(COLUMN_TYPE_REGISTRY.number.jsonbCast)
  })

  it('restricts filter operators only for types storing opaque ids', () => {
    // Restricting a comparable type would silently drop valid filters.
    for (const definition of ALL_COLUMN_TYPES) {
      if (definition.filterOperators !== null) {
        expect(definition.storesOpaqueIds).toBe(true)
      }
    }
  })

  it('never lets a type with its own metadata be unique-constrained implicitly', () => {
    // Uniqueness compares the stored value; for a type whose storage is an
    // opaque id that caps each option at one row for the whole table.
    for (const definition of ALL_COLUMN_TYPES) {
      if (definition.storesOpaqueIds) expect(definition.supportsUnique).toBe(false)
    }
  })

  it('gives every type that can reject a draft a message to show', () => {
    // Without one, `cleanCellValue` nulls the draft and the edit vanishes with
    // no explanation.
    for (const definition of ALL_COLUMN_TYPES) {
      if (definition.typeaheadPattern) expect(definition.parseErrorMessage).toBeTruthy()
    }
  })
})

describe('metadata ownership', () => {
  const column = (over: Partial<ColumnDefinition>): ColumnDefinition =>
    ({ name: 'c', type: 'string', ...over }) as ColumnDefinition
  const options = [{ id: 'opt_a', name: 'A' }]

  it.each`
    label                      | definition                                                  | valid    | needle
    ${'options on select'}     | ${column({ type: 'select', options })}                      | ${true}  | ${''}
    ${'options on string'}     | ${column({ type: 'string', options })}                      | ${false} | ${'cannot define options'}
    ${'options on currency'}   | ${column({ type: 'currency', options })}                    | ${false} | ${'cannot define options'}
    ${'multiple on number'}    | ${column({ type: 'number', multiple: true })}               | ${false} | ${'cannot be multiple'}
    ${'code on currency'}      | ${column({ type: 'currency', currencyCode: 'USD' })}        | ${true}  | ${''}
    ${'code on number'}        | ${column({ type: 'number', currencyCode: 'USD' })}          | ${false} | ${'cannot define a currency'}
    ${'code on select'}        | ${column({ type: 'select', currencyCode: 'USD', options })} | ${false} | ${'cannot define a currency'}
    ${'unsupported code'}      | ${column({ type: 'currency', currencyCode: 'ZZZ' })}        | ${false} | ${'invalid currency code'}
    ${'unique on select'}      | ${column({ type: 'select', unique: true, options })}        | ${false} | ${'cannot be unique'}
    ${'unique on currency'}    | ${column({ type: 'currency', unique: true })}               | ${true}  | ${''}
    ${'select with no option'} | ${column({ type: 'select' })}                               | ${false} | ${'at least one option'}
    ${'unknown type'}          | ${column({ type: 'percent' as ColumnDefinition['type'] })}  | ${false} | ${'invalid type'}
  `(
    'rejects $label',
    ({
      definition,
      valid,
      needle,
    }: {
      definition: ColumnDefinition
      valid: boolean
      needle: string
    }) => {
      const result = validateColumnDefinition(definition)
      expect(result.valid, result.errors.join('; ')).toBe(valid)
      if (!valid) expect(result.errors.join(' ').toLowerCase()).toContain(needle.toLowerCase())
    }
  )
})
