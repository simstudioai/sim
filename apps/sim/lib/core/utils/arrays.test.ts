import { describe, expect, it } from 'vitest'
import { normalizeStringArray } from '@/lib/core/utils/arrays'

describe('array normalization utilities', () => {
  it('normalizes string arrays loaded from untyped state', () => {
    expect(normalizeStringArray(['output-1', 2, 'output-2', null])).toEqual([
      'output-1',
      'output-2',
    ])
    expect(normalizeStringArray('output-1')).toEqual([])
    expect(normalizeStringArray(undefined)).toEqual([])
  })
})
