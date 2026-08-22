import { describe, expect, it } from 'vitest'
import { resourceTabTargetIndex } from '@/main/resource-shortcuts'

describe('resourceTabTargetIndex', () => {
  it('cycles through tabs in both directions', () => {
    expect(resourceTabTargetIndex('next-tab', 3, 2)).toBe(0)
    expect(resourceTabTargetIndex('previous-tab', 3, 0)).toBe(2)
    expect(resourceTabTargetIndex('next-tab', 3, -1)).toBe(0)
  })

  it('selects numbered tabs and reserves nine for the last tab', () => {
    expect(resourceTabTargetIndex('select-tab-1', 5, 2)).toBe(0)
    expect(resourceTabTargetIndex('select-tab-4', 5, 2)).toBe(3)
    expect(resourceTabTargetIndex('select-tab-9', 5, 2)).toBe(4)
    expect(resourceTabTargetIndex('select-tab-6', 5, 2)).toBeNull()
  })
})
