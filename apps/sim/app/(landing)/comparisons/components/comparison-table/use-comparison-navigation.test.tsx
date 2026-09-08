/**
 * @vitest-environment jsdom
 */
import { act, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPARISON_SECTIONS } from '@/app/(landing)/comparisons/comparison-sections'
import { useComparisonNavigation } from '@/app/(landing)/comparisons/components/comparison-table/use-comparison-navigation'

interface ComparisonFixtureProps {
  revision: number
}

function ComparisonFixture({ revision }: ComparisonFixtureProps) {
  const { layoutRef, tableRef, headerRef, activeId } = useComparisonNavigation(revision)

  useLayoutEffect(() => {
    initialLayout = {
      headerHeight: layoutRef.current?.style.getPropertyValue('--comparison-header-height'),
      sectionSpan: tableRef.current
        ?.querySelector<HTMLElement>('[data-comparison-category-cell]')
        ?.style.getPropertyValue('--comparison-category-span'),
    }
  }, [])

  return (
    <div ref={layoutRef}>
      <output>{activeId}</output>
      <div ref={tableRef} data-comparison-table>
        <header ref={headerRef} />
        <div key={revision}>
          <div data-comparison-section-header />
          {COMPARISON_SECTIONS.map((section) => (
            <div key={section.id}>
              <div data-comparison-category-cell={section.id}>
                <div data-comparison-category-label={section.id} />
              </div>
              <div id={section.id} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

let host: HTMLDivElement
let root: Root
let sectionGap: number
let onResize: () => void
let initialLayout: { headerHeight?: string; sectionSpan?: string }

function scrollTo(top: number) {
  act(() => {
    host.scrollTop = top
    host.dispatchEvent(new Event('scroll'))
    vi.advanceTimersToNextFrame()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        onResize = callback
      }
      observe = vi.fn()
      disconnect = vi.fn()
    }
  )
  sectionGap = 1000
  host = document.createElement('div')
  host.style.overflowY = 'auto'
  document.body.append(host)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (!this.isConnected) return new DOMRect()
    if (this.tagName === 'HEADER') return new DOMRect(0, 100, 1000, 128)
    if (this.dataset.comparisonCategoryLabel) return new DOMRect(0, 100, 200, 128)
    if (this.hasAttribute('data-comparison-table')) {
      return new DOMRect(0, 172 - host.scrollTop, 1000, 6 * sectionGap + 500)
    }
    if (this.dataset.comparisonCategoryCell) {
      const index = COMPARISON_SECTIONS.findIndex(
        (section) => section.id === this.dataset.comparisonCategoryCell
      )
      return new DOMRect(0, 172 + index * sectionGap - host.scrollTop, 200, 128)
    }
    const index = COMPARISON_SECTIONS.findIndex((section) => section.id === this.id)
    return index < 0
      ? new DOMRect()
      : new DOMRect(0, 300 + index * sectionGap - host.scrollTop, 200, 64)
  })
  root = createRoot(host)
  act(() => root.render(<ComparisonFixture revision={0} />))
  act(() => vi.advanceTimersToNextFrame())
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useComparisonNavigation', () => {
  it('measures section bounds before the first paint', () => {
    expect(initialLayout).toEqual({ headerHeight: '128px', sectionSpan: '1000px' })
  })

  it('leaves all layout styles unchanged during scrolling in either direction', () => {
    const setProperty = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty')

    for (const top of [1002, 1037, 1072, 1200, 6200, 1072, 1037, 1002, 0]) {
      scrollTo(top)
    }

    expect(setProperty).not.toHaveBeenCalled()
  })

  it('ends the last sticky rail at the bottom of the table', () => {
    const support = host.querySelector<HTMLElement>(
      '[data-comparison-category-cell="comparison-support"]'
    )!
    expect(support.style.getPropertyValue('--comparison-category-span')).toBe('500px')
  })

  it('remeasures section bounds when the table resizes, even while scrolled', () => {
    scrollTo(1037)
    sectionGap = 1200.5
    act(() => onResize())

    const platform = host.querySelector<HTMLElement>(
      '[data-comparison-category-cell="comparison-platform"]'
    )!
    const support = host.querySelector<HTMLElement>(
      '[data-comparison-category-cell="comparison-support"]'
    )!
    expect(platform.style.getPropertyValue('--comparison-category-span')).toBe('1200.5px')
    expect(support.style.getPropertyValue('--comparison-category-span')).toBe('500px')
  })

  it('tracks the incoming section when its first fact reaches the header', () => {
    expect(host.querySelector('output')?.textContent).toBe('comparison-platform')

    scrollTo(1070)
    expect(host.querySelector('output')?.textContent).toBe('comparison-platform')

    scrollTo(1072)
    expect(host.querySelector('output')?.textContent).toBe('comparison-pricing')

    scrollTo(1070)
    expect(host.querySelector('output')?.textContent).toBe('comparison-platform')
  })

  it('returns to Platform when scrolling back from Support', () => {
    scrollTo(6200)
    expect(host.querySelector('output')?.textContent).toBe('comparison-support')

    scrollTo(0)
    expect(host.querySelector('output')?.textContent).toBe('comparison-platform')
  })

  it('tracks the current rows after comparison content is replaced', () => {
    const previousTarget = document.getElementById('comparison-support')
    act(() => root.render(<ComparisonFixture revision={1} />))
    expect(previousTarget?.isConnected).toBe(false)
    expect(
      host
        .querySelector<HTMLElement>('[data-comparison-category-cell="comparison-platform"]')
        ?.style.getPropertyValue('--comparison-category-span')
    ).toBe('1000px')

    scrollTo(0)
    expect(host.querySelector('output')?.textContent).toBe('comparison-platform')

    scrollTo(1200)
    expect(host.querySelector('output')?.textContent).toBe('comparison-pricing')

    scrollTo(6200)
    expect(host.querySelector('output')?.textContent).toBe('comparison-support')

    scrollTo(0)
    expect(host.querySelector('output')?.textContent).toBe('comparison-platform')
  })
})
