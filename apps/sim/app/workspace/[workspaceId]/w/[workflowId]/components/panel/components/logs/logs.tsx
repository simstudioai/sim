'use client'

import { useEffect, useMemo, useState } from 'react'
import { Chip, cn } from '@sim/emcn'
import { ArrowLeft, RefreshCw } from '@sim/emcn/icons'
import { formatDuration, formatRelativeTime } from '@sim/utils/formatting'
import { useParams } from 'next/navigation'
import type { LogTraceSpan, WorkflowLogRow, WorkflowLogSummary } from '@/lib/api/contracts/logs'
import { LogDetailsContent } from '@/app/workspace/[workspaceId]/logs/components'
import {
  getDisplayStatus,
  StatusBadge,
  TriggerBadge,
} from '@/app/workspace/[workspaceId]/logs/utils'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import type { LogFilters } from '@/hooks/queries/logs'
import { useExecutionSnapshot, useLogDetail, useLogsList } from '@/hooks/queries/logs'
import { useWorkflowRunSnapshotStore } from '@/stores/logs/workflow-run-snapshot'
import { usePanelEditorStore } from '@/stores/panel'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

type LogScope = 'block' | 'workflow'

const EMPTY_FILTERS: Omit<LogFilters, 'workflowIds'> = {
  timeRange: 'Past 7 days',
  level: 'all',
  folderIds: [],
  triggers: [],
  searchQuery: '',
  limit: 50,
  sortBy: 'date',
  sortOrder: 'desc',
}

function selectBlockSpans(spans: LogTraceSpan[], blockId: string): LogTraceSpan[] {
  const selected: LogTraceSpan[] = []

  for (const span of spans) {
    if (span.blockId === blockId) {
      selected.push(span)
    } else if (span.children?.length) {
      selected.push(...selectBlockSpans(span.children, blockId))
    }
  }

  return selected
}

function focusLogOnBlock(log: WorkflowLogRow, blockId: string | null): WorkflowLogRow {
  const traceSpans = log.executionData?.traceSpans
  if (!blockId || !traceSpans) return log

  return {
    ...log,
    executionData: {
      ...log.executionData,
      traceSpans: selectBlockSpans(traceSpans, blockId),
    },
  }
}

interface RunRowProps {
  log: WorkflowLogSummary
  onSelect: (log: WorkflowLogSummary) => void
}

function RunRow({ log, onSelect }: RunRowProps) {
  return (
    <button
      type='button'
      onClick={() => onSelect(log)}
      className='group flex w-full min-w-0 items-center gap-2 border-[var(--border)] border-b px-3 py-2.5 text-start transition-colors last:border-b-0 hover-hover:bg-[var(--surface-active)] focus-visible:bg-[var(--surface-active)] focus-visible:outline-none'
    >
      <div className='flex min-w-0 flex-1 flex-col gap-1'>
        <div className='flex min-w-0 items-center gap-2'>
          <span className='min-w-0 flex-1 truncate text-[var(--text-primary)] text-sm'>
            {formatRelativeTime(log.createdAt)}
          </span>
          <span className='flex-none text-[var(--text-tertiary)] text-caption tabular-nums'>
            {formatDuration(log.duration, { precision: 2 }) || '—'}
          </span>
        </div>
        <div className='flex min-w-0 items-center gap-1.5'>
          <StatusBadge status={getDisplayStatus(log.status)} />
          {log.trigger ? <TriggerBadge trigger={log.trigger} /> : null}
        </div>
      </div>
    </button>
  )
}

export function Logs() {
  const params = useParams<{ workspaceId: string; workflowId: string }>()
  const workspaceId = params.workspaceId
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const workflowId = activeWorkflowId ?? params.workflowId
  const currentBlockId = usePanelEditorStore((state) => state.currentBlockId)
  const currentWorkflow = useCurrentWorkflow()
  const currentBlock = currentBlockId ? currentWorkflow.getBlockById(currentBlockId) : null
  const [scope, setScope] = useState<LogScope>(currentBlock ? 'block' : 'workflow')
  const [selectedLog, setSelectedLog] = useState<WorkflowLogSummary | null>(null)
  const openSnapshot = useWorkflowRunSnapshotStore((state) => state.openSnapshot)
  const closeSnapshot = useWorkflowRunSnapshotStore((state) => state.closeSnapshot)

  useEffect(() => {
    setScope(currentBlockId ? 'block' : 'workflow')
  }, [currentBlockId])

  const filters = useMemo<LogFilters>(
    () => ({ ...EMPTY_FILTERS, workflowIds: workflowId ? [workflowId] : [] }),
    [workflowId]
  )
  const logsQuery = useLogsList(workspaceId, filters, { enabled: Boolean(workflowId) })
  const logDetailQuery = useLogDetail(selectedLog?.id, workspaceId)
  const logs = useMemo(
    () => logsQuery.data?.pages.flatMap((page) => page.logs) ?? [],
    [logsQuery.data]
  )
  const detailLog = logDetailQuery.data ?? selectedLog
  const snapshotExecutionId = selectedLog?.executionId ?? logs[0]?.executionId ?? undefined
  useExecutionSnapshot(snapshotExecutionId)

  useEffect(() => {
    if (!snapshotExecutionId) return
    void import(
      '@/app/workspace/[workspaceId]/logs/components/log-details/components/execution-snapshot/execution-snapshot'
    )
  }, [snapshotExecutionId])

  const visibleLog = detailLog
    ? focusLogOnBlock(detailLog, scope === 'block' ? currentBlockId : null)
    : null

  if (selectedLog && visibleLog) {
    return (
      <div className='flex h-full min-h-0 flex-col overflow-hidden px-3'>
        <div className='flex h-10 flex-none items-center gap-2 border-[var(--border)] border-b'>
          <Chip
            leftIcon={ArrowLeft}
            onClick={() => {
              closeSnapshot()
              setSelectedLog(null)
              setScope(currentBlockId ? 'block' : 'workflow')
            }}
            aria-label='Back to workflow runs'
            className='size-[30px] justify-center p-0'
          />
          <span className='min-w-0 flex-1 truncate text-[var(--text-primary)] text-sm'>
            Run details
          </span>
          <StatusBadge status={getDisplayStatus(visibleLog.status)} />
        </div>

        {currentBlock && scope === 'block' ? (
          <div className='flex flex-none items-center gap-2 border-[var(--border)] border-b py-3'>
            <div className='min-w-0 flex-1'>
              <p className='truncate text-[var(--text-primary)] text-sm'>{currentBlock.name}</p>
              <p className='truncate text-[var(--text-tertiary)] text-caption'>
                Showing this block in the run trace
              </p>
            </div>
            <Chip onClick={() => setScope('workflow')}>View full run</Chip>
          </div>
        ) : null}

        <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
          <LogDetailsContent
            log={visibleLog}
            onViewSnapshot={() => {
              if (!detailLog?.executionId) return
              openSnapshot({
                executionId: detailLog.executionId,
                traceSpans: logDetailQuery.data?.executionData?.traceSpans,
              })
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col overflow-hidden'>
      <div className='flex flex-none flex-col gap-2 border-[var(--border)] border-b px-3 py-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <div className='min-w-0 flex-1'>
            <p className='truncate text-[var(--text-primary)] text-sm'>
              {currentBlock ? currentBlock.name : 'Workflow runs'}
            </p>
            <p className='truncate text-[var(--text-tertiary)] text-caption'>
              {currentBlock
                ? 'Open a run to inspect this block in its trace'
                : 'Runs from the past 7 days'}
            </p>
          </div>
          <Chip
            leftIcon={RefreshCw}
            onClick={() => logsQuery.refetch()}
            disabled={logsQuery.isFetching}
            aria-label='Refresh workflow runs'
            className='size-[30px] justify-center p-0'
          />
        </div>
      </div>

      <div
        className={cn(
          'min-h-0 flex-1 overflow-y-auto',
          logs.length === 0 && 'flex items-center justify-center'
        )}
      >
        {logsQuery.isLoading ? (
          <p className='px-4 text-center text-[var(--text-tertiary)] text-sm'>Loading runs…</p>
        ) : logsQuery.isError ? (
          <div className='flex flex-col items-center gap-2 px-4 text-center'>
            <p className='text-[var(--text-secondary)] text-sm'>Couldn’t load workflow runs.</p>
            <Chip onClick={() => logsQuery.refetch()}>Try again</Chip>
          </div>
        ) : logs.length === 0 ? (
          <p className='px-4 text-center text-[var(--text-tertiary)] text-sm'>
            No runs in the past 7 days.
          </p>
        ) : (
          <div>
            {logs.map((log) => (
              <RunRow key={log.id} log={log} onSelect={setSelectedLog} />
            ))}
            {logsQuery.hasNextPage ? (
              <div className='flex justify-center p-3'>
                <Chip
                  onClick={() => logsQuery.fetchNextPage()}
                  disabled={logsQuery.isFetchingNextPage}
                >
                  {logsQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Chip>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
