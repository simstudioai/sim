import { describe, expect, it } from 'vitest'
import { parseJsonArrayValue } from './utils'

describe('parseJsonArrayValue', () => {
  it.each([
    ['a malformed JSON string', '{not json'],
    ['a JSON string parsing to null', 'null'],
    ['a JSON string parsing to an object', '{"a":1}'],
    ['a JSON string parsing to a number', '5'],
    ['a bare object', { a: 1 }],
  ])('returns an empty array rather than throwing for %s', (_label, value) => {
    expect(parseJsonArrayValue(value)).toEqual([])
  })
})
