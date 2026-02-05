'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { List, type RowComponentProps, useListRef } from 'react-window'
import { Badge, buttonVariants } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { formatDuration } from '@/lib/core/utils/formatting'
import {
  DELETED_WORKFLOW_COLOR,
  DELETED_WORKFLOW_LABEL,
  formatDate,
  getDisplayStatus,
  LOG_COLUMNS,
  StatusBadge,
  TriggerBadge,
} from '@/app/workspace/[workspaceId]/logs/utils'
import type { WorkflowLog } from '@/stores/logs/filters/types'

const LOG_ROW_HEIGHT = 44 as const

interface LogRowProps {
  log: WorkflowLog
  isSelected: boolean
  onClick: (log: WorkflowLog) => void
  onContextMenu?: (e: React.MouseEvent, log: WorkflowLog) => void
  selectedRowRef: React.RefObject<HTMLTableRowElement | null> | null
}

/**
 * Memoized log row component to prevent unnecessary re-renders.
 * Uses shallow comparison for the log object.
 */
const LogRow = memo(
  function LogRow({ log, isSelected, onClick, onContextMenu, selectedRowRef }: LogRowProps) {
    const formattedDate = useMemo(() => formatDate(log.createdAt), [log.createdAt])
    const isDeletedWorkflow = !log.workflow?.id && !log.workflowId
    const workflowName = isDeletedWorkflow
      ? DELETED_WORKFLOW_LABEL
      : log.workflow?.name || 'Unknown'
    const workflowColor = isDeletedWorkflow ? DELETED_WORKFLOW_COLOR : log.workflow?.color

    const handleClick = useCallback(() => onClick(log), [onClick, log])

    const handleContextMenu = useCallback(
      (e: React.MouseEvent) => {
        if (onContextMenu) {
          e.preventDefault()
          onContextMenu(e, log)
        }
      },
      [onContextMenu, log]
    )

    return (
      <div
        ref={isSelected ? selectedRowRef : null}
        className={cn(
          'relative flex h-[44px] cursor-pointer items-center px-[24px] hover:bg-[var(--surface-3)] dark:hover:bg-[var(--surface-4)]',
          isSelected && 'bg-[var(--surface-3)] dark:bg-[var(--surface-4)]'
        )}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <div className='flex flex-1 items-center'>
          <span
            className={`${LOG_COLUMNS.date.width} ${LOG_COLUMNS.date.minWidth} font-medium text-[12px] text-[var(--text-primary)]`}
          >
            {formattedDate.compactDate}
          </span>

          <span
            className={`${LOG_COLUMNS.time.width} ${LOG_COLUMNS.time.minWidth} font-medium text-[12px] text-[var(--text-primary)]`}
          >
            {formattedDate.compactTime}
          </span>

          <div className={`${LOG_COLUMNS.status.width} ${LOG_COLUMNS.status.minWidth}`}>
            <StatusBadge status={getDisplayStatus(log.status)} />
          </div>

          <div
            className={`flex ${LOG_COLUMNS.workflow.width} ${LOG_COLUMNS.workflow.minWidth} items-center gap-[8px] pr-[8px]`}
          >
            <div
              className='h-[10px] w-[10px] flex-shrink-0 rounded-[3px]'
              style={{ backgroundColor: workflowColor }}
            />
            <span
              className={cn(
                'min-w-0 truncate font-medium text-[12px]',
                isDeletedWorkflow ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'
              )}
            >
              {workflowName}
            </span>
          </div>

          <span
            className={`${LOG_COLUMNS.cost.width} ${LOG_COLUMNS.cost.minWidth} font-medium text-[12px] text-[var(--text-primary)]`}
          >
            {typeof log.cost?.total === 'number' ? `$${log.cost.total.toFixed(4)}` : '—'}
          </span>

          <div className={`${LOG_COLUMNS.trigger.width} ${LOG_COLUMNS.trigger.minWidth}`}>
            {log.trigger ? (
              <TriggerBadge trigger={log.trigger} />
            ) : (
              <span className='font-medium text-[12px] text-[var(--text-primary)]'>—</span>
            )}
          </div>

          <div className={`${LOG_COLUMNS.duration.width} ${LOG_COLUMNS.duration.minWidth}`}>
            <Badge variant='default' className='rounded-[6px] px-[9px] py-[2px] text-[12px]'>
              {formatDuration(log.duration, { precision: 2 }) || '—'}
            </Badge>
          </div>
        </div>

        {/* Resume Link */}
        {log.status === 'pending' && log.executionId && (log.workflow?.id || log.workflowId) && (
          <Link
            href={`/resume/${log.workflow?.id || log.workflowId}/${log.executionId}`}
            target='_blank'
            rel='noopener noreferrer'
            className={cn(
              buttonVariants({ variant: 'active' }),
              'absolute right-[24px] h-[26px] w-[26px] rounded-[6px] p-0'
            )}
            aria-label='Open resume console'
            onClick={(e) => e.stopPropagation()}
          >
            <ArrowUpRight className='h-[14px] w-[14px]' />
          </Link>
        )}
      </div>
    )
  },
  (prevProps, nextProps) => {
    return (
      prevProps.log.id === nextProps.log.id &&
      prevProps.log.duration === nextProps.log.duration &&
      prevProps.log.status === nextProps.log.status &&
      prevProps.isSelected === nextProps.isSelected
    )
  }
)

interface RowProps {
  logs: WorkflowLog[]
  selectedLogId: string | null
  onLogClick: (log: WorkflowLog) => void
  onLogContextMenu?: (e: React.MouseEvent, log: WorkflowLog) => void
  selectedRowRef: React.RefObject<HTMLTableRowElement | null>
  isFetchingNextPage: boolean
  loaderRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Row component for the virtualized list.
 * Receives row-specific props via rowProps.
 */
function Row({
  index,
  style,
  logs,
  selectedLogId,
  onLogClick,
  onLogContextMenu,
  selectedRowRef,
  isFetchingNextPage,
  loaderRef,
}: RowComponentProps<RowProps>) {
  if (index >= logs.length) {
    return (
      <div style={style} className='flex items-center justify-center'>
        <div ref={loaderRef} className='flex items-center gap-[8px] text-[var(--text-secondary)]'>
          {isFetchingNextPage ? (
            <>
              <Loader2 className='h-[16px] w-[16px] animate-spin' />
              <span className='text-[13px]'>Loading more...</span>
            </>
          ) : (
            <span className='text-[13px]'>Scroll to load more</span>
          )}
        </div>
      </div>
    )
  }

  const log = logs[index]
  const isSelected = selectedLogId === log.id

  return (
    <div style={style}>
      <LogRow
        log={log}
        isSelected={isSelected}
        onClick={onLogClick}
        onContextMenu={onLogContextMenu}
        selectedRowRef={isSelected ? selectedRowRef : null}
      />
    </div>
  )
}

export interface LogsListProps {
  logs: WorkflowLog[]
  selectedLogId: string | null
  onLogClick: (log: WorkflowLog) => void
  onLogContextMenu?: (e: React.MouseEvent, log: WorkflowLog) => void
  selectedRowRef: React.RefObject<HTMLTableRowElement | null>
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
  loaderRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Virtualized logs list using react-window for optimal performance.
 * Renders only visible rows, enabling smooth scrolling with large datasets.
 * @param props - Component props
 * @returns The virtualized logs list
 */
export function LogsList({
  logs,
  selectedLogId,
  onLogClick,
  onLogContextMenu,
  selectedRowRef,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  loaderRef,
}: LogsListProps) {
  const listRef = useListRef(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [listHeight, setListHeight] = useState(400)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateHeight = () => {
      const rect = container.getBoundingClientRect()
      if (rect.height > 0) {
        setListHeight(rect.height)
      }
    }

    updateHeight()
    const ro = new ResizeObserver(updateHeight)
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  const handleRowsRendered = useCallback(
    ({ stopIndex }: { startIndex: number; stopIndex: number }) => {
      const threshold = logs.length - 10
      if (stopIndex >= threshold && hasNextPage && !isFetchingNextPage) {
        onLoadMore()
      }
    },
    [logs.length, hasNextPage, isFetchingNextPage, onLoadMore]
  )

  const itemCount = hasNextPage ? logs.length + 1 : logs.length

  const rowProps = useMemo<RowProps>(
    () => ({
      logs,
      selectedLogId,
      onLogClick,
      onLogContextMenu,
      selectedRowRef,
      isFetchingNextPage,
      loaderRef,
    }),
    [
      logs,
      selectedLogId,
      onLogClick,
      onLogContextMenu,
      selectedRowRef,
      isFetchingNextPage,
      loaderRef,
    ]
  )

  return (
    <div ref={containerRef} className='h-full w-full'>
      <List
        listRef={listRef}
        defaultHeight={listHeight}
        rowCount={itemCount}
        rowHeight={LOG_ROW_HEIGHT}
        rowComponent={Row}
        rowProps={rowProps}
        overscanCount={5}
        onRowsRendered={handleRowsRendered}
      />
    </div>
  )
}

export default LogsList
