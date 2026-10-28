/**
 * ECharts option assembly for the `.chart` file viewer. Pure: no React, no
 * echarts import, JSON-in/JSON-out.
 *
 * Chrome layout is Sim-owned, content is spec-owned. Models reliably produce
 * colliding title/legend placements, so the renderer pins the title top-left
 * and the legend top-right on one chrome row (scrollable when long),
 * overriding any spec positions — the same split the pptx renderer makes
 * between slide chrome and slide content.
 */

import { toRecord } from '@sim/utils/object'

export const CHART_BAR_MAX_WIDTH = 16

export interface ChartRenderInput {
  title?: string
  option: Record<string, unknown>
  rows?: Array<Record<string, unknown>> | null
}

/** Category labels share the plot width for a single horizontal Cartesian bar chart. */
export function isHorizontalBarOption(option: Record<string, unknown>): boolean {
  const yAxes = Array.isArray(option.yAxis) ? option.yAxis : [option.yAxis]
  const xAxes = Array.isArray(option.xAxis) ? option.xAxis : [option.xAxis]
  const series = Array.isArray(option.series) ? option.series : [option.series]
  return (
    yAxes.length === 1 &&
    xAxes.length === 1 &&
    toRecord(yAxes[0]).type === 'category' &&
    toRecord(xAxes[0]).type === 'value' &&
    series.length > 0 &&
    series.every((entry) => toRecord(entry).type === 'bar')
  )
}

/** Applies `update` to every tooltip entry, keeping ECharts' array form when authored. */
export function mapTooltipEntries(
  tooltip: unknown,
  update: (entry: Record<string, unknown>) => Record<string, unknown>
): Record<string, unknown> | Record<string, unknown>[] {
  return Array.isArray(tooltip)
    ? tooltip.map((entry) => update(toRecord(entry)))
    : update(toRecord(tooltip))
}

const CATEGORY_LABEL_LAYOUT_KEYS = ['inside', 'width', 'margin'] as const

/** ECharts' default `barGap`: the space between grouped bars, relative to bar width. */
const DEFAULT_BAR_GAP = '20%'

/**
 * Pixel gap between side-by-side bars. ECharts reads `barGap` from the last series that sets
 * it: a number is pixels, a percentage is relative to the bar width, and a negative gap
 * overlaps the bars, which then need no extra space.
 */
function barGapPixels(option: Record<string, unknown>, barWidth: number): number {
  const series = Array.isArray(option.series) ? option.series : [option.series]
  let gap: unknown = DEFAULT_BAR_GAP
  for (const entry of series) {
    const barGap = toRecord(entry).barGap
    if (barGap !== undefined) gap = barGap
  }
  const pixels =
    typeof gap === 'number'
      ? gap
      : typeof gap === 'string' && gap.endsWith('%')
        ? (barWidth * Number.parseFloat(gap)) / 100
        : Number(gap)
  return Number.isFinite(pixels) ? pixels : 0
}

/**
 * Bar thickness per slot in one category row: stacked series share a slot, every other series
 * gets its own, and slots sit side by side within the row.
 */
function barSlotWidths(option: Record<string, unknown>): number[] {
  const series = Array.isArray(option.series) ? option.series : [option.series]
  const slots = new Map<unknown, number>()
  series.forEach((entry, index) => {
    const bar = toRecord(entry)
    const width = bar.barWidth ?? bar.barMaxWidth
    const key = bar.stack ?? Symbol(index)
    slots.set(
      key,
      Math.max(slots.get(key) ?? 0, typeof width === 'number' ? width : CHART_BAR_MAX_WIDTH)
    )
  })
  return [...slots.values()]
}

/**
 * Labels above the bars are a default layout, not a blend: an option that places its own
 * category labels or reserves a left inset keeps the standard ECharts left column intact. So
 * does a percentage bar width, which scales with the plot and cannot be sized per row, and a
 * grouped chart, whose side-by-side bars leave no single bar to place a label above.
 */
function authorsCategoryLabelColumn(option: Record<string, unknown>): boolean {
  const axis = toRecord(Array.isArray(option.yAxis) ? option.yAxis[0] : option.yAxis)
  const axisLabel = toRecord(axis.axisLabel)
  const grids = Array.isArray(option.grid) ? option.grid : [option.grid]
  const series = Array.isArray(option.series) ? option.series : [option.series]
  return (
    barSlotWidths(option).length > 1 ||
    CATEGORY_LABEL_LAYOUT_KEYS.some((key) => axisLabel[key] !== undefined) ||
    series.some((entry) => {
      const bar = toRecord(entry)
      return [bar.barWidth, bar.barMaxWidth].some(
        (width) => width !== undefined && typeof width !== 'number'
      )
    }) ||
    grids.some((grid) => {
      const record = toRecord(grid)
      return record.left !== undefined || record.containLabel !== undefined
    })
  )
}

export function horizontalBarWidth(option: Record<string, unknown>): number {
  const series = Array.isArray(option.series) ? option.series : [option.series]
  return Math.max(
    CHART_BAR_MAX_WIDTH,
    ...series.map((entry) => {
      const bar = toRecord(entry)
      const width = bar.barWidth ?? bar.barMaxWidth
      return typeof width === 'number' ? width : CHART_BAR_MAX_WIDTH
    })
  )
}

export function buildChartRenderOption({
  title,
  option: specOption,
  rows,
}: ChartRenderInput): Record<string, unknown> {
  const option = structuredClone(specOption)
  const horizontalBars = isHorizontalBarOption(option) && !authorsCategoryLabelColumn(option)
  if (horizontalBars) {
    const barWidth = horizontalBarWidth(option)
    const axis = toRecord(Array.isArray(option.yAxis) ? option.yAxis[0] : option.yAxis)
    axis.axisLabel = {
      inside: true,
      align: 'left',
      verticalAlign: 'bottom',
      margin: 0,
      padding: [0, 0, barWidth / 2 + 8, 0],
      ...toRecord(axis.axisLabel),
    }
    option.tooltip = mapTooltipEntries(option.tooltip, (tooltip) => ({
      ...tooltip,
      axisPointer: { type: 'none', ...toRecord(tooltip.axisPointer) },
    }))
  }
  if (rows !== null && rows !== undefined) {
    // The resolved rows become the FIRST dataset (id "table", datasetIndex 0).
    // Spec-declared datasets follow it, so filter/sort transform datasets can
    // derive from the injected rows (transforms default to fromDatasetIndex 0,
    // or name it explicitly with fromDatasetId: "table").
    const injected = { id: 'table', source: rows }
    if (option.dataset === undefined) {
      option.dataset = injected
    } else if (Array.isArray(option.dataset)) {
      option.dataset = [injected, ...option.dataset]
    } else {
      option.dataset = [injected, option.dataset]
    }
  }
  if (option.backgroundColor === undefined) {
    option.backgroundColor = 'transparent'
  }
  if (title && option.title === undefined) {
    option.title = { text: title }
  }
  const hasTitle = option.title !== null && typeof option.title === 'object'
  if (hasTitle) {
    const titles = Array.isArray(option.title) ? option.title : [option.title]
    const primary = titles[0]
    if (primary !== null && typeof primary === 'object') {
      const t = primary as Record<string, unknown>
      t.left = 0
      t.top = 0
      t.right = undefined
      t.bottom = undefined
    }
    option.title = titles[0]
  }
  let hasLegend = false
  if (option.legend !== null && typeof option.legend === 'object') {
    const legends = Array.isArray(option.legend) ? option.legend : [option.legend]
    for (const entry of legends) {
      if (entry === null || typeof entry !== 'object') continue
      hasLegend = true
      const l = entry as Record<string, unknown>
      l.top = 2
      l.right = 0
      l.left = undefined
      l.bottom = undefined
      if (l.type === undefined) l.type = 'scroll'
    }
  }
  /** ECharts 6 outer bounds fit both end ticks and axis names; containLabel omits names. */
  const chromeTop = hasTitle || hasLegend ? 48 : horizontalBars ? 24 : 16
  const gridDefaults = {
    top: chromeTop,
    left: 12,
    right: 12,
    bottom: 12,
    outerBounds: { top: chromeTop, left: 12, right: 12, bottom: 12 },
    outerBoundsContain: 'all',
  }
  if (option.grid === undefined) {
    option.grid = gridDefaults
  } else if (Array.isArray(option.grid)) {
    option.grid = option.grid.map((grid) => ({ ...gridDefaults, ...toRecord(grid) }))
  } else if (option.grid !== null && typeof option.grid === 'object') {
    option.grid = { ...gridDefaults, ...option.grid }
  }
  return option
}

/** Label line, its padding above the bar, and the gap before the next row's bar. */
export const ABOVE_BAR_LABEL_SPACE = 28
const LEFT_LABEL_ROW_GAP = 12
const HORIZONTAL_BAR_CHROME_HEIGHT = 72
const MIN_CHART_HEIGHT = 240

/**
 * Horizontal bar charts grow with their rows: each row must fit its bar plus, in the
 * above-bar layout, the category label and a gap before the next bar. Null for other charts.
 */
export function horizontalBarChartHeight(
  option: Record<string, unknown>,
  rowCount: number
): number | null {
  if (!isHorizontalBarOption(option)) return null
  const slots = barSlotWidths(option)
  const gap = barGapPixels(option, Math.max(...slots))
  const barsHeight = Math.max(
    Math.max(...slots),
    slots.reduce((total, width) => total + width, 0) + gap * (slots.length - 1)
  )
  const rowHeight =
    barsHeight + (authorsCategoryLabelColumn(option) ? LEFT_LABEL_ROW_GAP : ABOVE_BAR_LABEL_SPACE)
  return Math.max(MIN_CHART_HEIGHT, HORIZONTAL_BAR_CHROME_HEIGHT + rowCount * rowHeight)
}

/** Rendered options using the above-bar label layout, whose row highlight Sim draws itself. */
export function isAboveBarLabelLayout(option: Record<string, unknown>): boolean {
  if (!isHorizontalBarOption(option)) return false
  const axis = toRecord(Array.isArray(option.yAxis) ? option.yAxis[0] : option.yAxis)
  const axisLabel = toRecord(axis.axisLabel)
  const tooltip = Array.isArray(option.tooltip) ? option.tooltip[0] : option.tooltip
  const pointer = toRecord(toRecord(tooltip).axisPointer)
  return (
    axisLabel.inside === true && axisLabel.verticalAlign === 'bottom' && pointer.type === 'none'
  )
}
