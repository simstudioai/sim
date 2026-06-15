/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isPlainRecord, isRecordLike, sortObjectKeysDeep } from './object.js'

class Sample {
  value = 1
}

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
