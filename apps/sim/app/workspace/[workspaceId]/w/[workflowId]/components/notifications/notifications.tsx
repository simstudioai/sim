import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { X } from 'lucide-react'
import { Button, CountdownRing, Tooltip } from '@/components/emcn'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { createCommands } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import { usePreventZoom } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import {
  type Notification,
  type NotificationAction,
  sendMothershipMessage,
  useNotificationStore,
} from '@/stores/notifications'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('Notifications')
const MAX_VISIBLE_NOTIFICATIONS = 4
const STACK_OFFSET_PX = 3
const AUTO_DISMISS_MS = 10000
const EXIT_ANIMATION_MS = 200

const ACTION_LABELS: Record<NotificationAction['type'], string> = {
  copilot: 'Fix in Copilot',
  refresh: 'Refresh',
  'unlock-workflow': 'Unlock Workflow',
} as const

function isAutoDismissable(n: Notification): boolean {
  return !!n.workflowId
}

function NotificationCountdownRing({ onPause }: { onPause: () => void }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          variant='ghost'
          onClick={onPause}
          aria-label='Keep notifications visible'
          className='!p-[4px] -m-[2px] shrink-0 rounded-[5px] text-[var(--text-icon)] hover:bg-[var(--surface-active)]'
        >
          <CountdownRing duration={AUTO_DISMISS_MS} />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>
        <p>Keep visible</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

/**
 * Notifications display component.
 * Positioned in the bottom-right workspace area, reactive to panel width and terminal height.
 * Shows both global notifications and workflow-specific notifications.
 *
 * Workflow-scoped notifications auto-dismiss after {@link AUTO_DISMISS_MS}ms with a countdown
 * ring. Clicking the ring pauses all timers until the notification stack clears.
 */
interface NotificationsProps {
  embedded?: boolean
}

export const Notifications = memo(function Notifications({ embedded }: NotificationsProps) {
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  const allNotifications = useNotificationStore((state) => state.notifications)
  const removeNotification = useNotificationStore((state) => state.removeNotification)
  const clearNotifications = useNotificationStore((state) => state.clearNotifications)

  const visibleNotifications = useMemo(() => {
    if (!activeWorkflowId) return []
    return allNotifications
      .filter((n) => !n.workflowId || n.workflowId === activeWorkflowId)
      .slice(0, MAX_VISIBLE_NOTIFICATIONS)
  }, [allNotifications, activeWorkflowId])

  /**
   * Executes a notification action and handles side effects.
   *
   * @param notificationId - The ID of the notification whose action is executed.
   * @param action - The action configuration to execute.
   */
  const executeAction = useCallback(
    (notificationId: string, action: NotificationAction) => {
      try {
        logger.info('Executing notification action', {
          notificationId,
          actionType: action.type,
          messageLength: action.message.length,
        })

        switch (action.type) {
          case 'copilot':
            sendMothershipMessage(action.message)
            break
          case 'refresh':
            window.location.reload()
            break
          case 'unlock-workflow':
            window.dispatchEvent(new CustomEvent('unlock-workflow'))
            break
          default:
            logger.warn('Unknown action type', { notificationId, actionType: action.type })
        }

        removeNotification(notificationId)
      } catch (error) {
        logger.error('Failed to execute notification action', {
          notificationId,
          actionType: action.type,
          error,
        })
      }
    },
    [embedded, removeNotification]
  )

  useRegisterGlobalCommands(() =>
    createCommands([
      {
        id: 'clear-notifications',
        handler: () => {
          clearNotifications(activeWorkflowId ?? undefined)
        },
        overrides: {
          allowInEditable: false,
        },
      },
    ])
  )

  const preventZoomRef = usePreventZoom()

  const [isPaused, setIsPaused] = useState(false)
  const isPausedRef = useRef(false)
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set())
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const pauseAll = useCallback(() => {
    setIsPaused(true)
    isPausedRef.current = true
    setExitingIds(new Set())
    for (const timer of timersRef.current.values()) clearTimeout(timer)
    timersRef.current.clear()
  }, [])

  /**
   * Manages per-notification dismiss timers.
   * Resets pause state when the notification stack empties so new arrivals get fresh timers.
   */
  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])

  useEffect(() => {
    if (visibleNotifications.length === 0) {
      if (isPaused) setIsPaused(false)
      for (const timer of timersRef.current.values()) clearTimeout(timer)
      timersRef.current.clear()
      return
    }
    if (isPaused) return

    const timers = timersRef.current
    const activeIds = new Set<string>()

    for (const n of visibleNotifications) {
      if (!isAutoDismissable(n) || timers.has(n.id)) continue
      activeIds.add(n.id)

      timers.set(
        n.id,
        setTimeout(() => {
          timers.delete(n.id)
          setExitingIds((prev) => new Set(prev).add(n.id))
          setTimeout(() => {
            if (isPausedRef.current) return
            removeNotification(n.id)
            setExitingIds((prev) => {
              const next = new Set(prev)
              next.delete(n.id)
              return next
            })
          }, EXIT_ANIMATION_MS)
        }, AUTO_DISMISS_MS)
      )
    }

    for (const [id, timer] of timers) {
      if (!activeIds.has(id) && !visibleNotifications.some((n) => n.id === id)) {
        clearTimeout(timer)
        timers.delete(id)
      }
    }
  }, [visibleNotifications, removeNotification, isPaused])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
    }
  }, [])

  if (visibleNotifications.length === 0) {
    return null
  }

  return (
    <div ref={preventZoomRef} className='absolute right-[16px] bottom-[16px] z-30 grid'>
      {[...visibleNotifications].reverse().map((notification, index, stacked) => {
        const depth = stacked.length - index - 1
        const xOffset = depth * STACK_OFFSET_PX
        const hasAction = Boolean(notification.action)
        const showCountdown = !isPaused && isAutoDismissable(notification)

        return (
          <div
            key={notification.id}
            style={
              {
                '--stack-offset': `${xOffset}px`,
                animation: exitingIds.has(notification.id)
                  ? `notification-exit ${EXIT_ANIMATION_MS}ms ease-in forwards`
                  : 'notification-enter 200ms ease-out forwards',
                gridArea: '1 / 1',
              } as React.CSSProperties
            }
            className='w-[240px] self-end overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--bg)] shadow-sm'
          >
            <div className='flex flex-col gap-[8px] p-[8px]'>
              <div className='flex items-start gap-[8px]'>
                <div className='line-clamp-2 min-w-0 flex-1 font-medium text-[12px] text-[var(--text-body)]'>
                  {notification.level === 'error' && (
                    <span className='mr-[8px] mb-[2px] inline-block h-[8px] w-[8px] rounded-[2px] bg-[var(--text-error)] align-middle' />
                  )}
                  {notification.message}
                </div>
                <div className='flex shrink-0 items-start gap-[2px]'>
                  {showCountdown && <NotificationCountdownRing onPause={pauseAll} />}
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Button
                        variant='ghost'
                        onClick={() => removeNotification(notification.id)}
                        aria-label='Dismiss notification'
                        className='!p-[4px] -m-[2px] shrink-0 rounded-[5px] hover:bg-[var(--surface-active)]'
                      >
                        <X className='h-[14px] w-[14px] text-[var(--text-icon)]' />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      <Tooltip.Shortcut keys='⌘E'>Clear all</Tooltip.Shortcut>
                    </Tooltip.Content>
                  </Tooltip.Root>
                </div>
              </div>
              {hasAction && (
                <Button
                  variant='active'
                  onClick={() => executeAction(notification.id, notification.action!)}
                  className='w-full rounded-[5px] px-[8px] py-[4px] font-medium text-[12px]'
                >
                  {embedded && notification.action!.type === 'copilot'
                    ? 'Fix in Mothership'
                    : (ACTION_LABELS[notification.action!.type] ?? 'Take action')}
                </Button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
})
