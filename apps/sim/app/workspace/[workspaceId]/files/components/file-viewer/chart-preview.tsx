'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import type { EChartsOption } from 'echarts'
import { useTheme } from 'next-themes'
import { useTableRowsSample } from '@/hooks/queries/tables'
import { PreviewLoadingFrame } from './preview-shared'

/** Hard cap on rows a table-backed chart pulls; the spec's `limit` clamps under it. */
const CHART_ROWS_MAX = 5000
const CHART_ROWS_DEFAULT = 1000

interface ChartTableSource {
  type: 'table'
  tableId: string
  filter?: unknown
  sort?: unknown
  limit?: number
}

interface ChartStaticSource {
  type: 'static'
  rows?: Array<Record<string, unknown>>
}

/**
 * A `.chart` file (`text/x-sim-chart`): a declarative ECharts document. The
 * `option` is a plain ECharts option object; `source` optionally supplies the
 * data — inline rows, or a live read of a Sim table injected as
 * `option.dataset.source` so the chart stays current with the table.
 */
interface ChartSpec {
  schema_version: number
  title?: string
  source?: ChartStaticSource | ChartTableSource
  option: Record<string, unknown>
}

function parseChartSpec(content: string): { spec?: ChartSpec; error?: string } {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch (e) {
    return { error: getErrorMessage(e, 'not valid JSON') }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'chart document must be a JSON object' }
  }
  const doc = raw as Record<string, unknown>
  if (doc.schema_version !== 1) {
    return { error: 'chart document must declare "schema_version": 1' }
  }
  if (doc.option === null || typeof doc.option !== 'object' || Array.isArray(doc.option)) {
    return { error: 'chart document must declare an "option" object (an ECharts option)' }
  }
  const source = doc.source as ChartSpec['source']
  if (source !== undefined) {
    if (source === null || typeof source !== 'object') {
      return { error: '"source" must be an object' }
    }
    if (source.type === 'table') {
      if (typeof source.tableId !== 'string' || source.tableId === '') {
        return { error: 'a table source must declare "tableId"' }
      }
    } else if (source.type === 'static') {
      if (source.rows !== undefined && !Array.isArray(source.rows)) {
        return { error: 'a static source\'s "rows" must be an array' }
      }
    } else {
      return { error: '"source.type" must be "static" or "table"' }
    }
  }
  return { spec: doc as unknown as ChartSpec }
}

/**
 * Merges the resolved rows into the ECharts option as `dataset.source`. A spec
 * whose option already carries a dataset keeps it (fully self-contained static
 * charts); the file-level `title` fills in only when the option has none.
 */
function buildOption(spec: ChartSpec, rows: Array<Record<string, unknown>> | null): EChartsOption {
  const option = structuredClone(spec.option)
  if (rows && rows.length > 0 && option.dataset === undefined) {
    option.dataset = { source: rows }
  }
  if (option.backgroundColor === undefined) {
    option.backgroundColor = 'transparent'
  }
  if (spec.title && option.title === undefined) {
    option.title = { text: spec.title }
  }
  // Gentle layout defaults — fill in ONLY what the spec leaves unset. A title
  // and a legend both default to the top edge and overlap; when both are
  // present and the legend declares no position, drop it below the title.
  const legend = option.legend
  if (
    option.title !== undefined &&
    legend !== null &&
    typeof legend === 'object' &&
    !Array.isArray(legend)
  ) {
    const positioned = legend as Record<string, unknown>
    if (positioned.top === undefined && positioned.bottom === undefined) {
      positioned.top = 32
    }
  }
  return option as EChartsOption
}

function ChartErrorPanel({ message, content }: { message: string; content: string }) {
  return (
    <div className='min-h-0 flex-1 overflow-auto p-6'>
      <div className='overflow-hidden rounded-lg border border-[var(--border)]'>
        <div className='flex items-center justify-between border-[var(--border)] border-b bg-[var(--surface-3)] px-3 py-1.5'>
          <span className='text-[11px] text-[var(--text-tertiary)]'>chart</span>
          <span className='text-[11px] text-[var(--text-muted)]'>{message}</span>
        </div>
        <div className='code-editor-theme bg-[var(--surface-5)]'>
          <pre className='m-0 overflow-x-auto whitespace-pre p-4 font-mono text-[13px] text-[var(--text-primary)] leading-[1.6]'>
            <code>{content}</code>
          </pre>
        </div>
      </div>
    </div>
  )
}

type EChartsModule = typeof import('echarts')

/**
 * Renders a `.chart` document with ECharts, lazy-loading the (heavy) library
 * on first use. Static sources render inline rows; table sources read the
 * table live through React Query, so the chart reflects the table's current
 * data every time it is opened.
 */
export const ChartPreview = memo(function ChartPreview({
  content,
  workspaceId,
  isStreaming = false,
}: {
  content: string
  workspaceId: string
  isStreaming?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [echartsLib, setEchartsLib] = useState<EChartsModule | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    import('echarts')
      .then((mod) => {
        if (active) setEchartsLib(mod)
      })
      .catch((e) => {
        if (active) setLoadError(getErrorMessage(e, 'failed to load the chart renderer'))
      })
    return () => {
      active = false
    }
  }, [])

  const { spec, error: parseError } = useMemo(() => parseChartSpec(content), [content])

  const tableSource = spec?.source?.type === 'table' ? spec.source : null
  const rowsQuery = useTableRowsSample({
    workspaceId,
    tableId: tableSource?.tableId,
    filter: tableSource?.filter,
    sort: tableSource?.sort,
    limit: Math.min(tableSource?.limit ?? CHART_ROWS_DEFAULT, CHART_ROWS_MAX),
    enabled: Boolean(tableSource),
  })

  const rows = useMemo(() => {
    if (!spec) return null
    if (spec.source?.type === 'static') return spec.source.rows ?? null
    if (tableSource) return rowsQuery.data?.rows.map((row) => row.data) ?? null
    return null
  }, [spec, tableSource, rowsQuery.data])

  const option = useMemo(() => (spec ? buildOption(spec, rows) : null), [spec, rows])
  /** Stable identity for the effect below — option is a fresh object per memo. */
  const optionKey = useMemo(() => (option ? JSON.stringify(option) : ''), [option])

  const { resolvedTheme } = useTheme()

  useEffect(() => {
    setRenderError(null)
    const el = containerRef.current
    if (!el || !echartsLib || !option) return
    const chart = echartsLib.init(el, resolvedTheme === 'dark' ? 'dark' : undefined)
    try {
      chart.setOption(option)
    } catch (e) {
      setRenderError(getErrorMessage(e, 'invalid ECharts option'))
      chart.dispose()
      return
    }
    const resizeObserver = new ResizeObserver(() => chart.resize())
    resizeObserver.observe(el)
    return () => {
      resizeObserver.disconnect()
      chart.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [echartsLib, optionKey, resolvedTheme])

  if (parseError) {
    // A file the agent is still writing is expected to be truncated JSON.
    if (isStreaming) return <PreviewLoadingFrame className='h-full flex-1' />
    return <ChartErrorPanel message={parseError} content={content} />
  }
  if (loadError) return <ChartErrorPanel message={loadError} content={content} />
  if (renderError) return <ChartErrorPanel message={renderError} content={content} />
  if (tableSource && rowsQuery.isError) {
    return (
      <ChartErrorPanel
        message={getErrorMessage(rowsQuery.error, 'failed to read the table')}
        content={content}
      />
    )
  }

  const waitingOnRows = Boolean(tableSource) && !rowsQuery.data
  // Width-driven aspect box, not full-bleed: a chart stretched to the whole
  // panel height is unreadable in a tall resource pane. ECharts follows the
  // box through the ResizeObserver above.
  return (
    <div className='min-h-0 flex-1 overflow-auto p-6'>
      <div className='relative mx-auto w-full max-w-[1024px]'>
        {(!echartsLib || waitingOnRows) && (
          <PreviewLoadingFrame className='absolute inset-0 z-10' />
        )}
        <div ref={containerRef} className='aspect-[16/10] min-h-[280px] w-full' />
      </div>
    </div>
  )
})
