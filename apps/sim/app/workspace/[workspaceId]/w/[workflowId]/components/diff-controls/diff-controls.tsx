import { memo, useCallback, useMemo } from 'react'
import { createLogger } from '@sim/logger'
import clsx from 'clsx'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { createCommand } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import { usePreventZoom } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useNotificationStore } from '@/stores/notifications'
import { useCopilotStore, usePanelStore } from '@/stores/panel'
import { useTerminalStore } from '@/stores/terminal'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('DiffControls')
const NOTIFICATION_WIDTH = 240
const NOTIFICATION_GAP = 16

export const DiffControls = memo(function DiffControls() {
  const isTerminalResizing = useTerminalStore((state) => state.isResizing)
  const isPanelResizing = usePanelStore((state) => state.isResizing)
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

  const { updatePreviewToolCallState } = useCopilotStore(
    useCallback(
      (state) => ({
        updatePreviewToolCallState: state.updatePreviewToolCallState,
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

    // Resolve target toolCallId for build/edit and update to terminal success state in the copilot store
    // This happens synchronously first for instant UI feedback
    try {
      const { toolCallsById, messages } = useCopilotStore.getState()
      let id: string | undefined
      outer: for (let mi = messages.length - 1; mi >= 0; mi--) {
        const m = messages[mi]
        if (m.role !== 'assistant' || !m.contentBlocks) continue
        const blocks = m.contentBlocks as any[]
        for (let bi = blocks.length - 1; bi >= 0; bi--) {
          const b = blocks[bi]
          if (b?.type === 'tool_call') {
            const tn = b.toolCall?.name
            if (tn === 'edit_workflow') {
              id = b.toolCall?.id
              break outer
            }
          }
        }
      }
      if (!id) {
        const candidates = Object.values(toolCallsById).filter((t) => t.name === 'edit_workflow')
        id = candidates.length ? candidates[candidates.length - 1].id : undefined
      }
      if (id) updatePreviewToolCallState('accepted', id)
    } catch {}

    // Accept changes without blocking the UI; errors will be logged by the store handler
    acceptChanges().catch((error) => {
      logger.error('Failed to accept changes (background):', error)
    })

    // Create checkpoint in the background (fire-and-forget) so it doesn't block UI
    logger.info('Accept triggered; UI will update optimistically')
  }, [updatePreviewToolCallState, acceptChanges])

  const handleReject = useCallback(() => {
    logger.info('Rejecting proposed changes (optimistic)')

    // Resolve target toolCallId for build/edit and update to terminal rejected state in the copilot store
    try {
      const { toolCallsById, messages } = useCopilotStore.getState()
      let id: string | undefined
      outer: for (let mi = messages.length - 1; mi >= 0; mi--) {
        const m = messages[mi]
        if (m.role !== 'assistant' || !m.contentBlocks) continue
        const blocks = m.contentBlocks as any[]
        for (let bi = blocks.length - 1; bi >= 0; bi--) {
          const b = blocks[bi]
          if (b?.type === 'tool_call') {
            const tn = b.toolCall?.name
            if (tn === 'edit_workflow') {
              id = b.toolCall?.id
              break outer
            }
          }
        }
      }
      if (!id) {
        const candidates = Object.values(toolCallsById).filter((t) => t.name === 'edit_workflow')
        id = candidates.length ? candidates[candidates.length - 1].id : undefined
      }
      if (id) updatePreviewToolCallState('rejected', id)
    } catch {}

    // Reject changes optimistically
    rejectChanges().catch((error) => {
      logger.error('Failed to reject changes (background):', error)
    })
  }, [updatePreviewToolCallState, rejectChanges])

  const preventZoomRef = usePreventZoom()

  // Register global command to accept changes (Cmd/Ctrl + Shift + Enter)
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

  // Don't show anything if no diff is available or diff is not ready
  if (!hasActiveDiff || !isDiffReady) {
    return null
  }

  const isResizing = isTerminalResizing || isPanelResizing

  const notificationOffset = hasVisibleNotifications ? NOTIFICATION_WIDTH + NOTIFICATION_GAP : 0

  return (
    <div
      ref={preventZoomRef}
      className={clsx('fixed z-30', !isResizing && 'transition-[bottom] duration-100 ease-out')}
      style={{
        bottom: 'calc(var(--terminal-height) + 16px)',
        right: `calc(var(--panel-width) + 16px + ${notificationOffset}px)`,
      }}
    >
      <div
        className='group relative flex h-[30px] overflow-hidden rounded-[4px]'
        style={{ isolation: 'isolate' }}
      >
        {/* Reject side */}
        <button
          onClick={handleReject}
          title='Reject changes'
          className='relative flex h-full items-center border border-[var(--border)] bg-[var(--surface-4)] pr-[20px] pl-[12px] font-medium text-[13px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-1)] hover:bg-[var(--surface-6)] hover:text-[var(--text-primary)] dark:hover:bg-[var(--surface-5)]'
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
              'linear-gradient(to right, var(--border) 50%, color-mix(in srgb, var(--brand-tertiary-2) 70%, black) 50%)',
          }}
        />
        {/* Accept side */}
        <button
          onClick={handleAccept}
          title='Accept changes (⇧⌘⏎)'
          className='-ml-[10px] relative flex h-full items-center border border-[rgba(0,0,0,0.15)] bg-[var(--brand-tertiary-2)] pr-[12px] pl-[20px] font-medium text-[13px] text-[var(--text-inverse)] transition-[background-color,border-color,fill,stroke] hover:brightness-110 dark:border-[rgba(255,255,255,0.1)]'
          style={{
            clipPath: 'polygon(10px 0, 100% 0, 100% 100%, 0 100%)',
            borderRadius: '0 4px 4px 0',
          }}
        >
          Accept
          <kbd className='ml-2 rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-medium font-sans text-[10px]'>
            ⇧⌘<span className='translate-y-[-1px]'>⏎</span>
          </kbd>
        </button>
      </div>
    </div>
  )
})
