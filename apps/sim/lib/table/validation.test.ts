/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ColumnDefinition, RowData, TableSchema } from '@/lib/table/types'
import {
  coerceRowToSchema,
  resolveSelectOptionId,
  validateColumnDefinition,
  validateRowAgainstSchema,
} from '@/lib/table/validation'

const selectColumn: ColumnDefinition = {
  id: 'col_status',
  name: 'status',
  type: 'select',
  options: [
    { id: 'opt_open', name: 'Open' },
    { id: 'opt_closed', name: 'Closed' },
  ],
}

const multiselectColumn: ColumnDefinition = {
  id: 'col_tags',
  name: 'tags',
  type: 'select',
  multiple: true,
  options: [
    { id: 'opt_a', name: 'Alpha' },
    { id: 'opt_b', name: 'Beta' },
  ],
}

function schemaWith(...columns: ColumnDefinition[]): TableSchema {
  return { columns }
}

describe('validateRowAgainstSchema — select', () => {
  it('accepts a value matching an option id', () => {
    expect(
      validateRowAgainstSchema({ col_status: 'opt_open' }, schemaWith(selectColumn)).valid
    ).toBe(true)
  })

  it('rejects a value that is not a declared option id', () => {
    expect(
      validateRowAgainstSchema({ col_status: 'opt_unknown' }, schemaWith(selectColumn)).valid
    ).toBe(false)
  })

  it('rejects a non-string value', () => {
    const result = validateRowAgainstSchema(
      { col_status: 123 } as unknown as RowData,
      schemaWith(selectColumn)
    )
    expect(result.valid).toBe(false)
  })
})

describe('validateRowAgainstSchema — multiselect', () => {
  it('accepts an array of valid option ids', () => {
    expect(
      validateRowAgainstSchema({ col_tags: ['opt_a', 'opt_b'] }, schemaWith(multiselectColumn))
        .valid
    ).toBe(true)
  })

  it('rejects an array containing an unknown id', () => {
    expect(
      validateRowAgainstSchema({ col_tags: ['opt_a', 'nope'] }, schemaWith(multiselectColumn)).valid
    ).toBe(false)
  })

  it('rejects a non-array value', () => {
    expect(
      validateRowAgainstSchema({ col_tags: 'opt_a' }, schemaWith(multiselectColumn)).valid
    ).toBe(false)
  })

  it('rejects an empty array when required', () => {
    const result = validateRowAgainstSchema(
      { col_tags: [] },
      schemaWith({ ...multiselectColumn, required: true })
    )
    expect(result.valid).toBe(false)
  })
})

describe('coerceRowToSchema — select', () => {
  it('maps an option name to its id', () => {
    const data: RowData = { col_status: 'Open' }
    const result = coerceRowToSchema(data, schemaWith(selectColumn))
    expect(result.valid).toBe(true)
    expect(data.col_status).toBe('opt_open')
  })

  it('maps an option name case-insensitively', () => {
    const data: RowData = { col_status: 'closed' }
    coerceRowToSchema(data, schemaWith(selectColumn))
    expect(data.col_status).toBe('opt_closed')
  })

  it('rejects an unmatched value on an optional column under the `reject` policy', () => {
    const data: RowData = { col_status: 'banana' }
    const result = coerceRowToSchema(data, schemaWith(selectColumn), 'reject')
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toContain('status')
  })

  it('nulls an unmatched value by default', () => {
    const data: RowData = { col_status: 'banana' }
    const result = coerceRowToSchema(data, schemaWith(selectColumn))
    expect(result.valid).toBe(true)
    expect(data.col_status).toBeNull()
  })
})

describe('coerceRowToSchema — multiselect', () => {
  it('resolves names and keeps the entries that resolve by default', () => {
    const data: RowData = { col_tags: ['Alpha', 'opt_b', 'ghost'] }
    const result = coerceRowToSchema(data, schemaWith(multiselectColumn))
    expect(result.valid).toBe(true)
    expect(data.col_tags).toEqual(['opt_a', 'opt_b'])
  })

  it('rejects an entry matching no option instead of dropping it under `reject`', () => {
    const data: RowData = { col_tags: ['Alpha', 'ghost'] }
    const result = coerceRowToSchema(data, schemaWith(multiselectColumn), 'reject')
    expect(result.valid).toBe(false)
  })

  it('rejects a lone unmatched entry rather than storing an empty list under `reject`', () => {
    const data: RowData = { col_tags: ['green'] }
    const result = coerceRowToSchema(data, schemaWith(multiselectColumn), 'reject')
    expect(result.valid).toBe(false)
    expect(data.col_tags).not.toEqual([])
  })

  it('empties the cell by default only when nothing resolves', () => {
    const data: RowData = { col_tags: ['ghost'] }
    const result = coerceRowToSchema(data, schemaWith(multiselectColumn))
    expect(result.valid).toBe(true)
    expect(data.col_tags).toEqual([])
  })

  it('wraps a single string into a one-element array', () => {
    const data: RowData = { col_tags: 'opt_a' as unknown as string[] }
    coerceRowToSchema(data, schemaWith(multiselectColumn))
    expect(data.col_tags).toEqual(['opt_a'])
  })
})

/**
 * The `reject` policy, which only `/api/v2` opts into. It answers a value it
 * cannot store exactly with a 400 rather than a 200 whose cell is `null`,
 * matching the read side, which already refuses the same mismatch in a filter
 * predicate. Every first-party surface runs the `null` policy in the sibling
 * `it.each` below, which is the default and what they have always done.
 */
describe('coerceRowToSchema — uncoercible values under the `reject` policy', () => {
  const numberColumn: ColumnDefinition = { id: 'col_n', name: 'n', type: 'number' }
  const booleanColumn: ColumnDefinition = { id: 'col_b', name: 'b', type: 'boolean' }
  const dateColumn: ColumnDefinition = { id: 'col_d', name: 'd', type: 'date' }
  const stringColumn: ColumnDefinition = { id: 'col_s', name: 's', type: 'string' }

  const cases: Array<[string, ColumnDefinition, RowData[string]]> = [
    ['string into number', numberColumn, 'abc'],
    ['boolean into number', numberColumn, true],
    ['array into number', numberColumn, [1]],
    ['"NaN" into number', numberColumn, 'NaN'],
    ['"yes" into boolean', booleanColumn, 'yes'],
    ['1 into boolean', booleanColumn, 1],
    ['object into boolean', booleanColumn, {}],
    ['unparseable string into date', dateColumn, 'not-a-date'],
    ['object into string', stringColumn, { a: 1 }],
  ]

  it.each(cases)('rejects %s', (_label, column, value) => {
    const data: RowData = { [column.id as string]: value }
    const result = coerceRowToSchema(data, schemaWith(column), 'reject')
    expect(result.valid).toBe(false)
    expect(data[column.id as string]).not.toBeNull()
  })

  it.each(cases)(
    'nulls %s by default, as every first-party surface does',
    (_label, column, value) => {
      const data: RowData = { [column.id as string]: value }
      const result = coerceRowToSchema(data, schemaWith(column))
      expect(result.valid).toBe(true)
      expect(data[column.id as string]).toBeNull()
    }
  )

  it('still applies unambiguous conversions', () => {
    const data: RowData = { col_n: '1999' }
    expect(coerceRowToSchema(data, schemaWith(numberColumn)).valid).toBe(true)
    expect(data.col_n).toBe(1999)
  })

  /**
   * A bare number cannot say whether it means seconds or milliseconds, and both
   * readings land in range: guessing milliseconds stores `1600000000` — a
   * Unix-seconds timestamp for September 2020 — as 19 January 1970 under a 200.
   */
  it('refuses a bare epoch number rather than guessing its unit', () => {
    const data: RowData = { col_d: 1600000000 }
    const result = coerceRowToSchema(data, schemaWith(dateColumn), 'reject')
    expect(result.valid).toBe(false)
    expect(data.col_d).not.toBe('1970-01-19T12:26:40.000Z')
  })

  it('accepts an ISO-8601 string, which states its own unit', () => {
    const data: RowData = { col_d: '2020-09-13T12:26:40Z' }
    expect(coerceRowToSchema(data, schemaWith(dateColumn)).valid).toBe(true)
  })

  it('reads a bare epoch number as milliseconds by default', () => {
    const data: RowData = { col_d: 1600000000000 }
    const result = coerceRowToSchema(data, schemaWith(dateColumn))
    expect(result.valid).toBe(true)
    expect(data.col_d).toBe('2020-09-13T12:26:40.000Z')
  })

  it('still nulls an out-of-range epoch number by default', () => {
    const data: RowData = { col_d: 1e20 }
    const result = coerceRowToSchema(data, schemaWith(dateColumn))
    expect(result.valid).toBe(true)
    expect(data.col_d).toBeNull()
  })
})

/**
 * A partial update coerces the caller's patch and then validates the MERGED
 * row, so the merged pass sees cells this write never touched. Those are
 * storage, not caller input — a legacy cell that no longer fits its column must
 * not fail an update of a different column, and must not be persisted either
 * (the write only sends the patched keys).
 */
describe('coerceRowToSchema — merged row', () => {
  const numberColumn: ColumnDefinition = { id: 'col_n', name: 'n', type: 'number' }
  const stringColumn: ColumnDefinition = { id: 'col_s', name: 's', type: 'string' }
  const schema = schemaWith(numberColumn, stringColumn)

  it('does not fail an update over an untouched cell that no longer coerces', () => {
    const merged: RowData = { col_n: 'legacy', col_s: 'new' }
    const result = coerceRowToSchema(merged, schema, 'reject', ['col_s'])
    expect(result.valid).toBe(true)
  })

  it('still refuses the same value when this write is the one supplying it', () => {
    const merged: RowData = { col_n: 'legacy', col_s: 'new' }
    const result = coerceRowToSchema(merged, schema, 'reject', ['col_n', 'col_s'])
    expect(result.valid).toBe(false)
    expect(merged.col_n).toBe('legacy')
  })

  it('treats every key as caller-supplied when no patch key set is given', () => {
    const merged: RowData = { col_n: 'legacy', col_s: 'new' }
    expect(coerceRowToSchema(merged, schema, 'reject').valid).toBe(false)
  })
})

describe('resolveSelectOptionId', () => {
  const options = selectColumn.options ?? []

  it('resolves a stable id', () => {
    expect(resolveSelectOptionId('opt_open', options)).toBe('opt_open')
  })

  it('resolves a display name (case-insensitively)', () => {
    expect(resolveSelectOptionId('closed', options)).toBe('opt_closed')
  })

  it('returns null for an unknown value (drives the type-conversion compatibility gate)', () => {
    expect(resolveSelectOptionId('nope', options)).toBeNull()
  })
})

describe('validateColumnDefinition — select options', () => {
  it('accepts a well-formed select column', () => {
    expect(validateColumnDefinition(selectColumn).valid).toBe(true)
  })

  it('requires at least one option', () => {
    expect(validateColumnDefinition({ ...selectColumn, options: [] }).valid).toBe(false)
  })

  it('rejects duplicate option ids', () => {
    const result = validateColumnDefinition({
      ...selectColumn,
      options: [
        { id: 'dup', name: 'One' },
        { id: 'dup', name: 'Two' },
      ],
    })
    expect(result.valid).toBe(false)
  })

  it('rejects duplicate option names', () => {
    const result = validateColumnDefinition({
      ...selectColumn,
      options: [
        { id: 'a', name: 'Same' },
        { id: 'b', name: 'same' },
      ],
    })
    expect(result.valid).toBe(false)
  })

  it('rejects options on a non-select column', () => {
    const result = validateColumnDefinition({
      id: 'c',
      name: 'plain',
      type: 'string',
      options: [{ id: 'a', name: 'One' }],
    })
    expect(result.valid).toBe(false)
  })
})
