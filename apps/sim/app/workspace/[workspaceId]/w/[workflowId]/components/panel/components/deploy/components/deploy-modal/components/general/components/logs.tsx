'use client'

import { useMemo } from 'react'
import { formatDateTime, formatDuration } from '@sim/utils/formatting'
import clsx from 'clsx'
import { useParams, useRouter } from 'next/navigation'
import { Skeleton } from '@/components/emcn'
import type { WorkflowLogSummary } from '@/lib/api/contracts/logs'
import { type LogFilters, useLogsList } from '@/hooks/queries/logs'
import {
  getDisplayStatus,
  StatusBadge,
  TriggerBadge,
} from '@/app/workspace/[workspaceId]/logs/utils'

const HEADER_TEXT_CLASS = 'font-medium text-[var(--text-tertiary)] text-caption'
const ROW_TEXT_CLASS = 'font-medium text-[var(--text-primary)] text-caption'
const COLUMN_BASE_CLASS = 'flex-shrink-0'

const COLUMN_WIDTHS = {
  STATUS: 'w-[100px]',
  TRIGGER: 'w-[120px]',
  DURATION: 'w-[80px]',
  TIMESTAMP: 'flex-1',
} as const

const LOGS_LIMIT = 5 as const

const BASE_FILTERS = {
  timeRange: 'All time',
  level: 'all',
  folderIds: [] as string[],
  triggers: [] as string[],
  searchQuery: '',
  limit: LOGS_LIMIT,
  sortBy: 'date',
  sortOrder: 'desc',
} as const satisfies Omit<LogFilters, 'workflowIds'>

interface LogsProps {
  workflowId: string | null
}

/**
 * Displays the latest workflow runs inside the deploy modal.
 * Clicking a row opens that execution in the Logs page.
 */
export function Logs({ workflowId }: LogsProps) {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params?.workspaceId as string | undefined

  const filters = useMemo<LogFilters>(
    () => ({ ...BASE_FILTERS, workflowIds: workflowId ? [workflowId] : [] }),
    [workflowId]
  )

  const { data, isLoading } = useLogsList(workspaceId, filters, {
    enabled: Boolean(workflowId) && Boolean(workspaceId),
  })

  const logs = useMemo<WorkflowLogSummary[]>(
    () => (data?.pages?.[0]?.logs ?? []).slice(0, LOGS_LIMIT),
    [data]
  )

  const handleRowClick = (log: WorkflowLogSummary) => {
    if (!workspaceId || !log.executionId) return
    router.push(`/workspace/${workspaceId}/logs?executionId=${log.executionId}`)
  }

  if (isLoading && logs.length === 0) {
    return (
      <div className='overflow-hidden rounded-sm border border-[var(--border)]'>
        <div className='flex h-[30px] items-center bg-[var(--surface-1)] px-4'>
          <div className={clsx(COLUMN_WIDTHS.STATUS, COLUMN_BASE_CLASS)}>
            <Skeleton className='h-[12px] w-[44px]' />
          </div>
          <div className={clsx(COLUMN_WIDTHS.TRIGGER, COLUMN_BASE_CLASS)}>
            <Skeleton className='h-[12px] w-[52px]' />
          </div>
          <div className={clsx(COLUMN_WIDTHS.DURATION, COLUMN_BASE_CLASS)}>
            <Skeleton className='h-[12px] w-[56px]' />
          </div>
          <div className={clsx(COLUMN_WIDTHS.TIMESTAMP, 'min-w-0')}>
            <Skeleton className='h-[12px] w-[68px]' />
          </div>
        </div>
        <div className='bg-[var(--surface-2)]'>
          {[0, 1, 2].map((i) => (
            <div key={i} className='flex h-[36px] items-center px-4'>
              <div className={clsx(COLUMN_WIDTHS.STATUS, COLUMN_BASE_CLASS, 'min-w-0 pr-2')}>
                <Skeleton className='h-[18px] w-[60px] rounded-sm' />
              </div>
              <div className={clsx(COLUMN_WIDTHS.TRIGGER, COLUMN_BASE_CLASS, 'min-w-0 pr-2')}>
                <Skeleton className='h-[18px] w-[70px] rounded-sm' />
              </div>
              <div className={clsx(COLUMN_WIDTHS.DURATION, COLUMN_BASE_CLASS, 'min-w-0 pr-2')}>
                <Skeleton className='h-[12px] w-[48px]' />
              </div>
              <div className={clsx(COLUMN_WIDTHS.TIMESTAMP, 'min-w-0')}>
                <Skeleton className='h-[12px] w-[160px]' />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <div className='flex h-[80px] items-center justify-center rounded-sm border border-[var(--border)] text-[var(--text-placeholder)] text-small'>
        No runs yet
      </div>
    )
  }

  return (
    <div className='overflow-hidden rounded-sm border border-[var(--border)]'>
      <div className='flex h-[30px] items-center bg-[var(--surface-1)] px-4'>
        <div className={clsx(COLUMN_WIDTHS.STATUS, COLUMN_BASE_CLASS)}>
          <span className={HEADER_TEXT_CLASS}>Status</span>
        </div>
        <div className={clsx(COLUMN_WIDTHS.TRIGGER, COLUMN_BASE_CLASS)}>
          <span className={HEADER_TEXT_CLASS}>Trigger</span>
        </div>
        <div className={clsx(COLUMN_WIDTHS.DURATION, COLUMN_BASE_CLASS)}>
          <span className={HEADER_TEXT_CLASS}>Duration</span>
        </div>
        <div className={clsx(COLUMN_WIDTHS.TIMESTAMP, 'min-w-0')}>
          <span className={HEADER_TEXT_CLASS}>Timestamp</span>
        </div>
      </div>

      <div className='bg-[var(--surface-2)]'>
        {logs.map((log) => {
          const isClickable = Boolean(log.executionId && workspaceId)
          return (
            <div
              key={log.id}
              className={clsx(
                'flex h-[36px] items-center px-4 transition-colors duration-100',
                isClickable
                  ? 'cursor-pointer hover-hover:bg-[var(--surface-6)] dark:hover-hover:bg-[var(--border)]'
                  : 'cursor-default'
              )}
              onClick={isClickable ? () => handleRowClick(log) : undefined}
            >
              <div className={clsx(COLUMN_WIDTHS.STATUS, COLUMN_BASE_CLASS, 'min-w-0 pr-2')}>
                <StatusBadge status={getDisplayStatus(log.status)} />
              </div>

              <div className={clsx(COLUMN_WIDTHS.TRIGGER, COLUMN_BASE_CLASS, 'min-w-0 pr-2')}>
                {log.trigger ? (
                  <TriggerBadge trigger={log.trigger} />
                ) : (
                  <span className={ROW_TEXT_CLASS}>—</span>
                )}
              </div>

              <div className={clsx(COLUMN_WIDTHS.DURATION, COLUMN_BASE_CLASS, 'min-w-0 pr-2')}>
                <span
                  className={clsx('block truncate text-[var(--text-tertiary)]', ROW_TEXT_CLASS)}
                >
                  {formatDuration(log.duration, { precision: 2 }) || '—'}
                </span>
              </div>

              <div className={clsx(COLUMN_WIDTHS.TIMESTAMP, 'min-w-0')}>
                <span
                  className={clsx('block truncate text-[var(--text-tertiary)]', ROW_TEXT_CLASS)}
                >
                  {formatDateTime(new Date(log.createdAt))}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
