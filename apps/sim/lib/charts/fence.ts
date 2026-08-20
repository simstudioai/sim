import { buildChartRenderOption } from '@/lib/charts/option'

/**
 * The `sim:chart` page fence, rendered as PURE markup: the final ECharts
 * option rides inside the figure as JSON, and a single inline hydration
 * script (appended once per page by the server pass or the client preview)
 * boots every figure. That keeps the compiled page self-contained — fully
 * interactive in the app's sandboxed iframe (inline scripts are allowed) and
 * in a downloaded copy, which carries the library and the data with it.
 *
 * Two payload shapes are valid:
 *  - inline: `{ option, rows?, height? }` — data baked into the page.
 *  - reference: `{ file, height? }` — a `.chart` workspace file; emitted as a
 *    marker figure the SERVER pass resolves (reading the file and, for table
 *    sources, the table's CURRENT rows under the viewer's authorization), so
 *    every in-app view is fresh while a download freezes that serve's data.
 */

export const CHART_FENCE_DEFAULT_HEIGHT = 420
const CHART_FENCE_MIN_HEIGHT = 200
const CHART_FENCE_MAX_HEIGHT = 800

export interface ChartFenceInlinePayload {
  option: Record<string, unknown>
  rows?: Array<Record<string, unknown>>
  height?: number
}

function clampHeight(height: unknown): number {
  const parsed = typeof height === 'number' ? Math.round(height) : CHART_FENCE_DEFAULT_HEIGHT
  return Math.min(Math.max(parsed, CHART_FENCE_MIN_HEIGHT), CHART_FENCE_MAX_HEIGHT)
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** A `</script` or `<!--` inside the JSON would terminate/confuse the carrier tag. */
function escapeJsonForScriptTag(json: string): string {
  return json.replace(/</g, '\\u003c')
}

/** Accepts `sim:file/<id>` or a bare file id; returns the bare id. */
function chartFileRef(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null
  const match = value.match(/^(?:sim:file\/)?([A-Za-z0-9-]+)$/)
  return match ? match[1] : null
}

/** The resolved-figure markup: spec JSON carrier + canvas the hydrator fills. */
export function renderResolvedChartFigure(
  payload: ChartFenceInlinePayload,
  caption: string
): string {
  const height = clampHeight(payload.height)
  const option = buildChartRenderOption({ option: payload.option, rows: payload.rows ?? null })
  const spec = escapeJsonForScriptTag(JSON.stringify({ option }))
  const figcaption = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''
  return `<figure class="sim-chart"><script type="application/json" class="sim-chart-spec">${spec}</script><div class="sim-chart-canvas" style="height:${height}px"><div class="sim-chart-placeholder">Chart</div></div>${figcaption}</figure>`
}

/**
 * Renders a `sim:chart` fence payload to figure markup, or null when the
 * payload matches neither valid shape (the compiler reports a diagnostic).
 */
export function renderChartFenceMarkup(payload: unknown, caption: string): string | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  const doc = payload as Record<string, unknown>

  const fileRef = doc.file === undefined ? null : chartFileRef(doc.file)
  if (doc.file !== undefined) {
    if (fileRef === null) return null
    const height = clampHeight(doc.height)
    const figcaption = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''
    return `<figure class="sim-chart" data-sim-chart-file="${escapeHtml(fileRef)}" data-sim-chart-height="${height}" data-sim-chart-caption="${escapeHtml(caption)}"><div class="sim-chart-placeholder">Chart — resolves from the workspace when the page is served</div>${figcaption}</figure>`
  }

  if (doc.option === null || typeof doc.option !== 'object' || Array.isArray(doc.option)) {
    return null
  }
  if (doc.rows !== undefined && !Array.isArray(doc.rows)) return null
  return renderResolvedChartFigure(doc as unknown as ChartFenceInlinePayload, caption)
}

/** Matches the unresolved reference markers emitted for `{"file": ...}` payloads. */
export const CHART_REF_FIGURE_RE =
  /<figure class="sim-chart" data-sim-chart-file="([^"]+)" data-sim-chart-height="(\d+)" data-sim-chart-caption="([^"]*)">[\s\S]*?<\/figure>/g

export function chartUnavailableFigure(reason: string): string {
  return `<figure class="sim-chart"><div class="sim-chart-placeholder">${reason}</div></figure>`
}

export function htmlHasChartFigures(html: string): boolean {
  return html.includes('class="sim-chart"')
}

/**
 * The per-page bootstrap appended after the ECharts library source: hydrates
 * every resolved figure, themed by the page's `data-theme` stamp (falling
 * back to the OS scheme), and follows container resizes.
 */
export const CHART_HYDRATION_SNIPPET = `(() => {
  const stamped = document.documentElement.getAttribute('data-theme')
  const dark = stamped === 'dark' || (stamped !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  for (const figure of document.querySelectorAll('figure.sim-chart')) {
    const specTag = figure.querySelector('script.sim-chart-spec')
    const canvas = figure.querySelector('.sim-chart-canvas')
    if (!specTag || !canvas) continue
    let spec
    try { spec = JSON.parse(specTag.textContent || '') } catch { continue }
    if (!spec || typeof spec.option !== 'object') continue
    canvas.textContent = ''
    const chart = echarts.init(canvas, dark ? 'dark' : undefined)
    try { chart.setOption(spec.option) } catch { chart.dispose(); continue }
    new ResizeObserver(() => chart.resize()).observe(canvas)
  }
})()`
