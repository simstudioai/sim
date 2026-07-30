/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  booleanColumnType,
  COLUMN_TYPE_REGISTRY,
  dateColumnType,
  formatColumnValue,
  getColumnType,
  isValidColumnValue,
  isValueCompatibleWithColumnType,
  jsonColumnType,
  numberColumnType,
  parseColumnValue,
  selectColumnType,
  sqlCastForColumnType,
  stringColumnType,
} from '@/lib/table/column-types'
import { COLUMN_TYPES } from '@/lib/table/constants'
import type { ColumnDefinition, JsonValue } from '@/lib/table/types'

const stringCol: ColumnDefinition = { name: 'title', type: 'string' }
const numberCol: ColumnDefinition = { name: 'price', type: 'number' }
const booleanCol: ColumnDefinition = { name: 'active', type: 'boolean' }
const dateCol: ColumnDefinition = { name: 'due', type: 'date' }
const jsonCol: ColumnDefinition = { name: 'payload', type: 'json' }

const status: ColumnDefinition = {
  name: 'status',
  type: 'select',
  options: [
    { id: 'opt_open', name: 'Open' },
    { id: 'opt_closed', name: 'Closed' },
  ],
}

const tags: ColumnDefinition = {
  name: 'tags',
  type: 'select',
  multiple: true,
  options: [
    { id: 'opt_a', name: 'Alpha' },
    { id: 'opt_b', name: 'Beta' },
  ],
}

describe('COLUMN_TYPE_REGISTRY', () => {
  it('has a definition for every entry in COLUMN_TYPES', () => {
    for (const type of COLUMN_TYPES) {
      expect(COLUMN_TYPE_REGISTRY[type]).toBeDefined()
    }
  })
})

describe('getColumnType', () => {
  it('resolves a known type', () => {
    expect(getColumnType('number')).toBe(numberColumnType)
  })

  it('returns undefined for an unrecognized type', () => {
    expect(getColumnType('currency')).toBeUndefined()
  })
})

describe('stringColumnType', () => {
  it('sqlCast: compares as text', () => {
    expect(stringColumnType.sqlCast).toBeNull()
  })

  it('parse: accepts strings, stringifies numbers/booleans, rejects objects', () => {
    expect(stringColumnType.parse('hello', stringCol)).toEqual({ ok: true, value: 'hello' })
    expect(stringColumnType.parse(42, stringCol)).toEqual({ ok: true, value: '42' })
    expect(stringColumnType.parse(true, stringCol)).toEqual({ ok: true, value: 'true' })
    expect(stringColumnType.parse(['a'], stringCol)).toEqual({ ok: false })
  })

  it('isValidValue: only a string passes', () => {
    expect(stringColumnType.isValidValue('hello', stringCol)).toBeNull()
    expect(stringColumnType.isValidValue(42, stringCol)).toBe('title must be string, got number')
  })

  it('format: returns the string as-is', () => {
    expect(stringColumnType.format('hello', stringCol)).toBe('hello')
  })

  it('isCompatible: rejects objects and arrays, accepts everything else', () => {
    expect(stringColumnType.isCompatible('42', { type: 'string' })).toBe(true)
    expect(stringColumnType.isCompatible(42, { type: 'string' })).toBe(true)
    expect(stringColumnType.isCompatible(['a'], { type: 'string' })).toBe(false)
    expect(stringColumnType.isCompatible({ a: 1 }, { type: 'string' })).toBe(false)
  })
})

describe('numberColumnType', () => {
  it('sqlCast: numeric', () => {
    expect(numberColumnType.sqlCast).toBe('numeric')
  })

  it('parse: accepts finite numbers and numeric strings', () => {
    expect(numberColumnType.parse(42, numberCol)).toEqual({ ok: true, value: 42 })
    expect(numberColumnType.parse('42', numberCol)).toEqual({ ok: true, value: 42 })
    expect(numberColumnType.parse(Number.POSITIVE_INFINITY, numberCol)).toEqual({ ok: false })
  })

  it('parse: treats a whitespace-only string as empty rather than 0', () => {
    expect(numberColumnType.parse('   ', numberCol)).toEqual({ ok: false })
  })

  it('parse: rejects non-numeric strings', () => {
    expect(numberColumnType.parse('abc', numberCol)).toEqual({ ok: false })
  })

  it('isValidValue: only a finite number passes', () => {
    expect(numberColumnType.isValidValue(42, numberCol)).toBeNull()
    expect(numberColumnType.isValidValue(Number.NaN, numberCol)).toBe('price must be number')
    expect(numberColumnType.isValidValue('42', numberCol)).toBe('price must be number')
  })

  it('format: stringifies the number', () => {
    expect(numberColumnType.format(1234.5, numberCol)).toBe('1234.5')
  })

  it('isCompatible: finite numbers and numeric strings only', () => {
    expect(numberColumnType.isCompatible(42, { type: 'number' })).toBe(true)
    expect(numberColumnType.isCompatible('42', { type: 'number' })).toBe(true)
    expect(numberColumnType.isCompatible('   ', { type: 'number' })).toBe(false)
    expect(numberColumnType.isCompatible('abc', { type: 'number' })).toBe(false)
    expect(numberColumnType.isCompatible(true, { type: 'number' })).toBe(false)
  })
})

describe('booleanColumnType', () => {
  it('sqlCast: compares as text', () => {
    expect(booleanColumnType.sqlCast).toBeNull()
  })

  it('parse: accepts booleans and true/false strings, case- and whitespace-insensitively', () => {
    expect(booleanColumnType.parse(true, booleanCol)).toEqual({ ok: true, value: true })
    expect(booleanColumnType.parse(' TRUE ', booleanCol)).toEqual({ ok: true, value: true })
    expect(booleanColumnType.parse('false', booleanCol)).toEqual({ ok: true, value: false })
    expect(booleanColumnType.parse('yes', booleanCol)).toEqual({ ok: false })
  })

  it('isValidValue: only a boolean passes', () => {
    expect(booleanColumnType.isValidValue(true, booleanCol)).toBeNull()
    expect(booleanColumnType.isValidValue('true', booleanCol)).toBe('active must be boolean')
  })

  it('format: stringifies the boolean', () => {
    expect(booleanColumnType.format(true, booleanCol)).toBe('true')
  })

  it('isCompatible: booleans, true/false/1/0 strings, and 0/1 numbers', () => {
    expect(booleanColumnType.isCompatible(true, { type: 'boolean' })).toBe(true)
    expect(booleanColumnType.isCompatible('1', { type: 'boolean' })).toBe(true)
    expect(booleanColumnType.isCompatible(1, { type: 'boolean' })).toBe(true)
    expect(booleanColumnType.isCompatible(2, { type: 'boolean' })).toBe(false)
    expect(booleanColumnType.isCompatible('yes', { type: 'boolean' })).toBe(false)
  })
})

describe('dateColumnType', () => {
  it('sqlCast: timestamptz', () => {
    expect(dateColumnType.sqlCast).toBe('timestamptz')
  })

  it('parse: normalizes a calendar date and rejects unparseable strings', () => {
    expect(dateColumnType.parse('2024-01-15', dateCol)).toEqual({ ok: true, value: '2024-01-15' })
    expect(dateColumnType.parse('not-a-date', dateCol)).toEqual({ ok: false })
  })

  it('parse: accepts a Date instance and an epoch number', () => {
    const result = dateColumnType.parse(new Date('2024-01-15T00:00:00Z'), dateCol)
    expect(result.ok).toBe(true)
    expect(dateColumnType.parse(1705276800000, dateCol).ok).toBe(true)
  })

  it('isValidValue: a Date instance or a parseable string passes', () => {
    expect(dateColumnType.isValidValue('2024-01-15', dateCol)).toBeNull()
    expect(dateColumnType.isValidValue(new Date('2024-01-15'), dateCol)).toBeNull()
    expect(dateColumnType.isValidValue('not-a-date', dateCol)).toBe('due must be valid date')
  })

  it('format: renders a calendar date as MM/DD/YYYY', () => {
    expect(dateColumnType.format('2024-01-15', dateCol)).toBe('01/15/2024')
  })

  it('isCompatible: valid Date instances and parseable strings', () => {
    expect(dateColumnType.isCompatible('2024-01-15', { type: 'date' })).toBe(true)
    expect(dateColumnType.isCompatible(new Date('2024-01-15'), { type: 'date' })).toBe(true)
    expect(dateColumnType.isCompatible('not-a-date', { type: 'date' })).toBe(false)
    expect(dateColumnType.isCompatible(42, { type: 'date' })).toBe(false)
  })
})

describe('jsonColumnType', () => {
  it('sqlCast: compares as text', () => {
    expect(jsonColumnType.sqlCast).toBeNull()
  })

  it('parse: always passes the value through unchanged', () => {
    expect(jsonColumnType.parse({ a: 1 }, jsonCol)).toEqual({ ok: true, value: { a: 1 } })
    expect(jsonColumnType.parse('plain text', jsonCol)).toEqual({ ok: true, value: 'plain text' })
  })

  it('isValidValue: anything JSON.stringify can serialize passes', () => {
    expect(jsonColumnType.isValidValue({ a: 1 }, jsonCol)).toBeNull()
    expect(jsonColumnType.isValidValue([1, 2, 3], jsonCol)).toBeNull()
  })

  it('isValidValue: a value JSON.stringify cannot serialize (a BigInt) fails', () => {
    const unstringifiable = 10n as unknown as JsonValue
    expect(jsonColumnType.isValidValue(unstringifiable, jsonCol)).toBe('payload must be valid JSON')
  })

  it('format: JSON-stringifies the value', () => {
    expect(jsonColumnType.format({ a: 1 }, jsonCol)).toBe('{"a":1}')
  })

  it('isCompatible: always true', () => {
    expect(jsonColumnType.isCompatible({ a: 1 }, { type: 'json' })).toBe(true)
    expect(jsonColumnType.isCompatible(null, { type: 'json' })).toBe(true)
  })
})

describe('selectColumnType', () => {
  describe('single-select', () => {
    it('parse: resolves an id or a name (case-insensitively), rejects unknown values', () => {
      expect(selectColumnType.parse('opt_open', status)).toEqual({ ok: true, value: 'opt_open' })
      expect(selectColumnType.parse('closed', status)).toEqual({ ok: true, value: 'opt_closed' })
      expect(selectColumnType.parse('nope', status)).toEqual({ ok: false })
    })

    it('isValidValue: a declared option id passes, anything else fails', () => {
      expect(selectColumnType.isValidValue('opt_open', status)).toBeNull()
      expect(selectColumnType.isValidValue('opt_unknown', status)).toBe(
        'status must be one of the defined options'
      )
    })

    it('format: resolves the stored id to its display name', () => {
      expect(selectColumnType.format('opt_open', status)).toBe('Open')
      expect(selectColumnType.format(null, status)).toBe('')
    })

    it('isCompatible: an empty cell is convertible unless the target is required', () => {
      expect(selectColumnType.isCompatible('', { type: 'select', options: status.options })).toBe(
        true
      )
      expect(
        selectColumnType.isCompatible('', {
          type: 'select',
          options: status.options,
          required: true,
        })
      ).toBe(false)
    })

    it('isCompatible: a single-select target rejects multiple values', () => {
      expect(
        selectColumnType.isCompatible(['Open', 'Closed'], {
          type: 'select',
          options: status.options,
        })
      ).toBe(false)
    })
  })

  describe('multi-select', () => {
    it('parse: splits a comma-delimited string, resolves each part, and dedups', () => {
      expect(selectColumnType.parse('Alpha, Beta, alpha', tags)).toEqual({
        ok: true,
        value: ['opt_a', 'opt_b'],
      })
    })

    it('isValidValue: requires an array of declared option ids', () => {
      expect(selectColumnType.isValidValue(['opt_a', 'opt_b'], tags)).toBeNull()
      expect(selectColumnType.isValidValue('opt_a', tags)).toBe('tags must be a list of options')
      expect(selectColumnType.isValidValue(['opt_a', 'nope'], tags)).toBe(
        'tags must only contain defined options'
      )
    })

    it('isValidValue: an empty array fails only when required', () => {
      expect(selectColumnType.isValidValue([], tags)).toBeNull()
      expect(selectColumnType.isValidValue([], { ...tags, required: true })).toBe(
        'Missing required field: tags'
      )
    })

    it('format: joins resolved names with a comma', () => {
      expect(selectColumnType.format(['opt_b', 'opt_a'], tags)).toBe('Beta, Alpha')
    })

    it('isCompatible: every part must resolve against the target options', () => {
      expect(
        selectColumnType.isCompatible('Alpha, Beta', {
          type: 'select',
          options: tags.options,
          multiple: true,
        })
      ).toBe(true)
      expect(
        selectColumnType.isCompatible('Alpha, Gamma', {
          type: 'select',
          options: tags.options,
          multiple: true,
        })
      ).toBe(false)
    })
  })
})

describe('convenience wrappers', () => {
  it('parseColumnValue delegates to the column type, falling back to ok:false for an unknown type', () => {
    expect(parseColumnValue('42', numberCol)).toEqual({ ok: true, value: 42 })
    expect(
      parseColumnValue('x', { name: 'c', type: 'currency' } as unknown as ColumnDefinition)
    ).toEqual({
      ok: false,
    })
  })

  it('isValidColumnValue delegates to the column type, falling back to an error for an unknown type', () => {
    expect(isValidColumnValue(42, numberCol)).toBeNull()
    expect(
      isValidColumnValue('x', { name: 'c', type: 'currency' } as unknown as ColumnDefinition)
    ).toBe('Unknown column type "currency"')
  })

  it('formatColumnValue delegates to the column type, falling back to String(value) for an unknown type', () => {
    expect(formatColumnValue('opt_open', status)).toBe('Open')
    expect(
      formatColumnValue(42, { name: 'c', type: 'currency' } as unknown as ColumnDefinition)
    ).toBe('42')
  })

  it('isValueCompatibleWithColumnType treats null/undefined as always compatible', () => {
    expect(isValueCompatibleWithColumnType(null, { type: 'number' })).toBe(true)
    expect(isValueCompatibleWithColumnType(undefined, { type: 'string' })).toBe(true)
  })

  it('isValueCompatibleWithColumnType dispatches on the target type, not the source', () => {
    expect(isValueCompatibleWithColumnType('Medium', { type: 'string' })).toBe(true)
    expect(isValueCompatibleWithColumnType({ a: 1 }, { type: 'string' })).toBe(false)
  })

  it('sqlCastForColumnType returns the right cast per type and null for unknown/undefined', () => {
    expect(sqlCastForColumnType('number')).toBe('numeric')
    expect(sqlCastForColumnType('date')).toBe('timestamptz')
    expect(sqlCastForColumnType('string')).toBeNull()
    expect(sqlCastForColumnType('currency')).toBeNull()
    expect(sqlCastForColumnType(undefined)).toBeNull()
  })
})
