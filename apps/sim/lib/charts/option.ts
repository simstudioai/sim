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

export interface ChartRenderInput {
  title?: string
  option: Record<string, unknown>
  rows?: Array<Record<string, unknown>> | null
}

export function buildChartRenderOption({
  title,
  option: specOption,
  rows,
}: ChartRenderInput): Record<string, unknown> {
  const option = structuredClone(specOption)
  if (rows && rows.length > 0) {
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
  // Reserve a chrome row above the plot. Fill only what the spec left unset
  // inside grid — axis-name insets remain the spec's call.
  const chromeTop = hasTitle || hasLegend ? 48 : 16
  if (option.grid === undefined) {
    option.grid = { top: chromeTop, left: 12, right: 12, bottom: 12, containLabel: true }
  } else if (
    option.grid !== null &&
    typeof option.grid === 'object' &&
    !Array.isArray(option.grid)
  ) {
    const g = option.grid as Record<string, unknown>
    if (g.top === undefined) g.top = chromeTop
    if (g.containLabel === undefined) g.containLabel = true
  }
  return option
}
