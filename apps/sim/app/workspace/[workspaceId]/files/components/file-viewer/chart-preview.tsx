'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import type { EChartsOption } from 'echarts'
import { useTheme } from 'next-themes'
import { buildChartRenderOption } from '@/lib/charts/option'
import {
  CHART_ROWS_DEFAULT,
  CHART_ROWS_MAX,
  type ChartSpec,
  mapRowsToColumnNames,
  parseChartSpec,
  shapeTableRows,
} from '@/lib/charts/spec'
import { useTable, useTableRowsSample } from '@/hooks/queries/tables'
import { PreviewLoadingFrame } from './preview-shared'

function buildOption(spec: ChartSpec, rows: Array<Record<string, unknown>> | null): EChartsOption {
  return buildChartRenderOption({ title: spec.title, option: spec.option, rows }) as EChartsOption
}

function ChartErrorCard({ message, content }: { message: string; content: string }) {
  return (
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
  )
}

function ChartErrorPanel({ message, content }: { message: string; content: string }) {
  return (
    <div className='min-h-0 flex-1 overflow-auto p-6'>
      <ChartErrorCard message={message} content={content} />
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
    return shapeTableRows(mapRowsToColumnNames(fetched, columns), tableSource)
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
  //
  // A render error (setOption threw) HIDES the chart box rather than
  // unmounting it: the render effect only re-runs when the option changes,
  // and it needs the container mounted at that moment to re-initialize —
  // an unmounted container would leave the fixed chart blank until a
  // second edit.
  return (
    <div className='min-h-0 flex-1 overflow-auto p-6'>
      {renderError !== null && <ChartErrorCard message={renderError} content={content} />}
      <div className={renderError !== null ? 'hidden' : 'relative mx-auto w-full max-w-[1024px]'}>
        {(!echartsLib || waitingOnRows) && (
          <PreviewLoadingFrame className='absolute inset-0 z-10' />
        )}
        <div ref={containerRef} className='aspect-[16/10] min-h-[280px] w-full' />
      </div>
    </div>
  )
})
