import { memo, useCallback, useMemo } from 'react'
import { createLogger } from '@sim/logger'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { createCommand } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import { usePreventZoom } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useNotificationStore } from '@/stores/notifications'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('DiffControls')
const NOTIFICATION_WIDTH = 240
const NOTIFICATION_GAP = 16

export const DiffControls = memo(function DiffControls() {
  const { isDiffReady, hasActiveDiff, acceptChanges, rejectChanges } = useWorkflowDiffStore(
    useCallback(
      (state) => ({
        isDiffReady: state.isDiffReady,
        hasActiveDiff: state.hasActiveDiff,
        acceptChanges: state.acceptChanges,
        rejectChanges: state.rejectChanges,
      }),
      []
    )
  )

  const { activeWorkflowId } = useWorkflowRegistry(
    useCallback((state) => ({ activeWorkflowId: state.activeWorkflowId }), [])
  )

  const allNotifications = useNotificationStore((state) => state.notifications)
  const hasVisibleNotifications = useMemo(() => {
    if (!activeWorkflowId) return false
    return allNotifications.some((n) => !n.workflowId || n.workflowId === activeWorkflowId)
  }, [allNotifications, activeWorkflowId])

  const handleAccept = useCallback(() => {
    logger.info('Accepting proposed changes with backup protection')
    acceptChanges().catch((error) => {
      logger.error('Failed to accept changes (background):', error)
    })
    logger.info('Accept triggered; UI will update optimistically')
  }, [acceptChanges])

  const handleReject = useCallback(() => {
    logger.info('Rejecting proposed changes (optimistic)')
    rejectChanges().catch((error) => {
      logger.error('Failed to reject changes (background):', error)
    })
  }, [rejectChanges])

  const preventZoomRef = usePreventZoom()

  const acceptCommand = useMemo(
    () =>
      createCommand({
        id: 'accept-diff-changes',
        handler: () => {
          if (hasActiveDiff && isDiffReady) {
            handleAccept()
          }
        },
      }),
    [hasActiveDiff, isDiffReady, handleAccept]
  )
  useRegisterGlobalCommands([acceptCommand])

  if (!hasActiveDiff || !isDiffReady) {
    return null
  }

  const notificationOffset = hasVisibleNotifications ? NOTIFICATION_WIDTH + NOTIFICATION_GAP : 0

  return (
    <div
      ref={preventZoomRef}
      className='absolute z-30'
      style={{
        bottom: '16px',
        right: `${16 + notificationOffset}px`,
      }}
    >
      <div
        className='group relative flex h-[30px] overflow-hidden rounded-sm'
        style={{ isolation: 'isolate' }}
      >
        {/* Reject side */}
        <button
          onClick={handleReject}
          title='Reject changes'
          className='relative flex h-full items-center border border-[var(--border)] bg-[var(--surface-4)] pr-5 pl-3 font-medium text-[var(--text-secondary)] text-small transition-colors hover-hover:border-[var(--border-1)] hover-hover:bg-[var(--surface-6)] hover-hover:text-[var(--text-primary)] dark:hover-hover:bg-[var(--surface-5)]'
          style={{
            clipPath: 'polygon(0 0, calc(100% + 10px) 0, 100% 100%, 0 100%)',
            borderRadius: '4px 0 0 4px',
          }}
        >
          Reject
        </button>
        {/* Slanted divider - split gray/green */}
        <div
          className='pointer-events-none absolute top-0 bottom-0 z-10'
          style={{
            left: '66px',
            width: '2px',
            transform: 'skewX(-18.4deg)',
            background:
              'linear-gradient(to right, var(--border) 50%, color-mix(in srgb, var(--brand-accent) 70%, black) 50%)',
          }}
        />
        {/* Accept side */}
        <button
          onClick={handleAccept}
          title='Accept changes (⇧⌘⏎)'
          className='-ml-2.5 relative flex h-full items-center border border-[rgba(0,0,0,0.15)] bg-[var(--brand-accent)] pr-3 pl-5 font-medium text-[var(--text-inverse)] text-small transition-[background-color,border-color,fill,stroke] hover-hover:brightness-110 dark:border-[rgba(255,255,255,0.1)]'
          style={{
            clipPath: 'polygon(10px 0, 100% 0, 100% 100%, 0 100%)',
            borderRadius: '0 4px 4px 0',
          }}
        >
          Accept
          <kbd className='ml-2 rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-medium font-sans text-micro'>
            ⇧⌘<span className='translate-y-[-1px]'>⏎</span>
          </kbd>
        </button>
      </div>
    </div>
  )
})
