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
    { id: 'opt_open', name: 'Open', color: 'green' },
    { id: 'opt_closed', name: 'Closed', color: 'red' },
  ],
}

const multiselectColumn: ColumnDefinition = {
  id: 'col_tags',
  name: 'tags',
  type: 'multiselect',
  options: [
    { id: 'opt_a', name: 'Alpha', color: 'blue' },
    { id: 'opt_b', name: 'Beta', color: 'purple' },
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

  it('nulls an unmatched value on an optional column', () => {
    const data: RowData = { col_status: 'banana' }
    const result = coerceRowToSchema(data, schemaWith(selectColumn))
    expect(result.valid).toBe(true)
    expect(data.col_status).toBeNull()
  })
})

describe('coerceRowToSchema — multiselect', () => {
  it('resolves names and drops unmatched entries', () => {
    const data: RowData = { col_tags: ['Alpha', 'opt_b', 'ghost'] }
    const result = coerceRowToSchema(data, schemaWith(multiselectColumn))
    expect(result.valid).toBe(true)
    expect(data.col_tags).toEqual(['opt_a', 'opt_b'])
  })

  it('wraps a single string into a one-element array', () => {
    const data: RowData = { col_tags: 'opt_a' as unknown as string[] }
    coerceRowToSchema(data, schemaWith(multiselectColumn))
    expect(data.col_tags).toEqual(['opt_a'])
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
        { id: 'dup', name: 'One', color: 'green' },
        { id: 'dup', name: 'Two', color: 'red' },
      ],
    })
    expect(result.valid).toBe(false)
  })

  it('rejects duplicate option names', () => {
    const result = validateColumnDefinition({
      ...selectColumn,
      options: [
        { id: 'a', name: 'Same', color: 'green' },
        { id: 'b', name: 'same', color: 'red' },
      ],
    })
    expect(result.valid).toBe(false)
  })

  it('rejects an invalid color', () => {
    const result = validateColumnDefinition({
      ...selectColumn,
      options: [{ id: 'a', name: 'One', color: 'chartreuse' as never }],
    })
    expect(result.valid).toBe(false)
  })

  it('rejects options on a non-select column', () => {
    const result = validateColumnDefinition({
      id: 'c',
      name: 'plain',
      type: 'string',
      options: [{ id: 'a', name: 'One', color: 'green' }],
    })
    expect(result.valid).toBe(false)
  })
})
