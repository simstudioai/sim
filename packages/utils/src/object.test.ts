/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getValueAtPath,
  isPlainRecord,
  isRecordLike,
  sortObjectKeysDeep,
  toRecord,
  toRecordOrNull,
} from './object.js'

class Sample {
  value = 1
}

describe('getValueAtPath', () => {
  const source = { items: [{ name: 'first', active: false, count: 0 }], empty: null }

  it.each([
    ['items[0].name', 'first'],
    ['items.0.active', false],
    ['items[0].count', 0],
    ['items[1].name', undefined],
    ['items[0].name.missing', undefined],
    ['empty.missing', undefined],
  ])('reads %s without confusing missing and falsy values', (path, expected) => {
    expect(getValueAtPath(source, path)).toBe(expected)
  })

  it('preserves an empty path and nullish roots', () => {
    expect(getValueAtPath(source, '')).toBe(source)
    expect(getValueAtPath(null, 'items')).toBeNull()
    expect(getValueAtPath(undefined, 'items')).toBeUndefined()
  })
})

describe('isRecordLike', () => {
  it('returns true for plain objects, Date, and class instances', () => {
    expect(isRecordLike({})).toBe(true)
    expect(isRecordLike(new Date())).toBe(true)
    expect(isRecordLike(new Sample())).toBe(true)
  })

  it('returns false for arrays, null, and primitives', () => {
    expect(isRecordLike([])).toBe(false)
    expect(isRecordLike(null)).toBe(false)
    expect(isRecordLike('not-a-record')).toBe(false)
    expect(isRecordLike(42)).toBe(false)
  })
})

describe('toRecord', () => {
  it('returns the value itself for records, preserving identity', () => {
    const source = { a: 1 }
    expect(toRecord(source)).toBe(source)
  })

  it('falls back to a fresh empty object for arrays, null, and primitives', () => {
    expect(toRecord([])).toEqual({})
    expect(toRecord(null)).toEqual({})
    expect(toRecord('nope')).toEqual({})
    expect(toRecord(undefined)).not.toBe(toRecord(undefined))
  })
})

describe('toRecordOrNull', () => {
  it('returns the value itself for records, preserving identity', () => {
    const source = { a: 1 }
    expect(toRecordOrNull(source)).toBe(source)
  })

  it('falls back to null for arrays, null, and primitives', () => {
    expect(toRecordOrNull([])).toBeNull()
    expect(toRecordOrNull(null)).toBeNull()
    expect(toRecordOrNull(42)).toBeNull()
  })
})

describe('isPlainRecord', () => {
  it('returns true for plain objects', () => {
    expect(isPlainRecord({})).toBe(true)
    expect(isPlainRecord(Object.create(null))).toBe(true)
  })

  it('returns false for Date, class instances, arrays, and null', () => {
    expect(isPlainRecord(new Date())).toBe(false)
    expect(isPlainRecord(new Sample())).toBe(false)
    expect(isPlainRecord([])).toBe(false)
    expect(isPlainRecord(null)).toBe(false)
  })
})

describe('sortObjectKeysDeep', () => {
  it('sorts keys deeply and recurses into array elements', () => {
    const input = {
      b: 1,
      a: { d: 4, c: 3 },
      list: [{ z: 26, y: 25 }],
    }
    const sorted = sortObjectKeysDeep(input)
    expect(JSON.stringify(sorted)).toBe(
      JSON.stringify({ a: { c: 3, d: 4 }, b: 1, list: [{ y: 25, z: 26 }] })
    )
  })

  it('returns primitives and null unchanged', () => {
    expect(sortObjectKeysDeep(null)).toBe(null)
    expect(sortObjectKeysDeep(42)).toBe(42)
    expect(sortObjectKeysDeep('x')).toBe('x')
  })

  it('preserves array order while sorting element keys', () => {
    const sorted = sortObjectKeysDeep([
      { b: 1, a: 2 },
      { d: 3, c: 4 },
    ])
    expect(JSON.stringify(sorted)).toBe(
      JSON.stringify([
        { a: 2, b: 1 },
        { c: 4, d: 3 },
      ])
    )
  })
})
