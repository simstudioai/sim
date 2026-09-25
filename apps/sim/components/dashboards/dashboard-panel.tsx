'use client'

import {
  Chip,
  cn,
  DashboardMetric,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@sim/emcn'
import { EChartsView } from '@/components/charts/echarts-view'
import { TimeSeriesChart } from '@/components/charts/time-series-chart'
import { useDashboardInteractions } from '@/components/dashboards/dashboard-interactions'
import type { QueryTableAnalyticsResponse } from '@/lib/api/contracts/table-analytics'
import { buildChartRenderOption, isHorizontalBarOption } from '@/lib/charts/option'
import { isTimeSeriesOption } from '@/lib/charts/time-series'
import {
  type DashboardDataBlock,
  type DashboardSource,
  dashboardSelection,
  resolveDashboardSource,
} from '@/lib/dashboards/spec'
import {
  type DashboardTimeRange,
  dashboardTimeLabel,
  relativeDashboardRange,
} from '@/lib/dashboards/time'
import { useTableAnalytics } from '@/hooks/queries/table-analytics'

interface DashboardPanelProps {
  block: DashboardDataBlock
  defaults?: DashboardSource
  workspaceId: string
  range: DashboardTimeRange
  now: number
}

function displayValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return typeof value === 'number'
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : String(value)
}

interface ResultsTableProps {
  data: QueryTableAnalyticsResponse
  timeField: string
  timeZone: string
}
function ResultsTable({ data, timeField, timeZone }: ResultsTableProps) {
  return (
    <div className='h-full overflow-auto'>
      <Table>
        <TableHeader>
          <TableRow>
            {data.columns.map((column) => (
              <TableHead key={column}>{data.columnLabels[column]}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((row, index) => (
            <TableRow key={index}>
              {data.columns.map((column) => (
                <TableCell
                  key={column}
                  className='max-w-[420px] whitespace-pre-wrap break-words align-top'
                >
                  {typeof row[column] === 'string' &&
                  [timeField, 'createdAt', 'updatedAt'].includes(column)
                    ? dashboardTimeLabel(row[column], timeZone)
                    : displayValue(row[column])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function DashboardPanel({ block, defaults, workspaceId, range, now }: DashboardPanelProps) {
  const interactions = useDashboardInteractions()
  const source = resolveDashboardSource(defaults, block.source)
  const panelRange = source.range ? relativeDashboardRange(source.range, now) : range
  const horizontalBars = 'chart' in block && isHorizontalBarOption(block.option)
  const timeSeries = 'chart' in block && isTimeSeriesOption(block.option)
  const query = useTableAnalytics({
    tableId: source.tableId,
    body: {
      workspaceId,
      query: {
        ...dashboardSelection(source),
        ...panelRange,
      },
    },
  })
  const title = 'stat' in block ? block.stat : 'chart' in block ? block.chart : block.table
  const data = query.data
  const metric = data?.rows[0]?.[data.columns[0]]
  const metricOperation = source.aggregate && Object.values(source.aggregate)[0]?.op
  const option =
    'chart' in block && data
      ? buildChartRenderOption({
          option: { useUTC: true, ...block.option },
          rows: data.rows,
        })
      : null
  const times =
    timeSeries && data
      ? data.rows
          .map((row) => row[source.timeField ?? 'createdAt'])
          .filter((value): value is string => typeof value === 'string')
          .map(Date.parse)
          .filter(Number.isFinite)
      : []
  return (
    <section aria-label={title} aria-busy={query.isFetching} className='relative h-full min-w-0'>
      {query.isFetching && !query.isPending && !query.isError && (
        <span role='status' className='sr-only'>
          Updating…
        </span>
      )}
      {'stat' in block ? (
        <DashboardMetric
          size='large'
          animated
          maximumFractionDigits={
            metricOperation === 'count' || metricOperation === 'countDistinct' ? 0 : 2
          }
          label={title}
          value={
            query.isError
              ? 'Unavailable'
              : typeof metric === 'number'
                ? metric
                : displayValue(metric)
          }
          unit={!query.isError && metric != null ? block.unit : undefined}
          loading={query.isPending}
        />
      ) : (
        <h2
          className={cn(
            '@min-[1000px]/dashboard:text-[24px] text-[20px] text-[var(--text-primary)] leading-tight tracking-[-0.02em]',
            timeSeries ? 'mb-3' : 'mb-5'
          )}
        >
          {title}
        </h2>
      )}
      {source.range && (
        <p className='mt-1 mb-2 text-[var(--text-muted)] text-xs'>
          Last {source.range} · panel override
        </p>
      )}
      <div
        className={cn(
          !('stat' in block) &&
            ('chart' in block
              ? timeSeries
                ? 'relative h-[280px]'
                : horizontalBars
                  ? 'relative h-[360px]'
                  : 'relative h-[240px]'
              : 'relative h-[400px]')
        )}
      >
        {query.isError ? (
          <div
            role='alert'
            className='flex h-full flex-wrap items-center justify-center gap-2 text-[var(--text-error)] text-caption'
          >
            <span>{query.error.message}</span>
            <Chip onClick={() => void query.refetch()}>Retry</Chip>
          </div>
        ) : query.isPending ? (
          !('stat' in block) && (
            <div
              role='status'
              className='grid h-full place-items-center text-[var(--text-muted)] text-caption'
            >
              Loading data…
            </div>
          )
        ) : (
          data &&
          !('stat' in block) &&
          ('chart' in block ? (
            <>
              {timeSeries ? (
                <TimeSeriesChart
                  {...interactions}
                  label={title}
                  option={option!}
                  range={data.queryRange}
                  columnLabels={data.columnLabels}
                  firstTime={times.length ? Math.min(...times) : null}
                  onZoom={!source.range && !query.isFetching ? interactions.onZoom : undefined}
                />
              ) : (
                <EChartsView
                  label={title}
                  className={horizontalBars ? 'h-[360px]' : 'h-[240px]'}
                  option={option!}
                />
              )}
              {data.rows.length === 0 && (
                <p className='absolute inset-0 grid place-items-center bg-[var(--bg)] text-[var(--text-muted)] text-caption'>
                  No data in this time range
                </p>
              )}
            </>
          ) : data.rows.length === 0 ? (
            <p className='grid h-full place-items-center text-[var(--text-muted)] text-caption'>
              No data in this time range
            </p>
          ) : (
            <ResultsTable
              data={data}
              timeField={source.timeField ?? 'createdAt'}
              timeZone={interactions.timeZone}
            />
          ))
        )}
      </div>
      {!('stat' in block) && (
        <div className='mt-2 min-h-4'>
          {data?.truncated && !query.isError && (
            <p className='text-[var(--text-muted)] text-xs'>
              Showing the first {data.rows.length} {source.aggregate ? 'groups' : 'rows'} in the
              selected sort order.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
