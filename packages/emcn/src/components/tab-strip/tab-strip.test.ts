import { describe, expect, it } from 'vitest'
import { isTabTitleTruncated, type TabStripItem, tabDropIndex } from './tab-strip'

describe('isTabTitleTruncated', () => {
  it('shows title help only after a meaningful amount of text is clipped', () => {
    expect(isTabTitleTruncated({ clientWidth: 100, scrollWidth: 140 })).toBe(true)
    expect(isTabTitleTruncated({ clientWidth: 100, scrollWidth: 131 })).toBe(false)
    expect(isTabTitleTruncated({ clientWidth: 160, scrollWidth: 199 })).toBe(false)
    expect(isTabTitleTruncated({ clientWidth: 160, scrollWidth: 200 })).toBe(true)
    expect(isTabTitleTruncated({ clientWidth: 100, scrollWidth: 100 })).toBe(false)
    expect(isTabTitleTruncated({ clientWidth: 120, scrollWidth: 80 })).toBe(false)
  })
})

describe('tabDropIndex', () => {
  const tabs: TabStripItem[] = [
    { id: 'pinned-1', title: 'pinned-1', pinned: true },
    { id: 'pinned-2', title: 'pinned-2', pinned: true },
    { id: 'regular-1', title: 'regular-1' },
    { id: 'regular-2', title: 'regular-2' },
  ]

  it('calculates final indices from insertion gaps', () => {
    expect(tabDropIndex(tabs, 'pinned-1', 2)).toBe(1)
    expect(tabDropIndex(tabs, 'regular-1', 4)).toBe(3)
    expect(tabDropIndex(tabs, 'regular-1', 3)).toBeNull()
  })

  it('keeps pinned and regular tabs inside their respective groups', () => {
    expect(tabDropIndex(tabs, 'pinned-1', 4)).toBe(1)
    expect(tabDropIndex(tabs, 'regular-2', 0)).toBe(2)
    expect(tabDropIndex(tabs, 'missing', 0)).toBeNull()
  })

  it('treats a strip with no pinned tabs as one group', () => {
    const plain: TabStripItem[] = [
      { id: 'a', title: 'a' },
      { id: 'b', title: 'b' },
      { id: 'c', title: 'c' },
    ]
    expect(tabDropIndex(plain, 'a', 3)).toBe(2)
    expect(tabDropIndex(plain, 'c', 0)).toBe(0)
    expect(tabDropIndex(plain, 'b', 1)).toBeNull()
  })
})

describe('tab tooltips', () => {
  /** Mirrors the render condition: tooltip text, and whether it is shown. */
  function tooltipFor(tab: TabStripItem, titleTruncated: boolean) {
    const shown = Boolean(tab.tooltip || tab.pinned || titleTruncated)
    return shown ? (tab.tooltip ?? tab.title) : null
  }

  it('prefers the fuller detail a tab supplies over its label', () => {
    // A terminal labelled with a basename can say where it actually is.
    const tab: TabStripItem = { id: '1', title: 'sim', tooltip: '/Users/me/code/sim — bun test' }

    expect(tooltipFor(tab, false)).toBe('/Users/me/code/sim — bun test')
  })

  it('shows that detail even when the label fits', () => {
    // It says something the tab cannot, so there is always a reason to hover.
    const tab: TabStripItem = { id: '1', title: 'sim', tooltip: '/Users/me/code/sim' }

    expect(tooltipFor(tab, false)).not.toBeNull()
  })

  it('falls back to the title, and only when the title is clipped', () => {
    const tab: TabStripItem = { id: '1', title: 'a very long tab title' }

    expect(tooltipFor(tab, true)).toBe('a very long tab title')
    expect(tooltipFor(tab, false)).toBeNull()
  })

  it('still explains a pinned tab, which renders with no label at all', () => {
    const tab: TabStripItem = { id: '1', title: 'GitHub', pinned: true }

    expect(tooltipFor(tab, false)).toBe('GitHub')
  })
})
