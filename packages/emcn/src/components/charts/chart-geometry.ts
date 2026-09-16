export const CHART_PADDING = { top: 16, right: 28, bottom: 26, left: 26 } as const

export type ChartPadding = { top: number; right: number; bottom: number; left: number }

export const CHART_DEFAULT_HEIGHT = 166

/** Minimum width before axis labels collide; narrower containers scroll horizontally. */
export const CHART_MIN_WIDTH = 280

export const CHART_TICK_FILL = 'var(--text-tertiary)'
export const CHART_TICK_FONT_SIZE = 9
export const CHART_GRID_FRACTIONS = [0.25, 0.5, 0.75] as const

/** Punctuation and whitespace, which sit near half the width of a digit or letter. */
const NARROW_GLYPH = /[.,:\s]/

/** Gap between a y-axis tick label's right edge and the axis rule. */
export const CHART_AXIS_LABEL_GAP = 8

/** Quantize gutters so comparable charts keep aligned plot origins. */
const CHART_AXIS_GUTTER_STEP = 8

/** Estimate SVG label width before layout, allowing extra space to prevent clipping. */
export function estimateAxisLabelWidth(text: string): number {
  let width = 0
  for (const character of text) {
    width += NARROW_GLYPH.test(character) ? 0.3 : 0.58
  }
  return width * CHART_TICK_FONT_SIZE
}

/** Expand the shared left gutter to accommodate the chart’s y-axis labels. */
export function resolveChartPadding(yAxisLabels: readonly string[]): ChartPadding {
  const widest = yAxisLabels.reduce((max, label) => Math.max(max, estimateAxisLabelWidth(label)), 0)
  const required = Math.max(CHART_PADDING.left, widest + CHART_AXIS_LABEL_GAP)
  return {
    ...CHART_PADDING,
    left: Math.ceil(required / CHART_AXIS_GUTTER_STEP) * CHART_AXIS_GUTTER_STEP,
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
export function formatTimeTick(
  date: Date,
  spanMs: number,
  timeZone?: string,
  format: 'auto' | 'date' = 'auto'
): string {
  if (format === 'date')
    return date.toLocaleDateString('en-US', { timeZone, month: 'short', day: 'numeric' })
  if (spanMs <= 36 * 60 * 60 * 1000) {
    return date.toLocaleTimeString('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }
  if (spanMs <= 90 * 24 * 60 * 60 * 1000) {
    return date.toLocaleString('en-US', { timeZone, month: 'short', day: 'numeric' })
  }
  return date.toLocaleString('en-US', { timeZone, month: 'short', year: 'numeric' })
}

/** Milliseconds between the first and last timestamp, or 0 for a degenerate series. */
export function resolveSpanMs(points: ReadonlyArray<{ timestamp: string }>): number {
  if (points.length < 2) return 0
  const first = new Date(points[0].timestamp).getTime()
  const last = new Date(points[points.length - 1].timestamp).getTime()
  if (Number.isNaN(first) || Number.isNaN(last)) return 0
  return Math.abs(last - first)
}
