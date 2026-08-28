/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BarChart } from '@/components/charts/bar-chart'
import { CHART_PADDING } from '@/components/charts/chart-geometry'
import { RadarChart } from '@/components/charts/radar-chart'

/**
 * Rendered-geometry guards for the chart family.
 *
 * These assert against the real SVG the components emit rather than against the
 * geometry helpers in isolation: the two clipping bugs this file exists for — a
 * y-axis label cut off at the container's left edge, and a radar caption painting
 * over the section beside it — were both invisible to a unit test of the maths,
 * because each came from a *callsite* combining correct helpers wrongly.
 */

let container: HTMLDivElement
let root: Root

/** jsdom lays nothing out, so the width the chart measures has to be supplied. */
function mountAtWidth(width: number, element: React.ReactElement): SVGSVGElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width,
    height: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
  root = createRoot(container)
  act(() => root.render(element))
  const svg = container.querySelector('svg')
  if (!svg) throw new Error('chart did not render an svg')
  return svg
}

/** Right-anchored SVG text at 9px, measured the way the chart's own estimator does. */
function textExtent(text: string): number {
  let width = 0
  for (const character of text) width += /[.,:\s]/.test(character) ? 0.3 : 0.58
  return width * 9
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  vi.restoreAllMocks()
})

function dailySeries(count: number, peak: number) {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
    value: index === 0 ? peak : peak / 10,
  }))
}

describe('BarChart rendered geometry', () => {
  const widths = [280, 420, 680, 1024]
  const peaks = [7300, 173_000, 1_234_567]

  it.each(widths.flatMap((width) => peaks.map((peak) => [width, peak] as const)))(
    'keeps the y-axis labels inside the box at width %i, peak %i',
    (width, peak) => {
      const svg = mountAtWidth(
        width,
        <BarChart
          data={dailySeries(90, peak)}
          label=''
          color='#5b8def'
          unit='credits'
          height={160}
        />
      )
      const labels = [...svg.querySelectorAll('text')].filter(
        (node) => node.getAttribute('text-anchor') === 'end'
      )
      expect(labels.length).toBe(2)
      for (const label of labels) {
        const anchorX = Number(label.getAttribute('x'))
        // Right-anchored: the glyphs run leftward from the anchor.
        expect(anchorX - textExtent(label.textContent ?? '')).toBeGreaterThanOrEqual(0)
      }
    }
  )

  it.each(widths)('keeps every bar inside the plot area at width %i', (width) => {
    const svg = mountAtWidth(
      width,
      <BarChart
        data={dailySeries(90, 173_000)}
        label=''
        color='#5b8def'
        unit='credits'
        height={160}
      />
    )
    const bars = [...svg.querySelectorAll('rect')]
    expect(bars.length).toBeGreaterThan(0)
    const svgWidth = Number(svg.getAttribute('width'))
    for (const bar of bars) {
      const x = Number(bar.getAttribute('x'))
      const right = x + Number(bar.getAttribute('width'))
      expect(x).toBeGreaterThanOrEqual(CHART_PADDING.left)
      expect(right).toBeLessThanOrEqual(svgWidth - CHART_PADDING.right + 0.01)
    }
  })

  it('keeps the first and last x-axis tick label inside the box', () => {
    const width = 680
    const svg = mountAtWidth(
      width,
      <BarChart
        data={dailySeries(90, 173_000)}
        label=''
        color='#5b8def'
        unit='credits'
        height={160}
      />
    )
    const ticks = [...svg.querySelectorAll('text')].filter(
      (node) => node.getAttribute('text-anchor') === 'middle'
    )
    expect(ticks.length).toBeGreaterThan(1)
    for (const tick of ticks) {
      const centre = Number(tick.getAttribute('x'))
      const half = textExtent(tick.textContent ?? '') / 2
      expect(centre - half).toBeGreaterThanOrEqual(0)
      expect(centre + half).toBeLessThanOrEqual(width)
    }
  })
})

describe('RadarChart rendered geometry', () => {
  const LONG = 'Knowledge Base Sync'

  /**
   * Every caption long, not just the first.
   *
   * The first axis sits at twelve o'clock, where a caption is centred and has the
   * whole half-width to spend — the one position that cannot overflow horizontally.
   * A fixture that only made that one long proved nothing about the axes that
   * actually run out of room.
   */
  function axesOf(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      label: `${LONG} ${index}`,
      value: 100 * (index + 1),
      display: String(100 * (index + 1)),
    }))
  }

  it.each([
    [280, 3],
    [280, 6],
    [320, 4],
    [420, 5],
    [420, 6],
    [520, 7],
    [680, 6],
  ])('keeps every axis caption inside the box at width %i with %i axes', (width, axisCount) => {
    const svg = mountAtWidth(width, <RadarChart axes={axesOf(axisCount)} color='#5b8def' />)
    const height = Number(svg.getAttribute('height'))
    const captions = [...svg.querySelectorAll('text')]
    expect(captions.length).toBe(axisCount)

    for (const caption of captions) {
      const x = Number(caption.getAttribute('x'))
      const y = Number(caption.getAttribute('y'))
      const anchor = caption.getAttribute('text-anchor')
      const extent = textExtent(caption.textContent ?? '')
      const left = anchor === 'start' ? x : anchor === 'end' ? x - extent : x - extent / 2
      const right = left + extent
      expect(left).toBeGreaterThanOrEqual(0)
      expect(right).toBeLessThanOrEqual(width)

      // An 'auto' baseline sits the glyphs above y; 'middle' centres them on it.
      const capHeight = 9
      const top =
        caption.getAttribute('dominant-baseline') === 'middle' ? y - capHeight / 2 : y - capHeight
      const bottom = top + capHeight
      expect(top).toBeGreaterThanOrEqual(0)
      expect(bottom).toBeLessThanOrEqual(height)
    }
  })

  it('draws a positive-radius web rather than collapsing at the narrow floor', () => {
    const svg = mountAtWidth(280, <RadarChart axes={axesOf(6)} color='#5b8def' />)
    const rings = [...svg.querySelectorAll('polygon')].filter(
      (node) => node.getAttribute('fill') === 'none'
    )
    expect(rings.length).toBeGreaterThan(0)
    const outer = rings[rings.length - 1]
    const points = (outer.getAttribute('points') ?? '')
      .split(' ')
      .map((pair) => pair.split(',').map(Number))
    const xs = points.map(([x]) => x)
    const ys = points.map(([, y]) => y)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(40)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(40)
  })

  it('renders the empty state rather than a degenerate polygon below three axes', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 420,
      height: 0,
      top: 0,
      left: 0,
      right: 420,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)
    root = createRoot(container)
    act(() => root.render(<RadarChart axes={axesOf(2)} color='#5b8def' />))
    expect(container.querySelector('svg')).toBeNull()
    expect(container.textContent).toContain('No data')
  })
})
