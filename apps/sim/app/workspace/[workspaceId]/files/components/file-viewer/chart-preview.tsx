'use client'

import { useMemo } from 'react'
import { cn } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import { EChartsView } from '@/components/charts/echarts-view'
import { buildChartRenderOption, horizontalBarChartHeight } from '@/lib/charts/option'
import {
  CHART_ROWS_DEFAULT,
  CHART_ROWS_MAX,
  mapRowsToColumnNames,
  parseChartSpec,
  shapeTableRows,
} from '@/lib/charts/spec'
import { PreviewLoadingFrame } from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-shared'
import { useTable, useTableRowsSample } from '@/hooks/queries/tables'

const CHART_HEADER_HEIGHT = 24

interface ChartPreviewProps {
  content: string
  workspaceId: string
  isStreaming?: boolean
}

/** Existing chart documents retain their source semantics and share the dashboard canvas theme. */
export function ChartPreview({ content, workspaceId, isStreaming = false }: ChartPreviewProps) {
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

  if (parseError && isStreaming) return <PreviewLoadingFrame className='h-full flex-1' />
  const error =
    parseError ??
    (tableSource && (rowsQuery.isError || tableQuery.isError)
      ? getErrorMessage(rowsQuery.error ?? tableQuery.error, 'Failed to read table')
      : null)
  if (error)
    return (
      <div className='min-h-0 flex-1 overflow-auto p-6'>
        <p role='alert' className='mb-3 text-[var(--text-error)] text-caption'>
          {error}
        </p>
        <pre className='overflow-auto whitespace-pre-wrap font-mono text-[var(--text-body)] text-small'>
          {content}
        </pre>
      </div>
    )
  if (!spec || (tableSource && rows === null))
    return <PreviewLoadingFrame className='h-full flex-1' />
  const yAxis = toRecord(
    Array.isArray(spec.option.yAxis) ? spec.option.yAxis[0] : spec.option.yAxis
  )
  const categories = Array.isArray(yAxis.data) ? yAxis.data.length : (rows?.length ?? 0)
  const barHeight = horizontalBarChartHeight(spec.option, categories)
  /** Title and legend share one chrome row inside this canvas, unlike dashboard panels. */
  const chromeHeight = spec.title || spec.option.legend ? CHART_HEADER_HEIGHT : 0
  return (
    <div className='min-h-0 flex-1 overflow-auto p-6'>
      <div
        className={cn(
          'mx-auto w-full max-w-[1024px]',
          barHeight === null && 'aspect-[16/10] min-h-[280px]'
        )}
        style={barHeight === null ? undefined : { height: barHeight + chromeHeight }}
      >
        <EChartsView
          className='h-full'
          label={spec.title ?? 'Chart'}
          option={buildChartRenderOption({ title: spec.title, option: spec.option, rows })}
        />
      </div>
    </div>
  )
}
