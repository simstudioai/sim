import * as echarts from 'echarts'
import { buildChartRenderOption } from '@/lib/charts/option'
import { registerChartFenceRenderer } from '@/lib/workspace-files/page-compile'

/**
 * Server-side `sim:chart` renderer: ECharts SSR to inline SVG, once per theme.
 * Importing this module registers it with page-compile (side-effect module —
 * import it from every server compile entrypoint). Pages are static documents,
 * so the embed is a styled snapshot; the live interactive artifact remains the
 * `.chart` file, which a page links with `[Name](sim:file/<id>)`.
 */

const CHART_SSR_WIDTH = 860
const CHART_SSR_DEFAULT_HEIGHT = 420
const CHART_SSR_MIN_HEIGHT = 200
const CHART_SSR_MAX_HEIGHT = 800

interface ChartFencePayload {
  option: Record<string, unknown>
  rows?: Array<Record<string, unknown>>
  height?: number
}

function parsePayload(payload: unknown): ChartFencePayload | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  const doc = payload as Record<string, unknown>
  if (doc.option === null || typeof doc.option !== 'object' || Array.isArray(doc.option)) {
    return null
  }
  if (doc.rows !== undefined && !Array.isArray(doc.rows)) return null
  return doc as unknown as ChartFencePayload
}

function renderSvg(
  option: Record<string, unknown>,
  theme: 'light' | 'dark',
  height: number
): string {
  const chart = echarts.init(null, theme === 'dark' ? 'dark' : undefined, {
    renderer: 'svg',
    ssr: true,
    width: CHART_SSR_WIDTH,
    height,
  })
  try {
    chart.setOption(option as Parameters<typeof chart.setOption>[0])
    return chart.renderToSVGString()
  } finally {
    chart.dispose()
  }
}

function renderChartFence(payload: unknown, caption: string): string | null {
  const parsed = parsePayload(payload)
  if (!parsed) return null
  const height = Math.min(
    Math.max(Math.round(parsed.height ?? CHART_SSR_DEFAULT_HEIGHT), CHART_SSR_MIN_HEIGHT),
    CHART_SSR_MAX_HEIGHT
  )
  const option = buildChartRenderOption({ option: parsed.option, rows: parsed.rows ?? null })
  let light: string
  let dark: string
  try {
    light = renderSvg(option, 'light', height)
    dark = renderSvg(option, 'dark', height)
  } catch {
    return null
  }
  const figcaption = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''
  return `<figure class="sim-chart"><div class="sim-chart-light">${light}</div><div class="sim-chart-dark">${dark}</div>${figcaption}</figure>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

registerChartFenceRenderer(renderChartFence)
