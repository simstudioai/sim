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
import type { ColumnType } from '@/lib/table/column-types'
import {
  ALL_COLUMN_TYPES,
  COLUMN_TYPE_REGISTRY,
  COLUMN_TYPES,
  columnTypeById,
  isColumnType,
  isValueCompatible,
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
      const restricted = definition.filterOperatorsFor?.({ name: 'c', type: definition.id })
      if (restricted) expect(definition.storesOpaqueIds).toBe(true)
    }
  })

  it('never lets a type with its own metadata be unique-constrained implicitly', () => {
    // Uniqueness compares the stored value; for a type whose storage is an
    // opaque id that caps each option at one row for the whole table.
    for (const definition of ALL_COLUMN_TYPES) {
      if (definition.storesOpaqueIds) expect(definition.supportsUnique).toBe(false)
    }
  })

  it('never asks for a native number input on a type accepting formatted text', () => {
    // `<input type="number">` rejects `$1,234.56` outright, so a type whose
    // parser exists to accept that must get a text field with a numeric keypad.
    for (const definition of ALL_COLUMN_TYPES) {
      if (!definition.acceptsFormattedInput) continue
      expect(definition.inputMode).toBe('decimal')
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

describe('conversion write-back', () => {
  // A retype is allowed exactly when the target's `coerce` accepts the value,
  // and `coerce` often TRANSFORMS it. The conversion must therefore write the
  // transformed value back — filters and sorts apply `jsonbCast` to whatever is
  // stored, so a value left in its old shape breaks every query on the column.
  it.each`
    type          | stored          | expected
    ${'date'}     | ${'2024-01-01'} | ${'2024-01-01'}
    ${'currency'} | ${'$1,234.56'}  | ${1234.56}
    ${'currency'} | ${'1.234,56'}   | ${1234.56}
    ${'number'}   | ${'1999'}       | ${1999}
  `('$type coerces $stored to a value its jsonbCast can read', ({ type, stored, expected }) => {
    const column = { name: 'c', type } as ColumnDefinition
    const result = COLUMN_TYPE_REGISTRY[type as ColumnType].coerce(stored, column)
    expect(result.ok && result.value).toEqual(expected)
  })

  it('never leaves a numeric-cast type holding something Postgres cannot cast', () => {
    // The concrete failure this guards: a number left in a `date` column makes
    // `(data->>'col')::timestamptz` throw on every query. A bare number is now
    // refused outright rather than read as epoch milliseconds — the value
    // cannot say whether it means seconds or milliseconds, and both readings
    // are in range — so the column can never come to hold one either way.
    for (const definition of ALL_COLUMN_TYPES) {
      if (definition.jsonbCast !== 'timestamptz') continue
      expect(definition.coerce(1700000000000, { name: 'c', type: definition.id }).ok).toBe(false)
      const coerced = definition.coerce('2023-11-14T22:13:20.000Z', {
        name: 'c',
        type: definition.id,
      })
      expect(coerced.ok).toBe(true)
      expect(typeof (coerced as { value: unknown }).value).toBe('string')
    }
  })
})

describe('ttl columns', () => {
  const column = { name: 'expires_at', type: 'ttl' } as ColumnDefinition

  it('stores integer epoch seconds while accepting date-shaped input', () => {
    expect(COLUMN_TYPE_REGISTRY.ttl.coerce('2023-11-14T22:13:20Z', column)).toEqual({
      ok: true,
      value: 1_700_000_000,
    })
    expect(COLUMN_TYPE_REGISTRY.ttl.coerce(1_700_000_000, column)).toEqual({
      ok: true,
      value: 1_700_000_000,
    })
    expect(COLUMN_TYPE_REGISTRY.ttl.coerce('1700000000', column)).toEqual({
      ok: true,
      value: 1_700_000_000,
    })
    expect(COLUMN_TYPE_REGISTRY.ttl.coerce('2023-11-14T22:13:20.123Z', column)).toEqual({
      ok: true,
      value: 1_700_000_000,
    })
    expect(COLUMN_TYPE_REGISTRY.ttl.coerce('not-a-date', column)).toEqual({ ok: false })
    expect(COLUMN_TYPE_REGISTRY.ttl.coerce(1_700_000_000.5, column)).toEqual({ ok: false })
  })

  it('renders and edits epoch seconds as a date', () => {
    expect(COLUMN_TYPE_REGISTRY.ttl.formatForDisplay(1_700_000_000, column)).toBe(
      '11/14/2023 10:13:20 PM'
    )
    expect(COLUMN_TYPE_REGISTRY.ttl.formatForInput(1_700_000_000, column)).toBe(
      '2023-11-14T22:13:20Z'
    )
    expect(
      COLUMN_TYPE_REGISTRY.ttl.formatForInput(1_700_000_000, column, {
        timezone: 'America/New_York',
      })
    ).toBe('2023-11-14T17:13:20-05:00')
  })

  it('preserves the exact instant across both sides of a daylight-saving fold', () => {
    expect(
      COLUMN_TYPE_REGISTRY.ttl.formatForInput(1_699_162_200, column, {
        timezone: 'America/New_York',
      })
    ).toBe('2023-11-05T01:30:00-04:00')
    expect(
      COLUMN_TYPE_REGISTRY.ttl.formatForInput(1_699_165_800, column, {
        timezone: 'America/New_York',
      })
    ).toBe('2023-11-05T01:30:00-05:00')
  })

  it('limits a table to one ttl column', () => {
    expect(COLUMN_TYPE_REGISTRY.ttl.maxPerTable).toBe(1)
  })
})

describe('intentional divergences from the pre-registry behavior', () => {
  // A differential run of the registry against the pre-refactor implementations
  // (55 values x 7 column shapes) found ZERO coercion differences and exactly
  // these compatibility differences. Both are deliberate fixes; pinning them
  // here so neither can be silently reverted or quietly widened.

  it('rejects boolean conversions the old gate accepted and then nulled', () => {
    // The old gate accepted '1'/'0'/1/0 but the write path only ever accepted
    // 'true'/'false' — so the conversion reported zero incompatible rows and
    // then nulled every one of them. Rejecting is the honest answer.
    const column: ColumnDefinition = { name: 'b', type: 'boolean' }
    for (const value of ['0', '1', 0, 1]) {
      expect(isValueCompatible(value, column)).toBe(false)
      expect(COLUMN_TYPE_REGISTRY.boolean.coerce(value as never, column).ok).toBe(false)
    }
    for (const value of [true, false, 'true', 'false']) {
      expect(isValueCompatible(value, column)).toBe(true)
    }
  })

  it('refuses a number as a date, on the write path and the bulk gate alike', () => {
    // A whole numeric column reinterpreted as epoch milliseconds turns 1, 5, 42
    // into three timestamps in January 1970, and one value at a time is no
    // better — `1600000000` is September 2020 as seconds and January 1970 as
    // milliseconds, both in range. `coerce` refuses a bare number, so the gate
    // needs no override.
    const column: ColumnDefinition = { name: 'd', type: 'date' }
    for (const value of [0, 1, 42, 1700000000]) {
      expect(isValueCompatible(value, column)).toBe(false)
      expect(COLUMN_TYPE_REGISTRY.date.coerce(value as never, column).ok).toBe(false)
    }
    expect(isValueCompatible('2024-01-01', column)).toBe(true)
  })

  it('never lets a gate be LOOSER than its write path', () => {
    // The dangerous direction: a gate that accepts what `coerce` rejects
    // reports zero incompatible rows and then nulls every one of them.
    const samples: unknown[] = ['', '0', '1', 'abc', 0, 1, 42, true, '2024-01-01', '$1.50']
    for (const definition of ALL_COLUMN_TYPES) {
      if (definition.id === 'select') continue
      const column: ColumnDefinition = { name: 'c', type: definition.id }
      for (const value of samples) {
        if (!isValueCompatible(value, column)) continue
        expect(
          definition.coerce(value as never, column).ok,
          `${definition.id} gate accepts ${JSON.stringify(value)} but coerce rejects it`
        ).toBe(true)
      }
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

/**
 * `salvage` is the escape hatch for the write paths that have no caller to
 * answer: a computed cell, a CSV import row, the cell-write snapshot. There the
 * alternative to a lossy reading is a blanked cell, so the registry may read
 * looser than `coerce` — but only there, and only in that direction.
 */
describe('salvage — the machine-path reading', () => {
  it('reads a bare epoch number as milliseconds for a date column', () => {
    const column: ColumnDefinition = { name: 'd', type: 'date' }
    expect(COLUMN_TYPE_REGISTRY.date.coerce(1700000000000 as never, column).ok).toBe(false)
    expect(COLUMN_TYPE_REGISTRY.date.salvage?.(1700000000000 as never, column)).toEqual({
      ok: true,
      value: '2023-11-14T22:13:20.000Z',
    })
  })

  it('refuses an out-of-range epoch rather than throwing on toISOString', () => {
    const column: ColumnDefinition = { name: 'd', type: 'date' }
    expect(COLUMN_TYPE_REGISTRY.date.salvage?.(1e20 as never, column)).toEqual({ ok: false })
  })

  it('keeps the resolvable members of a multiselect and drops the rest', () => {
    const column: ColumnDefinition = {
      id: 'col_tags',
      name: 'tags',
      type: 'select',
      multiple: true,
      options: [
        { id: 'opt_a', name: 'Alpha' },
        { id: 'opt_b', name: 'Beta' },
      ],
    }
    expect(COLUMN_TYPE_REGISTRY.select.coerce(['Alpha', 'ghost'], column).ok).toBe(false)
    expect(COLUMN_TYPE_REGISTRY.select.salvage?.(['Alpha', 'ghost'], column)).toEqual({
      ok: true,
      value: ['opt_a'],
    })
  })

  it('has nothing partial to keep for a single select', () => {
    const column: ColumnDefinition = {
      id: 'col_status',
      name: 'status',
      type: 'select',
      options: [{ id: 'opt_open', name: 'Open' }],
    }
    expect(COLUMN_TYPE_REGISTRY.select.salvage?.('ghost', column)).toEqual({ ok: false })
  })
})
