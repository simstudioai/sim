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

  it('returns true for two empty strings', () => {
    expect(safeCompare('', '')).toBe(true)
  })

  it('handles long inputs', () => {
    const a = 'x'.repeat(10_000)
    const b = 'x'.repeat(10_000)
    expect(safeCompare(a, b)).toBe(true)
    expect(safeCompare(a, `${b.slice(0, -1)}y`)).toBe(false)
  })

  it('is case-sensitive', () => {
    expect(safeCompare('ABC', 'abc')).toBe(false)
  })

  it('distinguishes hex digests that differ in one nibble', () => {
    const a = 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
    const b = 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff8'
    expect(safeCompare(a, b)).toBe(false)
    expect(safeCompare(a, a)).toBe(true)
  })
})
