/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolveComparePair } from './compare-pair'

describe('resolveComparePair', () => {
  it('puts the older version on the base side whichever was clicked', () => {
    const expected = {
      base: { kind: 'version', version: 3 },
      target: { kind: 'version', version: 5 },
    }
    expect(resolveComparePair(5, 3)).toEqual(expected)
    expect(resolveComparePair(3, 5)).toEqual(expected)
  })

  it('compares the live version, or any version with nothing live, against the draft', () => {
    expect(resolveComparePair(3, 3)).toEqual({
      base: { kind: 'version', version: 3 },
      target: { kind: 'draft' },
    })
    expect(resolveComparePair(2, null)).toEqual({
      base: { kind: 'version', version: 2 },
      target: { kind: 'draft' },
    })
  })
})
