import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  isTabTitleTruncated,
  type TabStripItem,
  tabDropIndex,
  tabStripWheelPosition,
} from './tab-strip'

describe('isTabTitleTruncated', () => {
  it('shows title help only after a meaningful amount of text is clipped', () => {
    expect(isTabTitleTruncated({ clientWidth: 100, scrollWidth: 140 })).toBe(true)
    expect(isTabTitleTruncated({ clientWidth: 100, scrollWidth: 108 })).toBe(true)
    expect(isTabTitleTruncated({ clientWidth: 160, scrollWidth: 167 })).toBe(false)
    expect(isTabTitleTruncated({ clientWidth: 160, scrollWidth: 200 })).toBe(true)
    expect(isTabTitleTruncated({ clientWidth: 100, scrollWidth: 100 })).toBe(false)
    expect(isTabTitleTruncated({ clientWidth: 120, scrollWidth: 80 })).toBe(false)
  })
})

describe('tabStripWheelPosition', () => {
  it('uses native horizontal deltas and falls back to vertical wheel movement', () => {
    expect(tabStripWheelPosition(20, 500, 200, 100, 40)).toBe(120)
    expect(tabStripWheelPosition(20, 500, 200, 0, 100)).toBe(120)
  })

  it('clamps at each edge and declines gestures that cannot move', () => {
    expect(tabStripWheelPosition(280, 500, 200, 0, 50)).toBe(300)
    expect(tabStripWheelPosition(300, 500, 200, 0, 50)).toBeNull()
    expect(tabStripWheelPosition(0, 500, 200, -50, 0)).toBeNull()
    expect(tabStripWheelPosition(0, 200, 200, 10, 0)).toBeNull()
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

describe('tab strip vertical overflow', () => {
  const source = readFileSync(new URL('./tab-strip.tsx', import.meta.url), 'utf8')
  /** Declarations only — the comments here discuss the very class they removed. */
  const markup = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  /**
   * A source-level guard, which is weaker than asserting rendered geometry and is a
   * deliberate compromise: this package's vitest runs in `node`, has no browser mode, and
   * the repo's only Playwright harness drives Electron against static HTML fixtures, so
   * nothing here can lay out a React tree against the compiled CSS. The behaviour was
   * instead measured directly in a renderer — the row went from scrollHeight 30 against
   * clientHeight 29 to 30 against 30 — and this guard pins the invariant that produced it.
   */
  it('keeps every negative bottom margin outside the horizontally scrolling row', () => {
    // The active tab has to hang one pixel over the strip's bottom border. Anything inside
    // the row that does so overflows it, and `overflow-x: auto` computes the visible
    // `overflow-y` to `auto` as well — so the strip became scrollable by that one pixel.
    // Asserting the count, not just the row's own class, catches the regression wherever a
    // descendant reintroduces it rather than only on the tab it came from originally.
    const negativeBottomMargins = markup.match(/-mb-px/g) ?? []
    expect(negativeBottomMargins).toHaveLength(1)

    const scrollRow = markup.match(/className='([^']*overflow-x-auto[^']*)'/)?.[1] ?? ''
    expect(scrollRow).not.toContain('-mb-px')
  })
})
