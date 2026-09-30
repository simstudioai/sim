'use client'

import { type ReactNode, useMemo, useState } from 'react'
import { Chip, DashboardMetric, LineChart, Loader } from '@sim/emcn'
import Link from 'next/link'
import type { Project } from '@/app/playground/org/lib/project'
import { workspaceRoutes } from '@/app/playground/org/lib/routes'
import { formatLatency } from '@/app/workspace/[workspaceId]/logs/utils'
import { useDashboardStats } from '@/hooks/queries/logs'
import type { TimeRange } from '@/stores/logs/filters/types'

const RANGES: { id: TimeRange; label: string }[] = [
  { id: 'Past 24 hours', label: '24h' },
  { id: 'Past 7 days', label: '7d' },
  { id: 'Past 30 days', label: '30d' },
]

interface RunsDashboardProps {
  project: Project
  title: ReactNode
}

/** Runs, errors and latency for every workflow in the project, from the workspace's execution stats. */
export function RunsDashboard({ project, title }: RunsDashboardProps) {
  const [range, setRange] = useState<TimeRange>('Past 7 days')
  const { data, isPending, error } = useDashboardStats(project.id, {
    timeRange: range,
    level: 'all',
    workflowIds: [],
    folderIds: [],
    triggers: [],
    searchQuery: '',
  })

  const series = useMemo(() => {
    const segments = data?.aggregateSegments ?? []
    return {
      runs: segments.map((segment) => ({
        timestamp: segment.timestamp,
        value: segment.totalExecutions,
      })),
      errors: segments.map((segment) => ({
        timestamp: segment.timestamp,
        value: segment.totalExecutions - segment.successfulExecutions,
      })),
    }
  }, [data])

  const successRate =
    data && data.totalRuns > 0
      ? Math.round(((data.totalRuns - data.totalErrors) / data.totalRuns) * 100)
      : null
  const workflows = [...(data?.workflows ?? [])].sort(
    (a, b) => b.totalExecutions - a.totalExecutions
  )

  return (
    <div className='@container/dashboard h-full overflow-y-auto'>
      <div className='mx-auto flex max-w-[1200px] flex-col gap-6 px-6 py-6'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          {title}
          <div className='flex items-center gap-1'>
            {RANGES.map((option) => (
              <Chip
                key={option.id}
                active={range === option.id}
                onClick={() => setRange(option.id)}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        </div>

        {error ? (
          <p className='text-[var(--text-error)] text-small'>{error.message}</p>
        ) : (
          <>
            <div className='grid @min-[800px]/dashboard:grid-cols-4 grid-cols-2 gap-3'>
              <Tile label='Runs' value={data?.totalRuns ?? 0} loading={isPending} />
              <Tile label='Errors' value={data?.totalErrors ?? 0} loading={isPending} />
              <Tile
                label='Success rate'
                value={successRate ?? '—'}
                unit={successRate === null ? undefined : '%'}
                loading={isPending}
              />
              <Tile
                label='Avg latency'
                value={data ? formatLatency(data.avgLatency) : '—'}
                loading={isPending}
              />
            </div>

            <div className='grid @min-[800px]/dashboard:grid-cols-2 grid-cols-1 gap-3'>
              <ChartCard label='Runs' count={data?.totalRuns} loading={isPending}>
                <LineChart data={series.runs} label='' color='var(--success)' unit='' />
              </ChartCard>
              <ChartCard label='Errors' count={data?.totalErrors} loading={isPending}>
                <LineChart data={series.errors} label='' color='var(--text-error)' unit='' />
              </ChartCard>
            </div>

            <section className='flex flex-col overflow-hidden rounded-md bg-[var(--surface-2)]'>
              <div className='flex items-center justify-between bg-[var(--surface-3)] px-4 py-[9px]'>
                <span className='text-[var(--text-primary)] text-sm'>Workflows</span>
                <span className='text-[var(--text-secondary)] text-sm'>{workflows.length}</span>
              </div>
              {isPending ? (
                <div className='flex h-[80px] items-center justify-center'>
                  <Loader className='size-[16px] text-[var(--text-secondary)]' animate />
                </div>
              ) : workflows.length === 0 ? (
                <p className='px-4 py-6 text-[var(--text-muted)] text-small'>
                  No runs in this period.
                </p>
              ) : (
                <ul className='flex flex-col'>
                  {workflows.map((workflow) => (
                    <li
                      key={workflow.workflowId}
                      className='flex items-center gap-4 border-[var(--border)] border-t px-4 py-2.5 text-small first:border-t-0'
                    >
                      <Link
                        href={workspaceRoutes.workflow(project.id, workflow.workflowId)}
                        className='min-w-0 flex-1 truncate text-[var(--text-body)] hover-hover:underline'
                      >
                        {workflow.workflowName}
                      </Link>
                      <span className='w-[90px] text-right text-[var(--text-muted)]'>
                        {workflow.totalExecutions.toLocaleString()} runs
                      </span>
                      <span className='w-[90px] text-right text-[var(--text-muted)]'>
                        {(workflow.totalExecutions - workflow.totalSuccessful).toLocaleString()}{' '}
                        errors
                      </span>
                      <span className='w-[70px] text-right text-[var(--text-body)]'>
                        {Math.round(workflow.overallSuccessRate)}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

interface TileProps {
  label: string
  value: string | number
  unit?: string
  loading: boolean
}

function Tile({ label, value, unit, loading }: TileProps) {
  return (
    <div className='rounded-md bg-[var(--surface-2)] px-4 py-3'>
      <DashboardMetric label={label} value={value} unit={unit} loading={loading} />
    </div>
  )
}

interface ChartCardProps {
  label: string
  count?: number
  loading: boolean
  children: ReactNode
}

function ChartCard({ label, count, loading, children }: ChartCardProps) {
  return (
    <div className='flex flex-col overflow-hidden rounded-md bg-[var(--surface-2)]'>
      <div className='flex items-center justify-between bg-[var(--surface-3)] px-4 py-[9px]'>
        <span className='text-[var(--text-primary)] text-sm'>{label}</span>
        {count !== undefined && (
          <span className='text-[var(--text-secondary)] text-sm'>{count.toLocaleString()}</span>
        )}
      </div>
      <div className='px-3.5 py-2.5'>
        {loading ? (
          <div className='flex h-[166px] items-center justify-center'>
            <Loader className='size-[16px] text-[var(--text-secondary)]' animate />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
