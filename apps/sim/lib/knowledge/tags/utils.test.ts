import { describe, expect, it } from 'vitest'
import {
  coerceTagFilterValue,
  validateTagValue,
  validateTagValueLength,
} from '@/lib/knowledge/tags/utils'

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
})

describe('validateTagValueLength', () => {
  it('accepts a value at the indexed-text limit and names the tag past it', () => {
    expect(validateTagValueLength('Labels', 'a'.repeat(512))).toBeNull()
    expect(validateTagValueLength('Labels', 'a'.repeat(513))).toBe(
      'Tag "Labels" cannot exceed 512 characters'
    )
  })
})
