import { describe, expect, it } from 'vitest'
import { type TabStripItem, tabDropIndex } from './tab-strip'

describe('tabDropIndex', () => {
  const tabs: TabStripItem[] = [
    { id: 'pinned-1', title: 'pinned-1', pinned: true },
    { id: 'pinned-2', title: 'pinned-2', pinned: true },
    { id: 'regular-1', title: 'regular-1' },
    { id: 'regular-2', title: 'regular-2' },
  ]

  it('keeps pinned and regular tabs inside their respective groups', () => {
    expect(tabDropIndex(tabs, 'pinned-1', 4)).toBe(1)
    expect(tabDropIndex(tabs, 'regular-2', 0)).toBe(2)
    expect(tabDropIndex(tabs, 'missing', 0)).toBeNull()
  })
})
