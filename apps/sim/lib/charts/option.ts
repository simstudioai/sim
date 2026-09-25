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

export function buildChartRenderOption({
  title,
  option: specOption,
  rows,
}: ChartRenderInput): Record<string, unknown> {
  const option = structuredClone(specOption)
  const horizontalBars = isHorizontalBarOption(option)
  if (horizontalBars) {
    const series = Array.isArray(option.series) ? option.series : [option.series]
    const barWidth = Math.max(
      CHART_BAR_MAX_WIDTH,
      ...series.map((entry) => {
        const bar = toRecord(entry)
        const width = bar.barWidth ?? bar.barMaxWidth
        return typeof width === 'number' ? width : CHART_BAR_MAX_WIDTH
      })
    )
    const axis = toRecord(Array.isArray(option.yAxis) ? option.yAxis[0] : option.yAxis)
    axis.axisLabel = {
      inside: true,
      align: 'left',
      verticalAlign: 'bottom',
      margin: 0,
      padding: [0, 0, barWidth / 2 + 8, 0],
      ...toRecord(axis.axisLabel),
    }
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
