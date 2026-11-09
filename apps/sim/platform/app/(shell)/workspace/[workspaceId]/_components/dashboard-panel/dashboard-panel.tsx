'use client'

import { type ReactNode, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { MetricGroup } from '@sim/emcn/data-display'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/_components/dashboard-panel/dashboard-panel.module.css'
import { ChartCanvas } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/file-preview/chart-canvas'
import { DataTable } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/file-preview/data-table'
import {
  bindTimeSeriesInteractions,
  type ChartAnnotations,
  type ChartHighlight,
  type ChartReadout,
  type DashboardCursorStore,
  type DashboardDataBlock,
  type DashboardSource,
  type DashboardTimeRange,
  dashboardSelection,
  dashboardTimeLabel,
  formatChartValue,
  isTimeSeriesOption,
  type QueryTableAnalyticsResponse,
  relativeDashboardRange,
  resolveDashboardSource,
  useTableAnalytics,
} from '@/platform/lib/data/files/dashboards'
import { buildChartRenderOption, horizontalBarChartHeight } from '@/platform/lib/data/files/preview'

const CHART_HEIGHT = 240

/** A dashboard's panels and rows, top to bottom. */
export function DashboardStack({ children }: { children: ReactNode }) {
  return <div className={styles.rows}>{children}</div>
}

interface DashboardRowProps {
  cells: readonly { key: string; flex: number; content: ReactNode }[]
  /** A row of stats only, which packs its cells closer. */
  metrics: boolean
}

/** Panels side by side, sharing the row by their `flex` weights and wrapping when narrow. */
export function DashboardRow({ cells, metrics }: DashboardRowProps) {
  return (
    <div className={styles.row} data-metrics={metrics || undefined}>
      {cells.map((cell) => (
        <div key={cell.key} className={styles.cell} data-flex={cell.flex}>
          {cell.content}
        </div>
      ))}
    </div>
  )
}

interface TimeSeriesPanelProps {
  label: string
  option: Record<string, unknown>
  annotations?: ChartAnnotations
  data: QueryTableAnalyticsResponse & { queryRange: DashboardTimeRange }
  firstTime: number | null
  cursorStore: DashboardCursorStore
  timeZone: string
  onZoom?: (range: DashboardTimeRange) => void
}

/**
 * A time-series chart with the values under the pointer read out above it. Pointers stay in step
 * across the embed's charts, and dragging across one zooms the whole embed to that span.
 */
function TimeSeriesPanel({
  label,
  option,
  annotations,
  data,
  firstTime,
  cursorStore,
  timeZone,
  onZoom,
}: TimeSeriesPanelProps) {
  const valuesRef = useScrollEdges<HTMLDivElement>('horizontal')
  const [readout, setReadout] = useState<ChartReadout | null>(null)
  const hasValues = Boolean(readout?.values.length)
  const config = {
    range: data.queryRange,
    timeZone,
    cursorStore,
    columnLabels: data.columnLabels,
    firstTime,
    onZoom,
  }
  return (
    <div className={styles.series}>
      <div
        className={styles.readout}
        role={hasValues ? 'group' : undefined}
        aria-label={hasValues ? `${label} values` : undefined}
        data-type='T060'
      >
        <div ref={valuesRef} className={styles.readoutValues}>
          {readout?.values.map((entry, index) => (
            <span key={index} className={styles.readoutValue}>
              <svg
                viewBox='0 0 8 8'
                className={styles.swatch}
                aria-label={`${entry.name} series color`}
                role='img'
              >
                <circle cx='4' cy='4' r='3' fill={entry.color ?? 'currentColor'} />
              </svg>
              <span className={styles.secondary}>{entry.name}:</span>
              <span>{entry.value}</span>
              {entry.summary && <span className={styles.muted}>{entry.summary}</span>}
            </span>
          ))}
        </div>
        {readout?.time != null && (
          <span className={styles.muted}>{dashboardTimeLabel(readout.time, timeZone)}</span>
        )}
      </div>
      <ChartCanvas
        label={label}
        option={option}
        annotations={annotations}
        height={CHART_HEIGHT}
        revision={JSON.stringify({
          ...config.range,
          timeZone,
          zoomEnabled: Boolean(onZoom),
          columnLabels: config.columnLabels,
          firstTime,
        })}
        createController={(chart) =>
          bindTimeSeriesInteractions(chart, {
            ...config,
            onReadout: (next) =>
              setReadout((previous) =>
                JSON.stringify(previous) === JSON.stringify(next) ? previous : next
              ),
          })
        }
      />
    </div>
  )
}

function ResultsTable({
  data,
  timeField,
  timeZone,
}: {
  data: QueryTableAnalyticsResponse
  timeField: string
  timeZone: string
}) {
  const scrollRef = useScrollEdges<HTMLDivElement>('vertical')
  return (
    <div ref={scrollRef} className={styles.results}>
      <DataTable
        headers={data.columns.map((column) => data.columnLabels[column] ?? column)}
        rows={data.rows.map((row) =>
          data.columns.map((column) => {
            const value = row[column]
            return typeof value === 'string' &&
              [timeField, 'createdAt', 'updatedAt'].includes(column)
              ? dashboardTimeLabel(value, timeZone)
              : formatChartValue(value)
          })
        )}
      />
    </div>
  )
}

interface DashboardPanelProps {
  block: DashboardDataBlock
  defaults?: DashboardSource
  workspaceId: string
  range: DashboardTimeRange
  now: number
  /** Drawn on time-series charts only. */
  highlights?: ChartHighlight[]
  cursorStore: DashboardCursorStore
  timeZone: string
  onZoom: (range: DashboardTimeRange) => void
}

/** One stat, chart or table of a dashboard fence, read from its table for the embed's range. */
export function DashboardPanel({
  block,
  defaults,
  workspaceId,
  range,
  now,
  highlights,
  cursorStore,
  timeZone,
  onZoom,
}: DashboardPanelProps) {
  const source = resolveDashboardSource(defaults, block.source)
  const panelRange = source.range ? relativeDashboardRange(source.range, now) : range
  const timeSeries = 'chart' in block && isTimeSeriesOption(block.option)
  const query = useTableAnalytics({
    tableId: source.tableId,
    body: { workspaceId, query: { ...dashboardSelection(source), ...panelRange } },
    refreshedAt: now,
  })
  const title = 'stat' in block ? block.stat : 'chart' in block ? block.chart : block.table
  const data = query.data
  const timeField = source.timeField ?? 'createdAt'

  if ('stat' in block) {
    const metric = data?.rows[0]?.[data.columns[0]]
    if (query.isPending && !query.isError) return null
    const value = query.isError
      ? 'Unavailable'
      : `${formatChartValue(metric)}${metric != null && block.unit ? ` ${block.unit}` : ''}`
    return (
      <section aria-label={title} aria-busy={query.isFetching} className={styles.panel}>
        <MetricGroup metrics={[{ label: title, value }]} />
      </section>
    )
  }

  const option =
    'chart' in block && data
      ? buildChartRenderOption({ option: { useUTC: true, ...block.option }, rows: data.rows })
      : null
  const annotations: ChartAnnotations | undefined =
    'chart' in block && ((timeSeries && highlights) || block.thresholds)
      ? { highlights: timeSeries ? highlights : undefined, thresholds: block.thresholds }
      : undefined
  const barHeight =
    'chart' in block ? horizontalBarChartHeight(block.option, data?.rows.length ?? 10) : null
  const times =
    timeSeries && data
      ? data.rows
          .map((row) => row[timeField])
          .filter((value): value is string => typeof value === 'string')
          .map(Date.parse)
          .filter(Number.isFinite)
      : []

  return (
    <section aria-label={title} aria-busy={query.isFetching} className={styles.panel}>
      <p className={styles.panelTitle} data-type='T060'>
        {title}
      </p>
      {source.range && (
        <p className={styles.muted} data-type='T052'>
          {`Last ${source.range} · panel override`}
        </p>
      )}
      {query.isError ? (
        <div className={styles.panelError} role='alert' data-type='T052'>
          <span>{query.error.message}</span>
          <Button variant='quiet' size='compact' onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : data && option ? (
        <div className={styles.chart}>
          {timeSeries ? (
            <TimeSeriesPanel
              label={title}
              option={option}
              annotations={annotations}
              data={data}
              firstTime={times.length ? Math.min(...times) : null}
              cursorStore={cursorStore}
              timeZone={timeZone}
              onZoom={!source.range && !query.isFetching ? onZoom : undefined}
            />
          ) : (
            <ChartCanvas
              label={title}
              option={option}
              annotations={annotations}
              height={barHeight ?? CHART_HEIGHT}
            />
          )}
          {data.rows.length === 0 && (
            <p className={styles.empty} data-type='T052'>
              No data in this time range
            </p>
          )}
        </div>
      ) : data ? (
        data.rows.length === 0 ? (
          <p className={styles.emptyTable} data-type='T052'>
            No data in this time range
          </p>
        ) : (
          <ResultsTable data={data} timeField={timeField} timeZone={timeZone} />
        )
      ) : null}
      {data?.truncated && !query.isError && (
        <p className={styles.muted} data-type='T052'>
          {`Showing the first ${data.rows.length} ${source.aggregate ? 'groups' : 'rows'} in the selected sort order.`}
        </p>
      )}
    </section>
  )
}
