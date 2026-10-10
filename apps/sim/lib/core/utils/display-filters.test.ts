import { describe, expect, it } from 'vitest'
import { filterForDisplay } from '@/lib/core/utils/display-filters'

describe('filterForDisplay', () => {
  it('never truncates a string inside a surrogate pair', () => {
    const value = `${'x'.repeat(14_999)}😀${'y'.repeat(10)}`

    const shown: string = filterForDisplay({ value }).value

    expect(shown).toBe(`${'x'.repeat(14_999)}... [truncated 12 chars]`)
  })
})
