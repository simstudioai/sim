/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { CHART_PADDING, resolveChartPadding } from '@/components/charts/chart-geometry'
import {
  estimateTooltipHeight,
  estimateTooltipWidth,
  positionChartTooltip,
} from '@/components/charts/chart-tooltip'

const WIDTH = 800
const HEIGHT = 166

function place(anchorY: number, rows = 1, hasDate = true) {
  const tooltipHeight = estimateTooltipHeight(rows, hasDate)
  const position = positionChartTooltip({
    anchorX: 400,
    anchorY,
    width: WIDTH,
    height: HEIGHT,
    tooltipMaxWidth: estimateTooltipWidth(12),
    tooltipHeight,
  })
  return { ...position, tooltipHeight }
}

describe('positionChartTooltip', () => {
  /**
   * The bug this exists for: the vertical clamp was a fixed inset that ignored the
   * box's real height, so near the foot of the plot the tooltip hung a pixel or two
   * past the bottom. The scroll container sets `overflow-x`, which promotes
   * `overflow-y` to `auto`, and those pixels raised a vertical scrollbar over the
   * chart the moment the cursor approached the axis.
   */
  it('keeps the whole box inside the chart when the cursor is at the very bottom', () => {
    const { top, tooltipHeight } = place(HEIGHT)
    expect(top + tooltipHeight).toBeLessThanOrEqual(HEIGHT)
  })

  it('holds for a taller multi-row tooltip, which overflows soonest', () => {
    const { top, tooltipHeight } = place(HEIGHT, 5)
    expect(top + tooltipHeight).toBeLessThanOrEqual(HEIGHT)
    expect(top).toBeGreaterThanOrEqual(0)
  })

  it('never places the box above the chart when the cursor is at the top', () => {
    expect(place(0).top).toBeGreaterThanOrEqual(0)
  })

  it('prefers the right of the cursor and flips left near the right edge', () => {
    const boxWidth = estimateTooltipWidth(12)
    const right = positionChartTooltip({
      anchorX: 100,
      anchorY: 80,
      width: WIDTH,
      height: HEIGHT,
      tooltipMaxWidth: boxWidth,
      tooltipHeight: estimateTooltipHeight(1, true),
    })
    expect(right.left).toBeGreaterThan(100)

    const flipped = positionChartTooltip({
      anchorX: WIDTH - CHART_PADDING.right,
      anchorY: 80,
      width: WIDTH,
      height: HEIGHT,
      tooltipMaxWidth: boxWidth,
      tooltipHeight: estimateTooltipHeight(1, true),
    })
    expect(flipped.left + boxWidth).toBeLessThanOrEqual(WIDTH - CHART_PADDING.right)
  })

  /** A chart with wide axis labels has a wider gutter, and the clamp must follow it. */
  it('clamps the left edge to the resolved gutter, not the shared constant', () => {
    const padding = resolveChartPadding(['123456.7m'])
    const { left } = positionChartTooltip({
      anchorX: 0,
      anchorY: 80,
      width: WIDTH,
      height: HEIGHT,
      tooltipMaxWidth: estimateTooltipWidth(12),
      tooltipHeight: estimateTooltipHeight(1, true),
      padding,
    })
    expect(left).toBeGreaterThanOrEqual(padding.left)
    expect(padding.left).toBeGreaterThan(CHART_PADDING.left)
  })
})

describe('estimateTooltipHeight', () => {
  it('grows with each row and with the date header', () => {
    expect(estimateTooltipHeight(2, true)).toBeGreaterThan(estimateTooltipHeight(1, true))
    expect(estimateTooltipHeight(1, true)).toBeGreaterThan(estimateTooltipHeight(1, false))
  })

  it('reserves a row even when told there are none', () => {
    expect(estimateTooltipHeight(0, false)).toBe(estimateTooltipHeight(1, false))
  })
})
