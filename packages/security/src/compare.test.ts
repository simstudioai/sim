import { describe, expect, it } from 'vitest'
import { safeCompare } from './compare'

describe('safeCompare', () => {
  it('returns true for identical strings', () => {
    expect(safeCompare('abc', 'abc')).toBe(true)
  })

  it('returns false for equal-length different strings', () => {
    expect(safeCompare('abc', 'abd')).toBe(false)
  })

  it('returns false for different-length strings without throwing', () => {
    expect(safeCompare('short', 'longer-value')).toBe(false)
    expect(safeCompare('', 'a')).toBe(false)
    expect(safeCompare('a', '')).toBe(false)
  })
})
