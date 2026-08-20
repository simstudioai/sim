import { readFile } from 'node:fs/promises'
import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import {
  CHART_HYDRATION_SNIPPET,
  CHART_REF_FIGURE_RE,
  chartUnavailableFigure,
  htmlHasChartFigures,
  renderResolvedChartFigure,
} from '@/lib/charts/fence'
import { parseChartSpec, shapeTableRows } from '@/lib/charts/spec'
import { queryTableRows } from '@/lib/table/application/rows'
import { getColumnId } from '@/lib/table/column-keys'
import type { SortSpec, TablePredicate } from '@/lib/table/types'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { getFileMetadataById } from '@/lib/uploads/server/metadata'

const logger = createLogger('PageChartHydrate')

/** Charts embedded in a page read at most this many table rows per serve. */
const PAGE_CHART_ROWS_MAX = 5000
const PAGE_CHART_ROWS_DEFAULT = 1000

function unescapeAttr(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/**
 * Resolves a referenced `.chart` file into a hydratable figure: static
 * sources inline their rows; table sources read the table's CURRENT rows
 * under the viewer's authorization — so every in-app serve shows fresh data,
 * and a download freezes exactly what that serve rendered. Failures degrade
 * to a quiet placeholder rather than breaking the page.
 */
async function resolveChartRef(
  fileId: string,
  height: number,
  caption: string,
  options: { workspaceId?: string; principal?: Principal }
): Promise<string> {
  try {
    const metadata = await getFileMetadataById(fileId)
    if (!metadata || (options.workspaceId && metadata.workspaceId !== options.workspaceId)) {
      return chartUnavailableFigure(
        'Chart unavailable: the referenced file is not in this workspace'
      )
    }
    const raw = await downloadFile({ key: metadata.key, context: 'workspace' })
    const { spec, error } = parseChartSpec(raw.toString('utf8'))
    if (!spec) {
      return chartUnavailableFigure(`Chart unavailable: ${error ?? 'invalid chart file'}`)
    }

    let rows: Array<Record<string, unknown>> | undefined
    if (spec.source?.type === 'static') {
      rows = spec.source.rows
    } else if (spec.source?.type === 'table') {
      if (!options.principal) {
        return chartUnavailableFigure('Chart unavailable in this view — open it in the workspace')
      }
      const source = spec.source
      const limit = Math.min(source.limit ?? PAGE_CHART_ROWS_DEFAULT, PAGE_CHART_ROWS_MAX)
      const { table, rows: fetched } = await queryTableRows.execute({
        principal: options.principal,
        input: {
          tableId: source.tableId,
          assertedWorkspaceId: options.workspaceId,
          predicate: source.filter as TablePredicate | undefined,
          sort: source.sort as SortSpec | undefined,
          limit,
        },
      })
      const nameByStorageKey = new Map<string, string>()
      for (const col of table.schema.columns) nameByStorageKey.set(getColumnId(col), col.name)
      const named = fetched.map((row) => {
        const out: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(row.data)) {
          out[nameByStorageKey.get(key) ?? key] = value
        }
        return out
      })
      rows = shapeTableRows(named, source)
    }

    return renderResolvedChartFigure(
      { option: spec.option, rows, height },
      caption || spec.title || ''
    )
  } catch (error) {
    logger.warn('Referenced chart failed to resolve', { fileId, error: String(error) })
    return chartUnavailableFigure('Chart unavailable in this view — open it in the workspace')
  }
}

/** Replaces every `data-sim-chart-file` marker with its resolved figure. */
export async function resolveChartFileRefs(
  html: string,
  options: { workspaceId?: string; principal?: Principal }
): Promise<string> {
  const matches = [...html.matchAll(CHART_REF_FIGURE_RE)]
  if (matches.length === 0) return html
  const replacements = await Promise.all(
    matches.map((match) =>
      resolveChartRef(match[1], Number(match[2]), unescapeAttr(match[3]), options)
    )
  )
  let index = 0
  return html.replace(CHART_REF_FIGURE_RE, () => replacements[index++])
}

let echartsSource: Promise<string> | null = null

/** The minified ECharts runtime, read once from the installed package. */
export function getEChartsRuntimeSource(): Promise<string> {
  echartsSource ??= readFile(require.resolve('echarts/dist/echarts.min.js'), 'utf8')
  return echartsSource
}

/**
 * Appends the chart runtime + hydration bootstrap when the document contains
 * chart figures. Inlined so the page stays self-contained: interactive in the
 * app's sandboxed iframe and in a downloaded copy, with no network access.
 */
export async function injectChartHydration(html: string): Promise<string> {
  if (!htmlHasChartFigures(html)) return html
  const runtime = await getEChartsRuntimeSource()
  const script = `<script>${runtime}\n${CHART_HYDRATION_SNIPPET}</script>`
  if (html.includes('</body>')) {
    return html.replace('</body>', `${script}</body>`)
  }
  return html + script
}
