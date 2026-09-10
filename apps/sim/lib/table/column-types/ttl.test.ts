/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { isValueCompatible } from '@/lib/table/column-types'
import { ttlColumnType } from '@/lib/table/column-types/ttl'
import { retypeCellRewrite } from '@/lib/table/columns/service'
import {
  isTtlTimestamp,
  normalizeTtlTimestamp,
  TTL_FORMAT_ERROR,
  todayAtTtlOffset,
  ttlInstantForComparison,
  ttlValueFromPicker,
  ttlValueToPickerParts,
} from '@/lib/table/ttl-values'
import type { ColumnDefinition, JsonValue } from '@/lib/table/types'
import { coerceRowToSchema } from '@/lib/table/validation'

const column: ColumnDefinition = { name: 'expires_at', type: 'ttl' }

describe('TTL column type', () => {
  it.each([
    '2026-09-07T14:30:00-07:00',
    '2026-01-07T14:30:00-08:00',
    '2026-09-07T14:30:00+05:45',
    '2026-09-07T14:30:00+00:00',
    '2024-02-29T23:59:59-00:00',
    '0001-01-01T00:00:00-00:00',
    '9999-12-31T23:59:59-00:00',
  ])('stores and displays %s byte-for-byte', (value) => {
    expect(isTtlTimestamp(value)).toBe(true)
    expect(ttlColumnType.coerce(value, column)).toEqual({ ok: true, value })
    expect(ttlColumnType.validateCell(value, column)).toBeNull()
    expect(ttlColumnType.formatForDisplay(value, column)).toBe(value)
    expect(ttlColumnType.formatForInput(value, column)).toBe(value)
    expect(isValueCompatible(value, column)).toBe(true)
  })

  it.each([
    ['2026-09-07T14:30:00Z', '2026-09-07T14:30:00-00:00'],
    ['2026-09-07T14:30Z', '2026-09-07T14:30:00-00:00'],
    ['2026-09-07t14:30:00z', '2026-09-07T14:30:00-00:00'],
    ['2026-09-07T14:30:00.000Z', '2026-09-07T14:30:00-00:00'],
    ['2026-09-07T14:30:00.123400Z', '2026-09-07T14:30:00.1234-00:00'],
    ['2026-09-07T07:30:00.000001-07:00', '2026-09-07T07:30:00.000001-07:00'],
    ['2026-01-01T00:00:00.999999+01:00', '2026-01-01T00:00:00.999999+01:00'],
    ['2026-11-01T01:30:00-04:00', '2026-11-01T01:30:00-04:00'],
    ['2026-11-01T01:30:00-05:00', '2026-11-01T01:30:00-05:00'],
  ])('preserves the clock and offset of %s without losing precision', (input, expected) => {
    expect(isTtlTimestamp(input)).toBe(true)
    expect(ttlColumnType.coerce(input, column)).toEqual({ ok: true, value: expected })
    expect(ttlColumnType.formatForDisplay(input, column)).toBe(expected)
    expect(ttlColumnType.formatForInput(input, column)).toBe(expected)
    expect(ttlColumnType.validateFilterValue?.(input, column)).toBeNull()
    expect(normalizeTtlTimestamp(expected)).toBe(expected)
    expect(retypeCellRewrite(input, column)).toEqual(
      input === expected ? null : { value: expected }
    )
  })

  it('compares equivalent instants without rewriting stored offsets or dropping microseconds', () => {
    const equal = [
      '2026-09-07T07:30:00.000001-07:00',
      '2026-09-07T20:15:00.000001+05:45',
      '2026-09-07T14:30:00.000001Z',
      '2026-09-07T14:30:00.000001-00:00',
      '2026-09-07T14:30:00.000001+00:00',
    ]
    for (const value of equal) {
      expect(ttlColumnType.valueForEquality?.(value)).toBe('2026-09-07T14:30:00.000001Z')
    }
    expect(ttlInstantForComparison('2026-09-07T07:30:00.000002-07:00')).toBe(
      '2026-09-07T14:30:00.000002Z'
    )
    expect(ttlInstantForComparison('2026-01-01T00:00:00.999999+01:00')).toBe(
      '2025-12-31T23:00:00.999999Z'
    )
  })

  it.each<JsonValue>([
    1_700_000_000,
    '1700000000',
    new Date('2026-09-07T14:30:00Z'),
    '2026-09-07',
    '2026-09-07T14:30:00',
    '2026-09-07T14:30:00+16:00',
    '2026-09-07T14:30:00-07:60',
    '2026-09-07T14:30:00.0000001Z',
    '2026-09-07 14:30:00Z',
    '2026-09-07T14:30:00Z ',
    '2026-09-07T14:30:00Z\n',
    '2026-09-07T14:30:00+0700',
    '2026-09-07T14:30:00 America/Los_Angeles',
    '2026-09-07T14:30:00Z[UTC]',
    'now',
    'today',
    'epoch',
    'infinity',
    '-infinity',
    '2026-02-29T12:00:00Z',
    '2026-02-30T12:00:00Z',
    '2026-02-30T12:00:00-07:00',
    '2026-04-31T12:00:00Z',
    '2026-09-07T24:00:00Z',
    '2026-09-07T14:60:00Z',
    '2026-09-07T14:30:60Z',
    '0000-01-01T00:00:00Z',
    '0001-01-01T00:00:00+01:00',
    '9999-12-31T23:59:59-01:00',
    '',
    null,
    false,
    [],
    {},
  ])('rejects ambiguous, invalid, or unsupported input %j', (value) => {
    expect(isTtlTimestamp(value)).toBe(false)
    expect(ttlColumnType.coerce(value, column)).toEqual({ ok: false })
    expect(ttlColumnType.validateCell(value, column)).toContain(TTL_FORMAT_ERROR)
    expect(isValueCompatible(value, column)).toBe(false)
  })

  it('validates workflow/API writes and preserves absent or cleared expiration', () => {
    const schema = { columns: [column] }
    const valid = { expires_at: '2026-09-07T07:30:00-07:00' }
    expect(coerceRowToSchema(valid, schema, 'reject').valid).toBe(true)
    expect(valid.expires_at).toBe('2026-09-07T07:30:00-07:00')
    expect(coerceRowToSchema({ expires_at: 1_700_000_000 }, schema, 'reject').valid).toBe(false)
    expect(coerceRowToSchema({}, schema, 'reject').valid).toBe(true)
    expect(coerceRowToSchema({ expires_at: null }, schema, 'reject').valid).toBe(true)
  })

  it('converts between TTL and text without rewriting the value', () => {
    const value = '2026-09-07T14:30:00-00:00'
    expect(retypeCellRewrite(value, { name: 'text', type: 'string' })).toBeNull()
    expect(retypeCellRewrite(value, column)).toBeNull()
    expect(retypeCellRewrite(value, { name: 'date', type: 'date' })).toEqual({
      value: '2026-09-07T14:30:00Z',
    })
  })

  it('serializes picker fields in their offset and defaults new values to -00:00', () => {
    expect(ttlValueFromPicker('2026-09-07', '14:30')).toBe('2026-09-07T14:30:00-00:00')
    expect(ttlValueFromPicker('2026-09-07', '14:30:45', '-07:00')).toBe('2026-09-07T14:30:45-07:00')
    expect(ttlValueFromPicker('2026-09-07', null, '+05:45')).toBe('2026-09-07T00:00:00+05:45')
    expect(ttlValueFromPicker('2026-09-07', '14:30:45.123456', '-08:00')).toBe(
      '2026-09-07T14:30:45.123456-08:00'
    )
    expect(ttlValueToPickerParts('2026-09-07T07:30:45.123456-07:00')).toEqual({
      day: '2026-09-07',
      time: '07:30:45.123456',
      offset: '-07:00',
    })
    expect(ttlValueToPickerParts('2026-09-07T07:30:00Z').offset).toBe('-00:00')
    expect(ttlValueToPickerParts('')).toEqual({ day: null, time: null, offset: '-00:00' })
  })

  it('calculates Today in the stored offset across a UTC date boundary', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-01T01:00:00Z'))
    try {
      expect(todayAtTtlOffset('-07:00')).toBe('2025-12-31')
      expect(todayAtTtlOffset('+05:45')).toBe('2026-01-01')
      expect(todayAtTtlOffset('-00:00')).toBe('2026-01-01')
    } finally {
      now.mockRestore()
    }
  })
})
