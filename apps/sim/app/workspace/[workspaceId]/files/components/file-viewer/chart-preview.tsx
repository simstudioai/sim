'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import type { EChartsOption } from 'echarts'
import { useTheme } from 'next-themes'
import { buildChartRenderOption } from '@/lib/charts/option'
import { getColumnId } from '@/lib/table/column-keys'
import { useTable, useTableRowsSample } from '@/hooks/queries/tables'
import { PreviewLoadingFrame } from './preview-shared'

/** Hard cap on rows a table-backed chart pulls; the spec's `limit` clamps under it. */
const CHART_ROWS_MAX = 5000
const CHART_ROWS_DEFAULT = 1000

type ChartAggregateOp = 'sum' | 'avg' | 'min' | 'max' | 'count'

const CHART_AGGREGATE_OPS = new Set<string>(['sum', 'avg', 'min', 'max', 'count'])

interface ChartTableSource {
  type: 'table'
  tableId: string
  filter?: unknown
  sort?: unknown
  limit?: number
  /** Group rows by these columns; requires `aggregate`. */
  groupBy?: string[]
  /** Metric column → op, computed per group. */
  aggregate?: Record<string, ChartAggregateOp>
  /** Fan the aggregated metric(s) out into one column per distinct value of this column. */
  pivot?: string
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

export function parseChartSpec(content: string): { spec?: ChartSpec; error?: string } {
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
      if (source.groupBy !== undefined) {
        if (!Array.isArray(source.groupBy) || source.groupBy.some((c) => typeof c !== 'string')) {
          return { error: '"groupBy" must be an array of column names' }
        }
        if (source.aggregate === null || typeof source.aggregate !== 'object') {
          return { error: '"groupBy" requires an "aggregate" object ({column: op})' }
        }
        const ops = Object.values(source.aggregate)
        if (ops.length === 0 || ops.some((op) => !CHART_AGGREGATE_OPS.has(String(op)))) {
          return { error: '"aggregate" ops must be sum, avg, min, max, or count' }
        }
      }
      if (source.pivot !== undefined) {
        if (typeof source.pivot !== 'string') return { error: '"pivot" must be a column name' }
        if (!source.groupBy) return { error: '"pivot" requires "groupBy" and "aggregate"' }
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

function aggregateValues(
  rows: Array<Record<string, unknown>>,
  column: string,
  op: ChartAggregateOp
): number {
  if (op === 'count') return rows.length
  const values = rows.map((r) => Number(r[column])).filter((n) => Number.isFinite(n))
  if (values.length === 0) return 0
  switch (op) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0)
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length
    case 'min':
      return Math.min(...values)
    case 'max':
      return Math.max(...values)
  }
}

/**
 * Client-side shaping for table sources: group → aggregate → optionally pivot
 * one column's distinct values into per-value columns. Groups keep first-seen
 * order, so the source's `sort` decides the category order. This is the whole
 * "query engine" — deliberately tiny; anything fancier belongs in a static
 * source with precomputed rows.
 */
export function shapeTableRows(
  rows: Array<Record<string, unknown>>,
  source: ChartTableSource
): Array<Record<string, unknown>> {
  const { groupBy, aggregate, pivot } = source
  if (!groupBy || groupBy.length === 0 || !aggregate) return rows

  const groups = new Map<string, Array<Record<string, unknown>>>()
  for (const row of rows) {
    const key = groupBy.map((c) => String(row[c] ?? '')).join('\u0000')
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  const metrics = Object.entries(aggregate)
  const out: Array<Record<string, unknown>> = []
  for (const bucket of groups.values()) {
    const shaped: Record<string, unknown> = {}
    for (const c of groupBy) shaped[c] = bucket[0][c]
    if (pivot) {
      const byValue = new Map<string, Array<Record<string, unknown>>>()
      for (const row of bucket) {
        const value = String(row[pivot] ?? '')
        const slice = byValue.get(value)
        if (slice) slice.push(row)
        else byValue.set(value, [row])
      }
      for (const [value, slice] of byValue) {
        for (const [column, op] of metrics) {
          const name = metrics.length === 1 ? value : `${value} ${column}`
          shaped[name] = aggregateValues(slice, column, op)
        }
      }
    } else {
      for (const [column, op] of metrics) {
        shaped[column] = aggregateValues(bucket, column, op)
      }
    }
    out.push(shaped)
  }
  return out
}

function buildOption(spec: ChartSpec, rows: Array<Record<string, unknown>> | null): EChartsOption {
  return buildChartRenderOption({ title: spec.title, option: spec.option, rows }) as EChartsOption
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
  const tableQuery = useTable(tableSource ? workspaceId : undefined, tableSource?.tableId)

  const rows = useMemo(() => {
    if (!spec) return null
    if (spec.source?.type === 'static') return spec.source.rows ?? null
    if (!tableSource) return null
    const fetched = rowsQuery.data?.rows
    const columns = tableQuery.data?.schema.columns
    if (!fetched || !columns) return null
    // Row data is stored keyed by column ID (an opaque uuid); chart specs —
    // like the mothership table tool and the public API — speak column NAMES.
    // Remap so `encode`/dimension references in the option match what the
    // author sees in the table UI.
    const nameByStorageKey = new Map<string, string>()
    for (const col of columns) nameByStorageKey.set(getColumnId(col), col.name)
    const named = fetched.map((row) => {
      const out: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(row.data)) {
        out[nameByStorageKey.get(key) ?? key] = value
      }
      return out
    })
    return shapeTableRows(named, tableSource)
  }, [spec, tableSource, rowsQuery.data, tableQuery.data])

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

  if (tableSource && tableQuery.isError) {
    return (
      <ChartErrorPanel
        message={getErrorMessage(tableQuery.error, 'failed to read the table')}
        content={content}
      />
    )
  }

  const waitingOnRows = Boolean(tableSource) && rows === null
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
