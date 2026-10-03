import { describe, expect, it } from 'vitest'
import { getValueAtPath, isPlainRecord, toArray } from './object.js'

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
})

describe('isPlainRecord', () => {
  it('returns false for Date, class instances, arrays, and null', () => {
    expect(isPlainRecord(new Date())).toBe(false)
    expect(isPlainRecord(new Sample())).toBe(false)
    expect(isPlainRecord([])).toBe(false)
    expect(isPlainRecord(null)).toBe(false)
  })
})

describe('toArray', () => {
  it('returns a fresh array on every miss, so callers cannot share one', () => {
    expect(toArray(null)).not.toBe(toArray(null))
  })
})
