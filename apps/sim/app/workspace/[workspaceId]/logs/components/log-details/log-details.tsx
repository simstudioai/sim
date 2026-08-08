'use client'

import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { Button, cn, Tooltip } from '@sim/emcn'
import { ChevronUp, Redo, X } from '@sim/emcn/icons'
import { useParams, useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import type { LogViewTab } from '@/components/resources/log-view'
import { LogView } from '@/components/resources/log-view'
import type { WorkflowLogRow } from '@/lib/api/contracts/logs'
import {
  logDetailsTabParam,
  logDetailsTabUrlKeys,
} from '@/app/workspace/[workspaceId]/logs/search-params'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useLogDetailsResize } from '@/hooks/use-log-details-resize'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { grantsFromPermissions, workspaceSource } from '@/resources'
import { useLogDetailsUIStore } from '@/stores/logs/store'
import { MAX_LOG_DETAILS_WIDTH_RATIO, MIN_LOG_DETAILS_WIDTH } from '@/stores/logs/utils'

interface LogDetailsProps {
  log: WorkflowLogRow | null
  isOpen: boolean
  onClose: () => void
  onNavigateNext?: () => void
  onNavigatePrev?: () => void
  hasNext?: boolean
  hasPrev?: boolean
  onRetryExecution?: () => void
  isRetryPending?: boolean
  onActiveTabChange?: (tab: LogViewTab) => void
}

export const LogDetails = memo(function LogDetails({
  log,
  isOpen,
  onClose,
  onNavigateNext,
  onNavigatePrev,
  hasNext = false,
  hasPrev = false,
  onRetryExecution,
  isRetryPending = false,
  onActiveTabChange,
}: LogDetailsProps) {
  const activeTabRef = useRef<LogViewTab>('overview')

  const handleActiveTabChange = useCallback(
    (tab: LogViewTab) => {
      activeTabRef.current = tab
      onActiveTabChange?.(tab)
    },
    [onActiveTabChange]
  )

  const router = useRouter()
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const permissions = useUserPermissionsContext()
  const { config: permissionConfig } = usePermissionConfig()

  /**
   * The logs page owns its URL, so the tab stays deep-linkable here rather than
   * inside the view.
   */
  const [activeTab, setActiveTab] = useQueryState(logDetailsTabParam.key, {
    ...logDetailsTabParam.parser,
    ...logDetailsTabUrlKeys,
  })

  const source = useMemo(
    () => workspaceSource({ kind: 'log' as const, workspaceId, resourceId: log?.id ?? '' }),
    [workspaceId, log?.id]
  )
  const grants = useMemo(() => grantsFromPermissions(permissions), [permissions])
  const showExecutionInternals = !permissionConfig.hideTraceSpans

  const handleNavigate = useCallback((path: string) => router.push(path), [router])

  const panelWidth = useLogDetailsUIStore((state) => state.panelWidth)
  const { handleMouseDown } = useLogDetailsResize()

  const maxVw = `${MAX_LOG_DETAILS_WIDTH_RATIO * 100}vw`
  const effectiveWidth = `clamp(min(${MIN_LOG_DETAILS_WIDTH}px, ${maxVw}), ${panelWidth}px, ${maxVw})`

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }

      if (!isOpen) return

      // Trace tab owns arrow keys for span navigation.
      if (activeTabRef.current === 'trace') return

      if (e.key === 'ArrowUp' && hasPrev && onNavigatePrev) {
        e.preventDefault()
        onNavigatePrev()
      }

      if (e.key === 'ArrowDown' && hasNext && onNavigateNext) {
        e.preventDefault()
        onNavigateNext()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, hasPrev, hasNext, onNavigatePrev, onNavigateNext])

  return (
    <>
      {/* Resize Handle - positioned outside the panel */}
      {isOpen && (
        <div
          className='absolute top-0 bottom-0 z-[var(--z-dropdown)] w-[8px] cursor-ew-resize'
          style={{ right: `calc(${effectiveWidth} - 4px)` }}
          onMouseDown={handleMouseDown}
          role='separator'
          aria-label='Resize log details panel'
          aria-orientation='vertical'
        />
      )}

      <div
        className={cn(
          'absolute top-0 right-0 bottom-0 z-[var(--z-dropdown)] overflow-hidden border-l bg-[var(--bg)] shadow-md transition-transform duration-200 ease-out',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
        style={{ width: effectiveWidth }}
        aria-label='Log details sidebar'
      >
        {log && (
          <div className='flex h-full flex-col px-3.5 pt-3'>
            {/* Header */}
            <div className='flex items-center justify-between'>
              <h2 className='font-medium text-[var(--text-primary)] text-sm'>Log Details</h2>
              <div className='flex items-center gap-[1px]'>
                {log.status === 'failed' &&
                  (log.workflow?.id || log.workflowId) &&
                  log.trigger !== 'mothership' && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          variant='ghost'
                          className='!p-1'
                          onClick={() => onRetryExecution?.()}
                          disabled={isRetryPending}
                          aria-label='Retry execution'
                        >
                          <Redo className='size-[14px]' />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content side='bottom'>Retry</Tooltip.Content>
                    </Tooltip.Root>
                  )}
                <Button
                  variant='ghost'
                  className='!p-1'
                  onClick={() => hasPrev && onNavigatePrev?.()}
                  disabled={!hasPrev}
                  aria-label='Previous log'
                >
                  <ChevronUp className='size-[14px]' />
                </Button>
                <Button
                  variant='ghost'
                  className='!p-1'
                  onClick={() => hasNext && onNavigateNext?.()}
                  disabled={!hasNext}
                  aria-label='Next log'
                >
                  <ChevronUp className='size-[14px] rotate-180' />
                </Button>
                <Button variant='ghost' className='!p-1' onClick={onClose} aria-label='Close'>
                  <X className='size-[14px]' />
                </Button>
              </div>
            </div>

            <LogView
              source={source}
              grants={grants}
              host='page'
              log={log}
              showExecutionInternals={showExecutionInternals}
              tab={activeTab}
              onTabChange={setActiveTab}
              onActiveTabChange={handleActiveTabChange}
              onNavigate={handleNavigate}
            />
          </div>
        )}
      </div>
    </>
  )
})
