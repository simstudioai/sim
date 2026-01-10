'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronUp, X } from 'lucide-react'
import { Button, Eye } from '@/components/emcn'
import { ScrollArea } from '@/components/ui/scroll-area'
import { BASE_EXECUTION_CHARGE } from '@/lib/billing/constants'
import {
  ExecutionSnapshot,
  FileCards,
  TraceSpans,
} from '@/app/workspace/[workspaceId]/logs/components'
import { useLogDetailsResize } from '@/app/workspace/[workspaceId]/logs/hooks'
import {
  formatDate,
  getDisplayStatus,
  StatusBadge,
  TriggerBadge,
} from '@/app/workspace/[workspaceId]/logs/utils'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { formatCost } from '@/providers/utils'
import type { WorkflowLog } from '@/stores/logs/filters/types'
import { useLogDetailsUIStore } from '@/stores/logs/store'

interface LogDetailsProps {
  /** The log to display details for */
  log: WorkflowLog | null
  /** Whether the sidebar is open */
  isOpen: boolean
  /** Callback when closing the sidebar */
  onClose: () => void
  /** Callback to navigate to next log */
  onNavigateNext?: () => void
  /** Callback to navigate to previous log */
  onNavigatePrev?: () => void
  /** Whether there is a next log available */
  hasNext?: boolean
  /** Whether there is a previous log available */
  hasPrev?: boolean
}

/**
 * Sidebar panel displaying detailed information about a selected log.
 * Supports navigation between logs and expandable sections.
 * @param props - Component props
 * @returns Log details sidebar component
 */
export const LogDetails = memo(function LogDetails({
  log,
  isOpen,
  onClose,
  onNavigateNext,
  onNavigatePrev,
  hasNext = false,
  hasPrev = false,
}: LogDetailsProps) {
  const [isExecutionSnapshotOpen, setIsExecutionSnapshotOpen] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const panelWidth = useLogDetailsUIStore((state) => state.panelWidth)
  const { handleMouseDown } = useLogDetailsResize()
  const { config: permissionConfig } = usePermissionConfig()

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = 0
    }
  }, [log?.id])

  const isWorkflowExecutionLog = useMemo(() => {
    if (!log) return false
    return (
      (log.trigger === 'manual' && !!log.duration) ||
      (log.executionData?.enhanced && log.executionData?.traceSpans)
    )
  }, [log])

  const hasCostInfo = useMemo(() => {
    return isWorkflowExecutionLog && log?.cost
  }, [log, isWorkflowExecutionLog])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }

      if (isOpen) {
        if (e.key === 'ArrowUp' && hasPrev && onNavigatePrev) {
          e.preventDefault()
          handleNavigate(onNavigatePrev)
        }

        if (e.key === 'ArrowDown' && hasNext && onNavigateNext) {
          e.preventDefault()
          handleNavigate(onNavigateNext)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, hasPrev, hasNext, onNavigatePrev, onNavigateNext])

  const handleNavigate = (navigateFunction: () => void) => {
    navigateFunction()
  }

  const formattedTimestamp = useMemo(
    () => (log ? formatDate(log.createdAt) : null),
    [log?.createdAt]
  )

  const logStatus = useMemo(() => getDisplayStatus(log?.status), [log?.status])

  return (
    <>
      {/* Resize Handle - positioned outside the panel */}
      {isOpen && (
        <div
          className='absolute top-0 bottom-0 z-[60] w-[8px] cursor-ew-resize'
          style={{ right: `${panelWidth - 4}px` }}
          onMouseDown={handleMouseDown}
          role='separator'
          aria-label='Resize log details panel'
          aria-orientation='vertical'
        />
      )}

      <div
        className={`absolute top-[0px] right-0 bottom-0 z-50 transform overflow-hidden border-l bg-[var(--surface-1)] shadow-md transition-transform duration-200 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ width: `${panelWidth}px` }}
        aria-label='Log details sidebar'
      >
        {log && (
          <div className='flex h-full flex-col px-[14px] pt-[12px]'>
            {/* Header */}
            <div className='flex items-center justify-between'>
              <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>Log Details</h2>
              <div className='flex items-center gap-[1px]'>
                <Button
                  variant='ghost'
                  className='!p-[4px]'
                  onClick={() => hasPrev && handleNavigate(onNavigatePrev!)}
                  disabled={!hasPrev}
                  aria-label='Previous log'
                >
                  <ChevronUp className='h-[14px] w-[14px]' />
                </Button>
                <Button
                  variant='ghost'
                  className='!p-[4px]'
                  onClick={() => hasNext && handleNavigate(onNavigateNext!)}
                  disabled={!hasNext}
                  aria-label='Next log'
                >
                  <ChevronUp className='h-[14px] w-[14px] rotate-180' />
                </Button>
                <Button variant='ghost' className='!p-[4px]' onClick={onClose} aria-label='Close'>
                  <X className='h-[14px] w-[14px]' />
                </Button>
              </div>
            </div>

            {/* Content - Scrollable */}
            <ScrollArea className='mt-[20px] h-full w-full overflow-y-auto' ref={scrollAreaRef}>
              <div className='flex flex-col gap-[10px] pb-[16px]'>
                {/* Timestamp & Workflow Row */}
                <div className='flex min-w-0 items-center gap-[16px] px-[1px]'>
                  {/* Timestamp Card */}
                  <div className='flex w-[140px] flex-shrink-0 flex-col gap-[8px]'>
                    <div className='font-medium text-[12px] text-[var(--text-tertiary)]'>
                      Timestamp
                    </div>
                    <div className='flex items-center gap-[6px]'>
                      <span className='font-medium text-[14px] text-[var(--text-secondary)]'>
                        {formattedTimestamp?.compactDate || 'N/A'}
                      </span>
                      <span className='font-medium text-[14px] text-[var(--text-secondary)]'>
                        {formattedTimestamp?.compactTime || 'N/A'}
                      </span>
                    </div>
                  </div>

                  {/* Workflow Card */}
                  {log.workflow && (
                    <div className='flex w-0 min-w-0 flex-1 flex-col gap-[8px]'>
                      <div className='font-medium text-[12px] text-[var(--text-tertiary)]'>
                        Workflow
                      </div>
                      <div className='flex min-w-0 items-center gap-[8px]'>
                        <div
                          className='h-[10px] w-[10px] flex-shrink-0 rounded-[3px]'
                          style={{ backgroundColor: log.workflow?.color }}
                        />
                        <span className='min-w-0 flex-1 truncate font-medium text-[14px] text-[var(--text-secondary)]'>
                          {log.workflow.name}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Execution ID */}
                {log.executionId && (
                  <div className='flex flex-col gap-[6px] rounded-[6px] bg-[var(--surface-2)] px-[10px] py-[8px]'>
                    <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>
                      Execution ID
                    </span>
                    <span className='truncate font-medium text-[14px] text-[var(--text-secondary)]'>
                      {log.executionId}
                    </span>
                  </div>
                )}

                {/* Details Section */}
                <div className='flex min-w-0 flex-col overflow-hidden'>
                  {/* Level */}
                  <div className='flex h-[48px] items-center justify-between border-[var(--border)] border-b p-[8px]'>
                    <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>
                      Level
                    </span>
                    <StatusBadge status={logStatus} />
                  </div>

                  {/* Trigger */}
                  <div className='flex h-[48px] items-center justify-between border-[var(--border)] border-b p-[8px]'>
                    <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>
                      Trigger
                    </span>
                    {log.trigger ? (
                      <TriggerBadge trigger={log.trigger} />
                    ) : (
                      <span className='font-medium text-[12px] text-[var(--text-secondary)]'>
                        —
                      </span>
                    )}
                  </div>

                  {/* Duration */}
                  <div
                    className={`flex h-[48px] items-center justify-between border-b p-[8px] ${log.deploymentVersion ? 'border-[var(--border)]' : 'border-transparent'}`}
                  >
                    <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>
                      Duration
                    </span>
                    <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                      {log.duration || '—'}
                    </span>
                  </div>

                  {/* Version */}
                  {log.deploymentVersion && (
                    <div className='flex h-[48px] items-center gap-[8px] p-[8px]'>
                      <span className='flex-shrink-0 font-medium text-[12px] text-[var(--text-tertiary)]'>
                        Version
                      </span>
                      <div className='flex w-0 flex-1 justify-end'>
                        <span className='max-w-full truncate rounded-[6px] bg-[#14291B] px-[9px] py-[2px] font-medium text-[#86EFAC] text-[12px]'>
                          {log.deploymentVersionName || `v${log.deploymentVersion}`}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Workflow State */}
                {isWorkflowExecutionLog && log.executionId && !permissionConfig.hideTraceSpans && (
                  <div className='flex flex-col gap-[6px] rounded-[6px] bg-[var(--surface-2)] px-[10px] py-[8px]'>
                    <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>
                      Workflow State
                    </span>
                    <button
                      onClick={() => setIsExecutionSnapshotOpen(true)}
                      className='flex items-center justify-between rounded-[6px] bg-[var(--surface-1)] px-[10px] py-[8px] transition-colors hover:bg-[var(--surface-4)]'
                    >
                      <span className='font-medium text-[12px] text-[var(--text-secondary)]'>
                        View Snapshot
                      </span>
                      <Eye className='h-[14px] w-[14px] text-[var(--text-subtle)]' />
                    </button>
                  </div>
                )}

                {/* Workflow Execution - Trace Spans */}
                {isWorkflowExecutionLog &&
                  log.executionData?.traceSpans &&
                  !permissionConfig.hideTraceSpans && (
                    <TraceSpans
                      traceSpans={log.executionData.traceSpans}
                      totalDuration={log.executionData.totalDuration}
                    />
                  )}

                {/* Files */}
                {log.files && log.files.length > 0 && (
                  <FileCards files={log.files} isExecutionFile />
                )}

                {/* Cost Breakdown */}
                {hasCostInfo && (
                  <div className='flex flex-col gap-[8px]'>
                    <span className='px-[1px] font-medium text-[12px] text-[var(--text-tertiary)]'>
                      Cost Breakdown
                    </span>

                    <div className='flex flex-col gap-[4px] rounded-[6px] border border-[var(--border)]'>
                      <div className='flex flex-col gap-[10px] rounded-[6px] p-[10px]'>
                        <div className='flex items-center justify-between'>
                          <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>
                            Base Execution:
                          </span>
                          <span className='font-medium text-[12px] text-[var(--text-secondary)]'>
                            {formatCost(BASE_EXECUTION_CHARGE)}
                          </span>
                        </div>
                        <div className='flex items-center justify-between'>
                          <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>
                            Model Input:
                          </span>
                          <span className='font-medium text-[12px] text-[var(--text-secondary)]'>
                            {formatCost(log.cost?.input || 0)}
                          </span>
                        </div>
                        <div className='flex items-center justify-between'>
                          <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>
                            Model Output:
                          </span>
                          <span className='font-medium text-[12px] text-[var(--text-secondary)]'>
                            {formatCost(log.cost?.output || 0)}
                          </span>
                        </div>
                      </div>

                      <div className='border-[var(--border)] border-t' />

                      <div className='flex flex-col gap-[10px] rounded-[6px] p-[10px]'>
                        <div className='flex items-center justify-between'>
                          <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>
                            Total:
                          </span>
                          <span className='font-medium text-[12px] text-[var(--text-secondary)]'>
                            {formatCost(log.cost?.total || 0)}
                          </span>
                        </div>
                        <div className='flex items-center justify-between'>
                          <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>
                            Tokens:
                          </span>
                          <span className='font-medium text-[12px] text-[var(--text-secondary)]'>
                            {log.cost?.tokens?.input || log.cost?.tokens?.prompt || 0} in /{' '}
                            {log.cost?.tokens?.output || log.cost?.tokens?.completion || 0} out
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className='flex items-center justify-center rounded-[6px] bg-[var(--surface-2)] p-[8px] text-center'>
                      <p className='font-medium text-[11px] text-[var(--text-subtle)]'>
                        Total cost includes a base execution charge of{' '}
                        {formatCost(BASE_EXECUTION_CHARGE)} plus any model usage costs.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Frozen Canvas Modal */}
        {log?.executionId && (
          <ExecutionSnapshot
            executionId={log.executionId}
            traceSpans={log.executionData?.traceSpans}
            isModal
            isOpen={isExecutionSnapshotOpen}
            onClose={() => setIsExecutionSnapshotOpen(false)}
          />
        )}
      </div>
    </>
  )
})
