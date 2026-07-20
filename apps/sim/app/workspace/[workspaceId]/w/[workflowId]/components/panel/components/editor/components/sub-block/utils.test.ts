/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseJsonArrayValue } from './utils'

interface TagFilter {
  id: string
  tagName: string
}

describe('parseJsonArrayValue', () => {
  it('parses a JSON string array, the shape edit_workflow now persists', () => {
    const filters: TagFilter[] = [{ id: 'f1', tagName: 'Department' }]

    expect(parseJsonArrayValue<TagFilter>(JSON.stringify(filters))).toEqual(filters)
  })

  // Rows written by builds predating the edit_workflow stringify fix still hold raw arrays.
  it('passes through an already-parsed array', () => {
    const filters: TagFilter[] = [{ id: 'f1', tagName: 'Department' }]

    expect(parseJsonArrayValue<TagFilter>(filters)).toEqual(filters)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
  ])('returns an empty array for %s', (_label, value) => {
    expect(parseJsonArrayValue(value)).toEqual([])
  })

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
