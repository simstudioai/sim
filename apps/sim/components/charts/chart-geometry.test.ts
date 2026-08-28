/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  CHART_AXIS_LABEL_GAP,
  CHART_PADDING,
  chartPlotBand,
  estimateAxisLabelWidth,
  formatTimeTick,
  resolveChartPadding,
  resolveSpanMs,
  resolveTimeTickIndices,
} from '@/components/charts/chart-geometry'

describe('resolveTimeTickIndices', () => {
  it('budgets roughly one tick per 64px, clamped to 3..8', () => {
    expect(resolveTimeTickIndices(100, 100).length).toBe(3)
    expect(resolveTimeTickIndices(100, 320).length).toBe(5)
    expect(resolveTimeTickIndices(100, 4000).length).toBe(8)
  })

  it('dedupes the collisions rounding produces on a short series', () => {
    // 2 points across a wide chart wants 8 ticks but only has indices 0 and 1.
    const indices = resolveTimeTickIndices(2, 4000)
    expect(indices).toEqual([...new Set(indices)])
    expect(indices.every((index) => index >= 0 && index < 2)).toBe(true)
  })

  it('always spans the full series, first index to last', () => {
    const indices = resolveTimeTickIndices(50, 640)
    expect(indices[0]).toBe(0)
    expect(indices[indices.length - 1]).toBe(49)
  })
})

describe('formatTimeTick', () => {
  const date = new Date('2026-03-04T15:05:00.000Z')

  it('shows clock time within a day and a half', () => {
    expect(formatTimeTick(date, 36 * 60 * 60 * 1000)).toMatch(/^\d{2}:\d{2}$/)
  })

  it('shows a calendar day within a quarter', () => {
    expect(formatTimeTick(date, 40 * 24 * 60 * 60 * 1000)).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/)
  })

  it('shows month and year beyond a quarter', () => {
    expect(formatTimeTick(date, 400 * 24 * 60 * 60 * 1000)).toMatch(/^[A-Z][a-z]{2} \d{4}$/)
  })
})

describe('resolveSpanMs', () => {
  it('measures first to last', () => {
    expect(
      resolveSpanMs([
        { timestamp: '2026-03-04T00:00:00.000Z' },
        { timestamp: '2026-03-05T00:00:00.000Z' },
      ])
    ).toBe(24 * 60 * 60 * 1000)
  })

  it('returns 0 for a degenerate or unparseable series rather than NaN', () => {
    expect(resolveSpanMs([])).toBe(0)
    expect(resolveSpanMs([{ timestamp: '2026-03-04T00:00:00.000Z' }])).toBe(0)
    expect(resolveSpanMs([{ timestamp: 'nope' }, { timestamp: 'also nope' }])).toBe(0)
  })
})

describe('chartPlotBand', () => {
  it('insets the band so strokes clear the axis rules', () => {
    // The line and bar charts both clamp to this band, which is what keeps them
    // aligned when stacked in the same card.
    expect(chartPlotBand(166)).toEqual({
      yMin: CHART_PADDING.top + 3,
      yMax: CHART_PADDING.top + (166 - CHART_PADDING.top - CHART_PADDING.bottom) - 3,
    })
  })

  it('tracks a caller-supplied height', () => {
    expect(chartPlotBand(240).yMax).toBeGreaterThan(chartPlotBand(166).yMax)
  })
})

describe('resolveChartPadding', () => {
  /**
   * The bug this exists for: a fixed 26px gutter left 18px of drawable width once
   * `CHART_AXIS_LABEL_GAP` was taken out, and a right-anchored `7.3k` at 9px is wider
   * than that — so its first glyph was cut off at the container's left edge.
   */
  it('widens the gutter until the longest label fits beside the axis', () => {
    const { left } = resolveChartPadding(['7.3k', '0'])
    expect(left).toBeGreaterThanOrEqual(estimateAxisLabelWidth('7.3k') + CHART_AXIS_LABEL_GAP)
  })

  it('never narrows below the shared padding, so short labels stay aligned', () => {
    expect(resolveChartPadding(['0', '0']).left).toBe(CHART_PADDING.left)
    expect(resolveChartPadding([]).left).toBe(CHART_PADDING.left)
  })

  it('leaves the other three sides on the shared constant', () => {
    const padding = resolveChartPadding(['123.4m'])
    expect(padding.top).toBe(CHART_PADDING.top)
    expect(padding.right).toBe(CHART_PADDING.right)
    expect(padding.bottom).toBe(CHART_PADDING.bottom)
  })

  it('grows monotonically with label length', () => {
    const short = resolveChartPadding(['1.2k']).left
    const long = resolveChartPadding(['123456.7m']).left
    expect(long).toBeGreaterThan(short)
  })
})
