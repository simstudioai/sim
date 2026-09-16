/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { BarChart, CHART_PADDING, ChartFrame, DonutChart, LineChart, RadarChart } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('renders date buckets and axes for a zero-only series without a no-data overlay', () => {
    const svg = mountAtWidth(
      680,
      <BarChart
        data={dailySeries(7, 0)}
        label=''
        color='var(--indicator-seat-filled)'
        height={180}
        timeZone='UTC'
      />
    )
    expect(container.textContent).not.toContain('No data')
    expect(container.textContent).toContain('Jan 1')
    expect(container.textContent).toContain('Jan 7')
    expect(container.textContent).not.toContain('Dec 31')
    expect(svg.querySelectorAll('text').length).toBeGreaterThan(2)
    expect(svg.querySelectorAll('rect')).toHaveLength(7)
    expect(svg.querySelectorAll('rect[fill^="url"]')).toHaveLength(0)
    expect(svg.querySelectorAll('line').length).toBeGreaterThan(0)
  })

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
        /** Right-anchored: the glyphs run leftward from the anchor. */
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

  /** Every axis needs a long caption; the centered first axis cannot expose side overflow. */
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

      /** An 'auto' baseline sits the glyphs above y; 'middle' centres them on it. */
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

describe('Dashboard chart states', () => {
  it('previews, pins, and clears a distribution without changing its proportions', () => {
    const segments = [
      { label: 'Completed', value: 90, color: 'blue' },
      { label: 'Failed', value: 10, color: 'red' },
    ]
    mountAtWidth(400, <DonutChart label='Outcomes' segments={segments} />)
    const failed = container.querySelector<HTMLButtonElement>(
      '[aria-label="Highlight Failed: 10"]'
    )!
    const completedArc = container.querySelector('circle[stroke="blue"]')!
    act(() => failed.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(completedArc.getAttribute('opacity')).toBe('0.2')
    expect(completedArc.getAttribute('stroke-dasharray')).toBe('90 10')
    act(() => failed.click())
    act(() => failed.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
    expect(failed.getAttribute('aria-pressed')).toBe('true')
    expect(completedArc.getAttribute('opacity')).toBe('0.2')
    act(() => failed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(failed.getAttribute('aria-pressed')).toBe('false')
    expect(completedArc.getAttribute('opacity')).toBe('1')
    act(() => failed.focus())
    expect(completedArc.getAttribute('opacity')).toBe('0.2')
    act(() => failed.blur())
    expect(completedArc.getAttribute('opacity')).toBe('1')
    act(() => failed.click())
    act(() => root.render(<DonutChart label='Outcomes' segments={segments.slice(0, 1)} />))
    expect(completedArc.getAttribute('opacity')).toBe('1')
    expect(container.querySelector('text')?.textContent).toBe('90')
  })

  it.each([1, 2])('labels short daily series with calendar dates (%s buckets)', (count) => {
    const svg = mountAtWidth(
      400,
      <BarChart
        label=''
        data={dailySeries(count, 0)}
        color='blue'
        xAxisFormat='date'
        timeZone='UTC'
      />
    )
    expect(svg.textContent).toContain('Jan 1')
    expect(svg.textContent).not.toContain('00:00')
    if (count === 2) expect(svg.textContent).toContain('Jan 2')
  })

  it('reserves the same chart frame for loading, errors, and data', () => {
    const content = (
      <DonutChart label='Outcomes' segments={[{ label: 'Completed', value: 5, color: 'blue' }]} />
    )
    mountAtWidth(
      320,
      <ChartFrame title='Outcomes' height={160} loading>
        {content}
      </ChartFrame>
    )
    expect(container.querySelector('section')?.getAttribute('aria-busy')).toBe('true')
    expect(container.querySelector('svg')?.getAttribute('height')).toBe('160')
    expect(container.querySelector('circle')).toBeNull()
    act(() =>
      root.render(
        <ChartFrame title='Outcomes' height={160} error='Unavailable'>
          {content}
        </ChartFrame>
      )
    )
    expect(container.querySelector('svg')?.getAttribute('height')).toBe('160')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Unavailable')
    act(() =>
      root.render(
        <ChartFrame title='Outcomes' height={160}>
          {content}
        </ChartFrame>
      )
    )
    expect(container.querySelector('svg')?.getAttribute('height')).toBe('160')
    expect(container.textContent).toContain('Completed')
    expect(
      container.querySelector('circle[stroke-dasharray]')?.getAttribute('stroke-dasharray')
    ).toBe('100 0')
  })

  it('recovers when a selected line series disappears during refresh', () => {
    const data = dailySeries(3, 10)
    mountAtWidth(
      400,
      <LineChart
        label='Runs'
        color='blue'
        data={data}
        series={[{ id: 'extra', label: 'Extra', color: 'red', data }]}
      />
    )
    const extra = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Extra')
    )
    expect(extra).toBeDefined()
    act(() => extra?.click())
    act(() => extra?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    act(() => root.render(<LineChart label='Runs' color='blue' data={data} />))
    expect(container.querySelector('path[stroke="blue"]')?.getAttribute('opacity')).toBe('1')
    act(() =>
      container
        .querySelector('svg')
        ?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 60, clientY: 40 }))
    )
    expect(container.textContent).toContain('Runs')
    expect(container.querySelector('table')?.textContent).toContain('10')
  })
})
