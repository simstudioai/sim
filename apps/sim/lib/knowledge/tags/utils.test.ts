/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { coerceTagFilterValue, validateTagValue } from '@/lib/knowledge/tags/utils'

describe('coerceTagFilterValue', () => {
  it('accepts exactly what validateTagValue accepts', () => {
    const cases: Array<[string, 'number' | 'date' | 'boolean']> = [
      ['', 'number'],
      ['0x10', 'number'],
      ['12.5', 'number'],
      ['abc', 'number'],
      ['TRUE', 'boolean'],
      ['False', 'boolean'],
      ['yes', 'boolean'],
      [' 2026-08-13', 'date'],
      ['2026-08-13', 'date'],
      ['2026-02-31', 'date'],
      ['13-08-2026', 'date'],
    ]
    for (const [value, fieldType] of cases) {
      expect(coerceTagFilterValue(value, fieldType).ok, `${fieldType} "${value}"`).toBe(
        validateTagValue('tag', value, fieldType) === null
      )
    }
  })

  it('trims a date the same way the gate does', () => {
    expect(coerceTagFilterValue(' 2026-08-13 ', 'date')).toEqual({ ok: true, value: '2026-08-13' })
  })

  it('reads a boolean case-insensitively', () => {
    expect(coerceTagFilterValue('TRUE', 'boolean')).toEqual({ ok: true, value: true })
    expect(coerceTagFilterValue('False', 'boolean')).toEqual({ ok: true, value: false })
    expect(coerceTagFilterValue(true, 'boolean')).toEqual({ ok: true, value: true })
  })

  it('reads a number with the same base the gate validates with', () => {
    expect(coerceTagFilterValue('0x10', 'number')).toEqual({ ok: true, value: 16 })
    expect(coerceTagFilterValue('', 'number')).toEqual({ ok: true, value: 0 })
    expect(coerceTagFilterValue(12.5, 'number')).toEqual({ ok: true, value: 12.5 })
  })

  it('leaves a text value untouched so a search for padded text still matches', () => {
    expect(coerceTagFilterValue(' padded ', 'text')).toEqual({ ok: true, value: ' padded ' })
  })
})

describe('validateTagValue', () => {
  it('keeps its distinct messages per failure', () => {
    expect(validateTagValue('flag', 'yes', 'boolean')).toBe(
      'Tag "flag" expects a boolean value (true/false), but received "yes"'
    )
    expect(validateTagValue('score', 'abc', 'number')).toBe(
      'Tag "score" expects a number value, but received "abc"'
    )
    expect(validateTagValue('due', '13-08-2026', 'date')).toBe(
      'Tag "due" expects a date in YYYY-MM-DD format, but received "13-08-2026"'
    )
    expect(validateTagValue('due', '2026-02-31', 'date')).toBe(
      'Tag "due" has an invalid date: "2026-02-31"'
    )
  })

  it('does not constrain text or unknown field types', () => {
    expect(validateTagValue('name', 'anything', 'text')).toBeNull()
    expect(validateTagValue('name', 'anything', 'json')).toBeNull()
  })
})
