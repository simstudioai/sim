import { memo, useCallback, useMemo } from 'react'
import { createLogger } from '@sim/logger'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { Button, Tooltip } from '@/components/emcn'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { createCommands } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import { usePreventZoom } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import {
  type NotificationAction,
  openCopilotWithMessage,
  useNotificationStore,
} from '@/stores/notifications'
import { usePanelStore } from '@/stores/panel'
import { useTerminalStore } from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('Notifications')
const MAX_VISIBLE_NOTIFICATIONS = 4

/**
 * Notifications display component.
 * Positioned in the bottom-right workspace area, reactive to panel width and terminal height.
 * Shows both global notifications and workflow-specific notifications.
 */
export const Notifications = memo(function Notifications() {
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
  const isTerminalResizing = useTerminalStore((state) => state.isResizing)
  const isPanelResizing = usePanelStore((state) => state.isResizing)

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
            openCopilotWithMessage(action.message)
            break
          case 'refresh':
            window.location.reload()
            break
          default:
            logger.warn('Unknown action type', { notificationId, actionType: action.type })
        }

        // Dismiss the notification after the action is triggered
        removeNotification(notificationId)
      } catch (error) {
        logger.error('Failed to execute notification action', {
          notificationId,
          actionType: action.type,
          error,
        })
      }
    },
    [removeNotification]
  )

  /**
   * Register global keyboard shortcut for clearing notifications.
   *
   * - Mod+E: Clear all notifications visible in the current workflow (including global ones).
   *
   * The command is disabled in editable contexts so it does not interfere with typing.
   */
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

  if (visibleNotifications.length === 0) {
    return null
  }

  const isResizing = isTerminalResizing || isPanelResizing

  return (
    <div
      ref={preventZoomRef}
      className={clsx(
        'fixed z-30 flex flex-col items-start',
        !isResizing && 'transition-[bottom,right] duration-100 ease-out'
      )}
      style={{
        bottom: 'calc(var(--terminal-height) + 16px)',
        right: 'calc(var(--panel-width) + 16px)',
      }}
    >
      {[...visibleNotifications].reverse().map((notification, index, stacked) => {
        const depth = stacked.length - index - 1
        const xOffset = depth * 3
        const hasAction = Boolean(notification.action)

        return (
          <div
            key={notification.id}
            style={
              {
                '--stack-offset': `${xOffset}px`,
                animation: 'notification-enter 200ms ease-out forwards',
              } as React.CSSProperties
            }
            className={`relative h-[80px] w-[240px] overflow-hidden rounded-[4px] border bg-[var(--surface-2)] ${
              index > 0 ? '-mt-[80px]' : ''
            }`}
          >
            <div className='flex h-full flex-col justify-between px-[8px] pt-[6px] pb-[8px]'>
              <div className='flex items-start gap-[8px]'>
                <div
                  className={`min-w-0 flex-1 font-medium text-[12px] leading-[16px] ${
                    hasAction ? 'line-clamp-2' : 'line-clamp-4'
                  }`}
                >
                  {notification.level === 'error' && (
                    <span className='mr-[6px] mb-[2.75px] inline-block h-[6px] w-[6px] rounded-[2px] bg-[var(--text-error)] align-middle' />
                  )}
                  {notification.message}
                </div>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      variant='ghost'
                      onClick={() => removeNotification(notification.id)}
                      aria-label='Dismiss notification'
                      className='!p-1.5 -m-1.5 shrink-0'
                    >
                      <X className='h-3 w-3' />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content>
                    <Tooltip.Shortcut keys='⌘E'>Clear all</Tooltip.Shortcut>
                  </Tooltip.Content>
                </Tooltip.Root>
              </div>
              {hasAction && (
                <Button
                  variant='active'
                  onClick={() => executeAction(notification.id, notification.action!)}
                  className='w-full px-[8px] py-[4px] font-medium text-[12px]'
                >
                  {notification.action!.type === 'copilot'
                    ? 'Fix in Copilot'
                    : notification.action!.type === 'refresh'
                      ? 'Refresh'
                      : 'Take action'}
                </Button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
})
