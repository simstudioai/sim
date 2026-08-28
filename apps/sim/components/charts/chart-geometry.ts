/**
 * Geometry shared by every chart in the family.
 *
 * Extracted so a sibling chart cannot drift: bar and line charts read the same
 * padding, the same clamps, the same gridlines, and resolve their x ticks the same
 * way, so two charts stacked in one card line up on the pixel.
 *
 * Pure — no React, no DOM — so a server module can read the constants.
 */

export const CHART_PADDING = { top: 16, right: 28, bottom: 26, left: 26 } as const

export type ChartPadding = { top: number; right: number; bottom: number; left: number }

/** Matches the loader placeholders callers size themselves against. */
export const CHART_DEFAULT_HEIGHT = 166

/** Below this the axis labels collide, so the chart scrolls rather than compresses. */
export const CHART_MIN_WIDTH = 280

export const CHART_TICK_FILL = 'var(--text-tertiary)'
export const CHART_TICK_FONT_SIZE = 9
export const CHART_GRID_FRACTIONS = [0.25, 0.5, 0.75] as const

/** Gap between a y-axis tick label's right edge and the axis rule. */
export const CHART_AXIS_LABEL_GAP = 8

/**
 * Rendered width of a right-anchored y-axis tick label.
 *
 * SVG `<text>` cannot be measured before layout, so the gutter that has to hold it
 * is estimated from the glyphs instead. The ratios are for the UI sans at
 * {@link CHART_TICK_FONT_SIZE}: digits and letters sit near 0.58em, punctuation and
 * spaces near 0.3em. Deliberately generous — an over-wide gutter costs a couple of
 * plot pixels, an under-wide one clips the label against the container's edge.
 */
export function estimateAxisLabelWidth(text: string): number {
  let width = 0
  for (const character of text) {
    width += /[.,:\s]/.test(character) ? 0.3 : 0.58
  }
  return width * CHART_TICK_FONT_SIZE
}

/**
 * {@link CHART_PADDING} with a left gutter wide enough for the chart's own y-axis
 * labels.
 *
 * The fixed 26px gutter left 18px of drawable width once the label gap is taken out,
 * which fits four narrow glyphs — so any tick past `7.3k` was cut off at the left edge
 * of the container. Both charts resolve their gutter through this one function from
 * the labels they are about to draw, so a bar and a line chart showing comparable
 * magnitudes still line up when stacked in one card, and neither can clip.
 */
export function resolveChartPadding(yAxisLabels: readonly string[]): ChartPadding {
  const widest = yAxisLabels.reduce((max, label) => Math.max(max, estimateAxisLabelWidth(label)), 0)
  return {
    ...CHART_PADDING,
    left: Math.max(CHART_PADDING.left, Math.ceil(widest) + CHART_AXIS_LABEL_GAP),
  }
}

/** Vertical clamp for plotted geometry, keeping strokes off the axis rules. */
export function chartPlotBand(height: number): { yMin: number; yMax: number } {
  const chartHeight = height - CHART_PADDING.top - CHART_PADDING.bottom
  return { yMin: CHART_PADDING.top + 3, yMax: CHART_PADDING.top + chartHeight - 3 }
}

/**
 * Evenly spaced point indices to label, budgeting ~64px per tick and deduping the
 * collisions that rounding produces on short series.
 */
export function resolveTimeTickIndices(pointCount: number, usableWidth: number): number[] {
  const approxLabelWidth = 64
  const desired = Math.min(8, Math.max(3, Math.floor(usableWidth / approxLabelWidth)))
  const seen = new Set<number>()
  return Array.from({ length: desired }, (_, i) =>
    Math.round((i * (pointCount - 1)) / Math.max(1, desired - 1))
  ).filter((index) => {
    if (seen.has(index)) return false
    seen.add(index)
    return true
  })
}

/**
 * Tick label whose precision follows the window: clock time within a day and a half,
 * calendar day within a quarter, month beyond that.
 */
export function formatTimeTick(date: Date, spanMs: number): string {
  if (spanMs <= 36 * 60 * 60 * 1000) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  if (spanMs <= 90 * 24 * 60 * 60 * 1000) {
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric' })
  }
  return date.toLocaleString('en-US', { month: 'short', year: 'numeric' })
}

/** Milliseconds between the first and last timestamp, or 0 for a degenerate series. */
export function resolveSpanMs(points: ReadonlyArray<{ timestamp: string }>): number {
  if (points.length < 2) return 0
  const first = new Date(points[0].timestamp).getTime()
  const last = new Date(points[points.length - 1].timestamp).getTime()
  if (Number.isNaN(first) || Number.isNaN(last)) return 0
  return Math.abs(last - first)
}
