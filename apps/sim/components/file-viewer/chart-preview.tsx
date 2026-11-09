'use client'

import { useMemo } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import { ChartCanvas } from '@/components/file-viewer/chart-canvas'
import styles from '@/components/file-viewer/chart-preview.module.css'
import { buildChartRenderOption, horizontalBarChartHeight } from '@/lib/charts/option'
import {
  CHART_ROWS_DEFAULT,
  CHART_ROWS_MAX,
  mapRowsToColumnNames,
  parseChartSpec,
  shapeTableRows,
} from '@/lib/charts/spec'
import { useTable, useTableRowsSample } from '@/hooks/queries/tables'

const CHART_HEADER_HEIGHT = 24

interface ChartPreviewProps {
  content: string
  workspaceId: string
  isStreaming?: boolean
}

/** A chart document: a declarative ECharts spec over static rows or a live table sample. */
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

  if (parseError && isStreaming) return null
  const error =
    parseError ??
    (tableSource && (rowsQuery.isError || tableQuery.isError)
      ? getErrorMessage(rowsQuery.error ?? tableQuery.error, 'Failed to read table')
      : null)
  if (error)
    return (
      <div className={styles.scroller}>
        <p className={styles.error} role='alert' data-type='T052'>
          {error}
        </p>
        <pre className={styles.source} data-type='T014'>
          {content}
        </pre>
      </div>
    )
  if (!spec || (tableSource && rows === null)) return null
  const yAxis = toRecord(
    Array.isArray(spec.option.yAxis) ? spec.option.yAxis[0] : spec.option.yAxis
  )
  const categories = Array.isArray(yAxis.data) ? yAxis.data.length : (rows?.length ?? 0)
  const barHeight = horizontalBarChartHeight(spec.option, categories)
  const chromeHeight = spec.title || spec.option.legend ? CHART_HEADER_HEIGHT : 0
  return (
    <div className={styles.scroller}>
      <ChartCanvas
        label={spec.title ?? 'Chart'}
        height={barHeight === null ? null : barHeight + chromeHeight}
        option={buildChartRenderOption({ title: spec.title, option: spec.option, rows })}
      />
    </div>
  )
}
